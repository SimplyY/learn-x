import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectDocumentsMarkdown, readContextFile } from "./scripts/documents-context.mjs";
import { buildUsageView, readLocalUsageStore, readUsageBaseline, recordLocalUsage } from "./scripts/chatpack-usage.mjs";
import { readPromptAssets } from "./scripts/prompt-assets.mjs";
import { containsPromptFragment } from "../../../skills/prompt-governance/scripts/fetch-prompt.mjs";
import { readChatPackConfig } from "./scripts/static-graph.mjs";
import { buildInsightContext } from "../../.agents/skills/learn-x-periodic-insight/scripts/periodic-insight-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const distRoot = path.join(repoRoot, "dist");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const ignoredWatchDirs = new Set([".git", ".test-tmp", "node_modules", "dist"]);
let suppressWatchUntil = 0;
let editorSaveInProgress = false;
// ponytail: one process-wide request gate; the shared file lock protects other processes.
let usageWriteInProgress = false;

async function serveStatic(_req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const absolutePath = path.resolve(distRoot, `.${requested}`);

  if (!absolutePath.startsWith(distRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const fileInfo = await stat(absolutePath);
    if (!fileInfo.isFile()) throw new Error("Not a file");
    const stream = createReadStream(absolutePath);
    const ext = path.extname(absolutePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png"
    };
    res.writeHead(200, staticResponseHeaders(ext, contentTypes));
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end("Unable to read file");
    });
    stream.pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

export function staticResponseHeaders(ext, contentTypes = {}) {
  const headers = { "content-type": contentTypes[ext] || "application/octet-stream" };
  // ponytail: local rebuilds replace hashed assets; stale HTML must not point at deleted entries.
  if (ext === ".html") headers["cache-control"] = "no-store";
  return headers;
}

function shouldRebuild(changedPath) {
  if (!changedPath) return false;
  const normalized = changedPath.split(path.sep);
  if (normalized.some((part) => ignoredWatchDirs.has(part))) return false;
  return path.extname(changedPath) === ".md";
}

function startMarkdownBuildWatcher() {
  let timer = null;
  let isBuilding = false;
  let needsRebuild = false;

  function runBuild(reason) {
    if (isBuilding) {
      needsRebuild = true;
      return;
    }

    isBuilding = true;
    console.log(`Markdown changed (${reason}); rebuilding static site...`);

    const build = spawn(process.execPath, ["app/code/scripts/build-static-data.mjs", "--target=local"], {
      cwd: repoRoot,
      stdio: "inherit"
    });

    build.on("close", (code) => {
      isBuilding = false;
      if (code !== 0) console.error(`Static rebuild failed with exit code ${code}`);
      if (needsRebuild) {
        needsRebuild = false;
        runBuild("queued changes");
      }
    });

    build.on("error", (error) => {
      isBuilding = false;
      console.error(`Static rebuild failed: ${error.message}`);
    });
  }

  const watcher = watch(repoRoot, { recursive: true }, (_eventType, filename) => {
    const changedPath = filename ? filename.toString() : "";
    if (Date.now() < suppressWatchUntil) return;
    if (!shouldRebuild(changedPath)) return;

    clearTimeout(timer);
    timer = setTimeout(() => runBuild(changedPath), 300);
  });

  watcher.on("error", (error) => {
    console.error(`Markdown watcher failed: ${error.message}`);
  });

  return watcher;
}

async function handleChatPackSave(req, res) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local editor requests only" });
    return;
  }
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type must be application/json" });
    return;
  }
  if (editorSaveInProgress) {
    sendJson(res, 409, { error: "Another Chat Pack save is still running" });
    return;
  }
  editorSaveInProgress = true;
  try {
    const payload = await readJsonBody(req);
    const { prepareChatPackEdits, writePreparedEdits } = await loadChatPackEditor();
    const writes = await prepareChatPackEdits({ repoRoot, payload });
    suppressWatchUntil = Date.now() + 2_000;
    await writePreparedEdits(writes);
    await runLocalBuild();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to save Chat Pack configuration" });
  } finally {
    editorSaveInProgress = false;
  }
}

async function loadChatPackEditor() {
  const editorPath = path.join(__dirname, "scripts/chatpack-editor.mjs");
  return import(`${pathToFileURL(editorPath).href}?t=${Date.now()}`);
}

export async function handleDocumentsContext(req, res, url, { collectFiles = collectDocumentsMarkdown, readContext = readContextFile } = {}) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local context requests only" });
    return;
  }
  try {
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/api/context-files") {
      sendJson(res, 200, { files: await collectFiles(undefined, repoRoot) });
      return;
    }
    const filePath = url.searchParams.get("path") || "";
    sendJson(res, 200, await readContext(filePath));
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to read Documents context" });
  }
}

async function handlePeriodicInsightContext(req, res, url) {
  if (!isLocalRequest(req)) { sendJson(res, 403, { error: "Local periodic insight requests only" }); return; }
  try {
    const payload = await buildInsightContext({
      repoRoot,
      taskId: url.searchParams.get("taskId") || "munger-soul",
      target: url.searchParams.get("target") || "auto",
      range: url.searchParams.get("range") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      includeTypes: url.searchParams.get("includeTypes") || undefined
    });
    sendJson(res, 200, payload);
  } catch (error) { sendJson(res, 400, { error: error.message || "Unable to build periodic insight context" }); }
}

async function fetchLatestPromptAsset(promptId) {
  const readerPath = process.env.PROMPT_GOVERNANCE_FETCHER
    ? path.resolve(process.env.PROMPT_GOVERNANCE_FETCHER)
    : path.resolve(repoRoot, "../skills/prompt-governance/scripts/fetch-prompt.mjs");
  const { fetchPrompt } = await import(pathToFileURL(readerPath).href);
  return fetchPrompt(promptId);
}

export async function handleChatPackPromptsLatest(req, res, {
  readManifest = () => readPromptAssets(repoRoot, { optional: false }),
  fetchAsset = fetchLatestPromptAsset
} = {}) {
  res.setHeader("cache-control", "no-store");
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local Prompt requests only" });
    return;
  }
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type must be application/json" });
    return;
  }

  let promptIds;
  try {
    const body = await readJsonBody(req);
    promptIds = body?.prompt_ids;
    if (!Array.isArray(promptIds) || promptIds.length < 1 || promptIds.length > 24 ||
        promptIds.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) ||
        new Set(promptIds).size !== promptIds.length) {
      throw new Error("prompt_ids must contain 1–24 unique prompt_id values");
    }
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Invalid Prompt request" });
    return;
  }

  let manifest;
  try {
    manifest = await readManifest();
  } catch (error) {
    sendJson(res, 503, { error: `Learn-X Prompt allowlist unavailable: ${error.message || "invalid manifest"}` });
    return;
  }
  const allowed = new Set(Object.keys(manifest.assets || {}));
  const unknown = promptIds.find((id) => !allowed.has(id));
  if (unknown) {
    sendJson(res, 400, { error: `Prompt is not registered for Learn-X: ${unknown}`, prompt_id: unknown });
    return;
  }

  const assets = {};
  for (const promptId of promptIds) {
    try {
      const asset = await fetchAsset(promptId);
      validateLatestPromptAsset(asset, promptId);
      assets[promptId] = asset;
    } catch (error) {
      sendJson(res, 502, {
        error: `飞书 Prompt ${promptId} 最新内容读取失败：${error.message || "invalid prompt-asset/v1"}`,
        prompt_id: promptId
      });
      return;
    }
  }
  sendJson(res, 200, { assets });
}

function validateLatestPromptAsset(asset, promptId) {
  if (!asset || asset.contract_version !== "prompt-asset/v1" || asset.prompt_id !== promptId) {
    throw new Error("响应的 Prompt 身份或 contract_version 无效");
  }
  if (typeof asset.prompt_source !== "string" || !asset.prompt_source.trim() ||
      typeof asset.prompt_document_id !== "string" || !asset.prompt_document_id.trim()) {
    throw new Error("响应缺少 Prompt 来源或 document_id");
  }
  if (!Number.isInteger(asset.prompt_revision) || asset.prompt_revision < 0) {
    throw new Error("响应缺少有效 prompt_revision");
  }
  if (typeof asset.content !== "string" || !asset.content.trim() || containsPromptFragment(asset.content)) {
    throw new Error("响应正文为空或不是完整 Prompt");
  }
  if (!/^[a-f0-9]{64}$/.test(asset.prompt_sha256) ||
      createHash("sha256").update(asset.content, "utf8").digest("hex") !== asset.prompt_sha256) {
    throw new Error("响应正文与 prompt_sha256 不一致");
  }
  if (!asset.prompt_fetched_at || Number.isNaN(Date.parse(asset.prompt_fetched_at))) {
    throw new Error("响应缺少有效 prompt_fetched_at");
  }
}

async function handleChatPackUsage(req, res) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local usage requests only" });
    return;
  }
  if (req.method === "GET") {
    try {
      const baseline = await readUsageBaseline(repoRoot);
      const local = await readLocalUsageStore(repoRoot);
      sendJson(res, 200, { ok: true, usage: buildUsageView(baseline, local) });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Unable to read Chat Pack usage" });
    }
    return;
  }
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type must be application/json" });
    return;
  }
  if (usageWriteInProgress) {
    sendJson(res, 409, { error: "Another Chat Pack usage write is still running" });
    return;
  }
  usageWriteInProgress = true;
  try {
    const payload = await readJsonBody(req);
    const config = await readChatPackConfig();
    const result = await recordLocalUsage({ repoRoot, payload, config });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to record Chat Pack usage" });
  } finally {
    usageWriteInProgress = false;
  }
}

export function isLocalRequest(req) {
  const remoteAddress = req.socket.remoteAddress || "";
  if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(remoteAddress)) return false;
  const hostHeader = req.headers.host || "";
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(hostHeader)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${hostHeader}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 1_000_000) req.destroy(new Error("Request body is too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function runLocalBuild() {
  return new Promise((resolve, reject) => {
    const build = spawn(process.execPath, ["app/code/scripts/build-static-data.mjs", "--target=local"], {
      cwd: repoRoot,
      stdio: "inherit"
    });
    build.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Local rebuild failed: ${code}`))));
    build.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watcher = startMarkdownBuildWatcher();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "PUT" && url.pathname === "/api/chatpack/editor") {
      await handleChatPackSave(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chatpack/prompts/latest") {
      await handleChatPackPromptsLatest(req, res);
      return;
    }
    if (url.pathname === "/api/chatpack/usage" && new Set(["GET", "POST"]).has(req.method)) {
      await handleChatPackUsage(req, res);
      return;
    }
    if (req.method === "GET" && new Set(["/api/context-files", "/api/file"]).has(url.pathname)) {
      await handleDocumentsContext(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/periodic-insights/context") {
      await handlePeriodicInsightContext(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  });

  server.listen(port, host, () => {
    console.log(`Learn-X static preview running at http://${host}:${port}`);
  });

  server.on("close", () => watcher.close());
}

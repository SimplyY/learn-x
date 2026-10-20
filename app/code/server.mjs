import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { collectDocumentsMarkdown, readContextFile } from "./scripts/documents-context.mjs";
import { buildUsageView, readLocalUsageStore, readUsageBaseline, recordLocalUsage } from "./scripts/chatpack-usage.mjs";
import { readPromptAssets } from "./scripts/prompt-assets.mjs";
import { containsPromptFragment, loadRegistry } from "../../../skills/prompt-governance/scripts/fetch-prompt.mjs";
import { ChatPackCache } from "./scripts/chatpack-cache.mjs";
import { readChatPackConfig } from "./scripts/static-graph.mjs";
import { buildInsightContext } from "../../.agents/skills/learn-x-periodic-insight/scripts/periodic-insight-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const defaultDistRoot = path.join(repoRoot, "dist");
const distRoot = resolveDistRoot(process.env.LEARN_X_DIST_DIR);
const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const ignoredWatchDirs = new Set([".git", ".test-tmp", "node_modules", "dist"]);
let suppressWatchUntil = 0;
let editorSaveInProgress = false;
// ponytail: one process-wide request gate; the shared file lock protects other processes.
let usageWriteInProgress = false;
const chatPackPromptAssetCache = new Map();
const chatPackCache = new ChatPackCache({
  filePath: path.join(__dirname, ".local", "chatpack-cache", "cache.json"),
  promptDescriptors: async () => {
    const [manifest, registry] = await Promise.all([readPromptAssets(repoRoot, { optional: false }), loadRegistry()]);
    return Object.entries(manifest.assets).map(([id, asset]) => {
      const source = registry.prompts?.[id]?.source;
      if (!source) throw new Error(`Prompt 来源映射缺失：${id}`);
      return { id, source, document_id: asset.synced.document_id };
    });
  },
  coreDescriptors: async () => {
    const configPath = path.resolve(repoRoot, "../core/config/core-truth.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config.schemaVersion !== "core-truth/v1" || config.lifecycle !== "official") throw new Error("Core 正式来源映射无效");
    return ["dao", "fa"].map((id) => {
      const document = config.documents?.[id];
      if (!document || typeof document.wikiUrl !== "string" || typeof document.documentId !== "string") throw new Error(`Core 来源映射缺失：${id}`);
      return { id, source: document.wikiUrl, document_id: document.documentId };
    });
  },
  fetchPrompt: async (descriptor) => {
    const asset = await fetchLatestPromptAsset(descriptor.id);
    validateLatestPromptAsset(asset, descriptor.id);
    if (asset.prompt_source !== descriptor.source || asset.prompt_document_id !== descriptor.document_id) throw new Error("飞书 Prompt 来源身份与登记映射不一致");
    return asset;
  },
  fetchCore: async (descriptor) => {
    const kind = descriptor.id === "dao" ? "Core/道" : "Core/法";
    const asset = await readContextFile(kind);
    if (asset.sourceUrl !== descriptor.source || asset.documentId !== descriptor.document_id) throw new Error("Core 来源身份与登记映射不一致");
    return asset;
  }
});
let chatPackCacheInitialization;

function ensureChatPackCache() {
  if (!chatPackCacheInitialization) chatPackCacheInitialization = chatPackCache.initialize();
  return chatPackCacheInitialization;
}

async function serveStatic(_req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const absolutePath = path.resolve(distRoot, `.${requested}`);

  if (absolutePath !== distRoot && !absolutePath.startsWith(`${distRoot}${path.sep}`)) {
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

function resolveDistRoot(configuredPath) {
  if (!configuredPath) return defaultDistRoot;
  const resolved = path.resolve(repoRoot, configuredPath);
  const relative = path.relative(defaultDistRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("LEARN_X_DIST_DIR must stay inside dist/");
  return resolved;
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

async function fetchLatestPromptAsset(promptId, { signal } = {}) {
  const readerPath = process.env.PROMPT_GOVERNANCE_FETCHER
    ? path.resolve(process.env.PROMPT_GOVERNANCE_FETCHER)
    : path.resolve(repoRoot, "../skills/prompt-governance/scripts/fetch-prompt.mjs");
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [readerPath, promptId], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 65_000,
      signal
    }));
  } catch (error) {
    if (error.code === "ETIMEDOUT") throw new Error("Prompt 子进程读取超时（65 秒）");
    throw new Error(error.stderr?.trim() || error.message || "Prompt reader failed");
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Prompt reader returned invalid JSON");
  }
}

export async function handleChatPackCacheStatus(req, res, { cache = chatPackCache, initialize = ensureChatPackCache } = {}) {
  res.setHeader("cache-control", "no-store");
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local Chat Pack cache requests only" });
    return;
  }
  try {
    await initialize();
    sendJson(res, 200, await cache.status());
  } catch (error) {
    sendJson(res, 503, { error: error.message || "Chat Pack cache service unavailable", cache_service: "unavailable" });
  }
}

export async function handleChatPackCacheRefresh(req, res, { cache = chatPackCache, initialize = ensureChatPackCache } = {}) {
  res.setHeader("cache-control", "no-store");
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local Chat Pack cache requests only" });
    return;
  }
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type must be application/json" });
    return;
  }
  try {
    const payload = await readJsonBody(req);
    const promptIds = payload?.prompt_ids ?? [];
    const coreKinds = payload?.core_kinds ?? [];
    if (!validCacheSelection(promptIds, 24) || !validCacheSelection(coreKinds, 2) ||
        coreKinds.some((kind) => !new Set(["dao", "fa"]).has(kind))) {
      throw new Error("prompt_ids/core_kinds must contain unique registered resource IDs");
    }
    await initialize();
    const result = await cache.requestRefresh({ priority: [
      ...promptIds.map((id) => `prompt:${id}`),
      ...coreKinds.map((id) => `core:${id}`)
    ] });
    if (result.state === "failed") {
      sendJson(res, 503, { accepted: false, ...result });
      return;
    }
    sendJson(res, 202, { accepted: true, ...result });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to request Chat Pack cache refresh" });
  }
}

export async function handleChatPackCacheRead(req, res, { cache = chatPackCache, initialize = ensureChatPackCache } = {}) {
  res.setHeader("cache-control", "no-store");
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local Chat Pack cache requests only" });
    return;
  }
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type must be application/json" });
    return;
  }
  try {
    const payload = await readJsonBody(req);
    const promptIds = payload?.prompt_ids ?? [];
    const coreKinds = payload?.core_kinds ?? [];
    if (!validCacheSelection(promptIds, 24) || !validCacheSelection(coreKinds, 2) ||
        coreKinds.some((kind) => !new Set(["dao", "fa"]).has(kind))) {
      throw new Error("prompt_ids/core_kinds must contain unique registered resource IDs");
    }
    await initialize();
    const result = await cache.read({ promptIds, coreKinds });
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 503, { error: error.message || "Chat Pack cache service unavailable", cache_service: "unavailable" });
  }
}

function validCacheSelection(value, maximum) {
  return Array.isArray(value) && value.length <= maximum &&
    value.every((item) => typeof item === "string" && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(item)) &&
    new Set(value).size === value.length;
}

export async function handleChatPackPromptsLatest(req, res, {
  readManifest = () => readPromptAssets(repoRoot, { optional: false }),
  fetchAsset = fetchLatestPromptAsset,
  cache = chatPackPromptAssetCache
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
  let cacheOnly = false;
  try {
    const body = await readJsonBody(req);
    promptIds = body?.prompt_ids;
    cacheOnly = body?.cache_only === true;
    if (!Array.isArray(promptIds) || promptIds.length < 1 || promptIds.length > 24 ||
        promptIds.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) ||
        new Set(promptIds).size !== promptIds.length ||
        (body?.cache_only !== undefined && typeof body.cache_only !== "boolean")) {
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

  if (cacheOnly) {
    const cacheHit = promptIds.every((promptId) => cache.has(promptId));
    sendJson(res, 200, {
      cache_hit: cacheHit,
      assets: cacheHit ? Object.fromEntries(promptIds.map((promptId) => [promptId, cache.get(promptId)])) : {}
    });
    return;
  }

  const assets = {};
  for (let index = 0; index < promptIds.length; index += 2) {
    const batchIds = promptIds.slice(index, index + 2);
    const controller = new AbortController();
    const reads = batchIds.map(async (promptId) => {
      try {
        const asset = await fetchAsset(promptId, { signal: controller.signal });
        validateLatestPromptAsset(asset, promptId);
        return asset;
      } catch (error) {
        const failure = new Error(error?.message || "invalid prompt-asset/v1");
        failure.promptId = promptId;
        throw failure;
      }
    });
    try {
      const batchAssets = await Promise.all(reads);
      for (let offset = 0; offset < batchAssets.length; offset += 1) {
        assets[batchIds[offset]] = batchAssets[offset];
        cache.set(batchIds[offset], batchAssets[offset]);
      }
    } catch (error) {
      controller.abort();
      const promptId = error.promptId || batchIds[0];
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
    if (req.method === "GET" && url.pathname === "/api/chatpack/cache/status") {
      await handleChatPackCacheStatus(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chatpack/cache/refresh") {
      await handleChatPackCacheRefresh(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chatpack/cache/read") {
      await handleChatPackCacheRead(req, res);
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
    void ensureChatPackCache().catch((error) => console.error(`Chat Pack cache initialization failed: ${error.message || error}`));
  });

  server.on("close", () => watcher.close());
}

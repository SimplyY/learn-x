import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareChatPackEdits, writePreparedEdits } from "./scripts/chatpack-editor.mjs";
import { collectDocumentsMarkdown, readDocumentsMarkdown } from "./scripts/documents-context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const distRoot = path.join(repoRoot, "dist");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const ignoredWatchDirs = new Set([".git", ".test-tmp", "node_modules", "dist"]);
let suppressWatchUntil = 0;
let editorSaveInProgress = false;

async function serveStatic(_req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
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
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream" });
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

async function handleDocumentsContext(req, res, url) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { error: "Local context requests only" });
    return;
  }
  try {
    if (url.pathname === "/api/context-files") {
      sendJson(res, 200, { files: await collectDocumentsMarkdown(undefined, repoRoot) });
      return;
    }
    const filePath = url.searchParams.get("path") || "";
    sendJson(res, 200, { path: filePath, content: await readDocumentsMarkdown(filePath) });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to read Documents context" });
  }
}

function isLocalRequest(req) {
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
    if (req.method === "GET" && new Set(["/api/context-files", "/api/file"]).has(url.pathname)) {
      await handleDocumentsContext(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  });

  server.listen(port, host, () => {
    console.log(`Learn-X static preview running at http://${host}:${port}`);
  });

  server.on("close", () => watcher.close());
}

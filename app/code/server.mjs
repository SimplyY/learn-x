import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const distRoot = path.join(repoRoot, "dist");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const ignoredWatchDirs = new Set([".git", "node_modules", "dist"]);

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

    const build = spawn(process.execPath, ["app/code/scripts/build-static-data.mjs"], {
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
    if (!shouldRebuild(changedPath)) return;

    clearTimeout(timer);
    timer = setTimeout(() => runBuild(changedPath), 300);
  });

  watcher.on("error", (error) => {
    console.error(`Markdown watcher failed: ${error.message}`);
  });

  return watcher;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watcher = startMarkdownBuildWatcher();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    await serveStatic(req, res, url);
  });

  server.listen(port, host, () => {
    console.log(`Learn-X static preview running at http://${host}:${port}`);
  });

  server.on("close", () => watcher.close());
}

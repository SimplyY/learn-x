import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { APP_CONFIG } from "./public/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false
});
const defaultLinkOpen =
  markdown.renderer.rules.link_open ||
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") || "";

  if (href.startsWith("learnx://") || href.endsWith(".md") || href.includes(".md#")) {
    const target = href.startsWith("learnx://")
      ? decodeURIComponent(href.replace("learnx://", ""))
      : normalizeMarkdownLink(href);
    token.attrSet("href", "#");
    token.attrSet("class", "wiki-link");
    token.attrSet("data-target", target);
  } else if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite"]);
const IGNORED_FILES = new Set(["AGENTS.md", "CONTEXT_MASTER.md"]);
const PROMPT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function collectMarkdownFiles(dir = repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name === "code") continue;
      files.push(...(await collectMarkdownFiles(path.join(dir, entry.name))));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md") || IGNORED_FILES.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, absolutePath);
    const content = await readFile(absolutePath, "utf8");
    const info = await stat(absolutePath);
    files.push({
      path: relativePath,
      title: titleFromMarkdown(content, relativePath),
      content,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      links: extractLinks(content)
    });
  }

  return files.sort(compareFilePaths);
}

function titleFromMarkdown(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(fallback, ".md");
}

function extractLinks(content) {
  const links = new Set();
  const wikiPattern = /\[\[([^\]\n]+)\]\]/g;
  const mdPattern = /\[[^\]\n]+\]\(([^)\n]+\.md(?:#[^)]+)?)\)/g;
  let match;

  while ((match = wikiPattern.exec(content))) links.add(match[1].trim());
  while ((match = mdPattern.exec(content))) links.add(decodeURI(match[1].trim()));
  return [...links];
}

export function renderMarkdown(content) {
  const withWikiLinks = content.replace(/\[\[([^\]\n]+)\]\]/g, (_match, target) => {
    const clean = target.trim();
    return `[${clean}](learnx://${encodeURIComponent(clean)})`;
  });
  const rendered = markdown.render(withWikiLinks);

  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["target", "data-target"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|learnx):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  });
}

function normalizeMarkdownLink(href) {
  const [withoutHash] = href.split("#");
  return decodeURIComponent(withoutHash).replace(/^\.\//, "");
}

function buildTree(files) {
  const root = { name: "Learn-X", type: "root", children: [] };
  for (const file of files) {
    const parts = file.path.split(path.sep);
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      let node = cursor.children.find((child) => child.name === part);
      if (!node) {
        node = {
          name: part,
          type: isFile ? "file" : "folder",
          path: isFile ? file.path : undefined,
          children: isFile ? undefined : []
        };
        cursor.children.push(node);
      }
      if (!isFile) cursor = node;
    }
  }
  return root;
}

function buildSources(files) {
  const sourceMap = new Map([["README.md", { path: "README.md", label: "README.md", type: "file" }]]);
  for (const file of files) {
    const parts = file.path.split(path.sep);
    if (parts[0] === "道") {
      sourceMap.set("道", { path: "道", label: "道/", type: "directory" });
    }
    if (parts[0] === "法" && parts[1]) {
      if (parts[1] === "meta-prompts") continue;
      const domainPath = `法/${parts[1]}`;
      sourceMap.set(domainPath, { path: domainPath, label: `${domainPath}/`, type: "domain" });
    }
  }

  return [...sourceMap.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function buildDomains(files) {
  const domains = new Set();
  for (const file of files) {
    const parts = file.path.split(path.sep);
    if (parts[1] === "meta-prompts") continue;
    if (parts[0] === "法" && parts[1]) domains.add(parts[1]);
  }
  return [...domains].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function readPrompt(id) {
  if (!PROMPT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid prompt id: ${id}`);
  }

  const promptDirectory = APP_CONFIG.promptDirectory || "meta-prompts";
  const promptRoot = path.resolve(repoRoot, promptDirectory);
  const absolutePath = path.resolve(promptRoot, `${id}.md`);

  if (!absolutePath.startsWith(`${promptRoot}${path.sep}`)) {
    throw new Error(`Invalid prompt path: ${id}`);
  }

  return readFile(absolutePath, "utf8");
}

async function buildPromptMap() {
  const entries = await Promise.all(
    APP_CONFIG.learningScenarios.map(async (scenario) => {
      try {
        return [scenario.id, await readPrompt(scenario.id)];
      } catch (error) {
        return [scenario.id, `# Prompt 加载失败\n\n${error.message}`];
      }
    })
  );

  return Object.fromEntries(entries);
}

export function filterFilesByIncludes(files, includes) {
  if (!includes.length) return files;
  return files.filter((file) =>
    includes.some((includePath) => file.path === includePath || file.path.startsWith(`${includePath}/`))
  );
}

export function buildContext(files, label = "Learn-X") {
  const generatedAt = new Date().toISOString();
  const body = files
    .map((file) => `## ${file.path}\n\n${demoteMarkdownHeadings(file.content.trim())}\n`)
    .join("\n---\n\n");

  return `# CONTEXT_MASTER\n\nSource: ${label}\nGenerated from Learn-X at ${generatedAt}.\n\n${body}\n`;
}

function compareFilePaths(a, b) {
  const aDepth = a.path.split(path.sep).length;
  const bDepth = b.path.split(path.sep).length;
  if (aDepth !== bDepth) return aDepth - bDepth;
  return a.path.localeCompare(b.path, "zh-Hans-CN");
}

function demoteMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (match, hashes) => {
    const level = Math.min(hashes.length + 2, 6);
    return `${"#".repeat(level)} `;
  });
}

function json(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function rejectUnsafePath(filePath) {
  const absolutePath = path.resolve(repoRoot, filePath);
  if (!absolutePath.startsWith(repoRoot) || !absolutePath.endsWith(".md")) {
    throw new Error("Invalid file path");
  }
  return absolutePath;
}

export async function buildGraphPayload({ includeContent = false } = {}) {
  const files = await collectMarkdownFiles();
  const prompts = await buildPromptMap();

  return {
    files: files.map((file) => {
      const preview = file.content.trim().split(/\n\s*\n/)[0] || "";
      const payload = {
        path: file.path,
        title: file.title,
        size: file.size,
        modifiedAt: file.modifiedAt,
        links: file.links,
        preview,
        previewHtml: renderMarkdown(preview)
      };
      if (includeContent) {
        payload.content = file.content;
        payload.html = renderMarkdown(file.content);
      }
      return payload;
    }),
    tree: buildTree(files),
    sources: buildSources(files),
    domains: buildDomains(files),
    prompts,
    promptDirectory: APP_CONFIG.promptDirectory || "meta-prompts"
  };
}

async function routeApi(req, res, url) {
  const files = await collectMarkdownFiles();

  if (url.pathname === "/api/graph") {
    json(res, await buildGraphPayload());
    return;
  }

  if (url.pathname === "/api/file") {
    const filePath = url.searchParams.get("path");
    if (!filePath) return json(res, { error: "Missing path" }, 400);
    const absolutePath = rejectUnsafePath(filePath);
    const content = await readFile(absolutePath, "utf8");
    json(res, {
      path: path.relative(repoRoot, absolutePath),
      title: titleFromMarkdown(content, filePath),
      content,
      html: renderMarkdown(content),
      links: extractLinks(content)
    });
    return;
  }

  if (url.pathname === "/api/context") {
    const includes = url.searchParams.getAll("include").filter(Boolean);
    const scene = url.searchParams.get("scene") || "learn-x";
    const selectedFiles = filterFilesByIncludes(files, includes);
    const content = buildContext(selectedFiles, scene);
    json(res, {
      fileName: "CONTEXT_MASTER.md",
      generatedAt: new Date().toISOString(),
      fileCount: selectedFiles.length,
      bytes: Buffer.byteLength(content, "utf8"),
      includedPaths: selectedFiles.map((file) => file.path),
      content
    });
    return;
  }

  json(res, { error: "Not found" }, 404);
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const absolutePath = path.resolve(publicRoot, `.${requested}`);

  if (!absolutePath.startsWith(publicRoot)) {
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
      ".svg": "image/svg+xml"
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/api/")) await routeApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      json(res, { error: error.message }, 500);
    }
  });

  server.listen(port, host, () => {
    console.log(`Learn-X visualizer running at http://${host}:${port}`);
  });
}

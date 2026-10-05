import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const documentsRoot = "/Users/yuwei/code";
const coreReaderUrl = new URL("file:///Users/yuwei/code/core/scripts/read-core-truth.mjs");
const coreSources = new Map([
  ["Core/道", { kind: "dao", title: "道", layer: "dao" }],
  ["Core/法", { kind: "fa", title: "法", layer: "fa" }]
]);
const excludedTruthPaths = [
  "learn-x/01_core/道",
  "learn-x/01_core/法",
  "core/runtime/migrations/2026-10-core-dao-fa"
];

function isWithin(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

async function excludedTruthRoots(root) {
  return Promise.all(excludedTruthPaths.map(async (relativePath) => {
    const lexical = path.resolve(root, relativePath);
    try { return { lexical, actual: await realpath(lexical) }; }
    catch (error) { if (error.code === "ENOENT") return { lexical, actual: lexical }; throw error; }
  }));
}

function isExcludedTruthPath(candidate, excludedRoots) {
  return excludedRoots.some(({ lexical, actual }) => isWithin(candidate, lexical) || isWithin(candidate, actual));
}

async function readLiveCoreTruth(kind) {
  const { readCoreTruth } = await import(coreReaderUrl.href);
  return readCoreTruth(kind);
}

export async function readContextFile(virtualPath, { root = documentsRoot, readTruth = readLiveCoreTruth } = {}) {
  const source = coreSources.get(virtualPath);
  if (!source) return { path: virtualPath, content: await readDocumentsMarkdown(virtualPath, root) };
  const result = await readTruth(source.kind);
  if (result?.kind !== source.kind || typeof result.content !== "string" || !result.content.trim()) {
    throw new Error("Core truth reader returned invalid content");
  }
  return { ...result, path: virtualPath, title: source.title, layer: source.layer, live: true, external: true };
}

const ignoredDirectories = new Set([
  ".agents",
  ".git",
  ".skills",
  ".test-tmp",
  "build",
  "dist",
  "node_modules"
]);
const ignoredFiles = new Set(["AGENTS.md", "CONTEXT_MASTER.md"]);
const sensitiveName = /token|secret|credential|password|cookie|session|wallet/i;

export async function collectDocumentsMarkdown(root = documentsRoot, excludedRoot = "") {
  const resolvedRoot = await realpath(root);
  const resolvedExcluded = excludedRoot ? path.resolve(excludedRoot) : "";
  const excludedRoots = await excludedTruthRoots(resolvedRoot);
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || sensitiveName.test(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (resolvedExcluded && (absolutePath === resolvedExcluded || absolutePath.startsWith(`${resolvedExcluded}${path.sep}`))) continue;
      if (isExcludedTruthPath(absolutePath, excludedRoots)) continue;

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        if (entry.name === "code" && path.basename(directory) === "app") continue;
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md" || ignoredFiles.has(entry.name)) continue;
      const relativePath = path.relative(resolvedRoot, absolutePath);
      const info = await stat(absolutePath);
      files.push({
        path: `Documents/${relativePath.split(path.sep).join("/")}`,
        title: path.basename(entry.name, path.extname(entry.name)),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        external: true,
        defaultStrategy: "normal"
      });
    }
  }

  await visit(resolvedRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

export async function readDocumentsMarkdown(virtualPath, root = documentsRoot) {
  if (typeof virtualPath !== "string" || !virtualPath.startsWith("Documents/")) throw new Error("Invalid Documents path");
  const relativePath = virtualPath.slice("Documents/".length);
  if (path.extname(relativePath).toLowerCase() !== ".md" || sensitiveName.test(relativePath)) throw new Error("Unsupported Documents file");

  const resolvedRoot = await realpath(root);
  const requested = path.resolve(resolvedRoot, relativePath);
  const excludedRoots = await excludedTruthRoots(resolvedRoot);
  if (isExcludedTruthPath(requested, excludedRoots)) throw new Error("Historical Dao/Fa content is not an active context source");
  const candidate = await realpath(requested);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Documents path escapes allowed root");
  if (isExcludedTruthPath(candidate, excludedRoots)) throw new Error("Historical Dao/Fa content is not an active context source");
  if (ignoredFiles.has(path.basename(candidate))) throw new Error("Unsupported Documents file");
  return readFile(candidate, "utf8");
}

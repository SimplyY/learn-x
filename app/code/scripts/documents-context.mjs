import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const documentsRoot = "/Users/yuwei/code";

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
  const resolvedRoot = path.resolve(root);
  const resolvedExcluded = excludedRoot ? path.resolve(excludedRoot) : "";
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || sensitiveName.test(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (resolvedExcluded && (absolutePath === resolvedExcluded || absolutePath.startsWith(`${resolvedExcluded}${path.sep}`))) continue;

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
  const candidate = await realpath(path.resolve(resolvedRoot, relativePath));
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Documents path escapes allowed root");
  if (ignoredFiles.has(path.basename(candidate))) throw new Error("Unsupported Documents file");
  return readFile(candidate, "utf8");
}

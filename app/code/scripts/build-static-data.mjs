import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphPayload } from "./static-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const publicRoot = path.join(repoRoot, "app/code/public");
const distRoot = path.join(repoRoot, "dist");
const dataRoot = path.join(distRoot, "data");

const graph = await buildGraphPayload({ includeContent: true });
const assetReferences = new Map();

await rm(distRoot, { recursive: true, force: true });
await cp(publicRoot, distRoot, {
  recursive: true,
  filter: (source) => path.basename(source) !== "data" && path.basename(source) !== ".nojekyll"
});
await mkdir(dataRoot, { recursive: true });
const graphJson = JSON.stringify(graph);
const graphJsonPath = await writeHashedFile(dataRoot, "graph", ".json", graphJson);
const graphScriptPath = await writeHashedFile(
  dataRoot,
  "graph",
  ".js",
  [
    `window.LEARN_X_GRAPH_URL=${JSON.stringify(`data/${graphJsonPath}`)};`,
    `window.LEARN_X_GRAPH=${graphJson};`,
    ""
  ].join("\n")
);
assetReferences.set("data/graph.js", `data/${graphScriptPath}`);
assetReferences.set("data/graph.json", `data/${graphJsonPath}`);
assetReferences.set("styles.css", await renameWithHash(distRoot, "styles.css"));
assetReferences.set("app.js", await renameWithHash(distRoot, "app.js"));
await rewriteIndexReferences(path.join(distRoot, "index.html"), assetReferences);
await writeFile(path.join(distRoot, ".nojekyll"), "", "utf8");

console.log(
  `Static site generated: dist (${graph.files.length} files, ${Object.keys(graph.prompts).length} prompts, ${assetReferences.size} hashed assets)`
);

async function writeHashedFile(directory, basename, extension, content) {
  const hash = contentHash(content);
  const filename = `${basename}.${hash}${extension}`;
  await writeFile(path.join(directory, filename), content, "utf8");
  return filename;
}

async function renameWithHash(root, relativePath) {
  const sourcePath = path.join(root, relativePath);
  const content = await readFile(sourcePath);
  const parsed = path.parse(relativePath);
  const hashedName = `${parsed.name}.${contentHash(content)}${parsed.ext}`;
  const hashedRelativePath = path.join(parsed.dir, hashedName).replaceAll(path.sep, "/");
  await rename(sourcePath, path.join(root, hashedRelativePath));
  return hashedRelativePath;
}

async function rewriteIndexReferences(indexPath, references) {
  let html = await readFile(indexPath, "utf8");
  for (const [original, hashed] of references) {
    html = html.replaceAll(original, hashed);
  }
  await writeFile(indexPath, html, "utf8");
}

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

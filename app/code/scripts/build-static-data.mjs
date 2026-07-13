import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatPackPromptPayload, buildContentPayload, buildGraphPayload, isPublicPrivatePath } from "./static-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const publicRoot = path.join(repoRoot, "app/code/public");
const defaultDistRoot = path.join(repoRoot, "dist");

const targetArg = process.argv.find((argument) => argument.startsWith("--target="));
const target = targetArg?.split("=")[1] || "public";
const outDirArg = process.argv.find((argument) => argument.startsWith("--out-dir="));
const distRoot = resolveDistRoot(outDirArg?.slice("--out-dir=".length));
const dataRoot = path.join(distRoot, "data");
const contextEnabled = process.env.LEARN_X_CHATPACK_CONTEXT !== "off";
const graph = await buildGraphPayload({ includeContent: false, target, contextEnabled });
const content = await buildContentPayload({ target, contextEnabled });
const prompts = await buildChatPackPromptPayload({ target });
const assetReferences = new Map();

await rm(distRoot, { recursive: true, force: true });
await cp(publicRoot, distRoot, {
  recursive: true,
  filter: (source) => path.basename(source) !== "data" && path.basename(source) !== ".nojekyll"
});
await mkdir(dataRoot, { recursive: true });
const graphJson = JSON.stringify(graph);
const graphJsonPath = await writeHashedFile(dataRoot, "graph", ".json", graphJson);
const contentJsonPath = await writeHashedFile(dataRoot, "content", ".json", JSON.stringify(content));
const promptsJsonPath = await writeHashedFile(dataRoot, "prompts", ".json", JSON.stringify(prompts));
const graphScriptPath = await writeHashedFile(
  dataRoot,
  "graph",
  ".js",
  [
    `window.LEARN_X_GRAPH_URL=${JSON.stringify(`data/${graphJsonPath}`)};`,
    `window.LEARN_X_CONTENT_URL=${JSON.stringify(`data/${contentJsonPath}`)};`,
    `window.LEARN_X_PROMPTS_URL=${JSON.stringify(`data/${promptsJsonPath}`)};`,
    ""
  ].join("\n")
);
assetReferences.set("data/graph.js", `data/${graphScriptPath}`);
assetReferences.set("data/graph.json", `data/${graphJsonPath}`);
assetReferences.set("styles.css", await renameWithHash(distRoot, "styles.css"));
assetReferences.set("app.js", await renameWithHash(distRoot, "app.js"));
await rewriteModuleImport(path.join(distRoot, "editor.js"), "./app.js", `./${assetReferences.get("app.js")}`);
await rewriteIndexReferences(path.join(distRoot, "index.html"), assetReferences);
await writeFile(path.join(distRoot, ".nojekyll"), "", "utf8");

if (target === "public") assertPublicArtifact(graph);

console.log(
  `Static site generated: ${path.relative(repoRoot, distRoot) || "dist"}/${target} (${graph.files.length} files, ${Object.keys(prompts.subtypes).length} Chat Pack prompts, ${Object.keys(prompts.enhancers).length} enhancers, context ${contextEnabled ? "on" : "off"}, ${assetReferences.size} hashed assets)`
);

function resolveDistRoot(outDir) {
  if (!outDir) return defaultDistRoot;
  const resolved = path.resolve(repoRoot, outDir);
  const relative = path.relative(defaultDistRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--out-dir must stay inside dist/");
  }
  return resolved;
}

function assertPublicArtifact(graphPayload) {
  const exposedPaths = [
    ...(graphPayload.files || []).map((file) => file.path),
    ...(graphPayload.contextFiles || []).map((file) => file.path),
    ...(graphPayload.customContextFiles || []).map((file) => file.path),
    ...(graphPayload.chatPackConfig?.dialogueTypes || []).flatMap((type) =>
      (type.subtypes || []).flatMap((subtype) => subtype.recommendedSources || [])
    )
  ];
  const leakedPath = exposedPaths.find(isPublicPrivatePath);
  if (leakedPath) throw new Error(`Public build exposes private path: ${leakedPath}`);
}

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

async function rewriteModuleImport(modulePath, original, replacement) {
  const source = await readFile(modulePath, "utf8");
  await writeFile(modulePath, source.replaceAll(original, replacement), "utf8");
}

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

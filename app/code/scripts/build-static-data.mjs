import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatPackPromptPayload, buildContentPayload, buildGraphPayload, isPublicPrivatePath } from "./static-graph.mjs";
import { readPromptAssets } from "./prompt-assets.mjs";

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

if (target === "public") {
  const promptManifest = await readPromptAssets(repoRoot, { optional: false });
  await assertPublicArtifact(graph, content, prompts, promptManifest);
}

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
await rewriteIndexReferences(path.join(distRoot, "index.html"), assetReferences, contextEnabled, target);
await writeFile(path.join(distRoot, ".nojekyll"), "", "utf8");

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

async function assertPublicArtifact(graphPayload, contentPayload, promptPayload, promptManifest) {
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

  const serialized = JSON.stringify({ graph: graphPayload, content: contentPayload, prompts: promptPayload });
  const coreSourceArtifacts = [
    "https://ywhome.feishu.cn/wiki/BZKNwMA5KiczTFkiFAEcqUeDnXg",
    "https://ywhome.feishu.cn/wiki/RfwBwmu6piXlM5kP0HRcFXMmn4b",
    "W5R3d90wQoUlZRx7zNlcIffRnXf",
    "DCdQdn4Qyor2QwxwZ6Hcnib6n89",
    "Core/道",
    "Core/法"
  ];
  const leakedCoreArtifact = coreSourceArtifacts.find((value) => serialized.includes(value));
  if (leakedCoreArtifact) throw new Error(`Public build exposes Core source metadata: ${leakedCoreArtifact}`);

  const managedPromptPaths = new Set(Object.values(promptManifest.assets || {}).map((asset) => asset.local_path.replaceAll("\\", "/")));
  const exposedPromptPath = [
    ...(graphPayload.chatPackConfig?.dialogueTypes || []).flatMap((type) => type.subtypes || []),
    ...(graphPayload.chatPackConfig?.enhancers || [])
  ].map((item) => item.promptPath).find((promptPath) => managedPromptPaths.has(promptPath));
  if (exposedPromptPath) throw new Error(`Public build exposes governed Prompt metadata path: ${exposedPromptPath}`);

  for (const [promptId, asset] of Object.entries(promptManifest.assets || {})) {
    const promptPath = asset.local_path.replaceAll("\\", "/");
    if (exposedPaths.includes(promptPath) || Object.hasOwn(contentPayload.files || {}, promptPath) || Object.hasOwn(contentPayload.customContextFiles || {}, promptPath)) {
      throw new Error(`Public build exposes governed Prompt path: ${promptPath}`);
    }
    try {
      const promptBody = (await readFile(path.join(repoRoot, promptPath), "utf8")).trim();
      if (promptBody && serialized.includes(promptBody)) {
        throw new Error(`Public build exposes governed Prompt body: ${promptId}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
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

async function rewriteIndexReferences(indexPath, references, contextEnabled, target) {
  let html = await readFile(indexPath, "utf8");
  for (const [original, hashed] of references) {
    html = html.replaceAll(original, hashed);
  }
  if (!contextEnabled) {
    html = html.replace('id="contextControls" class="source-box"', 'id="contextControls" class="source-box" hidden');
  }
  if (target === "local") {
    html = html.replace(
      "</head>",
      '<script>window.LEARN_X_PERIODIC_INSIGHT_CONTEXT_API="/api/periodic-insights/context";</script>\n</head>'
    );
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

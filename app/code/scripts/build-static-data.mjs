import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphPayload } from "./static-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const publicRoot = path.join(repoRoot, "app/code/public");
const distRoot = path.join(repoRoot, "dist");
const dataRoot = path.join(distRoot, "data");

const graph = await buildGraphPayload({ includeContent: true });

await rm(distRoot, { recursive: true, force: true });
await cp(publicRoot, distRoot, {
  recursive: true,
  filter: (source) => path.basename(source) !== "data" && path.basename(source) !== ".nojekyll"
});
await mkdir(dataRoot, { recursive: true });
await writeFile(path.join(dataRoot, "graph.json"), JSON.stringify(graph), "utf8");
await writeFile(path.join(dataRoot, "graph.js"), `window.LEARN_X_GRAPH=${JSON.stringify(graph)};\n`, "utf8");
await writeFile(path.join(distRoot, ".nojekyll"), "", "utf8");

console.log(`Static site generated: dist (${graph.files.length} files, ${Object.keys(graph.prompts).length} prompts)`);

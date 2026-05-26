import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphPayload } from "../server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, "../public");
const dataRoot = path.join(publicRoot, "data");

const graph = await buildGraphPayload({ includeContent: true });

await mkdir(dataRoot, { recursive: true });
await writeFile(path.join(dataRoot, "graph.json"), JSON.stringify(graph), "utf8");
await writeFile(path.join(publicRoot, ".nojekyll"), "", "utf8");

console.log(`Static graph generated: ${graph.files.length} files, ${Object.keys(graph.prompts).length} prompts`);

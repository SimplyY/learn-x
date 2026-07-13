import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("built modules reference the hashed application entry", async () => {
  execFileSync(process.execPath, ["app/code/scripts/build-static-data.mjs", "--target=local"], {
    cwd: repoRoot,
    stdio: "ignore"
  });
  const index = await readFile(path.join(repoRoot, "dist/index.html"), "utf8");
  const appEntry = index.match(/src="(app\.[^"]+\.js)"/)?.[1];
  assert.ok(appEntry);
  const editor = await readFile(path.join(repoRoot, "dist/editor.js"), "utf8");
  assert.match(editor, new RegExp(`from "\\./${appEntry.replaceAll(".", "\\.")}"`));
});

test("no-context build omits selectable context payloads", async () => {
  execFileSync(process.execPath, ["app/code/scripts/build-static-data.mjs", "--target=public", "--out-dir=dist/no-context"], {
    cwd: repoRoot,
    env: { ...process.env, LEARN_X_CHATPACK_CONTEXT: "off" },
    stdio: "ignore"
  });
  const dataDirectory = path.join(repoRoot, "dist/no-context/data");
  const index = await readFile(path.join(repoRoot, "dist/no-context/index.html"), "utf8");
  const graphFile = (await readdir(dataDirectory)).find((file) => /^graph\..+\.json$/.test(file));
  assert.ok(graphFile);
  assert.match(index, /id="contextControls" class="source-box" hidden/);
  const graph = JSON.parse(await readFile(path.join(dataDirectory, graphFile), "utf8"));
  assert.equal(graph.runtime.contextEnabled, false);
  assert.deepEqual(graph.contextFiles, []);
  assert.deepEqual(graph.customContextFiles, []);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

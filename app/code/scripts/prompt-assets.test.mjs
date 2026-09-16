import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promptAssetsPath, readManagedPrompt, readPromptAssets, sha256, validatePromptAssets } from "./prompt-assets.mjs";

const root = path.resolve("app/code/.test-tmp/prompt-assets");

test("missing manifest is ordinary mode and managed hash is exact", async () => {
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(await readPromptAssets(root), { schema_version: "learn-x-prompt-assets/v1", assets: {} });
  const content = "# prompt\n";
  const relative = "02_prompts/chatpack/enhancers/demo.md";
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content, "utf8");
  const asset = { local_path: relative, synced: { document_id: "doc", revision: 1, sha256: sha256(content), at: "2026-09-16T00:00:00.000Z" } };
  assert.equal((await readManagedPrompt(root, asset)).sha256, sha256(content));
  const drifted = { ...asset, synced: { ...asset.synced, sha256: "0".repeat(64) } };
  await assert.rejects(() => readManagedPrompt(root, drifted), /drift/);
  await rm(root, { recursive: true, force: true });
});

test("rejects unsafe or incomplete managed assets", () => {
  assert.throws(() => validatePromptAssets({ schema_version: "learn-x-prompt-assets/v1", assets: { "x.y": { tier: "P2", local_path: "../x", synced: {} } } }), /Prompt asset|Invalid managed/);
});

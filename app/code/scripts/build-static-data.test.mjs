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

test("no-context build has a route entry page", async () => {
  const index = await readFile(path.join(repoRoot, "dist/no-context/index.html"), "utf8");
  assert.match(index, /id="chatPackPreview"/);
  assert.match(index, /id="contextControls" class="source-box" hidden/);
});

test("local-only external links are hidden by default and use the published URLs", async () => {
  const index = await readFile(path.join(repoRoot, "app/code/public/index.html"), "utf8");
  const app = await readFile(path.join(repoRoot, "app/code/public/app.js"), "utf8");

  assert.match(index, /id="localExternalLinks" class="local-external-links"[^>]* hidden/);
  assert.match(index, /href="https:\/\/simplyy\.github\.io\/learn-x\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(index, /href="https:\/\/simplyy\.github\.io\/learn-x\/no-context\/#learning"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(app, /els\.localExternalLinks\.hidden = state\.runtime\.target !== "local";/);
});

test("intermediate Header keeps local links on the right instead of stacking them under the brand", async () => {
  const css = await readFile(path.join(repoRoot, "app/code/public/styles.css"), "utf8");
  const headerBlock = css.match(/@media \(max-width: 1080px\)[\s\S]*?\.app-header \{([\s\S]*?)\n\s*\}/)?.[1] || "";
  const navBlock = css.match(/@media \(max-width: 1080px\)[\s\S]*?\.top-nav \{([\s\S]*?)\n\s*\}/)?.[1] || "";
  const linkBlocks = [...css.matchAll(/\.local-external-links \{([\s\S]*?)\n\s*\}/g)].map((match) => match[1]);

  assert.match(headerBlock, /align-items:\s*center/);
  assert.match(headerBlock, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(headerBlock, /flex-direction:\s*column/);
  assert.match(navBlock, /order:\s*3/);
  assert.match(linkBlocks[1], /width:\s*auto/);
  assert.match(linkBlocks[1], /margin-left:\s*auto/);
  assert.match(linkBlocks[1], /justify-content:\s*flex-end/);
  assert.match(linkBlocks[2], /flex:\s*1 0 100%/);
});

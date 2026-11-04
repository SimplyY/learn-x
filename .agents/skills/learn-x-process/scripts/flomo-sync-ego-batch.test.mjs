import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEgoBatchScript } from "./flomo-sync-ego-batch.mjs";

test("Flomo browser batch uses the documented Ego Lite API and one named TaskSpace", () => {
  const script = buildEgoBatchScript("preflight", { specs: [] }, "learn-x-v2-flomo-sync-test-uuid");
  assert.match(script, /taskSpace\(taskName\)/);
  assert.match(script, /task\.page\("p1"\)/);
  assert.match(script, /page\.snapshot\(\)/);
  assert.match(script, /const extractFeedCards = async \(page\)/);
  assert.match(script, /data-slug=/);
  assert.match(script, /content: item\.remote\.content/);
  assert.match(script, /const flomoComparableText = function flomoComparableText/);
  assert.match(script, /open Flomo memo/);
  assert.doesNotMatch(script, /useOrCreateTaskSpace|openOrReuseTab|gotoAndWait|cliLog|completeTaskSpace|\bdoubleClick\(|\btypeText\(/);
});

test("Flomo writes verify the prepared editor text before save and read back after save", () => {
  const script = buildEgoBatchScript("apply", { plans: [] }, "learn-x-v2-flomo-sync-test-uuid");
  const selectAllAt = script.indexOf('page.keyboard.press("ControlOrMeta+A")');
  const pasteAt = script.indexOf("page.keyboard.paste({ text: plan.content })");
  const settleAt = script.indexOf("page.waitForFunction((expectedTitle)");
  const verifyAt = script.indexOf("actualComparable !== expectedComparable");
  const saveAt = script.indexOf('page.click(".editor-menu-bar .pin-right"');
  const readBackAt = script.indexOf("return await readMemo(page, memo)");
  assert.ok(selectAllAt >= 0 && selectAllAt < pasteAt && pasteAt < settleAt && settleAt < verifyAt && verifyAt < saveAt && saveAt < readBackAt);
  assert.match(script, /const editorSelector = memoSelector\(memo\.memoId, "\.tiptap\.ProseMirror"\)/);
  assert.match(script, /extractFeedCards\(page\)/);
  assert.match(script, /await navigate\(page, returnUrl\)/);
  assert.doesNotMatch(script, /button\.cancel-btn/);
  assert.match(script, /task\.finish\(\{ keep: \[\] \}\)/);
});

test("generated Ego Lite script parses as an ES module", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "learn-x-flomo-ego-"));
  const file = path.join(directory, "batch.mjs");
  try {
    await writeFile(file, buildEgoBatchScript("preflight", { specs: [] }, "learn-x-v2-flomo-sync-test-uuid"));
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { changeMagnitude, isSubstantive, memoSpec, normalizeMemoText, reconcile } from "./flomo-sync-core.mjs";

test("renders stable weekly and quarterly Flomo identifiers", () => {
  assert.match(memoSpec("weekly", "2026-W32", "正文").content, /^Learn-X 周记｜2026-W32[\s\S]*#learn-x\/weekly\/2026-W32/);
  assert.match(memoSpec("memory", "2026-Q3", "记忆").content, /^Learn-X 记忆｜2026-Q3[\s\S]*#learn-x\/memory\/2026-Q3/);
  assert.match(memoSpec("weekly", "2026-W32", "正文").content, /Learn-X 同步校验：[a-f0-9]{16}/);
});

test("keeps local additions while applying a small remote edit", () => {
  const base = "标题\n\n第一段\n\n第二段";
  const result = reconcile({ base, local: `${base}\n\n第三段`, remote: "标题\n\n第一段改\n\n第二段" });
  assert.equal(result.content, "标题\n\n第一段改\n\n第二段\n\n第三段");
});

test("stops for a removed paragraph or a large remote change", () => {
  const base = "标题\n\n完整段落\n\n保留段落";
  assert.equal(reconcile({ base, local: base, remote: "标题\n\n保留段落" }).stop, "remote-paragraph-removed");
  const large = `${base}${"x".repeat(201)}`;
  assert.equal(reconcile({ base, local: base, remote: large }).stop, "remote-change-over-200");
  assert.equal(changeMagnitude(base, large), 201);
});

test("uses Flomo when both sides change the same paragraph", () => {
  const result = reconcile({ base: "标题\n\n原文", local: "标题\n\n本地", remote: "标题\n\n远端" });
  assert.equal(result.content, "标题\n\n远端");
});

test("does not treat a weekly template heading as a publishable memo", () => {
  assert.equal(isSubstantive("# 周记\n"), false);
  assert.equal(isSubstantive("# 飞书周记\n\n真实回顾"), true);
});

test("normalizes only Flomo rich-text blank lines around blockquotes", () => {
  assert.equal(normalizeMemoText("标题\n\n> 一\n\n> 二\n\n\n\n#tag"), "标题\n> 一\n> 二\n\n#tag");
});

test("normalizes Flomo blank lines between adjacent list items", () => {
  assert.equal(normalizeMemoText("- 一\n\n- 二\n\n1. 三\n\n2. 四"), "- 一\n- 二\n1. 三\n2. 四");
});

test("normalizes Flomo blank line before the sync tag", () => {
  assert.equal(normalizeMemoText("正文\n\n#learn-x/sync #learn-x/memory/2026-Q3"), "正文\n#learn-x/sync #learn-x/memory/2026-Q3");
});

import test from "node:test";
import assert from "node:assert/strict";
import { changeMagnitude, isSubstantive, loadManifestSpecs, memoSpec, normalizeMemoText, reconcile, sanitizeFlomoSource } from "./flomo-sync-core.mjs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("renders stable weekly and quarterly Flomo identifiers", () => {
  assert.match(memoSpec("weekly", "2026-W32", "正文").content, /^Learn-X 周记｜2026-W32[\s\S]*#learn-x\/weekly\/2026-W32/);
  assert.match(memoSpec("memory", "2026-Q3", "记忆").content, /^Learn-X 记忆｜2026-Q3[\s\S]*#learn-x\/memory\/2026-Q3/);
  assert.match(memoSpec("weekly", "2026-W32", "正文").content, /Learn-X 同步校验：[a-f0-9]{16}/);
  assert.match(memoSpec("monthly", "2026-06", "月记").content, /^Learn-X 月记｜2026-06[\s\S]*#learn-x\/monthly\/2026-06/);
});

test("removes local source metadata before preparing a Flomo memo", () => {
  const source = "标题\n\n来源：/Users/yuwei/Downloads/2024 月记.md\n\n正文";
  assert.equal(sanitizeFlomoSource(source), "标题\n\n\n正文");
  const memo = memoSpec("monthly", "2024-01", source);
  assert.doesNotMatch(memo.content, /\/Users\/|Downloads|file:\/\//);
  assert.match(memo.content, /Learn-X 同步校验：[a-f0-9]{16}/);
});

test("loads history weekly, monthly, and memory targets from one manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-flomo-manifest-"));
  await mkdir(path.join(root, "03_input/weekly-history/2025-W01"), { recursive: true });
  await mkdir(path.join(root, "03_input/monthly/2025-1"), { recursive: true });
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "03_input/weekly-history/2025-W01/weekly.md"), "历史周记");
  await writeFile(path.join(root, "03_input/monthly/2025-1/monthly.md"), "历史月记");
  await writeFile(path.join(root, "01_core/memory/2025-Q1.memory.md"), "历史记忆");
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    weeks: [{ id: "2025-W01", status: "generated", syncSource: "03_input/weekly-history/2025-W01/weekly.md" }],
    monthly: [{ id: "2025-01", status: "verified", candidates: [{ relativePath: "03_input/monthly/2025-1/monthly.md" }] }],
    memory: [{ id: "2025-Q1", status: "verified", relativePath: "01_core/memory/2025-Q1.memory.md" }]
  }));
  const result = await loadManifestSpecs(root, manifestPath);
  assert.deepEqual(result.specs.map((spec) => spec.key), ["weekly:2025-W01", "monthly:2025-01", "memory:2025-Q1"]);
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

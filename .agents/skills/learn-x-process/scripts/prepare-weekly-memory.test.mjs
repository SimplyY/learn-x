import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bindWeeklyMemoryApproval, extractRequiredSections, quarterFromIsoWeek, verifyWeeklyMemoryApproval } from "./prepare-weekly-memory.mjs";

test("assigns an ISO week to the quarter of its real Monday date", () => {
  assert.equal(quarterFromIsoWeek("2026-W01"), "2025-Q4");
  assert.equal(quarterFromIsoWeek("2026-W02"), "2026-Q1");
});

test("binds one approval fingerprint to the source, exact proposed content, and fixed destinations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-memory-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proposalRoot = path.join(root, "04_output/_dist/weekly/2026-W40");
  await mkdir(proposalRoot, { recursive: true });
  await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  await writeFile(path.join(root, "04_output/weekly/2026-40.md"), "# Confirmed Weekly Output\n\nA source-backed conclusion.\n");
  await writeFile(path.join(proposalRoot, "memory-candidates.md"), "# Verified candidates\n\nCandidate A.\n");
  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nExact approved memory payload.\n");
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "# Existing quarterly memory\n");

  const binding = await bindWeeklyMemoryApproval({ week: "2026-W40", repoRoot: root });
  assert.match(binding.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(binding.scope.memoryPath, "01_core/memory/2026-Q3.memory.md");
  assert.equal(binding.scope.imagePath, "04_output/_dist/weekly/2026-W40/weekly-core.png");
  assert.deepEqual(binding.scope.backupRoots, ["01_core", "03_input", "04_output", "05_library"]);
  assert.deepEqual(binding.scope.flomo, ["03_input/weekly/2026-W40/weekly.md", "01_core/memory/2026-Q3.memory.md"]);
  assert.equal((await verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: binding.fingerprint, repoRoot: root })).verified, true);

  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nChanged after approval.\n");
  await assert.rejects(
    verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: binding.fingerprint, repoRoot: root }),
    /memory-approval-stale/
  );

  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nExact approved memory payload.\n");
  const rebound = await bindWeeklyMemoryApproval({ week: "2026-W40", repoRoot: root });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "# Concurrently changed memory\n");
  await assert.rejects(
    verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: rebound.fingerprint, repoRoot: root }),
    /memory-approval-stale/
  );
});

test("extracts only core summary and Munger sections; ignores Q&A", () => {
  const result = extractRequiredSections(`# Weekly

## 10. 全文核心重点纪要

本周的核心判断。

## 11. 芒格之魂的洞察

先检查失败路径。

## 13. 本周最值得思考的问题与回答

1. 问题：这个私密问题是什么？
   背景补充：不应复制的背景。
   回答：不应复制的回答。

## 核心问题与回答

问题：这个兼容格式的问题是什么？
回答：这个兼容格式的回答。
`);

  assert.deepEqual(Object.keys(result), ["coreSummary", "mungerInsights"]);
  assert.equal(result.coreSummary.length, 1);
  assert.equal(result.mungerInsights.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /私密问题|不应复制|兼容格式/);
});

test("keeps Weekly Output questions and their background out of Memory candidates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-memory-candidates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  await writeFile(path.join(root, "04_output/weekly/2026-40.md"), `# Weekly

## 11. 全文核心重点纪要

核心判断内容。

## 12. 芒格之魂的洞察

洞察内容。

## 13. 本周最值得思考的问题与回答

1. 问题：私密问题标记-QA-1？
   背景补充：私密背景标记-QA-2。
   回答：私密回答标记-QA-3。

## 值得长期保留

- [x] 长期候选内容。
`);

  const { prepareWeeklyMemory } = await import("./prepare-weekly-memory.mjs");
  const result = await prepareWeeklyMemory({ week: "2026-W40", repoRoot: root });
  assert.equal(result.counts.coreSummary, 1);
  assert.equal(result.counts.mungerInsights, 1);
  assert.equal(result.counts.checked, 1);
  assert.equal(Object.hasOwn(result.counts, "questionsAnswers"), false);
  const candidates = await readFile(result.outputPath, "utf8");
  assert.match(candidates, /核心判断内容/);
  assert.match(candidates, /洞察内容/);
  assert.match(candidates, /长期候选内容/);
  assert.match(candidates, /问题、背景和回答/);
  assert.doesNotMatch(candidates, /私密问题标记|私密背景标记|私密回答标记/);
});

test("preserves placeholder filtering for the two supported memory sections", () => {
  const result = extractRequiredSections(`# Weekly

## 全文核心重点纪要

todo

## 芒格之魂的洞察

- 保留这条。

## 13. 本周最值得思考的问题与回答

1. xx
2. xx
`);

  assert.deepEqual(result.coreSummary, []);
  assert.equal(result.mungerInsights.length, 1);
  assert.equal(result.mungerInsights[0].text, "- 保留这条。");
});

test("supports legacy nested headings and purpose notes for confirmed sections", () => {
  const result = extractRequiredSections(`# Weekly

## 9. 芒格之魂的洞察 & 全文核心重点纪要

### 芒格之魂的洞察（纳入洞察候选池）

反转假设。

### 全文核心重点纪要（纳入本周 Memory）

本周核心判断。

## 13. 核心问题与回答

问题：不得迁移的问题？
回答：不得迁移的答案。
`);

  assert.equal(result.mungerInsights[0].text, "反转假设。");
  assert.equal(result.coreSummary[0].text, "本周核心判断。");
  assert.doesNotMatch(JSON.stringify(result), /不得迁移/);
});

test("rejects numbered placeholder lists in confirmed sections", () => {
  const result = extractRequiredSections(`# Weekly

## 全文核心重点纪要

1. xx
2. xx

## 芒格之魂的洞察

todo
`);

  assert.deepEqual(result, { coreSummary: [], mungerInsights: [] });
});

test("does not infer memory from ordinary prose or checks outside candidate sections", async () => {
  const { extractMemoryCandidates } = await import("./prepare-weekly-memory.mjs");
  const result = extractMemoryCandidates(`# Weekly

## 1. 正文

重要：普通正文。
- [x] 正文 checkbox。

## 8. 人工确认清单

### Memory 候选

- [x] 候选 checkbox。
- [ ] 未确认 checkbox。

### 道 / 法 / 术候选观察

- [x] 只进季度候选池。
`);

  assert.deepEqual(result.checked.map((item) => item.text), ["候选 checkbox。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["只进季度候选池。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["未确认 checkbox。"]);
  assert.deepEqual(result.explicit, []);
});

test("uses checked items in the new long-term section and allows zero candidates", async () => {
  const { extractMemoryCandidates } = await import("./prepare-weekly-memory.mjs");
  const result = extractMemoryCandidates(`# Weekly

## 5. 值得长期保留

- [x] 已确认的长期候选。
- [ ] 未确认的长期候选。

## 6. 其他

- [x] 普通正文中的勾选项。

## 7. 道 / 法 / 术候选观察

- [x] 历史观察，保持可读。`);

  assert.deepEqual(result.checked.map((item) => item.text), ["已确认的长期候选。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["未确认的长期候选。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["历史观察，保持可读。"]);

  const empty = extractMemoryCandidates(`# Weekly

## 5. 值得长期保留

- [ ] 未确认。
`);
  assert.deepEqual(empty.checked, []);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  annualHardLimit,
  annualTargetLimit,
  measureTextChange,
  planMemoryCompression,
  promoteMemoryCompression,
  renderMemoryCandidate,
  validateMemoryCompression
} from "./memory-compression.mjs";

test("measures replacements separately from net reduction", () => {
  assert.deepEqual(measureTextChange("甲乙丙丁", "甲乙戊己"), {
    removedChars: 2,
    addedChars: 2,
    changedChars: 4,
    netReduction: 0
  });
  assert.equal(measureTextChange("出门、运动、写诗", "出门、写诗").changedChars, 3);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-memory-compression-"));
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), [
    "# Learn-X Memory｜2026-Q2",
    "",
    "## 2026-W28",
    "",
    "### Memory",
    "",
    "- 旧月份判断。",
    "",
    "## 2026-W31",
    "",
    "### Memory",
    "",
    "- 跨越当前月的周块。",
    "",
    "## 未识别来源",
    "",
    "- 未识别来源判断，默认保护。"
  ].join("\n"));
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), [
    "# Learn-X Memory｜2026-Q3",
    "",
    "## 候选观察池",
    "",
    "- [2026-W31] 当前月候选。",
    "",
    "## 2026-W31",
    "",
    "### Memory",
    "",
    "- 当前月判断。"
  ].join("\n"));
  await writeFile(path.join(root, "01_core/memory/2025-Q4.memory.md"), "# Learn-X Memory｜2025-Q4\n\n## 2025-W50\n\n### Memory\n\n- 旧年判断。\n");
  return root;
}

async function writeCandidate(root, candidate, body, overrides = {}) {
  await mkdir(path.join(root, candidate.directory), { recursive: true });
  const metadata = {
    ...candidate.metadata,
    ...overrides,
    coreDifferences: overrides.coreDifferences ?? Array.from({ length: 5 }, (_, index) => ({
      topic: `测试核心区别${index + 1}`,
      original: `原文判断内容一二三四五${index + 1}`,
      candidate: `候选${index + 1}`,
      kind: "压缩/合并",
      action: "测试合并",
      review: "人工确认测试摘要"
    })),
    otherChanges: overrides.otherChanges ?? [{
      topic: "测试中的其他压缩",
      before: "原来有多条细节记录。",
      after: "合并为一条背景说明。",
      examples: "保留一个代表性例子。"
    }]
  };
  await writeFile(path.join(root, candidate.candidatePath), renderMemoryCandidate(candidate.metadata, body));
  await writeFile(path.join(root, candidate.metadataPath), JSON.stringify(metadata));
}

test("uses the bounded decay curve and keeps the recent-three-year hard cap", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 10].map(annualHardLimit), [8000, 4800, 2880, 1728, 1036, 622, 373, 223, 200]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(annualTargetLimit), [6000, 3600, 2160, 1296, 777, 466, 279]);
  assert.equal(annualHardLimit(0) + annualHardLimit(1) + annualHardLimit(2), 15680);
});

test("plans current-year compression and protects the current month and overlapping weeks", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const current = plan.operations.find((operation) => operation.mode === "current-year");
  assert.ok(current);
  assert.deepEqual(current.sourcePaths, ["01_core/memory/2026-Q2.memory.md", "01_core/memory/2026-Q3.memory.md"]);
  assert.ok(current.protectedUnits.some((unit) => unit.period?.week === 31));
  assert.ok(current.protectedUnits.some((unit) => unit.period?.week === 31));
  assert.ok(current.protectedUnits.some((unit) => unit.period === null));
  assert.ok(current.eligibleUnits.some((unit) => unit.period?.week === 28));
  assert.ok(current.candidates.every((candidate) => !candidate.candidatePath.startsWith("01_core/memory/")));
  assert.ok(plan.operations.some((operation) => operation.mode === "annualize" && operation.id === "2025-annual"));
});

test("validates a manually edited candidate without modifying the source", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.mode === "current-year");
  for (const candidate of operation.candidates) {
    const source = await readFile(path.join(root, candidate.metadata.sourcePaths[0]), "utf8");
    await writeCandidate(root, candidate, source);
  }
  const beforeRerun = await readFile(path.join(root, operation.candidates[0].candidatePath), "utf8");
  const rerun = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  assert.equal(rerun.operations.find((entry) => entry.mode === "current-year").candidates[0].exists, true);
  assert.equal(await readFile(path.join(root, operation.candidates[0].candidatePath), "utf8"), beforeRerun);
  const result = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir) });
  assert.equal(result.status, "ready");
  assert.equal(result.protectedOk, true);
  assert.equal(result.coreDifferencesOk, true);
  assert.equal(result.otherChangesOk, true);
  const comparison = await readFile(result.comparisonPath, "utf8");
  assert.ok(comparison.indexOf("## 核心变化（先看这里）") < comparison.indexOf("## 量化校验"));
  assert.ok(comparison.indexOf("## 核心变化（先看这里）") < comparison.indexOf("## 辅助统计：文件级变化"));
  const q3ComparisonPath = result.comparisonPaths.find((filePath) => filePath.includes("2026-Q3.memory"));
  const q3Comparison = await readFile(q3ComparisonPath, "utf8");
  assert.match(comparison, /01_core\/memory\/2026-Q2\.memory\.md/);
  assert.doesNotMatch(comparison, /01_core\/memory\/2026-Q3\.memory\.md/);
  assert.match(q3Comparison, /01_core\/memory\/2026-Q3\.memory\.md/);
  assert.doesNotMatch(q3Comparison, /01_core\/memory\/2026-Q2\.memory\.md/);
  assert.notEqual(comparison, q3Comparison);
  assert.match(comparison, /\| 排序 \| 核心点 \| 字数变化 \| 之前是什么 \| 现在是什么 \|/);
  assert.doesNotMatch(comparison, /<table|<tbody|<td>/);
  assert.match(comparison, /之前是什么/);
  assert.match(comparison, /现在是什么/);
  assert.match(comparison, /字数变化/);
  assert.doesNotMatch(comparison, /具体变了什么/);
  assert.doesNotMatch(comparison, /变化类型/);
  assert.doesNotMatch(comparison, /<th>人工确认<\/th>/);
  assert.match(comparison, /整体压缩量（单独计算）/);
  assert.match(comparison, /其他压缩内容概览/);
  assert.match(comparison, /其他变化归类/);
  assert.match(comparison, /测试中的其他压缩/);
  assert.equal((comparison.match(/\| \*\*本报告\*\*/g) ?? []).length, 0);
  assert.match(comparison, /未纳入核心表的差额/);
  const original = await readFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "utf8");
  assert.match(original, /当前月判断/);

  const candidatePath = path.join(root, operation.candidates[0].candidatePath);
  const candidate = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, candidate.replace("旧月份判断。", "手动压缩后的旧月份判断。"));
  const staleSourcePath = path.join(root, "01_core/memory/2026-Q2.memory.md");
  await writeFile(staleSourcePath, `${await readFile(staleSourcePath, "utf8")}\n新增来源。`);
  const stale = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir) });
  assert.equal(stale.status, "stale");
  const stalePlan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  assert.equal(stalePlan.operations.find((entry) => entry.mode === "current-year").candidates[0].reviewStatus, "stale");
});

test("groups small changes instead of expanding every non-retained source unit", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.mode === "current-year");
  const q2 = operation.candidates.find((candidate) => candidate.sourcePath.endsWith("2026-Q2.memory.md"));
  const source = await readFile(path.join(root, q2.metadata.sourcePaths[0]), "utf8");
  await writeCandidate(root, q2, [
    "# Learn-X Memory｜2026-Q2",
    "",
    "## 2026-W31",
    "",
    "- 跨越当前月的周块。",
    "",
    "## 未识别来源",
    "",
    "- 未识别来源判断，默认保护。"
  ].join("\n"));
  const q3 = operation.candidates.find((candidate) => candidate.sourcePath.endsWith("2026-Q3.memory.md"));
  await writeCandidate(root, q3, await readFile(path.join(root, q3.metadata.sourcePaths[0]), "utf8"), {
    otherChanges: [{
      topic: "等长替换测试",
      before: "甲".repeat(40),
      after: "乙".repeat(40),
      examples: "验证等长但实质替换的内容按实际改动量处理。"
    }]
  });
  const result = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir) });
  assert.equal(result.status, "ready");
  const comparison = await readFile(result.comparisonPaths.find((filePath) => filePath.includes("2026-Q2.memory")), "utf8");
  assert.match(comparison, /其他变化归类/);
  assert.match(comparison, /删除候选 \/ 未找到对应/);
  assert.match(comparison, /小于等于10字：统一归类/);
  assert.match(comparison, /未逐字保留的其他内容：归类/);
  const q3Comparison = await readFile(result.comparisonPaths.find((filePath) => filePath.includes("2026-Q3.memory")), "utf8");
  assert.match(q3Comparison, /## 保护范围/);
  assert.match(q3Comparison, /当前月或跨月周块/);
  const q3SmallSection = q3Comparison.split("### 小于等于10字：统一归类")[1].split("### 未逐字保留的其他内容：归类")[0];
  assert.doesNotMatch(q3SmallSection, /等长替换测试/);
  assert.match(q3Comparison, /等长替换测试.*实际改动 80 字/);
  assert.equal(source.includes("旧月份判断"), true);
});

test("promotes only after explicit confirmation and archives the original", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.mode === "current-year");
  for (const candidate of operation.candidates) {
    const source = await readFile(path.join(root, candidate.metadata.sourcePaths[0]), "utf8");
    await writeCandidate(root, candidate, source);
  }
  assert.doesNotMatch(await readFile(path.join(root, operation.candidates[0].candidatePath), "utf8"), /learn-x-memory-compression/);
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir) }), /--confirm/);
  const result = await promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir), confirm: true });
  assert.equal(result.status, "promoted");
  assert.match(result.archivePath, /01_core[\\/]memory-archive/);
  assert.match(await readFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), "utf8"), /旧月份判断/);
});

test("annualizes old quarters without duplicating them in the active directory", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.id === "2025-annual");
  const candidate = operation.candidates[0];
  const source = await readFile(path.join(root, candidate.metadata.sourcePaths[0]), "utf8");
  await writeCandidate(root, candidate, source);
  const result = await promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir), confirm: true });
  assert.equal(result.status, "promoted");
  assert.match(await readFile(path.join(root, "01_core/memory/2025.memory.md"), "utf8"), /旧年判断/);
  await assert.rejects(() => readFile(path.join(root, "01_core/memory/2025-Q4.memory.md")));
});

test("consolidates an existing annual file and quarters into one active annual file", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "01_core/memory/2025.memory.md"), "# 年度 Memory\n\n既有年度判断。\n");
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.id === "2025-annual");
  assert.equal(operation.reason, "consolidate-duplicate-quarter-files");
  assert.deepEqual(operation.sourcePaths, ["01_core/memory/2025.memory.md", "01_core/memory/2025-Q4.memory.md"]);
});

test("rejects malformed candidate metadata as needs_review", async () => {
  const root = await fixture();
  const candidatePath = path.join(root, "04_output/_dist/memory-compression/2026-08/bad/bad.memory.compressed.md");
  await mkdir(path.dirname(candidatePath), { recursive: true });
  await writeFile(candidatePath, "<!-- learn-x-memory-compression: {\"mode\":\"current-year\"} -->\n# invalid");
  const result = await validateMemoryCompression({ repoRoot: root, candidatePath });
  assert.equal(result.status, "needs_review");
  assert.equal(result.formatOk, false);
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath, confirm: true }), /format/);
});

test("rejects candidate paths outside the review directory", async () => {
  const root = await fixture();
  await assert.rejects(
    () => validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "outside", "candidate.memory.compressed.md") }),
    /inside 04_output\/_dist\/memory-compression/
  );
});

test("requires a readable core-differences summary before promotion", async () => {
  const root = await fixture();
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const candidate = plan.operations.find((entry) => entry.mode === "current-year").candidates[0];
  await writeCandidate(root, candidate, await readFile(path.join(root, candidate.metadata.sourcePaths[0]), "utf8"));
  const metadataPath = path.join(root, candidate.metadataPath);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  delete metadata.coreDifferences;
  await writeFile(metadataPath, JSON.stringify(metadata));
  const result = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, candidate.directory) });
  assert.equal(result.status, "needs_review");
  assert.equal(result.coreDifferencesOk, false);
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, candidate.directory), confirm: true }), /core-differences/);
});

test("replaces an oversized annual file without moving the target out of active memory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-memory-annual-budget-"));
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  const sourceContent = `# 2025 Memory\n\n${"历史判断".repeat(1180)}\n`;
  await writeFile(path.join(root, "01_core/memory/2025.memory.md"), sourceContent);
  const plan = await planMemoryCompression({ repoRoot: root, asOf: "2026-08-30" });
  const operation = plan.operations.find((entry) => entry.id === "2025-annual");
  assert.equal(operation.reason, "annual-budget");
  const candidate = operation.candidates[0];
  await writeCandidate(root, candidate, sourceContent);
  const result = await promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, operation.outputDir), confirm: true });
  assert.equal(result.status, "promoted");
  assert.equal(await readFile(path.join(root, "01_core/memory/2025.memory.md"), "utf8"), sourceContent);
});

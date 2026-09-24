import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertMonthlyProcessPackSize, classifyPreviousMonthlyOutput, demoteEmbeddedHeadings, previousMonthId, readPreviousMonthlyOutput, renderProcessPack, validateCompressionDocument } from "./generate-monthly-process-pack.mjs";
import { datedSections, extractWeeklyConfirmedSections, filterBoundaryContent, isPlaceholder, isValidAiReview, monthlyCompressionPolicies, monthlyCompressionRatioRules, monthlyVoiceMaxChars, monthlyVoiceMaxRatio, monthlyVoiceMinRatio, requiresCompressionReview, reviewMonthlyTypes, wereadMatchesDeclaredWeek, weeksIntersectingMonth } from "./monthly-process-input.mjs";

test("selects all ISO weeks intersecting a month", () => {
  assert.deepEqual(weeksIntersectingMonth("2026-06"), ["2026-W23", "2026-W24", "2026-W25", "2026-W26", "2026-W27"]);
});

test("selects the previous calendar month, including year rollover", () => {
  assert.equal(previousMonthId("2026-01"), "2025-12");
  assert.equal(previousMonthId("2026-06"), "2026-05");
});

test("classifies prior Monthly Output as missing, empty, shell, or full text", () => {
  assert.deepEqual(classifyPreviousMonthlyOutput("2026-06", "", { code: "ENOENT" }), {
    previousMonth: "2026-05", sourcePath: "04_output/monthly/2026-05.md", status: "missing", content: ""
  });
  assert.equal(classifyPreviousMonthlyOutput("2026-06", " \n\t").status, "empty");
  assert.equal(classifyPreviousMonthlyOutput("2026-06", "# Learn-X Monthly Output｜2026-05\n\n> 基于 `04_output/_dist/monthly/2026-05/process-pack.md` 由用户使用 AI Chat 生成正文后填入。\n").status, "shell");
  assert.equal(classifyPreviousMonthlyOutput("2026-06", "# Learn-X Monthly Output｜2026-05\n\n> 基于 `04_output/_dist/monthly/2026-05/` 由用户使用 AI Chat 生成正文后填入。\n").status, "shell");
  assert.equal(classifyPreviousMonthlyOutput("2026-06", "# Learn-X Monthly Output｜2026-05\n\n## 月度总判断\n\n1. xx\n\n## 本月问题与回答\n\n1. 问题：todo\n   回答：待补充").status, "shell");
  assert.deepEqual(classifyPreviousMonthlyOutput("2026-06", "# 2026-05 月报\n\n## 核心洞察\n实质内容\n"), {
    previousMonth: "2026-05", sourcePath: "04_output/monthly/2026-05.md", status: "ready", content: "# 2026-05 月报\n\n## 核心洞察\n实质内容"
  });
  assert.throws(() => classifyPreviousMonthlyOutput("2026-06", "", Object.assign(new Error("permission denied"), { code: "EACCES" })), /permission denied/);
});

test("monthly loader reads only the direct calendar predecessor across year rollover", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-monthly-compare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "04_output/monthly");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "2025-11.md"), "OLDER_MONTH_SENTINEL", "utf8");

  const missing = await readPreviousMonthlyOutput("2026-01", root);
  assert.equal(missing.previousMonth, "2025-12");
  assert.equal(missing.status, "missing");
  assert.doesNotMatch(missing.content, /OLDER_MONTH_SENTINEL/);

  const priorOutput = "# Learn-X Monthly Output｜2025-12\n\n## 月度总判断\n\n跨年基线正文";
  await writeFile(path.join(outputDir, "2025-12.md"), priorOutput, "utf8");
  const ready = await readPreviousMonthlyOutput("2026-01", root);
  assert.equal(ready.status, "ready");
  assert.equal(ready.sourcePath, "04_output/monthly/2025-12.md");
  assert.equal(ready.content, priorOutput);
});

test("preserves headings inside backtick and tilde fences in the prior Monthly Output", () => {
  const source = "```markdown\n## backtick heading\n```\n\n~~~markdown\n## tilde heading\n~~~~\n\n## regular heading";
  assert.equal(demoteEmbeddedHeadings(source), "```markdown\n## backtick heading\n```\n\n~~~markdown\n## tilde heading\n~~~~\n\n#### regular heading");
});

test("adds the full prior Monthly Output as comparison-only material without changing item stats", () => {
  const payload = {
    month: "2026-06",
    selection: { weeklyPaths: [], missingWeeklyPaths: [], monthlyPath: "03_input/monthly/2026-6" },
    sources: [],
    items: [],
    stats: { sourceCount: 0, excludedSourceCount: 0, deterministicOutputChars: 0 }
  };
  const compression = { stats: { sourceCount: 0, eventCount: 0, originalChars: 0, outputChars: 0 } };
  const previous = classifyPreviousMonthlyOutput("2026-06", "# 上月月报\n\n## 月度判断\n上月正文的末尾锚点");
  const pack = renderProcessPack(payload, compression, [], previous);
  assert.match(pack, /## 上月 Monthly Output 对照材料｜2026-05/);
  assert.match(pack, /对比专用：只用于识别上月到本月的变化/);
  assert.match(pack, /本月事实以本 Process Pack 当前月份材料为准/);
  assert.match(pack, /- 来源：`04_output\/monthly\/2026-05\.md`/);
  assert.match(pack, /不计入 `input\.json`，也不计入下面按本月材料计算的来源、事件和字符统计/);
  assert.match(pack, /### 上月 Monthly Output 全文\n\n#### 上月月报/);
  assert.match(pack, /上月正文的末尾锚点/);
  assert.equal(payload.sources.length, 0);
  assert.equal(payload.items.length, 0);
  assert.equal(payload.stats.sourceCount, 0);
});

test("reports unavailable comparison states and does not substitute an older month", () => {
  const payload = {
    month: "2026-01",
    selection: { weeklyPaths: [], missingWeeklyPaths: [], monthlyPath: "03_input/monthly/2026-1" },
    sources: [],
    items: [],
    stats: { sourceCount: 0, excludedSourceCount: 0, deterministicOutputChars: 0 }
  };
  const compression = { stats: { sourceCount: 0, eventCount: 0, originalChars: 0, outputChars: 0 } };
  for (const status of ["missing", "empty", "shell"]) {
    const previous = classifyPreviousMonthlyOutput("2026-01", status === "missing" ? "" : status === "empty" ? "" : "# Learn-X Monthly Output｜2025-12", status === "missing" ? { code: "ENOENT" } : undefined);
    const pack = renderProcessPack(payload, compression, [], previous);
    assert.match(pack, /## 上月 Monthly Output 对照材料｜2025-12/);
    assert.match(pack, new RegExp(`- 状态：${status}`));
    assert.match(pack, /来源：`04_output\/monthly\/2025-12\.md`/);
    assert.doesNotMatch(pack, /04_output\/monthly\/2025-11\.md/);
    assert.doesNotMatch(pack, /### 上月 Monthly Output 全文/);
  }
});

test("rejects an oversized full comparison source instead of truncating it", () => {
  const payload = {
    month: "2026-06",
    selection: { weeklyPaths: [], missingWeeklyPaths: [], monthlyPath: "03_input/monthly/2026-6" },
    sources: [],
    items: [],
    stats: { sourceCount: 0, excludedSourceCount: 0, deterministicOutputChars: 0 }
  };
  const compression = { stats: { sourceCount: 0, eventCount: 0, originalChars: 0, outputChars: 0 } };
  const previous = classifyPreviousMonthlyOutput("2026-06", `# 上月月报\n\n${"月".repeat(40_000)}`);
  const pack = renderProcessPack(payload, compression, [], previous);
  assert.ok(pack.includes("月".repeat(40_000)));
  assert.throws(() => assertMonthlyProcessPackSize(pack), /previous Monthly Output comparison source is never truncated/);
});

test("monthly prompt contract covers bounded comparison and separate user-answer root questions", async () => {
  const [rules, prompt, automation] = await Promise.all([
    readFile(new URL("../resources/monthly-output-rules.md", import.meta.url), "utf8"),
    readFile(new URL("../../../../02_prompts/chatpack/reflective-decision/monthly-output.md", import.meta.url), "utf8"),
    readFile(new URL("../../learn-x-monthly-automation/SKILL.md", import.meta.url), "utf8")
  ]);

  assert.match(rules, /上月与本月对照/);
  assert.match(rules, /1200.{0,8}(?:字符|字)/);
  assert.match(rules, /月度总判断、月度核心洞察、全文核心重点纪要、芒格之魂洞察和月度问题与回答/);
  assert.match(rules, /只作次级参照/);
  assert.match(rules, /不显示百分比、不机械打分/);
  assert.match(rules, /本月事实以当前 Process Pack 的本月材料为准/);
  assert.match(rules, /本月最值得思考的 3 个问题与回答/);
  assert.match(rules, /问题核心以 10–20 字为目标，最多 50 字/);
  assert.match(rules, /问题核心与背景补充合计不超过 100 字/);
  assert.match(rules, /背景补充（选填）/);
  assert.match(rules, /本月议题[\s\S]*?阶段性答案[\s\S]*?不得/);
  assert.match(rules, /不构成新的 Memory 来源|不作为.*Memory.*来源/);
  assert.match(prompt, /上月 Monthly Output/);
  assert.match(prompt, /问题核心以 10–20 字为目标、最多 50 字/);
  assert.match(prompt, /单题合计最多 100 字/);
  assert.match(automation, /上月对比入口/);
  assert.match(automation, /不得用更早月份替代/);
  assert.match(automation, /1200/);
  assert.match(automation, /本月最值得思考的 3 个问题与回答/);
  assert.match(automation, /最多 50 字.*最多 100 字/s);
  assert.match(automation, /精确标题为「全文核心重点纪要」和「芒格之魂的洞察」/);
});

test("extracts dated daily or flomo sections", () => {
  assert.deepEqual(
    datedSections("# source\n\n## 2026-05-31\nold\n\n## 2026-06-01\nkeep").map((entry) => entry.date),
    ["2026-05-31", "2026-06-01"]
  );
  assert.equal(isPlaceholder("# health\n\n待补充"), true);
  assert.doesNotMatch(filterBoundaryContent("## 2026-05-31\nold\n## 2026-06-01\nkeep", "2026-06"), /old/);
});

test("rejects WeRead content whose dated records belong to another week", () => {
  const wrong = "# 微信读书｜2026-W26\n\n- 2026-06-15（周一）：42 分钟\n\n##### 划线｜2026-06-16";
  assert.equal(wereadMatchesDeclaredWeek(wrong, "2026-W26"), false);
});

test("rejects an AI prompt template and accepts a structured weekly review", () => {
  assert.equal(isValidAiReview("# AI 对话\n\n请基于本次回顾周期输出 500 字，并按当前日期生成一下文件名"), false);
  assert.equal(isValidAiReview("# Learn-X 周回顾\n\n## 具体的人和事\n\n本周未发现可可靠提炼的具体人/事。\n\n## 本周议题\n\n真实判断\n\n## 精华议题摘要\n\n真实答案"), true);
  assert.equal(isValidAiReview("# Learn-X 周回顾\n\n## 本周反复思考的核心问题\n\n真实判断\n\n## 精华问题摘要\n\n真实答案"), false);
});

test("extracts only substantive system-confirmed weekly output sections", () => {
  const sections = extractWeeklyConfirmedSections("# 周报\n\n## 10. 全文核心重点纪要\n\n1. 核心判断\n2. \n\n## 11. 芒格之魂的洞察\n\ntodo\n\n## 12. 其它\n\n不读取");
  assert.deepEqual(sections.map((entry) => entry.source), ["weekly-core"]);
  assert.match(sections[0].text, /核心判断/);
  assert.doesNotMatch(sections[0].text, /芒格|其它/);
  const renumbered = extractWeeklyConfirmedSections("# 周报\n\n## 11. 全文核心重点纪要\n\n1. 新编号判断\n\n## 12. 芒格之魂的洞察\n\n1. 新洞察\n\n## 13. 其它\n\n不读取");
  assert.deepEqual(renumbered.map((entry) => entry.source), ["weekly-core", "weekly-munger"]);
  assert.match(renumbered[1].text, /新洞察/);
});

test("reviews the monthly aggregate by type instead of individual file size", () => {
  assert.equal(requiresCompressionReview("ai"), true);
  assert.equal(requiresCompressionReview("build"), true);
  assert.equal(requiresCompressionReview("voice"), true);
  assert.equal(monthlyVoiceMaxChars, 10_000);
  assert.equal(monthlyVoiceMinRatio, 0.05);
  assert.equal(monthlyVoiceMaxRatio, 0.10);
  assert.deepEqual(monthlyCompressionRatioRules, {
    ai: { min: 0.10, max: 0.30 },
    build: { min: 0.02, max: 0.08 },
    "build-bot": { min: 0.02, max: 0.08 }
  });
  assert.equal(monthlyCompressionPolicies.ai.signalToNoise, 0.60);
  assert.ok(Math.abs(monthlyCompressionPolicies.ai.minRatio + (monthlyCompressionPolicies.ai.maxRatio - monthlyCompressionPolicies.ai.minRatio) * monthlyCompressionPolicies.ai.signalToNoise - 0.22) < 1e-9);
  const reviews = reviewMonthlyTypes([
    { source: "build", text: "甲".repeat(1800) },
    { source: "build", text: "乙".repeat(1800) },
    { source: "daily", text: "日".repeat(4000) }
  ]);
  assert.equal(reviews.find((entry) => entry.type === "build").decision, "compression-required");
  assert.equal(reviews.find((entry) => entry.type === "daily").decision, "keep-full");
});

test("compression requires current hashes, target-month dates, and complete source coverage", () => {
  const payload = {
    month: "2026-06",
    compressionRequests: [{ path: "source.md", sha256: "abc", originalChars: 1000, source: "weread" }]
  };
  const valid = {
    schemaVersion: 1,
    month: "2026-06",
    events: [{
      id: "E001",
      title: "event",
      category: "inbox",
      source: "weread",
      importance: "minor",
      dateRange: { start: "2026-06-01", end: "2026-06-01" },
      sourcePaths: ["source.md"],
      sourceHashes: { "source.md": "abc" },
      text: "- 核心证据与判断\n- 现实反馈与限制"
    }]
  };
  assert.equal(validateCompressionDocument(valid, payload).items.length, 1);
  assert.throws(() => validateCompressionDocument({ ...valid, events: [] }, payload), /not covered/);
  assert.throws(() => validateCompressionDocument({
    ...valid,
    events: [{ ...valid.events[0], dateRange: { start: "2026-07-01", end: "2026-07-01" } }]
  }, payload), /outside 2026-06/);
  assert.throws(() => validateCompressionDocument({
    ...valid,
    events: [{ ...valid.events[0], dateRange: { start: "2026-06-99", end: "2026-06-99" } }]
  }, payload), /outside 2026-06/);
  assert.throws(() => validateCompressionDocument({
    ...valid,
    events: [{ ...valid.events[0], text: "这是没有分段的长段落。".repeat(30) }]
  }, payload), /structured bullet points|unstructured paragraph/);
});

test("enforces the monthly Voice character budget", () => {
  const request = { path: "voice.md", sha256: "voice-hash", originalChars: 20000, source: "voice" };
  const text = Array.from({ length: 2500 }, (_, index) => `- 核心事件${index}`).join("\n");
  assert.ok(text.length > monthlyVoiceMaxChars);
  assert.throws(() => validateCompressionDocument({
    schemaVersion: 1,
    month: "2026-06",
    events: [{
      id: "V001",
      title: "voice",
      category: "insight",
      source: "voice",
      importance: "core",
      dateRange: { start: "2026-06-01", end: "2026-06-30" },
      sourcePaths: [request.path],
      sourceHashes: { [request.path]: request.sha256 },
      text
    }]
  }, { month: "2026-06", compressionRequests: [request] }), /Monthly Voice compression/);
});

test("preserves each AI weekly review as its own structured core event", () => {
  const requests = ["W27", "W29"].map((week) => ({
    path: `${week}/ai.md`, sha256: week, originalChars: 300, source: "ai"
  }));
  const aiText = "#### 本周主线\n- 主线\n\n#### 核心洞察与判断\n- 洞察\n\n#### 行动反馈与未闭环问题\n- 反馈";
  const document = {
    schemaVersion: 1,
    month: "2026-06",
    events: requests.map((request, index) => ({
      id: `A${index + 1}`,
      title: request.path,
      category: "inbox",
      source: "ai",
      importance: "core",
      dateRange: { start: "2026-06-01", end: "2026-06-30" },
      sourcePaths: [request.path],
      sourceHashes: { [request.path]: request.sha256 },
      text: aiText
    }))
  };
  assert.equal(validateCompressionDocument(document, { month: "2026-06", compressionRequests: requests }).items.length, 2);
  assert.throws(() => validateCompressionDocument({
    ...document,
    events: [{ ...document.events[0], importance: "supporting" }, document.events[1]]
  }, { month: "2026-06", compressionRequests: requests }), /core event/);
  assert.throws(() => validateCompressionDocument({
    ...document,
    events: [{
      ...document.events[0],
      sourcePaths: requests.map((request) => request.path),
      sourceHashes: Object.fromEntries(requests.map((request) => [request.path, request.sha256]))
    }]
  }, { month: "2026-06", compressionRequests: requests }), /one weekly source/);
});

test("renders Input source-type groups and demotes embedded source headings", () => {
  const payload = {
    month: "2026-06",
    selection: { weeklyPaths: ["03_input/weekly/2026-W23"], missingWeeklyPaths: ["03_input/weekly/2026-W27"], monthlyPath: "03_input/monthly/2026-6" },
    sources: [],
    items: [],
    stats: { sourceCount: 2, excludedSourceCount: 0, deterministicOutputChars: 10 }
  };
  const compression = { stats: { sourceCount: 0, eventCount: 0, originalChars: 0, outputChars: 0 } };
  const items = [
    { title: "日记", category: "log", source: "daily", paths: ["daily.md"], text: "# 原始一级标题\n\n正文", outputChars: 8 },
    { title: "AI W23", category: "inbox", source: "ai", paths: ["ai.md"], text: "## 原始二级标题\n\n- 核心\n- 反馈", outputChars: 12 },
    { title: "工程 W23", category: "action", source: "build", paths: ["build-bot.md", "build.md"], text: "- 工程\n- 反馈", outputChars: 10 }
  ];
  const pack = renderProcessPack(payload, compression, items);
  assert.ok(pack.indexOf("## 1. 按 Input 文件类型组织的材料") < pack.indexOf("## 2. 来源与处理审计"));
  assert.match(pack, /未提供相交周.*2026-W27.*不阻断生成/);
  for (const heading of ["## 0. 完整性与缺口", "## 1. 按 Input 文件类型组织的材料", "## 2. 来源与处理审计", "### 1. `ai`", "### 2. `daily`", "### 3. `build + build-bot`"]) {
    assert.match(pack, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(pack, /- 来源文件：1 个/);
  assert.match(pack, /#### M001｜AI W23/);
  assert.match(pack, /#### M002｜日记/);
  assert.match(pack, /#### M003｜工程 W23/);
  assert.doesNotMatch(pack, /自我反馈与生命状态|月度核心判断|支撑性输入/);
  assert.match(pack, /#### 原始一级标题/);
  assert.match(pack, /#### 原始二级标题/);
  assert.doesNotMatch(pack, /\n# 原始一级标题/);
  assert.equal(demoteEmbeddedHeadings("```md\n# code\n```\n# content"), "```md\n# code\n```\n#### content");
});

test("only sources in a reviewed monthly type may pass through", () => {
  const payload = {
    month: "2026-06",
    compressionRequests: [{
      path: "weekly.md",
      sha256: "hash",
      originalChars: 4,
      category: "log",
      source: "weekly",
      reason: "type-total-over-10kb:weekly",
      rawText: "原文"
    }]
  };
  const result = validateCompressionDocument({
    schemaVersion: 1,
    month: "2026-06",
    events: [],
    passthroughs: [{
      sourcePath: "weekly.md",
      sourceHash: "hash",
      title: "高价值周记",
      dateRange: { start: "2026-06-01", end: "2026-06-30" },
      reason: "内容已经高密度记录真实行动与反馈"
    }]
  }, payload);
  assert.equal(result.items[0].mode, "full-reviewed");
  assert.equal(result.items[0].text, "原文");
});

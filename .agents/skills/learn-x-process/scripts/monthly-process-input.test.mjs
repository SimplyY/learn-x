import assert from "node:assert/strict";
import test from "node:test";
import { demoteEmbeddedHeadings, renderProcessPack, validateCompressionDocument } from "./generate-monthly-process-pack.mjs";
import { datedSections, extractWeeklyConfirmedSections, filterBoundaryContent, isPlaceholder, isValidAiReview, requiresCompressionReview, reviewMonthlyTypes, wereadMatchesDeclaredWeek, weeksIntersectingMonth } from "./monthly-process-input.mjs";

test("selects all ISO weeks intersecting a month", () => {
  assert.deepEqual(weeksIntersectingMonth("2026-06"), ["2026-W23", "2026-W24", "2026-W25", "2026-W26", "2026-W27"]);
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
  assert.equal(isValidAiReview("# Learn-X 周回顾\n\n## 具体的人和事\n\n本周未发现可可靠提炼的具体人/事。\n\n## 本周反复思考的核心问题\n\n真实判断\n\n## 精华问题摘要\n\n真实答案"), true);
  assert.equal(isValidAiReview("# Learn-X 周回顾\n\n## 本周反复思考的核心问题\n\n真实判断\n\n## 精华问题摘要\n\n真实答案"), false);
});

test("extracts only substantive system-confirmed weekly output sections", () => {
  const sections = extractWeeklyConfirmedSections("# 周报\n\n## 10. 全文核心重点纪要\n\n1. 核心判断\n2. \n\n## 11. 芒格之魂的洞察\n\ntodo\n\n## 12. 其它\n\n不读取");
  assert.deepEqual(sections.map((entry) => entry.source), ["weekly-core"]);
  assert.match(sections[0].text, /核心判断/);
  assert.doesNotMatch(sections[0].text, /芒格|其它/);
});

test("reviews the monthly aggregate by type instead of individual file size", () => {
  assert.equal(requiresCompressionReview("ai"), true);
  assert.equal(requiresCompressionReview("build"), true);
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

test("preserves each AI weekly review as its own structured core event", () => {
  const requests = ["W27", "W29"].map((week) => ({
    path: `${week}/ai.md`, sha256: week, originalChars: 1200, source: "ai"
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

test("renders fixed monthly groups and demotes embedded source headings", () => {
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
    { title: "AI W23", category: "inbox", source: "ai", paths: ["ai.md"], text: "## 原始二级标题\n\n- 核心\n- 反馈", outputChars: 12 }
  ];
  const pack = renderProcessPack(payload, compression, items);
  assert.ok(pack.indexOf("## 1. 月度核心判断") < pack.indexOf("## 2. 自我反馈与生命状态"));
  assert.match(pack, /未提供相交周.*2026-W27.*不阻断生成/);
  for (const heading of ["## 0. 完整性与缺口", "## 1. 月度核心判断", "## 2. 自我反馈与生命状态", "## 3. 行动与现实反馈", "## 4. 支撑性输入", "## 5. 来源与处理审计"]) {
    assert.match(pack, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
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

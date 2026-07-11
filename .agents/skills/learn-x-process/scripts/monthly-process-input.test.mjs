import assert from "node:assert/strict";
import test from "node:test";
import { validateCompressionDocument } from "./generate-monthly-process-pack.mjs";
import { datedSections, filterBoundaryContent, isPlaceholder, requiresCompressionReview, reviewMonthlyTypes, wereadMatchesDeclaredWeek, weeksIntersectingMonth } from "./monthly-process-input.mjs";

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

test("reviews the monthly aggregate by type instead of individual file size", () => {
  assert.equal(requiresCompressionReview("ai"), true);
  assert.equal(requiresCompressionReview("build"), false);
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
    compressionRequests: [{ path: "source.md", sha256: "abc", originalChars: 1000 }]
  };
  const valid = {
    schemaVersion: 1,
    month: "2026-06",
    events: [{
      id: "E001",
      title: "event",
      category: "inbox",
      source: "ai",
      importance: "minor",
      dateRange: { start: "2026-06-01", end: "2026-06-01" },
      sourcePaths: ["source.md"],
      sourceHashes: { "source.md": "abc" },
      text: "证据".repeat(60)
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

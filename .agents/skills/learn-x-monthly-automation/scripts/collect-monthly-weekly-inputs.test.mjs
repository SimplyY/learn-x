import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  parseMonthlyWeeklyInputs,
  renderMonthlyWeeklyInputs,
  weeksIntersectingMonth
} from "./collect-monthly-weekly-inputs.mjs";

test("六月选择所有相交 ISO 周", () => {
  assert.deepEqual(weeksIntersectingMonth("2026-06"), ["2026-W23", "2026-W24", "2026-W25", "2026-W26", "2026-W27"]);
});

test("周度原文写入后数量和哈希守恒", () => {
  const text = "原文  不压缩\n\n\n```边界```";
  const source = {
    week: "2026-W23",
    path: "03_input/weekly/2026-W23/daily.md",
    shortPath: "daily.md",
    category: "log",
    source: "daily",
    modifiedAt: "2026-06-01T00:00:00.000Z",
    bytes: Buffer.byteLength(text),
    chars: text.length,
    sha256: createHash("sha256").update(Buffer.from(text)).digest("hex"),
    text
  };
  const rendered = renderMonthlyWeeklyInputs({ month: "2026-06", weeks: [source.week], sources: [source], generatedAt: "test" });
  assert.deepEqual(parseMonthlyWeeklyInputs(rendered).map(({ text: parsedText, sha256 }) => ({ text: parsedText, sha256 })), [{ text, sha256: source.sha256 }]);
  assert.throws(() => parseMonthlyWeeklyInputs(rendered.replace("原始文件数：1", "原始文件数：2")), /数量不守恒/);
});

test("跨年月份仍选择正确 ISO 周", () => {
  assert.deepEqual(weeksIntersectingMonth("2026-01"), ["2026-W01", "2026-W02", "2026-W03", "2026-W04", "2026-W05"]);
});

test("旧式摘要不能伪装成月度原始输入", () => {
  assert.throws(() => parseMonthlyWeeklyInputs("# 月度周输入汇总\n\n- W23：本周很开心"), /数量不守恒/);
});

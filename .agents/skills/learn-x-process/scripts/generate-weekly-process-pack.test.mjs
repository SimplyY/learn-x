import assert from "node:assert/strict";
import test from "node:test";
import { compressWeeklyProcessItems } from "./generate-weekly-process-pack.mjs";

test("compresses Voice-X once at Process Pack time and reports the overall ratio", () => {
  const source = [
    "# Voice-X 核心重点｜2026-W36", "", "## with 测试", "",
    "## 核心总结", "", "关键事实与行动反馈。".repeat(500), "",
    "## 芒格之魂洞察", "", "核心判断与风险边界。".repeat(300)
  ].join("\n");
  const input = { path: "03_input/weekly/2026-W36/voice.md", text: source };
  const result = compressWeeklyProcessItems([input]);
  assert.equal(input.text, source);
  assert.notEqual(result.items[0].text, source);
  assert.ok(result.compression.outputChars < result.compression.sourceChars);
  assert.ok(result.compression.retainedRatio <= 0.25);
  assert.equal(result.compression.targetRetainedRatio, 0.2);
});

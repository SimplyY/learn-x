import assert from "node:assert/strict";
import test from "node:test";
import { MAX_WEEKLY_INPUT_CHARS, MAX_VOICE_WEEKLY_INPUT_CHARS, assertWeeklyInputSize, countInputChars, maxInputCharsForPath } from "./input-limits.mjs";

test("counts Unicode characters instead of UTF-8 bytes", () => {
  assert.equal(countInputChars("你好🙂"), 3);
});

test("accepts the exact limit and rejects one character over", () => {
  assert.doesNotThrow(() => assertWeeklyInputSize("x".repeat(MAX_WEEKLY_INPUT_CHARS), "fixture.md"));
  assert.throws(() => assertWeeklyInputSize("x".repeat(MAX_WEEKLY_INPUT_CHARS + 1), "fixture.md"), /超过周输入上限/);
});

test("uses the Voice-X file warning line", () => {
  assert.equal(maxInputCharsForPath("03_input/weekly/2026-W36/voice.md"), MAX_VOICE_WEEKLY_INPUT_CHARS);
  assert.equal(maxInputCharsForPath("03_input/weekly/2026-W36/daily.md"), MAX_WEEKLY_INPUT_CHARS);
  assert.equal(MAX_VOICE_WEEKLY_INPUT_CHARS, 30_000);
});

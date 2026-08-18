import assert from "node:assert/strict";
import test from "node:test";
import { defaultWeeklyReviewWeek, filterFilesBySourceStatus, findOversizedWeeklyInputs, inputKindFromRelativePath } from "./collect-weekly-input.mjs";

test("defaults weekly review to previous week on weekdays and current week on weekends", () => {
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-03T04:00:00Z")), "2026-W26");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-04T04:00:00Z")), "2026-W27");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-06T04:00:00Z")), "2026-W27");
});

test("keeps source classification for weekly input files", () => {
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/coach.md"), {
    category: "action",
    source: "coach"
  });
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/wisdom.md"), {
    category: "input",
    source: "wisdom"
  });
});

test("keeps Time-X summaries as ordinary input", () => {
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/time.md"), {
    category: "input",
    source: "time"
  });
});

test("reports every oversized weekly input instead of truncating it", () => {
  const result = findOversizedWeeklyInputs([
    { path: "voice.md", content: "x".repeat(15_001) },
    { path: "daily.md", content: "ok" },
    { path: "flomo.md", content: "y".repeat(15_002) }
  ]);
  assert.deepEqual(result, [
    { path: "voice.md", chars: 15_001 },
    { path: "flomo.md", chars: 15_002 }
  ]);
});

test("excludes stale automatic files while keeping legacy files without status", () => {
  const files = [{ relativePath: "03_input/weekly/2026-W29/daily.md" }, { relativePath: "03_input/weekly/2026-W29/weekly.md" }];
  assert.deepEqual(filterFilesBySourceStatus(files, { daily: { file: "daily.md", status: "empty" } }), [files[1]]);
  assert.deepEqual(filterFilesBySourceStatus(files, {}), files);
});

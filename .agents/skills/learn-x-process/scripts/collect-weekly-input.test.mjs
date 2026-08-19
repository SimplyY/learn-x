import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { collectWeeklyInput, defaultWeeklyReviewWeek, filterFilesBySourceStatus, findOversizedWeeklyInputs, inputKindFromRelativePath, isIgnoredWeeklyInputFile, writeWeeklyInput } from "./collect-weekly-input.mjs";

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

test("keeps the unconfirmed AI draft out of weekly process input", () => {
  assert.equal(isIgnoredWeeklyInputFile("ai.generated.md"), true);
  assert.equal(isIgnoredWeeklyInputFile("_ai-generated.json"), true);
  assert.equal(isIgnoredWeeklyInputFile("ai.md"), false);
});

test("collects from an explicit repo root and excludes only the unconfirmed draft", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-input-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "ai.generated.md"), "## 草稿\n\n未确认", "utf8");
    await writeFile(path.join(weekDir, "ai.md"), "## 正式周回顾\n\n已确认的实质内容", "utf8");
    const result = await collectWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.deepEqual(result.files.map((file) => file.path), ["03_input/weekly/2026-W29/ai.md"]);
    const written = await writeWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.deepEqual(written.payload.files.map((file) => file.path), ["03_input/weekly/2026-W29/ai.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

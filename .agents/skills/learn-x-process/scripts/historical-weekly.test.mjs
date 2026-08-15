import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHistoricalManifest } from "./historical-weekly.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-history-"));
  await mkdir(path.join(root, "03_input/yearly/2025/2025-1"), { recursive: true });
  await mkdir(path.join(root, "03_input/monthly/2025-1"), { recursive: true });
  await mkdir(path.join(root, "03_input/weekly/2025-W01"), { recursive: true });
  await writeFile(path.join(root, "03_input/yearly/2025/2025-1/daily.md"), [
    "## 2024-12-30\n\n最喜悦的事：短记录",
    "## 2024-12-31\n\n最喜悦的事：这是一段明显更长的记录，用于验证最长来源选择。",
    "## 2025-01-01\n\n内容甲内容甲内容甲"
  ].join("\n\n"));
  await writeFile(path.join(root, "03_input/monthly/2025-1/daily.md"), [
    "## 2024-12-31\n\n最喜悦的事：较短",
    "## 2025-01-01\n\n内容乙内容乙内容乙"
  ].join("\n\n"));
  await writeFile(path.join(root, "03_input/weekly/2025-W01/weekly.md"), "# 周记\n\n已有周记正文");
  return root;
}

test("builds an ISO-week coverage manifest and fails closed on equal-length daily conflicts", async () => {
  const root = await fixture();
  const manifest = await buildHistoricalManifest(root);
  const week = manifest.weeks.find((entry) => entry.id === "2025-W01");
  assert.equal(week.status, "blocked");
  assert.equal(week.reason, "daily-date-conflict");
  assert.deepEqual(week.coverage.dates, ["2024-12-30", "2024-12-31", "2025-01-01"]);
  assert.equal(manifest.daily.duplicates.length, 2);
  assert.equal(manifest.daily.conflicts.length, 1);
  const pack = await readFile(path.join(root, "04_output/_dist/historical-weekly/packs/2025-W01.md"), "utf8");
  assert.match(pack, /输入日记哈希：/);
  assert.doesNotMatch(pack, /\/Users\//);
});

test("keeps a substantive canonical weekly source without generating a history copy", async () => {
  const root = await fixture();
  const manifest = await buildHistoricalManifest(root);
  const week = manifest.weeks.find((entry) => entry.id === "2025-W01");
  assert.equal(week.status, "blocked");
  assert.equal(week.syncSource, null);
  assert.equal(week.candidates.find((candidate) => candidate.kind === "canonical").kind, "canonical");
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { flomoBodyHash, flomoMemoUrl, writeStagedOnlineFlomoSnapshot } from "./lib/flomo-full-snapshot.mjs";
import { readWeeklySourceStatus } from "./lib/source-status.mjs";
import { paths, readJson } from "../../learn-x-flomo-review/scripts/review.mjs";
import { parseSyncArgs, syncFlomoFullWeek } from "./sync-flomo-full-week.mjs";

const week = "2026-W40";

function record(id, body, createdAt = "2026-09-29T03:00:00.000Z", isPinned = false) {
  return { memoId: id, url: flomoMemoUrl(id), createdAt, timeText: isPinned ? "置顶・2026-09-29 11:00" : "2026-09-29 11:00",
    bodyText: body, bodyComplete: true, isPinned };
}

function fullScan(records, libraryCount = records.length) {
  const longest = [...records].sort((a, b) => b.bodyText.length - a.bodyText.length)[0];
  const missingCount = libraryCount - records.length;
  return {
    mode: "full", complete: true, libraryCount, scanned: records.length, pageCount: 4,
    scanStartedAt: "2026-10-11T00:00:00.000Z", scanFinishedAt: "2026-10-11T01:00:00.000Z",
    termination: { reason: missingCount ? "stable-bottom-with-accepted-count-gap" : "library-count-and-stable-ids",
      enumerationComplete: true, expectedCount: libraryCount, observedUniqueIds: records.length, missingCount,
      stableScrollPasses: 2, atBottom: true, hasMore: false, loading: false },
    detailVerification: longest ? { verified: true, memoId: longest.memoId, bodyLength: longest.bodyText.length,
      bodyHash: flomoBodyHash(longest.bodyText), method: "original-link-detail-sheet-tiptap-prosemirror" } : null,
    records,
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-full-week-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const attemptToken = "01234567-89ab-cdef-0123-456789abcdef";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: attemptToken, active: true }));
  return { root, weekRoot, attemptToken };
}

function stagedCollector(root, scan) {
  return async () => writeStagedOnlineFlomoSnapshot(root, scan, { storageRoot: path.join(root, "staging") });
}

test("full-week sync activates one validated snapshot and renders weekly input from that same scan", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const note = record("memo-week", "完整线上正文进入目标 ISO 周输入。");
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root, collect: stagedCollector(root, fullScan([note])) });
  assert.equal(result.status, "ready");
  assert.equal(result.count, 1);
  assert.equal(result.snapshotId, (await readJson(paths(root).catalog)).snapshot.snapshotId);
  assert.equal(result.coverage.status, "complete");
  const markdown = await readFile(path.join(weekRoot, "flomo.md"), "utf8");
  assert.match(markdown, /完整线上正文进入目标 ISO 周输入/);
  assert.ok(markdown.includes(flomoMemoUrl("memo-week")));
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "ready");
  assert.equal(status.sources.flomo.count, 1);
});

test("publishes weekly notes when the stable full scan has one user-accepted gap", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-visible", "本次可见笔记。")], 2)) });
  assert.equal(result.status, "ready");
  assert.equal(result.count, 1);
  assert.equal(result.coverage.omittedCount, 1);
  const markdown = await readFile(path.join(weekRoot, "flomo.md"), "utf8");
  assert.match(markdown, /本次可见笔记/);
  assert.match(markdown, /全库计数：观察到 1 \/ 预期 2；未枚举 1 条（容差内，最多 10 条）/);
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "ready");
  assert.match(status.sources.flomo.summary, /未枚举 1 条（容差内，最多 10 条）/);
  assert.equal(paths(root).onlineStorageActive, true);
  assert.equal((await readJson(paths(root).catalog)).coverage.omittedCount, 1);
});

test("holds a full scan with more than five non-generated notes in one Shanghai hour before activation", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const file = path.join(weekRoot, "flomo.md");
  const old = "# Flomo 周输入｜2026-W40\n旧版保留。\n";
  await writeFile(file, old);
  const records = Array.from({ length: 6 }, (_, index) => record(`memo-burst-${index}`, `独立笔记 ${index}`));
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan(records)) }), /flomo-timestamp-density-review-required/);
  assert.equal(await readFile(file, "utf8"), old);
  assert.equal(paths(root).onlineStorageActive, false);
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "failed");
  assert.match(status.sources.flomo.summary, /超过 5 条笔记，时间需核验/);
});

test("filters generated Learn-X records before hourly density validation", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const records = Array.from({ length: 6 }, (_, index) => record(`memo-generated-${index}`, "Learn-X 周记\n自动生成的内容"));
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan(records)) });
  assert.equal(result.status, "empty");
  assert.equal(result.count, 0);
  assert.equal(paths(root).onlineStorageActive, true);
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "empty");
});

test("rejects more than ten missing records without replacing an old week file or activating the snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const old = "# Flomo 周输入｜2026-W40\n\n旧周输入保留。\n";
  const file = path.join(weekRoot, "flomo.md");
  await writeFile(file, old);
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-visible", "本次可见笔记。")], 12)) }), /flomo-full-scan-termination-unproven/);
  assert.equal(await readFile(file, "utf8"), old);
  assert.equal(paths(root).onlineStorageActive, false);
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "failed");
});

test("late attempt token is rejected before the active snapshot pointer changes", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const collect = async () => {
    const staged = await writeStagedOnlineFlomoSnapshot(root, fullScan([record("memo-late", "迟到尝试不应提交。")]), { storageRoot: path.join(root, "staging") });
    await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: "fedcba98-7654-3210-fedc-ba9876543210", active: true }));
    return staged;
  };
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root, collect }), /flomo-attempt-token-stale/);
  assert.equal(paths(root).onlineStorageActive, false);
});

test("sync command requires the weekly retry executor's attempt token", () => {
  assert.deepEqual(parseSyncArgs(["--week", week, "--attempt-token", "01234567-89ab-cdef-0123-456789abcdef"]), {
    week, attemptToken: "01234567-89ab-cdef-0123-456789abcdef",
  });
  assert.throws(() => parseSyncArgs(["--week", week]), /attempt-token-required/);
  assert.throws(() => parseSyncArgs(["--week", week, "--attempt-token", "bad"]), /attempt-token-required/);
});

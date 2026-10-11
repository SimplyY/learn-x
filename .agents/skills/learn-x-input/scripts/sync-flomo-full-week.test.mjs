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

test("accepted daily snapshot gaps cannot publish an incomplete weekly source or overwrite its old file", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const old = "# Flomo 周输入｜2026-W40\n\n旧周输入保留但 failed 状态不允许消费。\n";
  const file = path.join(weekRoot, "flomo.md");
  await writeFile(file, old);
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-visible", "本次可见笔记。")], 2)) });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "flomo-weekly-snapshot-gap");
  assert.equal(result.coverage.omittedCount, 1);
  assert.equal(await readFile(file, "utf8"), old);
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "failed");
  assert.equal(status.sources.flomo.preservedStaleFile, true);
  assert.equal(paths(root).onlineStorageActive, true, "the accepted snapshot still serves daily review with visible coverage");
  assert.equal((await readJson(paths(root).catalog)).coverage.omittedCount, 1);
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

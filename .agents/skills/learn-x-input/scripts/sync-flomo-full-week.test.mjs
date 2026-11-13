import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultFlomoPrivateDataRoot, flomoBodyHash, flomoMemoUrl, resolveFlomoPathAllowed, writeStagedOnlineFlomoSnapshot } from "./lib/flomo-full-snapshot.mjs";
import { fileExists, readWeeklySourceStatus } from "./lib/source-status.mjs";
import { activateOnlineSnapshot, paths, readJson } from "../../learn-x-flomo-review/scripts/review.mjs";
import { parseSyncArgs, runYWContextFlomoSync, syncFlomoFullWeek } from "./sync-flomo-full-week.mjs";

const week = "2026-W40";

function record(id, body, createdAt = "2026-09-29T03:00:00.000Z", isPinned = false) {
  return { memoId: id, url: flomoMemoUrl(id), createdAt, timeText: isPinned ? "置顶・2026-09-29 11:00" : "2026-09-29 11:00",
    bodyText: body, bodyComplete: true, isPinned };
}

function fullScan(records, libraryCount = records.length, {
  scanStartedAt = "2026-10-11T00:00:00.000Z",
  scanFinishedAt = "2026-10-11T01:00:00.000Z",
} = {}) {
  const longest = [...records].sort((a, b) => b.bodyText.length - a.bodyText.length)[0];
  const missingCount = libraryCount - records.length;
  return {
    mode: "full", complete: true, libraryCount, scanned: records.length, pageCount: 4,
    scanStartedAt, scanFinishedAt,
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
  return async () => writeStagedOnlineFlomoSnapshot(root, scan, { storageRoot: defaultFlomoPrivateDataRoot(root) });
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
  assert.match(markdown, new RegExp(`活动快照 ID：${result.snapshotId}`));
  assert.match(markdown, new RegExp(`快照采集时间：${result.capturedAt}`));
  assert.ok(markdown.includes(flomoMemoUrl("memo-week")));
  const status = await readWeeklySourceStatus(weekRoot, week);
  assert.equal(status.sources.flomo.status, "ready");
  assert.equal(status.sources.flomo.count, 1);
});

test("YW-Context mirror runs after activation and its failure does not change Learn-X Flomo success", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  let observedActiveSnapshot = null;
  const result = await syncFlomoFullWeek({
    week,
    attemptToken,
    repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-mirror", "镜像失败不能回滚来源快照。")])),
    mirrorToYWContext: async (learnXRoot) => {
      observedActiveSnapshot = (await readJson(paths(learnXRoot).storageModePath)).activeSnapshotId;
      return { status: "failed", error_code: "test_mirror_failure" };
    },
  });
  assert.equal(observedActiveSnapshot, result.snapshotId);
  assert.equal(result.status, "ready");
  assert.equal(result.ywContextMirror.status, "failed");
  assert.equal((await readWeeklySourceStatus(weekRoot, week)).sources.flomo.status, "ready");
});

test("YW-Context sync preserves the sanitized publication and failure-status receipt fields", async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts/sync-flomo-snapshot.mjs"), "// fixture entrypoint\n");
  const sourceRevision = `flomo-snapshot-v1:${"a".repeat(36)}:${"b".repeat(64)}`;
  const commit = "c".repeat(40);
  const statusReportCommit = "d".repeat(40);
  const result = runYWContextFlomoSync(root, {
    env: { YW_CONTEXT_ROOT: root },
    spawn: (_command, args, options) => {
      assert.equal(args.at(-1), "--apply");
      assert.equal(path.resolve(options.cwd), path.resolve(root));
      return { status: 0, stdout: JSON.stringify({ status: "incomplete_snapshot", source_revision: sourceRevision,
        commit, status_report: { status: "published_and_read_back", commit: statusReportCommit }, private_body: "fixture only" }) };
    },
  });
  assert.deepEqual(result, { status: "incomplete_snapshot", source_revision: sourceRevision, commit,
    status_report_status: "published_and_read_back", status_report_commit: statusReportCommit });
});

test("a handwritten weekly file blocks snapshot activation before it can diverge from the active snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const first = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-last-good", "最后一次成功的扫描。")])) });
  const activeBefore = await readJson(paths(root).catalog);
  const file = path.join(weekRoot, "flomo.md");
  const handwritten = "# 人工维护的周输入\n\n不得被覆盖。\n";
  await writeFile(file, handwritten);
  const nextAttemptToken = "fedcba98-7654-3210-fedc-ba9876543210";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: nextAttemptToken, active: true }));

  await assert.rejects(syncFlomoFullWeek({ week, attemptToken: nextAttemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-next", "不应激活的新扫描。")], 1,
      { scanStartedAt: "2026-10-12T00:00:00.000Z", scanFinishedAt: "2026-10-12T01:00:00.000Z" })) }), /flomo-existing-file-not-generated/);

  assert.equal(await readFile(file, "utf8"), handwritten);
  assert.deepEqual(await readJson(paths(root).catalog), activeBefore);
  assert.equal((await readJson(paths(root).catalog)).snapshot.snapshotId, first.snapshotId);
  assert.equal(paths(root).onlineStorageActive, true);
});

test("the activation commit hook catches a handwritten-file race before switching the active snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const first = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-last-good", "最后一次成功的扫描。")])) });
  const activeBefore = await readJson(paths(root).catalog);
  const file = path.join(weekRoot, "flomo.md");
  const handwritten = "# 在预检后写入的人工内容\n";
  const nextAttemptToken = "fedcba98-7654-3210-fedc-ba9876543210";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: nextAttemptToken, active: true }));

  await assert.rejects(syncFlomoFullWeek({ week, attemptToken: nextAttemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-next", "不应激活的新扫描。")], 1,
      { scanStartedAt: "2026-10-12T00:00:00.000Z", scanFinishedAt: "2026-10-12T01:00:00.000Z" })),
    activate: async (projectRoot, snapshotPath, options) => {
      await writeFile(file, handwritten);
      return activateOnlineSnapshot(projectRoot, snapshotPath, options);
    } }), /flomo-existing-file-not-generated/);

  assert.equal(await readFile(file, "utf8"), handwritten);
  assert.deepEqual(await readJson(paths(root).catalog), activeBefore);
  assert.equal((await readJson(paths(root).catalog)).snapshot.snapshotId, first.snapshotId);
});

test("a weekly publish failure inside the activation hook preserves the last active snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const first = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-last-good", "最后一次成功的扫描。")])) });
  const activeBefore = await readJson(paths(root).catalog);
  const file = path.join(weekRoot, "flomo.md");
  const previousWeekFile = await readFile(file, "utf8");
  const nextAttemptToken = "fedcba98-7654-3210-fedc-ba9876543210";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: nextAttemptToken, active: true }));

  await assert.rejects(syncFlomoFullWeek({ week, attemptToken: nextAttemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-next", "本次发布将失败。")], 1,
      { scanStartedAt: "2026-10-12T00:00:00.000Z", scanFinishedAt: "2026-10-12T01:00:00.000Z" })),
    publish: async () => { throw new Error("weekly-file-publish-failed"); } }), /weekly-file-publish-failed/);

  assert.equal(await readFile(file, "utf8"), previousWeekFile);
  assert.deepEqual(await readJson(paths(root).catalog), activeBefore);
  assert.equal((await readJson(paths(root).catalog)).snapshot.snapshotId, first.snapshotId);
});

test("an activation commit failure rolls the weekly file back to the last active snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const first = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-last-good", "最后一次成功的扫描。")])) });
  const activeBefore = await readJson(paths(root).storageModePath);
  const file = path.join(weekRoot, "flomo.md");
  const previousWeekFile = await readFile(file, "utf8");
  const nextAttemptToken = "fedcba98-7654-3210-fedc-ba9876543210";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: nextAttemptToken, active: true }));

  await assert.rejects(syncFlomoFullWeek({ week, attemptToken: nextAttemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-next", "新周文件必须随失败回滚。")], 1,
      { scanStartedAt: "2026-10-12T00:00:00.000Z", scanFinishedAt: "2026-10-12T01:00:00.000Z" })),
    activate: async (projectRoot, snapshotPath, options) => activateOnlineSnapshot(projectRoot, snapshotPath, {
      beforeCommit: async () => {
        await options.beforeCommit();
        throw new Error("snapshot-pointer-commit-failed");
      },
    }) }), /snapshot-pointer-commit-failed/);

  assert.equal(await readFile(file, "utf8"), previousWeekFile);
  assert.deepEqual(await readJson(paths(root).storageModePath), activeBefore);
  assert.equal((await readWeeklySourceStatus(weekRoot, week)).sources.flomo.status, "failed");
  assert.equal((await readJson(paths(root).catalog)).snapshot.snapshotId, first.snapshotId);
});

test("an activation failure removes a first weekly file when there was no previous one", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-first", "首次发布失败后不得留下未激活输入。")])),
    activate: async (projectRoot, snapshotPath, options) => activateOnlineSnapshot(projectRoot, snapshotPath, {
      beforeCommit: async () => {
        await options.beforeCommit();
        throw new Error("snapshot-pointer-commit-failed");
      },
    }) }), /snapshot-pointer-commit-failed/);

  assert.equal(await fileExists(path.join(weekRoot, "flomo.md")), false);
  assert.equal(paths(root).onlineStorageActive, false);
  assert.equal((await readWeeklySourceStatus(weekRoot, week)).sources.flomo.status, "failed");
});

test("full-week sync passes the repository-local private root to its collector by default", async (t) => {
  const { root, attemptToken } = await fixture(t);
  let seenStorageRoot;
  const note = record("memo-local-root", "项目内私有目录路由测试。");
  const result = await syncFlomoFullWeek({
    week,
    attemptToken,
    repoRoot: root,
    collect: async (options) => {
      seenStorageRoot = options.storageRoot;
      return writeStagedOnlineFlomoSnapshot(root, fullScan([note]), { storageRoot: seenStorageRoot });
    },
  });
  assert.equal(seenStorageRoot, await resolveFlomoPathAllowed(defaultFlomoPrivateDataRoot(root)));
  assert.equal(result.status, "ready");
});

test("full-week sync rejects a Library storage override before invoking the collector", async (t) => {
  const { root, attemptToken } = await fixture(t);
  let collectStarted = false;
  await assert.rejects(syncFlomoFullWeek({
    week,
    attemptToken,
    repoRoot: root,
    storageRoot: path.join(os.homedir(), "Library", "Application Support", "Learn-X", "flomo-review"),
    collect: async () => { collectStarted = true; throw new Error("collector-should-not-run"); },
  }), /flomo-storage-root-library-forbidden/);
  assert.equal(collectStarted, false);
});

test("full snapshot refresh includes edits to older notes while the weekly file includes only target-week creations", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const oldEdited = record("memo-edited-old", "旧笔记在本周被编辑后的内容。", "2026-09-20T03:00:00.000Z");
  const newThisWeek = record("memo-new-this-week", "本周新建的笔记内容。", "2026-09-29T03:00:00.000Z");
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([oldEdited, newThisWeek])) });

  const weeklyInput = await readFile(path.join(weekRoot, "flomo.md"), "utf8");
  assert.match(weeklyInput, /本周新建的笔记内容/);
  assert.doesNotMatch(weeklyInput, /旧笔记在本周被编辑后的内容/);
  const storage = await readJson(paths(root).storageModePath);
  const activeSnapshot = await readJson(path.join(paths(root).privateRoot, storage.activeSnapshotPath));
  assert.equal(activeSnapshot.snapshotId, result.snapshotId);
  assert.equal(activeSnapshot.records.find((item) => item.memoId === oldEdited.memoId).body, oldEdited.bodyText);
  assert.equal(activeSnapshot.records.find((item) => item.memoId === newThisWeek.memoId).body, newThisWeek.bodyText);
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
  const file = path.join(weekRoot, "flomo.md");
  const handwritten = "# 人工维护的旧周输入\n\n空结果应保留它。\n";
  await writeFile(file, handwritten);
  const records = Array.from({ length: 6 }, (_, index) => record(`memo-generated-${index}`, "Learn-X 周记\n自动生成的内容"));
  const result = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan(records)) });
  assert.equal(result.status, "empty");
  assert.equal(result.count, 0);
  assert.equal(await readFile(file, "utf8"), handwritten);
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

test("an incomplete later scan preserves the last activated full snapshot", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const first = await syncFlomoFullWeek({ week, attemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-last-good", "最后一次成功的快照。")])) });
  const activeBefore = await readJson(paths(root).catalog);
  const nextAttemptToken = "fedcba98-7654-3210-fedc-ba9876543210";
  await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: nextAttemptToken, active: true }));

  await assert.rejects(syncFlomoFullWeek({ week, attemptToken: nextAttemptToken, repoRoot: root,
    collect: stagedCollector(root, fullScan([record("memo-incomplete", "不完整扫描不能激活。")], 12)) }), /flomo-full-scan-termination-unproven/);

  const activeAfter = await readJson(paths(root).catalog);
  assert.equal(activeAfter.snapshot.snapshotId, first.snapshotId);
  assert.deepEqual(activeAfter, activeBefore);
  assert.equal(paths(root).onlineStorageActive, true);
});

test("preserves a safe Flomo scan error code and stage in failed source status", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const error = Object.assign(new Error("ego-detail-body-mismatch"), {
    stage: "verify-longest-detail",
    bodyText: "private memo text",
    memoId: "private-memo-id",
  });
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root, collect: async () => { throw error; } }), /ego-detail-body-mismatch/);
  const status = await readWeeklySourceStatus(weekRoot, week);
  const summary = status.sources.flomo.summary;
  assert.match(summary, /ego-detail-body-mismatch stage=verify-longest-detail/);
  assert.match(summary, /scan-integrity-check-failed/);
  assert.doesNotMatch(summary, /private memo text|private-memo-id/);
});

test("late attempt token is rejected before the active snapshot pointer changes", async (t) => {
  const { root, weekRoot, attemptToken } = await fixture(t);
  const collect = async () => {
    const staged = await writeStagedOnlineFlomoSnapshot(root, fullScan([record("memo-late", "迟到尝试不应提交。")]), { storageRoot: defaultFlomoPrivateDataRoot(root) });
    await writeFile(path.join(weekRoot, "_flomo-attempt.json"), JSON.stringify({ token: "fedcba98-7654-3210-fedc-ba9876543210", active: true }));
    return staged;
  };
  await assert.rejects(syncFlomoFullWeek({ week, attemptToken, repoRoot: root, collect }), /flomo-attempt-token-stale/);
  assert.equal(paths(root).onlineStorageActive, false);
});

test("sync command requires the weekly retry executor's attempt token", () => {
  assert.deepEqual(parseSyncArgs(["--week", week, "--attempt-token", "01234567-89ab-cdef-0123-456789abcdef",
    "--invocation-id", "123e4567-e89b-42d3-a456-426614174000"]), {
    week, attemptToken: "01234567-89ab-cdef-0123-456789abcdef", invocationId: "123e4567-e89b-42d3-a456-426614174000",
  });
  assert.throws(() => parseSyncArgs(["--week", week]), /attempt-token-required/);
  assert.throws(() => parseSyncArgs(["--week", week, "--attempt-token", "01234567-89ab-cdef-0123-456789abcdef"]), /invocation-id-required/);
  assert.throws(() => parseSyncArgs(["--week", week, "--attempt-token", "bad"]), /attempt-token-required/);
});

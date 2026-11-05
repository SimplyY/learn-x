import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectAndPublishConfirmedWeeklyJournal, collectConfirmedWeeklyJournal, mirrorLearnXPersonalFilesToYWContext, recordWeeklyJournalAnchor, WEEKLY_JOURNAL_DOCUMENT_URL } from "./collect-weekly-journal.mjs";

const allowCoreGate = async () => [];

test("records a narrow target-week anchor and collects only the anchored, confirmed section", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const anchor = await recordWeeklyJournalAnchor({
    week: "2026-W40",
    writeDate: "2026-10-05",
    targetTitle: "10.5",
    targetBlockId: "blkTarget2026W40",
    documentId: "docWeeklyJournal01",
    repoRoot: root
  });
  assert.equal(anchor.anchor.documentUrl, WEEKLY_JOURNAL_DOCUMENT_URL);
  assert.deepEqual(anchor.anchor.coverage, { start: "2026-09-28", end: "2026-10-04" });

  const section = "## 10.5\n\n本周周记包含具体经历、事实和个人判断，已经完成确认。";
  let calls = 0;
  const fetchSection = async (request) => {
    calls += 1;
    assert.equal(request.docUrl, WEEKLY_JOURNAL_DOCUMENT_URL);
    assert.equal(request.blockId, "blkTarget2026W40");
    return {
      ok: true,
      identity: "bot",
      data: { document: { document_id: "docWeeklyJournal01", revision_id: 71, content: `<fragment mode="section">${section}</fragment>` } }
    };
  };

  const first = await collectConfirmedWeeklyJournal({ week: "2026-W40", repoRoot: root, fetchSection, requireCoreGate: allowCoreGate });
  const saved = await readFile(first.outputPath, "utf8");
  assert.match(saved, /目标周：2026-W40/);
  assert.match(saved, /目标覆盖范围：2026-09-28 至 2026-10-04/);
  assert.ok(saved.endsWith(`${section}\n`));
  const second = await collectConfirmedWeeklyJournal({ week: "2026-W40", repoRoot: root, fetchSection, requireCoreGate: allowCoreGate });
  assert.equal(second.unchanged, true);
  assert.equal(await readFile(first.outputPath, "utf8"), saved);
  assert.equal(calls, 2);
});

test("Core incompleteness blocks journal collection before remote fetch or shared publication", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-core-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyJournalAnchor({
    week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
    targetBlockId: "blkTarget2026W40", documentId: "docWeeklyJournal01", repoRoot: root
  });
  let fetchCalls = 0;
  const weekDir = path.join(root, "03_input/weekly/2026-W40");
  await assert.rejects(collectAndPublishConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    requireCoreGate: async (weeks, options) => {
      assert.deepEqual(weeks, ["2026-W40"]);
      assert.equal(options.repoRoot, root);
      throw new Error("weekly-process-blocked-core: 2026-W40 first-thought-incomplete");
    },
    fetchSection: async () => { fetchCalls += 1; throw new Error("must not fetch"); }
  }), /weekly-process-blocked-core/);
  assert.equal(fetchCalls, 0);
  await assert.rejects(readFile(path.join(weekDir, "weekly.md")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(root, "04_output/_dist/shared-context/weekly/current.json")), { code: "ENOENT" });
});

test("accepts an edited confirmed heading on the same date and records the current title", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-edited-title-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyJournalAnchor({
    week: "2026-W41",
    writeDate: "2026-10-12",
    targetTitle: "【待优化】AI 基础草稿：10.12",
    targetBlockId: "blkTarget2026W41",
    documentId: "docWeeklyJournal01",
    repoRoot: root
  });
  const section = "## 10.12\n\n本周周记已完成确认，包含具体经历、事实和判断。";
  const result = await collectConfirmedWeeklyJournal({
    week: "2026-W41",
    repoRoot: root,
    requireCoreGate: allowCoreGate,
    fetchSection: async () => ({
      ok: true,
      identity: "bot",
      data: { document: { document_id: "docWeeklyJournal01", revision_id: 73, content: `<fragment mode=\"section\">${section}</fragment>` } }
    })
  });
  const saved = await readFile(result.outputPath, "utf8");
  assert.match(saved, /周记写作日标题：10\.12/);
  assert.ok(saved.endsWith(`${section}\n`));
});

test("refuses stale, wrong-document, or still-draft journal sections without writing weekly.md", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyJournalAnchor({
    week: "2026-W40",
    writeDate: "2026-10-05",
    targetTitle: "10.5",
    targetBlockId: "blkTarget2026W40",
    documentId: "docWeeklyJournal01",
    repoRoot: root
  });
  const weekDir = path.join(root, "03_input/weekly/2026-W40");
  const output = path.join(weekDir, "weekly.md");

  await assert.rejects(collectConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    requireCoreGate: allowCoreGate,
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: { document_id: "docOther01", content: "## 10.5\n\n有效周记正文足够长。" } } })
  }), /different document/);
  await assert.rejects(collectConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    requireCoreGate: allowCoreGate,
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: { document_id: "docWeeklyJournal01", content: "## 10.5\n\n【待优化】AI 基础草稿\n\n模板内容不能确认。" } } })
  }), /still contains the draft marker/);
  await assert.rejects(collectConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    requireCoreGate: allowCoreGate,
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: { document_id: "docWeeklyJournal01", content: "## 10.6\n\n这不是当前目标周标题，虽然正文足够长。" } } })
  }), /target heading does not match expected write date/);
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("refuses replacing a different saved journal anchor for the same week", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-anchor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyJournalAnchor({
    week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
    targetBlockId: "blkTarget2026W40", documentId: "docWeeklyJournal01", repoRoot: root
  });
  await assert.rejects(recordWeeklyJournalAnchor({
    week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
    targetBlockId: "blkDifferent2026W40", documentId: "docWeeklyJournal01", repoRoot: root
  }), /different target/);
});

test("publishes the shared plan only after Stage 2 journal collection succeeds", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyJournalAnchor({
    week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
    targetBlockId: "blkTarget2026W40", documentId: "docWeeklyJournal01", repoRoot: root
  });
  const section = `## 10.5\n\n已确认周记正文，包含足够的经历事实和个人判断。\n\n| 项目 | 内容 |\n| --- | --- |\n| 新周计划 | 1. 完成计划核对 [链接](https://example.com/plan) |`;
  let mirrorCalled = false;
  const result = await collectAndPublishConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    requireCoreGate: allowCoreGate,
    mirrorToYWContext: async (learnXRoot) => {
      mirrorCalled = true;
      assert.equal(learnXRoot, root);
      return { status: "idempotent", record_count: 482 };
    },
    fetchSection: async () => ({
      ok: true,
      identity: "bot",
      data: { document: { document_id: "docWeeklyJournal01", revision_id: 72, content: section } }
    })
  });

  assert.equal(result.sharedContext.planWeek, "2026-W41");
  assert.equal(mirrorCalled, true);
  assert.equal(result.ywContextMirror.status, "idempotent");
  const saved = await readFile(result.outputPath, "utf8");
  assert.match(saved, /来源 revision：72/);
  const current = JSON.parse(await readFile(result.sharedContext.currentPath, "utf8"));
  assert.equal(current.producer, "learn-x");
  assert.equal(current.planWeek, "2026-W41");
});

test("atomically preserves one target when conflicting anchor writes race", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-journal-anchor-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempts = await Promise.allSettled([
    recordWeeklyJournalAnchor({
      week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
      targetBlockId: "blkTargetRaceA", documentId: "docWeeklyJournal01", repoRoot: root
    }),
    recordWeeklyJournalAnchor({
      week: "2026-W40", writeDate: "2026-10-05", targetTitle: "10.5",
      targetBlockId: "blkTargetRaceB", documentId: "docWeeklyJournal01", repoRoot: root
    })
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected" && /different target/.test(result.reason.message)).length, 1);

  await assert.rejects(recordWeeklyJournalAnchor({
    week: "2026-W40", writeDate: "2026-10-05", targetTitle: "110.50",
    targetBlockId: "blkTargetSubstring", documentId: "docWeeklyJournal01", repoRoot: root
  }), /target title must include/);
});

test("YW-Context mirror reuses the confirmed weekly completion point and returns only a safe receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-yw-context-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contextRoot = path.join(root, "yw-context");
  const syncScript = path.join(contextRoot, "scripts", "sync-learn-x-personal-files.mjs");
  await mkdir(path.dirname(syncScript), { recursive: true });
  await writeFile(syncScript, "// test fixture\n");

  let captured;
  const result = await mirrorLearnXPersonalFilesToYWContext(root, {
    env: { YW_CONTEXT_ROOT: contextRoot },
    run: async (command, args, options) => {
      captured = { command, args, cwd: options.cwd };
      return { stdout: JSON.stringify({ status: "idempotent", source_revision: "fixture-revision", record_count: 482, levels: { P2: 117, P3: 365 }, commit: "abc123" }) };
    }
  });
  assert.equal(result.status, "idempotent");
  assert.equal(result.record_count, 482);
  assert.equal(captured.args.at(-1), "--apply");
  assert.equal(captured.cwd, contextRoot);

  const unavailable = await mirrorLearnXPersonalFilesToYWContext(root, { env: { YW_CONTEXT_ROOT: path.join(root, "missing") } });
  assert.deepEqual(unavailable, { status: "unavailable", error_code: "yw_context_sync_entrypoint_not_found" });
});

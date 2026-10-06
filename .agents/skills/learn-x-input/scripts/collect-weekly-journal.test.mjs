import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectConfirmedWeeklyJournal, recordWeeklyJournalAnchor, WEEKLY_JOURNAL_DOCUMENT_URL } from "./collect-weekly-journal.mjs";

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

  const first = await collectConfirmedWeeklyJournal({ week: "2026-W40", repoRoot: root, fetchSection });
  const saved = await readFile(first.outputPath, "utf8");
  assert.match(saved, /目标周：2026-W40/);
  assert.match(saved, /目标覆盖范围：2026-09-28 至 2026-10-04/);
  assert.ok(saved.endsWith(`${section}\n`));
  const second = await collectConfirmedWeeklyJournal({ week: "2026-W40", repoRoot: root, fetchSection });
  assert.equal(second.unchanged, true);
  assert.equal(await readFile(first.outputPath, "utf8"), saved);
  assert.equal(calls, 2);
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
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: { document_id: "docOther01", content: "## 10.5\n\n有效周记正文足够长。" } } })
  }), /different document/);
  await assert.rejects(collectConfirmedWeeklyJournal({
    week: "2026-W40",
    repoRoot: root,
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: { document_id: "docWeeklyJournal01", content: "## 10.5\n\n【待优化】AI 基础草稿\n\n模板内容不能确认。" } } })
  }), /still contains the draft marker/);
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

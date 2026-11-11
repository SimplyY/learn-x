import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectConfirmedWeeklyRangeJournal, recordWeeklyRangeAnchor } from "./collect-weekly-range-journal.mjs";
import { WEEKLY_JOURNAL_DOCUMENT_URL } from "./collect-weekly-journal.mjs";

const periodId = "2026-W43-W44";
const weeks = ["2026-W43", "2026-W44"];

async function createRangeAnchor(root) {
  const directory = path.join(root, "03_input/weekly", periodId);
  await mkdir(directory, { recursive: true });
  const anchor = {
    schemaVersion: 1,
    periodId,
    weeks,
    documentUrl: WEEKLY_JOURNAL_DOCUMENT_URL,
    documentId: "docWeeklyJournal01",
    targetTitle: "【待优化】AI 基础草稿：11.2｜2026-W43-W44（2026-10-19—2026-11-01）",
    targetBlockId: "blkRangeTarget2026W43W44",
    writeDate: "2026-11-02",
    coverage: { start: "2026-10-19", end: "2026-11-01" }
  };
  const manifest = {
    schemaVersion: 1,
    period: {
      id: periodId, weeks, start: "2026-10-19", endInclusive: "2026-11-01", timezone: "Asia/Shanghai", writeDate: "2026-11-02"
    },
    journal: {
      documentId: anchor.documentId, targetBlockId: anchor.targetBlockId,
      targetTitle: anchor.targetTitle, status: "draft", readBackVerified: true
    }
  };
  const anchorPath = path.join(directory, "_weekly-journal-anchor.json");
  const manifestPath = path.join(directory, "_range-manifest.json");
  const anchorText = `${JSON.stringify(anchor, null, 2)}\n`;
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(anchorPath, anchorText);
  await writeFile(manifestPath, manifestText);
  return { directory, anchorPath, manifestPath, anchorText, manifestText };
}

test("Core incompleteness blocks range journal fetch and leaves weekly/anchor/manifest untouched", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-range-core-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = await createRangeAnchor(root);
  let fetchCalls = 0;

  await assert.rejects(collectConfirmedWeeklyRangeJournal({
    periodId,
    repoRoot: root,
    requireCoreGate: async (actualWeeks, options) => {
      assert.deepEqual(actualWeeks, weeks);
      assert.equal(options.repoRoot, root);
      throw new Error("weekly-process-blocked-core: W43/W44 first-thought-incomplete");
    },
    fetchSection: async () => { fetchCalls += 1; throw new Error("must not fetch"); }
  }), /weekly-process-blocked-core/);

  assert.equal(fetchCalls, 0);
  await assert.rejects(readFile(path.join(files.directory, "weekly.md")), { code: "ENOENT" });
  assert.equal(await readFile(files.anchorPath, "utf8"), files.anchorText);
  assert.equal(await readFile(files.manifestPath, "utf8"), files.manifestText);
});

test("range journal collects only after all Core weeks pass the live gate", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-range-ready-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = await createRangeAnchor(root);
  const order = [];
  const section = "## 11.2｜2026-W43-W44（2026-10-19—2026-11-01）\n\n本范围周记包含已确认的具体经历与事实，覆盖两周。";

  const result = await collectConfirmedWeeklyRangeJournal({
    periodId,
    repoRoot: root,
    requireCoreGate: async (actualWeeks, options) => {
      order.push("gate");
      assert.deepEqual(actualWeeks, weeks);
      assert.equal(options.repoRoot, root);
      return weeks.map(week => ({ week, ok: true }));
    },
    fetchSection: async request => {
      order.push("fetch");
      assert.equal(request.docUrl, WEEKLY_JOURNAL_DOCUMENT_URL);
      assert.equal(request.blockId, "blkRangeTarget2026W43W44");
      return { ok: true, identity: "bot", data: { document: { document_id: "docWeeklyJournal01", revision_id: 5391, content: section } } };
    }
  });

  assert.deepEqual(order, ["gate", "fetch"]);
  assert.equal(result.periodId, periodId);
  assert.match(await readFile(path.join(files.directory, "weekly.md"), "utf8"), /目标周期：2026-W43-W44/);
  const manifest = JSON.parse(await readFile(files.manifestPath, "utf8"));
  assert.equal(manifest.journal.status, "confirmed-readback");
  assert.equal(result.ywContextMirror.status, "unavailable");
});

test("range anchor initialization creates the manifest and is idempotent without downgrading confirmation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-range-anchor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const periodId = "2026-W45-W46";
  const weeks = ["2026-W45", "2026-W46"];
  for (const week of weeks) {
    const directory = path.join(root, "03_input/weekly", week);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "_source-status.json"), JSON.stringify({
      version: 1, week, updatedAt: "2026-11-15T12:00:00.000Z",
      sources: { daily: { status: "ready", file: "daily.md", count: 2 }, flomo: { status: "empty", file: "flomo.md", count: 0 } }
    }));
    await writeFile(path.join(directory, "_weekly-retry-state.json"), JSON.stringify({
      schemaVersion: 1, week, updatedAt: "2026-11-15T12:00:00.000Z",
      sources: { daily: { status: "succeeded", attempts: 1, retries: 0 }, flomo: { status: "succeeded", attempts: 2, retries: 1 } }
    }));
  }

  const input = {
    periodId, targetTitle: "【待优化】AI 基础草稿：11.16｜2026-W45-W46（2026-11-02—2026-11-15）", targetBlockId: "rangeHeading123",
    documentId: "document123", writeDate: "2026-11-16", automationId: "learn-x-v2",
    scheduledAt: "2026-11-16T05:00:00+08:00", repoRoot: root,
    fetchSection: async request => {
      assert.equal(request.blockId, "rangeHeading123");
      return { ok: true, identity: "bot", data: { document: {
        document_id: "document123", revision_id: 42,
        content: `## ${input.targetTitle}\n\nThis synthetic draft contains enough concrete weekly evidence for a safe range anchor.`
      } } };
    }
  };
  const first = await recordWeeklyRangeAnchor(input);
  assert.equal(first.unchanged, false);

  const manifestPath = path.join(root, "03_input/weekly", periodId, "_range-manifest.json");
  const anchorPath = path.join(root, "03_input/weekly", periodId, "_weekly-journal-anchor.json");
  const anchor = JSON.parse(await readFile(anchorPath, "utf8"));
  assert.deepEqual(anchor.weeks, weeks);
  assert.equal(anchor.coverage.start, "2026-11-02");
  assert.equal(anchor.coverage.end, "2026-11-15");
  assert.equal(anchor.draftStatus, "draft");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.period, {
    id: periodId, weeks, start: "2026-11-02", endInclusive: "2026-11-15", timezone: "Asia/Shanghai", writeDate: "2026-11-16"
  });
  assert.deepEqual(manifest.sourceStatusByWeek.map(item => item.week), weeks);
  assert.equal(manifest.sourceStatusByWeek[0].sources.daily.file, "daily.md");
  assert.equal(manifest.sourceStatusByWeek[0].retry.flomo.attempts, 2);

  manifest.journal.status = "confirmed-readback";
  manifest.journal.weeklySha256 = "a".repeat(64);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const second = await recordWeeklyRangeAnchor(input);
  assert.equal(second.unchanged, true);
  const saved = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(saved.journal.status, "confirmed-readback");
  assert.equal(saved.journal.weeklySha256, "a".repeat(64));
});

test("initialized range metadata unblocks confirmed range collection end to end", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-range-anchor-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const periodId = "2026-W45-W46";
  for (const week of ["2026-W45", "2026-W46"]) {
    const directory = path.join(root, "03_input/weekly", week);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "_source-status.json"), JSON.stringify({ version: 1, week, sources: { daily: { status: "ready", file: "daily.md", count: 1 } } }));
    await writeFile(path.join(directory, "_weekly-retry-state.json"), JSON.stringify({ schemaVersion: 1, week, sources: { daily: { status: "succeeded", attempts: 1, retries: 0 } } }));
  }
  await recordWeeklyRangeAnchor({
    periodId, targetTitle: "【待优化】AI 基础草稿：11.16｜2026-W45-W46（2026-11-02—2026-11-15）", targetBlockId: "rangeHeading123",
    documentId: "document123", writeDate: "2026-11-16", automationId: "learn-x-v2",
    scheduledAt: "2026-11-16T05:00:00+08:00", repoRoot: root,
    fetchSection: async () => ({ ok: true, identity: "bot", data: { document: {
      document_id: "document123", revision_id: 42,
      content: "## 【待优化】AI 基础草稿：11.16｜2026-W45-W46（2026-11-02—2026-11-15）\n\nThis synthetic draft contains enough concrete weekly evidence for the range anchor."
    } } })
  });

  const result = await collectConfirmedWeeklyRangeJournal({
    periodId, repoRoot: root,
    requireCoreGate: async weeks => weeks.map(week => ({ week, ok: true })),
    fetchSection: async request => {
      assert.equal(request.blockId, "rangeHeading123");
      return { ok: true, identity: "bot", data: { document: {
        document_id: "document123", revision_id: 43,
        content: "## 11.16｜2026-W45-W46（2026-11-02—2026-11-15）\n\nThis synthetic journal summarizes both covered weeks with verified facts."
      } } };
    }
  });
  assert.equal(result.periodId, periodId);
  assert.equal(result.targetTitle, "11.16｜2026-W45-W46（2026-11-02—2026-11-15）");
  const manifest = JSON.parse(await readFile(path.join(root, "03_input/weekly", periodId, "_range-manifest.json"), "utf8"));
  assert.equal(manifest.journal.status, "confirmed-readback");
  assert.equal(manifest.journal.readBackVerified, true);
  assert.match(await readFile(path.join(root, "03_input/weekly", periodId, "weekly.md"), "utf8"), /目标覆盖范围：2026-11-02 至 2026-11-15/);
});

test("range anchor rejects impossible ISO weeks before creating files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-range-invalid-week-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(recordWeeklyRangeAnchor({ periodId: "2025-W53", repoRoot: root }), /weekly-range-invalid-week/);
  await assert.rejects(readFile(path.join(root, "03_input/weekly/2025-W53/_range-manifest.json")), { code: "ENOENT" });
});

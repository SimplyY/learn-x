import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectConfirmedWeeklyRangeJournal } from "./collect-weekly-range-journal.mjs";
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
    targetBlockId: "blkRangeTarget2026W43W44",
    writeDate: "2026-11-02",
    coverage: { start: "2026-10-19", end: "2026-11-01" }
  };
  const manifest = {
    schemaVersion: 1,
    period: { id: periodId, weeks },
    journal: { documentId: anchor.documentId, targetBlockId: anchor.targetBlockId, status: "draft" }
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
  const section = "## 11.2｜2026-W43—W44（10.19—11.1）\n\n本范围周记包含已确认的具体经历与事实，覆盖两周。";

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

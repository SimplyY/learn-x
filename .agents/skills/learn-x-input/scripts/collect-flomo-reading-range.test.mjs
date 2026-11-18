import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { collectFlomoReadingRange } from "./collect-flomo-reading-range.mjs";
import { storeReadingBatch } from "../../learn-x-reading/scripts/store-reading.mjs";

async function prepareSnapshot(root, records, coverage = { status: "complete", expectedCount: records.length, observedCount: records.length, omittedCount: 0 }) {
  const storageRoot = path.join(root, "04_output/_dist/flomo-review/online-full");
  await mkdir(path.join(storageRoot, "snapshots"), { recursive: true, mode: 0o700 });
  await chmod(storageRoot, 0o700);
  const snapshot = {
    schemaVersion: 1,
    sourceMode: "flomo-online-full",
    snapshotId: "snapshot-1",
    capturedAt: "2026-11-16T02:26:21.641Z",
    totalCount: records.length,
    coverage,
    records,
  };
  const snapshotPath = path.join(storageRoot, "snapshots", "snapshot-1.json");
  await writeFile(snapshotPath, JSON.stringify(snapshot), { mode: 0o600 });
  await chmod(snapshotPath, 0o600);
  await writeFile(path.join(storageRoot, "storage-mode.json"), JSON.stringify({
    schemaVersion: 1,
    sourceMode: "flomo-online-full",
    activeSnapshotId: "snapshot-1",
    activeSnapshotPath: "snapshots/snapshot-1.json",
    activatedAt: "2026-11-16T02:26:22.000Z",
  }), { mode: 0o600 });
  return snapshot;
}

test("collects Flomo reading-tagged notes with Shanghai timestamps and stores them as Flomo records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-reading-"));
  try {
    const body = "#记录/读书笔记/《周期》\n\n周期的位置很重要。";
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    await prepareSnapshot(root, [
      {
        memoId: "memo-1",
        url: "https://v.flomoapp.com/mine/?memo_id=memo-1",
        createdAt: "2026-11-15T14:00:00.000Z",
        timeText: "2026-11-15 22:00",
        bodyHash: hash,
        tags: ["记录/读书笔记/《周期》"],
        body,
      },
      {
        memoId: "memo-2",
        url: "https://v.flomoapp.com/mine/?memo_id=memo-2",
        createdAt: "2026-11-14T01:00:00.000Z",
        timeText: "2026-11-14 09:00",
        bodyHash: createHash("sha256").update("没有标签", "utf8").digest("hex"),
        tags: ["记录/思考"],
        body: "没有标签",
      },
    ]);
    const payload = await collectFlomoReadingRange({ root, from: "2026-11-14", to: "2026-11-16", now: new Date("2026-11-16T10:00:00+08:00") });
    assert.equal(payload.complete, true);
    assert.equal(payload.counts.matchedRecords, 1);
    assert.equal(payload.books[0].title, "《周期》");
    assert.equal(payload.books[0].thoughts[0].date, "2026-11-15");
    assert.equal(payload.books[0].thoughts[0].timeText, "2026-11-15 22:00");
    const thought = payload.books[0].thoughts[0];
    const stored = await storeReadingBatch({
      batchId: "flomo-reading-test",
      source: "flomo",
      book: { title: payload.books[0].title, author: "", bookId: payload.books[0].bookId },
      entries: [{
        sourceId: thought.sourceId,
        sourceEvidence: thought.sourceEvidence,
        location: "Flomo",
        date: thought.date,
        time: thought.timeText,
        kind: "读书笔记",
        userThought: thought.content,
        status: "ready",
        visibility: "public",
      }],
    }, { root });
    assert.equal(stored.addedCount, 1);
    assert.equal(stored.publicReadbackVerified, true);
    const markdown = await import("node:fs/promises").then((fs) => fs.readFile(path.join(root, stored.publicPath), "utf8"));
    assert.match(markdown, /Flomo 读书笔记/);
    assert.match(markdown, /记录时间：2026-11-15 22:00（Asia\/Shanghai）/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed on body hash mismatch and incomplete snapshot coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-reading-gap-"));
  try {
    const body = "#记录/读书笔记\n\n错配内容。";
    await prepareSnapshot(root, [{
      memoId: "memo-bad",
      url: "https://v.flomoapp.com/mine/?memo_id=memo-bad",
      createdAt: "2026-11-15T14:00:00.000Z",
      timeText: "2026-11-15 22:00",
      bodyHash: "wrong-hash",
      tags: ["记录/读书笔记"],
      body,
    }], { status: "accepted-with-gaps", expectedCount: 2, observedCount: 1, omittedCount: 1, policy: "up-to-ten-unresolved-records-v1" });
    const payload = await collectFlomoReadingRange({ root, from: "2026-11-14", to: "2026-11-16", now: new Date("2026-11-16T10:00:00+08:00") });
    assert.equal(payload.complete, false);
    assert.equal(payload.counts.matchedRecords, 0);
    assert.ok(payload.errors.some((error) => error.reason.includes("flomo-body-hash-mismatch")));
    assert.ok(payload.errors.some((error) => error.reason.includes("flomo-coverage-incomplete")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

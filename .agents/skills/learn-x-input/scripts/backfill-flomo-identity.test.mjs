import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectFlomoIdentityBackfill, validateIdentityScan } from "./backfill-flomo-identity.mjs";
import { bodyHash } from "../../learn-x-flomo-review/scripts/catalog.mjs";

function scanFixture({ complete = true, lowerBoundCovered = true, week = "backfill", memos = [], scanned = memos.length, pageCount = 1 } = {}) {
  return { complete, lowerBoundCovered, week, scanned, pageCount, scanStartedAt: "2026-10-08T00:00:00.000Z", scanFinishedAt: "2026-10-08T00:00:01.000Z", memos };
}

const remoteMemo = () => ({ memoId: "REMOTE-ID", timeText: "2026-09-28 09:00", timeMs: Date.parse("2026-09-28T09:00:00+08:00"), bodyText: "历史正文保持原样。", bodyComplete: true });

test("backfill keeps only time, body hash and remote id", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "flomo-backfill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "03_input/_archives/flomo/identity-backfill.json");
  const result = await collectFlomoIdentityBackfill({ output, scan: async () => scanFixture({ memos: [remoteMemo()], scanned: 1 }) });
  const saved = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.identities, 1);
  assert.equal(saved.complete, true);
  assert.deepEqual(saved.identities, [{ memoId: "REMOTE-ID", timeMs: Date.parse("2026-09-28T09:00:00+08:00"), bodyHash: bodyHash("历史正文保持原样。") }]);
  assert.ok(!JSON.stringify(saved).includes("历史正文保持原样。"));
});

test("backfill rejects incomplete or conflicting remote identities", async () => {
  assert.throws(() => validateIdentityScan(scanFixture({ complete: false })), /flomo-backfill-scan-incomplete/);
  assert.throws(() => validateIdentityScan(scanFixture({ memos: [{ ...remoteMemo(), memoId: null }] })), /flomo-backfill-record-incomplete/);
  assert.throws(() => validateIdentityScan(scanFixture({ memos: [remoteMemo(), { ...remoteMemo(), bodyText: "不同正文" }] })), /flomo-backfill-identity-conflict/);
});

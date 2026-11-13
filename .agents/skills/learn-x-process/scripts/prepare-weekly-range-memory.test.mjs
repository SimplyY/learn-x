import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyWeeklyRangeMemory, prepareWeeklyRangeMemory } from "./prepare-weekly-range-memory.mjs";

const sha256 = value => createHash("sha256").update(String(value), "utf8").digest("hex");

async function prepareFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-range-memory-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const periodId = "2026-W40-W41";
  const outputDir = path.join(repoRoot, "04_output/_dist/weekly", periodId);
  const inputDir = path.join(repoRoot, "03_input/weekly", periodId);
  const memoryDir = path.join(repoRoot, "01_core/memory");
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(inputDir, { recursive: true }), mkdir(memoryDir, { recursive: true }), mkdir(path.join(repoRoot, "04_output/weekly"), { recursive: true })]);

  const rangeManifest = { period: { id: periodId, weeks: ["2026-W40", "2026-W41"], start: "2026-09-28", endInclusive: "2026-10-11" } };
  await writeFile(path.join(inputDir, "_range-manifest.json"), JSON.stringify(rangeManifest));
  const weeklyOutput = [
    `# ${periodId} Weekly Output`,
    "",
    "Coverage: 2026年9月28日—10月11日",
    "",
    "## 11. 全文核心重点纪要",
    "本周期的已审核核心总结。",
    "",
    "## 12. 芒格之魂的洞察",
    "本周期的已审核洞察。",
    ""
  ].join("\n");
  const weeklyPath = path.join(repoRoot, "04_output/weekly", periodId + ".md");
  await writeFile(weeklyPath, weeklyOutput);
  await writeFile(path.join(outputDir, "process-pack.md"), "Synthetic process pack metadata.");
  const targetPath = path.join(memoryDir, "2026-Q4.memory.md");
  await writeFile(targetPath, "# Memory\n\n### 芒格之魂手动洞察候选\n\n## Existing\n\n- Existing content\n");

  const reviewEvidence = {
    source: "official-codex-read-thread",
    periodId,
    weeklyOutputSha256: sha256(weeklyOutput),
    threadId: "thread-test",
    userMessageId: "review-message",
    userMessageSha256: "a".repeat(64)
  };
  const authorizationEvidence = {
    source: "official-codex-read-thread",
    periodId,
    threadId: "thread-test",
    userMessageId: "authorization-message",
    userMessageSha256: "b".repeat(64),
    authorizesAutomaticCloseout: true
  };
  return { repoRoot, periodId, outputDir, weeklyOutput, targetPath, reviewEvidence, authorizationEvidence };
}

test("range approval card binds automatic YWContext P1 sync and write receipt records missing-publisher state", async t => {
  const fixture = await prepareFixture(t);
  const prepared = await prepareWeeklyRangeMemory(fixture);
  const approval = JSON.parse(await readFile(prepared.approvalPath, "utf8"));
  const card = await readFile(prepared.cardPath, "utf8");
  assert.equal(approval.schemaVersion, 2);
  assert.equal(approval.scope.ywcontext.sourceId, "learn-x-memory-p1-content");
  assert.equal(approval.scope.ywcontext.contentMode, "full");
  assert.equal(Object.hasOwn(approval.scope, "ywnext"), false);
  assert.match(card, /自动 YWContext 同步尝试/);
  assert.doesNotMatch(card, /YW Next|ywnext/);

  const result = await applyWeeklyRangeMemory({
    periodId: fixture.periodId,
    fingerprint: prepared.fingerprint,
    authorizationEvidence: fixture.authorizationEvidence,
    ywContextExecutor: { execute: async () => ({ status: "pending" }), resolve: async () => ({ status: "not-applied" }) },
    repoRoot: fixture.repoRoot
  });
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.schemaVersion, 2);
  assert.deepEqual(receipt.ywcontextSync, {
    status: "pending",
    errorCode: "dynamic_ywcontext_sync_unavailable",
    sourceId: "learn-x-memory-p1-content",
    targetPath: "01_core/memory/2026-Q4.memory.md",
    sourceSha256: receipt.targetSha256
  });
  assert.equal(JSON.stringify(receipt).includes("本周期的已审核核心总结"), false);
});

test("range v1 approval is read-only and cannot be applied under the retired YWNext scope", async t => {
  const fixture = await prepareFixture(t);
  const prepared = await prepareWeeklyRangeMemory(fixture);
  const { fingerprint: _currentFingerprint, ...legacy } = JSON.parse(await readFile(prepared.approvalPath, "utf8"));
  legacy.schemaVersion = 1;
  const legacyFingerprint = sha256(JSON.stringify(legacy));
  await writeFile(prepared.approvalPath, JSON.stringify({ ...legacy, fingerprint: legacyFingerprint }, null, 2) + "\n");
  await assert.rejects(applyWeeklyRangeMemory({
    periodId: fixture.periodId,
    fingerprint: legacyFingerprint,
    authorizationEvidence: fixture.authorizationEvidence,
    repoRoot: fixture.repoRoot
  }), /legacy-scope-read-only/);
  assert.equal(await readFile(fixture.targetPath, "utf8"), "# Memory\n\n### 芒格之魂手动洞察候选\n\n## Existing\n\n- Existing content\n");
});

test("range Memory write automatically publishes the complete P1 batch and records a verified receipt", async t => {
  const fixture = await prepareFixture(t);
  const prepared = await prepareWeeklyRangeMemory(fixture);
  let calls = 0;
  const result = await applyWeeklyRangeMemory({
    periodId: fixture.periodId,
    fingerprint: prepared.fingerprint,
    authorizationEvidence: fixture.authorizationEvidence,
    repoRoot: fixture.repoRoot,
    ywContextExecutor: {
      execute: async (_item, batch, evidence) => {
        calls += 1;
        assert.equal(batch.reviewWeek, fixture.periodId);
        assert.deepEqual(batch.items.map(item => item.id), ["range-core-summary", "range-munger-insights"]);
        assert.equal(evidence.evidence.itemIds.length, 2);
        const sourceSha = evidence.evidence.sha256;
        return { ok: true, status: "verified", evidence: {
          schema: "yw-context-p1-publish-receipt/v1",
          source_id: "learn-x-memory-p1-content",
          source_revision: `${fixture.periodId}:${sourceSha}:${"a".repeat(64)}`,
          source_sha256: sourceSha,
          sourceSha256: sourceSha,
          targetPath: "01_core/memory/2026-Q4.memory.md",
          p1_record_count: 2,
          itemIds: ["range-core-summary", "range-munger-insights"],
          p1_records_sha256: "b".repeat(64),
          p1_bundle_sha256: "c".repeat(64),
          published_commit: "d".repeat(40),
          remote_readback_commit: "d".repeat(40),
          p2_remote_commit: "e".repeat(40),
          p2_batch_id: "learn-x-memory-test",
          batch_id: "learn-x-memory-p1-test",
        } };
      },
      resolve: async () => ({ status: "not-applied" }),
    },
  });
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(calls, 1);
  assert.equal(result.status, "written");
  assert.equal(receipt.ywcontextSync.status, "published_and_read_back");
  assert.equal(receipt.ywcontextSync.evidence.itemIds.length, 2);
});

test("range Memory retry resolves publication state before any apply attempt", async t => {
  const fixture = await prepareFixture(t);
  const prepared = await prepareWeeklyRangeMemory(fixture);
  let executeCalls = 0;
  let resolveCalls = 0;
  const executor = {
    execute: async (_item, _batch, evidence) => {
      executeCalls += 1;
      if (executeCalls === 1) return { status: "pending" };
      const sourceSha = evidence.evidence.sha256;
      return { ok: true, status: "verified", evidence: {
        schema: "yw-context-p1-publish-receipt/v1",
        source_id: "learn-x-memory-p1-content",
        source_revision: `${fixture.periodId}:${sourceSha}:${"a".repeat(64)}`,
        source_sha256: sourceSha,
        sourceSha256: sourceSha,
        targetPath: "01_core/memory/2026-Q4.memory.md",
        p1_record_count: 2,
        itemIds: ["range-core-summary", "range-munger-insights"],
        p1_records_sha256: "b".repeat(64),
        p1_bundle_sha256: "c".repeat(64),
        published_commit: "d".repeat(40),
        remote_readback_commit: "d".repeat(40),
        p2_remote_commit: "e".repeat(40),
        p2_batch_id: "learn-x-memory-test",
        batch_id: "learn-x-memory-p1-test",
      } };
    },
    resolve: async () => { resolveCalls += 1; return { status: "not-applied" }; },
  };
  const first = await applyWeeklyRangeMemory({
    periodId: fixture.periodId, fingerprint: prepared.fingerprint,
    authorizationEvidence: fixture.authorizationEvidence, repoRoot: fixture.repoRoot, ywContextExecutor: executor,
  });
  const firstTarget = await readFile(fixture.targetPath, "utf8");
  assert.equal(first.ywcontextSync.status, "pending");
  const retry = await applyWeeklyRangeMemory({
    periodId: fixture.periodId, fingerprint: prepared.fingerprint,
    authorizationEvidence: fixture.authorizationEvidence, repoRoot: fixture.repoRoot, ywContextExecutor: executor,
  });
  assert.equal(retry.status, "already-success");
  assert.equal(retry.ywcontextSync.status, "published_and_read_back");
  assert.equal(resolveCalls, 1);
  assert.equal(executeCalls, 2);
  assert.equal(await readFile(fixture.targetPath, "utf8"), firstTarget);
});

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

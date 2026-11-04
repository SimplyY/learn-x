import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importLearnXCandidate, listLearnXCandidates, prepareLearnXHandoff, readLearnXCandidate } from "./manual-handoff-adapter.mjs";
import { runBridgeCli } from "./generate-ai-review.mjs";

async function tempRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-handoff-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function options(repoRoot, overrides = {}) {
  return {
    repoRoot, callerLabel: "learn-x:weekly-ai", taskId: "weekly-ai:2026-W44",
    stage: "weekly-review", artifactId: "weekly-ai.md", inputVersion: "sha256:input-v1",
    originEventId: "learn-x-schedule:2026-W44", prompt: "保真 Prompt\n原样。",
    promptId: "learn-x.weekly-ai-review", promptAssets: [{ prompt_id: "learn-x.weekly-ai-review", prompt_revision: "rev-7" }],
    historyDependency: { required: false, completenessVerified: true, items: [] },
    expectedOutputFormat: "Markdown UTF-8", fullFlow: ["业务校验", "人工定稿", "归档"],
    continuationChoice: "continue-complete-workflow", ...overrides,
  };
}

test("freezes exact prompt bytes privately, imports a candidate and keeps source at user-asserted", async (t) => {
  const repoRoot = await tempRoot(t), input = options(repoRoot);
  const prepared = await prepareLearnXHandoff(input);
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.record.schema, "handoff/v1");
  assert.equal(prepared.record.callerLabel, input.callerLabel);
  assert.equal(prepared.record.promptIdentity.sha256, prepared.record.promptSha256);
  assert.equal(prepared.record.sourceRequirements.continuationChoice, input.continuationChoice);
  assert.deepEqual(await readFile(prepared.privatePaths.prompt), Buffer.from(input.prompt));
  assert.equal((await stat(prepared.privatePaths.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(prepared.privatePaths.prompt)).mode & 0o777, 0o600);

  const raw = Buffer.from("# AI 周回顾\n候选内容\n");
  const imported = await importLearnXCandidate({ repoRoot, handoffId: prepared.handoffId,
    eventId: "codex-task:reply-1", sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: raw });
  assert.equal(imported.status, "received");
  assert.equal(imported.candidate.evidenceLevel, "user-asserted");
  assert.equal(imported.candidate.intakeChannel, "codex");
  assert.deepEqual(imported.candidate.operatorBasis, { kind: "codex-user-message",
    referenceSha256: createHash("sha256").update("codex-task:reply-1").digest("hex") });
  assert.equal("businessStatus" in imported.candidate, false);
  const candidates = await listLearnXCandidates({ repoRoot, handoffId: prepared.handoffId });
  assert.equal(candidates.record.candidates.length, 1);
  const candidate = await readLearnXCandidate({ repoRoot, handoffId: prepared.handoffId, candidateId: imported.candidate.candidateId });
  assert.deepEqual(candidate.resultBytes, raw);
});

test("unverified ChatGPT history remains needs_review and does not create a package", async (t) => {
  const repoRoot = await tempRoot(t), input = options(repoRoot, {
    historyDependency: { required: true, completenessVerified: false, items: [], missing: ["历史资料导出"] },
  });
  const result = await prepareLearnXHandoff(input);
  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "history-materials-unverified");
  assert.deepEqual(result.missing, ["历史资料导出"]);
  await assert.rejects(stat(path.join(repoRoot, ".runtime", "manual-handoffs")), { code: "ENOENT" });
});

test("candidate recovery prunes unrelated expired handoff payloads", async (t) => {
  const repoRoot = await tempRoot(t);
  const expired = await prepareLearnXHandoff(options(repoRoot, { taskId: "weekly-ai:expired" }));
  const active = await prepareLearnXHandoff(options(repoRoot, { taskId: "weekly-ai:active" }));
  const manifestPath = path.join(expired.privatePaths.directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.expiresAt = "2000-01-01T00:00:00.000Z";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const status = await listLearnXCandidates({ repoRoot, handoffId: active.handoffId });
  assert.equal(status.status, "pending");
  await assert.rejects(readFile(expired.privatePaths.prompt), { code: "ENOENT" });
  assert.equal((await listLearnXCandidates({ repoRoot, handoffId: expired.handoffId })).status, "expired");
});

test("caller, binding and continuation metadata are mandatory", async (t) => {
  const repoRoot = await tempRoot(t);
  await assert.rejects(prepareLearnXHandoff(options(repoRoot, { callerLabel: "../../escape" })), /caller-not-allowed/);
  await assert.rejects(prepareLearnXHandoff(options(repoRoot, { continuationChoice: undefined })), /continuation-choice-required/);
});

test("default runner returns a durable manual package without starting the browser bridge", async (t) => {
  const repoRoot = await tempRoot(t);
  const result = await runBridgeCli("原样 Prompt\n完整输入", { manualHandoff: options(repoRoot) });
  assert.equal(result.result.status, "awaiting_manual");
  assert.equal(result.exit.code, 75);
  assert.equal(result.result.handoffId, result.result.manualHandoff.handoffId);
  assert.deepEqual(await readFile(result.result.manualHandoff.privatePaths.prompt), Buffer.from("原样 Prompt\n完整输入"));
});

test("rejected candidates stay recorded while a later corrected candidate can continue", async (t) => {
  const repoRoot = await tempRoot(t), handoff = options(repoRoot);
  const first = await runBridgeCli(handoff.prompt, { manualHandoff: handoff });
  const handoffId = first.result.handoffId;
  const rejected = await importLearnXCandidate({ repoRoot, handoffId, eventId: "codex-task:invalid-reply",
    sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: Buffer.from("格式错误的回填") });
  const rejectedDuplicate = await importLearnXCandidate({ repoRoot, handoffId, eventId: "codex-task:invalid-reply-duplicate",
    sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: Buffer.from("格式错误的回填") });
  assert.equal(rejectedDuplicate.candidate.status, "duplicate");
  assert.equal(rejectedDuplicate.candidate.duplicateOf, rejected.candidate.candidateId);
  const waiting = await runBridgeCli(handoff.prompt, { manualHandoff: {
    ...handoff, rejectedCandidateIds: [rejected.candidate.candidateId],
  } });
  assert.equal(waiting.result.status, "awaiting_manual");
  assert.equal(waiting.result.handoffId, handoffId);
  assert.equal(waiting.exit.code, 75);

  const correctedBytes = Buffer.from("修正后的完整 Markdown 候选");
  const corrected = await importLearnXCandidate({ repoRoot, handoffId, eventId: "codex-task:corrected-reply",
    sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: correctedBytes });
  const resumed = await runBridgeCli(handoff.prompt, { manualHandoff: {
    ...handoff, rejectedCandidateIds: [rejected.candidate.candidateId],
  } });
  assert.equal(resumed.result.status, "candidate_received");
  assert.equal(resumed.result.candidate.candidateId, corrected.candidate.candidateId);
  assert.deepEqual(resumed.result.resultBytes, correctedBytes);
  assert.equal(resumed.result.candidate.evidenceLevel, "user-asserted");
});

test("parallel candidates remain pending until an explicit candidate ID is selected", async (t) => {
  const repoRoot = await tempRoot(t), handoff = options(repoRoot);
  const first = await runBridgeCli(handoff.prompt, { manualHandoff: handoff });
  const handoffId = first.result.handoffId;
  const candidateA = await importLearnXCandidate({ repoRoot, handoffId, eventId: "codex-task:candidate-a",
    sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: Buffer.from("候选 A") });
  const candidateB = await importLearnXCandidate({ repoRoot, handoffId, eventId: "codex-task:candidate-b",
    sourceClaim: "用户声明此内容来自 ChatGPT", resultBytes: Buffer.from("候选 B") });

  const ambiguous = await runBridgeCli(handoff.prompt, { manualHandoff: handoff });
  assert.equal(ambiguous.result.status, "awaiting_manual");
  assert.equal(ambiguous.result.reason, "manual-candidate-selection-required");
  assert.deepEqual(ambiguous.result.candidateOptions.map((item) => item.candidateId).sort(),
    [candidateA.candidate.candidateId, candidateB.candidate.candidateId].sort());
  assert.equal(ambiguous.exit.code, 75);

  const invalidSelection = await runBridgeCli(handoff.prompt, { manualHandoff: { ...handoff, selectedCandidateId: "unknown" } });
  assert.equal(invalidSelection.result.status, "awaiting_manual");
  assert.equal(invalidSelection.result.reason, "manual-candidate-selection-invalid");

  const selected = await runBridgeCli(handoff.prompt, { manualHandoff: { ...handoff, selectedCandidateId: candidateB.candidate.candidateId } });
  assert.equal(selected.result.status, "candidate_received");
  assert.equal(selected.result.candidate.candidateId, candidateB.candidate.candidateId);
  assert.deepEqual(selected.result.resultBytes, Buffer.from("候选 B"));
});

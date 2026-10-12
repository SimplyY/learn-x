import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { findRecoveryProblems, queryRecoveryPlaybook, recordRecoveryIncident, recordManualRepair } from "./recovery-memory.mjs";

test("recovery memory rejects ISO week 53 when the year has only 52 weeks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-invalid-week-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(recordRecoveryIncident({ week: "2025-W53", sourceId: "daily", errorClass: "unknown-failure", outcome: "failed" }, { stateRoot: root }), /recovery-week-invalid/);
});

test("recovery incidents share one problem across layers and propose repeat fixes by ISO week", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const common = { sourceId: "weread", errorClass: "source-contract-mismatch", errorSignal: "SOURCE-CONTRACT-MISMATCH", outcome: "failed", eventType: "failure" };
  const first = await recordRecoveryIncident({ ...common, week: "2026-W40", layer: 1, attemptKind: "first", eventId: "event-1" }, { stateRoot: root });
  const second = await recordRecoveryIncident({ ...common, week: "2026-W41", layer: 2, attemptKind: "rescue", eventId: "event-2" }, { stateRoot: root });
  assert.equal(first.event.problemId, second.event.problemId);
  assert.equal(second.index.problems.length, 1);
  assert.deepEqual(second.index.problems[0].layers, [1, 2]);
  assert.equal(second.index.permanentRepairCandidates.length, 1);

  await recordManualRepair({
    week: "2026-W41", sourceId: "weread", symptom: "SOURCE-CONTRACT-MISMATCH", problemId: second.event.problemId,
    actionCode: "upgrade-official-skill", actionNote: "核验官方版本后升级",
    evidenceRef: "03_input/weekly/2026-W41/_source-status.json", verification: "verified"
  }, { stateRoot: root });
  const advice = await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH" }, { stateRoot: root });
  assert.equal(advice.status, "ready");
  assert.equal(advice.recommendations.length, 1);
  assert.equal((await queryRecoveryPlaybook({ sourceId: "weread" }, { stateRoot: root })).recommendations.length, 1);
  assert.equal(advice.recommendations[0].actionNote, "核验官方版本后升级");
  assert.match(await readFile(path.join(root, "recovery-incidents.jsonl"), "utf8"), /"layer":2/);
});

test("unknown failures are not merged and corrupt evidence disables recommendations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-unknown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const one = await recordRecoveryIncident({ week: "2026-W40", sourceId: "daily", errorClass: "unknown-failure", errorSignal: "UNKNOWN-FAILURE", outcome: "failed" }, { stateRoot: root });
  const two = await recordRecoveryIncident({ week: "2026-W40", sourceId: "daily", errorClass: "unknown-failure", errorSignal: "UNKNOWN-FAILURE", outcome: "failed" }, { stateRoot: root });
  assert.notEqual(one.event.problemId, two.event.problemId);

  await writeFile(path.join(root, "recovery-incidents.jsonl"), "{not-json\n", "utf8");
  const result = await queryRecoveryPlaybook({ sourceId: "daily" }, { stateRoot: root });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.recommendations, []);
});

test("same-run unknown failures share one problem across layers but separate runs stay isolated", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-unknown-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  let sameRunIndex;
  for (const layer of [1, 2, 3]) {
    const result = await recordRecoveryIncident({
      week: "2026-W41", runId: "same-run", sourceId: "daily", errorClass: "unknown-failure",
      errorSignal: "UNKNOWN-FAILURE", layer, outcome: "failed", eventType: "failure", eventId: `same-${layer}`
    }, { stateRoot: root });
    events.push(result.event);
    sameRunIndex = result.index;
  }
  assert.equal(new Set(events.map((event) => event.problemId)).size, 1);
  assert.equal(sameRunIndex.problems.length, 1);

  const separateRun = await recordRecoveryIncident({
    week: "2026-W41", runId: "different-run", sourceId: "daily", errorClass: "unknown-failure",
    errorSignal: "UNKNOWN-FAILURE", layer: 1, outcome: "failed", eventType: "failure", eventId: "different-run"
  }, { stateRoot: root });
  assert.notEqual(separateRun.event.problemId, events[0].problemId);
  assert.equal(separateRun.index.problems.length, 2);
});

test("event IDs make retries idempotent and concurrent writes preserve all events", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { week: "2026-W40", sourceId: "health", errorClass: "network-timeout", errorSignal: "COLLECTOR-TIMEOUT", outcome: "failed", eventType: "failure", eventId: "same-event" };
  const results = await Promise.all([
    recordRecoveryIncident(input, { stateRoot: root }),
    recordRecoveryIncident(input, { stateRoot: root }),
    recordRecoveryIncident({ ...input, eventId: "another-event" }, { stateRoot: root })
  ]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  const lines = (await readFile(path.join(root, "recovery-incidents.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(results.at(-1).index.problems.length, 1);
});

test("three layers in one execution count as one recurrence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-layers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const layer of [1, 2, 3]) {
    const result = await recordRecoveryIncident({
      week: "2026-W40", runId: "same-execution", sourceId: "calendar",
      errorClass: "network-timeout", errorSignal: "COLLECTOR-TIMEOUT", layer, outcome: "failed", eventType: "failure"
    }, { stateRoot: root });
    assert.equal(result.index.permanentRepairCandidates.length, 0);
  }
  const repeated = await recordRecoveryIncident({
    week: "2026-W40", runId: "second-execution", sourceId: "calendar",
    errorClass: "network-timeout", errorSignal: "COLLECTOR-TIMEOUT", layer: 2, outcome: "failed", eventType: "failure"
  }, { stateRoot: root });
  assert.equal(repeated.index.permanentRepairCandidates.length, 0);
  const third = await recordRecoveryIncident({
    week: "2026-W40", runId: "third-execution", sourceId: "calendar",
    errorClass: "network-timeout", errorSignal: "COLLECTOR-TIMEOUT", layer: 2, outcome: "failed", eventType: "failure"
  }, { stateRoot: root });
  assert.equal(third.index.permanentRepairCandidates.length, 1);
});

test("problem lookup returns one stable ID across a continuing failure's layers", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-problem-lookup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = [];
  for (const layer of [1, 2, 3]) {
    records.push(await recordRecoveryIncident({ week: "2026-W41", runId: "issue-run-1", sourceId: "health",
      errorClass: "source-contract-mismatch", errorSignal: "SOURCE-CONTRACT-MISMATCH", layer,
      outcome: layer === 1 ? "failed" : "inconclusive", eventType: "recovery" }, { stateRoot: root }));
  }
  const lookup = await findRecoveryProblems({ week: "2026-W41", sourceId: "health",
    errorSignal: "SOURCE-CONTRACT-MISMATCH", runId: "issue-run-1" }, { stateRoot: root });
  assert.equal(lookup.status, "ready");
  assert.equal(lookup.problems.length, 1);
  assert.equal(lookup.problems[0].problemId, records[0].event.problemId);
  assert.deepEqual(lookup.problems[0].layers, [1, 2, 3]);
  assert.deepEqual(await findRecoveryProblems({ week: "2026-W41", sourceId: "health",
    errorSignal: "SOURCE-CONTRACT-MISMATCH", runId: "issue-run-2" }, { stateRoot: root }), { status: "ready", problems: [] });
});

test("recovery evidence keeps bounded technical facts, filters old versions, and invalidates failed fixes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = {
    week: "2026-W41", sourceId: "weread", symptom: "SOURCE-CONTRACT-MISMATCH", sourceVersion: "2.4.1",
    actionCode: "upgrade-official-skill", actionNote: "按官方版本更新并复核目标周", evidenceRef: "03_input/weekly/2026-W41/_source-status.json",
    actionPreconditions: ["official-source-verified", "same-target-week", "not-a-real-precondition"],
    evidence: { sourceStatus: "failed", targetWeek: "2026-W41", sourceVersion: "2.4.1", expectedCount: 951, observedCount: 950,
      omittedCount: 1, artifactSha256: "a".repeat(64), privateText: "must-not-be-saved" },
    verification: "verified", rootCauseStatus: "confirmed"
  };
  const saved = await recordManualRepair(base, { stateRoot: root });
  assert.deepEqual(saved.event.evidence, {
    sourceStatus: "failed", targetWeek: "2026-W41", sourceVersion: "2.4.1", expectedCount: 951, observedCount: 950,
    omittedCount: 1, artifactSha256: "a".repeat(64)
  });
  assert.doesNotMatch(await readFile(path.join(root, "recovery-incidents.jsonl"), "utf8"), /must-not-be-saved/);
  const currentAdvice = await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH", sourceVersion: "2.4.1",
    satisfiedPreconditions: ["official-source-verified", "same-target-week"] }, { stateRoot: root });
  assert.equal(currentAdvice.recommendations.length, 1);
  assert.deepEqual(currentAdvice.recommendations[0].actionPreconditions, ["official-source-verified", "same-target-week"]);
  assert.equal((await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH", sourceVersion: "2.5.0" }, { stateRoot: root })).recommendations.length, 0);
  assert.equal((await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH" }, { stateRoot: root })).recommendations.length, 0);
  await recordManualRepair({ ...base, verification: "failed", rootCauseStatus: "unconfirmed", actionNote: "核验官方版本后升级" }, { stateRoot: root });
  assert.equal((await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH", sourceVersion: "2.4.1" }, { stateRoot: root })).recommendations.length, 0);
});

test("a failed manual repair invalidates the same stable action even when its note changes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-note-invalidation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = { week: "2026-W41", sourceId: "weread", symptom: "SOURCE-CONTRACT-MISMATCH",
    actionCode: "upgrade-official-skill", actionPreconditions: ["official-source-verified"],
    evidenceRef: "03_input/weekly/2026-W41/_source-status.json" };
  await recordManualRepair({ ...base, actionNote: "核验官方来源后升级", verification: "verified" }, { stateRoot: root });
  assert.equal((await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH",
    satisfiedPreconditions: ["official-source-verified"] }, { stateRoot: root })).recommendations.length, 1);
  await recordManualRepair({ ...base, actionNote: "升级后重读版本仍不一致", verification: "failed" }, { stateRoot: root });
  const refreshed = await queryRecoveryPlaybook({ sourceId: "weread", errorSignal: "SOURCE-CONTRACT-MISMATCH",
    satisfiedPreconditions: ["official-source-verified"] }, { stateRoot: root });
  assert.equal(refreshed.recommendations.length, 0);
  const index = JSON.parse(await readFile(path.join(root, "recovery-playbook.json"), "utf8"));
  assert.equal(index.experiences.length, 1);
  assert.equal(index.experiences[0].actionNote, "升级后重读版本仍不一致");
  assert.equal(index.experiences[0].validation, "invalidated");
});

test("unsafe repair notes are rejected and recurrence counts only independent run IDs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-safe-notes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = { week: "2026-W41", sourceId: "health", symptom: "SOURCE-UNAVAILABLE", actionCode: "manual-repair",
    evidenceRef: "03_input/weekly/2026-W41/_source-status.json", verification: "candidate" };
  await assert.rejects(recordManualRepair({ ...base, actionNote: "health 120/80" }, { stateRoot: root }), /recovery-action-note-not-safe/);
  await assert.rejects(recordManualRepair({ ...base, actionNote: "npm run secret-check" }, { stateRoot: root }), /recovery-action-note-not-safe/);
  await assert.rejects(recordManualRepair({ ...base, evidenceRef: "", verification: "verified" }, { stateRoot: root }), /recovery-verified-evidence-required/);
  for (let index = 0; index < 5; index += 1) {
    await recordManualRepair({ ...base, actionNote: "核验来源状态并重采", evidenceRef: "03_input/weekly/2026-W41/_source-status.json",
      verification: "failed", eventType: "manual-repair" }, { stateRoot: root });
  }
  const unbound = await recordRecoveryIncident({ week: "2026-W41", sourceId: "health", errorClass: "source-unavailable",
    errorSignal: "SOURCE-UNAVAILABLE", outcome: "failed", eventType: "failure", eventId: "failure-no-run-id" }, { stateRoot: root });
  assert.equal(unbound.index.permanentRepairCandidates.length, 0);
  const savedEvents = await readFile(path.join(root, "recovery-incidents.jsonl"), "utf8");
  assert.equal(savedEvents.includes("health 120/80"), false);
  assert.equal(savedEvents.includes("npm run secret-check"), false);
});

test("playbook recommendations require a matching layer and satisfied preconditions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-preconditions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordManualRepair({ week: "2026-W41", sourceId: "flomo", symptom: "SOURCE-CONTRACT-MISMATCH",
    actionCode: "verify-only", actionNote: "完整核验快照后重采", actionPreconditions: ["full-scan-stable"],
    evidenceRef: "03_input/weekly/2026-W41/_source-status.json", verification: "verified", layer: 2 }, { stateRoot: root });
  const base = { sourceId: "flomo", errorSignal: "SOURCE-CONTRACT-MISMATCH", layer: 2 };
  assert.equal((await queryRecoveryPlaybook(base, { stateRoot: root })).recommendations.length, 0);
  assert.equal((await queryRecoveryPlaybook({ ...base, layer: 3, satisfiedPreconditions: ["full-scan-stable"] }, { stateRoot: root })).recommendations.length, 0);
  assert.equal((await queryRecoveryPlaybook({ ...base, satisfiedPreconditions: ["full-scan-stable"] }, { stateRoot: root })).recommendations.length, 1);
});

test("a verified root repair closes its recurring prevention candidate", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-prevention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let result;
  for (const [week, runId] of [["2026-W40", "r1"], ["2026-W41", "r2"]]) {
    result = await recordRecoveryIncident({ week, runId, sourceId: "build-bot", errorClass: "source-contract-mismatch", errorSignal: "SOURCE-CONTRACT-MISMATCH", outcome: "failed", eventType: "failure" }, { stateRoot: root });
  }
  assert.equal(result.index.permanentRepairCandidates[0].status, "pending");
  const problemId = result.index.problems[0].problemId;
  const closed = await recordManualRepair({
    week: "2026-W41", sourceId: "build-bot", symptom: "SOURCE-CONTRACT-MISMATCH", problemId,
    eventType: "prevention", actionCode: "small-patch", actionNote: "按报告标题核验覆盖周并拒绝错周认领",
    actionPreconditions: ["same-target-week", "status-readback-valid"], verification: "verified", rootCauseStatus: "confirmed",
    evidenceRef: "test/build-week-coverage.test.mjs"
  }, { stateRoot: root });
  assert.equal(closed.index.permanentRepairCandidates[0].status, "verified");
  assert.equal(closed.index.problems[0].preventionStatus, "verified");
});

test("playbook queries are read-only and reject stale or missing indexes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-readonly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const absentRoot = path.join(root, "absent");
  assert.equal((await queryRecoveryPlaybook({ sourceId: "health" }, { stateRoot: absentRoot })).status, "empty");
  await assert.rejects(access(absentRoot), { code: "ENOENT" });

  await recordRecoveryIncident({ week: "2026-W41", sourceId: "health", errorClass: "network-timeout", outcome: "failed", eventId: "read-only-event" }, { stateRoot: root });
  const indexPath = path.join(root, "recovery-playbook.json");
  const original = await readFile(indexPath, "utf8");
  const stale = JSON.parse(original);
  stale.lastEventId = "older-event";
  await writeFile(indexPath, `${JSON.stringify(stale)}\n`, "utf8");
  const staleText = await readFile(indexPath, "utf8");
  assert.deepEqual(await queryRecoveryPlaybook({ sourceId: "health" }, { stateRoot: root }), {
    status: "unavailable", reason: "index-stale", recommendations: []
  });
  assert.equal(await readFile(indexPath, "utf8"), staleText);
  await assert.rejects(access(path.join(root, ".recovery-memory.lock")), { code: "ENOENT" });

  await unlink(indexPath);
  assert.deepEqual(await queryRecoveryPlaybook({ sourceId: "health" }, { stateRoot: root }), {
    status: "unavailable", reason: "index-rebuild-required", recommendations: []
  });
  await assert.rejects(access(path.join(root, ".recovery-memory.lock")), { code: "ENOENT" });
});

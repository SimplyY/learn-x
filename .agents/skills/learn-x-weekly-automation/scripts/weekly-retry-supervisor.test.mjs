import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canRetrySource, classifyOutcome, classifyWeeklyFailure, createWeeklyRetryState,
  readCurrentSourceOutcome, recordWeeklyStage, runConfiguredSource, runWeeklyRetrySupervisor
} from "./weekly-retry-supervisor.mjs";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { withLock } from "../../learn-x-flomo-review/scripts/review.mjs";
import { recordRecoveryIncident } from "./recovery-memory.mjs";

async function seedFailedSource(root, week, sourceId, overrides = {}) {
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  Object.assign(state.sources[sourceId], {
    status: "failed", attempts: 1, lastErrorClass: "source-version-mismatch",
    lastErrorSignal: "SOURCE-VERSION-MISMATCH", lastAttemptAt: "2026-10-01T00:00:00.000Z",
    lastEvidence: { sourceVersion: "1.0.0" },
    ...overrides
  });
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  return weekRoot;
}

test("classifies recoverable network faults separately from login, schema, and uncertain AI submissions", () => {
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET"), { errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET", { sourceId: "flomo" }), { errorClass: "network-transient", retryable: true, retryAfterMs: 10 * 60_000 });
  assert.equal(classifyWeeklyFailure("rate limit; retry-after=2400", { sourceId: "flomo" }).retryAfterMs, 40 * 60_000);
  assert.equal(classifyWeeklyFailure("flomo-weekly-snapshot-gap", { sourceId: "flomo" }).retryable, false);
  assert.deepEqual(classifyWeeklyFailure("flomo-weekly-timestamp-density-review-required", { sourceId: "flomo" }), {
    errorClass: "manual-review-required", retryable: false, retryAfterMs: 0
  });
  assert.equal(classifyWeeklyFailure("login expired").retryable, false);
  assert.equal(classifyWeeklyFailure("field contract mismatch").errorClass, "source-contract-mismatch");
  assert.deepEqual(classifyWeeklyFailure("weread-skill-upgrade-required: please upgrade"), {
    errorClass: "source-version-mismatch", retryable: false, retryAfterMs: 0
  });
  assert.deepEqual(classifyWeeklyFailure("review-locked-inspect-owner-before-recovery", { sourceId: "flomo" }), {
    errorClass: "review-store-lock-busy", retryable: true, retryAfterMs: 10 * 60_000
  });
  assert.equal(classifyWeeklyFailure("observer-window-ended", { sourceId: "ai" }).errorClass, "unknown-failure");
  assert.equal(classifyWeeklyFailure("ECONNRESET", { sourceId: "ai" }).retryable, true);
});

test("AI retries only a confirmed preflight network failure and observes uncertain submissions", () => {
  assert.deepEqual(classifyOutcome("ai", {
    status: "failed", error: "ECONNRESET", diagnostics: { rateLimitPhase: "preflight" }
  }), { status: "failed", errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "login-required", diagnostics: { rateLimitPhase: "preflight" }
  }).retryable, false);
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "field contract mismatch", diagnostics: { rateLimitPhase: "preflight" }
  }).errorClass, "source-contract-mismatch");
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "ECONNRESET", diagnostics: { rateLimitPhase: "submit" }
  }).status, "needs_review");
  assert.equal(classifyOutcome("ai", { status: "failed", error: "bridge-timeout" }).errorClass, "ai-submission-state-uncertain");
  assert.equal(classifyOutcome("ai", { status: "needs_review", error: "observer-window-ended" }).retryable, false);
});

test("preserves a fresh AI needs_review sidecar when the collector exits nonzero", async () => {
  const ai = WEEKLY_SOURCE_CONFIG.find((source) => source.id === "ai");
  const outcome = await runConfiguredSource(ai, {
    week: "2026-W40", repoRoot: process.cwd(),
    executeCommand: async () => { const error = new Error("exit 2"); error.code = 2; throw error; },
    readOutcome: async () => ({ status: "needs_review", error: "snapshot-mismatch", updatedAt: new Date(Date.now() + 1_000).toISOString() })
  });
  assert.equal(outcome.status, "needs_review");
  assert.equal(classifyOutcome("ai", outcome).status, "needs_review");
});

test("manual AI resubmission is explicitly scoped and runs once through the browser queue", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-manual-ai-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "manual", sourceId: "ai", resubmitUncertainAi: true, repoRoot: root,
    runSource: async (source, context) => { calls.push(source.id); assert.equal(context.resubmitUncertainAi, true); return { status: "confirmed" }; },
    readOutcome: async () => null
  });
  assert.deepEqual(calls, ["ai"]);
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(result.sources.ai.attempts, 2);
  await assert.rejects(() => runWeeklyRetrySupervisor({ week: "2026-W40", mode: "manual", sourceId: "ai", repoRoot: root }), /source-filter-only-supports/);
});

test("automatic AI recovery observes the original run before considering a resubmission", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-observe-ai-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const sidecar = path.join(weekRoot, "_ai-generated.json");
  await writeFile(sidecar, JSON.stringify({
    status: "needs_review", targetWeek: week, runId: "123e4567-e89b-42d3-a456-426614174000",
    conversationUrl: "https://chatgpt.com/c/ai-existing", reason: "observer-window-ended"
  }));
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 200_000,
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi });
      const current = JSON.parse(await readFile(sidecar, "utf8"));
      current.observation = { status: "needs_review", reason: "chatgpt-rate-limited", observedAt: new Date().toISOString() };
      await writeFile(sidecar, JSON.stringify(current));
      return { status: "needs_review", error: "chatgpt-rate-limited" };
    },
    readOutcome: async () => null
  });
  assert.deepEqual(calls, [{ observe: true, resubmit: false }]);
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(JSON.parse(await readFile(sidecar, "utf8")).observation.reason, "chatgpt-rate-limited");
});

test("migrates only untouched Health-X recheck-only state into the managed report collector", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-state-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.health.status = "recheck-only";
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; },
    readOutcome: async () => null, maxDurationMs: 1_000
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(calls, ["health"]);
  assert.equal(saved.sources.health.status, "succeeded");
  assert.ok(saved.diagnostics.some((item) => item.step === "source-management-migration" && item.sourceId === "health"));
});

test("recovery status carries the installed WeRead version for version-scoped playbook lookup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-recovery-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(weekRoot, "weread.md"), "# synthetic weekly reading input\n", "utf8");
  await updateWeeklySourceStatus({ weekRoot, week, source: "weread", status: "ready", file: "weread.md", count: 1,
    summary: "本周有阅读活动；Skill版本：2.4.1" });
  const outcome = await readCurrentSourceOutcome(WEEKLY_SOURCE_CONFIG.find((source) => source.id === "weread"), week, root);
  assert.equal(outcome.sourceVersion, "2.4.1");
});

test("layer-two WeRead recovery runs an explicit upgrade action and verifies the installed version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-recovery-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = await seedFailedSource(root, week, "weread");
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "upgrade-official-skill",
    expectedSourceVersion: "2.4.1", confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "weread-skill-upgrade-required", sourceVersion: "1.0.0" }),
    runSource: async (source, context) => {
      calls.push({ sourceId: source.id, actionCode: context.recoveryActionCode, expected: context.expectedSourceVersion });
      return { status: "ready", count: 1, sourceVersion: "2.4.1" };
    }
  });
  assert.deepEqual(calls, [{ sourceId: "weread", actionCode: "upgrade-official-skill", expected: "2.4.1" }]);
  assert.equal(result.sources.weread.status, "succeeded");
  assert.equal(result.sources.weread.recoveryActions[0].status, "succeeded");
  assert.equal(result.sources.weread.recoveryActions[0].sourceVersion, "1.0.0");
  const incidents = (await readFile(path.join(root, ".agents/skills/learn-x-weekly-automation/state/recovery-incidents.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(incidents.some((incident) => incident.layer === 2 && incident.actionCode === "upgrade-official-skill" && incident.outcome === "succeeded"));
  assert.ok(weekRoot.endsWith(week));
});

test("layer-two WeRead recovery rejects an unverifiable installed version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-recovery-version-mismatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  await seedFailedSource(root, week, "weread");
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "upgrade-official-skill",
    expectedSourceVersion: "2.4.1", confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "weread-skill-upgrade-required", sourceVersion: "1.0.0" }),
    runSource: async () => ({ status: "ready", count: 1, sourceVersion: "2.4.0" })
  });
  assert.equal(result.sources.weread.status, "failed");
  assert.equal(result.sources.weread.lastErrorClass, "source-version-mismatch");
  assert.equal(result.sources.weread.recoveryActions[0].status, "failed");
});

test("layer-two recovery validates scope, explicit confirmation, and the two-action budget", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-layer-two-guards-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  await seedFailedSource(root, week, "weread", { recoveryActions: [
    { actionCode: "verify-only", layer: 2, status: "failed" },
    { actionCode: "manual-repair", layer: 2, status: "failed" }
  ] });
  const base = { week, mode: "recovery", sourceId: "weread", repoRoot: root, maxDurationMs: 1_000,
    readOutcome: async () => ({ status: "failed", error: "weread-skill-upgrade-required" }),
    runSource: async () => assert.fail("a rejected recovery must not execute the collector") };
  await assert.rejects(runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "upgrade-official-skill",
    expectedSourceVersion: "2.4.1", confirmedRecovery: true }), /recovery-layer-two-budget-exhausted/);
  await assert.rejects(runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "unknown-action", confirmedRecovery: true }),
    /recovery-action-not-supported-for-source/);
  await assert.rejects(runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "verify-only" }), /recovery-action-requires-confirm/);
  await assert.rejects(runWeeklyRetrySupervisor({ ...base, sourceId: "ai", recoveryActionCode: "manual-repair", confirmedRecovery: true }),
    /recovery-mode-source-not-supported/);
});

test("layer-three source recheck requires an exact verified same-week patch receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-small-patch-recheck-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W41";
  await seedFailedSource(root, week, "health", { lastErrorClass: "source-contract-mismatch",
    lastErrorSignal: "SOURCE-CONTRACT-MISMATCH", lastEvidence: {} });
  await assert.rejects(runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "health", recoveryActionCode: "small-patch", problemId: "P-aaaaaaaaaaaaaaaa",
    confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "SOURCE-CONTRACT-MISMATCH" }),
    runSource: async () => assert.fail("small-patch recheck requires the guard's verified receipt")
  }), /recovery-layer-two-not-exhausted/);
});

test("layer-three patch recheck is allowed after two failed layer-two actions and a verified receipt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-small-patch-after-l2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W41";
  const problemId = "P-aaaaaaaaaaaaaaaa";
  const stateRoot = path.join(root, ".agents/skills/learn-x-weekly-automation/state");
  await seedFailedSource(root, week, "health", { lastErrorClass: "source-contract-mismatch",
    lastErrorSignal: "SOURCE-CONTRACT-MISMATCH", problemId, lastEvidence: {}, recoveryActions: [
      { actionCode: "verify-only", layer: 2, status: "failed" },
      { actionCode: "manual-repair", layer: 2, status: "inconclusive" }
    ] });
  await recordRecoveryIncident({
    eventId: "verified-patch-receipt", week, runId: "patch-run-1", sourceId: "health", problemId,
    errorClass: "source-contract-mismatch", errorSignal: "SOURCE-CONTRACT-MISMATCH", layer: 3,
    eventType: "recovery", attemptKind: "small-patch", actionCode: "small-patch", outcome: "verified",
    rootCauseStatus: "confirmed", verification: "verified", evidenceRef: `03_input/weekly/${week}/_source-status.json`,
    evidence: { phase: "validation", targetWeek: week, patchSha256: "a".repeat(64), baselineDigest: "b".repeat(64),
      resultDigest: "c".repeat(64), reviewerReceiptSha256: "d".repeat(64), changedFiles: [".agents/skills/test/scripts/fix.mjs"],
      patchFileCount: 1, addedLines: 1, deletedLines: 1, originalFailureObserved: true, originalFailureFixed: true,
      counterexampleBaselinePassed: true, counterexampleAfterPassed: true }
  }, { stateRoot });
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "health", recoveryActionCode: "small-patch", problemId,
    confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "SOURCE-CONTRACT-MISMATCH" }),
    runSource: async (source, context) => { calls.push({ sourceId: source.id, actionCode: context.recoveryActionCode }); return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(calls, [{ sourceId: "health", actionCode: "small-patch" }]);
  assert.equal(result.sources.health.recoveryActions.at(-1).status, "succeeded");
});

test("different recovery layers share one run identity for a continuing source failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-shared-problem-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W41";
  await seedFailedSource(root, week, "weread", { lastErrorClass: "source-contract-mismatch",
    lastErrorSignal: "SOURCE-CONTRACT-MISMATCH", lastEvidence: {} });
  const base = { week, mode: "recovery", sourceId: "weread", confirmedRecovery: true,
    repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "SOURCE-CONTRACT-MISMATCH" }),
    runSource: async () => ({ status: "failed", error: "SOURCE-CONTRACT-MISMATCH" }) };
  await runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "verify-only" });
  const second = await runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "manual-repair" });
  const events = (await readFile(path.join(root, ".agents/skills/learn-x-weekly-automation/state/recovery-incidents.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line)).filter((event) => event.outcome === "failed");
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map((event) => event.runId)).size, 1);
  assert.equal(second.sources.weread.problemRunId, events[0].runId);
  assert.equal(events[0].problemId, events[1].problemId);
});

test("different unknown errors stay separate while a repeated fingerprint keeps its problem identity", async (t) => {
  const runPair = async (errors) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-unknown-error-fingerprints-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const week = "2026-W41";
    await seedFailedSource(root, week, "weread", { lastErrorClass: "unknown-failure", lastErrorSignal: "unknown-failure", lastEvidence: {} });
    const base = { week, mode: "recovery", sourceId: "weread", confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
      readOutcome: async () => ({ status: "failed", error: "SOURCE-CONTRACT-MISMATCH" }),
      runSource: async () => ({ status: "failed", error: errors.shift() }) };
    await runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "verify-only" });
    await runWeeklyRetrySupervisor({ ...base, recoveryActionCode: "manual-repair" });
    return (await readFile(path.join(root, ".agents/skills/learn-x-weekly-automation/state/recovery-incidents.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line)).filter((event) => event.outcome === "failed");
  };
  const different = await runPair(["unclassified-alpha", "unclassified-beta"]);
  assert.equal(different.length, 2);
  assert.notEqual(different[0].errorSignal, different[1].errorSignal);
  assert.notEqual(different[0].runId, different[1].runId);
  assert.notEqual(different[0].problemId, different[1].problemId);
  assert.doesNotMatch(JSON.stringify(different), /unclassified-alpha|unclassified-beta/);

  const repeated = await runPair(["unclassified-alpha", "unclassified-alpha"]);
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].errorSignal, repeated[1].errorSignal);
  assert.equal(repeated[0].runId, repeated[1].runId);
  assert.equal(repeated[0].problemId, repeated[1].problemId);
});

test("weekly supervisor rejects a week 53 that does not exist in the requested ISO year", async () => {
  await assert.rejects(runWeeklyRetrySupervisor({ week: "2025-W53", mode: "manual", sourceId: "flomo" }), /invalid-week/);
});

test("weekly supervisor refuses a symlinked target week before writing its state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-supervisor-week-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "learn-x-supervisor-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "03_input"), { recursive: true });
  await symlink(outside, path.join(root, "03_input/weekly"));

  await assert.rejects(runWeeklyRetrySupervisor({ week: "2026-W41", mode: "manual", sourceId: "flomo", repoRoot: root }), /weekly-path-symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test("an interrupted recovery action is recorded inconclusive and never replayed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-interrupted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  await seedFailedSource(root, week, "weread", { recoveryActions: [
    { actionCode: "verify-only", layer: 2, runId: "previous-run", status: "running",
      at: "2026-10-01T00:00:00.000Z", evidenceRef: "03_input/weekly/2026-W40/_source-status.json" }
  ] });
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "manual-repair",
    confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "failed", error: "weread-skill-upgrade-required" }),
    runSource: async (source, context) => {
      calls.push(context.recoveryActionCode);
      return { status: "ready", count: 1 };
    }
  });
  assert.deepEqual(calls, ["manual-repair"]);
  assert.equal(result.sources.weread.recoveryActions[0].status, "inconclusive");
  assert.equal(result.sources.weread.recoveryActions[0].resultErrorClass, "process-interrupted");
  assert.equal(result.sources.weread.recoveryActions[1].status, "succeeded");
  const incidents = (await readFile(path.join(root, ".agents/skills/learn-x-weekly-automation/state/recovery-incidents.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(incidents.some((incident) => incident.runId === "previous-run" && incident.outcome === "inconclusive"));
  const statePath = path.join(root, "03_input/weekly", week, "_weekly-retry-state.json");
  const savedState = JSON.parse(await readFile(statePath, "utf8"));
  savedState.sources.weread.status = "failed";
  savedState.sources.weread.lastErrorClass = "source-version-mismatch";
  savedState.sources.weread.lastErrorSignal = "SOURCE-VERSION-MISMATCH";
  await writeFile(statePath, `${JSON.stringify(savedState)}\n`);
  await assert.rejects(runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "verify-only", confirmedRecovery: true,
    repoRoot: root, maxDurationMs: 1_000, readOutcome: async () => ({ status: "failed", error: "weread-skill-upgrade-required" }),
    runSource: async () => assert.fail("the interrupted action must not be replayed")
  }), /recovery-action-already-used/);
});

test("layer-two recovery rechecks an existing valid artifact before running its repair action", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-existing-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  await seedFailedSource(root, week, "weread");
  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "verify-only",
    confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "ready", count: 3, sourceVersion: "2.4.1", updatedAt: "2026-10-02T00:00:00.000Z" }),
    runSource: async () => { calls += 1; return { status: "ready", count: 3 }; }
  });
  assert.equal(calls, 0);
  assert.equal(result.result, "recovered-existing-result");
  assert.equal(result.sources.weread.status, "succeeded");
  assert.deepEqual(result.sources.weread.recoveryActions, []);
  const incidents = (await readFile(path.join(root, ".agents/skills/learn-x-weekly-automation/state/recovery-incidents.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(incidents.some((incident) => incident.actionCode === "reconcile-output" && incident.outcome === "succeeded"));
});

test("layer-two recovery does not accept a success sidecar older than the failed attempt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-stale-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  await seedFailedSource(root, week, "weread");
  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "recovery", sourceId: "weread", recoveryActionCode: "verify-only",
    confirmedRecovery: true, repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => ({ status: "ready", count: 3, sourceVersion: "1.0.0", updatedAt: "2026-09-30T00:00:00.000Z" }),
    runSource: async () => { calls += 1; return { status: "ready", count: 3, sourceVersion: "2.4.1" }; }
  });
  assert.equal(calls, 1);
  assert.equal(result.sources.weread.status, "succeeded");
});

test("records measured Stage 2 and Stage 3 card timings without storing content", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-stage-metrics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyStage({ week: "2026-W40", stage: "authorization_card", durationMs: 812, repoRoot: root });
  await recordWeeklyStage({ week: "2026-W40", stage: "memory_card", durationMs: 1_200, outcome: "failed", repoRoot: root });
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(state.diagnostics.map(({ step, durationMs, outcome }) => ({ step, durationMs, outcome })), [
    { step: "authorization_card", durationMs: 812, outcome: "success" },
    { step: "memory_card", durationMs: 1_200, outcome: "failed" }
  ]);
  assert.doesNotMatch(JSON.stringify(state.diagnostics), /Memory body|private-note|token/);
});

test("persists failed recovery-memory events for idempotent backfill on a later run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-memory-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W41";
  const statePath = path.join(root, "03_input/weekly", week, "_weekly-retry-state.json");
  const recoveryRoot = path.join(root, ".agents/skills/learn-x-weekly-automation/state");
  const incidentsPath = path.join(recoveryRoot, "recovery-incidents.jsonl");
  await mkdir(path.dirname(statePath), { recursive: true });
  const seededState = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) seededState.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  await writeFile(statePath, `${JSON.stringify(seededState)}\n`, "utf8");
  await mkdir(recoveryRoot, { recursive: true });
  await writeFile(incidentsPath, "{invalid-json\n", "utf8");
  const first = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => null,
    runSource: async () => ({ status: "failed", error: "synthetic unknown source failure" })
  });
  assert.equal(first.recoveryMemory.status, "partial");
  const failedState = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(failedState.pendingRecoveryEvents.length, 1);
  const pendingEventId = failedState.pendingRecoveryEvents[0].eventId;
  assert.doesNotMatch(JSON.stringify(failedState.pendingRecoveryEvents), /synthetic unknown source failure|prompt|token/i);

  await writeFile(incidentsPath, "", "utf8");
  let sourceCalls = 0;
  const retry = await runWeeklyRetrySupervisor({
    week, mode: "rescue", repoRoot: root, maxDurationMs: 5_000,
    readOutcome: async () => null,
    runSource: async () => { sourceCalls += 1; return { status: "failed", error: "must-not-run" }; }
  });
  assert.equal(sourceCalls, 0);
  assert.equal(retry.recoveryMemory.status, "ready");
  const recoveredState = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual(recoveredState.pendingRecoveryEvents, []);
  const savedEvents = (await readFile(incidentsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(savedEvents.length, 1);
  assert.equal(savedEvents[0].eventId, pendingEventId);
});

test("starts Wisdom Base in the CLI batch and imports Flomo reviews only after both sources succeed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-wisdom-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const events = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000, enableFlomoReviewImport: true,
    readOutcome: async () => null,
    runSource: async (source, context) => { calls.push({ id: source.id, queue: source.queue, allowFlomoReviewImport: context.allowFlomoReviewImport }); return { status: "ready", count: 1 }; },
    importFlomoReviews: async () => { calls.push({ id: "flomo-review-import" }); return { scanned: 2, candidates: 1, alreadyImported: 0, created: 1, skipped: 0 }; },
    onEvent: (event) => events.push(event),
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00")
  });
  const wisdomIndex = calls.findIndex((call) => call.id === "wisdom");
  const importIndex = calls.findIndex((call) => call.id === "flomo-review-import");
  assert.ok(wisdomIndex >= 0);
  assert.equal(calls[wisdomIndex].queue, "cli");
  assert.equal(calls[wisdomIndex].allowFlomoReviewImport, true);
  assert.ok(importIndex > wisdomIndex);
  assert.ok(events.findIndex((event) => event.step === "source-collection" && event.sourceId === "wisdom" && event.outcome === "succeeded")
    < events.findIndex((event) => event.step === "flomo-review-import" && event.outcome === "started"));
});

test("a failed Flomo source does not block Wisdom Base or trigger the optional review import", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-wisdom-independent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000, enableFlomoReviewImport: true,
    readOutcome: async () => null,
    runSource: async (source, context) => {
      calls.push({ id: source.id, queue: source.queue, allowFlomoReviewImport: context.allowFlomoReviewImport });
      return source.id === "flomo" ? { status: "failed", error: "flomo-weekly-snapshot-gap" } : { status: "ready", count: 1 };
    },
    importFlomoReviews: async () => assert.fail("review import must wait for a successful Flomo snapshot"),
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00")
  });
  const wisdom = calls.find((call) => call.id === "wisdom");
  assert.ok(wisdom, "Wisdom Gate Base collection starts independently of Flomo");
  assert.equal(wisdom.queue, "cli");
  assert.equal(wisdom.allowFlomoReviewImport, true, "Wisdom collection can run while the optional import checks Flomo state later");
  assert.equal(result.sources.wisdom.status, "succeeded");
});

test("a Flomo review import error is diagnostic and does not suppress the Wisdom Base collector", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-wisdom-import-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { "input:wisdom": "node scripts/collect.mjs" } }));
  await writeFile(path.join(root, "scripts/collect.mjs"), "");
  const dependencyEvents = [];
  let collectorRan = false;
  const outcome = await runConfiguredSource(WEEKLY_SOURCE_CONFIG.find((source) => source.id === "wisdom"), {
    week: "2026-W40", repoRoot: root, allowFlomoReviewImport: true,
    importFlomoReviews: async () => { throw new Error("field contract mismatch"); },
    onDependencyResult: async (event) => dependencyEvents.push(event),
    executeCommand: async () => { collectorRan = true; return { stdout: "" }; },
    readOutcome: async () => ({ status: "ready", count: 2, updatedAt: new Date(Date.now() + 1_000).toISOString() })
  });
  assert.equal(collectorRan, true);
  assert.equal(outcome.status, "ready");
  assert.equal(dependencyEvents[0].outcome, "failed");
  assert.equal(dependencyEvents[0].errorClass, "source-contract-mismatch");
  assert.doesNotMatch(JSON.stringify(dependencyEvents), /field contract mismatch/);
});

test("manual Flomo refresh uses the supervisor lock and attempt token without rerunning other sources", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-manual-flomo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"), readOutcome: async () => null,
    runSource: async (source, context) => {
      calls.push(source.id);
      assert.match(context.attemptToken, /^[0-9a-f-]{36}$/i);
      const guard = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_flomo-attempt.json"), "utf8"));
      assert.equal(guard.token, context.attemptToken);
      assert.equal(guard.active, true);
      return { status: "ready", count: 3, snapshotId: "snapshot-example", capturedAt: "2026-10-05T01:00:00.000Z",
        coverage: { expectedCount: 3, observedCount: 3, omittedCount: 0 }, termination: { reason: "library-count-and-stable-ids" } };
    }
  });
  const state = JSON.parse(await readFile(result.statePath, "utf8"));
  const guard = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_flomo-attempt.json"), "utf8"));
  assert.deepEqual(calls, ["flomo"]);
  assert.equal(result.sources.flomo.status, "succeeded");
  assert.equal(state.sources.flomo.lastSnapshot.snapshotId, "snapshot-example");
  assert.equal(state.sources.daily.attempts, 0);
  assert.equal(guard.active, false);
});

test("a busy review store lock makes Flomo guard begin retryable without starting the collector", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-guard-begin-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  let current = Date.parse("2026-10-05T05:00:00.000+08:00");
  let collectorStarted = false;

  await withLock(root, async () => {
    const result = await runWeeklyRetrySupervisor({
      week, mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 1_000,
      now: () => current, sleep: async (ms) => { current += ms; }, readOutcome: async () => null,
      runSource: async () => { collectorStarted = true; return { status: "ready", count: 1 }; }
    });
    assert.equal(result.sources.flomo.status, "failed");
    assert.equal(result.sources.flomo.lastErrorClass, "review-store-lock-busy");
    assert.equal(Date.parse(result.sources.flomo.nextRetryAt), current + 10 * 60_000);
  });

  assert.equal(collectorStarted, false);
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly", week, "_weekly-retry-state.json"), "utf8"));
  assert.equal(state.sources.flomo.status, "failed");
  assert.equal(state.sources.flomo.activeAttemptToken, null);
});

test("a busy review store lock during guard retirement becomes a scheduled Flomo retry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-guard-retire-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  let current = Date.parse("2026-10-05T05:00:00.000+08:00");
  let releaseLock;
  let lockHeld;
  let lockReady;
  lockHeld = new Promise((resolve) => { lockReady = resolve; });
  let holder;

  const result = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 1_000,
    now: () => current, sleep: async (ms) => { current += ms; }, readOutcome: async () => null,
    runSource: async () => {
      holder = withLock(root, async () => {
        await new Promise((resolve) => { releaseLock = resolve; lockReady(); });
      });
      await lockHeld;
      return { status: "ready", count: 1 };
    }
  });
  releaseLock();
  await holder;

  assert.equal(result.sources.flomo.status, "failed");
  assert.equal(result.sources.flomo.lastErrorClass, "review-store-lock-busy");
  assert.ok(Date.parse(result.sources.flomo.nextRetryAt) > current);
  const guard = JSON.parse(await readFile(path.join(weekRoot, "_flomo-attempt.json"), "utf8"));
  const state = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(guard.active, true);
  assert.equal(state.sources.flomo.activeAttemptToken, guard.token);
  assert.equal(state.sources.flomo.status, "failed");
});

test("manual Flomo refresh retries transient failure once after ten minutes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-manual-flomo-retries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T05:00:00.000+08:00");
  const waits = [], calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 100 * 60_000,
    now: () => current, sleep: async (ms) => { waits.push(ms); current += ms; }, readOutcome: async () => null,
    runSource: async (source, context) => {
      calls.push({ id: source.id, token: context.attemptToken });
      return calls.length < 2 ? { status: "failed", error: "ECONNRESET" } : { status: "ready", count: 1 };
    }
  });
  assert.deepEqual(waits, [10 * 60_000]);
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map((call) => call.token)).size, 2, "each retry receives a fresh attempt token");
  assert.equal(result.sources.flomo.status, "succeeded");
  assert.equal(result.sources.flomo.attempts, 2);

  const retryRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-manual-flomo-max-"));
  t.after(() => rm(retryRoot, { recursive: true, force: true }));
  current = Date.parse("2026-10-05T05:00:00.000+08:00");
  waits.length = 0;
  calls.length = 0;
  const exhausted = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "manual", sourceId: "flomo", repoRoot: retryRoot, maxDurationMs: 100 * 60_000,
    now: () => current, sleep: async (ms) => { waits.push(ms); current += ms; }, readOutcome: async () => null,
    runSource: async (source, context) => { calls.push(context.attemptToken); return { status: "failed", error: "ECONNRESET" }; }
  });
  assert.equal(calls.length, 2, "one initial manual attempt plus one first-layer retry");
  assert.deepEqual(waits, [10 * 60_000]);
  assert.equal(new Set(calls).size, 2);
  assert.equal(exhausted.sources.flomo.attempts, 2);
  assert.equal(exhausted.sources.flomo.status, "failed");
});

test("manual Flomo refresh does not bypass a persisted cooldown outside its bounded window", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-manual-flomo-cooldown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const current = Date.parse("2026-10-05T05:00:00.000+08:00");
  const state = createWeeklyRetryState("2026-W40");
  Object.assign(state.sources.flomo, { status: "failed", attempts: 1, lastErrorClass: "network-transient", nextRetryAt: new Date(current + 10 * 60_000).toISOString() });
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 60_000,
    now: () => current, readOutcome: async () => null,
    runSource: async () => assert.fail("the persisted ten-minute cooldown must not be bypassed")
  });
  assert.equal(result.sources.flomo.status, "failed");
  assert.equal(result.sources.flomo.attempts, 1);
  assert.ok(result.statePath);
  const saved = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.ok(saved.diagnostics.some((entry) => entry.outcome === "cooldown-exceeds-bounded-window"));
});

test("Flomo browser scans from different target weeks share one global queue", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-cross-week-flomo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let active = 0;
  let peak = 0;
  let releaseFirst;
  let firstEnteredResolve;
  const firstEntered = new Promise((resolve) => { firstEnteredResolve = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const run = (week) => runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    readOutcome: async () => null,
    runSource: async (source) => {
      active += 1;
      peak = Math.max(peak, active);
      if (week === "2026-W40") {
        firstEnteredResolve();
        await firstGate;
      }
      active -= 1;
      return { status: "ready", count: 1 };
    },
  });
  const first = run("2026-W40");
  await firstEntered;
  const second = run("2026-W41");
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(peak, 1, "separate weekly state locks must not run Flomo scans in parallel");
});

test("prepares the local input snapshot after each successful collection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-prepare-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const collected = [];
  const prepared = [];
  const events = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source) => { collected.push(source.id); return { status: "ready", count: 1 }; },
    prepareInputs: async (source) => { prepared.push(source.id); },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual([...prepared].sort(), [...collected].sort());
  assert.ok(events.some((event) => event.step === "weekly-preprocess" && event.sourceId === "daily" && event.outcome === "succeeded"));
});

test("preprocessing failure is diagnostic and does not relabel a successful source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-prepare-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async () => ({ status: "ready", count: 1 }),
    prepareInputs: async (source) => { if (source.id === "daily") throw new Error("candidate-version-mismatch"); }
  });

  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.equal(result.sources.daily.status, "succeeded");
  assert.ok(state.diagnostics.some((event) => event.step === "weekly-preprocess" && event.sourceId === "daily" && event.outcome === "failed"));
});

test("first-layer retry runs once after the 20-minute network cooldown", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-important-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T05:00:00.000+08:00");
  const waits = [];
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40",
    repoRoot: root,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async (source) => source.id === "daily" ? null : { status: "ready", count: 1 },
    runSource: async (source) => { calls.push(source.id); return { status: "failed", error: "ECONNRESET" }; },
    maxDurationMs: 2 * 60 * 60_000
  });
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(calls, ["daily", "daily"]);
  assert.deepEqual(waits, [20 * 60_000]);
  assert.equal(state.sources.daily.attempts, 2);
  assert.equal(state.sources.daily.status, "failed");
  assert.equal(state.sources.daily.sameErrorCount, 2);
  assert.equal(result.sources.daily.retries, 1);
});

test("does not retry successful empty sources or restart sources already marked successful", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-success-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40",
    repoRoot: root,
    runSource: async (source) => { calls.push(source.id); return { status: "failed", error: "ECONNRESET" }; },
    readOutcome: async () => ({ status: "empty", count: 0, summary: "complete query" }),
    now: () => Date.parse("2026-10-05T05:00:00Z"),
    sleep: async () => assert.fail("successful empty results must not wait or retry")
  });
  assert.deepEqual(calls, []);
});

test("07:00 rescue consumes one extra eligible attempt without resetting earlier retries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily,
    status: "failed", attempts: 2, retries: 1, lastErrorClass: "network-transient", lastErrorSignal: "EAI_AGAIN",
    nextRetryAt: "2026-10-05T07:00:00.000+08:00", rescueUsed: false
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:01:00.000+08:00"),
    runSource: async () => { calls += 1; return { status: "failed", error: "EAI_AGAIN" }; },
    readOutcome: async () => null
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(calls, 1);
  assert.equal(saved.sources.daily.attempts, 3);
  assert.equal(saved.sources.daily.rescueUsed, true);
  assert.equal(saved.sources.daily.status, "failed");
  assert.equal(canRetrySource(WEEKLY_SOURCE_CONFIG.find((item) => item.id === "daily"), saved.sources.daily, "rescue", Date.parse("2026-10-05T08:00:00+08:00")), false);
  assert.equal(result.mode, "rescue");
});

test("07:00 rescue runs a safe collector left pending by a bounded 05:00 run exactly once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.calendar = { ...state.sources.calendar, status: "pending", attempts: 0, rescueUsed: false };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(calls, ["calendar"]);
  assert.equal(result.sources.calendar.attempts, 1);
  assert.equal(result.sources.calendar.rescueUsed, true);
});

test("07:00 rescue collects Wisdom even when Flomo fails and marks both bounded starts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-wisdom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.flomo = { ...state.sources.flomo, status: "pending", attempts: 0, rescueUsed: false };
  state.sources.wisdom = { ...state.sources.wisdom, status: "pending", attempts: 0, rescueUsed: false };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source, context) => {
      calls.push({ id: source.id, allowFlomoReviewImport: context.allowFlomoReviewImport });
      return source.id === "flomo" ? { status: "failed", error: "flomo-weekly-snapshot-gap" } : { status: "ready", count: 1 };
    }
  });
  assert.deepEqual(calls.map((call) => call.id).sort(), ["flomo", "wisdom"]);
  assert.equal(calls.find((call) => call.id === "wisdom").allowFlomoReviewImport, false);
  assert.equal(result.sources.flomo.rescueUsed, true);
  assert.equal(result.sources.wisdom.rescueUsed, true);
  assert.equal(result.sources.wisdom.status, "succeeded");
});

test("07:00 rescue waits for the persisted nextRetryAt and respects its bounded window", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-cooldown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily, status: "failed", attempts: 5, retries: 4, rescueUsed: false,
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T07:10:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 20 * 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(waits, [10 * 60_000]);
  assert.equal(calls, 1);

  const lateRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-late-"));
  t.after(() => rm(lateRoot, { recursive: true, force: true }));
  const lateWeekRoot = path.join(lateRoot, "03_input/weekly/2026-W40");
  await mkdir(lateWeekRoot, { recursive: true });
  const lateState = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) lateState.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  lateState.sources.daily = {
    ...lateState.sources.daily, status: "failed", attempts: 5, rescueUsed: false,
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T08:00:00.000+08:00"
  };
  await writeFile(path.join(lateWeekRoot, "_weekly-retry-state.json"), `${JSON.stringify(lateState)}\n`);
  let lateNow = Date.parse("2026-10-05T07:00:00.000+08:00");
  let lateCalls = 0;
  const bounded = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: lateRoot, maxDurationMs: 20 * 60_000,
    now: () => lateNow,
    sleep: async (ms) => { lateNow += ms; },
    readOutcome: async () => null,
    runSource: async () => { lateCalls += 1; return { status: "ready", count: 1 }; }
  });
  const lateSaved = JSON.parse(await readFile(path.join(lateWeekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(lateCalls, 0);
  assert.equal(lateSaved.sources.daily.rescueUsed, false);
  assert.equal(bounded.sources.daily.nextRetryAt, "2026-10-05T08:00:00.000+08:00");
  assert.ok(lateSaved.diagnostics.some((event) => event.outcome === "bounded-window-ending" || event.outcome === "bounded-window-ended"));
});

test("07:00 rescue handles every eligible source as its own cooldown expires", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-staggered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  for (const [sourceId, minute] of [["daily", "10"], ["core", "15"]]) {
    state.sources[sourceId] = {
      ...state.sources[sourceId], status: "failed", attempts: 5, rescueUsed: false,
      lastErrorClass: "network-transient", nextRetryAt: `2026-10-05T07:${minute}:00.000+08:00`
    };
  }
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 20 * 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; }
  });

  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(waits, [10 * 60_000, 5 * 60_000]);
  assert.deepEqual(calls, ["daily", "core"]);
  assert.equal(saved.sources.daily.attempts, 6);
  assert.equal(saved.sources.core.attempts, 6);
  assert.equal(saved.sources.daily.rescueUsed, true);
  assert.equal(saved.sources.core.rescueUsed, true);
  assert.equal(result.sources.daily.status, "succeeded");
  assert.equal(result.sources.core.status, "succeeded");
});

test("rescue waits for a running initial invocation, then reads its persisted state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-active-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily, status: "failed", attempts: 1, lastErrorClass: "network-transient",
    nextRetryAt: "2026-10-05T07:00:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const lockPath = path.join(weekRoot, "_weekly-retry-state.lock");
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: "active-initial" }));
  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; await rm(lockPath, { force: true }); },
    readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(waits, [30_000]);
  assert.equal(calls, 1);
});

test("07:00 rescue ignores stale success sidecars and records only a diagnostic hypothesis", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-stale-sidecar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.wisdom = {
    ...state.sources.wisdom,
    status: "failed", attempts: 1, lastAttemptAt: "2026-10-05T06:30:00.000+08:00",
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T06:50:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const events = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async (source) => source.id === "wisdom"
      ? { status: "ready", count: 1, updatedAt: "2026-10-05T06:00:00.000+08:00" }
      : null,
    runSource: async () => {
      calls += 1;
      throw new Error("ECONNRESET private-note https://example.invalid/token");
    },
    onEvent: (event) => events.push(event)
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(calls, 1, "the stale ready sidecar must not suppress the eligible retry");
  assert.equal(saved.sources.wisdom.status, "failed");
  assert.equal(saved.sources.wisdom.attempts, 2);
  assert.equal(saved.sources.wisdom.rescueUsed, true);
  const failure = events.find((event) => event.step === "source-collection" && event.sourceId === "wisdom" && event.outcome === "failed");
  assert.equal(failure.rootCauseStatus, "unconfirmed");
  assert.equal(failure.hypothesis, "network-transient");
  assert.equal(failure.errorSignal, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(events), /private-note|example\.invalid|token/);
});

test("only one concurrent invocation reclaims a dead run lock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-lock-reaper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily,
    status: "failed", attempts: 1, lastAttemptAt: "2026-10-05T06:30:00.000+08:00",
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T06:50:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  await writeFile(path.join(weekRoot, "_weekly-retry-state.lock"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));

  let releaseSource;
  let enteredSource;
  const sourceEntered = new Promise((resolve) => { enteredSource = resolve; });
  const sourceBlocked = new Promise((resolve) => { releaseSource = resolve; });
  let calls = 0;
  const options = {
    week: "2026-W40", repoRoot: root, maxDurationMs: 60_000,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async () => { calls += 1; enteredSource(); await sourceBlocked; return { status: "ready", count: 1 }; }
  };
  const first = runWeeklyRetrySupervisor(options);
  await sourceEntered;
  const second = await runWeeklyRetrySupervisor({ ...options, runSource: async () => { calls += 100; return { status: "ready" }; } });
  assert.equal(second.skipped, "supervisor-already-running");
  releaseSource();
  const firstResult = await first;
  assert.equal(firstResult.sources.daily.status, "succeeded");
  assert.equal(calls, 1);
});

test("interrupted Flomo recovery schedules a retry when the review store lock is busy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-commit-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const token = "01234567-89ab-cdef-0123-456789abcdef";
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  state.sources.flomo.status = "running";
  state.sources.flomo.attempts = 1;
  state.sources.flomo.activeAttemptToken = token;
  state.sources.flomo.lastAttemptAt = "2026-10-05T05:00:00.000+08:00";
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const guardPath = path.join(weekRoot, "_flomo-attempt.json");
  const guard = { token, active: true, startedAt: state.sources.flomo.lastAttemptAt };
  await writeFile(guardPath, `${JSON.stringify(guard)}\n`);

  await withLock(root, async () => {
    const result = await runWeeklyRetrySupervisor({
      week, mode: "rescue", repoRoot: root, maxDurationMs: 0,
      now: () => Date.parse("2026-10-05T05:30:00.000+08:00"),
      readOutcome: async () => null,
      runSource: async () => assert.fail("recovery must not start a collector while the commit lock is held"),
    });
    assert.equal(result.sources.flomo.status, "failed");
    assert.equal(result.sources.flomo.lastErrorClass, "review-store-lock-busy");
    assert.ok(Date.parse(result.sources.flomo.nextRetryAt) > Date.parse("2026-10-05T05:30:00.000+08:00"));
    assert.deepEqual(JSON.parse(await readFile(guardPath, "utf8")), guard);
    const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
    assert.equal(saved.sources.flomo.activeAttemptToken, token);
  });
});

test("AI work interrupted with no confirmed result is observed as needs_review and never resubmitted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-ai-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "running";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let called = false;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00Z"),
    runSource: async () => { called = true; return { status: "success" }; },
    readOutcome: async () => null
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(called, false);
  assert.equal(saved.sources.ai.status, "needs_review");
  assert.equal(saved.sources.ai.lastErrorClass, "ai-submission-state-uncertain");
});

test("retry workers cap CLI concurrency at three and browser work at one", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    entry.status = source.collector ? "failed" : "manual-input";
    entry.attempts = 1;
    entry.lastErrorClass = "network-transient";
    entry.nextRetryAt = "2026-10-05T07:00:00.000Z";
  }
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const active = { cli: 0, browser: 0 };
  const peak = { cli: 0, browser: 0 };
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T08:00:00Z"),
    readOutcome: async () => null,
    runSource: async (source) => {
      active[source.queue] += 1;
      peak[source.queue] = Math.max(peak[source.queue], active[source.queue]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active[source.queue] -= 1;
      return { status: "failed", error: "schema contract mismatch" };
    }
  });
  assert.ok(peak.cli <= 3);
  assert.equal(peak.browser, 1);
});

test("the shared deadline prevents starting a collector after the budget is exhausted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-deadline-no-start-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 0,
    runSource: async () => assert.fail("no source may start after the common deadline"),
    readOutcome: async () => null,
    onEvent: (event) => events.push(event)
  });
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.equal(state.sources.daily.attempts, 0);
  assert.equal(result.sources.flomo.attempts, 0);
  assert.ok(events.some((event) => event.outcome === "skipped-deadline"));
});

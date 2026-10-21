import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canRetrySource, classifyOutcome, classifyWeeklyFailure, createWeeklyRetryState,
  parseArgs, readCurrentSourceOutcome, recordWeeklyStage, runConfiguredSource, runWeeklyRetrySupervisor
} from "./weekly-retry-supervisor.mjs";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { withLock } from "../../learn-x-flomo-review/scripts/review.mjs";
import { recordRecoveryIncident } from "./recovery-memory.mjs";
import { buildReviewPrompt, sha256 } from "./generate-ai-review.mjs";

const VALID_AI_REVIEW = "# Learn-X 周回顾\n\n## 具体的人和事（独立主线，优先保留）\n\n本周未发现可可靠提炼的具体人/事。\n\n## 本周议题\n\n真实判断\n\n## 精华议题摘要\n\n真实答案";

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

async function runOneShotWindowScenario(t, resolveAtMinute) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-second-window-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const templateDir = path.join(root, "03_input/weekly/00_template");
  await mkdir(weekRoot, { recursive: true });
  await mkdir(templateDir, { recursive: true });
  await writeFile(path.join(templateDir, "ai.md"), "# synthetic template", "utf8");
  const template = await readFile(path.join(templateDir, "ai.md"), "utf8");
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const originalRunId = "123e4567-e89b-42d3-a456-426614174334";
  const replacementRunId = "123e4567-e89b-42d3-a456-426614174335";
  const conversationUrl = `https://chatgpt.com/c/${originalRunId}`;
  const sidecar = path.join(weekRoot, "_ai-generated.json");
  let nowMs = Date.parse("2026-10-05T07:00:00Z");
  const originalDispatchAt = new Date(nowMs - 21 * 60_000).toISOString();
  await writeFile(sidecar, JSON.stringify({
    status: "needs_review", targetWeek: week, promptSha256: sha256(buildReviewPrompt(template, week)),
    runId: originalRunId, localAttemptId: originalRunId, dispatchStartedAt: originalDispatchAt, startedAt: originalDispatchAt,
    submissionConfirmed: true, requestedConversationUrl: "https://chatgpt.com/", actualConversationUrl: conversationUrl,
    conversationUrl, reason: "observer-window-ended", manualPrompt: "Complete synthetic manual prompt"
  }));
  const calls = [];
  const readOutcome = async () => {
    const current = JSON.parse(await readFile(sidecar, "utf8"));
    return { status: current.status, error: current.reason, updatedAt: current.completedAt || current.dispatchStartedAt };
  };
  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 45 * 60_000,
    now: () => nowMs,
    sleep: async (ms) => { nowMs += Math.max(ms, 60_000); },
    readOutcome,
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi, token: context.weeklyAiLockToken });
      const current = JSON.parse(await readFile(sidecar, "utf8"));
      if (context.resubmitUncertainAi) {
        current.status = "needs_review";
        current.runId = replacementRunId;
        current.localAttemptId = replacementRunId;
        current.dispatchStartedAt = new Date(nowMs).toISOString();
        current.resubmissionCount = 1;
        current.resubmissionOf = { runId: originalRunId };
        current.reason = "observer-window-ended";
        await writeFile(sidecar, JSON.stringify(current));
        return { status: "needs_review", error: "observer-window-ended" };
      }
      if (context.observeUncertainAi && current.resubmissionCount === 1) {
        const elapsed = nowMs - Date.parse(current.dispatchStartedAt);
        if (resolveAtMinute != null && elapsed >= resolveAtMinute * 60_000) {
          current.status = "confirmed";
          current.completedAt = new Date(nowMs).toISOString();
          current.outputSha256 = sha256(VALID_AI_REVIEW);
          current.readbackSha256 = current.outputSha256;
          current.reason = undefined;
          await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");
          await writeFile(sidecar, JSON.stringify(current));
          return { status: "confirmed" };
        }
        current.observation = { status: "needs_review", runId: replacementRunId, reason: "original-run-result-pending", observedAt: new Date(nowMs).toISOString() };
        await writeFile(sidecar, JSON.stringify(current));
        return { status: "needs_review", error: "original-run-result-pending" };
      }
      current.observation = { status: "needs_review", runId: originalRunId, reason: "original-run-result-pending", observedAt: new Date(nowMs).toISOString() };
      await writeFile(sidecar, JSON.stringify(current));
      return { status: "needs_review", error: "original-run-result-pending" };
    }
  });
  return { result, calls, sidecar, now: () => nowMs, replacementRunId };
}

async function runFreshUncertainAiScenario(t, { maxDurationMs = 60 * 60_000, lateOriginal = false, humanDuringWait = false,
  duringWait, duringReplacementWait, interruptDuringWait = false, terminalReplacementReason, replacementImmediateStatus } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-invocation-deadline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const templateDir = path.join(root, "03_input/weekly/00_template");
  const browserQueuePath = path.join(root, "03_input/weekly/.browser-queue.lock");
  await mkdir(weekRoot, { recursive: true });
  await mkdir(templateDir, { recursive: true });
  await writeFile(path.join(templateDir, "ai.md"), "# synthetic template", "utf8");
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "pending";
  state.sources.ai.attempts = 0;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const originalRunId = "123e4567-e89b-42d3-a456-426614174336";
  const replacementRunId = "123e4567-e89b-42d3-a456-426614174337";
  const conversationUrl = `https://chatgpt.com/c/${originalRunId}`;
  const sidecar = path.join(weekRoot, "_ai-generated.json");
  let nowMs = Date.parse("2026-10-05T07:00:00Z");
  let originalDispatchAt;
  const calls = [];
  const sleeps = [];
  const events = [];
  let waitResult;
  let result;
  let error;
  try { result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs,
    now: () => nowMs,
    sleep: async (ms) => {
      sleeps.push(ms);
      assert.equal(await readFile(browserQueuePath, "utf8").then(() => true, () => false), false,
        "the timed wait never holds the Browser queue");
      nowMs += ms;
      if (duringWait && ms > 10 * 60_000 && !waitResult) waitResult = await duringWait({ root, week, weekRoot });
      const current = await readFile(sidecar, "utf8").then((value) => JSON.parse(value), () => null);
      if (duringReplacementWait && current?.resubmissionCount === 1 && ms > 10 * 60_000 && !waitResult) {
        waitResult = await duringReplacementWait({ root, week, weekRoot });
      }
      const interruptReplacement = interruptDuringWait === "replacement" && current?.resubmissionCount === 1;
      const interruptOriginal = interruptDuringWait === true && current?.resubmissionCount !== 1;
      if ((interruptReplacement || interruptOriginal) && ms > 10 * 60_000) throw new Error("synthetic-process-interruption");
      if (humanDuringWait && ms > 10 * 60_000) await writeFile(path.join(weekRoot, "ai.md"), "# 用户人工周记\n保留这段正文。\n", "utf8");
    },
    readOutcome: async () => {
      const current = JSON.parse(await readFile(sidecar, "utf8"));
      return { status: current.status, error: current.reason || "", updatedAt: current.observation?.observedAt || current.completedAt || current.dispatchStartedAt };
    },
    onEvent: (event) => events.push(event),
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi,
        automatic: context.automaticResubmit, at: nowMs });
      if (!context.observeUncertainAi && !context.resubmitUncertainAi) {
        originalDispatchAt = new Date(nowMs).toISOString();
        nowMs += 4 * 60_000;
        await writeFile(sidecar, JSON.stringify({
          status: "needs_review", targetWeek: week, promptSha256: sha256(buildReviewPrompt("# synthetic template", week)),
          runId: originalRunId, localAttemptId: originalRunId, dispatchStartedAt: originalDispatchAt, startedAt: originalDispatchAt,
          submissionConfirmed: true, requestedConversationUrl: "https://chatgpt.com/", actualConversationUrl: conversationUrl,
          conversationUrl, reason: "observer-window-ended", manualPrompt: "Complete synthetic manual prompt"
        }));
        return { status: "needs_review", error: "observer-window-ended" };
      }
      const current = JSON.parse(await readFile(sidecar, "utf8"));
      if (context.resubmitUncertainAi) {
        const retryState = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
        assert.equal(retryState.sources.ai.resubmissionParentRunId, originalRunId,
          "the expected parent is durable before the replacement dispatch begins");
        assert.ok(Date.parse(retryState.sources.ai.resubmissionReservedAt));
        current.status = replacementImmediateStatus || "needs_review";
        current.runId = replacementRunId;
        current.localAttemptId = replacementRunId;
        current.dispatchStartedAt = new Date(nowMs).toISOString();
        current.resubmissionCount = 1;
        current.resubmissionOf = { runId: originalRunId, dispatchStartedAt: originalDispatchAt, reason: "observer-window-ended" };
        current.reason = terminalReplacementReason || "observer-window-ended";
        current.actualConversationUrl = `https://chatgpt.com/c/${replacementRunId}`;
        current.conversationUrl = current.actualConversationUrl;
        if (["generated", "confirmed"].includes(replacementImmediateStatus)) {
          current.outputSha256 = sha256(VALID_AI_REVIEW);
          if (replacementImmediateStatus === "confirmed") {
            current.readbackSha256 = current.outputSha256;
            current.completedAt = new Date(nowMs).toISOString();
            delete current.reason;
            await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");
          } else {
            await writeFile(path.join(weekRoot, "ai.generated.md"), `${VALID_AI_REVIEW}\n`, "utf8");
          }
        }
        await writeFile(sidecar, JSON.stringify(current));
        return { status: current.status, error: current.reason };
      }
      if (nowMs >= Date.parse(originalDispatchAt) + 20 * 60_000 && lateOriginal && current.resubmissionCount !== 1) {
        current.status = "confirmed";
        current.completedAt = new Date(nowMs).toISOString();
        delete current.reason;
        delete current.observation;
        await writeFile(sidecar, JSON.stringify(current));
        return { status: "confirmed" };
      }
      const observedRunId = current.resubmissionCount === 1 ? replacementRunId : originalRunId;
      current.observation = { status: "needs_review", runId: observedRunId,
        reason: "original-run-result-pending", submissionConfirmed: true,
        actualConversationUrl: `https://chatgpt.com/c/${observedRunId}`, observedAt: new Date(nowMs).toISOString() };
      await writeFile(sidecar, JSON.stringify(current));
      return { status: "needs_review", error: "original-run-result-pending" };
    }
  }); } catch (caught) { error = caught; }
  return { result, error, calls, sleeps, events, sidecar, weekRoot, root, waitResult, now: () => nowMs, originalRunId, replacementRunId };
}

test("classifies recoverable network faults separately from login, schema, and uncertain AI submissions", () => {
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET"), { errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET", { sourceId: "flomo" }), { errorClass: "network-transient", retryable: true, retryAfterMs: 10 * 60_000 });
  assert.equal(classifyWeeklyFailure("rate limit; retry-after=2400", { sourceId: "flomo" }).retryAfterMs, 40 * 60_000);
  assert.equal(classifyWeeklyFailure("rate limit; Retry-After: Mon, 26 Oct 2026 00:50:00 GMT", {
    sourceId: "flomo", now: Date.parse("2026-10-26T00:10:00.000Z")
  }).retryAfterMs, 40 * 60_000);
  assert.equal(classifyWeeklyFailure("flomo-weekly-snapshot-gap", { sourceId: "flomo" }).retryable, false);
  assert.deepEqual(classifyWeeklyFailure("flomo-weekly-timestamp-density-review-required", { sourceId: "flomo" }), {
    errorClass: "manual-review-required", retryable: false, retryAfterMs: 0
  });
  assert.equal(classifyWeeklyFailure("login expired").retryable, false);
  assert.deepEqual(classifyWeeklyFailure("operation not permitted", { sourceId: "flomo", code: "EPERM" }), {
    errorClass: "local-execution-permission-denied", retryable: false, retryAfterMs: 0,
  });
  assert.equal(classifyWeeklyFailure("field contract mismatch").errorClass, "source-contract-mismatch");
  assert.deepEqual(classifyWeeklyFailure("Flomo 全量快照同步失败（ego-detail-body-mismatch stage=verify-longest-detail）：scan-integrity-check-failed", { sourceId: "flomo" }), {
    errorClass: "source-integrity-failed", retryable: false, retryAfterMs: 0,
  });
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

test("automatic weekly AI recovery reopens at most once after twenty minutes with confirmed same-run identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-ai-20m-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const templateDir = path.join(root, "03_input/weekly/00_template");
  await mkdir(weekRoot, { recursive: true });
  await mkdir(templateDir, { recursive: true });
  await writeFile(path.join(templateDir, "ai.md"), "# synthetic template", "utf8");
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const template = await readFile(path.join(templateDir, "ai.md"), "utf8");
  const runId = "123e4567-e89b-42d3-a456-426614174333";
  const nowMs = Date.parse("2026-10-05T07:00:00Z");
  const dispatchStartedAt = new Date(nowMs - 21 * 60_000).toISOString();
  const conversationUrl = `https://chatgpt.com/c/${runId}`;
  const sidecar = path.join(weekRoot, "_ai-generated.json");
  await writeFile(sidecar, JSON.stringify({
    status: "needs_review", targetWeek: week, promptSha256: sha256(buildReviewPrompt(template, week)), runId, localAttemptId: runId,
    dispatchStartedAt, startedAt: dispatchStartedAt, submissionConfirmed: true, requestedConversationUrl: "https://chatgpt.com/",
    actualConversationUrl: conversationUrl, conversationUrl, reason: "observer-window-ended"
  }));
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 30 * 60_000, now: () => nowMs,
    readOutcome: async () => null,
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi, automatic: context.automaticResubmit });
      const current = JSON.parse(await readFile(sidecar, "utf8"));
      if (context.observeUncertainAi) {
        current.observation = { status: "needs_review", runId, reason: "original-run-result-pending", submissionConfirmed: true,
          actualConversationUrl: conversationUrl, observedAt: new Date(nowMs).toISOString() };
        await writeFile(sidecar, JSON.stringify(current));
        return { status: "needs_review", error: "original-run-result-pending" };
      }
      assert.equal(context.resubmitUncertainAi, true);
      const replacementRunId = "123e4567-e89b-42d3-a456-426614174338";
      current.status = "confirmed";
      current.runId = replacementRunId;
      current.localAttemptId = replacementRunId;
      current.dispatchStartedAt = new Date(nowMs).toISOString();
      current.resubmissionCount = 1;
      current.resubmissionOf = { runId, dispatchStartedAt, reason: "observer-window-ended" };
      current.outputSha256 = sha256(VALID_AI_REVIEW);
      current.readbackSha256 = current.outputSha256;
      current.completedAt = new Date(nowMs).toISOString();
      current.conversationUrl = `https://chatgpt.com/c/${replacementRunId}`;
      current.actualConversationUrl = current.conversationUrl;
      await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");
      await writeFile(sidecar, JSON.stringify(current));
      return { status: "confirmed" };
    }
  });
  assert.deepEqual(calls, [
    { observe: true, resubmit: false, automatic: false },
    { observe: false, resubmit: true, automatic: true },
  ]);
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(JSON.parse(await readFile(sidecar, "utf8")).resubmissionCount, 1);
});

test("the one-shot replacement is observed through its own twenty-minute window and accepts a late result", async (t) => {
  const { result, calls, sidecar, now, replacementRunId } = await runOneShotWindowScenario(t, 19);
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(finalSidecar.status, "confirmed");
  assert.equal(finalSidecar.runId, replacementRunId);
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.ok(now() - Date.parse(finalSidecar.dispatchStartedAt) >= 19 * 60_000);
  assert.equal(calls.filter((call) => call.resubmit).length, 1);
  assert.ok(calls.filter((call) => call.observe).length >= 2, "observe original and replacement runs separately");
  assert.ok(calls.every((call) => typeof call.token === "string"), "the outer business lock remains held across observations");
});

test("the one-shot replacement returns the full manual prompt after its second twenty-minute window", async (t) => {
  const { result, calls, sidecar, replacementRunId } = await runOneShotWindowScenario(t, null);
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(finalSidecar.runId, replacementRunId);
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.equal(calls.filter((call) => call.resubmit).length, 1);
  assert.equal(calls.filter((call) => call.observe).length, 2, "observe the original once, then the replacement at its deadline");
});

test("a known terminal replacement reason skips its remaining wait and preserves the manual prompt", async (t) => {
  const { result, calls, sleeps, events, sidecar } = await runFreshUncertainAiScenario(t, {
    terminalReplacementReason: "login-required"
  });
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.equal(calls.filter((call) => call.resubmit).length, 1);
  assert.equal(calls.filter((call) => call.observe).length, 2, "no replacement boundary observation follows a login block");
  assert.equal(sleeps.filter((ms) => ms > 10 * 60_000).length, 1, "only the original run's required boundary wait occurs");
  assert.ok(events.some((event) => event.outcome === "stopped-terminal-reason" && event.reasonCode === "login-required"));
});

test("a fresh uncertain weekly AI run waits once to its twenty-minute boundary and accepts the late original result", async (t) => {
  const { result, calls, sleeps, events, sidecar, now, originalRunId } = await runFreshUncertainAiScenario(t, { lateOriginal: true });
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(finalSidecar.status, "confirmed");
  assert.equal(finalSidecar.runId, originalRunId);
  assert.equal(calls.filter((call) => !call.observe && !call.resubmit).length, 1, "one initial submission");
  assert.equal(calls.filter((call) => call.resubmit).length, 0, "a late original result prevents replacement submission");
  assert.equal(sleeps.filter((ms) => ms > 10 * 60_000).length, 1, "one deadline wait, without polling");
  assert.equal(now(), Date.parse(finalSidecar.dispatchStartedAt) + 20 * 60_000);
  assert.ok(events.some((event) => event.outcome === "waiting-for-20m-deadline"));
  assert.ok(events.some((event) => event.outcome === "late-original-result"));
});

test("a fresh uncertain weekly AI run reserves at most one replacement after re-observing the original", async (t) => {
  const { result, calls, sleeps, sidecar, now, originalRunId, replacementRunId } = await runFreshUncertainAiScenario(t);
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(finalSidecar.runId, replacementRunId);
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.equal(finalSidecar.resubmissionOf.runId, originalRunId);
  assert.equal(calls.filter((call) => !call.observe && !call.resubmit).length, 1, "one initial submission");
  assert.equal(calls.filter((call) => call.resubmit).length, 1, "one reserved replacement submission");
  assert.ok(calls.some((call) => call.observe && call.at >= Date.parse(finalSidecar.resubmissionOf.dispatchStartedAt) + 20 * 60_000),
    "the original run was re-observed at the eligibility boundary");
  assert.ok(now() >= Date.parse(finalSidecar.dispatchStartedAt) + 20 * 60_000, "replacement receives its own observation window");
});

test("the twenty-minute AI wait releases the weekly state lock and merges concurrent stage and manual Flomo results", async (t) => {
  const { result, events, weekRoot, waitResult } = await runFreshUncertainAiScenario(t, {
    duringWait: async ({ root: repoRoot, week }) => {
      const stage = await recordWeeklyStage({ week, stage: "preprocess", durationMs: 1234, repoRoot });
      const manual = await runWeeklyRetrySupervisor({
        week, mode: "manual", sourceId: "flomo", repoRoot, now: () => Date.parse("2026-10-05T07:10:00Z"),
        readOutcome: async () => null, runSource: async () => ({ status: "ready", count: 2 })
      });
      return { stage, manual };
    }
  });
  assert.equal(waitResult.stage.skipped, undefined, "stage recording succeeds during the AI deadline wait");
  assert.equal(waitResult.manual.skipped, undefined, "manual Flomo is no longer blocked by the AI wait");
  assert.equal(waitResult.manual.sources.flomo.status, "succeeded");
  assert.equal(result.sources.ai.status, "needs_review");
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(saved.sources.flomo.status, "succeeded", "resuming AI observation does not overwrite the concurrent Flomo result");
  assert.ok(saved.diagnostics.some((entry) => entry.step === "preprocess"), "concurrent stage evidence survives the AI resume");
  assert.ok(events.some((entry) => entry.outcome === "released-for-ai-deadline-wait" && entry.waitPhase === "original"));
  assert.ok(events.some((entry) => entry.outcome === "reacquired-after-ai-deadline-wait" && entry.waitPhase === "original"));
});

test("the replacement deadline also releases the shared state lock and merges concurrent Flomo and stage results", async (t) => {
  const { result, events, weekRoot, waitResult } = await runFreshUncertainAiScenario(t, {
    duringReplacementWait: async ({ root: repoRoot, week }) => {
      const stage = await recordWeeklyStage({ week, stage: "preprocess", durationMs: 2345, repoRoot });
      const manual = await runWeeklyRetrySupervisor({
        week, mode: "manual", sourceId: "flomo", repoRoot, now: () => Date.parse("2026-10-05T07:10:00Z"),
        readOutcome: async () => null, runSource: async () => ({ status: "ready", count: 3 })
      });
      return { stage, manual };
    }
  });
  assert.equal(waitResult.stage.skipped, undefined);
  assert.equal(waitResult.manual.skipped, undefined);
  assert.equal(waitResult.manual.sources.flomo.status, "succeeded");
  assert.equal(result.sources.ai.status, "needs_review");
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(saved.sources.flomo.status, "succeeded", "resuming replacement observation merges current Flomo state");
  assert.ok(saved.diagnostics.some((entry) => entry.step === "preprocess"), "replacement wait preserves concurrent stage evidence");
  assert.ok(events.some((entry) => entry.outcome === "released-for-ai-deadline-wait" && entry.waitPhase === "replacement"));
  assert.ok(events.some((entry) => entry.outcome === "reacquired-after-ai-deadline-wait" && entry.waitPhase === "replacement"));
});

test("the AI wait does not save stale weekly state when lock reacquisition would leave insufficient budget", async (t) => {
  let competingLock;
  const { result, calls, waitResult } = await runFreshUncertainAiScenario(t, {
    maxDurationMs: 53 * 60_000,
    duringWait: async ({ weekRoot }) => {
      competingLock = path.join(weekRoot, "_weekly-retry-state.lock");
      await writeFile(competingLock, JSON.stringify({ pid: process.pid, token: "synthetic-owner", createdAt: new Date().toISOString() }));
      return { competingLock };
    }
  });
  t.after(() => rm(competingLock, { force: true }));
  assert.equal(result.skipped, "supervisor-state-lock-reacquire-timeout");
  assert.equal(result.diagnostic?.outcome, "reacquire-budget-exhausted", JSON.stringify(result));
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(calls.filter((call) => call.resubmit).length, 0);
  const owner = JSON.parse(await readFile(competingLock, "utf8"));
  assert.equal(owner.token, "synthetic-owner", "the losing invocation does not remove or overwrite the new lock owner");
  assert.ok(waitResult.competingLock);
});

test("an interrupted AI deadline wait resumes from the durable run receipt without duplicate submission", async (t) => {
  const first = await runFreshUncertainAiScenario(t, { interruptDuringWait: true });
  assert.equal(first.error.message, "synthetic-process-interruption");
  const stateLock = path.join(first.weekRoot, "_weekly-retry-state.lock");
  const aiLock = path.join(first.weekRoot, ".weekly-ai.lock");
  assert.equal(await readFile(stateLock, "utf8").then(() => true, () => false), false,
    "the interrupted waiter leaves the shared state lock available");
  assert.equal(await readFile(aiLock, "utf8").then(() => true, () => false), false,
    "the interrupted process releases its AI lock for deterministic recovery");

  let nowMs = first.now();
  const calls = [];
  let replacementRunId;
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "initial", repoRoot: first.root, maxDurationMs: 40 * 60_000,
    now: () => nowMs, sleep: async (ms) => { nowMs += ms; },
    readOutcome: async () => {
      const current = JSON.parse(await readFile(first.sidecar, "utf8"));
      return { status: current.status, error: current.reason || "",
        updatedAt: current.observation?.observedAt || current.completedAt || current.dispatchStartedAt };
    },
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi });
      const current = JSON.parse(await readFile(first.sidecar, "utf8"));
      if (context.resubmitUncertainAi) {
        replacementRunId = "123e4567-e89b-42d3-a456-426614174338";
        current.status = "needs_review";
        current.runId = replacementRunId;
        current.localAttemptId = replacementRunId;
        current.dispatchStartedAt = new Date(nowMs).toISOString();
        current.resubmissionReservedAt = new Date(nowMs).toISOString();
        current.resubmissionCount = 1;
        current.resubmissionOf = { runId: first.originalRunId, dispatchStartedAt: current.startedAt,
          reason: "observer-window-ended" };
        current.reason = "observer-window-ended";
        current.conversationUrl = "https://chatgpt.com/c/" + replacementRunId;
        current.actualConversationUrl = current.conversationUrl;
        await writeFile(first.sidecar, JSON.stringify(current));
        return { status: "needs_review", error: "observer-window-ended" };
      }
      if (context.observeUncertainAi && current.resubmissionCount === 1) {
        current.status = "confirmed";
        current.completedAt = new Date(nowMs).toISOString();
        delete current.reason;
        await writeFile(first.sidecar, JSON.stringify(current));
        return { status: "confirmed" };
      }
      current.observation = { status: "needs_review", runId: first.originalRunId,
        reason: "original-run-result-pending", submissionConfirmed: true,
        actualConversationUrl: current.conversationUrl, observedAt: new Date(nowMs).toISOString() };
      await writeFile(first.sidecar, JSON.stringify(current));
      return { status: "needs_review", error: "original-run-result-pending" };
    }
  });

  const finalSidecar = JSON.parse(await readFile(first.sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.equal(finalSidecar.resubmissionOf.runId, first.originalRunId);
  assert.equal(finalSidecar.runId, replacementRunId);
  assert.equal(calls.filter((call) => call.resubmit).length, 1);
  assert.ok(calls.filter((call) => call.observe).length >= 2, "the restarted invocation observes the original before the replacement");
});

test("an interrupted replacement wait resumes the reserved run and never submits a third task", async (t) => {
  const first = await runFreshUncertainAiScenario(t, { interruptDuringWait: "replacement" });
  assert.equal(first.error.message, "synthetic-process-interruption");
  const stateLock = path.join(first.weekRoot, "_weekly-retry-state.lock");
  const aiLock = path.join(first.weekRoot, ".weekly-ai.lock");
  assert.equal(await readFile(stateLock, "utf8").then(() => true, () => false), false);
  assert.equal(await readFile(aiLock, "utf8").then(() => true, () => false), false);
  const reserved = JSON.parse(await readFile(first.sidecar, "utf8"));
  assert.equal(reserved.resubmissionCount, 1);
  assert.equal(first.now(), Date.parse(reserved.dispatchStartedAt) + 20 * 60_000);

  let nowMs = first.now();
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "initial", repoRoot: first.root, maxDurationMs: 10 * 60_000,
    now: () => nowMs, sleep: async (ms) => { nowMs += ms; },
    readOutcome: async () => {
      const current = JSON.parse(await readFile(first.sidecar, "utf8"));
      return { status: current.status, error: current.reason || "", updatedAt: current.completedAt || current.dispatchStartedAt };
    },
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi });
      const current = JSON.parse(await readFile(first.sidecar, "utf8"));
      assert.equal(current.resubmissionCount, 1);
      if (context.observeUncertainAi) {
        current.status = "confirmed";
        current.completedAt = new Date(nowMs).toISOString();
        delete current.reason;
        await writeFile(first.sidecar, JSON.stringify(current));
        return { status: "confirmed" };
      }
      return { status: "needs_review", error: "unexpected-resubmission" };
    }
  });
  const finalSidecar = JSON.parse(await readFile(first.sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(finalSidecar.resubmissionCount, 1);
  assert.equal(calls.filter((call) => call.resubmit).length, 0);
  assert.equal(calls.filter((call) => call.observe).length, 1, "restart performs one boundary observation of the reserved replacement");
});

test("an immediately confirmed replacement verifies ai.md and does not wait another twenty minutes", async (t) => {
  const { result, events, sleeps, sidecar, weekRoot } = await runFreshUncertainAiScenario(t, {
    replacementImmediateStatus: "confirmed"
  });
  const confirmed = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.resubmissionCount, 1);
  assert.equal(sha256((await readFile(path.join(weekRoot, "ai.md"), "utf8")).trim()), confirmed.outputSha256);
  assert.equal(sleeps.length, 1, "only the original run's remaining 20-minute window is awaited");
  assert.ok(events.some((event) => event.outcome === "replacement-delivery-readback-verified"));
  assert.ok(!events.some((event) => event.outcome === "waiting-for-replacement-20m-deadline"));
});

test("an immediately generated replacement does not wait for a second result window", async (t) => {
  const { result, events, sleeps, sidecar, weekRoot } = await runFreshUncertainAiScenario(t, {
    replacementImmediateStatus: "generated"
  });
  const confirmed = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(confirmed.status, "confirmed", "an available generated result is promoted without another Bridge request");
  assert.equal(confirmed.resubmissionCount, 1);
  assert.equal(confirmed.readbackSha256, confirmed.outputSha256);
  assert.equal(sha256((await readFile(path.join(weekRoot, "ai.md"), "utf8")).trim()), confirmed.outputSha256);
  assert.equal(sleeps.length, 1, "the available replacement result ends observation immediately");
  assert.ok(events.some((event) => event.outcome === "replacement-generated-promoted"));
  assert.ok(!events.some((event) => event.outcome === "waiting-for-replacement-20m-deadline"));
});

test("a restarted supervisor reconciles a confirmed replacement by reading back ai.md without observing again", async (t) => {
  const first = await runFreshUncertainAiScenario(t, { interruptDuringWait: "replacement" });
  assert.equal(first.error.message, "synthetic-process-interruption");
  const hash = sha256(VALID_AI_REVIEW);
  const receipt = JSON.parse(await readFile(first.sidecar, "utf8"));
  receipt.status = "confirmed";
  receipt.outputSha256 = hash;
  receipt.readbackSha256 = hash;
  receipt.completedAt = new Date(first.now()).toISOString();
  delete receipt.reason;
  await writeFile(first.sidecar, JSON.stringify(receipt));
  await writeFile(path.join(first.weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");

  const calls = [];
  const sleeps = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "initial", repoRoot: first.root, maxDurationMs: 10 * 60_000,
    now: first.now, sleep: async (ms) => { sleeps.push(ms); },
    readOutcome: async () => {
      const current = JSON.parse(await readFile(first.sidecar, "utf8"));
      return { status: current.status, error: current.reason || "", updatedAt: current.completedAt || current.dispatchStartedAt };
    },
    runSource: async (_source, context) => {
      calls.push({ observe: context.observeUncertainAi, resubmit: context.resubmitUncertainAi });
      return { status: "needs_review", error: "unexpected-ai-call" };
    }
  });
  assert.equal(result.sources.ai.status, "succeeded");
  assert.equal(receipt.resubmissionCount, 1);
  assert.equal(calls.length, 0, "the confirmed receipt is reconciled locally without a Bridge call");
  assert.equal(sleeps.length, 0, "a confirmed delivery does not wait for its deadline");
});

test("a generated replacement with a missing parent run ID is rejected before promotion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-invalid-parent-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "succeeded";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const replacementRunId = "123e4567-e89b-42d3-a456-426614174339";
  const dispatchStartedAt = "2026-10-05T07:00:00.000Z";
  await writeFile(path.join(weekRoot, "ai.generated.md"), `${VALID_AI_REVIEW}\n`, "utf8");
  await writeFile(path.join(weekRoot, "_ai-generated.json"), JSON.stringify({
    status: "generated", targetWeek: week, runId: replacementRunId, localAttemptId: replacementRunId,
    dispatchStartedAt, conversationUrl: `https://chatgpt.com/c/${replacementRunId}`,
    resubmissionCount: 1, resubmissionOf: {}, outputSha256: sha256(VALID_AI_REVIEW),
    manualPrompt: "Complete synthetic manual prompt"
  }));

  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 5_000,
    runSource: async () => { throw new Error("invalid replacement receipt must never call Bridge"); }
  });
  const receipt = JSON.parse(await readFile(path.join(weekRoot, "_ai-generated.json"), "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(receipt.status, "generated", "the invalid receipt remains preserved for review");
  assert.equal(await readFile(path.join(weekRoot, "ai.md"), "utf8").then(() => true, () => false), false,
    "missing parent identity cannot promote untraceable output");
});

test("a restarted supervisor rejects a valid-format replacement linked to the wrong parent run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-wrong-parent-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  Object.assign(state.sources.ai, {
    status: "succeeded", attempts: 1,
    resubmissionParentRunId: "123e4567-e89b-42d3-a456-426614174340",
    resubmissionReservedAt: "2026-10-05T06:59:59.000Z"
  });
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const replacementRunId = "123e4567-e89b-42d3-a456-426614174341";
  const wrongParentRunId = "123e4567-e89b-42d3-a456-426614174342";
  await writeFile(path.join(weekRoot, "ai.generated.md"), `${VALID_AI_REVIEW}\n`, "utf8");
  const sidecarPath = path.join(weekRoot, "_ai-generated.json");
  const receipt = {
    status: "generated", targetWeek: week, runId: replacementRunId, localAttemptId: replacementRunId,
    dispatchStartedAt: "2026-10-05T07:00:00.000Z", conversationUrl: `https://chatgpt.com/c/${replacementRunId}`,
    resubmissionCount: 1, resubmissionOf: { runId: wrongParentRunId }, outputSha256: sha256(VALID_AI_REVIEW),
    manualPrompt: "Complete synthetic manual prompt"
  };
  await writeFile(sidecarPath, JSON.stringify(receipt));

  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 5_000,
    runSource: async () => { throw new Error("wrong-parent receipt must never call Bridge"); }
  });
  const finalReceipt = JSON.parse(await readFile(sidecarPath, "utf8"));
  const finalState = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.sources.ai.lastErrorClass, "ai-submission-state-uncertain");
  assert.equal(finalState.sources.ai.lastErrorSignal, "AI_REPLACEMENT_RECEIPT_INVALID");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.deepEqual(finalReceipt, receipt, "the untrusted receipt is preserved for diagnosis");
  assert.equal(finalState.sources.ai.resubmissionParentRunId, "123e4567-e89b-42d3-a456-426614174340");
  assert.equal(await readFile(path.join(weekRoot, "ai.md"), "utf8").then(() => true, () => false), false,
    "a valid-looking but wrong parent cannot promote generated output");
});

test("a persisted one-shot reservation without a replacement receipt cannot dispatch after restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-reserved-without-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  Object.assign(state.sources.ai, {
    status: "needs_review", attempts: 1,
    resubmissionParentRunId: "123e4567-e89b-42d3-a456-426614174343",
    resubmissionReservedAt: "2026-10-05T07:20:00.000Z"
  });
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const originalRunId = "123e4567-e89b-42d3-a456-426614174343";
  const dispatchStartedAt = "2026-10-05T07:00:00.000Z";
  const sidecar = {
    status: "needs_review", targetWeek: week, runId: originalRunId, localAttemptId: originalRunId,
    dispatchStartedAt, conversationUrl: `https://chatgpt.com/c/${originalRunId}`,
    reason: "observer-window-ended", manualPrompt: "Complete synthetic manual prompt"
  };
  const sidecarPath = path.join(weekRoot, "_ai-generated.json");
  await writeFile(sidecarPath, JSON.stringify(sidecar));
  let bridgeCalls = 0;

  const result = await runWeeklyRetrySupervisor({
    week, mode: "initial", repoRoot: root, maxDurationMs: 5_000,
    runSource: async () => { bridgeCalls += 1; throw new Error("a reserved quota must not dispatch again"); }
  });
  const finalState = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(bridgeCalls, 0);
  assert.equal(finalState.sources.ai.lastErrorSignal, "AI_REPLACEMENT_RECEIPT_INVALID");
  assert.deepEqual(JSON.parse(await readFile(sidecarPath, "utf8")), sidecar,
    "reservation-only recovery leaves the original receipt unchanged");
});

test("the twenty-minute wait stops when human ai.md content appears before the boundary", async (t) => {
  const { result, calls, sidecar, weekRoot } = await runFreshUncertainAiScenario(t, { humanDuringWait: true });
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.match(await readFile(path.join(weekRoot, "ai.md"), "utf8"), /用户人工周记/);
  assert.equal(finalSidecar.resubmissionCount, undefined);
  assert.equal(calls.filter((call) => call.resubmit).length, 0);
});

test("insufficient deadline budget surfaces the manual prompt without waiting or resubmitting", async (t) => {
  const { result, calls, sleeps, events, sidecar } = await runFreshUncertainAiScenario(t, { maxDurationMs: 35 * 60_000 });
  const finalSidecar = JSON.parse(await readFile(sidecar, "utf8"));
  assert.equal(result.sources.ai.status, "needs_review");
  assert.equal(result.manualFallback.prompt, "Complete synthetic manual prompt");
  assert.equal(finalSidecar.resubmissionCount, undefined);
  assert.equal(calls.filter((call) => call.resubmit).length, 0);
  assert.equal(sleeps.length, 0);
  assert.ok(events.some((event) => event.outcome === "skipped-deadline-budget"));
});

test("returns the complete business manual prompt when weekly AI remains unresolved", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-ai-manual-prompt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const manualPrompt = "Complete synthetic manual prompt\nwith all lines intact";
  await writeFile(path.join(weekRoot, "_ai-generated.json"), JSON.stringify({
    targetWeek: week, status: "needs_review", reason: "observer-window-ended", manualPrompt
  }));
  const result = await runWeeklyRetrySupervisor({
    week, repoRoot: root, maxDurationMs: 0, now: () => Date.parse("2026-10-05T08:00:00Z"), readOutcome: async () => null
  });
  assert.equal(result.manualFallback.prompt, manualPrompt);
  assert.equal(result.manualFallback.path, `03_input/weekly/${week}/ai.md`);
});

test("rebuilds the complete manual prompt from the target-week template when the sidecar field is absent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-ai-manual-prompt-rebuild-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const templatePath = path.join(root, "03_input/weekly/00_template/ai.md");
  const template = "# synthetic template for fallback reconstruction";
  await mkdir(weekRoot, { recursive: true });
  await mkdir(path.dirname(templatePath), { recursive: true });
  await writeFile(templatePath, template, "utf8");
  const state = createWeeklyRetryState(week);
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "needs_review";
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  await writeFile(path.join(weekRoot, "_ai-generated.json"), JSON.stringify({
    targetWeek: week, status: "needs_review", reason: "observer-window-ended"
  }));

  const result = await runWeeklyRetrySupervisor({
    week, repoRoot: root, maxDurationMs: 0, now: () => Date.parse("2026-10-05T08:00:00Z"), readOutcome: async () => null
  });

  assert.equal(result.manualFallback.path, `03_input/weekly/${week}/ai.md`);
  assert.equal(sha256(result.manualFallback.prompt), sha256(buildReviewPrompt(template, week)));
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

test("confirmed weekly AI is a success only when ai.md still passes validation and hash readback", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-confirmed-ai-readback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const hash = sha256(VALID_AI_REVIEW);
  const sidecar = { targetWeek: week, status: "confirmed", outputSha256: hash, readbackSha256: hash, confirmedAt: "2026-10-05T08:00:00Z" };
  await writeFile(path.join(weekRoot, "_ai-generated.json"), `${JSON.stringify(sidecar)}\n`);
  const source = WEEKLY_SOURCE_CONFIG.find((item) => item.id === "ai");

  const missing = await readCurrentSourceOutcome(source, week, root);
  assert.equal(missing.status, "needs_review");
  assert.equal(missing.error, "confirmed-ai-md-missing");

  await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");
  const intact = await readCurrentSourceOutcome(source, week, root);
  assert.equal(intact.status, "confirmed");

  await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW.replace("真实判断", "另一判断")}\n`, "utf8");
  const changed = await readCurrentSourceOutcome(source, week, root);
  assert.equal(changed.status, "needs_review");
  assert.equal(changed.error, "confirmed-ai-md-changed");

  await writeFile(path.join(weekRoot, "ai.md"), `${VALID_AI_REVIEW}\n`, "utf8");
  await writeFile(path.join(weekRoot, "_ai-generated.json"), `${JSON.stringify({ ...sidecar, readbackSha256: hash, outputSha256: sha256(VALID_AI_REVIEW.replace("真实判断", "另一判断")) })}\n`);
  const conflictingHashes = await readCurrentSourceOutcome(source, week, root);
  assert.equal(conflictingHashes.status, "needs_review");
  assert.equal(conflictingHashes.error, "confirmed-ai-md-hash-conflict");
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

test("Flomo automation exposes one-attempt flags and passes a fresh invocation UUID to its collector", async (t) => {
  const parsed = parseArgs(["--week", "2026-W40", "--mode", "manual", "--source", "flomo", "--single-attempt",
    "--automation-id", "learn-x-flomo-00-10", "--skip-prepare", "--skip-flomo-review-import", "--max-duration-ms", "1920000"]);
  assert.equal(parsed.singleAttempt, true);
  assert.equal(parsed.automationId, "learn-x-flomo-00-10");
  assert.equal(parsed.skipPreparation, true);
  assert.equal(parsed.skipFlomoReviewImport, true);
  assert.equal(parsed.maxDurationMs, 1_920_000);

  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-invocation-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T00:10:00.000Z");
  let prepared = 0;
  const result = await runWeeklyRetrySupervisor({
    ...parsed, repoRoot: root, now: () => current, maxDurationMs: parsed.maxDurationMs,
    prepareInputs: async () => { prepared += 1; }, readOutcome: async () => null,
    runSource: async (_source, context) => ({ status: "ready", count: 1, snapshotId: "snapshot-one-shot",
      capturedAt: new Date(current).toISOString(), coverage: { expectedCount: 1, observedCount: 1, omittedCount: 0 } }),
  });
  const state = JSON.parse(await readFile(result.statePath, "utf8"));
  const starts = state.diagnostics.filter((entry) => entry.step === "source-collection" && entry.sourceId === "flomo" && entry.outcome === "started");
  assert.equal(starts.length, 1);
  assert.match(starts[0].invocationId, /^[0-9a-f-]{36}$/i);
  assert.equal(state.sources.flomo.lastInvocationId, starts[0].invocationId);
  assert.equal(state.sources.flomo.lastAutomationId, "learn-x-flomo-00-10");
  assert.equal(state.sources.flomo.lastSnapshot.snapshotId, "snapshot-one-shot");
  assert.equal(prepared, 0, "the Flomo-only automation skips weekly preprocessing");
});

test("the Flomo adapter passes the supervisor invocation UUID and automation ID to the sync process", async () => {
  const source = WEEKLY_SOURCE_CONFIG.find((item) => item.id === "flomo");
  const invocationId = "123e4567-e89b-42d3-a456-426614174000";
  let invocation;
  const outcome = await runConfiguredSource(source, {
    week: "2026-W40", repoRoot: "/tmp/learn-x-flomo-adapter", attemptToken: "fedcba98-7654-3210-fedc-ba9876543210",
    invocationId, automationId: "learn-x-flomo-00-10", timeoutMs: 5_000,
    executeCommand: async (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.match(args[0], /sync-flomo-full-week\.mjs$/);
      assert.deepEqual(args.slice(1), ["--week", "2026-W40", "--attempt-token", "fedcba98-7654-3210-fedc-ba9876543210",
        "--invocation-id", invocationId]);
      assert.equal(options.env.LEARN_X_AUTOMATION_ID, "learn-x-flomo-00-10");
      invocation = { args, env: options.env };
      return { stdout: JSON.stringify({ snapshotId: "snapshot-adapter", capturedAt: "2026-10-05T00:00:00.000Z" }) };
    },
    readOutcome: async () => ({ status: "ready", updatedAt: new Date().toISOString() }),
  });
  assert.ok(invocation);
  assert.equal(outcome.snapshotId, "snapshot-adapter");
});

test("Flomo single-attempt runner enforces a twenty-minute minimum, honors persisted backoff, and stops after success", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-single-attempt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  let current = Date.parse("2026-10-26T00:10:00.000Z");
  let calls = 0;
  const options = {
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true,
    automationId, repoRoot: root, maxDurationMs: 60_000, now: () => current, readOutcome: async () => null,
    runSource: async () => {
      calls += 1;
      return calls === 1 ? { status: "failed", error: "ECONNRESET; Retry-After: Mon, 26 Oct 2026 00:50:00 GMT" }
        : { status: "ready", count: 1, snapshotId: "snapshot-recovered", capturedAt: new Date(current).toISOString() };
    },
  };
  const first = await runWeeklyRetrySupervisor(options);
  assert.equal(first.sources.flomo.status, "failed");
  assert.equal(Date.parse(first.sources.flomo.nextRetryAt), current + 40 * 60_000);

  current += 39 * 60_000;
  const tooEarly = await runWeeklyRetrySupervisor(options);
  const tooEarlyState = JSON.parse(await readFile(tooEarly.statePath, "utf8"));
  assert.equal(tooEarlyState.diagnostics.at(-1).outcome, "flomo-retry-cooldown");
  assert.equal(calls, 1);

  current += 60_000;
  const recovered = await runWeeklyRetrySupervisor(options);
  assert.equal(recovered.sources.flomo.status, "succeeded");
  assert.equal(calls, 2);
  const afterSuccess = await runWeeklyRetrySupervisor(options);
  const afterSuccessState = JSON.parse(await readFile(afterSuccess.statePath, "utf8"));
  assert.equal(afterSuccessState.diagnostics.at(-1).outcome, "flomo-already-succeeded");
  assert.equal(calls, 2, "success ends the automation's retry sequence");
});

test("Flomo single-attempt runner waits twenty minutes from failure completion before retrying", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-minimum-gap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T00:10:00.000Z");
  let calls = 0;
  const options = {
    week: "2026-W40", mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true,
    automationId: "learn-x-flomo-00-10", repoRoot: root, maxDurationMs: 60_000, now: () => current,
    readOutcome: async () => null,
    runSource: async () => {
      calls += 1;
      return calls === 1 ? { status: "failed", error: "ECONNRESET" }
        : { status: "empty", count: 0, snapshotId: "snapshot-empty", capturedAt: new Date(current).toISOString() };
    },
  };
  const first = await runWeeklyRetrySupervisor(options);
  assert.equal(Date.parse(first.sources.flomo.nextRetryAt), current + 20 * 60_000);
  current += 19 * 60_000;
  const tooEarly = await runWeeklyRetrySupervisor(options);
  const tooEarlyState = JSON.parse(await readFile(tooEarly.statePath, "utf8"));
  assert.equal(tooEarly.sources.flomo.status, "failed");
  assert.equal(tooEarlyState.diagnostics.at(-1).outcome, "flomo-retry-cooldown");
  assert.equal(calls, 1);
  current += 60_000;
  const retry = await runWeeklyRetrySupervisor(options);
  assert.equal(retry.sources.flomo.status, "succeeded");
  assert.equal(calls, 2);
});

test("Flomo single-attempt runner does not retry failures classified as non-retryable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-non-retryable-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T00:10:00.000Z");
  let calls = 0;
  const options = {
    week: "2026-W40", mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true,
    automationId: "learn-x-flomo-00-10", repoRoot: root, maxDurationMs: 60_000, now: () => current,
    readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "failed", error: "flomo-scan-incomplete" }; },
  };
  const first = await runWeeklyRetrySupervisor(options);
  assert.equal(first.sources.flomo.lastErrorClass, "source-integrity-failed");
  current += 20 * 60_000;
  const second = await runWeeklyRetrySupervisor(options);
  const state = JSON.parse(await readFile(second.statePath, "utf8"));
  assert.equal(state.diagnostics.at(-1).outcome, "flomo-failure-not-retryable");
  assert.equal(calls, 1);
  assert.equal(second.sources.flomo.attempts, 1);
});

test("Flomo single-attempt runner stops on login or user-control failures and caps the automation at three starts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-single-attempt-stop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  let current = Date.parse("2026-10-05T00:10:00.000Z");
  let calls = 0;
  const options = {
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true,
    automationId, repoRoot: root, maxDurationMs: 60_000, now: () => current, readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "failed", error: "ECONNRESET" }; },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await runWeeklyRetrySupervisor(options);
    assert.equal(result.sources.flomo.attempts, attempt + 1);
    current += 20 * 60_000;
  }
  const capped = await runWeeklyRetrySupervisor(options);
  const cappedState = JSON.parse(await readFile(capped.statePath, "utf8"));
  assert.equal(cappedState.diagnostics.at(-1).outcome, "flomo-automation-attempt-limit-reached");
  assert.equal(calls, 3);

  const blockedRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-human-stop-"));
  t.after(() => rm(blockedRoot, { recursive: true, force: true }));
  let blockedCalls = 0;
  const blockedOptions = { ...options, repoRoot: blockedRoot,
    runSource: async () => { blockedCalls += 1; return { status: "failed", error: "ego-user-control-required" }; } };
  const blocked = await runWeeklyRetrySupervisor(blockedOptions);
  const stopped = await runWeeklyRetrySupervisor(blockedOptions);
  const stoppedState = JSON.parse(await readFile(stopped.statePath, "utf8"));
  assert.equal(blocked.sources.flomo.status, "failed");
  assert.equal(stoppedState.diagnostics.at(-1).outcome, "flomo-human-action-required");
  assert.equal(blockedCalls, 1);
});

test("Flomo automation attempt budget survives diagnostic-log truncation before the attempt gate", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-attempt-budget-log-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  const current = Date.parse("2026-10-05T02:00:00.000Z");
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  Object.assign(state.sources.flomo, {
    status: "failed", attempts: 3, lastErrorClass: "network-transient", lastErrorSignal: "ECONNRESET",
    lastFailureAt: new Date(current - 60 * 60_000).toISOString(), nextRetryAt: new Date(current - 40 * 60_000).toISOString(),
    lastAutomationId: automationId
  });
  delete state.sources.flomo.automationAttemptCounts;
  state.diagnostics = [
    ...Array.from({ length: 3 }, (_, index) => ({ at: new Date(current - (60 - index) * 60_000).toISOString(),
      step: "source-collection", sourceId: "flomo", automationId, outcome: "started" })),
    ...Array.from({ length: 497 }, (_, index) => ({ at: new Date(current - 1_000).toISOString(), step: "source-check", sourceId: `old-${index}` }))
  ];
  assert.equal(state.diagnostics.length, 500);
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true, automationId,
    repoRoot: root, maxDurationMs: 60_000, now: () => current,
    readOutcome: async (source) => source.id === "flomo" ? null : { status: "ready", updatedAt: new Date(current).toISOString() },
    runSource: async () => { calls += 1; return { status: "failed", error: "ECONNRESET" }; }
  });
  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(calls, 0, "the collector must not start after the persisted three-attempt budget is exhausted");
  assert.equal(persisted.sources.flomo.attempts, 3);
  assert.equal(persisted.sources.flomo.automationAttemptCounts[automationId], 3);
  assert.equal(persisted.diagnostics.at(-1).outcome, "flomo-automation-attempt-limit-reached");
});

test("Flomo legacy state with a full truncated log and no counter fails closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-legacy-truncated-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  const current = Date.parse("2026-10-05T02:00:00.000Z");
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  delete state.sources.flomo.automationAttemptCounts;
  Object.assign(state.sources.flomo, { status: "failed", attempts: 3, lastErrorClass: "network-transient",
    lastFailureAt: new Date(current - 60 * 60_000).toISOString(), nextRetryAt: new Date(current - 40 * 60_000).toISOString(),
    lastAutomationId: null });
  state.diagnostics = Array.from({ length: 500 }, (_, index) => ({ at: new Date(current - 1_000).toISOString(),
    step: "source-check", sourceId: `old-${index}` }));
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true, automationId,
    repoRoot: root, maxDurationMs: 60_000, now: () => current, readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "failed", error: "ECONNRESET" }; }
  });
  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(calls, 0, "an old full log with no durable counter may hide earlier starts");
  assert.equal(persisted.sources.flomo.automationAttemptCounts[automationId], 3);
  assert.equal(persisted.diagnostics.at(-1).outcome, "flomo-automation-attempt-limit-reached");
});

test("Flomo legacy state with another automation counter and no current key fails closed on a full log", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-missing-counter-key-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  const current = Date.parse("2026-10-05T02:00:00.000Z");
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  Object.assign(state.sources.flomo, { status: "failed", attempts: 3, lastErrorClass: "network-transient",
    lastFailureAt: new Date(current - 60 * 60_000).toISOString(), nextRetryAt: new Date(current - 40 * 60_000).toISOString(),
    lastAutomationId: null, automationAttemptCounts: { "other-automation": 1 } });
  state.diagnostics = Array.from({ length: 500 }, (_, index) => ({ at: new Date(current - 1_000).toISOString(),
    step: "source-check", sourceId: `old-${index}` }));
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true, automationId,
    repoRoot: root, maxDurationMs: 60_000, now: () => current, readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "failed", error: "ECONNRESET" }; }
  });
  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(calls, 0, "a missing counter key plus a full log cannot prove that no earlier starts were trimmed");
  assert.equal(persisted.sources.flomo.automationAttemptCounts[automationId], 3);
  assert.equal(persisted.diagnostics.at(-1).outcome, "flomo-automation-attempt-limit-reached");
});

test("Flomo automation trusts an existing counter when a full log still contains one retry slot", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-flomo-persisted-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";
  const current = Date.parse("2026-10-05T02:00:00.000Z");
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  Object.assign(state.sources.flomo, { status: "failed", attempts: 2, lastErrorClass: "network-transient",
    lastFailureAt: new Date(current - 60 * 60_000).toISOString(), nextRetryAt: new Date(current - 40 * 60_000).toISOString(),
    lastAutomationId: automationId, automationAttemptCounts: { [automationId]: 2 } });
  state.diagnostics = [
    ...Array.from({ length: 2 }, (_, index) => ({ at: new Date(current - (60 - index) * 60_000).toISOString(),
      step: "source-collection", sourceId: "flomo", automationId, outcome: "started" })),
    ...Array.from({ length: 498 }, (_, index) => ({ at: new Date(current - 1_000).toISOString(), step: "source-check", sourceId: `old-${index}` }))
  ];
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true, automationId,
    repoRoot: root, maxDurationMs: 60_000, now: () => current, readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "failed", error: "ECONNRESET" }; }
  });
  const persisted = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.equal(calls, 1, "the third allowed attempt remains available when the durable count says two");
  assert.equal(persisted.sources.flomo.automationAttemptCounts[automationId], 3);
  assert.equal(persisted.sources.flomo.attempts, 3);
});

test("the 05:00 initial run consumes a successful 00:10 Flomo result without rescanning, while 07:00 can rescue a failed one", async (t) => {
  const seed = async (root, week) => {
    const weekRoot = path.join(root, "03_input/weekly", week);
    await mkdir(weekRoot, { recursive: true });
    const state = createWeeklyRetryState(week);
    for (const source of WEEKLY_SOURCE_CONFIG) {
      state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
      state.sources[source.id].attempts = source.collector ? 1 : 0;
    }
    state.sources.flomo.status = "pending";
    state.sources.flomo.attempts = 0;
    await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
    return weekRoot;
  };
  const week = "2026-W40";
  const automationId = "learn-x-flomo-00-10";

  const successfulRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-pre-sync-dedupe-"));
  t.after(() => rm(successfulRoot, { recursive: true, force: true }));
  await seed(successfulRoot, week);
  let successCalls = 0;
  const singleOptions = { week, mode: "manual", sourceId: "flomo", singleAttempt: true, skipPreparation: true,
    automationId, repoRoot: successfulRoot, maxDurationMs: 60_000, readOutcome: async () => null,
    runSource: async () => { successCalls += 1; return { status: "ready", count: 2, snapshotId: "snapshot-00-10" }; } };
  await runWeeklyRetrySupervisor(singleOptions);
  const at0500 = await runWeeklyRetrySupervisor({ week, mode: "initial", repoRoot: successfulRoot, maxDurationMs: 60_000,
    readOutcome: async () => null, runSource: async () => { successCalls += 1; return { status: "ready", count: 2 }; } });
  assert.equal(at0500.sources.flomo.status, "succeeded");
  assert.equal(successCalls, 1, "the successful pre-sync is not scanned again at 05:00");

  const failedRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-pre-sync-rescue-"));
  t.after(() => rm(failedRoot, { recursive: true, force: true }));
  await seed(failedRoot, week);
  let current = Date.parse("2026-10-05T00:10:00.000Z");
  let rescueCalls = 0;
  const failedOptions = { ...singleOptions, repoRoot: failedRoot, now: () => current,
    runSource: async () => { rescueCalls += 1; return { status: "failed", error: "ECONNRESET" }; } };
  const failed = await runWeeklyRetrySupervisor(failedOptions);
  assert.equal(failed.sources.flomo.status, "failed");
  current += 20 * 60_000;
  const at0700 = await runWeeklyRetrySupervisor({ week, mode: "rescue", repoRoot: failedRoot, now: () => current,
    maxDurationMs: 60_000, readOutcome: async () => null,
    runSource: async (source) => { rescueCalls += 1; assert.equal(source.id, "flomo"); return { status: "ready", count: 2, snapshotId: "snapshot-07-00" }; } });
  assert.equal(at0700.sources.flomo.status, "succeeded");
  assert.equal(at0700.sources.flomo.rescueUsed, true);
  assert.equal(rescueCalls, 2, "the 07:00 rescue performs one source recovery scan");
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

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { isoWeeksInYear } from "../../learn-x-input/scripts/lib/iso-week.mjs";
import { ensureWeeklyDirectory } from "../../learn-x-input/scripts/lib/weekly-path.mjs";
import { readWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { validateAiReview } from "../../learn-x-process/scripts/monthly-process-input.mjs";
import { canResubmitUncertainAi, normalizeAiReviewText, promoteAiReview, sha256 } from "./generate-ai-review.mjs";
import { tryAcquireWeeklyAiLock, validateWeeklyAiLockToken } from "./lib/weekly-ai-lock.mjs";
import { hasVerifiedSmallPatch, prepareRecoveryIncident, queryRecoveryPlaybook, recordRecoveryIncident, recoveryLayerForAttempt } from "./recovery-memory.mjs";
import { withLock } from "../../learn-x-flomo-review/scripts/review.mjs";
import { readBuildCoverageHeader } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const DEFAULT_RETRY_GAP_MS = 20 * 60_000;
const FLOMO_RETRY_GAP_MS = 10 * 60_000;
const AI_UNCERTAIN_RESUBMIT_AFTER_MS = 20 * 60_000;
const AI_REPLACEMENT_PROCESS_BUDGET_MS = 5 * 60_000;
const AI_REPLACEMENT_OBSERVATION_MS = 20 * 60_000;
const AI_REPLACEMENT_FINAL_OBSERVE_PROCESS_BUDGET_MS = 150_000;
const AI_RESUBMISSION_FINALIZATION_MARGIN_MS = 2 * 60_000;
const AI_ORIGINAL_BOUNDARY_PROCESS_BUDGET_MS = 150_000;
const AI_STATE_LOCK_REACQUIRE_MARGIN_MS = 30_000;
const AI_REPLACEMENT_FINALIZATION_BUDGET_MS = AI_REPLACEMENT_FINAL_OBSERVE_PROCESS_BUDGET_MS
  + AI_RESUBMISSION_FINALIZATION_MARGIN_MS + AI_STATE_LOCK_REACQUIRE_MARGIN_MS;
const AI_RESUBMISSION_REQUIRED_BUDGET_MS = AI_REPLACEMENT_PROCESS_BUDGET_MS
  + AI_REPLACEMENT_OBSERVATION_MS + AI_REPLACEMENT_FINALIZATION_BUDGET_MS;
const AI_WAIT_REACQUIRE_MIN_BUDGET_MS = AI_ORIGINAL_BOUNDARY_PROCESS_BUDGET_MS
  + AI_RESUBMISSION_REQUIRED_BUDGET_MS + AI_STATE_LOCK_REACQUIRE_MARGIN_MS;
const STATE_FILE = "_weekly-retry-state.json";
const LOCK_FILE = "_weekly-retry-state.lock";
const BROWSER_QUEUE_LOCK_FILE = ".browser-queue.lock";
const LOG_LIMIT = 500;
const AI_TERMINAL_OBSERVATION_REASONS = new Set([
  "chatgpt-rate-limited", "login-required", "captcha-or-blocked", "ego-bootstrap-permission",
  "conversation-session-mismatch", "conversation-session-not-bound", "observer-identity-mismatch",
  "original-run-identity-mismatch", "submission-unconfirmed", "new-user-message-not-found",
  "formal-ai-md-has-human-content", "formal-ai-md-changed-after-promotion", "confirmed-ai-md-changed", "confirmed-ai-md-missing",
]);
const RECOVERY_ACTIONS = Object.freeze({
  "verify-only": { layer: 2, note: "执行只读核验后重查", preconditions: ["status-readback-valid"] },
  "manual-repair": { layer: 2, note: "完成经核验的来源修复后重采", preconditions: ["user-confirmed-scope"] },
  "upgrade-official-skill": { layer: 2, note: "官方 Skill 升级后重采", preconditions: ["official-source-verified", "current-version-matched"], sourceId: "weread" },
  "small-patch": { layer: 3, note: "受控补丁通过原失败与反例验证后重采", preconditions: ["same-target-week", "status-readback-valid", "user-confirmed-scope", "remaining-budget-sufficient"] }
});

export function createWeeklyRetryState(week) {
  return {
    schemaVersion: 1,
    week: normalizeWeek(week),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: Object.fromEntries(WEEKLY_SOURCE_CONFIG.map((source) => [source.id, {
      status: "pending", attempts: 0, retries: source.retries, rescueUsed: false,
      recoveryActions: [], problemRunId: null,
      nextRetryAt: null, lastAttemptAt: null, lastSuccessAt: null,
      lastErrorClass: null, lastErrorSignal: null, sameErrorCount: 0
    }])),
    flomoReviewImport: null,
    pendingRecoveryEvents: [],
    diagnostics: []
  };
}

export function classifyWeeklyFailure(message, { sourceId = "", code = "" } = {}) {
  const value = `${code} ${message}`.toLowerCase();
  if (/weread-skill-upgrade-required|weread-skill-version-unverifiable|skill.{0,20}(upgrade|version)|upgrade_info/.test(value)) {
    return { errorClass: "source-version-mismatch", retryable: false, retryAfterMs: 0 };
  }
  if (/\bEPERM\b|operation not permitted/i.test(value)) {
    return { errorClass: "local-execution-permission-denied", retryable: false, retryAfterMs: 0 };
  }
  if (/permission|forbidden|unauthori[sz]ed|login|captcha|user.control|bootstrap.permission|scope|identity/.test(value)) {
    return { errorClass: "permission-or-human-control", retryable: false, retryAfterMs: 0 };
  }
  if (/schema|field.contract|invalid.field|contract.mismatch|unsupported.field|target.mismatch|snapshot-gap|completeness-contract/.test(value)) {
    return { errorClass: "source-contract-mismatch", retryable: false, retryAfterMs: 0 };
  }
  if (sourceId === "flomo" && /scan-integrity-check-failed|flomo-(?:scan|weekly|full-scan|week-snapshot)-(?:incomplete|invalid|termination-unproven|coverage-invalid|record-incomplete)|ego-(?:memo-id-missing|body-incomplete|pagination-incomplete|pagination-control-missing|detail-[a-z-]+|library-count-[a-z-]+|scan-conflict|scan-record-conflict|task-exit-unconfirmed)/.test(value)) {
    return { errorClass: "source-integrity-failed", retryable: false, retryAfterMs: 0 };
  }
  if (/manual|human.review|needs_review|timestamp[-_ ]density[-_ ]review[-_ ]required/.test(value)) {
    return { errorClass: "manual-review-required", retryable: false, retryAfterMs: 0 };
  }
  if (/review[-_ ]locked[-_ ]inspect[-_ ]owner[-_ ]before[-_ ]recovery|review[-_ ]store[-_ ]lock[-_ ]busy/.test(value)) {
    const cooldown = sourceId === "flomo" ? FLOMO_RETRY_GAP_MS : DEFAULT_RETRY_GAP_MS;
    return { errorClass: "review-store-lock-busy", retryable: true, retryAfterMs: cooldown };
  }
  const retryAfter = Number(value.match(/retry-after\s*[:= ]\s*(\d+)/)?.[1] || 0) * 1000;
  if (/econnreset|econnrefused|eai_again|enotfound|network|dns|temporar|http.?5\d\d|rate.?limit|throttl|timeout|timed out|process-interrupted/.test(value)) {
    const cooldown = sourceId === "flomo" ? FLOMO_RETRY_GAP_MS : DEFAULT_RETRY_GAP_MS;
    return { errorClass: /rate.?limit|throttl/.test(value) ? "service-rate-limit" : /timeout|timed out/.test(value) ? "network-timeout" : "network-transient", retryable: true, retryAfterMs: Math.max(cooldown, retryAfter) };
  }
  return { errorClass: "unknown-failure", retryable: false, retryAfterMs: 0 };
}

export function canRetrySource(source, entry, mode, now = Date.now()) {
  if (!source || !entry) return false;
  if (mode === "rescue") {
    if (entry.rescueUsed || source.retries < 0 || !source.collector || source.queue === "external" || source.queue === "manual") return false;
    if (entry.status === "pending" && entry.attempts === 0) return true;
    if (entry.status !== "failed" || !entry.lastErrorClass || entry.nextRetryAt == null || Date.parse(entry.nextRetryAt) > now) return false;
    return isRetryableClass(entry.lastErrorClass);
  }
  if (entry.status !== "failed" || !entry.lastErrorClass || entry.nextRetryAt == null || Date.parse(entry.nextRetryAt) > now) return false;
  if (!isRetryableClass(entry.lastErrorClass)) return false;
  return entry.attempts <= source.retries;
}

export function classifyOutcome(sourceId, outcome) {
  if (outcome?.status === "unavailable") {
    return { status: "unavailable", errorClass: "source-unavailable", retryable: false, retryAfterMs: 0 };
  }
  if (["ready", "empty", "success", "generated", "confirmed"].includes(outcome?.status)) {
    return { status: "succeeded", errorClass: null, retryable: false, retryAfterMs: 0 };
  }
  if (["needs_review", "submission-uncertain"].includes(outcome?.status)) {
    return { status: "needs_review", errorClass: sourceId === "ai" ? "ai-submission-state-uncertain" : "manual-review-required", retryable: false, retryAfterMs: 0 };
  }
  const failure = classifyWeeklyFailure(`${outcome?.error || ""} ${outcome?.summary || ""}`, { sourceId, code: outcome?.code });
  if (sourceId === "ai") {
    const phase = outcome?.diagnostics?.rateLimitPhase;
    const reason = `${outcome?.error || ""} ${outcome?.summary || ""}`;
    const ambiguousSubmission = outcome?.timedOut || ["submit", "observe"].includes(phase)
      || /bridge-timeout|bridge-result-missing|observer-window-ended|observer-timeout|snapshot-mismatch|submit-timeout|submission-state-uncertain/i.test(reason);
    if (ambiguousSubmission || (failure.retryable && phase !== "preflight")) {
      return { status: "needs_review", errorClass: "ai-submission-state-uncertain", retryable: false, retryAfterMs: 0 };
    }
  }
  return { status: "failed", ...failure };
}

export async function runWeeklyRetrySupervisor({
  week,
  mode = "initial",
  sourceId = null,
  resubmitUncertainAi = false,
  recoveryActionCode = "",
  problemId = "",
  expectedSourceVersion = "",
  confirmedRecovery = false,
  enableFlomoReviewImport = false,
  importFlomoReviews = runFlomoReviewImport,
  repoRoot = defaultRepoRoot,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  runSource = (source, context) => runConfiguredSource(source, context),
  readOutcome = (source) => readCurrentSourceOutcome(source, week, repoRoot),
  prepareInputs,
  onEvent = () => {},
  maxDurationMs = 100 * 60_000
} = {}) {
  const normalizedWeek = normalizeWeek(week);
  if (!["initial", "rescue", "manual", "recovery"].includes(mode)) throw new Error("mode must be initial, rescue, manual, or recovery");
  if (mode === "recovery" && !sourceId) throw new Error("recovery-mode-requires-source");
  const supportedManualSource = sourceId === "flomo" || (sourceId === "ai" && resubmitUncertainAi);
  const recoverySource = sourceId && WEEKLY_SOURCE_CONFIG.find((source) => source.id === sourceId);
  if (sourceId != null && mode === "recovery") {
    if (!recoverySource?.collector || sourceId === "ai") throw new Error("recovery-mode-source-not-supported");
    const contract = RECOVERY_ACTIONS[recoveryActionCode];
    if (!contract || (contract.sourceId && contract.sourceId !== sourceId)) throw new Error("recovery-action-not-supported-for-source");
    if (!confirmedRecovery) throw new Error("recovery-action-requires-confirm");
    if (recoveryActionCode === "upgrade-official-skill" && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(expectedSourceVersion)) {
      throw new Error("recovery-expected-version-required");
    }
  } else if (recoveryActionCode || expectedSourceVersion
    || (confirmedRecovery && !(mode === "manual" && sourceId === "ai" && resubmitUncertainAi))) {
    throw new Error("recovery-action-requires-recovery-mode");
  }
  if (sourceId != null && mode !== "recovery" && (!WEEKLY_SOURCE_CONFIG.some((source) => source.id === sourceId && source.collector) || mode !== "manual" || !supportedManualSource)) {
    throw new Error("source-filter-only-supports-manual-flomo-or-confirmed-ai-resubmission-or-recovery");
  }
  if (resubmitUncertainAi && (mode !== "manual" || sourceId !== "ai")) throw new Error("uncertain-ai-resubmission-requires-manual-source-ai");
  if (mode === "manual" && sourceId !== "flomo" && !(sourceId === "ai" && resubmitUncertainAi)) throw new Error("manual-mode-requires-source-flomo-or-confirmed-ai-resubmission");
  const selectedSources = sourceId ? WEEKLY_SOURCE_CONFIG.filter((source) => source.id === sourceId) : WEEKLY_SOURCE_CONFIG;
  const safePaths = await ensureWeeklyDirectory(repoRoot, normalizedWeek);
  repoRoot = safePaths.repoRoot;
  const weekRoot = safePaths.weekRoot;
  const statePath = path.join(weekRoot, STATE_FILE);
  const startedAt = now();
  const executionId = randomUUID();
  const lockPath = path.join(weekRoot, LOCK_FILE);
  let lock = await tryAcquireRunLock(lockPath);
  let lockWaitMs = 0;
  while (!lock && mode === "rescue" && now() - startedAt < maxDurationMs) {
    const waitMs = Math.min(30_000, maxDurationMs - (now() - startedAt));
    if (waitMs <= 0) break;
    await sleep(waitMs);
    lockWaitMs += waitMs;
    lock = await tryAcquireRunLock(lockPath);
  }
  if (!lock) return { week: normalizedWeek, mode, skipped: "supervisor-already-running", waitedMs: lockWaitMs };
  let state;
  let stateLockLost = false;
  let stateLockDiagnostic = null;
  let saveQueue = Promise.resolve();
  let preparationQueue = Promise.resolve();
  let recoveryQueue = Promise.resolve();
  let aiRecoveryStarted = false;
  const recoveryWriteErrors = [];
  const save = () => {
    if (!lock || stateLockLost) return Promise.reject(new Error("weekly-retry-state-lock-not-held"));
    state.updatedAt = new Date(now()).toISOString();
    saveQueue = saveQueue.then(() => atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`));
    return saveQueue;
  };
  const releaseStateLockForAiWait = async (waitPhase = "original") => {
    if (!lock) return async () => false;
    const requiredReacquireBudgetMs = waitPhase === "replacement"
      ? AI_REPLACEMENT_FINALIZATION_BUDGET_MS : AI_WAIT_REACQUIRE_MIN_BUDGET_MS;
    // Finish every queued mutation while this process still owns the state lock.
    await preparationQueue;
    await recoveryQueue;
    await saveQueue;
    await save();
    await saveQueue;
    const releasedLock = lock;
    event({ step: "supervisor-state-lock", sourceId: "ai", outcome: "released-for-ai-deadline-wait",
      waitPhase, evidence: STATE_FILE });
    await save();
    await saveQueue;
    lock = null;
    await releasedLock.release();
    return async () => {
      const deadline = startedAt + maxDurationMs;
      const reacquireStartedAt = now();
      while (deadline - now() >= requiredReacquireBudgetMs) {
        const acquired = await tryAcquireRunLock(lockPath);
        if (acquired) {
          lock = acquired;
          state = await loadState(statePath, normalizedWeek) || createWeeklyRetryState(normalizedWeek);
          state.pendingRecoveryEvents = Array.isArray(state.pendingRecoveryEvents) ? state.pendingRecoveryEvents : [];
          if (deadline - now() < requiredReacquireBudgetMs) {
            event({ step: "supervisor-state-lock", sourceId: "ai", outcome: "reacquired-with-insufficient-ai-budget",
              waitPhase,
              remainingMs: Math.max(0, deadline - now()), requiredBudgetMs: requiredReacquireBudgetMs, evidence: STATE_FILE });
            await save();
            await lock.release();
            lock = null;
            stateLockLost = true;
            stateLockDiagnostic = { step: "supervisor-state-lock", outcome: "reacquired-with-insufficient-ai-budget", waitPhase,
              elapsedMs: Math.max(0, now() - reacquireStartedAt), remainingMs: Math.max(0, deadline - now()),
              requiredBudgetMs: requiredReacquireBudgetMs };
            return false;
          }
          event({ step: "supervisor-state-lock", sourceId: "ai", outcome: "reacquired-after-ai-deadline-wait",
            waitPhase,
            durationMs: Math.max(0, now() - reacquireStartedAt), evidence: STATE_FILE });
          for (const pending of [...state.pendingRecoveryEvents]) queueRecoveryWrite(pending);
          await save();
          return true;
        }
        const remaining = deadline - now() - requiredReacquireBudgetMs;
        if (remaining <= 0) break;
        await sleep(Math.min(1_000, remaining));
      }
      stateLockLost = true;
      stateLockDiagnostic = { step: "supervisor-state-lock", outcome: "reacquire-budget-exhausted", waitPhase,
        elapsedMs: Math.max(0, now() - reacquireStartedAt), remainingMs: Math.max(0, deadline - now()),
        requiredBudgetMs: requiredReacquireBudgetMs };
      return false;
    };
  };
  const recoveryStateRoot = path.join(repoRoot, ".agents/skills/learn-x-weekly-automation/state");
  const queueRecoveryWrite = (input) => {
    let incident;
    try { incident = prepareRecoveryIncident(input, input?.at || new Date(now())); }
    catch { recoveryWriteErrors.push("invalid-event"); return; }
    state.pendingRecoveryEvents = Array.isArray(state.pendingRecoveryEvents) ? state.pendingRecoveryEvents : [];
    const wasPending = state.pendingRecoveryEvents.some((item) => item.eventId === incident.eventId);
    if (!wasPending) state.pendingRecoveryEvents.push(incident);
    recoveryQueue = recoveryQueue.then(async () => {
      try { await save(); }
      catch { recoveryWriteErrors.push("pending-marker-save-failed"); }
      let recorded;
      try {
        recorded = await recordRecoveryIncident(incident, { stateRoot: recoveryStateRoot });
      } catch {
        recoveryWriteErrors.push("write-failed");
        state.diagnostics.push({ at: new Date(now()).toISOString(), step: "recovery-memory", eventId: incident.eventId, outcome: "pending-write" });
        try { await save(); }
        catch { recoveryWriteErrors.push("pending-state-save-failed"); }
        return;
      }
      state.pendingRecoveryEvents = state.pendingRecoveryEvents.filter((item) => item.eventId !== incident.eventId);
      state.diagnostics.push({ at: new Date(now()).toISOString(), step: "recovery-memory", eventId: incident.eventId,
        outcome: wasPending ? "pending-backfilled" : recorded.duplicate ? "already-recorded" : "written",
        ...(wasPending ? { evidence: "_weekly-retry-state.json" } : {}) });
      try { await save(); }
      catch { recoveryWriteErrors.push("pending-clear-save-failed"); }
    });
  };
  const event = (entry) => {
    const logged = entry.step === "source-collection" && entry.attemptKind
      ? { ...entry, executionId, problemRunId: state.sources[entry.sourceId]?.problemRunId || executionId,
        recoveryLayer: recoveryLayerForAttempt(entry.attemptKind) || 1 }
      : entry;
    state.diagnostics.push({ at: new Date(now()).toISOString(), ...logged });
    if (state.diagnostics.length > LOG_LIMIT) state.diagnostics.splice(0, state.diagnostics.length - LOG_LIMIT);
    onEvent(logged);
    if (logged.step === "source-collection" && ["failed", "needs_review", "unavailable", "succeeded"].includes(logged.outcome)) {
      const signal = logged.outcome === "succeeded" ? logged.recoveredErrorSignal : logged.errorSignal;
      const errorClass = logged.outcome === "succeeded" ? logged.recoveredErrorClass : logged.errorClass;
      if (errorClass && signal) {
        const evidenceMetadata = normalizeRecoveryEvidence(normalizedWeek, logged.evidenceMetadata);
        const layer = recoveryLayerForAttempt(logged.attemptKind);
        const eventType = logged.outcome === "succeeded" || logged.actionCode ? "recovery" : "failure";
        const outcome = logged.outcome === "succeeded" ? "succeeded" : logged.outcome === "failed" ? "failed" : "inconclusive";
        queueRecoveryWrite({
          eventId: `${logged.executionId}-${logged.sourceId}-${logged.attempt}-${logged.outcome}`,
          week: normalizedWeek,
          sourceId: logged.sourceId,
          errorClass,
          errorSignal: signal,
          layer: layer || 1,
          runId: logged.problemRunId,
          eventType,
          attemptKind: logged.attemptKind,
          actionCode: logged.actionCode || (logged.outcome === "succeeded" ? "retry-transient" : logged.attemptKind === "first" ? "retry-transient" : "verify-only"),
          actionNote: logged.actionNote || "",
          actionPreconditions: logged.actionPreconditions || [],
          outcome,
          evidence: evidenceMetadata,
          hypothesisNote: logged.hypothesis,
          evidenceRef: `03_input/weekly/${normalizedWeek}/${logged.sourceId === "ai" ? "_ai-generated.json" : "_source-status.json"}`,
          rootCauseStatus: logged.rootCauseStatus || "unconfirmed",
          verification: "pending"
        });
      }
    }
  };
  const prepareAfterSuccess = prepareInputs ? (source) => {
    preparationQueue = preparationQueue.then(async () => {
      const began = now();
      try {
        const remainingMs = Math.max(0, maxDurationMs - (now() - startedAt));
        if (remainingMs <= 0) throw new Error("weekly-preparation-deadline-exceeded");
        await prepareInputs(source, { week: normalizedWeek, repoRoot, remainingMs });
        event({ step: "weekly-preprocess", sourceId: source.id, durationMs: Math.max(0, now() - began), outcome: "succeeded", evidence: "04_output/_dist/weekly/<week>/.preprocessing/manifest.json" });
      } catch (error) {
        const errorClass = classifyWeeklyFailure(sanitizeErrorForClassification(error)).errorClass;
        event({ step: "weekly-preprocess", sourceId: source.id, durationMs: Math.max(0, now() - began), outcome: "failed", errorClass, errorSignal: safeFailureSignal(error, errorClass), rootCauseStatus: "unconfirmed", hypothesis: errorClass, evidence: "04_output/_dist/weekly/<week>/.preprocessing/manifest.json" });
      }
      await save();
    });
    return preparationQueue;
  } : undefined;
  const sourceContext = () => {
    const context = { state, now, sleep, runSource, readOutcome, save, event, mode, week: normalizedWeek, repoRoot,
      enableFlomoReviewImport, importFlomoReviews, executionId,
      recoveryActionCode, expectedSourceVersion,
      maxDurationMs, prepareAfterSuccess, drainPreparation: () => preparationQueue, resubmitUncertainAi,
      remainingDurationMs: () => Math.max(0, maxDurationMs - (now() - startedAt)),
      runBatch: (sources, kind, overrides = {}) => runBatch(sources, kind, { ...sourceContext(), ...overrides }),
      beginAiRecovery: () => { if (aiRecoveryStarted) return false; aiRecoveryStarted = true; return true; } };
    context.releaseStateLockForAiWait = async (waitPhase = "original") => {
      const reacquire = await releaseStateLockForAiWait(waitPhase);
      return async () => {
        const recovered = await reacquire();
        if (recovered) context.state = state;
        return recovered;
      };
    };
    return context;
  };

  try {
    state = await loadState(statePath, normalizedWeek);
    if (mode === "rescue" && !state) {
      state = createWeeklyRetryState(normalizedWeek);
      event({ step: "retry-rescue", outcome: "stopped", errorClass: "retry-state-missing", evidence: STATE_FILE });
      await save();
      return { week: normalizedWeek, mode, stopped: "retry-state-missing", statePath };
    }
    state ||= createWeeklyRetryState(normalizedWeek);
    state.pendingRecoveryEvents = Array.isArray(state.pendingRecoveryEvents) ? state.pendingRecoveryEvents : [];
    for (const pending of [...state.pendingRecoveryEvents]) queueRecoveryWrite(pending);
    await reconcileInterruptedRuns(state, { now: now(), mode, event, readOutcome, weekRoot, repoRoot });
    if (mode !== "recovery") await absorbCurrentSuccesses(state, { readOutcome, now: now(), event });
    if (lockWaitMs) event({ step: "retry-rescue-wait", outcome: "waited-for-active-run", durationMs: lockWaitMs, evidence: STATE_FILE });
    await save();

    if (mode === "initial") {
      const dueFirst = selectedSources.filter((source) => source.collector && state.sources[source.id]?.attempts === 0 && state.sources[source.id]?.status === "pending");
      await runBatch(dueFirst, "first", sourceContext());
      if (!sourceId) await runEligibleAiResubmission(sourceContext());
      if (stateLockLost || !lock) return await unlockedAiWaitResult();
    }

    if (mode === "recovery") {
      const source = selectedSources[0];
      const entry = state.sources[source.id];
      const contract = RECOVERY_ACTIONS[recoveryActionCode];
      entry.recoveryActions = Array.isArray(entry.recoveryActions) ? entry.recoveryActions : [];
      const previous = await readOutcome(source).catch(() => null);
      if (classifyOutcome(source.id, previous).status === "succeeded") {
        const previousAt = Date.parse(previous.updatedAt || previous.confirmedAt || previous.completedAt || "");
        const lastAttemptAt = Date.parse(entry.lastAttemptAt || "");
        const staleForFailedState = ["failed", "needs_review", "unavailable"].includes(entry.status) && Number.isFinite(lastAttemptAt)
          && (!Number.isFinite(previousAt) || previousAt < lastAttemptAt - 1_000);
        if (!staleForFailedState) {
          if (entry.status === "succeeded") {
            await save();
            return { week: normalizedWeek, mode, sourceId, result: "already-succeeded", statePath,
              sources: { [sourceId]: { status: entry.status, attempts: entry.attempts, recoveryActions: entry.recoveryActions } } };
          }
          if (!["failed", "needs_review", "unavailable"].includes(entry.status) || !entry.lastErrorClass) {
            throw new Error("recovery-source-not-failed");
          }
          const priorErrorClass = entry.lastErrorClass;
          const priorErrorSignal = entry.lastErrorSignal;
          entry.status = "succeeded";
          entry.lastSuccessAt = new Date(now()).toISOString();
          entry.lastErrorClass = null;
          entry.lastErrorSignal = null;
          entry.problemRunId = null;
          entry.nextRetryAt = null;
          event({ step: "source-collection", sourceId: source.id, attempt: entry.attempts, attemptKind: "recovery",
            actionCode: "reconcile-output", outcome: "succeeded", recoveredErrorClass: priorErrorClass,
            recoveredErrorSignal: priorErrorSignal, evidence: sourceStatusEvidence(source, previous),
            evidenceMetadata: normalizeRecoveryEvidence(normalizedWeek, { sourceStatus: previous.status,
              sourceVersion: previous.sourceVersion || previous.skillVersion || "", count: previous.count,
              artifactSha256: previous.artifactSha256 }) });
          await save();
          return { week: normalizedWeek, mode, sourceId, result: "recovered-existing-result", statePath,
            sources: { [sourceId]: { status: entry.status, attempts: entry.attempts, recoveryActions: entry.recoveryActions } } };
        }
      }
      if (!["failed", "needs_review", "unavailable"].includes(entry.status) || !entry.lastErrorClass) throw new Error("recovery-source-not-failed");
      for (const interrupted of entry.recoveryActions.filter((action) => action.status === "running")) {
        interrupted.status = "inconclusive";
        interrupted.finishedAt = new Date(now()).toISOString();
        interrupted.resultErrorClass = "process-interrupted";
        event({ step: "recovery-action", sourceId: source.id, recoveryLayer: interrupted.layer || 2,
          actionCode: interrupted.actionCode, outcome: "inconclusive", evidence: interrupted.evidenceRef || STATE_FILE });
        queueRecoveryWrite({
          eventId: "recovery-interrupted-" + normalizedWeek + "-" + source.id + "-" + String(interrupted.runId || "unknown") + "-" + interrupted.actionCode,
          week: normalizedWeek, sourceId: source.id, errorClass: entry.lastErrorClass, errorSignal: entry.lastErrorSignal || entry.lastErrorClass,
          layer: interrupted.layer || 2, runId: interrupted.runId || "", eventType: "recovery", attemptKind: "recovery",
          actionCode: interrupted.actionCode, actionNote: RECOVERY_ACTIONS[interrupted.actionCode]?.note || "",
          actionPreconditions: RECOVERY_ACTIONS[interrupted.actionCode]?.preconditions || [], outcome: "inconclusive",
          evidence: normalizeRecoveryEvidence(normalizedWeek, entry.lastEvidence || {}),
          evidenceRef: interrupted.evidenceRef || "03_input/weekly/" + normalizedWeek + "/_source-status.json",
          rootCauseStatus: "unconfirmed", verification: "pending"
        });
      }
      if (entry.recoveryActions.some((action) => action.status === "inconclusive" && action.resultErrorClass === "process-interrupted")) await save();
      if (entry.recoveryActions.some((action) => action.actionCode === recoveryActionCode)) throw new Error("recovery-action-already-used");
      const layerTwoActions = entry.recoveryActions.filter((action) => action.layer === 2);
      if (contract.layer === 2 && layerTwoActions.length >= 2) throw new Error("recovery-layer-two-budget-exhausted");
      if (contract.layer === 3) {
        if (layerTwoActions.length < 2) throw new Error("recovery-layer-two-not-exhausted");
        if (layerTwoActions.some((action) => !["failed", "inconclusive", "needs_review", "unavailable"].includes(action.status))) {
          throw new Error("recovery-layer-two-not-exhausted");
        }
      }
      if (recoveryActionCode === "small-patch") {
        const verified = await hasVerifiedSmallPatch({ week: normalizedWeek, sourceId: source.id, problemId,
          errorSignal: entry.lastErrorSignal || "" }, { stateRoot: path.join(repoRoot, ".agents/skills/learn-x-weekly-automation/state") });
        if (!verified) throw new Error("recovery-small-patch-not-verified");
      }
      const action = { actionCode: recoveryActionCode, layer: contract.layer, runId: executionId, status: "running", at: new Date(now()).toISOString(),
        sourceVersion: String(entry.lastEvidence?.sourceVersion || ""), evidenceRef: `03_input/weekly/${normalizedWeek}/_source-status.json` };
      entry.recoveryActions.push(action);
      event({ step: "recovery-action", sourceId: source.id, recoveryLayer: contract.layer, actionCode: recoveryActionCode,
        outcome: "started", evidence: action.evidenceRef });
      await save();
      await runBatch([source], contract.layer === 3 ? "patch" : "recovery", sourceContext());
      action.status = state.sources[source.id].status;
      action.finishedAt = new Date(now()).toISOString();
      action.resultErrorClass = state.sources[source.id].lastErrorClass || null;
      event({ step: "recovery-action", sourceId: source.id, recoveryLayer: contract.layer, actionCode: recoveryActionCode,
        outcome: action.status, evidence: action.evidenceRef });
      await save();
    }

    if (mode === "manual") {
      const source = selectedSources[0], entry = state.sources[source.id];
      let blockedByCooldown = false;
      if (entry.status === "failed" && isRetryableClass(entry.lastErrorClass) && Date.parse(entry.nextRetryAt || "") > now()) {
        const delayMs = Date.parse(entry.nextRetryAt) - now();
        const remainingMs = maxDurationMs - (now() - startedAt);
        if (delayMs > remainingMs) {
          event({ step: "manual-refresh", sourceId: source.id, outcome: "cooldown-exceeds-bounded-window", nextRetryAt: entry.nextRetryAt, evidence: STATE_FILE });
          blockedByCooldown = true;
        } else {
          event({ step: "retry-wait", sourceId: source.id, attemptKind: "manual", outcome: "waiting", delayMs, evidence: STATE_FILE });
          await save();
          await sleep(delayMs);
        }
      }
      if (!blockedByCooldown && now() - startedAt < maxDurationMs) {
        let retryCount = 0;
        await runBatch([source], "manual", sourceContext());
        while (sourceId !== "ai" && now() - startedAt < maxDurationMs) {
          const current = state.sources[source.id];
          if (current.status !== "failed" || !isRetryableClass(current.lastErrorClass) || retryCount >= source.retries) break;
          const retryAt = Date.parse(current.nextRetryAt || "");
          if (!Number.isFinite(retryAt)) break;
          const delayMs = Math.max(0, retryAt - now());
          const remainingMs = maxDurationMs - (now() - startedAt);
          if (delayMs > remainingMs) {
            event({ step: "retry-wait", sourceId: source.id, attemptKind: "manual", outcome: "bounded-window-ending", delayMs: remainingMs, evidence: STATE_FILE });
            await save();
            break;
          }
          if (delayMs > 0) {
            event({ step: "retry-wait", sourceId: source.id, attemptKind: "manual", outcome: "waiting", delayMs, evidence: STATE_FILE });
            await save();
            await sleep(delayMs);
          }
          if (now() - startedAt >= maxDurationMs) break;
          retryCount += 1;
          await runBatch([source], "retry", sourceContext());
        }
      }
    }

    while (mode === "initial" && now() - startedAt < maxDurationMs) {
      const due = selectedSources.filter((source) => canRetrySource(source, state.sources[source.id], mode, now()));
      if (!due.length) {
        const pending = selectedSources
          .filter((source) => source.collector && state.sources[source.id]?.status === "failed" && isRetryableClass(state.sources[source.id]?.lastErrorClass) && state.sources[source.id].attempts <= source.retries)
          .map((source) => Date.parse(state.sources[source.id].nextRetryAt)).filter(Number.isFinite);
        if (!pending.length) break;
        const nextAt = Math.min(...pending);
        const waitMs = Math.min(Math.max(0, nextAt - now()), maxDurationMs - (now() - startedAt));
        if (waitMs <= 0) break;
        event({ step: "retry-wait", outcome: "waiting", delayMs: waitMs, evidence: STATE_FILE });
        await save();
        await sleep(waitMs);
        if (now() - startedAt >= maxDurationMs) break;
        continue;
      }
      await runBatch(due, "retry", sourceContext());
    }

    if (mode === "rescue") {
      while (now() - startedAt < maxDurationMs) {
        const dueRescue = selectedSources.filter((source) => canRetrySource(source, state.sources[source.id], mode, now()));
        if (dueRescue.length) {
          for (const source of dueRescue) state.sources[source.id].rescueUsed = true;
          await save();
          await runBatch(dueRescue, "rescue", sourceContext());
          continue;
        }
        const pendingTimes = selectedSources
          .filter((source) => source.collector && source.queue !== "external" && source.queue !== "manual")
          .map((source) => state.sources[source.id])
          .filter((entry) => entry.status === "failed" && !entry.rescueUsed && isRetryableClass(entry.lastErrorClass) && Number.isFinite(Date.parse(entry.nextRetryAt)))
          .map((entry) => Date.parse(entry.nextRetryAt));
        if (!pendingTimes.length) break;
        const remainingMs = maxDurationMs - (now() - startedAt);
        const untilNext = Math.max(0, Math.min(...pendingTimes) - now());
        const waitMs = Math.min(untilNext, remainingMs);
        if (!waitMs) break;
        event({ step: "retry-wait", attemptKind: "rescue", outcome: waitMs < untilNext ? "bounded-window-ending" : "waiting", delayMs: waitMs, evidence: STATE_FILE });
        await save();
        await sleep(waitMs);
        if (waitMs < untilNext) break;
      }
      if (now() - startedAt >= maxDurationMs) {
        event({ step: "retry-rescue", outcome: "bounded-window-ended", evidence: STATE_FILE });
        await save();
      }
      if (!sourceId) await runEligibleAiResubmission(sourceContext());
      if (stateLockLost || !lock) return await unlockedAiWaitResult();
    }

    await save();
    await recoveryQueue;
    await save();
    let manualFallback;
    if (["failed", "needs_review"].includes(state.sources.ai?.status)) {
      try {
        const sidecar = JSON.parse(await readFile(path.join(weekRoot, "_ai-generated.json"), "utf8"));
        if (sidecar.targetWeek === normalizedWeek && typeof sidecar.manualPrompt === "string" && sidecar.manualPrompt.length > 0) {
          manualFallback = { status: sidecar.status, reason: sidecar.reason || null,
            path: `03_input/weekly/${normalizedWeek}/ai.md`, prompt: sidecar.manualPrompt };
        }
      } catch { /* Missing or invalid business sidecar remains an explicit unknown. */ }
    }
    const recoveryAdvice = {};
    const adviceLayer = recoveryActionCode === "small-patch" ? 3 : ["rescue", "recovery", "manual"].includes(mode) ? 2 : 1;
    for (const [id, entry] of Object.entries(state.sources)) {
      if (entry.status !== "failed" && entry.status !== "needs_review") continue;
      const advice = await queryRecoveryPlaybook({ sourceId: id, errorClass: entry.lastErrorClass || "", errorSignal: entry.lastErrorSignal || "",
        sourceVersion: entry.lastEvidence?.sourceVersion || "", layer: adviceLayer,
        satisfiedPreconditions: ["same-target-week"] }, { stateRoot: path.join(repoRoot, ".agents/skills/learn-x-weekly-automation/state") });
      if (advice.recommendations?.length) recoveryAdvice[id] = advice.recommendations;
    }
    return {
      week: normalizedWeek,
      mode,
      statePath,
      sources: Object.fromEntries(Object.entries(state.sources).map(([id, item]) => [id, { status: item.status, attempts: item.attempts, retries: item.retries, rescueUsed: item.rescueUsed,
        recoveryActions: item.recoveryActions || [], problemRunId: item.problemRunId || null,
        lastErrorClass: item.lastErrorClass, nextRetryAt: item.nextRetryAt }])),
      alerts: await repeatedFailureAlerts(state, repoRoot),
      recoveryAdvice,
      ...(manualFallback ? { manualFallback } : {}),
      recoveryMemory: { status: recoveryWriteErrors.length ? "partial" : "ready", writeFailures: recoveryWriteErrors.length,
        pendingEvents: state.pendingRecoveryEvents.length }
    };
  } finally {
    await saveQueue.catch(() => {});
    await recoveryQueue.catch(() => {});
    await lock?.release();
  }

  async function unlockedAiWaitResult() {
    const latest = await loadState(statePath, normalizedWeek).catch(() => null);
    let manualFallback;
    try {
      const sidecar = JSON.parse(await readFile(path.join(weekRoot, "_ai-generated.json"), "utf8"));
      if (sidecar.targetWeek === normalizedWeek && typeof sidecar.manualPrompt === "string" && sidecar.manualPrompt.length > 0) {
        manualFallback = { status: sidecar.status, reason: sidecar.reason || null,
          path: `03_input/weekly/${normalizedWeek}/ai.md`, prompt: sidecar.manualPrompt };
      }
    } catch { /* A missing business sidecar stays unknown; never write while unlocked. */ }
    return { week: normalizedWeek, mode, statePath, skipped: "supervisor-state-lock-reacquire-timeout",
      sources: latest ? Object.fromEntries(Object.entries(latest.sources).map(([id, item]) => [id, { status: item.status,
        attempts: item.attempts, retries: item.retries, rescueUsed: item.rescueUsed, recoveryActions: item.recoveryActions || [],
        problemRunId: item.problemRunId || null, lastErrorClass: item.lastErrorClass, nextRetryAt: item.nextRetryAt }])) : {},
      diagnostic: stateLockDiagnostic || { step: "supervisor-state-lock", outcome: "reacquire-failed",
        requiredBudgetMs: AI_WAIT_REACQUIRE_MIN_BUDGET_MS },
      ...(manualFallback ? { manualFallback } : {}) };
  }
}

async function runBatch(sources, kind, context) {
  const groups = new Map();
  for (const source of sources) {
    const list = groups.get(source.queue) || [];
    list.push(source);
    groups.set(source.queue, list);
  }
  const limits = { cli: 3, browser: 1, external: 1, manual: 1 };
  await Promise.all([...groups.entries()].map(async ([queue, items]) => {
    const limit = limits[queue] || 1;
    let index = 0;
    const worker = async () => {
      while (index < items.length) {
        const source = items[index++];
        await runOneSource(source, kind, context);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }));
  await context.drainPreparation?.();
  if (context.enableFlomoReviewImport) await runEligibleFlomoReviewImport(context);
}

async function runEligibleFlomoReviewImport(context) {
  if (context.state.sources.flomo?.status !== "succeeded" || context.state.sources.wisdom?.status !== "succeeded") return;
  const prior = context.state.flomoReviewImport;
  if (prior?.status === "succeeded" || prior?.executionId === context.executionId) return;
  if ((context.remainingDurationMs?.() ?? 0) <= 0) {
    context.state.flomoReviewImport = { status: "pending", executionId: context.executionId, reason: "shared-deadline-exceeded", at: new Date(context.now()).toISOString() };
    context.event({ step: "flomo-review-import", sourceId: "wisdom", outcome: "skipped-deadline", evidence: "共享执行截止时间" });
    await context.save();
    return;
  }
  context.state.flomoReviewImport = { status: "running", executionId: context.executionId, at: new Date(context.now()).toISOString() };
  context.event({ step: "flomo-review-import", sourceId: "wisdom", outcome: "started", evidence: "Flomo 与 Wisdom Base 来源状态均成功" });
  await context.save();
  let browserQueueLock;
  try {
    browserQueueLock = await acquireBrowserQueue(context);
    const result = await context.importFlomoReviews(context.week, context.repoRoot);
    context.state.flomoReviewImport = { status: "succeeded", executionId: context.executionId, at: new Date(context.now()).toISOString(),
      scanned: Number(result?.scanned) || 0, candidates: Number(result?.candidates) || 0,
      alreadyImported: Number(result?.alreadyImported) || 0, created: Number(result?.created) || 0,
      skipped: Number(result?.skipped) || 0 };
    context.event({ step: "flomo-review-import", sourceId: "wisdom", outcome: "succeeded", ...context.state.flomoReviewImport,
      evidence: "智慧之门来源键读回" });
  } catch (error) {
    const errorClass = classifyWeeklyFailure(sanitizeErrorForClassification(error), { sourceId: "wisdom" }).errorClass;
    const errorSignal = safeFailureSignal(error, errorClass);
    context.state.flomoReviewImport = { status: "failed", executionId: context.executionId, at: new Date(context.now()).toISOString(), errorClass, errorSignal };
    context.event({ step: "flomo-review-import", sourceId: "wisdom", outcome: "failed", errorClass, errorSignal,
      rootCauseStatus: "unconfirmed", evidence: "依赖状态诊断" });
  } finally {
    await browserQueueLock?.release();
    await context.save();
  }
}

async function runEligibleAiResubmission(context) {
  const source = WEEKLY_SOURCE_CONFIG.find((item) => item.id === "ai");
  const entry = context.state.sources.ai;
  if (!["needs_review", "succeeded"].includes(entry?.status)) return false;
  let isReservedReplacement = false;
  let priorAi;
  try {
    priorAi = JSON.parse(await readFile(path.join(context.repoRoot, "03_input/weekly", context.week, "_ai-generated.json"), "utf8"));
    isReservedReplacement = priorAi?.resubmissionCount === 1 && Boolean(priorAi.resubmissionOf);
    if (priorAi.targetWeek !== context.week
      || typeof priorAi.runId !== "string" || typeof priorAi.conversationUrl !== "string") return false;
    if (entry.status === "needs_review" && priorAi.status !== "needs_review"
      && !(isReservedReplacement && ["generated", "confirmed"].includes(priorAi.status))) return false;
    if (entry.status === "succeeded" && !(isReservedReplacement && ["generated", "confirmed"].includes(priorAi.status))) return false;
  } catch { return false; }
  if (context.beginAiRecovery && !context.beginAiRecovery()) return false;
  const weekDir = path.join(context.repoRoot, "03_input/weekly", context.week);
  const aiLock = await tryAcquireWeeklyAiLock(weekDir);
  if (!aiLock) {
    context.event({ step: "ai-uncertain-observation", sourceId: "ai", outcome: "skipped-active-ai-run", evidence: "03_input/weekly/<week>/.weekly-ai.lock" });
    await context.save();
    return false;
  }
  const lockedContext = { ...context, weeklyAiLockToken: aiLock.token };
  try {
    context.event({ step: "ai-uncertain-observation", sourceId: "ai", outcome: "started", evidence: "_ai-generated.json 原 runId 与会话地址" });
    await context.save();
    if (isReservedReplacement && ["generated", "confirmed"].includes(priorAi.status)) {
      return await observeReservedAiReplacement(context, lockedContext, source, weekDir, priorAi);
    }
    const remainingMs = context.remainingDurationMs?.() ?? 810_000;
    if (remainingMs <= 90_000) {
      context.event({ step: "ai-uncertain-observation", sourceId: "ai", outcome: "skipped-insufficient-observation-budget",
        remainingMs, evidence: "保留完整手动提示词；不启动超出共享截止时间的观察" });
      await context.save();
      return true;
    }
    const observeSeconds = Math.max(1, Math.min(60, Math.floor(remainingMs / 1000) - 30));
    try { priorAi = JSON.parse(await readFile(path.join(context.repoRoot, "03_input/weekly", context.week, "_ai-generated.json"), "utf8")); }
    catch { return false; }
    if (priorAi.resubmissionCount === 1 && priorAi.resubmissionOf) {
      return await observeReservedAiReplacement(context, lockedContext, source, weekDir, priorAi);
    }
    await context.runBatch([source], "observe-existing", { ...lockedContext, observeUncertainAi: true, observeWaitSeconds: observeSeconds });
    if (context.state.sources.ai?.status === "succeeded") return true;
    try { priorAi = JSON.parse(await readFile(path.join(context.repoRoot, "03_input/weekly", context.week, "_ai-generated.json"), "utf8")); }
    catch { return true; }
    let eligible = false;
    try { eligible = await canResubmitUncertainAi({ repoRoot: context.repoRoot, week: context.week, nowMs: context.now() }); }
    catch { return false; }
    if (!eligible) {
      const dispatchStartedAt = Date.parse(priorAi.dispatchStartedAt || priorAi.startedAt || "");
      const resubmitAt = Number.isFinite(dispatchStartedAt) ? dispatchStartedAt + AI_UNCERTAIN_RESUBMIT_AFTER_MS : NaN;
      const waitMs = resubmitAt - context.now();
      if (Number.isFinite(resubmitAt) && waitMs > 0) {
        let eligibleAtDeadline = false;
        try {
          // This hypothetical-time check proves every non-time gate before we wait.
          eligibleAtDeadline = await canResubmitUncertainAi({ repoRoot: context.repoRoot, week: context.week, nowMs: resubmitAt });
        } catch { return false; }
        if (!eligibleAtDeadline) {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "blocked-by-non-time-gate",
            reasonCode: "resubmission-eligibility-failed-at-deadline", evidence: "20分钟假定边界不满足会话、身份、prompt或产物门禁；保留手动提示词" });
          await context.save();
          return true;
        }
        const requiredBudgetMs = waitMs + AI_WAIT_REACQUIRE_MIN_BUDGET_MS;
        if ((context.remainingDurationMs?.() ?? 0) < requiredBudgetMs) {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "skipped-deadline-budget",
            waitMs, requiredBudgetMs, evidence: "剩余预算不足以等到20分钟门限、复看原run并完成单次重开观察；保留完整手动提示词" });
          await context.save();
          return true;
        }
        const originalRunId = priorAi.runId;
        context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "waiting-for-20m-deadline",
          waitMs, deadlineAt: new Date(resubmitAt).toISOString(), requiredBudgetMs,
          evidence: "身份、会话、prompt指纹及可重开原因均已通过；等待期间释放周记状态锁和Browser队列，保留周记AI锁" });
        await context.save();
        const reacquireStateLock = await context.releaseStateLockForAiWait?.();
        await context.sleep(waitMs);
        if (reacquireStateLock) {
          if (!await reacquireStateLock()) return true;
          lockedContext.state = context.state;
        }
        if (context.now() < resubmitAt) {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "deadline-wait-incomplete",
            waitMs: Math.max(0, resubmitAt - context.now()), evidence: "单次定时等待提前返回；不重开" });
          await context.save();
          return true;
        }
        let atDeadlineSidecar;
        try { atDeadlineSidecar = JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8")); }
        catch { return true; }
        if (atDeadlineSidecar.targetWeek !== context.week || atDeadlineSidecar.runId !== originalRunId
          || atDeadlineSidecar.localAttemptId !== originalRunId) {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "stopped-original-identity-changed",
            evidence: "等待后原run标识或目标周发生变化；不观察不明任务、不重开" });
          await context.save();
          return true;
        }
        context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "deadline-reobserving-original",
          evidence: "到达派发后20分钟边界，重新观察绑定的原run" });
        await context.save();
        await context.runBatch([source], "observe-original-at-20m-deadline", {
          ...lockedContext, observeUncertainAi: true, observeWaitSeconds: 60
        });
        if (context.state.sources.ai?.status === "succeeded") {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "late-original-result",
            evidence: "原run在20分钟门限复看时取得并校验为可用结果" });
          await context.save();
          return true;
        }
        try { priorAi = JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8")); }
        catch { return true; }
        try { eligible = await canResubmitUncertainAi({ repoRoot: context.repoRoot, week: context.week, nowMs: context.now() }); }
        catch { return false; }
        if (!eligible) {
          context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "stopped-after-deadline-recheck",
            evidence: "边界复看后重新读取sidecar、正式ai.md及结果；身份、产物或安全门槛不再满足" });
          await context.save();
          return true;
        }
      }
    }
    if (!eligible) return false;
    // Reserve the bridge dispatch budget, the full late-result window and finalization margin.
    if ((context.remainingDurationMs?.() ?? 0) < AI_RESUBMISSION_REQUIRED_BUDGET_MS) {
      context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "skipped-deadline", evidence: "剩余执行预算不足以派发并完整观察第二个20分钟窗口" });
      return true;
    }
    context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "one-shot-resubmission-eligible", evidence: "原 run 已观察满20分钟、身份与 prompt 指纹匹配" });
    await context.save();
    await context.runBatch([source], "uncertain-resubmission", { ...lockedContext, resubmitUncertainAi: true, automaticResubmitAi: true });
    let replacement;
    try { replacement = JSON.parse(await readFile(path.join(context.repoRoot, "03_input/weekly", context.week, "_ai-generated.json"), "utf8")); }
    catch {
      context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "unknown-dispatch-receipt", evidence: "_ai-generated.json" });
      await context.save();
      return true;
    }
    const replacementId = replacement.localAttemptId || replacement.runId;
    const replacementStartedAt = Date.parse(replacement.dispatchStartedAt || "");
    if (replacement.resubmissionCount !== 1 || !replacement.resubmissionOf || typeof replacementId !== "string"
      || !Number.isFinite(replacementStartedAt)) {
      context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "unknown-dispatch-receipt", evidence: "_ai-generated.json" });
      await context.save();
      return true;
    }
    context.event({ step: "ai-uncertain-resubmission", sourceId: "ai", outcome: "one-shot-reserved-dispatched",
      runId: replacementId, parentAttemptId: replacement.resubmissionOf.runId || null,
      reservedAt: replacement.resubmissionReservedAt || null, dispatchStartedAt: replacement.dispatchStartedAt,
      dispatchStatus: ["dispatching", "needs_review", "generated", "confirmed", "failed"].includes(replacement.status) ? replacement.status : "unknown",
      evidence: "_ai-generated.json 的原子 resubmissionCount 与父run读回" });
    await context.save();
    return await observeReservedAiReplacement(context, lockedContext, source, weekDir, replacement);
  } finally {
    await aiLock.release();
  }
}

async function observeReservedAiReplacement(context, lockedContext, source, weekDir, receipt) {
  const replacementId = receipt.localAttemptId || receipt.runId;
  const replacementStartedAt = Date.parse(receipt.dispatchStartedAt || "");
  if (receipt.targetWeek !== context.week || receipt.resubmissionCount !== 1 || !receipt.resubmissionOf
    || typeof replacementId !== "string" || !Number.isFinite(replacementStartedAt)) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "unknown-dispatch-receipt", evidence: "_ai-generated.json" });
    await context.save();
    return true;
  }
  if (receipt.status === "generated") {
    let promotion;
    try {
      promotion = await promoteAiReview({ repoRoot: context.repoRoot, week: context.week, confirm: true,
        weeklyAiLockToken: lockedContext.weeklyAiLockToken });
    } catch (error) {
      const entry = context.state.sources.ai;
      entry.status = "needs_review";
      entry.lastErrorClass = "ai-submission-state-uncertain";
      entry.lastErrorSignal = safeFailureSignal(error, entry.lastErrorClass);
      context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "replacement-generated-promotion-failed",
        runId: replacementId, errorClass: entry.lastErrorClass, errorSignal: entry.lastErrorSignal,
        rootCauseStatus: "unconfirmed", evidence: "generated结果保留；正式ai.md晋升失败，不重复生成" });
      await context.save();
      return true;
    }
    if (promotion.status === "confirmed") {
      const entry = context.state.sources.ai;
      entry.status = "succeeded";
      entry.lastSuccessAt ||= new Date(context.now()).toISOString();
      entry.lastErrorClass = null;
      entry.lastErrorSignal = null;
      entry.nextRetryAt = null;
      entry.problemRunId = null;
    } else {
      const entry = context.state.sources.ai;
      entry.status = "needs_review";
      entry.lastErrorClass = promotion.reason === "formal-ai-md-has-human-content"
        ? "manual-review-required" : "ai-submission-state-uncertain";
      entry.lastErrorSignal = safeFailureSignal(promotion.reason || "generated-promotion-unconfirmed", entry.lastErrorClass);
      entry.nextRetryAt = null;
    }
    context.event({ step: "ai-resubmission-observation", sourceId: "ai",
      outcome: promotion.status === "confirmed" ? "replacement-generated-promoted" : "replacement-generated-promotion-needs-review",
      runId: replacementId, errorClass: context.state.sources.ai.lastErrorClass || null,
      errorSignal: context.state.sources.ai.lastErrorSignal || null,
      evidence: promotion.status === "confirmed" ? "generated正文、ai.md和confirmed侧车摘要读回一致；不等待或重复观察"
        : "generated结果保留；正式ai.md晋升需要人工核验" });
    await context.save();
    return true;
  }
  if (receipt.status === "confirmed") {
    const readbackIssue = await confirmedReplacementReadbackIssue(weekDir, receipt);
    if (!readbackIssue) {
      const entry = context.state.sources.ai;
      entry.status = "succeeded";
      entry.lastSuccessAt ||= new Date(context.now()).toISOString();
      entry.lastErrorClass = null;
      entry.lastErrorSignal = null;
      entry.nextRetryAt = null;
      entry.problemRunId = null;
      context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "replacement-delivery-readback-verified",
        runId: replacementId, evidence: "目标周ai.md摘要与confirmed侧车读回一致" });
      await context.save();
      return true;
    }
    const entry = context.state.sources.ai;
    entry.status = "needs_review";
    entry.lastErrorClass = "ai-submission-state-uncertain";
    entry.lastErrorSignal = readbackIssue;
    entry.nextRetryAt = null;
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "replacement-delivery-readback-failed",
      runId: replacementId, reasonCode: readbackIssue, evidence: "不等待已确认但缺失/改变的正式ai.md；保留完整手动提示词" });
    await context.save();
    return true;
  }
  const deadline = replacementStartedAt + AI_REPLACEMENT_OBSERVATION_MS;
  if (AI_TERMINAL_OBSERVATION_REASONS.has(receipt.reason) || AI_TERMINAL_OBSERVATION_REASONS.has(receipt.observation?.reason)) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "stopped-terminal-reason",
      reasonCode: AI_TERMINAL_OBSERVATION_REASONS.has(receipt.reason) ? receipt.reason : receipt.observation.reason,
      elapsedMs: Math.max(0, context.now() - replacementStartedAt),
      evidence: "已知身份、权限、提交或人工内容门禁失败；保留完整手动提示词" });
    await context.save();
    return true;
  }
  const waitMs = Math.max(0, deadline - context.now());
  const requiredBudgetMs = waitMs + AI_REPLACEMENT_FINALIZATION_BUDGET_MS;
  if ((context.remainingDurationMs?.() ?? 0) < requiredBudgetMs) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "skipped-replacement-window-budget",
      waitMs, requiredBudgetMs, evidence: "剩余预算不足以等待replacement边界并完成一次最终观察；保留完整手动提示词" });
    await context.save();
    return true;
  }
  if (waitMs > 0) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "waiting-for-replacement-20m-deadline",
      waitMs, deadlineAt: new Date(deadline).toISOString(),
      evidence: "保留周记AI锁；释放共享周记状态锁与Browser队列，避免阻塞人工Flomo和阶段记录" });
    await context.save();
    const reacquireStateLock = await context.releaseStateLockForAiWait?.("replacement");
    await context.sleep(waitMs);
    if (reacquireStateLock) {
      if (!await reacquireStateLock()) return true;
      lockedContext.state = context.state;
    }
    if (context.now() < deadline) {
      context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "replacement-deadline-wait-incomplete",
        waitMs: Math.max(0, deadline - context.now()), evidence: "单次定时等待提前返回；不重复提交" });
      await context.save();
      return true;
    }
  }
  const current = await readFile(path.join(weekDir, "_ai-generated.json"), "utf8")
    .then((value) => JSON.parse(value)).catch(() => null);
  if (!current || current.targetWeek !== context.week
    || (current.localAttemptId || current.runId) !== replacementId
    || current.resubmissionCount !== 1 || current.resubmissionOf?.runId !== receipt.resubmissionOf.runId) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "stopped-replacement-identity-changed",
      evidence: "replacement收据、目标周或父run发生变化；保留完整手动提示词" });
    await context.save();
    return true;
  }
  if (AI_TERMINAL_OBSERVATION_REASONS.has(current.reason) || AI_TERMINAL_OBSERVATION_REASONS.has(current.observation?.reason)) {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "stopped-terminal-reason",
      reasonCode: AI_TERMINAL_OBSERVATION_REASONS.has(current.reason) ? current.reason : current.observation.reason,
      elapsedMs: Math.max(0, context.now() - replacementStartedAt),
      evidence: "已知身份、权限、提交或人工内容门禁失败；保留完整手动提示词" });
    await context.save();
    return true;
  }
  context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "observing-replacement-at-20m-deadline",
    runId: replacementId, elapsedMs: Math.max(0, context.now() - replacementStartedAt),
    evidence: "在replacement派发后20分钟边界执行一次最终观察" });
  await context.save();
  await context.runBatch([source], "observe-resubmitted-run", {
    ...lockedContext, observeUncertainAi: true, observeWaitSeconds: 60
  });
  if (context.state.sources.ai?.status !== "succeeded") {
    context.event({ step: "ai-resubmission-observation", sourceId: "ai", outcome: "window-ended",
      elapsedMs: Math.max(0, context.now() - replacementStartedAt),
      evidence: "20分钟边界观察未取得可晋升结果；保留完整手动提示词" });
    await context.save();
  }
  return true;
}

async function confirmedReplacementReadbackIssue(weekDir, receipt) {
  let raw;
  try { raw = await readFile(path.join(weekDir, "ai.md"), "utf8"); }
  catch (error) { return error.code === "ENOENT" ? "confirmed-ai-md-missing" : "confirmed-ai-md-changed"; }
  const normalized = normalizeAiReviewText(raw);
  if (!validateAiReview(normalized).valid) return "confirmed-ai-md-changed";
  if (receipt.manualConfirmation?.sha256) {
    return sha256(raw) === receipt.manualConfirmation.sha256 ? null : "confirmed-ai-md-changed";
  }
  const actualHash = sha256(normalized);
  if (receipt.outputSha256 !== actualHash
    || (receipt.readbackSha256 && receipt.readbackSha256 !== actualHash)) return "confirmed-ai-md-changed";
  return null;
}

async function runOneSource(source, kind, context) {
  const entry = context.state.sources[source.id];
  const priorStatus = entry.status;
  const priorErrorSignal = entry.lastErrorSignal || "";
  const priorProblemRunId = entry.problemRunId || "";
  if ((context.remainingDurationMs?.() ?? context.maxDurationMs) <= 0) {
    context.event({ step: "source-collection", sourceId: source.id, attemptKind: kind, outcome: "skipped-deadline", evidence: STATE_FILE });
    await context.save();
    return;
  }
  let weeklyAiLock = null;
  if (source.id === "ai") {
    if (context.weeklyAiLockToken) {
      if (!await validateWeeklyAiLockToken(path.join(context.repoRoot, "03_input/weekly", context.week), context.weeklyAiLockToken)) {
        context.event({ step: "source-collection", sourceId: source.id, attemptKind: kind, outcome: "skipped-invalid-ai-lock", evidence: "03_input/weekly/<week>/.weekly-ai.lock" });
        await context.save();
        return;
      }
    } else {
      weeklyAiLock = await tryAcquireWeeklyAiLock(path.join(context.repoRoot, "03_input/weekly", context.week));
      if (!weeklyAiLock) {
        context.event({ step: "source-collection", sourceId: source.id, attemptKind: kind, outcome: "skipped-active-ai-run", evidence: "03_input/weekly/<week>/.weekly-ai.lock" });
        await context.save();
        return;
      }
    }
  }
  const attempt = entry.attempts + 1;
  const began = context.now();
  const attemptToken = source.id === "flomo" ? randomUUID() : null;
  const previousActiveAttemptToken = entry.activeAttemptToken ?? null;
  entry.status = "running";
  entry.attempts = attempt;
  entry.lastAttemptAt = new Date(began).toISOString();
  entry.nextRetryAt = null;
  if (attemptToken) {
    entry.activeAttemptToken = attemptToken;
  }
  if (kind === "rescue") entry.rescueUsed = true;
  context.event({ step: "source-collection", sourceId: source.id, attempt, attemptKind: kind, outcome: "started", evidence: STATE_FILE });
  try { await context.save(); }
  catch (error) { await weeklyAiLock?.release(); throw error; }

  let outcome;
  let browserQueueLock = null;
  let attemptGuardWritten = false;
  try {
    if (source.queue === "browser") browserQueueLock = await acquireBrowserQueue(context);
    if (attemptToken) {
      await writeFlomoAttemptGuard(context.repoRoot, context.week, { token: attemptToken, active: true, startedAt: entry.lastAttemptAt });
      attemptGuardWritten = true;
    }
    const result = await context.runSource(source, {
      week: context.week, repoRoot: context.repoRoot, attempt, attemptKind: kind,
      recoveryActionCode: context.recoveryActionCode,
      expectedSourceVersion: context.expectedSourceVersion,
      attemptToken,
      resubmitUncertainAi: Boolean(context.resubmitUncertainAi && source.id === "ai"),
      automaticResubmit: Boolean(context.automaticResubmitAi && source.id === "ai"),
      weeklyAiLockToken: source.id === "ai" ? (context.weeklyAiLockToken || weeklyAiLock?.token) : undefined,
      observeUncertainAi: Boolean(context.observeUncertainAi && source.id === "ai"),
      observeWaitSeconds: context.observeWaitSeconds,
      timeoutMs: context.remainingDurationMs?.(),
      allowFlomoReviewImport: context.enableFlomoReviewImport && source.id === "wisdom",
      importFlomoReviews: async (week, repoRoot) => {
        const dependencyLock = await acquireBrowserQueue(context);
        try { return await context.importFlomoReviews(week, repoRoot); }
        finally { await dependencyLock.release(); }
      },
      onDependencyResult: async (result) => {
        if (result.outcome === "succeeded" || result.outcome === "failed") state.flomoReviewImport = {
          status: result.outcome, executionId: context.executionId, at: new Date(context.now()).toISOString(),
          ...(result.outcome === "succeeded" ? { scanned: Number(result.scanned) || 0, candidates: Number(result.candidates) || 0,
            alreadyImported: Number(result.alreadyImported) || 0, created: Number(result.created) || 0, skipped: Number(result.skipped) || 0 } :
            { errorClass: result.errorClass || "unknown-failure", errorSignal: result.errorSignal || "UNKNOWN-FAILURE" })
        };
        context.event({ step: "flomo-review-import", sourceId: source.id, ...result,
          evidence: result.outcome === "succeeded" ? "智慧之门来源键读回" : "依赖状态诊断" });
        await context.save();
      }
    });
    if (result && typeof result === "object" && typeof result.status === "string") {
      outcome = result;
    } else {
      const current = await context.readOutcome(source);
      outcome = freshOutcome(current, began) && ["ready", "empty", "generated", "confirmed", "needs_review", "unavailable"].includes(current.status)
        ? current
        : { status: "failed", error: "collector-result-missing" };
    }
  } catch (error) {
    const current = await context.readOutcome(source).catch(() => null);
    // The AI CLI exits with code 2 for a recorded needs_review result. A fresh
    // sidecar is authoritative for that exit; keep its uncertainty state.
    outcome = source.id === "ai" && freshOutcome(current, began) && ["generated", "confirmed", "needs_review"].includes(current.status)
      ? current
      : { status: "failed", error: sanitizeErrorForClassification(error), code: error?.code, timedOut: Boolean(error?.killed || error?.signal === "SIGTERM") };
  }
  if (context.recoveryActionCode === "upgrade-official-skill" && ["ready", "empty", "succeeded"].includes(outcome?.status)
    && outcome.sourceVersion !== context.expectedSourceVersion) {
    outcome = { status: "failed", error: "weread-skill-version-unverifiable" };
  }
  try {
    if (attemptToken) {
      let attemptGuardRetired = false;
      if (attemptGuardWritten) {
        try {
          await retireFlomoAttemptGuard(context.repoRoot, context.week, attemptToken);
          attemptGuardRetired = true;
        } catch (error) {
          const failure = classifyWeeklyFailure(sanitizeErrorForClassification(error), { sourceId: "flomo", code: error?.code });
          if (failure.errorClass !== "review-store-lock-busy") throw error;
          outcome = { status: "failed", error: failure.errorClass };
        }
      }
      if (attemptGuardRetired) {
        entry.activeAttemptToken = null;
        const snapshot = outcome?.snapshotId ? {
          snapshotId: outcome.snapshotId, capturedAt: outcome.capturedAt,
          coverage: outcome.coverage ? { ...outcome.coverage } : null,
          termination: outcome.termination ? { ...outcome.termination } : null,
        } : null;
        if (snapshot) entry.lastSnapshot = snapshot;
      } else if (!attemptGuardWritten) {
        entry.activeAttemptToken = previousActiveAttemptToken;
      }
    }
  } finally {
    await browserQueueLock?.release();
  }
  let classified;
  try {
  classified = classifyOutcome(source.id, outcome);
  const durationMs = Math.max(0, context.now() - began);
  const previousErrorClass = entry.lastErrorClass;
  const errorSignal = ["failed", "needs_review", "unavailable"].includes(classified.status)
    ? safeFailureSignal(outcome, classified.errorClass) : null;
  entry.status = classified.status;
  entry.lastDurationMs = durationMs;
  entry.lastErrorClass = classified.errorClass;
  if (classified.status === "succeeded") {
    entry.lastSuccessAt = new Date(context.now()).toISOString();
    entry.nextRetryAt = null;
    entry.sameErrorCount = 0;
    entry.problemRunId = null;
  } else if (classified.retryable) {
    entry.lastFailureAt = new Date(context.now()).toISOString();
    const retryGap = source.id === "flomo" ? FLOMO_RETRY_GAP_MS : DEFAULT_RETRY_GAP_MS;
    entry.nextRetryAt = new Date(context.now() + Math.max(retryGap, classified.retryAfterMs)).toISOString();
  } else {
    entry.lastFailureAt = new Date(context.now()).toISOString();
    entry.nextRetryAt = null;
  }
  if (classified.status === "failed" || classified.status === "needs_review" || classified.status === "unavailable") {
    entry.lastErrorSignal = errorSignal;
    const continuesProblem = priorProblemRunId && priorErrorSignal === errorSignal && priorStatus !== "succeeded";
    entry.problemRunId = continuesProblem ? priorProblemRunId : `issue-${randomUUID()}`;
  }
  if (classified.status !== "succeeded" && classified.status !== "needs_review") {
    entry.sameErrorCount = previousErrorClass === classified.errorClass ? entry.sameErrorCount + 1 : 1;
  }
  context.event({
    step: "source-collection", sourceId: source.id, attempt, attemptKind: kind,
    ...(context.recoveryActionCode ? { actionCode: context.recoveryActionCode, actionNote: RECOVERY_ACTIONS[context.recoveryActionCode]?.note || "",
      actionPreconditions: RECOVERY_ACTIONS[context.recoveryActionCode]?.preconditions || [] } : {}),
    durationMs, outcome: classified.status, errorClass: classified.errorClass,
    errorSignal,
    retryable: classified.retryable, nextRetryAt: entry.nextRetryAt,
    rootCauseStatus: classified.status === "failed" ? "unconfirmed" : "not-applicable",
    recoveredErrorClass: classified.status === "succeeded" ? previousErrorClass : null,
    recoveredErrorSignal: classified.status === "succeeded" ? entry.lastErrorSignal || null : null,
    hypothesis: classified.errorClass,
    evidence: sourceStatusEvidence(source, outcome),
    evidenceMetadata: normalizeRecoveryEvidence(context.week, {
      sourceStatus: outcome?.status || classified.status,
      sourceVersion: outcome?.sourceVersion || outcome?.skillVersion || "",
      count: outcome?.count,
      expectedCount: outcome?.coverage?.expectedCount ?? outcome?.expectedCount,
      observedCount: outcome?.coverage?.observedCount ?? outcome?.observedCount,
      omittedCount: outcome?.coverage?.omittedCount ?? outcome?.omittedCount,
      artifactSha256: outcome?.artifactSha256,
      snapshotSha256: outcome?.snapshotId ? createHash("sha256").update(String(outcome.snapshotId)).digest("hex") : "",
      phase: outcome?.diagnostics?.phase
    })
  });
  entry.lastEvidence = normalizeRecoveryEvidence(context.week, {
    sourceStatus: outcome?.status || classified.status,
    sourceVersion: outcome?.sourceVersion || outcome?.skillVersion || "",
    count: outcome?.count,
    expectedCount: outcome?.coverage?.expectedCount ?? outcome?.expectedCount,
    observedCount: outcome?.coverage?.observedCount ?? outcome?.observedCount,
    omittedCount: outcome?.coverage?.omittedCount ?? outcome?.omittedCount,
    artifactSha256: outcome?.artifactSha256,
    snapshotSha256: outcome?.snapshotId ? createHash("sha256").update(String(outcome.snapshotId)).digest("hex") : "",
    phase: outcome?.diagnostics?.phase
  });
  await context.save();
  } finally {
    await weeklyAiLock?.release();
  }
  if (classified.status === "succeeded") context.prepareAfterSuccess?.(source);
}

export async function runConfiguredSource(source, { week, repoRoot, onDependencyResult, attemptToken,
  resubmitUncertainAi = false,
  automaticResubmit = false,
  weeklyAiLockToken,
  observeUncertainAi = false,
  observeWaitSeconds = 720,
  timeoutMs,
  allowFlomoReviewImport = false, importFlomoReviews = runFlomoReviewImport,
  executeCommand = execFileAsync, readOutcome = readCurrentSourceOutcome } = {}) {
  const startedAt = Date.now();
  let script, args;
  if (source.id === "flomo") {
    if (!attemptToken) return { status: "failed", error: "flomo-attempt-token-required" };
    script = path.join(repoRoot, ".agents/skills/learn-x-input/scripts/sync-flomo-full-week.mjs");
    args = ["--week", week, "--attempt-token", attemptToken];
  } else {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const command = packageJson.scripts?.[source.collector];
    if (!command) return { status: "failed", error: "source-collector-command-missing" };
    const tokens = command.trim().split(/\s+/);
    if (tokens[0] !== "node" || !tokens[1]?.endsWith(".mjs")) return { status: "failed", error: "source-collector-command-contract-mismatch" };
    script = path.resolve(repoRoot, tokens[1]);
    args = [...tokens.slice(2), "--week", week,
      ...(source.id === "ai" && observeUncertainAi ? ["--observe-uncertain", "--observe-seconds", String(observeWaitSeconds)] : []),
      ...(source.id === "ai" && resubmitUncertainAi ? ["--resubmit-uncertain", "--confirm"] : []),
      ...(source.id === "ai" && automaticResubmit ? ["--automatic-resubmit"] : []),
      ...(source.id === "ai" && typeof weeklyAiLockToken === "string" ? ["--weekly-ai-lock-token", weeklyAiLockToken] : [])];
  }
  try {
    const sourceTimeoutMs = source.id === "ai" && observeUncertainAi ? (observeWaitSeconds + 90) * 1000 : source.id === "ai" ? 5 * 60_000 : source.id === "flomo" ? 32 * 60_000 : 12 * 60_000;
    const result = await executeCommand(process.execPath, [script, ...args], {
      cwd: repoRoot,
      timeout: Math.max(1, Math.min(sourceTimeoutMs, Number.isFinite(timeoutMs) ? timeoutMs : sourceTimeoutMs)),
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const current = await readOutcome(source, week, repoRoot);
    const updatedAt = Date.parse(current?.updatedAt || current?.confirmedAt || current?.completedAt || "");
    const acceptedStatuses = ["ready", "empty", "generated", "confirmed", "needs_review", "unavailable", ...(source.id === "flomo" ? ["failed"] : [])];
    if (!current || !Number.isFinite(updatedAt) || updatedAt < startedAt - 1_000 || !acceptedStatuses.includes(current.status)) {
      return { status: "failed", error: "collector-exit-without-fresh-valid-status" };
    }
    if (source.id !== "flomo") {
      if (source.id === "wisdom") {
        const flomoSource = WEEKLY_SOURCE_CONFIG.find((item) => item.id === "flomo");
        const flomoOutcome = allowFlomoReviewImport ? await readOutcome(flomoSource, week, repoRoot).catch(() => null) : null;
        if (allowFlomoReviewImport && ["ready", "empty", "succeeded"].includes(flomoOutcome?.status)) {
          try {
            const importResult = await importFlomoReviews(week, repoRoot);
            await onDependencyResult?.({ outcome: "succeeded", ...importResult });
          } catch (error) {
            const errorClass = classifyWeeklyFailure(sanitizeErrorForClassification(error), { sourceId: "wisdom" }).errorClass;
            await onDependencyResult?.({ outcome: "failed", errorClass,
              errorSignal: safeFailureSignal(error, errorClass), rootCauseStatus: "unconfirmed" });
          }
        } else {
          await onDependencyResult?.({ outcome: "skipped", reason: "flomo-not-successful" });
        }
      }
      return current;
    }
    let runResult = null;
    try { runResult = JSON.parse(result.stdout.trim().split("\n").at(-1)); } catch {}
    return { ...current, ...(runResult?.error ? { error: runResult.error } : {}), ...(runResult?.snapshotId ? {
      snapshotId: runResult.snapshotId, capturedAt: runResult.capturedAt,
      coverage: runResult.coverage, termination: runResult.termination,
    } : {}) };
  } catch (error) {
    const current = await readOutcome(source, week, repoRoot).catch(() => null);
    if (source.id === "ai" && freshOutcome(current, startedAt) && ["generated", "confirmed", "needs_review"].includes(current.status)) return current;
    return {
      status: "failed",
      error: error?.killed ? "collector-timeout" : String(error?.stderr || error?.message || "collector-failed").slice(-1200),
      ...(current?.sourceVersion ? { sourceVersion: current.sourceVersion } : {}),
      code: error?.code,
      timedOut: Boolean(error?.killed || error?.signal === "SIGTERM")
    };
  }
}

async function runFlomoReviewImport(week, repoRoot) {
  const importerPath = path.resolve(repoRoot, "../research-x/.agents/skills/wisdom-gate/scripts/import-flomo-review.mjs");
  const { main } = await import(pathToFileURL(importerPath).href);
  const taskSpace = `learn-x-v2-flomo-review-${randomUUID()}`;
  const result = await main({ apply: true, week, taskSpace, closeSpace: true });
  if (!result?.applied || result.imported?.some((item) => item.action === "blocked")) {
    throw new Error("flomo-review-import-incomplete");
  }
  return {
    scanned: Number(result.scanned) || 0,
    candidates: Number(result.candidates) || 0,
    alreadyImported: Number(result.alreadyImported) || 0,
    created: (result.imported || []).filter((item) => item.action === "created").length,
    skipped: (result.skipped || []).length,
    blocked: 0
  };
}

export async function readCurrentSourceOutcome(source, week, repoRoot = defaultRepoRoot) {
  const weekRoot = path.join(repoRoot, "03_input/weekly", normalizeWeek(week));
  if (source.id === "ai") {
    try {
      const sidecar = JSON.parse(await readFile(path.join(weekRoot, "_ai-generated.json"), "utf8"));
      if (sidecar.targetWeek !== normalizeWeek(week)) return { status: "failed", error: "ai-target-week-mismatch" };
      return {
        status: sidecar.status,
        error: sidecar.reason || sidecar.errorClass || "",
        code: sidecar.code,
        diagnostics: sidecar.diagnostics,
        updatedAt: sidecar.observation?.observedAt || sidecar.confirmedAt || sidecar.completedAt || sidecar.startedAt
      };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      return { status: "failed", error: "ai-status-sidecar-invalid" };
    }
  }
  try {
    const status = await readWeeklySourceStatus(weekRoot, normalizeWeek(week));
    const entry = status.sources[source.id];
    if (!entry) return null;
    if (["build", "build-bot"].includes(source.id) && entry.status === "ready") {
      try {
        const coverage = await readBuildCoverageHeader(path.join(weekRoot, entry.file), normalizeWeek(week));
        if (coverage.status !== "matched") return {
          status: "needs_review", count: entry.count, updatedAt: entry.updatedAt,
          error: coverage.status === "mismatch" ? "build-report-target-week-mismatch" : "build-report-target-week-unverified"
        };
      } catch (error) {
        return { status: "needs_review", count: entry.count, updatedAt: entry.updatedAt, error: error.code === "ENOENT" ? "build-report-missing" : "build-report-target-week-unverified" };
      }
    }
    const sourceVersion = source.id === "weread" ? String(entry.summary || "").match(/Skill版本[:：]\s*([A-Za-z0-9][A-Za-z0-9._+-]{0,63})/)?.[1] : "";
    return { status: entry.status, count: entry.count, summary: entry.summary, updatedAt: entry.updatedAt, ...(sourceVersion ? { sourceVersion } : {}) };
  } catch {
    return { status: "failed", error: "source-status-sidecar-invalid" };
  }
}

async function absorbCurrentSuccesses(state, { readOutcome, now, event }) {
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    if (["running", "succeeded"].includes(entry.status)) continue;
    if (!source.collector) {
      const current = await readOutcome(source).catch(() => null);
      entry.status = source.queue === "external" ? (current?.status || "recheck-only") : "manual-input";
      event({ step: "source-check", sourceId: source.id, outcome: entry.status, evidence: sourceStatusEvidence(source, current) });
      continue;
    }
    const current = await readOutcome(source).catch(() => null);
    if (!current) continue;
    const currentAt = Date.parse(current.updatedAt || current.confirmedAt || current.completedAt || "");
    const lastAttemptAt = Date.parse(entry.lastAttemptAt || "");
    if (entry.status === "failed" && Number.isFinite(lastAttemptAt) && (!Number.isFinite(currentAt) || currentAt < lastAttemptAt - 1_000)) continue;
    const classified = classifyOutcome(source.id, current);
    if (classified.status === "unavailable") {
      entry.status = "unavailable";
      entry.lastErrorClass = classified.errorClass;
      entry.nextRetryAt = null;
      event({ step: "source-check", sourceId: source.id, outcome: "unavailable", errorClass: classified.errorClass, evidence: sourceStatusEvidence(source, current) });
      continue;
    }
    if (classified.status === "succeeded") {
      entry.status = "succeeded";
      entry.lastSuccessAt = new Date(now).toISOString();
      entry.nextRetryAt = null;
      entry.lastErrorClass = null;
      entry.lastErrorSignal = null;
      entry.problemRunId = null;
      event({ step: "source-check", sourceId: source.id, outcome: "already-succeeded", evidence: sourceStatusEvidence(source, current) });
    } else if (classified.status === "needs_review") {
      entry.status = "needs_review";
      entry.lastErrorClass = classified.errorClass;
      event({ step: "source-check", sourceId: source.id, outcome: "needs-review", errorClass: classified.errorClass, evidence: sourceStatusEvidence(source, current) });
    }
  }
}

async function reconcileInterruptedRuns(state, { now, event, readOutcome, weekRoot, repoRoot }) {
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    if (entry.status !== "running") continue;
    if (source.id === "ai") {
      const current = await readOutcome(source).catch(() => null);
      if (current && ["generated", "confirmed"].includes(current.status)) {
        entry.status = "succeeded";
        entry.lastSuccessAt = new Date(now).toISOString();
        entry.lastErrorClass = null;
        entry.lastErrorSignal = null;
        entry.problemRunId = null;
        entry.nextRetryAt = null;
        event({ step: "recovery", sourceId: source.id, outcome: "recovered-existing-result", evidence: sourceStatusEvidence(source, current) });
      } else {
        entry.status = "needs_review";
        entry.lastErrorClass = "ai-submission-state-uncertain";
        entry.nextRetryAt = null;
        event({ step: "recovery", sourceId: source.id, outcome: "needs-review", errorClass: entry.lastErrorClass, evidence: sourceStatusEvidence(source, current) });
      }
      continue;
    }
    if (source.id === "flomo") {
      try {
        await invalidateFlomoAttemptGuard(weekRoot, repoRoot);
        entry.activeAttemptToken = null;
      } catch (error) {
        const failure = classifyWeeklyFailure(sanitizeErrorForClassification(error), { sourceId: "flomo", code: error?.code });
        if (failure.errorClass !== "review-store-lock-busy") throw error;
        const previousErrorClass = entry.lastErrorClass;
        entry.status = "failed";
        entry.lastErrorClass = failure.errorClass;
        entry.lastFailureAt = new Date(now).toISOString();
        entry.nextRetryAt = new Date(now + failure.retryAfterMs).toISOString();
        entry.sameErrorCount = previousErrorClass === failure.errorClass ? entry.sameErrorCount + 1 : 1;
        event({ step: "recovery", sourceId: source.id, outcome: "retry-scheduled", errorClass: failure.errorClass, nextRetryAt: entry.nextRetryAt, evidence: STATE_FILE });
        continue;
      }
    }
    const failure = classifyWeeklyFailure("process-interrupted", { sourceId: source.id });
    entry.status = "failed";
    entry.lastErrorClass = failure.errorClass;
    entry.lastFailureAt = new Date(now).toISOString();
    entry.nextRetryAt = new Date(now + failure.retryAfterMs).toISOString();
    event({ step: "recovery", sourceId: source.id, outcome: "retry-scheduled", errorClass: failure.errorClass, nextRetryAt: entry.nextRetryAt, evidence: STATE_FILE });
  }
}

async function repeatedFailureAlerts(state, repoRoot) {
  const previousWeek = previousIsoWeek(state.week);
  const previousState = await loadState(path.join(repoRoot, "03_input/weekly", previousWeek, STATE_FILE), previousWeek).catch(() => null);
  return Object.entries(state.sources).filter(([sourceId, entry]) => {
    const repeatedThisWeek = entry.sameErrorCount >= 3;
    const repeatedAcrossWeeks = previousState?.sources?.[sourceId]?.status === "failed"
      && previousState.sources[sourceId].lastErrorClass === entry.lastErrorClass;
    return entry.status === "failed" && (repeatedThisWeek || repeatedAcrossWeeks);
  }).map(([sourceId, entry]) => ({ sourceId, errorClass: entry.lastErrorClass, repeats: entry.sameErrorCount, consecutiveWeeks: previousState?.sources?.[sourceId]?.lastErrorClass === entry.lastErrorClass ? 2 : 1 }));
}

function sourceStatusEvidence(source, outcome) {
  return {
    sourceId: source.id,
    status: outcome?.status || "unknown",
    count: Number.isInteger(outcome?.count) ? outcome.count : null,
    sidecar: source.id === "ai" ? "_ai-generated.json" : "_source-status.json",
    ...(source.id === "flomo" && outcome?.snapshotId ? {
      snapshotId: outcome.snapshotId, capturedAt: outcome.capturedAt || null,
      coverage: outcome.coverage || null, termination: outcome.termination || null,
    } : {})
  };
}

function normalizeRecoveryEvidence(week, value = {}) {
  const evidence = { targetWeek: week };
  const statuses = new Set(["pending", "running", "ready", "empty", "succeeded", "failed", "unavailable", "needs_review"]);
  if (statuses.has(value.sourceStatus)) evidence.sourceStatus = value.sourceStatus;
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(String(value.sourceVersion || ""))) evidence.sourceVersion = String(value.sourceVersion);
  if (["preflight", "collection", "observation", "readback", "preprocess", "validation", "repair", "delivery"].includes(value.phase)) evidence.phase = value.phase;
  for (const key of ["count", "expectedCount", "observedCount", "omittedCount"]) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1_000_000_000) evidence[key] = value[key];
  }
  for (const key of ["artifactSha256", "snapshotSha256"]) {
    const hash = String(value[key] || "").toLowerCase();
    if (/^[a-f0-9]{64}$/.test(hash)) evidence[key] = hash;
  }
  return evidence;
}

async function writeFlomoAttemptGuard(repoRoot, week, guard) {
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  await withLock(repoRoot, async () => {
    await mkdir(weekRoot, { recursive: true });
    await atomicWrite(path.join(weekRoot, "_flomo-attempt.json"), `${JSON.stringify(guard)}\n`);
  });
}

async function retireFlomoAttemptGuard(repoRoot, week, token) {
  const guardPath = path.join(repoRoot, "03_input/weekly", week, "_flomo-attempt.json");
  await withLock(repoRoot, async () => {
    try {
      const current = JSON.parse(await readFile(guardPath, "utf8"));
      if (current.token === token) await atomicWrite(guardPath, `${JSON.stringify({ ...current, active: false, finishedAt: new Date().toISOString() })}\n`);
    } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  });
}

async function invalidateFlomoAttemptGuard(weekRoot, repoRoot) {
  const guardPath = path.join(weekRoot, "_flomo-attempt.json");
  await withLock(repoRoot, async () => {
    try {
      const current = JSON.parse(await readFile(guardPath, "utf8"));
      if (current.active === true) await atomicWrite(guardPath, `${JSON.stringify({ ...current, active: false, invalidatedAt: new Date().toISOString() })}\n`);
    } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  });
}

function freshOutcome(outcome, attemptStartedAt) {
  const timestamp = Date.parse(outcome?.updatedAt || outcome?.confirmedAt || outcome?.completedAt || "");
  return Number.isFinite(timestamp) && timestamp >= attemptStartedAt - 1_000;
}

function sanitizeErrorForClassification(error) {
  return String(error?.stderr || error?.message || "unknown")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:token|secret|password|cookie|session|api[_-]?key)\s*[:=]\s*\S+/gi, "[redacted]")
    .slice(-1200);
}

function safeFailureSignal(outcome, errorClass) {
  const code = String(outcome?.code || "").match(/^[A-Z][A-Z0-9_]{0,39}$/)?.[0];
  if (code) return code;
  const message = String(outcome?.error || outcome?.stderr || "");
  const knownSignal = message.match(/\b(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EPIPE|HTTP\s?5\d\d|collector-timeout|collector-exit-without-fresh-valid-status|source-status-sidecar-invalid|source-collector-command-missing|source-collector-command-contract-mismatch)\b/i)?.[0];
  if (knownSignal) return knownSignal.toUpperCase().replace(/\s+/g, "");
  if (errorClass === "unknown-failure") {
    const sanitized = sanitizeErrorForClassification({ message }).replace(/\s+/g, " ").trim().toLowerCase();
    return sanitized && sanitized !== "unknown"
      ? `UNKNOWN-${createHash("sha256").update(sanitized).digest("hex").slice(0, 16).toUpperCase()}`
      : `UNKNOWN-UNATTRIBUTED-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  }
  return errorClass;
}

function isRetryableClass(errorClass) {
  return ["service-rate-limit", "network-timeout", "network-transient", "process-interrupted", "review-store-lock-busy"].includes(errorClass);
}

async function loadState(filePath, week) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.schemaVersion !== 1 || parsed.week !== week || !parsed.sources || typeof parsed.sources !== "object") throw new Error("weekly-retry-state-invalid");
    const expected = createWeeklyRetryState(week);
    for (const source of WEEKLY_SOURCE_CONFIG) {
      parsed.sources[source.id] ||= expected.sources[source.id];
      parsed.sources[source.id].retries = source.retries;
      parsed.sources[source.id].rescueUsed = Boolean(parsed.sources[source.id].rescueUsed);
      parsed.sources[source.id].recoveryActions = Array.isArray(parsed.sources[source.id].recoveryActions) ? parsed.sources[source.id].recoveryActions : [];
      if (source.id === "health" && parsed.sources[source.id].status === "recheck-only"
        && parsed.sources[source.id].attempts === 0 && parsed.sources[source.id].lastAttemptAt == null) {
        parsed.sources[source.id].status = "pending";
        parsed.diagnostics ||= [];
        parsed.diagnostics.push({ at: new Date().toISOString(), step: "source-management-migration", sourceId: "health", from: "recheck-only", to: "pending", evidence: "Health-X report-only collector" });
      }
    }
    parsed.diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function tryAcquireRunLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(owner), "utf8");
    await handle.close();
    return {
      release: async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current.token === owner.token) await rm(lockPath, { force: true });
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await reapAbandonedRunLock(lockPath)) return tryAcquireRunLock(lockPath);
    return null;
  }
}

async function acquireBrowserQueue(context) {
  const lockPath = path.join(context.repoRoot, "03_input", "weekly", BROWSER_QUEUE_LOCK_FILE);
  const startedAt = context.now();
  while (true) {
    const lock = await tryAcquireRunLock(lockPath);
    if (lock) return lock;
    const remaining = context.remainingDurationMs?.() ?? context.maxDurationMs - (context.now() - startedAt);
    if (remaining <= 0) throw new Error("browser-queue-wait-timeout");
    await context.sleep(Math.min(250, remaining));
  }
}

async function reapAbandonedRunLock(lockPath) {
  const reaperPath = `${lockPath}.reap`;
  const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  let handle;
  try {
    handle = await open(reaperPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(owner), "utf8");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await isDeadRunLockOwner(reaperPath)) await rm(reaperPath, { force: true });
    return false;
  } finally {
    await handle?.close();
  }
  try {
    if (!await isDeadRunLockOwner(lockPath)) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    try {
      const current = JSON.parse(await readFile(reaperPath, "utf8"));
      if (current.token === owner.token) await rm(reaperPath, { force: true });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function isDeadRunLockOwner(lockPath) {
  let current;
  try { current = JSON.parse(await readFile(lockPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    if (!(error instanceof SyntaxError)) throw error;
    const lockStat = await stat(lockPath).catch((statError) => statError.code === "ENOENT" ? null : Promise.reject(statError));
    return Boolean(lockStat && Date.now() - lockStat.mtimeMs > 60_000);
  }
  const pid = Number(current?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

async function atomicWrite(filePath, content) {
  const temp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temp, filePath); }
  finally { await rm(temp, { force: true }); }
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`invalid-week: ${value}`);
  const normalized = `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
  if (Number(match[2]) < 1 || Number(match[2]) > isoWeeksInYear(Number(match[1]))) throw new Error(`invalid-week: ${value}`);
  return normalized;
}

function previousIsoWeek(week) {
  const [yearValue, weekValue] = normalizeWeek(week).split("-W").map(Number);
  const jan4 = new Date(Date.UTC(yearValue, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (weekValue - 1) * 7 - 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const isoJan4 = new Date(Date.UTC(isoYear, 0, 4));
  const isoMonday = new Date(isoJan4);
  isoMonday.setUTCDate(isoJan4.getUTCDate() - ((isoJan4.getUTCDay() + 6) % 7));
  const isoWeek = Math.floor((monday - isoMonday) / (7 * 86_400_000)) + 1;
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export async function recordWeeklyStage({ week, stage, durationMs, outcome = "success", repoRoot = defaultRepoRoot }) {
  const normalizedWeek = normalizeWeek(week);
  const allowed = new Set(["preprocess", "weekly_journal_fetch", "process_pack", "authorization_card", "memory_card", "closeout"]);
  if (!allowed.has(stage)) throw new Error(`unknown-stage: ${stage}`);
  const weekRoot = path.join(repoRoot, "03_input/weekly", normalizedWeek);
  const lock = await tryAcquireRunLock(path.join(weekRoot, LOCK_FILE));
  if (!lock) return { week: normalizedWeek, skipped: "supervisor-already-running" };
  try {
    const statePath = path.join(weekRoot, STATE_FILE);
    const state = await loadState(statePath, normalizedWeek) || createWeeklyRetryState(normalizedWeek);
    state.diagnostics.push({ at: new Date().toISOString(), step: stage, durationMs: Math.max(0, Number(durationMs) || 0), outcome, evidence: STATE_FILE });
    if (state.diagnostics.length > LOG_LIMIT) state.diagnostics.splice(0, state.diagnostics.length - LOG_LIMIT);
    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
    return { week: normalizedWeek, stage, durationMs: Math.max(0, Number(durationMs) || 0), statePath };
  } finally { await lock.release(); }
}

function parseArgs(argv) {
  const value = (flag, fallback = undefined) => { const index = argv.indexOf(flag); return index < 0 ? fallback : argv[index + 1]; };
  if (argv.includes("--record-stage")) return { recordStage: value("--record-stage"), durationMs: Number(value("--duration-ms", "0")), outcome: value("--outcome", "success"), week: value("--week") };
  return {
    week: value("--week"), mode: value("--mode", "initial"), sourceId: value("--source") || null,
    resubmitUncertainAi: argv.includes("--resubmit-uncertain") && argv.includes("--confirm"),
    recoveryActionCode: value("--action-code", ""),
    problemId: value("--problem-id", ""),
    expectedSourceVersion: value("--expected-source-version", ""),
    confirmedRecovery: argv.includes("--confirm")
  };
}

async function prepareWeeklyInputs(_source, { week, repoRoot, remainingMs = 2 * 60_000 }) {
  const script = path.join(repoRoot, ".agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs");
  await execFileAsync(process.execPath, [script, "--week", week, "--prepare"], {
    cwd: repoRoot, timeout: Math.max(1, Math.min(2 * 60_000, Number(remainingMs) || 2 * 60_000)), maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const operation = options.recordStage
    ? recordWeeklyStage(options)
    : runWeeklyRetrySupervisor({ ...options, prepareInputs: prepareWeeklyInputs, enableFlomoReviewImport: true });
  operation
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

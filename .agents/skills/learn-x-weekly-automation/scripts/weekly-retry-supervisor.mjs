import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { readWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const RETRY_GAP_MS = 20 * 60_000;
const STATE_FILE = "_weekly-retry-state.json";
const LOCK_FILE = "_weekly-retry-state.lock";
const LOG_LIMIT = 500;

export function createWeeklyRetryState(week) {
  return {
    schemaVersion: 1,
    week: normalizeWeek(week),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: Object.fromEntries(WEEKLY_SOURCE_CONFIG.map((source) => [source.id, {
      status: "pending", attempts: 0, retries: source.retries, rescueUsed: false,
      nextRetryAt: null, lastAttemptAt: null, lastSuccessAt: null,
      lastErrorClass: null, sameErrorCount: 0
    }])),
    diagnostics: []
  };
}

export function classifyWeeklyFailure(message, { sourceId = "", code = "" } = {}) {
  const value = `${code} ${message}`.toLowerCase();
  if (/permission|forbidden|unauthori[sz]ed|login|captcha|user.control|bootstrap.permission|scope|identity/.test(value)) {
    return { errorClass: "permission-or-human-control", retryable: false, retryAfterMs: 0 };
  }
  if (/schema|field.contract|invalid.field|contract.mismatch|unsupported.field|target.mismatch/.test(value)) {
    return { errorClass: "source-contract-mismatch", retryable: false, retryAfterMs: 0 };
  }
  if (/manual|human.review|needs_review/.test(value)) {
    return { errorClass: "manual-review-required", retryable: false, retryAfterMs: 0 };
  }
  const retryAfter = Number(value.match(/retry-after\s*[:= ]\s*(\d+)/)?.[1] || 0) * 1000;
  if (/econnreset|econnrefused|eai_again|enotfound|network|dns|temporar|http.?5\d\d|rate.?limit|throttl|timeout|timed out|process-interrupted/.test(value)) {
    return { errorClass: /rate.?limit|throttl/.test(value) ? "service-rate-limit" : /timeout|timed out/.test(value) ? "network-timeout" : "network-transient", retryable: true, retryAfterMs: Math.max(RETRY_GAP_MS, retryAfter) };
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
  if (!["initial", "rescue"].includes(mode)) throw new Error("mode must be initial or rescue");
  const weekRoot = path.join(repoRoot, "03_input/weekly", normalizedWeek);
  const statePath = path.join(weekRoot, STATE_FILE);
  const startedAt = now();
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
  let saveQueue = Promise.resolve();
  let preparationQueue = Promise.resolve();
  const save = () => {
    state.updatedAt = new Date(now()).toISOString();
    saveQueue = saveQueue.then(() => atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`));
    return saveQueue;
  };
  const event = (entry) => {
    state.diagnostics.push({ at: new Date(now()).toISOString(), ...entry });
    if (state.diagnostics.length > LOG_LIMIT) state.diagnostics.splice(0, state.diagnostics.length - LOG_LIMIT);
    onEvent(entry);
  };
  const prepareAfterSuccess = prepareInputs ? (source) => {
    preparationQueue = preparationQueue.then(async () => {
      const began = now();
      try {
        await prepareInputs(source, { week: normalizedWeek, repoRoot });
        event({ step: "weekly-preprocess", sourceId: source.id, durationMs: Math.max(0, now() - began), outcome: "succeeded", evidence: "04_output/_dist/weekly/<week>/.preprocessing/manifest.json" });
      } catch (error) {
        const errorClass = classifyWeeklyFailure(sanitizeErrorForClassification(error)).errorClass;
        event({ step: "weekly-preprocess", sourceId: source.id, durationMs: Math.max(0, now() - began), outcome: "failed", errorClass, errorSignal: safeFailureSignal(error, errorClass), rootCauseStatus: "unconfirmed", hypothesis: errorClass, evidence: "04_output/_dist/weekly/<week>/.preprocessing/manifest.json" });
      }
      await save();
    });
    return preparationQueue;
  } : undefined;
  const sourceContext = () => ({ state, now, runSource, readOutcome, save, event, mode, week: normalizedWeek, repoRoot, prepareAfterSuccess, drainPreparation: () => preparationQueue });

  try {
    state = await loadState(statePath, normalizedWeek);
    if (mode === "rescue" && !state) {
      state = createWeeklyRetryState(normalizedWeek);
      event({ step: "retry-rescue", outcome: "stopped", errorClass: "retry-state-missing", evidence: STATE_FILE });
      await save();
      return { week: normalizedWeek, mode, stopped: "retry-state-missing", statePath };
    }
    state ||= createWeeklyRetryState(normalizedWeek);
    await reconcileInterruptedRuns(state, { now: now(), mode, event, readOutcome });
    await absorbCurrentSuccesses(state, { readOutcome, now: now(), event });
    if (lockWaitMs) event({ step: "retry-rescue-wait", outcome: "waited-for-active-run", durationMs: lockWaitMs, evidence: STATE_FILE });
    await save();

    if (mode === "initial") {
      const dueFirst = WEEKLY_SOURCE_CONFIG.filter((source) => source.collector && source.id !== "wisdom" && state.sources[source.id]?.attempts === 0 && state.sources[source.id]?.status === "pending");
      await runBatch(dueFirst, "first", sourceContext());
      await runDependentWisdomFirst(sourceContext());
    }

    while (mode === "initial" && now() - startedAt < maxDurationMs) {
      const due = WEEKLY_SOURCE_CONFIG.filter((source) => canRetrySource(source, state.sources[source.id], mode, now()) && (source.id !== "wisdom" || state.sources.flomo?.status === "succeeded"));
      if (!due.length) {
        const pending = WEEKLY_SOURCE_CONFIG
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
      await runDependentWisdomFirst(sourceContext());
    }

    if (mode === "rescue") {
      while (now() - startedAt < maxDurationMs) {
        const dueRescue = WEEKLY_SOURCE_CONFIG.filter((source) => canRetrySource(source, state.sources[source.id], mode, now()) && (source.id !== "wisdom" || state.sources.flomo?.status === "succeeded"));
        if (dueRescue.length) {
          for (const source of dueRescue) state.sources[source.id].rescueUsed = true;
          await save();
          await runBatch(dueRescue, "rescue", sourceContext());
          await runDependentWisdomFirst(sourceContext());
          continue;
        }
        const pendingTimes = WEEKLY_SOURCE_CONFIG
          .filter((source) => source.collector && source.queue !== "external" && source.queue !== "manual"
            && (source.id !== "wisdom" || state.sources.flomo?.status === "succeeded"))
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
    }

    await save();
    return {
      week: normalizedWeek,
      mode,
      statePath,
      sources: Object.fromEntries(Object.entries(state.sources).map(([id, item]) => [id, { status: item.status, attempts: item.attempts, retries: item.retries, rescueUsed: item.rescueUsed, lastErrorClass: item.lastErrorClass, nextRetryAt: item.nextRetryAt }])),
      alerts: await repeatedFailureAlerts(state, repoRoot)
    };
  } finally {
    await saveQueue.catch(() => {});
    await lock.release();
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
}

async function runDependentWisdomFirst(context) {
  const entry = context.state.sources.wisdom;
  if (context.state.sources.flomo?.status !== "succeeded" || entry?.status !== "pending" || entry.attempts !== 0) return;
  const source = WEEKLY_SOURCE_CONFIG.find((item) => item.id === "wisdom");
  await runBatch([source], context.mode === "rescue" ? "rescue" : "first", context);
}

async function runOneSource(source, kind, context) {
  const entry = context.state.sources[source.id];
  const attempt = entry.attempts + 1;
  const began = context.now();
  entry.status = "running";
  entry.attempts = attempt;
  entry.lastAttemptAt = new Date(began).toISOString();
  entry.nextRetryAt = null;
  if (kind === "rescue") entry.rescueUsed = true;
  context.event({ step: "source-collection", sourceId: source.id, attempt, attemptKind: kind, outcome: "started", evidence: STATE_FILE });
  await context.save();

  let outcome;
  try {
    const result = await context.runSource(source, {
      week: context.week, repoRoot: context.repoRoot, attempt, attemptKind: kind,
      onDependencyResult: async (result) => {
        context.event({ step: "flomo-review-import", sourceId: source.id, outcome: "succeeded", ...result, evidence: "智慧之门来源键读回" });
        await context.save();
      }
    });
    if (result && typeof result === "object" && typeof result.status === "string") {
      outcome = result;
    } else {
      const current = await context.readOutcome(source);
      outcome = freshOutcome(current, began) && ["ready", "empty", "generated", "confirmed", "needs_review"].includes(current.status)
        ? current
        : { status: "failed", error: "collector-result-missing" };
    }
  } catch (error) {
    const current = await context.readOutcome(source).catch(() => null);
    // ChatGPT may finish after its observer is interrupted. Recover only a
    // confirmed AI result; other collector exceptions remain authoritative.
    outcome = source.id === "ai" && freshOutcome(current, began) && ["generated", "confirmed"].includes(current.status)
      ? current
      : { status: "failed", error: sanitizeErrorForClassification(error), code: error?.code, timedOut: Boolean(error?.killed || error?.signal === "SIGTERM") };
  }
  const classified = classifyOutcome(source.id, outcome);
  const durationMs = Math.max(0, context.now() - began);
  const previousErrorClass = entry.lastErrorClass;
  entry.status = classified.status;
  entry.lastDurationMs = durationMs;
  entry.lastErrorClass = classified.errorClass;
  if (classified.status === "succeeded") {
    entry.lastSuccessAt = new Date(context.now()).toISOString();
    entry.nextRetryAt = null;
    entry.sameErrorCount = 0;
  } else if (classified.retryable) {
    entry.lastFailureAt = new Date(context.now()).toISOString();
    entry.nextRetryAt = new Date(context.now() + Math.max(RETRY_GAP_MS, classified.retryAfterMs)).toISOString();
  } else {
    entry.lastFailureAt = new Date(context.now()).toISOString();
    entry.nextRetryAt = classified.retryable
      ? new Date(context.now() + Math.max(RETRY_GAP_MS, classified.retryAfterMs)).toISOString()
      : null;
  }
  if (classified.status !== "succeeded" && classified.status !== "needs_review") {
    entry.sameErrorCount = previousErrorClass === classified.errorClass ? entry.sameErrorCount + 1 : 1;
  }
  context.event({
    step: "source-collection", sourceId: source.id, attempt, attemptKind: kind,
    durationMs, outcome: classified.status, errorClass: classified.errorClass,
    errorSignal: safeFailureSignal(outcome, classified.errorClass),
    retryable: classified.retryable, nextRetryAt: entry.nextRetryAt,
    rootCauseStatus: classified.status === "failed" ? "unconfirmed" : "not-applicable",
    hypothesis: classified.errorClass,
    evidence: sourceStatusEvidence(source, outcome)
  });
  await context.save();
  if (classified.status === "succeeded") context.prepareAfterSuccess?.(source);
}

export async function runConfiguredSource(source, { week, repoRoot, onDependencyResult }) {
  const startedAt = Date.now();
  if (source.id === "wisdom") {
    const importResult = await runFlomoReviewImport(week, repoRoot);
    await onDependencyResult?.(importResult);
  }
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const command = packageJson.scripts?.[source.collector];
  if (!command) return { status: "failed", error: "source-collector-command-missing" };
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "node" || !tokens[1]?.endsWith(".mjs")) return { status: "failed", error: "source-collector-command-contract-mismatch" };
  const script = path.resolve(repoRoot, tokens[1]);
  const args = [...tokens.slice(2), "--week", week];
  try {
    await execFileAsync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      timeout: source.id === "ai" ? 5 * 60_000 : 12 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const current = await readCurrentSourceOutcome(source, week, repoRoot);
    const updatedAt = Date.parse(current?.updatedAt || current?.confirmedAt || current?.completedAt || "");
    if (!current || !Number.isFinite(updatedAt) || updatedAt < startedAt - 1_000 || !["ready", "empty", "generated", "confirmed", "needs_review"].includes(current.status)) {
      return { status: "failed", error: "collector-exit-without-fresh-valid-status" };
    }
    return current;
  } catch (error) {
    return {
      status: "failed",
      error: error?.killed ? "collector-timeout" : String(error?.stderr || error?.message || "collector-failed").slice(-1200),
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
        updatedAt: sidecar.confirmedAt || sidecar.completedAt || sidecar.startedAt
      };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      return { status: "failed", error: "ai-status-sidecar-invalid" };
    }
  }
  try {
    const status = await readWeeklySourceStatus(weekRoot, normalizeWeek(week));
    const entry = status.sources[source.id];
    return entry ? { status: entry.status, count: entry.count, summary: entry.summary, updatedAt: entry.updatedAt } : null;
  } catch {
    return { status: "failed", error: "source-status-sidecar-invalid" };
  }
}

async function absorbCurrentSuccesses(state, { readOutcome, now, event }) {
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    if (["running", "succeeded", "needs_review", "recheck-only", "manual-input"].includes(entry.status)) continue;
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
    if (classified.status === "succeeded") {
      entry.status = "succeeded";
      entry.lastSuccessAt = new Date(now).toISOString();
      entry.nextRetryAt = null;
      entry.lastErrorClass = null;
      event({ step: "source-check", sourceId: source.id, outcome: "already-succeeded", evidence: sourceStatusEvidence(source, current) });
    } else if (classified.status === "needs_review") {
      entry.status = "needs_review";
      entry.lastErrorClass = classified.errorClass;
      event({ step: "source-check", sourceId: source.id, outcome: "needs-review", errorClass: classified.errorClass, evidence: sourceStatusEvidence(source, current) });
    }
  }
}

async function reconcileInterruptedRuns(state, { now, event, readOutcome }) {
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    if (entry.status !== "running") continue;
    if (source.id === "ai") {
      const current = await readOutcome(source).catch(() => null);
      if (current && ["generated", "confirmed"].includes(current.status)) {
        entry.status = "succeeded";
        entry.lastSuccessAt = new Date(now).toISOString();
        entry.lastErrorClass = null;
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
    sidecar: source.id === "ai" ? "_ai-generated.json" : "_source-status.json"
  };
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
  const message = String(outcome?.error || "");
  const knownSignal = message.match(/\b(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EPIPE|HTTP\s?5\d\d|collector-timeout|collector-exit-without-fresh-valid-status|source-status-sidecar-invalid|source-collector-command-missing|source-collector-command-contract-mismatch)\b/i)?.[0];
  return knownSignal ? knownSignal.toUpperCase().replace(/\s+/g, "") : errorClass;
}

function isRetryableClass(errorClass) {
  return ["service-rate-limit", "network-timeout", "network-transient", "process-interrupted"].includes(errorClass);
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
  if (Number(match[2]) < 1 || Number(match[2]) > 53) throw new Error(`invalid-week: ${value}`);
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
  return { week: value("--week"), mode: value("--mode", "initial") };
}

async function prepareWeeklyInputs(_source, { week, repoRoot }) {
  const script = path.join(repoRoot, ".agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs");
  await execFileAsync(process.execPath, [script, "--week", week, "--prepare"], {
    cwd: repoRoot, timeout: 2 * 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const operation = options.recordStage
    ? recordWeeklyStage(options)
    : runWeeklyRetrySupervisor({ ...options, prepareInputs: prepareWeeklyInputs });
  operation
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

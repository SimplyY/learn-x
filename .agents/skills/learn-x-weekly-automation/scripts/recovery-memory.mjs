import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoWeeksInYear } from "../../learn-x-input/scripts/lib/iso-week.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATE_ROOT = path.join(skillRoot, "state");
const EVENTS_FILE = "recovery-incidents.jsonl";
const INDEX_FILE = "recovery-playbook.json";
const SOURCE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const SAFE_SIGNALS = new Set([
  "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE",
  "HTTP429", "HTTP5XX", "COLLECTOR-TIMEOUT", "COLLECTOR-EXIT-WITHOUT-FRESH-VALID-STATUS",
  "SOURCE-STATUS-SIDECAR-INVALID", "SOURCE-COLLECTOR-COMMAND-MISSING", "SOURCE-COLLECTOR-COMMAND-CONTRACT-MISMATCH",
  "SOURCE-UNAVAILABLE", "PERMISSION-OR-HUMAN-CONTROL", "SOURCE-CONTRACT-MISMATCH", "MANUAL-REVIEW-REQUIRED",
  "SOURCE-VERSION-MISMATCH", "SOURCE-DEPENDENCY-ORDER", "BUILD-COVERAGE-WEEK-MISMATCH", "HEALTH-LOCAL-EXPORT-MISSING",
  "AI-SUBMISSION-STATE-UNCERTAIN", "UNKNOWN-FAILURE", "PROCESS-INTERRUPTED", "REVIEW-STORE-LOCK-BUSY",
  "NETWORK-TIMEOUT", "NETWORK-TRANSIENT", "SERVICE-RATE-LIMIT"
]);
const ACTION_CODES = new Set([
  "observe-existing", "reconcile-output", "retry-transient", "upgrade-official-skill", "exclude-optional-source",
  "continue-original-task", "manual-repair", "small-patch", "verify-only", "skip-source"
]);
const OUTCOMES = new Set(["failed", "succeeded", "inconclusive", "candidate", "verified", "rejected"]);
const REPAIR_PRECONDITIONS = new Set([
  "same-target-week", "current-version-matched", "official-source-verified", "run-receipt-matched", "no-existing-output",
  "no-rate-limit", "status-readback-valid", "full-scan-stable", "user-confirmed-scope", "browser-queue-held", "remaining-budget-sufficient"
]);

export function recoveryStatePaths(root = DEFAULT_STATE_ROOT) {
  return { root, eventsPath: path.join(root, EVENTS_FILE), indexPath: path.join(root, INDEX_FILE), lockPath: path.join(root, ".recovery-memory.lock") };
}

export function recoveryLayerForAttempt(attemptKind) {
  if (attemptKind === "first" || attemptKind === "retry") return 1;
  if (["patch", "small-patch"].includes(attemptKind)) return 3;
  if (["rescue", "manual", "recovery", "uncertain-resubmission", "continue-original-task", "observe-existing"].includes(attemptKind)) return 2;
  return 0;
}

export async function recordRecoveryIncident(input, { stateRoot = DEFAULT_STATE_ROOT, now = () => new Date() } = {}) {
  const event = prepareRecoveryIncident(input, input?.at || now());
  return withRecoveryLock(stateRoot, async (paths) => {
    await mkdir(paths.root, { recursive: true });
    const prior = await readEvents(paths.eventsPath);
    if (!prior.valid) throw new Error("recovery-memory-events-invalid");
    const duplicate = prior.events.find((entry) => entry.eventId === event.eventId);
    if (duplicate) return { event: duplicate, duplicate: true, index: await rebuildIndex(paths, prior.events) };
    const handle = await open(paths.eventsPath, "a", 0o600);
    try { await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    const events = [...prior.events, event];
    const index = await rebuildIndex(paths, events);
    return { event, duplicate: false, index };
  });
}

export function prepareRecoveryIncident(input, at = new Date()) {
  return normalizeIncident(input, at);
}

export async function recordManualRepair({ week, sourceId, symptom, problemId, runId = "", sourceVersion = "", evidence = {}, actionCode = "manual-repair", actionPreconditions = [],
  actionNote = "", evidenceRef = "", verification = "candidate", rootCauseStatus = "unconfirmed", eventType = "manual-repair", layer = 2, actor = "user" } = {}, options = {}) {
  if (!ACTION_CODES.has(actionCode)) throw new Error("recovery-action-code-invalid");
  if (!OUTCOMES.has(verification)) throw new Error("recovery-verification-invalid");
  const safeWeek = normalizeWeek(week);
  const safeSource = cleanSource(sourceId);
  const safeNote = sanitizeNote(actionNote);
  if (String(actionNote || "").trim() && !safeNote) throw new Error("recovery-action-note-not-safe");
  const safeEvidence = cleanEvidenceRef(evidenceRef);
  if (verification === "verified" && !safeEvidence) throw new Error("recovery-verified-evidence-required");
  const safeEventType = ["manual-repair", "verification", "prevention"].includes(eventType) ? eventType : "manual-repair";
  const preconditions = normalizePreconditions(actionPreconditions);
  if (safeEventType === "prevention" && (verification !== "verified" || rootCauseStatus !== "confirmed" || !safeEvidence)) throw new Error("prevention-closure-requires-verified-evidence");
  const safeRunId = cleanRunId(runId);
  const eventId = `M-${createHash("sha256").update([safeWeek, safeSource, symptom, problemId || "", safeRunId, normalizeVersion(sourceVersion), actionCode, preconditions.join(","), safeNote, safeEvidence, verification, safeEventType].join("\0")).digest("hex").slice(0, 24)}`;
  return recordRecoveryIncident({
    week, sourceId, problemId, errorClass: safeSignal(symptom), errorSignal: safeSignal(symptom),
    runId: safeRunId,
    layer: safeEventType === "prevention" ? 3 : (Number(layer) === 3 ? 3 : 2), actionCode, actionPreconditions: preconditions, actionNote, outcome: verification, eventType: safeEventType,
    eventId, actor, evidenceRef, rootCauseStatus, sourceVersion, evidence, verification
  }, options);
}

export async function queryRecoveryPlaybook({ sourceId, errorClass = "", errorSignal = "", sourceVersion = "", layer = 2, satisfiedPreconditions = [], limit = 3 } = {}, { stateRoot = DEFAULT_STATE_ROOT } = {}) {
  const paths = recoveryStatePaths(stateRoot);
  const data = await readEvents(paths.eventsPath);
  if (!data.valid) return { status: "unavailable", reason: data.reason || "events-corrupt", recommendations: [] };

  let index;
  try { index = JSON.parse(await readFile(paths.indexPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" && data.events.length === 0) return { status: "empty", recommendations: [] };
    return { status: "unavailable", reason: error.code === "ENOENT" ? "index-rebuild-required" : "index-unreadable", recommendations: [] };
  }
  if (!index || typeof index !== "object" || Array.isArray(index)) return { status: "unavailable", reason: "index-corrupt", recommendations: [] };
  const lastEventId = data.events.at(-1)?.eventId || null;
  if (index.schemaVersion !== 1 || index.sourceOfTruth !== EVENTS_FILE || index.eventCount !== data.events.length || index.lastEventId !== lastEventId
    || !Array.isArray(index.experiences)) return { status: "unavailable", reason: "index-stale", recommendations: [] };

  try {
    const source = cleanSource(sourceId);
    const requestedSignal = String(errorSignal || errorClass || "").trim();
    const wanted = requestedSignal ? safeSignal(requestedSignal) : "";
    const version = normalizeVersion(sourceVersion);
    const requestedLayer = Number(layer);
    if (![1, 2, 3].includes(requestedLayer)) throw new Error("recovery-layer-invalid");
    const satisfied = new Set(normalizePreconditions(satisfiedPreconditions));
    const recommendations = index.experiences
      .filter((item) => item.sourceId === source && item.validation === "verified" && ["succeeded", "verified"].includes(item.lastOutcome))
      .filter((item) => !wanted || item.errorSignal === wanted || item.errorClass === wanted)
      .filter((item) => !item.sourceVersion || (version && item.sourceVersion === version))
      .filter((item) => item.layer === requestedLayer)
      .filter((item) => item.actionPreconditions.every((precondition) => satisfied.has(precondition)))
      .sort((a, b) => b.successCount - a.successCount || b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, Math.min(3, Math.max(0, Number(limit) || 3)));
    return { status: "ready", recommendations };
  } catch {
    return { status: "unavailable", reason: "query-invalid", recommendations: [] };
  }
}

export async function hasVerifiedSmallPatch({ week, sourceId, problemId, errorSignal } = {}, { stateRoot = DEFAULT_STATE_ROOT } = {}) {
  let targetWeek;
  let source;
  try {
    targetWeek = normalizeWeek(week);
    source = cleanSource(sourceId);
  } catch { return false; }
  if (!/^P-[a-f0-9]{16}$/.test(String(problemId || ""))) return false;
  let signal;
  try { signal = safeSignal(errorSignal); } catch { return false; }
  const data = await readEvents(recoveryStatePaths(stateRoot).eventsPath);
  if (!data.valid) return false;
  return data.events.some((event) => {
    const evidence = event.evidence || {};
    return event.week === targetWeek && event.sourceId === source && event.problemId === problemId
      && event.errorSignal === signal && event.layer === 3 && event.actionCode === "small-patch"
      && event.eventType === "recovery" && event.outcome === "verified" && event.rootCauseStatus === "confirmed"
      && event.verification === "verified" && evidence.phase === "validation"
      && /^[a-f0-9]{64}$/.test(evidence.patchSha256 || "") && /^[a-f0-9]{64}$/.test(evidence.baselineDigest || "")
      && /^[a-f0-9]{64}$/.test(evidence.resultDigest || "") && /^[a-f0-9]{64}$/.test(evidence.reviewerReceiptSha256 || "")
      && Number.isInteger(evidence.patchFileCount) && evidence.patchFileCount >= 1 && evidence.patchFileCount <= 3
      && Array.isArray(evidence.changedFiles) && evidence.changedFiles.length === evidence.patchFileCount
      && Number.isInteger(evidence.addedLines) && Number.isInteger(evidence.deletedLines)
      && evidence.addedLines + evidence.deletedLines > 0 && evidence.addedLines + evidence.deletedLines <= 100
      && evidence.originalFailureObserved === true && evidence.originalFailureFixed === true
      && evidence.counterexampleBaselinePassed === true && evidence.counterexampleAfterPassed === true;
  });
}

export async function findRecoveryProblems({ week, sourceId, errorSignal, runId = "" } = {}, { stateRoot = DEFAULT_STATE_ROOT } = {}) {
  let targetWeek;
  let source;
  let signal;
  try {
    targetWeek = normalizeWeek(week);
    source = cleanSource(sourceId);
    signal = safeSignal(errorSignal);
  } catch { return { status: "unavailable", reason: "query-invalid", problems: [] }; }
  const requestedRunId = runId ? cleanRunId(runId) : "";
  if (runId && !requestedRunId) return { status: "unavailable", reason: "query-invalid", problems: [] };
  const data = await readEvents(recoveryStatePaths(stateRoot).eventsPath);
  if (!data.valid) return { status: "unavailable", reason: data.reason || "events-corrupt", problems: [] };
  const matching = data.events.filter((event) => event.week === targetWeek && event.sourceId === source && event.errorSignal === signal
    && (!requestedRunId || event.runId === requestedRunId));
  const groups = new Map();
  for (const event of matching) {
    const group = groups.get(event.problemId) || { problemId: event.problemId, firstSeenAt: event.at, lastSeenAt: event.at, layers: [], actionCodes: [], events: 0 };
    if (event.at < group.firstSeenAt) group.firstSeenAt = event.at;
    if (event.at > group.lastSeenAt) group.lastSeenAt = event.at;
    if (!group.layers.includes(event.layer)) group.layers.push(event.layer);
    if (!group.actionCodes.includes(event.actionCode)) group.actionCodes.push(event.actionCode);
    group.events += 1;
    groups.set(event.problemId, group);
  }
  const problems = [...groups.values()].map((item) => ({ ...item, layers: item.layers.sort(), actionCodes: item.actionCodes.sort() }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 10);
  return { status: "ready", problems };
}

export async function rebuildRecoveryPlaybook({ stateRoot = DEFAULT_STATE_ROOT } = {}) {
  const paths = recoveryStatePaths(stateRoot);
  return withRecoveryLock(stateRoot, async () => {
    const data = await readEvents(paths.eventsPath);
    if (!data.valid) throw new Error("recovery-memory-events-invalid");
    return rebuildIndex(paths, data.events);
  });
}

function normalizeIncident(input, date) {
  const week = normalizeWeek(input.week);
  const sourceId = cleanSource(input.sourceId);
  const errorClass = safeSignal(input.errorClass || "unknown-failure");
  const errorSignal = safeSignal(input.errorSignal || errorClass);
  const runId = cleanRunId(input.runId);
  const layer = Number(input.layer) || recoveryLayerForAttempt(input.attemptKind) || 1;
  if (![1, 2, 3].includes(layer)) throw new Error("recovery-layer-invalid");
  const actionCode = ACTION_CODES.has(input.actionCode) ? input.actionCode : "verify-only";
  const outcome = OUTCOMES.has(input.outcome) ? input.outcome : "inconclusive";
  const eventType = ["failure", "recovery", "manual-repair", "verification", "prevention"].includes(input.eventType)
    ? input.eventType : (outcome === "failed" ? "failure" : "recovery");
  const rootCauseStatus = ["confirmed", "unconfirmed", "not-applicable"].includes(input.rootCauseStatus) ? input.rootCauseStatus : "unconfirmed";
  const verification = ["pending", "verified", "failed", "not-applicable"].includes(input.verification) ? input.verification : "pending";
  const evidenceRef = cleanEvidenceRef(input.evidenceRef);
  const sourceVersion = normalizeVersion(input.sourceVersion || input.evidence?.sourceVersion);
  const evidence = normalizeEvidence(input.evidence, week, sourceVersion);
  if (rootCauseStatus === "confirmed" && (verification !== "verified" || !evidenceRef)) throw new Error("confirmed-root-cause-requires-verified-evidence");
  const unknown = errorClass === "UNKNOWN-FAILURE" || errorClass === "UNKNOWN";
  const suppliedProblemId = /^P-[a-f0-9]{16}$/.test(String(input.problemId || "")) ? String(input.problemId) : "";
  const problemId = suppliedProblemId || (unknown
    ? `P-${createHash("sha256").update(`${sourceId}\0${errorClass}\0${errorSignal}\0${runId || randomUUID()}`).digest("hex").slice(0, 16)}`
    : `P-${createHash("sha256").update(`${sourceId}\0${errorClass}\0${errorSignal}`).digest("hex").slice(0, 16)}`);
  const eventAt = input.at === undefined ? date : input.at;
  const parsedAt = eventAt instanceof Date ? eventAt : new Date(eventAt);
  if (!Number.isFinite(parsedAt.getTime())) throw new Error("recovery-event-time-invalid");
  return {
    schemaVersion: 1,
    eventId: String(input.eventId || randomUUID()),
    runId,
    problemId,
    at: parsedAt.toISOString(),
    week,
    sourceId,
    errorClass,
    errorSignal,
    layer,
    eventType,
    attemptKind: cleanEnumText(input.attemptKind, 32),
    actionCode,
    actionPreconditions: normalizePreconditions(input.actionPreconditions),
    actionNote: sanitizeNote(input.actionNote),
    outcome,
    actor: ["automation", "agent", "user"].includes(input.actor) ? input.actor : "automation",
    rootCauseStatus,
    rootCauseNote: sanitizeNote(input.rootCauseNote),
    hypothesisNote: sanitizeNote(input.hypothesisNote),
    sourceVersion,
    evidence,
    evidenceRef,
    verification
  };
}

async function rebuildIndex(paths, events) {
  const problems = new Map();
  const actions = new Map();
  for (const event of events) {
    const problem = problems.get(event.problemId) || {
      problemId: event.problemId, sourceId: event.sourceId, errorClass: event.errorClass, errorSignal: event.errorSignal,
      firstSeenAt: event.at, lastSeenAt: event.at, weeks: [], layers: [], attempts: [], failureCount: 0,
      recoveryCount: 0, manualRepairCount: 0, rootCauseStatus: "unconfirmed", preventionStatus: "pending", evidenceRefs: [], occurrenceRuns: [], permanentRepairCandidate: false
    };
    problem.firstSeenAt = event.at < problem.firstSeenAt ? event.at : problem.firstSeenAt;
    problem.lastSeenAt = event.at > problem.lastSeenAt ? event.at : problem.lastSeenAt;
    if (!problem.weeks.includes(event.week) && event.outcome === "failed") problem.weeks.push(event.week);
    if (event.outcome === "failed" && event.runId && !problem.occurrenceRuns.includes(event.runId)) problem.occurrenceRuns.push(event.runId);
    if (!problem.layers.includes(event.layer)) problem.layers.push(event.layer);
    if (event.attemptKind && !problem.attempts.includes(event.attemptKind)) problem.attempts.push(event.attemptKind);
    if (event.outcome === "failed") problem.failureCount += 1;
    if (event.eventType === "recovery" && event.outcome === "succeeded") problem.recoveryCount += 1;
    if (event.eventType === "manual-repair") problem.manualRepairCount += 1;
    if (event.rootCauseStatus === "confirmed") problem.rootCauseStatus = "confirmed";
    if (event.eventType === "prevention" && event.outcome === "verified" && event.rootCauseStatus === "confirmed" && event.verification === "verified") problem.preventionStatus = "verified";
    if (event.evidenceRef && !problem.evidenceRefs.includes(event.evidenceRef)) problem.evidenceRefs.push(event.evidenceRef);
    problem.weeks.sort();
    problem.layers.sort();
    problem.permanentRepairCandidate ||= recurrenceThresholdReached(problem.weeks, problem.occurrenceRuns);
    problems.set(event.problemId, problem);

    if (["manual-repair", "recovery", "verification", "prevention"].includes(event.eventType) && event.actionNote) {
      const key = `${event.sourceId}|${event.errorSignal}|${event.sourceVersion || ""}|${event.layer}|${event.actionCode}|${event.actionPreconditions.join(",")}`;
      const experience = actions.get(key) || {
        sourceId: event.sourceId, errorClass: event.errorClass, errorSignal: event.errorSignal, sourceVersion: event.sourceVersion || "", actionCode: event.actionCode,
        layer: event.layer, actionNote: event.actionNote, actionPreconditions: event.actionPreconditions, successCount: 0, failureCount: 0, lastOutcome: event.outcome,
        lastUsedAt: event.at, validation: "candidate", evidenceRefs: []
      };
      if (["succeeded", "verified"].includes(event.outcome)) experience.successCount += 1;
      if (["failed", "rejected"].includes(event.outcome)) experience.failureCount += 1;
      experience.actionNote = event.actionNote;
      experience.lastOutcome = event.outcome;
      experience.lastUsedAt = event.at;
      if (event.verification === "verified" || event.outcome === "verified") experience.validation = "verified";
      if (event.verification === "failed" || ["failed", "rejected"].includes(event.outcome)) experience.validation = "invalidated";
      if (event.evidenceRef && !experience.evidenceRefs.includes(event.evidenceRef)) experience.evidenceRefs.push(event.evidenceRef);
      actions.set(key, experience);
    }
  }
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceOfTruth: EVENTS_FILE,
    eventCount: events.length,
    lastEventId: events.at(-1)?.eventId || null,
    problems: [...problems.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    experiences: [...actions.values()].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
    permanentRepairCandidates: [...problems.values()].filter((item) => item.permanentRepairCandidate)
      .map((item) => ({ problemId: item.problemId, sourceId: item.sourceId, errorClass: item.errorClass, errorSignal: item.errorSignal, weeks: item.weeks,
        suggestedRegression: `复现 ${item.sourceId} 的 ${item.errorSignal}，并验证目标周、来源状态和实际产物读回。`, status: item.preventionStatus }))
  };
  const temp = `${paths.indexPath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temp, paths.indexPath); }
  finally { await rm(temp, { force: true }); }
  return index;
}

function recurrenceThresholdReached(weeks, runs = []) {
  if (runs.length >= 3 || weeks.length >= 3) return true;
  for (let index = 1; index < weeks.length; index += 1) if (weekDistance(weeks[index - 1], weeks[index]) === 1) return true;
  return false;
}

function normalizeEvidence(value, defaultWeek, sourceVersion) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  const statuses = new Set(["pending", "running", "ready", "empty", "succeeded", "failed", "unavailable", "needs_review"]);
  if (statuses.has(input.sourceStatus)) output.sourceStatus = input.sourceStatus;
  const phase = ["preflight", "collection", "observation", "readback", "preprocess", "validation", "repair", "delivery"].includes(input.phase) ? input.phase : "";
  if (phase) output.phase = phase;
  const targetWeek = safeWeekOrEmpty(input.targetWeek || defaultWeek);
  const coverageWeek = safeWeekOrEmpty(input.coverageWeek);
  if (targetWeek) output.targetWeek = targetWeek;
  if (coverageWeek) output.coverageWeek = coverageWeek;
  const version = normalizeVersion(input.sourceVersion || sourceVersion);
  if (version) output.sourceVersion = version;
  for (const key of ["count", "expectedCount", "observedCount", "omittedCount"]) {
    const number = Number(input[key]);
    if (Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000_000) output[key] = number;
  }
  for (const key of ["artifactSha256", "snapshotSha256", "templateSha256", "patchSha256", "baselineDigest", "resultDigest", "reviewerReceiptSha256"]) {
    const hash = String(input[key] || "").toLowerCase();
    if (/^[a-f0-9]{64}$/.test(hash)) output[key] = hash;
  }
  for (const key of ["patchFileCount", "addedLines", "deletedLines", "rollbackRestoredCount", "rollbackConflictCount"]) {
    const number = Number(input[key]);
    if (Number.isSafeInteger(number) && number >= 0 && number <= 1000) output[key] = number;
  }
  if (["not-needed", "restored", "partial-conflict", "conflict", "unknown"].includes(input.rollbackStatus)) output.rollbackStatus = input.rollbackStatus;
  for (const key of ["originalFailureObserved", "originalFailureFixed", "counterexampleBaselinePassed", "counterexampleAfterPassed"]) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (Array.isArray(input.changedFiles)) {
    const changedFiles = [...new Set(input.changedFiles.map(cleanEvidenceRef).filter(Boolean))].slice(0, 3);
    if (changedFiles.length) output.changedFiles = changedFiles;
  }
  return output;
}

function safeWeekOrEmpty(value) {
  try { return normalizeWeek(value); } catch { return ""; }
}

function normalizePreconditions(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.filter((item) => REPAIR_PRECONDITIONS.has(item)))].slice(0, 8).sort();
}

function normalizeVersion(value) {
  const version = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version) ? version : "";
}

function weekDistance(left, right) {
  const a = weekMonday(left), b = weekMonday(right);
  return Math.round((b - a) / 604800000);
}
function weekMonday(week) {
  const [year, number] = normalizeWeek(week).split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(year, 0, 4 - day + (number - 1) * 7));
}

async function readEvents(file) {
  try {
    const raw = await readFile(file, "utf8");
    const events = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (events.some((event) => event.schemaVersion !== 1 || !event.eventId || !event.problemId || !event.sourceId)) return { valid: false, events: [] };
    return { valid: true, events };
  } catch (error) {
    if (error.code === "ENOENT") return { valid: true, events: [] };
    return { valid: false, events: [], reason: error instanceof SyntaxError ? "events-corrupt" : "events-unreadable" };
  }
}

async function withRecoveryLock(stateRoot, action) {
  const paths = recoveryStatePaths(stateRoot);
  await mkdir(paths.root, { recursive: true });
  const deadline = Date.now() + 5000;
  let lock;
  while (!lock) {
    try { lock = await open(paths.lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await reapDeadLock(paths.lockPath)) continue;
      if (Date.now() >= deadline) throw new Error("recovery-memory-lock-timeout");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8"); }
  finally { await lock.close(); }
  try { return await action(paths); }
  finally { await rm(paths.lockPath, { force: true }); }
}

async function reapDeadLock(lockPath) {
  let current;
  try { current = JSON.parse(await readFile(lockPath, "utf8")); }
  catch { return false; }
  if (!Number.isInteger(current.pid) || current.pid < 1) return false;
  try { process.kill(current.pid, 0); return false; }
  catch (error) {
    if (error.code !== "ESRCH") return false;
    try {
      const again = JSON.parse(await readFile(lockPath, "utf8"));
      if (again.pid !== current.pid || again.createdAt !== current.createdAt) return false;
      await rm(lockPath);
      return true;
    } catch (removeError) { return removeError.code === "ENOENT"; }
  }
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > isoWeeksInYear(Number(match[1]))) throw new Error("recovery-week-invalid");
  return `${match[1]}-W${match[2]}`;
}
function cleanSource(value) {
  const source = String(value || "");
  if (!SOURCE_ID.test(source)) throw new Error("recovery-source-invalid");
  return source;
}
function safeSignal(value) {
  const signal = String(value || "UNKNOWN-FAILURE").toUpperCase().replace(/\s+/g, "-");
  return SAFE_SIGNALS.has(signal)
    || /^UNKNOWN-[A-F0-9]{16}$/.test(signal)
    || /^UNKNOWN-UNATTRIBUTED-[A-F0-9]{16}$/.test(signal)
    ? signal
    : "UNKNOWN-FAILURE";
}
function cleanEnumText(value, max) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, max);
}
function cleanRunId(value) { return /^[A-Za-z0-9-]{1,48}$/.test(String(value || "")) ? String(value) : ""; }
function sanitizeNote(value) {
  const note = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!note || note.length > 80 || !/^[\p{L}\p{M}\p{Zs}，。；：、（）()·-]+$/u.test(note)) return "";
  if (/(?:prompt|password|token|secret|cookie|session|api.?key|npm|pnpm|yarn|node|python|git|curl|wget|bash|zsh|shell|lark-cli|sudo|exec|手机号|身份证|银行卡|住址|病历|体检|医院|医生|血压|血糖|心率|体温|健康数据|聊天|对话|正文|姓名|电话)/i.test(note)) return "";
  return note;
}
function cleanEvidenceRef(value) {
  const ref = String(value || "").replaceAll("\\", "/");
  if (!ref || ref.startsWith("/") || ref.includes("..") || !/^[A-Za-z0-9_./-]{1,160}$/.test(ref)) return "";
  return ref;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (key, fallback = "") => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1]; };
  try {
    let result;
    if (args.includes("--record-repair")) result = await recordManualRepair({
      week: value("--week"), sourceId: value("--source"), symptom: value("--symptom"), problemId: value("--problem-id"), actionCode: value("--action-code", "manual-repair"),
      runId: value("--run-id"), actionNote: value("--note"), evidenceRef: value("--evidence"), verification: value("--verification", "candidate"),
      rootCauseStatus: value("--root-cause", "unconfirmed"), sourceVersion: value("--source-version"),
      eventType: value("--event-type", "manual-repair"), layer: Number(value("--layer", "2")), actionPreconditions: value("--preconditions"),
      evidence: { targetWeek: value("--target-week"), sourceStatus: value("--source-status"), count: value("--count"), expectedCount: value("--expected-count"),
        observedCount: value("--observed-count"), omittedCount: value("--omitted-count"), artifactSha256: value("--artifact-sha256") }, actor: "user"
    });
    else if (args.includes("--rebuild")) result = await rebuildRecoveryPlaybook();
    else if (args.includes("--show-problem")) result = await findRecoveryProblems({ week: value("--week"), sourceId: value("--source"),
      errorSignal: value("--symptom"), runId: value("--run-id") });
    else result = await queryRecoveryPlaybook({ sourceId: value("--source"), errorSignal: value("--symptom"), sourceVersion: value("--source-version"),
      layer: Number(value("--layer", "2")), satisfiedPreconditions: value("--satisfied-preconditions") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

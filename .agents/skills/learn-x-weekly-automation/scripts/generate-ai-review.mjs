import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { readFile, link, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAiReview } from "../../learn-x-process/scripts/monthly-process-input.mjs";
import { isoWeekRange } from "../../learn-x-process/scripts/collect-weekly-input.mjs";
import { tryAcquireWeeklyAiLock, validateWeeklyAiLockToken } from "./lib/weekly-ai-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const defaultBridgePath = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const maxInputChars = 15_000;
const defaultBridgeConversationUrl = "https://chatgpt.com/";
const uncertainAiResubmitAfterMs = 20 * 60_000;
// Bridge 默认预算为 120 秒观察 + 90 秒传输/清理余量；适配器必须覆盖完整协议预算。
export const DEFAULT_BRIDGE_TIMEOUT_MS = 270_000;
// Bridge image 模式（生图）观察预算为 600 秒（对齐 Voice-X / Read-X），适配器覆盖完整预算。
export const IMAGE_BRIDGE_TIMEOUT_MS = 780_000;

export function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${value}. Use YYYY-Www.`);
  const week = `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
  isoWeekRange(week);
  return week;
}

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

const safeWeeklyAiReasons = new Set([
  "snapshot-mismatch", "observer-window-ended", "observer-timeout", "assistant-selector-missing",
  "chatgpt-rate-limited", "login-required", "captcha-or-blocked", "ego-bootstrap-permission",
  "bridge-observation-identity-mismatch", "empty-ai-review", "ai-review-too-large", "invalid-ai-review",
  "bridge-observe-result-missing", "bridge-result-missing", "bridge-timeout", "bridge-process-error",
  "promotion-readback-hash-mismatch", "promotion-status-readback-failed", "promotion-refuses-substantive-ai-md",
  "manual-ai-review-invalid", "manual-ai-review-changed-after-confirmation", "weekly-ai-run-in-progress",
  "formal-ai-md-has-human-content", "confirmed-ai-md-changed", "confirmed-ai-md-missing",
  "formal-ai-md-changed-after-promotion", "bridge-conversation-url-missing", "bridge-observe-interface-unavailable",
  "formal-ai-md-exists-during-promotion",
  "formal-ai-md-changed-during-promotion",
  "bridge-observe-unavailable", "previous-run-needs-review", "substantive-ai-md-exists", "uncertain-resubmission-in-progress",
  "promotion-reconciliation-readback-failed", "uncertain-ai-resubmission-requires-confirmed-eligible-snapshot-mismatch",
  "uncertain-ai-resubmission-refuses-to-replace-substantive-ai-md", "manual-ai-review-state-not-eligible",
  "weekly-ai-resubmission-outcome-uncertain", "weekly-ai-resubmission-exhausted",
  "conversation-session-mismatch", "conversation-session-not-bound", "observer-identity-mismatch",
  "original-run-identity-mismatch", "submission-unconfirmed", "new-user-message-not-found",
  "new-assistant-message-not-found", "assistant-order-invalid", "generation-in-progress",
  "image-output-not-ready", "output-markers-missing", "response-body-not-ready", "response-text-unstable",
  "observer-state-unavailable", "original-run-result-pending", "original-run-not-observable",
  "recoverable-result-unavailable", "ego-runtime-evaluate-timeout", "ego-script-process-timeout",
  "ego-script-outcome-unknown", "ego-operation-failed", "ego-host-error", "recovery-lease-heartbeat-failed", "task-space-cleanup-failed",
  "cleanup-failed", "image-fetch-failed", "image-read-failed", "image-extract-failed", "image-src-missing",
  "output-boundary-invalid", "history-verification-failed", "local-state-unavailable", "bridge-internal-error",
  "submit-timeout", "submit-observer-unavailable", "composer-missing", "composer-not-empty",
  "prompt-fill-not-confirmed", "send-button-missing", "conversation-history-not-ready",
  "conversation-navigation-not-confirmed", "runner-request-timeout", "ego-host-unavailable",
  "ego-host-connect-failed", "ego-host-disconnected", "ego-host-timeout", "ego-host-protocol-error",
  "ego-browser-unavailable", "local-rate-limit-cooldown", "bridge-busy", "image-mode-exact-input-unsupported",
  "invalid-observe-request", "invalid-preallocated-run-id", "invalid-request-id", "invalid-runner-request",
  "invalid-bridge-transport", "invalid-observer-output", "invalid-submit-result", "invalid-bridge-result-status",
  "bridge-result-status-missing", "invalid-caller-label", "invalid-prompt", "invalid-mode",
  "unsupported-runner-version", "unsupported-runner-operation", "invalid-response-path", "invalid-runner-json",
  "invalid-client-request", "assistant-selector-missing", "observer-window-ended", "observer-timeout",
  "snapshot-mismatch", "chatgpt-rate-limited", "login-required", "captcha-or-blocked", "empty-prompt",
  "prompt-too-large", "invalid-conversation-url", "invalid-max-wait", "original-run-receipt-invalid",
  "original-run-receipt-unavailable", "recovery-lease-unavailable", "receipt-write-failed", "append-failed",
  "diagnostic-write-failed", "ego-bootstrap-permission", "composer-missing", "chat-mode-switch-failed",
]);
const safeSystemErrorCodes = new Set([
  "EACCES", "EAGAIN", "EBUSY", "EEXIST", "EIO", "EINVAL", "EISDIR", "EMFILE", "ENFILE", "ENOENT",
  "ENOSPC", "ENOTDIR", "EPERM", "EPIPE", "ETIMEDOUT", "EWOULDBLOCK",
]);
const safeChildErrorCode = (error) => {
  const code = String(error?.code || "").toUpperCase();
  return safeSystemErrorCodes.has(code) ? code : "other";
};
const weeklyAiObserverReasons = new Set([
  "snapshot-mismatch", "observer-window-ended", "observer-timeout", "assistant-selector-missing",
  "chatgpt-rate-limited", "bridge-observation-identity-mismatch", "bridge-observe-result-missing",
  "bridge-observe-unavailable", "bridge-observe-interface-unavailable", "output-boundary-invalid", "history-verification-failed",
  "conversation-session-mismatch",
  "conversation-session-not-bound", "observer-identity-mismatch", "submission-unconfirmed",
  "new-user-message-not-found", "new-assistant-message-not-found", "assistant-order-invalid",
  "generation-in-progress", "image-output-not-ready", "output-markers-missing", "response-body-not-ready",
  "response-text-unstable", "observer-state-unavailable", "original-run-result-pending", "original-run-not-observable",
  "recoverable-result-unavailable", "ego-runtime-evaluate-timeout", "ego-script-process-timeout",
  "ego-script-outcome-unknown", "image-extract-failed", "image-src-missing",
]);
const weeklyAiSubmitReasons = new Set([
  "login-required", "captcha-or-blocked", "ego-bootstrap-permission", "ego-browser-unavailable",
  "ego-host-unavailable", "ego-host-connect-failed", "ego-host-disconnected", "ego-host-timeout",
  "ego-host-protocol-error", "submit-timeout", "submit-observer-unavailable", "composer-missing",
  "composer-not-empty", "prompt-fill-not-confirmed", "send-button-missing", "chat-mode-switch-failed",
  "conversation-history-not-ready", "conversation-navigation-not-confirmed", "runner-request-timeout",
]);
const weeklyAiFailureStages = new Set(["local-gate", "submit", "observer", "cleanup", "runtime", "delivery", "recovery", "persistence", "validation", "unknown"]);
const weeklyAiPhases = new Set(["local-gate", "submit", "observe", "cleanup", "runtime", "delivery", "recovery", "persistence", "validation", "promotion", "manual-confirmation", "unknown"]);

function weeklyAiFailureClassification(result, reason, succeeded) {
  const code = typeof reason === "string" ? reason : "";
  if (succeeded) return {
    failureStage: "delivery",
    phase: result.completionSource === "user-manual" ? "manual-confirmation" : "delivery",
  };
  const declaredPhase = result.phase || result.diagnostics?.phase;
  const declaredStage = result.failureStage || result.diagnostics?.failureStage;
  let inferredStage = "unknown";
  let inferredPhase = "unknown";
  if (["bridge-busy", "local-rate-limit-cooldown", "weekly-ai-run-in-progress"].includes(code)) {
    inferredStage = "local-gate"; inferredPhase = "local-gate";
  } else if (["task-space-cleanup-failed", "cleanup-failed"].includes(code)) {
    inferredStage = "cleanup"; inferredPhase = "cleanup";
  } else if (weeklyAiObserverReasons.has(code)) {
    inferredStage = "observer"; inferredPhase = "observe";
  } else if (weeklyAiSubmitReasons.has(code)) {
    inferredStage = "submit"; inferredPhase = "submit";
  } else if (["empty-ai-review", "ai-review-too-large", "invalid-ai-review", "manual-ai-review-invalid", "manual-ai-review-changed-after-confirmation"].includes(code)) {
    inferredStage = "validation"; inferredPhase = "validation";
  } else if (["receipt-write-failed", "append-failed", "diagnostic-write-failed"].includes(code)) {
    inferredStage = "persistence"; inferredPhase = "persistence";
  } else if (code.startsWith("promotion-") || code.startsWith("formal-ai-md-") || code.startsWith("confirmed-ai-md-")) {
    inferredStage = "delivery"; inferredPhase = "promotion";
  } else if (["bridge-internal-error", "local-state-unavailable", "ego-operation-failed"].includes(code)) {
    inferredStage = "runtime"; inferredPhase = "runtime";
  } else if (["bridge-timeout", "bridge-process-error"].includes(code)) {
    inferredStage = "runtime"; inferredPhase = "runtime";
  } else if (["original-run-identity-mismatch", "original-run-receipt-invalid", "original-run-receipt-unavailable", "recovery-lease-unavailable", "recovery-lease-heartbeat-failed"].includes(code)) {
    inferredStage = "recovery"; inferredPhase = "recovery";
  }
  return {
    failureStage: weeklyAiFailureStages.has(declaredStage) ? declaredStage : inferredStage,
    phase: weeklyAiPhases.has(declaredPhase) ? declaredPhase : inferredPhase,
  };
}

export function weeklyAiOutcomeEvent(result = {}) {
  const attemptId = result.localAttemptId || result.runId;
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(attemptId)) return null;
  const succeeded = result.status === "confirmed";
  const failed = result.status === "failed";
  const generated = result.status === "generated";
  const startAt = Date.parse(result.resubmissionOf?.dispatchStartedAt || result.dispatchStartedAt || "");
  const endAt = Date.parse(result.confirmedAt || result.completedAt || "");
  const durationMs = Number.isFinite(startAt) && Number.isFinite(endAt) && endAt >= startAt ? endAt - startAt : undefined;
  const parentAttemptId = result.resubmissionOf?.runId;
  const observationReason = result.observation?.reason;
  const observationAt = Date.parse(result.observation?.observedAt || "");
  const resultAt = Date.parse(result.confirmedAt || result.completedAt || result.updatedAt || "");
  const hasExplicitStage = weeklyAiFailureStages.has(result.failureStage || result.diagnostics?.failureStage)
    || weeklyAiPhases.has(result.phase || result.diagnostics?.phase);
  const rootReasonIsCurrent = typeof result.reason === "string" && result.reason !== observationReason
    && (result.status === "failed" || hasExplicitStage
      || (Number.isFinite(resultAt) && Number.isFinite(observationAt) && resultAt > observationAt));
  const currentReason = rootReasonIsCurrent ? result.reason : observationReason || result.reason;
  const originalReason = result.originalReason || result.resubmissionOf?.reason
    || (observationReason && observationReason !== currentReason ? observationReason : undefined)
    || (currentReason === observationReason && result.reason && result.reason !== observationReason ? result.reason : undefined);
  const failure = weeklyAiFailureClassification(result, currentReason, succeeded);
  const systemErrorCode = result.systemErrorCode || result.diagnostics?.systemErrorCode;
  const completionSource = result.completionSource === "user-manual" ? "user-manual"
    : result.completionSource === "ai-generated" || generated ? "ai-generated" : "unknown";
  const recoveryStatus = succeeded ? "succeeded" : generated ? "pending" : failed ? "failed" : "needs_review";
  return {
    type: "weekly-ai-outcome",
    ...(result.targetWeek ? { week: result.targetWeek } : {}),
    attemptId,
    ...(typeof result.runId === "string" ? { runId: result.runId, taskRunId: result.runId } : {}),
    clientRequestId: attemptId,
    ...(typeof parentAttemptId === "string" ? { parentAttemptId } : {}),
    caller: "learn-x:weekly-ai",
    status: succeeded ? "succeeded" : generated ? "submitted" : failed ? "failed" : "needs_review",
    phase: failure.phase,
    failureStage: failure.failureStage,
    ...(typeof currentReason === "string" ? { reason: safeWeeklyAiReasons.has(currentReason) ? currentReason : "unknown" } : {}),
    ...(typeof originalReason === "string" ? { originalReason: safeWeeklyAiReasons.has(originalReason) ? originalReason : "unknown" } : {}),
    ...(typeof systemErrorCode === "string" ? { systemErrorCode: safeSystemErrorCodes.has(systemErrorCode) ? systemErrorCode : "unknown" } : {}),
    ...(typeof result.remoteOutcomeUnknown === "boolean" || result.reason === "bridge-timeout"
      ? { remoteOutcomeUnknown: result.remoteOutcomeUnknown === true || result.reason === "bridge-timeout" } : {}),
    ...(typeof result.localProcessExitConfirmed === "boolean" ? { localProcessExitConfirmed: result.localProcessExitConfirmed } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(Number.isSafeInteger(result.resubmissionCount) ? { attempts: result.resubmissionCount + 1 } : {}),
    deliveryStatus: succeeded ? "succeeded" : generated ? "pending" : failed ? "failed" : "needs_review",
    ...(typeof parentAttemptId === "string" ? { recoveryAction: "one-shot-resubmit", recoveryStatus } : {}),
    businessValidationStatus: succeeded || generated ? "succeeded" : "unknown",
    promotionStatus: succeeded ? "succeeded" : generated ? "pending" : "unknown",
    readbackStatus: succeeded ? "succeeded" : generated ? "pending" : "unknown",
    completionSource,
    humanConfirmed: result.humanConfirmed === true || (completionSource === "user-manual" && Boolean(result.manualConfirmation?.confirmedAt)),
    ...(typeof result.outputSha256 === "string" && /^[a-f0-9]{64}$/.test(result.outputSha256) ? { sourceFingerprint: result.outputSha256 } : {}),
  };
}

async function appendWeeklyAiDiagnostic(event, options = {}) {
  if (!event) return;
  if (typeof options.diagnosticWriter === "function") {
    try { await options.diagnosticWriter(event); }
    catch (error) {
      const code = safeSystemErrorCodes.has(String(error?.code || "").toUpperCase()) ? String(error.code).toUpperCase() : "unknown";
      await reportWeeklyAiDiagnosticWriteFailure(event, code, options);
    }
    return;
  }
  // Temporary-repository tests and previews must never write into the user's production journal.
  if (options.repoRoot && path.resolve(options.repoRoot) !== path.resolve(defaultRepoRoot)) return;
  if (process.env.EGO_GOVERNANCE_DISABLED === "1") return;
  try {
    const modulePath = path.resolve(defaultRepoRoot, "../browser-runtime-governance/runtime/lib/journal.mjs");
    const { append, DEFAULT_RUNTIME_DIR } = await import(pathToFileURL(modulePath).href);
    await append(process.env.EGO_RUNTIME_DIR || DEFAULT_RUNTIME_DIR, "learn-x-weekly-ai", event);
  } catch (error) {
    const code = safeSystemErrorCodes.has(String(error?.code || "").toUpperCase()) ? String(error.code).toUpperCase() : "unknown";
    await reportWeeklyAiDiagnosticWriteFailure(event, code, options);
  }
}

async function reportWeeklyAiDiagnosticWriteFailure(event, systemErrorCode, options = {}) {
  let fallbackStatus = "failed";
  let fallbackSystemErrorCode = "unknown";
  let retentionStatus = "unknown";
  try {
    const modulePath = path.resolve(defaultRepoRoot, "../browser-runtime-governance/runtime/lib/journal.mjs");
    const { append, prune } = await import(pathToFileURL(modulePath).href);
    const outboxDir = options.diagnosticOutboxRoot
      || path.join(options.repoRoot || defaultRepoRoot, "03_input/weekly/.diagnostic-outbox");
    const stableId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
    const week = typeof event.week === "string" ? normalizeWeek(event.week) : undefined;
    const pruneOutbox = options.diagnosticOutboxPruner || prune;
    try {
      await pruneOutbox(outboxDir, 30);
      retentionStatus = "ok";
    } catch (error) {
      retentionStatus = "failed";
      const code = String(error?.code || "").toUpperCase();
      fallbackSystemErrorCode = safeSystemErrorCodes.has(code) ? code : "unknown";
    }
    const fallbackEvent = {
      type: "diagnostic-write-failed",
      ...(typeof event.type === "string" ? { originalEventType: event.type } : {}),
      ...(week ? { week } : {}),
      ...(stableId(event.runId) ? { runId: stableId(event.runId), taskRunId: stableId(event.taskRunId) || stableId(event.runId) } : {}),
      ...(stableId(event.clientRequestId) ? { clientRequestId: stableId(event.clientRequestId) } : {}),
      ...(stableId(event.attemptId) ? { attemptId: stableId(event.attemptId) } : {}),
      ...(stableId(event.parentAttemptId) ? { parentAttemptId: stableId(event.parentAttemptId) } : {}),
      caller: "learn-x:weekly-ai",
      status: "failed",
      ...(typeof event.status === "string" ? { originalStatus: event.status } : {}),
      reason: "diagnostic-write-failed",
      ...(safeWeeklyAiReasons.has(event.reason) ? { originalReason: event.reason } : {}),
      errorCode: "diagnostic-write-failed",
      systemErrorCode,
      phase: "persistence",
      failureStage: "persistence",
      ...(typeof event.phase === "string" ? { originalPhase: event.phase } : {}),
      ...(typeof event.failureStage === "string" ? { originalFailureStage: event.failureStage } : {}),
      ...(typeof event.deliveryStatus === "string" ? { deliveryStatus: event.deliveryStatus } : {}),
      ...(typeof event.businessValidationStatus === "string" ? { businessValidationStatus: event.businessValidationStatus } : {}),
      ...(typeof event.promotionStatus === "string" ? { promotionStatus: event.promotionStatus } : {}),
      ...(typeof event.readbackStatus === "string" ? { readbackStatus: event.readbackStatus } : {}),
      ...(typeof event.completionSource === "string" ? { completionSource: event.completionSource } : {}),
      ...(typeof event.humanConfirmed === "boolean" ? { humanConfirmed: event.humanConfirmed } : {}),
      ...(typeof event.recoveryStatus === "string" ? { recoveryStatus: event.recoveryStatus } : {}),
      ...(Number.isSafeInteger(event.durationMs) ? { durationMs: event.durationMs } : {}),
      ...(Number.isSafeInteger(event.attempts) ? { attempts: event.attempts } : {}),
      fallbackRetentionStatus: retentionStatus,
      ...(retentionStatus === "failed" ? { fallbackSystemErrorCode } : {}),
      diagnosticWriteFailed: true,
    };
    await append(outboxDir, "learn-x-weekly-ai", fallbackEvent);
    fallbackStatus = "persisted";
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    fallbackSystemErrorCode = safeSystemErrorCodes.has(code) ? code : "unknown";
  }
  process.stderr.write(`${JSON.stringify({
    event: "learn-x-weekly-ai-diagnostic-write-failed",
    errorCode: "diagnostic-write-failed",
    systemErrorCode,
    fallbackStatus,
    ...(fallbackStatus === "failed" || retentionStatus === "failed" ? { fallbackSystemErrorCode } : {}),
    ...(fallbackStatus === "persisted" ? { fallbackRetentionStatus: retentionStatus } : {}),
  })}\n`);
}

export async function readWeeklyAiDiagnosticOutbox(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = options.week ? normalizeWeek(options.week) : undefined;
  const outboxDir = options.diagnosticOutboxRoot || path.join(repoRoot, "03_input/weekly/.diagnostic-outbox");
  const modulePath = path.resolve(defaultRepoRoot, "../browser-runtime-governance/runtime/lib/journal.mjs");
  const { readRange } = await import(pathToFileURL(modulePath).href);
  const events = await readRange(outboxDir, 30);
  return events
    .filter((event) => event.source === "learn-x-weekly-ai" && event.type === "diagnostic-write-failed")
    .filter((event) => !week || event.week === week)
    .map((event) => ({
      t: event.t,
      week: event.week || "unknown",
      runId: event.runId,
      taskRunId: event.taskRunId,
      clientRequestId: event.clientRequestId,
      attemptId: event.attemptId,
      parentAttemptId: event.parentAttemptId,
      reason: event.reason,
      originalReason: event.originalReason,
      originalEventType: event.originalEventType,
      originalStatus: event.originalStatus,
      systemErrorCode: event.systemErrorCode || "unknown",
      fallbackRetentionStatus: event.fallbackRetentionStatus || "unknown",
      ...(event.fallbackSystemErrorCode ? { fallbackSystemErrorCode: event.fallbackSystemErrorCode } : {}),
      phase: event.phase || "unknown",
      failureStage: event.failureStage || "unknown",
      originalPhase: event.originalPhase,
      originalFailureStage: event.originalFailureStage,
      deliveryStatus: event.deliveryStatus,
      businessValidationStatus: event.businessValidationStatus,
      promotionStatus: event.promotionStatus,
      readbackStatus: event.readbackStatus,
      completionSource: event.completionSource,
      humanConfirmed: event.humanConfirmed,
    }));
}

export async function readWeeklyAiDiagnosticStatus(options = {}) {
  const events = await readWeeklyAiDiagnosticOutbox(options);
  const retentionStatus = events.length === 0 ? "unknown"
    : events.some((event) => event.fallbackRetentionStatus === "failed") ? "failed"
      : events.every((event) => event.fallbackRetentionStatus === "ok") ? "ok" : "unknown";
  return {
    status: events.length ? "degraded" : "unknown",
    reason: events.length ? undefined : "no-fallback-events-in-window",
    coverage: "local-diagnostic-outbox-only",
    lookbackDays: 30,
    ...(options.week ? { week: normalizeWeek(options.week) } : {}),
    count: events.length,
    retentionStatus,
    events,
  };
}

function conversationOriginMatches(requestedUrl, observedUrl) {
  try {
    const requested = new URL(requestedUrl);
    const observed = new URL(observedUrl);
    const requestedPath = requested.pathname.replace(/\/+$/, "") || "/";
    const observedPath = observed.pathname.replace(/\/+$/, "") || "/";
    return requested.protocol === "https:" && observed.protocol === "https:"
      && requested.origin === observed.origin && requestedPath === observedPath;
  } catch {
    return false;
  }
}

function isBoundChatGptConversationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === "https://chatgpt.com"
      && /^\/c\/[^/]+\/?$/.test(url.pathname) && !/^\/c\/new\/?$/i.test(url.pathname);
  } catch { return false; }
}

export function manualAiShell(week) {
  return `# AI 周回顾｜${week}\n\n<!-- 手动完成后，将 ChatGPT 返回的完整 Markdown 正文粘贴到这里；不要粘贴提示词或外层代码块。 -->\n`;
}

export function buildReviewPrompt(template, week) {
  const range = isoWeekRange(week);
  const start = range.start.toISOString().slice(0, 10);
  const end = new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10);
  return [
    "你正在执行 Learn-X 的 AI 周回顾自动化。",
    `目标回顾周期：${week}（${start} 至 ${end}，Asia/Shanghai）。`,
    "请严格执行下面原有提示词，只回顾目标周期，不要把其它周期内容混入结果。",
    "输出前必须自检：正文必须包含以下四个原样的二级标题，缺一不可：",
    "## 具体的人和事（独立主线，优先保留）",
    "## 本周议题",
    "## 精华议题摘要",
    "## 核心洞察与判断变化",
    "",
    "--- 原有提示词开始 ---",
    template.trim(),
    "--- 原有提示词结束 ---"
  ].join("\n");
}

export function stripOuterMarkdownFence(text) {
  const normalized = String(text || "").trim();
  const match = normalized.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (match ? match[1] : normalized).trim();
}

export function normalizeAiReviewText(text) {
  return stripOuterMarkdownFence(text).split("\n").map((line) => {
    const candidate = line
      .trim()
      .replace(/^\*{1,2}|\*{1,2}$/g, "")
      .replace(/^\d+[.)、]\s*/, "")
      .trim();
    if (/^(具体的人和事（独立主线，优先保留）|本周议题|本周反复思考的核心问题|精华议题摘要|精华问题摘要|核心洞察与判断变化|核心洞察|最值得沉淀|最值得自动化的重复工作流|最值得交给 Codex 执行的任务)$/.test(candidate) && !/^#{1,6}\s/.test(line.trim())) {
      return `## ${{ "本周反复思考的核心问题": "本周议题", "精华问题摘要": "精华议题摘要" }[candidate] || candidate}`;
    }
    return line;
  }).join("\n").trim();
}

export function parseJsonLines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  });
}

export function extractBridgePersistenceDiagnostics(stderr) {
  return parseJsonLines(stderr).flatMap((event) => {
    if (event.event === "bridge-primary-journal-write-failed") {
      return [{ reason: "diagnostic-write-failed", originalReason: "append-failed", failureStage: "persistence", phase: "persistence" }];
    }
    if (event.event === "bridge-client-journal-write-failed") {
      return [{ reason: "diagnostic-write-failed", failureStage: "persistence", phase: "persistence" }];
    }
    if (event.event === "bridge-client-journal-prune-failed") {
      return [{ reason: "diagnostic-write-failed", failureStage: "persistence", phase: "persistence" }];
    }
    return [];
  });
}

export async function runBridgeCli(prompt, options = {}) {
  const bridgePath = options.bridgePath || process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath;
  const image = Boolean(options.image);
  const timeoutMs = options.timeoutMs ?? (image ? IMAGE_BRIDGE_TIMEOUT_MS : DEFAULT_BRIDGE_TIMEOUT_MS);
  const args = [bridgePath];
  if (image) args.push("--image");
  if (options.preallocatedRunId) args.push("--run-id", options.preallocatedRunId);
  if (options.conversationUrl) args.push("--conversation-url", options.conversationUrl);
  if (options.callerLabel || options.sourceId === "ai") args.push("--caller-label", options.callerLabel || "learn-x:weekly-ai");
  if (options.contextPackDelivery !== undefined) args.push("--context-pack-delivery-json", JSON.stringify(options.contextPackDelivery));
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let processErrorCode;
  child.once("error", (error) => {
    processErrorCode = safeChildErrorCode(error);
  });
  child.stdin.on("error", (error) => {
    processErrorCode ||= safeChildErrorCode(error);
  });
  try { child.stdin.end(prompt); }
  catch (error) {
    processErrorCode = safeChildErrorCode(error);
  }

  const exit = await new Promise((resolve) => {
    const termGraceMs = Number.isSafeInteger(options.termGraceMs) ? Math.max(0, Math.min(options.termGraceMs, 30_000)) : 1_000;
    const killGraceMs = Number.isSafeInteger(options.killGraceMs) ? Math.max(0, Math.min(options.killGraceMs, 30_000)) : 5_000;
    let timedOut = false;
    let settled = false;
    let timeoutTimer;
    let termTimer;
    let killTimer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      resolve({ ...value, ...(processErrorCode ? { errorCode: processErrorCode } : {}) });
    };
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      termTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill("SIGKILL"); } catch {}
        killTimer = setTimeout(() => finish({
          code: null, signal: null, timedOut: true, localProcessExitConfirmed: false, remoteOutcomeUnknown: true,
        }), killGraceMs);
      }, termGraceMs);
    }, timeoutMs);
    child.once("close", (code, signal) => {
      finish({
        code, signal, timedOut,
        localProcessExitConfirmed: true,
        ...(timedOut ? { remoteOutcomeUnknown: true } : {}),
      });
    });
  });

  const result = [...parseJsonLines(`${stdout}\n${stderr}`)].reverse().find((value) => typeof value.status === "string");
  return { result, exit, persistenceDiagnostics: extractBridgePersistenceDiagnostics(stderr) };
}

export async function observeBridgeCli(previous, options = {}) {
  const bridgePath = options.bridgePath || process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath;
  try {
    const bridgeModule = await import(pathToFileURL(bridgePath).href);
    if (typeof bridgeModule.observeBridge !== "function") {
      return { result: { status: "needs_review", runId: previous?.runId, reason: "bridge-observe-interface-unavailable" } };
    }
    const callerLabel = options.callerLabel || previous?.callerLabel || "learn-x:weekly-ai";
    if (typeof previous?.conversationUrl !== "string" || !previous.conversationUrl.trim()) {
      return { result: { status: "needs_review", runId: previous?.runId, reason: "bridge-conversation-url-missing" } };
    }
    const result = await bridgeModule.observeBridge({
      originalRunId: previous?.runId,
      conversationUrl: previous?.conversationUrl,
      maxWaitSeconds: options.observeWaitSeconds || 720,
      callerLabel,
      transport: options.bridgeTransport
    });
    return { result, exit: { code: result?.status === "succeeded" ? 0 : 2, timedOut: false } };
  } catch (error) {
    return { result: { status: "needs_review", runId: previous?.runId, reason: "bridge-observe-unavailable", diagnostics: { errorCode: error?.code || "module-load-failed" } }, exit: { code: 2, timedOut: false } };
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureManualAiShell(paths, week) {
  return await writeExclusive(paths.formalPath, manualAiShell(week), "manual");
}

async function ensureManualAiShellForUnrecoverableFailure(paths, week, runId) {
  const stableRunId = typeof runId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId);
  if (stableRunId) return false;
  return await ensureManualAiShell(paths, week);
}

async function writeAtomic(filePath, content, suffix = "tmp") {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.${suffix}`);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
}

async function writeExclusive(filePath, content, suffix = "tmp") {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.${suffix}`);
  try {
    await writeFile(tempPath, content, "utf8");
    await link(tempPath, filePath);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    try { await unlink(tempPath); } catch {}
  }
}

function weekPaths(repoRoot, week) {
  const weekDir = path.join(repoRoot, "03_input/weekly", week);
  return {
    weekDir,
    templatePath: path.join(repoRoot, "03_input/weekly/00_template/ai.md"),
    generatedPath: path.join(weekDir, "ai.generated.md"),
    invalidPath: path.join(weekDir, "_ai-invalid.generated.md"),
    formalPath: path.join(weekDir, "ai.md"),
    sidecarPath: path.join(weekDir, "_ai-generated.json"),
    archiveDir: path.join(repoRoot, "04_output/_dist/weekly", week)
  };
}

function isTemplateLike(text) {
  const sectionCount = [...String(text).matchAll(/^##\s+.+$/gm)].length;
  return /(请基于本次回顾周期|请输出\s*500|按当前日期生成一下文件名)/.test(String(text)) && sectionCount < 2;
}

function isSubstantiveExisting(text) {
  if (/^# AI 周回顾｜\d{4}-W\d{2}\s*\n\s*<!-- 手动完成后，将 ChatGPT 返回的完整 Markdown 正文粘贴到这里；不要粘贴提示词或外层代码块。 -->\s*$/u.test(String(text).trim())) return false;
  const normalized = String(text).replace(/[#>*_`|\s-]/g, "").trim();
  return Boolean(normalized) && !/^(x+|待补充|暂无|无|todo|placeholder)$/i.test(normalized) && !isTemplateLike(text);
}

async function promoteGeneratedSafely(repoRoot, week, prompt) {
  const paths = weekPaths(repoRoot, week);
  try { return await promoteAiReviewUnlocked({ repoRoot, week, confirm: true, manualPrompt: prompt }); }
  catch (error) {
    if (!["promotion-refuses-substantive-ai-md", "promotion-refuses-existing-ai-md"].includes(error?.message)) throw error;
    const previous = await readJson(paths.sidecarPath) || {};
    const hasHumanContent = error.message === "promotion-refuses-substantive-ai-md";
    const conflict = { ...previous, status: "needs_review", targetWeek: week,
      reason: hasHumanContent ? "formal-ai-md-has-human-content" : "formal-ai-md-exists-during-promotion",
      promotionStatus: "blocked-by-existing-content",
      manualPrompt: previous.manualPrompt || prompt, manualPath: paths.formalPath };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(conflict, null, 2)}\n`, "status");
    return conflict;
  }
}

function resultBase(week, prompt, startedAt) {
  return {
    schemaVersion: 1,
    targetWeek: week,
    promptSha256: sha256(prompt),
    startedAt,
    source: "chatgpt-web-bridge"
  };
}

async function generateAiReviewUnlocked(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  const paths = weekPaths(repoRoot, week);
  const startedAt = new Date().toISOString();
  await mkdir(paths.weekDir, { recursive: true });

  let previous = await readJson(paths.sidecarPath);
  const template = await readFile(paths.templatePath, "utf8");
  const prompt = buildReviewPrompt(template, week);
  if (previous?.status === "confirmed") {
    if (!await exists(paths.formalPath)) return { ...previous, status: "needs_review", targetWeek: week, reason: "confirmed-ai-md-missing", manualPrompt: previous.manualPrompt || prompt };
    const rawFormal = await readFile(paths.formalPath, "utf8");
    const contentMatches = previous.manualConfirmation?.sha256
      ? sha256(rawFormal) === previous.manualConfirmation.sha256
      : previous.outputSha256 && sha256(normalizeAiReviewText(rawFormal)) === previous.outputSha256;
    if (contentMatches) return { ...previous, targetWeek: week, formalPath: paths.formalPath };
    return { ...previous, status: "needs_review", targetWeek: week, reason: "confirmed-ai-md-changed", manualPrompt: previous.manualPrompt || prompt, manualPath: paths.formalPath };
  }
  if (previous?.status === "generated" && await exists(paths.formalPath)) {
    const formalText = normalizeAiReviewText(await readFile(paths.formalPath, "utf8"));
    if (sha256(formalText) === previous.outputSha256 && validateAiReview(formalText).valid) {
      const reconciled = { ...previous, status: "confirmed", confirmedAt: new Date().toISOString(), formalPath: paths.formalPath,
        promotionRecovered: true, completionSource: "ai-generated", readbackSha256: sha256(formalText) };
      const readback = await persistConfirmedPromotion(paths, reconciled, { week, manualPrompt: prompt });
      if (readback.status === "confirmed" && await exists(paths.generatedPath)) await unlink(paths.generatedPath);
      return { ...readback, targetWeek: week };
    }
    if (isSubstantiveExisting(formalText)) {
      const conflict = { ...previous, status: "needs_review", reason: "formal-ai-md-changed-after-promotion", manualPrompt: previous.manualPrompt || prompt,
        manualPath: paths.formalPath, promotionStatus: "blocked-by-existing-content" };
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(conflict, null, 2)}\n`, "status");
      return { ...conflict, targetWeek: week };
    }
  }
  if (await exists(paths.generatedPath)) {
    return await promoteGeneratedSafely(repoRoot, week, prompt);
  }
  if (previous?.resubmissionCount === 1 && !options.observeUncertain) {
    const exhausted = { ...previous, status: "needs_review", targetWeek: week,
      reason: previous.status === "dispatching" ? "weekly-ai-resubmission-outcome-uncertain" : previous.reason || "weekly-ai-resubmission-exhausted",
      manualPrompt: previous.manualPrompt || prompt, manualPath: paths.formalPath };
    await ensureManualAiShell(paths, week);
    if (previous.status === "dispatching") await writeAtomic(paths.sidecarPath, `${JSON.stringify(exhausted, null, 2)}\n`, "status");
    return exhausted;
  }
  let resubmissionOf = previous?.resubmissionOf || null;
  let bridge;
  let dispatchedRunId;
  let dispatchedStartedAt;
  const conversationUrl = options.conversationUrl || defaultBridgeConversationUrl;

  if (previous?.status === "needs_review" && previous.reason === "invalid-ai-review" && previous.promptSha256 === sha256(prompt) && await exists(paths.invalidPath)) {
    const recoveredText = normalizeAiReviewText(await readFile(paths.invalidPath, "utf8"));
    const recoveredValidation = validateAiReview(recoveredText);
    if (recoveredText.length <= maxInputChars && recoveredValidation.valid) {
      const recovered = {
        ...resultBase(week, prompt, startedAt),
        status: "generated",
        runId: previous.runId,
        outputSha256: sha256(recoveredText),
        conversationUrl: previous.conversationUrl,
        completedAt: new Date().toISOString(),
        recoveredFrom: paths.invalidPath,
        generatedPath: paths.generatedPath
      };
      await writeAtomic(paths.generatedPath, `${recoveredText}\n`, "draft");
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(recovered, null, 2)}\n`, "status");
      return await promoteGeneratedSafely(repoRoot, week, prompt);
    }
  }
  if (previous?.status === "dispatching" || previous?.dispatchState === "started") {
    const stableRunId = typeof previous.runId === "string"
      && previous.runId === previous.localAttemptId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous.runId);
    const uncertain = {
      ...previous,
      status: "needs_review",
      dispatchState: "uncertain",
      submissionStateUncertain: true,
      reason: previous.reason || (stableRunId ? "bridge-run-observation-pending" : "dispatch-receipt-missing"),
      manualPath: paths.formalPath
    };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(uncertain, null, 2)}\n`, "status");
    if (!stableRunId) {
      await ensureManualAiShell(paths, week);
      return { ...uncertain, targetWeek: week, manualPrompt: prompt, manualPath: paths.formalPath };
    }
    previous = uncertain;
  }
  if (previous?.status === "needs_review" && previous.submissionStateUncertain && !previous.runId) {
    const uncertain = { ...previous, dispatchState: "uncertain", reason: previous.reason || "dispatch-receipt-missing", manualPath: paths.formalPath };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(uncertain, null, 2)}\n`, "status");
    await ensureManualAiShell(paths, week);
    return { ...uncertain, targetWeek: week, manualPrompt: prompt, manualPath: paths.formalPath };
  }
  const safeRetryReasons = new Set(["ego-bootstrap-permission", "ego-browser-unavailable", "local-rate-limit-cooldown", "login-required", "captcha-or-blocked", "composer-missing", "chat-mode-switch-failed", "empty-ai-review", "ai-review-too-large", "invalid-ai-review"]);
  if (previous?.status === "needs_review" && options.observeUncertain) {
    if (await exists(paths.formalPath) && isSubstantiveExisting(await readFile(paths.formalPath, "utf8"))) {
      return { ...previous, targetWeek: week, reason: "substantive-ai-md-exists" };
    }
    if (typeof previous.conversationUrl !== "string" || !conversationOriginMatches(previous.conversationUrl, previous.conversationUrl)) {
      const updated = { ...previous, reason: "bridge-conversation-url-missing", observation: { status: "needs_review", reason: "bridge-conversation-url-missing", observedAt: new Date().toISOString() } };
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(updated, null, 2)}\n`, "status");
      await ensureManualAiShellForUnrecoverableFailure(paths, week, updated.runId);
      return { ...updated, targetWeek: week, manualPath: paths.formalPath };
    }
    const observe = options.observeBridge || observeBridgeCli;
    try { bridge = await observe(previous, options); }
    catch (error) { bridge = { result: { status: "needs_review", runId: previous.runId, reason: "bridge-observe-unavailable", diagnostics: { errorCode: error?.code || "observer-error" } } }; }
    const observed = bridge?.result;
    const expectedActualUrl = previous.actualConversationUrl || (isBoundChatGptConversationUrl(previous.conversationUrl) ? previous.conversationUrl : null);
    const observedActualUrl = observed?.actualConversationUrl || observed?.conversationUrl;
    const observationIdentityMatches = expectedActualUrl
      ? isBoundChatGptConversationUrl(observedActualUrl) && conversationOriginMatches(expectedActualUrl, observedActualUrl)
      : conversationOriginMatches(previous.requestedConversationUrl || previous.conversationUrl, observed?.requestedConversationUrl)
        && isBoundChatGptConversationUrl(observedActualUrl) && observed?.submissionConfirmed === true;
    const observationMatches = observed?.status === "succeeded"
      && observed.runId === previous.runId
      && observationIdentityMatches
      && typeof observed.text === "string" && observed.text.trim().length > 0;
    if (!observationMatches) {
      const observation = {
        status: observed?.status === "succeeded" ? "needs_review" : observed?.status || "needs_review",
        reason: observed?.status === "succeeded" && !observationMatches
          ? "bridge-observation-identity-mismatch"
          : observed?.reason || "bridge-observe-result-missing",
        runId: observed?.runId || previous.runId,
        submissionConfirmed: observed?.submissionConfirmed,
        requestedConversationUrl: observed?.requestedConversationUrl,
        actualConversationUrl: observed?.actualConversationUrl || observed?.conversationUrl,
        diagnostics: observed?.diagnostics,
        observedAt: new Date().toISOString()
      };
      const updated = { ...previous, observation,
        ...(observed?.submissionConfirmed === true ? { submissionConfirmed: true } : {}),
        ...(typeof observed?.requestedConversationUrl === "string" ? { requestedConversationUrl: observed.requestedConversationUrl } : {}),
        ...(typeof (observed?.actualConversationUrl || observed?.conversationUrl) === "string"
          ? { actualConversationUrl: observed.actualConversationUrl || observed.conversationUrl, conversationUrl: observed.actualConversationUrl || observed.conversationUrl } : {}) };
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(updated, null, 2)}\n`, "status");
      await ensureManualAiShellForUnrecoverableFailure(paths, week, updated.runId);
      return { ...updated, targetWeek: week, manualPath: paths.formalPath };
    }
  }
  if (options.resubmitUncertain) {
    const hasSavedOutput = await exists(paths.generatedPath) || await exists(paths.invalidPath);
    if (!options.confirm || hasSavedOutput || !isEligibleUncertainResubmission(previous, week, sha256(prompt))) {
      throw new Error("uncertain-ai-resubmission-requires-confirmed-eligible-snapshot-mismatch");
    }
    if (await exists(paths.formalPath) && isSubstantiveExisting(await readFile(paths.formalPath, "utf8"))) {
      throw new Error("uncertain-ai-resubmission-refuses-to-replace-substantive-ai-md");
    }
    resubmissionOf = {
      runId: previous.runId,
      reason: previous.reason,
      completedAt: previous.completedAt,
      dispatchStartedAt: previous.dispatchStartedAt,
      promptSha256: previous.promptSha256,
      authorizedBy: options.automaticResubmit ? "weekly-ai-20m-policy" : "user-explicit-resubmission",
      startedAt
    };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify({
      ...resultBase(week, prompt, startedAt),
      status: "needs_review",
      runId: previous.runId,
      localAttemptId: previous.localAttemptId,
      dispatchStartedAt: previous.dispatchStartedAt,
      submissionConfirmed: previous.submissionConfirmed === true,
      requestedConversationUrl: previous.requestedConversationUrl || conversationUrl,
      actualConversationUrl: previous.actualConversationUrl || previous.conversationUrl,
      reason: "uncertain-resubmission-in-progress",
      conversationUrl: previous.conversationUrl,
      diagnostics: previous.diagnostics,
      resubmissionOf,
      resubmissionCount: 1,
      resubmissionReservedAt: startedAt,
      automaticResubmit: options.automaticResubmit === true,
      manualPrompt: prompt,
      manualPath: paths.formalPath
    }, null, 2)}\n`, "status");
  }
  if (previous?.status === "needs_review" && !resubmissionOf && !(options.retry && safeRetryReasons.has(previous.reason)) && !bridge) {
    await ensureManualAiShellForUnrecoverableFailure(paths, week, previous.runId);
    return { status: "needs_review", targetWeek: week, reason: "previous-run-needs-review", manualPrompt: previous.manualPrompt || prompt, manualPath: paths.formalPath };
  }

  if (!bridge) {
    const runner = options.runBridge || runBridgeCli;
    const dispatchIntentAt = new Date().toISOString();
    const dispatchIntent = {
      ...resultBase(week, prompt, startedAt),
      status: "dispatching",
      dispatchState: "started",
      conversationUrl,
      requestedConversationUrl: conversationUrl,
      dispatchIntentAt,
      localAttemptId: randomUUID(),
      ...(resubmissionOf ? { reason: "uncertain-resubmission-in-progress" } : {}),
      callerLabel: options.callerLabel || "learn-x:weekly-ai",
      ...(resubmissionOf ? { resubmissionOf, resubmissionCount: 1,
        resubmissionReservedAt: previous?.resubmissionReservedAt || startedAt,
        automaticResubmit: options.automaticResubmit === true } : {})
    };
    dispatchIntent.runId = dispatchIntent.localAttemptId;
    dispatchedRunId = dispatchIntent.runId;
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(dispatchIntent, null, 2)}\n`, "dispatch");
    await appendWeeklyAiDiagnostic({
      type: "weekly-ai-dispatch-intent",
      week,
      runId: dispatchIntent.runId,
      taskRunId: dispatchIntent.runId,
      clientRequestId: dispatchIntent.runId,
      attemptId: dispatchIntent.runId,
      ...(typeof resubmissionOf?.runId === "string" ? { parentAttemptId: resubmissionOf.runId } : {}),
      caller: "learn-x:weekly-ai",
      status: "pending",
      phase: "submit",
      deliveryStatus: "pending",
      recoveryAction: resubmissionOf ? "one-shot-resubmit" : "none",
      ...(resubmissionOf ? { recoveryStatus: "pending" } : {}),
    }, options);
    dispatchedStartedAt = new Date().toISOString();
    let bridgePromise;
    try {
      bridgePromise = Promise.resolve(runner(prompt, { ...options, conversationUrl, preallocatedRunId: dispatchIntent.runId, dispatchStartedAt: dispatchedStartedAt, sourceId: "ai", callerLabel: options.callerLabel || "learn-x:weekly-ai" }))
        .catch((error) => ({ result: null, exit: { errorCode: safeChildErrorCode(error) } }));
    } catch (error) {
      bridgePromise = Promise.resolve({ result: null, exit: { errorCode: safeChildErrorCode(error) } });
    }
    dispatchIntent.dispatchStartedAt = dispatchedStartedAt;
    try {
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(dispatchIntent, null, 2)}\n`, "dispatch-started");
    } catch (error) {
      await appendWeeklyAiDiagnostic({
        type: "weekly-ai-persistence-diagnostic",
        week,
        runId: dispatchIntent.runId,
        taskRunId: dispatchIntent.runId,
        clientRequestId: dispatchIntent.runId,
        attemptId: dispatchIntent.runId,
        caller: "learn-x:weekly-ai",
        status: "failed",
        deliveryStatus: "unknown",
        reason: "diagnostic-write-failed",
        errorCode: "diagnostic-write-failed",
        systemErrorCode: safeSystemErrorCodes.has(String(error?.code || "").toUpperCase()) ? String(error.code).toUpperCase() : "unknown",
        failureStage: "persistence",
        phase: "persistence",
      }, options);
    }
    await appendWeeklyAiDiagnostic({
      type: "weekly-ai-dispatch",
      week,
      runId: dispatchIntent.runId,
      taskRunId: dispatchIntent.runId,
      clientRequestId: dispatchIntent.runId,
      attemptId: dispatchIntent.runId,
      ...(typeof resubmissionOf?.runId === "string" ? { parentAttemptId: resubmissionOf.runId } : {}),
      caller: "learn-x:weekly-ai",
      status: "submitted",
      phase: "submit",
      dispatchStartedAt: dispatchedStartedAt,
      deliveryStatus: "pending",
      recoveryAction: resubmissionOf ? "one-shot-resubmit" : "none",
      ...(resubmissionOf ? { recoveryStatus: "pending" } : {}),
    }, options);
    bridge = await bridgePromise;
    for (const diagnostic of bridge?.persistenceDiagnostics || []) {
      await appendWeeklyAiDiagnostic({
        type: "weekly-ai-persistence-diagnostic",
        week,
        runId: dispatchIntent.runId,
        taskRunId: dispatchIntent.runId,
        clientRequestId: dispatchIntent.runId,
        attemptId: dispatchIntent.runId,
        caller: "learn-x:weekly-ai",
        status: "failed",
        deliveryStatus: "unknown",
        ...diagnostic,
      }, options);
    }
  }

  const bridgeResult = bridge?.result;
  const base = { ...resultBase(week, prompt, startedAt),
    ...(bridgeResult?.contextPack ? { contextPack: bridgeResult.contextPack }
      : options.observeUncertain && previous?.contextPack ? { contextPack: previous.contextPack } : {}),
    ...(resubmissionOf ? {
    resubmissionOf, resubmissionCount: 1, resubmissionReservedAt: startedAt,
    automaticResubmit: options.automaticResubmit === true
  } : {}) };
  if (bridgeResult?.status === "succeeded") {
    const expectedRunId = options.observeUncertain ? previous?.runId : dispatchedRunId;
    const actualUrl = bridgeResult.actualConversationUrl || bridgeResult.conversationUrl;
    const identityVerified = typeof expectedRunId === "string" && bridgeResult.runId === expectedRunId
      && bridgeResult.submissionConfirmed === true
      && isBoundChatGptConversationUrl(actualUrl)
      && conversationOriginMatches(actualUrl, bridgeResult.conversationUrl);
    if (!identityVerified) {
      const failure = { ...base, status: "needs_review", runId: bridgeResult.runId || expectedRunId,
        reason: "bridge-observation-identity-mismatch", requestedConversationUrl: bridgeResult.requestedConversationUrl || conversationUrl,
        actualConversationUrl: actualUrl, conversationUrl: actualUrl, submissionConfirmed: bridgeResult.submissionConfirmed === true,
        completedAt: new Date().toISOString(), manualPrompt: prompt, manualPath: paths.formalPath };
      await ensureManualAiShellForUnrecoverableFailure(paths, week, failure.runId);
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(failure, null, 2)}\n`, "status");
      return { ...failure, targetWeek: week };
    }
  }
  if (bridgeResult?.status !== "succeeded") {
    const status = bridgeResult?.status === "failed" ? "failed" : "needs_review";
    const bridgeReason = typeof bridgeResult?.reason === "string"
      ? (safeWeeklyAiReasons.has(bridgeResult.reason) ? bridgeResult.reason : "unknown")
      : undefined;
    const failure = {
      ...base,
      status,
      dispatchState: "returned",
      ...(status === "needs_review" && !bridgeResult?.runId ? { submissionStateUncertain: true } : {}),
      runId: bridgeResult?.runId || (status === "needs_review" ? dispatchedRunId || previous?.runId : undefined),
      reason: bridgeReason || (bridge?.exit?.timedOut ? "bridge-timeout" : bridge?.exit?.errorCode ? "bridge-process-error" : "bridge-result-missing"),
      conversationUrl: bridgeResult?.conversationUrl || previous?.conversationUrl || conversationUrl,
      requestedConversationUrl: bridgeResult?.requestedConversationUrl || previous?.requestedConversationUrl || conversationUrl,
      actualConversationUrl: bridgeResult?.actualConversationUrl || bridgeResult?.conversationUrl || previous?.actualConversationUrl,
      ...(typeof bridgeResult?.submissionConfirmed === "boolean" ? { submissionConfirmed: bridgeResult.submissionConfirmed } : {}),
      ...(dispatchedRunId ? { localAttemptId: dispatchedRunId } : previous?.localAttemptId ? { localAttemptId: previous.localAttemptId } : {}),
      ...(dispatchedStartedAt || previous?.dispatchStartedAt ? { dispatchStartedAt: dispatchedStartedAt || previous.dispatchStartedAt } : {}),
      callerLabel: options.callerLabel || "learn-x:weekly-ai",
      ...(options.observeUncertain ? { observation: { status: "succeeded", runId: bridgeResult.runId, observedAt: new Date().toISOString(), outputSha256: bridgeResult.text ? sha256(bridgeResult.text) : undefined } } : {}),
      retryAfterSeconds: bridgeResult?.retryAfterSeconds,
      diagnostics: bridgeResult?.diagnostics,
      ...(bridge?.exit?.timedOut === true ? { remoteOutcomeUnknown: true } : {}),
      ...(typeof bridge?.exit?.localProcessExitConfirmed === "boolean" ? { localProcessExitConfirmed: bridge.exit.localProcessExitConfirmed } : {}),
      ...(typeof bridge?.exit?.errorCode === "string" && safeSystemErrorCodes.has(bridge.exit.errorCode) ? { systemErrorCode: bridge.exit.errorCode } : {}),
      completedAt: new Date().toISOString(),
      manualPrompt: prompt
    };
    await ensureManualAiShellForUnrecoverableFailure(paths, week, failure.runId);
    failure.manualPath = paths.formalPath;
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(failure, null, 2)}\n`, "status");
    return { ...failure, targetWeek: week };
  }

  const text = normalizeAiReviewText(bridgeResult.text);
  const validation = text ? validateAiReview(text) : { valid: false, reasons: ["empty-output"], sectionCount: 0 };
  if (!text || text.length > maxInputChars || !validation.valid) {
    const failure = {
      ...base,
      status: "needs_review",
      runId: bridgeResult.runId,
      reason: !text ? "empty-ai-review" : text.length > maxInputChars ? "ai-review-too-large" : "invalid-ai-review",
      outputSha256: text ? sha256(text) : undefined,
      validation: text.length > maxInputChars ? ["output-too-large", ...validation.reasons] : validation.reasons,
      conversationUrl: bridgeResult.conversationUrl,
      invalidOutputPath: text ? paths.invalidPath : undefined,
      completedAt: new Date().toISOString(),
      manualPrompt: prompt
    };
    await ensureManualAiShellForUnrecoverableFailure(paths, week, failure.runId);
    failure.manualPath = paths.formalPath;
    if (text) await writeAtomic(paths.invalidPath, `${text.slice(0, maxInputChars)}${text.length > maxInputChars ? "\n\n[输出已截断]" : ""}\n`, "invalid");
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(failure, null, 2)}\n`, "status");
    return { ...failure, targetWeek: week };
  }

  const generated = {
    ...base,
    status: "generated",
    runId: bridgeResult.runId,
    ...(dispatchedRunId ? { localAttemptId: dispatchedRunId } : previous?.localAttemptId ? { localAttemptId: previous.localAttemptId } : {}),
    ...(dispatchedStartedAt || previous?.dispatchStartedAt ? { dispatchStartedAt: dispatchedStartedAt || previous.dispatchStartedAt } : {}),
    outputSha256: sha256(text),
    conversationUrl: bridgeResult.conversationUrl,
    requestedConversationUrl: bridgeResult.requestedConversationUrl || conversationUrl,
    actualConversationUrl: bridgeResult.actualConversationUrl || bridgeResult.conversationUrl,
    submissionConfirmed: bridgeResult.submissionConfirmed === true,
    callerLabel: options.callerLabel || "learn-x:weekly-ai",
    ...(options.observeUncertain ? { observation: { status: "succeeded", runId: bridgeResult.runId, observedAt: new Date().toISOString(), verification: bridgeResult.verification, outputSha256: sha256(text) } } : {}),
    completedAt: bridgeResult.completedAt || new Date().toISOString(),
    generatedPath: paths.generatedPath
  };
  try {
    await writeAtomic(paths.generatedPath, `${text}\n`, "draft");
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(generated, null, 2)}\n`, "status");
  } catch (error) {
    try { await unlink(paths.generatedPath); } catch {}
    throw error;
  }
  return await promoteGeneratedSafely(repoRoot, week, prompt);
}

export async function generateAiReview(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  if (options.weeklyAiLockToken) {
    if (!await validateWeeklyAiLockToken(weekPaths(repoRoot, week).weekDir, options.weeklyAiLockToken)) {
      throw new Error("weekly-ai-lock-token-invalid");
    }
    const result = await generateAiReviewUnlocked(options);
    await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), options);
    return result;
  }
  const paths = weekPaths(repoRoot, week);
  const lock = await tryAcquireWeeklyAiLock(paths.weekDir);
  if (!lock) {
    const template = await readFile(paths.templatePath, "utf8");
    const result = { status: "needs_review", targetWeek: week, reason: "weekly-ai-run-in-progress",
      manualPrompt: buildReviewPrompt(template, week), manualPath: paths.formalPath, dispatchState: "not-started" };
    await appendWeeklyAiDiagnostic({
      type: "weekly-ai-local-gate", week, attemptId: randomUUID(), status: "needs_review",
      phase: "validation", failureStage: "local-gate", reason: "weekly-ai-run-in-progress",
      deliveryStatus: "needs_review", businessValidationStatus: "unknown", promotionStatus: "unknown", readbackStatus: "unknown",
    }, { ...options, repoRoot });
    return result;
  }
  try {
    const result = await generateAiReviewUnlocked({ ...options, repoRoot, week });
    await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), { ...options, repoRoot });
    return result;
  }
  finally { await lock.release(); }
}

function isEligibleUncertainResubmission(previous, week, promptSha256, nowMs = Date.now()) {
  const diagnostics = previous?.diagnostics;
  const runId = previous?.runId;
  const actualConversationUrl = previous?.actualConversationUrl || previous?.conversationUrl;
  const observationReason = previous?.observation?.reason || previous?.reason;
  const forbiddenReasons = new Set([
    "chatgpt-rate-limited", "login-required", "captcha-or-blocked", "ego-bootstrap-permission",
    "conversation-session-mismatch", "conversation-session-not-bound", "observer-identity-mismatch",
    "original-run-identity-mismatch", "submission-unconfirmed", "new-user-message-not-found",
  ]);
  const retryableObservationReasons = new Set([
    "snapshot-mismatch", "observer-window-ended", "observer-timeout", "new-assistant-message-not-found",
    "response-body-not-ready", "response-text-unstable", "generation-in-progress", "output-markers-missing",
    "observer-state-unavailable", "original-run-result-pending",
  ]);
  const startedAt = Date.parse(previous?.dispatchStartedAt || "");
  const sameBoundRun = typeof runId === "string" && runId === previous?.localAttemptId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)
    && previous?.submissionConfirmed === true
    && /^https:\/\/chatgpt\.com\/c\/[^/]+\/?$/.test(actualConversationUrl || "")
    && conversationOriginMatches(actualConversationUrl, previous?.conversationUrl);
  const safelyUnresolved = !forbiddenReasons.has(previous?.reason)
    && !forbiddenReasons.has(observationReason)
    && retryableObservationReasons.has(observationReason)
    && previous?.observation?.status === "needs_review"
    && previous?.observation?.runId === runId
    && diagnostics?.rateLimited !== true
    && previous?.observation?.diagnostics?.rateLimited !== true;
  const snapshotMismatch = previous?.reason === "snapshot-mismatch"
    && diagnostics?.conversationMatched === true
    && diagnostics?.promptSeen === true
    && diagnostics?.assistantPresent === true
    && diagnostics?.outputReady === true
    && diagnostics?.markersSeen === true
    && diagnostics?.stop !== true
    && diagnostics?.rateLimited !== true
    && Number(diagnostics?.stableReadCount) >= 2
    && diagnostics?.snapshot?.ok === false;
  return previous?.status === "needs_review"
    && previous?.targetWeek === week
    && previous?.promptSha256 === promptSha256
    && !previous?.resubmissionOf
    && (previous?.resubmissionCount === undefined || previous.resubmissionCount === 0)
    && sameBoundRun
    && safelyUnresolved
    && Number.isFinite(startedAt)
    && nowMs - startedAt >= uncertainAiResubmitAfterMs
    && (snapshotMismatch || retryableObservationReasons.has(observationReason));
}

export async function canResubmitUncertainAi({ repoRoot = defaultRepoRoot, week: weekInput, nowMs = Date.now() } = {}) {
  const week = normalizeWeek(weekInput);
  const paths = weekPaths(repoRoot, week);
  const [previous, hasGenerated, hasInvalid, formalExists] = await Promise.all([
    readJson(paths.sidecarPath), exists(paths.generatedPath), exists(paths.invalidPath), exists(paths.formalPath)
  ]);
  if (hasGenerated || hasInvalid) return false;
  if (formalExists && isSubstantiveExisting(await readFile(paths.formalPath, "utf8"))) return false;
  const template = await readFile(paths.templatePath, "utf8");
  return isEligibleUncertainResubmission(previous, week, sha256(buildReviewPrompt(template, week)), nowMs);
}

async function persistConfirmedPromotion(paths, confirmed, { week = confirmed.targetWeek, manualPrompt } = {}) {
  try {
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(confirmed, null, 2)}\n`, "confirmed");
    const readback = JSON.parse(await readFile(paths.sidecarPath, "utf8"));
    if (readback.status !== "confirmed" || readback.outputSha256 !== confirmed.readbackSha256) throw new Error("promotion-status-readback-failed");
    const finalReadbackSha = sha256(normalizeAiReviewText(await readFile(paths.formalPath, "utf8")));
    if (finalReadbackSha !== confirmed.readbackSha256) throw new Error("promotion-readback-hash-mismatch");
    return readback;
  } catch (error) {
    if (error?.message !== "promotion-readback-hash-mismatch") throw error;
    const previous = await readJson(paths.sidecarPath) || confirmed;
    const { confirmedAt, readbackSha256, promotionRecovered, auditPath, ...unconfirmed } = previous;
    const conflict = { ...unconfirmed, status: "needs_review", targetWeek: week,
      reason: "formal-ai-md-changed-during-promotion", promotionStatus: "formal-file-changed-during-readback",
      ...(previous.manualPrompt || manualPrompt ? { manualPrompt: previous.manualPrompt || manualPrompt } : {}),
      manualPath: paths.formalPath };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(conflict, null, 2)}\n`, "status");
    return conflict;
  }
}

async function promoteAiReviewUnlocked(options = {}) {
  if (!options.confirm) throw new Error("promotion-requires-confirm");
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  const paths = weekPaths(repoRoot, week);
  const generated = await readFile(paths.generatedPath, "utf8");
  const sidecar = await readJson(paths.sidecarPath);
  const text = normalizeAiReviewText(generated);
  if (sidecar?.status !== "generated" || sidecar.outputSha256 !== sha256(text) || !validateAiReview(text).valid) {
    throw new Error("generated-review-integrity-check-failed");
  }

  await mkdir(paths.archiveDir, { recursive: true });
  const auditPath = path.join(paths.archiveDir, `ai.generated.${Date.now()}.md`);
  try {
    if (await exists(paths.formalPath)) {
      const current = await readFile(paths.formalPath, "utf8");
      const currentText = normalizeAiReviewText(current);
      if (sha256(currentText) === sidecar.outputSha256 && validateAiReview(currentText).valid) {
        const reconciled = { ...sidecar, status: "confirmed", confirmedAt: sidecar.confirmedAt || new Date().toISOString(),
          formalPath: paths.formalPath, promotionRecovered: true, completionSource: "ai-generated", readbackSha256: sha256(currentText) };
        const readback = await persistConfirmedPromotion(paths, reconciled, { week, manualPrompt: options.manualPrompt });
        if (readback.status === "confirmed" && await exists(paths.generatedPath)) await unlink(paths.generatedPath);
        return { ...readback, targetWeek: week };
      }
      if (isSubstantiveExisting(current)) throw new Error("promotion-refuses-substantive-ai-md");
      throw new Error("promotion-refuses-existing-ai-md");
    }

    await writeAtomic(auditPath, `${text}\n`, "audit");
    try {
      if (!await writeExclusive(paths.formalPath, `${text}\n`, "promotion")) {
        throw new Error("promotion-refuses-existing-ai-md");
      }
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("promotion-refuses-existing-ai-md");
      throw error;
    }
    const confirmed = {
      ...sidecar,
      status: "confirmed",
      completionSource: "ai-generated",
      confirmedAt: new Date().toISOString(),
      formalPath: paths.formalPath,
      auditPath,
      readbackSha256: sha256(normalizeAiReviewText(await readFile(paths.formalPath, "utf8")))
    };
    if (confirmed.readbackSha256 !== sidecar.outputSha256) throw new Error("promotion-readback-hash-mismatch");
    const readback = await persistConfirmedPromotion(paths, confirmed, { week, manualPrompt: options.manualPrompt });
    if (readback.status === "confirmed") {
      try { await unlink(paths.generatedPath); } catch {}
    }
    return { ...readback, targetWeek: week };
  } catch (error) {
    try { await unlink(auditPath); } catch {}
    if (error?.message === "promotion-readback-hash-mismatch") {
      const previous = await readJson(paths.sidecarPath) || sidecar;
      const { confirmedAt, readbackSha256, promotionRecovered, ...unconfirmed } = previous;
      const conflict = { ...unconfirmed, status: "needs_review", targetWeek: week,
        reason: "formal-ai-md-changed-during-promotion", promotionStatus: "formal-file-changed-during-readback",
        ...(previous.manualPrompt || options.manualPrompt ? { manualPrompt: previous.manualPrompt || options.manualPrompt } : {}),
        manualPath: paths.formalPath };
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(conflict, null, 2)}\n`, "status");
      return { ...conflict, targetWeek: week };
    }
    throw error;
  }
}

export async function promoteAiReview(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  if (options.weeklyAiLockToken) {
    if (!await validateWeeklyAiLockToken(weekPaths(repoRoot, week).weekDir, options.weeklyAiLockToken)) {
      throw new Error("weekly-ai-lock-token-invalid");
    }
    const result = await promoteAiReviewUnlocked(options);
    await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), { ...options, repoRoot });
    return result;
  }
  const lock = await tryAcquireWeeklyAiLock(weekPaths(repoRoot, week).weekDir);
  if (!lock) throw new Error("weekly-ai-run-in-progress");
  try {
    const result = await promoteAiReviewUnlocked({ ...options, repoRoot, week });
    await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), { ...options, repoRoot });
    return result;
  }
  finally { await lock.release(); }
}

async function confirmManualAiReviewUnlocked(options = {}) {
  if (!options.confirm) throw new Error("manual-confirmation-requires-explicit-confirmation");
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  const paths = weekPaths(repoRoot, week);
  const raw = await readFile(paths.formalPath, "utf8");
  const text = normalizeAiReviewText(raw);
  const validation = text ? validateAiReview(text) : { valid: false, reasons: ["empty-output"] };
  if (!text || text.length > maxInputChars || !validation.valid || !isSubstantiveExisting(text)) {
    throw new Error(`manual-ai-review-invalid: ${validation.reasons.join(",") || (text.length > maxInputChars ? "output-too-large" : "empty-or-template")}`);
  }

  const previous = await readJson(paths.sidecarPath);
  const rawSha256 = sha256(raw);
  if (previous?.status === "confirmed" && previous.targetWeek === week && previous.completionSource === "user-manual") {
    if (previous.manualConfirmation?.sha256 !== rawSha256) throw new Error("manual-ai-review-changed-after-confirmation");
    return { ...previous, alreadyConfirmed: true };
  }
  if (previous?.targetWeek !== week || !["failed", "needs_review"].includes(previous.status)
    || previous.manualPath !== paths.formalPath || typeof previous.manualPrompt !== "string" || !previous.manualPrompt.trim()) {
    throw new Error("manual-ai-review-state-not-eligible");
  }

  const confirmedAt = new Date().toISOString();
  const confirmed = {
    ...previous,
    status: "confirmed",
    completionSource: "user-manual",
    manualConfirmation: { sha256: rawSha256, confirmedAt },
    confirmedAt,
    formalPath: paths.formalPath
  };
  await writeAtomic(paths.sidecarPath, `${JSON.stringify(confirmed, null, 2)}\n`, "manual-confirmed");
  return { ...confirmed, targetWeek: week };
}

export async function confirmManualAiReview(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  if (options.weeklyAiLockToken) {
    if (!await validateWeeklyAiLockToken(weekPaths(repoRoot, week).weekDir, options.weeklyAiLockToken)) {
      throw new Error("weekly-ai-lock-token-invalid");
    }
    const result = await confirmManualAiReviewUnlocked(options);
    if (!result.alreadyConfirmed) await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), { ...options, repoRoot });
    return result;
  }
  const lock = await tryAcquireWeeklyAiLock(weekPaths(repoRoot, week).weekDir);
  if (!lock) throw new Error("weekly-ai-run-in-progress");
  try {
    const result = await confirmManualAiReviewUnlocked({ ...options, repoRoot, week });
    if (!result.alreadyConfirmed) await appendWeeklyAiDiagnostic(weeklyAiOutcomeEvent(result), { ...options, repoRoot });
    return result;
  }
  finally { await lock.release(); }
}

export function parseGenerateAiReviewArgs(argv) {
  const options = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--diagnostic-status") options.diagnosticStatus = true;
    else if (argv[index] === "--promote") options.promote = true;
    else if (argv[index] === "--confirm-manual") options.confirmManual = true;
    else if (argv[index] === "--confirm") options.confirm = true;
    else if (argv[index] === "--retry") options.retry = true;
    else if (argv[index] === "--resubmit-uncertain") options.resubmitUncertain = true;
    else if (argv[index] === "--observe-uncertain") options.observeUncertain = true;
    else if (argv[index] === "--observe-seconds") options.observeWaitSeconds = Number(argv[++index]);
    else if (argv[index] === "--automatic-resubmit") options.automaticResubmit = true;
    else if (argv[index] === "--weekly-ai-lock-token") options.weeklyAiLockToken = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseGenerateAiReviewArgs(process.argv.slice(2));
  const result = options.diagnosticStatus
    ? await readWeeklyAiDiagnosticStatus(options)
    : options.confirmManual
    ? await confirmManualAiReview(options)
    : options.promote
      ? await promoteAiReview(options)
      : await generateAiReview(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["succeeded", "generated", "confirmed"].includes(result.status) ? 0 : 2;
}

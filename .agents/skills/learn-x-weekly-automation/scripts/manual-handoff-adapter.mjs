import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const sharedCorePath = path.resolve(defaultRepoRoot, "../browser-runtime-governance/skills/chatgpt-web-bridge/scripts/manual-handoff.mjs");
const CALLERS = new Set([
  "learn-x:weekly-ai", "learn-x:periodic-insight",
  "learn-x:voice-insight", "learn-x:monthly-understanding", "learn-x:monthly-question-proposal",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

let corePromise;
async function core() {
  corePromise ||= import(pathToFileURL(sharedCorePath).href);
  return corePromise;
}

function requiredId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_.\/-]{1,160}$/.test(value)) throw new Error(`learn-x-handoff-${field}-invalid`);
  return value;
}

function normalizeHistoryDependency(value) {
  if (!value || typeof value !== "object" || typeof value.required !== "boolean") throw new Error("learn-x-handoff-history-dependency-required");
  const items = Array.isArray(value.items) ? value.items : [];
  if (value.required && (value.completenessVerified !== true || items.length === 0)) return {
    status: "needs_review", reason: "history-materials-unverified",
    missing: Array.isArray(value.missing) && value.missing.length ? value.missing : ["历史会话或账号 Memory 的资料完整性证明"],
  };
  if (!value.required && value.completenessVerified !== true) throw new Error("learn-x-handoff-history-dependency-unverified");
  return { status: "verified", value: {
    required: value.required,
    completenessVerified: value.required ? true : value.completenessVerified,
    items: value.required ? items : [],
    ...(typeof value.sessionUrl === "string" ? { sessionUrl: value.sessionUrl } : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
  } };
}

export function handoffRoot(repoRoot = defaultRepoRoot) {
  return path.join(path.resolve(repoRoot), ".runtime", "manual-handoffs");
}

/** Freeze an exact business prompt and its verified source binding for a manual ChatGPT step. */
export async function prepareLearnXHandoff(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const callerLabel = options.callerLabel;
  if (!CALLERS.has(callerLabel)) throw new Error("learn-x-handoff-caller-not-allowed");
  const taskId = requiredId(options.taskId, "task-id");
  const stage = requiredId(options.stage, "stage");
  const artifactId = requiredId(options.artifactId, "artifact-id");
  const inputVersion = requiredId(options.inputVersion, "input-version");
  const originEventId = requiredId(options.originEventId, "origin-event-id");
  const promptBytes = Buffer.isBuffer(options.promptBytes) ? Buffer.from(options.promptBytes)
    : typeof options.prompt === "string" ? Buffer.from(options.prompt, "utf8") : null;
  if (!promptBytes?.length) throw new Error("learn-x-handoff-prompt-missing");
  if (promptBytes.length > 30 * 1024 * 1024) throw new Error("learn-x-handoff-prompt-too-large");
  if (!options.fullFlow?.length || options.continuationChoice !== "continue-complete-workflow"
    && options.continuationChoice !== "current-stage-only") {
    throw new Error("learn-x-handoff-continuation-choice-required");
  }
  const history = normalizeHistoryDependency(options.historyDependency);
  if (history.status !== "verified") return { status: "needs_review", reason: history.reason, missing: history.missing };
  const expectedOutputFormat = options.expectedOutputFormat;
  if (typeof expectedOutputFormat !== "string" || !expectedOutputFormat.trim()) throw new Error("learn-x-handoff-output-format-required");
  const promptSha256 = hash(promptBytes);
  const promptIdentity = {
    schema: "learn-x-effective-prompt/v1",
    promptId: options.promptId || `learn-x:${callerLabel}`,
    revision: options.promptRevision || promptSha256,
    sha256: promptSha256,
    ...(Array.isArray(options.promptAssets) ? { formalAssets: options.promptAssets } : {}),
  };
  const sourceRequirements = {
    ...(options.sourceRequirements || {}),
    historyDependency: history.value,
    expectedOutput: { format: expectedOutputFormat, returnTo: "此原始 Learn-X Codex 任务" },
    fullFlow: options.fullFlow,
    continuationChoice: options.continuationChoice,
    materialStatus: "verified",
    missing: [],
  };
  const handoffCore = await core();
  await handoffCore.pruneHandoffs({ root: handoffRoot(repoRoot) });
  const prepared = await handoffCore.prepareHandoff({
    root: handoffRoot(repoRoot), callerLabel, taskId, stage, artifactId,
    inputVersion, originEventId, promptBytes, promptIdentity,
    attachments: options.attachments || [], sourceRequirements,
  });
  if (prepared.status !== "prepared") return prepared;
  return {
    ...prepared,
    promptSha256,
    historyDependency: history.value,
    expectedOutputFormat,
    fullFlow: options.fullFlow,
    continuationChoice: options.continuationChoice,
    manualInstructions: {
      submitTo: options.submitTo || "ChatGPT 新聊天；如交接记录要求指定历史会话，使用该会话",
      returnTo: "当前原始 Codex 任务，粘贴完整结果或提供原始文件",
      resultFormat: expectedOutputFormat,
      expiresAt: prepared.record.expiresAt,
      handoffId: prepared.handoffId,
    },
  };
}

/** Import only into the shared candidate store; this never validates or completes a business task. */
export async function importLearnXCandidate({ repoRoot, handoffId, eventId, sourceClaim, resultBytes, files = [] } = {}) {
  const root = handoffRoot(repoRoot || defaultRepoRoot);
  const handoffCore = await core();
  await handoffCore.pruneHandoffs({ root });
  const opened = await handoffCore.readHandoff({ root, handoffId });
  const record = opened.record;
  if (!CALLERS.has(record.callerLabel) || !record.taskId || !record.inputVersion) throw new Error("learn-x-handoff-record-untrusted");
  return await handoffCore.importHandoffResult({
    root, handoffId, callerLabel: record.callerLabel, taskId: record.taskId,
    stage: record.stage, artifactId: record.artifactId, inputVersion: record.inputVersion,
    originEventId: record.originEventId, eventId, intakeChannel: "codex",
    operatorBasis: { kind: "codex-user-message", referenceSha256: hash(Buffer.from(eventId, "utf8")) },
    sourceClaim, resultBytes, files,
  });
}

export async function readLearnXCandidate({ repoRoot, handoffId, candidateId } = {}) {
  const handoffCore = await core();
  const root = handoffRoot(repoRoot || defaultRepoRoot);
  await handoffCore.pruneHandoffs({ root });
  const result = await handoffCore.readHandoffResult({ root, handoffId, candidateId });
  if (!CALLERS.has(result.candidate?.callerLabel) || result.candidate?.evidenceLevel !== "user-asserted"
    || !["received", "duplicate"].includes(result.candidate?.status)) throw new Error("learn-x-handoff-candidate-not-acceptable");
  return result;
}

export async function listLearnXCandidates({ repoRoot, handoffId } = {}) {
  const handoffCore = await core();
  const root = handoffRoot(repoRoot || defaultRepoRoot);
  await handoffCore.pruneHandoffs({ root });
  const result = await handoffCore.readHandoffStatus({ root, handoffId });
  if (!CALLERS.has(result.record?.callerLabel)) throw new Error("learn-x-handoff-record-untrusted");
  return result;
}

export const LEARN_X_MANUAL_CALLERS = Object.freeze([...CALLERS]);

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { readFile, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAiReview } from "../../learn-x-process/scripts/monthly-process-input.mjs";
import { isoWeekRange } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const defaultBridgePath = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const maxInputChars = 15_000;
const defaultBridgeConversationUrl = "https://chatgpt.com/";
// Bridge 默认预算为 120 秒观察 + 90 秒传输/清理余量；适配器必须覆盖完整协议预算。
export const DEFAULT_BRIDGE_TIMEOUT_MS = 240_000;
// Bridge image 模式（生图）观察预算为 600 秒（对齐 Voice-X / Read-X），适配器覆盖完整预算。
export const IMAGE_BRIDGE_TIMEOUT_MS = 750_000;

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

function conversationOriginMatches(requestedUrl, observedUrl) {
  try {
    const requested = new URL(requestedUrl);
    const observed = new URL(observedUrl);
    return requested.protocol === "https:" && observed.protocol === "https:" && requested.origin === observed.origin;
  } catch {
    return false;
  }
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

export async function runBridgeCli(prompt, options = {}) {
  const bridgePath = options.bridgePath || process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath;
  const image = Boolean(options.image);
  const timeoutMs = options.timeoutMs || (image ? IMAGE_BRIDGE_TIMEOUT_MS : DEFAULT_BRIDGE_TIMEOUT_MS);
  const args = [bridgePath];
  if (image) args.push("--image");
  if (options.preallocatedRunId) args.push("--run-id", options.preallocatedRunId);
  if (options.conversationUrl) args.push("--conversation-url", options.conversationUrl);
  if (options.callerLabel || options.sourceId === "ai") args.push("--caller-label", options.callerLabel || "learn-x:weekly-ai");
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(prompt);

  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, timedOut: true });
    }, timeoutMs);
    child.once("error", (error) => resolve({ code: null, timedOut: false, error: String(error?.message || error) }));
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false });
    });
  });

  const result = [...parseJsonLines(`${stdout}\n${stderr}`)].reverse().find((value) => typeof value.status === "string");
  return { result, exit };
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
  if (await exists(paths.formalPath)) return false;
  await writeAtomic(paths.formalPath, manualAiShell(week), "manual");
  return true;
}

async function writeAtomic(filePath, content, suffix = "tmp") {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${suffix}`);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
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

function resultBase(week, prompt, startedAt) {
  return {
    schemaVersion: 1,
    targetWeek: week,
    promptSha256: sha256(prompt),
    startedAt,
    source: "chatgpt-web-bridge"
  };
}

export async function generateAiReview(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  const paths = weekPaths(repoRoot, week);
  const startedAt = new Date().toISOString();
  await mkdir(paths.weekDir, { recursive: true });

  let previous = await readJson(paths.sidecarPath);
  if (previous?.status === "confirmed" && await exists(paths.formalPath)) {
    return { status: "confirmed", targetWeek: week, formalPath: paths.formalPath };
  }
  if (await exists(paths.generatedPath)) {
    return await promoteAiReview({ repoRoot, week, confirm: true });
  }
  const template = await readFile(paths.templatePath, "utf8");
  const prompt = buildReviewPrompt(template, week);
  let resubmissionOf = null;
  let bridge;
  let dispatchedRunId;
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
      return await promoteAiReview({ repoRoot, week, confirm: true });
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
      await ensureManualAiShell(paths, week);
      return { ...updated, targetWeek: week, manualPath: paths.formalPath };
    }
    const observe = options.observeBridge || observeBridgeCli;
    try { bridge = await observe(previous, options); }
    catch (error) { bridge = { result: { status: "needs_review", runId: previous.runId, reason: "bridge-observe-unavailable", diagnostics: { errorCode: error?.code || "observer-error" } } }; }
    const observed = bridge?.result;
    const observationMatches = observed?.status === "succeeded"
      && observed.runId === previous.runId
      && conversationOriginMatches(previous.conversationUrl, observed.conversationUrl)
      && typeof observed.text === "string" && observed.text.trim().length > 0;
    if (!observationMatches) {
      const observation = {
        status: observed?.status === "succeeded" ? "needs_review" : observed?.status || "needs_review",
        reason: observed?.status === "succeeded" && !observationMatches
          ? "bridge-observation-identity-mismatch"
          : observed?.reason || "bridge-observe-result-missing",
        runId: observed?.runId || previous.runId,
        diagnostics: observed?.diagnostics,
        observedAt: new Date().toISOString()
      };
      const updated = { ...previous, observation };
      await writeAtomic(paths.sidecarPath, `${JSON.stringify(updated, null, 2)}\n`, "status");
      await ensureManualAiShell(paths, week);
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
      promptSha256: previous.promptSha256,
      authorizedBy: "user-explicit-resubmission",
      startedAt
    };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify({
      ...resultBase(week, prompt, startedAt),
      status: "needs_review",
      runId: previous.runId,
      reason: "uncertain-resubmission-in-progress",
      conversationUrl: previous.conversationUrl,
      diagnostics: previous.diagnostics,
      resubmissionOf,
      manualPrompt: prompt,
      manualPath: paths.formalPath
    }, null, 2)}\n`, "status");
  }
  if (previous?.status === "needs_review" && !resubmissionOf && !(options.retry && safeRetryReasons.has(previous.reason)) && !bridge) {
    await ensureManualAiShell(paths, week);
    return { status: "needs_review", targetWeek: week, reason: "previous-run-needs-review", manualPrompt: previous.manualPrompt || prompt, manualPath: paths.formalPath };
  }

  if (!bridge) {
    const runner = options.runBridge || runBridgeCli;
    const dispatchIntent = {
      ...resultBase(week, prompt, startedAt),
      status: "dispatching",
      dispatchState: "started",
      conversationUrl,
      localAttemptId: randomUUID(),
      ...(resubmissionOf ? { reason: "uncertain-resubmission-in-progress" } : {}),
      callerLabel: options.callerLabel || "learn-x:weekly-ai",
      ...(resubmissionOf ? { resubmissionOf } : {})
    };
    dispatchIntent.runId = dispatchIntent.localAttemptId;
    dispatchedRunId = dispatchIntent.runId;
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(dispatchIntent, null, 2)}\n`, "dispatch");
    try {
      bridge = await runner(prompt, { ...options, conversationUrl, preallocatedRunId: dispatchIntent.runId, sourceId: "ai", callerLabel: options.callerLabel || "learn-x:weekly-ai" });
    } catch (error) {
      bridge = { result: null, exit: { error: String(error?.message || error) } };
    }
  }

  const bridgeResult = bridge?.result;
  const base = { ...resultBase(week, prompt, startedAt), ...(resubmissionOf ? { resubmissionOf } : {}) };
  if (bridgeResult?.status !== "succeeded") {
    const status = bridgeResult?.status === "failed" ? "failed" : "needs_review";
    const failure = {
      ...base,
      status,
      dispatchState: "returned",
      ...(status === "needs_review" && !bridgeResult?.runId ? { submissionStateUncertain: true } : {}),
      runId: bridgeResult?.runId || (status === "needs_review" ? dispatchedRunId || previous?.runId : undefined),
      reason: bridgeResult?.reason || bridge?.exit?.error || (bridge?.exit?.timedOut ? "bridge-timeout" : "bridge-result-missing"),
      conversationUrl: bridgeResult?.conversationUrl || previous?.conversationUrl || conversationUrl,
      callerLabel: options.callerLabel || "learn-x:weekly-ai",
      ...(options.observeUncertain ? { observation: { status: "succeeded", runId: bridgeResult.runId, observedAt: new Date().toISOString(), outputSha256: bridgeResult.text ? sha256(bridgeResult.text) : undefined } } : {}),
      retryAfterSeconds: bridgeResult?.retryAfterSeconds,
      diagnostics: bridgeResult?.diagnostics,
      completedAt: new Date().toISOString(),
      manualPrompt: prompt
    };
    await ensureManualAiShell(paths, week);
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
    await ensureManualAiShell(paths, week);
    failure.manualPath = paths.formalPath;
    if (text) await writeAtomic(paths.invalidPath, `${text.slice(0, maxInputChars)}${text.length > maxInputChars ? "\n\n[输出已截断]" : ""}\n`, "invalid");
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(failure, null, 2)}\n`, "status");
    return { ...failure, targetWeek: week };
  }

  const generated = {
    ...base,
    status: "generated",
    runId: bridgeResult.runId,
    outputSha256: sha256(text),
    conversationUrl: bridgeResult.conversationUrl,
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
  return await promoteAiReview({ repoRoot, week, confirm: true });
}

function isEligibleUncertainResubmission(previous, week, promptSha256) {
  const diagnostics = previous?.diagnostics;
  return previous?.status === "needs_review"
    && previous.reason === "snapshot-mismatch"
    && previous.targetWeek === week
    && previous.promptSha256 === promptSha256
    && !previous.resubmissionOf
    && diagnostics?.conversationMatched === true
    && diagnostics?.promptSeen === true
    && diagnostics?.assistantPresent === true
    && diagnostics?.outputReady === true
    && diagnostics?.markersSeen === true
    && diagnostics?.stop !== true
    && diagnostics?.rateLimited !== true
    && Number(diagnostics?.stableReadCount) >= 2
    && diagnostics?.snapshot?.ok === false;
}

export async function canResubmitUncertainAi({ repoRoot = defaultRepoRoot, week: weekInput } = {}) {
  const week = normalizeWeek(weekInput);
  const paths = weekPaths(repoRoot, week);
  const [previous, hasGenerated, hasInvalid, formalExists] = await Promise.all([
    readJson(paths.sidecarPath), exists(paths.generatedPath), exists(paths.invalidPath), exists(paths.formalPath)
  ]);
  if (hasGenerated || hasInvalid) return false;
  if (formalExists && isSubstantiveExisting(await readFile(paths.formalPath, "utf8"))) return false;
  const template = await readFile(paths.templatePath, "utf8");
  return isEligibleUncertainResubmission(previous, week, sha256(buildReviewPrompt(template, week)));
}

export async function promoteAiReview(options = {}) {
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
  let backupPath;
  let rollbackPath;
  const auditPath = path.join(paths.archiveDir, `ai.generated.${Date.now()}.md`);
  if (await exists(paths.formalPath)) {
    const current = await readFile(paths.formalPath, "utf8");
    rollbackPath = path.join(paths.archiveDir, `.ai.rollback.${process.pid}.${Date.now()}.md`);
    await rename(paths.formalPath, rollbackPath);
    if (isSubstantiveExisting(current)) {
      backupPath = path.join(paths.archiveDir, `ai.previous.${Date.now()}.md`);
      await rename(rollbackPath, backupPath);
      rollbackPath = null;
    }
  }

  try {
    await writeAtomic(auditPath, `${text}\n`, "audit");
    await rename(paths.generatedPath, paths.formalPath);
    const confirmed = {
      ...sidecar,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      formalPath: paths.formalPath,
      backupPath,
      auditPath
    };
    await writeAtomic(paths.sidecarPath, `${JSON.stringify(confirmed, null, 2)}\n`, "confirmed");
    if (rollbackPath) {
      try { await unlink(rollbackPath); } catch {}
    }
    return { ...confirmed, targetWeek: week };
  } catch (error) {
    try { await rename(paths.formalPath, paths.generatedPath); } catch {}
    if (rollbackPath) {
      try { await rename(rollbackPath, paths.formalPath); } catch {}
    } else if (backupPath) {
      try { await rename(backupPath, paths.formalPath); } catch {}
    }
    try { await unlink(auditPath); } catch {}
    throw error;
  }
}

export async function confirmManualAiReview(options = {}) {
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

function parseArgs(argv) {
  const options = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--promote") options.promote = true;
    else if (argv[index] === "--confirm-manual") options.confirmManual = true;
    else if (argv[index] === "--confirm") options.confirm = true;
    else if (argv[index] === "--retry") options.retry = true;
    else if (argv[index] === "--resubmit-uncertain") options.resubmitUncertain = true;
    else if (argv[index] === "--observe-uncertain") options.observeUncertain = true;
    else if (argv[index] === "--observe-seconds") options.observeWaitSeconds = Number(argv[++index]);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.confirmManual
    ? await confirmManualAiReview(options)
    : options.promote
      ? await promoteAiReview(options)
      : await generateAiReview(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["succeeded", "generated", "confirmed"].includes(result.status) ? 0 : 2;
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBridgeCli } from "../../learn-x-weekly-automation/scripts/generate-ai-review.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const maxChars = { self: 2250, memory: 4500 };
export const DEFAULT_BRIDGE_GAP_MS = 300_000;
const defaultBridgeTimeoutMs = 240_000;
const safeRetryReasons = new Set([
  "ego-bootstrap-permission",
  "ego-browser-unavailable",
  "local-rate-limit-cooldown",
  "login-required",
  "captcha-or-blocked",
  "composer-missing",
  "chat-mode-switch-failed",
  "bridge-busy",
  "assistant-selector-missing",
  "chatgpt-rate-limited",
  "invalid-output",
  "previous-run-uncertain"
]);

export function normalizeMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!match) throw new Error(`Invalid month format: ${value}. Use YYYY-MM.`);
  return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
}

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
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

async function writeJsonAtomic(filePath, value) {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
}

export function buildPrompt(template, type) {
  return [
    "请只依据当前普通 ChatGPT 账号真实可用的 Memory、记忆和长期互动印象完成下面的任务；不要读取或猜测本地文件。请输出一份完整、稳定、可迁移的全量理解，不写版本变化或更新说明。",
    template.trim(),
    "只输出完整 Markdown，不解释过程。"
  ].join("\n\n");
}

export function extractOutput(text, marker) {
  const normalized = String(text || "").trim();
  const match = normalized.match(new RegExp(`<${marker}>\\s*([\\s\\S]*?)\\s*<\\/${marker}>`, "i"));
  return (match?.[1] || normalized).trim();
}

function redactSensitive(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[已脱敏邮箱]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[已脱敏手机号]")
    .replace(/(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, "[已脱敏证件号]")
    .replace(/((?:银行卡|卡号|bank\s*card|card\s*number)\s*[:：]?\s*)\d{13,19}/gi, "$1[已脱敏卡号]")
    .replace(/((?:家庭住址|住址|家庭地址|收货地址|详细地址|地址|home\s*address|address)\s*[:：]\s*)[^\n]+/gi, "$1[已脱敏地址]")
    .replace(/((?:账号|账户|用户名|user\s*name|account)\s*[:：]\s*)[^\n]+/gi, "$1[已脱敏账号]");
}

function hasSensitivePattern(text) {
  return [
    /(?:手机号|手机|电话|联系方式|phone|mobile)\s*[:：]?\s*1[3-9]\d{9}/i,
    /(?:身份证|公民身份号码|id\s*card)\D{0,20}[1-9]\d{5}(?:18|19|20)\d{2}/i,
    /(?:银行卡|卡号|bank\s*card|card\s*number)\D{0,20}\d{13,19}/i,
    /(?:家庭住址|住址|家庭地址|收货地址|详细地址|home\s*address)\s*[:：]\s*\S.{8,}/i,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/
  ].some((pattern) => pattern.test(text));
}

export function validateOutputs(outputs) {
  const reasons = [];
  if (!outputs.self) reasons.push("empty-self-reading");
  if (!outputs.memory) reasons.push("empty-ai-memory");
  if (outputs.self.length > maxChars.self) reasons.push("self-reading-too-large");
  if (outputs.memory.length > maxChars.memory) reasons.push("ai-memory-too-large");
  if (hasSensitivePattern(outputs.self)) reasons.push("sensitive-self-reading");
  if (hasSensitivePattern(outputs.memory)) reasons.push("sensitive-ai-memory");
  return { valid: reasons.length === 0, reasons };
}

export function diffLines(oldText, newText) {
  const oldLines = String(oldText || "").replace(/\r\n/g, "\n").split("\n");
  const newLines = String(newText || "").replace(/\r\n/g, "\n").split("\n");
  if (oldLines.at(-1) === "") oldLines.pop();
  if (newLines.at(-1) === "") newLines.pop();
  const rows = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      rows[i][j] = oldLines[i] === newLines[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const operations = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      operations.push(` ${oldLines[i]}`); i += 1; j += 1;
    } else if (j < newLines.length && (i === oldLines.length || rows[i][j + 1] >= rows[i + 1][j])) {
      operations.push(`+${newLines[j]}`); j += 1;
    } else {
      operations.push(`-${oldLines[i]}`); i += 1;
    }
  }
  if (!operations.length) return "（无变化）";
  return [`--- previous`, `+++ current`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...operations].join("\n");
}

async function replacePair(repoRoot, selfText, memoryText) {
  const targets = [
    { path: path.join(repoRoot, "01_core/ChatGPT-自我阅读版.md"), text: `${selfText}\n` },
    { path: path.join(repoRoot, "01_core/memory/ChatGPT-AI记忆版.md"), text: `${memoryText}\n` }
  ];
  const backups = [];
  const temps = [];
  try {
    for (const target of targets) {
      await mkdir(path.dirname(target.path), { recursive: true });
      const tempPath = `${target.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, target.text, "utf8");
      temps.push({ target, tempPath });
    }
    for (const { target } of temps) {
      if (await exists(target.path)) {
        const backupPath = `${target.path}.${process.pid}.${Date.now()}.rollback`;
        await rename(target.path, backupPath);
        backups.push({ target, backupPath });
      }
    }
    for (const { target, tempPath } of temps) await rename(tempPath, target.path);
    for (const { backupPath } of backups) await unlink(backupPath);
  } catch (error) {
    for (const { target, tempPath } of temps) { try { await unlink(tempPath); } catch {} }
    for (const { target } of temps) { try { await unlink(target.path); } catch {} }
    for (const { target, backupPath } of backups) { try { await rename(backupPath, target.path); } catch {} }
    throw error;
  }
}

function sidecarPath(repoRoot, month) {
  return path.join(repoRoot, "04_output/_dist/monthly", month, "chatgpt-understanding.json");
}

function bridgeExitSummary(bridge) {
  const exit = bridge?.exit || {};
  return {
    code: Number.isInteger(exit.code) ? exit.code : null,
    signal: exit.signal || null,
    timedOut: Boolean(exit.timedOut),
    error: exit.error ? String(exit.error).slice(0, 240) : null
  };
}

function bridgeFailureReason(bridge) {
  const result = bridge?.result;
  if (result?.reason) return result.reason;
  if (bridge?.exit?.error) return String(bridge.exit.error);
  if (bridge?.exit?.timedOut) return "bridge-timeout";
  if (Number.isInteger(bridge?.exit?.code) && bridge.exit.code !== 0) return `bridge-process-exit-${bridge.exit.code}`;
  return "bridge-result-missing";
}

async function currentFiles(repoRoot) {
  const paths = {
    self: path.join(repoRoot, "01_core/ChatGPT-自我阅读版.md"),
    memory: path.join(repoRoot, "01_core/memory/ChatGPT-AI记忆版.md")
  };
  return {
    paths,
    self: await exists(paths.self) ? await readFile(paths.self, "utf8") : "",
    memory: await exists(paths.memory) ? await readFile(paths.memory, "utf8") : ""
  };
}

export async function exportChatgptUnderstanding(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const month = normalizeMonth(options.month);
  const statePath = sidecarPath(repoRoot, month);
  const previousState = await readJson(statePath);
  const current = await currentFiles(repoRoot);
  const [selfTemplate, memoryTemplate] = await Promise.all([
    readFile(path.join(repoRoot, "02_prompts/meta/chatgpt-self-reading.md"), "utf8"),
    readFile(path.join(repoRoot, "02_prompts/meta/chatgpt-ai-memory.md"), "utf8")
  ]);
  const prompts = {
    self: buildPrompt(selfTemplate, "self"),
    memory: buildPrompt(memoryTemplate, "memory")
  };
  if (previousState?.status === "succeeded") {
    const unchanged = previousState.outputSha256?.self === sha256(current.self.trim())
      && previousState.outputSha256?.memory === sha256(current.memory.trim());
    const promptsUnchanged = previousState.promptSha256?.self === sha256(prompts.self)
      && previousState.promptSha256?.memory === sha256(prompts.memory);
    if (unchanged && promptsUnchanged && !options.retry) return { status: "skipped", reason: "already-succeeded", month, files: current.paths };
    if (!unchanged && !options.retry) return { status: "needs_review", reason: "output-modified-after-success", month, files: current.paths };
  }
  const fallbackRetryNotBefore = previousState?.reason === "local-rate-limit-cooldown" && previousState.completedAt
    ? new Date(previousState.completedAt).getTime() + DEFAULT_BRIDGE_GAP_MS
    : 0;
  const retryNotBefore = Number(previousState?.retryNotBefore || fallbackRetryNotBefore);
  if (retryNotBefore > Date.now()) {
    return {
      status: "needs_review", reason: "local-rate-limit-cooldown", month, files: current.paths,
      retryAfterSeconds: Math.ceil((retryNotBefore - Date.now()) / 1000)
    };
  }
  if (previousState?.status === "needs_review" && !(options.retry && safeRetryReasons.has(previousState.reason))) {
    return { status: "needs_review", reason: "previous-run-needs-review", month, files: current.paths };
  }
  if (previousState?.status === "failed" && !options.retry) {
    return { status: "needs_review", reason: "previous-run-failed", month, files: current.paths };
  }

  if (previousState?.status === "running" || previousState?.status === "validated") {
    const validatedFilesMatch = previousState.status === "validated"
      && previousState.outputSha256?.self === sha256(current.self.trim())
      && previousState.outputSha256?.memory === sha256(current.memory.trim());
    if (validatedFilesMatch) {
      const recovered = { ...previousState, status: "succeeded", recovered: true, recoveredAt: new Date().toISOString() };
      await writeJsonAtomic(statePath, recovered);
      return { status: "skipped", reason: "recovered-after-commit", month, files: current.paths };
    }
    if (!(options.retry && safeRetryReasons.has("previous-run-uncertain"))) {
      return { status: "needs_review", reason: "previous-run-uncertain", month, files: current.paths };
    }
  }
  await writeJsonAtomic(statePath, {
    schemaVersion: 1, month, status: "running",
    promptSha256: { self: sha256(prompts.self), memory: sha256(prompts.memory) },
    startedAt: new Date().toISOString()
  });
  const runner = options.runBridge || runBridgeCli;
  const runOne = async (part, prompt) => {
    try {
      return await runner(prompt, {
        ...options,
        timeoutMs: options.bridgeTimeoutMs || defaultBridgeTimeoutMs,
        understandingPart: part
      });
    }
    catch (error) { return { result: null, exit: { error: String(error?.message || error) } }; }
  };
  const selfBridge = await runOne("self", prompts.self);
  const selfResult = selfBridge?.result;
  if (selfResult?.status !== "succeeded") {
    const failure = {
      schemaVersion: 1, month, status: selfResult?.status === "needs_review" ? "needs_review" : "failed",
      reason: bridgeFailureReason(selfBridge),
      runs: { self: { runId: selfResult?.runId, conversationUrl: selfResult?.conversationUrl } },
      bridgeExit: { self: bridgeExitSummary(selfBridge) },
      retryAfterSeconds: selfResult?.retryAfterSeconds,
      retryNotBefore: selfResult?.retryAfterSeconds ? Date.now() + selfResult.retryAfterSeconds * 1000 : undefined,
      completedAt: new Date().toISOString()
    };
    await writeJsonAtomic(statePath, failure);
    return { ...failure, files: current.paths };
  }

  const bridgeGapMs = options.bridgeGapMs ?? DEFAULT_BRIDGE_GAP_MS;
  if (bridgeGapMs > 0) {
    await (options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(bridgeGapMs);
  }
  const memoryBridge = await runOne("memory", prompts.memory);
  const memoryResult = memoryBridge?.result;
  if (memoryResult?.status !== "succeeded") {
    const failure = {
      schemaVersion: 1, month, status: memoryResult?.status === "needs_review" ? "needs_review" : "failed",
      reason: bridgeFailureReason(memoryBridge),
      runs: {
        self: { runId: selfResult.runId, conversationUrl: selfResult.conversationUrl },
        memory: { runId: memoryResult?.runId, conversationUrl: memoryResult?.conversationUrl }
      },
      bridgeExit: { self: bridgeExitSummary(selfBridge), memory: bridgeExitSummary(memoryBridge) },
      retryAfterSeconds: memoryResult?.retryAfterSeconds,
      retryNotBefore: memoryResult?.retryAfterSeconds ? Date.now() + memoryResult.retryAfterSeconds * 1000 : undefined,
      completedAt: new Date().toISOString()
    };
    await writeJsonAtomic(statePath, failure);
    return { ...failure, files: current.paths };
  }

  const outputs = {
    self: redactSensitive(extractOutput(selfResult.text, "SELF_READING")),
    memory: redactSensitive(extractOutput(memoryResult.text, "AI_MEMORY"))
  };
  const validation = validateOutputs(outputs);
  if (!validation.valid) {
    const failure = {
      schemaVersion: 1, month, status: "needs_review", reason: "invalid-output", validation: validation.reasons,
      observedChars: { self: outputs.self.length, memory: outputs.memory.length },
      runs: {
        self: { runId: selfResult.runId, conversationUrl: selfResult.conversationUrl },
        memory: { runId: memoryResult.runId, conversationUrl: memoryResult.conversationUrl }
      },
      completedAt: new Date().toISOString()
    };
    await writeJsonAtomic(statePath, failure);
    return { ...failure, files: current.paths };
  }

  const hashes = { self: sha256(outputs.self), memory: sha256(outputs.memory) };
  await writeJsonAtomic(statePath, {
    schemaVersion: 1, month, status: "validated", outputSha256: hashes,
    runs: {
      self: { runId: selfResult.runId, conversationUrl: selfResult.conversationUrl },
      memory: { runId: memoryResult.runId, conversationUrl: memoryResult.conversationUrl }
    },
    completedAt: new Date().toISOString()
  });
  try {
    await replacePair(repoRoot, outputs.self, outputs.memory);
  } catch (error) {
    await writeJsonAtomic(statePath, {
      schemaVersion: 1, month, status: "needs_review", reason: "validated-output-not-committed",
      outputSha256: hashes, runs: {
        self: { runId: selfResult.runId, conversationUrl: selfResult.conversationUrl },
        memory: { runId: memoryResult.runId, conversationUrl: memoryResult.conversationUrl }
      }, completedAt: new Date().toISOString()
    });
    return { status: "needs_review", reason: "validated-output-not-committed", month, files: current.paths };
  }
  const diff = diffLines(current.self, outputs.self);
  await writeJsonAtomic(statePath, {
    schemaVersion: 1, month, status: "succeeded", outputSha256: hashes,
    runs: {
      self: { runId: selfResult.runId, conversationUrl: selfResult.conversationUrl },
      memory: { runId: memoryResult.runId, conversationUrl: memoryResult.conversationUrl }
    },
    completedAt: new Date().toISOString()
  });
  return {
    status: "succeeded", month, files: current.paths, selfReading: outputs.self, diff,
    outputSha256: hashes,
    runIds: { self: selfResult.runId, memory: memoryResult.runId },
    conversationUrls: { self: selfResult.conversationUrl, memory: memoryResult.conversationUrl }
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--month") options.month = argv[++i];
    else if (argv[i] === "--retry") options.retry = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await exportChatgptUnderstanding(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  // Best-effort by contract: a handled Bridge failure must not abort monthly Stage 1.
  process.exitCode = ["succeeded", "skipped", "needs_review", "failed"].includes(result.status) ? 0 : 1;
}

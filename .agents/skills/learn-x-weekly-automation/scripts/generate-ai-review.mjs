import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { readFile, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAiReview } from "../../learn-x-process/scripts/monthly-process-input.mjs";
import { isoWeekRange } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const defaultBridgePath = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const maxInputChars = 15_000;

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
    "## 本周反复思考的核心问题",
    "## 精华问题摘要",
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
    if (/^(具体的人和事（独立主线，优先保留）|本周反复思考的核心问题|精华问题摘要|核心洞察与判断变化|核心洞察|最值得沉淀|最值得自动化的重复工作流|最值得交给 Codex 执行的任务)$/.test(candidate) && !/^#{1,6}\s/.test(line.trim())) {
      return `## ${candidate}`;
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
  const timeoutMs = options.timeoutMs || 150_000;
  const child = spawn(process.execPath, [bridgePath], { stdio: ["pipe", "pipe", "pipe"] });
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

  const previous = await readJson(paths.sidecarPath);
  if (previous?.status === "confirmed" && await exists(paths.formalPath)) {
    return { status: "confirmed", targetWeek: week, formalPath: paths.formalPath };
  }
  if (await exists(paths.generatedPath)) {
    return await promoteAiReview({ repoRoot, week, confirm: true });
  }

  const template = await readFile(paths.templatePath, "utf8");
  const prompt = buildReviewPrompt(template, week);
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
  const safeRetryReasons = new Set(["ego-bootstrap-permission", "ego-browser-unavailable", "local-rate-limit-cooldown", "login-required", "captcha-or-blocked", "composer-missing", "chat-mode-switch-failed", "empty-ai-review", "ai-review-too-large", "invalid-ai-review"]);
  if (previous?.status === "needs_review" && !(options.retry && safeRetryReasons.has(previous.reason))) {
    return { status: "needs_review", targetWeek: week, reason: "previous-run-needs-review", manualPrompt: previous.manualPrompt };
  }

  const runner = options.runBridge || runBridgeCli;
  let bridge;
  try {
    bridge = await runner(prompt, options);
  } catch (error) {
    bridge = { result: null, exit: { error: String(error?.message || error) } };
  }

  const bridgeResult = bridge?.result;
  const base = resultBase(week, prompt, startedAt);
  if (bridgeResult?.status !== "succeeded") {
    const status = bridgeResult?.status === "needs_review" ? "needs_review" : "failed";
    const failure = {
      ...base,
      status,
      runId: bridgeResult?.runId,
      reason: bridgeResult?.reason || bridge?.exit?.error || (bridge?.exit?.timedOut ? "bridge-timeout" : "bridge-result-missing"),
      conversationUrl: bridgeResult?.conversationUrl,
      retryAfterSeconds: bridgeResult?.retryAfterSeconds,
      diagnostics: bridgeResult?.diagnostics,
      completedAt: new Date().toISOString(),
      manualPrompt: prompt
    };
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

function parseArgs(argv) {
  const options = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--promote") options.promote = true;
    else if (argv[index] === "--confirm") options.confirm = true;
    else if (argv[index] === "--retry") options.retry = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.promote ? await promoteAiReview(options) : await generateAiReview(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["succeeded", "generated", "confirmed"].includes(result.status) ? 0 : 2;
}

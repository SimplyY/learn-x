import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "../../learn-x-input/scripts/collect-weread-weekly.mjs";
import { writeVoiceWeekly } from "../../learn-x-input/scripts/collect-voice-weekly.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
const voiceRoot = process.env.VOICE_X_ROOT || "/Users/yuwei/code/voice-x";
const voiceScript = path.join(voiceRoot, ".agents/skills/voice-x/scripts/voice-x.mjs");
const voicePromptPath = path.join(repoRoot, "02_prompts/chatpack/reflective-decision/voice-insight.md");
const defaultBridgePath = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const { validateInsightMarkdown } = await import(pathToFileURL(voiceScript).href);
const BASE_URL = "https://ywhome.feishu.cn/base/OBapbpVNIaw7kfsM1Q9cftlmnbe?table=tbljFGhqPgKaMD5l&view=vew4IAgkv3";
const TABLE_ID = "tbljFGhqPgKaMD5l";
const FIELDS = ["标题", "录制时间", "处理后原文", "AI 洞察文档", "内容指纹"];

export async function runVoiceInsight(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const paths = { context: path.join(outputRoot, "_voice-insight-context.md"), generated: path.join(outputRoot, "_voice-insight.generated.md"), status: path.join(outputRoot, "_voice-insight-status.json") };
  await mkdir(outputRoot, { recursive: true });
  try {
    return await runVoiceInsightInternal({ ...options, week, outputRoot, paths });
  } catch (error) {
    const previous = await readJson(paths.status);
    const failed = { ...(previous || {}), schemaVersion: 1, targetWeek: week, status: "failed", reason: String(error?.message || error), failedAt: new Date().toISOString() };
    try { await writeAtomic(paths.status, `${JSON.stringify(failed, null, 2)}\n`); } catch { /* preserve the original failure */ }
    throw error;
  }
}

async function runVoiceInsightInternal(options = {}) {
  const { week, outputRoot, paths } = options;
  const previous = await readJson(paths.status);
  const transport = options.transport || createVoiceTransport();
  await transport.prepare();
  const records = await collectRecords(transport, week);
  const classified = await classifyRecords(records, transport);
  const candidates = classified.filter((record) => record.status === "ready" || (options.migrateLegacy && record.status === "legacy"));
  if (options.migrateLegacy && classified.some((record) => record.status === "legacy") && !options.confirm) throw new Error("migration-requires-confirm");
  const states = Object.fromEntries(classified.map((record) => [record.id, { id: record.id, title: record.title, status: record.status, ...(record.reason ? { reason: record.reason } : {}) }]));

  if (!candidates.length) {
    if (!(await exists(paths.generated))) await writeAtomic(paths.context, "# Voice-X 周日洞察上下文\n\n本轮没有可处理的新版粗加工记录；pending/legacy 记录未发送。\n");
    const refreshed = options.refreshVoice === false ? null : await (options.refreshVoice || writeVoiceWeekly)({ week });
    const result = { schemaVersion: 1, targetWeek: week, status: "completed", counts: countStatuses(classified), records: states, completedAt: new Date().toISOString() };
    await writeAtomic(paths.status, `${JSON.stringify(result, null, 2)}\n`);
    return { ...result, refreshed: Boolean(refreshed), paths };
  }

  const context = await buildContext(candidates, transport);
  await writeAtomic(paths.context, context);
  let blocks;
  let bridgeMeta = {};
  if (await exists(paths.generated)) {
    const generatedText = await readFile(paths.generated, "utf8");
    blocks = parseBatchOutput(generatedText, candidates.map((record) => record.id));
  } else {
    const prompt = buildBatchPrompt(await readFile(voicePromptPath, "utf8"), week, context, candidates);
    if (previous?.status === "submitted" || previous?.status === "needs_review") return { ...previous, paths };
    const explicitlyAuthorizedMigration = options.migrateLegacy && options.confirm;
    if (!options.send && !explicitlyAuthorizedMigration) {
      const preview = { schemaVersion: 1, targetWeek: week, status: "preview", promptSha256: sha256(prompt), counts: countStatuses(classified), records: states, manualPrompt: prompt, generatedAt: new Date().toISOString() };
      await writeAtomic(paths.status, `${JSON.stringify(preview, null, 2)}\n`);
      return { ...preview, paths };
    }
    if (!options.confirm) throw new Error("send-requires-confirm");
    const submitted = { schemaVersion: 1, targetWeek: week, status: "submitted", promptSha256: sha256(prompt), counts: countStatuses(classified), records: states, submittedAt: new Date().toISOString() };
    await writeAtomic(paths.status, `${JSON.stringify(submitted, null, 2)}\n`);
    const bridge = await (options.runBridge || runBridgeCli)(prompt, options);
    const bridgeResult = bridge?.result || bridge;
    if (bridgeResult?.status !== "succeeded") {
      const review = { ...submitted, status: "needs_review", runId: bridgeResult?.runId, conversationUrl: bridgeResult?.conversationUrl, reason: bridgeResult?.reason || bridge?.exit?.error || "bridge-result-missing", retryAfterSeconds: bridgeResult?.retryAfterSeconds, outputSha256: bridgeResult?.text ? sha256(bridgeResult.text) : undefined, reviewedAt: new Date().toISOString() };
      await writeAtomic(paths.status, `${JSON.stringify(review, null, 2)}\n`);
      return { ...review, paths };
    }
    bridgeMeta = { runId: bridgeResult.runId, conversationUrl: bridgeResult.conversationUrl, outputSha256: sha256(bridgeResult.text || "") };
    try { blocks = parseBatchOutput(bridgeResult.text, candidates.map((record) => record.id)); }
    catch (error) {
      const review = { ...submitted, ...bridgeMeta, status: "needs_review", reason: `invalid-output:${error.message}`, reviewedAt: new Date().toISOString() };
      await writeAtomic(paths.status, `${JSON.stringify(review, null, 2)}\n`);
      return { ...review, paths };
    }
    await writeAtomic(paths.generated, renderGeneratedBlocks(blocks));
  }

  const generated = { schemaVersion: 1, targetWeek: week, status: "generated", ...bridgeMeta, counts: countStatuses(classified), records: states, generatedAt: new Date().toISOString() };
  await writeAtomic(paths.status, `${JSON.stringify(generated, null, 2)}\n`);
  const archivePending = { ...generated, status: "archive_pending", archiveStartedAt: new Date().toISOString() };
  await writeAtomic(paths.status, `${JSON.stringify(archivePending, null, 2)}\n`);
  for (const record of candidates) {
    if (states[record.id]?.status === "completed") continue;
    const content = blocks.get(record.id);
    try {
      const archived = await (options.archive || archiveWithVoiceX)(record, content, { legacy: record.status === "legacy" });
      states[record.id] = { ...states[record.id], status: "completed", insightUrl: archived?.insightUrl };
      await writeAtomic(paths.status, `${JSON.stringify({ ...archivePending, records: states }, null, 2)}\n`);
    } catch (error) {
      const pending = { ...archivePending, records: states, failedRecord: record.id, reason: String(error?.message || error) };
      await writeAtomic(paths.status, `${JSON.stringify(pending, null, 2)}\n`);
      return { ...pending, paths };
    }
  }
  const refreshed = options.refreshVoice === false ? null : await (options.refreshVoice || writeVoiceWeekly)({ week });
  const completed = { ...archivePending, status: "completed", records: states, completedAt: new Date().toISOString() };
  await writeAtomic(paths.status, `${JSON.stringify(completed, null, 2)}\n`);
  return { ...completed, refreshed: Boolean(refreshed), paths };
}

async function collectRecords(transport, week) {
  const range = isoWeekRangeShanghai(week);
  const page = await transport.listRecords({ startEpoch: range.startEpoch, endEpoch: range.endEpoch });
  return page.filter((record) => {
    const time = Date.parse(record.recordedAt);
    return Number.isFinite(time) && time >= range.startEpoch * 1000 && time < range.endEpoch * 1000 && record.coreUrl;
  }).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id));
}

async function classifyRecords(records, transport) {
  const result = [];
  for (const record of records) {
    if (!record.insightUrl) { result.push({ ...record, status: "pending", reason: "missing-insight" }); continue; }
    const insight = await transport.fetchMarkdown(record.insightUrl);
    if (isStructuredInsight(insight)) result.push({ ...record, status: "completed" });
    else {
      const core = await transport.fetchMarkdown(record.coreUrl);
      if (!isRoughProcessedOriginal(core)) result.push({ ...record, status: "pending", reason: "legacy-processed-original" });
      else if (/占位文档/.test(insight)) result.push({ ...record, status: "ready" });
      else result.push({ ...record, status: "legacy" });
    }
  }
  return result;
}

async function buildContext(records, transport) {
  const sections = [];
  for (const record of records) {
    const markdown = await transport.fetchMarkdown(record.coreUrl);
    sections.push(`<!-- VOICE_RECORD: ${record.id} -->\n## 记录标识\n${record.id}\n\n- 标题：${record.title}\n- 录制时间：${record.recordedAt}\n- 处理后原文字符数：${Array.from(markdown).length}\n\n## 处理后原文\n\n${markdown.trim()}\n<!-- END VOICE_RECORD: ${record.id} -->`);
  }
  return `# Voice-X 周日洞察上下文\n\n${sections.join("\n\n---\n\n")}\n`;
}

export function buildBatchPrompt(template, week, context, records) {
  return ["你正在执行 Learn-X 的 Voice-X 周日批量洞察。", `目标周期：${week}（Asia/Shanghai）。`, `必须处理 ${records.length} 条记录，记录标识不可改动、不可遗漏、不可重复。`, "每条记录只输出由自动化包裹的独立区块，区块内严格按 Voice-X Prompt 的两段格式。", "--- Voice-X Prompt 开始 ---", template.trim(), "--- Voice-X Prompt 结束 ---", "--- 周日上下文开始 ---", context.trim(), "--- 周日上下文结束 ---"].join("\n\n");
}

export function parseBatchOutput(text, expectedIds) {
  const source = stripFence(text);
  const blocks = new Map();
  const ids = [];
  const pattern = /<!--[\t ]*VOICE_RECORD:[\t ]*([^\s>]+)[\t ]*-->[\t ]*([\s\S]*?)[\t ]*<!--[\t ]*END VOICE_RECORD:[\t ]*([^\s>]+)[\t ]*-->/g;
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    if (!isBatchSeparator(source.slice(lastIndex, match.index))) throw new Error("批次内容存在未标记文本");
    const startId = match[1];
    const endId = match[3];
    if (startId !== endId) throw new Error(`记录 ${startId} 起止标识不一致`);
    if (ids.includes(startId)) throw new Error(`记录 ${startId} 区块缺失或重复`);
    ids.push(startId);
    const content = match[2].trim();
    validateInsightContent(content);
    blocks.set(startId, content);
    lastIndex = match.index + match[0].length;
  }
  if (!isBatchSeparator(source.slice(lastIndex))) throw new Error("批次内容存在未标记文本");
  if (ids.length !== expectedIds.length || ids.some((id) => !expectedIds.includes(id)) || expectedIds.some((id) => !blocks.has(id))) throw new Error("记录区块数量或标识不一致");
  return blocks;
}

function validateInsightContent(content) {
  validateInsightMarkdown(content);
  if (!/^# Voice-X AI 洞察\s*\n+## 核心总结\s*\n+[\s\S]*?\n+## 芒格之魂洞察\s*\n+[\s\S]+$/m.test(content) || /^#{1,6}\s+(?:压缩原文|原始文字稿|对我的建议)(?:\s|$)/m.test(content)) throw new Error("AI 洞察不是新版两段格式");
}

function renderGeneratedBlocks(blocks) { return [...blocks.entries()].map(([id, content]) => `<!-- VOICE_RECORD: ${id} -->\n${content}\n<!-- END VOICE_RECORD: ${id} -->`).join("\n\n---\n\n") + "\n"; }
function isBatchSeparator(value) { return String(value).replace(/---/g, "").trim() === ""; }
function countStatuses(records) { return records.reduce((counts, record) => ({ ...counts, [record.status]: (counts[record.status] || 0) + 1 }), {}); }
function stripFence(text) { const value = String(text || "").trim(); const match = value.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i); return (match ? match[1] : value).trim(); }
function sha256(value) { return createHash("sha256").update(String(value), "utf8").digest("hex"); }
async function exists(filePath) { try { await stat(filePath); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function readJson(filePath) { try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function writeAtomic(filePath, content) { const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`; await writeFile(tempPath, content, "utf8"); await rename(tempPath, filePath); }
function scalar(value) { return String(Array.isArray(value) ? value[0] ?? "" : value ?? ""); }
function extractUrl(value) { return scalar(value).match(/https?:\/\/[^)\s\]]+/)?.[0] || ""; }
function isStructuredInsight(text) { const value = String(text || "").replace(/\r\n/g, "\n").replace(/^# AI 洞察(?: v2)? · .+?\s*\n+/, "").trim(); return /^# Voice-X AI 洞察\s*\n+## 核心总结\s*\n+[\s\S]*?\n+## 芒格之魂洞察\s*\n+[\s\S]+$/m.test(value) && !/^#{1,6}\s+(?:压缩原文|原始文字稿|对我的建议)(?:\s|$)/m.test(value); }
function isRoughProcessedOriginal(text) { return !/^#{1,6}\s+(?:核心总结|AI 洞察|芒格之魂洞察|压缩原文|对我的建议)(?:\s|$)/m.test(String(text || "")); }

export function createVoiceTransport() {
  let baseToken = "";
  return {
    async prepare() {
      const resolved = await runLarkJson(["base", "+url-resolve", "--url", BASE_URL, "--as", "bot", "--format", "json"]);
      baseToken = resolved?.data?.base_token;
      if (!baseToken || resolved?.data?.table_id !== TABLE_ID) throw new Error("Voice-X Base URL 解析结果不一致");
      const fields = await runLarkJson(["base", "+field-list", "--base-token", baseToken, "--table-id", TABLE_ID, "--limit", "100", "--as", "bot", "--format", "json"]);
      const names = new Set((fields?.data?.fields || []).map((field) => field.name));
      if (FIELDS.some((field) => !names.has(field))) throw new Error("Voice-X 必需字段读回不完整");
    },
    async listRecords({ startEpoch, endEpoch }) {
      const filter = { logic: "and", conditions: [["录制时间", ">", `ExactDate(${formatShanghaiIso(startEpoch - 1)})`], ["录制时间", "<", `ExactDate(${formatShanghaiIso(endEpoch)})`], ["处理后原文", "non_empty", null]] };
      const records = [];
      let offset = 0;
      while (true) {
        const result = await runLarkJson(["base", "+record-list", "--base-token", baseToken, "--table-id", TABLE_ID, ...FIELDS.flatMap((field) => ["--field-id", field]), "--filter-json", JSON.stringify(filter), "--offset", String(offset), "--limit", "200", "--as", "bot", "--format", "json"]);
        const data = result?.data || {};
        const page = (data.data || []).map((row, index) => ({ id: data.record_id_list?.[index], fields: Object.fromEntries((data.fields || []).map((name, fieldIndex) => [name, row[fieldIndex]])) }));
        records.push(...page);
        if (!data.has_more) break;
        if (!page.length) throw new Error("Voice-X Base 分页 has_more=true 但没有新增记录");
        offset += page.length;
      }
      return records.map((record) => ({ id: record.id, title: scalar(record.fields?.["标题"]), recordedAt: scalar(record.fields?.["录制时间"]), coreUrl: extractUrl(record.fields?.["处理后原文"]), insightUrl: extractUrl(record.fields?.["AI 洞察文档"]) }));
    },
    async fetchMarkdown(url) {
      const result = await runLarkJson(["docs", "+fetch", "--doc", url, "--doc-format", "markdown", "--as", "bot", "--format", "json"]);
      const content = result?.data?.document?.content;
      if (typeof content !== "string") throw new Error(`Voice-X 文档读取失败：${url}`);
      return content;
    }
  };
}

async function runLarkJson(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result?.ok !== true) throw new Error(result?.error?.message || "lark-cli returned ok=false");
  return result;
}

async function archiveWithVoiceX(record, content, { legacy = false } = {}) {
  const args = [voiceScript, "archive-insight", "--record", record.id];
  if (legacy) args.push("--new-version");
  const result = await runProcess(process.execPath, args, content);
  const line = result.stdout.trim().split(/\r?\n/).reverse().find((item) => item.trim().startsWith("{"));
  if (result.code !== 0 || !line) throw new Error(result.stderr.trim() || "Voice-X AI 洞察归档失败");
  return JSON.parse(line);
}

export async function runBridgeCli(prompt, options = {}) {
  const bridgePath = options.bridgePath || process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath;
  const result = await runProcess(process.execPath, [bridgePath], prompt, options.timeoutMs || 150_000);
  const parsed = result.stdout.split(/\r?\n/).concat(result.stderr.split(/\r?\n/)).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse().find((value) => typeof value.status === "string");
  return { result: parsed, exit: result };
}

function runProcess(command, args, input, timeoutMs = 150_000) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error?.code || 0, stdout: String(stdout), stderr: String(stderr), error: error?.message }));
    if (child.stdin) child.stdin.end(input);
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve({ code: null, stdout: "", stderr: "bridge-timeout", timedOut: true }); }, timeoutMs);
    child.once("close", () => clearTimeout(timer));
    child.once("error", reject);
  });
}

function formatShanghaiIso(epochSeconds) { return `${formatShanghai(epochSeconds).replace(" ", "T")}+08:00`; }
function formatShanghai(epochSeconds) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epochSeconds * 1000)); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`; }

function parseArgs(argv) { const options = {}; for (let index = 0; index < argv.length; index += 1) { if (argv[index] === "--week") options.week = argv[++index]; else if (argv[index] === "--send") options.send = true; else if (argv[index] === "--confirm") options.confirm = true; else if (argv[index] === "--migrate-legacy") options.migrateLegacy = true; } return options; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runVoiceInsight(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["preview", "completed"].includes(result.status) ? 0 : 2;
}

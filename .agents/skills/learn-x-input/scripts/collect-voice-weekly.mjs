import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";
import { assertWeeklyInputSize } from "./lib/input-limits.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";

export const VOICE_X_BASE_URL = "https://ywhome.feishu.cn/base/OBapbpVNIaw7kfsM1Q9cftlmnbe?table=tbljFGhqPgKaMD5l&view=vew4IAgkv3";
const TABLE_ID = "tbljFGhqPgKaMD5l";
const TABLE_NAME = "内容索引";
const TIMEZONE = "Asia/Shanghai";
const REQUIRED_FIELDS = ["标题", "录制时间", "处理后原文", "AI 洞察文档", "内容指纹"];
const EXCLUDED_HEADING_PATTERNS = [
  /^#{1,6}\s+对我的建议(?:（仅留档，不采集到 Learn-X）)?\s*$/,
  /^#{1,6}\s+\d+\.\s*对我的建议(?:（仅留档，不采集到 Learn-X）)?\s*$/,
  /^#{1,6}\s+压缩原文\s*$/
];
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function collectVoiceWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const range = isoWeekRangeShanghai(week);
  const transport = options.transport || createLarkTransport();
  await transport.prepare();
  const records = [];
  let offset = 0;
  let pages = 0;

  while (true) {
    const page = await transport.listRecords({ startEpoch: range.startEpoch, endEpoch: range.endEpoch, offset, limit: 200 });
    pages += 1;
    if (!Array.isArray(page.records)) throw new Error("Voice-X Base 返回了非法记录页。");
    records.push(...page.records);
    if (!page.hasMore) break;
    if (!page.records.length) throw new Error("Voice-X Base 分页 has_more=true 但没有新增记录。");
    offset += page.records.length;
  }

  const normalized = records.map(normalizeRecord).filter((record) => {
    const timestamp = Date.parse(record.recordedAt);
    return Number.isFinite(timestamp) && timestamp >= range.startEpoch * 1000 && timestamp < range.endEpoch * 1000 && record.coreUrl;
  });
  normalized.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.key.localeCompare(b.key, "zh-Hans-CN"));

  const ready = [];
  const counts = { ready: 0, pending: 0, legacy: 0 };
  for (const record of normalized) {
    const core = await transport.fetchMarkdown(record.coreUrl);
    record.processedOriginalChars = countChars(core);
    if (!record.insightUrl) {
      record.insightStatus = "pending";
      counts.pending += 1;
      continue;
    }
    const insight = await transport.fetchMarkdown(record.insightUrl);
    record.insightChars = countChars(insight);
    if (isStructuredInsight(insight)) {
      record.insightStatus = "ready";
      record.markdown = extractInsightMarkdown(insight);
      counts.ready += 1;
      ready.push(record);
    } else if (isInsightPlaceholder(insight)) {
      record.insightStatus = "pending";
      counts.pending += 1;
    } else {
      record.insightStatus = "legacy";
      counts.legacy += 1;
    }
  }
  return {
    week,
    timezone: TIMEZONE,
    range: { start: formatShanghai(range.startEpoch), endExclusive: formatShanghai(range.endEpoch) },
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: VOICE_X_BASE_URL,
    pagination: { pages, complete: true },
    counts,
    records: ready,
    allRecords: normalized
  };
}

export async function writeVoiceWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const notesPath = path.join(outputRoot, "voice.md");
  try {
    const payload = await collectVoiceWeekly({ ...options, week });
    const written = payload.records.length > 0;
    if (written) {
      const tempPath = `${notesPath}.${process.pid}-${Date.now()}.tmp`;
      const content = renderVoiceMarkdown(payload);
      assertWeeklyInputSize(content, notesPath);
      await mkdir(outputRoot, { recursive: true });
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, notesPath);
    }
    const summary = written ? `本周有 ${payload.records.length} 条新版 AI 洞察` : `本周没有可采集的新版 AI 洞察（pending ${payload.counts.pending}，legacy ${payload.counts.legacy}）`;
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "voice", status: written ? "ready" : "empty", file: "voice.md", count: payload.records.length, summary, preservedStaleFile: !written && await fileExists(notesPath) });
    return { payload, notesPath: written ? notesPath : null };
  } catch (error) {
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "voice", status: "failed", file: "voice.md", count: 0, summary: `采集失败：${error.message}`, preservedStaleFile: await fileExists(notesPath) });
    throw error;
  }
}

export function renderVoiceMarkdown(payload) {
  const lines = [
    `# Voice-X 核心重点｜${payload.week}`,
    "",
    `- 来源：${payload.source}`,
    `- 采集范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 记录数：${payload.records.length}`,
    `- 状态：新版 ${payload.counts?.ready || payload.records.length}，pending ${payload.counts?.pending || 0}，legacy ${payload.counts?.legacy || 0}`,
    `- 分页：已完成（${payload.pagination.pages} 页）`,
    ""
  ];
  if (!payload.records.length) return `${lines.join("\n")}已查询 Voice-X，本周核心重点记录为 0 条。\n`;
  for (const [index, record] of payload.records.entries()) {
    if (index) lines.push("---", "");
    lines.push(`## ${record.title}`, "", `- 录制时间：${record.recordedAt}`, `- 处理后原文字符数：${record.processedOriginalChars}`, `- AI 洞察字符数：${record.insightChars}`, "", record.markdown, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// 新格式 AI 洞察的建议基于当时个人上下文生成，只留档，不是新的周度事实。
// 仅识别完整且独占的固定标题，旧文档保持向后兼容。
export function stripAdviceFromVoiceMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => EXCLUDED_HEADING_PATTERNS.some((pattern) => pattern.test(line)));
  return index === -1 ? String(markdown) : lines.slice(0, index).join("\n").trimEnd();
}

export function isStructuredInsight(markdown) {
  const text = normalizeInsightDocument(markdown);
  return /^# Voice-X AI 洞察\s*\n+## 核心总结\s*\n+[\s\S]*?\n+## 芒格之魂洞察\s*\n+[\s\S]+$/m.test(text) && !/^#{1,6}\s+(?:压缩原文|原始文字稿|对我的建议)(?:\s|$)/m.test(text);
}

export function extractInsightMarkdown(markdown) {
  const text = normalizeInsightDocument(markdown);
  const start = text.indexOf("# Voice-X AI 洞察");
  return start === -1 ? text : text.slice(start).trim();
}

function isInsightPlaceholder(markdown) { return /占位文档/.test(String(markdown || "")); }
function normalizeInsightDocument(markdown) { return String(markdown || "").replace(/\r\n/g, "\n").replace(/^# AI 洞察(?: v2)? · .+?\s*\n+/, "").trim(); }
function countChars(markdown) { return Array.from(String(markdown || "").replace(/\r\n/g, "\n")).length; }

export function createLarkTransport() {
  let baseToken = "";
  return {
    async prepare() {
      const resolved = await runLarkJson(["base", "+url-resolve", "--url", VOICE_X_BASE_URL, "--as", "bot", "--format", "json"]);
      baseToken = resolved?.data?.base_token;
      if (!baseToken || resolved?.data?.table_id !== TABLE_ID) throw new Error("Voice-X Base URL 解析结果不一致。");
      const tables = await runLarkJson(["base", "+table-list", "--base-token", baseToken, "--as", "bot", "--format", "json"]);
      const table = (tables?.data?.tables || []).find((item) => item.id === TABLE_ID && item.name === TABLE_NAME);
      if (!table) throw new Error("Voice-X 内容索引表读回失败。");
      const fields = await runLarkJson(["base", "+field-list", "--base-token", baseToken, "--table-id", TABLE_ID, "--limit", "100", "--as", "bot", "--format", "json"]);
      const names = new Set((fields?.data?.fields || []).map((field) => field.name));
      if (REQUIRED_FIELDS.some((name) => !names.has(name))) throw new Error("Voice-X 必需字段读回不完整。");
    },
    async listRecords({ startEpoch, endEpoch, offset, limit }) {
      if (!baseToken) throw new Error("Voice-X Base 尚未准备。");
      const filter = buildVoiceFilter(startEpoch, endEpoch);
      const result = await runLarkJson(["base", "+record-list", "--base-token", baseToken, "--table-id", TABLE_ID, ...REQUIRED_FIELDS.flatMap((field) => ["--field-id", field]), "--filter-json", JSON.stringify(filter), "--offset", String(offset), "--limit", String(limit), "--as", "bot", "--format", "json"]);
      const data = result?.data || {};
      const names = data.fields || [];
      const ids = data.record_id_list || [];
      return {
        hasMore: Boolean(data.has_more),
        records: (data.data || []).map((row, index) => ({ id: ids[index], fields: Object.fromEntries(names.map((name, fieldIndex) => [name, row[fieldIndex]])) }))
      };
    },
    async fetchMarkdown(url) {
      const result = await runLarkJson(["docs", "+fetch", "--doc", url, "--doc-format", "markdown", "--as", "bot", "--format", "json"]);
      const content = result?.data?.document?.content;
      if (typeof content !== "string") throw new Error(`Voice-X 核心重点文档读取失败：${url}`);
      return content;
    }
  };
}

export function buildVoiceFilter(startEpoch, endEpoch) {
  return { logic: "and", conditions: [
    ["录制时间", ">", `ExactDate(${formatShanghaiIso(startEpoch - 1)})`],
    ["录制时间", "<", `ExactDate(${formatShanghaiIso(endEpoch)})`],
    ["处理后原文", "non_empty", null]
  ] };
}

function normalizeRecord(record) {
  const title = scalar(record.fields?.["标题"]) || "未命名语音记录";
  const recordedAt = scalar(record.fields?.["录制时间"]);
  const coreUrl = extractUrl(record.fields?.["处理后原文"]);
  const insightUrl = extractUrl(record.fields?.["AI 洞察文档"]);
  const fingerprint = scalar(record.fields?.["内容指纹"]);
  if (!recordedAt) throw new Error(`Voice-X 记录 ${record.id || title} 缺少录制时间。`);
  return { id: record.id, key: fingerprint || record.id || title, title, recordedAt, coreUrl, insightUrl };
}

async function runLarkJson(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result?.ok !== true) throw new Error(result?.error?.message || "lark-cli returned ok=false");
  return result;
}

function scalar(value) { return String(Array.isArray(value) ? value[0] ?? "" : value ?? ""); }
export function extractUrl(value) { return scalar(value).match(/https?:\/\/[^)\s\]]+/g)?.at(-1) || ""; }
function formatShanghai(epochSeconds) { const parts = formatParts(epochSeconds); return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`; }
function formatShanghaiIso(epochSeconds) { return `${formatShanghai(epochSeconds).replace(" ", "T")}+08:00`; }
function formatParts(epochSeconds) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epochSeconds * 1000)); return Object.fromEntries(parts.map((part) => [part.type, part.value])); }
function parseArgs(argv) { const options = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index] === "--week") options.week = argv[++index]; return options; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeVoiceWeekly(parseArgs(process.argv.slice(2)));
  console.log(`Voice-X weekly input: ${result.notesPath ? path.relative(repoRoot, result.notesPath) : "文件未生成（0 条记录）"}`);
  console.log(`Records: ${result.payload.records.length}`);
}

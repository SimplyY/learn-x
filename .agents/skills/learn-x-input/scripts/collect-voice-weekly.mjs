import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";

export const VOICE_X_BASE_URL = "https://ywhome.feishu.cn/base/OBapbpVNIaw7kfsM1Q9cftlmnbe?table=tbljFGhqPgKaMD5l&view=vew4IAgkv3";
const TABLE_ID = "tbljFGhqPgKaMD5l";
const TABLE_NAME = "内容索引";
const TIMEZONE = "Asia/Shanghai";
const REQUIRED_FIELDS = ["标题", "录制时间", "原始文字稿", "处理后原文", "内容指纹"];
const ADVICE_HEADING = "## 3. 对我的建议（仅留档，不采集到 Learn-X）";
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

  for (const record of normalized) record.markdown = stripAdviceFromVoiceMarkdown(await transport.fetchMarkdown(record.coreUrl));
  return {
    week,
    timezone: TIMEZONE,
    range: { start: formatShanghai(range.startEpoch), endExclusive: formatShanghai(range.endEpoch) },
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: VOICE_X_BASE_URL,
    pagination: { pages, complete: true },
    records: normalized
  };
}

export async function writeVoiceWeekly(options = {}) {
  const payload = await collectVoiceWeekly(options);
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", payload.week);
  const notesPath = path.join(outputRoot, "voice.md");
  const tempPath = `${notesPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(tempPath, renderVoiceMarkdown(payload), "utf8");
  await rename(tempPath, notesPath);
  return { payload, notesPath };
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
    `- 分页：已完成（${payload.pagination.pages} 页）`,
    ""
  ];
  if (!payload.records.length) return `${lines.join("\n")}已查询 Voice-X，本周核心重点记录为 0 条。\n`;
  for (const [index, record] of payload.records.entries()) {
    if (index) lines.push("---", "");
    lines.push(`## ${record.title}`, "", `- 录制时间：${record.recordedAt}`, "", record.markdown, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// 新格式 AI 洞察的建议基于当时个人上下文生成，只留档，不是新的周度事实。
// 仅识别完整且独占的固定标题，旧文档保持向后兼容。
export function stripAdviceFromVoiceMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line === ADVICE_HEADING);
  return index === -1 ? String(markdown) : lines.slice(0, index).join("\n").trimEnd();
}

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
  const fingerprint = scalar(record.fields?.["内容指纹"]);
  if (!recordedAt) throw new Error(`Voice-X 记录 ${record.id || title} 缺少录制时间。`);
  return { id: record.id, key: fingerprint || record.id || title, title, recordedAt, coreUrl };
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
  console.log(`Voice-X weekly input written: ${path.relative(repoRoot, result.notesPath)}`);
  console.log(`Records: ${result.payload.records.length}`);
}

import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertWeeklyInputSize } from "./lib/input-limits.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TZ = "Asia/Shanghai";
const DAILY_URL = "https://ywhome.feishu.cn/base/WPZRbLRrGarf8bsfYoJcZ8Kwnqc";
const COACH_URL = "https://ywhome.feishu.cn/wiki/UeHNwP3ebihXPJkU2Lfc2mIsncb";
const DAILY_TABLE = "日记";
const DAILY_FIELDS = ["日期", "核心事项（语音输入，写清楚时间、地点、人）", "明日规划", "最喜悦的事", "思考&收获&洞察&幽默"];
const COACH_TABLES = [
  { name: "服务对象", fields: ["姓名", "优先级", "创建时间", "更新时间"], filterField: "创建时间" },
  { name: "服务记录", fields: ["日期", "姓名", "服务内容", "服务资料", "核心图"], filterField: "日期" },
  { name: "ai coach thinking", fields: ["主题", "核心思考", "已推送轮次", "回顾状态", "上次推送时间", "超链接", "附件", "更新时间"], filterField: "更新时间", reviewFilter: true },
  { name: "项目", fields: ["项目名", "状态", "项目类型", "创建时间", "更新时间", "备注", "产出链接", "阻塞与风险", "当前阶段", "优先级", "下一步", "当前方案"], filterField: "创建时间" },
];

export async function collectDailyCoachWeekly({ week, outputRoot = path.join(repoRoot, "03_input/weekly", week), runCli = run }) {
  const dailyPath = path.join(outputRoot, "daily.md");
  const coachPath = path.join(outputRoot, "coach.md");
  try {
    const range = weekRange(week);
    const daily = await collectDaily(range, runCli);
    const coach = await collectCoach(range, runCli);
    const dailyContent = renderDaily(week, range, daily);
    const coachContent = renderCoach(week, range, coach);
    const dailyReady = daily.records.length > 0;
    const coachFileWritten = shouldWriteCoachFile(coach);
    assertWeeklyInputSize(dailyContent, dailyPath);
    assertWeeklyInputSize(coachContent, coachPath);
    await mkdir(outputRoot, { recursive: true });
    if (dailyReady) await atomicWrite(dailyPath, dailyContent);
    if (coachFileWritten) await atomicWrite(coachPath, coachContent);
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "daily", status: dailyReady ? "ready" : "empty", file: "daily.md", count: daily.records.length, summary: dailyReady ? "本周有日记记录" : "本周 0 条记录，文件未生成", preservedStaleFile: !dailyReady && await fileExists(dailyPath) });
    const coachCount = Object.values(coach.tables).reduce((sum, table) => sum + table.records.length, 0);
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "coach", status: coachFileWritten ? "ready" : "empty", file: "coach.md", count: coachCount, summary: coachFileWritten ? "本周有 AI Coach 记录" : "本周 0 条记录，文件未生成", preservedStaleFile: !coachFileWritten && await fileExists(coachPath) });
    return { daily, coach, coachFileWritten };
  } catch (error) {
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "daily", status: "failed", file: "daily.md", count: 0, summary: `采集失败：${error.message}`, preservedStaleFile: await fileExists(dailyPath) });
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "coach", status: "failed", file: "coach.md", count: 0, summary: `采集失败：${error.message}`, preservedStaleFile: await fileExists(coachPath) });
    throw error;
  }
}

export function shouldWriteCoachFile(data) {
  return Object.values(data.tables).some((table) => table.records.length > 0);
}

async function collectDaily(range, runCli) {
  const base = await resolve(DAILY_URL, runCli);
  const blocks = await runCli(["base", "+base-block-list", "--base-token", base, "--as", "bot", "--format", "json"]);
  const table = (blocks.data?.blocks || []).find((item) => item.name === DAILY_TABLE);
  if (!table) throw new Error("日常记录 Base 未找到「日记」表。");
  await verifyFields(base, table.table_id || table.id, DAILY_FIELDS, runCli);
  const result = await listRecords(base, table.table_id || table.id, DAILY_FIELDS, [
    ["日期", ">", `ExactDate(${range.startExclusive})`], ["日期", "<", `ExactDate(${range.end})`]
  ], runCli);
  return { baseUrl: DAILY_URL, table: DAILY_TABLE, fields: DAILY_FIELDS, ...result, records: inRange(result.records, "日期", range) };
}

async function collectCoach(range, runCli) {
  const base = await resolve(COACH_URL, runCli);
  const blocks = await runCli(["base", "+base-block-list", "--base-token", base, "--as", "bot", "--format", "json"]);
  const tables = blocks.data?.blocks || [];
  const output = {};
  for (const config of COACH_TABLES) {
    const table = tables.find((item) => item.name === config.name);
    if (!table) throw new Error(`AI Coach Base 未找到「${config.name}」表。`);
    const tableId = table.table_id || table.id;
    await verifyFields(base, tableId, config.fields, runCli);
    const result = await listRecords(base, tableId, config.fields, [
      [config.filterField, ">", `ExactDate(${range.startExclusive})`], [config.filterField, "<", `ExactDate(${range.end})`]
    ], runCli);
    const inRangeRecords = inRange(result.records, config.filterField, range);
    const records = config.reviewFilter ? inRangeRecords.filter((record) => !isCoachReviewRecord(record.values)) : inRangeRecords;
    output[config.name] = {
      fields: config.fields,
      filterField: config.filterField,
      ...result,
      records,
      excludedReviewCount: inRangeRecords.length - records.length,
    };
  }
  return { baseUrl: COACH_URL, tables: output };
}

export function isCoachReviewRecord(values) {
  const pushRound = Number(values["已推送轮次"]);
  return Number.isFinite(pushRound) && pushRound > 0 && Boolean(values["回顾状态"]) && Boolean(values["上次推送时间"]);
}

async function resolve(url, runCli) { return (await runCli(["base", "+url-resolve", "--url", url, "--as", "bot", "--format", "json"])).data?.base_token; }
async function verifyFields(base, table, required, runCli) { const result = await runCli(["base", "+field-list", "--base-token", base, "--table-id", table, "--limit", "100", "--as", "bot", "--format", "json"]); const names = new Set((result.data?.fields || []).map((field) => field.name)); if (required.some((field) => !names.has(field))) throw new Error(`飞书表字段核验失败：${required.filter((field) => !names.has(field)).join("、")}`); }
async function listRecords(base, table, fields, conditions, runCli) {
  const pages = []; let offset = 0; let pageCount = 0;
  while (true) {
    const result = await runCli(["base", "+record-list", "--base-token", base, "--table-id", table, ...fields.flatMap((field) => ["--field-id", field]), "--filter-json", JSON.stringify({ logic: "and", conditions }), "--offset", String(offset), "--limit", "200", "--as", "bot", "--format", "json"]);
    const data = result.data || {}; const names = data.fields || fields; const rows = data.data || [];
    pages.push(...rows.map((row, index) => ({ id: data.record_id_list?.[index], values: Object.fromEntries(names.map((name, i) => [name, safeValue(row[i])])) })));
    pageCount += 1;
    if (!data.has_more) return { records: pages, pages: pageCount, complete: true };
    if (!rows.length) throw new Error("飞书 Base 分页 has_more=true 但没有新增记录。");
    offset += rows.length;
  }
}

function inRange(records, field, range) {
  const start = Date.parse(range.start); const end = Date.parse(range.end);
  return records.filter((record) => { const value = record.values[field]; const timestamp = Date.parse(String(value).replace(" ", "T") + (String(value).includes("+") ? "" : "+08:00")); return Number.isFinite(timestamp) && timestamp >= start && timestamp < end; });
}

function safeValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(safeValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    if (value.url) return String(value.url);
    if (value.file_name) return String(value.file_name);
    return Object.entries(value).filter(([key]) => !/id|contact|interview|token|secret/i.test(key)).map(([key, item]) => `${key}:${safeValue(item)}`).filter(Boolean).join("；");
  }
  return String(value);
}

function renderDaily(week, range, data) {
  const lines = [`# 飞书日记｜${week}`, "", `- 来源：日常记录（飞书 Base）`, `- Base URL：${data.baseUrl}`, `- 目标范围：${range.start} 至 ${range.end}（Asia/Shanghai）`, `- 采集时间：${new Date().toISOString()}`, `- CLI 来源：\`lark-cli base +url-resolve --as bot\`、\`+base-block-list\`、\`+field-list\`、\`+record-list --filter-json\``, `- 字段 provenance：已核验「${data.fields.join("、")}」`, `- 记录数：${data.records.length}`, `- 分页：${data.complete ? `已完成（${data.pages} 页）` : "未完成"}`, "", "## 记录", ""];
  for (const record of data.records.sort((a, b) => String(a.values.日期).localeCompare(String(b.values.日期)))) { lines.push(`### ${record.values.日期.slice(0, 10)}`); for (const [key, value] of Object.entries(record.values).slice(1)) if (value) lines.push(`- ${key}：${value}`); lines.push(""); }
  return lines.join("\n");
}

function renderCoach(week, range, data) {
  const lines = [
    `# AI Coach 周度采集｜${week}`, "",
    `- Base URL：${data.baseUrl}`,
    `- 目标范围：${range.start} 至 ${range.end}（${TZ}）`,
    `- 采集时间：${new Date().toISOString()}`,
    "- 输入边界：保留新增记录；在采集器内排除回顾、复看和推送状态更新，不由通用 Input 二次排除。",
    "- CLI 来源：`lark-cli base +url-resolve --as bot`、`+base-block-list`、`+field-list`、`+record-list --filter-json`",
    "- 结构核验：四张表与字段已现场核验。", "",
  ];
  for (const [name, table] of Object.entries(data.tables)) {
    lines.push(`## ${name}（本周新增：${table.records.length} 条；回顾更新排除：${table.excludedReviewCount} 条；筛选字段：${table.filterField}；分页：${table.complete ? `已完成（${table.pages} 页）` : "未完成"}）`, "");
    for (const record of table.records) {
      const values = Object.entries(record.values).filter(([, value]) => value).map(([key, value]) => `${key}：${value}`);
      if (values.length) lines.push(`- ${values.join("；")}`);
    }
    if (!table.records.length) lines.push("- 本周无新增记录");
    lines.push("");
  }
  return lines.join("\n");
}

function weekRange(week) { const match = /^(\d{4})-W(\d{2})$/.exec(week); if (!match) throw new Error(`无效周：${week}`); const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4)); const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (Number(match[2]) - 1) * 7); const date = (value) => value.toISOString().slice(0, 10); const start = date(monday); const endDate = new Date(monday); endDate.setUTCDate(monday.getUTCDate() + 7); const startExclusive = new Date(monday); startExclusive.setUTCSeconds(-1); return { start: `${start}T00:00:00+08:00`, startExclusive: `${date(startExclusive)}T23:59:59+08:00`, end: `${date(endDate)}T00:00:00+08:00` }; }
async function atomicWrite(file, content) { assertWeeklyInputSize(content, file); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, content, "utf8"); await rename(temp, file); }
async function run(args) { const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 }); const result = JSON.parse(stdout); if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败"); return result; }

if (process.argv[1] === fileURLToPath(import.meta.url)) { const week = process.argv[process.argv.indexOf("--week") + 1]; const result = await collectDailyCoachWeekly({ week }); const excluded = Object.values(result.coach.tables).reduce((sum, table) => sum + table.excludedReviewCount, 0); const retained = Object.values(result.coach.tables).reduce((sum, table) => sum + table.records.length, 0); const coachStatus = result.coachFileWritten ? "coach.md 已生成" : "coach.md 未生成（0 条记录）"; console.log(`Daily/Coach weekly inputs for ${week}: daily=${result.daily.records.length} 条，coach=${retained} 条，${coachStatus}；review 排除 ${excluded} 条。`); }

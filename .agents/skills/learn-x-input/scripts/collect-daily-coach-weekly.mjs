import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TZ = "Asia/Shanghai";
const DAILY_URL = "https://ywhome.feishu.cn/base/WPZRbLRrGarf8bsfYoJcZ8Kwnqc";
const COACH_URL = "https://ywhome.feishu.cn/wiki/UeHNwP3ebihXPJkU2Lfc2mIsncb";
const DAILY_TABLE = "日记";
const DAILY_FIELDS = ["日期", "核心事项（语音输入）", "明日规划", "最喜悦的事", "思考&收获&洞察&幽默"];
const COACH_TABLES = {
  "服务对象": ["姓名", "优先级", "更新时间"],
  "服务记录": ["日期", "姓名", "服务内容", "服务资料", "更新时间", "核心图"],
  "ai coach thinking": ["主题", "核心思考", "已推送轮次", "回顾状态", "超链接", "附件", "更新时间"],
  "项目": ["项目名", "状态", "项目类型", "更新时间", "备注", "产出链接", "阻塞与风险", "当前阶段", "优先级", "下一步", "当前方案"]
};

export async function collectDailyCoachWeekly({ week, outputRoot = path.join(repoRoot, "03_input/weekly", week) }) {
  const range = weekRange(week);
  const daily = await collectDaily(range);
  const coach = await collectCoach(range);
  await mkdir(outputRoot, { recursive: true });
  await atomicWrite(path.join(outputRoot, "daily.md"), renderDaily(week, range, daily));
  await atomicWrite(path.join(outputRoot, "coach.md"), renderCoach(week, range, coach));
  return { daily, coach };
}

async function collectDaily(range) {
  const base = await resolve(DAILY_URL);
  const blocks = await run(["base", "+base-block-list", "--base-token", base, "--as", "bot", "--format", "json"]);
  const table = (blocks.data?.blocks || []).find((item) => item.name === DAILY_TABLE);
  if (!table) throw new Error("日常记录 Base 未找到「日记」表。");
  await verifyFields(base, table.table_id || table.id, DAILY_FIELDS);
  const result = await listRecords(base, table.table_id || table.id, DAILY_FIELDS, [
    ["日期", ">", `ExactDate(${range.startExclusive})`], ["日期", "<", `ExactDate(${range.end})`]
  ]);
  return { baseUrl: DAILY_URL, table: DAILY_TABLE, fields: DAILY_FIELDS, ...result, records: inRange(result.records, "日期", range) };
}

async function collectCoach(range) {
  const base = await resolve(COACH_URL);
  const blocks = await run(["base", "+base-block-list", "--base-token", base, "--as", "bot", "--format", "json"]);
  const tables = blocks.data?.blocks || [];
  const output = {};
  for (const [name, fields] of Object.entries(COACH_TABLES)) {
    const table = tables.find((item) => item.name === name);
    if (!table) throw new Error(`AI Coach Base 未找到「${name}」表。`);
    await verifyFields(base, table.table_id || table.id, fields);
    const result = await listRecords(base, table.table_id || table.id, fields, [
      ["更新时间", ">", `ExactDate(${range.startExclusive})`], ["更新时间", "<", `ExactDate(${range.end})`]
    ]);
    output[name] = { fields, ...result, records: inRange(result.records, "更新时间", range) };
  }
  return { baseUrl: COACH_URL, tables: output };
}

async function resolve(url) { return (await run(["base", "+url-resolve", "--url", url, "--as", "bot", "--format", "json"])).data?.base_token; }
async function verifyFields(base, table, required) { const result = await run(["base", "+field-list", "--base-token", base, "--table-id", table, "--limit", "100", "--as", "bot", "--format", "json"]); const names = new Set((result.data?.fields || []).map((field) => field.name)); if (required.some((field) => !names.has(field))) throw new Error(`飞书表字段核验失败：${required.filter((field) => !names.has(field)).join("、")}`); }
async function listRecords(base, table, fields, conditions) {
  const pages = []; let offset = 0; let pageCount = 0;
  while (true) {
    const result = await run(["base", "+record-list", "--base-token", base, "--table-id", table, ...fields.flatMap((field) => ["--field-id", field]), "--filter-json", JSON.stringify({ logic: "and", conditions }), "--offset", String(offset), "--limit", "200", "--as", "bot", "--format", "json"]);
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
  const lines = [`# AI Coach 周度采集｜${week}`, "", `- Base URL：${data.baseUrl}`, `- 目标范围：${range.start} 至 ${range.end}（${TZ}）`, `- 采集时间：${new Date().toISOString()}`, "- CLI 来源：`lark-cli base +url-resolve --as bot`、`+base-block-list`、`+field-list`、`+record-list --filter-json`", "- 结构核验：四张表与字段已现场核验。", ""];
  for (const [name, table] of Object.entries(data.tables)) { lines.push(`## ${name}（目标周更新：${table.records.length} 条；分页：${table.complete ? `已完成（${table.pages} 页）` : "未完成"}）`, ""); for (const record of table.records) { const values = Object.entries(record.values).filter(([, value]) => value).map(([key, value]) => `${key}：${value}`); if (values.length) lines.push(`- ${values.join("；")}`); } if (!table.records.length) lines.push("- 已检查，本周无更新"); lines.push(""); }
  return lines.join("\n");
}

function weekRange(week) { const match = /^(\d{4})-W(\d{2})$/.exec(week); if (!match) throw new Error(`无效周：${week}`); const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4)); const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (Number(match[2]) - 1) * 7); const date = (value) => value.toISOString().slice(0, 10); const start = date(monday); const endDate = new Date(monday); endDate.setUTCDate(monday.getUTCDate() + 7); const startExclusive = new Date(monday); startExclusive.setUTCSeconds(-1); return { start: `${start}T00:00:00+08:00`, startExclusive: `${date(startExclusive)}T23:59:59+08:00`, end: `${date(endDate)}T00:00:00+08:00` }; }
async function atomicWrite(file, content) { const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, content, "utf8"); await rename(temp, file); }
async function run(args) { const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 }); const result = JSON.parse(stdout); if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败"); return result; }

if (process.argv[1] === fileURLToPath(import.meta.url)) { const week = process.argv[process.argv.indexOf("--week") + 1]; const result = await collectDailyCoachWeekly({ week }); console.log(`Daily/Coach weekly inputs written for ${week}: ${result.daily.records.length}/${Object.values(result.coach.tables).reduce((sum, table) => sum + table.records.length, 0)}`); }

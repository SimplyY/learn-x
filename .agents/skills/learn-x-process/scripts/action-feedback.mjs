#!/usr/bin/env node
// Action Feedback 周报是独立的行动反馈事件草稿；Base 只保存人工确认后的事件。
// collect 保留为旧流程兼容命令，新流程只读取独立的 action-feedback.md。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fileExists, updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { normalizeWeek } from "./backup-weekly.mjs";
import { defaultWeeklyReviewWeek } from "./collect-weekly-input.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../../../..");
export const BASE_NAME = "Learn-X Action Feedback";
export const TABLE_NAME = "Actions";
export const LEGACY_BASE_FIELD_SCHEMA = [
  { name: "行动 ID", type: "text" },
  { name: "行动", type: "text" },
  { name: "来源周期", type: "text" },
  { name: "状态", type: "select", multiple: false, options: [{ name: "continue" }, { name: "done" }, { name: "stopped" }] },
  { name: "核心反馈", type: "text" },
  { name: "反馈类型", type: "select", multiple: false, options: [{ name: "外部" }, { name: "系统" }, { name: "内部" }] },
  { name: "下一步", type: "text" },
  { name: "最近复盘周期", type: "text" },
  { name: "来源证据", type: "text" },
];
export const BASE_FIELD_SCHEMA = [
  { name: "短期核心议题", type: "text" },
  { name: "行动", type: "text" },
  { name: "反馈", type: "text" },
  { name: "周期时间", type: "datetime" },
  { name: "事件键", type: "text" },
  // 旧 Base 已有同名的普通 datetime 字段，不能改型；新增系统字段保持事件时间语义。
  { name: "事件创建时间", type: "created_at" },
];
export const TIME_GROUP_FIELD_SCHEMA = [
  { name: "年", type: "formula", expression: "[事件创建时间].YEAR().CONCATENATE(\" 年\")" },
  { name: "月", type: "formula", expression: "TEXT([事件创建时间],\"MM月\")" },
  { name: "年度第几周", type: "formula", expression: "FORMAT(\"{1}周\",TEXT(WEEKNUM([事件创建时间],2),\"00\"))" },
];
export const ACTION_FEEDBACK_FIELD_SCHEMA = [...BASE_FIELD_SCHEMA, ...TIME_GROUP_FIELD_SCHEMA];
export const REQUIRED_FIELDS = BASE_FIELD_SCHEMA.map((field) => field.name);
export const LEGACY_REQUIRED_FIELDS = LEGACY_BASE_FIELD_SCHEMA.map((field) => field.name);
export const STATUS_TO_BASE = { "继续": "continue", "完成": "done", "停止": "stopped" };
export const FEEDBACK_TYPES = ["外部", "系统", "内部"];
const ACTION_ID_RE = /^AF-\d{4}-W\d{2}-\d{2}$/;
const SYNC_LOG_DIR = "04_output/_dist/action-feedback";
const SYNC_LOG_FILE = "sync-log.jsonl";
export const ACTION_FEEDBACK_REPORT = "action-feedback.md";
export const CORE_TOPICS_FILE = "01_core/道/人生核心议题.md";
export const MAX_REPORT_CHARS = 1000;

async function runLarkCli(args) {
  const fullArgs = [...args, "--as", "user", "--format", "json"];
  try {
    const { stdout } = await execFileAsync("lark-cli", fullArgs, {
      cwd: repoRoot,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败");
    return result;
  } catch (error) {
    const output = `${error.stderr || ""}\n${error.stdout || ""}`.trim();
    const jsonLine = output.split("\n").find((line) => line.trim().startsWith("{"));
    if (jsonLine) {
      try {
        const parsed = JSON.parse(jsonLine);
        throw new Error(parsed.error?.message || parsed.message || error.message);
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) throw parseError;
      }
    }
    throw error;
  }
}

function cellText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.text != null) return String(value.text);
    if (value.name != null) return String(value.name);
    if (value.value != null) return cellText(value.value);
    const values = Object.values(value);
    if (values.length) return values.map(cellText).filter(Boolean).join("、");
  }
  return String(value);
}

function recordsFromData(data, requestedFields = REQUIRED_FIELDS) {
  const rows = data.data || data.records || data.items || [];
  const ids = data.record_id_list || [];
  const fieldNames = data.fields || requestedFields;
  return rows.map((row, index) => {
    if (Array.isArray(row)) {
      return { id: ids[index], values: Object.fromEntries(fieldNames.map((field, fieldIndex) => [field, cellText(row[fieldIndex])])) };
    }
    const values = row.fields || row.values || row;
    return { id: row.record_id || row.id || ids[index], values: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, cellText(value)])) };
  }).filter((record) => record.id);
}

async function listRecords(config, fields = REQUIRED_FIELDS) {
  const records = [];
  let offset = 0;
  while (true) {
    const result = await runLarkCli(["base", "+record-list", "--base-token", config.baseToken, "--table-id", config.tableId, ...fields.flatMap((field) => ["--field-id", field]), "--offset", String(offset), "--limit", "200"]);
    const page = recordsFromData(result.data || {}, fields);
    records.push(...page);
    if (!result.data?.has_more) return records;
    if (!page.length) throw new Error("Base 分页声明 has_more，但没有返回新记录。");
    offset += page.length;
  }
}

function driveItems(result) {
  const data = result.data || {};
  if (Array.isArray(data.results)) return data.results.map((item) => ({ name: String(item.title_highlighted || "").replace(/<\/?h>/g, ""), token: item.result_meta?.token || "" }));
  return data.items || data.data || [];
}

// drive +search 对新建 Base 存在冷启动窗口，不能作为唯一存在性判断；返回全部精确同名匹配，由调用方裁决。
async function findBaseTokens() {
  return driveItems(await runLarkCli(["drive", "+search", "--query", BASE_NAME, "--doc-types", "bitable", "--only-title"]))
    .filter((item) => item.name === BASE_NAME)
    .map((item) => item.token)
    .filter(Boolean);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fieldDefinitions(baseToken, tableId) {
  const listed = await runLarkCli(["base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--limit", "200"]);
  return listed.data?.fields || [];
}

export function schemaIssues(fields, schema) {
  const byName = new Map(fields.map((field) => [field.name, field]));
  const missing = [];
  const mismatched = [];
  for (const expected of schema) {
    const name = typeof expected === "string" ? expected : expected.name;
    const actual = byName.get(name);
    if (!actual) {
      missing.push(name);
      continue;
    }
    if (typeof expected !== "string" && expected.type && actual.type !== expected.type) {
      mismatched.push(`${name}（实际类型 ${actual.type || "unknown"}，预期 ${expected.type}）`);
    }
  }
  return { missing, mismatched };
}

async function missingFields(baseToken, tableId, schema = BASE_FIELD_SCHEMA) {
  try {
    const issues = schemaIssues(await fieldDefinitions(baseToken, tableId), schema);
    return [...issues.missing, ...issues.mismatched];
  } catch {
    return ["（Base 或表不可访问）"];
  }
}

async function waitForMissingFields(baseToken, tableId, schema = BASE_FIELD_SCHEMA) {
  let remaining = await missingFields(baseToken, tableId, schema);
  for (let attempt = 0; attempt < 5 && remaining.length; attempt += 1) {
    await sleep(250 * (attempt + 1));
    remaining = await missingFields(baseToken, tableId, schema);
  }
  return remaining;
}

async function ensureFields(baseToken, tableId, schema, missingNames = null) {
  const current = schemaIssues(await fieldDefinitions(baseToken, tableId), schema);
  if (current.mismatched.length) throw new Error(`字段类型不匹配，拒绝覆盖：${current.mismatched.join("、")}`);
  const missing = schema.filter((field) => (missingNames || current.missing).includes(field.name));
  for (const field of missing) {
    const args = ["base", "+field-create", "--base-token", baseToken, "--table-id", tableId, "--json", JSON.stringify(field)];
    if (field.type === "formula") args.push("--i-have-read-guide");
    await runLarkCli(args);
  }
  const remaining = await waitForMissingFields(baseToken, tableId, schema);
  if (remaining.length) throw new Error(`字段迁移后仍缺失或类型错误：${remaining.join("、")}`);
  return missing.map((field) => field.name);
}

function tableItems(result) {
  const data = result.data || {};
  return data.tables || data.items || data.data || [];
}

async function findTableId(baseToken) {
  const matches = tableItems(await runLarkCli(["base", "+table-list", "--base-token", baseToken, "--limit", "100"])).filter((table) => table.name === TABLE_NAME);
  if (matches.length > 1) throw new Error(`Base 存在多个同名表，拒绝猜选：${TABLE_NAME}`);
  return matches.length ? (matches[0].table_id || matches[0].tableId || matches[0].id || "") : "";
}

function baseTokenFromItem(item) {
  return item?.base_token || item?.token || item?.obj_token || item?.file_token || "";
}

// 首次解析成功后本地 pin；后续运行不再依赖 drive search 做存在性判断，避免冷启动导致重复建 Base。
const PIN_FILE = path.join(repoRoot, SYNC_LOG_DIR, "base.json");

async function readPin() {
  try {
    const pin = JSON.parse(await readFile(PIN_FILE, "utf8"));
    return pin && pin.baseToken ? pin : null;
  } catch {
    return null;
  }
}

async function writePin(config) {
  await mkdir(path.join(repoRoot, SYNC_LOG_DIR), { recursive: true });
  await writeFile(PIN_FILE, `${JSON.stringify({ baseToken: config.baseToken, tableId: config.tableId, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

// 解析顺序：显式 env → 本地 pin；两者都必须通过字段校验才算可用。collect 与 sync 共用；collect 绝不创建。
async function resolvePinned(config, schema = BASE_FIELD_SCHEMA) {
  const pin = await readPin();
  const candidates = [{ baseToken: config.baseToken, tableId: config.tableId }, { baseToken: pin?.baseToken, tableId: pin?.tableId }].filter((item) => item.baseToken);
  for (const candidate of candidates) {
    const tableId = candidate.tableId || (await findTableId(candidate.baseToken).catch(() => ""));
    if (tableId && (await missingFields(candidate.baseToken, tableId, schema)).length === 0) {
      config.baseToken = candidate.baseToken;
      config.tableId = tableId;
      return config;
    }
  }
  return null;
}

async function ensureResources(config) {
  const pinned = await resolvePinned(config, ACTION_FEEDBACK_FIELD_SCHEMA);
  if (pinned) return pinned;
  config.baseToken = "";
  config.tableId = "";
  let tokens = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await sleep(2000 * attempt);
    tokens = await findBaseTokens();
    if (tokens.length !== 1) break;
  }
  if (tokens.length > 1) {
    throw new Error(`发现多个名为「${BASE_NAME}」的 Base，拒绝猜选：${tokens.join("、")}；请用 LEARN_X_ACTION_BASE_TOKEN 指定目标 Base 或清理多余 Base。`);
  }
  let baseToken = tokens[0] || "";
  let createdBase = false;
  if (!baseToken) {
    const created = await runLarkCli(["base", "+base-create", "--name", BASE_NAME, "--table-name", TABLE_NAME, "--time-zone", "Asia/Shanghai", "--fields", JSON.stringify(BASE_FIELD_SCHEMA)]);
    baseToken = baseTokenFromItem(created.data || created);
    for (let attempt = 0; attempt < 5 && !baseToken; attempt += 1) {
      // 创建响应形状不可靠时按名称搜索回读；新建 Base 的搜索索引可能短暂冷启动，带退避重试。
      await sleep(1000 * (attempt + 1));
      const found = await findBaseTokens();
      if (found.length === 1) baseToken = found[0];
      else if (found.length > 1) throw new Error(`Base 创建后搜索到多个同名 Base，拒绝猜选：${found.join("、")}；可用 LEARN_X_ACTION_BASE_TOKEN 指定后重试。`);
    }
    if (!baseToken) {
      throw new Error(`Base 创建后未能定位 token（响应键：${Object.keys(created.data || created).join("、") || "空"}）；可用 LEARN_X_ACTION_BASE_TOKEN 指定后重试。`);
    }
    createdBase = true;
  }
  config.baseToken = baseToken;
  config.tableId = await findTableId(config.baseToken);
  let createdTable = false;
  if (!config.tableId) {
    const created = await runLarkCli(["base", "+table-create", "--base-token", config.baseToken, "--name", TABLE_NAME, "--fields", JSON.stringify(BASE_FIELD_SCHEMA)]);
    const table = tableItems(created)[0] || created.data?.table || created.data;
    config.tableId = table?.table_id || table?.tableId || table?.id || created.data?.table_id || "";
    for (let attempt = 0; attempt < 5 && !config.tableId; attempt += 1) {
      await sleep(1000 * (attempt + 1));
      config.tableId = await findTableId(config.baseToken);
    }
    if (!config.tableId) throw new Error("Actions 表创建后未能定位 table id；可用 LEARN_X_ACTION_TABLE_ID 指定后重试。");
    createdTable = true;
  }
  if (createdBase || createdTable) await ensureFields(config.baseToken, config.tableId, ACTION_FEEDBACK_FIELD_SCHEMA);
  const missing = await missingFields(config.baseToken, config.tableId, ACTION_FEEDBACK_FIELD_SCHEMA);
  if (missing.length) throw new Error(`行动反馈 Base 字段缺失：${missing.join("、")}`);
  await writePin(config);
  return config;
}

function dateOnly(value) {
  if (value == null || value === "") return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 100000000000) {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(numeric));
  }
  return String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || String(value);
}

function sameReadbackValue(field, expected, actual) {
  if (field === "周期时间") return dateOnly(expected) === dateOnly(actual);
  return String(actual ?? "") === String(expected ?? "");
}

async function upsertRecord(config, fields, recordId, actionId) {
  const args = ["base", "+record-upsert", "--base-token", config.baseToken, "--table-id", config.tableId, "--json", JSON.stringify(fields)];
  if (recordId) args.push("--record-id", recordId);
  await runLarkCli(args);
  const id = String(actionId ?? fields["行动 ID"] ?? "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = (await listRecords(config, LEGACY_REQUIRED_FIELDS)).find((record) => String(record.values["行动 ID"] || "") === id);
    if (found) {
      const mismatch = Object.entries(fields).filter(([field, value]) => field !== "事件创建时间" && !sameReadbackValue(field, value, found.values[field]));
      if (!mismatch.length) return found;
      if (attempt === 4) throw new Error(`Base 读回字段不一致：${id}（${mismatch.map(([field]) => field).join("、")}）`);
    } else if (attempt === 4) {
      throw new Error(`Base 写入后未读回行动 ID：${id}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
}

async function upsertEvent(config, fields, recordId, eventKey) {
  const args = ["base", "+record-upsert", "--base-token", config.baseToken, "--table-id", config.tableId, "--json", JSON.stringify(fields)];
  if (recordId) args.push("--record-id", recordId);
  await runLarkCli(args);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = (await listRecords(config)).find((record) => String(record.values["事件键"] || "") === String(eventKey));
    if (found) {
      const mismatch = Object.entries(fields).filter(([field, value]) => !sameReadbackValue(field, value, found.values[field]));
      if (!mismatch.length) return found;
      if (attempt === 4) throw new Error(`Base 读回事件字段不一致：${eventKey}（${mismatch.map(([field]) => field).join("、")}）`);
    } else if (attempt === 4) {
      throw new Error(`Base 写入后未读回事件键：${eventKey}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
}

async function resolveExistingTarget() {
  const explicit = { baseToken: process.env.LEARN_X_ACTION_BASE_TOKEN || "", tableId: process.env.LEARN_X_ACTION_TABLE_ID || "" };
  const pin = await readPin();
  const candidates = [explicit, { baseToken: pin?.baseToken || "", tableId: pin?.tableId || "" }].filter((item) => item.baseToken);
  if (!candidates.length) {
    const tokens = await findBaseTokens();
    if (tokens.length !== 1) throw new Error(tokens.length > 1 ? `发现多个同名 Base，需人工指定 LEARN_X_ACTION_BASE_TOKEN：${tokens.join("、")}` : "Action Feedback Base 不存在。");
    candidates.push({ baseToken: tokens[0], tableId: "" });
  }
  const target = candidates[0];
  target.tableId ||= await findTableId(target.baseToken);
  if (!target.tableId) throw new Error("Action Feedback Base 中不存在 Actions 表。");
  return target;
}

async function cmdMigrate() {
  const config = await resolveExistingTarget();
  const created = await ensureFields(config.baseToken, config.tableId, ACTION_FEEDBACK_FIELD_SCHEMA);
  await writePin(config);
  return { ok: true, command: "migrate", created };
}

// ---------- 当前季度短期核心议题与独立报告 ----------

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function cellPlainText(value) {
  return decodeHtml(String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function shortTermSection(markdown) {
  const lines = String(markdown || "").split("\n");
  const start = lines.findIndex((line) => /^#\s+短期核心议题\s*$/.test(line.trim()));
  if (start < 0) return "";
  const end = lines.slice(start + 1).findIndex((line) => /^#\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : start + 1 + end).join("\n");
}

export function parseShortTermTopics(markdown) {
  const section = shortTermSection(markdown);
  const topics = [];
  for (const row of section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cellPlainText(match[1]));
    const topic = cells[1] || "";
    if (topic && topic !== "议题" && !topics.includes(topic)) topics.push(topic);
  }
  if (topics.length) return topics;
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const topic = cells[2] || "";
    if (topic && topic !== "议题" && !/^[-:]+$/.test(topic) && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

export function coreTopicMetadata(markdown) {
  const revision = String(markdown || "").match(/revision:\s*([^\s]+)/i)?.[1] || "unknown";
  const source = String(markdown || "").match(/source:\s*(\S+)/i)?.[1] || "";
  const status = String(markdown || "").match(/status:\s*([^\s]+)/i)?.[1] || "unknown";
  return { revision, source, status };
}

export async function readShortTermTopics(file = path.join(repoRoot, CORE_TOPICS_FILE)) {
  const markdown = await readFile(file, "utf8");
  const topics = parseShortTermTopics(markdown);
  if (!topics.length) throw new Error(`核心议题镜像缺少「短期核心议题」：${path.relative(repoRoot, file)}`);
  const metadata = coreTopicMetadata(markdown);
  if (metadata.status === "stale") throw new Error(`核心议题镜像已过期（revision ${metadata.revision}），请先同步：${path.relative(repoRoot, file)}`);
  return { topics, ...metadata, file };
}

export function renderActionFeedbackDraft({ week, topics, revision = "unknown" }) {
  if (!topics?.length) {
    return [
      `# Action Feedback 周报｜${week}`,
      "",
      "> ⚠️ 未读取到短期核心议题；请先同步核心议题镜像，本报告不会伪造空议题。",
      "",
    ].join("\n");
  }
  return [
    `# Action Feedback 周报｜${week}`,
    "",
    `> 议题基线：核心议题总览（revision ${revision}）`,
    "> 本周没有行动或反馈的议题保留为空。",
    `> 总字数不超过 ${MAX_REPORT_CHARS} 字。`,
    "",
    "| 短期核心议题 | 行动 | 反馈 |",
    "|---|---|---|",
    ...topics.map((topic) => `| ${topic} | — | 本周无新事项 |`),
    "",
  ].join("\n");
}

export function visibleCharCount(value) {
  return Array.from(String(value || "")).length;
}

export async function ensureActionFeedbackDraft({ week, outputRoot, coreTopicsFile } = {}) {
  const target = path.join(outputRoot, ACTION_FEEDBACK_REPORT);
  if (await fileExists(target)) return { path: target, status: "preserved" };
  let content;
  let metadata = { topics: [], revision: "unknown", source: "" };
  try {
    metadata = await readShortTermTopics(coreTopicsFile || path.join(repoRoot, CORE_TOPICS_FILE));
    content = renderActionFeedbackDraft({ week, ...metadata });
  } catch (error) {
    content = renderActionFeedbackDraft({ week, topics: [] });
    metadata.error = error.message;
  }
  if (visibleCharCount(content) > MAX_REPORT_CHARS) throw new Error(`Action Feedback 模板超过 ${MAX_REPORT_CHARS} 字：${visibleCharCount(content)}`);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(target, content, "utf8");
  return { ...metadata, path: target, status: metadata.error ? "needs_review" : "created" };
}

export function parseActionFeedbackTable(markdown) {
  const rows = [];
  let currentTopic = "";
  for (const line of String(markdown || "").split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 3 || cells[0] === "短期核心议题" || cells.every((cell) => /^[-:]+$/.test(cell))) continue;
    const topic = cells[0] || currentTopic;
    if (topic) currentTopic = topic;
    const actionCell = cells[1] || "";
    const marker = actionCell.match(/^\[( |x|X)\]\s*(.*)$/);
    const action = (marker ? marker[2] : actionCell).trim();
    rows.push({
      topic,
      action,
      feedback: (cells[2] || "").trim(),
      confirmed: Boolean(marker && marker[1].toLowerCase() === "x"),
      raw: line.trim(),
    });
  }
  return rows;
}

export function normalizeAction(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function actionFeedbackEventKey(week, topic, action) {
  return createHash("sha256").update([week, topic, normalizeAction(action)].map((value) => String(value || "").trim()).join("\n"), "utf8").digest("hex");
}

function weekStartDatetime(week) {
  const match = String(week).match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`无效周格式：${week}`);
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const januaryFour = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(januaryFour.getTime() - ((januaryFour.getUTCDay() || 7) - 1) * 86400000 + (weekNumber - 1) * 7 * 86400000);
  return `${monday.toISOString().slice(0, 10)} 00:00:00`;
}

export function validateActionFeedbackReport(markdown, topics, week) {
  const text = String(markdown || "");
  if (!new RegExp(`^# Action Feedback 周报｜${week}$`, "m").test(text)) throw new Error(`Action Feedback 缺少目标周标题：${week}`);
  if (visibleCharCount(text) > MAX_REPORT_CHARS) throw new Error(`Action Feedback 超过 ${MAX_REPORT_CHARS} 字：${visibleCharCount(text)}`);
  const expected = [...new Set((topics || []).map((topic) => String(topic).trim()).filter(Boolean))];
  if (!expected.length) throw new Error("没有可用的短期核心议题，拒绝同步。");
  const rows = parseActionFeedbackTable(markdown);
  const expectedSet = new Set(expected);
  const present = new Set(rows.map((row) => row.topic).filter(Boolean));
  const missing = expected.filter((topic) => !present.has(topic));
  const unknown = [...present].filter((topic) => !expectedSet.has(topic));
  if (missing.length) throw new Error(`Action Feedback 缺少短期核心议题：${missing.join("、")}`);
  if (unknown.length) throw new Error(`Action Feedback 出现未在议题基线中的主题：${unknown.join("、")}`);
  return rows.map((row) => ({ ...row, week, period: weekStartDatetime(week) }));
}

export function routeConfirmedEvents(entries, existingRecords = []) {
  const plan = { updates: [], creates: [], skipped: [], failed: [] };
  const grouped = new Map();
  for (const entry of entries.filter((item) => item.confirmed)) {
    const topic = String(entry.topic || "").trim();
    const action = normalizeAction(entry.action);
    if (!topic || !action || action === "—") continue;
    const key = `${entry.week}\n${topic}\n${action}`;
    const current = grouped.get(key) || { ...entry, topic, action, feedback: "", week: entry.week, period: entry.period || weekStartDatetime(entry.week) };
    const feedback = String(entry.feedback || "").trim();
    if (feedback && feedback !== "—" && feedback !== "本周无新事项" && !current.feedback.split("；").includes(feedback)) {
      current.feedback = current.feedback ? `${current.feedback}；${feedback}` : feedback;
    }
    grouped.set(key, current);
  }
  const byKey = new Map(existingRecords.map((record) => [String(record.values["事件键"] || ""), record]));
  for (const entry of grouped.values()) {
    const eventKey = actionFeedbackEventKey(entry.week, entry.topic, entry.action);
    const fields = {
      "短期核心议题": entry.topic,
      "行动": entry.action,
      "反馈": entry.feedback || "待补充",
      "周期时间": entry.period || weekStartDatetime(entry.week),
      "事件键": eventKey,
    };
    const existing = byKey.get(eventKey);
    if (existing) plan.updates.push({ eventKey, recordId: existing.id, fields, deduped: true });
    else plan.creates.push({ eventKey, fields });
  }
  return plan;
}

// ---------- 兼容旧版 Weekly Output 解析 ----------

export function extractActionFeedbackSection(markdown) {
  const lines = String(markdown || "").split("\n");
  const headings = lines.map((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    return match ? { index, level: match[1].length, title: match[2].trim() } : null;
  }).filter(Boolean);
  const start = headings.find((heading) => heading.title.includes("行动反馈周报"));
  if (!start) return { found: false, text: "" };
  const next = headings.slice(headings.indexOf(start) + 1).find((heading) => heading.level <= start.level);
  return { found: true, text: lines.slice(start.index + 1, next?.index ?? lines.length).join("\n") };
}

function parsePairs(rest) {
  const values = {};
  for (const pair of rest.split("｜")) {
    const match = pair.match(/^([^：:]+)[：:](.*)$/);
    if (match) values[match[1].trim()] = match[2].trim();
  }
  return values;
}

export function parseActionEntries(sectionText) {
  const lines = String(sectionText || "").split("\n");
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- \[( |x)\] (.+)$/);
    if (!match) continue;
    const entry = { confirmed: match[1] === "x", raw: match[2], evidence: [] };
    const separator = match[2].indexOf("｜");
    entry.head = separator < 0 ? match[2].trim() : match[2].slice(0, separator).trim();
    const rest = separator < 0 ? "" : match[2].slice(separator + 1);
    Object.assign(entry, parsePairs(rest));
    for (let probe = index + 1; probe < lines.length; probe += 1) {
      const evidence = lines[probe].match(/^\s{2,}- 证据：(.+)$/);
      if (!evidence) break;
      entry.evidence.push(...evidence[1].split(/[、；;]/).map((item) => item.trim()).filter(Boolean));
      index = probe;
    }
    if (ACTION_ID_RE.test(entry.head)) entry.kind = "update";
    else if (entry.head === "新增") entry.kind = "create";
    else if (entry.head.includes("可能对应")) entry.kind = "unresolved";
    else entry.kind = "unknown";
    entries.push(entry);
  }
  return entries;
}

// ---------- 条目路由（纯函数，供测试） ----------

export function routeConfirmedEntries(entries, existingRecords = []) {
  const byId = new Map(existingRecords.map((record) => [String(record.values["行动 ID"] || ""), record]));
  const plan = { updates: [], creates: [], skipped: [], failed: [] };
  for (const entry of entries.filter((item) => item.confirmed)) {
    const action = String(entry["行动"] || "").trim();
    const status = String(entry["状态"] || "").trim();
    const feedbackType = String(entry["反馈类型"] || "").trim();
    const feedback = String(entry["反馈"] || "").trim() || "待确认";
    if (entry.kind === "unresolved") {
      plan.skipped.push({ head: entry.head, reason: "仍标注「可能对应已有行动」，需先改为引用行动 ID 或确认新增" });
      continue;
    }
    if (entry.kind === "unknown") {
      plan.skipped.push({ head: entry.head, reason: "条目头不是行动 ID 或「新增」" });
      continue;
    }
    if (!action) {
      plan.failed.push({ head: entry.head, reason: "缺少「行动」正文" });
      continue;
    }
    if (feedbackType && feedbackType !== "待确认" && !FEEDBACK_TYPES.includes(feedbackType)) {
      plan.failed.push({ head: entry.head, reason: `反馈类型非法：${feedbackType}（只接受 外部/系统/内部，证据不足写 待确认）` });
      continue;
    }
    const base = {
      "行动": action,
      "核心反馈": feedback,
      "下一步": String(entry["下一步"] || "").trim(),
      "来源证据": entry.evidence.join("；"),
      ...(FEEDBACK_TYPES.includes(feedbackType) ? { "反馈类型": feedbackType } : {}),
    };
    if (entry.kind === "update") {
      const record = byId.get(entry.head);
      if (!record) {
        plan.failed.push({ head: entry.head, reason: "Base 中不存在该行动 ID" });
        continue;
      }
      if (!STATUS_TO_BASE[status]) {
        plan.failed.push({ head: entry.head, reason: `状态缺失或非法：${status || "（空）"}（继续/完成/停止）` });
        continue;
      }
      plan.updates.push({ actionId: entry.head, recordId: record.id, fields: { ...base, "状态": STATUS_TO_BASE[status], "最近复盘周期": entry.week } });
    } else {
      // 幂等去重：同一周期已存在相同行动正文时按更新处理，不得重复创建。
      const existing = existingRecords.find((record) => String(record.values["来源周期"] || "") === entry.week && String(record.values["行动"] || "").trim() === action);
      if (existing) {
        const fields = { ...base, "最近复盘周期": entry.week };
        if (STATUS_TO_BASE[status]) fields["状态"] = STATUS_TO_BASE[status];
        plan.updates.push({ actionId: String(existing.values["行动 ID"] || ""), recordId: existing.id, fields, deduped: true });
      } else {
        plan.creates.push({ fields: { ...base, "最近复盘周期": entry.week } });
      }
    }
  }
  return plan;
}

function entryWeek(entries, fallbackWeek) {
  for (const entry of entries) entry.week = fallbackWeek;
  return entries;
}

// ---------- collect ----------

export function isOpenAction(record) {
  return String(record.values["状态"] || "") === "continue";
}

export function renderOpenActions({ week, records, baseUrl, readAt }) {
  const sorted = records.filter(isOpenAction).sort((a, b) => String(a.values["行动 ID"] || "").localeCompare(String(b.values["行动 ID"] || "")));
  return [
    `# Action Feedback 回捞｜${week}`,
    "",
    "- 来源：Learn-X Action Feedback Base（Actions 表）",
    `- Base：${baseUrl || "（未取得链接）"}`,
    `- 读取时间：${readAt}`,
    `- 目标周：${week}`,
    `- 未闭环行动数：${sorted.length}`,
    "- 说明：以下为本周期开始时全部 continue 状态核心行动；逐条结合本周材料草拟结果、反馈与下一步，确认后进入周报「行动反馈周报」。0 条表示当前没有待回捞行动。",
    "",
    "## 未闭环行动",
    "",
    ...sorted.map((record) => {
      const values = record.values;
      const type = values["反馈类型"] ? `（反馈类型：${values["反馈类型"]}）` : "";
      return `- ${values["行动 ID"]}｜行动：${values["行动"] || ""}｜状态：${values["状态"] || "continue"}｜上次反馈：${values["核心反馈"] || "待确认"}${type}｜下一步：${values["下一步"] || "（无）"}｜来源周期：${values["来源周期"] || ""}`;
    }),
    "",
  ].join("\n");
}

async function cmdCollect({ week }) {
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  const target = path.join(weekRoot, "open-actions.md");
  const finish = async (status, summary, count) => {
    await updateWeeklySourceStatus({ weekRoot, week, source: "open-actions", status, file: "open-actions.md", count, summary, preservedStaleFile: await fileExists(target) });
    return { ok: status !== "failed", command: "collect", week, status, count, summary };
  };
  try {
    const pinned = await resolvePinned({ baseToken: process.env.LEARN_X_ACTION_BASE_TOKEN || "", tableId: process.env.LEARN_X_ACTION_TABLE_ID || "" }, LEGACY_BASE_FIELD_SCHEMA);
    let config = pinned;
    if (!config) {
      const tokens = await findBaseTokens();
      if (tokens.length > 1) return await finish("unavailable", `发现多个同名 Base，需人工指定 LEARN_X_ACTION_BASE_TOKEN：${tokens.join("、")}`, 0);
      if (tokens.length === 0) return await finish("unavailable", "Action Feedback Base 不存在；首次阶段 3 确认行动后自动创建", 0);
      const tableId = await findTableId(tokens[0]);
      if (!tableId) return await finish("unavailable", "Base 中不存在 Actions 表", 0);
      config = { baseToken: tokens[0], tableId };
    }
    const records = await listRecords(config, LEGACY_REQUIRED_FIELDS);
    const open = records.filter(isOpenAction);
    if (!open.length) return await finish("empty", "0 条未闭环行动，文件未生成", 0);
    await mkdir(weekRoot, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, renderOpenActions({ week, records: open, baseUrl: `https://ywhome.feishu.cn/base/${config.baseToken}?table=${config.tableId}`, readAt: new Date().toISOString() }), "utf8");
    await rename(temp, target);
    return await finish("ready", `已回捞 ${open.length} 条未闭环核心行动`, open.length);
  } catch (error) {
    return await finish("failed", `采集失败：${error.message}`, 0);
  }
}

// ---------- sync ----------

async function cmdSync({ week }) {
  const outputFile = path.join(repoRoot, "04_output/_dist/weekly", week, ACTION_FEEDBACK_REPORT);
  let markdown;
  try {
    markdown = await readFile(outputFile, "utf8");
  } catch (error) {
    return { ok: false, command: "sync", week, reason: `Action Feedback 周报不存在：${path.relative(repoRoot, outputFile)}` };
  }
  let topicConfig;
  let entries;
  try {
    topicConfig = await readShortTermTopics();
    entries = validateActionFeedbackReport(markdown, topicConfig.topics, week);
  } catch (error) {
    const report = { ok: false, command: "sync", week, output: path.relative(repoRoot, outputFile), reason: error.message };
    await appendSyncLog(report);
    return report;
  }
  const report = {
    ok: true, command: "sync", week, output: path.relative(repoRoot, outputFile),
    topics: topicConfig.topics, candidates: entries.length, confirmed: entries.filter((entry) => entry.confirmed && entry.action && entry.action !== "—").length,
    created: [], updated: [], skipped: [], failed: [],
  };
  if (!report.confirmed) report.reason = "没有已勾选（[x]）且包含行动的行动反馈条目";
  if (!report.confirmed) {
    await appendSyncLog(report);
    return report;
  }
  try {
    const config = await ensureResources({ baseToken: process.env.LEARN_X_ACTION_BASE_TOKEN || "", tableId: process.env.LEARN_X_ACTION_TABLE_ID || "" });
    const existing = await listRecords(config);
    const plan = routeConfirmedEvents(entries, existing);
    report.skipped.push(...plan.skipped);
    report.failed.push(...plan.failed);
    for (const item of plan.updates) report.updated.push({ eventKey: item.eventKey, deduped: Boolean(item.deduped), recordId: (await upsertEvent(config, item.fields, item.recordId, item.eventKey)).id });
    for (const item of plan.creates) report.created.push({ eventKey: item.eventKey, recordId: (await upsertEvent(config, item.fields, "", item.eventKey)).id });
  } catch (error) {
    const failed = { ...report, ok: false, error: error.message };
    await appendSyncLog(failed);
    return failed;
  }
  await appendSyncLog(report);
  return report;
}

async function appendSyncLog(report) {
  const dir = path.join(repoRoot, SYNC_LOG_DIR);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, SYNC_LOG_FILE), `${JSON.stringify({
    at: new Date().toISOString(), week: report.week, candidates: report.candidates, confirmed: report.confirmed,
    created: report.created?.length || 0, updated: report.updated?.length || 0, skipped: report.skipped?.length || 0, failed: report.failed?.length || 0,
    ok: report.ok,
  })}\n`, "utf8");
}

// ---------- CLI ----------

function usage() {
  return [
    "用法：",
    "  npm run action:feedback -- sync --week YYYY-Www      # 独立 Action Feedback 周报 -> Base 事件",
    "  npm run action:feedback -- migrate                  # 只新增缺失的事件字段（需明确执行）",
    "  npm run action:feedback -- collect --week YYYY-Www  # 旧流程兼容，不再是默认周流程",
    "",
    "可选 token 覆盖：LEARN_X_ACTION_BASE_TOKEN、LEARN_X_ACTION_TABLE_ID",
  ].join("\n");
}

async function main(argv) {
  const [command] = argv;
  if (command !== "collect" && command !== "sync" && command !== "migrate") {
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  let week = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") week = argv[index + 1] || "";
  }
  if (command === "migrate") {
    const report = await cmdMigrate();
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  week = normalizeWeek(week || defaultWeeklyReviewWeek());
  const report = command === "collect" ? await cmdCollect({ week }) : await cmdSync({ week });
  console.log(JSON.stringify(report, null, 2));
  if (report.ok === false) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

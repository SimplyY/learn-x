import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BASE_TOKEN = "W6NLbDh1YahvZ9sbjIccEirBnae";
export const ISSUE_TABLE = "tbllcm6oBbdMKnkN";
export const EVENT_TABLE = "tblIE9FK9mWGv7GE";
export const ZONE = "Asia/Shanghai";

export const ISSUE_FIELDS = [
  "议题", "议题编号", "类型", "状态", "阶段", "年度", "为什么重要", "当前判断", "判断置信度",
  "最大未知", "改变判断的条件", "下一步", "决策截止时间", "可逆性", "复盘频率", "下次复盘日期",
  "上次复盘推送时间", "智慧时效性", "回顾状态", "已推送轮次", "上次推送时间", "创建时间", "更新时间"
];
export const EVENT_FIELDS = [
  "内容摘要", "详细内容", "事件摘要", "事件编号", "关联议题", "事件时间", "事件类型", "证据方向", "发生了什么", "认知增量",
  "变更前", "变更后", "变化后置信度", "来源系统", "来源标识", "来源链接", "创建时间", "更新时间"
];

const ISSUE_TYPES = new Set(["长期问题", "年度重点", "重大决策"]);
const ISSUE_STATES = new Set(["候选", "活跃", "休眠", "关闭"]);
const FREQUENCIES = new Set(["每周", "每月", "每季度", "按截止时间", "手动"]);
const SELECT_OPTIONS = new Map([
  ["类型", ["长期问题", "年度重点", "重大决策"]],
  ["状态", ["候选", "活跃", "休眠", "关闭"]],
  ["阶段", ["探索", "形成判断", "待决策", "行动中", "等待结果", "校准"]],
  ["可逆性", ["可逆", "部分可逆", "不可逆"]],
  ["复盘频率", ["每周", "每月", "每季度", "按截止时间", "手动"]],
  ["智慧时效性", ["短期", "中期", "长期", "永恒"]],
  ["回顾状态", ["待首推", "进行中", "已完成", "暂停"]],
  ["事件类型", ["证据", "判断更新", "类型变化", "状态变化", "决策", "行动或实验", "现实结果", "校准", "问题重构"]],
  ["证据方向", ["支持", "反对", "约束", "结果", "未知"]],
  ["来源系统", ["Learn-X", "Voice-X", "Research-X", "Read-X", "Doing-X", "现实经历", "其他"]],
]);

export async function runLark(args) {
  const { stdout } = await execFileAsync("lark-cli", args, {
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败");
  return result;
}

function scalar(value) {
  if (Array.isArray(value)) return value.length ? scalar(value[0]) : "";
  if (value && typeof value === "object") return value.name || value.text || value.url || value.id || "";
  return value == null ? "" : value;
}

function text(value) {
  return String(scalar(value) || "").trim();
}

function parseDate(value, label) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${label}无效：${value}`);
    return value;
  }
  const raw = String(value);
  const normalized = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}+08:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}无效：${value}`);
  return date;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function nextReviewDate(issue, deliveredAt) {
  const frequency = text(issue["复盘频率"]);
  const now = parseDate(deliveredAt, "送达时间") || new Date();
  if (frequency === "每周" || frequency === "按截止时间") {
    const next = new Date(now.getTime() + 7 * 86400000);
    const deadline = parseDate(issue["决策截止时间"], "决策截止时间");
    return frequency === "按截止时间" && deadline && next > deadline ? deadline : next;
  }
  if (frequency === "每月") return addMonths(now, 1);
  if (frequency === "每季度") return addMonths(now, 3);
  return null;
}

function expectedType(name) {
  if (["议题", "为什么重要", "当前判断", "最大未知", "改变判断的条件", "下一步", "内容摘要", "详细内容", "事件摘要", "发生了什么", "认知增量", "变更前", "变更后", "来源标识", "来源链接"].includes(name)) return "text";
  if (["关联议题", "相关议题", "认知事件"].includes(name)) return "link";
  if (["议题编号", "事件编号"].includes(name)) return "auto_number";
  if (["年度", "判断置信度", "已推送轮次", "变化后置信度"].includes(name)) return "number";
  if (["决策截止时间", "下次复盘日期", "上次复盘推送时间", "上次推送时间", "事件时间"].includes(name)) return "datetime";
  if (["创建时间"].includes(name)) return "created_at";
  if (["更新时间"].includes(name)) return "updated_at";
  return "select";
}

export function validateFieldContract(fields, required) {
  const byName = new Map(fields.map((field) => [field.name, field]));
  const missing = required.filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`Base 字段缺失：${missing.join("、")}`);
  const wrong = required.filter((name) => expectedType(name) !== byName.get(name).type);
  if (wrong.length) throw new Error(`Base 字段类型不匹配：${wrong.map((name) => `${name}=${byName.get(name).type}`).join("、")}`);
  const optionDrift = required.flatMap((name) => {
    const expected = SELECT_OPTIONS.get(name);
    if (!expected) return [];
    const actual = (byName.get(name).options || []).map((option) => option.name).filter(Boolean);
    const multiple = byName.get(name).multiple === true;
    return !multiple && actual.length === expected.length && expected.every((value) => actual.includes(value)) ? [] : [`${name}=[${actual.join("、")}]${multiple ? "（不应为多选）" : ""}`];
  });
  if (optionDrift.length) throw new Error(`Base 单选项不匹配：${optionDrift.join("；")}`);
  return fields;
}

export async function assertSchema(tableId, required) {
  const result = await runLark(["base", "+field-list", "--base-token", BASE_TOKEN, "--table-id", tableId, "--limit", "100", "--as", "user", "--format", "json"]);
  return validateFieldContract(result.data?.fields || [], required);
}

async function listRecords(tableId, fields, conditions = []) {
  const rows = [];
  let offset = 0;
  while (true) {
    const args = ["base", "+record-list", "--base-token", BASE_TOKEN, "--table-id", tableId, "--limit", "200", "--offset", String(offset), "--as", "user", "--format", "json", ...fields.flatMap((field) => ["--field-id", field])];
    if (conditions.length) args.push("--filter-json", JSON.stringify({ logic: "and", conditions }));
    const result = await runLark(args);
    const data = result.data || {};
    const names = data.fields || fields;
    const values = data.data || [];
    rows.push(...values.map((row, index) => ({
      recordId: data.record_id_list?.[index],
      values: Object.fromEntries(names.map((name, column) => [name, row[column]])),
    })));
    if (!data.has_more) return rows;
    if (!values.length) throw new Error("Base 分页 has_more=true 但没有新增记录");
    offset += values.length;
  }
}

export function validateIssue(raw) {
  const issue = Object.fromEntries(ISSUE_FIELDS.map((field) => [field, raw.values[field]]));
  const type = text(issue["类型"]);
  const state = text(issue["状态"]);
  const frequency = text(issue["复盘频率"]);
  if (!text(issue["议题编号"]) || !text(issue["议题"])) throw new Error(`议题记录缺少编号或正文：${raw.recordId}`);
  if (!ISSUE_TYPES.has(type)) throw new Error(`${text(issue["议题编号"])} 类型无效：${type}`);
  if (!ISSUE_STATES.has(state)) throw new Error(`${text(issue["议题编号"])} 状态无效：${state}`);
  if (!FREQUENCIES.has(frequency)) throw new Error(`${text(issue["议题编号"])} 复盘频率无效：${frequency}`);
  if (frequency === "按截止时间" && !parseDate(issue["决策截止时间"], `${text(issue["议题编号"])} 决策截止时间`)) throw new Error(`${text(issue["议题编号"])} 使用按截止时间复盘时必须设置决策截止时间`);
  const confidence = issue["判断置信度"] == null || issue["判断置信度"] === "" ? null : Number(scalar(issue["判断置信度"]));
  if (confidence != null && (!Number.isInteger(confidence) || confidence < 0 || confidence > 10)) throw new Error(`${text(issue["议题编号"])} 置信度必须是 0-10 整数`);
  return { ...issue, recordId: raw.recordId, confidence };
}

function dueDate(issue) {
  const explicit = parseDate(issue["下次复盘日期"], `${text(issue["议题编号"])} 下次复盘日期`);
  if (explicit) return explicit;
  const last = parseDate(issue["上次复盘推送时间"], `${text(issue["议题编号"])} 上次复盘推送时间`) || parseDate(issue["创建时间"], `${text(issue["议题编号"])} 创建时间`);
  if (!last) return null;
  const frequency = text(issue["复盘频率"]);
  if (frequency === "每周" || frequency === "按截止时间") return new Date(last.getTime() + 7 * 86400000);
  if (frequency === "每月") return addMonths(last, 1);
  if (frequency === "每季度") return addMonths(last, 3);
  return null;
}

export function selectDueIssues(issues, mode, now = new Date(), id = null) {
  const normalizedId = id ? String(id).toUpperCase() : null;
  if (mode === "single" || mode === "chat-pack") {
    const selected = issues.find((issue) => text(issue["议题编号"]).toUpperCase() === normalizedId);
    if (!selected) throw new Error(`未找到议题：${id}`);
    if (text(selected["状态"]) === "关闭") throw new Error(`${id} 已关闭，不能复盘`);
    return [selected];
  }
  return issues.filter((issue) => {
    if (text(issue["状态"]) !== "活跃") return false;
    const frequency = text(issue["复盘频率"]);
    const deadline = parseDate(issue["决策截止时间"], "决策截止时间");
    if (frequency === "按截止时间" && deadline && deadline < now) return false;
    const deadlineDelta = deadline ? deadline.getTime() - now.getTime() : null;
    const deadlineWindow = text(issue["类型"]) === "重大决策" && deadlineDelta != null && deadlineDelta >= 0 && deadlineDelta <= 14 * 86400000;
    if (mode === "weekly" && !["每周", "按截止时间"].includes(frequency)) {
      if (!deadlineWindow) return false;
    }
    if (mode === "monthly" && !["每月", "每季度"].includes(frequency)) return false;
    if (deadlineWindow && mode === "weekly") return true;
    const due = dueDate(issue);
    if (due && due > now) return false;
    return true;
  }).sort((a, b) => (dueDate(a)?.getTime() || 0) - (dueDate(b)?.getTime() || 0) || text(a["议题编号"]).localeCompare(text(b["议题编号"])));
}

async function eventsForIssue(issue) {
  return listRecords(EVENT_TABLE, EVENT_FIELDS, [["关联议题", "intersects", [{ id: issue.recordId }]]]);
}

function eventPayload(raw) {
  return Object.fromEntries(EVENT_FIELDS.map((field) => [field, raw.values[field]]));
}

export function consistencyWarnings(issue, events) {
  const warnings = [];
  const latest = (type) => [...events].reverse().find((event) => text(event["事件类型"]) === type);
  const judgmentEvent = latest("判断更新");
  const currentJudgment = text(issue["当前判断"]);
  if (currentJudgment && !judgmentEvent) warnings.push("当前判断已有内容，但没有对应的“判断更新”事件");
  if (judgmentEvent && text(judgmentEvent["变更后"]) && text(judgmentEvent["变更后"]) !== currentJudgment) warnings.push("当前判断与最近“判断更新”事件的变更后内容不一致");
  const typeEvent = latest("类型变化");
  if (typeEvent && text(typeEvent["变更后"]) && text(typeEvent["变更后"]) !== text(issue["类型"])) warnings.push("当前类型与最近“类型变化”事件的变更后内容不一致");
  const stateEvent = latest("状态变化");
  if (stateEvent && text(stateEvent["变更后"]) && text(stateEvent["变更后"]) !== text(issue["状态"])) warnings.push("当前状态与最近“状态变化”事件的变更后内容不一致");
  return warnings;
}

function display(value) {
  return value == null || String(value).trim() === "" ? "未填写" : String(value).trim();
}

function eventSource(event) {
  const values = [text(event["来源系统"]), text(event["来源标识"]), text(event["来源链接"])].filter(Boolean);
  return values.length ? `（来源：${values.join(" / ")}）` : "（来源未填写）";
}

function renderEvent(event) {
  const date = text(event["事件时间"]);
  const when = date ? `${date} ` : "";
  const metadata = [text(event["事件类型"]), text(event["证据方向"])].filter(Boolean).join(" / ");
  const prefix = metadata ? `${metadata}：` : "";
  const summary = text(event["内容摘要"]) || text(event["事件摘要"]) || text(event["发生了什么"]) || "未填写";
  const detail = text(event["详细内容"]);
  const detailSuffix = detail && detail !== summary ? `；详细内容：${detail}` : "";
  const increment = text(event["认知增量"]);
  return `- ${when}${prefix}${summary}${detailSuffix}${increment ? `；认知增量：${increment}` : ""}${eventSource(event)}`;
}

/**
 * Render a provenance-preserving Chat Pack without model-authored facts.
 * The surrounding Skill may add reasoning prompts, but this section is a
 * deterministic projection of Base fields and the five most recent events.
 */
export function renderChatPack(review) {
  if (!review || review.dossiers?.length !== 1) throw new Error("Chat Pack 必须且只能对应一个议题");
  const dossier = review.dossiers[0];
  const issue = dossier.issue;
  const events = dossier.recentEvents || [];
  const evidence = events.filter((event) => text(event["事件类型"]) === "证据");
  const support = evidence.filter((event) => text(event["证据方向"]) === "支持");
  const counter = evidence.filter((event) => text(event["证据方向"]) === "反对");
  const actions = events.filter((event) => ["决策", "行动或实验"].includes(text(event["事件类型"])));
  const outcomes = events.filter((event) => ["现实结果", "校准"].includes(text(event["事件类型"])));
  const questions = [
    `问题背后的问题 1：这个问题最大的未知是什么？（当前记录：${display(issue.unknown)}）`,
    `问题背后的问题 2：什么事实出现会改变判断？（当前记录：${display(issue.changeConditions)}）`,
    `问题背后的问题 3：下一项最小现实实验是什么？（当前记录：${display(issue.nextStep)}）`,
  ];
  const lines = [
    `# ${issue.id} Chat Pack`,
    "",
    "## 问题背景与重要性",
    `- 问题：${display(issue.question)}`,
    `- 类型 / 阶段：${display(issue.type)} / ${display(issue.stage)}`,
    `- 为什么重要：${display(issue.importance)}`,
    "",
    "## 当前判断",
    `- 判断：${display(issue.judgment)}`,
    `- 置信度：${issue.confidence == null ? "未填写" : issue.confidence}/10`,
    "",
    "## 关键转折事件",
    ...(events.length ? events.map(renderEvent) : ["- 未记录认知事件"]),
    "",
    "## 支持证据与反证",
    `- 支持：${support.length ? support.map(renderEvent).join("\n") : "未记录"}`,
    `- 反证：${counter.length ? counter.map(renderEvent).join("\n") : "未记录"}`,
    "",
    "## 最大未知与改变判断的条件",
    `- 最大未知：${display(issue.unknown)}`,
    `- 改变判断的条件：${display(issue.changeConditions)}`,
    "",
    "## 期限、可逆性与现实约束",
    `- 决策截止时间：${display(issue.deadline)}`,
    `- 可逆性：${display(issue.reversibility)}`,
    "- 其他现实约束：未记录（不从环境上下文推断）",
    "",
    "## 已有行动、结果与校准",
    `- 行动 / 决策：${actions.length ? actions.map(renderEvent).join("\n") : "未记录"}`,
    `- 现实结果 / 校准：${outcomes.length ? outcomes.map(renderEvent).join("\n") : "未记录"}`,
    "",
    "## 问题背后的问题",
    ...questions.map((question) => `- ${question}`),
    "",
    "## 请 ChatGPT 解决的具体任务",
    "只基于以上已核验内容进行推理；不要补全未填写的个人事实。请提出 3 个候选判断，并为每个候选列出支持条件、最强反证、需要获得的证据和一个可逆的最小现实实验。",
  ];
  return lines.join("\n");
}

export async function buildReview(mode, { now = new Date(), id = null } = {}) {
  await assertSchema(ISSUE_TABLE, ISSUE_FIELDS);
  await assertSchema(EVENT_TABLE, EVENT_FIELDS);
  const rawIssues = await listRecords(ISSUE_TABLE, ISSUE_FIELDS);
  const issues = rawIssues.map(validateIssue);
  const selected = selectDueIssues(issues, mode, now, id);
  const dossiers = [];
  for (const issue of selected) {
    const rawEvents = await eventsForIssue(issue);
    const events = rawEvents.map(eventPayload).sort((a, b) => (parseDate(a["事件时间"], "事件时间")?.getTime() || 0) - (parseDate(b["事件时间"], "事件时间")?.getTime() || 0));
    const lastReview = parseDate(issue["上次复盘推送时间"], `${text(issue["议题编号"])} 上次复盘推送时间`);
    const incremental = events.filter((event) => {
      const at = parseDate(event["事件时间"], "事件时间");
      return at && (!lastReview || at > lastReview);
    });
    dossiers.push({
      issue: {
        recordId: issue.recordId,
        id: text(issue["议题编号"]),
        question: text(issue["议题"]),
        type: text(issue["类型"]),
        state: text(issue["状态"]),
        stage: text(issue["阶段"]),
        importance: text(issue["为什么重要"]),
        judgment: text(issue["当前判断"]),
        confidence: issue.confidence,
        unknown: text(issue["最大未知"]),
        changeConditions: text(issue["改变判断的条件"]),
        nextStep: text(issue["下一步"]),
        deadline: text(issue["决策截止时间"]),
        reversibility: text(issue["可逆性"]),
        frequency: text(issue["复盘频率"]),
        lastReview: issue["上次复盘推送时间"] || "",
      },
      incrementalEvents: incremental,
      recentEvents: events.slice(-5),
      consistencyWarnings: consistencyWarnings(issue, events),
    });
  }
  const activeIssues = issues.filter((issue) => text(issue["状态"]) === "活跃");
  const countBy = (field) => Object.fromEntries(Object.entries(activeIssues.reduce((counts, issue) => {
    const value = text(issue[field]);
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
  const annualCount = activeIssues.filter((issue) => text(issue["类型"]) === "年度重点").length;
  const snapshotPayload = {
    schemaVersion: 1,
    mode,
    annualFocusCount: annualCount,
    annualFocusOverLimit: annualCount > 3,
    portfolio: { activeCount: activeIssues.length, activeByType: countBy("类型"), activeByStage: countBy("阶段") },
    dossiers,
  };
  const snapshot = createHash("sha256").update(JSON.stringify(snapshotPayload)).digest("hex");
  return { ...snapshotPayload, generatedAt: now.toISOString(), snapshot };
}

function dateForWrite(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace("T", " ");
}

export function deliveryPatch(issue, deliveredAt) {
  const at = parseDate(deliveredAt, "送达时间");
  const next = nextReviewDate(issue, at);
  const patch = { "上次复盘推送时间": dateForWrite(at) };
  if (next) patch["下次复盘日期"] = dateForWrite(next);
  return patch;
}

export function validateDeliveryReadback(values, patch) {
  for (const [field, expected] of Object.entries(patch)) {
    const actual = values[field];
    if (field === "上次复盘推送时间" || field === "下次复盘日期") {
      const expectedDate = parseDate(expected, field);
      const actualDate = parseDate(actual, field);
      if (!actualDate || actualDate.getTime() !== expectedDate.getTime()) throw new Error(`Base 回写读回不一致：${field}`);
    } else if (text(actual) !== text(expected)) {
      throw new Error(`Base 回写读回不一致：${field}`);
    }
  }
  return true;
}

async function readDeliveryFields(recordId, fields) {
  const result = await runLark([
    "base", "+record-get", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--record-id", recordId,
    "--as", "user", "--format", "json", ...fields.flatMap((field) => ["--field-id", field]),
  ]);
  const data = result.data || {};
  const names = data.fields || fields;
  const row = data.data?.[0];
  if (!row) throw new Error(`Base 回写读回缺少议题记录：${recordId}`);
  return Object.fromEntries(names.map((name, index) => [name, row[index]]));
}

export async function markDelivered(mode, snapshot, options = {}) {
  if (!snapshot) throw new Error("--mark-delivered 必须提供 --snapshot");
  const deliveredAt = options.deliveredAt ? parseDate(options.deliveredAt, "送达时间") : new Date();
  const review = await buildReview(mode, { now: deliveredAt, id: options.id || null });
  if (review.snapshot !== snapshot) throw new Error("复盘快照已变化，拒绝回写，请重新生成");
  for (const dossier of review.dossiers) {
    const patch = deliveryPatch(dossier.issue, deliveredAt);
    await runLark(["base", "+record-upsert", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--record-id", dossier.issue.recordId, "--json", JSON.stringify(patch), "--as", "user", "--format", "json"]);
    validateDeliveryReadback(await readDeliveryFields(dossier.issue.recordId, Object.keys(patch)), patch);
  }
  return { updated: review.dossiers.map((dossier) => dossier.issue.id), deliveredAt: deliveredAt.toISOString(), snapshot };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") result.mode = argv[++index];
    else if (arg === "--id") result.id = argv[++index];
    else if (arg === "--snapshot") result.snapshot = argv[++index];
    else if (arg === "--delivered-at") result.deliveredAt = argv[++index];
    else if (arg === "--format") result.format = argv[++index];
    else if (arg === "--mark-delivered") result.markDelivered = true;
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!["weekly", "monthly", "single", "chat-pack"].includes(args.mode)) throw new Error("--mode 必须是 weekly、monthly、single 或 chat-pack");
  if (["single", "chat-pack"].includes(args.mode) && !args.id) throw new Error(`${args.mode} 必须提供 --id`);
  if (args.format && !["json", "markdown"].includes(args.format)) throw new Error("--format 必须是 json 或 markdown");
  if (args.format === "markdown" && args.mode !== "chat-pack") throw new Error("只有 chat-pack 支持 --format markdown");
  const result = args.markDelivered ? await markDelivered(args.mode, args.snapshot, { id: args.id, deliveredAt: args.deliveredAt }) : await buildReview(args.mode, { id: args.id });
  process.stdout.write(args.format === "markdown" ? `${renderChatPack(result)}\n` : `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const BASE_TOKEN = "W6NLbDh1YahvZ9sbjIccEirBnae";
export const ISSUE_TABLE = "tbllcm6oBbdMKnkN";
export const EVENT_TABLE = "tblIE9FK9mWGv7GE";
export const LEDGER_NAME = "月度核心议题研究";
export const AUDIT_VIEW_NAME = "月度核心议题审计";
export const ISSUE_FIELDS = ["议题编号", "议题", "类型", "状态", "阶段", "议题周期", "优先级", "研究状态", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步", "决策截止时间", "创建时间", "更新时间"];
export const EVENT_FIELDS = ["事件编号", "关联议题", "事件类型", "内容摘要", "详细内容", "认知增量", "变更前", "变更后", "变化后置信度", "来源系统", "来源标识", "来源链接", "有效性", "来源月度研究", "创建时间", "更新时间"];
export const MUTABLE_FIELDS = new Set(["议题周期", "优先级", "研究状态", "阶段", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步"]);
export const EVENT_TYPES = new Set(["证据", "判断更新", "问题重构", "决策", "行动或实验", "现实结果", "校准"]);
const PRIORITIES = ["P0", "P1", "P2"];
const HORIZONS = ["短期核心问题", "中期核心问题", "长期核心问题"];
const RESEARCH_STATES = ["继续研究", "暂缓研究", "关闭研究"];
const STAGES = ["探索", "形成判断", "待决策", "行动中", "等待结果", "校准"];
const LEDGER_FIELDS = ["研究月份", "候选议题", "选定议题", "候选顺序", "研究文档", "流程状态", "当前提交标识", "当前文档哈希", "审计历史", "解析摘要", "创建时间", "更新时间"];

export const text = (value) => String(Array.isArray(value) ? value[0] ?? "" : value?.name ?? value?.text ?? value ?? "").trim();
export const linkIds = (value) => (Array.isArray(value) ? value : [value]).map((item) => String(item?.id ?? item?.record_id ?? item ?? "")).filter(Boolean);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const iso = (value) => { const date = value && new Date(value); return date && !Number.isNaN(date.getTime()) ? date : null; };
const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const effectivePriority = (issue) => PRIORITIES.includes(text(issue["优先级"])) ? text(issue["优先级"]) : "P1";
const effectiveHorizon = (issue) => HORIZONS.includes(text(issue["议题周期"])) ? text(issue["议题周期"]) : "未分类";
const effectiveResearchState = (issue) => RESEARCH_STATES.includes(text(issue["研究状态"])) ? text(issue["研究状态"]) : "继续研究";
const priorityIndex = (issue) => PRIORITIES.indexOf(effectivePriority(issue));
const horizonIndex = (issue) => { const index = HORIZONS.indexOf(effectiveHorizon(issue)); return index < 0 ? HORIZONS.length : index; };
const same = (a, b) => text(a) === text(b);
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function monthEnd(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份必须是 YYYY-MM");
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1, 2)); // next month, 10:00 Asia/Shanghai
}

function acquireLock(month) {
  const lock = path.join(os.tmpdir(), `learn-x-workbench-${month}.lock`);
  const take = () => { const fd = fs.openSync(lock, "wx"); fs.writeSync(fd, `${process.pid}\n`); return fd; };
  try { return { fd: take(), lock }; } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let ownerAlive = false;
    try { const pid = Number(fs.readFileSync(lock, "utf8").trim()); if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); ownerAlive = true; } } catch { ownerAlive = false; }
    if (ownerAlive) throw new Error("同一月份已有进行中的提交，请等待其完成后再重试");
    try { fs.unlinkSync(lock); } catch { /* stale lock removal is best effort */ }
    return { fd: take(), lock };
  }
}

export function rankIssues(issues, events, month, ledgers = []) {
  const deadline = monthEnd(month);
  const lastAttention = new Map();
  for (const event of events) {
    if (["已撤回"].includes(text(event["有效性"]))) continue;
    const at = iso(event["更新时间"]) || iso(event["创建时间"]);
    for (const id of linkIds(event["关联议题"])) if (at && (!lastAttention.has(id) || lastAttention.get(id) < at)) lastAttention.set(id, at);
  }
  for (const ledger of ledgers) {
    if (text(ledger["流程状态"]) !== "已提交") continue;
    const at = iso(ledger["更新时间"]) || iso(ledger["创建时间"]);
    for (const id of linkIds(ledger["选定议题"])) if (at && (!lastAttention.has(id) || lastAttention.get(id) < at)) lastAttention.set(id, at);
  }
  return issues.filter((issue) => text(issue["状态"]) === "活跃" && effectiveResearchState(issue) === "继续研究").sort((a, b) => {
    const urgent = (issue) => text(issue["类型"]) === "重大决策" && iso(issue["决策截止时间"]) && iso(issue["决策截止时间"]) >= new Date() && iso(issue["决策截止时间"]) < deadline;
    const au = urgent(a); const bu = urgent(b);
    if (au !== bu) return au ? -1 : 1;
    if (au) return iso(a["决策截止时间"]) - iso(b["决策截止时间"]) || priorityIndex(a) - priorityIndex(b);
    const attention = (issue) => lastAttention.get(issue.recordId) || iso(issue["创建时间"]) || new Date(0);
    return horizonIndex(a) - horizonIndex(b) || priorityIndex(a) - priorityIndex(b) || attention(a) - attention(b) || text(a["议题编号"]).localeCompare(text(b["议题编号"]));
  }).slice(0, 5).map((issue, index) => ({ ...issue, position: index + 1 }));
}

export function recommendationReason(issue, month) {
  const deadline = iso(issue["决策截止时间"]);
  if (text(issue["类型"]) === "重大决策" && deadline && deadline < monthEnd(month)) return `重大决策将在 ${deadline.toISOString().slice(0, 10)} 前到期`;
  return `${effectiveHorizon(issue)}｜${effectivePriority(issue)}｜${text(issue["更新时间"]) ? "等待重新进入注意力" : "尚未获得明确注意力记录"}`;
}

export function parseSelection(input, candidates, allIssues) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("请选择候选议题");
  const quoted = [...raw.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]);
  const explicitTitles = allIssues.filter((issue) => text(issue["议题"]) && raw.includes(text(issue["议题"])));
  const tailMatch = raw.match(/(?:再加|加入|加上)\s*([^，。；;]+)$/);
  const tail = tailMatch?.[1]?.trim();
  let scan = raw;
  for (const match of raw.matchAll(/[“"][^”"]+[”"]/g)) scan = scan.replace(match[0], " ");
  for (const issue of explicitTitles) scan = scan.split(text(issue["议题"])).join(" ");
  if (tailMatch) scan = scan.split(tailMatch[0]).join(" ");
  let selected = [];
  if (/(按默认|默认|前三个)/.test(scan)) selected = candidates.slice(0, 3);
  else if (/(都研究|全部|全选)/.test(scan)) selected = candidates;
  else {
    for (const digit of scan.match(/\d/g) || []) {
      const item = candidates.find((candidate) => candidate.position === Number(digit));
      if (item && !selected.some((current) => current.recordId === item.recordId)) selected.push(item);
    }
  }
  for (const title of quoted) {
    const matches = allIssues.filter((issue) => text(issue["议题"]).includes(title));
    if (matches.length !== 1) throw new Error(matches.length ? `候选外议题不唯一：${title}` : `未找到候选外议题：${title}`);
    if (!selected.some((current) => current.recordId === matches[0].recordId)) selected.push(matches[0]);
  }
  for (const issue of explicitTitles) if (!selected.some((current) => current.recordId === issue.recordId)) selected.push(issue);
  if (tail && !explicitTitles.length && !quoted.length) {
    const matches = allIssues.filter((issue) => text(issue["议题"]).includes(tail));
    if (matches.length !== 1) throw new Error(matches.length ? `候选外议题不唯一：${tail}` : `未找到候选外议题：${tail}`);
    if (!selected.some((current) => current.recordId === matches[0].recordId)) selected.push(matches[0]);
  }
  if (!selected.length) throw new Error("无法从回复解析选择；请使用 123、前三个、都研究或引号中的完整议题标题");
  return selected;
}

export function renderWorkbench(month, issues) {
  const field = (label, value) => `<p><b>${label}：</b>${xml(value || "")}</p>`;
  const section = (issue) => `<h2>[${xml(issue["议题编号"])}] ${xml(issue["议题"])}</h2>${field("议题周期", text(issue["议题周期"]) || "未分类（请按短期／中期／长期核心问题维护）")}${field("优先级", text(issue["优先级"]) || "P1（默认）")}${field("研究状态", text(issue["研究状态"]) || "继续研究（默认）")}${field("阶段", issue["阶段"])}${field("当前判断", issue["当前判断"])}${field("判断置信度", issue["判断置信度"])}${field("最大未知", issue["最大未知"])}${field("最强反证", "")}${field("改变判断的条件", issue["改变判断的条件"])}${field("下一步", issue["下一步"])}${field("本轮新增认识", "")}${field("来源与引用", "")}<p><b>自由研究区：</b></p><p></p>`;
  return `<title>月度核心议题研究工作台｜${month}</title><h1>月度核心议题研究工作台｜${month}</h1><callout emoji="💡" background-color="light-blue" border-color="blue"><p>这是一份研究现场，不是月报。提交只解析当前版本；未发生变化可以留空，提交不等于完成。</p></callout>${issues.map(section).join("")}`;
}

export function headingBlockId(outline, issueId) {
  const id = escaped(issueId);
  const patterns = [
    new RegExp(`<h2[^>]*\\bid=["']([^"']+)["'][^>]*>(?:(?!</h2>|<h2)[\\s\\S]){0,300}?\\[${id}\\]`, "i"),
    new RegExp(`<(?:heading|item|outline-item)[^>]*\\bid=["']([^"']+)["'][^>]*>(?:(?!</(?:heading|item|outline-item)>|<(?:heading|item|outline-item))[\\s\\S]){0,300}?\\[${id}\\]`, "i"),
  ];
  for (const pattern of patterns) { const match = String(outline).match(pattern); if (match) return match[1]; }
  return null;
}

function blankBaseDoc(content, name) {
  return String(content || "").replace(/<[^>]+>/g, "").replace(name, "").trim() === "";
}

export function validateProposal(proposal, selected, document) {
  if (!proposal || typeof proposal !== "object") throw new Error("proposal 必须是 JSON 对象");
  const selectedById = new Map(selected.map((issue) => [text(issue["议题编号"]), issue]));
  const changes = proposal.changes || [];
  const events = proposal.events || [];
  if (!Array.isArray(changes) || !Array.isArray(events)) throw new Error("changes 和 events 必须为数组");
  const judgmentChanges = new Map();
  for (const change of changes) {
    if (!selectedById.has(change.issueId)) throw new Error(`不是本月选定议题：${change.issueId}`);
    for (const field of change.clear || []) if (!MUTABLE_FIELDS.has(field)) throw new Error(`不允许清空字段：${field}`);
    for (const [name, value] of Object.entries(change.fields || {})) {
      if (!MUTABLE_FIELDS.has(name)) throw new Error(`不允许更新字段：${name}`);
      if (name === "议题周期" && value !== "清空" && !HORIZONS.includes(value)) throw new Error(`议题周期无效：${value}`);
      if (name === "优先级" && value !== "清空" && !PRIORITIES.includes(value)) throw new Error(`优先级无效：${value}`);
      if (name === "研究状态" && value !== "清空" && !RESEARCH_STATES.includes(value)) throw new Error(`研究状态无效：${value}`);
      if (name === "阶段" && value !== "清空" && !STAGES.includes(value)) throw new Error(`阶段无效：${value}`);
      if (name === "判断置信度" && value !== "清空" && (!Number.isInteger(value) || value < 0 || value > 10)) throw new Error("判断置信度必须为 0-10 整数");
    }
    if (has(change.fields, "当前判断") || (change.clear || []).includes("当前判断")) {
      const before = text(selectedById.get(change.issueId)["当前判断"]);
      const value = (change.fields || {})["当前判断"];
      const after = value === "清空" || (change.clear || []).includes("当前判断") ? "" : text(value);
      if (after !== before) judgmentChanges.set(change.issueId, { before, after });
    }
  }
  for (const event of events) {
    if (!selectedById.has(event.issueId) || !EVENT_TYPES.has(event.type)) throw new Error(`事件议题或类型无效：${event.issueId}/${event.type}`);
    if (!text(event.summary) || !text(event.detail) || !text(event.increment) || !text(event.evidence) || !text(event.blockId)) throw new Error("事件缺少摘要、详细内容、认知增量、证据或 block ID");
    if (!document.includes(event.evidence) || !new RegExp(`id=["']${escaped(event.blockId)}["']`).test(document)) throw new Error(`事件证据无法在当前文档定位：${event.issueId}`);
    if (event.sourceSystem && !["Learn-X", "Voice-X", "Research-X", "Read-X", "Doing-X", "现实经历", "其他"].includes(event.sourceSystem)) throw new Error(`来源系统无效：${event.sourceSystem}`);
    if (event.sourceLink && !document.includes(event.sourceLink)) throw new Error("事件来源链接不在当前文档中");
    if (event.type === "判断更新" && (!has(event, "before") || !has(event, "after"))) throw new Error("判断更新必须包含前后判断");
  }
  for (const [issueId, judgment] of judgmentChanges) {
    const matched = events.some((event) => event.issueId === issueId && event.type === "判断更新" && text(event.before) === judgment.before && text(event.after) === judgment.after);
    if (!matched) throw new Error(`${issueId} 当前判断变化必须有前后值一致的判断更新事件`);
  }
  return { ...proposal, changes, events, unprocessed: proposal.unprocessed || [] };
}

export async function defaultRunner(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (parsed.ok !== true) throw new Error(parsed.error?.message || "lark-cli 返回失败");
  return parsed;
}

export class Workbench {
  constructor(run = defaultRunner) { this.run = run; }
  async lark(args) { return this.run([...args, "--as", "user", "--format", "json"]); }
  async fields(tableId) { return (await this.lark(["base", "+field-list", "--base-token", BASE_TOKEN, "--table-id", tableId, "--limit", "100"])).data.fields || []; }
  async blocks() { return (await this.lark(["base", "+base-block-list", "--base-token", BASE_TOKEN])).data.blocks || []; }
  async ledgerTable() { const table = (await this.blocks()).find((block) => block.type === "table" && block.name === LEDGER_NAME); if (!table) throw new Error(`缺少机器表：${LEDGER_NAME}；先运行 setup`); return table.id; }
  async list(tableId, fields) {
    const rows = []; let offset = 0;
    while (true) {
      const result = await this.lark(["base", "+record-list", "--base-token", BASE_TOKEN, "--table-id", tableId, "--limit", "200", "--offset", String(offset), ...fields.flatMap((field) => ["--field-id", field])]);
      const data = result.data || {}; const names = data.fields || fields; const values = data.data || [];
      rows.push(...values.map((value, index) => ({ recordId: data.record_id_list?.[index], ...Object.fromEntries(names.map((name, column) => [name, value[column]])) })));
      if (!data.has_more) return rows;
      if (!values.length) throw new Error("Base 分页异常：has_more=true 但无新增记录");
      offset += values.length;
    }
  }
  async issues() { return this.list(ISSUE_TABLE, ISSUE_FIELDS); }
  async events() { return this.list(EVENT_TABLE, EVENT_FIELDS); }
  async ledger(month) { const table = await this.ledgerTable(); const rows = await this.list(table, LEDGER_FIELDS); const matches = rows.filter((row) => text(row["研究月份"]) === month); if (matches.length > 1) throw new Error(`同月存在重复账本：${month}`); return { table, row: matches[0] || null }; }
  async write(table, recordId, values) { return this.lark(["base", "+record-upsert", "--base-token", BASE_TOKEN, "--table-id", table, ...(recordId ? ["--record-id", recordId] : []), "--json", JSON.stringify(values)]); }
  async assertSchema() {
    const exact = (fields, expected) => { const map = new Map(fields.map((field) => [field.name, field])); for (const [name, type, options] of expected) { const field = map.get(name); if (!field || field.type !== type) throw new Error(`字段结构漂移：${name}`); if (options && options.some((option) => !(field.options || []).some((actual) => actual.name === option))) throw new Error(`字段选项漂移：${name}`); } };
    exact(await this.fields(ISSUE_TABLE), [["议题周期", "select", HORIZONS], ["优先级", "select", PRIORITIES], ["研究状态", "select", RESEARCH_STATES]]);
    exact(await this.fields(EVENT_TABLE), [["有效性", "select", ["有效", "待生效", "已撤回"]], ["来源月度研究", "link"]]);
    exact(await this.fields(await this.ledgerTable()), [["研究月份", "text"], ["流程状态", "select", ["待选择", "研究中", "需处理", "已提交", "已撤回"]]]);
  }
  async setup() {
    const select = (name, options, description, defaultValue) => ({ name, type: "select", multiple: false, default_value: [defaultValue], options: options.map((option) => ({ name: option })), description });
    const ensure = async (table, spec) => { const current = await this.fields(table); const found = current.find((field) => field.name === spec.name); if (found) return found; return (await this.lark(["base", "+field-create", "--base-token", BASE_TOKEN, "--table-id", table, "--json", JSON.stringify(spec)])).data.field; };
    await ensure(ISSUE_TABLE, select("优先级", PRIORITIES, "议题整体有多重要，不代表本月一定研究。", "P1"));
    await ensure(ISSUE_TABLE, { name: "议题周期", type: "select", multiple: false, options: HORIZONS.map((option) => ({ name: option })), description: "议题主要通过哪个注意力窗口取得进展；短期 4–12 周，中期 6–24 个月，长期跨更长人生或世界问题。它不等于优先级。" });
    await ensure(ISSUE_TABLE, select("研究状态", RESEARCH_STATES, "当前是否继续投入注意力；独立于议题生命周期和阶段。", "继续研究"));
    let ledger = (await this.blocks()).find((block) => block.type === "table" && block.name === LEDGER_NAME);
    if (!ledger) {
      const fields = [{ name: "研究月份", type: "text" }, { name: "候选议题", type: "link", link_table: ISSUE_TABLE, bidirectional: false }, { name: "选定议题", type: "link", link_table: ISSUE_TABLE, bidirectional: false }, { name: "候选顺序", type: "text" }, { name: "研究文档", type: "text" }, select("流程状态", ["待选择", "研究中", "需处理", "已提交", "已撤回"], "机器流程状态，用户无需维护。", "待选择"), { name: "当前提交标识", type: "text" }, { name: "当前文档哈希", type: "text" }, { name: "审计历史", type: "text" }, { name: "解析摘要", type: "text" }];
      await this.lark(["base", "+table-create", "--base-token", BASE_TOKEN, "--name", LEDGER_NAME, "--fields", JSON.stringify(fields)]);
      ledger = (await this.blocks()).find((block) => block.type === "table" && block.name === LEDGER_NAME);
    }
    await ensure(ledger.id, { name: "创建时间", type: "created_at" });
    await ensure(ledger.id, { name: "更新时间", type: "updated_at" });
    await ensure(EVENT_TABLE, select("有效性", ["有效", "待生效", "已撤回"], "追加历史的当前有效性；撤回不删除事件。", "有效"));
    await ensure(EVENT_TABLE, { name: "来源月度研究", type: "link", link_table: ledger.id, bidirectional: false, description: "本事件来自的月度工作台审计记录。" });
    const views = (await this.lark(["base", "+view-list", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--limit", "100"])).data.views || [];
    let view = views.find((item) => item.name === AUDIT_VIEW_NAME);
    if (!view) { await this.lark(["base", "+view-create", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--json", JSON.stringify({ name: AUDIT_VIEW_NAME, type: "grid" })]); view = ((await this.lark(["base", "+view-list", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--limit", "100"])).data.views || []).find((item) => item.name === AUDIT_VIEW_NAME); }
    await this.lark(["base", "+view-set-visible-fields", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--view-id", view.id, "--json", JSON.stringify({ visible_fields: ["议题编号", "议题", "议题周期", "优先级", "研究状态", "类型", "状态", "阶段", "当前判断", "最大未知", "下一步", "决策截止时间", "更新时间"] })]);
    await this.lark(["base", "+view-set-filter", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--view-id", view.id, "--json", JSON.stringify({ logic: "and", conditions: [["状态", "!=", "关闭"]] })]);
    await this.lark(["base", "+view-set-sort", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--view-id", view.id, "--json", JSON.stringify({ sort_config: [{ field: "优先级", desc: false }, { field: "研究状态", desc: false }, { field: "决策截止时间", desc: false }] })]);
    await this.assertSchema();
    return { table: ledger.id, view: view.id };
  }
  async recommend(month, refresh = false) {
    await this.assertSchema(); const { table, row } = await this.ledger(month);
    if (row && text(row["研究文档"])) throw new Error("本月工作台已创建，候选顺序已冻结");
    let candidates = row && !refresh ? linkIds(row["候选议题"]) : null;
    const issues = await this.issues(); const events = await this.events(); const ledgers = await this.list(table, LEDGER_FIELDS);
    if (candidates) candidates = candidates.map((recordId) => issues.find((issue) => issue.recordId === recordId)).filter(Boolean).map((issue, index) => ({ ...issue, position: index + 1 }));
    else candidates = rankIssues(issues, events, month, ledgers);
    const values = { "研究月份": month, "候选议题": candidates.map((candidate) => ({ id: candidate.recordId })), "候选顺序": JSON.stringify(candidates.map((candidate) => candidate.recordId)), "流程状态": text(row?.["流程状态"]) || "待选择" };
    const saved = await this.write(table, row?.recordId, values); const ledgerId = row?.recordId || saved.data?.record?.record_id;
    const views = (await this.lark(["base", "+view-list", "--base-token", BASE_TOKEN, "--table-id", ISSUE_TABLE, "--limit", "100"])).data.views || [];
    const view = views.find((item) => item.name === AUDIT_VIEW_NAME);
    const counts = issues.reduce((all, issue) => { all[effectiveHorizon(issue)]++; all[effectivePriority(issue)]++; all[effectiveResearchState(issue)]++; if (!text(issue["议题周期"]) || !text(issue["优先级"]) || !text(issue["研究状态"])) all.未显式维护++; return all; }, { 短期核心问题: 0, 中期核心问题: 0, 长期核心问题: 0, 未分类: 0, P0: 0, P1: 0, P2: 0, 继续研究: 0, 暂缓研究: 0, 关闭研究: 0, 未显式维护: 0 });
    return { ledgerId, counts, auditUrl: `https://ywhome.feishu.cn/base/${BASE_TOKEN}?table=${ISSUE_TABLE}&view=${view?.id || ""}`, candidates: candidates.map((candidate) => ({ position: candidate.position, horizon: effectiveHorizon(candidate), id: candidate["议题编号"], question: candidate["议题"], reason: recommendationReason(candidate, month) })), reply: "回复 123、前三个、都研究，或 1 和 3，再加“候选外议题标题”。" };
  }
  async select(month, input) {
    const { row } = await this.ledger(month); if (!row) throw new Error("请先运行 recommend");
    const issues = await this.issues(); const candidates = linkIds(row["候选议题"]).map((recordId, index) => { const issue = issues.find((item) => item.recordId === recordId); if (!issue) throw new Error("候选议题已不存在，需重新推荐"); return { ...issue, position: index + 1 }; });
    const selected = parseSelection(input, candidates, issues); return { selected: selected.map((issue) => ({ recordId: issue.recordId, id: issue["议题编号"], question: issue["议题"] })) };
  }
  async create(month, selection) {
    await this.assertSchema(); const { table, row } = await this.ledger(month); if (!row) throw new Error("请先运行 recommend");
    if (text(row["研究文档"])) return { document: row["研究文档"], reused: true };
    const issues = await this.issues(); const selected = selection.map((recordId) => issues.find((issue) => issue.recordId === recordId)).filter(Boolean); if (!selected.length || selected.length !== selection.length) throw new Error("选定议题不存在");
    const name = `月度核心议题研究工作台｜${month}`; const allBlocks = await this.blocks(); const duplicates = allBlocks.filter((block) => block.type === "docx" && block.name === name); if (duplicates.length > 1) throw new Error("同月存在多个同名工作台文档");
    let doc = duplicates[0]; let created = false;
    if (!doc) { await this.lark(["base", "+base-block-create", "--base-token", BASE_TOKEN, "--type", "docx", "--name", name]); doc = (await this.blocks()).find((block) => block.type === "docx" && block.name === name); created = true; }
    if (!doc) throw new Error("工作台 Docx 创建后无法定位");
    const existing = created ? "" : text((await this.lark(["docs", "+fetch", "--doc", doc.id, "--detail", "with-ids"])).data?.document?.content);
    const expectedMarkers = selected.map((issue) => `[${text(issue["议题编号"])}]`);
    if (!created && expectedMarkers.every((marker) => existing.includes(marker))) {
      await this.write(table, row.recordId, { "选定议题": selected.map((issue) => ({ id: issue.recordId })), "研究文档": doc.id, "流程状态": "研究中" });
      return { document: `https://ywhome.feishu.cn/base/${BASE_TOKEN}?block=${doc.id}`, token: doc.id, selected: selected.map((issue) => ({ id: issue["议题编号"], question: issue["议题"] })), recovered: true };
    }
    if (!created && !blankBaseDoc(existing, name)) throw new Error("同名工作台文档已有非模板内容，拒绝覆盖");
    await this.lark(["docs", "+update", "--doc", doc.id, "--command", "overwrite", "--content", renderWorkbench(month, selected)]);
    const readback = await this.lark(["docs", "+fetch", "--doc", doc.id, "--detail", "with-ids"]); const written = text(readback.data?.document?.content); if (!written.includes(`月度核心议题研究工作台｜${month}`) || !expectedMarkers.every((marker) => written.includes(marker))) throw new Error("工作台文档回读失败");
    const document = `https://ywhome.feishu.cn/base/${BASE_TOKEN}?block=${doc.id}`;
    await this.write(table, row.recordId, { "选定议题": selected.map((issue) => ({ id: issue.recordId })), "研究文档": doc.id, "流程状态": "研究中" });
    return { document, token: doc.id, selected: selected.map((issue) => ({ id: issue["议题编号"], question: issue["议题"] })) };
  }
  async snapshot(month) {
    await this.assertSchema(); const { row } = await this.ledger(month); if (!row || !text(row["研究文档"])) throw new Error("本月尚未创建工作台");
    const token = text(row["研究文档"]); const outline = await this.lark(["docs", "+fetch", "--doc", token, "--scope", "outline", "--max-depth", "3", "--detail", "with-ids"]); const revision = outline.data?.document?.revision_id; if (!Number.isInteger(revision)) throw new Error("文档缺少稳定 revision"); const outlineText = text(outline.data?.document?.content); const issues = await this.issues(); const selected = linkIds(row["选定议题"]).map((recordId) => issues.find((issue) => issue.recordId === recordId)).filter(Boolean); if (!selected.length) throw new Error("账本缺少选定议题");
    const sections = []; for (const issue of selected) { const id = text(issue["议题编号"]); const blockId = headingBlockId(outlineText, id); if (!blockId) throw new Error(`文档缺少稳定议题区域：[${id}]`); const section = await this.lark(["docs", "+fetch", "--doc", token, "--revision-id", String(revision), "--scope", "section", "--start-block-id", blockId, "--detail", "with-ids"]); sections.push({ issueId: id, blockId, content: text(section.data?.document?.content) }); }
    const content = sections.map((section) => section.content).join("\n"); return { month, documentToken: token, revisionId: revision, hash: sha(content), selected, sections, content };
  }
  async assertCurrentRevision(snapshot) {
    const current = await this.lark(["docs", "+fetch", "--doc", snapshot.documentToken, "--scope", "outline", "--max-depth", "3", "--detail", "with-ids"]);
    if (Number(current.data?.document?.revision_id) !== Number(snapshot.revisionId)) throw new Error("文档在解析期间已变化；请重新解析最新版本");
  }
  async apply(proposal) {
    const snapshot = await this.snapshot(proposal.month); if (proposal.documentToken !== snapshot.documentToken || Number(proposal.revisionId) !== Number(snapshot.revisionId)) throw new Error("proposal 不是当前文档 revision");
    const checked = validateProposal(proposal, snapshot.selected, snapshot.content); const { table, row } = await this.ledger(proposal.month); if (text(row["流程状态"]) === "已提交" && text(row["当前文档哈希"]) === snapshot.hash) return JSON.parse(text(row["解析摘要"]) || "{}");
    const { fd, lock } = acquireLock(proposal.month); // single-host lock with stale-owner detection; use a leased Base lock only if real multi-host contention appears.
    try {
      await this.assertCurrentRevision(snapshot);
      const history = JSON.parse(text(row["审计历史"]) || "[]"); const previous = [...history].reverse().find((entry) => entry.status === "已提交");
      if (previous) await this.restorePrevious(table, row, previous);
      const issues = await this.issues(); const byId = new Map(issues.map((issue) => [text(issue["议题编号"]), issue])); const before = {};
      for (const change of checked.changes) before[change.issueId] = Object.fromEntries([...MUTABLE_FIELDS].map((field) => [field, byId.get(change.issueId)[field]]));
      const submissionId = `${proposal.month}:${snapshot.documentToken}:${snapshot.hash}`; const sourceIds = checked.events.map((event) => `MWQW:${submissionId}:${event.issueId}:${sha(`${event.type}\n${event.summary}\n${event.detail}\n${event.evidence}\n${event.before ?? ""}\n${event.after ?? ""}`).slice(0, 16)}`); const pending = history.find((entry) => entry.submissionId === submissionId && entry.status === "需处理"); const previousSourceIds = pending ? [...(pending.eventSourceIds || [])] : []; const audit = pending || { submissionId, revisionId: snapshot.revisionId, hash: snapshot.hash, before, after: checked.changes, eventSourceIds: sourceIds, status: "需处理" }; if (pending) audit.eventSourceIds = sourceIds; const auditHistory = pending ? history : [...history, audit];
      await this.write(table, row.recordId, { "流程状态": "需处理", "当前提交标识": submissionId, "当前文档哈希": snapshot.hash, "审计历史": JSON.stringify(auditHistory) });
      const knownEvents = await this.events(); for (const staleId of previousSourceIds.filter((id) => !sourceIds.includes(id))) { const stale = knownEvents.find((item) => text(item["来源标识"]) === staleId); if (stale && text(stale["有效性"]) === "待生效") await this.write(EVENT_TABLE, stale.recordId, { "有效性": "已撤回" }); }
      for (const [index, event] of checked.events.entries()) { const sourceId = sourceIds[index]; if (knownEvents.some((item) => text(item["来源标识"]) === sourceId)) continue; const issue = byId.get(event.issueId); await this.write(EVENT_TABLE, null, { "内容摘要": event.summary, "详细内容": event.detail, "认知增量": event.increment, "关联议题": [{ id: issue.recordId }], "事件类型": event.type, "变更前": event.before || null, "变更后": event.after || null, "变化后置信度": event.confidence ?? null, "来源系统": event.sourceSystem || null, "来源标识": sourceId, "来源链接": event.sourceLink || null, "有效性": "待生效", "来源月度研究": [{ id: row.recordId }] }); }
      for (const change of checked.changes) { const patch = {}; for (const field of new Set([...Object.keys(change.fields || {}), ...(change.clear || [])])) { const value = (change.fields || {})[field]; patch[field] = value === "清空" || (change.clear || []).includes(field) ? null : value; } await this.write(ISSUE_TABLE, byId.get(change.issueId).recordId, patch); const updated = (await this.issues()).find((issue) => text(issue["议题编号"]) === change.issueId); for (const field of Object.keys(patch)) if (!same(updated?.[field], patch[field] ?? "")) throw new Error(`议题写后读回不一致：${change.issueId}/${field}`); }
      const pendingEvents = await this.events(); for (const sourceId of audit.eventSourceIds) { const event = pendingEvents.find((item) => text(item["来源标识"]) === sourceId); if (!event) throw new Error(`事件创建后丢失：${sourceId}`); await this.write(EVENT_TABLE, event.recordId, { "有效性": "有效" }); }
      const finalEvents = await this.events(); const resultEvents = checked.events.map((event, index) => { const stored = finalEvents.find((item) => text(item["来源标识"]) === audit.eventSourceIds[index]); if (text(stored?.["有效性"]) !== "有效") throw new Error(`事件有效性读回不一致：${audit.eventSourceIds[index]}`); const id = text(stored?.["事件编号"]); if (!id) throw new Error(`事件编号读回失败：${audit.eventSourceIds[index]}`); return { id, type: event.type, summary: event.summary, sourceId: audit.eventSourceIds[index] }; }); audit.status = "已提交"; const changed = new Set(checked.changes.map((change) => change.issueId)); const resultChanges = checked.changes.map((change) => ({ issueId: change.issueId, fields: Object.fromEntries([...new Set([...Object.keys(change.fields || {}), ...(change.clear || [])])].map((field) => [field, { before: before[change.issueId][field] ?? null, after: (change.clear || []).includes(field) || change.fields?.[field] === "清空" ? null : change.fields?.[field] }])) })); const result = { month: proposal.month, revision: snapshot.revisionId, submissionId, hash: snapshot.hash.slice(0, 12), changes: resultChanges, events: resultEvents, unchanged: snapshot.selected.filter((issue) => !changed.has(text(issue["议题编号"]))).map((issue) => text(issue["议题编号"])), unprocessed: checked.unprocessed, replaced: Boolean(previous), correction: "编辑工作台后重新解析，或撤回上次解析。" };
      await this.write(table, row.recordId, { "流程状态": "已提交", "审计历史": JSON.stringify(auditHistory), "解析摘要": JSON.stringify(result) }); return result;
    } catch (error) { await this.write(table, row.recordId, { "流程状态": "需处理" }); throw error; } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  async restorePrevious(table, row, previous) {
    const issues = await this.issues(); for (const change of previous.after || []) { const current = issues.find((issue) => text(issue["议题编号"]) === change.issueId); for (const field of new Set([...Object.keys(change.fields || {}), ...(change.clear || [])])) { const value = (change.fields || {})[field]; const after = value === "清空" || (change.clear || []).includes(field) ? "" : value; const before = previous.before?.[change.issueId]?.[field]; if (!same(current[field], after) && !same(current[field], before)) throw new Error(`人工并发修改，无法替换：${change.issueId}/${field}`); } }
    for (const sourceId of previous.eventSourceIds || []) { const event = (await this.events()).find((item) => text(item["来源标识"]) === sourceId); if (event && text(event["有效性"]) !== "已撤回") await this.write(EVENT_TABLE, event.recordId, { "有效性": "已撤回" }); }
    const patches = new Map((previous.after || []).map((change) => { const fields = new Set([...Object.keys(change.fields || {}), ...(change.clear || [])]); return [change.issueId, Object.fromEntries([...fields].map((field) => [field, previous.before?.[change.issueId]?.[field] ?? null]))]; }));
    for (const [issueId, values] of patches) { const issue = issues.find((item) => text(item["议题编号"]) === issueId); if (issue) await this.write(ISSUE_TABLE, issue.recordId, values); }
    const restoredIssues = await this.issues(); for (const [issueId, values] of patches) { const issue = restoredIssues.find((item) => text(item["议题编号"]) === issueId); for (const [field, value] of Object.entries(values)) if (!same(issue?.[field], value)) throw new Error(`撤回字段读回不一致：${issueId}/${field}`); }
    const restoredEvents = await this.events(); for (const sourceId of previous.eventSourceIds || []) { const event = restoredEvents.find((item) => text(item["来源标识"]) === sourceId); if (event && text(event["有效性"]) !== "已撤回") throw new Error(`撤回事件读回不一致：${sourceId}`); }
    previous.status = "已撤回";
  }
  async rollback(month) { const { table, row } = await this.ledger(month); const history = JSON.parse(text(row?.["审计历史"]) || "[]"); const previous = [...history].reverse().find((entry) => entry.status === "已提交"); if (!previous) throw new Error("没有可撤回的已提交版本"); await this.restorePrevious(table, row, previous); await this.write(table, row.recordId, { "流程状态": "已撤回", "审计历史": JSON.stringify(history), "解析摘要": JSON.stringify({ month, withdrawn: previous.submissionId }) }); const result = await this.ledger(month); if (text(result.row?.["流程状态"]) !== "已撤回") throw new Error("撤回账本读回不一致"); return { month, withdrawn: previous.submissionId }; }
  async status(month) { const { row } = await this.ledger(month); return row ? Object.fromEntries(LEDGER_FIELDS.map((field) => [field, row[field]])) : { month, status: "不存在" }; }
}

async function stdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
async function main() {
  const [command] = process.argv.slice(2); const month = arg("--month"); const app = new Workbench(); let output;
  if (command === "setup") output = await app.setup();
  else if (command === "recommend") output = await app.recommend(month, process.argv.includes("--refresh"));
  else if (command === "select") output = await app.select(month, arg("--input"));
  else if (command === "create") { const raw = arg("--selection-json"); output = await app.create(month, JSON.parse(raw === "-" ? await stdin() : raw)); }
  else if (command === "snapshot") output = await app.snapshot(month);
  else if (command === "apply") { const raw = arg("--proposal-json"); output = await app.apply(JSON.parse(raw === "-" ? await stdin() : raw)); }
  else if (command === "rollback") output = await app.rollback(month);
  else if (command === "status") output = await app.status(month);
  else throw new Error("用法：setup | recommend --month YYYY-MM | select --month YYYY-MM --input '123' | create --month YYYY-MM --selection-json - | snapshot --month YYYY-MM | apply --proposal-json - | rollback --month YYYY-MM | status --month YYYY-MM");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

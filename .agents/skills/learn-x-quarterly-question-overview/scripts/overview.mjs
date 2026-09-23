import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { escapeXml, readConfig, renderIndex, sortNodes, wikiUrl } from "../../../lib/inquiry-wiki.mjs";

const execFileAsync = promisify(execFile);

export const BASE_TOKEN = "W6NLbDh1YahvZ9sbjIccEirBnae";
export const ISSUE_TABLE = "tbllcm6oBbdMKnkN";
export const EVENT_TABLE = "tblIE9FK9mWGv7GE";
export const LEDGER_NAME = "季度议题总览";
export const LEDGER_FIELDS = ["季度", "总览文档", "Wiki 节点", "流程状态", "当前提交标识", "当前文档哈希", "审计历史", "解析摘要", "创建的议题", "创建时间", "更新时间"];
export const ISSUE_FIELDS = ["议题编号", "议题", "类型", "状态", "阶段", "议题周期", "优先级", "研究状态", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步", "决策截止时间", "创建时间", "更新时间"];
export const EVENT_FIELDS = ["事件编号", "关联议题", "事件类型", "内容摘要", "详细内容", "认知增量", "变更前", "变更后", "变化后置信度", "来源系统", "来源标识", "来源链接", "有效性", "来源季度总览", "创建时间", "更新时间"];
export const PRIORITIES = ["P0", "P1", "P2"];
export const HORIZONS = ["短期", "中期", "长期", "未分类"];
export const STATES = ["继续研究", "暂缓研究", "关闭研究"];
export const STAGES = ["探索", "形成判断", "待决策", "行动中", "等待结果", "校准"];
export const MUTABLE_FIELDS = new Set(["议题", "类型", "议题周期", "优先级", "研究状态", "阶段", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步"]);
export const EVENT_TYPES = new Set(["证据", "判断更新", "问题重构", "决策", "行动或实验", "现实结果", "校准"]);

export const text = (value) => String(Array.isArray(value) ? value[0] ?? "" : value?.name ?? value?.text ?? value ?? "").trim();
export const linkIds = (value) => (Array.isArray(value) ? value : [value]).map((item) => String(item?.id ?? item?.record_id ?? item ?? "")).filter(Boolean);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const parseSummary = (value) => { try { const parsed = JSON.parse(text(value) || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
const xml = (value) => escapeXml(value);
const defaultPriority = (issue) => PRIORITIES.includes(text(issue["优先级"])) ? text(issue["优先级"]) : "P1";
const defaultState = (issue) => STATES.includes(text(issue["研究状态"])) ? text(issue["研究状态"]) : "继续研究";
const horizon = (issue) => HORIZONS.includes(text(issue["议题周期"])) ? text(issue["议题周期"]) : "未分类";
const field = (name, value) => `<p><b>${xml(name)}：</b>${xml(value || "")}</p>`;
const recordId = (result) => result?.data?.record?.record_id || result?.data?.record?.recordId || result?.data?.record?.record_id_list?.[0] || result?.data?.record_id_list?.[0] || null;
const validQuarter = (quarter) => { if (!/^\d{4}-Q[1-4]$/.test(quarter)) throw new Error("季度必须是 YYYY-Q1 至 YYYY-Q4"); return quarter; };
const evidenceInBlock = (content, evidence, blockId) => { const escaped = String(blockId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const match = String(content).match(new RegExp(`<([A-Za-z][\\w-]*)[^>]*\\bid=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/\\1>`)); return Boolean(match && match[0].includes(String(evidence))); };

export function quarterOfDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("无法计算 Asia/Shanghai 季度");
  return `${year}-Q${Math.ceil(month / 3)}`;
}

export function renderOverview(quarter, issues) {
  validQuarter(quarter);
  const groups = HORIZONS.map((name) => issues.filter((issue) => horizon(issue) === name));
  const rows = (items) => items.map((issue) => `<tr><td>${xml(issue["议题编号"])}</td><td>${xml(issue["议题"])}</td><td>${xml(issue["类型"])}</td><td>${xml(horizon(issue))}</td><td>${xml(text(issue["优先级"]) || "P1（默认）")}</td><td>${xml(text(issue["研究状态"]) || "继续研究（默认）")}</td><td>${xml(issue["阶段"])}</td></tr>`).join("");
  const tables = groups.map((items, index) => `<h2>${xml(HORIZONS[index])}议题（${items.length}）</h2><table><tr><th>编号</th><th>议题</th><th>类型</th><th>周期</th><th>优先级</th><th>研究状态</th><th>阶段</th></tr>${rows(items)}</table>`).join("");
  const priority = `<table><tr><th>周期</th>${PRIORITIES.map((name) => `<th>${name}</th>`).join("")}<th>合计</th></tr>${groups.map((items, index) => `<tr><td>${xml(HORIZONS[index])}</td>${PRIORITIES.map((name) => `<td>${items.filter((issue) => defaultPriority(issue) === name).length}</td>`).join("")}<td>${items.length}</td></tr>`).join("")}<tr><td>合计</td>${PRIORITIES.map((name) => `<td>${issues.filter((issue) => defaultPriority(issue) === name).length}</td>`).join("")}<td>${issues.length}</td></tr></table>`;
  return `<title>核心议题总览｜${quarter}</title><h1>核心议题总览｜${quarter}</h1><callout emoji="🧭" background-color="light-blue" border-color="blue"><p>本页是季度盘点与治理现场。Base 是结构化状态真值源，只有下方明确回填清单中的结论可以提交。</p><p>空优先级显示为 P1（默认），空研究状态显示为继续研究（默认），不代表人工已维护。</p></callout><h2>议题盘点</h2>${tables}<h2>优先级交叉视图</h2>${priority}<h2>候选池</h2><p>请在人工整理后把下一季候选写入回填清单。</p><h2>回填清单</h2><p>仅此区域的明确结论可提交；普通笔记不会写入 Base。</p><p>季度回填锚点：quarterly-fillback</p><h2>自由整理区</h2><p></p>`;
}

export function baseHash(issues) {
  return hash(JSON.stringify([...issues].sort((a, b) => String(a.recordId).localeCompare(String(b.recordId))).map((issue) => [issue.recordId, ISSUE_FIELDS.map((name) => issue[name] ?? null)])));
}

function eventSourceId(submissionId, event) {
  return `${submissionId}:${event.issueId}:${hash(JSON.stringify([event.type, event.summary, event.detail, event.increment, event.evidence, event.blockId, event.before ?? null, event.after ?? null, event.confidence ?? null, event.sourceLink ?? null])).slice(0, 16)}`;
}

function patchForChange(change) {
  const patch = {};
  for (const name of new Set([...Object.keys(change.fields || {}), ...(change.clear || [])])) {
    patch[name] = change.fields?.[name] === "清空" || (change.clear || []).includes(name) ? null : change.fields[name];
  }
  return patch;
}

export function validateProposal(proposal, snapshot) {
  if (!proposal || typeof proposal !== "object") throw new Error("proposal 必须是 JSON 对象");
  if (proposal.quarter !== snapshot.quarter || proposal.documentToken !== snapshot.documentToken || Number(proposal.revisionId) !== Number(snapshot.revisionId)) throw new Error("proposal 不是当前文档 revision");
  if (proposal.baseHash && proposal.baseHash !== snapshot.baseHash) throw new Error("Base 快照已变化；请重新解析最新版本");
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const creates = Array.isArray(proposal.creates) ? proposal.creates : [];
  const events = Array.isArray(proposal.events) ? proposal.events : [];
  const unprocessed = Array.isArray(proposal.unprocessed) ? proposal.unprocessed : [];
  const known = new Map(snapshot.issues.map((issue) => [text(issue["议题编号"]), issue]));
  const changedIds = new Set();
  for (const change of changes) {
    if (!known.has(change.issueId)) throw new Error(`议题不存在：${change.issueId}`);
    if (changedIds.has(change.issueId)) throw new Error(`同一议题重复变更：${change.issueId}`);
    changedIds.add(change.issueId);
    for (const name of [...Object.keys(change.fields || {}), ...(change.clear || [])]) {
      if (!MUTABLE_FIELDS.has(name) || name === "议题编号" || name === "状态") throw new Error(`不允许更新字段：${name}`);
      const value = change.fields?.[name];
      if (name === "议题周期" && value !== "清空" && !HORIZONS.slice(0, 3).includes(value)) throw new Error(`议题周期无效：${value}`);
      if (name === "优先级" && value !== "清空" && !PRIORITIES.includes(value)) throw new Error(`优先级无效：${value}`);
      if (name === "研究状态" && value !== "清空" && !STATES.includes(value)) throw new Error(`研究状态无效：${value}`);
      if (name === "阶段" && value !== "清空" && !STAGES.includes(value)) throw new Error(`阶段无效：${value}`);
      if (name === "判断置信度" && value !== "清空" && (!Number.isInteger(value) || value < 0 || value > 10)) throw new Error("判断置信度必须为 0-10 整数");
    }
  }
  const createTitles = new Set();
  for (const create of creates) {
    const values = create.fields || {};
    for (const name of Object.keys(values)) if (!MUTABLE_FIELDS.has(name) || name === "议题编号" || name === "状态") throw new Error(`新议题不允许写入字段：${name}`);
    for (const required of ["议题", "类型", "议题周期"]) if (!text(values[required])) throw new Error(`新议题缺少 ${required}`);
    if (!HORIZONS.slice(0, 3).includes(values["议题周期"])) throw new Error("新议题周期必须为短期、中期或长期");
    const title = text(values["议题"]);
    if (createTitles.has(title) || [...known.values()].some((issue) => text(issue["议题"]) === title)) throw new Error(`新议题重复：${title}`);
    createTitles.add(title);
  }
  for (const item of unprocessed) {
    if (!known.has(item?.issueId) || !text(item?.reason)) throw new Error(`unprocessed 议题或原因无效：${item?.issueId}`);
  }
  for (const event of events) {
    if (!known.has(event.issueId) || !EVENT_TYPES.has(event.type) || !text(event.summary) || !text(event.detail) || !text(event.increment) || !text(event.evidence) || !text(event.blockId)) throw new Error("事件缺少议题、类型、摘要、详情、增量、证据或 block ID");
    if (event.confidence != null && (!Number.isInteger(event.confidence) || event.confidence < 0 || event.confidence > 10)) throw new Error("事件变化后置信度必须为 0-10 整数");
    const escapedBlock = String(event.blockId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!evidenceInBlock(snapshot.content, event.evidence, event.blockId) || !new RegExp(`id=["']${escapedBlock}["']`).test(snapshot.content)) throw new Error(`事件证据无法在当前季度文档定位：${event.issueId}`);
    if (event.sourceLink && !snapshot.content.includes(event.sourceLink)) throw new Error("事件来源链接不在当前季度文档中");
    if (event.type === "判断更新" && (!has(event, "before") || !has(event, "after"))) throw new Error("判断更新必须包含前后判断");
  }
  const evidenceFields = new Set(["议题", "类型", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步"]);
  for (const change of changes) if ([...Object.keys(change.fields || {}), ...(change.clear || [])].some((name) => evidenceFields.has(name)) && !events.some((event) => event.issueId === change.issueId)) throw new Error(`${change.issueId} 的议题重写或判断更新必须有对应认知事件`);
  return { ...proposal, changes, creates, events, unprocessed };
}

function acquireLock(quarter) {
  const lockPath = path.join(os.tmpdir(), `learn-x-quarterly-overview-${quarter}.lock`);
  const open = () => { const fd = fs.openSync(lockPath, "wx"); fs.writeSync(fd, `${process.pid}\n`); return fd; };
  try { return { fd: open(), lockPath }; } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let alive = false;
    try { const pid = Number(fs.readFileSync(lockPath, "utf8").trim()); if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); alive = true; } } catch { alive = false; }
    if (alive) throw new Error("同一季度已有进行中的提交，请等待其完成后再重试");
    try { fs.unlinkSync(lockPath); } catch { /* stale lock removal is best effort */ }
    return { fd: open(), lockPath };
  }
}

export async function defaultRunner(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (parsed.ok !== true) throw new Error(parsed.error?.message || "lark-cli 返回失败");
  return parsed;
}

export class QuarterlyOverview {
  constructor(run = defaultRunner, config = run === defaultRunner ? readConfig() : null) { this.run = run; this.config = config; }
  async lark(args, identity = "user") { return this.run([...args, "--as", identity, "--format", "json"]); }
  async wiki(args, identity = "user") { return this.lark(["wiki", ...args], identity); }
  async fields(table) { return (await this.lark(["base", "+field-list", "--base-token", BASE_TOKEN, "--table-id", table, "--limit", "100"])).data.fields || []; }
  async blocks() { return (await this.lark(["base", "+base-block-list", "--base-token", BASE_TOKEN])).data.blocks || []; }
  async list(table, fields) {
    const rows = []; let offset = 0;
    while (true) {
      const result = await this.lark(["base", "+record-list", "--base-token", BASE_TOKEN, "--table-id", table, "--limit", "200", "--offset", String(offset), ...fields.flatMap((name) => ["--field-id", name])]);
      const data = result.data || {}; const names = data.fields || fields; const values = data.data || [];
      rows.push(...values.map((value, index) => ({ recordId: data.record_id_list?.[index], ...Object.fromEntries(names.map((name, column) => [name, value[column]])) })));
      if (!data.has_more) return rows;
      if (!values.length) throw new Error("Base 分页异常：has_more=true 但无新增记录");
      offset += values.length;
    }
  }
  async issues() { return this.list(ISSUE_TABLE, ISSUE_FIELDS); }
  async events() { return this.list(EVENT_TABLE, EVENT_FIELDS); }
  async ledgerTable() { const tables = (await this.blocks()).filter((block) => block.type === "table" && block.name === LEDGER_NAME); if (tables.length > 1) throw new Error(`季度账本存在多个同名表：${LEDGER_NAME}`); if (!tables[0]) throw new Error(`缺少机器表：${LEDGER_NAME}；先运行 setup`); return tables[0].id; }
  async ledger(quarter) { validQuarter(quarter); const table = await this.ledgerTable(); const rows = await this.list(table, LEDGER_FIELDS); const matches = rows.filter((row) => text(row["季度"]) === quarter); if (matches.length > 1) throw new Error(`同季度存在重复账本：${quarter}`); return { table, row: matches[0] || null }; }
  async write(table, id, values) { return this.lark(["base", "+record-upsert", "--base-token", BASE_TOKEN, "--table-id", table, ...(id ? ["--record-id", id] : []), "--json", JSON.stringify(values)]); }
  async nodeGet(token) { const data = (await this.wiki(["+node-get", "--node-token", token])).data || {}; return data.node || data; }
  async assertChild(token, title, parent) { const node = await this.nodeGet(token); if (node.title !== title || text(node.parent_node_token) !== String(parent) || (node.space_id && String(node.space_id) !== String(this.config.space_id))) throw new Error(`Wiki 子节点漂移：${title}`); return node; }
  async assertSpace() { const spaces = (await this.wiki(["+space-list", "--page-all"])).data?.spaces || []; const matches = spaces.filter((space) => String(space.space_id) === String(this.config.space_id)); if (matches.length !== 1 || matches[0].name !== this.config.space_name || matches[0].visibility !== "private" || matches[0].open_sharing === "open") throw new Error("核心议题 Wiki 空间名称或私有权限漂移"); }
  async children(parent) {
    const nodes = []; let pageToken = "";
    while (true) {
      const args = ["+node-list", "--space-id", this.config.space_id, "--parent-node-token", parent, "--page-size", "50"]; if (pageToken) args.push("--page-token", pageToken);
      const data = (await this.wiki(args)).data || {}; nodes.push(...(data.nodes || []));
      if (!data.has_more) return nodes;
      if (!data.page_token || data.page_token === pageToken) throw new Error("Wiki 子节点分页异常：has_more=true 但无新 page_token");
      pageToken = data.page_token;
    }
  }
  async assertRoots() {
    await this.assertSpace();
    const [overview, research] = await Promise.all([this.nodeGet(this.config.overview_node_token), this.nodeGet(this.config.research_node_token)]);
    if (overview.title !== "总览" || research.title !== "细项研究") throw new Error("Wiki 目录页名称漂移");
    if (text(overview.parent_node_token) || text(research.parent_node_token)) throw new Error("Wiki 目录页父节点漂移");
    if ((overview.space_id && String(overview.space_id) !== String(this.config.space_id)) || (research.space_id && String(research.space_id) !== String(this.config.space_id))) throw new Error("Wiki 空间漂移");
  }
  async rebuildIndex() {
    await this.assertRoots();
    const nodes = sortNodes((await this.children(this.config.overview_node_token)).filter((node) => /^核心议题总览｜\d{4}-Q[1-4]$/.test(node.title)));
    await this.lark(["docs", "+update", "--doc", this.config.overview_node_token, "--command", "overwrite", "--content", renderIndex("总览", "季度核心议题总览目录；研究正文位于子节点。", nodes, "当前暂无季度总览。")], "bot");
    const readback = await this.lark(["docs", "+fetch", "--doc", this.config.overview_node_token, "--detail", "with-ids"]);
    if (!text(readback.data?.document?.content).includes("文档索引（新 → 旧）")) throw new Error("总览目录索引回读失败");
    return { count: nodes.length };
  }
  async syncChatTab(quarter, row) {
    const setting = this.config?.chat_tab;
    const url = wikiUrl(text(row?.["Wiki 节点"]) || text(row?.["总览文档"]));
    if (!setting?.group || !setting?.name) return { group: setting?.group || "learn-x", name: setting?.name || "人生核心议题", url, status: "需重试", tabId: null, error: "季度标签配置缺失", updatedAt: new Date().toISOString() };
    if (setting.group !== "learn-x" || setting.name !== "人生核心议题") return { group: setting.group, name: setting.name, url, status: "需重试", tabId: null, error: "季度标签配置越界：只允许 learn-x/人生核心议题", updatedAt: new Date().toISOString() };
    try {
      const script = "/Users/yuwei/code/group-index/scripts/group-info.mjs";
      const { stdout } = await execFileAsync(process.execPath, [script, "sync-tab", "--group", setting.group, "--name", setting.name, "--url", url, "--type", "doc", "--apply", "--require-fresh", "--format", "json"], {
        cwd: "/Users/yuwei/code/group-index",
        env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 45_000,
      });
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const result = JSON.parse(lines.at(-1) || "{}");
      if (result.ok !== true) throw new Error(result.error || "群标签同步未确认成功");
      return { group: setting.group, name: setting.name, url, status: "已同步", tabId: result.tabId || null, error: null, updatedAt: new Date().toISOString() };
    } catch (error) {
      return { group: setting.group, name: setting.name, url, status: "需重试", tabId: null, error: String(error.message || error).slice(0, 500), updatedAt: new Date().toISOString() };
    }
  }
  async persistChatTabSync(table, row, sync) {
    const summary = { ...parseSummary(row?.["解析摘要"]), chatTabSync: sync };
    await this.write(table, row.recordId, { "解析摘要": JSON.stringify(summary) });
    const checked = await this.ledger(text(row["季度"]));
    if (!checked.row || !text(checked.row["解析摘要"])) throw new Error("季度标签同步状态写后读回失败");
    return checked.row;
  }
  async setup() {
    await this.assertRoots();
    const select = (name, options, description, defaultValue) => ({ name, type: "select", multiple: false, default_value: [defaultValue], options: options.map((option) => ({ name: option })), description });
    const ensure = async (table, spec) => { const found = (await this.fields(table)).find((fieldItem) => fieldItem.name === spec.name); if (found) { if (found.type !== spec.type || (spec.multiple != null && Boolean(found.multiple) !== Boolean(spec.multiple)) || (spec.link_table && String(found.link_table) !== String(spec.link_table)) || (spec.options && spec.options.some((option) => !(found.options || []).some((actual) => actual.name === option.name)))) throw new Error(`字段结构漂移：${spec.name}`); return found; } return (await this.lark(["base", "+field-create", "--base-token", BASE_TOKEN, "--table-id", table, "--json", JSON.stringify(spec)])).data.field; };
    let ledger = (await this.blocks()).find((block) => block.type === "table" && block.name === LEDGER_NAME);
    if (!ledger) { await this.lark(["base", "+table-create", "--base-token", BASE_TOKEN, "--name", LEDGER_NAME, "--fields", JSON.stringify([{ name: "季度", type: "text" }, { name: "总览文档", type: "text" }, { name: "Wiki 节点", type: "text" }, select("流程状态", ["待创建", "研究中", "需处理", "已提交", "已撤回"], "机器流程状态，用户无需维护。", "待创建"), { name: "当前提交标识", type: "text" }, { name: "当前文档哈希", type: "text" }, { name: "审计历史", type: "text" }, { name: "解析摘要", type: "text" }, { name: "创建的议题", type: "text" }])]); ledger = (await this.blocks()).find((block) => block.type === "table" && block.name === LEDGER_NAME); }
    if (!ledger) throw new Error("季度账本创建后无法定位");
    for (const spec of [{ name: "创建时间", type: "created_at" }, { name: "更新时间", type: "updated_at" }]) await ensure(ledger.id, spec);
    await ensure(EVENT_TABLE, { name: "有效性", type: "select", multiple: false, default_value: ["有效"], options: ["有效", "待生效", "已撤回"].map((name) => ({ name })), description: "追加历史的当前有效性；撤回不删除事件。" });
    await ensure(EVENT_TABLE, { name: "来源季度总览", type: "link", link_table: ledger.id, bidirectional: false, description: "本事件来自的季度总览审计记录。" });
    const fields = await this.fields(ledger.id); const required = [["季度", "text"], ["总览文档", "text"], ["Wiki 节点", "text"], ["流程状态", "select"], ["当前提交标识", "text"], ["当前文档哈希", "text"], ["审计历史", "text"], ["解析摘要", "text"], ["创建的议题", "text"], ["创建时间", "created_at"], ["更新时间", "updated_at"]]; for (const [name, type] of required) { const found = fields.find((fieldItem) => fieldItem.name === name); if (!found || found.type !== type) throw new Error(`季度账本字段结构漂移：${name}`); } const statusField = fields.find((fieldItem) => fieldItem.name === "流程状态"); if (["待创建", "研究中", "需处理", "已提交", "已撤回"].some((option) => !(statusField.options || []).some((actual) => actual.name === option))) throw new Error("季度账本流程状态选项漂移");
    const eventFields = await this.fields(EVENT_TABLE); if (!eventFields.some((fieldItem) => fieldItem.name === "来源季度总览" && fieldItem.type === "link")) throw new Error("事件来源季度总览字段缺失");
    return { table: ledger.id, spaceId: this.config.space_id, overviewNode: this.config.overview_node_token };
  }
  async create(quarter) {
    validQuarter(quarter); await this.assertRoots(); const { table, row } = await this.ledger(quarter);
    if (row && text(row["总览文档"])) {
      if (text(row["Wiki 节点"])) await this.assertChild(text(row["Wiki 节点"]), `核心议题总览｜${quarter}`, this.config.overview_node_token);
      await this.rebuildIndex();
      const chatTabSync = await this.syncChatTab(quarter, row);
      const checkedRow = await this.persistChatTabSync(table, row, chatTabSync);
      return { document: wikiUrl(text(row["Wiki 节点"]) || text(row["总览文档"])), token: text(row["总览文档"]), wikiToken: text(row["Wiki 节点"]), reused: true, chatTabSync, ledgerId: checkedRow.recordId };
    }
    const title = `核心议题总览｜${quarter}`; const baseDuplicate = (await this.blocks()).some((block) => block.type === "docx" && block.name === title); if (baseDuplicate) throw new Error("同季度已有 Base Docx 同名总览，拒绝与 Wiki 产生双端副本");
    const issues = await this.issues(); const matches = (await this.children(this.config.overview_node_token)).filter((node) => node.title === title); if (matches.length > 1) throw new Error("同季度存在多个同名总览");
    let node = matches[0]; let created = false; if (!node) { const result = await this.wiki(["+node-create", "--space-id", this.config.space_id, "--parent-node-token", this.config.overview_node_token, "--title", title, "--obj-type", "docx"], "bot"); node = result.data?.node || result.data; created = true; }
    if (!node?.node_token) throw new Error("季度总览 Wiki 节点创建后无法定位"); await this.assertChild(node.node_token, title, this.config.overview_node_token); const docToken = node.obj_token || node.objToken || node.node_token;
    const existing = created ? "" : text((await this.lark(["docs", "+fetch", "--doc", docToken, "--detail", "with-ids"])).data?.document?.content); const stable = existing.includes(`核心议题总览｜${quarter}`) && (existing.includes("季度回填锚点：quarterly-fillback") || /data-anchor=["']quarterly-fillback["']/.test(existing));
    if (!created && existing && !stable) throw new Error("同名总览缺少稳定标题或模板锚点，拒绝覆盖");
    if (created || !existing) await this.lark(["docs", "+update", "--doc", docToken, "--command", "overwrite", "--content", renderOverview(quarter, issues)], "bot");
    const readback = await this.lark(["docs", "+fetch", "--doc", docToken, "--detail", "with-ids"]); const content = text(readback.data?.document?.content); if (!content.includes(`核心议题总览｜${quarter}`) || !/quarterly-fillback/.test(content)) throw new Error("季度总览写后读回失败");
    await this.rebuildIndex(); const saved = await this.write(table, row?.recordId, { "季度": quarter, "总览文档": docToken, "Wiki 节点": node.node_token, "流程状态": "研究中" }); const ledgerId = row?.recordId || recordId(saved); const checked = await this.ledger(quarter); if (!checked.row || text(checked.row["总览文档"]) !== docToken || text(checked.row["Wiki 节点"]) !== node.node_token) throw new Error("季度账本写后读回失败");
    const chatTabSync = await this.syncChatTab(quarter, checked.row); await this.persistChatTabSync(table, checked.row, chatTabSync);
    return { document: wikiUrl(node.node_token), token: docToken, wikiToken: node.node_token, ledgerId, issueCount: issues.length, chatTabSync };
  }
  async snapshot(quarter) {
    await this.assertRoots(); const { row } = await this.ledger(quarter); if (!row || !text(row["总览文档"])) throw new Error("本季度尚未创建总览"); const token = text(row["总览文档"]); if (text(row["Wiki 节点"])) await this.assertChild(text(row["Wiki 节点"]), `核心议题总览｜${quarter}`, this.config.overview_node_token); const result = await this.lark(["docs", "+fetch", "--doc", token, "--detail", "with-ids"]); const document = result.data?.document || {}; if (!Number.isInteger(document.revision_id)) throw new Error("文档缺少稳定 revision"); const issues = await this.issues(); const content = text(document.content); return { quarter, documentToken: token, wikiToken: text(row["Wiki 节点"]), revisionId: Number(document.revision_id), hash: hash(content), baseHash: baseHash(issues), content, issues };
  }
  async assertSnapshot(expected) { const latest = await this.snapshot(expected.quarter); if (latest.revisionId !== expected.revisionId || latest.hash !== expected.hash || latest.baseHash !== expected.baseHash) throw new Error("文档或 Base 在提交前已变化；请重新解析最新版本"); }
  async apply(proposal) {
    const snapshot = await this.snapshot(proposal.quarter); const { table, row } = await this.ledger(proposal.quarter); if (text(row["流程状态"]) === "已提交" && text(row["当前文档哈希"]) === snapshot.hash) { if (proposal.documentToken !== snapshot.documentToken || Number(proposal.revisionId) !== Number(snapshot.revisionId)) throw new Error("proposal 不是当前文档 revision"); return JSON.parse(text(row["解析摘要"]) || "{}"); }
    const submissionId = `QOV:${proposal.quarter}:${snapshot.documentToken}:${snapshot.hash}`; const priorHistory = JSON.parse(text(row["审计历史"]) || "[]"); const priorAudit = priorHistory.find((entry) => entry.submissionId === submissionId && entry.createdValues?.length); let proposalForValidation = proposal;
    if (priorAudit) {
      const priorTitles = new Set(priorAudit.createdValues.map((entry) => text(entry.values?.["议题"])));
      const submittedTitles = new Set((proposal.creates || []).map((entry) => text(entry.fields?.["议题"])));
      if (priorTitles.size !== submittedTitles.size || [...priorTitles].some((title) => !submittedTitles.has(title))) throw new Error("同一提交的创建议题与历史不一致，拒绝重复创建");
      proposalForValidation = { ...proposal, creates: [] };
    }
    const checked = validateProposal(proposalForValidation, snapshot); if (priorAudit) checked.creates = proposal.creates || []; const latest = await this.snapshot(proposal.quarter); if (latest.revisionId !== snapshot.revisionId || latest.hash !== snapshot.hash || latest.baseHash !== snapshot.baseHash) throw new Error("文档或 Base 在解析期间已变化；请重新解析最新版本"); const lock = acquireLock(proposal.quarter);
    try {
      await this.assertSnapshot(snapshot);
      const history = JSON.parse(text(row["审计历史"]) || "[]"); const current = new Map(snapshot.issues.map((issue) => [text(issue["议题编号"]), issue])); const existing = history.find((entry) => entry.submissionId === submissionId); if (existing?.status === "已提交") { const summary = JSON.parse(text(row["解析摘要"]) || "{}"); if (text(row["流程状态"]) !== "已提交") { await this.write(table, row.recordId, { "流程状态": "已提交", "当前提交标识": submissionId, "当前文档哈希": snapshot.hash, "解析摘要": JSON.stringify(summary) }); const healed = await this.ledger(proposal.quarter); if (text(healed.row?.["流程状态"]) !== "已提交") throw new Error("季度账本幂等恢复读回不一致"); } return summary; } if (existing && (JSON.stringify(existing.changes || []) !== JSON.stringify(checked.changes) || JSON.stringify(existing.creates || []) !== JSON.stringify(checked.creates) || JSON.stringify(existing.eventSourceIds || []) !== JSON.stringify(checked.events.map((event) => eventSourceId(submissionId, event))))) throw new Error("同一 revision 的待处理提交内容已变化，拒绝覆盖审计记录");
      const before = existing?.before || Object.fromEntries(checked.changes.map((change) => [change.issueId, Object.fromEntries([...new Set([...Object.keys(change.fields || {}), ...(change.clear || [])])].map((name) => [name, current.get(change.issueId)?.[name]]))]));
      const audit = existing || { submissionId, revisionId: snapshot.revisionId, hash: snapshot.hash, before, changes: checked.changes, creates: checked.creates, createdIssueIds: [], createdValues: [], eventSourceIds: checked.events.map((event) => eventSourceId(submissionId, event)), status: "需处理" };
      const saveAudit = async (status = "需处理") => { audit.status = status; const next = [...history.filter((entry) => entry.submissionId !== submissionId), audit]; await this.write(table, row.recordId, { "流程状态": status, "当前提交标识": submissionId, "当前文档哈希": snapshot.hash, "审计历史": JSON.stringify(next) }); };
      await saveAudit();
      const createdIds = [...(audit.createdIssueIds || [])];
      for (let index = createdIds.length; index < checked.creates.length; index += 1) { const values = { ...(checked.creates[index].fields || {}), "优先级": checked.creates[index].fields["优先级"] || "P1", "研究状态": checked.creates[index].fields["研究状态"] || "继续研究" }; const saved = await this.write(ISSUE_TABLE, null, values); const id = recordId(saved); if (!id) throw new Error("新议题创建后缺少记录 ID"); createdIds.push(id); audit.createdValues.push({ id, values }); audit.createdIssueIds = createdIds; await saveAudit(); }
      const issuesBeforeWrite = await this.issues(); const byId = new Map(issuesBeforeWrite.map((issue) => [text(issue["议题编号"]), issue]));
      if (existing && audit.createdValues?.length) {
        for (const created of audit.createdValues) {
          const issue = issuesBeforeWrite.find((item) => item.recordId === created.id);
          if (!issue) throw new Error(`季度提交创建的议题已不存在：${created.id}`);
          for (const [name, value] of Object.entries(created.values || {})) {
            const currentValue = text(issue[name]);
            if (currentValue !== text(value) && !(name === "研究状态" && currentValue === "关闭研究" && text(value) === "继续研究")) throw new Error(`人工并发修改，无法恢复创建的议题：${created.id}/${name}`);
          }
          await this.write(ISSUE_TABLE, created.id, created.values);
        }
      }
      for (const change of checked.changes) { const issue = byId.get(change.issueId); if (!issue) throw new Error(`议题在提交期间消失：${change.issueId}`); const patch = patchForChange(change); for (const name of Object.keys(patch)) { const expectedBefore = before[change.issueId]?.[name]; const expectedAfter = patch[name]; if (text(issue[name]) !== text(expectedBefore) && text(issue[name]) !== text(expectedAfter)) throw new Error(`人工并发修改，无法替换：${change.issueId}/${name}`); } await this.write(ISSUE_TABLE, issue.recordId, patch); const readback = (await this.issues()).find((item) => item.recordId === issue.recordId); for (const [name, value] of Object.entries(patch)) if (text(readback?.[name]) !== text(value ?? "")) throw new Error(`议题写后读回不一致：${change.issueId}/${name}`); }
      const events = await this.events(); const eventIds = []; for (const [index, event] of checked.events.entries()) { const sourceId = audit.eventSourceIds[index]; const known = events.find((item) => text(item["来源标识"]) === sourceId); if (known) { eventIds.push(text(known["事件编号"]) || known.recordId); continue; } const issue = byId.get(event.issueId); if (!issue) throw new Error(`事件关联议题在提交期间消失：${event.issueId}`); const saved = await this.write(EVENT_TABLE, null, { "内容摘要": event.summary, "详细内容": event.detail, "认知增量": event.increment, "关联议题": [{ id: issue.recordId }], "事件类型": event.type, "变更前": event.before || null, "变更后": event.after || null, "变化后置信度": event.confidence ?? null, "来源系统": event.sourceSystem || null, "来源标识": sourceId, "来源链接": event.sourceLink || null, "有效性": "待生效", "来源季度总览": [{ id: row.recordId }] }); const id = recordId(saved); if (!id) throw new Error(`事件创建后缺少记录 ID：${sourceId}`); eventIds.push(id); }
      for (const sourceId of audit.eventSourceIds) { const event = (await this.events()).find((item) => text(item["来源标识"]) === sourceId); if (!event) throw new Error(`事件创建后丢失：${sourceId}`); if (text(event["有效性"]) !== "有效") { await this.write(EVENT_TABLE, event.recordId, { "有效性": "有效" }); const readback = (await this.events()).find((item) => item.recordId === event.recordId); if (text(readback?.["有效性"]) !== "有效") throw new Error(`事件有效性读回不一致：${sourceId}`); } }
      audit.createdIssueIds = createdIds; audit.status = "已提交"; const result = { quarter: proposal.quarter, revision: snapshot.revisionId, submissionId, hash: snapshot.hash.slice(0, 12), createdIssueIds: createdIds, events: eventIds, changes: checked.changes.map((change) => change.issueId), unprocessed: checked.unprocessed }; await this.write(table, row.recordId, { "流程状态": "已提交", "当前提交标识": submissionId, "当前文档哈希": snapshot.hash, "审计历史": JSON.stringify([...history.filter((entry) => entry.submissionId !== submissionId), audit]), "解析摘要": JSON.stringify(result), "创建的议题": JSON.stringify(createdIds) }); const landed = await this.ledger(proposal.quarter); if (text(landed.row?.["流程状态"]) !== "已提交" || text(landed.row?.["当前文档哈希"]) !== snapshot.hash) throw new Error("季度账本提交状态读回不一致"); return result;
    } catch (error) { try { const latest = await this.ledger(proposal.quarter); if (latest.row) await this.write(latest.table, latest.row.recordId, { "流程状态": "需处理" }); } catch { /* preserve original failure */ } throw error; } finally { fs.closeSync(lock.fd); try { fs.unlinkSync(lock.lockPath); } catch { /* best effort */ } }
  }
  async rollback(quarter) {
    const lock = acquireLock(quarter);
    try {
      const { table, row } = await this.ledger(quarter); const history = JSON.parse(text(row?.["审计历史"]) || "[]"); const previous = [...history].reverse().find((entry) => entry.status === "已提交"); if (!previous) throw new Error("没有可撤回的已提交季度版本"); const issues = await this.issues();
      for (const change of previous.changes || previous.after || []) { const issue = issues.find((item) => text(item["议题编号"]) === change.issueId); if (!issue) throw new Error(`议题已不存在，无法撤回：${change.issueId}`); const patch = patchForChange(change); for (const name of Object.keys(patch)) { const before = previous.before?.[change.issueId]?.[name]; const after = patch[name]; if (text(issue[name]) !== text(before) && text(issue[name]) !== text(after)) throw new Error(`人工并发修改，无法撤回：${change.issueId}/${name}`); } }
      for (const change of previous.changes || previous.after || []) { const issue = issues.find((item) => text(item["议题编号"]) === change.issueId); const restore = {}; for (const name of Object.keys(patchForChange(change))) restore[name] = previous.before?.[change.issueId]?.[name] ?? null; await this.write(ISSUE_TABLE, issue.recordId, restore); }
      for (const created of previous.createdValues || []) { const issue = issues.find((item) => item.recordId === created.id); if (!issue) continue; for (const [name, value] of Object.entries(created.values || {})) if (text(issue[name]) !== text(value)) throw new Error(`新议题已被人工修改，无法关闭：${created.id}/${name}`); await this.write(ISSUE_TABLE, created.id, { "研究状态": "关闭研究" }); }
      const restoredIssues = await this.issues(); for (const change of previous.changes || previous.after || []) { const issue = restoredIssues.find((item) => text(item["议题编号"]) === change.issueId); for (const name of Object.keys(patchForChange(change))) if (text(issue?.[name]) !== text(previous.before?.[change.issueId]?.[name] ?? "")) throw new Error(`撤回字段读回不一致：${change.issueId}/${name}`); }
      for (const created of previous.createdValues || []) { const issue = restoredIssues.find((item) => item.recordId === created.id); if (issue && text(issue["研究状态"]) !== "关闭研究") throw new Error(`新议题关闭状态读回不一致：${created.id}`); }
      for (const sourceId of previous.eventSourceIds || []) { const event = (await this.events()).find((item) => text(item["来源标识"]) === sourceId); if (event && text(event["有效性"]) !== "已撤回") { await this.write(EVENT_TABLE, event.recordId, { "有效性": "已撤回" }); const readback = (await this.events()).find((item) => item.recordId === event.recordId); if (text(readback?.["有效性"]) !== "已撤回") throw new Error(`事件撤回读回不一致：${sourceId}`); } }
      previous.status = "已撤回"; await this.write(table, row.recordId, { "流程状态": "已撤回", "审计历史": JSON.stringify(history), "解析摘要": JSON.stringify({ quarter, withdrawn: previous.submissionId }) }); const landed = await this.ledger(quarter); if (text(landed.row?.["流程状态"]) !== "已撤回") throw new Error("季度撤回账本读回不一致"); return { quarter, withdrawn: previous.submissionId };
    } finally { fs.closeSync(lock.fd); try { fs.unlinkSync(lock.lockPath); } catch { /* best effort */ } }
  }
  async syncTab(quarter) { validQuarter(quarter); await this.assertRoots(); const { table, row } = await this.ledger(quarter); if (!row || !text(row["总览文档"])) throw new Error("本季度尚未创建总览"); const chatTabSync = await this.syncChatTab(quarter, row); await this.persistChatTabSync(table, row, chatTabSync); return { quarter, document: wikiUrl(text(row["Wiki 节点"]) || text(row["总览文档"])), chatTabSync }; }
  async status(quarter) { const { row } = await this.ledger(quarter); return row ? Object.fromEntries(LEDGER_FIELDS.map((name) => [name, row[name]])) : { quarter, status: "不存在" }; }
}

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const stdin = async () => { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); };
async function main() { const [command] = process.argv.slice(2); const quarter = arg("--quarter"); const app = new QuarterlyOverview(); let output; if (command === "setup") output = await app.setup(); else if (command === "create") output = await app.create(quarter); else if (command === "sync-tab") output = await app.syncTab(quarter); else if (command === "snapshot") output = await app.snapshot(quarter); else if (command === "apply") { const raw = arg("--proposal-json"); output = await app.apply(JSON.parse(raw === "-" ? await stdin() : raw)); } else if (command === "rollback") output = await app.rollback(quarter); else if (command === "status") output = await app.status(quarter); else throw new Error("用法：setup | create --quarter YYYY-QN | sync-tab --quarter YYYY-QN | snapshot --quarter YYYY-QN | apply --proposal-json - | rollback --quarter YYYY-QN | status --quarter YYYY-QN"); process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); }
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

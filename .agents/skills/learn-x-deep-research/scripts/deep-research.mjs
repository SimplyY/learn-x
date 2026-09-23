import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig, escapeXml, wikiUrl } from "../../../lib/inquiry-wiki.mjs";

const execFileAsync = promisify(execFile);
export const BASE_TOKEN = "W6NLbDh1YahvZ9sbjIccEirBnae";
export const ISSUE_TABLE = "tbllcm6oBbdMKnkN";
export const EVENT_TABLE = "tblIE9FK9mWGv7GE";
export const YEAR_DIR_RE = /^深度研究-(\d{4})$/;
export const ISSUE_FIELDS = ["议题编号", "议题", "类型", "状态", "阶段", "议题周期", "优先级", "研究状态", "当前判断", "判断置信度", "最大未知", "改变判断的条件", "下一步", "更新时间"];
export const EVENT_FIELDS = ["事件编号", "关联议题", "事件类型", "内容摘要", "认知增量", "有效性", "创建时间", "更新时间"];
// 深度研究是按需发生的一等对象：Base 零写入（事件由人在认知事件表记录，来源链接指向本文档）。
export const HORIZONS = ["短期", "中期", "长期", "未分类"];
const PRIORITIES = ["P0", "P1", "P2"];

export const text = (value) => String(Array.isArray(value) ? value[0] ?? "" : value?.name ?? value?.text ?? value ?? "").trim();
export const linkIds = (value) => (Array.isArray(value) ? value : [value]).map((item) => String(item?.id ?? item?.record_id ?? item ?? "")).filter(Boolean);
const xml = (value) => escapeXml(String(value ?? "").trim());
const iso = (value) => { const date = value && new Date(value); return date && !Number.isNaN(date.getTime()) ? date : null; };

export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const effectiveHorizon = (issue) => HORIZONS.includes(text(issue["议题周期"])) ? text(issue["议题周期"]) : "未分类";
const effectivePriority = (issue) => PRIORITIES.includes(text(issue["优先级"])) ? text(issue["优先级"]) : "P1";

export function eventsOf(events, issue) {
  return events
    .filter((event) => text(event["有效性"]) !== "已撤回" && linkIds(event["关联议题"]).includes(issue.recordId))
    .map((event) => ({ event, at: iso(event["更新时间"]) || iso(event["创建时间"]) || new Date(0) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
    .map(({ event, at }) => `[${text(event["事件类型"])}] ${at.toISOString().slice(0, 10)} ${text(event["内容摘要"])}`);
}

export function renderResearch(topic, question, issues, events) {
  const field = (label, value) => `<p><b>${label}：</b>${xml(value || "")}</p>`;
  const section = (issue) => {
    const history = eventsOf(events, issue);
    return `<h3>[${xml(issue["议题编号"])}] ${xml(issue["议题"])}</h3>${field("类型｜周期｜优先级", `${text(issue["类型"]) || "未分类"}｜${effectiveHorizon(issue)}｜${effectivePriority(issue)}`)}${field("当前判断", issue["当前判断"])}${field("判断置信度", issue["判断置信度"])}${field("最大未知", issue["最大未知"])}${field("改变判断的条件", issue["改变判断的条件"])}${field("下一步", issue["下一步"])}<p><b>近期认知事件：</b></p>${history.length ? `<ul>${history.map((line) => `<li>${xml(line)}</li>`).join("")}</ul>` : "<p>暂无</p>"}`;
  };
  const linked = issues.length ? `<ul>${issues.map((issue) => `<li>[${xml(issue["议题编号"])}] ${xml(issue["议题"])}</li>`).join("")}</ul>` : "<p>无（来自临时问题或现实经历）</p>";
  return `<title>${xml(topic)}</title><h1>${xml(topic)}</h1><callout emoji="🧭" background-color="light-blue" border-color="blue"><p>一次深度研究 = 一篇文档。模板只固定检查点，研究主体按问题需要自由展开。</p><p>研究造成真正认知变化时，在 Base「认知事件」新建记录（来源链接填本文档，来源系统选 Learn-X）；没有变化就不产生事件。</p></callout><h2>研究问题</h2><p>${xml(question || topic)}</p><h2>为什么现在研究</h2><p><b>触发背景：</b></p><p></p><p><b>关联议题：</b></p>${linked}<h2>当前认知（研究开始前）</h2>${issues.map(section).join("") || "<p>无关联议题。</p>"}<h2>研究主体</h2><callout emoji="📝" background-color="light-gray" border-color="gray"><p>自由研究区：允许混乱、停顿和反复，不强制固定章节。</p></callout><p></p><h2>反证与未知</h2><p>哪些证据可能推翻当前判断？哪些问题仍然无法回答？</p><p></p><h2>阶段性结论</h2><p>目前能确定什么？哪些只是推断？</p><p></p><h2>认知变化</h2><p>与研究前相比：哪些判断改变或得到加强？哪些问题被重构？是否产生新的决策、行动或实验？</p><p></p><h2>下一步</h2><p>还有什么值得继续研究、验证或行动？</p><p></p>`;
}

export function sortIndex(nodes) {
  return [...nodes].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh"));
}

export function renderIndexPage(nodes, year) {
  const links = sortIndex(nodes).map((node) => `<p><a href="${wikiUrl(node.node_token || node.token)}">${escapeXml(node.title)}</a></p>`).join("");
  return `<title>深度研究-${year}</title><h1>深度研究-${year}</h1><p>按需发生的深度研究目录；每次研究一篇文档，研究正文位于子节点。Base「认知事件」通过来源链接引用这里的研究。</p><h2>文档索引</h2>${links || "<p>当前暂无深度研究。</p>"}`;
}

export function renderContextPack(issues, events, researchNodes) {
  const lines = ["# ChatGPT 深度研究上下文", "", "## 已有研究", researchNodes.length ? researchNodes.map((node) => `- ${node.title}`).join("\n") : "- 暂无"];
  for (const issue of issues) {
    const history = eventsOf(events, issue);
    lines.push("", `## [${text(issue["议题编号"])}] ${text(issue["议题"])}`, `- 类型｜周期｜优先级：${text(issue["类型"]) || "未分类"}｜${effectiveHorizon(issue)}｜${effectivePriority(issue)}`, `- 当前判断：${text(issue["当前判断"]) || "（未维护）"}`, `- 判断置信度：${text(issue["判断置信度"]) || "（未维护）"}`, `- 最大未知：${text(issue["最大未知"]) || "（未维护）"}`, `- 改变判断的条件：${text(issue["改变判断的条件"]) || "（未维护）"}`, `- 下一步：${text(issue["下一步"]) || "（未维护）"}`, "- 近期认知事件：", history.length ? history.map((line) => `  - ${line}`).join("\n") : "  - 暂无");
  }
  return lines.join("\n");
}

export async function defaultRunner(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (parsed.ok !== true) throw new Error(parsed.error?.message || "lark-cli 返回失败");
  return parsed;
}

export class DeepResearch {
  constructor(run = defaultRunner, config = run === defaultRunner ? readConfig() : null) {
    this.run = run; this.config = config;
  }
  async lark(args, identity = "user") { return this.run([...args, "--as", identity, "--format", "json"]); }
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
  issues() { return this.list(ISSUE_TABLE, ISSUE_FIELDS); }
  events() { return this.list(EVENT_TABLE, EVENT_FIELDS); }
  async wiki(args, identity = "user") { return this.lark(["wiki", ...args], identity); }
  async node(token) { const data = (await this.wiki(["+node-get", "--node-token", token])).data || {}; return data.node || data; }
  async listNodes(parentToken = "") {
    const nodes = []; let pageToken = "";
    while (true) {
      const args = ["+node-list", "--space-id", this.config.space_id, "--page-size", "50"];
      if (parentToken) args.push("--parent-node-token", parentToken);
      if (pageToken) args.push("--page-token", pageToken);
      const data = (await this.wiki(args)).data || {}; nodes.push(...(data.nodes || []));
      if (!data.has_more) return nodes;
      if (!data.page_token || data.page_token === pageToken) throw new Error("Wiki 子节点分页异常：has_more=true 但无新 page_token");
      pageToken = data.page_token;
    }
  }
  topLevelNodes() { return this.listNodes(); }
  async wikiChildren(token) { return this.listNodes(token); }
  async yearNodes() {
    const years = (await this.topLevelNodes()).filter((node) => YEAR_DIR_RE.test(node.title));
    return years.sort((a, b) => b.title.localeCompare(a.title));
  }
  async assertWikiRoots() {
    const spaces = (await this.wiki(["+space-list", "--page-all"])).data?.spaces || [];
    const matches = spaces.filter((space) => String(space.space_id) === String(this.config.space_id));
    if (matches.length !== 1 || matches[0].name !== this.config.space_name || matches[0].visibility !== "private" || matches[0].open_sharing === "open") throw new Error("核心议题 Wiki 空间名称或私有权限漂移");
    const [overview, research] = await Promise.all([this.node(this.config.overview_node_token), this.node(this.config.research_node_token)]);
    if (overview.title !== this.config.overview_name || research.title !== this.config.research_name) throw new Error("核心议题 Wiki 目录漂移");
    if (text(overview.parent_node_token) || text(research.parent_node_token)) throw new Error("核心议题 Wiki 目录父节点漂移");
  }
  async ensureYearDir(year) {
    const dir = (await this.topLevelNodes()).find((node) => node.title === `深度研究-${year}`);
    if (dir) return dir;
    const result = await this.wiki(["+node-create", "--space-id", this.config.space_id, "--title", `深度研究-${year}`, "--obj-type", "docx"], "bot");
    const created = result.data?.node || result.data;
    if (!created?.node_token) throw new Error(`深度研究-${year} 目录创建后无法定位`);
    return created;
  }
  async docContent(token) { return text((await this.lark(["docs", "+fetch", "--doc", token, "--detail", "with-ids"])).data?.document?.content); }
  async rebuildIndex() {
    await this.assertWikiRoots();
    const index = {};
    for (const dir of await this.yearNodes()) {
      const year = dir.title.match(YEAR_DIR_RE)[1];
      const nodes = sortIndex(await this.wikiChildren(dir.node_token));
      await this.lark(["docs", "+update", "--doc", dir.node_token, "--command", "overwrite", "--content", renderIndexPage(nodes, year)], "bot");
      const written = await this.docContent(dir.node_token);
      if (!written.includes("文档索引")) throw new Error(`深度研究-${year} 目录页回读失败`);
      index[year] = nodes.map((node) => node.title);
    }
    return index;
  }
  async create({ topic, question = "", issueIds = [] }) {
    topic = String(topic || "").trim();
    if (!topic) throw new Error("请提供研究主题 --title");
    await this.assertWikiRoots();
    const allIssues = await this.issues();
    const issues = [...new Set(issueIds)].map((id) => { const issue = allIssues.find((item) => text(item["议题编号"]) === id); if (!issue) throw new Error(`未找到议题：${id}`); return issue; });
    const events = issues.length ? await this.events() : [];
    const year = today().slice(0, 4);
    const yearDirs = await this.yearNodes();
    const dir = yearDirs.find((node) => node.title === `深度研究-${year}`) || await this.ensureYearDir(year);
    const allNodes = [];
    for (const node of yearDirs) allNodes.push(...(await this.wikiChildren(node.node_token)));
    const matches = allNodes.filter((node) => node.title === topic);
    if (matches.length > 1) throw new Error("跨年存在多个同名深度研究文档，请先人工合并或改名");
    let node = matches[0]; let created = false;
    if (!node) {
      const result = await this.wiki(["+node-create", "--space-id", this.config.space_id, "--parent-node-token", dir.node_token, "--title", topic, "--obj-type", "docx"], "bot");
      node = result.data?.node || result.data; created = true;
    }
    if (!node?.node_token) throw new Error("深度研究 Wiki 节点创建后无法定位");
    const token = node.obj_token || node.objToken || node.node_token;
    if (!created && (await this.docContent(token)).replace(/<[^>]+>/g, "").replace(topic, "").trim()) {
      const index = await this.rebuildIndex();
      return { document: wikiUrl(node.node_token), wikiToken: node.node_token, topic, question: question || topic, issues: issues.map((issue) => ({ id: text(issue["议题编号"]), title: text(issue["议题"]) })), created: false, recovered: true, indexTitles: index };
    }
    await this.lark(["docs", "+update", "--doc", token, "--command", "overwrite", "--content", renderResearch(topic, question, issues, events)], "bot");
    const readback = await this.docContent(token);
    if (!readback.includes(topic) || !issues.every((issue) => readback.includes(`[${text(issue["议题编号"])}]`))) throw new Error("深度研究文档回读失败");
    const index = await this.rebuildIndex();
    return { document: wikiUrl(node.node_token), wikiToken: node.node_token, topic, question: question || topic, issues: issues.map((issue) => ({ id: text(issue["议题编号"]), title: text(issue["议题"]) })), created, indexTitles: index };
  }
  async contextPack({ issueIds = [] } = {}) {
    await this.assertWikiRoots();
    const allIssues = await this.issues();
    const issues = issueIds.length ? issueIds.map((id) => { const issue = allIssues.find((item) => text(item["议题编号"]) === id); if (!issue) throw new Error(`未找到议题：${id}`); return issue; }) : allIssues.filter((issue) => text(issue["状态"]) === "活跃");
    const events = await this.events();
    const researchNodes = [];
    for (const dir of await this.yearNodes()) researchNodes.push(...(await this.wikiChildren(dir.node_token)));
    return renderContextPack(issues, events, researchNodes);
  }
  async setup() {
    await this.ensureYearDir(today().slice(0, 4));
    return { yearDirs: await this.rebuildIndex() };
  }
}

function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const argList = (name) => { const values = []; for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name) values.push(process.argv[index + 1]); return values.filter(Boolean); };

async function main() {
  const [command] = process.argv.slice(2);
  const app = new DeepResearch();
  let output;
  if (command === "setup") output = await app.setup();
  else if (command === "create") output = await app.create({ topic: arg("--title"), question: arg("--question") || "", issueIds: argList("--issue-id") });
  else if (command === "context") output = await app.contextPack({ issueIds: argList("--issue-id") });
  else if (command === "index") output = await app.rebuildIndex();
  else throw new Error("用法：setup | create --title 主题 [--issue-id IQ-0001]... [--question 一句话问题] | context [--issue-id IQ-0001]... | index");
  process.stdout.write(`${typeof output === "string" ? output : JSON.stringify(output, null, 2)}\n`);
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

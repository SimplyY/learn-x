import assert from "node:assert/strict";
import test from "node:test";
import { DeepResearch, renderContextPack, renderIndexPage, renderResearch, researchTitle, sortIndex, TITLE_RE, eventsOf } from "./deep-research.mjs";

const issue = (id, overrides = {}) => ({ recordId: `rec-${id}`, "议题编号": `IQ-${id}`, "议题": `问题 ${id}`, "类型": "长期问题", "状态": "活跃", "优先级": "P1", "研究状态": "继续研究", "当前判断": "旧判断", "最大未知": "未知 A", ...overrides });
const event = (id, overrides = {}) => ({ recordId: `rec-ev-${id}`, "事件编号": `EV-${id}`, "关联议题": [{ id: "rec-0001" }], "事件类型": "判断更新", "内容摘要": `事件 ${id} 摘要`, "有效性": "有效", "创建时间": `2026-0${id}-01T10:00:00+08:00`, "更新时间": `2026-0${id}-01T10:00:00+08:00`, ...overrides });

test("research title round-trips through the index pattern", () => {
  const title = researchTitle("2026-09-17", "AI 时代的自处");
  assert.match(title, TITLE_RE);
  assert.equal(title.match(TITLE_RE)[1], "2026-09-17");
  assert.equal(title.match(TITLE_RE)[2], "AI 时代的自处");
  assert.equal("月度议题研究工作台｜2026-09".match(TITLE_RE), null);
});

test("index keeps every same-day research and sorts newest first", () => {
  const nodes = [
    { node_token: "a", title: "深度研究｜2026-09-17｜主题 B" },
    { node_token: "b", title: "深度研究｜2026-09-17｜主题 A" },
    { node_token: "c", title: "深度研究｜2026-09-01｜主题 C" },
    { node_token: "d", title: "月度议题研究工作台｜2026-09" },
  ];
  const research = nodes.filter((node) => TITLE_RE.test(node.title));
  const sorted = sortIndex(research);
  assert.deepEqual(sorted.map((node) => node.node_token), ["a", "b", "c"]);
  const html = renderIndexPage(nodes);
  assert.match(html, /主题 B/);
  assert.match(html, /主题 A/);
  assert.match(html, /主题 C/);
  assert.doesNotMatch(html, /月度议题研究工作台/);
  assert.ok(html.indexOf("主题 B") < html.indexOf("主题 A"));
  assert.ok(html.indexOf("主题 A") < html.indexOf("主题 C"));
});

test("research template injects issue context and event history with escaping", () => {
  const issues = [issue("0001", { "议题": "A < B & C", "当前判断": "保持主体性" })];
  const events = [event(1), event(2, { "有效性": "已撤回" })];
  const html = renderResearch("2026-09-17", "主题", "一句话问题", issues, events);
  assert.match(html, /深度研究｜2026-09-17｜主题/);
  assert.match(html, /一句话问题/);
  for (const marker of ["研究问题", "为什么现在研究", "当前认知（研究开始前）", "研究主体", "反证与未知", "阶段性结论", "认知变化", "下一步"]) assert.ok(html.includes(marker), marker);
  assert.match(html, /A &lt; B &amp; C/);
  assert.match(html, /保持主体性/);
  assert.match(html, /未知 A/);
  assert.match(html, /事件 1 摘要/);
  assert.doesNotMatch(html, /事件 2 摘要/);
  assert.match(html, /自由研究区/);
  assert.match(html, /来源链接填本文档/);
  const empty = renderResearch("2026-09-17", "主题", "", [], []);
  assert.match(empty, /来自临时问题或现实经历/);
});

test("events of an issue are newest first and capped at five", () => {
  const target = issue("0001");
  const many = [1, 2, 3, 4, 5, 6, 7].map((id) => event(id));
  const lines = eventsOf(many, target);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /事件 7 摘要/);
  assert.deepEqual(eventsOf(many, issue("0002")), []);
});

test("context pack lists research history and issue snapshot", () => {
  const pack = renderContextPack([issue("0001")], [event(1)], [{ title: "深度研究｜2026-09-01｜旧研究" }]);
  assert.match(pack, /# ChatGPT 深度研究上下文/);
  assert.match(pack, /深度研究｜2026-09-01｜旧研究/);
  assert.match(pack, /当前判断：旧判断/);
  assert.match(pack, /事件 1 摘要/);
});

function fakeApp(state = {}) {
  state.nodes = state.nodes ?? [];
  state.docs = state.docs ?? {};
  state.issues = state.issues ?? [issue("0001")];
  state.events = state.events ?? [];
  state.created = [];
  state.updated = [];
  const config = { space_id: "sp-1", space_name: "人生核心议题", overview_node_token: "tk-overview", research_node_token: "tk-research", deep_research_node_token: "tk-deep", overview_name: "总览", research_name: "细项研究", deep_research_name: "深度研究" };
  const run = async (args) => {
    const command = `${args[0]} ${args[1]}`;
    if (command === "wiki +space-list") return { ok: true, data: { spaces: [{ space_id: "sp-1", name: "人生核心议题", visibility: "private", open_sharing: "closed" }] } };
    if (command === "wiki +node-get") {
      const token = args[args.indexOf("--node-token") + 1];
      const titles = { "tk-overview": "总览", "tk-research": "细项研究", "tk-deep": "深度研究" };
      return { ok: true, data: { node: { title: titles[token], parent_node_token: "", space_id: "sp-1", node_token: token, obj_token: token } } };
    }
    if (command === "wiki +node-list") {
      const parent = args[args.indexOf("--parent-node-token") + 1];
      if (parent !== "tk-deep") throw new Error(`unexpected node-list parent: ${parent}`);
      return { ok: true, data: { nodes: state.nodes, has_more: false } };
    }
    if (command === "wiki +node-create") {
      const title = args[args.indexOf("--title") + 1];
      const token = `tk-new-${state.created.length + 1}`;
      state.created.push({ title, token });
      state.nodes.push({ node_token: token, obj_token: token, title });
      return { ok: true, data: { node: { title, node_token: token, obj_token: token, parent_node_token: "" } } };
    }
    if (command === "docs +fetch") {
      const token = args[args.indexOf("--doc") + 1];
      return { ok: true, data: { document: { content: state.docs[token] ?? "" } } };
    }
    if (command === "docs +update") {
      const token = args[args.indexOf("--doc") + 1];
      const content = args[args.indexOf("--content") + 1];
      state.docs[token] = content;
      state.updated.push({ token, content });
      return { ok: true, data: {} };
    }
    if (command === "base +record-list") {
      const table = args[args.indexOf("--table-id") + 1];
      const rows = table === "tbllcm6oBbdMKnkN" ? state.issues : state.events;
      const fields = args.filter((value, index) => args[index - 1] === "--field-id");
      return { ok: true, data: { fields, data: rows.map((row) => fields.map((field) => row[field] ?? null)), record_id_list: rows.map((row) => row.recordId), has_more: false } };
    }
    if (command.startsWith("base +record-upsert") || command.startsWith("base +field-create") || command.startsWith("base +table-create")) throw new Error(`深度研究 Skill 不得写 Base：${command}`);
    throw new Error(`unexpected fake call: ${command}`);
  };
  return { app: new DeepResearch(run, config), state };
}

test("create builds a wiki document, injects context and rebuilds the index", async () => {
  const { app, state } = fakeApp();
  const result = await app.create({ topic: "AI 时代的自处", question: "人何以自处？", issueIds: ["IQ-0001"], date: "2026-09-17" });
  assert.equal(result.created, true);
  assert.equal(result.document, "https://ywhome.feishu.cn/wiki/tk-new-1");
  assert.ok(state.docs["tk-new-1"].includes("深度研究｜2026-09-17｜AI 时代的自处"));
  assert.ok(state.docs["tk-new-1"].includes("[IQ-0001]"));
  assert.ok(state.docs["tk-deep"].includes("深度研究｜2026-09-17｜AI 时代的自处"));
  assert.deepEqual(result.indexTitles, ["深度研究｜2026-09-17｜AI 时代的自处"]);
  assert.equal(state.created.filter((node) => node.title !== "深度研究｜2026-09-17｜AI 时代的自处").length, 0);
});

test("create reuses a blank same-name document instead of duplicating it", async () => {
  const { app, state } = fakeApp({ nodes: [{ node_token: "tk-blank", obj_token: "tk-blank", title: "深度研究｜2026-09-17｜主题" }] });
  const result = await app.create({ topic: "主题", date: "2026-09-17" });
  assert.equal(result.created, false);
  assert.equal(result.wikiToken, "tk-blank");
  assert.ok(state.docs["tk-blank"].includes("深度研究｜2026-09-17｜主题"));
  assert.equal(state.created.length, 0);
});

test("create returns the existing document untouched when it already has content", async () => {
  const { app, state } = fakeApp({ nodes: [{ node_token: "tk-full", obj_token: "tk-full", title: "深度研究｜2026-09-17｜主题" }] });
  state.docs["tk-full"] = "<title>深度研究｜2026-09-17｜主题</title><p>我自己的研究笔记。</p>";
  const result = await app.create({ topic: "主题", date: "2026-09-17" });
  assert.equal(result.created, false);
  assert.equal(result.recovered, true);
  assert.equal(result.wikiToken, "tk-full");
  assert.ok(state.docs["tk-full"].includes("我自己的研究笔记"));
  assert.ok(!state.updated.some((update) => update.token === "tk-full"));
});

test("create rejects unknown issue ids", async () => {
  const { app } = fakeApp();
  await assert.rejects(app.create({ topic: "主题", issueIds: ["IQ-9999"] }), /未找到议题/);
});

test("context pack without issue ids covers all active issues", async () => {
  const { app, state } = fakeApp({ issues: [issue("0001"), issue("0002", { "状态": "关闭" })], events: [event(1)] });
  const pack = await app.contextPack({});
  assert.match(pack, /IQ-0001/);
  assert.doesNotMatch(pack, /IQ-0002/);
  state.issues = [issue("0001")];
  const single = await app.contextPack({ issueIds: ["IQ-0001"] });
  assert.match(single, /IQ-0001/);
});

test("injected runner fails closed on broken wiki pagination", async () => {
  const config = { space_id: "sp-1", space_name: "人生核心议题", overview_node_token: "a", research_node_token: "b", deep_research_node_token: "c", overview_name: "总览", research_name: "细项研究", deep_research_name: "深度研究" };
  const app = new DeepResearch(async () => ({ ok: true, data: { nodes: [], has_more: true } }), config);
  await assert.rejects(app.wikiChildren(), /分页异常/);
});

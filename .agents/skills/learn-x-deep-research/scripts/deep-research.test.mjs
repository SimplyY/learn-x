import assert from "node:assert/strict";
import test from "node:test";
import { DeepResearch, YEAR_DIR_RE, renderContextPack, renderIndexPage, renderResearch, sortIndex, eventsOf } from "./deep-research.mjs";

const issue = (id, overrides = {}) => ({ recordId: `rec-${id}`, "议题编号": `IQ-${id}`, "议题": `问题 ${id}`, "类型": "长期问题", "状态": "活跃", "优先级": "P1", "研究状态": "继续研究", "当前判断": "旧判断", "最大未知": "未知 A", ...overrides });
const event = (id, overrides = {}) => ({ recordId: `rec-ev-${id}`, "事件编号": `EV-${id}`, "关联议题": [{ id: "rec-0001" }], "事件类型": "判断更新", "内容摘要": `事件 ${id} 摘要`, "有效性": "有效", "创建时间": `2026-0${id}-01T10:00:00+08:00`, "更新时间": `2026-0${id}-01T10:00:00+08:00`, ...overrides });

test("year directories use the new annual pattern", () => {
  assert.match("深度研究-2026", YEAR_DIR_RE);
  assert.equal("深度研究-2026".match(YEAR_DIR_RE)[1], "2026");
  assert.equal("深度研究｜2026-09-18｜主题".match(YEAR_DIR_RE), null);
});

test("annual index renders direct children sorted by title", () => {
  const nodes = [
    { node_token: "b", title: "深度研究-北大光华价值投资课" },
    { node_token: "a", title: "AI 时代的自处" },
    { node_token: "c", title: "生活秩序" },
  ];
  const html = renderIndexPage(nodes, "2026");
  assert.match(html, /深度研究-2026/);
  assert.match(html, /文档索引/);
  for (const title of ["AI 时代的自处", "深度研究-北大光华价值投资课", "生活秩序"]) assert.ok(html.includes(title));
  const sorted = sortIndex(nodes).map((node) => node.title);
  const positions = sorted.map((title) => html.indexOf(title));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("research template uses the topic as its title and escapes context", () => {
  const issues = [issue("0001", { "议题": "A < B & C", "当前判断": "保持主体性" })];
  const events = [event(1), event(2, { "有效性": "已撤回" })];
  const html = renderResearch("主题", "一句话问题", issues, events);
  assert.match(html, /<title>主题<\/title>/);
  assert.match(html, /一句话问题/);
  for (const marker of ["研究问题", "为什么现在研究", "当前认知（研究开始前）", "研究主体", "反证与未知", "阶段性结论", "认知变化", "下一步"]) assert.ok(html.includes(marker), marker);
  assert.match(html, /A &lt; B &amp; C/);
  assert.match(html, /保持主体性/);
  assert.match(html, /未知 A/);
  assert.match(html, /事件 1 摘要/);
  assert.doesNotMatch(html, /事件 2 摘要/);
  const empty = renderResearch("主题", "", [], []);
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
  const pack = renderContextPack([issue("0001")], [event(1)], [{ title: "旧研究" }]);
  assert.match(pack, /# ChatGPT 深度研究上下文/);
  assert.match(pack, /旧研究/);
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
  const config = { space_id: "sp-1", space_name: "人生核心议题", overview_node_token: "tk-overview", research_node_token: "tk-research", overview_name: "总览", research_name: "细项研究" };
  const run = async (args) => {
    const nodeBy = (name) => args[args.indexOf(name) + 1];
    const command = `${args[0]} ${args[1]}`;
    if (command === "wiki +space-list") return { ok: true, data: { spaces: [{ space_id: "sp-1", name: "人生核心议题", visibility: "private", open_sharing: "closed" }] } };
    if (command === "wiki +node-get") {
      const token = nodeBy("--node-token");
      const titles = { "tk-overview": "总览", "tk-research": "细项研究" };
      if (!titles[token]) throw new Error(`unexpected node-get: ${token}`);
      return { ok: true, data: { node: { title: titles[token], parent_node_token: "", space_id: "sp-1", node_token: token, obj_token: token } } };
    }
    if (command === "wiki +node-list") {
      const parent = args.includes("--parent-node-token") ? nodeBy("--parent-node-token") : "";
      const nodes = state.nodes.filter((node) => (node.parent_node_token || "") === parent);
      return { ok: true, data: { nodes, has_more: false } };
    }
    if (command === "wiki +node-create") {
      const title = nodeBy("--title");
      const parent = args.includes("--parent-node-token") ? nodeBy("--parent-node-token") : "";
      const token = `tk-new-${state.created.length + 1}`;
      state.created.push({ title, token, parent });
      state.nodes.push({ node_token: token, obj_token: token, title, parent_node_token: parent });
      return { ok: true, data: { node: { title, node_token: token, obj_token: token, parent_node_token: parent } } };
    }
    if (command === "docs +fetch") {
      const token = nodeBy("--doc");
      return { ok: true, data: { document: { content: state.docs[token] ?? "" } } };
    }
    if (command === "docs +update") {
      const token = nodeBy("--doc");
      const content = nodeBy("--content");
      state.docs[token] = content;
      state.updated.push({ token, content });
      return { ok: true, data: {} };
    }
    if (command === "base +record-list") {
      const table = nodeBy("--table-id");
      const rows = table === "tbllcm6oBbdMKnkN" ? state.issues : state.events;
      const fields = args.filter((value, index) => args[index - 1] === "--field-id");
      return { ok: true, data: { fields, data: rows.map((row) => fields.map((field) => row[field] ?? null)), record_id_list: rows.map((row) => row.recordId), has_more: false } };
    }
    if (command.startsWith("base +record-upsert") || command.startsWith("base +field-create") || command.startsWith("base +table-create")) throw new Error(`深度研究 Skill 不得写 Base：${command}`);
    throw new Error(`unexpected fake call: ${command}`);
  };
  return { app: new DeepResearch(run, config), state };
}

test("create puts a new document in the current annual directory and rebuilds the index", async () => {
  const { app, state } = fakeApp({ nodes: [{ node_token: "tk-year", obj_token: "tk-year", title: "深度研究-2026", parent_node_token: "" }] });
  const result = await app.create({ topic: "AI 时代的自处", question: "人何以自处？", issueIds: ["IQ-0001"] });
  assert.equal(result.created, true);
  assert.equal(result.document, "https://ywhome.feishu.cn/wiki/tk-new-1");
  assert.equal(state.nodes.find((node) => node.node_token === "tk-new-1").parent_node_token, "tk-year");
  assert.ok(state.docs["tk-new-1"].includes("<title>AI 时代的自处</title>"));
  assert.ok(state.docs["tk-new-1"].includes("[IQ-0001]"));
  assert.ok(state.docs["tk-year"].includes("深度研究-2026"));
  assert.deepEqual(result.indexTitles, { "2026": ["AI 时代的自处"] });
});

test("create creates a missing annual directory before writing the document", async () => {
  const { app, state } = fakeApp();
  const result = await app.create({ topic: "主题" });
  assert.equal(result.created, true);
  const yearDir = state.nodes.find((node) => YEAR_DIR_RE.test(node.title));
  const document = state.nodes.find((node) => node.title === "主题");
  assert.equal(yearDir.parent_node_token, "");
  assert.equal(document.parent_node_token, yearDir.node_token);
});

test("create reuses a blank same-name document instead of duplicating it", async () => {
  const { app, state } = fakeApp({
    nodes: [
      { node_token: "tk-year", obj_token: "tk-year", title: "深度研究-2026", parent_node_token: "" },
      { node_token: "tk-blank", obj_token: "tk-blank", title: "主题", parent_node_token: "tk-year" },
    ],
  });
  const result = await app.create({ topic: "主题" });
  assert.equal(result.created, false);
  assert.equal(result.wikiToken, "tk-blank");
  assert.ok(state.docs["tk-blank"].includes("<title>主题</title>"));
  assert.equal(state.created.length, 0);
});

test("create returns an existing nonblank document untouched", async () => {
  const { app, state } = fakeApp({
    nodes: [
      { node_token: "tk-year", obj_token: "tk-year", title: "深度研究-2026", parent_node_token: "" },
      { node_token: "tk-full", obj_token: "tk-full", title: "主题", parent_node_token: "tk-year" },
    ],
  });
  state.docs["tk-full"] = "<title>主题</title><p>我自己的研究笔记。</p>";
  const result = await app.create({ topic: "主题" });
  assert.equal(result.created, false);
  assert.equal(result.recovered, true);
  assert.equal(result.wikiToken, "tk-full");
  assert.ok(state.docs["tk-full"].includes("我自己的研究笔记"));
  assert.equal(state.updated.some((update) => update.token === "tk-full"), false);
});

test("create rejects unknown issue ids and blank topics, and trims topics", async () => {
  const { app, state } = fakeApp();
  await assert.rejects(app.create({ topic: "主题", issueIds: ["IQ-9999"] }), /未找到议题/);
  await assert.rejects(app.create({ topic: "  " }), /请提供研究主题/);
  const result = await app.create({ topic: "  主题  " });
  assert.equal(result.topic, "主题");
  assert.ok(Object.keys(state.docs).some((token) => state.docs[token].includes("<title>主题</title>")));
});

test("create dedupes repeated issue ids", async () => {
  const { app, state } = fakeApp();
  const result = await app.create({ topic: "主题", issueIds: ["IQ-0001", "IQ-0001"] });
  assert.equal(result.issues.length, 1);
  const doc = state.docs[result.wikiToken];
  assert.equal(doc.split("[IQ-0001]").length - 1, 2);
});

test("create fails closed when the same title exists in more than one year", async () => {
  const { app } = fakeApp({
    nodes: [
      { node_token: "tk-2025", obj_token: "tk-2025", title: "深度研究-2025", parent_node_token: "" },
      { node_token: "tk-old", obj_token: "tk-old", title: "主题", parent_node_token: "tk-2025" },
      { node_token: "tk-2026", obj_token: "tk-2026", title: "深度研究-2026", parent_node_token: "" },
      { node_token: "tk-current", obj_token: "tk-current", title: "主题", parent_node_token: "tk-2026" },
    ],
  });
  await assert.rejects(app.create({ topic: "主题" }), /跨年存在多个同名/);
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
  const config = { space_id: "sp-1", space_name: "人生核心议题", overview_node_token: "a", research_node_token: "b", overview_name: "总览", research_name: "细项研究" };
  const app = new DeepResearch(async () => ({ ok: true, data: { nodes: [], has_more: true } }), config);
  await assert.rejects(app.listNodes(), /分页异常/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_TABLE, ISSUE_TABLE, QuarterlyOverview, baseHash, quarterOfDate, renderOverview, validateProposal } from "./overview.mjs";
import { renderIndex, sortNodes } from "../../../lib/inquiry-wiki.mjs";

const issue = (id, extra = {}) => ({ recordId: `rec-${id}`, "议题编号": `IQ-${id}`, "议题": `问题 ${id}`, "类型": "长期问题", "状态": "活跃", ...extra });

test("quarter renderer groups all horizons and marks defaults", () => {
  const html = renderOverview("2026-Q3", [issue("1", { "议题": "A < B & C", "议题周期": "短期" }), issue("2")]);
  assert.match(html, /A &lt; B &amp; C/);
  assert.match(html, /短期议题/);
  assert.match(html, /优先级交叉视图/);
  assert.match(html, /<th>P0<\/th>/);
  assert.match(html, /P1（默认）/);
  assert.match(html, /继续研究（默认）/);
  assert.match(html, /季度回填锚点：quarterly-fillback/);
});

test("quarter calculation uses Asia/Shanghai", () => {
  assert.equal(quarterOfDate("2026-09-30T16:00:00Z"), "2026-Q4");
  assert.equal(quarterOfDate("2026-09-30T15:59:59Z"), "2026-Q3");
});

test("Base snapshot hash is independent of API record order", () => {
  const first = [issue("1", { "当前判断": "a" }), issue("2", { "当前判断": "b" })];
  assert.equal(baseHash(first), baseHash([...first].reverse()));
});

test("Wiki directory index is newest first and escapes titles", () => {
  const nodes = sortNodes([{ node_token: "old", title: "核心议题总览｜2026-Q2" }, { node_token: "new", title: "核心议题总览｜2026-Q3" }, { node_token: "duplicate", title: "核心议题总览｜2026-Q3" }]);
  assert.deepEqual(nodes.map((node) => node.node_token), ["new", "old"]);
  assert.match(renderIndex("总览", "说明", [{ node_token: "x", title: "核心议题总览｜2026-Q3 <" }], "空"), /&lt;/);
});

test("quarter Wiki pagination fails closed when the page token does not advance", async () => {
  const app = new QuarterlyOverview(async () => ({ ok: true, data: { nodes: [], has_more: true, page_token: "same" } }), {
    space_id: "space", overview_node_token: "overview", research_node_token: "research", space_name: "人生核心议题",
  });
  await assert.rejects(app.children("overview"), /分页异常/);
});

test("reused quarter records non-blocking chat-tab retry state", async () => {
  const row = { recordId: "ledger-1", "季度": "2026-Q3", "总览文档": "doc", "Wiki 节点": "wiki", "解析摘要": "{\"note\":\"kept\"}" };
  const app = new QuarterlyOverview(async () => ({ ok: true }), {
    space_id: "space", overview_node_token: "overview", research_node_token: "research", space_name: "人生核心议题",
    chat_tab: { group: "learn-x", name: "人生核心议题" },
  });
  app.assertRoots = async () => {};
  app.assertChild = async () => {};
  app.rebuildIndex = async () => ({ count: 1 });
  app.ledger = async () => ({ table: "ledger", row });
  app.syncChatTab = async () => ({ group: "learn-x", name: "人生核心议题", url: "https://ywhome.feishu.cn/wiki/wiki", status: "需重试", tabId: null, error: "group-index unavailable", updatedAt: "now" });
  app.write = async (_table, _id, values) => { Object.assign(row, values); return { ok: true }; };
  const result = await app.create("2026-Q3");
  assert.equal(result.reused, true);
  assert.equal(result.chatTabSync.status, "需重试");
  assert.equal(JSON.parse(row["解析摘要"]).note, "kept");
  assert.equal(JSON.parse(row["解析摘要"]).chatTabSync.status, "需重试");
});

test("new quarter persists chat-tab status after the Wiki ledger is created", async () => {
  let row = null;
  let content = "";
  const app = new QuarterlyOverview(async () => ({ ok: true }), {
    space_id: "space", overview_node_token: "overview", research_node_token: "research", space_name: "人生核心议题",
    chat_tab: { group: "learn-x", name: "人生核心议题" },
  });
  app.assertRoots = async () => {};
  app.blocks = async () => [];
  app.issues = async () => [];
  app.children = async () => [];
  app.wiki = async () => ({ data: { node: { node_token: "wiki-new", obj_token: "doc-new" } } });
  app.assertChild = async () => {};
  app.rebuildIndex = async () => ({ count: 1 });
  app.ledger = async () => ({ table: "ledger", row });
  app.lark = async (args) => {
    if (args.includes("+update")) content = args[args.indexOf("--content") + 1];
    return args.includes("+fetch") ? { data: { document: { content, revision_id: 1 } } } : { ok: true };
  };
  app.syncChatTab = async () => ({ group: "learn-x", name: "人生核心议题", url: "https://ywhome.feishu.cn/wiki/wiki-new", status: "需重试", tabId: null, error: "temporary", updatedAt: "now" });
  app.write = async (_table, id, values) => {
    row = { recordId: id || "ledger-new", ...(row || {}), ...values };
    return { data: { record: { record_id: row.recordId } } };
  };
  const result = await app.create("2026-Q4");
  assert.equal(result.reused, undefined);
  assert.equal(result.chatTabSync.status, "需重试");
  assert.equal(JSON.parse(row["解析摘要"]).chatTabSync.error, "temporary");
});

test("sync-tab command path is independently retryable", async () => {
  const row = { recordId: "ledger-1", "季度": "2026-Q3", "总览文档": "doc", "Wiki 节点": "wiki" };
  const app = new QuarterlyOverview(async () => ({ ok: true }), {
    space_id: "space", overview_node_token: "overview", research_node_token: "research", space_name: "人生核心议题",
    chat_tab: { group: "learn-x", name: "人生核心议题" },
  });
  app.assertRoots = async () => {};
  app.ledger = async () => ({ table: "ledger", row });
  app.syncChatTab = async () => ({ group: "learn-x", name: "人生核心议题", url: "https://ywhome.feishu.cn/wiki/wiki", status: "已同步", tabId: "managed", error: null, updatedAt: "now" });
  app.write = async (_table, _id, values) => { Object.assign(row, values); return { ok: true }; };
  const result = await app.syncTab("2026-Q3");
  assert.equal(result.chatTabSync.status, "已同步");
  assert.equal(JSON.parse(row["解析摘要"]).chatTabSync.tabId, "managed");
});

test("invalid quarter and forbidden lifecycle edits fail closed", () => {
  assert.throws(() => renderOverview("2026-13", []), /季度/);
  const snapshot = { quarter: "2026-Q3", documentToken: "doc", revisionId: 2, content: "", issues: [issue("1")] };
  assert.throws(() => validateProposal({ quarter: "2026-Q3", documentToken: "doc", revisionId: 2, changes: [{ issueId: "IQ-1", fields: { 状态: "关闭" } }] }, snapshot), /不允许更新字段/);
  assert.throws(() => validateProposal({ quarter: "2026-Q3", documentToken: "doc", revisionId: 2, creates: [{ fields: { 议题: "新" } }] }, snapshot), /类型/);
});

test("proposal requires evidence anchor for events", () => {
  const snapshot = { quarter: "2026-Q3", documentToken: "doc", revisionId: 2, content: '<h2 id="blk">证据</h2>', issues: [issue("1")] };
  assert.throws(() => validateProposal({ quarter: "2026-Q3", documentToken: "doc", revisionId: 2, events: [{ issueId: "IQ-1", type: "证据", summary: "s", detail: "d", increment: "i", evidence: "不存在", blockId: "blk" }] }, snapshot), /证据无法/);
  const splitBlocks = { ...snapshot, content: '<h2 id="blk">其他块</h2><p id="other">原文证据</p>' };
  assert.throws(() => validateProposal({ quarter: "2026-Q3", documentToken: "doc", revisionId: 2, events: [{ issueId: "IQ-1", type: "证据", summary: "s", detail: "d", increment: "i", evidence: "原文证据", blockId: "blk" }] }, splitBlocks), /证据无法/);
});

test("quarter snapshot guard rejects a changed Base hash", async () => {
  const app = new QuarterlyOverview(async () => ({ ok: true }), null);
  app.snapshot = async () => ({ quarter: "2026-Q3", revisionId: 2, hash: "same", baseHash: "changed" });
  await assert.rejects(app.assertSnapshot({ quarter: "2026-Q3", revisionId: 2, hash: "same", baseHash: "original" }), /变化/);
});

test("issue rewrites require a cognitive event", () => {
  const snapshot = { quarter: "2026-Q3", documentToken: "doc", revisionId: 2, content: '<h2 id="blk">证据</h2>', issues: [issue("1", { "议题": "旧" })] };
  assert.throws(() => validateProposal({ quarter: "2026-Q3", documentToken: "doc", revisionId: 2, changes: [{ issueId: "IQ-1", fields: { 议题: "新" } }] }, snapshot), /认知事件/);
});

test("apply is idempotent and rollback restores issues, withdraws events, and closes created issues", async () => {
  const row = { recordId: "ledger-1", "季度": "2026-Q3", "总览文档": "doc", "Wiki 节点": "wiki", "流程状态": "研究中", "当前文档哈希": "" };
  let issues = [issue("1", { "当前判断": "旧判断", "研究状态": "继续研究" })];
  let events = [];
  let eventNumber = 0;
  const app = new QuarterlyOverview(async () => ({ ok: true }), null);
  app.snapshot = async () => ({
    quarter: "2026-Q3", documentToken: "doc", wikiToken: "wiki", revisionId: 2, hash: "doc-hash", baseHash: "base-hash",
    content: '<h2 id="blk">证据块：原文证据</h2>', issues: issues.map((value) => ({ ...value })),
  });
  app.ledger = async () => ({ table: "ledger", row });
  app.issues = async () => issues.map((value) => ({ ...value }));
  app.events = async () => events.map((value) => ({ ...value }));
  app.write = async (table, id, values) => {
    if (table === ISSUE_TABLE) {
      if (!id) {
        const recordId = "rec-new";
        issues.push({ recordId, "议题编号": "IQ-NEW", "状态": "活跃", ...values });
        return { data: { record: { record_id: recordId } } };
      }
      const target = issues.find((value) => value.recordId === id);
      Object.assign(target, values);
      return { data: { record: { record_id: id } } };
    }
    if (table === EVENT_TABLE) {
      const recordId = id || `event-${++eventNumber}`;
      if (!id) events.push({ recordId, "事件编号": `EV-${eventNumber}`, ...values });
      else Object.assign(events.find((value) => value.recordId === id), values);
      return { data: { record: { record_id: recordId } } };
    }
    Object.assign(row, values);
    return { data: { record: { record_id: id || row.recordId } } };
  };
  const proposal = {
    quarter: "2026-Q3", documentToken: "doc", revisionId: 2,
    changes: [{ issueId: "IQ-1", fields: { "当前判断": "新判断" } }],
    creates: [{ fields: { "议题": "新议题", "类型": "长期问题", "议题周期": "长期" } }],
    events: [{ issueId: "IQ-1", type: "判断更新", summary: "更新", detail: "详情", increment: "增量", evidence: "原文证据", blockId: "blk", before: "旧判断", after: "新判断" }],
  };
  const first = await app.apply(proposal);
  assert.equal(row["流程状态"], "已提交");
  assert.equal(issues.find((value) => value["议题编号"] === "IQ-1")["当前判断"], "新判断");
  assert.equal(events[0]["有效性"], "有效");
  const second = await app.apply(proposal);
  assert.deepEqual(second, first);
  row["流程状态"] = "需处理";
  const healed = await app.apply(proposal);
  assert.deepEqual(healed, first);
  assert.equal(row["流程状态"], "已提交");
  await app.rollback("2026-Q3");
  assert.equal(row["流程状态"], "已撤回");
  assert.equal(issues.find((value) => value["议题编号"] === "IQ-1")["当前判断"], "旧判断");
  assert.equal(events[0]["有效性"], "已撤回");
  assert.equal(issues.find((value) => value["议题编号"] === "IQ-NEW")["研究状态"], "关闭研究");
  await app.apply(proposal);
  assert.equal(row["流程状态"], "已提交");
  assert.equal(issues.find((value) => value["议题编号"] === "IQ-NEW")["研究状态"], "继续研究");
  assert.equal(events[0]["有效性"], "有效");
  const history = JSON.parse(row["审计历史"]);
  history[0].status = "需处理";
  row["流程状态"] = "需处理";
  row["审计历史"] = JSON.stringify(history);
  await assert.rejects(app.apply({ ...proposal, changes: [{ issueId: "IQ-1", fields: { 优先级: "P2" } }], events: [] }), /待处理提交内容已变化/);
});

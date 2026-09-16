import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Workbench, headingBlockId, parseSelection, rankIssues, recommendationReason, renderWorkbench, validateProposal } from "./workbench.mjs";

const issue = (id, overrides = {}) => ({ recordId: `rec-${id}`, "议题编号": `IQ-${id}`, "议题": `问题 ${id}`, "类型": "长期问题", "状态": "活跃", "优先级": "P1", "研究状态": "继续研究", "阶段": "探索", "创建时间": "2026-01-01T10:00:00+08:00", ...overrides });

test("recommendation prioritizes urgent decisions, then priority and stale attention", () => {
  const ranked = rankIssues([
    issue("0001", { "优先级": "P2", "类型": "重大决策", "决策截止时间": "2026-09-20T10:00:00+08:00" }),
    issue("0002", { "优先级": "P0", "创建时间": "2026-09-01T10:00:00+08:00" }),
    issue("0003", { "优先级": "P0", "创建时间": "2026-01-01T10:00:00+08:00" }),
    issue("0004", { "优先级": "P0", "研究状态": "暂缓研究" }),
  ], [], "2026-09");
  assert.deepEqual(ranked.map((item) => item["议题编号"]), ["IQ-0001", "IQ-0003", "IQ-0002"]);
});

test("successful monthly submission counts as attention even without an event", () => {
  const first = issue("0001", { "优先级": "P0", "创建时间": "2026-01-01T10:00:00+08:00" });
  const second = issue("0002", { "优先级": "P0", "创建时间": "2026-02-01T10:00:00+08:00" });
  const ranked = rankIssues([first, second], [], "2026-09", [{ "流程状态": "已提交", "选定议题": [{ id: first.recordId }], "更新时间": "2026-09-01T10:00:00+08:00" }]);
  assert.deepEqual(ranked.map((item) => item["议题编号"]), ["IQ-0002", "IQ-0001"]);
});

test("explicit attention horizon orders ordinary candidates before cross-horizon priority", () => {
  const long = issue("0001", { "优先级": "P0", "议题周期": "长期核心问题" });
  const middle = issue("0002", { "优先级": "P2", "议题周期": "中期核心问题" });
  const short = issue("0003", { "优先级": "P2", "议题周期": "短期核心问题" });
  assert.deepEqual(rankIssues([long, middle, short], [], "2026-09").map((item) => item["议题编号"]), ["IQ-0003", "IQ-0002", "IQ-0001"]);
});

test("selection supports defaults, digit replies and unique quoted additions", () => {
  const candidates = [issue("0001", { position: 1 }), issue("0002", { position: 2 }), issue("0003", { position: 3 })];
  const outside = issue("0004", { "议题": "候选外问题" });
  assert.deepEqual(parseSelection("前三个", candidates, [...candidates, outside]).map((item) => item.recordId), ["rec-0001", "rec-0002", "rec-0003"]);
  assert.deepEqual(parseSelection("前三个，再加“候选外问题”", candidates, [...candidates, outside]).map((item) => item.recordId), ["rec-0001", "rec-0002", "rec-0003", "rec-0004"]);
  assert.deepEqual(parseSelection("1、3，再加“候选外问题”", candidates, [...candidates, outside]).map((item) => item.recordId), ["rec-0001", "rec-0003", "rec-0004"]);
  assert.throws(() => parseSelection("“问题”", candidates, [...candidates, outside]), /不唯一/);
});

test("workbench document escapes user text and keeps a free research region", () => {
  const content = renderWorkbench("2026-09", [issue("0001", { "议题": "A < B & C" })]);
  assert.match(content, /A &lt; B &amp; C/);
  assert.match(content, /自由研究区/);
  assert.match(content, /议题周期/);
  assert.match(content, /提交不等于完成/);
});

test("snapshot heading lookup accepts both document and outline forms", () => {
  assert.equal(headingBlockId('<h2 id="blk-a">[IQ-0001] 问题</h2>', "IQ-0001"), "blk-a");
  assert.equal(headingBlockId('<outline-item id="blk-b">[IQ-0001] 问题</outline-item>', "IQ-0001"), "blk-b");
  assert.equal(headingBlockId('<h2 id="blk-c">[IQ-0002] 其他</h2>', "IQ-0001"), null);
});

test("proposal rejects system actions and requires evidence for events", () => {
  const selected = [issue("0001", { "当前判断": "旧判断" })];
  const document = '<h2 id="blk1">[IQ-0001] 问题</h2><p>新证据导致新判断。</p>';
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "状态": "关闭" } }], events: [] }, selected, document), /不允许更新字段/);
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "当前判断": "新判断" } }], events: [{ issueId: "IQ-0001", type: "判断更新", summary: "判断变化", detail: "新证据导致新判断", increment: "判断更新", evidence: "新证据导致新判断", blockId: "blk1", before: "旧判断", after: "新判断" }] }, selected, document));
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "当前判断": "新判断" } }], events: [{ issueId: "IQ-0001", type: "判断更新", summary: "判断变化", detail: "新证据导致新判断", increment: "判断更新", evidence: "新证据导致新判断", blockId: "blk1", before: "旧判断", after: "另一判断" }] }, selected, document), /前后值一致/);
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", clear: ["当前判断"] }], events: [{ issueId: "IQ-0001", type: "判断更新", summary: "清空判断", detail: "新证据导致新判断", increment: "判断清空", evidence: "新证据导致新判断", blockId: "blk1", before: "旧判断", after: "" }] }, selected, document));
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [] }, selected, document));
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "议题周期": "短期核心问题" } }], events: [] }, selected, document));
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: {}, clear: ["下一步"] }], events: [] }, selected, document));
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: {}, clear: ["状态"] }], events: [] }, selected, document), /不允许清空字段/);
});

test("injected Lark runner fails closed on broken pagination", async () => {
  const app = new Workbench(async () => ({ ok: true, data: { fields: ["议题编号"], data: [], record_id_list: [], has_more: true } }));
  await assert.rejects(app.list("tbl-test", ["议题编号"]), /分页异常/);
});

function fakeApplyApp() {
  const state = {
    issues: [issue("0001", { recordId: "rec-issue", "当前判断": "旧判断" })],
    events: [],
    ledger: [{ recordId: "rec-ledger", "研究月份": "2026-09", "选定议题": [{ id: "rec-issue" }], "研究文档": "doc-1", "流程状态": "研究中", "审计历史": null, "当前文档哈希": null, "当前提交标识": null, "候选议题": [{ id: "rec-issue" }], "候选顺序": "[\"rec-issue\"]", "解析摘要": null }],
    writes: [],
  };
  const select = (name, options) => ({ name, type: "select", options: options.map((option) => ({ name: option })) });
  const schemas = {
    tbllcm6oBbdMKnkN: [select("议题周期", ["短期核心问题", "中期核心问题", "长期核心问题"]), select("优先级", ["P0", "P1", "P2"]), select("研究状态", ["继续研究", "暂缓研究", "关闭研究"])],
    tblIE9FK9mWGv7GE: [select("有效性", ["有效", "待生效", "已撤回"]), { name: "来源月度研究", type: "link" }],
    "tbl-ledger": [{ name: "研究月份", type: "text" }, select("流程状态", ["待选择", "研究中", "需处理", "已提交", "已撤回"])],
  };
  const tableRows = (table) => table === "tbllcm6oBbdMKnkN" ? state.issues : table === "tblIE9FK9mWGv7GE" ? state.events : state.ledger;
  const run = async (args) => {
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +field-list") return { ok: true, data: { fields: schemas[args[args.indexOf("--table-id") + 1]] } };
    if (command === "base +base-block-list") return { ok: true, data: { blocks: [{ id: "tbl-ledger", type: "table", name: "月度核心议题研究" }, ...(state.extraBlocks || [])] } };
    if (command === "base +view-list") return { ok: true, data: { views: [{ id: "vew-audit", name: "月度核心议题审计" }] } };
    if (command === "base +record-list") {
      const table = args[args.indexOf("--table-id") + 1]; const fields = args.filter((value, index) => args[index - 1] === "--field-id"); const rows = tableRows(table);
      return { ok: true, data: { fields, data: rows.map((row) => fields.map((field) => row[field] ?? null)), record_id_list: rows.map((row) => row.recordId), has_more: false } };
    }
    if (command === "docs +fetch") {
      const doc = args[args.indexOf("--doc") + 1]; const content = state.docs?.[doc] ?? '<h2 id="blk-issue">[IQ-0001] 问题</h2><p>本月只决定暂缓，不产生新认知事件。</p>';
      return { ok: true, data: { document: { revision_id: 1, content } } };
    }
    if (command === "base +record-upsert") {
      const table = args[args.indexOf("--table-id") + 1]; const recordId = args.includes("--record-id") ? args[args.indexOf("--record-id") + 1] : `rec-event-${state.events.length + 1}`; const patch = JSON.parse(args[args.indexOf("--json") + 1]); const rows = tableRows(table); let row = rows.find((item) => item.recordId === recordId);
      if (!row) { row = { recordId, ...(table === "tblIE9FK9mWGv7GE" ? { "事件编号": `EV-${state.events.length + 1}` } : {}) }; rows.push(row); } Object.assign(row, patch); state.writes.push({ table, recordId, patch }); return { ok: true, data: { record: row } };
    }
    throw new Error(`unexpected fake call: ${command}`);
  };
  return { app: new Workbench(run), state };
}

test("injected end-to-end apply persists a state change without fabricating an event", async () => {
  const { app, state } = fakeApplyApp();
  const result = await app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [], unprocessed: [{ issueId: "IQ-0001", reason: "无新的证据或判断" }] });
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.unchanged, []);
  assert.equal(state.issues[0]["研究状态"], "暂缓研究");
  assert.equal(state.events.length, 0);
  assert.equal(state.ledger[0]["流程状态"], "已提交");
});

test("frozen candidates are reused rather than cleared on a repeated recommendation", async () => {
  const { app, state } = fakeApplyApp();
  state.ledger[0]["研究文档"] = null;
  const result = await app.recommend("2026-09");
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(state.ledger[0]["候选议题"], [{ id: "rec-issue" }]);
});

test("injected rollback restores the previous field value and keeps history", async () => {
  const { app, state } = fakeApplyApp();
  await app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [] });
  state.issues[0]["优先级"] = "P0";
  const result = await app.rollback("2026-09");
  assert.match(result.withdrawn, /^2026-09:doc-1:/);
  assert.equal(state.issues[0]["研究状态"], "继续研究");
  assert.equal(state.issues[0]["优先级"], "P0");
  assert.equal(state.ledger[0]["流程状态"], "已撤回");
  assert.match(state.ledger[0]["审计历史"], /已撤回/);
});

test("injected apply activates an evidenced judgment event only after the issue write", async () => {
  const { app, state } = fakeApplyApp();
  const result = await app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "当前判断": "新判断" } }], events: [{ issueId: "IQ-0001", type: "判断更新", summary: "判断更新", detail: "本月只决定暂缓，不产生新认知事件。", increment: "明确更新", evidence: "本月只决定暂缓，不产生新认知事件。", blockId: "blk-issue", before: "旧判断", after: "新判断" }] });
  assert.equal(result.events.length, 1);
  assert.equal(state.issues[0]["当前判断"], "新判断");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]["有效性"], "有效");
  assert.equal(result.events[0].id, "EV-1");
  assert.equal(state.events[0]["来源系统"], null);
  assert.equal(state.events[0]["来源链接"], null);
});

test("heading lookup stays inside one heading in the real flat adjacent outline format", () => {
  const outline = '<fragment mode="outline"><outline><h2 id="blk-1">[IQ-0001] 问题一</h2><h2 id="blk-2">[IQ-0002] 问题二</h2><h2 id="blk-3">[IQ-0003] 问题三</h2></outline></fragment>';
  assert.equal(headingBlockId(outline, "IQ-0001"), "blk-1");
  assert.equal(headingBlockId(outline, "IQ-0002"), "blk-2");
  assert.equal(headingBlockId(outline, "IQ-0003"), "blk-3");
});

test("uncategorized issues are never disguised as long-term and sort after them", () => {
  const long = issue("0001", { "议题周期": "长期核心问题", "优先级": "P0" });
  const uncategorized = issue("0002", { "优先级": "P0" });
  const ranked = rankIssues([uncategorized, long], [], "2026-09");
  assert.deepEqual(ranked.map((item) => item["议题编号"]), ["IQ-0001", "IQ-0002"]);
  assert.match(recommendationReason(uncategorized, "2026-09"), /未分类/);
});

test("selection never misparses digits or keywords that appear inside titles", () => {
  const candidates = [issue("0001", { position: 1 }), issue("0002", { position: 2 }), issue("0003", { position: 3 })];
  const all = [...candidates, issue("0004", { "议题": "2026 年该不该买房" }), issue("0005", { "议题": "全部注意力去哪了" })];
  assert.deepEqual(parseSelection("2026 年该不该买房", candidates, all).map((item) => item.recordId), ["rec-0004"]);
  assert.deepEqual(parseSelection("全部注意力去哪了", candidates, all).map((item) => item.recordId), ["rec-0005"]);
  assert.deepEqual(parseSelection("1 和 3，再加“2026 年该不该买房”", candidates, all).map((item) => item.recordId), ["rec-0001", "rec-0003", "rec-0004"]);
  assert.deepEqual(parseSelection("1 和 3，再加 2026 年该不该买房", candidates, all).map((item) => item.recordId), ["rec-0001", "rec-0003", "rec-0004"]);
});

test("proposal fails closed on missing evidence, unknown block ids and regex injection", () => {
  const selected = [issue("0001")];
  const document = '<h2 id="blk1">[IQ-0001] 问题</h2><p>证据原文。</p>';
  const event = (overrides) => ({ issueId: "IQ-0001", type: "证据", summary: "s", detail: "d", increment: "i", evidence: "证据原文。", blockId: "blk1", ...overrides });
  assert.throws(() => validateProposal({ changes: [], events: [event({ evidence: "文档中不存在的片段" })] }, selected, document), /无法在当前文档定位/);
  assert.throws(() => validateProposal({ changes: [], events: [event({ blockId: "blk999" })] }, selected, document), /无法在当前文档定位/);
  assert.throws(() => validateProposal({ changes: [], events: [event({ blockId: `a["']|` })] }, selected, document), /无法在当前文档定位/);
  assert.throws(() => validateProposal({ changes: [], events: [event({ sourceSystem: "外部系统" })] }, selected, document), /来源系统无效/);
  assert.throws(() => validateProposal({ changes: [], events: [event({ sourceLink: "https://example.com" })] }, selected, document), /来源链接不在当前文档中/);
});

test("proposal rejects out-of-range confidence and invalid option values", () => {
  const selected = [issue("0001")];
  const document = '<h2 id="blk1">[IQ-0001] 问题</h2><p>证据。</p>';
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "判断置信度": 11 } }], events: [] }, selected, document), /置信度/);
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "判断置信度": 7.5 } }], events: [] }, selected, document), /置信度/);
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "议题周期": "超长期核心问题" } }], events: [] }, selected, document), /议题周期无效/);
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "优先级": "P9" } }], events: [] }, selected, document), /优先级无效/);
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "研究状态": "随便" } }], events: [] }, selected, document), /研究状态无效/);
  assert.throws(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "阶段": "躺平" } }], events: [] }, selected, document), /阶段无效/);
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "判断置信度": 0 } }], events: [] }, selected, document));
  assert.doesNotThrow(() => validateProposal({ changes: [{ issueId: "IQ-0001", fields: { "判断置信度": 10 } }], events: [] }, selected, document));
});

test("duplicate monthly ledger rows fail closed", async () => {
  const { app, state } = fakeApplyApp();
  state.ledger.push({ ...state.ledger[0] });
  await assert.rejects(app.status("2026-09"), /重复账本/);
});

test("duplicate same-name workbench documents fail closed on create", async () => {
  const { app, state } = fakeApplyApp();
  state.ledger[0]["研究文档"] = null;
  state.ledger[0]["流程状态"] = "待选择";
  state.extraBlocks = [{ id: "doc-a", type: "docx", name: "月度核心议题研究工作台｜2026-09" }, { id: "doc-b", type: "docx", name: "月度核心议题研究工作台｜2026-09" }];
  await assert.rejects(app.create("2026-09", ["rec-issue"]), /多个同名工作台文档/);
});

test("create refuses to overwrite a same-name document that holds user content", async () => {
  const { app, state } = fakeApplyApp();
  state.ledger[0]["研究文档"] = null;
  state.ledger[0]["流程状态"] = "待选择";
  state.extraBlocks = [{ id: "doc-a", type: "docx", name: "月度核心议题研究工作台｜2026-09" }];
  state.docs = { "doc-a": "<h1>其他标题</h1><p>用户自己写的研究内容。</p>" };
  await assert.rejects(app.create("2026-09", ["rec-issue"]), /拒绝覆盖/);
});

test("create recovers an existing template document instead of overwriting it", async () => {
  const { app, state } = fakeApplyApp();
  state.ledger[0]["研究文档"] = null;
  state.ledger[0]["流程状态"] = "待选择";
  state.extraBlocks = [{ id: "doc-a", type: "docx", name: "月度核心议题研究工作台｜2026-09" }];
  state.docs = { "doc-a": '<h1>月度核心议题研究工作台｜2026-09</h1><h2>[IQ-0001] 问题</h2><p>既有研究。</p>' };
  const result = await app.create("2026-09", ["rec-issue"]);
  assert.equal(result.recovered, true);
  assert.equal(state.ledger[0]["研究文档"], "doc-a");
  assert.equal(state.ledger[0]["流程状态"], "研究中");
});

test("recommend fails closed once the monthly document already exists", async () => {
  const { app } = fakeApplyApp();
  await assert.rejects(app.recommend("2026-09"), /候选顺序已冻结/);
});

test("rollback without any submitted version fails closed", async () => {
  const { app } = fakeApplyApp();
  await assert.rejects(app.rollback("2026-09"), /没有可撤回/);
});

test("rollback fails closed when a human edited the same field after submission", async () => {
  const { app, state } = fakeApplyApp();
  await app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [] });
  state.issues[0]["研究状态"] = "关闭研究";
  await assert.rejects(app.rollback("2026-09"), /人工并发修改/);
  assert.equal(state.issues[0]["研究状态"], "关闭研究");
});

test("re-applying the same revision and hash is idempotent", async () => {
  const { app, state } = fakeApplyApp();
  const proposal = { month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [] };
  const first = await app.apply(proposal);
  const writes = state.writes.length;
  const events = state.events.length;
  const second = await app.apply(proposal);
  assert.deepEqual(second, first);
  assert.equal(state.writes.length, writes);
  assert.equal(state.events.length, events);
});

test("re-applying after rollback reactivates the same event instead of duplicating it", async () => {
  const { app, state } = fakeApplyApp();
  const proposal = { month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "当前判断": "新判断" } }], events: [{ issueId: "IQ-0001", type: "判断更新", summary: "判断更新", detail: "本月只决定暂缓，不产生新认知事件。", increment: "明确更新", evidence: "本月只决定暂缓，不产生新认知事件。", blockId: "blk-issue", before: "旧判断", after: "新判断" }] };
  await app.apply(proposal);
  await app.rollback("2026-09");
  assert.equal(state.events[0]["有效性"], "已撤回");
  await app.apply(proposal);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]["有效性"], "有效");
  assert.equal(state.issues[0]["当前判断"], "新判断");
  assert.equal(state.ledger[0]["流程状态"], "已提交");
});

test("apply rejects a proposal that is not the current document revision", async () => {
  const { app, state } = fakeApplyApp();
  await assert.rejects(app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 2, changes: [], events: [] }), /不是当前文档 revision/);
  assert.equal(state.writes.length, 0);
});

test("apply fails closed when the document changed during parsing", async () => {
  const { app, state } = fakeApplyApp();
  const realLark = app.lark.bind(app);
  let docsFetches = 0;
  app.lark = async (args) => {
    if (args[0] === "docs" && args[1] === "+fetch") { docsFetches += 1; if (docsFetches > 2) return { ok: true, data: { document: { revision_id: 99, content: "" } } }; }
    return realLark(args);
  };
  await assert.rejects(app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }], events: [] }), /解析期间已变化/);
  assert.equal(state.ledger[0]["流程状态"], "需处理");
  assert.equal(state.issues[0]["研究状态"], "继续研究");
});

test("partial failure lands in 需处理 and a revised retry replaces stale pending events", async () => {
  const { app, state } = fakeApplyApp();
  const realWrite = app.write.bind(app);
  let failIssueWrites = true;
  app.write = async (table, recordId, values) => {
    if (failIssueWrites && table === "tbllcm6oBbdMKnkN") throw new Error("注入的议题写入失败");
    return realWrite(table, recordId, values);
  };
  const base = { month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [{ issueId: "IQ-0001", fields: { "研究状态": "暂缓研究" } }] };
  await assert.rejects(app.apply({ ...base, events: [{ issueId: "IQ-0001", type: "判断更新", summary: "第一版判断", detail: "本月只决定暂缓，不产生新认知事件。", increment: "明确更新", evidence: "本月只决定暂缓，不产生新认知事件。", blockId: "blk-issue", before: "旧判断", after: "新判断" }] }), /注入的议题写入失败/);
  assert.equal(state.ledger[0]["流程状态"], "需处理");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0]["有效性"], "待生效");
  failIssueWrites = false;
  const result = await app.apply({ ...base, events: [{ issueId: "IQ-0001", type: "判断更新", summary: "修订版判断", detail: "不产生新认知事件。", increment: "明确更新", evidence: "不产生新认知事件。", blockId: "blk-issue", before: "旧判断", after: "新判断" }] });
  assert.equal(result.events.length, 1);
  assert.equal(state.issues[0]["研究状态"], "暂缓研究");
  assert.equal(state.ledger[0]["流程状态"], "已提交");
  assert.equal(state.events.length, 2);
  assert.equal(state.events[0]["有效性"], "已撤回");
  assert.equal(state.events[1]["有效性"], "有效");
});

test("a stale lock from a crashed process is reclaimed while a live one fails closed", async () => {
  const { app, state } = fakeApplyApp();
  const lock = path.join(os.tmpdir(), "learn-x-workbench-2026-09.lock");
  const crashed = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  fs.writeFileSync(lock, `${crashed.pid}\n`);
  await app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [], events: [] });
  assert.equal(state.ledger[0]["流程状态"], "已提交");
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, `${process.pid}\n`);
  state.ledger[0]["流程状态"] = "研究中";
  state.ledger[0]["当前文档哈希"] = null;
  state.docs = { "doc-1": '<h2 id="blk-issue">[IQ-0001] 问题</h2><p>不同的文档内容。</p>' };
  await assert.rejects(app.apply({ month: "2026-09", documentToken: "doc-1", revisionId: 1, changes: [], events: [] }), /进行中的提交/);
  assert.equal(state.ledger[0]["流程状态"], "研究中");
  fs.unlinkSync(lock);
});

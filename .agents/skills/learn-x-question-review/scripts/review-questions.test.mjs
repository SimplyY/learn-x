import test from "node:test";
import assert from "node:assert/strict";
import { consistencyWarnings, daysUntilDeadline, deliveryPatch, eventCursorDate, nextReviewDate, renderChatPack, resolveRelatedIssues, selectDueIssues, validateDeliveryReadback, validateFieldContract, validateIssue } from "./review-questions.mjs";

const now = new Date("2026-09-14T01:30:00.000Z");
const issue = (overrides = {}) => ({
  "议题编号": "IQ-0001", "议题": "测试问题", "类型": "长期问题", "状态": "活跃", "复盘频率": "每周",
  "下次复盘日期": "2026-09-13T09:00:00.000+08:00", "决策截止时间": "", "创建时间": "2026-09-01T09:00:00.000+08:00", ...overrides,
});

test("selectDueIssues respects weekly and monthly channels", () => {
  assert.equal(selectDueIssues([issue(), issue({ "议题编号": "IQ-0002", "复盘频率": "每月", "下次复盘日期": "2026-09-01T09:00:00.000+08:00" })], "weekly", now).length, 1);
  assert.equal(selectDueIssues([issue(), issue({ "议题编号": "IQ-0002", "复盘频率": "每月", "下次复盘日期": "2026-09-01T09:00:00.000+08:00" })], "monthly", now).length, 1);
});

test("annual focus follows its configured review channel", () => {
  assert.equal(selectDueIssues([issue({ "议题编号": "IQ-0002", "类型": "年度重点", "复盘频率": "每周" })], "weekly", now).length, 1);
  assert.equal(selectDueIssues([issue({ "议题编号": "IQ-0003", "类型": "年度重点", "复盘频率": "每月" })], "weekly", now).length, 0);
  assert.equal(selectDueIssues([issue({ "议题编号": "IQ-0004", "类型": "年度重点", "复盘频率": "手动", "下次复盘日期": "" })], "weekly", now).length, 0);
});

test("major decisions enter weekly review fourteen days before deadline", () => {
  const selected = selectDueIssues([issue({ "议题编号": "IQ-0002", "类型": "重大决策", "复盘频率": "手动", "下次复盘日期": "2026-12-01T09:00:00.000+08:00", "决策截止时间": "2026-09-20T09:00:00.000+08:00" })], "weekly", now);
  assert.equal(selected.length, 1);
});

test("stops automatic deadline reviews after the decision deadline", () => {
  const overdue = issue({ "议题编号": "IQ-0002", "类型": "重大决策", "复盘频率": "按截止时间", "下次复盘日期": "2026-09-13T09:00:00.000+08:00", "决策截止时间": "2026-09-13T09:00:00.000+08:00" });
  assert.equal(selectDueIssues([overdue], "weekly", now).length, 0);
});

test("fails closed when deadline cadence has no decision deadline", () => {
  assert.throws(() => validateIssue({ recordId: "rec-1", values: { "议题编号": "IQ-0002", "议题": "测试决策", "类型": "重大决策", "状态": "活跃", "复盘频率": "按截止时间", "决策截止时间": "" } }), /必须设置决策截止时间/);
});

test("nextReviewDate advances only the scheduling field", () => {
  const next = nextReviewDate(issue(), new Date("2026-09-14T02:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-09-21T02:00:00.000Z");
  assert.equal(nextReviewDate({ ...issue(), "复盘频率": "手动" }, new Date()) , null);
});

test("monthly and quarterly reviews clamp month-end dates", () => {
  const deliveredAt = new Date("2026-01-31T02:00:00.000Z");
  assert.equal(nextReviewDate({ ...issue(), "复盘频率": "每月" }, deliveredAt).toISOString(), "2026-02-28T02:00:00.000Z");
  assert.equal(nextReviewDate({ ...issue(), "复盘频率": "每季度" }, deliveredAt).toISOString(), "2026-04-30T02:00:00.000Z");
});

test("deliveryPatch contains scheduling fields only", () => {
  const patch = deliveryPatch({ ...issue(), "复盘频率": "每月" }, new Date("2026-09-14T02:00:00.000Z"));
  assert.deepEqual(Object.keys(patch).sort(), ["上次复盘推送时间", "下次复盘日期"]);
  assert.equal(patch["上次复盘推送时间"], "2026-09-14 10:00");
  assert.equal(patch["下次复盘日期"], "2026-10-14 10:00");
});

test("validateDeliveryReadback accepts normalized Base datetimes and rejects drift", () => {
  const patch = { "上次复盘推送时间": "2026-09-14 10:00", "下次复盘日期": "2026-10-14 10:00" };
  assert.doesNotThrow(() => validateDeliveryReadback({ "上次复盘推送时间": "2026-09-14T10:00:00.000+08:00", "下次复盘日期": "2026-10-14T10:00:00.000+08:00" }, patch));
  assert.throws(() => validateDeliveryReadback({ "上次复盘推送时间": "2026-09-14T10:01:00.000+08:00", "下次复盘日期": "2026-10-14T10:00:00.000+08:00" }, patch), /读回不一致/);
});

test("event increment uses ingestion/update time so late backfilled events are not lost", () => {
  const cursor = eventCursorDate({ "事件时间": "2026-09-01T09:00:00.000+08:00", "创建时间": "2026-09-15T09:00:00.000+08:00", "更新时间": "2026-09-15T09:00:00.000+08:00" });
  assert.equal(cursor.toISOString(), "2026-09-15T01:00:00.000Z");
});

test("deadline context exposes a calendar-day countdown", () => {
  const issueWithDeadline = { "决策截止时间": "2026-09-20T09:00:00.000+08:00" };
  assert.equal(daysUntilDeadline(issueWithDeadline, new Date("2026-09-14T09:00:00.000+08:00")), 6);
  assert.equal(daysUntilDeadline({ "决策截止时间": "" }), null);
});

test("related issues resolve to stable ids and questions without inventing facts", () => {
  const resolved = resolveRelatedIssues({ "相关议题": [{ id: "rec-2" }, { id: "rec-missing" }] }, [
    { recordId: "rec-1", "议题编号": "IQ-0001", "议题": "主问题" },
    { recordId: "rec-2", "议题编号": "IQ-0002", "议题": "相关问题" },
  ]);
  assert.deepEqual(resolved, [{ id: "IQ-0002", question: "相关问题" }, { id: "rec-missing", question: "未知议题" }]);
});

test("consistencyWarnings detects manual judgment and stale change events without writing", () => {
  assert.deepEqual(consistencyWarnings({ "当前判断": "现在的判断", "类型": "长期问题", "状态": "活跃" }, []), ["当前判断已有内容，但没有对应的“判断更新”事件"]);
  assert.deepEqual(consistencyWarnings({ "当前判断": "现在的判断", "类型": "年度重点", "状态": "活跃" }, [
    { "事件类型": "判断更新", "变更后": "旧判断" },
    { "事件类型": "类型变化", "变更后": "长期问题" },
  ]), ["当前判断与最近“判断更新”事件的变更后内容不一致", "当前类型与最近“类型变化”事件的变更后内容不一致"]);
});

test("validateFieldContract fails closed when a select option drifts", () => {
  const fields = [
    { name: "类型", type: "select", options: [{ name: "长期问题" }, { name: "年度重点" }] },
  ];
  assert.throws(() => validateFieldContract(fields, ["类型"]), /单选项不匹配/);
});

test("validateFieldContract accepts the exact issue select contract", () => {
  const fields = [
    { name: "类型", type: "select", multiple: false, options: [{ name: "长期问题" }, { name: "年度重点" }, { name: "重大决策" }] },
    { name: "状态", type: "select", multiple: false, options: [{ name: "候选" }, { name: "活跃" }, { name: "休眠" }, { name: "关闭" }] },
  ];
  assert.doesNotThrow(() => validateFieldContract(fields, ["类型", "状态"]));
});

test("validateFieldContract rejects a multi-select drift", () => {
  const fields = [{ name: "类型", type: "select", multiple: true, options: [{ name: "长期问题" }, { name: "年度重点" }, { name: "重大决策" }] }];
  assert.throws(() => validateFieldContract(fields, ["类型"]), /不应为多选/);
});

test("renderChatPack preserves blank facts and only renders event provenance", () => {
  const output = renderChatPack({ dossiers: [{
    issue: {
      id: "IQ-0001", question: "测试问题", type: "长期问题", stage: "探索", importance: "", judgment: "", confidence: null,
      unknown: "", changeConditions: "", nextStep: "", deadline: "", reversibility: "", relatedIssues: [], recentEvents: [],
    },
    recentEvents: [],
  }] });
  assert.match(output, /为什么重要：未填写/);
  assert.match(output, /当前判断：未填写|判断：未填写/);
  assert.match(output, /其他现实约束：未记录/);
  assert.match(output, /关联议题：未记录/);
  assert.doesNotMatch(output, /个人上下文|价值投资|健康优先/);
});

test("renderChatPack includes only resolved related issue context", () => {
  const output = renderChatPack({ dossiers: [{
    issue: {
      id: "IQ-0001", question: "测试问题", type: "长期问题", stage: "探索", importance: "", judgment: "", confidence: null,
      unknown: "", changeConditions: "", nextStep: "", deadline: "", reversibility: "", relatedIssues: [{ id: "IQ-0002", question: "相关问题" }], recentEvents: [],
    },
    recentEvents: [],
  }] });
  assert.match(output, /关联议题：IQ-0002 相关问题/);
});

test("renderChatPack exposes a decision deadline countdown when present", () => {
  const output = renderChatPack({ dossiers: [{
    issue: {
      id: "IQ-0003", question: "是否行动", type: "重大决策", stage: "待决策", importance: "", judgment: "", confidence: null,
      unknown: "", changeConditions: "", nextStep: "", deadline: "2026-09-20 09:00", deadlineDays: 6, reversibility: "可逆", relatedIssues: [], recentEvents: [],
    },
    recentEvents: [],
  }] });
  assert.match(output, /决策截止时间：2026-09-20 09:00（剩余 6 天）/);
});

test("renderChatPack uses the minimal human event fields", () => {
  const output = renderChatPack({ dossiers: [{
    issue: {
      id: "IQ-0001", question: "测试问题", type: "长期问题", stage: "探索", importance: "", judgment: "", confidence: null,
      unknown: "", changeConditions: "", nextStep: "", deadline: "", reversibility: "", recentEvents: [],
    },
    recentEvents: [{
      "内容摘要": "发现新的约束", "详细内容": "详细记录新的现实反馈", "事件时间": "2026-09-14", "事件类型": "", "证据方向": "",
      "认知增量": "", "来源系统": "", "来源标识": "", "来源链接": "",
    }],
  }] });
  assert.match(output, /发现新的约束；详细内容：详细记录新的现实反馈/);
  assert.doesNotMatch(output, /未填写：发现新的约束/);
});

test("renderChatPack keeps legacy structured event fields", () => {
  const output = renderChatPack({ dossiers: [{
    issue: {
      id: "IQ-0001", question: "测试问题", type: "长期问题", stage: "探索", importance: "", judgment: "", confidence: null,
      unknown: "", changeConditions: "", nextStep: "", deadline: "", reversibility: "", recentEvents: [],
    },
    recentEvents: [{
      "事件摘要": "旧事件摘要", "发生了什么": "旧事件详情", "事件类型": "证据", "证据方向": "支持", "认知增量": "旧增量",
      "事件时间": "2026-09-14", "来源系统": "Learn-X", "来源标识": "legacy", "来源链接": "https://example.com",
    }],
  }] });
  assert.match(output, /证据 \/ 支持：旧事件摘要；认知增量：旧增量/);
  assert.match(output, /支持：- 2026-09-14 证据 \/ 支持：旧事件摘要/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  actionFeedbackEventKey,
  ACTION_FEEDBACK_FIELD_SCHEMA,
  BASE_FIELD_SCHEMA,
  coreTopicMetadata,
  ensureActionFeedbackDraft,
  parseActionFeedbackTable,
  parseShortTermTopics,
  renderActionFeedbackDraft,
  renderOpenActions,
  repoRoot,
  routeConfirmedEvents,
  LEGACY_BASE_FIELD_SCHEMA,
  schemaIssues,
  TIME_GROUP_FIELD_SCHEMA,
  validateActionFeedbackReport,
  visibleCharCount,
} from "./action-feedback.mjs";
import { SOURCE_FILES, SOURCE_NAMES } from "../../learn-x-input/scripts/lib/source-status.mjs";

const TOPICS = ["北大光华价值投资课", "和丽姐深度合作", "读书会", "求职市场采样", "大理定居考察-12月"];
const CORE_DOC = [
  "<!-- source: https://example.test/wiki/core revision: 246 -->",
  "# 长期核心议题",
  "# 短期核心议题",
  "<table><tbody>",
  ...TOPICS.map((topic) => `<tr><td></td><td>${topic}</td><td>P1</td></tr>`),
  "</tbody></table>",
  "# 其他",
].join("\n");

test("parseShortTermTopics 只读取短期议题并保持文档顺序", () => {
  assert.deepEqual(parseShortTermTopics(CORE_DOC), TOPICS);
  assert.deepEqual(coreTopicMetadata(CORE_DOC), { revision: "246", source: "https://example.test/wiki/core", status: "unknown" });
});

test("新建 Base 只声明事件字段，旧任务字段仅保留兼容 schema", () => {
  assert.deepEqual(BASE_FIELD_SCHEMA.map((field) => field.name), ["短期核心议题", "行动", "反馈", "周期时间", "事件键", "事件创建时间"]);
  assert.deepEqual(TIME_GROUP_FIELD_SCHEMA.map((field) => field.name), ["年", "月", "年度第几周"]);
  assert.deepEqual(ACTION_FEEDBACK_FIELD_SCHEMA.slice(-3), TIME_GROUP_FIELD_SCHEMA);
  assert.ok(LEGACY_BASE_FIELD_SCHEMA.some((field) => field.name === "状态"));
  assert.ok(!BASE_FIELD_SCHEMA.some((field) => field.name === "状态"));
});

test("字段迁移拒绝同名但类型错误的字段", () => {
  const issues = schemaIssues([
    { name: "事件键", type: "text" },
    { name: "事件创建时间", type: "datetime" },
  ], BASE_FIELD_SCHEMA);
  assert.deepEqual(issues.missing, ["短期核心议题", "行动", "反馈", "周期时间"]);
  assert.deepEqual(issues.mismatched, ["事件创建时间（实际类型 datetime，预期 created_at）"]);
});

test("renderActionFeedbackDraft 输出三列、五个议题且不超过 1000 字", () => {
  const report = renderActionFeedbackDraft({ week: "2026-W37", topics: TOPICS, revision: "246" });
  assert.match(report, /\| 短期核心议题 \| 行动 \| 反馈 \|/);
  for (const topic of TOPICS) assert.match(report, new RegExp(topic));
  assert.ok(report.length <= 1000);
  assert.equal(visibleCharCount("😀"), 1);
  assert.doesNotMatch(report, /状态|反馈类型|下一步|证据|时间字段/);
});

test("ensureActionFeedbackDraft 不覆盖已有报告，核心议题缺失时标记 needs_review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-action-feedback-"));
  const target = path.join(root, "action-feedback.md");
  await writeFile(target, "用户已经填写的报告\n", "utf8");
  const preserved = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: root, coreTopicsFile: "/private/tmp/not-found-core-topics.md" });
  assert.equal(preserved.status, "preserved");
  assert.equal(await readFile(target, "utf8"), "用户已经填写的报告\n");

  const reviewRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-action-feedback-review-"));
  const review = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: reviewRoot, coreTopicsFile: "/private/tmp/not-found-core-topics.md" });
  assert.equal(review.status, "needs_review");
  assert.match(await readFile(review.path, "utf8"), /未读取到短期核心议题/);

  const createdRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-action-feedback-created-"));
  const created = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: createdRoot, coreTopicsFile: path.join(repoRoot, "01_core/道/人生核心议题.md") });
  assert.equal(created.status, "created");
});

test("parseActionFeedbackTable 识别确认、未确认和同议题多行", () => {
  const report = [
    "# Action Feedback 周报｜2026-W37",
    "",
    "| 短期核心议题 | 行动 | 反馈 |",
    "|---|---|---|",
    "| 读书会 | [x] 组织一次讨论 | 有 3 人参加 |",
    "| 读书会 | [ ] 整理讨论记录 | 待补充 |",
    "| 求职市场采样 | — | 本周无新事项 |",
  ].join("\n");
  const rows = parseActionFeedbackTable(report);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].confirmed, true);
  assert.equal(rows[1].confirmed, false);
  assert.equal(rows[2].action, "—");
});

test("validateActionFeedbackReport 要求完整议题覆盖并拒绝未知主题与超长报告", () => {
  const valid = renderActionFeedbackDraft({ week: "2026-W37", topics: TOPICS });
  assert.equal(validateActionFeedbackReport(valid, TOPICS, "2026-W37").length, TOPICS.length);
  assert.throws(() => validateActionFeedbackReport(valid.replace("| 读书会 |", "| 其他主题 |"), TOPICS, "2026-W37"), /缺少短期核心议题|未在议题基线/);
  assert.throws(() => validateActionFeedbackReport(valid, TOPICS.slice(0, 4), "2026-W37"), /未在议题基线/);
  assert.throws(() => validateActionFeedbackReport(`${valid}\n${"x".repeat(1000)}`, TOPICS, "2026-W37"), /超过 1000/);
  assert.doesNotThrow(() => validateActionFeedbackReport(`${valid}\n${"😀".repeat(450)}`, TOPICS, "2026-W37"));
});

function record(key, values = {}) {
  return { id: `rec-${key}`, values: { "事件键": key, ...values } };
}

test("事件键同周稳定、跨周变化", () => {
  const first = actionFeedbackEventKey("2026-W37", TOPICS[0], "上课 + 作业");
  assert.equal(first, actionFeedbackEventKey("2026-W37", TOPICS[0], "上课 + 作业"));
  assert.notEqual(first, actionFeedbackEventKey("2026-W38", TOPICS[0], "上课 + 作业"));
});

test("routeConfirmedEvents 按事件键更新、跨周新建，并合并同一行动反馈", () => {
  const key = actionFeedbackEventKey("2026-W37", "读书会", "组织一次讨论");
  const entries = [
    { confirmed: true, topic: "读书会", action: "组织一次讨论", feedback: "3 人参加", week: "2026-W37", period: "2026-09-07 00:00:00" },
    { confirmed: true, topic: "读书会", action: "组织一次讨论", feedback: "形成下次主题", week: "2026-W37", period: "2026-09-07 00:00:00" },
    { confirmed: false, topic: "求职市场采样", action: "采样岗位", feedback: "不应写入", week: "2026-W37" },
  ];
  const plan = routeConfirmedEvents(entries, [record(key)]);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].fields["反馈"], "3 人参加；形成下次主题");
  assert.equal(plan.updates[0].fields["短期核心议题"], "读书会");

  const nextWeek = routeConfirmedEvents([{ ...entries[0], week: "2026-W38", period: "2026-09-14 00:00:00" }], [record(key)]);
  assert.equal(nextWeek.creates.length, 1);
  assert.notEqual(nextWeek.creates[0].eventKey, key);

  const mixedWeeks = routeConfirmedEvents([
    { ...entries[0], week: "2026-W37" },
    { ...entries[0], week: "2026-W38" },
  ]);
  assert.equal(mixedWeeks.creates.length, 2);
});

test("renderOpenActions 保留旧 collect 兼容能力", () => {
  const markdown = renderOpenActions({
    week: "2026-W37",
    records: [{ id: "rec-1", values: { "行动 ID": "AF-2026-W36-01", 行动: "行动 A", 状态: "continue" } }],
    baseUrl: "https://example.test/base",
    readAt: "2026-09-14T08:00:00.000Z",
  });
  assert.match(markdown, /未闭环行动数：1/);
  assert.match(markdown, /AF-2026-W36-01/);
});

test("旧 open-actions 仍只作为兼容源，不进入新 process pack 固定输入", async () => {
  assert.equal(SOURCE_FILES["open-actions"], "open-actions.md");
  assert.ok(SOURCE_NAMES.has("open-actions"));
  const source = await readFile(path.join(repoRoot, ".agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs"), "utf8");
  assert.doesNotMatch(source, /SOURCE_FILES\["open-actions"\]/);
  assert.match(await readFile(path.join(repoRoot, "package.json"), "utf8"), /action:feedback/);
});

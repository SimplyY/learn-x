import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  actionFeedbackEventKey,
  actionFeedbackTargetMode,
  ACTION_FEEDBACK_FIELD_SCHEMA,
  BASE_FIELD_SCHEMA,
  coreTopicMetadata,
  ensureActionFeedbackDraft,
  findEventByKey,
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

test("字段迁移拒绝表达式错误的既有公式字段", () => {
  const issues = schemaIssues([
    ...BASE_FIELD_SCHEMA.map((field) => ({ name: field.name, type: field.type })),
    ...TIME_GROUP_FIELD_SCHEMA.map((field) => ({ name: field.name, type: field.type, expression: "wrong" })),
  ], ACTION_FEEDBACK_FIELD_SCHEMA);
  assert.equal(issues.missing.length, 0);
  assert.equal(issues.mismatched.length, TIME_GROUP_FIELD_SCHEMA.length);
});

test("已配置 Base 缺字段时必须停在原目标，不按名称发现并切换", () => {
  assert.equal(actionFeedbackTargetMode({ baseToken: "explicit" }, null), "configured");
  assert.equal(actionFeedbackTargetMode({}, { baseToken: "pinned" }), "configured");
  assert.equal(actionFeedbackTargetMode({}, null), "discover");
});

test("renderActionFeedbackDraft 输出三列、五个议题且不超过 1000 字", () => {
  const report = renderActionFeedbackDraft({ week: "2026-W37", topics: TOPICS, revision: "246" });
  assert.match(report, /\| 短期核心议题 \| 行动 \| 反馈 \|/);
  for (const topic of TOPICS) assert.match(report, new RegExp(topic));
  assert.match(report, /阶段 1 初稿/);
  assert.match(report, /\| 北大光华价值投资课 \| 待核对 \| 待核对 \|/);
  assert.doesNotMatch(report, /本周无新事项/);
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

  const unknownRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-action-feedback-unknown-status-"));
  const unknownMirror = path.join(unknownRoot, "core.md");
  await writeFile(unknownMirror, `${CORE_DOC}\n<!-- status: unknown -->`, "utf8");
  const unknown = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: unknownRoot, coreTopicsFile: unknownMirror });
  assert.equal(unknown.status, "needs_review");
});

test("仅在确认周记晚于严格待核对模板时刷新基线，其他报告继续保留", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-action-feedback-refresh-"));
  const target = path.join(root, "action-feedback.md");
  const weeklyInputFile = path.join(root, "weekly.md");
  const currentCoreFile = path.join(root, "core.md");
  const blankDraft = renderActionFeedbackDraft({ week: "2026-W37", topics: TOPICS, revision: "246" });
  await writeFile(weeklyInputFile, "# 已确认周记\n", "utf8");
  await writeFile(currentCoreFile, `${CORE_DOC.replace("revision: 246", "revision: 277")}\n<!-- status: fresh -->`, "utf8");
  await writeFile(target, blankDraft, "utf8");
  await utimes(weeklyInputFile, new Date("2020-01-02T00:00:00Z"), new Date("2020-01-02T00:00:00Z"));

  await utimes(target, new Date("2020-01-03T00:00:00Z"), new Date("2020-01-03T00:00:00Z"));
  const notStale = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: root, coreTopicsFile: currentCoreFile, weeklyInputFile });
  assert.equal(notStale.status, "preserved");
  assert.equal(await readFile(target, "utf8"), blankDraft);

  await utimes(target, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));

  const refreshed = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: root, coreTopicsFile: currentCoreFile, weeklyInputFile });
  assert.equal(refreshed.status, "refreshed");
  assert.equal(refreshed.revision, "277");
  const draft = await readFile(target, "utf8");
  assert.match(draft, /revision 277/);
  assert.match(draft, /阶段 1 初稿/);
  assert.match(draft, /\| 北大光华价值投资课 \| 待核对 \| 待核对 \|/);

  const userFilled = draft.replace("| 北大光华价值投资课 | 待核对 | 待核对 |", "| 北大光华价值投资课 | [ ] 参加课程 | 尚待案例校准 |");
  await writeFile(target, userFilled, "utf8");
  await utimes(target, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  const preserved = await ensureActionFeedbackDraft({ week: "2026-W37", outputRoot: root, coreTopicsFile: currentCoreFile, weeklyInputFile });
  assert.equal(preserved.status, "preserved");
  assert.equal(await readFile(target, "utf8"), userFilled);
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

test("表格解析保留转义竖线、拒绝多列错位，并忽略报告中的其他表格", () => {
  const report = [
    "# Action Feedback 周报｜2026-W37",
    "",
    "| 短期核心议题 | 行动 | 反馈 |",
    "|---|---|---|",
    "| 读书会 | [x] 比较 A\\|B 两种方案 | 获得“保留 X\\|Y”的反馈 |",
    "",
    "## 补充",
    "| 这不是议题基线 | 任意列 | 忽略 |",
  ].join("\n");
  const [row] = parseActionFeedbackTable(report);
  assert.equal(row.action, "比较 A|B 两种方案");
  assert.equal(row.feedback, "获得“保留 X|Y”的反馈");
  assert.throws(() => parseActionFeedbackTable(report.replace("| 读书会 |", "| 读书会 | extra |")), /必须为三列/);
});

test("validateActionFeedbackReport 要求完整议题覆盖并拒绝未知主题与超长报告", () => {
  const valid = renderActionFeedbackDraft({ week: "2026-W37", topics: TOPICS });
  assert.equal(validateActionFeedbackReport(valid, TOPICS, "2026-W37").length, TOPICS.length);
  assert.throws(() => validateActionFeedbackReport(valid.replace("| 读书会 |", "| 其他主题 |"), TOPICS, "2026-W37"), /缺少短期核心议题|未在议题基线/);
  assert.throws(() => validateActionFeedbackReport(valid.replace("| 读书会 | 待核对 | 待核对 |\n", ""), TOPICS, "2026-W37"), /缺少短期核心议题/);
  const checkedPlaceholder = valid.replace(`| ${TOPICS[0]} | 待核对 | 待核对 |`, `| ${TOPICS[0]} | [x] 待核对 | 待核对 |`);
  assert.throws(() => validateActionFeedbackReport(checkedPlaceholder, TOPICS, "2026-W37"), /真实行动和非占位反馈/);
  assert.throws(() => validateActionFeedbackReport(`${valid}\n${"x".repeat(1000)}`, TOPICS, "2026-W37"), /超过 1000/);
  assert.doesNotThrow(() => validateActionFeedbackReport(`${valid}\n${"😀".repeat(450)}`, TOPICS, "2026-W37"));
  assert.throws(() => validateActionFeedbackReport(renderActionFeedbackDraft({ week: "2021-W53", topics: TOPICS }), TOPICS, "2021-W53"), /不存在第 53 周/);
  assert.equal(validateActionFeedbackReport(renderActionFeedbackDraft({ week: "2020-W53", topics: TOPICS }), TOPICS, "2020-W53")[0].period, "2020-12-28 00:00:00");
  const renamed = TOPICS.map((topic) => `新季度-${topic}`);
  assert.equal(validateActionFeedbackReport(valid, renamed, "2026-W37", "277").length, TOPICS.length);
  const legacyWithoutSnapshot = valid.replace(/<!-- action-feedback-baseline:[^>]+ -->\n/, "");
  assert.throws(() => validateActionFeedbackReport(legacyWithoutSnapshot, renamed, "2026-W37", "277"), /没有议题快照/);
});

function record(key, values = {}) {
  return { id: `rec-${key}`, values: { "事件键": key, ...values } };
}

test("事件键同周稳定、跨周变化", () => {
  const first = actionFeedbackEventKey("2026-W37", TOPICS[0], "上课 + 作业");
  assert.equal(first, actionFeedbackEventKey("2026-W37", TOPICS[0], "上课 + 作业"));
  assert.notEqual(first, actionFeedbackEventKey("2026-W38", TOPICS[0], "上课 + 作业"));
});

test("新事件暂不可见时按事件键有限重试，避免写入成功后误报失败", async () => {
  const delays = [];
  let reads = 0;
  const found = await findEventByKey("event-1", async () => {
    reads += 1;
    return reads < 3 ? [] : [record("event-1")];
  }, async (ms) => delays.push(ms));
  assert.equal(found.id, "rec-event-1");
  assert.equal(reads, 3);
  assert.deepEqual(delays, [250, 500]);

  reads = 0;
  const absent = await findEventByKey("not-visible", async () => {
    reads += 1;
    return [];
  }, async (ms) => delays.push(ms));
  assert.equal(absent, null);
  assert.equal(reads, 5);
  assert.deepEqual(delays.slice(2), [250, 500, 750, 1000]);
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

  const placeholder = routeConfirmedEvents([
    { confirmed: true, topic: TOPICS[0], action: "待核对", feedback: "待核对", week: "2026-W37" }
  ]);
  assert.equal(placeholder.creates.length, 0);
  assert.equal(placeholder.skipped.length, 1);
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

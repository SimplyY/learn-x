import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInputAuditRows, classifyWeeklyOutput, compressWeeklyProcessItems, previousWeeklyPeriod, readPreviousWeeklyOutput, renderInputAuditTable, renderProcessPack, summarizeActionFeedbackReport } from "./generate-weekly-process-pack.mjs";
import { renderActionFeedbackDraft } from "./action-feedback.mjs";

const ACTION_TOPICS = ["投资线-北大光华价值投资课", "创业线-和丽姐深度合作", "活动线-读书会", "求职市场采样", "旅游线-大理-12月"];

test("weekly Process Pack embeds the co-reviewed Action Feedback snapshot", () => {
  const actionFeedback = renderActionFeedbackDraft({ week: "2026-W37", topics: ACTION_TOPICS, revision: "246" });
  const pack = renderProcessPack({
    week: "2026-W37",
    range: { start: "2026-09-14T00:00:00.000Z", end: "2026-09-20T23:59:59.999Z" },
    selection: { path: "03_input/weekly/2026-W37", mode: "iso" },
    generatedAt: "2026-09-19T00:00:00.000Z",
    stats: { fileCount: 0, itemCount: 0, uniqueItemCount: 0, duplicateCount: 0, excludedFileCount: 0 },
    sourceStatuses: {},
    files: [],
    excludedFiles: []
  }, [], [], [], { sourceCount: 0, files: [] }, { status: "needs_review", count: "5 议题 / 0 条候选", result: "needs_review" }, actionFeedback);

  assert.match(pack, /Action Feedback 是核心行动 \/ 反馈输入，完整快照见第 8 节/);
  assert.match(pack, /以下为同目录 `action-feedback\.md` 的完整快照/);
  assert.match(pack, /Action Feedback 周报｜2026-W37/);
  for (const topic of ACTION_TOPICS) assert.match(pack, new RegExp(topic));
  assert.match(pack, /\| 独立产物 \| Action Feedback \|/);
  assert.doesNotMatch(pack, /常规只把本文件交给 AI Chat/);
});

test("weekly comparison selects the direct ISO predecessor across year rollover and embeds its full Output", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-compare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(previousWeeklyPeriod("2026-W01"), "2025-W52");
  assert.equal(previousWeeklyPeriod("2025-W01"), "2024-W52");
  assert.equal(previousWeeklyPeriod("2021-W01"), "2020-W53");

  const outputDir = path.join(root, "04_output/weekly");
  await mkdir(outputDir, { recursive: true });
  const priorOutput = "# Learn-X Weekly Output｜2025-52\n\n## 本周总览\n\n连续判断与用户补充回答。\n";
  await writeFile(path.join(outputDir, "2025-52.md"), priorOutput, "utf8");
  const baseline = await readPreviousWeeklyOutput("2026-W01", root);
  assert.equal(baseline.week, "2025-W52");
  assert.equal(baseline.status, "ready");
  assert.equal(baseline.content, priorOutput);

  const pack = renderWeeklyPackWithComparison(baseline);
  assert.match(pack, /## 9\. 上周 Weekly Output（仅作对照）/);
  assert.match(pack, /以下是上周完整 Weekly Output，只作对照/);
  assert.match(pack, /本周事实以 Process Pack 当前周材料为准/);
  assert.ok(pack.includes(priorOutput.trim()));
});

test("weekly comparison reports missing, empty, and shell baselines without falling back", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "04_output/weekly");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "2025-51.md"), "older week content", "utf8");

  const missing = await readPreviousWeeklyOutput("2026-W01", root);
  assert.equal(missing.status, "missing");
  assert.match(renderWeeklyPackWithComparison(missing), /2025-W52，missing；不可比较/);

  await writeFile(path.join(outputDir, "2025-52.md"), "  \n", "utf8");
  const empty = await readPreviousWeeklyOutput("2026-W01", root);
  assert.equal(empty.status, "empty");
  assert.equal(classifyWeeklyOutput(""), "empty");

  await writeFile(path.join(outputDir, "2025-52.md"), "# Learn-X Weekly Output｜2025-52\n\n> 基于 `04_output/_dist/weekly/2025-W52/` 由用户使用 AI Chat 生成正文后填入。\n", "utf8");
  const shell = await readPreviousWeeklyOutput("2026-W01", root);
  assert.equal(shell.status, "shell");
  assert.match(renderWeeklyPackWithComparison(shell), /2025-W52，shell；不可比较/);
  assert.doesNotMatch(renderWeeklyPackWithComparison(shell), /older week content/);

  const placeholderTemplate = "# Learn-X Weekly Output｜2025-52\n\n## 11. 全文核心重点纪要\n1. xx\n2. xx\n3. xx\n\n## 13. 本周问题与回答\n1. 问题：todo\n   回答：待补充\n";
  assert.equal(classifyWeeklyOutput(placeholderTemplate), "shell");
});

test("compresses Voice-X once at Process Pack time and reports the overall ratio", () => {
  const source = [
    "# Voice-X 核心重点｜2026-W36", "", "## with 测试", "",
    "## 核心总结", "", "关键事实与行动反馈。".repeat(500), "",
    "## 芒格之魂洞察", "", "核心判断与风险边界。".repeat(300)
  ].join("\n");
  const input = { path: "03_input/weekly/2026-W36/voice.md", text: source };
  const result = compressWeeklyProcessItems([input]);
  assert.equal(input.text, source);
  assert.notEqual(result.items[0].text, source);
  assert.ok(result.compression.outputChars < result.compression.sourceChars);
  assert.ok(result.compression.retainedRatio <= 0.25);
  assert.equal(result.compression.targetRetainedRatio, 0.2);
});

test("renders the full source-to-final character chain with failures and compression", () => {
  const payload = {
    week: "2026-W36",
    selection: { path: "03_input/weekly/2026-W36" },
    sourceStatuses: {
      daily: { status: "ready", file: "daily.md", count: 2, summary: "有日记" },
      flomo: { status: "failed", file: "flomo.md", count: 0, summary: "采集失败：页面不可用", preservedStaleFile: true },
      voice: { status: "ready", file: "voice.md", count: 1, summary: "有洞察" },
      coach: { status: "empty", file: "coach.md", count: 0, summary: "本周 0 条记录，文件未生成", preservedStaleFile: false },
      "build-bot": { status: "unavailable", file: "build-bot.md", count: 0, summary: "机器人侧未完成", preservedStaleFile: false }
    },
    excludedFiles: [{ file: "flomo.md", present: true }]
  };
  const files = [
    { path: "03_input/weekly/2026-W36/daily.md", source: "daily", itemCount: 2, rawChars: 100, effectiveChars: 90, processChars: 90 },
    { path: "03_input/weekly/2026-W36/voice.md", source: "voice", itemCount: 1, rawChars: 1000, effectiveChars: 1000, processChars: 220 }
  ];
  const compression = { files: [{ path: files[1].path, sourceChars: 1000, candidateChars: 220, retainedRatio: 0.22 }] };
  const rows = buildInputAuditRows(payload, files, compression);
  const table = renderInputAuditTable(payload, files, compression);

  assert.equal(rows[0].file, "daily.md");
  assert.equal(rows.find((row) => row.file === "flomo.md").status, "failed");
  assert.match(table, /\| 类型 \/ 产物 \| 来源 \| 文件 \| 状态 \|/);
  assert.match(table, /字符链路（文件原始 → 清洗有效〔去重前〕→ 最终纳入）/);
  const tableRows = table.split("\n").filter((line) => /^\|/.test(line)).slice(2);
  assert.match(tableRows[0], /\| Flomo \| \[flomo\.md\]/);
  assert.match(tableRows[1], /\| 独立产物 \| Action Feedback \| \[action-feedback\.md\]/);
  assert.match(tableRows[1], /不计入 input\.json/);
  assert.match(tableRows[2], /\| 飞书日记 \| \[daily\.md\]/);
  assert.match(table, /采集失败：页面不可用/);
  assert.match(table, /1000 → 1000 → 220（Voice-X 压缩，保留 22%）/);
  assert.doesNotMatch(table, /仅确定性清洗|未做语义压缩/);
  assert.match(table, /build-bot\.md \| unavailable/);
  assert.match(table, /旧文件保留但过期、不计入/);
  assert.match(table, /wisdom\.md \| 未发现/);
  assert.match(table, /本轮需关注：.*Flomo（flomo\.md：failed）/);
  assert.doesNotMatch(table, /本轮需关注：.*微信聊天/);
  assert.match(table, /wechat\.md \| 未发现/);
  assert.match(table, /\]\(learnx:\/\/03_input%2Fweekly%2F2026-W36%2Fdaily\.md\)/);
});

test("Action Feedback summary row shows candidate and confirmation counts without changing input totals", () => {
  const payload = {
    week: "2026-W38",
    selection: { path: "03_input/weekly/2026-W38" },
    sourceStatuses: {},
    excludedFiles: []
  };
  const table = renderInputAuditTable(payload, [], { files: [] }, {
    path: "04_output/_dist/weekly/2026-W38/action-feedback.md",
    status: "ready（默认通过）",
    count: "5 议题 / 4 条候选",
    result: "独立产物，不计入 input.json；随用户确认周记一并通过；4 条候选，4 条将写入 Base。"
  });

  const tableRows = table.split("\n").filter((line) => /^\|/.test(line)).slice(2);
  assert.match(tableRows[1], /5 议题 \/ 4 条候选/);
  assert.match(tableRows[1], /4 条将写入 Base/);
  assert.match(tableRows[1], /\]\(learnx:\/\/04_output%2F_dist%2Fweekly%2F2026-W38%2Faction-feedback\.md\)/);
  assert.doesNotMatch(table, /本轮需关注：.*Action Feedback/);
  assert.equal(buildInputAuditRows(payload, [], []).length, 14);
});

test("weekly Process Pack registers the ready personal Feishu Docs source row", () => {
  const payload = {
    week: "2026-W38",
    selection: { path: "03_input/weekly/2026-W38" },
    sourceStatuses: {
      "feishu-docs": { status: "ready", file: "feishu-docs.md", count: 2, summary: "2 篇本人创建或编辑文档" }
    },
    excludedFiles: []
  };
  const files = [{
    path: "03_input/weekly/2026-W38/feishu-docs.md",
    source: "feishu-docs",
    itemCount: 2,
    rawChars: 120,
    effectiveChars: 120,
    processChars: 120
  }];

  const row = buildInputAuditRows(payload, files, { files: [] }).find((item) => item.file === "feishu-docs.md");
  assert.equal(row.source, "个人飞书文档");
  assert.equal(row.status, "ready");
  assert.equal(row.count, 2);
  assert.equal(row.rawChars, 120);
});

test("Action Feedback table summary counts candidates and fails closed on incomplete rows", () => {
  const week = "2026-W37";
  let report = renderActionFeedbackDraft({ week, topics: ACTION_TOPICS, revision: "246" });
  ACTION_TOPICS.forEach((topic, index) => {
    const action = index < 4 ? `[x] 行动 ${index + 1}` : "—";
    const feedback = index < 4 ? `反馈 ${index + 1}` : "本周无实际行动或反馈";
    report = report.replace(`| ${topic} | 待核对 | 待核对 |`, `| ${topic} | ${action} | ${feedback} |`);
  });

  const summary = summarizeActionFeedbackReport({ report, week, topics: ACTION_TOPICS, currentRevision: "246", filePath: "action-feedback.md" });
  assert.equal(summary.status, "ready（默认通过）");
  assert.equal(summary.count, "5 议题 / 4 条候选");
  assert.match(summary.result, /4 条候选，4 条将写入 Base/);

  const incomplete = report.replace(`| ${ACTION_TOPICS[0]} | [x] 行动 1 | 反馈 1 |`, `| ${ACTION_TOPICS[0]} |  |  |`);
  const needsReview = summarizeActionFeedbackReport({ report: incomplete, week, topics: ACTION_TOPICS, currentRevision: "246" });
  assert.equal(needsReview.status, "needs_review");
  assert.match(needsReview.result, /候选初稿尚待证据核对/);
});

test("Stage 1 automation requires a final character count for each included ready file", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage1Report = skill.slice(skill.indexOf("阶段 1 汇报必须"), skill.indexOf("## 阶段 1 内"));

  assert.match(stage1Report, /阶段 1 仅生成 `action-feedback.md`/);
  assert.match(stage1Report, /`countInputChars`（Unicode 码点数）/);
  assert.match(stage1Report, /链路写 `— → N`，不得把整格写成 `—`/);
  assert.match(stage1Report, /Action Feedback 是独立产物，不作为输入来源行/);
  assert.match(skill, /阶段 1 固定总表在 `weekly\.md` 后加入 `feishu-docs\.md`/);
});

test("weekly automation creates and reviews Action Feedback at Stage 1", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage1Report = skill.slice(skill.indexOf("阶段 1 汇报必须"), skill.indexOf("## 阶段 2："));
  const stage2 = skill.slice(skill.indexOf("## 阶段 2："), skill.indexOf("## 阶段 3："));

  assert.match(stage1Report, /Action Feedback 草稿/);
  assert.match(stage1Report, /action:feedback -- draft/);
  assert.match(stage1Report, /`周记已确认` 表示两份草稿都已审核通过/);
  assert.match(stage2, /回读 Process Pack 第 8 节/);
  assert.match(stage2, /上一 ISO 周.*完整的 `04_output\/weekly\/YYYY-WW\.md`/);
  assert.match(stage2, /阶段 2 汇报只报告上一周 Output 的周期、状态和绝对可点击文件链接，不复述旧 Output 正文或旧问答/);
  assert.doesNotMatch(stage2, /逐项填 Action Feedback 候选/);
  assert.match(stage2, /Flomo 第一行，独立 Action Feedback 第二行/);
  assert.match(stage2, /不计入 `input\.json` 输入数/);
});

test("weekly Output rules define concise comparison and bounded user-answer questions", async () => {
  const [rules, prompt] = await Promise.all([
    readFile(new URL("../resources/weekly-output-rules.md", import.meta.url), "utf8"),
    readFile(new URL("../../../../02_prompts/chatpack/reflective-decision/weekly-output.md", import.meta.url), "utf8")
  ]);
  assert.match(rules, /上周 Weekly Output（仅作对照）/);
  assert.match(rules, /600 字/);
  assert.match(rules, /本周总览.*核心洞察/s);
  assert.match(rules, /全文核心重点纪要.*芒格之魂的洞察.*问题与回答/);
  assert.match(rules, /其它相关内容只作次级参照/);
  assert.match(rules, /不显示百分比、不机械打分/);
  assert.match(rules, /10–20 字/);
  assert.match(rules, /最多 50 字/);
  assert.match(rules, /问题核心加补充合计不超过 100 字/);
  assert.match(prompt, /跨周对照/);
  assert.match(prompt, /10–20 字为目标、最多 50 字/);
  assert.match(prompt, /问题与补充合计最多 100 字/);
});

function renderWeeklyPackWithComparison(previousOutput) {
  return renderProcessPack({
    week: "2026-W01",
    range: { start: "2025-12-29T00:00:00.000Z", end: "2026-01-04T23:59:59.999Z" },
    selection: { path: "03_input/weekly/2026-W01", mode: "iso" },
    generatedAt: "2026-01-05T00:00:00.000Z",
    stats: { fileCount: 0, itemCount: 0, uniqueItemCount: 0, duplicateCount: 0, excludedFileCount: 0 },
    sourceStatuses: {},
    files: [],
    excludedFiles: []
  }, [], [], [], { sourceCount: 0, files: [] }, {}, "", previousOutput);
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildInsightContext, buildInsightPrompt, cleanFlomoMemoBody, extractFlomoTags, flomoExclusionReason, parseFlomoMemos, parseIsoWeek, parseRange, preflightSnapshotFreshness, resolveMaterialTypes, resolveTarget, validatePeriodicConfig } from "./periodic-insight-core.mjs";

const config = { schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", chatPackSubtypeId: "insight.munger-soul", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month", fallback: "week" }, contextPolicyId: "periodic-v1" }] };
const NOW = new Date("2026-09-16T00:00:00+08:00");
const body = (title, text = "证据 ".repeat(100)) => `# ${title}\n\n${text}`;
const text = (count = 60, word = "背景") => `${word} `.repeat(count);
const lifeCore = (status = "fresh", wordCount = 60) => `<!--\nsource: https://example.feishu.cn/wiki/life-core\nrevision: 242\nbody-sha256: ${"a".repeat(64)}\nlast-synced-at: 2026-09-14T08:00:00+08:00\nlast-attempt-at: 2026-09-14T08:00:00+08:00\nstatus: ${status}\n-->\n\n# 人生核心议题\n\n长期核心议题：${"议题 ".repeat(wordCount)}`;
const memoryFile = (segments) => `# 季度记忆\n\n${segments.join("\n\n")}\n`;
const seg = (heading, word = "背景") => `## ${heading}\n\n${text(60, word)}`;
const writeJson = (root, relative, value) => writeFile(path.join(root, relative), JSON.stringify(value));

async function prepare(root, extra = {}) {
  await mkdir(path.join(root, "00_config"), { recursive: true });
  await writeJson(path.join(root), "00_config/periodic-insights.json", extra.config || config);
  for (const [relative, content] of Object.entries(extra.files || {})) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
}

test("月目标缺失时选择最近完整周，目标输出与历史背景分开装配", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: { "04_output/weekly/2026-37.md": body("Weekly"), "04_output/monthly/2026-07.md": "# 空壳\n\nTODO", "01_core/memory/2026-Q3.memory.md": body("Memory"), "01_core/道/人生核心议题.md": lifeCore() } });
  const target = await resolveTarget(root, config.tasks[0], "auto", NOW); assert.equal(target.id, "2026-W37"); assert.equal(target.path, "04_output/weekly/2026-37.md");
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", range: "1y", now: NOW });
  assert.equal(result.target.id, "2026-W37"); assert.equal(result.range.id, "1y"); assert.match(result.content, /## 目标输出 · /); assert.match(result.content, /## 人生核心议题 · 01_core\/道\/人生核心议题\.md/); assert.ok(result.content.indexOf("## 人生核心议题") < result.content.indexOf("## 目标输出"));
  assert.ok(result.included.some((item) => item.role === "target-output" && item.tier === 1)); assert.ok(result.included.some((item) => item.role === "life-core" && item.sync?.status === "fresh")); assert.ok(result.excluded.some((item) => item.role === "target-journal" && item.reason === "missing-or-empty"));
  assert.equal(result.sha256.length, 64); assert.equal(result.manifest.schemaVersion, 2);
});

test("无月级 Memory 时用周级 Memory，再退月记，再退周记", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-cascade-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "01_core/memory/2026-Q2.memory.md": memoryFile([seg("2026-W19", "五月周记忆"), seg("候选观察池", "观察")]),
    "03_input/monthly/2026-6/monthly-journal.md": body("六月月记"),
    "03_input/weekly/2026-W27/weekly.md": body("W27 周记"), "03_input/weekly/2026-W28/weekly.md": body("W28 周记")
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", now: NOW });
  const included = result.included.filter((item) => item.role === "history-backbone");
  assert.ok(included.some((item) => item.kind === "memory-week" && item.dateBasis === "2026-W19"));
  assert.ok(included.some((item) => item.kind === "monthly-journal" && item.dateBasis === "2026-06"));
  assert.ok(included.some((item) => item.kind === "weekly-journal" && item.dateBasis === "2026-W27"));
  assert.ok(included.some((item) => item.kind === "weekly-journal" && item.dateBasis === "2026-W28"));
  assert.ok(!included.some((item) => item.kind === "weekly-journal" && item.dateBasis === "2026-W31"));
  assert.ok(result.excluded.some((item) => item.kind === "memory-undated" && item.reason === "undated-candidate-pool"));
  assert.ok(result.content.indexOf("五月周记忆") < result.content.indexOf("六月月记"));
});

test("月级 Memory 存在时覆盖该月周 Memory 与月记周记", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-month-priority-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "01_core/memory/2026-Q2.memory.md": memoryFile([seg("Monthly｜2026-04", "四月月记忆"), seg("2026-W14", "四月周记忆")]),
    "03_input/monthly/2026-4/monthly-journal.md": body("四月月记"),
    "03_input/weekly/2026-W14/weekly.md": body("W14 周记")
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", now: NOW });
  const included = result.included.filter((item) => item.role === "history-backbone");
  assert.deepEqual(included.map((item) => item.kind), ["memory-month"]);
  assert.ok(result.excluded.some((item) => item.kind === "memory-week" && item.reason === "superseded-by-month-memory"));
  assert.ok(!result.content.includes("# 四月月记")); assert.ok(!result.content.includes("# W14 周记"));
});

test("目标之后与范围之外的 Memory 不泄漏进 Context", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-leak-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "01_core/memory/2026-Q3.memory.md": memoryFile([seg("Monthly｜2026-09", "九月记忆"), seg("2026-W38", "九月周记忆")]),
    "01_core/memory/ChatGPT-AI记忆版.md": body("Legacy Memory"),
    "03_input/weekly/2026-W20/weekly.md": body("五月周记")
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "3m", now: NOW });
  const leak = result.excluded.find((item) => item.kind === "memory-overlap" && item.reason === "after-target");
  assert.ok(leak); assert.match(String(leak.dateBasis), /2026-09/); assert.match(String(leak.dateBasis), /2026-W38/);
  assert.ok(!result.content.includes("九月记忆") && !result.content.includes("九月周记忆"));
  assert.ok(result.excluded.some((item) => item.path.endsWith("ChatGPT-AI记忆版.md") && item.reason === "invalid-period"));
});

test("畸形周标题与周目录按 invalid-period 排除，不再中断构建", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-invalid-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "01_core/memory/2026-Q2.memory.md": memoryFile([seg("2026-W99", "畸形周段"), seg("Monthly｜2026-04", "正常月记忆")]),
    "03_input/weekly/2026-W99/weekly.md": body("畸形周目录周记"),
    "03_input/weekly/2026-W14/weekly.md": body("W14 周记")
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", now: NOW });
  assert.ok(result.excluded.some((item) => item.kind === "memory-invalid" && item.dateBasis === "2026-W99" && item.reason === "invalid-period"));
  assert.ok(result.excluded.some((item) => item.kind === "weekly-directory" && item.dateBasis === "2026-W99" && item.reason === "invalid-period"));
  assert.ok(result.included.some((item) => item.kind === "memory-month" && item.dateBasis === "2026-04"));
  assert.ok(result.included.some((item) => item.kind === "weekly-journal" && item.dateBasis === "2026-W14"));
  assert.ok(!result.content.includes("畸形周段") && !result.content.includes("畸形周目录周记"));
});

test("目标月的月记与周记不进历史骨架，范围起点边界的 Flomo 保留", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-boundary-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "03_input/monthly/2026-8/monthly-journal.md": body("目标月月记"),
    "03_input/weekly/2026-W31/weekly.md": body("目标月周记"),
    "03_input/weekly/2026-W31/flomo.md": "## 2026-08-01 00:00\n\n范围起点当天的记录 #日记"
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", now: NOW });
  const backbone = result.included.filter((item) => item.role === "history-backbone");
  assert.ok(!backbone.some((item) => item.kind === "monthly-journal"));
  assert.ok(!backbone.some((item) => item.kind === "weekly-journal"));
  assert.ok(result.content.includes("范围起点当天的记录"));
  assert.ok(!result.manifest.internal.flomo.some((item) => item.reason === "outside-range" && item.created?.startsWith("2026-08-01")));
});

test("月目标优先 input.json.weeklyPaths，缺失回退日期相交周", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-tj-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-07.md": body("Target"),
    "03_input/weekly/2026-W27/weekly.md": body("W27 周记")
  } });
  await mkdir(path.join(root, "04_output/_dist/monthly/2026-07"), { recursive: true });
  await writeJson(root, "04_output/_dist/monthly/2026-07/input.json", { selection: { weeklyPaths: ["03_input/weekly/2026-W27", "03_input/weekly/2026-W28"] } });  const declared = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-07", range: "1y", now: NOW });
  const tj = declared.included.filter((item) => item.role === "target-journal");
  assert.deepEqual(tj.map((item) => item.dateBasis), ["2026-W27"]);
  assert.ok(declared.excluded.some((item) => item.role === "target-journal" && item.dateBasis === "2026-W28" && item.reason === "missing-or-empty"));
  const fallback = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-07", range: "1y", now: NOW, includeTypes: "target-output,target-journal" });
  assert.ok(fallback.included.some((item) => item.role === "target-journal" && item.dateBasis === "2026-W27"));
  assert.ok(!fallback.content.includes("历史记忆"));
});

test("Flomo 三种标题格式都能解析，连续 h3 各自成段", () => {
  const markdown = ["# Flomo", "", "## 采集信息", "- 周期：示例", "", "## 2026-07-01 12:15", "内容A", "", "## 2026-08-10 9:30", "内容B", "", "## 2026-06-02", "", "### 13:46:43", "内容C", "", "### 14:00:00", "内容D"].join("\n");
  const memos = parseFlomoMemos(markdown);
  assert.deepEqual(memos.map((memo) => `${memo.dateStr} ${memo.timeStr}`), ["2026-07-01 12:15:00", "2026-08-10 09:30:00", "2026-06-02 13:46:43", "2026-06-02 14:00:00"]);
  assert.deepEqual(memos.map((memo) => memo.body.trim()), ["内容A", "内容B", "内容C", "内容D"]);
  assert.deepEqual(cleanFlomoMemoBody("- 来源：https://example.com/x\n正文\n\nhttps://example.com/y\n![](https://img)\n保留行"), "正文\n\n保留行");
});

test("Flomo 过滤：Learn-X 标签命中但正文提及放行，AI 与否定标签排除", () => {
  assert.equal(flomoExclusionReason("记录 #learn-x/周记 内容"), "reverse-sync-tag");
  assert.equal(flomoExclusionReason("Learn-X 周记｜2026-W37"), "reverse-sync-memo");
  assert.equal(flomoExclusionReason("今天用 Learn-X 记了一条 #日记"), null);
  assert.equal(flomoExclusionReason("自动生成 #ai洞察"), "ai-insight-tag");
  assert.equal(flomoExclusionReason("自动生成 #自我认知/ai洞察"), "ai-insight-tag");
  assert.equal(flomoExclusionReason("不想回顾 #不洞察"), "user-excluded-tag");
  assert.equal(flomoExclusionReason("不想回顾 #不回顾"), "user-excluded-tag");
  assert.deepEqual(extractFlomoTags("#写诗 #旅行/博物馆。#被截断`"), ["写诗", "旅行/博物馆", "被截断"]);
});

test("Flomo 诗歌 300 字边界、近 6 个月全量与更早低信号过滤、全局去重", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-flomo-")); t.after(() => rm(root, { recursive: true, force: true }));
  const poemShort = `## 2026-08-01 09:30\n\n${"诗".repeat(295)} #写诗`;
  const poemLong = `## 2026-08-02 09:30\n\n${"诗".repeat(297)} #写诗`;
  const dedupMemo = "## 2026-08-03 10:00\n\n这是需要全局去重的重复内容。";
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "03_input/weekly/2026-W31/flomo.md": [poemShort, poemLong, dedupMemo].join("\n\n"),
    "03_input/monthly/2026-8/flomo.md": `${dedupMemo}\n\n## 2026-02-01 08:00\n\n没有高信号标签的旧内容`,
    "03_input/monthly/2026-1/flomo.md": `## 2026-01-05 08:00\n\n${text(30, "旧事")} #回顾/一月`
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", now: NOW });
  const included = result.manifest.internal.flomo.filter((item) => item.decision === "included");
  const poems = included.filter((item) => item.tier === 1);
  assert.equal(poems.length, 1);
  assert.ok(included.some((item) => item.tier === 3 && item.created.startsWith("2026-08-02")));
  const weeklyFile = "03_input/weekly/2026-W31/flomo.md";
  assert.equal(included.filter((item) => item.path === weeklyFile).length, 2);
  assert.ok(!included.some((item) => item.path === weeklyFile && item.created.startsWith("2026-08-03")));
  assert.ok(result.content.indexOf("## 目标输出") < result.content.indexOf(`## Flomo · ${weeklyFile}`));
  assert.ok(included.some((item) => item.tier === 4 && item.created.startsWith("2026-01-05")));
  const excluded = result.manifest.internal.flomo.filter((item) => item.decision === "excluded");
  assert.ok(excluded.some((item) => item.reason.startsWith("duplicate-of:")));
  assert.ok(excluded.some((item) => item.reason === "older-low-signal" && item.created.startsWith("2026-02-01")));
});

test("includeTypes：默认四类、锁定目标输出、非法与重复值失败、禁用留痕", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-types-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: { "04_output/monthly/2026-08.md": body("Target"), "03_input/weekly/2026-W31/flomo.md": "## 2026-08-01 09:30\n\n一条普通记录" } });
  const onlyFlomo = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", includeTypes: "flomo", now: NOW });
  assert.deepEqual(onlyFlomo.selectedTypes, ["target-output", "flomo"]);
  assert.ok(onlyFlomo.included.some((item) => item.role === "flomo")); assert.ok(!onlyFlomo.content.includes("人生核心议题"));
  const disabled = onlyFlomo.excluded.filter((item) => item.reason === "user-disabled").map((item) => item.role).sort();
  assert.deepEqual(disabled, ["history-backbone", "life-core", "target-journal"]);
  const onlyTarget = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", range: "1y", includeTypes: "target-output", now: NOW });
  assert.deepEqual(onlyTarget.selectedTypes, ["target-output"]); assert.deepEqual(onlyTarget.included.map((item) => item.role), ["target-output"]);
  await assert.rejects(() => buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", includeTypes: "bogus", now: NOW }), /未知材料类型/);
  await assert.rejects(() => buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", includeTypes: "flomo,flomo", now: NOW }), /重复/);
  const policy = config.contextPolicies["periodic-v1"];
  assert.deepEqual(resolveMaterialTypes(undefined, policy).selected, ["life-core", "target-journal", "history-backbone", "flomo"]);
  assert.deepEqual(resolveMaterialTypes(["life-core"], policy).selected, ["life-core"]);
});

test("目标输出超过 Context 上限时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  const tight = { ...config, contextPolicies: { "periodic-v1": { ...config.contextPolicies["periodic-v1"], maxContextChars: 1000 } } };
  await prepare(root, { config: tight, files: { "04_output/monthly/2026-08.md": body("月报", "大材料 ".repeat(500)) } });
  await assert.rejects(() => buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", now: NOW }), /Context 超过/);
});

test("其他材料超预算时按优先级排除而不是失败", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-budget-drop-")); t.after(() => rm(root, { recursive: true, force: true }));
  const tight = { ...config, contextPolicies: { "periodic-v1": { ...config.contextPolicies["periodic-v1"], maxContextChars: 900 } } };
  await prepare(root, { config: tight, files: {
    "04_output/monthly/2026-08.md": body("月报", "目标 ".repeat(110)),
    "01_core/道/人生核心议题.md": lifeCore(),
    "03_input/weekly/2026-W31/flomo.md": `## 2026-08-01 09:30\n\n${"闲聊 ".repeat(120)}`
  } });
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", now: NOW });
  assert.ok(result.excluded.some((item) => item.role === "flomo" && item.reason === "context-budget"));
  assert.ok(result.chars <= 900); assert.ok(result.content.includes("人生核心议题")); assert.ok(!result.content.includes("闲聊"));
});

test("Manifest 显式记录预算、材料类型与稳定 sha256", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root, { files: {
    "04_output/monthly/2026-08.md": body("Target"),
    "01_core/道/人生核心议题.md": lifeCore("stale")
  } });
  const first = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", now: NOW });
  const second = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08", now: NOW });
  assert.deepEqual(first.budget, { contextChars: 100000, promptChars: 120000 });
  assert.deepEqual(first.manifest.availableTypes, ["target-output", "life-core", "target-journal", "history-backbone", "flomo"]);
  assert.equal(first.included.find((item) => item.role === "life-core").sync.status, "stale");
  assert.equal(first.sha256, second.sha256); assert.equal(first.chars, second.chars);
});

test("没有合格目标时也写出可审计的空 Manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-empty-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await prepare(root);
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "auto", now: NOW });
  assert.equal(result.target, null); assert.equal(result.manifest.target, null); assert.deepEqual(result.manifest.excluded, [{ reason: "no-substantive-target" }]);
  assert.deepEqual(result.manifest.selectedTypes, ["target-output", "life-core", "target-journal", "history-backbone", "flomo"]);
});

test("未声明 fallback 时不跨类型寻找目标", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-no-fallback-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  const task = { ...config.tasks[0], target: { preferred: "month" } };
  await writeFile(path.join(root, "04_output/weekly/2026-37.md"), body("Weekly"));
  assert.equal(await resolveTarget(root, task, "auto", NOW), null);
});

test("显式目标不能选择尚未结束的周期", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-future-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "04_output/monthly"), { recursive: true });
  await writeFile(path.join(root, "04_output/monthly/2026-10.md"), body("Future"));
  assert.equal(await resolveTarget(root, config.tasks[0], "2026-10", NOW), null);
});

test("日期和预算边界可预测", () => { assert.equal(parseIsoWeek("2026-W37").start.toISOString().slice(0, 10), "2026-09-07"); assert.equal(parseIsoWeek("2026-35").id, "2026-W35"); assert.throws(() => parseIsoWeek("2021-W53"), /ISO 周无效/); assert.equal(parseRange("1m", undefined, undefined, new Date("2026-08-31T00:00:00Z")).start.toISOString().slice(0, 10), "2026-08-01"); assert.equal(parseRange("1y", undefined, undefined, new Date("2026-08-31T00:00:00Z")).start.toISOString().slice(0, 10), "2025-09-01"); assert.equal(parseRange("custom", "2026-08-30", "2026-09-10", new Date("2026-08-31T00:00:00Z")).end.toISOString().slice(0, 10), "2026-08-31"); assert.throws(() => parseRange("custom", "2026-02-30", "2026-03-01"), /from/); assert.throws(() => parseRange("custom", "2026-09-02", "2026-09-01", new Date("2026-08-31T00:00:00Z")), /from/); assert.throws(() => parseRange("custom", "2026-08-01", undefined, new Date("2026-08-31T00:00:00Z")), /from\/to/); });

test("配置契约要求 schema v2 与 defaultMaterialTypes，拒绝重复任务", () => {
  const policy = { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] };
  assert.throws(() => validatePeriodicConfig({ ...config, schemaVersion: 1 }), /配置契约无效/);
  assert.throws(() => validatePeriodicConfig({ ...config, contextPolicies: { "periodic-v1": { ...policy, defaultMaterialTypes: undefined } } }), /Context Policy/);
  assert.throws(() => validatePeriodicConfig({ ...config, contextPolicies: { "periodic-v1": { ...policy, defaultMaterialTypes: ["flomo", "flomo"] } } }), /Context Policy/);
  assert.throws(() => validatePeriodicConfig({ ...config, contextPolicies: { "periodic-v1": { ...policy, defaultMaterialTypes: ["process-pack"] } } }), /Context Policy/);
  assert.throws(() => validatePeriodicConfig({ ...config, tasks: [{ ...config.tasks[0] }, { ...config.tasks[0] }] }), /洞察任务/);
});

test("Prompt 装配使用声明的子类型并拒绝路径穿越", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-prompt-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "声明的适配器");
  const task = { id: "alias", chatPackSubtypeId: "insight.munger-soul", prompt: { defaultEnhancerIds: [] } }; const prompt = await buildInsightPrompt({ repoRoot: root, context: "Context", task, target: { id: "2026-08", kind: "month" } }); assert.match(prompt, /声明的适配器/); await assert.rejects(() => buildInsightPrompt({ repoRoot: root, context: "Context", task: { ...task, chatPackSubtypeId: "insight.foo\/..\/bar" }, target: { id: "2026-08", kind: "month" } }), /子类型标识无效/);
});

test("snapshot 预检：远端新版本自动 pull，且告警显式留痕", async () => {
  const calls = [];
  const check = { project: "/repo", fresh_limit_days: 7, live_status: "ok", assets: [
    { prompt_id: "chatpack.a", freshness: "ok", freshness_days: 1, remote_changed: true },
    { prompt_id: "chatpack.b", freshness: "stale", freshness_days: 30, remote_changed: false },
  ] };
  const run = (args) => { calls.push(args); if (args[0] === "check") return { status: 0, stdout: JSON.stringify(check) }; return { status: 0, stdout: JSON.stringify({ ok: true, plans: [] }) }; };
  const logs = [];
  const result = await preflightSnapshotFreshness({ repoRoot: "/repo", run, log: (line) => logs.push(line) });
  assert.equal(result.checked, true);
  assert.equal(result.pulled, true);
  assert.deepEqual(result.remote_changed_ids, ["chatpack.a"]);
  assert.deepEqual(result.stale_ids, ["chatpack.b"]);
  assert.deepEqual(calls[1], ["pull", "--project", "/repo", "--all", "--confirm"]);
  assert.ok(logs.some((line) => line.includes("自动 pull")));
  assert.ok(logs.some((line) => line.includes("30") || line.includes("未校准")));
});

test("snapshot 预检：offline 与 pull 被拒都不阻塞且必须告警", async () => {
  const logs = [];
  const offline = await preflightSnapshotFreshness({ repoRoot: "/repo", run: () => { throw new Error("spawn lark-cli failed"); }, log: (line) => logs.push(line) });
  assert.equal(offline.checked, false);
  assert.equal(offline.pulled, false);
  assert.ok(offline.warnings.some((line) => line.includes("继续使用本地副本")));
  const logs2 = [];
  const check = { project: "/repo", fresh_limit_days: 7, live_status: "degraded", assets: [
    { prompt_id: "chatpack.a", freshness: "ok", freshness_days: 1, remote_changed: true },
    { prompt_id: "chatpack.b", freshness: "ok", freshness_days: 2, live_error: "offline" },
  ] };
  const result2 = await preflightSnapshotFreshness({ repoRoot: "/repo", run: (args) => { if (args[0] === "check") return { status: 2, stdout: JSON.stringify(check) }; throw new Error("本地文件存在未提交修改：02_prompts/x.md"); }, log: (line) => logs2.push(line) });
  assert.equal(result2.checked, true);
  assert.equal(result2.pulled, false);
  assert.ok(logs2.some((line) => line.includes("保留旧版本")));
  assert.ok(logs2.some((line) => line.includes("offline")));
});

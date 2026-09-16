import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildInsightContext, buildInsightPrompt, parseIsoWeek, parseRange, resolveTarget, validatePeriodicConfig } from "./periodic-insight-core.mjs";

const config = { schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month", fallback: "week" }, contextPolicyId: "periodic-v1" }] };
const body = (title, text = "证据 ".repeat(100)) => `# ${title}\n\n${text}`;

test("月目标缺失时选择最近完整周，且目标与历史范围分开", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "04_output/weekly"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/weekly/2026-W37"), { recursive: true }); await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify(config)); await writeFile(path.join(root, "04_output/weekly/2026-37.md"), body("Weekly")); await writeFile(path.join(root, "04_output/monthly/2026-07.md"), "# 空壳\n\nTODO"); await writeFile(path.join(root, "04_output/monthly/2026-06.md"), body("Old Month")); await writeFile(path.join(root, "04_output/_dist/weekly/2026-W37/process-pack.md"), body("Process Pack")); await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), body("Memory"));
  const target = await resolveTarget(root, config.tasks[0], "auto", new Date("2026-09-16T00:00:00+08:00")); assert.equal(target.id, "2026-W37"); assert.equal(target.path, "04_output/weekly/2026-37.md");
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", range: "1y", now: new Date("2026-09-16T00:00:00+08:00") });
  assert.equal(result.target.id, "2026-W37"); assert.equal(result.range.id, "1y"); assert.match(result.content, /目标输出/); assert.ok(result.included.some((item) => item.role === "process-pack")); assert.deepEqual(result.excluded.find((item) => item.path.endsWith("2026-07.md")), { path: "04_output/monthly/2026-07.md", role: "confirmed-output", chars: 10, dateBasis: "2026-07", reason: "empty-or-placeholder" }); assert.equal(result.sha256.length, 64);
});

test("未声明 fallback 时不跨类型寻找目标", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-no-fallback-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  const task = { ...config.tasks[0], target: { preferred: "month" } };
  await writeFile(path.join(root, "04_output/weekly/2026-37.md"), body("Weekly"));
  assert.equal(await resolveTarget(root, task, "auto", new Date("2026-09-16T00:00:00+08:00")), null);
});

test("日期和预算边界可预测", () => { assert.equal(parseIsoWeek("2026-W37").start.toISOString().slice(0, 10), "2026-09-07"); assert.equal(parseIsoWeek("2026-35").id, "2026-W35"); assert.throws(() => parseIsoWeek("2021-W53"), /ISO 周无效/); assert.equal(parseRange("1m", undefined, undefined, new Date("2026-08-31T00:00:00Z")).start.toISOString().slice(0, 10), "2026-08-01"); assert.equal(parseRange("1y", undefined, undefined, new Date("2026-08-31T00:00:00Z")).start.toISOString().slice(0, 10), "2025-09-01"); assert.equal(parseRange("custom", "2026-08-30", "2026-09-10", new Date("2026-08-31T00:00:00Z")).end.toISOString().slice(0, 10), "2026-08-31"); assert.throws(() => parseRange("custom", "2026-02-30", "2026-03-01"), /from/); assert.throws(() => parseRange("custom", "2026-09-02", "2026-09-01", new Date("2026-08-31T00:00:00Z")), /from/); assert.throws(() => parseRange("custom", "2026-08-01", undefined, new Date("2026-08-31T00:00:00Z")), /from\/to/); });

test("显式目标不能选择尚未结束的周期", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-future-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "04_output/monthly"), { recursive: true });
  await writeFile(path.join(root, "04_output/monthly/2026-10.md"), body("Future"));
  assert.equal(await resolveTarget(root, config.tasks[0], "2026-10", new Date("2026-09-16T00:00:00+08:00")), null);
});

test("没有合格目标时也写出可审计的空 Manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-empty-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify(config));
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "auto", now: new Date("2026-09-16T00:00:00+08:00") });
  assert.equal(result.target, null); assert.equal(result.manifest.target, null); assert.deepEqual(result.manifest.excluded, [{ reason: "no-substantive-target" }]);
});

test("配置契约拒绝重复任务和无效预算", () => { assert.throws(() => validatePeriodicConfig({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 0, historicalBudgetChars: 30, timezone: "Asia/Shanghai" } }, tasks: [] }), /Context Policy/); assert.throws(() => validatePeriodicConfig({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "bad id", name: "x", prompt: { productionReady: false, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }), /洞察任务/); });

test("目标输出超过 Context 上限时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ ...config, contextPolicies: { "periodic-v1": { ...config.contextPolicies["periodic-v1"], maxContextChars: 1000 } } })); await writeFile(path.join(root, "04_output/monthly/2026-08.md"), body("月报", "大材料 ".repeat(500)));
  await assert.rejects(() => buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }), /Context 超过/);
});

test("无章节 Process Pack 超出预算时也必须出现在排除清单", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-process-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/monthly/2026-08"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ ...config, contextPolicies: { "periodic-v1": { ...config.contextPolicies["periodic-v1"], maxContextChars: 1000 } } }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), body("月报", "目标 ".repeat(110)));
  await writeFile(path.join(root, "04_output/_dist/monthly/2026-08/process-pack.md"), "Process ".repeat(120));
  const result = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08" });
  assert.ok(result.excluded.some((item) => item.role === "process-pack" && item.reason === "context-budget"));
  assert.ok(result.chars <= 1000);
});

test("Prompt 装配使用声明的子类型并拒绝路径穿越", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-prompt-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "声明的适配器");
  const task = { id: "alias", chatPackSubtypeId: "insight.munger-soul", prompt: { defaultEnhancerIds: [] } }; const prompt = await buildInsightPrompt({ repoRoot: root, context: "Context", task, target: { id: "2026-08", kind: "month" } }); assert.match(prompt, /声明的适配器/); await assert.rejects(() => buildInsightPrompt({ repoRoot: root, context: "Context", task: { ...task, chatPackSubtypeId: "insight.foo\/..\/bar" }, target: { id: "2026-08", kind: "month" } }), /子类型标识无效/);
});

test("Manifest 显式记录未选章节、非法 Memory 和稳定预算", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify(config));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), body("Target"));
  await writeFile(path.join(root, "04_output/monthly/2026-07.md"), "# 历史\n\n## 不相关章节\n\n" + "背景 ".repeat(60) + "\n\n## 核心判断\n\n" + "判断 ".repeat(60));
  await writeFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), body("Legacy Memory"));
  const first = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08" });
  const second = await buildInsightContext({ repoRoot: root, taskId: "munger-soul", target: "2026-08" });
  assert.deepEqual(first.budget, { contextChars: 100000, promptChars: 120000, historicalChars: 30000 });
  assert.ok(first.excluded.some((item) => item.reason === "section-not-whitelisted"));
  assert.ok(first.excluded.some((item) => item.path.endsWith("ChatGPT-AI记忆版.md") && item.reason === "invalid-period"));
  assert.equal(first.sha256, second.sha256);
});

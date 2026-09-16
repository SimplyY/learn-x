import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exitCodeForResult, runPeriodicInsight, validateGeneratedOutput } from "./run-periodic-insight.mjs";

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const bridgeSuccess = (text, extra = {}) => ({ result: { status: "succeeded", runId: "run-generated", conversationUrl: "https://chatgpt.com/c/generated", text, format: "markdown", verification: "live-dom+snapshot", outputSha256: sha256(text), ...extra } });

test("CLI 只把已完成状态视为成功，setup-wiki 成功也返回 0", () => { assert.equal(exitCodeForResult("setup-wiki", { name: "Learn-X 周期洞察" }), 0); assert.equal(exitCodeForResult("run", { status: "preview" }), 0); assert.equal(exitCodeForResult("run", { status: "skipped" }), 0); assert.equal(exitCodeForResult("run", { status: "completed" }), 0); assert.equal(exitCodeForResult("run", { status: "archive_pending" }), 2); assert.equal(exitCodeForResult("run", { status: "needs_review" }), 2); });

test("preview 写入 Manifest 和状态；submitted 不会自动重发", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-run-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/enhancers"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const first = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); assert.equal(first.status, "preview"); assert.ok((await readFile(first.paths.manifest, "utf8")).includes("target-output"));
  await writeFile(first.paths.state, JSON.stringify({ status: "completed", contextSha256: "stale", promptSha256: "stale" })); const changed = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); assert.equal(changed.status, "needs_review"); assert.equal(changed.reason, "input-changed-after-completion");
  await writeFile(first.paths.state, JSON.stringify({ status: "submitted", taskId: "munger-soul" })); let calls = 0; const second = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; throw new Error("must-not-resend"); } }); assert.equal(second.status, "submitted"); assert.equal(calls, 0);
});

test("Bridge 返回 needs_review 时只记录一次提交", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-review-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  let calls = 0; const first = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; return { result: { status: "needs_review", runId: "r1", reason: "observer-timeout" } }; } }); assert.equal(first.status, "needs_review");
  const second = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; throw new Error("must-not-resend"); } }); assert.equal(second.status, "needs_review"); assert.equal(calls, 1);
});

test("Bridge 成功时保存会话、运行键和生成结果", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-generated-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] })); await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => bridgeSuccess(text) }); assert.equal(result.status, "generated"); assert.equal(result.runId, "run-generated"); assert.match(await readFile(result.paths.generated, "utf8"), /运行键：munger-soul:month:2026-08/);
});

test("Bridge 缺少 live-dom+snapshot 验证时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-verification-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] })); await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; let calls = 0; const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-unverified", conversationUrl: "https://chatgpt.com/c/unverified", text } }; } }); assert.equal(result.status, "needs_review"); assert.equal(result.reason, "bridge-result-invalid"); assert.equal(calls, 1); assert.equal(await readFile(result.paths.generated).catch(() => null), null);
});

test("占位洞察即使传入 send 也只预览，不调用 Bridge", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-placeholder-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "weekly-review", name: "每周复盘", prompt: { productionReady: false, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/weekly-review.md"), "TODO：Prompt 待历史样本反推");
  let calls = 0; const result = await runPeriodicInsight({ repoRoot: root, taskId: "weekly-review", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; } }); assert.equal(result.status, "preview"); assert.equal(result.reason, "production-not-ready"); assert.equal(calls, 0);
});

test("芒格输出必须包含目标周期和六层结构", () => { const task = { id: "munger-soul" }; const target = { id: "2026-08" }; const valid = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; validateGeneratedOutput(valid, task, target); assert.throws(() => validateGeneratedOutput("2026-08 候选洞察", task, target), /过短|六层/); });

test("归档恢复使用注入的 Lark 传输并保留幂等节点", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-archive-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/periodic-insights"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察"); await writeFile(path.join(root, "04_output/_dist/periodic-insights/wiki.json"), JSON.stringify({ name: "Learn-X 周期洞察", spaceId: "space", visibility: "private", openSharing: "closed" }));
  const preview = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); const generated = `# 芒格之魂｜2026-08\n\n- 运行键：munger-soul:month:2026-08\n- 运行结果：候选洞察\n- ChatGPT 会话：https://chatgpt.com/c/test\n\n${"候选洞察 2026-08 底层 第二层 第三层 第四层 第五层 顶层。".repeat(8)}`; await writeFile(preview.paths.generated, generated); const oldState = JSON.parse(await readFile(preview.paths.state, "utf8")); await writeFile(preview.paths.state, JSON.stringify({ ...oldState, status: "generated", runId: "run-archive", conversationUrl: "https://chatgpt.com/c/test" }));
  const calls = []; const runLark = async (args) => { calls.push(args.slice(0, 2).join(" ")); if (args[0] === "wiki" && args[1] === "+node-list" && args.includes("--parent-node-token")) return { data: { nodes: [{ title: "芒格之魂｜2026-08", node_token: "node", obj_token: "doc" }] } }; if (args[0] === "wiki" && args[1] === "+node-list") return { data: { nodes: [{ title: "2026", node_token: "year", obj_token: "year-doc" }] } }; if (args[0] === "docs" && args[1] === "+update") return { ok: true }; if (args[0] === "docs" && args[1] === "+fetch") return { data: { document: { content: generated } } }; throw new Error(`unexpected-lark-call:${args.join(" ")}`); };
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", archive: true, runLark }); assert.equal(result.status, "completed"); assert.equal(result.archive.documentToken, "doc"); assert.ok(calls.includes("docs +update")); assert.ok(calls.includes("docs +fetch")); assert.equal(await readFile(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08/feishu.xml")).catch(() => null), null);
});

test("目标暂时缺失时不覆盖已提交状态", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-preserve-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08/state.json"), JSON.stringify({ status: "submitted", taskId: "munger-soul", target: { id: "2026-08" } })); const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul" }); assert.equal(result.status, "submitted"); assert.match(result.paths.state, /2026-08[\\/]state\.json$/);
});

test("无合格目标时 skipped 会保存空 Manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-skipped-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month", fallback: "week" }, contextPolicyId: "periodic-v1" }] }));
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul" });
  assert.equal(result.status, "skipped"); assert.equal(JSON.parse(await readFile(result.paths.manifest, "utf8")).excluded[0].reason, "no-substantive-target"); assert.equal(result.contextSha256, sha256(""));
});

test("Bridge 进程退出码异常时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-exit-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`;
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => ({ ...bridgeSuccess(text), exit: { code: 1, timedOut: false } }) });
  assert.equal(result.status, "needs_review"); assert.equal(result.reason, "bridge-exit-nonzero");
});

test("同一目标并发运行只允许一个 Bridge 调用", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-lock-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; let calls = 0;
  const runBridge = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 50)); return bridgeSuccess(text); };
  const results = await Promise.all([1, 2].map(() => runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge })));
  assert.equal(calls, 1); assert.ok(results.some((item) => item.status === "generated")); assert.ok(results.some((item) => item.reason === "run-in-progress"));
});

test("生成状态缺少本地产物时不降级成预览", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-missing-generated-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 1, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, historicalBudgetChars: 30000, timezone: "Asia/Shanghai" } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const preview = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); const state = JSON.parse(await readFile(preview.paths.state, "utf8")); await writeFile(preview.paths.state, JSON.stringify({ ...state, status: "generated" }));
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); assert.equal(result.status, "needs_review"); assert.equal(result.reason, "generated-output-missing");
});

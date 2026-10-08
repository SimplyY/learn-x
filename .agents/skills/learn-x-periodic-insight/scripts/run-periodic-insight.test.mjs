import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exitCodeForResult, runPeriodicInsight as runPeriodicInsightImpl, setupWiki, validateGeneratedOutput } from "./run-periodic-insight.mjs";

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const bridgeSuccess = (text, extra = {}) => ({ result: { status: "succeeded", runId: "run-generated", conversationUrl: "https://chatgpt.com/c/generated", text, format: "markdown", verification: "live-dom+snapshot", outputSha256: sha256(text), ...extra } });
const defaultLatestPromptAssets = async ({ task }) => {
  const subtype = String(task.chatPackSubtypeId || `insight.${task.id}`).replace(/^insight\./, "");
  const ids = [`chatpack.insight-${subtype}`, ...(task.prompt.defaultEnhancerIds.includes("munger-soul") ? ["chatpack.munger-soul"] : [])];
  return ids.map((prompt_id, index) => {
    const content = `实时 Prompt 正文：${prompt_id}`;
    return { contract_version: "prompt-asset/v1", prompt_id, consumer_role: index === 0 ? "subtype" : "enhancer", prompt_source: "https://example.feishu.cn/wiki/doc", prompt_document_id: "doc", prompt_revision: 42, prompt_sha256: sha256(content), prompt_fetched_at: "2026-10-04T00:00:00.000Z", content };
  });
};
const runPeriodicInsight = (options = {}) => runPeriodicInsightImpl({ ...options, fetchLatestPromptAssets: options.fetchLatestPromptAssets || defaultLatestPromptAssets });

test("CLI 只把已完成状态视为成功，setup-wiki 成功也返回 0", () => { assert.equal(exitCodeForResult("setup-wiki", { name: "Learn-X 周期洞察" }), 0); assert.equal(exitCodeForResult("run", { status: "preview" }), 0); assert.equal(exitCodeForResult("run", { status: "skipped" }), 0); assert.equal(exitCodeForResult("run", { status: "completed" }), 0); assert.equal(exitCodeForResult("run", { status: "archive_pending" }), 2); assert.equal(exitCodeForResult("run", { status: "needs_review" }), 2); });

test("preview 写入 Manifest 和状态；submitted 不会自动重发", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-run-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/enhancers"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const first = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); assert.equal(first.status, "preview"); assert.ok((await readFile(first.paths.manifest, "utf8")).includes("target-output")); assert.equal(first.prompt_assets[0].prompt_revision, 42); assert.equal(first.prompt_assets[0].prompt_fetched_at, "2026-10-04T00:00:00.000Z"); const state = JSON.parse(await readFile(first.paths.state, "utf8")); assert.equal("prompt" in state, false); assert.equal(JSON.stringify(state).includes("实时 Prompt 正文"), false);
  const completedText = "已归档的完整候选洞察正文"; await writeFile(first.paths.generated, completedText); await writeFile(first.paths.state, JSON.stringify({ schemaVersion: 1, taskId: "munger-soul", runKey: first.runKey, target: first.target, status: "completed", contextSha256: "stale", promptSha256: "stale", runId: "run-completed", conversationUrl: "https://chatgpt.com/c/completed", completedAt: "2026-10-08T00:00:00.000Z", outputSha256: sha256(completedText), archive: { documentToken: "doc-completed", published: { status: "published", business_key: "completed-key" } } })); let promptReads = 0, bridgeCalls = 0;
  const changed = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", fetchLatestPromptAssets: async () => { promptReads += 1; throw new Error("completed previews must stay quiet"); }, runBridge: async () => { bridgeCalls += 1; throw new Error("completed previews must not call Bridge"); } }); assert.equal(changed.status, "completed"); assert.equal(promptReads, 0); assert.equal(bridgeCalls, 0);
  const accidentalSend = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, fetchLatestPromptAssets: async () => { promptReads += 1; throw new Error("completed target must not fetch prompt without force"); }, runBridge: async () => { bridgeCalls += 1; throw new Error("completed target must not call Bridge without force"); } }); assert.equal(accidentalSend.status, "completed"); assert.equal(promptReads, 0); assert.equal(bridgeCalls, 0);
  await rm(first.paths.generated); const missingCompletedArtifact = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", fetchLatestPromptAssets: async () => { promptReads += 1; throw new Error("must not read prompts"); }, runBridge: async () => { bridgeCalls += 1; throw new Error("must not call Bridge"); } }); assert.equal(missingCompletedArtifact.status, "needs_review"); assert.equal(missingCompletedArtifact.reason, "completed-output-integrity-failed"); assert.equal(promptReads, 0); assert.equal(bridgeCalls, 0);
  await writeFile(first.paths.state, JSON.stringify({ status: "submitted", taskId: "munger-soul" })); let calls = 0; const second = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; throw new Error("must-not-resend"); } }); assert.equal(second.status, "submitted"); assert.equal(calls, 0);
});

test("setup-wiki 创建私有空间时使用 bot 身份", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-setup-wiki-")); t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const record = await setupWiki({ repoRoot: root, confirm: true, runLark: async (args) => {
    calls.push(args);
    if (args[1] === "+space-list") return { data: { spaces: [] } };
    if (args[1] === "+space-create") return { data: { space_id: "private-space", visibility: "private", open_sharing: "closed" } };
    throw new Error(`unexpected-lark-call:${args.join(" ")}`);
  } });
  const identityOf = (args) => args[args.indexOf("--as") + 1];
  assert.equal(identityOf(calls[0]), "user");
  assert.equal(identityOf(calls[1]), "bot");
  assert.deepEqual(record, { name: "Learn-X 周期洞察", spaceId: "private-space", visibility: "private", openSharing: "closed", updatedAt: record.updatedAt });
  assert.equal(JSON.parse(await readFile(path.join(root, "04_output/_dist/periodic-insights/wiki.json"), "utf8")).spaceId, "private-space");
});

test("飞书 latest 读取失败时不启动 Bridge，下一次调用会重新读取", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-prompt-failure-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "STALE LOCAL BODY");
  let reads = 0, bridgeCalls = 0;
  const fail = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, fetchLatestPromptAssets: async () => { reads += 1; throw new Error("飞书权限失败"); }, runBridge: async () => { bridgeCalls += 1; } });
  assert.equal(fail.status, "needs_review"); assert.match(fail.reason, /latest-prompt-read-failed: 飞书权限失败/); assert.equal(bridgeCalls, 0);
  const retry = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", fetchLatestPromptAssets: async (args) => { reads += 1; return defaultLatestPromptAssets(args); } });
  assert.equal(retry.status, "preview"); assert.equal(reads, 2); assert.equal(bridgeCalls, 0);
});

test("Bridge 返回 needs_review 时只记录一次提交", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-review-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  let calls = 0; const first = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; return { result: { status: "needs_review", runId: "r1", reason: "observer-timeout" } }; } }); assert.equal(first.status, "needs_review");
  const second = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; throw new Error("must-not-resend"); } }); assert.equal(second.status, "needs_review"); assert.equal(calls, 1);
});

test("Bridge 成功时保存会话、运行键和生成结果", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-generated-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] })); await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => bridgeSuccess(text) }); assert.equal(result.status, "generated"); assert.equal(result.runId, "run-generated"); assert.match(await readFile(result.paths.generated, "utf8"), /运行键：munger-soul:month:2026-08/);
});

test("结构校验失败时保留候选文本但不归档且不重发", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-invalid-output-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), ["# 月报", "", "有效材料 ".repeat(100)].join(String.fromCharCode(10))); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const invalid = ["2026-08 候选洞察 " + "证据 ".repeat(30), "## 一、底层｜基础层", "证据", "## 二、第二层｜跨域联系", "证据", "## 四、第四层｜尺度切换", "证据", "## 五、第五层｜简化支点", "证据", "## 六、顶层｜整合", "证据"].join(String.fromCharCode(10));
  let calls = 0; const options = { repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, archive: true, confirm: true, runBridge: async () => { calls += 1; return bridgeSuccess(invalid); } };
  const first = await runPeriodicInsight(options); assert.equal(first.status, "needs_review"); assert.match(first.reason, /缺少第三层/); assert.equal(await readFile(first.paths.unvalidated, "utf8"), invalid); assert.equal(await readFile(first.paths.generated).catch(() => null), null);
  const second = await runPeriodicInsight(options); assert.equal(second.status, "needs_review"); assert.equal(calls, 1);
});

test("Bridge 缺少 live-dom+snapshot 验证时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-verification-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] })); await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; let calls = 0; const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-unverified", conversationUrl: "https://chatgpt.com/c/unverified", text } }; } }); assert.equal(result.status, "needs_review"); assert.equal(result.reason, "bridge-result-invalid"); assert.equal(calls, 1); assert.equal(await readFile(result.paths.generated).catch(() => null), null);
});

test("占位洞察即使传入 send 也只预览，不调用 Bridge", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-placeholder-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "weekly-review", name: "每周复盘", prompt: { productionReady: false, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/weekly-review.md"), "TODO：Prompt 待历史样本反推");
  let calls = 0; const result = await runPeriodicInsight({ repoRoot: root, taskId: "weekly-review", target: "2026-08", send: true, confirm: true, runBridge: async () => { calls += 1; } }); assert.equal(result.status, "preview"); assert.equal(result.reason, "production-not-ready"); assert.equal(calls, 0);
});

test("芒格输出必须包含目标周期和六层结构", () => {
  const task = { id: "munger-soul" };
  const target = { id: "2026-08" };
  const evidence = "证据 ".repeat(30);
  const valid = `2026-08 候选洞察 ${evidence}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`;
  const actualMungerFormat = `2026-08 候选洞察 ${evidence}\n## 一、底层｜基础层\n证据\n## 二、第二层｜跨域联系\n证据\n## 三、第三层｜反转假设\n证据\n## 四、第四层｜尺度切换\n证据\n## 五、第五层｜简化支点\n证据\n## 六、顶层｜整合\n证据`;
  const numberedLayerFormat = `2026-08 候选洞察 ${evidence}\n## 第一层｜基础层\n证据\n## 第二层｜领域同构\n证据\n## 第三层｜反转假设\n证据\n## 第四层｜变换尺度\n证据\n## 第五层｜寻找简化支点\n证据\n## 第六层｜整合跃迁\n证据`;
  validateGeneratedOutput(valid, task, target);
  validateGeneratedOutput(actualMungerFormat, task, target);
  validateGeneratedOutput(numberedLayerFormat, task, target);
  assert.throws(() => validateGeneratedOutput(actualMungerFormat.replace("## 三、第三层｜反转假设\n证据\n", ""), task, target), /六层/);
  assert.throws(() => validateGeneratedOutput(actualMungerFormat.replace("## 一、底层｜基础层", "## 一、底层模型｜基础层"), task, target), /六层/);
  assert.throws(() => validateGeneratedOutput(numberedLayerFormat.replace("## 第一层｜基础层", "## 第一层模型｜基础层"), task, target), /缺少底层/);
  assert.throws(() => validateGeneratedOutput(numberedLayerFormat.replace("## 第六层｜整合跃迁", "## 第七层｜整合跃迁"), task, target), /缺少顶层/);
  assert.throws(() => validateGeneratedOutput(`2026-08 候选洞察 ${evidence}\n正文提到底层、第二层、第三层、第四层、第五层和顶层，但没有按层分节。`, task, target), /六层/);
  assert.throws(() => validateGeneratedOutput("2026-08 候选洞察", task, target), /过短|六层/);
});

test("归档恢复使用注入的 Lark 传输并保留幂等节点", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-archive-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/periodic-insights"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察"); await writeFile(path.join(root, "04_output/_dist/periodic-insights/wiki.json"), JSON.stringify({ name: "Learn-X 周期洞察", spaceId: "space", visibility: "private", openSharing: "closed" }));
  const preview = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); const evidence = "证据材料。".repeat(12); const generated = `# 芒格之魂｜2026-08\n\n- 运行键：munger-soul:month:2026-08\n- 运行结果：候选洞察\n- ChatGPT 会话：https://chatgpt.com/c/test\n\n## 底层\n${evidence}\n## 第二层\n${evidence}\n## 第三层\n${evidence}\n## 第四层\n${evidence}\n## 第五层\n${evidence}\n## 顶层\n${evidence}`; await writeFile(preview.paths.generated, generated); const oldState = JSON.parse(await readFile(preview.paths.state, "utf8")); await writeFile(preview.paths.state, JSON.stringify({ ...oldState, status: "generated", runId: "run-archive", conversationUrl: "https://chatgpt.com/c/test" }));
  const pendingState = { ...oldState, status: "archive_pending", reason: "stale-previous-archive-error", runId: "run-archive", conversationUrl: "https://chatgpt.com/c/test", outputSha256: sha256(generated) }; await writeFile(preview.paths.state, JSON.stringify(pendingState));
  const calls = []; const runLark = async (args) => { calls.push(args.slice(0, 2).join(" ")); if (args[0] === "wiki" && args[1] === "+node-list" && args.includes("--parent-node-token")) return { data: { nodes: [{ title: "芒格之魂｜2026-08", node_token: "node", obj_token: "doc" }] } }; if (args[0] === "wiki" && args[1] === "+node-list") return { data: { nodes: [{ title: "2026", node_token: "year", obj_token: "year-doc" }] } }; if (args[0] === "docs" && args[1] === "+fetch") return { data: { document: { content: generated } } }; throw new Error(`unexpected-lark-call:${args.join(" ")}`); };
  const publishDoc = async (options) => { calls.push(`dc publish ${options.docToken}`); assert.equal(options.identity, "bot"); assert.ok(String(options.xml).includes("<")); return { status: "published", business_key: options.businessKey }; }; // M5：正文写入已切 dc 链，测试注入桩
  let promptReads = 0, bridgeCalls = 0;
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", archive: true, runLark, publishDoc, fetchLatestPromptAssets: async () => { promptReads += 1; throw new Error("archive recovery must not read prompts"); }, runBridge: async () => { bridgeCalls += 1; throw new Error("archive recovery must not call Bridge"); } }); assert.equal(result.status, "completed"); assert.equal("reason" in result, false); assert.equal(result.archive.documentToken, "doc"); assert.ok(calls.includes("dc publish doc")); assert.ok(calls.includes("docs +fetch")); assert.equal(promptReads, 0); assert.equal(bridgeCalls, 0); assert.equal(JSON.parse(await readFile(result.paths.state, "utf8")).reason, undefined); assert.equal(await readFile(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08/feishu.xml")).catch(() => null), null); assert.ok(result.archive.published.business_key.startsWith("learn-x-periodic-insight-munger-soul-"));
});

test("归档恢复遇到产物哈希不符时保持 pending 且绝不调用 Bridge", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-archive-corrupt-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`);
  const preview = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); const generated = `# 芒格之魂｜2026-08\n\n- 运行键：munger-soul:month:2026-08\n- 运行结果：候选洞察\n\n${"候选洞察 2026-08 底层 第二层 第三层 第四层 第五层 顶层。".repeat(8)}`; await writeFile(preview.paths.generated, generated); await writeFile(preview.paths.state, JSON.stringify({ schemaVersion: 1, taskId: "munger-soul", runKey: "munger-soul:month:2026-08", target: { id: "2026-08", kind: "month" }, status: "archive_pending", outputSha256: "stale" }));
  let promptReads = 0, bridgeCalls = 0; const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", archive: true, fetchLatestPromptAssets: async () => { promptReads += 1; throw new Error("must not read prompts"); }, runBridge: async () => { bridgeCalls += 1; throw new Error("must not call Bridge"); } });
  assert.equal(result.status, "archive_pending"); assert.equal(result.reason, "generated-output-integrity-mismatch"); assert.equal(promptReads, 0); assert.equal(bridgeCalls, 0);
});

test("目标暂时缺失时不覆盖已提交状态", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-preserve-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/_dist/periodic-insights/munger-soul/2026-08/state.json"), JSON.stringify({ status: "submitted", taskId: "munger-soul", target: { id: "2026-08" } })); const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul" }); assert.equal(result.status, "submitted"); assert.match(result.paths.state, /2026-08[\\/]state\.json$/);
});

test("无合格目标时 skipped 会保存空 Manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-skipped-manifest-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month", fallback: "week" }, contextPolicyId: "periodic-v1" }] }));
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul" });
  assert.equal(result.status, "skipped"); assert.equal(JSON.parse(await readFile(result.paths.manifest, "utf8")).excluded[0].reason, "no-substantive-target"); assert.equal(result.contextSha256, sha256(""));
});

test("Bridge 进程退出码异常时失败关闭", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-exit-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`;
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge: async () => ({ ...bridgeSuccess(text), exit: { code: 1, timedOut: false } }) });
  assert.equal(result.status, "needs_review"); assert.equal(result.reason, "bridge-exit-nonzero");
});

test("同一目标并发运行只允许一个 Bridge 调用", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-lock-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const text = `2026-08 候选洞察 ${"证据 ".repeat(30)}\n## 底层\n证据\n## 第二层\n证据\n## 第三层\n证据\n## 第四层\n证据\n## 第五层\n证据\n## 顶层\n证据`; let calls = 0;
  const runBridge = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 50)); return bridgeSuccess(text); };
  const results = await Promise.all([1, 2].map(() => runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08", send: true, confirm: true, runBridge })));
  assert.equal(calls, 1); assert.ok(results.some((item) => item.status === "generated")); assert.ok(results.some((item) => item.reason === "run-in-progress"));
});

test("生成状态缺少本地产物时不降级成预览", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-periodic-missing-generated-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "00_config"), { recursive: true }); await mkdir(path.join(root, "04_output/monthly"), { recursive: true }); await mkdir(path.join(root, "02_prompts/chatpack/insight"), { recursive: true });
  await writeFile(path.join(root, "00_config/periodic-insights.json"), JSON.stringify({ schemaVersion: 2, contextPolicies: { "periodic-v1": { defaultRange: "1y", maxContextChars: 100000, maxPromptChars: 120000, timezone: "Asia/Shanghai", defaultMaterialTypes: ["life-core", "target-journal", "history-backbone", "flomo"] } }, tasks: [{ id: "munger-soul", name: "芒格之魂", prompt: { productionReady: true, defaultEnhancerIds: [] }, target: { preferred: "month" }, contextPolicyId: "periodic-v1" }] }));
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), `# 月报\n\n${"有效材料 ".repeat(100)}`); await writeFile(path.join(root, "02_prompts/chatpack/insight/munger-soul.md"), "输出候选洞察");
  const preview = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); const state = JSON.parse(await readFile(preview.paths.state, "utf8")); await writeFile(preview.paths.state, JSON.stringify({ ...state, status: "generated" }));
  const result = await runPeriodicInsight({ repoRoot: root, taskId: "munger-soul", target: "2026-08" }); assert.equal(result.status, "needs_review"); assert.equal(result.reason, "generated-output-missing");
});

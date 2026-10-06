import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInputAuditRows, classifyWeeklyOutput, compressWeeklyProcessItems, generateWeeklyProcessPack, previousWeeklyPeriod, readPreviousWeeklyOutput, renderInputAuditTable, renderProcessPack, validateWeeklyProcessInputs } from "./generate-weekly-process-pack.mjs";
import { updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";

test("weekly Process Pack no longer embeds Action Feedback (retired, Core V1 owns weekly action review)", () => {
  const pack = renderProcessPack({
    week: "2026-W37",
    range: { start: "2026-09-14T00:00:00.000Z", end: "2026-09-20T23:59:59.999Z" },
    selection: { path: "03_input/weekly/2026-W37", mode: "iso" },
    generatedAt: "2026-09-19T00:00:00.000Z",
    stats: { fileCount: 0, itemCount: 0, uniqueItemCount: 0, duplicateCount: 0, excludedFileCount: 0 },
    sourceStatuses: {},
    files: [],
    excludedFiles: []
  }, [], [], [], { sourceCount: 0, files: [] });

  assert.match(pack, /行动与反馈直接来自第 7 节各来源材料正文/);
  assert.match(pack, /完整受治理 Weekly Output 主提示词/);
  assert.match(pack, /## 9\. 上周 Weekly Output（仅作对照）/);
  assert.doesNotMatch(pack, /Action Feedback/);
  assert.doesNotMatch(pack, /action-feedback\.md/);
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

test("prepare mode writes only private preprocessing state; failed mandatory gates create no Pack artifacts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-prepare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekDir = path.join(root, "03_input/weekly", week);
  const outputDir = path.join(root, "04_output/_dist/weekly", week);
  await mkdir(weekDir, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }), "utf8");
  await writeFile(path.join(weekDir, "daily.md"), "2026-09-28\n日记有一条足够长的记录。", "utf8");

  const prepared = await generateWeeklyProcessPack({ week, repoRoot: root, prepare: true });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.preparation.requests.length, 0);
  await assert.rejects(readFile(path.join(outputDir, "input.json")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(outputDir, "process-pack.md")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(root, "04_output/weekly/2026-40.md")), { code: "ENOENT" });
  assert.ok(prepared.preparation.manifestPath.endsWith("/.preprocessing/manifest.json"));

  await assert.rejects(generateWeeklyProcessPack({ week, repoRoot: root }), /weekly-process-blocked:/);
  await assert.rejects(readFile(path.join(outputDir, "input.json")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(outputDir, "process-pack.md")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(root, "04_output/weekly/2026-40.md")), { code: "ENOENT" });
});

test("confirmed target week with ready required inputs and verified empty sources assembles from cached preprocessing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-fast-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const weekDir = path.join(root, "03_input/weekly", week);
  const outputDir = path.join(root, "04_output/_dist/weekly", week);
  await mkdir(weekDir, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }), "utf8");

  await writeFile(path.join(weekDir, "daily.md"), "2026-09-28\n日记记录了本周的真实事项和判断。", "utf8");
  await writeFile(path.join(weekDir, "ai.md"), [
    `# AI 周回顾｜${week}`,
    `目标回顾周期：${week}`,
    "## 具体的人和事",
    "本周发生了值得回顾的具体事情。",
    "## 本周议题",
    "本周形成了一个有证据的判断。",
    "## 精华议题摘要",
    "保留核心问题与答案。",
    "## 核心洞察与判断变化",
    "写清楚判断如何变化。"
  ].join("\n\n"), "utf8");
  await writeFile(path.join(weekDir, "weekly.md"), [
    `# 周记输入｜${week}`,
    `目标周：${week}`,
    "目标覆盖范围：2026-09-28 至 2026-10-04",
    "写作日标题：10.5",
    "定位依据：目标周日期与覆盖范围匹配",
    "采集时间：2026-10-05T00:00:00.000Z",
    "来源：https://example.invalid/weekly",
    "## 本周记录",
    "这是一段已确认的周记正文，包含足够具体的事实和思考。"
  ].join("\n\n"), "utf8");
  await writeFile(path.join(weekDir, "voice.md"), [
    `# Voice-X 核心重点｜${week}`,
    "- 来源：Voice-X",
    "- 采集范围：2026-09-28 至 2026-10-05",
    "- 分页：已完成（1 页）",
    "",
    "## 中文录音标题",
    "- 录制时间：2026-09-29T10:00:00+08:00",
    "- 处理后原文字符数：4000",
    "- AI 洞察字符数：3000",
    "",
    "### 核心总结",
    "记录了清晰的核心判断、证据、边界和行动。".repeat(80),
    "### 芒格之魂洞察",
    "从多个思维模型交叉验证风险与长期结果。".repeat(60)
  ].join("\n"), "utf8");
  await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({ schemaVersion: 1, targetWeek: week, status: "confirmed" }), "utf8");

  await updateWeeklySourceStatus({ weekRoot: weekDir, week, source: "daily", status: "ready", file: "daily.md", count: 1, summary: "目标周有日记", preservedStaleFile: false });
  await updateWeeklySourceStatus({ weekRoot: weekDir, week, source: "flomo", status: "empty", file: "flomo.md", count: 0, summary: "完整扫描 2026-09-28 至 2026-10-05 完成；下界已覆盖：是；0 条，确认无匹配", preservedStaleFile: false });
  await updateWeeklySourceStatus({ weekRoot: weekDir, week, source: "voice", status: "ready", file: "voice.md", count: 1, summary: "完整扫描完成，本周有 1 条新版 AI 洞察", preservedStaleFile: false });

  const gatePayload = (await import("./collect-weekly-input.mjs")).collectWeeklyInput({ week, repoRoot: root, allowOversized: true });
  assert.deepEqual(await validateWeeklyProcessInputs({ week, repoRoot: root, payload: await gatePayload }), []);
  await generateWeeklyProcessPack({ week, repoRoot: root, prepare: true });
  const result = await generateWeeklyProcessPack({ week, repoRoot: root });
  assert.equal(result.processPayload.week, week);
  assert.equal(result.processPayload.preprocessing.exclusions.length, 0);
  const pack = await readFile(result.outputPath, "utf8");
  assert.match(pack, /2026-W40/);
  assert.match(pack, /Voice-X/);
  assert.ok((await readFile(path.join(outputDir, "input.json"), "utf8")).includes("处理后原文字符数：4000"));
});

test("deterministically compresses structured Voice-X records and reports the final ratio", () => {
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
  assert.equal(result.compression.targetRetainedRatio, 0.125);
  assert.deepEqual(result.compression.targetRetainedRatioRange, [0.10, 0.15]);
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
  assert.match(tableRows[0], /\| 重要 \/ P0 \| 日志 \| 飞书日记 \| \[daily\.md\]/);
  assert.match(tableRows[1], /\| 阶段前提 \| 日志 \| 飞书周记 \| weekly\.md/);
  assert.match(tableRows[2], /\| 重要 \/ P0 \| 输入 \| Flomo \| \[flomo\.md\]/);
  assert.doesNotMatch(table, /Action Feedback/);
  assert.doesNotMatch(table, /独立产物/);
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

test("audit table has no Action Feedback row after retirement and keeps input totals", () => {
  const payload = {
    week: "2026-W38",
    selection: { path: "03_input/weekly/2026-W38" },
    sourceStatuses: {},
    excludedFiles: []
  };
  const table = renderInputAuditTable(payload, [], { files: [] });

  assert.doesNotMatch(table, /Action Feedback/);
  assert.doesNotMatch(table, /独立产物/);
  assert.doesNotMatch(table, /action-feedback\.md/);
  assert.equal(buildInputAuditRows(payload, [], []).length, 15);
});

test("fixed weekly input order places jingdu after the other P1 inputs as a 精读 source row", () => {
  const payload = {
    week: "2026-W39",
    selection: { path: "03_input/weekly/2026-W39" },
    sourceStatuses: {
      weread: { status: "ready", file: "weread.md", count: 3, summary: "本周划线" },
      jingdu: { status: "ready", file: "jingdu.md", count: 2, summary: "本周精读加工" }
    },
    excludedFiles: []
  };
  const files = [
    { path: "03_input/weekly/2026-W39/weread.md", source: "weread", itemCount: 3, rawChars: 300, effectiveChars: 300, processChars: 300 },
    { path: "03_input/weekly/2026-W39/jingdu.md", source: "jingdu", itemCount: 2, rawChars: 200, effectiveChars: 200, processChars: 200 }
  ];
  const rows = buildInputAuditRows(payload, files, { files: [] });
  const wereadIndex = rows.findIndex((row) => row.file === "weread.md");
  const calendarIndex = rows.findIndex((row) => row.file === "calendar.md");
  const wisdomIndex = rows.findIndex((row) => row.file === "wisdom.md");
  const jingduIndex = rows.findIndex((row) => row.file === "jingdu.md");
  assert.ok(wereadIndex >= 0 && calendarIndex === wereadIndex + 1 && wisdomIndex === calendarIndex + 1 && jingduIndex === wisdomIndex + 1);
  assert.equal(rows[jingduIndex].type, "输入");
  assert.equal(rows[jingduIndex].source, "精读");
  assert.equal(rows[jingduIndex].status, "ready");
  const table = renderInputAuditTable(payload, files, { files: [] });
  assert.match(table, /\| 输入 \| 精读 \| \[jingdu\.md\]/);
});

test("Stage 2 delivers an execution-scope preview without exposing not-yet-generated Memory", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage2 = skill.slice(skill.indexOf("## 阶段 2"), skill.indexOf("## 阶段 3"));
  assert.match(stage2, /执行授权范围预览/);
  assert.match(stage2, /不展示尚未生成的记忆内容/);
  assert.match(stage2, /不构成授权/);
  assert.match(stage2, /最终确认卡/);
  assert.doesNotMatch(stage2, /Action Feedback/);
  assert.doesNotMatch(stage2, /拟迁移条目：[^\n]+/);
});

test("Stage 1 automation requires a final character count for each included ready file", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage1Report = skill.slice(skill.indexOf("阶段 1 汇报必须"), skill.indexOf("## 阶段 1 内"));

  assert.match(stage1Report, /Action Feedback 已退役，输入表中不再有独立产物行/);
  assert.doesNotMatch(stage1Report, /action:feedback/);
  assert.doesNotMatch(stage1Report, /在输入表后另列该草稿路径/);
  assert.match(stage1Report, /`countInputChars`（Unicode 码点数）/);
  assert.match(stage1Report, /链路写 `— → N`，不得把整格写成 `—`/);
});

test("weekly automation no longer creates Action Feedback at Stage 1 (retired)", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage1Report = skill.slice(skill.indexOf("阶段 1 汇报必须"), skill.indexOf("## 阶段 2："));
  const stage2 = skill.slice(skill.indexOf("## 阶段 2："), skill.indexOf("## 阶段 3："));

  assert.match(skill, /Action Feedback 已于 2026-10 退役/);
  assert.match(skill, /`周记已确认` 只确认周记草稿/);
  assert.doesNotMatch(stage1Report, /action:feedback -- draft/);
  assert.doesNotMatch(stage1Report, /两份草稿都已审核通过/);
  assert.doesNotMatch(stage2, /Action Feedback/);
  assert.doesNotMatch(stage2, /第 8 节/);
  assert.match(stage2, /回读 Process Pack 第 9 节/);
  assert.match(stage2, /上一 ISO 周.*完整的 `04_output\/weekly\/YYYY-WW\.md`/);
  assert.match(stage2, /阶段 2 汇报只报告上一周 Output 的周期、状态和绝对可点击文件链接，不复述旧 Output 正文或旧问答/);
  assert.match(stage2, /Flomo 第一行，其余输入按原固定顺序/);
});

test("Stage 3 prepares candidates before one confirmation and generates the image after Memory", async () => {
  const skill = await readFile(new URL("../../learn-x-weekly-automation/SKILL.md", import.meta.url), "utf8");
  const stage2 = skill.slice(skill.indexOf("## 阶段 2："), skill.indexOf("## 阶段 3："));
  const stage3 = skill.slice(skill.indexOf("## 阶段 3："), skill.indexOf("## 边界"));
  const candidateIndex = stage3.indexOf("npm run memory:weekly -- --week YYYY-Www");
  const confirmationIndex = stage3.indexOf("最后确认卡");
  const memoryIndex = stage3.indexOf("将获准条目写入正确的季度 Memory 目标");
  const imageIndex = stage3.indexOf("npm run image:weekly -- --week YYYY-Www");

  assert.match(stage2, /图片不再是阶段 3 的人工前置步骤/);
  assert.doesNotMatch(stage2, /使用.*核心内容生成一张.*图片/);
  assert.ok(candidateIndex >= 0 && candidateIndex < confirmationIndex);
  assert.ok(confirmationIndex >= 0 && confirmationIndex < memoryIndex);
  assert.ok(memoryIndex >= 0 && memoryIndex < imageIndex);
  assert.match(skill, /图片只生成到确认卡列出的本地目标路径/);
  assert.match(stage3, /ChatGPT Bridge 的 image 模式/);
  assert.match(stage3, /04_output\/_dist\/weekly\/YYYY-Www\/weekly-core\.png/);
  assert.match(stage3, /不使用 `imagegen`/);
  assert.match(stage3, /不得上传或发布公众号/);
  assert.match(stage3, /Overall: partial/);
  assert.match(stage3, /Image: failed/);
  assert.match(stage3, /already-success/);
  assert.match(stage3, /版本化文件名/);
  assert.match(stage3, /needs_review.*不得自动重发/);
  assert.doesNotMatch(skill, /ljg-card/);
  assert.doesNotMatch(skill, /~\/Downloads\/Learn-X-周报/);
  assert.match(stage2, /确认卡缺少图片路径、备份目的地或 Flomo 目的地时，不得请求确认或执行任何写入/);
});

test("complete Weekly Output prompt defines facts, memory candidates, comparison and machine contracts", async () => {
  const prompt = await readFile(new URL("../../../../02_prompts/chatpack/reflective-decision/weekly-output.md", import.meta.url), "utf8");
  assert.match(prompt, /^# Weekly Output 核心输出要求/m);
  assert.match(prompt, /Weekly Output 是 Learn-X 的\*\*周度记忆层\*\*/);
  assert.match(prompt, /本周事实必须来自当前 Process Pack/);
  assert.match(prompt, /## 9\. 值得长期保留/);
  assert.match(prompt, /最多 600 字/);
  assert.match(prompt, /必须提出\*\*恰好 3 个\*\*/);
  assert.match(prompt, /## 11\. 全文核心重点纪要/);
  assert.match(prompt, /## 12\. 芒格之魂的洞察/);
  assert.match(prompt, /## 13\. 本周最值得思考的 3 个问题与回答/);
  assert.doesNotMatch(prompt, /请查看.*weekly-output-rules/);
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
  }, [], [], [], { sourceCount: 0, files: [] }, previousOutput);
}

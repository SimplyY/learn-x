import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectConfirmedWeeklyJournal, recordWeeklyJournalAnchor } from "../../learn-x-input/scripts/collect-weekly-journal.mjs";
import { updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { generateWeeklyProcessPack } from "../../learn-x-process/scripts/generate-weekly-process-pack.mjs";
import { bindWeeklyMemoryApproval, prepareWeeklyMemory, verifyWeeklyMemoryApproval } from "../../learn-x-process/scripts/prepare-weekly-memory.mjs";
import { runWeeklyRetrySupervisor } from "./weekly-retry-supervisor.mjs";

const week = "2026-W40";

test("simulates the weekly workflow in a temporary repo, from cooldown rescue through Pack and Memory candidates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-workflow-sim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));

  let clock = Date.parse("2026-09-28T05:00:00+08:00");
  const sleeps = [];
  const attempts = new Map();
  const now = () => clock;
  const sleep = async (ms) => { sleeps.push(ms); clock += ms; };
  const runSource = async (source, context) => {
    const attempt = (attempts.get(source.id) || 0) + 1;
    attempts.set(source.id, attempt);
    if (source.id === "daily" && attempt === 1) return { status: "failed", error: "ECONNRESET" };
    if (source.id === "daily") await writeReadyDaily(root);
    if (source.id === "flomo") await writeEmptyFlomo(root);
    if (source.id === "ai") await writeAiReview(root);
    if (source.id === "voice") await writeEmptyVoice(root);
    return { status: source.id === "ai" ? "confirmed" : source.id === "flomo" || source.id === "voice" ? "empty" : "ready" };
  };
  const readOutcome = async () => null;

  // Bound the 05:00 attempt so it records the scheduled retry; the virtual clock
  // then advances through the real 20-minute cooldown during the 07:00 rescue.
  const initial = await runWeeklyRetrySupervisor({
    week, repoRoot: root, now, sleep, runSource, readOutcome, maxDurationMs: 1
  });
  assert.equal(initial.sources.daily.status, "failed");
  assert.equal(initial.sources.daily.attempts, 1);
  assert.ok(Date.parse(initial.sources.daily.nextRetryAt) - clock >= 20 * 60_000 - 1);

  const rescue = await runWeeklyRetrySupervisor({
    week, mode: "rescue", repoRoot: root, now, sleep, runSource, readOutcome
  });
  assert.equal(rescue.sources.daily.status, "succeeded");
  assert.equal(rescue.sources.daily.attempts, 2);
  assert.equal(rescue.sources.daily.rescueUsed, true);
  assert.ok(sleeps.some((ms) => ms >= 20 * 60_000 - 1));

  // Stage 1 completes deterministic preprocessing before the journal is confirmed.
  const prepared = await generateWeeklyProcessPack({ week, repoRoot: root, prepare: true });
  assert.equal(prepared.prepared, true);
  assert.deepEqual(prepared.preparation.requests, []);

  const weekDir = path.join(root, "03_input/weekly", week);
  await recordWeeklyJournalAnchor({
    week, writeDate: "2026-10-05", targetTitle: "10.5", targetBlockId: "blkTarget2026W40",
    documentId: "docWeeklyJournal01", repoRoot: root
  });
  const section = "## 10.5\n\n本周完成了有边界的实验，并记录判断、证据和下一步。";
  const journal = await collectConfirmedWeeklyJournal({
    week,
    repoRoot: root,
    fetchSection: async () => ({
      ok: true,
      identity: "bot",
      data: { document: { document_id: "docWeeklyJournal01", revision_id: 71, content: section } }
    })
  });
  assert.equal(journal.week, week);

  // Stage 2 now only fetches the confirmed journal and assembles from cached prep.
  const pack = await generateWeeklyProcessPack({ week, repoRoot: root });
  assert.equal(pack.processPayload.week, week);
  assert.ok(pack.outputPath.endsWith("/process-pack.md"));
  assert.ok(pack.processPayload.files.some((file) => file.path.endsWith("/weekly.md")));
  assert.deepEqual(pack.processPayload.preprocessing.exclusions, []);
  const packText = await readFile(pack.outputPath, "utf8");
  assert.match(packText, /2026-W40/);
  assert.match(packText, /Confirmed weekly journal input/);
  assert.doesNotMatch(packText, /本轮需关注：.*阻断：(Flomo|Voice-X)/);
  assert.equal(await readFile(path.join(weekDir, "weekly.md"), "utf8").then((text) => text.includes(section)), true);

  // Represent the human Chat Pack result with fixture text, then prepare only a
  // candidate card in the temp repo; no formal Memory or external action runs.
  await writeFile(path.join(root, "04_output/weekly/2026-40.md"), [
    "# Learn-X Weekly Output｜2026-40",
    "",
    "## 11. 全文核心重点纪要",
    "本周用小实验替代不可检验的大改造。",
    "",
    "## 12. 芒格之魂的洞察",
    "反向思考先识别失败路径，再决定投入边界。",
    "",
    "## 13. 本周最值得思考的 3 个问题与回答",
    "1. 问题：当前哪项行动值得继续？",
    "   回答：继续小规模实测，并按可观测结果调整。",
    "2. 问题：哪项探索先暂停？",
    "",
    "## 值得长期保留（长期记忆候选，勾选后纳入）",
    "- [x] 用小实验替代不可检验的大改造。",
    "- [ ] 暂时不迁移的候选。",
    ""
  ].join("\n"));
  const candidates = await prepareWeeklyMemory({ week, repoRoot: root });
  const candidateText = await readFile(candidates.outputPath, "utf8");
  assert.equal(candidates.counts.coreSummary, 1);
  assert.equal(candidates.counts.mungerInsights, 1);
  assert.equal(candidates.counts.questionsAnswers, 1);
  assert.match(candidateText, /本周用小实验替代不可检验的大改造/);
  assert.match(candidateText, /反向思考先识别失败路径/);
  assert.match(candidateText, /继续小规模实测/);
  assert.match(candidateText, /用小实验替代不可检验的大改造/);
  assert.doesNotMatch(candidateText, /暂时不迁移的候选/);
  await assert.rejects(readFile(path.join(root, "01_core/memory/2026-Q3.memory.md")), { code: "ENOENT" });
  const proposalPath = path.join(root, "04_output/_dist/weekly", week, "memory-proposed.md");
  await writeFile(proposalPath, "## 2026-W40\n\nApproved weekly Memory payload.\n");
  const approval = await bindWeeklyMemoryApproval({ week, repoRoot: root });
  assert.equal((await verifyWeeklyMemoryApproval({ week, fingerprint: approval.fingerprint, repoRoot: root })).verified, true);

  const weeklyAutomationSkill = await readFile(new URL("../SKILL.md", import.meta.url), "utf8");
  assert.match(weeklyAutomationSkill, /Process Pack 成功生成后，在同一条阶段 2 消息中同时交付 Pack 与“执行授权范围预览”/);
  assert.match(weeklyAutomationSkill, /不展示尚未生成的记忆内容，也不构成授权/);
  assert.match(weeklyAutomationSkill, /展示真实拟迁移内容并与第二步已预览的执行范围合并为一张最终确认卡/);
  assert.match(weeklyAutomationSkill, /第二步预览必须一次列明本周 Memory 写入目标/);
  assert.match(weeklyAutomationSkill, /weekly-core\.png/);
  assert.match(weeklyAutomationSkill, /备份载荷.*01_core.*03_input.*04_output.*05_library/);
  assert.match(weeklyAutomationSkill, /Learn-X 专用飞书云盘 \/ `Snapshots`/);
  assert.match(weeklyAutomationSkill, /YW Next 刷新范围/);
  assert.match(weeklyAutomationSkill, /Flomo 载荷（`weekly\.md` 与季度 Memory）及目的地/);
  assert.match(weeklyAutomationSkill, /留存清理和读回校验/);
  assert.match(weeklyAutomationSkill, /图片生成和其他写入都必须等阶段 3 这一次确认/);
  assert.match(weeklyAutomationSkill, /memory:weekly -- --week YYYY-Www --bind-approval/);
  assert.match(weeklyAutomationSkill, /memory:weekly -- --week YYYY-Www --verify-approval/);
  assert.match(weeklyAutomationSkill, /未答、空白、占位或明确跳过的问题及其背景都自动排除/);
});

async function writeReadyDaily(root) {
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(weekRoot, "daily.md"), "# 2026-09-29\n\n本周记录了真实事项、关键判断和观察证据。\n");
  await updateWeeklySourceStatus({
    weekRoot, week, source: "daily", status: "ready", file: "daily.md", count: 1,
    summary: "目标周 1 条有效日记", preservedStaleFile: false
  });
}

async function writeEmptyFlomo(root) {
  const weekRoot = path.join(root, "03_input/weekly", week);
  await updateWeeklySourceStatus({
    weekRoot, week, source: "flomo", status: "empty", file: "flomo.md", count: 0,
    summary: "完整扫描 2026-09-28 00:00 至 2026-10-05 00:00 完成；下界已覆盖：是；0 条，确认无匹配（分页 1 页）",
    preservedStaleFile: false
  });
}

async function writeAiReview(root) {
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(weekRoot, "ai.md"), [
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
  ].join("\n\n"));
  await writeFile(path.join(weekRoot, "_ai-generated.json"), JSON.stringify({
    schemaVersion: 1, targetWeek: week, status: "confirmed", confirmedAt: new Date().toISOString()
  }));
}

async function writeEmptyVoice(root) {
  const weekRoot = path.join(root, "03_input/weekly", week);
  await updateWeeklySourceStatus({
    weekRoot, week, source: "voice", status: "empty", file: "voice.md", count: 0,
    summary: "完整扫描 2026-09-28 00:00:00 至 2026-10-05 00:00:00 完成；下界已覆盖：是；0 条，确认无匹配（分页 1 页）",
    preservedStaleFile: false
  });
}

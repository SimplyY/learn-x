import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectCoreWeekly, selectCoreExport } from "./collect-core-weekly.mjs";
import { isoWeekRangeShanghai } from "./collect-weread-weekly.mjs";
import { readWeeklySourceStatus } from "./lib/source-status.mjs";
import { collectWeeklyInput } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const WEEK = "2026-W29";
const at = (week, offsetSeconds) => new Date((isoWeekRangeShanghai(week).startEpoch + offsetSeconds) * 1000).toISOString();
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

async function makeFixture({ week = WEEK, exports = [] }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-core-input-"));
  const coreRoot = path.join(root, "core");
  const repoRoot = path.join(root, "learn-x");
  await mkdir(path.join(repoRoot, "03_input/weekly", week), { recursive: true });
  for (const item of exports) {
    const { confirmedWeek = week, reviewWeek = week, body = "Core 复盘正文\n", frozenAt = at(confirmedWeek, 3600), metaOverrides = {}, withBody = true, batchId = null } = item;
    const exportDir = path.join(coreRoot, "runtime/exports", confirmedWeek);
    await mkdir(exportDir, { recursive: true });
    const meta = {
      schemaVersion: batchId ? "2" : "1",
      ...(batchId ? { batchId, confirmedItems: [{ id: "item-1", locator: "B:1:1" }] } : {}),
      status: "confirmed",
      reviewWeek,
      frozenAt,
      sha256: withBody ? sha256(body) : "deadbeef",
      feishuUrl: "https://ywhome.feishu.cn/wiki/weekly-node",
      ...metaOverrides
    };
    const name = batchId ? `${reviewWeek}--${batchId}` : reviewWeek;
    await writeFile(path.join(exportDir, `${name}.json`), JSON.stringify(meta, null, 2), "utf8");
    if (withBody) await writeFile(path.join(exportDir, `${name}.md`), body, "utf8");
  }
  return { root, coreRoot, repoRoot };
}

test("汇集目标周窗口内全部确认导出并写入 core.md", async (t) => {
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", body: "旧导出\n", frozenAt: at(WEEK, 3600) },
    { reviewWeek: "2026-W28", body: "新导出\n", frozenAt: at(WEEK, 86_400) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: WEEK });
  assert.equal(selection.kind, "ok");
  assert.equal(selection.candidates.length, 2);
  assert.equal(selection.candidates[1].meta.reviewWeek, "2026-W28");

  const { status } = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "ready");
  const coreMd = await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  assert.match(coreMd, /原始复盘覆盖周：2026-W28/);
  assert.match(coreMd, /runtime\/exports\/2026-W29\/2026-W28\.md/);
  assert.match(coreMd, /新导出/);
  assert.match(coreMd, /旧导出/);
  assert.match(coreMd, /历史认知背景/);
  const statusDoc = await readWeeklySourceStatus(path.join(fx.repoRoot, "03_input/weekly", WEEK), WEEK);
  assert.equal(statusDoc.sources.core.status, "ready");
});

test("哈希不符与未知 schemaVersion 被排除并报告异常", async (t) => {
  const fx = await makeFixture({ exports: [
    { body: "正文\n", metaOverrides: { sha256: "deadbeef" } },
    { reviewWeek: "2026-W28", metaOverrides: { schemaVersion: "9" } }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: WEEK });
  assert.equal(selection.kind, "missing");
  const reasons = selection.rejected.map((item) => item.reason).join("；");
  assert.match(reasons, /哈希不符/);
  assert.match(reasons, /未知 schemaVersion=9/);

  const { status, report } = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "unavailable");
  await assert.rejects(() => readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8"), /ENOENT/);
  const statusDoc = await readWeeklySourceStatus(path.join(fx.repoRoot, "03_input/weekly", WEEK), WEEK);
  assert.equal(statusDoc.sources.core.status, "unavailable");
  assert.ok(report.written === null);
});

test("W39 复盘在 W40 确认后进入 Learn-X W40 并保留原始周信息", async (t) => {
  const targetWeek = "2026-W40";
  const fx = await makeFixture({ week: targetWeek, exports: [
    { confirmedWeek: targetWeek, reviewWeek: "2026-W39", body: "W39 复盘本人确认内容\n", frozenAt: at(targetWeek, 4 * 86_400) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: targetWeek });
  assert.equal(selection.kind, "ok");
  assert.equal(selection.candidates[0].confirmedWeek, targetWeek);
  assert.equal(selection.candidates[0].meta.reviewWeek, "2026-W39");

  const { status } = await collectCoreWeekly({ week: targetWeek, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "ready");
  const coreMd = await readFile(path.join(fx.repoRoot, "03_input/weekly", targetWeek, "core.md"), "utf8");
  assert.match(coreMd, /原始复盘覆盖周：2026-W39/);
  assert.match(coreMd, /认知确认时间（frozenAt）：2026-10-01T16:00:00\.000Z/);
  assert.match(coreMd, /runtime\/exports\/2026-W40\/2026-W39\.md/);
  assert.match(coreMd, /W39 复盘本人确认内容/);
  const input = await collectWeeklyInput({ week: targetWeek, repoRoot: fx.repoRoot });
  assert.ok(input.files.some((file) => file.path.endsWith("/2026-W40/core.md")));
  assert.ok(input.items.some((item) => item.text.includes("W39 复盘本人确认内容")));
});

test("同周确认与重复采集保持幂等", async (t) => {
  const targetWeek = "2026-W40";
  const fx = await makeFixture({ week: targetWeek, exports: [
    { confirmedWeek: targetWeek, reviewWeek: targetWeek, body: "同周复盘\n", frozenAt: at(targetWeek, 3600) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  assert.equal((await collectCoreWeekly({ week: targetWeek, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
  const outputPath = path.join(fx.repoRoot, "03_input/weekly", targetWeek, "core.md");
  const first = await readFile(outputPath, "utf8");
  assert.equal((await collectCoreWeekly({ week: targetWeek, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
  const second = await readFile(outputPath, "utf8");
  assert.equal(second, first);
  assert.equal(second.split("同周复盘").length - 1, 1);
});

test("未确认、非目标确认周与目标周外 frozenAt 不进入输入", async (t) => {
  const targetWeek = "2026-W40";
  const fx = await makeFixture({ week: targetWeek, exports: [
    { confirmedWeek: targetWeek, reviewWeek: "2026-W39", metaOverrides: { status: "draft" } },
    { confirmedWeek: targetWeek, reviewWeek: "2026-W38", frozenAt: at("2026-W39", 3600) },
    { confirmedWeek: targetWeek, reviewWeek: "2026-W37", metaOverrides: { reviewWeek: "2026-W36" } },
    { confirmedWeek: "2026-W39", reviewWeek: "2026-W37", frozenAt: at(targetWeek, 7200) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: targetWeek });
  assert.equal(selection.kind, "missing");
  assert.equal(selection.rejected.length, 3);
  assert.match(selection.rejected.map((item) => item.reason).join("；"), /非确认导出/);
  assert.match(selection.rejected.map((item) => item.reason).join("；"), /不在目标周窗口内/);
  assert.match(selection.rejected.map((item) => item.reason).join("；"), /与文件名 .* 不一致/);
});

test("确认导出消失后旧 core.md 保留但标记为过期", async (t) => {
  const fx = await makeFixture({ exports: [{ reviewWeek: "2026-W28", body: "旧确认复盘\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const outputPath = path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md");
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
  await rm(path.join(fx.coreRoot, "runtime/exports", WEEK), { recursive: true, force: true });
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "unavailable");
  assert.match(await readFile(outputPath, "utf8"), /旧确认复盘/);
  const statusDoc = await readWeeklySourceStatus(path.dirname(outputPath), WEEK);
  assert.equal(statusDoc.sources.core.status, "unavailable");
  assert.equal(statusDoc.sources.core.preservedStaleFile, true);
  const input = await collectWeeklyInput({ week: WEEK, repoRoot: fx.repoRoot });
  assert.equal(input.files.some((file) => file.path.endsWith("/core.md")), false);
  assert.ok(input.excludedFiles.some((file) => file.file === "core.md" && file.preservedStaleFile));
});

test("元数据 JSON 根值不是对象时将旧 core.md 标记过期并从周输入排除", async (t) => {
  const fx = await makeFixture({ exports: [{ reviewWeek: "2026-W28", body: "之前有效的确认复盘\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const outputPath = path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md");
  const metaPath = path.join(fx.coreRoot, "runtime/exports", WEEK, "2026-W28.json");
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
  await writeFile(metaPath, "null", "utf8");

  const { status, report } = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "unavailable");
  assert.match(report.rejected.map((item) => item.reason).join(";"), /JSON 顶层必须是对象/);
  assert.match(await readFile(outputPath, "utf8"), /之前有效的确认复盘/);
  const statusDoc = await readWeeklySourceStatus(path.dirname(outputPath), WEEK);
  assert.equal(statusDoc.sources.core.status, "unavailable");
  assert.equal(statusDoc.sources.core.preservedStaleFile, true);
  const input = await collectWeeklyInput({ week: WEEK, repoRoot: fx.repoRoot });
  assert.equal(input.files.some((file) => file.path.endsWith("/core.md")), false);
  assert.ok(input.excludedFiles.some((file) => file.file === "core.md" && file.preservedStaleFile));
  assert.equal(input.items.some((item) => item.text.includes("之前有效的确认复盘")), false);
});

test("相同 frozenAt 的不同复盘均保留", async (t) => {
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", frozenAt: at(WEEK, 3600) },
    { reviewWeek: "2026-W28", frozenAt: at(WEEK, 3600) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: WEEK });
  assert.equal(selection.kind, "ok");
  assert.equal(selection.candidates.length, 2);
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
});

test("无任何导出目录时报告缺失", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-core-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { status, report } = await collectCoreWeekly({ week: WEEK, coreRoot: path.join(root, "core"), repoRoot: path.join(root, "learn-x") });
  assert.equal(status, "unavailable");
  assert.match(report.reason, /缺失|不存在|无有效/);
});

test("周目录不存在时 ready 路径自动创建（单独运行不崩溃）", async (t) => {
  const fx = await makeFixture({ exports: [{ confirmedWeek: WEEK }] });
  await rm(path.join(fx.repoRoot, "03_input/weekly", WEEK), { recursive: true, force: true });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { status } = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "ready");
  const coreMd = await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  assert.match(coreMd, /Core 复盘正文/);
});

test("同一确认周多个 v2 批次与 v1 共存，保留各自原周和确认时间", async (t) => {
  const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", body: "旧版认可\n" },
    { reviewWeek: "2026-W28", batchId: a, frozenAt: at(WEEK, 7200), body: "首次认可\n" },
    { reviewWeek: "2026-W28", batchId: b, frozenAt: at(WEEK, 7200), body: "新增认可\n" }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "ready");
  assert.equal(result.report.selected.length, 3);
  const output = await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  for (const text of ["旧版认可", "首次认可", "新增认可", a, b, "原始复盘覆盖周：2026-W28"]) assert.ok(output.includes(text));
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "ready");
  assert.equal(await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8"), output);
});

test("新增批次安全刷新生成物，人工编辑后不得覆盖或进入周处理", async (t) => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fx = await makeFixture({ exports: [{ batchId: a, body: "首批\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const args = { week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot };
  assert.equal((await collectCoreWeekly(args)).status, "ready");
  const dir = path.join(fx.coreRoot, "runtime/exports", WEEK);
  const body = "第二批\n";
  await writeFile(path.join(dir, `${WEEK}--${b}.md`), body);
  await writeFile(path.join(dir, `${WEEK}--${b}.json`), JSON.stringify({ schemaVersion: "2", status: "confirmed", batchId: b, reviewWeek: WEEK, frozenAt: at(WEEK, 7200), sha256: sha256(body), confirmedItems: [{ id: "item-2", locator: "B:1:2" }] }));
  assert.equal((await collectCoreWeekly(args)).status, "ready");
  const outputPath = path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md");
  assert.match(await readFile(outputPath, "utf8"), /第二批/);
  await writeFile(outputPath, "本人新增内容\n");
  assert.equal((await collectCoreWeekly(args)).status, "needs_review");
  assert.equal(await readFile(outputPath, "utf8"), "本人新增内容\n");
  const input = await collectWeeklyInput({ week: WEEK, repoRoot: fx.repoRoot });
  assert.equal(input.files.some((file) => file.path.endsWith("/core.md")), false);
});

test("无效 v2 批次或重复批次 ID 阻止部分回流", async (t) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", batchId: id, body: "认可一\n" },
    { reviewWeek: "2026-W28", batchId: id, body: "认可二\n" }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "unavailable");
  await rm(path.join(fx.coreRoot, "runtime/exports", WEEK, `2026-W28--${id}.json`));
  await writeFile(path.join(fx.coreRoot, "runtime/exports", WEEK, `2026-W27--${id}.md`), "被改写\n");
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "unavailable");
  assert.match(result.report.reason, /未通过校验/);
});

test("有效新批次与损坏旧确认导出并存时不发布不完整回流", async (t) => {
  const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", body: "历史认可\n", metaOverrides: { sha256: "deadbeef" } },
    { reviewWeek: "2026-W28", batchId: id, body: "新增认可\n" }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "unavailable");
  const statusDoc = await readWeeklySourceStatus(path.join(fx.repoRoot, "03_input/weekly", WEEK), WEEK);
  assert.notEqual(statusDoc.sources.core.status, "ready");
  await assert.rejects(() => readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8"), /ENOENT/);
});

test("未确认旧草稿不混入有效确认批次", async (t) => {
  const id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", body: "未确认草稿\n", metaOverrides: { status: "draft" } },
    { reviewWeek: "2026-W28", batchId: id, body: "本人认可\n" }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "ready");
  const output = await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  assert.match(output, /本人认可/);
  assert.doesNotMatch(output, /未确认草稿/);
});

test("非普通的批次元数据不可被静默忽略", async (t) => {
  const valid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const invalid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const fx = await makeFixture({ exports: [{ batchId: valid, body: "认可内容\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const dir = path.join(fx.coreRoot, "runtime/exports", WEEK);
  await symlink(`${WEEK}--${valid}.json`, path.join(dir, `${WEEK}--${invalid}.json`));
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "unavailable");
  assert.match(result.report.rejected.map((item) => item.reason).join(";"), /不是普通文件/);
});

test("确认正文为符号链接时不读取或发布", async (t) => {
  const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const fx = await makeFixture({ exports: [{ batchId: id, body: "认可内容\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const dir = path.join(fx.coreRoot, "runtime/exports", WEEK);
  const body = path.join(dir, `${WEEK}--${id}.md`);
  await rm(body);
  await symlink("elsewhere.md", body);
  const result = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(result.status, "unavailable");
  assert.match(result.report.rejected.map((item) => item.reason).join(";"), /正文不是普通文件/);
});

test("独立同周采集串行化并回收已退出进程的锁", async (t) => {
  const fx = await makeFixture({ exports: [{ body: "已认可\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const args = { week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot };
  const weekRoot = path.join(fx.repoRoot, "03_input/weekly", WEEK);
  await writeFile(path.join(weekRoot, "_core-import.lock"), JSON.stringify({ pid: 2147483647, token: "dead", createdAt: new Date().toISOString() }));
  const results = await Promise.all([collectCoreWeekly(args), collectCoreWeekly(args)]);
  assert.deepEqual(results.map((result) => result.status), ["ready", "ready"]);
  const output = await readFile(path.join(weekRoot, "core.md"), "utf8");
  assert.equal(output.split("已认可").length - 1, 1);
  await assert.rejects(() => readFile(path.join(weekRoot, "_core-import.lock")), /ENOENT/);
  const status = await readWeeklySourceStatus(weekRoot, WEEK);
  assert.equal(status.sources.core.status, "ready");
});

test("导出状态损坏后旧来源被排除，已写结果的中断收据可恢复", async (t) => {
  const fx = await makeFixture({ exports: [{ body: "安全恢复\n" }] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const args = { week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot };
  assert.equal((await collectCoreWeekly(args)).status, "ready");
  const weekRoot = path.join(fx.repoRoot, "03_input/weekly", WEEK);
  const output = await readFile(path.join(weekRoot, "core.md"), "utf8");
  await writeFile(path.join(weekRoot, "_core-import.json"), JSON.stringify({ schemaVersion: 1, outputSha256: "old", pendingSha256: sha256(output) }));
  assert.equal((await collectCoreWeekly(args)).status, "ready");
  assert.equal(JSON.parse(await readFile(path.join(weekRoot, "_core-import.json"), "utf8")).outputSha256, sha256(output));
  await rm(path.join(fx.coreRoot, "runtime/exports", WEEK), { recursive: true });
  await writeFile(path.join(fx.coreRoot, "runtime/exports", WEEK), "不是目录");
  assert.equal((await collectCoreWeekly(args)).status, "failed");
  const input = await collectWeeklyInput({ week: WEEK, repoRoot: fx.repoRoot });
  assert.equal(input.files.some((item) => item.path.endsWith("/core.md")), false);
});

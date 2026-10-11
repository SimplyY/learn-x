import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const { confirmedWeek = week, reviewWeek = week, body = "Core 复盘正文\n", frozenAt = at(confirmedWeek, 3600), metaOverrides = {}, withBody = true } = item;
    const exportDir = path.join(coreRoot, "runtime/exports", confirmedWeek);
    await mkdir(exportDir, { recursive: true });
    const meta = {
      schemaVersion: "1",
      status: "confirmed",
      reviewWeek,
      frozenAt,
      sha256: withBody ? sha256(body) : "deadbeef",
      feishuUrl: "https://ywhome.feishu.cn/wiki/weekly-node",
      ...metaOverrides
    };
    await writeFile(path.join(exportDir, `${reviewWeek}.json`), JSON.stringify(meta, null, 2), "utf8");
    if (withBody) await writeFile(path.join(exportDir, `${reviewWeek}.md`), body, "utf8");
  }
  return { root, coreRoot, repoRoot };
}

test("选择目标周窗口内 frozenAt 最新的确认导出并写入 core.md", async (t) => {
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", body: "旧导出\n", frozenAt: at(WEEK, 3600) },
    { reviewWeek: "2026-W28", body: "新导出\n", frozenAt: at(WEEK, 86_400) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: WEEK });
  assert.equal(selection.kind, "ok");
  assert.equal(selection.candidates.length, 2);
  assert.equal(selection.candidates[0].meta.reviewWeek, "2026-W28");

  const { status } = await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot });
  assert.equal(status, "ready");
  const coreMd = await readFile(path.join(fx.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  assert.match(coreMd, /原始复盘覆盖周：2026-W28/);
  assert.match(coreMd, /runtime\/exports\/2026-W29\/2026-W28\.md/);
  assert.match(coreMd, /新导出/);
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

test("相同的最新 frozenAt 会拒绝歧义导入", async (t) => {
  const fx = await makeFixture({ exports: [
    { reviewWeek: "2026-W27", frozenAt: at(WEEK, 3600) },
    { reviewWeek: "2026-W28", frozenAt: at(WEEK, 3600) }
  ] });
  t.after(() => rm(fx.root, { recursive: true, force: true }));

  const selection = await selectCoreExport({ coreRoot: fx.coreRoot, week: WEEK });
  assert.equal(selection.kind, "ambiguous");
  assert.match(selection.reason, /frozenAt 相同/);
  assert.equal((await collectCoreWeekly({ week: WEEK, coreRoot: fx.coreRoot, repoRoot: fx.repoRoot })).status, "unavailable");
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

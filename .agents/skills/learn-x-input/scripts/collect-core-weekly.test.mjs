import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectCoreWeekly, selectCoreExport } from "./collect-core-weekly.mjs";
import { isoWeekRangeShanghai } from "./collect-weread-weekly.mjs";
import { readWeeklySourceStatus } from "./lib/source-status.mjs";

const WEEK = "2026-W29";
const weekStart = isoWeekRangeShanghai(WEEK).startEpoch;
const at = (offsetSeconds) => new Date((weekStart + offsetSeconds) * 1000).toISOString();
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

async function makeFixture({ confirmedWeek, body = "Core 复盘正文\n", frozenAt = at(3600), metaOverrides = {}, withBody = true }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-core-input-"));
  const coreRoot = path.join(root, "core");
  const repoRoot = path.join(root, "learn-x");
  const exportDir = path.join(coreRoot, "runtime/exports", confirmedWeek);
  await mkdir(exportDir, { recursive: true });
  await mkdir(path.join(repoRoot, "03_input/weekly", WEEK), { recursive: true });
  const meta = {
    schemaVersion: "1",
    status: "confirmed",
    reviewWeek: WEEK,
    frozenAt,
    sha256: withBody ? sha256(body) : "deadbeef",
    feishuUrl: "https://ywhome.feishu.cn/wiki/weekly-node",
    ...metaOverrides
  };
  await writeFile(path.join(exportDir, `${WEEK}.json`), JSON.stringify(meta, null, 2), "utf8");
  if (withBody) await writeFile(path.join(exportDir, `${WEEK}.md`), body, "utf8");
  return { root, coreRoot, repoRoot };
}

test("选择目标周窗口内 frozenAt 最新的确认导出并写入 core.md", async (t) => {
  const older = await makeFixture({ confirmedWeek: WEEK, body: "旧导出\n", frozenAt: at(3600) });
  const newer = await makeFixture({ confirmedWeek: "2026-W30", body: "新导出\n", frozenAt: at(86_400) });
  t.after(async () => { await rm(older.root, { recursive: true, force: true }); await rm(newer.root, { recursive: true, force: true }); });

  const selection = await selectCoreExport({ coreRoot: older.coreRoot, week: WEEK });
  assert.equal(selection.kind, "ok");
  assert.equal(selection.candidates.length, 1);

  // 把两个导出目录合并进同一 coreRoot：latest frozenAt 胜出。
  const { cp } = await import("node:fs/promises");
  await cp(path.join(newer.coreRoot, "runtime/exports/2026-W30"), path.join(older.coreRoot, "runtime/exports/2026-W30"), { recursive: true });
  const merged = await selectCoreExport({ coreRoot: older.coreRoot, week: WEEK });
  assert.equal(merged.candidates[0].confirmedWeek, "2026-W30");

  const { status } = await collectCoreWeekly({ week: WEEK, coreRoot: older.coreRoot, repoRoot: older.repoRoot });
  assert.equal(status, "ready");
  const coreMd = await readFile(path.join(older.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8");
  assert.match(coreMd, /原始复盘覆盖周：2026-W29/);
  assert.match(coreMd, /新导出/);
  assert.match(coreMd, /历史认知背景/);
  const statusDoc = await readWeeklySourceStatus(path.join(older.repoRoot, "03_input/weekly", WEEK), WEEK);
  assert.equal(statusDoc.sources.core.status, "ready");
});

test("哈希不符与未知 schemaVersion 被排除并报告异常", async (t) => {
  const badHash = await makeFixture({ confirmedWeek: WEEK, body: "正文\n", metaOverrides: { sha256: "deadbeef" } });
  const unknownVersion = await makeFixture({ confirmedWeek: "2026-W30", metaOverrides: { schemaVersion: "9" } });
  t.after(async () => { await rm(badHash.root, { recursive: true, force: true }); await rm(unknownVersion.root, { recursive: true, force: true }); });

  const { cp } = await import("node:fs/promises");
  await cp(path.join(unknownVersion.coreRoot, "runtime/exports/2026-W30"), path.join(badHash.coreRoot, "runtime/exports/2026-W30"), { recursive: true });
  const selection = await selectCoreExport({ coreRoot: badHash.coreRoot, week: WEEK });
  assert.equal(selection.kind, "missing");
  const reasons = selection.rejected.map((item) => item.reason).join("；");
  assert.match(reasons, /哈希不符/);
  assert.match(reasons, /未知 schemaVersion=9/);

  const { status, report } = await collectCoreWeekly({ week: WEEK, coreRoot: badHash.coreRoot, repoRoot: badHash.repoRoot });
  assert.equal(status, "unavailable");
  await assert.rejects(() => readFile(path.join(badHash.repoRoot, "03_input/weekly", WEEK, "core.md"), "utf8"), /ENOENT/);
  const statusDoc = await readWeeklySourceStatus(path.join(badHash.repoRoot, "03_input/weekly", WEEK), WEEK);
  assert.equal(statusDoc.sources.core.status, "unavailable");
  assert.ok(report.written === null);
});

test("无任何导出目录时报告缺失", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-core-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { status, report } = await collectCoreWeekly({ week: WEEK, coreRoot: path.join(root, "core"), repoRoot: path.join(root, "learn-x") });
  assert.equal(status, "unavailable");
  assert.match(report.reason, /缺失|不存在|无有效/);
});

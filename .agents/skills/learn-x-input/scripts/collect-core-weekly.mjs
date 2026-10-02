#!/usr/bin/env node
// input:core —— 从 Core V1（人生复利工作台）读取用户确认后的周复盘导出。
// 契约（core/docs/cases/2026-10-core-v1/execution-plan.md §2）：
// - 在目标周的上海时间窗口内，选择 frozenAt 最新的一份确认导出（Core 回流按确认周归属）。
// - 写入 03_input/weekly/YYYY-Www/core.md，注明认知确认时间、原始复盘覆盖周及来源。
// - 无导出则报告缺失，不等待同覆盖周 Core，不回退更早版本。
// - 缺元数据、未知版本、哈希不符时排除该文件并报告异常。
// Core 回流是历史认知背景，与底层经历同源，不得当作第二份独立现实证据。
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoWeekRangeShanghai, normalizeWeek, defaultWeeklyReviewWeek } from "./collect-weread-weekly.mjs";
import { updateWeeklySourceStatus } from "./lib/source-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../../..");
export const CORE_EXPORT_SCHEMA_VERSION = "1";
const SUPPORTED_SCHEMA_VERSIONS = new Set([CORE_EXPORT_SCHEMA_VERSION]);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 从候选导出中选出目标周窗口内 frozenAt 最新且校验通过的一份。
export async function selectCoreExport({ coreRoot, week }) {
  const range = isoWeekRangeShanghai(week);
  const exportsRoot = path.join(coreRoot, "runtime", "exports");
  let weekDirs;
  try {
    weekDirs = await readdir(exportsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing", reason: "Core 尚无任何确认导出目录（runtime/exports 不存在）", candidates: [] };
    throw error;
  }
  const candidates = [];
  const rejected = [];
  for (const entry of weekDirs) {
    if (!entry.isDirectory() || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(entry.name)) continue;
    const metaPath = path.join(exportsRoot, entry.name, `${week}.json`);
    const bodyPath = path.join(exportsRoot, entry.name, `${week}.md`);
    let meta;
    try {
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `元数据 JSON 不可解析：${error.message}` });
      continue;
    }
    if (meta.status !== "confirmed") {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `status=${meta.status}，非确认导出` });
      continue;
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.has(String(meta.schemaVersion))) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `未知 schemaVersion=${meta.schemaVersion}` });
      continue;
    }
    if (meta.reviewWeek !== week) continue; // 导出正文不覆盖目标周，跳过（不是异常）
    const frozenAt = Date.parse(String(meta.frozenAt || ""));
    if (!Number.isFinite(frozenAt) || frozenAt < range.startEpoch * 1000 || frozenAt >= range.endEpoch * 1000) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `frozenAt=${meta.frozenAt || "缺失"} 不在目标周窗口内` });
      continue;
    }
    let body;
    try {
      body = await readFile(bodyPath, "utf8");
    } catch (error) {
      rejected.push({ source: path.relative(coreRoot, bodyPath), reason: `正文缺失：${error.message}` });
      continue;
    }
    const expected = String(meta.sha256 || "").toLowerCase();
    if (!expected || expected !== sha256(body)) {
      rejected.push({ source: path.relative(coreRoot, bodyPath), reason: "正文哈希不符" });
      continue;
    }
    candidates.push({ confirmedWeek: entry.name, metaPath, bodyPath, body, meta, frozenAt });
  }
  candidates.sort((a, b) => b.frozenAt - a.frozenAt);
  return { kind: candidates.length ? "ok" : "missing", reason: candidates.length ? "" : "目标周窗口内无有效确认导出", candidates, rejected };
}

export async function collectCoreWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const coreRoot = options.coreRoot || process.env.CORE_REPO_DIR || "/Users/yuwei/code/core";
  const result = await selectCoreExport({ coreRoot, week });
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  const report = { week, coreRoot, ...result, candidates: undefined, selected: null, written: null };

  if (result.kind !== "ok") {
    report.rejected = result.rejected;
    await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "unavailable", file: "core.md", count: 0, summary: `缺失：${result.reason}` });
    console.log(JSON.stringify({ ...report, status: "unavailable" }, null, 2));
    return { status: "unavailable", report };
  }

  const selected = result.candidates[0];
  const skipped = result.candidates.slice(1).map((item) => item.confirmedWeek);
  const header = [
    "<!--",
    `来源：Core V1 确认导出（/Users/yuwei/code/core/runtime/exports/${selected.confirmedWeek}/${week}.md）`,
    `认知确认时间（frozenAt）：${selected.meta.frozenAt}`,
    `原始复盘覆盖周：${selected.meta.reviewWeek}`,
    `飞书周段落：${selected.meta.feishuUrl || "未提供"}`,
    `正文哈希：${selected.meta.sha256}`,
    "注意：Core 回流是历史认知背景，与底层经历同源，不构成第二份独立现实证据；行动归属按覆盖周理解，不计为本周新行动。",
    "-->",
    ""
  ].join("\n");
  const outputPath = path.join(repoRoot, "03_input/weekly", week, "core.md");
  await writeFile(outputPath, `${header}${selected.body}`, "utf8");
  await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "ready", file: "core.md", count: 1, summary: `Core ${selected.meta.reviewWeek} 复盘（确认于 ${selected.meta.frozenAt}）` });
  report.selected = { confirmedWeek: selected.confirmedWeek, frozenAt: selected.meta.frozenAt, reviewWeek: selected.meta.reviewWeek, feishuUrl: selected.meta.feishuUrl || "" };
  report.skippedNewer = skipped;
  report.rejected = result.rejected;
  report.written = path.relative(repoRoot, outputPath);
  console.log(JSON.stringify({ ...report, status: "ready" }, null, 2));
  return { status: "ready", report };
}

export async function main(argv) {
  let week = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") week = argv[index + 1] || "";
  }
  const { status } = await collectCoreWeekly(week ? { week } : {});
  if (status !== "ready") process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

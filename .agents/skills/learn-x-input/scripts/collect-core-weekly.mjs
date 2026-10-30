#!/usr/bin/env node
// input:core —— 从 Core V1（人生复利工作台）读取用户确认后的周复盘导出。
// 契约（core/docs/cases/2026-10-core-v1/execution-plan.md §2）：
// - 在目标周的上海时间窗口内，汇集通过校验的确认导出（Core 回流按确认周归属）。
// - 写入 03_input/weekly/YYYY-Www/core.md，注明认知确认时间、原始复盘覆盖周及来源。
// - 无导出则报告缺失，不等待同覆盖周 Core，不回退更早版本。
// - 缺元数据、未知版本、哈希不符时排除该文件并报告异常。
// Core 回流是历史认知背景，与底层经历同源，不得当作第二份独立现实证据。
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rename, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isoWeekRangeShanghai, normalizeWeek, defaultWeeklyReviewWeek } from "./collect-weread-weekly.mjs";
import { acquireWeeklyFileLock, fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../../..");
export const CORE_EXPORT_SCHEMA_VERSION = "1";
const SUPPORTED_SCHEMA_VERSIONS = new Set([CORE_EXPORT_SCHEMA_VERSION, "2"]);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// 只接受元数据完整发布、正文哈希一致且确认时间位于目标周的批次。
export async function selectCoreExport({ coreRoot, week }) {
  const range = isoWeekRangeShanghai(week);
  const exportsRoot = path.join(coreRoot, "runtime", "exports");
  const confirmedWeekRoot = path.join(exportsRoot, week);
  let exportFiles;
  try {
    exportFiles = await readdir(confirmedWeekRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing", reason: `缺失：Core 确认周 ${week} 尚无导出目录`, candidates: [] };
    throw error;
  }
  const candidates = [];
  const rejected = [];
  for (const entry of exportFiles) {
    const match = entry.name.match(/^(\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))(?:--([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\.json$/i);
    if (match && !entry.isFile()) {
      rejected.push({ source: path.relative(coreRoot, path.join(confirmedWeekRoot, entry.name)), reason: "确认元数据不是普通文件", v2: Boolean(match[2]) });
      continue;
    }
    if (!match) {
      if (entry.isFile() && /--.*\.json$/i.test(entry.name)) rejected.push({ source: path.relative(coreRoot, path.join(confirmedWeekRoot, entry.name)), reason: "批次文件名非法", v2: true });
      continue;
    }
    const reviewWeek = match[1];
    const metaPath = path.join(confirmedWeekRoot, entry.name);
    const batchId = match[2] ?? null;
    const bodyPath = path.join(confirmedWeekRoot, entry.name.replace(/\.json$/, ".md"));
    let meta;
    try {
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    } catch (error) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `元数据 JSON 不可解析：${error.message}` });
      continue;
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: "元数据 JSON 顶层必须是对象" });
      continue;
    }
    if (meta.status !== "confirmed") {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `status=${meta.status}，非确认导出`, unconfirmed: true });
      continue;
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.has(String(meta.schemaVersion))) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `未知 schemaVersion=${meta.schemaVersion}` });
      continue;
    }
    if ((batchId && (String(meta.schemaVersion) !== "2" || meta.batchId !== batchId)) || (!batchId && String(meta.schemaVersion) !== "1")) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: "批次文件名与 schemaVersion 或 batchId 不一致", v2: Boolean(batchId) });
      continue;
    }
    if (batchId && (!Array.isArray(meta.confirmedItems) || meta.confirmedItems.length === 0 || meta.confirmedItems.some((item) => !item || typeof item.id !== "string" || !item.id.trim() || typeof item.locator !== "string" || !item.locator.trim()) || new Set(meta.confirmedItems.map((item) => item.id)).size !== meta.confirmedItems.length)) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: "缺少有效的已确认条目清单", v2: true });
      continue;
    }
    if (meta.reviewWeek !== reviewWeek) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `reviewWeek=${meta.reviewWeek} 与文件名 ${reviewWeek} 不一致，无法归属` });
      continue;
    }
    const frozenAtRaw = String(meta.frozenAt || "");
    // Core 以 Asia/Shanghai 为准；无时区标记的 ISO 串按上海时间解释，避免依赖本机时区。
    const frozenAtIso = /(Z|[+-]\d{2}:?\d{2})$/i.test(frozenAtRaw) ? frozenAtRaw : frozenAtRaw === "" ? "" : frozenAtRaw + "+08:00";
    const frozenAt = Date.parse(frozenAtIso);
    if (!Number.isFinite(frozenAt) || frozenAt < range.startEpoch * 1000 || frozenAt >= range.endEpoch * 1000) {
      rejected.push({ source: path.relative(coreRoot, metaPath), reason: `frozenAt=${frozenAtRaw || "缺失"} 不在目标周窗口内` });
      continue;
    }
    let body;
    try {
      if (!(await lstat(bodyPath)).isFile()) throw new Error("正文不是普通文件");
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
    candidates.push({ confirmedWeek: week, metaPath, bodyPath, body, meta, frozenAt, batchId });
  }
  candidates.sort((a, b) => a.frozenAt - b.frozenAt || a.meta.reviewWeek.localeCompare(b.meta.reviewWeek) || String(a.batchId).localeCompare(String(b.batchId)));
  const seenBatches = new Set();
  for (const candidate of candidates.filter((item) => item.batchId)) {
    const id = candidate.batchId.toLowerCase();
    if (seenBatches.has(id)) return { kind: "ambiguous", reason: `重复 batchId=${id}`, candidates, rejected };
    seenBatches.add(id);
  }
  if (rejected.some((item) => item.v2 || /--.*\.json$/i.test(item.source) || /--.*\.md$/i.test(item.source)) || (candidates.length && rejected.some((item) => !item.unconfirmed))) return { kind: "invalid", reason: "存在未通过校验的确认导出，拒绝不完整回流", candidates, rejected };
  return { kind: candidates.length ? "ok" : "missing", reason: candidates.length ? "" : "目标周窗口内无有效确认导出", candidates, rejected };
}

export async function collectCoreWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  let release;
  try {
    release = await acquireWeeklyFileLock(weekRoot, "_core-import.lock");
  } catch (error) {
    // Do not mark the shared source failed while another importer may own it.
    return { status: "failed", report: { week, reason: `Core 回流锁不可用：${error.message}`, written: null } };
  }
  try {
    return await collectCoreWeeklyForWeek(options, week, repoRoot);
  } catch (error) {
    await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "failed", file: "core.md", count: 0, summary: `Core 回流失败：${error.message}`, preservedStaleFile: await fileExists(path.join(weekRoot, "core.md")) });
    return { status: "failed", report: { week, reason: error.message, written: null } };
  } finally {
    await release();
  }
}

async function collectCoreWeeklyForWeek(options, week, repoRoot) {
  const coreRoot = options.coreRoot || process.env.CORE_REPO_DIR || "/Users/yuwei/code/core";
  const result = await selectCoreExport({ coreRoot, week });
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  const report = { week, coreRoot, ...result, candidates: undefined, selected: null, written: null };

  if (result.kind !== "ok") {
    report.rejected = result.rejected;
    await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "unavailable", file: "core.md", count: 0, summary: `缺失：${result.reason}`, preservedStaleFile: await fileExists(path.join(weekRoot, "core.md")) });
    console.log(JSON.stringify({ ...report, status: "unavailable" }, null, 2));
    return { status: "unavailable", report };
  }

  const selected = result.candidates;
  const output = selected.map((item) => [
    "<!--",
    `来源：Core 确认导出（${item.bodyPath}）`,
    `认知确认时间（frozenAt）：${item.meta.frozenAt}`,
    `原始复盘覆盖周：${item.meta.reviewWeek}`,
    `确认批次：${item.batchId || "legacy-v1"}`,
    `飞书周段落：${item.meta.feishuUrl || "未提供"}`,
    `正文哈希：${item.meta.sha256}`,
    "注意：Core 回流是历史认知背景，与底层经历同源，不构成第二份独立现实证据；行动归属按覆盖周理解，不计为本周新行动。",
    "-->", "", item.body.trimEnd(), ""
  ].join("\n")).join("\n");
  const outputPath = path.join(repoRoot, "03_input/weekly", week, "core.md");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const receiptPath = path.join(weekRoot, "_core-import.json");
  let existing = null;
  try {
    const stat = await lstat(outputPath);
    if (!stat.isFile()) throw new Error("core.md 不是普通文件，拒绝覆盖");
    existing = await readFile(outputPath, "utf8");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let receipt = null;
  try { receipt = JSON.parse(await readFile(receiptPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") receipt = null; }
  if (existing !== null && existing !== output && (!receipt || (receipt.outputSha256 !== sha256(existing) && receipt.pendingSha256 !== sha256(existing)))) {
    const reason = "core.md 已有未受管或人工修改内容，保留原文并停止覆盖";
    await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "needs_review", file: "core.md", count: 0, summary: reason, preservedStaleFile: true });
    console.log(JSON.stringify({ ...report, status: "needs_review", reason }, null, 2));
    return { status: "needs_review", report: { ...report, reason } };
  }
  const writeReceipt = async (data) => {
    const temp = `${receiptPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(data) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temp, receiptPath);
    } finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  };
  if (existing !== output) await writeReceipt({ schemaVersion: 1, outputSha256: existing === null ? null : sha256(existing), pendingSha256: sha256(output) });
  if (existing === null) {
    try { await writeFile(outputPath, output, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "needs_review", file: "core.md", count: 0, summary: "core.md 并发出现，保留原文", preservedStaleFile: true });
      return { status: "needs_review", report: { ...report, reason: "core.md 并发出现" } };
    }
  } else if (existing !== output) {
    const temporary = `${outputPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, output, { encoding: "utf8", flag: "wx", mode: 0o600 });
      if (await readFile(outputPath, "utf8") !== existing) throw new Error("core.md 在写入前变化");
      await rename(temporary, outputPath);
    } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }
  if (await readFile(outputPath, "utf8") !== output) throw new Error("core.md 写后读回不一致");
  await writeReceipt({ schemaVersion: 1, outputSha256: sha256(output) });
  await updateWeeklySourceStatus({ weekRoot, week, source: "core", status: "ready", file: "core.md", count: selected.length, summary: `Core 确认复盘 ${selected.length} 批` });
  report.selected = selected.map((item) => ({ confirmedWeek: item.confirmedWeek, frozenAt: item.meta.frozenAt, reviewWeek: item.meta.reviewWeek, batchId: item.batchId, feishuUrl: item.meta.feishuUrl || "" }));
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

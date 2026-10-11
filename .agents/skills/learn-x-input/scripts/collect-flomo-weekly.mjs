import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";
import { learnXGeneratedReason } from "./lib/flomo-filter.mjs";
import { defaultFlomoPrivateDataRoot, MAX_ACCEPTED_MISSING_RECORDS, writeStagedOnlineFlomoSnapshot } from "./lib/flomo-full-snapshot.mjs";
import { isoWeekRangeShanghai, normalizeWeek, defaultWeeklyReviewWeek } from "./collect-weread-weekly.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const TIMEZONE = "Asia/Shanghai";
const MAX_SCAN_STEPS = 1000;
const MAX_MEMOS = 20_000;

export async function collectFlomoWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const notesPath = path.join(outputRoot, "flomo.md");
  const mirrorPath = options.mirrorPath || path.join(repoRoot, "03_input/_mirrors/flomo-top.md");
  try {
    const scan = await (options.scan || scanFlomoWithEgo)({ week, range: isoWeekRangeShanghai(week) });
    const validated = validateCompleteScan(scan, week);
    const generatedExcluded = validated.memos.filter((memo) => isLearnXGenerated(memo.bodyText)).length;
    const filtered = validated.memos.filter((memo) => !isLearnXGenerated(memo.bodyText));
    const included = dedupeWeeklyMemos(filtered);
    const content = renderFlomoWeekly({ week, scan: validated, memos: included });
    await mkdir(outputRoot, { recursive: true });
    if (included.length) {
      await assertReplaceableGeneratedInput(notesPath, week);
      await atomicWrite(notesPath, content);
    }

    const summary = `完整扫描 ${validated.range.start} 至 ${validated.range.endExclusive} 完成；下界已覆盖：是；${included.length} 条${included.length ? "" : "，确认无匹配"}（分页 ${validated.pageCount} 页）`;
    await updateWeeklySourceStatus({
      weekRoot: outputRoot,
      week,
      source: "flomo",
      status: included.length ? "ready" : "empty",
      file: "flomo.md",
      count: included.length,
      summary,
      preservedStaleFile: !included.length && await fileExists(notesPath)
    });

    const pin = validatePinnedMemo(validated.pinned);
    let mirror = { status: "preserved", reason: "pin-count-not-one" };
    if (pin) {
      await atomicWrite(mirrorPath, renderPinnedMirror({ pin, week, syncedAt: validated.scanFinishedAt }));
      mirror = { status: "updated", path: mirrorPath };
    }
    return {
      week,
      notesPath: included.length ? notesPath : null,
      count: included.length,
      scanned: validated.scanned,
      excludedGenerated: generatedExcluded,
      duplicateCount: filtered.length - included.length,
      pageCount: validated.pageCount,
      lowerBoundCovered: true,
      summary,
      mirror
    };
  } catch (error) {
    const safeReason = classifyFlomoError(error);
    await updateWeeklySourceStatus({
      weekRoot: outputRoot,
      week,
      source: "flomo",
      status: safeReason === "ego-login-or-control-required" ? "unavailable" : "failed",
      file: "flomo.md",
      count: 0,
      summary: `完整周扫描失败：${safeReason}；未使用旧文件`,
      preservedStaleFile: await fileExists(notesPath)
    });
    error.message = `flomo-weekly-${safeReason}`;
    throw error;
  }
}

export function validateCompleteScan(scan, week) {
  const normalizedWeek = normalizeWeek(week);
  const range = isoWeekRangeShanghai(normalizedWeek);
  if (!scan || scan.complete !== true || scan.lowerBoundCovered !== true || scan.week !== normalizedWeek) {
    throw new Error("flomo-scan-incomplete");
  }
  if (!Array.isArray(scan.memos) || !Array.isArray(scan.pinned) || !Number.isInteger(scan.pageCount) || scan.pageCount < 1) {
    throw new Error("flomo-scan-invalid-shape");
  }
  if (scan.memos.length > MAX_MEMOS || scan.scanned > MAX_MEMOS) throw new Error("flomo-scan-capacity-exceeded");
  for (const memo of scan.memos) {
    const time = parseMemoTime(memo.timeText);
    if (!memo.memoId || !memo.bodyComplete || time == null || time < range.startEpoch * 1000 || time >= range.endEpoch * 1000) {
      throw new Error("flomo-weekly-record-incomplete");
    }
    if (typeof memo.bodyText !== "string") throw new Error("flomo-weekly-record-incomplete");
  }
  for (const pin of scan.pinned) if (!pin.memoId || typeof pin.timeText !== "string") throw new Error("flomo-pin-record-incomplete");
  return {
    ...scan,
    week: normalizedWeek,
    range: {
      start: formatShanghaiDateTime(range.startEpoch),
      endExclusive: formatShanghaiDateTime(range.endEpoch)
    },
    memos: scan.memos.map((memo) => ({ ...memo, timeMs: parseMemoTime(memo.timeText), bodyText: normalizeMemoText(memo.bodyText) }))
  };
}

export async function collectFlomoFullSnapshot(options = {}) {
  const scan = await (options.scan || scanFlomoWithEgo)({
    mode: "full",
    taskSpaceId: options.taskSpaceId,
    taskSpaceName: options.taskSpaceName,
    resumeTaskSpace: options.resumeTaskSpace === true,
    keepTaskSpace: options.keepTaskSpace === true,
    timeout: options.timeout,
  });
  const staged = await writeStagedOnlineFlomoSnapshot(options.repoRoot || repoRoot, scan, {
    storageRoot: options.storageRoot || defaultFlomoPrivateDataRoot(),
    snapshotPath: options.snapshotPath,
    previewPath: options.previewPath,
  });
  return {
    snapshotId: staged.snapshot.snapshotId,
    sourceMode: staged.snapshot.sourceMode,
    taskSpaceId: scan.taskSpaceId ?? null,
    taskSpaceName: scan.taskSpaceName ?? null,
    capturedAt: staged.snapshot.capturedAt,
    totalCount: staged.snapshot.totalCount,
    coverage: staged.snapshot.coverage,
    pinnedCount: staged.snapshot.pinnedCount,
    pageCount: staged.snapshot.pageCount,
    termination: staged.snapshot.termination,
    detailVerification: staged.snapshot.detailVerification,
    snapshotPath: staged.snapshotPath,
    previewPath: staged.previewPath,
    cardPath: staged.cardPath,
    bundlePath: staged.bundlePath,
  };
}

export function parseMemoTime(text) {
  if (text == null) return null;
  const match = String(text).trim().replace(/^置顶[・·]\s*/, "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth || h > 23 || min > 59) return null;
  return Date.UTC(y, m - 1, d, h - 8, min);
}

export function isLearnXGenerated(text) {
  return learnXGeneratedReason(text) !== null;
}

export function dedupeWeeklyMemos(memos) {
  const unique = new Map();
  for (const memo of memos) {
    const bodyText = normalizeMemoText(memo.bodyText);
    const key = `${memo.timeMs ?? parseMemoTime(memo.timeText)}\u0000${bodyText}`;
    const previous = unique.get(key);
    if (!previous || String(memo.memoId).localeCompare(String(previous.memoId)) < 0) unique.set(key, { ...memo, bodyText });
  }
  return [...unique.values()].sort((a, b) => a.timeMs - b.timeMs || String(a.memoId).localeCompare(String(b.memoId)));
}

export function renderFlomoWeekly({ week, scan, memos }) {
  const lines = [
    `# Flomo 周输入｜${week}`,
    "",
    `- 时区：${TIMEZONE}`,
    `- 采集范围：${scan.range.start} 至 ${scan.range.endExclusive}（不含结束时刻）`,
    "- 完整扫描：是",
    "- 下界已覆盖：是",
    `- 扫描记录：${scan.scanned}`,
    `- 分页：已完成（${scan.pageCount} 页）`,
    `- 目标周记录：${memos.length}`,
    `- 扫描开始：${scan.scanStartedAt}`,
    `- 扫描完成：${scan.scanFinishedAt}`,
    ""
  ];
  if (!memos.length) lines.push("本周完整查询，Flomo 笔记为 0 条。", "");
  for (const [index, memo] of memos.entries()) {
    if (index) lines.push("---", "");
    lines.push(`## ${memo.timeText}`, "", `- 来源：${flomoMemoUrl(memo.memoId)}`, "", memo.bodyText || "（该笔记无可提取文字）", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderPinnedMirror({ pin, week, syncedAt }) {
  const createdAt = pin.timeText.replace(/^置顶[・·]\s*/, "");
  return [
    "# Flomo 置顶笔记镜像",
    "",
    `- 来源：${flomoMemoUrl(pin.memoId)}`,
    `- 原始创建时间：${createdAt}`,
    `- 同步周：${week}`,
    `- 同步时间：${syncedAt}`,
    "",
    normalizeMemoText(pin.bodyText),
    ""
  ].join("\n");
}

export async function publishFlomoSnapshotWeek(snapshot, { week, repoRoot: root = repoRoot, outputRoot, mirrorPath } = {}) {
  const targetWeek = normalizeWeek(week);
  if (!snapshot || snapshot.sourceMode !== "flomo-online-full" || !Array.isArray(snapshot.records) ||
      !Number.isFinite(Date.parse(snapshot.scanStartedAt)) || !Number.isFinite(Date.parse(snapshot.scanFinishedAt)) ||
      !Number.isInteger(snapshot.totalCount) || snapshot.totalCount !== snapshot.records.length || !snapshot.coverage) {
    throw new Error("flomo-week-snapshot-invalid");
  }
  const range = isoWeekRangeShanghai(targetWeek);
  const startMs = range.startEpoch * 1000, endMs = range.endEpoch * 1000;
  const observed = snapshot.records
    .filter((record) => !record.isPinned && Date.parse(record.createdAt) >= startMs && Date.parse(record.createdAt) < endMs)
    .map((record) => ({ ...record, timeMs: Date.parse(record.createdAt), bodyText: normalizeMemoText(record.body) }));
  const generatedExcluded = observed.filter((memo) => isLearnXGenerated(memo.bodyText)).length;
  const filtered = observed.filter((memo) => !isLearnXGenerated(memo.bodyText));
  const included = dedupeWeeklyMemos(filtered);
  const weekRoot = outputRoot || path.join(root, "03_input/weekly", targetWeek);
  const notesPath = path.join(weekRoot, "flomo.md");
  const coverageComplete = snapshot.coverage.status === "complete" && snapshot.coverage.omittedCount === 0;
  const summary = coverageComplete
    ? `完整线上快照 ${snapshot.capturedAt}；扫描 ${snapshot.scanStartedAt} 至 ${snapshot.scanFinishedAt}；下界已覆盖：是；${included.length} 条${included.length ? "" : "，确认无匹配"}（分页 ${snapshot.pageCount} 页）`
    : `全量快照扫描完成但存在 ${snapshot.coverage.omittedCount} 条未枚举缺口；无法证明 ${targetWeek} Flomo 周输入完整，未发布目标周文件`;

  if (!coverageComplete) {
    await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status: "failed", file: "flomo.md",
      count: 0, summary, preservedStaleFile: await fileExists(notesPath) });
    return { week: targetWeek, status: "failed", error: "flomo-weekly-snapshot-gap", count: 0, snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt, coverage: snapshot.coverage, termination: snapshot.termination };
  }

  await mkdir(weekRoot, { recursive: true });
  const scan = { range: { start: formatShanghaiDateTime(range.startEpoch), endExclusive: formatShanghaiDateTime(range.endEpoch) },
    scanned: snapshot.totalCount, pageCount: snapshot.pageCount,
    scanStartedAt: snapshot.scanStartedAt, scanFinishedAt: snapshot.scanFinishedAt };
  if (included.length) {
    await assertReplaceableGeneratedInput(notesPath, targetWeek);
    await atomicWrite(notesPath, renderFlomoWeekly({ week: targetWeek, scan, memos: included }));
  }
  const status = included.length ? "ready" : "empty";
  await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status, file: "flomo.md",
    count: included.length, summary, preservedStaleFile: !included.length && await fileExists(notesPath) });

  const pins = snapshot.records.filter((record) => record.isPinned).map((record) => ({ ...record, bodyText: record.body, bodyComplete: true }));
  const pin = validatePinnedMemo(pins);
  let mirror = { status: "preserved", reason: "pin-count-not-one" };
  if (pin) {
    const targetMirror = mirrorPath || path.join(root, "03_input/_mirrors/flomo-top.md");
    await atomicWrite(targetMirror, renderPinnedMirror({ pin, week: targetWeek, syncedAt: snapshot.capturedAt }));
    mirror = { status: "updated", path: targetMirror };
  }
  return { week: targetWeek, status, notesPath: included.length ? notesPath : null, count: included.length,
    scanned: snapshot.totalCount, excludedGenerated: generatedExcluded, duplicateCount: filtered.length - included.length,
    summary, mirror, snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt,
    coverage: snapshot.coverage, termination: snapshot.termination };
}

function validatePinnedMemo(pinned) {
  if (pinned.length !== 1) return null;
  const pin = pinned[0];
  return pin.bodyComplete === true && pin.bodyText.trim() ? pin : null;
}

function normalizeMemoText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function flomoMemoUrl(memoId) {
  return `https://v.flomoapp.com/mine/?memo_id=${encodeURIComponent(memoId)}`;
}

function formatShanghaiDateTime(epochSeconds) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(epochSeconds * 1000));
}

export function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--week") {
      const week = argv[++index];
      if (!week || week.startsWith("--")) throw new Error("--week 需要 YYYY-Www 参数");
      options.week = week;
    } else if (arg === "--full-snapshot") {
      if (options.mode) throw new Error("采集模式只能指定一次");
      options.mode = "full";
    } else if (arg === "--verify-detail") {
      options.verifyDetail = true;
    } else if (arg === "--keep-taskspace") {
      options.keepTaskSpace = true;
    } else if (arg === "--resume-taskspace") {
      options.resumeTaskSpace = true;
    } else if (arg === "--task-space-id") {
      const taskSpaceId = Number(argv[++index]);
      if (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1) throw new Error("--task-space-id 必须是正整数");
      options.taskSpaceId = taskSpaceId;
    } else if (arg === "--task-space-name") {
      const taskSpaceName = argv[++index];
      if (!taskSpaceName || !/^[a-zA-Z0-9_-]{1,160}$/.test(taskSpaceName)) throw new Error("--task-space-name 必须是 1 到 160 位字母、数字、下划线或连字符");
      options.taskSpaceName = taskSpaceName;
    } else if (arg === "--storage-root") {
      const storageRoot = argv[++index];
      if (!storageRoot || !path.isAbsolute(storageRoot)) throw new Error("--storage-root 必须是绝对路径");
      options.storageRoot = path.resolve(storageRoot);
    } else if (arg === "--timeout-ms") {
      const timeout = Number(argv[++index]);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30 * 60_000) {
        throw new Error("--timeout-ms 必须是 1 到 1800000 之间的整数");
      }
      options.timeout = timeout;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (options.mode === "full" && options.week) throw new Error("--full-snapshot 不能与 --week 同时使用");
  if ((options.taskSpaceId === undefined) !== (options.taskSpaceName === undefined)) {
    throw new Error("--task-space-id 与 --task-space-name 必须同时使用");
  }
  if (options.resumeTaskSpace && (!options.keepTaskSpace || options.taskSpaceId === undefined)) {
    throw new Error("--resume-taskspace 必须与 --keep-taskspace、--task-space-id 和 --task-space-name 一起使用");
  }
  if (options.mode !== "full" && (options.verifyDetail || options.keepTaskSpace || options.resumeTaskSpace || options.taskSpaceId || options.taskSpaceName || options.storageRoot || options.timeout)) {
    throw new Error("--verify-detail、--keep-taskspace、--resume-taskspace、--task-space-id、--task-space-name、--storage-root 和 --timeout-ms 仅用于 --full-snapshot");
  }
  return options;
}

export function cliUsage() {
  return [
    "用法：",
    "  node collect-flomo-weekly.mjs [--week YYYY-Www]",
    "  node collect-flomo-weekly.mjs --full-snapshot [--keep-taskspace] [--task-space-id N --task-space-name NAME] [--resume-taskspace] [--storage-root ABSOLUTE_PATH] [--timeout-ms N]",
    "  node collect-flomo-weekly.mjs --help",
    "",
    `默认运行目标 ISO 周采集；--full-snapshot 总会核验最长笔记详情，只生成私有暂存快照与本地预览，不切换日常 catalog。终态稳定且逐条数据有效时，最多允许 ${MAX_ACCEPTED_MISSING_RECORDS} 条计数缺口，快照会显式记录覆盖率；缺 ID、正文不完整或冲突仍失败关闭。恢复空间时必须同时提供此前输出的 ID 与随机名称。旧 --verify-detail 参数仍接受，但全量模式始终执行核验。`,
  ].join("\n");
}

export async function runCli(argv = []) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(cliUsage());
    return { help: true };
  }
  const result = options.mode === "full"
    ? await collectFlomoFullSnapshot(options)
    : await collectFlomoWeekly(options);
  console.log(JSON.stringify(result));
  return result;
}

export function formatCliError(error) {
  if (!error || typeof error.message !== "string") return "browser-scan-failed";
  if (!error.stage && !error.pageDiagnostics && !Number.isSafeInteger(error.taskSpaceId) && typeof error.taskSpaceName !== "string") return error.message;
  const details = {};
  if (typeof error.stage === "string" && /^[a-z0-9-]+$/.test(error.stage)) details.stage = error.stage;
  if (Number.isSafeInteger(error.taskSpaceId) && error.taskSpaceId > 0) details.taskSpaceId = error.taskSpaceId;
  if (typeof error.taskSpaceName === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(error.taskSpaceName)) details.taskSpaceName = error.taskSpaceName;
  if (error.taskOwnership === "agent") details.taskOwnership = "agent";
  if (Object.hasOwn(error, "expectedCount") && (error.expectedCount === null || Number.isInteger(error.expectedCount) && error.expectedCount >= 0 && error.expectedCount <= MAX_MEMOS)) {
    details.expectedCount = error.expectedCount;
  }
  for (const field of ["observedUniqueIds", "step"]) {
    if (Number.isInteger(error[field]) && error[field] >= -1 && error[field] <= MAX_MEMOS) details[field] = error[field];
  }
  const source = error.pageDiagnostics;
  if (source && typeof source === "object") {
    const page = {};
    if (typeof source.host === "string" && /^[a-z0-9.-]{1,253}$/i.test(source.host)) page.host = source.host;
    if (typeof source.path === "string" && /^\/[a-z0-9/_-]{0,256}$/i.test(source.path)) page.path = source.path;
    for (const field of ["pageTitleHasFlomo", "hasMemoList", "hasCountLabel", "loadingVisible", "emptyStateVisible", "loginIndicator", "captchaIndicator"]) {
      if (typeof source[field] === "boolean") page[field] = source[field];
    }
    for (const field of ["libraryCount", "memoCardCount"]) {
      if (source[field] === null || Number.isInteger(source[field]) && source[field] >= 0 && source[field] <= MAX_MEMOS) page[field] = source[field];
    }
    if (source.detail && typeof source.detail === "object") {
      const detail = {};
      for (const field of ["sheetVisible", "routeMatches", "bodyPresent", "editorPresent", "targetListLinkVisible"]) {
        if (typeof source.detail[field] === "boolean") detail[field] = source.detail[field];
      }
      if (Number.isInteger(source.detail.targetLinkCount) && source.detail.targetLinkCount >= 0 && source.detail.targetLinkCount <= MAX_MEMOS) {
        detail.targetLinkCount = source.detail.targetLinkCount;
      }
      if (Object.keys(detail).length) page.detail = detail;
    }
    if (Object.keys(page).length) details.pageDiagnostics = page;
  }
  const mismatch = error.detailMismatch;
  if (mismatch && typeof mismatch === "object") {
    const clean = {};
    for (const field of ["expectedLength", "editorInnerLength", "editorTextContentLength"]) {
      if (Number.isInteger(mismatch[field]) && mismatch[field] >= 0 && mismatch[field] <= MAX_MEMOS) clean[field] = mismatch[field];
    }
    for (const group of ["innerText", "textContent"]) {
      const sourceGroup = mismatch[group];
      if (!sourceGroup || typeof sourceGroup !== "object") continue;
      const safeGroup = {};
      for (const field of ["commonPrefix", "commonSuffix", "expectedMiddleLength", "editorMiddleLength"]) {
        if (Number.isInteger(sourceGroup[field]) && sourceGroup[field] >= 0 && sourceGroup[field] <= MAX_MEMOS) safeGroup[field] = sourceGroup[field];
      }
      for (const field of ["editorMiddleHasUrl", "editorMiddleHasMarkdownLink", "editorMiddleHasHtmlTag"]) {
        if (typeof sourceGroup[field] === "boolean") safeGroup[field] = sourceGroup[field];
      }
      for (const field of ["expectedMiddleKinds", "editorMiddleKinds"]) {
        const sourceKinds = sourceGroup[field];
        if (!sourceKinds || typeof sourceKinds !== "object") continue;
        const safeKinds = {};
        for (const kind of ["whitespace", "zeroWidth", "han", "latinOrDigit", "other"]) {
          if (Number.isInteger(sourceKinds[kind]) && sourceKinds[kind] >= 0 && sourceKinds[kind] <= MAX_MEMOS) safeKinds[kind] = sourceKinds[kind];
        }
        if (Object.keys(safeKinds).length) safeGroup[field] = safeKinds;
      }
      if (Object.keys(safeGroup).length) clean[group] = safeGroup;
    }
    if (Object.keys(clean).length) details.bodyMismatch = clean;
  }
  return `${error.message} ${JSON.stringify(details)}`;
}

export function classifyFlomoError(error) {
  const value = `${error?.message || ""} ${error?.code || ""} ${error?.stderr || ""}`.toLowerCase();
  if (/ego.*(?:bootstrap|login|permission|control)|user.control|unauthori[sz]ed|forbidden/.test(value)) return "ego-login-or-control-required";
  if (/task-exit-unconfirmed|taskspace-(?:binding-mismatch|resume-name-required)|cleanup-unconfirmed|detail-(?:body-mismatch|link-unresolved|editor-(?:unavailable|target-unavailable|cancel-unavailable)|verification-(?:missing|invalid))|library-count-(?:mismatch|gap-exceeds-tolerance|changed|unavailable)|memo-id-missing|body-incomplete|pagination-incomplete|pagination-control-missing|scan-record-conflict|scan-conflict/.test(value)) return "scan-integrity-check-failed";
  if (/capacity/.test(value)) return "scan-capacity-exceeded";
  if (/rate.?limit|throttl|too many requests|http.?429/.test(value)) return "service-rate-limit";
  if (/timeout|timed out|etimedout|sigterm/.test(value)) return "network-timeout";
  if (/econnreset|econnrefused|eai_again|enotfound|err_name_not_resolved|err_connection_reset|err_connection_refused|network|dns|temporar|http.?5[0-9][0-9]/.test(value)) return "network-transient";
  if (/invalid|incomplete|week.*record/.test(value)) return "scan-integrity-check-failed";
  return "browser-scan-failed";
}

export async function scanFlomoWithEgo({ week, range, mode = "weekly", taskSpaceId, taskSpaceName, keepTaskSpace = false, resumeTaskSpace = false, timeout } = {}) {
  if (mode === "full") {
    const hasTaskSpaceId = taskSpaceId !== undefined && taskSpaceId !== null;
    const hasTaskSpaceName = taskSpaceName !== undefined && taskSpaceName !== null;
    if (hasTaskSpaceId !== hasTaskSpaceName || hasTaskSpaceId && (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1 || !/^[a-zA-Z0-9_-]{1,160}$/.test(taskSpaceName))) {
      throw new Error("taskspace-resume-name-required");
    }
    if (resumeTaskSpace && (!keepTaskSpace || !hasTaskSpaceId)) {
      throw new Error("taskspace-resume-claim-requires-explicit-kept-space");
    }
  }
  const invocation = randomUUID();
  const automationId = String(process.env.LEARN_X_AUTOMATION_ID || "learn-x-v2").replace(/[^a-zA-Z0-9_-]/g, "-");
  const taskName = `${automationId}-flomo-${invocation}`;
  const resultPath = path.join(os.tmpdir(), `learn-x-flomo-${invocation}.json`);
  const script = mode === "full"
    ? buildEgoFullScanScript({ taskName, taskSpaceId, taskSpaceName, resultPath, maxSteps: MAX_SCAN_STEPS, keepTaskSpace, resumeTaskSpace })
    : buildEgoScanScript({ week, range, taskName, resultPath, maxSteps: MAX_SCAN_STEPS });
  try {
    await runEgoScript(script, { timeout: timeout || (mode === "full" ? 30 * 60_000 : 30 * 60_000) });
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (result?.ok === false) {
      const knownErrors = new Set(["service-rate-limit", "network-timeout", "network-transient"]);
      const error = new Error(result.error === "user-control" ? "ego-user-control" : knownErrors.has(result.error) || mode === "full" ? `ego-${result.error}` : "ego-browser-scan-failed");
      if (mode === "full") {
        if (result.error !== "user-control" && result.executionFinished !== true && result.cleanup !== "finished") error.message = "ego-task-exit-unconfirmed";
        if (Number.isSafeInteger(result.taskSpaceId) && result.taskSpaceId > 0) error.taskSpaceId = result.taskSpaceId;
        if (typeof result.taskSpaceName === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(result.taskSpaceName)) error.taskSpaceName = result.taskSpaceName;
        if (result.taskOwnership === "agent") error.taskOwnership = "agent";
        if (typeof result.stage === "string" && /^[a-z0-9-]+$/.test(result.stage)) error.stage = result.stage;
        if (Number.isInteger(result.expectedCount)) error.expectedCount = result.expectedCount;
        if (Number.isInteger(result.observedUniqueIds)) error.observedUniqueIds = result.observedUniqueIds;
        if (Number.isInteger(result.step)) error.step = result.step;
        if (result.pageDiagnostics && typeof result.pageDiagnostics === "object") error.pageDiagnostics = result.pageDiagnostics;
        if (result.detailMismatch && typeof result.detailMismatch === "object") error.detailMismatch = result.detailMismatch;
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (error.code === "ENOENT" && error.path === "ego-browser") throw new Error("ego-browser-unavailable");
    const processOutput = `${error?.message || ""} ${error?.stderr || ""} ${error?.stdout || ""}`;
    if (/failed to connect to ego_cli bootstrap|cannot connect to the ego_cli bootstrap/i.test(processOutput)) {
      throw new Error("ego-bootstrap-unavailable");
    }
    if (/^ego-[a-z0-9-]+$/.test(String(error.message || ""))) throw error;
    if (mode === "full" && (error.killed || error.code === "ETIMEDOUT")) throw new Error("ego-task-exit-unconfirmed");
    if (error.killed || error.code === "ETIMEDOUT") throw new Error("ego-browser-timeout");
    if (/econnreset|econnrefused|eai_again|enotfound|err_name_not_resolved|err_connection_reset|err_connection_refused|network|dns|temporar|http.?5[0-9][0-9]/i.test(`${error.message || ""} ${error.code || ""} ${error.stderr || ""}`)) {
      throw new Error("ego-network-transient");
    }
    throw new Error("ego-browser-scan-failed");
  } finally {
    await rm(resultPath, { force: true });
  }
}

export function runEgoScript(script, { timeout = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("ego-browser", ["nodejs", "-e", script], { timeout, maxBuffer: 1_000_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
      else resolve({ stdout, stderr });
    });
    // Ego's Node runner awaits stdin EOF even with -e. An open pipe stalls evaluation.
    child.stdin?.end();
  });
}

export function buildEgoScanScript({ week, range, taskName, resultPath, maxSteps }) {
  return `
const fs = await import('node:fs/promises');
let task;
task = await taskSpace(${JSON.stringify(taskName)});
let page;
const range = ${JSON.stringify({ start: range.startEpoch * 1000, end: range.endEpoch * 1000 })};
const week = ${JSON.stringify(week)};
const resultPath = ${JSON.stringify(resultPath)};
const startedAt = new Date().toISOString();
const seen = new Map();
let complete = false;
let lowerBoundCovered = false;
let pageCount = 1;
const state = () => page.evaluate(() => {
  const list = document.querySelector('.memos');
  const cards = [...document.querySelectorAll('div.memo')].map((card) => {
    const time = card.querySelector('a.time[href*="memo_id="]');
    const link = time;
    const body = card.querySelector('.richText, .content.copy-allowed, .content');
    return {
      memoId: link ? new URL(link.href).searchParams.get('memo_id') : null,
      timeText: (time?.querySelector(':scope > .text')?.innerText || time?.innerText)?.trim() || null,
      isEditor: Boolean(card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]')),
      bodyText: body?.innerText || '',
      bodyFound: Boolean(body),
      bodyComplete: Boolean(body),
      needsExpand: false,
      hasExpand: false,
      cardText: card.innerText || ''
    };
  });
  const buttons = [...document.querySelectorAll('button,a')].filter((item) => item.offsetParent !== null);
  const hasMore = buttons.some((item) => /加载更多|下一页/.test(item.innerText?.trim() || ''));
  const loading = [...document.querySelectorAll('*')].some((item) => {
    const rect = item.getBoundingClientRect();
    return item.offsetParent !== null && /^(loading|加载中|正在加载)$/.test(item.innerText?.trim() || '') && rect.top < window.innerHeight && rect.bottom > 0;
  });
  const atBottom = Boolean(list && list.scrollTop + list.clientHeight >= list.scrollHeight - 8);
  return { cards, hasMore, loading, atBottom, hasList: Boolean(list), progress: list ? cards.length + ':' + list.scrollHeight : '' };
});
const parseTime = (text) => {
  const match = String(text || '').trim().replace(/^置顶[・·]\\s*/, '').match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59) return null;
  return Date.UTC(y, m - 1, d, h - 8, min);
};
try {
  if (task.ownership !== 'agent') throw new Error('user-control');
  page = task.page('p1');
  await page.goto('https://v.flomoapp.com/mine');
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  for (let step = 0; step < ${maxSteps}; step += 1) {
    if (task.ownership !== 'agent') throw new Error('user-control');
    const current = await state();
    if (!current.hasList) throw new Error('list-unavailable');
    const timeline = current.cards.filter((item) => item.memoId && !item.isEditor && !/^置顶[・·]/.test(item.timeText || '')).map((item) => parseTime(item.timeText));
    if (timeline.some((time) => time == null)) throw new Error('timestamp-unreadable');
    const descending = timeline.every((time, index) => index === 0 || time <= timeline[index - 1]);
    for (const card of current.cards.filter((item) => item.memoId && !item.isEditor)) {
      const timeMs = parseTime(card.timeText);
      if (timeMs == null) throw new Error('timestamp-unreadable');
      const isPinned = /^置顶[・·]/.test(card.timeText || '');
      const bodyText = card.bodyText;
      const value = { ...card, timeMs, bodyText };
      if (!seen.has(card.memoId)) seen.set(card.memoId, value);
      else seen.set(card.memoId, { ...seen.get(card.memoId), ...value, bodyText: value.bodyText || seen.get(card.memoId).bodyText });
    }
    const afterExpand = await state();
    for (const card of afterExpand.cards.filter((item) => item.memoId && !item.isEditor)) {
      const previous = seen.get(card.memoId);
      if (!previous) continue;
      const timeMs = parseTime(card.timeText);
      const isPinned = /^置顶[・·]/.test(card.timeText || '');
      if ((!isPinned && timeMs >= range.start && timeMs < range.end) || isPinned) {
        if (!isPinned && (!card.bodyFound || card.needsExpand || !card.bodyComplete)) throw new Error('body-incomplete');
        seen.set(card.memoId, { ...previous, ...card, timeMs });
      }
    }
    const loadedTimes = afterExpand.cards.filter((item) => item.memoId && !item.isEditor && !/^置顶[・·]/.test(item.timeText || '')).map((item) => parseTime(item.timeText));
    if (descending && loadedTimes.some((time) => time < range.start)) {
      lowerBoundCovered = true;
      complete = true;
      break;
    }
    if (current.loading) {
      await page.waitForTimeout(500);
      continue;
    }
    if (current.hasMore) {
      const clicked = await page.evaluate(() => {
        const item = [...document.querySelectorAll('button,a')].find((node) => node.offsetParent !== null && /加载更多|下一页/.test(node.innerText?.trim() || ''));
        if (!item) return false;
        item.click();
        return true;
      });
      if (!clicked) throw new Error('pagination-control-missing');
      pageCount += 1;
      await page.waitForFunction((previous) => {
        const list = document.querySelector('.memos');
        return Boolean(list && [...document.querySelectorAll('div.memo')].length + ':' + list.scrollHeight + ':' + list.scrollTop !== previous);
      }, current.progress, { timeout: 30000 });
      continue;
    }
    if (current.atBottom) { complete = true; break; }
    let stableScrolls = 0;
    let previousScrollProgress = current.progress;
    while (stableScrolls < 3) {
      await page.evaluate(() => {
        const list = document.querySelector('.memos');
        if (list) { list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll', { bubbles: true })); }
      });
      await page.waitForTimeout(300);
      const scrolled = await page.evaluate(() => {
        const list = document.querySelector('.memos');
        return list ? [...document.querySelectorAll('div.memo')].length + ':' + list.scrollHeight : '';
      });
      if (scrolled === previousScrollProgress) stableScrolls += 1;
      else { stableScrolls = 0; previousScrollProgress = scrolled; }
    }
    await page.waitForFunction((previous) => {
      const list = document.querySelector('.memos');
      if (!list) return false;
      return [...document.querySelectorAll('div.memo')].length + ':' + list.scrollHeight !== previous;
    }, current.progress, { timeout: 10000 });
    const afterScroll = await state();
    if (afterScroll.atBottom && !afterScroll.hasMore && afterScroll.progress === current.progress) { complete = true; break; }
    if (afterScroll.progress === current.progress) await page.waitForTimeout(300);
  }
  if (!complete) throw new Error('pagination-incomplete');
  const memos = [...seen.values()].filter((item) => !/^置顶[・·]/.test(item.timeText || '') && item.timeMs >= range.start && item.timeMs < range.end);
  for (const memo of memos) if (!memo.bodyFound || !memo.bodyComplete) throw new Error('body-incomplete');
  const pinned = [...seen.values()].filter((item) => /^置顶[・·]/.test(item.timeText || '')).map((item) => {
    if (!item.bodyFound || !item.bodyComplete) return { ...item, bodyComplete: false };
    return item;
  });
  const result = {
    week, complete: true, lowerBoundCovered: lowerBoundCovered || complete, scanned: seen.size,
    pageCount: Math.max(1, pageCount), scanStartedAt: startedAt, scanFinishedAt: new Date().toISOString(),
    memos: memos.map(({ memoId, timeText, bodyText, bodyComplete }) => ({ memoId, timeText, bodyText, bodyComplete })),
    pinned: pinned.map(({ memoId, timeText, bodyText, bodyComplete }) => ({ memoId, timeText, bodyText, bodyComplete }))
  };
  await fs.writeFile(resultPath, JSON.stringify(result), { mode: 0o600 });
  await task.finish({ keep: [] });
  task = null;
  cliLog(JSON.stringify({ ok: true, complete: true, scanned: result.scanned, pageCount: result.pageCount }));
} catch (error) {
  const value = (String(error?.message || '') + ' ' + String(error?.code || '')).toLowerCase();
  const safeError = ['user-control', 'list-unavailable', 'timestamp-unreadable', 'body-incomplete', 'pagination-control-missing', 'pagination-incomplete'].includes(error.message)
    ? error.message
    : /rate.?limit|throttl|too many requests|http.?429/.test(value) ? 'service-rate-limit'
      : /timeout|timed out|etimedout|err_timed_out/.test(value) ? 'network-timeout'
        : /econnreset|econnrefused|eai_again|enotfound|err_name_not_resolved|err_connection_reset|err_connection_refused|network|dns|temporar|http.?5[0-9][0-9]/.test(value) ? 'network-transient'
          : 'scan-failed';
  let cleanup = 'not-needed';
  if (task && error.message !== 'user-control') {
    try { await task.finish({ keep: [] }); cleanup = 'finished'; }
    catch { cleanup = 'failed'; }
  }
  await fs.writeFile(resultPath, JSON.stringify({ ok: false, error: safeError, cleanup }), { mode: 0o600 });
  cliLog(JSON.stringify({ ok: false, error: safeError }));
}
`;
}

export function buildEgoFullScanScript({ taskName, taskSpaceId, taskSpaceName, resultPath, maxSteps = MAX_SCAN_STEPS, keepTaskSpace = false, resumeTaskSpace = false }) {
  if (taskSpaceId !== undefined && taskSpaceId !== null &&
      (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1 || !taskSpaceName || !/^[a-zA-Z0-9_-]{1,160}$/.test(taskSpaceName))) {
    throw new Error("taskspace-resume-name-required");
  }
  if (resumeTaskSpace && (!keepTaskSpace || !Number.isSafeInteger(taskSpaceId) || !taskSpaceName)) {
    throw new Error("taskspace-resume-claim-requires-explicit-kept-space");
  }
  const taskRef = Number.isSafeInteger(taskSpaceId) && taskSpaceId > 0 ? String(taskSpaceId) : JSON.stringify(taskName);
  const expectedTaskSpaceName = taskSpaceId ? taskSpaceName : taskName;
  const scanKey = `__learnXFlomoFullScan_${randomUUID().replace(/-/g, "")}`;
  return `
const fs = await import('node:fs/promises');
let task;
let page;
let taskSpaceBound = false;
let taskSpaceIdentity = null;
let taskLease;
let taskLeaseHeartbeat;
let taskLeaseFailed = false;
const taskRef = ${taskRef};
const expectedTaskSpaceName = ${JSON.stringify(expectedTaskSpaceName)};
const resultPath = ${JSON.stringify(resultPath)};
const scanKey = ${JSON.stringify(scanKey)};
const scanStartedAt = new Date().toISOString();
const { createHash } = await import('node:crypto');
const keepTaskSpace = ${keepTaskSpace === true};
const resumeTaskSpace = ${resumeTaskSpace === true};
const verifyDetail = true;
const maxSteps = ${Number.isSafeInteger(maxSteps) ? maxSteps : MAX_SCAN_STEPS};
const maxAcceptedMissingRecords = ${MAX_ACCEPTED_MISSING_RECORDS};
const seen = new Map();
let stage = 'taskspace-acquire';
let initialCount = null;
let scanStep = -1;
let pageCount = 1;
let observedCards = 0;
let complete = false;
let detailTargetId = null;
let detailMismatch = null;
let idleCountMismatchPasses = 0;
let stableScrollPasses = 0;
let previousStableIds = null;
let finalPageState = null;
const normalize = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
const summarizeTextDiff = (expected, editor) => {
  const left = [...expected];
  const right = [...editor];
  let commonPrefix = 0;
  while (commonPrefix < Math.min(left.length, right.length) && left[commonPrefix] === right[commonPrefix]) commonPrefix += 1;
  let commonSuffix = 0;
  while (commonSuffix < Math.min(left.length - commonPrefix, right.length - commonPrefix) &&
      left[left.length - 1 - commonSuffix] === right[right.length - 1 - commonSuffix]) commonSuffix += 1;
  const expectedMiddle = left.slice(commonPrefix, left.length - commonSuffix).join('');
  const editorMiddle = right.slice(commonPrefix, right.length - commonSuffix).join('');
  const countKinds = (text) => {
    const counts = { whitespace: 0, zeroWidth: 0, han: 0, latinOrDigit: 0, other: 0 };
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 32 || codePoint === 160 || codePoint === 0x2028 || codePoint === 0x2029) counts.whitespace += 1;
      else if (codePoint >= 0x200b && codePoint <= 0x200d || codePoint === 0xfeff) counts.zeroWidth += 1;
      else if (codePoint >= 0x3400 && codePoint <= 0x9fff) counts.han += 1;
      else if (codePoint >= 48 && codePoint <= 57 || codePoint >= 65 && codePoint <= 90 || codePoint >= 97 && codePoint <= 122) counts.latinOrDigit += 1;
      else counts.other += 1;
    }
    return counts;
  };
  return {
    commonPrefix, commonSuffix,
    expectedMiddleLength: expectedMiddle.length, editorMiddleLength: editorMiddle.length,
    expectedMiddleKinds: countKinds(expectedMiddle), editorMiddleKinds: countKinds(editorMiddle),
    editorMiddleHasUrl: editorMiddle.includes('http://') || editorMiddle.includes('https://'),
    editorMiddleHasMarkdownLink: editorMiddle.includes(']('),
    editorMiddleHasHtmlTag: editorMiddle.includes('<'),
  };
};
const assertTaskSpaceControl = () => { if (taskLeaseFailed) throw new Error('user-control'); };
const readLibraryCount = () => {
  const label = [...document.querySelectorAll('.type.typography-foot-note')].find((item) => (item.innerText || '').trim() === '笔记');
  const match = label?.parentElement?.innerText?.match(/^\\s*([\\d,，]+)\\s*\\n\\s*笔记\\s*$/);
  return match ? Number(match[1].replace(/[,，]/g, '')) : null;
};
const emptyLibraryVisible = () => [...document.querySelectorAll('p,span,div')]
  .some((item) => item.children.length === 0 && /^(暂无笔记|还没有笔记|没有笔记)$/.test((item.innerText || '').trim()));
const nonEditorCards = () => [...document.querySelectorAll('div.memo')]
  .filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
const linkData = (card) => {
  const time = card.querySelector('a.time[href*="memo_id="]');
  if (!time) return { id: null, timeText: null, url: null };
  let parsed;
  try { parsed = new URL(time.href); } catch { return { id: null, timeText: null, url: null }; }
  const id = parsed.searchParams.get('memo_id');
  const validUrl = parsed.protocol === 'https:' && parsed.hostname === 'v.flomoapp.com' &&
    parsed.pathname.replace(/\\/$/, '') === '/mine' && id;
  return {
    id: validUrl ? id : null,
    timeText: (time.querySelector(':scope > .text')?.innerText || time.innerText || '').trim() || null,
    url: validUrl ? 'https://v.flomoapp.com/mine/?memo_id=' + encodeURIComponent(id) : null,
  };
};
const parseTime = (text) => {
  const match = String(text || '').trim().replace(/^置顶[・·]\\s*/, '').match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59) return null;
  return Date.UTC(y, m - 1, d, h - 8, min);
};
const atBottom = (list) => Boolean(list && list.scrollTop + list.clientHeight >= list.scrollHeight - 8);
const hasMoreControl = () => [...document.querySelectorAll('button,a')]
  .some((item) => item.offsetParent !== null && /加载更多|下一页/.test((item.innerText || '').trim()));
const state = async () => {
  assertTaskSpaceControl();
  const prepared = await page.evaluate((key) => {
    const nonEditorCards = () => [...document.querySelectorAll('div.memo')]
      .filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
    const linkData = (card) => {
      const time = card.querySelector('a.time[href*="memo_id="]');
      if (!time) return { id: null, timeText: null, url: null };
      let parsed;
      try { parsed = new URL(time.href); } catch { return { id: null, timeText: null, url: null }; }
      const id = parsed.searchParams.get('memo_id');
      const validUrl = parsed.protocol === 'https:' && parsed.hostname === 'v.flomoapp.com' && (parsed.pathname === '/mine' || parsed.pathname === '/mine/') && id;
      return { id: validUrl ? id : null, timeText: (time.querySelector(':scope > .text')?.innerText || time.innerText || '').trim() || null,
        url: validUrl ? 'https://v.flomoapp.com/mine/?memo_id=' + encodeURIComponent(id) : null };
    };
    const list = document.querySelector('.memos');
    const cards = nonEditorCards();
    const store = window[key] || (window[key] = new Map());
    const pending = [];
    let missingIds = 0;
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const link = linkData(card);
      if (!link.id || !link.url || !link.timeText) { missingIds += 1; continue; }
      const body = card.querySelector('.richText, .content.copy-allowed, .content');
      const show = card.querySelector('.showBtn');
      const bounds = card.getBoundingClientRect();
      const listBounds = list?.getBoundingClientRect();
      const inView = Boolean(listBounds && bounds.bottom >= listBounds.top && bounds.top <= listBounds.bottom);
      const folded = Boolean(body && (body.classList.contains('is-fold') || (show && /^(展开|显示全文)$/.test((show.innerText || '').trim()))));
      const needsLayout = Boolean(body && body.clientHeight + 2 < body.scrollHeight);
      const shouldRead = !store.has(link.id) || inView || folded || needsLayout;
      if (body && shouldRead) {
        if (folded && show) show.click();
        if (folded || body.clientHeight + 2 < body.scrollHeight) pending.push(index);
      }
    }
    return { listFound: Boolean(list), missingIds, pending };
  }, scanKey);
  if (!prepared.listFound) throw new Error('list-unavailable');
  if (prepared.missingIds) throw new Error('memo-id-missing');
  if (prepared.pending.length) {
    await page.waitForFunction((indices) => {
      const nonEditorCards = () => [...document.querySelectorAll('div.memo')]
        .filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
      const cards = nonEditorCards();
      return indices.every((index) => {
        const card = cards[index];
        const body = card?.querySelector('.richText, .content.copy-allowed, .content');
        const show = card?.querySelector('.showBtn');
        return Boolean(body && !body.classList.contains('is-fold') &&
          !(show && /^(展开|显示全文)$/.test((show.innerText || '').trim())) &&
          body.clientHeight + 2 >= body.scrollHeight);
      });
    }, prepared.pending, { timeout: 30000 });
  }
  return page.evaluate((key) => {
    const normalize = (value) => String(value || '').replaceAll(String.fromCharCode(13), '').split(String.fromCharCode(10)).map((line) => line.trimEnd()).join(String.fromCharCode(10)).trim();
    const loadingNodes = () => [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
      .filter((item) => item.offsetParent !== null && (["loading", "加载中", "正在加载"].includes((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
    const readLibraryCount = () => {
      const label = [...document.querySelectorAll('.type.typography-foot-note')].find((item) => (item.innerText || '').trim() === '笔记');
      const lines = label?.parentElement?.innerText?.split(String.fromCharCode(10)) || [];
      const count = Number((lines[0] || '').replaceAll(',', '').replaceAll('，', '').trim());
      return lines[1]?.trim() === '笔记' && Number.isInteger(count) ? count : null;
    };
    const emptyLibraryVisible = () => [...document.querySelectorAll('p,span,div')]
      .some((item) => item.children.length === 0 && ["暂无笔记", "还没有笔记", "没有笔记"].includes((item.innerText || '').trim()));
    const nonEditorCards = () => [...document.querySelectorAll('div.memo')]
      .filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
    const linkData = (card) => {
      const time = card.querySelector('a.time[href*="memo_id="]');
      if (!time) return { id: null, timeText: null, url: null };
      let parsed;
      try { parsed = new URL(time.href); } catch { return { id: null, timeText: null, url: null }; }
      const id = parsed.searchParams.get('memo_id');
      const validUrl = parsed.protocol === 'https:' && parsed.hostname === 'v.flomoapp.com' && (parsed.pathname === '/mine' || parsed.pathname === '/mine/') && id;
      return { id: validUrl ? id : null, timeText: (time.querySelector(':scope > .text')?.innerText || time.innerText || '').trim() || null,
        url: validUrl ? 'https://v.flomoapp.com/mine/?memo_id=' + encodeURIComponent(id) : null };
    };
    const parseTime = (text) => {
      const parts = String(text || '').trim().replace('置顶・', '').replace('置顶·', '').replaceAll('-', ' ').replaceAll(':', ' ').split(' ').filter(Boolean).map(Number);
      if (parts.length !== 5 || !parts.every(Number.isInteger)) return null;
      const [y, m, d, h, min] = parts;
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59) return null;
      return Date.UTC(y, m - 1, d, h - 8, min);
    };
    const atBottom = (list) => Boolean(list && list.scrollTop + list.clientHeight >= list.scrollHeight - 8);
    const hasMoreControl = () => [...document.querySelectorAll('button,a')]
      .some((item) => item.offsetParent !== null && /加载更多|下一页/.test((item.innerText || '').trim()));
    const list = document.querySelector('.memos');
    const cards = nonEditorCards();
    const activeLoaders = loadingNodes();
    const lastCard = cards.at(-1);
    const loadingAtListTail = activeLoaders.length > 0 && activeLoaders.every((item) =>
      Boolean(list?.contains(item) && (!lastCard || (lastCard.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING))));
    const store = window[key] || (window[key] = new Map());
    const newRecords = [];
    const pinnedUpdates = [];
    const conflicts = [];
    let missingIds = 0;
    let incompleteBodies = 0;
    for (const card of cards) {
      const link = linkData(card);
      if (!link.id || !link.url || !link.timeText) { missingIds += 1; continue; }
      const timeMs = parseTime(link.timeText);
      const body = card.querySelector('.richText, .content.copy-allowed, .content');
      const isPinned = /^置顶[・·]/.test(link.timeText);
      const bodyCopy = body?.cloneNode(true);
      for (const inlineLink of bodyCopy?.querySelectorAll('a[href]') || []) {
        const href = inlineLink.href;
        if (href) inlineLink.replaceWith(document.createTextNode(href));
      }
      const bodyText = normalize(bodyCopy?.innerText || '');
      const bodySourceText = normalize(bodyCopy?.textContent || '');
      const tags = [...(bodyCopy?.querySelectorAll('.tag') || [])]
        .map((tag) => (tag.innerText || tag.textContent || '').trim().replace(/^#+/u, '').toLowerCase())
        .filter(Boolean);
      const bodyComplete = Boolean(body && bodyText && bodySourceText && !body.classList.contains('is-fold') &&
        body.clientHeight + 2 >= body.scrollHeight &&
        ![...card.querySelectorAll('.showBtn')].some((button) => /^(展开|显示全文)$/.test((button.innerText || '').trim())));
      if (!bodyComplete || timeMs == null) { incompleteBodies += 1; continue; }
      const record = { memoId: link.id, url: link.url, timeText: link.timeText,
        createdAt: new Date(timeMs).toISOString(), timeMs, bodyText, bodySourceText, tags, bodyComplete: true, isPinned };
      if (!store.has(link.id)) {
        store.set(link.id, { ...record });
        newRecords.push(record);
      } else {
        const old = store.get(link.id);
        if (old.createdAt !== record.createdAt || old.bodyText !== record.bodyText || old.bodySourceText !== record.bodySourceText ||
            JSON.stringify(old.tags || []) !== JSON.stringify(record.tags) || old.url !== record.url) {
          conflicts.push(link.id);
        } else if (record.isPinned && !old.isPinned) {
          old.isPinned = true;
          pinnedUpdates.push(link.id);
        }
      }
    }
    const count = readLibraryCount();
    return {
      listFound: Boolean(list), libraryCount: count, records: newRecords, pinnedUpdates, conflicts,
      missingIdCount: missingIds, incompleteBodyCount: incompleteBodies, observedUniqueIds: store.size,
      loadedCardCount: cards.length, observedCards: cards.length,
      hasMore: hasMoreControl(), loading: activeLoaders.length > 0, loadingAtListTail, atBottom: atBottom(list),
      scrollTop: list?.scrollTop || 0, scrollHeight: list?.scrollHeight || 0,
      emptyLibraryVisible: emptyLibraryVisible(),
    };
  }, scanKey);
};
const waitForStableList = async () => {
  let previousSignature = null;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const signature = await page.evaluate(() => {
      const list = document.querySelector('.memos');
      const cards = [...document.querySelectorAll('div.memo')].filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
      const loadingCount = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
        .filter((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true')).length;
      let idHash = 2166136261;
      for (const card of cards) {
        const href = card.querySelector('a.time[href*="memo_id="]')?.href || '';
        let id = '';
        try { id = new URL(href).searchParams.get('memo_id') || ''; } catch {}
        for (let index = 0; index < id.length; index += 1) idHash = Math.imul(idHash ^ id.charCodeAt(index), 16777619);
        idHash = Math.imul(idHash, 16777619);
      }
      return String(cards.length) + ':' + String(list?.scrollHeight || 0) + ':' + String(loadingCount) + ':' + String(idHash >>> 0);
    });
    if (signature === previousSignature) stablePasses += 1;
    else { previousSignature = signature; stablePasses = 0; }
    if (stablePasses >= 2) return;
    await page.waitForTimeout(250);
  }
  throw new Error('pagination-incomplete');
};
try {
  stage = resumeTaskSpace ? 'taskspace-resume-preflight' : 'taskspace-acquire';
  if (resumeTaskSpace) {
    const spaces = await listTaskSpaces();
    const existing = spaces.find((space) => Number(space.id) === Number(taskRef));
    if (!existing || existing.name !== expectedTaskSpaceName) throw new Error('taskspace-binding-mismatch');
    task = await claimTaskSpace(Number(taskRef));
  } else task = await taskSpace(taskRef);
  taskSpaceIdentity = Number.isSafeInteger(task.spaceId) ? task.spaceId : Number(task.id);
  stage = 'taskspace-ownership';
  if (task.ownership !== 'agent') throw new Error('user-control');
  stage = 'taskspace-binding';
  if (typeof task.name !== 'string' || task.name !== expectedTaskSpaceName ||
      resumeTaskSpace && taskSpaceIdentity !== Number(taskRef)) throw new Error('taskspace-binding-mismatch');
  taskSpaceBound = true;
  if (resumeTaskSpace) {
    taskLease = await import('file:///Users/yuwei/.codex/skills/ego-browser/scripts/ego-task-space-watchdog.mjs');
    const leaseId = taskSpaceIdentity;
    if (!Number.isSafeInteger(leaseId) || leaseId !== Number(taskRef)) throw new Error('taskspace-binding-mismatch');
    await taskLease.register({ id: leaseId, name: task.name, caller: 'codex-agent', skill: 'ego-browser', repo: 'learn-x' });
    taskLeaseHeartbeat = setInterval(() => taskLease.heartbeat(leaseId).catch(() => { taskLeaseFailed = true; }), 15000);
    taskLeaseHeartbeat.unref?.();
    const tabs = await listTabs();
    const flomoTab = tabs.find((tab) => { try { return new URL(tab.url).hostname.endsWith('flomoapp.com'); } catch { return false; } });
    if (!flomoTab) throw new Error('taskspace-binding-mismatch');
    await switchTab(flomoTab.targetId);
  }
  assertTaskSpaceControl();
  page = task.page('p1');
  stage = 'navigate-library';
  await page.goto('https://v.flomoapp.com/mine');
  stage = 'wait-library-dom';
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  stage = 'wait-initial-library';
  await page.waitForFunction(() => {
    const list = document.querySelector('.memos');
    const label = [...document.querySelectorAll('.type.typography-foot-note')].find((item) => (item.innerText || '').trim() === '笔记');
    const match = label?.parentElement?.innerText?.match(/^\\s*([\\d,，]+)\\s*\\n\\s*笔记\\s*$/);
    const count = match ? Number(match[1].replace(/[,，]/g, '')) : null;
    const cards = [...document.querySelectorAll('div.memo')].filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
    const empty = [...document.querySelectorAll('p,span,div')].some((item) => item.children.length === 0 && /^(暂无笔记|还没有笔记|没有笔记)$/.test((item.innerText || '').trim()));
    const loading = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
      .filter((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
    const lastCard = cards.at(-1);
    const loadingAtListTail = loading.length > 0 && loading.every((item) =>
      Boolean(list?.contains(item) && (!lastCard || (lastCard.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING))));
    const listReady = count > 0 ? cards.length > 0 && (!loading.length || loadingAtListTail) : empty && loading.length === 0;
    return Boolean(list && count !== null && listReady);
  }, undefined, { timeout: 60000 });
  stage = 'wait-initial-stability';
  await waitForStableList();
  stage = 'scan-library';
  let priorSeenCount = 0;
  let failedIdlePasses = 0;
  let lastScrollHeight = -1;
  for (let step = 0; step < maxSteps; step += 1) {
    scanStep = step;
    stage = 'read-page-state';
    if (task.ownership !== 'agent') throw new Error('user-control');
    const current = await state();
    if (!current.listFound) throw new Error('list-unavailable');
    if (!Number.isInteger(current.libraryCount) || current.libraryCount < 0) throw new Error('library-count-unavailable');
    if (current.libraryCount > 20000 || current.observedUniqueIds > 20000 || current.loadedCardCount > 20000) throw new Error('scan-capacity-exceeded');
    if (initialCount === null) initialCount = current.libraryCount;
    if (current.libraryCount !== initialCount) throw new Error('library-count-changed');
    if (current.missingIdCount) throw new Error('memo-id-missing');
    if (current.incompleteBodyCount) throw new Error('body-incomplete');
    if (current.conflicts.length) throw new Error('scan-record-conflict');
    for (const record of current.records) {
      if (seen.has(record.memoId)) {
        const old = seen.get(record.memoId);
        if (old.createdAt !== record.createdAt || old.bodyText !== record.bodyText || old.bodySourceText !== record.bodySourceText || old.url !== record.url) throw new Error('scan-record-conflict');
        old.isPinned ||= record.isPinned;
      } else seen.set(record.memoId, record);
    }
    for (const id of current.pinnedUpdates) if (seen.has(id)) seen.get(id).isPinned = true;
    if (seen.size !== current.observedUniqueIds) throw new Error('scan-record-conflict');
    observedCards = Math.max(observedCards, current.observedCards);
    if (seen.size > initialCount) throw new Error('library-count-mismatch');
    if (seen.size > priorSeenCount) {
      if (priorSeenCount > 0) pageCount += 1;
      priorSeenCount = seen.size;
      failedIdlePasses = 0;
      stableScrollPasses = 0;
      previousStableIds = null;
    }
    if (current.loading && !(current.loadingAtListTail && !current.atBottom)) {
      stage = 'wait-loading';
      await page.waitForFunction(() => {
        const loading = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')];
        return !loading.some((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
      }, undefined, { timeout: 30000 });
      continue;
    }
    if (current.hasMore) {
      stage = 'click-pagination';
      const clicked = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button,a')].find((item) => item.offsetParent !== null && /加载更多|下一页/.test((item.innerText || '').trim()));
        if (!button) return false;
        button.click();
        return true;
      });
      if (!clicked) throw new Error('pagination-control-missing');
      stage = 'wait-pagination';
      await page.waitForFunction((previous) => {
        const isLoading = () => [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
          .some((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
        const list = document.querySelector('.memos');
        const cards = [...document.querySelectorAll('div.memo')].filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
        return isLoading() || cards.length !== previous.cardCount || list?.scrollHeight !== previous.scrollHeight;
      }, { cardCount: current.loadedCardCount, scrollHeight: current.scrollHeight }, { timeout: 30000 });
      pageCount += 1;
      continue;
    }
    const before = { cardCount: current.loadedCardCount, scrollHeight: current.scrollHeight, loading: current.loading };
    stage = 'scroll-bottom';
    await page.evaluate(() => {
      const list = document.querySelector('.memos');
      if (list) { list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll', { bubbles: true })); }
    });
    try {
      stage = 'wait-scroll-progress';
      await page.waitForFunction((previous) => {
        const loading = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
          .some((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
        const list = document.querySelector('.memos');
        const cards = [...document.querySelectorAll('div.memo')].filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]'));
        return loading !== previous.loading || cards.length !== previous.cardCount || list?.scrollHeight !== previous.scrollHeight;
      }, before, { timeout: 30000 });
      stage = 'wait-page-stability';
      await waitForStableList();
    } catch (error) {
      if (!/timeout|timed out/i.test(String(error?.message || error))) throw error;
      if (before.loading) throw new Error('network-timeout');
    }
    stage = 'read-after-scroll';
    const after = await state();
    if (after.libraryCount !== initialCount) throw new Error('library-count-changed');
    if (after.missingIdCount) throw new Error('memo-id-missing');
    if (after.incompleteBodyCount) throw new Error('body-incomplete');
    if (after.conflicts.length) throw new Error('scan-record-conflict');
    for (const record of after.records) {
      if (seen.has(record.memoId)) {
        const old = seen.get(record.memoId);
        if (old.createdAt !== record.createdAt || old.bodyText !== record.bodyText || old.bodySourceText !== record.bodySourceText || old.url !== record.url) throw new Error('scan-record-conflict');
        old.isPinned ||= record.isPinned;
      } else seen.set(record.memoId, record);
    }
    for (const id of after.pinnedUpdates) if (seen.has(id)) seen.get(id).isPinned = true;
    if (seen.size > initialCount || seen.size !== after.observedUniqueIds) throw new Error('library-count-mismatch');
    if (after.loading && !(after.loadingAtListTail && !after.atBottom)) {
      await page.waitForFunction(() => {
        const loading = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')];
        return !loading.some((item) => item.offsetParent !== null && (/^(loading|加载中|正在加载)$/.test((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
      }, undefined, { timeout: 30000 });
      stableScrollPasses = 0;
      failedIdlePasses = 0;
      continue;
    }
    if (after.hasMore) { stableScrollPasses = 0; failedIdlePasses = 0; continue; }
    const missingCount = initialCount - seen.size;
    if (missingCount >= 0 && missingCount <= maxAcceptedMissingRecords && after.atBottom) {
      const signature = [...seen.keys()].sort().join('\\u0000');
      stableScrollPasses = signature === previousStableIds ? stableScrollPasses + 1 : 1;
      previousStableIds = signature;
      failedIdlePasses = 0;
      lastScrollHeight = after.scrollHeight;
      finalPageState = after;
      if (stableScrollPasses >= 2) { complete = true; break; }
    } else {
      stableScrollPasses = 0;
      failedIdlePasses += 1;
      if (failedIdlePasses >= 3 && after.atBottom && missingCount > maxAcceptedMissingRecords) throw new Error('library-count-gap-exceeds-tolerance');
      if (after.scrollHeight === lastScrollHeight && failedIdlePasses >= 3) throw new Error('pagination-incomplete');
    }
  }
  if (!complete) throw new Error('pagination-incomplete');
  stage = 'export-records';
  const browserRecords = await page.evaluate((key) => {
    const values = [...(window[key] || new Map()).values()].map(({ bodySourceText, ...record }) => ({ ...record }));
    delete window[key];
    return values;
  }, scanKey);
  if (browserRecords.length !== seen.size || initialCount - browserRecords.length < 0 ||
      initialCount - browserRecords.length > maxAcceptedMissingRecords || !finalPageState?.atBottom) {
    throw new Error('library-count-gap-exceeds-tolerance');
  }
  let detailVerification = null;
  if (verifyDetail && seen.size) {
    const longest = [...seen.values()].sort((a, b) => normalize(b.bodyText).length - normalize(a.bodyText).length || a.memoId.localeCompare(b.memoId))[0];
    const expectedBodySource = normalize(longest.bodySourceText);
    const expectedVisibleBody = normalize(longest.bodyText);
    detailTargetId = longest.memoId;
    stage = 'click-longest-note';
    const detailTarget = await page.evaluate((id) => {
      const links = [...document.querySelectorAll('.memos div.memo a.time[href*="memo_id="]')].filter((link) => {
        try { return new URL(link.href).searchParams.get('memo_id') === id; } catch { return false; }
      });
      const link = links[0];
      const existingSheet = document.querySelector('.memo-detail-sheet');
      const existingRect = existingSheet?.getBoundingClientRect();
      const existingSheetVisible = Boolean(existingRect && existingRect.width > 0 && existingRect.height > 0 && window.getComputedStyle(existingSheet).display !== 'none');
      // Flomo keeps the memo list in its own scroll container; Ego's click auto-scroll did not move it.
      link?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = link?.getBoundingClientRect();
      return {
        count: links.length,
        existingSheetVisible,
        href: link?.getAttribute('href') || null,
        visible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight),
      };
    }, longest.memoId);
    if (!detailTarget?.count) throw new Error('detail-link-unresolved');
    if (detailTarget.existingSheetVisible || !detailTarget.href || !detailTarget.visible) throw new Error('detail-link-unresolved');
    // Duplicate list cards for the same memo share the same ID and source URL; nth=0 picks one exact-ID link.
    const detailLinkSelector = '.memos div.memo a.time[href=' + JSON.stringify(detailTarget.href) + '] >> nth=0';
    await page.click(detailLinkSelector, { label: 'open longest original link' });
    stage = 'wait-longest-note';
    await page.waitForFunction(({ id, expectedBodySource }) => {
      const sheet = document.querySelector('.memo-detail-sheet');
      const rect = sheet?.getBoundingClientRect();
      const visible = Boolean(rect && rect.width > 0 && rect.height > 0 && window.getComputedStyle(sheet).display !== 'none');
      if (!visible) return false;
      const originalLinks = [...sheet.querySelectorAll('a.time[href*="memo_id="]')].filter((link) => {
        try { return new URL(link.href).searchParams.get('memo_id') === id; } catch { return false; }
      });
      const routeMatches = new URL(location.href).searchParams.get('memo_id') === id;
      const routeConflicts = new URL(location.href).searchParams.has('memo_id') && !routeMatches;
      const normalizeDetail = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const bodySource = (body) => {
        const copy = body.cloneNode(true);
        for (const link of copy.querySelectorAll('a[href]')) if (link.href) link.replaceWith(document.createTextNode(link.href));
        return normalizeDetail(copy.textContent);
      };
      const primaryRoots = [...sheet.querySelectorAll('div.normal:not(.memo-card)')];
      const roots = [...new Set(originalLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
      const bodyRoots = roots.filter((root) => [...root.querySelectorAll('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content')]
        .some((body) => bodySource(body) === expectedBodySource));
      const card = primaryRoots.length === 1 ? primaryRoots[0]
        : bodyRoots.length === 1 ? bodyRoots[0]
          : (!bodyRoots.length && roots.length === 1 ? roots[0] : (!originalLinks.length && routeMatches ? sheet : null));
      if (routeConflicts || !card) return false;
      return [...card.querySelectorAll('.richText, .content.copy-allowed, .content')]
        .some((body) => (body.innerText || body.textContent || '').trim().length > 0);
    }, { id: longest.memoId, expectedBodySource }, { timeout: 60000 });
    stage = 'open-longest-editor';
    // The list renderer and detail card can truncate the same tail; compare against Flomo's full editor.
    const editorState = ({ id, expectedBodySource }) => page.evaluate(({ memoId, expectedBodySource }) => {
      const sheet = document.querySelector('.memo-detail-sheet');
      const originalLinks = [...(sheet?.querySelectorAll('a.time[href*="memo_id="]') || [])].filter((item) => {
        try { return new URL(item.href).searchParams.get('memo_id') === memoId; } catch { return false; }
      });
      const routeMatches = sheet && new URL(location.href).searchParams.get('memo_id') === memoId;
      const routeConflicts = sheet && new URL(location.href).searchParams.has('memo_id') && !routeMatches;
      const normalizeDetail = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const bodySource = (body) => {
        const copy = body.cloneNode(true);
        for (const link of copy.querySelectorAll('a[href]')) if (link.href) link.replaceWith(document.createTextNode(link.href));
        return normalizeDetail(copy.textContent);
      };
      const primaryRoots = [...(sheet?.querySelectorAll('div.normal:not(.memo-card)') || [])];
      const roots = [...new Set(originalLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
      const matchingRoots = roots.filter((root) => {
        const bodies = [...root.querySelectorAll('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content')];
        const editor = root.querySelector('div.tiptap.ProseMirror');
        return bodies.some((body) => bodySource(body) === expectedBodySource) || normalizeDetail(editor?.textContent) === expectedBodySource;
      });
      const card = primaryRoots.length === 1 ? primaryRoots[0]
        : matchingRoots.length === 1 ? matchingRoots[0]
          : (!matchingRoots.length && roots.length === 1 ? roots[0] : (!originalLinks.length && routeMatches ? sheet : null));
      if (routeConflicts || (!primaryRoots.length && !originalLinks.length && !routeMatches) || !card) return { found: false, editorReady: false, editorText: null, point: null, cancelAvailable: false };
      const editor = card.querySelector('div.tiptap.ProseMirror');
      const body = card.querySelector('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content');
      const target = [...(body?.querySelectorAll('p, li, blockquote') || [])].find((item) => (item.innerText || item.textContent || '').trim()) || body || card.querySelector('.mainContent');
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = target?.getBoundingClientRect();
      return {
        found: true,
        editorReady: Boolean(editor),
        editorText: editor?.innerText ?? null,
        editorTextContent: editor?.textContent ?? null,
        point: rect && rect.width > 0 && rect.height > 0 ? [rect.left + rect.width / 2, rect.top + rect.height / 2] : null,
        cancelAvailable: Boolean(card.querySelector('button.cancel-btn')),
      };
    }, { memoId: id, expectedBodySource });
    const waitForEditor = () => page.waitForFunction(({ id, expectedBodySource }) => {
      const sheet = document.querySelector('.memo-detail-sheet');
      const originalLinks = [...(sheet?.querySelectorAll('a.time[href*="memo_id="]') || [])].filter((item) => {
        try { return new URL(item.href).searchParams.get('memo_id') === id; } catch { return false; }
      });
      const routeMatches = sheet && new URL(location.href).searchParams.get('memo_id') === id;
      const routeConflicts = sheet && new URL(location.href).searchParams.has('memo_id') && !routeMatches;
      const normalizeDetail = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const bodySource = (body) => {
        const copy = body.cloneNode(true);
        for (const link of copy.querySelectorAll('a[href]')) if (link.href) link.replaceWith(document.createTextNode(link.href));
        return normalizeDetail(copy.textContent);
      };
      const primaryRoots = [...(sheet?.querySelectorAll('div.normal:not(.memo-card)') || [])];
      const roots = [...new Set(originalLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
      const matchingRoots = roots.filter((root) => {
        const bodies = [...root.querySelectorAll('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content')];
        const editor = root.querySelector('div.tiptap.ProseMirror');
        return bodies.some((body) => bodySource(body) === expectedBodySource) || normalizeDetail(editor?.textContent) === expectedBodySource;
      });
      const card = primaryRoots.length === 1 ? primaryRoots[0]
        : matchingRoots.length === 1 ? matchingRoots[0]
          : (!matchingRoots.length && roots.length === 1 ? roots[0] : (!originalLinks.length && routeMatches ? sheet : null));
      return Boolean(!routeConflicts && (primaryRoots.length === 1 || originalLinks.length || routeMatches) && card?.querySelector('div.tiptap.ProseMirror'));
    }, { id: longest.memoId, expectedBodySource }, { timeout: 5000 });
    let detail = await editorState({ id: longest.memoId, expectedBodySource });
    if (!detail.found) throw new Error('detail-link-unresolved');
    if (!detail.editorReady) {
      if (!detail.point) throw new Error('detail-editor-target-unavailable');
      await doubleClick(detail.point);
      try { await waitForEditor(); } catch {
        detail = await editorState({ id: longest.memoId, expectedBodySource });
        if (!detail.editorReady) {
          const fallbackPoint = detail.point;
          if (!fallbackPoint) throw new Error('detail-editor-target-unavailable');
          await doubleClick(fallbackPoint);
          try { await waitForEditor(); } catch { throw new Error('detail-editor-unavailable'); }
        }
      }
    }
    stage = 'read-longest-editor';
    detail = await editorState({ id: longest.memoId, expectedBodySource });
    if (!detail.editorReady || typeof detail.editorText !== 'string') throw new Error('detail-editor-unavailable');
    const reloadOriginalPage = async () => {
      await page.goto(longest.url);
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    };
    if (!detail.cancelAvailable) {
      await reloadOriginalPage();
      throw new Error('detail-editor-cancel-unavailable');
    }
    const detailText = normalize(detail.editorText);
    const editorTextContent = normalize(detail.editorTextContent);
    const comparableVisible = (value) => normalize(value).replace(/\\s+/g, '');
    const textMatches = comparableVisible(detailText) === comparableVisible(expectedVisibleBody) && editorTextContent === expectedBodySource;
    if (!textMatches) detailMismatch = {
      expectedLength: expectedVisibleBody.length,
      editorInnerLength: detailText.length,
      editorTextContentLength: editorTextContent.length,
      innerText: summarizeTextDiff(expectedVisibleBody, detailText),
      textContent: summarizeTextDiff(expectedBodySource, editorTextContent),
    };
    stage = 'cancel-longest-editor';
    const canceled = await page.evaluate(({ id, expectedBodySource }) => {
      const sheet = document.querySelector('.memo-detail-sheet');
      const originalLinks = [...(sheet?.querySelectorAll('a.time[href*="memo_id="]') || [])].filter((item) => {
        try { return new URL(item.href).searchParams.get('memo_id') === id; } catch { return false; }
      });
      const routeMatches = sheet && new URL(location.href).searchParams.get('memo_id') === id;
      const routeConflicts = sheet && new URL(location.href).searchParams.has('memo_id') && !routeMatches;
      const normalizeDetail = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const bodySource = (body) => {
        const copy = body.cloneNode(true);
        for (const link of copy.querySelectorAll('a[href]')) if (link.href) link.replaceWith(document.createTextNode(link.href));
        return normalizeDetail(copy.textContent);
      };
      const primaryRoots = [...(sheet?.querySelectorAll('div.normal:not(.memo-card)') || [])];
      const roots = [...new Set(originalLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
      const matchingRoots = roots.filter((root) => {
        const bodies = [...root.querySelectorAll('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content')];
        const editor = root.querySelector('div.tiptap.ProseMirror');
        return bodies.some((body) => bodySource(body) === expectedBodySource) || normalizeDetail(editor?.textContent) === expectedBodySource;
      });
      const card = primaryRoots.length === 1 ? primaryRoots[0]
        : matchingRoots.length === 1 ? matchingRoots[0]
          : (!matchingRoots.length && roots.length === 1 ? roots[0] : (!originalLinks.length && routeMatches ? sheet : null));
      const button = routeConflicts ? null : card?.querySelector('button.cancel-btn');
      if (!button) return false;
      button.click();
      return true;
    }, { id: longest.memoId, expectedBodySource });
    if (!canceled) {
      await reloadOriginalPage();
      throw new Error('detail-editor-cancel-unavailable');
    }
    await page.waitForFunction(({ id, expectedBodySource }) => {
      const sheet = document.querySelector('.memo-detail-sheet');
      const originalLinks = [...(sheet?.querySelectorAll('a.time[href*="memo_id="]') || [])].filter((item) => {
        try { return new URL(item.href).searchParams.get('memo_id') === id; } catch { return false; }
      });
      const routeMatches = sheet && new URL(location.href).searchParams.get('memo_id') === id;
      const routeConflicts = sheet && new URL(location.href).searchParams.has('memo_id') && !routeMatches;
      const normalizeDetail = (value) => String(value || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const bodySource = (body) => {
        const copy = body.cloneNode(true);
        for (const link of copy.querySelectorAll('a[href]')) if (link.href) link.replaceWith(document.createTextNode(link.href));
        return normalizeDetail(copy.textContent);
      };
      const primaryRoots = [...(sheet?.querySelectorAll('div.normal:not(.memo-card)') || [])];
      const roots = [...new Set(originalLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
      const matchingRoots = roots.filter((root) => [...root.querySelectorAll('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content')]
        .some((body) => bodySource(body) === expectedBodySource));
      const card = primaryRoots.length === 1 ? primaryRoots[0]
        : matchingRoots.length === 1 ? matchingRoots[0]
          : (!matchingRoots.length && roots.length === 1 ? roots[0] : (!originalLinks.length && routeMatches ? sheet : null));
      return Boolean(!routeConflicts && (primaryRoots.length === 1 || originalLinks.length || routeMatches) && card && !card.querySelector('div.tiptap.ProseMirror'));
    }, { id: longest.memoId, expectedBodySource }, { timeout: 10000 });
    if (!textMatches) throw new Error('detail-body-mismatch');
    detailVerification = { verified: true, memoId: longest.memoId, bodyLength: expectedVisibleBody.length,
      bodyHash: createHash('sha256').update(expectedVisibleBody, 'utf8').digest('hex'), method: 'original-link-detail-sheet-tiptap-prosemirror' };
  }
  const missingCount = initialCount - browserRecords.length;
  const result = {
    ok: true, mode: 'full', complete: true, libraryCount: initialCount, scanned: browserRecords.length,
    taskSpaceId: keepTaskSpace ? taskSpaceIdentity : null,
    taskSpaceName: keepTaskSpace ? task.name : null,
    observedCards, pageCount: Math.max(1, pageCount), scanStartedAt, scanFinishedAt: new Date().toISOString(),
    records: browserRecords.sort((a, b) => a.timeMs - b.timeMs || a.memoId.localeCompare(b.memoId)),
    termination: { reason: missingCount === 0 ? 'library-count-and-stable-ids' : 'stable-bottom-with-accepted-count-gap',
      enumerationComplete: true, expectedCount: initialCount, observedUniqueIds: browserRecords.length, missingCount,
      stableScrollPasses, atBottom: finalPageState.atBottom, hasMore: finalPageState.hasMore, loading: finalPageState.loading,
      finalScrollHeight: lastScrollHeight },
    detailVerification,
  };
  if (!keepTaskSpace) {
    stage = 'cleanup-taskspace-success';
    await task.finish({ keep: [] });
    task = null;
  }
  if (taskLeaseHeartbeat) clearInterval(taskLeaseHeartbeat);
  stage = 'write-scan-result';
  await fs.writeFile(resultPath, JSON.stringify(result), { mode: '600' });
  cliLog(JSON.stringify({ ok: true, complete: true, scanned: result.scanned, expectedCount: result.libraryCount,
    omittedCount: missingCount, pageCount: result.pageCount,
    pinnedCount: browserRecords.filter((record) => record.isPinned).length, detailVerified: detailVerification?.verified === true }));
} catch (error) {
  if (taskLeaseHeartbeat) clearInterval(taskLeaseHeartbeat);
  const failureStage = stage;
  const value = (String(error?.message || '') + ' ' + String(error?.code || '')).toLowerCase();
  const known = new Set(['user-control', 'list-unavailable', 'library-count-unavailable', 'library-count-changed',
    'library-count-mismatch', 'library-count-gap-exceeds-tolerance', 'memo-id-missing', 'body-incomplete', 'scan-record-conflict', 'scan-capacity-exceeded',
    'pagination-control-missing', 'pagination-incomplete', 'detail-link-unresolved', 'detail-body-mismatch',
    'detail-editor-unavailable', 'detail-editor-target-unavailable', 'detail-editor-cancel-unavailable',
    'detail-verification-missing', 'detail-verification-invalid', 'taskspace-binding-mismatch']);
  const safeError = known.has(error.message) ? error.message
    : /rate.?limit|throttl|too many requests|http.?429/.test(value) ? 'service-rate-limit'
      : /timeout|timed out|etimedout|err_timed_out/.test(value) ? 'network-timeout'
        : /econnreset|econnrefused|eai_again|enotfound|err_name_not_resolved|err_connection_reset|err_connection_refused|network|dns|temporar|http.?5[0-9][0-9]/.test(value) ? 'network-transient'
          : 'scan-failed';
  let pageDiagnostics = null;
  if (page && taskSpaceBound && task?.ownership === 'agent') {
    try {
      pageDiagnostics = await page.evaluate((memoId) => {
        const label = [...document.querySelectorAll('.type.typography-foot-note')].find((item) => (item.innerText || '').trim() === '笔记');
        const lines = label?.parentElement?.innerText?.split(String.fromCharCode(10)) || [];
        const count = Number((lines[0] || '').replaceAll(',', '').replaceAll('，', '').trim());
        const loading = [...document.querySelectorAll('.loading,[class*=loading],[class*=Loading],[aria-busy="true"]')]
          .some((item) => item.offsetParent !== null && (["loading", "加载中", "正在加载"].includes((item.innerText || '').trim()) || item.getAttribute('aria-busy') === 'true'));
        const sheet = document.querySelector('.memo-detail-sheet');
        const sheetRect = sheet?.getBoundingClientRect();
        const sheetVisible = Boolean(sheetRect && sheetRect.width > 0 && sheetRect.height > 0 && window.getComputedStyle(sheet).display !== 'none');
        const matchingDetailLinks = [...(sheet?.querySelectorAll('a[href*="memo_id="]') || [])].filter((link) => {
          try { return new URL(link.href).searchParams.get('memo_id') === memoId; } catch { return false; }
        });
        const routeMatches = Boolean(memoId && new URL(location.href).searchParams.get('memo_id') === memoId);
        const detailRoots = [...new Set(matchingDetailLinks.map((link) => link.closest('.normal') || link.closest('div.memo')).filter(Boolean))];
        const targetRoot = detailRoots.find((root) => root.querySelector('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content, div.tiptap.ProseMirror')) || (routeMatches ? sheet : null);
        const body = targetRoot?.querySelector('.display .richText, .display .content.copy-allowed, .display .content, .richText, .content.copy-allowed, .content');
        const targetListLinkVisible = Boolean(memoId && [...document.querySelectorAll('.memos a[href*="memo_id="]')].some((link) => {
          try {
            const rect = link.getBoundingClientRect();
            return new URL(link.href).searchParams.get('memo_id') === memoId && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
          } catch { return false; }
        }));
        return {
          host: location.hostname,
          path: location.pathname,
          pageTitleHasFlomo: (document.title || '').toLowerCase().includes('flomo'),
          hasMemoList: Boolean(document.querySelector('.memos')),
          hasCountLabel: Boolean(label),
          libraryCount: lines[1]?.trim() === '笔记' && Number.isInteger(count) ? count : null,
          memoCardCount: [...document.querySelectorAll('div.memo')].filter((card) => !card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]')).length,
          loadingVisible: loading,
          emptyStateVisible: [...document.querySelectorAll('p,span,div')].some((item) => item.children.length === 0 && ["暂无笔记", "还没有笔记", "没有笔记"].includes((item.innerText || '').trim())),
          loginIndicator: Boolean(document.querySelector('input[type="password"],form[action*="login"],.login-form,[data-page*="login"]')),
          captchaIndicator: Boolean(document.querySelector('iframe[src*="captcha"],input[name*="captcha"],[class*=captcha]')),
          ...(memoId ? { detail: {
            sheetVisible,
            routeMatches,
            targetLinkCount: matchingDetailLinks.length,
            bodyPresent: Boolean(body && (body.innerText || body.textContent || '').trim()),
            editorPresent: Boolean(targetRoot?.querySelector('div.tiptap.ProseMirror')),
            targetListLinkVisible,
          } } : {}),
        };
      }, detailTargetId);
    } catch {}
  }
  const taskOwnership = taskSpaceBound ? task.ownership : null;
  const taskSpaceId = taskSpaceBound && taskOwnership === 'agent' && Number.isSafeInteger(taskSpaceIdentity) ? taskSpaceIdentity : null;
  const taskSpaceName = taskSpaceBound && typeof task?.name === 'string' ? task.name : null;
  const result = { ok: false, error: safeError, cleanup: taskSpaceId ? 'retained-after-error' : 'not-needed',
    executionFinished: true, taskSpaceId, taskSpaceName, taskOwnership, stage: failureStage,
    expectedCount: initialCount, observedUniqueIds: seen.size, step: scanStep, pageDiagnostics,
    ...(detailMismatch ? { detailMismatch } : {}) };
  await fs.writeFile(resultPath, JSON.stringify(result), { mode: '600' });
  cliLog(JSON.stringify(result));
}
`;
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temp, filePath); }
  finally { await rm(temp, { force: true }); }
}

async function assertReplaceableGeneratedInput(filePath, week) {
  try {
    const current = await readFile(filePath, "utf8");
    if (!current.startsWith(`# Flomo 周输入｜${week}\n`)) throw new Error("flomo-existing-file-not-generated");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2))
    .catch((error) => {
      console.error(formatCliError(error));
      process.exitCode = 1;
    });
}

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";
import { learnXGeneratedReason } from "./lib/flomo-filter.mjs";
import { isoWeekRangeShanghai, normalizeWeek, defaultWeeklyReviewWeek } from "./collect-weread-weekly.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const TIMEZONE = "Asia/Shanghai";
const MAX_SCAN_STEPS = 120;
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

function parseArgs(argv) {
  const index = argv.indexOf("--week");
  if (index < 0) return {};
  const week = argv[index + 1];
  if (!week || week.startsWith("--")) throw new Error("--week 需要 YYYY-Www 参数");
  return { week };
}

function classifyFlomoError(error) {
  if (/ego.*(?:bootstrap|login|permission|control)|user.control/i.test(String(error?.message || ""))) return "ego-login-or-control-required";
  if (/capacity/i.test(String(error?.message || ""))) return "scan-capacity-exceeded";
  if (/invalid|incomplete|week.*record/i.test(String(error?.message || ""))) return "scan-integrity-check-failed";
  return "browser-scan-failed";
}

async function scanFlomoWithEgo({ week, range }) {
  const invocation = randomUUID();
  const automationId = String(process.env.LEARN_X_AUTOMATION_ID || "learn-x-v2").replace(/[^a-zA-Z0-9_-]/g, "-");
  const taskName = `${automationId}-flomo-${invocation}`;
  const resultPath = path.join(os.tmpdir(), `learn-x-flomo-${invocation}.json`);
  const script = buildEgoScanScript({ week, range, taskName, resultPath, maxSteps: MAX_SCAN_STEPS });
  try {
    await runEgoScript(script);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (result?.ok === false) throw new Error(result.error === "user-control" ? "ego-user-control" : "ego-browser-scan-failed");
    return result;
  } catch (error) {
    if (error.code === "ENOENT" && error.path === "ego-browser") throw new Error("ego-browser-unavailable");
    if (error.killed || error.code === "ETIMEDOUT") throw new Error("ego-browser-timeout");
    if (/^ego-(?:user-control|browser-scan-failed)$/.test(String(error.message || ""))) throw error;
    throw new Error("ego-browser-scan-failed");
  } finally {
    await rm(resultPath, { force: true });
  }
}

export function runEgoScript(script, { timeout = 12 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("ego-browser", ["nodejs", "-e", script], { timeout, maxBuffer: 1_000_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    // Ego's Node runner awaits stdin EOF even with -e. An open pipe stalls evaluation.
    child.stdin?.end();
  });
}

export function buildEgoScanScript({ week, range, taskName, resultPath, maxSteps }) {
  return `
const fs = await import('node:fs/promises');
const task = await taskSpace(${JSON.stringify(taskName)});
const page = task.page('p1');
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
    const link = card.querySelector('a[href*="memo_id="]');
    const time = card.querySelector('a.time[href*="memo_id="]');
    const body = card.querySelector('.richText, .content.copy-allowed, .content');
    return {
      memoId: link ? new URL(link.href).searchParams.get('memo_id') : null,
      timeText: (time?.querySelector(':scope > .text')?.innerText || time?.innerText)?.trim() || null,
      isEditor: Boolean(card.querySelector('.input-box .tiptap, .input-box [contenteditable="true"]')),
      bodyText: body?.innerText || '',
      bodyFound: Boolean(body),
      bodyComplete: Boolean(body && !body.classList.contains('is-fold') && body.scrollHeight <= body.clientHeight + 2),
      needsExpand: Boolean(body && (body.classList.contains('is-fold') || body.scrollHeight > body.clientHeight + 2)),
      hasExpand: Boolean(card.querySelector('.showBtn')),
      cardText: card.innerText || ''
    };
  });
  const buttons = [...document.querySelectorAll('button,a')].filter((item) => item.offsetParent !== null);
  const hasMore = buttons.some((item) => /加载更多|下一页/.test(item.innerText?.trim() || ''));
  const loading = [...document.querySelectorAll('*')].some((item) => item.offsetParent !== null && /^(loading|加载中|正在加载)$/.test(item.innerText?.trim() || ''));
  const atBottom = Boolean(list && list.scrollTop + list.clientHeight >= list.scrollHeight - 8);
  return { cards, hasMore, loading, atBottom, hasList: Boolean(list), progress: list ? cards.length + ':' + list.scrollHeight + ':' + list.scrollTop : '' };
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
      if (((!isPinned && timeMs >= range.start && timeMs < range.end) || isPinned) && (!card.bodyFound || card.needsExpand)) {
        const clicked = await page.evaluate((memoId) => {
          const card = [...document.querySelectorAll('div.memo')].find((node) => [...node.querySelectorAll('a[href*="memo_id="]')].some((link) => new URL(link.href).searchParams.get('memo_id') === memoId));
          const button = card?.querySelector('.showBtn');
          if (!button) return false;
          button.click();
          return true;
        }, card.memoId);
        if (!clicked) throw new Error('body-incomplete');
        await page.waitForFunction((memoId) => {
          const card = [...document.querySelectorAll('div.memo')].find((node) => [...node.querySelectorAll('a[href*="memo_id="]')].some((link) => new URL(link.href).searchParams.get('memo_id') === memoId));
          const body = card?.querySelector('.richText, .content.copy-allowed, .content');
          return Boolean(body && !body.classList.contains('is-fold') && body.scrollHeight <= body.clientHeight + 2);
        }, card.memoId, { timeout: 10000 });
      }
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
    await page.evaluate(() => {
      const list = document.querySelector('.memos');
      if (list) { list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll', { bubbles: true })); }
    });
    await page.waitForFunction((previous) => {
      const list = document.querySelector('.memos');
      if (!list) return false;
      return [...document.querySelectorAll('div.memo')].length + ':' + list.scrollHeight + ':' + list.scrollTop !== previous;
    }, current.progress, { timeout: 10000 }).catch(() => {});
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
  cliLog(JSON.stringify({ ok: true, complete: true, scanned: result.scanned, pageCount: result.pageCount }));
} catch (error) {
  const safeError = ['user-control', 'list-unavailable', 'timestamp-unreadable', 'body-incomplete', 'pagination-control-missing', 'pagination-incomplete'].includes(error.message) ? error.message : 'scan-failed';
  await fs.writeFile(resultPath, JSON.stringify({ ok: false, error: safeError }), { mode: 0o600 });
  cliLog(JSON.stringify({ ok: false, error: safeError }));
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
  collectFlomoWeekly(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

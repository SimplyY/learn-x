import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";
import { assertWeeklyInputSize } from "./lib/input-limits.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const TIMEZONE = "Asia/Shanghai";
const TIME_X_CALENDAR_ID = "feishu.cn_xdVu3PUCuNclTJezzT7tse@group.calendar.feishu.cn";
const CATEGORIES = ["健康", "生活", "关系", "学习", "创造", "投资"];
const DAY_MS = 86_400_000;
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function collectCalendarWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const range = isoWeekRangeShanghai(week);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const injected = Boolean(options.getAgenda);
  const userCalendars = injected ? [] : await listUserPersonalCalendars();
  const getAgenda = options.getAgenda || (({ start, endExclusive }) => readAllAgenda(userCalendars, { start, endExclusive }));
  const calendar = await getAgenda({ start: range.startEpoch, endExclusive: range.endEpoch })
    .then((events) => summarizeCalendar(range, events))
    .catch((error) => ({ status: "unavailable", error: error instanceof Error ? error.message : String(error) }));
  return {
    week,
    timezone: TIMEZONE,
    range: { start: formatShanghaiDateTime(range.startEpoch), endExclusive: formatShanghaiDateTime(range.endEpoch) },
    generatedAt,
    calendar,
    sources: [
      { name: "Time-X｜随时记", identity: "bot" },
      ...userCalendars.map((calendar) => ({ name: calendar.summary, identity: "user" }))
    ]
  };
}

export async function writeCalendarWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const calendarPath = path.join(outputRoot, "calendar.md");
  try {
    const payload = await collectCalendarWeekly({ ...options, week });
    const count = payload.calendar.status === "available" ? payload.calendar.details.length : 0;
    const written = payload.calendar.status === "available" && count > 0;
    if (written) {
      const tempPath = `${calendarPath}.${process.pid}-${Date.now()}.tmp`;
      const content = renderCalendarMarkdown(payload);
      assertWeeklyInputSize(content, calendarPath);
      await mkdir(outputRoot, { recursive: true });
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, calendarPath);
    }
    const unavailableSummary = payload.calendar.error ? `Time-X 日历查询不可用：${payload.calendar.error}，未使用旧文件` : "Time-X 日历查询不可用，未使用旧文件";
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "calendar", status: written ? "ready" : payload.calendar.status === "available" ? "empty" : "unavailable", file: "calendar.md", count, summary: written ? "本周有有效日历块" : payload.calendar.status === "available" ? "本周 0 条记录，文件未生成" : unavailableSummary, preservedStaleFile: !written && await fileExists(calendarPath) });
    return { payload, calendarPath: written ? calendarPath : null };
  } catch (error) {
    await updateWeeklySourceStatus({ weekRoot: outputRoot, week, source: "calendar", status: "failed", file: "calendar.md", count: 0, summary: `采集失败：${error.message}`, preservedStaleFile: await fileExists(calendarPath) });
    throw error;
  }
}

export function summarizeCalendar(range, events) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: formatShanghaiDate(range.startEpoch + index * 86_400),
    intervals: [],
    blocks: 0,
    allDay: 0,
    categoryIntervals: new Map(CATEGORIES.map((category) => [category, []])),
    categoryBlocks: new Map(CATEGORIES.map((category) => [category, 0]))
  }));
  let untagged = 0;
  const details = [];
  for (const event of events || []) {
    if (String(event?.self_rsvp_status || "").toLowerCase().startsWith("declin") || String(event?.free_busy_status || "").toLowerCase() === "free") continue;
    const tags = CATEGORIES.filter((category) => String(event?.summary || "").includes(`【${category}】`));
    if (!tags.length) untagged += 1;
    const start = parseCalendarTime(event?.start_time);
    const rawEnd = parseCalendarTime(event?.end_time);
    const isAllDay = Boolean(event?.is_all_day || (event?.start_time?.date && event?.end_time?.date));
    const end = isAllDay ? rawEnd + DAY_MS : rawEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Time-X calendar returned an invalid interval.");
    details.push({
      date: formatShanghaiDate(start / 1000),
      start: formatShanghaiDateTime(start / 1000),
      end: formatShanghaiDateTime(end / 1000),
      title: String(event?.summary || "（无标题）"),
      description: String(event?.description || "")
    });
    for (let index = 0; index < days.length; index += 1) {
      const dayStart = range.startEpoch * 1000 + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const intervalStart = Math.max(start, dayStart);
      const intervalEnd = Math.min(end, dayEnd);
      if (intervalEnd <= intervalStart) continue;
      if (isAllDay) {
        days[index].allDay += 1;
        continue;
      }
      days[index].blocks += 1;
      days[index].intervals.push([intervalStart, intervalEnd]);
      for (const tag of tags) {
        days[index].categoryBlocks.set(tag, days[index].categoryBlocks.get(tag) + 1);
        days[index].categoryIntervals.get(tag).push([intervalStart, intervalEnd]);
      }
    }
  }
  const daily = days.map((day) => ({
    date: day.date,
    minutes: mergedMinutes(day.intervals),
    blocks: day.blocks,
    allDay: day.allDay,
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, {
      minutes: mergedMinutes(day.categoryIntervals.get(category)),
      blocks: day.categoryBlocks.get(category)
    }]))
  }));
  return {
    status: "available",
    daily,
    details,
    untagged,
    weeklyMinutes: daily.reduce((total, day) => total + day.minutes, 0),
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, {
      minutes: daily.reduce((total, day) => total + day.categories[category].minutes, 0),
      blocks: daily.reduce((total, day) => total + day.categories[category].blocks, 0)
    }]))
  };
}

export function renderCalendarMarkdown(payload) {
  const sources = payload.sources?.length
    ? payload.sources.map((source) => `${source.name}（${source.identity === "user" ? "用户身份" : "应用身份"}，只读）`).join("、")
    : "`Time-X｜随时记` 共享日历（应用身份，只读）";
  const lines = [
    `# Time-X 日历｜${payload.week}`, "",
    `- 来源：${sources}`,
    `- 时间范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    "",
    "> 日历来自 Time-X 随时记与用户个人日历合并结果，只保留日期、时间、标题和描述；人员、地点、ID、链接与系统元数据不保存。它是计划/记录上下文，不单独证明实际完成。",
    "",
    "## 时间投入"
  ];
  if (payload.calendar.status !== "available") lines.push("", "日历来源不可用；未使用旧结果替代。");
  else {
    lines.push("", "| 日期 | 时间投入 | 事项块 | 标签投入 |", "| --- | ---: | ---: | --- |");
    for (const day of payload.calendar.daily) lines.push(`| ${day.date} | ${formatMinutes(day.minutes)} | ${day.blocks} | ${formatCategoryDaily(day.categories)} |`);
    lines.push("", `- 全周时间投入：${formatMinutes(payload.calendar.weeklyMinutes)}`, `- 未分类事项：${payload.calendar.untagged}`, `- 标签汇总（标签可交叉，时长不可相加）：${formatCategoryWeekly(payload.calendar.categories)}`, "", "## 详细时间", "", "> 以下按日历原始块逐条保留，跨日事项不拆分；日历投入汇总仍按实际相交时间计算。", "");
    if (!payload.calendar.details?.length) lines.push("目标周内没有有效日历块。");
    else {
      lines.push("| 日期 | 开始 | 结束 | 事项 | 描述 |", "| --- | --- | --- | --- | --- |");
      for (const detail of payload.calendar.details) lines.push(`| ${detail.date} | ${detail.start} | ${detail.end} | ${escapeMarkdownCell(detail.title)} | ${escapeMarkdownCell(detail.description) || "—"} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function readTimeXAgenda({ start, endExclusive }) {
  const data = await runLarkJson(["calendar", "+agenda", "--as", "bot", "--calendar-id", TIME_X_CALENDAR_ID, "--start", formatCliDateTime(start), "--end", formatCliDateTime(endExclusive)]);
  if (!data?.ok || !Array.isArray(data.data)) throw new Error("Time-X calendar query failed.");
  return data.data;
}

// 用户自己创建/维护的日历（主日历 + 自有共享日历），与 Time-X 共享日历合并采集。
async function listUserPersonalCalendars() {
  try {
    const data = await runLarkJson(["calendar", "calendars", "list", "--as", "user", "--page-all"]);
    if (!data?.ok || !Array.isArray(data.data?.calendar_list)) return [];
    return data.data.calendar_list.filter((calendar) =>
      calendar.calendar_id !== TIME_X_CALENDAR_ID &&
      ["owner", "writer"].includes(calendar.role) &&
      ["primary", "shared"].includes(calendar.type)
    );
  } catch {
    return [];
  }
}

async function readUserAgenda(calendarId, { start, endExclusive }) {
  const data = await runLarkJson(["calendar", "+agenda", "--as", "user", "--calendar-id", calendarId, "--start", formatCliDateTime(start), "--end", formatCliDateTime(endExclusive)]);
  if (!data?.ok || !Array.isArray(data.data)) throw new Error(`User calendar query failed (${calendarId}).`);
  return data.data;
}

async function readAllAgenda(userCalendars, range) {
  const all = [...(await readTimeXAgenda(range))];
  for (const calendar of userCalendars) {
    try {
      all.push(...(await readUserAgenda(calendar.calendar_id, range)));
    } catch {
      // 单个个人日历不可读时跳过，不因此拖垮整个来源。
    }
  }
  return dedupeEvents(all);
}

// 同一活动可能同时出现在共享日历和主日历，按（开始、结束、标题）去重避免重复统计。
export function dedupeEvents(events) {
  const seen = new Set();
  return (events || []).filter((event) => {
    const key = `${parseCalendarTime(event?.start_time)}:${parseCalendarTime(event?.end_time)}:${String(event?.summary || "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runLarkJson(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" } });
  return JSON.parse(stdout);
}

function parseCalendarTime(value) {
  return value?.datetime ? Date.parse(value.datetime) : /^\d{4}-\d{2}-\d{2}$/.test(value?.date || "") ? Date.parse(`${value.date}T00:00:00+08:00`) : NaN;
}
function mergedMinutes(intervals) {
  const merged = [];
  for (const interval of [...intervals].sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return Math.round(merged.reduce((total, [start, end]) => total + end - start, 0) / 60_000);
}
function formatMinutes(minutes) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ""}` : `${rest} 分钟`; }
function formatCategoryDaily(categories) { return CATEGORIES.filter((category) => categories[category].minutes || categories[category].blocks).map((category) => `【${category}】${formatMinutes(categories[category].minutes)}`).join(" ") || "—"; }
function formatCategoryWeekly(categories) { return CATEGORIES.filter((category) => categories[category].minutes || categories[category].blocks).map((category) => `【${category}】${formatMinutes(categories[category].minutes)} / ${categories[category].blocks} 块`).join("；") || "无"; }
function escapeMarkdownCell(value) { return String(value || "").replaceAll("|", "\\|").replaceAll("\n", "<br>"); }
function formatShanghaiDate(epochSeconds) { return formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit" }, ["year", "month", "day"], "-"); }
function formatShanghaiDateTime(epochSeconds) { const parts = formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`; }
function formatCliDateTime(epochSeconds) { return `${formatShanghaiDateTime(epochSeconds).replace(" ", "T")}+08:00`; }
function formatParts(epochSeconds, options, keys, joiner) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, ...options }).formatToParts(new Date(epochSeconds * 1000)); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return keys ? keys.map((key) => values[key]).join(joiner) : values; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === "--week") options.week = process.argv[++index];
  const result = await writeCalendarWeekly(options);
  console.log(`Calendar weekly input: ${result.calendarPath ? path.relative(repoRoot, result.calendarPath) : "文件未生成（空缺或不可用）"}`);
}

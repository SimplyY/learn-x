import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";

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
  const getAgenda = options.getAgenda || readTimeXAgenda;
  const calendar = await getAgenda({ start: range.startEpoch, endExclusive: range.endEpoch })
    .then((events) => summarizeCalendar(range, events))
    .catch(() => ({ status: "unavailable" }));
  return {
    week,
    timezone: TIMEZONE,
    range: { start: formatShanghaiDateTime(range.startEpoch), endExclusive: formatShanghaiDateTime(range.endEpoch) },
    generatedAt,
    calendar
  };
}

export async function writeCalendarWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const payload = await collectCalendarWeekly({ ...options, week });
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const calendarPath = path.join(outputRoot, "calendar.md");
  const tempPath = `${calendarPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(tempPath, renderCalendarMarkdown(payload), "utf8");
  await rename(tempPath, calendarPath);
  return { payload, calendarPath };
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
    const end = parseCalendarTime(event?.end_time);
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
      if (event.is_all_day) {
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
  const lines = [
    `# Time-X 日历｜${payload.week}`, "",
    "- 来源：`Time-X｜随时记` 共享日历（应用身份，只读）",
    `- 时间范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    "",
    "> 日历来自 Time-X 随时记编译结果，只保留日期、时间、标题和描述；人员、地点、ID、链接与系统元数据不保存。它是计划/记录上下文，不单独证明实际完成。",
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
  console.log(`Calendar weekly input written: ${path.relative(repoRoot, result.calendarPath)}`);
}

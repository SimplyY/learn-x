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
    const count = payload.calendar.status === "available" ? payload.calendar.eventCount : 0;
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
  return allocateCalendarTime(range, events);
}

export function allocateCalendarTime(range, events) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: formatShanghaiDate(range.startEpoch + index * 86_400),
    startMs: range.startEpoch * 1000 + index * DAY_MS,
    endMs: range.startEpoch * 1000 + (index + 1) * DAY_MS,
    timedSlices: [],
    effectiveMinutes: 0,
    blocks: 0,
    allDay: 0,
    categoryMinutes: new Map(CATEGORIES.map((category) => [category, 0])),
    categoryBlocks: new Map(CATEGORIES.map((category) => [category, 0]))
  }));
  let untagged = 0;
  let eventCount = 0;
  const details = [];
  const rangeStart = range.startEpoch * 1000;
  const rangeEnd = range.endEpoch * 1000;
  const uniqueEvents = dedupePhysicalEvents(events);
  for (const [eventIndex, event] of uniqueEvents.entries()) {
    if (String(event?.self_rsvp_status || "").toLowerCase().startsWith("declin") || String(event?.free_busy_status || "").toLowerCase() === "free") continue;
    const start = parseCalendarTime(event?.start_time);
    const rawEnd = parseCalendarTime(event?.end_time);
    const isAllDay = Boolean(event?.is_all_day || (event?.start_time?.date && event?.end_time?.date));
    const end = isAllDay ? rawEnd + DAY_MS : rawEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Time-X calendar returned an invalid interval.");
    if (end <= rangeStart || start >= rangeEnd) continue;
    const tags = CATEGORIES.filter((category) => String(event?.summary || "").includes(`【${category}】`));
    if (!tags.length) untagged += 1;
    eventCount += 1;
    const title = String(event?.summary || "（无标题）");
    const description = String(event?.description || "");
    if (isAllDay) {
      details.push({
        date: formatShanghaiDate(start / 1000),
        start: formatShanghaiDateTime(start / 1000),
        end: formatShanghaiDateTime(end / 1000),
        originalStart: formatShanghaiDateTime(start / 1000),
        originalEnd: formatShanghaiDateTime(end / 1000),
        title,
        description,
        effectiveMinutes: null,
        eventIndex
      });
    }
    for (let index = 0; index < days.length; index += 1) {
      const dayStart = days[index].startMs;
      const dayEnd = days[index].endMs;
      const intervalStart = Math.max(start, dayStart);
      const intervalEnd = Math.min(end, dayEnd);
      if (intervalEnd <= intervalStart) continue;
      if (isAllDay) {
        days[index].allDay += 1;
        continue;
      }
      days[index].blocks += 1;
      days[index].timedSlices.push({
        eventIndex,
        start: intervalStart,
        end: intervalEnd,
        originalStart: start,
        originalEnd: end,
        title,
        description,
        tags,
        effectiveMilliseconds: 0
      });
      for (const tag of tags) {
        days[index].categoryBlocks.set(tag, days[index].categoryBlocks.get(tag) + 1);
      }
    }
  }
  const daily = days.map(allocateDay);
  for (const [dayIndex, day] of days.entries()) {
    for (const slice of day.timedSlices) {
      details.push({
        date: day.date,
        start: formatShanghaiDateTime(slice.start / 1000),
        end: formatShanghaiDateTime(slice.end / 1000),
        originalStart: formatShanghaiDateTime(slice.originalStart / 1000),
        originalEnd: formatShanghaiDateTime(slice.originalEnd / 1000),
        title: slice.title,
        description: slice.description,
        effectiveMinutes: slice.effectiveMinutes,
        eventIndex: slice.eventIndex,
        dayIndex
      });
    }
  }
  details.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.eventIndex - b.eventIndex);
  return {
    status: "available",
    daily,
    details,
    eventCount,
    untagged,
    weeklyMinutes: daily.reduce((total, day) => total + day.minutes, 0),
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, {
      minutes: daily.reduce((total, day) => total + day.categories[category].minutes, 0),
      blocks: daily.reduce((total, day) => total + day.categories[category].blocks, 0)
    }]))
  };
}

function allocateDay(day) {
  const boundaries = [...new Set(day.timedSlices.flatMap(({ start, end }) => [start, end]))].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    // ponytail: O(n²) active-slice scan; weekly calendars are small, and a sweep-line is only needed if profiling proves otherwise.
    const active = day.timedSlices.filter((slice) => slice.start <= start && slice.end >= end);
    if (!active.length) continue;
    const share = (end - start) / active.length;
    for (const slice of active) slice.effectiveMilliseconds += share;
  }

  const rounded = roundDayMinutes(day.timedSlices);
  day.effectiveMinutes = rounded.totalMinutes;
  for (const slice of day.timedSlices) {
    slice.effectiveMinutes = rounded.minutesBySlice.get(slice) || 0;
    for (const tag of slice.tags) day.categoryMinutes.set(tag, day.categoryMinutes.get(tag) + slice.effectiveMinutes);
  }
  return {
    date: day.date,
    minutes: day.effectiveMinutes,
    blocks: day.blocks,
    allDay: day.allDay,
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, {
      minutes: day.categoryMinutes.get(category),
      blocks: day.categoryBlocks.get(category)
    }]))
  };
}

function roundDayMinutes(slices) {
  const entries = slices.map((slice) => {
    const exactMinutes = slice.effectiveMilliseconds / 60_000;
    const baseMinutes = Math.floor(exactMinutes);
    return { slice, exactMinutes, baseMinutes, remainder: exactMinutes - baseMinutes };
  });
  const targetMinutes = Math.round(entries.reduce((total, entry) => total + entry.exactMinutes, 0));
  let remainder = targetMinutes - entries.reduce((total, entry) => total + entry.baseMinutes, 0);
  entries.sort((a, b) => b.remainder - a.remainder || a.slice.start - b.slice.start || a.slice.eventIndex - b.slice.eventIndex);
  for (const entry of entries) entry.minutes = entry.baseMinutes + (remainder-- > 0 ? 1 : 0);
  return {
    totalMinutes: targetMinutes,
    minutesBySlice: new Map(entries.map((entry) => [entry.slice, entry.minutes]))
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
    "> 日历来自 Time-X 随时记与用户个人日历合并结果，保留日期、时间、原始区间、标题、描述和有效投入；人员、地点、ID、链接与系统元数据不保存。它是计划/记录上下文，不单独证明实际完成。",
    "",
    "## 时间投入"
  ];
  if (payload.calendar.status !== "available") lines.push("", "日历来源不可用；未使用旧结果替代。");
  else {
    lines.push("", "| 日期 | 时间投入 | 事项块 | 标签投入 |", "| --- | ---: | ---: | --- |");
    for (const day of payload.calendar.daily) lines.push(`| ${day.date} | ${formatMinutes(day.minutes)} | ${day.blocks} | ${formatCategoryDaily(day.categories)} |`);
    lines.push("", `- 全周有效时间投入：${formatMinutes(payload.calendar.weeklyMinutes)}`, `- 未分类事项：${payload.calendar.untagged}`, `- 标签汇总（标签可交叉，时长不可相加）：${formatCategoryWeekly(payload.calendar.categories)}`, "", "## 详细时间", "", "> 保留原始标题和描述；定时日程按自然日展示，跨日事项按日切片；每一段时间按同时存在的定时日程数均分，全天事项不计入定时分钟。", "");
    if (!payload.calendar.details?.length) lines.push("目标周内没有有效日历块。");
    else {
      lines.push("| 日期 | 开始 | 结束 | 原始区间 | 有效投入 | 事项 | 描述 |", "| --- | --- | --- | --- | ---: | --- | --- |");
      for (const detail of payload.calendar.details) {
        const originalRange = detail.start === detail.originalStart && detail.end === detail.originalEnd
          ? "—"
          : `${detail.originalStart} 至 ${detail.originalEnd}`;
        const effectiveMinutes = detail.effectiveMinutes === null ? "—" : formatMinutes(detail.effectiveMinutes);
        lines.push(`| ${detail.date} | ${detail.start} | ${detail.end} | ${escapeMarkdownCell(originalRange)} | ${effectiveMinutes} | ${escapeMarkdownCell(detail.title)} | ${escapeMarkdownCell(detail.description) || "—"} |`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function readTimeXAgenda({ start, endExclusive }) {
  const data = await runLarkJson(["calendar", "+agenda", "--as", "bot", "--calendar-id", TIME_X_CALENDAR_ID, "--start", formatCliDateTime(start), "--end", formatCliDateTime(endExclusive)]);
  if (!data?.ok || !Array.isArray(data.data)) throw new Error("Time-X calendar query failed.");
  return data.data.map((event) => ({ ...event, calendar_id: TIME_X_CALENDAR_ID }));
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
  return data.data.map((event) => ({ ...event, calendar_id: calendarId }));
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
  return all;
}

// 只去除同一日历、同一物理事件的重复返回；不同 event_id 即使内容相同也必须参与时间分摊。
export function dedupePhysicalEvents(events) {
  const seen = new Set();
  return (events || []).filter((event) => {
    const calendarId = String(event?.calendar_id || event?.calendarId || "").trim();
    const eventId = String(event?.event_id || event?.eventId || "").trim();
    if (!calendarId || !eventId) return true;
    const key = JSON.stringify([calendarId, eventId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 保留旧导出名，避免外部调用方因去重策略内部升级而断裂。
export const dedupeEvents = dedupePhysicalEvents;

async function runLarkJson(args) {
  const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" } });
  return JSON.parse(stdout);
}

function parseCalendarTime(value) {
  return value?.datetime ? Date.parse(value.datetime) : /^\d{4}-\d{2}-\d{2}$/.test(value?.date || "") ? Date.parse(`${value.date}T00:00:00+08:00`) : NaN;
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

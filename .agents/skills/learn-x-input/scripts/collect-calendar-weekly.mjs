import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";

const TIMEZONE = "Asia/Shanghai";
const READ_SCOPE = "calendar:calendar.event:read";
const DAY_MS = 24 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function collectCalendarWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const range = isoWeekRangeShanghai(week);
  const getAuthStatus = options.getAuthStatus || readAuthStatus;
  const getAgenda = options.getAgenda || readAgenda;
  assertCalendarReadAccess(await getAuthStatus());
  const events = await getAgenda({ start: range.startEpoch, endExclusive: range.endEpoch });
  return summarizeCalendarEvents({ week, range, events, generatedAt: options.generatedAt || new Date().toISOString() });
}

export async function writeCalendarWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  let payload;

  try {
    payload = await collectCalendarWeekly({ ...options, week });
  } catch {
    payload = unavailablePayload(week, options.generatedAt || new Date().toISOString());
  }

  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const notesPath = path.join(outputRoot, "calendar.md");
  const tempPath = `${notesPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(tempPath, renderMarkdown(payload), "utf8");
  await rename(tempPath, notesPath);
  return { payload, notesPath };
}

export function summarizeCalendarEvents({ week, range, events, generatedAt }) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: formatShanghaiDate(range.startEpoch + index * 24 * 60 * 60),
    busyIntervals: [],
    timedEventCount: 0,
    allDayEventCount: 0
  }));
  const seenInstances = new Set();

  for (const event of events || []) {
    if (isDeclined(event)) continue;
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Calendar returned an invalid event interval.");
    const dedupeKey = event.event_id ? `${event.event_id}|${start}|${end}` : "";
    if (dedupeKey && seenInstances.has(dedupeKey)) continue;
    if (dedupeKey) seenInstances.add(dedupeKey);

    const clippedStart = Math.max(start, range.startEpoch * 1000);
    const clippedEnd = Math.min(end, range.endEpoch * 1000);
    if (clippedEnd <= clippedStart) continue;

    for (let index = 0; index < days.length; index += 1) {
      const dayStart = (range.startEpoch * 1000) + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const intervalStart = Math.max(clippedStart, dayStart);
      const intervalEnd = Math.min(clippedEnd, dayEnd);
      if (intervalEnd <= intervalStart) continue;
      if (event.is_all_day) {
        days[index].allDayEventCount += 1;
      } else if (event.free_busy_status !== "free") {
        days[index].timedEventCount += 1;
        days[index].busyIntervals.push([intervalStart, intervalEnd]);
      }
    }
  }

  const daily = days.map(({ date, busyIntervals, timedEventCount, allDayEventCount }) => ({
    date,
    plannedBusyMinutes: mergedMinutes(busyIntervals),
    timedEventCount,
    allDayEventCount
  }));
  return {
    status: "available",
    week,
    timezone: TIMEZONE,
    range: {
      start: formatShanghaiDateTime(range.startEpoch),
      endExclusive: formatShanghaiDateTime(range.endEpoch)
    },
    generatedAt,
    daily,
    weeklyPlannedBusyMinutes: daily.reduce((total, day) => total + day.plannedBusyMinutes, 0)
  };
}

export function renderMarkdown(payload) {
  const lines = [
    `# 飞书日历计划摘要｜${payload.week}`,
    "",
    "- 来源：飞书主日历（用户身份，只读）",
    `- 采集范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 状态：${payload.status === "available" ? "可用" : "不可用"}`,
    "",
    "> 此文件仅记录计划时间统计，不能证明实际发生、出席或完成；不保存日程标题、描述、人员、地点、ID 或会议链接。",
    ""
  ];

  if (payload.status !== "available") {
    lines.push("本周日历来源不可用；未使用旧结果替代。", "");
    return `${lines.join("\n").trim()}\n`;
  }

  lines.push("## 每日计划时间", "", "| 日期 | 计划忙碌时长 | 定时日程实例 | 全天事件 |", "| --- | ---: | ---: | ---: |");
  for (const day of payload.daily) {
    lines.push(`| ${day.date} | ${formatMinutes(day.plannedBusyMinutes)} | ${day.timedEventCount} | ${day.allDayEventCount} |`);
  }
  lines.push("", `- 全周计划忙碌时长：${formatMinutes(payload.weeklyPlannedBusyMinutes)}`, "");
  return lines.join("\n");
}

function unavailablePayload(week, generatedAt) {
  const range = isoWeekRangeShanghai(week);
  return {
    status: "unavailable",
    week,
    timezone: TIMEZONE,
    range: {
      start: formatShanghaiDateTime(range.startEpoch),
      endExclusive: formatShanghaiDateTime(range.endEpoch)
    },
    generatedAt
  };
}

async function readAuthStatus() {
  return runLarkJson(["auth", "status", "--json", "--verify"]);
}

async function readAgenda({ start, endExclusive }) {
  const data = await runLarkJson([
    "calendar", "+agenda", "--as", "user",
    "--start", formatCliDateTime(start),
    "--end", formatCliDateTime(endExclusive)
  ]);
  if (!data?.ok || !Array.isArray(data.data)) throw new Error("Calendar agenda query failed.");
  return data.data;
}

async function runLarkJson(args) {
  const { stdout } = await execFileAsync("lark-cli", args, {
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("lark-cli returned invalid JSON.");
  }
}

export function assertCalendarReadAccess(status) {
  const scope = String(status?.identities?.user?.scope || "").split(/\s+/);
  if (status?.identity !== "user" || status?.verified !== true || status?.identities?.user?.status !== "ready" || !scope.includes(READ_SCOPE)) {
    throw new Error("Calendar read authorization is unavailable.");
  }
}

function eventStart(event) {
  return parseCalendarTime(event?.start_time);
}

function eventEnd(event) {
  return parseCalendarTime(event?.end_time);
}

function parseCalendarTime(value) {
  if (value?.datetime) return Date.parse(value.datetime);
  return /^\d{4}-\d{2}-\d{2}$/.test(value?.date || "") ? Date.parse(`${value.date}T00:00:00+08:00`) : NaN;
}

function isDeclined(event) {
  return String(event?.self_rsvp_status || "").toLowerCase().startsWith("declin");
}

function mergedMinutes(intervals) {
  const merged = [];
  for (const interval of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return Math.round(merged.reduce((total, [start, end]) => total + end - start, 0) / 60000);
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} 小时${remainder ? ` ${remainder} 分钟` : ""}` : `${remainder} 分钟`;
}

function formatShanghaiDate(epochSeconds) {
  return formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit" }, ["year", "month", "day"], "-");
}

function formatShanghaiDateTime(epochSeconds) {
  const parts = formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatCliDateTime(epochSeconds) {
  const value = formatShanghaiDateTime(epochSeconds).replace(" ", "T");
  return `${value}+08:00`;
}

function formatParts(epochSeconds, options, keys, joiner) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, ...options }).formatToParts(new Date(epochSeconds * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return keys ? keys.map((key) => values[key]).join(joiner) : values;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeCalendarWeekly(parseArgs(process.argv.slice(2)));
  console.log(`Calendar weekly input ${result.payload.status}: ${path.relative(repoRoot, result.notesPath)}`);
}

import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek, isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";

const TIMEZONE = "Asia/Shanghai";
const TIME_X_CALENDAR_ID = "feishu.cn_xdVu3PUCuNclTJezzT7tse@group.calendar.feishu.cn";
const SCREEN_TIME_BASE_URL = "https://ywhome.feishu.cn/base/RpfGbno7IataUDsRx3acbeGGn5d";
const CATEGORIES = ["健康", "生活", "关系", "学习", "创造", "投资"];
const DAY_MS = 86_400_000;
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function collectTimeWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const range = isoWeekRangeShanghai(week);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const getAgenda = options.getAgenda || readTimeXAgenda;
  const getScreenRecords = options.getScreenRecords || readScreenRecords;
  const [calendar, screenTime] = await Promise.all([
    getAgenda({ start: range.startEpoch, endExclusive: range.endEpoch }).then((events) => summarizeCalendar(range, events)).catch(() => ({ status: "unavailable" })),
    getScreenRecords({ startDate: formatShanghaiDate(range.startEpoch), endDate: formatShanghaiDate(range.endEpoch) }).then((records) => ({ status: "available", records })).catch((error) => ({ status: "unavailable", records: [], reason: error.message }))
  ]);
  return { week, timezone: TIMEZONE, range: { start: formatShanghaiDateTime(range.startEpoch), endExclusive: formatShanghaiDateTime(range.endEpoch) }, generatedAt, calendar, screenTime };
}

export async function writeTimeWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const payload = await collectTimeWeekly({ ...options, week });
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const notesPath = path.join(outputRoot, "time.md");
  const tempPath = `${notesPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(tempPath, renderMarkdown(payload), "utf8");
  await rename(tempPath, notesPath);
  return { payload, notesPath };
}

export function summarizeCalendar(range, events) {
  const days = Array.from({ length: 7 }, (_, index) => ({ date: formatShanghaiDate(range.startEpoch + index * 86_400), intervals: [], blocks: 0, allDay: 0, categoryIntervals: new Map(CATEGORIES.map((category) => [category, []])), categoryBlocks: new Map(CATEGORIES.map((category) => [category, 0])) }));
  let untagged = 0;
  for (const event of events || []) {
    if (String(event?.self_rsvp_status || "").toLowerCase().startsWith("declin") || String(event?.free_busy_status || "").toLowerCase() === "free") continue;
    const tags = CATEGORIES.filter((category) => String(event?.summary || "").includes(`【${category}】`));
    if (!tags.length) untagged += 1;
    const start = parseCalendarTime(event?.start_time);
    const end = parseCalendarTime(event?.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Time-X calendar returned an invalid interval.");
    for (let index = 0; index < days.length; index += 1) {
      const dayStart = range.startEpoch * 1000 + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const intervalStart = Math.max(start, dayStart);
      const intervalEnd = Math.min(end, dayEnd);
      if (intervalEnd <= intervalStart) continue;
      if (event.is_all_day) { days[index].allDay += 1; continue; }
      days[index].blocks += 1;
      days[index].intervals.push([intervalStart, intervalEnd]);
      for (const tag of tags) { days[index].categoryBlocks.set(tag, days[index].categoryBlocks.get(tag) + 1); days[index].categoryIntervals.get(tag).push([intervalStart, intervalEnd]); }
    }
  }
  const daily = days.map((day) => ({ date: day.date, minutes: mergedMinutes(day.intervals), blocks: day.blocks, allDay: day.allDay, categories: Object.fromEntries(CATEGORIES.map((category) => [category, { minutes: mergedMinutes(day.categoryIntervals.get(category)), blocks: day.categoryBlocks.get(category) }])) }));
  return { status: "available", daily, untagged, weeklyMinutes: daily.reduce((total, day) => total + day.minutes, 0), categories: Object.fromEntries(CATEGORIES.map((category) => [category, { minutes: daily.reduce((total, day) => total + day.categories[category].minutes, 0), blocks: daily.reduce((total, day) => total + day.categories[category].blocks, 0) }])) };
}

export function renderMarkdown(payload) {
  const lines = [
    `# Time-X 时间摘要｜${payload.week}`, "",
    `- 时间范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`, `- 时区：${payload.timezone}`, `- 生成时间：${payload.generatedAt}`, "",
    "> 日历部分是 Time-X 私有共享日历中的计划/记录时间；屏幕时间是设备使用证据。两者不证明实际完成，Android 与 Mac 不相加。日程标题、人物、地点、链接与截图均不保存；仅保留超过 1 小时的应用名称与时长。", "",
    "## Time-X 日历投入"
  ];
  if (payload.calendar.status !== "available") lines.push("", "日历来源不可用；未使用旧结果替代。");
  else {
    lines.push("", "| 日期 | 时间投入 | 事项块 | 全天事项 | 标签投入 |", "| --- | ---: | ---: | ---: | --- |");
    for (const day of payload.calendar.daily) lines.push(`| ${day.date} | ${formatMinutes(day.minutes)} | ${day.blocks} | ${day.allDay} | ${formatCategoryDaily(day.categories)} |`);
    lines.push("", `- 全周时间投入：${formatMinutes(payload.calendar.weeklyMinutes)}`, `- 未分类事项：${payload.calendar.untagged}`, `- 标签汇总（标签可交叉，时长不可相加）：${formatCategoryWeekly(payload.calendar.categories)}`);
  }
  lines.push("", "## 屏幕时间", "");
  if (payload.screenTime.status !== "available") lines.push("屏幕时间 Base 不可用；未使用旧结果替代。");
  else if (!payload.screenTime.records.length) lines.push("目标周内未找到屏幕时间记录。");
  else {
    lines.push("| 终端 | 统计窗口 | 截至日期 | 总时长 | 来源 |", "| --- | --- | --- | ---: | --- |");
    for (const record of payload.screenTime.records) lines.push(`| ${record.device} | ${record.window} | ${record.capturedAt} | ${formatMinutes(record.totalMinutes)} | ${record.source} |`);
    lines.push("", "### 超过 1 小时的应用", "");
    for (const record of payload.screenTime.records) {
      if (record.apps === null) lines.push(`- ${record.device}：应用明细不可用。`);
      else {
        const apps = (record.apps || []).filter((app) => app.minutes > 60);
        lines.push(`- ${record.device}：${apps.length ? apps.map((app) => `${app.name} ${formatMinutes(app.minutes)}`).join("；") : "无"}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function readTimeXAgenda({ start, endExclusive }) { const data = await runLarkJson(["calendar", "+agenda", "--as", "bot", "--calendar-id", TIME_X_CALENDAR_ID, "--start", formatCliDateTime(start), "--end", formatCliDateTime(endExclusive)]); if (!data?.ok || !Array.isArray(data.data)) throw new Error("Time-X calendar query failed."); return data.data; }

async function readScreenRecords({ startDate, endDate }) {
  const base = await runLarkJson(["base", "+url-resolve", "--as", "bot", "--url", SCREEN_TIME_BASE_URL]);
  const baseToken = base?.data?.base_token; if (!baseToken) throw new Error("Screen-time Base unavailable.");
  const tables = await runLarkJson(["base", "+table-list", "--as", "bot", "--base-token", baseToken]);
  const table = (tables?.data?.tables || []).find((candidate) => candidate.name === "周记录"); if (!table?.id) throw new Error("Screen-time table unavailable.");
  const fields = ["记录", "截至日期", "终端", "统计窗口", "总分钟", "应用明细", "来源"];
  const result = await runLarkJson(["base", "+record-list", "--as", "bot", "--base-token", baseToken, "--table-id", table.id, ...fields.flatMap((field) => ["--field-id", field]), "--limit", "200", "--format", "json"]);
  const data = result?.data || {}; if (data.has_more) throw new Error("Screen-time records exceed one safe page.");
  const found = new Map(); const names = data.fields || [];
  for (const row of data.data || []) { const record = Object.fromEntries(names.map((name, index) => [name, row[index]])); const capturedAt = scalar(record["截至日期"]); if (capturedAt.slice(0, 10) < startDate || capturedAt.slice(0, 10) >= endDate) continue; const device = scalar(record["终端"]); found.set(scalar(record["记录"]), { device, window: scalar(record["统计窗口"]), capturedAt, totalMinutes: Number(record["总分钟"]), apps: parseScreenTimeApps(device, scalar(record["应用明细"])), source: scalar(record["来源"]) }); }
  const latestByDevice = new Map();
  for (const record of found.values()) {
    if (!Number.isFinite(record.totalMinutes)) continue;
    if (!latestByDevice.has(record.device) || record.capturedAt > latestByDevice.get(record.device).capturedAt) latestByDevice.set(record.device, record);
  }
  return [...latestByDevice.values()].sort((a, b) => a.device.localeCompare(b.device, "zh-Hans-CN"));
}

async function runLarkJson(args) { const { stdout } = await execFileAsync("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" } }); return JSON.parse(stdout); }
function scalar(value) { return Array.isArray(value) ? value[0] : value ?? ""; }
export function parseScreenTimeApps(device, details) {
  const prefix = "可见应用：";
  const value = String(details || "");
  const index = value.indexOf(prefix);
  if (index < 0) return null;
  const apps = [];
  for (const part of value.slice(index + prefix.length).split(/[；;]/)) {
    const item = part.trim().replace(/[。.]$/, "");
    if (!item) continue;
    const hourMatch = item.match(/^(.*?)\s+(\d+)小时(?:(\d+)分)?$/);
    const minuteMatch = item.match(/^(.*?)\s+(\d+)分$/);
    if (!hourMatch && !minuteMatch) return null;
    const name = (hourMatch?.[1] || minuteMatch?.[1] || "").trim();
    if (!name) return null;
    const minutes = hourMatch ? Number(hourMatch[2]) * 60 + Number(hourMatch[3] || 0) : Number(minuteMatch[2]);
    apps.push({ name: device === "Mac" && name === "ChatGPT" ? "Code X" : name, minutes });
  }
  return apps;
}
function parseCalendarTime(value) { return value?.datetime ? Date.parse(value.datetime) : /^\d{4}-\d{2}-\d{2}$/.test(value?.date || "") ? Date.parse(`${value.date}T00:00:00+08:00`) : NaN; }
function mergedMinutes(intervals) { const merged = []; for (const interval of [...intervals].sort((a, b) => a[0] - b[0])) { const previous = merged.at(-1); if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]); else merged.push([...interval]); } return Math.round(merged.reduce((total, [start, end]) => total + end - start, 0) / 60_000); }
function formatMinutes(minutes) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ""}` : `${rest} 分钟`; }
function formatCategoryDaily(categories) { return CATEGORIES.filter((category) => categories[category].minutes || categories[category].blocks).map((category) => `【${category}】${formatMinutes(categories[category].minutes)}`).join(" ") || "—"; }
function formatCategoryWeekly(categories) { return CATEGORIES.filter((category) => categories[category].minutes || categories[category].blocks).map((category) => `【${category}】${formatMinutes(categories[category].minutes)} / ${categories[category].blocks} 块`).join("；") || "无"; }
function formatShanghaiDate(epochSeconds) { return formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit" }, ["year", "month", "day"], "-"); }
function formatShanghaiDateTime(epochSeconds) { const parts = formatParts(epochSeconds, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`; }
function formatCliDateTime(epochSeconds) { return `${formatShanghaiDateTime(epochSeconds).replace(" ", "T")}+08:00`; }
function formatParts(epochSeconds, options, keys, joiner) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, ...options }).formatToParts(new Date(epochSeconds * 1000)); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return keys ? keys.map((key) => values[key]).join(joiner) : values; }
function parseArgs(argv) { const options = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index] === "--week") options.week = argv[++index]; return options; }
if (process.argv[1] === fileURLToPath(import.meta.url)) { const result = await writeTimeWeekly(parseArgs(process.argv.slice(2))); console.log(`Time weekly input written: ${path.relative(repoRoot, result.notesPath)}`); }

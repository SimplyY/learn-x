import path from "node:path";
import { fileURLToPath } from "node:url";

// 统一路径与周口径。所有命令共享，测试可注入 paths 覆盖。
export const WEEK_PATTERN = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function assertWeek(week) {
  if (!WEEK_PATTERN.test(String(week ?? ""))) throw fail("INVALID_WEEK", `无效周：${week}（期望 YYYY-Www）`);
}

export function skillRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function repoRoot() {
  return path.resolve(skillRoot(), "..", "..", "..");
}

export function weeklyRoot(repo, week) {
  return path.join(repo, "03_input", "weekly", week);
}

export function runtimeRoot(skill, week) {
  return path.join(skill, "runtime", week);
}

export function runtimeLockPath(skill, week) {
  return path.join(skill, "runtime", "locks", `jingdu-${week}.lock`);
}

function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday;
}

function shanghaiDateParts(now) {
  // Asia/Shanghai = UTC+8，无夏令时；用偏移后的 UTC 日期代表上海本地日期。
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return shifted;
}

// 口径（docs/cases/weread-highlights/codex-weekly-automation-prompt.md §0）：
// 周六/周日运行 = 当前 ISO 周；周一至周五运行 = 上一 ISO 周。
export function currentWeek(now = new Date()) {
  const shifted = shanghaiDateParts(now);
  const { year, week } = isoWeekOf(shifted);
  const weekday = shifted.getUTCDay() || 7;
  if (weekday >= 6) return `${year}-W${String(week).padStart(2, "0")}`;
  const previous = isoWeekMonday(year, week);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const previousWeek = isoWeekOf(previous);
  return `${previousWeek.year}-W${String(previousWeek.week).padStart(2, "0")}`;
}

export function weekRangeLabel(week) {
  assertWeek(week);
  const [year, weekText] = week.split("-W");
  const monday = isoWeekMonday(Number(year), Number(weekText));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const format = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return `${format(monday)} 至 ${format(sunday)}`;
}

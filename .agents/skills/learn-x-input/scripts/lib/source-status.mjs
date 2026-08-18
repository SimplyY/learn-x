import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const SOURCE_STATUS_FILE = "_source-status.json";
export const SOURCE_STATUSES = new Set(["ready", "empty", "failed", "unavailable"]);
export const SOURCE_NAMES = new Set([
  "daily", "flomo", "weread", "calendar", "voice", "coach", "wisdom",
  "wechat", "build", "build-bot", "health"
]);
export const SOURCE_FILES = {
  daily: "daily.md", flomo: "flomo.md", weread: "weread.md", calendar: "calendar.md",
  voice: "voice.md", coach: "coach.md", wisdom: "wisdom.md", wechat: "wechat.md",
  build: "build.md", "build-bot": "build-bot.md", health: "health.md"
};

function assertWeek(week) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week)) throw new Error(`无效周：${week}`);
}

function assertSource(source) {
  if (!SOURCE_NAMES.has(source)) throw new Error(`未知输入源：${source}`);
}

function assertFile(file) {
  if (!file || file === "." || file === ".." || path.basename(file) !== file || file.startsWith("_")) {
    throw new Error(`非法来源文件名：${file}`);
  }
}

function cleanSummary(summary) {
  const value = String(summary ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll("|", "／")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:token|secret|password|credential|cookie|session|api[_-]?key)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b(?:record[_-]?id|technical[_-]?id|document[_-]?id)\s*[:=]\s*\S+/gi, "[id]")
    .replace(/\b(?:rec|tbl|fld|app|base|view|doc|wiki)[A-Za-z0-9_-]{6,}\b/gi, "[id]")
    .trim();
  if (value.length > 240) throw new Error("来源状态说明过长。");
  return value;
}

function validateEntry(source, entry) {
  assertSource(source);
  if (!entry || typeof entry !== "object") throw new Error(`来源状态非法：${source}`);
  if (!SOURCE_STATUSES.has(entry.status)) throw new Error(`非法来源状态：${entry.status}`);
  assertFile(entry.file);
  if (entry.file !== SOURCE_FILES[source]) throw new Error(`来源文件名与来源不匹配：${source}`);
  if (!Number.isInteger(entry.count) || entry.count < 0) throw new Error(`非法来源计数：${source}`);
  if (typeof entry.summary !== "string") throw new Error(`来源说明必须是字符串：${source}`);
  const summary = cleanSummary(entry.summary);
  if (typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
    throw new Error(`来源更新时间非法：${source}`);
  }
  if (typeof entry.preservedStaleFile !== "boolean") throw new Error(`来源旧文件标记非法：${source}`);
  return {
    status: entry.status,
    file: entry.file,
    count: entry.count,
    summary,
    updatedAt: entry.updatedAt,
    preservedStaleFile: entry.preservedStaleFile
  };
}

export function validateSourceStatusDocument(document, week) {
  assertWeek(week);
  if (!document || typeof document !== "object" || document.version !== 1 || document.week !== week) {
    throw new Error("来源状态侧车格式非法。");
  }
  if (!document.sources || typeof document.sources !== "object" || Array.isArray(document.sources)) {
    throw new Error("来源状态侧车缺少 sources。");
  }
  const sources = {};
  for (const [source, entry] of Object.entries(document.sources)) sources[source] = validateEntry(source, entry);
  if (typeof document.updatedAt !== "string" || !Number.isFinite(Date.parse(document.updatedAt))) {
    throw new Error("来源状态侧车更新时间非法。");
  }
  return { version: 1, week, updatedAt: document.updatedAt, sources };
}

export async function readWeeklySourceStatus(weekRoot, week) {
  assertWeek(week);
  const file = path.join(weekRoot, SOURCE_STATUS_FILE);
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, document: null, sources: {} };
    throw error;
  }
  let document;
  try {
    document = JSON.parse(content);
  } catch (error) {
    throw new Error(`来源状态侧车 JSON 无法解析：${error.message}`);
  }
  try {
    const validated = validateSourceStatusDocument(document, week);
    return { present: true, document: validated, sources: validated.sources };
  } catch (error) {
    throw new Error(`来源状态侧车格式非法：${error.message}`);
  }
}

export async function updateWeeklySourceStatus({ weekRoot, week, source, status, file, count = 0, summary = "", preservedStaleFile = false }) {
  assertWeek(week);
  const now = new Date().toISOString();
  const current = await readWeeklySourceStatus(weekRoot, week);
  const entry = validateEntry(source, {
    status,
    file,
    count,
    summary: cleanSummary(summary),
    updatedAt: now,
    preservedStaleFile
  });
  if (entry.status === "ready" && !(await fileExists(path.join(weekRoot, entry.file)))) {
    throw new Error(`ready 来源文件不存在：${entry.file}`);
  }
  const document = {
    version: 1,
    week,
    updatedAt: now,
    sources: { ...current.sources, [source]: entry }
  };
  await mkdir(weekRoot, { recursive: true });
  const target = path.join(weekRoot, SOURCE_STATUS_FILE);
  const temp = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temp, target);
  return document;
}

export function sourceStatusForFile(sources, fileName) {
  return Object.values(sources).find((entry) => entry.file === path.basename(fileName));
}

export async function fileExists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

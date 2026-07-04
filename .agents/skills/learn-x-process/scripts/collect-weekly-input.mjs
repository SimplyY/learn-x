import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const inputRoot = path.join(repoRoot, "03_input", "weekly");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);
const ignoredFileNames = new Set(["README.md", ".gitkeep"]);

export async function collectWeeklyInput(options = {}) {
  const week = options.week || defaultWeeklyReviewWeek();
  const weekDirectory = distWeekId(week);
  const weekInputRoot = path.join(inputRoot, weekDirectory);
  const weekPrefix = `03_input/weekly/${weekDirectory}/`;
  const range = isoWeekRange(week);
  const files = await collectInputFiles(weekInputRoot);
  const activeFiles = [];
  const rawItems = [];

  for (const file of files) {
    const info = await stat(file.absolutePath);
    const content = await readFile(file.absolutePath, "utf8");
    const parsedItems = parseInputFile(content, file);
    const fileItems = parsedItems
      .map((item, index) => ({
        id: `${file.relativePath}#${index + 1}`,
        category: file.category,
        source: file.source,
        path: file.relativePath,
        shortPath: shortWeeklyPath(file.relativePath, weekPrefix),
        modifiedAt: info.mtime.toISOString(),
        text: cleanText(item.text),
        title: item.title || titleFromPath(file.relativePath)
      }))
      .filter((item) => item.text.length >= 12);

    if (!fileItems.length) continue;

    file.modifiedAt = info.mtime.toISOString();
    file.size = info.size;
    activeFiles.push(file);
    rawItems.push(...fileItems);
  }

  const uniqueItems = dedupeItems(rawItems);

  return {
    week,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    selection: {
      mode: "week-directory",
      path: toWebPath(path.relative(repoRoot, weekInputRoot))
    },
    generatedAt: new Date().toISOString(),
    files: activeFiles.map(({ absolutePath: _absolutePath, relativePath, ...file }) => ({
      path: relativePath,
      shortPath: shortWeeklyPath(relativePath, weekPrefix),
      ...file
    })),
    items: uniqueItems,
    stats: {
      fileCount: activeFiles.length,
      itemCount: rawItems.length,
      uniqueItemCount: uniqueItems.length,
      duplicateCount: rawItems.length - uniqueItems.length
    }
  };
}

export async function writeWeeklyInput(options = {}) {
  const payload = await collectWeeklyInput(options);
  const outputRoot = path.join(repoRoot, "04_output/_dist/weekly", distWeekId(payload.week));
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "input.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { payload, outputPath };
}

async function collectInputFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = toWebPath(path.relative(repoRoot, absolutePath));
    const kind = inputKindFromRelativePath(relativePath);

    if (entry.isDirectory()) {
      files.push(...(await collectInputFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("_")) continue;
    if (ignoredFileNames.has(entry.name)) continue;
    if (isExcludedWeeklyPath(relativePath)) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    files.push({ absolutePath, relativePath, ...kind });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
}

function isExcludedWeeklyPath(relativePath) {
  return /\/(?:00_log|log)\/monthly(?:\.md|\/)/.test(toWebPath(relativePath));
}

function parseInputFile(content, file) {
  const extension = path.extname(file.relativePath).toLowerCase();
  if (extension === ".json") {
    try {
      return extractJsonItems(JSON.parse(content)).map((text, index) => ({
        title: `${titleFromPath(file.relativePath)} ${index + 1}`,
        text
      }));
    } catch (error) {
      return [{ title: titleFromPath(file.relativePath), text: `JSON 解析失败：${error.message}\n\n${content}` }];
    }
  }
  if (extension === ".html" || extension === ".htm") {
    const flomoItems = extractFlomoMemoItems(content, file);
    if (flomoItems.length) return flomoItems;

    return [{ title: titleFromPath(file.relativePath), text: htmlToText(content) }];
  }

  return [{ title: titleFromMarkdown(content, file.relativePath), text: content }];
}

function extractJsonItems(value) {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(extractJsonItems);
  if (typeof value === "object") {
    const preferred = ["title", "content", "text", "note", "summary", "question", "answer"];
    const parts = [];
    for (const key of preferred) {
      if (typeof value[key] === "string") parts.push(`${key}: ${value[key]}`);
    }
    if (parts.length) return [parts.join("\n")];
    return Object.values(value).flatMap(extractJsonItems);
  }
  return [];
}

function htmlToText(content) {
  return String(content)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractFlomoMemoItems(content, file) {
  if (!/<div class="memo">/.test(content) || !/<div class="content">/.test(content)) return [];

  const items = [];
  const memoPattern = /<div class="memo">[\s\S]*?<div class="time">([\s\S]*?)<\/div>[\s\S]*?<div class="content">([\s\S]*?)<\/div>\s*<div class="files">/g;
  for (const match of content.matchAll(memoPattern)) {
    const time = cleanText(htmlToText(match[1]));
    const text = cleanText(htmlToText(match[2]));
    if (!text) continue;
    items.push({
      title: `${titleFromPath(file.relativePath)} ${time}`,
      text: time ? `${time}\n${text}` : text
    });
  }

  return items;
}

function dedupeItems(items) {
  const seen = new Map();
  for (const item of items) {
    const fingerprint = hashText(item.text);
    if (!seen.has(fingerprint)) {
      seen.set(fingerprint, { ...item, fingerprint, duplicateSources: [] });
      continue;
    }

    seen.get(fingerprint).duplicateSources.push(item.path);
  }

  return [...seen.values()];
}

function cleanText(text) {
  return String(text)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashText(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
}

function titleFromMarkdown(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : titleFromPath(fallback);
}

function titleFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function inputKindFromRelativePath(relativePath) {
  const parts = toWebPath(relativePath).split("/");
  const pathPart = parts[3] || "input";
  const category = categoryFromPathPart(pathPart);
  const sourceGroup = parts[4] ? sourceNameFromPathPart(parts[4]) : sourceNameFromPathPart(pathPart);

  if (category === "inbox") return { category, source: sourceGroup ? `inbox/${sourceGroup}` : "inbox" };
  if (category === "action") return { category, source: sourceGroup ? `action/${sourceGroup}` : "action" };
  if (category === "log") return { category, source: sourceGroup ? `log/${sourceGroup}` : "log" };
  return { category: categoryFromSourceName(sourceGroup), source: sourceGroup || "input" };
}

function categoryFromPathPart(part) {
  if (part === "00_log") return "log";
  if (part === "01_inbox") return "inbox";
  if (part === "02_action") return "action";
  return part;
}

function categoryFromSourceName(source) {
  if (["daily", "weekly"].includes(source)) return "log";
  if (["build", "build-bot", "research", "meeting", "chat", "feedback"].includes(source)) return "action";
  if (["ai", "flomo", "weread", "reading", "podcast", "docs", "theme-read"].includes(source)) return "inbox";
  return "input";
}

function sourceNameFromPathPart(part) {
  const extension = path.extname(part);
  return extension ? path.basename(part, extension) : part;
}

function distWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-W?(\d{1,2})$/, (_match, year, week) => `${year}-W${String(week).padStart(2, "0")}`);
}

export function currentIsoWeek(date = new Date()) {
  return isoWeekFromShanghaiDate(shanghaiDateParts(date));
}

export function defaultWeeklyReviewWeek(date = new Date()) {
  const shanghai = shanghaiDateParts(date);
  const target = shanghai.weekday >= 6 ? shanghai : shiftShanghaiDate(shanghai, -7);
  return isoWeekFromShanghaiDate(target);
}

function isoWeekFromShanghaiDate(parts) {
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function shanghaiDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  return { year, month, day, weekday };
}

function shiftShanghaiDate(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay() || 7;
  return { year, month, day, weekday };
}

export function isoWeekRange(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}. Use YYYY-WW or YYYY-Www, for example 2026-W22.`);

  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

function toWebPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function shortWeeklyPath(relativePath, weekPrefix) {
  const webPath = toWebPath(relativePath);
  return webPath.startsWith(weekPrefix) ? webPath.slice(weekPrefix.length) : webPath;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") {
      options.week = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { payload, outputPath } = await writeWeeklyInput(parseArgs(process.argv.slice(2)));
  console.log(`Collected ${payload.stats.uniqueItemCount} unique items from ${payload.stats.fileCount} files.`);
  console.log(`Input written: ${path.relative(repoRoot, outputPath)}`);
}

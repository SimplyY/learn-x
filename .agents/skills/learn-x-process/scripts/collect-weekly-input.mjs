import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const inputRoot = path.join(repoRoot, "input");
const outputRoot = path.join(repoRoot, "output/candidates");
const weeklyInputRoot = path.join(inputRoot, "weekly");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);
const ignoredFileNames = new Set(["README.md", ".gitkeep"]);

export async function collectWeeklyInput(options = {}) {
  const week = options.week || currentIsoWeek();
  const range = isoWeekRange(week);
  const manifest = await readWeeklyManifest(week);
  const files = manifest ? await collectManifestFiles(manifest) : await collectInputFiles();
  const inWeekFiles = [];
  const rawItems = [];

  for (const file of files) {
    const info = await stat(file.absolutePath);
    if (!manifest && (info.mtime < range.start || info.mtime >= range.end)) continue;

    inWeekFiles.push({
      path: file.relativePath,
      source: file.source,
      modifiedAt: info.mtime.toISOString(),
      size: info.size
    });

    const content = await readFile(file.absolutePath, "utf8");
    const parsedItems = parseInputFile(content, file);
    rawItems.push(
      ...parsedItems.map((item, index) => ({
        id: `${file.relativePath}#${index + 1}`,
        source: file.source,
        path: file.relativePath,
        modifiedAt: info.mtime.toISOString(),
        text: cleanText(item.text),
        title: item.title || titleFromPath(file.relativePath)
      }))
    );
  }

  const cleanedItems = rawItems.filter((item) => item.text.length >= 12);
  const uniqueItems = dedupeItems(cleanedItems);

  return {
    week,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString()
    },
    selection: manifest
      ? {
          mode: "manifest",
          path: manifest.relativePath,
          referencedPathCount: manifest.paths.length
        }
      : {
          mode: "mtime",
          path: null,
          referencedPathCount: 0
        },
    generatedAt: new Date().toISOString(),
    files: inWeekFiles,
    items: uniqueItems,
    stats: {
      fileCount: inWeekFiles.length,
      itemCount: cleanedItems.length,
      uniqueItemCount: uniqueItems.length,
      duplicateCount: cleanedItems.length - uniqueItems.length
    }
  };
}

export async function writeWeeklyInput(options = {}) {
  const payload = await collectWeeklyInput(options);
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `${payload.week}.input.json`);
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { payload, outputPath };
}

async function readWeeklyManifest(week) {
  const candidates = [`${week}.md`, `${week.replace("-", "-W")}.md`];
  for (const fileName of candidates) {
    const absolutePath = path.join(weeklyInputRoot, fileName);
    try {
      const content = await readFile(absolutePath, "utf8");
      return {
        absolutePath,
        relativePath: toWebPath(path.relative(repoRoot, absolutePath)),
        paths: parseManifestPaths(content)
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function parseManifestPaths(content) {
  const paths = new Set();
  const pathPattern = /(?:`([^`]+)`|(?<=^|[\s([{<])((?:input\/)[^\s)\]}>`]+))/gm;
  let ignoredSection = false;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      ignoredSection = /待确认|人工备注/.test(heading[1]);
      continue;
    }
    if (ignoredSection) continue;

    for (const match of line.matchAll(pathPattern)) {
      const rawPath = (match[1] || match[2] || "").trim();
      const cleanPath = rawPath.replace(/^\.?\//, "").split("#")[0].replace(/[，。,.;；:：]+$/, "");
      if (!cleanPath || cleanPath.startsWith("input/weekly/")) continue;
      paths.add(cleanPath);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

async function collectManifestFiles(manifest) {
  const files = [];
  for (const relativePath of manifest.paths) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!absolutePath.startsWith(inputRoot + path.sep)) continue;

    let info;
    try {
      info = await stat(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }

    if (info.isDirectory()) {
      files.push(...(await collectInputFiles(absolutePath, sourceFromRelativePath(relativePath))));
      continue;
    }

    if (!info.isFile()) continue;
    if (!supportedExtensions.has(path.extname(relativePath).toLowerCase())) continue;
    files.push({
      absolutePath,
      relativePath: toWebPath(path.relative(repoRoot, absolutePath)),
      source: sourceFromRelativePath(relativePath)
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
}

async function collectInputFiles(dir = inputRoot, source = "") {
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
    const nextSource = source || (dir === inputRoot ? entry.name : "input");

    if (entry.isDirectory()) {
      if (dir === inputRoot && entry.name === "weekly") continue;
      files.push(...(await collectInputFiles(absolutePath, nextSource)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("_")) continue;
    if (ignoredFileNames.has(entry.name)) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    files.push({ absolutePath, relativePath, source: nextSource });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
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
    return splitTextItems(htmlToText(content)).map((text, index) => ({
      title: `${titleFromPath(file.relativePath)} ${index + 1}`,
      text
    }));
  }

  return splitTextItems(content).map((text, index) => ({
    title: index === 0 ? titleFromMarkdown(content, file.relativePath) : `${titleFromPath(file.relativePath)} ${index + 1}`,
    text
  }));
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

function splitTextItems(content) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*(?:---|\*\*\*|#{1,3}\s+.+|[-*]\s+\[[ x]\])\s*\n/g)
    .map(cleanText)
    .filter(Boolean);

  if (blocks.length > 1) return blocks;

  const paragraphs = normalized.split(/\n{2,}/).map(cleanText).filter(Boolean);
  if (paragraphs.length > 1 && normalized.length > 1200) return paragraphs;

  return [normalized];
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

function sourceFromRelativePath(relativePath) {
  const parts = toWebPath(relativePath).split("/");
  return parts[0] === "input" && parts[1] ? parts[1] : "input";
}

export function currentIsoWeek(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function isoWeekRange(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}. Use YYYY-WW, for example 2026-22.`);

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

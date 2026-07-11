import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputKindFromRelativePath, isoWeekRange } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);
const ignoredNames = new Set(["README.md", ".gitkeep", "weekly-inputs.md"]);
const compressedSources = new Set(["ai", "research", "weread"]);
const highSignalTypes = new Set(["daily", "flomo"]);
const typeReviewThresholdBytes = 10 * 1024;

export async function collectMonthlyProcessInput(monthId) {
  const month = normalizeMonthId(monthId);
  const monthDir = inputMonthDirName(month);
  const files = [];

  for (const week of weeksIntersectingMonth(month)) {
    files.push(...await collectFiles(path.join(repoRoot, "03_input/weekly", week), { origin: "weekly", week }));
  }
  files.push(...await collectFiles(path.join(repoRoot, "03_input/monthly", monthDir), { origin: "monthly" }));

  const sources = [];
  const dailySections = [];
  const flomoSections = [];
  const fullItems = [];
  const compressionRequests = [];

  for (const file of files) {
    const buffer = await readFile(file.absolutePath);
    const info = await stat(file.absolutePath);
    const content = buffer.toString("utf8").replace(/\u0000/g, "");
    const kind = file.origin === "weekly"
      ? inputKindFromRelativePath(file.relativePath)
      : inputKindFromMonthlyPath(file.shortPath);
    const sourceName = baseSource(kind.source);
    const source = {
      id: `S${String(sources.length + 1).padStart(3, "0")}`,
      path: file.relativePath,
      shortPath: file.shortPath,
      origin: file.origin,
      week: file.week,
      category: kind.category,
      source: kind.source,
      modifiedAt: info.mtime.toISOString(),
      bytes: buffer.byteLength,
      chars: content.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      status: "pending",
      reason: ""
    };
    sources.push(source);

    if (isPlaceholder(content)) {
      source.status = "excluded";
      source.reason = "empty-or-placeholder";
      continue;
    }
    if (sourceName === "weread" && !wereadMatchesDeclaredWeek(content, file.week)) {
      source.status = "excluded";
      source.reason = "invalid-week-range";
      continue;
    }
    if (isOutsideMonth(content, month, file.week)) {
      source.status = "excluded";
      source.reason = "outside-target-month";
      continue;
    }

    if (sourceName === "daily") {
      const sections = datedSections(content).filter((section) => section.date.startsWith(month));
      if (!sections.length) {
        source.status = "excluded";
        source.reason = "no-target-month-daily-records";
        continue;
      }
      dailySections.push(...sections.map((section) => ({ ...section, source })));
      source.status = "included-merged";
      source.reason = "daily-metadata-merged";
      continue;
    }

    if (sourceName === "flomo") {
      const sections = datedSections(content).filter((section) => section.date.startsWith(month));
      if (!sections.length) {
        source.status = "excluded";
        source.reason = "no-target-month-flomo-records";
        continue;
      }
      flomoSections.push(...sections.map((section) => ({ ...section, source })));
      source.status = "included-merged";
      source.reason = "flomo-deduplicated";
      continue;
    }

    const filtered = filterBoundaryContent(content, month, file.week);
    if (requiresCompressionReview(sourceName)) {
      source.status = "compression-required";
      source.reason = "source-policy";
      compressionRequests.push(requestFromSource(source, month, filtered));
      continue;
    }

    if (isPlaceholder(filtered)) {
      source.status = "excluded";
      source.reason = "no-target-month-content";
      continue;
    }
    source.status = "included-full";
    fullItems.push(itemFromSource(source, stripSourceMetadata(filtered)));
  }

  const deterministicItems = [
    renderDailyTimeline(month, dailySections, sources),
    renderFlomoTimeline(month, flomoSections, sources),
    ...dedupeFullItems(fullItems, sources)
  ].filter(Boolean);
  const typeReview = reviewMonthlyTypes(deterministicItems);
  const items = [];
  for (const item of deterministicItems) {
    const review = typeReview.find((entry) => entry.type === item.source);
    if (!review || review.decision !== "compression-required") {
      items.push(item);
      continue;
    }
    for (const sourcePath of item.paths) {
      const source = sources.find((entry) => entry.path === sourcePath);
      if (!source || source.status === "excluded") continue;
      source.status = "compression-required";
      source.reason = `type-total-over-10kb:${item.source}`;
      compressionRequests.push(requestFromSource(source, month, item.text));
    }
  }

  return {
    schemaVersion: 2,
    month,
    generatedAt: new Date().toISOString(),
    selection: {
      mode: "weekly-plus-monthly",
      weeklyPaths: weeksIntersectingMonth(month).map((week) => `03_input/weekly/${week}`),
      monthlyPath: `03_input/monthly/${monthDir}`
    },
    sources,
    items,
    compressionRequests,
    typeReviews: typeReview,
    stats: buildStats(sources, items)
  };
}

async function collectFiles(dir, context) {
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
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, context));
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith("_") || ignoredNames.has(entry.name)) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    files.push({
      absolutePath,
      relativePath: toWebPath(path.relative(repoRoot, absolutePath)),
      shortPath: toWebPath(path.relative(dirForContext(context), absolutePath)),
      ...context
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
}

function dirForContext(context) {
  if (context.origin === "weekly") return path.join(repoRoot, "03_input/weekly", context.week);
  return path.join(repoRoot, "03_input/monthly");
}

function inputKindFromMonthlyPath(shortPath) {
  const file = path.basename(shortPath, path.extname(shortPath));
  if (["daily", "weekly", "health", "monthly-journal"].includes(file)) return { category: "log", source: file };
  if (["build", "build-bot", "research", "meeting", "chat", "feedback"].includes(file)) return { category: "action", source: file };
  if (["ai", "flomo", "weread", "reading", "podcast"].includes(file)) return { category: "inbox", source: file };
  return { category: "input", source: file };
}

function requestFromSource(source, month, text) {
  return {
    sourceId: source.id,
    path: source.path,
    sha256: source.sha256,
    month,
    category: source.category,
    source: baseSource(source.source),
    originalChars: text.length,
    reason: source.reason,
    rawText: text
  };
}

function itemFromSource(source, text) {
  return {
    id: `I-${source.id}`,
    title: firstHeading(text) || source.shortPath,
    category: source.category,
    source: baseSource(source.source),
    paths: [source.path],
    mode: "full",
    text: text.trim(),
    originalChars: source.chars,
    outputChars: text.trim().length
  };
}

function renderDailyTimeline(month, sections, sources) {
  const byDate = new Map();
  for (const section of sections) {
    const current = byDate.get(section.date);
    if (!current || section.text.length > current.text.length) {
      if (current) markDuplicateSource(current.source, sources, `daily:${section.date}`);
      byDate.set(section.date, section);
    } else {
      markDuplicateSource(section.source, sources, `daily:${section.date}`);
    }
  }
  if (!byDate.size) return null;
  const dates = [...byDate.keys()].sort();
  const missing = daysInMonth(month).filter((date) => !byDate.has(date));
  const selected = dates.map((date) => byDate.get(date));
  const text = [
    `# ${month} 日记时间线`,
    "",
    `- 来源：飞书日记周度/月度原始输入（重复元数据已合并）`,
    `- 覆盖：${dates[0]} 至 ${dates.at(-1)}`,
    `- 记录日：${dates.length} 天`,
    `- 缺失日：${missing.length ? missing.join("、") : "无"}`,
    "",
    ...selected.map((entry) => stripSourceMetadata(entry.text))
  ].join("\n");
  return {
    id: "I-DAILY",
    title: `${month} 日记时间线`,
    category: "log",
    source: "daily",
    paths: [...new Set(selected.map((entry) => entry.source.path))],
    mode: "merged",
    text,
    originalChars: sections.reduce((sum, entry) => sum + entry.text.length, 0),
    outputChars: text.length
  };
}

function renderFlomoTimeline(month, sections, sources) {
  const seen = new Set();
  const kept = [];
  for (const section of sections.sort((a, b) => a.date.localeCompare(b.date))) {
    const fingerprint = normalizedHash(stripSourceMetadata(section.text));
    if (seen.has(fingerprint)) {
      markDuplicateSource(section.source, sources, `flomo:${fingerprint}`);
      continue;
    }
    seen.add(fingerprint);
    kept.push(section);
  }
  if (!kept.length) return null;
  const text = [`# ${month} Flomo`, "", ...kept.map((entry) => stripSourceMetadata(entry.text))].join("\n");
  return {
    id: "I-FLOMO",
    title: `${month} Flomo`,
    category: "inbox",
    source: "flomo",
    paths: [...new Set(kept.map((entry) => entry.source.path))],
    mode: "deduplicated",
    text,
    originalChars: sections.reduce((sum, entry) => sum + entry.text.length, 0),
    outputChars: text.length
  };
}

function dedupeFullItems(items, sources) {
  const seen = new Map();
  const kept = [];
  for (const item of items) {
    const fingerprint = normalizedHash(item.text);
    if (seen.has(fingerprint)) {
      const source = sources.find((entry) => entry.path === item.paths[0]);
      if (source) {
        source.status = "excluded";
        source.reason = `duplicate-of:${seen.get(fingerprint).paths[0]}`;
      }
      continue;
    }
    seen.set(fingerprint, item);
    kept.push(item);
  }
  return kept;
}

function markDuplicateSource(source, sources, group) {
  const target = sources.find((entry) => entry.id === source.id);
  if (target) target.dedupeGroup = group;
}

export function datedSections(content) {
  const matches = [...String(content).matchAll(/^#{2,5}\s+(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2})?[^\n]*$/gm)];
  return matches.map((match, index) => ({
    date: match[1],
    text: content.slice(match.index, matches[index + 1]?.index ?? content.length).trim()
  }));
}

export function filterBoundaryContent(content, month, week) {
  if (week && weekFullyInsideMonth(week, month)) return content.trim();
  const sections = datedSections(content);
  if (!sections.length) return content.trim();
  return sections.filter((section) => section.date.startsWith(month)).map((section) => section.text).join("\n\n").trim();
}

function isOutsideMonth(content, month, week) {
  if (week && weekFullyInsideMonth(week, month)) return false;
  const dates = headingDates(content);
  if (dates.length) return dates.every((date) => !date.startsWith(month));
  const range = declaredRange(content);
  return range ? !rangeIntersectsMonth(range, month) : false;
}

function headingDates(content) {
  return [...String(content).matchAll(/^#{1,5}\s+.*?(\d{4}-\d{2}-\d{2})/gm)].map((match) => match[1]);
}

function declaredRange(content) {
  const match = String(content).match(/(?:覆盖期|覆盖范围|时间范围|采集范围)[^\n]*?(\d{4}-\d{2}-\d{2})[^\n]*?(\d{4}-\d{2}-\d{2})/);
  return match ? { start: match[1], end: match[2] } : null;
}

export function wereadMatchesDeclaredWeek(content, week) {
  if (!week) return true;
  const dates = [
    ...String(content).matchAll(/^#####\s+.+?｜(\d{4}-\d{2}-\d{2})$/gm),
    ...String(content).matchAll(/^- (\d{4}-\d{2}-\d{2})（周[一二三四五六日]）：/gm)
  ].map((match) => match[1]);
  if (!dates.length) return true;
  const range = isoWeekRange(week);
  return dates.every((date) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    return time >= range.start.getTime() && time < range.end.getTime();
  });
}

function stripSourceMetadata(text) {
  return String(text)
    .replace(/^(?:- )?(?:来源|采集时间|生成时间|采集方式|定位依据|覆盖期|覆盖范围|时间范围|采集范围|时区|接口[^：]*|表|Base)[：：][^\n]*\n/gim, "")
    .replace(/^## 字段表头[\s\S]*?(?=^## \d{4}-\d{2}-\d{2}|(?![\s\S]))/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isPlaceholder(content) {
  const text = String(content).replace(/[#>*_`|\s-]/g, "").trim();
  return text.length < 12 || /^(x+|待补充|暂无|无|todo|placeholder)$/i.test(text);
}

export function requiresCompressionReview(sourceName) {
  return compressedSources.has(sourceName);
}

export function reviewMonthlyTypes(items) {
  const totals = new Map();
  for (const item of items) totals.set(item.source, (totals.get(item.source) || 0) + Buffer.byteLength(item.text));
  return [...totals].map(([type, bytes]) => ({
    type,
    bytes,
    thresholdBytes: typeReviewThresholdBytes,
    decision: bytes <= typeReviewThresholdBytes
      ? "below-threshold"
      : highSignalTypes.has(type) ? "keep-full" : "compression-required",
    reason: bytes <= typeReviewThresholdBytes
      ? "monthly-type-total-at-or-below-10kb"
      : highSignalTypes.has(type)
        ? "high-signal-original-records-with-deterministic-deduplication"
        : "monthly-type-total-over-10kb-requires-codex-value-review"
  }));
}

function baseSource(source) {
  return String(source).split("/").at(-1).replace(/\.md$/, "");
}

function firstHeading(text) {
  return String(text).match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function normalizedHash(text) {
  return createHash("sha1").update(String(text).toLowerCase().replace(/\s+/g, "")).digest("hex").slice(0, 12);
}

function rangeIntersectsMonth(range, month) {
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month).length).padStart(2, "0")}`;
  return range.start <= end && range.end >= start;
}

function weekFullyInsideMonth(week, month) {
  const range = isoWeekRange(week);
  const start = range.start.toISOString().slice(0, 7);
  const end = new Date(range.end.getTime() - 1).toISOString().slice(0, 7);
  return start === month && end === month;
}

export function weeksIntersectingMonth(monthId) {
  const month = normalizeMonthId(monthId);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  const monday = new Date(first);
  monday.setUTCDate(first.getUTCDate() - ((first.getUTCDay() || 7) - 1));
  const weeks = [];
  for (const date = monday; date <= last; date.setUTCDate(date.getUTCDate() + 7)) weeks.push(isoWeekId(date));
  return weeks;
}

function isoWeekId(date) {
  const target = new Date(date);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function buildStats(sources, items) {
  return {
    sourceCount: sources.length,
    sourceBytes: sources.reduce((sum, source) => sum + source.bytes, 0),
    includedSourceCount: sources.filter((source) => source.status.startsWith("included")).length,
    excludedSourceCount: sources.filter((source) => source.status === "excluded").length,
    compressionSourceCount: sources.filter((source) => source.status === "compression-required").length,
    deterministicOutputChars: items.reduce((sum, item) => sum + item.outputChars, 0)
  };
}

export function normalizeMonthId(monthId) {
  const match = String(monthId).match(/^(\d{4})-(\d{1,2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`Invalid month: ${monthId}`);
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
}

function inputMonthDirName(month) {
  return month.replace(/^(\d{4})-0(\d)$/, "$1-$2");
}

function toWebPath(filePath) {
  return filePath.split(path.sep).join("/");
}

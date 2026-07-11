import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectMonthlyProcessInput, normalizeMonthId } from "./monthly-process-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const maxPackBytes = 100 * 1024;
const eventLimits = {
  core: { min: 3000, max: 5000 },
  supporting: { min: 800, max: 1500 },
  minor: { min: 300, max: 500 }
};

export async function generateMonthlyProcessPack(options = {}) {
  const months = options.months?.length ? options.months : [currentMonthId()];
  const results = [];

  for (const monthId of months) {
    const payload = await collectMonthlyProcessInput(monthId);
    const outputRoot = path.join(repoRoot, "04_output/_dist/monthly", payload.month);
    await mkdir(outputRoot, { recursive: true });
    const requestsPath = path.join(outputRoot, "compression-requests.json");
    const compressedPath = path.join(outputRoot, "compressed-events.json");
    const inputPath = path.join(outputRoot, "input.json");
    const processPackPath = path.join(outputRoot, "process-pack.md");

    await writeFile(requestsPath, `${JSON.stringify({
      schemaVersion: 1,
      month: payload.month,
      generatedAt: payload.generatedAt,
      requests: payload.compressionRequests.map(({ rawText: _rawText, ...request }) => request)
    }, null, 2)}\n`, "utf8");

    const compression = await loadCompression(compressedPath, payload);
    const items = [...payload.items, ...compression.items];
    const processPack = renderProcessPack(payload, compression, items);
    const processPackBytes = Buffer.byteLength(processPack);
    if (processPackBytes > maxPackBytes) {
      throw new Error(`Monthly Process Pack is ${processPackBytes} bytes; compress supporting/minor events below ${maxPackBytes} bytes before retrying.`);
    }

    const manifest = renderManifest(payload, compression, items, processPackBytes);
    await writeFile(inputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(processPackPath, processPack, "utf8");
    const shellPath = await ensureMonthlyOutputShell(payload.month);
    results.push({ payload, compression, inputPath, processPackPath, requestsPath, compressedPath, shellPath, processPackBytes });
  }

  return results;
}

async function loadCompression(compressedPath, payload) {
  if (!payload.compressionRequests.length) return { items: [], omissions: [], stats: emptyCompressionStats() };
  let document;
  try {
    document = JSON.parse(await readFile(compressedPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Compression required. Fill ${path.relative(repoRoot, compressedPath)} from compression-requests.json, then rerun.`);
    }
    throw new Error(`Invalid compressed-events.json: ${error.message}`);
  }
  if (document.schemaVersion !== 1 || document.month !== payload.month) {
    throw new Error(`compressed-events.json must use schemaVersion 1 and month ${payload.month}.`);
  }

  return validateCompressionDocument(document, payload);
}

export function validateCompressionDocument(document, payload) {

  const requests = new Map(payload.compressionRequests.map((request) => [request.path, request]));
  const covered = new Set();
  const events = [];
  for (const [index, event] of (document.events || []).entries()) {
    if (!eventLimits[event.importance]) throw new Error(`Compression event ${event.id || index + 1} has invalid importance.`);
    const text = String(event.text || "").trim();
    const textBytes = Buffer.byteLength(text);
    const limit = eventLimits[event.importance];
    if (!text || textBytes < limit.min || textBytes > limit.max) {
      throw new Error(`Compression event ${event.id || index + 1} must be ${limit.min}-${limit.max} UTF-8 bytes.`);
    }
    if (!Array.isArray(event.sourcePaths) || !event.sourcePaths.length) throw new Error(`Compression event ${event.id || index + 1} has no sources.`);
    for (const sourcePath of event.sourcePaths) {
      const request = requests.get(sourcePath);
      if (!request) throw new Error(`Compression event references an unrequested source: ${sourcePath}`);
      if (event.sourceHashes?.[sourcePath] !== request.sha256) throw new Error(`Compression source hash mismatch: ${sourcePath}`);
      covered.add(sourcePath);
    }
    if (!dateRangeInsideMonth(event.dateRange, payload.month)) throw new Error(`Compression event ${event.id || index + 1} is outside ${payload.month}.`);
    events.push({
      id: event.id || `E${String(index + 1).padStart(3, "0")}`,
      title: String(event.title || "压缩事件").trim(),
      category: event.category || "input",
      source: event.source || "compressed",
      paths: event.sourcePaths,
      mode: "compressed",
      importance: event.importance,
      dateRange: event.dateRange,
      text,
      originalChars: event.sourcePaths.reduce((sum, sourcePath) => sum + requests.get(sourcePath).originalChars, 0),
      outputChars: text.length
    });
  }

  const passthroughs = [];
  for (const [index, entry] of (document.passthroughs || []).entries()) {
    const request = requests.get(entry.sourcePath);
    if (!request || !request.reason.startsWith("type-total-over-10kb:")) {
      throw new Error(`Only sources from a reviewed monthly type over 10 KB may pass through: ${entry.sourcePath || index + 1}`);
    }
    if (entry.sourceHash !== request.sha256 || String(entry.reason || "").trim().length < 12) {
      throw new Error(`Invalid pass-through decision: ${entry.sourcePath}`);
    }
    if (!dateRangeInsideMonth(entry.dateRange, payload.month)) throw new Error(`Pass-through source is outside ${payload.month}: ${entry.sourcePath}`);
    covered.add(entry.sourcePath);
    passthroughs.push({
      id: entry.id || `P${String(index + 1).padStart(3, "0")}`,
      title: String(entry.title || path.basename(entry.sourcePath)).trim(),
      category: request.category,
      source: request.source,
      paths: [entry.sourcePath],
      mode: "full-reviewed",
      importance: "core",
      dateRange: entry.dateRange,
      text: request.rawText.trim(),
      originalChars: request.originalChars,
      outputChars: request.rawText.trim().length,
      decisionReason: entry.reason
    });
  }

  const omissions = [];
  for (const omission of document.omissions || []) {
    const request = requests.get(omission.sourcePath);
    if (!request || omission.sourceHash !== request.sha256 || !String(omission.reason || "").trim()) {
      throw new Error(`Invalid compression omission: ${omission.sourcePath || "unknown"}`);
    }
    covered.add(omission.sourcePath);
    omissions.push(omission);
  }
  const missing = [...requests.keys()].filter((sourcePath) => !covered.has(sourcePath));
  if (missing.length) throw new Error(`Compression sources not covered: ${missing.join(", ")}`);

  const originalChars = payload.compressionRequests.reduce((sum, request) => sum + request.originalChars, 0);
  const outputChars = [...events, ...passthroughs].reduce((sum, event) => sum + event.outputChars, 0);
  return {
    items: [...events, ...passthroughs],
    omissions,
    stats: {
      sourceCount: payload.compressionRequests.length,
      eventCount: events.length,
      passThroughCount: passthroughs.length,
      omissionCount: omissions.length,
      originalChars,
      outputChars,
      ratio: originalChars ? Number((outputChars / originalChars).toFixed(4)) : 0
    }
  };
}

function renderManifest(payload, compression, items, processPackBytes) {
  const compressionByPath = allocateCompressionBySource(compression.items, payload.compressionRequests);
  return {
    schemaVersion: 2,
    month: payload.month,
    generatedAt: payload.generatedAt,
    selection: payload.selection,
    typeReviews: payload.typeReviews.map((review) => {
      const finalItems = items.filter((item) => item.source === review.type);
      const outputBytes = finalItems.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
      return {
        ...review,
        outputBytes,
        outputEventCount: finalItems.length,
        ratio: review.bytes ? Number((outputBytes / review.bytes).toFixed(4)) : 0
      };
    }),
    sources: payload.sources.map((source) => ({
      ...source,
      ...(compressionByPath.get(source.path) ? { compression: compressionByPath.get(source.path) } : {})
    })),
    events: items.map(({ text: _text, ...item }) => item),
    omissions: compression.omissions,
    stats: {
      ...payload.stats,
      compression: compression.stats,
      finalEventCount: items.length,
      finalContextChars: items.reduce((sum, item) => sum + item.outputChars, 0),
      processPackBytes
    }
  };
}

function allocateCompressionBySource(events, requests) {
  const requestByPath = new Map(requests.map((request) => [request.path, request]));
  const totals = new Map();
  for (const event of events) {
    const eventOriginal = event.paths.reduce((sum, sourcePath) => sum + requestByPath.get(sourcePath).originalChars, 0);
    for (const sourcePath of event.paths) {
      const request = requestByPath.get(sourcePath);
      const current = totals.get(sourcePath) || { eventIds: [], allocatedOutputChars: 0 };
      current.eventIds.push(event.id);
      current.allocatedOutputChars += Math.round(event.outputChars * request.originalChars / eventOriginal);
      totals.set(sourcePath, current);
    }
  }
  for (const [sourcePath, value] of totals) {
    const originalChars = requestByPath.get(sourcePath).originalChars;
    value.ratio = originalChars ? Number((value.allocatedOutputChars / originalChars).toFixed(4)) : 0;
  }
  return totals;
}

function renderProcessPack(payload, compression, items) {
  const rawChars = payload.sources.reduce((sum, source) => sum + source.chars, 0);
  const finalChars = items.reduce((sum, item) => sum + item.outputChars, 0);
  const lines = [
    `# Learn-X Monthly Process Pack｜${payload.month}`,
    "",
    "> 这是给 AI Chat 生成 Monthly Output 的自包含上下文，不是原始 Input，也不是最终月报。",
    "> 已移除越界时间、空占位、重复采集元数据和重复材料；压缩事件保留来源路径，完整原文仍在 `03_input/`。",
    "",
    "## 1. 处理与压缩概览",
    "",
    `- 目标月：${payload.month}`,
    `- 周度输入：${payload.selection.weeklyPaths.map((entry) => `\`${entry}\``).join("、")}`,
    `- 月度独有输入：\`${payload.selection.monthlyPath}\``,
    `- 原始来源：${payload.stats.sourceCount} 个，${rawChars} 字符`,
    `- 确定性材料：${payload.items.length} 个，${payload.stats.deterministicOutputChars} 字符`,
    `- 压缩来源：${compression.stats.sourceCount} 个 → ${compression.stats.eventCount} 个事件，${compression.stats.originalChars} → ${compression.stats.outputChars} 字符`,
    `- 最终上下文正文：${items.length} 个事件，${finalChars} 字符`,
    "",
    `- 排除来源：${payload.stats.excludedSourceCount} 个；详细原因见同目录 \`input.json\``,
    "",
    "## 2. 月度材料",
    ""
  ];

  for (const [index, item] of items.entries()) {
    lines.push(
      `### M${String(index + 1).padStart(3, "0")}｜${item.title}`,
      "",
      `- 类型：${item.category} / ${item.source}`,
      `- 来源：${item.paths.map((entry) => `\`${entry}\``).join("、")}`,
      ...(item.dateRange ? [`- 日期：${item.dateRange.start} 至 ${item.dateRange.end}`] : []),
      ...(item.importance ? [`- 重要性：${importanceLabel(item.importance)}`] : []),
      "",
      item.text,
      ""
    );
  }
  return `${lines.join("\n").trim()}\n`;
}

function importanceLabel(importance) {
  return ({ core: "核心", supporting: "支撑", minor: "次要" })[importance] || importance;
}

function dateRangeInsideMonth(dateRange, month) {
  return dateRange
    && validIsoDate(dateRange.start)
    && validIsoDate(dateRange.end)
    && dateRange.start.startsWith(month)
    && dateRange.end.startsWith(month)
    && dateRange.start <= dateRange.end;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function emptyCompressionStats() {
  return { sourceCount: 0, eventCount: 0, passThroughCount: 0, omissionCount: 0, originalChars: 0, outputChars: 0, ratio: 0 };
}

async function ensureMonthlyOutputShell(month) {
  const outputPath = path.join(repoRoot, "04_output/monthly", `${month}.md`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing.trim()) return outputPath;
  await writeFile(outputPath, `# Learn-X Monthly Output｜${month}\n\n> 基于 \`04_output/_dist/monthly/${month}/process-pack.md\` 由用户使用 AI Chat 生成正文后填入。\n`, "utf8");
  return outputPath;
}

function currentMonthId(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseArgs(argv) {
  const options = { months: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--month") options.months.push(normalizeMonthId(argv[++index]));
    if (argv[index] === "--months") options.months.push(...argv[++index].split(",").map(normalizeMonthId));
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const results = await generateMonthlyProcessPack(parseArgs(process.argv.slice(2)));
    for (const result of results) {
      console.log(`Monthly process pack generated: ${path.relative(repoRoot, result.processPackPath)}`);
      console.log(`Monthly audit manifest generated: ${path.relative(repoRoot, result.inputPath)}`);
      console.log(`Process Pack: ${result.processPackBytes} bytes`);
      console.log(`Compression: ${result.compression.stats.originalChars} -> ${result.compression.stats.outputChars} characters`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

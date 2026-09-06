import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectMonthlyProcessInput, monthlyCompressionPolicies, monthlyVoiceMaxChars, monthlyVoiceMaxRatio, monthlyVoiceMinRatio, normalizeMonthId } from "./monthly-process-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const maxPackBytes = 100 * 1024;
const importanceLevels = new Set(["core", "supporting", "minor"]);

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
    const compressionReviewDir = await writeCompressionReviewFiles(outputRoot, payload, compression);
    const shellPath = await ensureMonthlyOutputShell(payload.month);
    results.push({ payload, compression, inputPath, processPackPath, requestsPath, compressedPath, compressionReviewDir, shellPath, processPackBytes });
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
  const individuallyCoveredAi = new Set();
  const events = [];
  for (const [index, event] of (document.events || []).entries()) {
    if (!importanceLevels.has(event.importance)) throw new Error(`Compression event ${event.id || index + 1} has invalid importance.`);
    const text = String(event.text || "").trim();
    if (!text) throw new Error(`Compression event ${event.id || index + 1} has no content.`);
    if (!Array.isArray(event.sourcePaths) || !event.sourcePaths.length) throw new Error(`Compression event ${event.id || index + 1} has no sources.`);
    const eventRequests = [];
    for (const sourcePath of event.sourcePaths) {
      const request = requests.get(sourcePath);
      if (!request) throw new Error(`Compression event references an unrequested source: ${sourcePath}`);
      if (event.sourceHashes?.[sourcePath] !== request.sha256) throw new Error(`Compression source hash mismatch: ${sourcePath}`);
      eventRequests.push(request);
      covered.add(sourcePath);
    }
    const aiRequests = eventRequests.filter((request) => request.source === "ai");
    if (aiRequests.length && event.source !== "ai-synthesis") {
      if (eventRequests.length !== 1 || event.importance !== "core") {
        throw new Error(`AI review event ${event.id || index + 1} must preserve one weekly source as a core event.`);
      }
      individuallyCoveredAi.add(aiRequests[0].path);
    }
    validateStructuredCompressionText(text, event.id || index + 1, eventRequests);
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
  const missingAi = [...requests.values()]
    .filter((request) => request.source === "ai" && !individuallyCoveredAi.has(request.path))
    .map((request) => request.path);
  if (missingAi.length) throw new Error(`AI weekly reviews require individual core events: ${missingAi.join(", ")}`);

  const originalChars = payload.compressionRequests.reduce((sum, request) => sum + request.originalChars, 0);
  const outputChars = [...events, ...passthroughs].reduce((sum, event) => sum + event.outputChars, 0);
  const voiceOutputChars = [...events, ...passthroughs]
    .filter((event) => event.source === "voice")
    .reduce((sum, event) => sum + event.outputChars, 0);
  const voiceCoveredPaths = new Set([...events, ...passthroughs].flatMap((event) => event.paths));
  const voiceOriginalChars = [...requests.values()]
    .filter((request) => request.source === "voice" && voiceCoveredPaths.has(request.path))
    .reduce((sum, request) => sum + request.originalChars, 0);
  const voiceMinChars = Math.ceil(voiceOriginalChars * monthlyVoiceMinRatio);
  const voiceMaxChars = Math.floor(voiceOriginalChars * monthlyVoiceMaxRatio);
  if (voiceOriginalChars && voiceOutputChars < voiceMinChars) {
    throw new Error(`Monthly Voice compression is ${voiceOutputChars} characters; keep at least ${voiceMinChars} characters (${monthlyVoiceMinRatio * 100}% of source).`);
  }
  if (voiceOriginalChars && voiceOutputChars > voiceMaxChars) {
    throw new Error(`Monthly Voice compression is ${voiceOutputChars} characters; keep at most ${voiceMaxChars} characters (${monthlyVoiceMaxRatio * 100}% of source).`);
  }
  if (voiceOutputChars > monthlyVoiceMaxChars) {
    throw new Error(`Monthly Voice compression is ${voiceOutputChars} characters; keep only core events below ${monthlyVoiceMaxChars}.`);
  }
  const ratioGuidance = [];
  for (const [source, policy] of Object.entries(monthlyCompressionPolicies)) {
    const sourcePaths = new Set([...requests.values()].filter((request) => request.source === source).map((request) => request.path));
    const originalChars = [...requests.values()]
      .filter((request) => sourcePaths.has(request.path) && !omissions.some((omission) => omission.sourcePath === request.path))
      .reduce((sum, request) => sum + request.originalChars, 0);
    if (!originalChars) continue;
    const outputChars = [...events, ...passthroughs]
      .filter((event) => event.paths.some((sourcePath) => sourcePaths.has(sourcePath)))
      .reduce((sum, event) => sum + event.outputChars, 0);
    const ratio = outputChars / originalChars;
    const minRatio = policy.minRatio ?? 0.01;
    const maxRatio = policy.maxRatio ?? 0.10;
    const recommendedRatio = minRatio + (maxRatio - minRatio) * policy.signalToNoise;
    ratioGuidance.push({ source, signalToNoise: policy.signalToNoise, originalChars, outputChars, actualRatio: Number(ratio.toFixed(4)), recommendedRatio: Number(recommendedRatio.toFixed(4)), minRatio, maxRatio });
    if (policy.minRatio != null && (ratio < policy.minRatio || ratio > policy.maxRatio)) {
      throw new Error(`Monthly ${source} compression is ${(ratio * 100).toFixed(2)}%; keep between ${policy.minRatio * 100}% and ${policy.maxRatio * 100}%.`);
    }
  }
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
      ratio: originalChars ? Number((outputChars / originalChars).toFixed(4)) : 0,
      ratioGuidance
    }
  };
}

async function writeCompressionReviewFiles(outputRoot, payload, compression) {
  const reviewDir = path.join(outputRoot, "compression-review");
  await mkdir(reviewDir, { recursive: true });
  const requestsBySource = new Map();
  for (const request of payload.compressionRequests) {
    if (!requestsBySource.has(request.source)) requestsBySource.set(request.source, []);
    requestsBySource.get(request.source).push(request);
  }
  const sourceFiles = [];
  for (const [source, requests] of [...requestsBySource.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))) {
    const requestPaths = new Set(requests.map((request) => request.path));
    const omittedPaths = new Set(compression.omissions.map((omission) => omission.sourcePath));
    const compressedItems = compression.items.filter((item) => item.paths.some((sourcePath) => requestPaths.has(sourcePath)));
    const originalChars = requests.reduce((sum, request) => sum + request.originalChars, 0);
    const includedOriginalChars = requests.filter((request) => !omittedPaths.has(request.path)).reduce((sum, request) => sum + request.originalChars, 0);
    const outputChars = compressedItems.reduce((sum, item) => sum + item.outputChars, 0);
    const fileName = `${safeReviewName(source)}.md`;
    const lines = [
      `# 月度压缩审阅｜${payload.month}｜${source}`,
      "",
      "> 临时审阅文件：原始 Input 保持原文；下方附本类型进入 Process Pack 的压缩结果。",
      `> 全部原始字符：${originalChars}；本月纳入原始字符：${includedOriginalChars}；压缩字符：${outputChars}；本月纳入保留比例：${includedOriginalChars ? (outputChars / includedOriginalChars * 100).toFixed(2) : "0.00"}%`,
      "",
      "## 原始 Input",
      ""
    ];
    for (const request of requests) {
      lines.push(`### ${request.path}`, "", `- 原始字符：${request.originalChars}`, `- 处理状态：${omittedPaths.has(request.path) ? "本月未纳入 Process Pack" : "本月纳入"}`, "", request.rawText.trim(), "");
    }
    lines.push("## 压缩后进入 Process Pack 的内容", "");
    if (!compressedItems.length) lines.push("- 本类型没有进入 Pack 的压缩事件。", "");
    for (const item of compressedItems) {
      lines.push(`### ${item.id}｜${item.title}`, "", `- 来源：${item.paths.map((entry) => `\`${entry}\``).join("、")}`, `- 压缩字符：${item.outputChars}`, "", item.text, "");
    }
    await writeFile(path.join(reviewDir, fileName), `${lines.join("\n").trim()}\n`, "utf8");
    const policy = monthlyCompressionPolicies[source];
    const minRatio = policy?.minRatio ?? 0.01;
    const maxRatio = policy?.maxRatio ?? 0.10;
    const recommendedRatio = policy ? minRatio + (maxRatio - minRatio) * policy.signalToNoise : null;
    sourceFiles.push({ source, fileName, originalChars, includedOriginalChars, outputChars, signalToNoise: policy?.signalToNoise, recommendedRatio });
  }
  const indexLines = [
    `# 月度压缩审阅索引｜${payload.month}`,
    "",
    "> 点击来源类型即可查看原始 Input 与对应的压缩结果。文件位于本次月度 `_dist` 临时目录。",
    "",
    "| Input 文件类型 | 信噪比 | 推荐保留 | 全部原始字符 | 本月纳入原始字符 | 压缩字符 | 纳入保留比例 | 审阅文件 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...sourceFiles.map(({ source, fileName, originalChars, includedOriginalChars, outputChars, signalToNoise, recommendedRatio }) => `| ${source} | ${signalToNoise == null ? "—" : signalToNoise.toFixed(2)} | ${recommendedRatio == null ? "—" : (recommendedRatio * 100).toFixed(1) + "%"} | ${originalChars} | ${includedOriginalChars} | ${outputChars} | ${includedOriginalChars ? (outputChars / includedOriginalChars * 100).toFixed(2) : "0.00"}% | [打开原文与压缩结果](./${fileName}) |`),
    ""
  ];
  await writeFile(path.join(reviewDir, "index.md"), `${indexLines.join("\n")}\n`, "utf8");
  return reviewDir;
}

function safeReviewName(source) {
  return String(source).replace(/[^\p{L}\p{N}._-]+/gu, "-");
}

export function validateStructuredCompressionText(text, eventId, requests = []) {
  const lines = String(text).split("\n");
  const bulletCount = lines.filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line)).length;
  if (bulletCount < 2) throw new Error(`Compression event ${eventId} must use structured bullet points instead of a flat paragraph.`);
  const longLine = lines.find((line) => !/^\s*(?:#{1,6}|[-*]|\d+\.)\s+/.test(line) && line.trim().length > 180);
  if (longLine) throw new Error(`Compression event ${eventId} contains an unstructured paragraph over 180 characters.`);

  const aiRequests = requests.filter((request) => request.source === "ai");
  if (!aiRequests.length) return;
  if (lines.filter((line) => /^####\s+\S/.test(line)).length < 3) {
    throw new Error(`AI review event ${eventId} must contain at least three structured subsections.`);
  }
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

export function renderProcessPack(payload, compression, items) {
  const rawChars = payload.sources.reduce((sum, source) => sum + source.chars, 0);
  const finalChars = items.reduce((sum, item) => sum + item.outputChars, 0);
  const lines = [
    `# Learn-X Monthly Process Pack｜${payload.month}`,
    "",
    "> 这是给 AI Chat 生成 Monthly Output 的自包含上下文，不是原始 Input，也不是最终月报。",
    "> 已移除越界时间、空占位、重复采集元数据和重复材料；压缩事件保留来源路径，完整原文仍在 `03_input/`。",
    "",
    "## 0. 完整性与缺口",
    "",
    `- 目标月：${payload.month}`,
    `- 周度输入：${payload.selection.weeklyPaths.map((entry) => `\`${entry}\``).join("、")}`,
    `- 未提供相交周：${payload.selection.missingWeeklyPaths?.length ? payload.selection.missingWeeklyPaths.map((entry) => `\`${entry}\``).join("、") : "无"}（仅记录缺口，不阻断生成）`,
    `- 月度独有输入：\`${payload.selection.monthlyPath}\``,
    `- 原始来源：${payload.stats.sourceCount} 个，${rawChars} 字符`,
    `- 确定性材料：${payload.items.length} 个，${payload.stats.deterministicOutputChars} 字符`,
    `- 压缩来源：${compression.stats.sourceCount} 个 → ${compression.stats.eventCount} 个事件，${compression.stats.originalChars} → ${compression.stats.outputChars} 字符`,
    `- 最终上下文正文：${items.length} 个事件，${finalChars} 字符`,
    "",
    `- 缺口与排除：${payload.stats.excludedSourceCount} 个来源；逐项原因见同目录 \`input.json\``,
    ""
  ];

  lines.push("## 1. 按 Input 文件类型组织的材料", "");
  let itemIndex = 0;
  for (const group of groupSourceItems(items)) {
    const summary = sourceGroupSummary(payload, group.items);
    lines.push(
      `### ${group.index}. \`${group.source}\``,
      "",
      `- 来源文件：${summary.paths.length} 个，${summary.paths.map((entry) => `\`${entry}\``).join("、")}`,
      `- 原始字符：${summary.rawChars}；进入 Pack：${group.items.length} 个事件，${summary.outputChars} 字符`,
      ...(renderSourcePolicySummary(group.source) ? [`- 信噪比策略：${renderSourcePolicySummary(group.source)}`] : []),
      ""
    );
    for (const item of group.items) {
      itemIndex += 1;
      lines.push(
        `#### M${String(itemIndex).padStart(3, "0")}｜${item.title}`,
        "",
        `- 类型：${item.category} / ${item.source}`,
        `- 来源：${item.paths.map((entry) => `\`${entry}\``).join("、")}`,
        ...(item.dateRange ? [`- 日期：${item.dateRange.start} 至 ${item.dateRange.end}`] : []),
        ...(item.importance ? [`- 重要性：${importanceLabel(item.importance)}`] : []),
        "",
        demoteEmbeddedHeadings(item.text),
        ""
      );
    }
  }
  lines.push(
    "## 2. 来源与处理审计",
    "",
    `- 原始来源：${payload.stats.sourceCount} 个；最终事件：${items.length} 个。`,
    `- 语义压缩：${compression.stats.sourceCount} 个来源，${compression.stats.originalChars} → ${compression.stats.outputChars} 字符。`,
    "- 原始文件、哈希、压缩率、排除和省略原因：见同目录 `input.json`。",
    ""
  );
  return `${lines.join("\n").trim()}\n`;
}

const sourcePriority = new Map([
  ["monthly-journal", 0], ["ai", 1], ["ai-synthesis", 2], ["weekly-core", 3], ["weekly-munger", 4],
  ["weekly", 10], ["daily", 11], ["flomo", 12], ["health", 13], ["voice", 14],
  ["coach", 20], ["build", 21], ["build-bot", 22],
  ["weread", 30], ["calendar", 31], ["time", 32], ["research", 33], ["podcast", 34]
]);

function comparePackItems(left, right) {
  return (sourcePriority.get(left.source) ?? 99) - (sourcePriority.get(right.source) ?? 99)
    || left.paths[0].localeCompare(right.paths[0], "zh-Hans-CN")
    || left.title.localeCompare(right.title, "zh-Hans-CN");
}

function groupSourceItems(items) {
  const groups = new Map();
  for (const item of items) {
    const sourceGroup = inputSourceGroup(item);
    if (!groups.has(sourceGroup)) groups.set(sourceGroup, []);
    groups.get(sourceGroup).push(item);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => sourceGroupPriority(left) - sourceGroupPriority(right) || left.localeCompare(right, "zh-Hans-CN"))
    .map(([source, groupItems], index) => ({
      index: index + 1,
      source,
      items: groupItems.sort(comparePackItems)
    }));
}

function inputSourceGroup(item) {
  if (["weekly-core", "weekly-munger"].includes(item.source)) return item.source;
  const types = [...new Set(item.paths.map((sourcePath) => path.basename(sourcePath, path.extname(sourcePath))))]
    .filter((source) => !/^\d{4}-\d{2}$/.test(source));
  if (!types.length) return item.source;
  return types.sort((left, right) => sourcePriorityForType(left) - sourcePriorityForType(right) || left.localeCompare(right, "zh-Hans-CN")).join(" + ");
}

function sourceGroupPriority(sourceGroup) {
  return sourceGroup.split(" + ").reduce((priority, source) => Math.min(priority, sourcePriorityForType(source)), 99);
}

function sourcePriorityForType(source) {
  return sourcePriority.get(source) ?? 99;
}

function sourceGroupSummary(payload, items) {
  const paths = [...new Set(items.flatMap((item) => item.paths))].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const sourceByPath = new Map(payload.sources.map((source) => [source.path, source]));
  const rawChars = paths.reduce((sum, sourcePath) => sum + (sourceByPath.get(sourcePath)?.chars ?? 0), 0);
  return {
    paths,
    rawChars: rawChars || items.reduce((sum, item) => sum + (item.originalChars || 0), 0),
    outputChars: items.reduce((sum, item) => sum + item.outputChars, 0)
  };
}

function renderSourcePolicySummary(sourceGroup) {
  const summaries = sourceGroup.split(" + ").map((source) => {
    const policy = monthlyCompressionPolicies[source];
    if (!policy) return null;
    const minRatio = policy.minRatio ?? 0.01;
    const maxRatio = policy.maxRatio ?? 0.10;
    const recommendedRatio = minRatio + (maxRatio - minRatio) * policy.signalToNoise;
    return `${source} SNR ${policy.signalToNoise.toFixed(2)}，推荐保留 ${(recommendedRatio * 100).toFixed(1)}%，范围 ${(minRatio * 100).toFixed(0)}%–${(maxRatio * 100).toFixed(0)}%`;
  }).filter(Boolean);
  return summaries.join("；");
}

export function demoteEmbeddedHeadings(text) {
  let inFence = false;
  return String(text).split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : line.replace(/^#{1,6}\s+/, "#### ");
  }).join("\n");
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

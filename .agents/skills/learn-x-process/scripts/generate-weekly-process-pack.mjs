import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compressVoiceForProcessPack, voiceCompressionMetrics } from "../../learn-x-input/scripts/collect-voice-weekly.mjs";
import { inputSize, MAX_VOICE_WEEKLY_INPUT_CHARS, VOICE_TARGET_RETAINED_RATIO } from "../../learn-x-input/scripts/lib/input-limits.mjs";
import { SOURCE_FILES } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { defaultWeeklyReviewWeek, writeWeeklyInput } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const FIXED_WEEKLY_INPUTS = [
  { file: SOURCE_FILES.daily, type: "日志", source: "飞书日记", statusSource: "daily" },
  { file: "weekly.md", type: "日志", source: "飞书周记", mode: "manual", note: "阶段 2 采回的人工确认周记" },
  { file: SOURCE_FILES.flomo, type: "输入", source: "Flomo", statusSource: "flomo" },
  { file: SOURCE_FILES.weread, type: "输入", source: "微信读书", statusSource: "weread" },
  { file: SOURCE_FILES.wechat, type: "输入", source: "微信聊天", statusSource: "wechat", optional: true, note: "按需手工采集" },
  { file: SOURCE_FILES.voice, type: "输入", source: "Voice-X", statusSource: "voice" },
  { file: SOURCE_FILES.calendar, type: "计划", source: "Time-X 日历", statusSource: "calendar" },
  { file: SOURCE_FILES.health, type: "日志", source: "Health-X", statusSource: "health" },
  { file: SOURCE_FILES.coach, type: "行动", source: "AI Coach", statusSource: "coach" },
  { file: SOURCE_FILES.wisdom, type: "输入", source: "智慧之门", statusSource: "wisdom" },
  { file: "ai.md", type: "补充", source: "AI 周回顾", mode: "manual", optional: true, note: "可选；确认后进入 Process" },
  { file: SOURCE_FILES.build, type: "复盘", source: "Codex / Code X Build", statusSource: "build" },
  { file: SOURCE_FILES["build-bot"], type: "复盘", source: "飞书机器人 Build", statusSource: "build-bot" }
];

export async function generateWeeklyProcessPack(options = {}) {
  const week = options.week || defaultWeeklyReviewWeek();
  const { payload } = await writeWeeklyInput({ week });
  const sourceSummaries = buildSourceSummaries(payload);
  const { items, compression } = compressWeeklyProcessItems(payload.items, payload.files);
  const fileSummaries = buildFileSummaries(payload, items);
  const processPack = renderProcessPack(payload, sourceSummaries, fileSummaries, items, compression);
  const outputRoot = path.join(repoRoot, "04_output/_dist/weekly", distWeekId(payload.week));
  const shellPath = await ensureWeeklyOutputShell(payload.week);

  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "process-pack.md");
  await writeFile(outputPath, processPack, "utf8");

  return {
    payload,
    sourceSummaries,
    fileSummaries,
    compression,
    outputPath,
    shellPath
  };
}

function renderProcessPack(payload, sourceSummaries, fileSummaries, items, compression) {
  return [
    `# Learn-X Process Pack｜${payload.week}`,
    "",
    "> 这是给 AI Chat 生成 Weekly Output 的上下文材料包，不是最终 Weekly Output。",
    "> 本文件只保留必要来源索引和清洗正文；不要在这里做道 / 法 / 术 / Prompt / Skill 判断。",
    "",
    "## 0. 使用方式",
    "",
    "1. 常规只把本文件交给 AI Chat；`input.json` 是脚本中间态，仅在排错或核查来源时使用。",
    "2. 如需生成 Weekly Output 正文，由用户自己在 AI Chat 中使用本文件，并按需读取 `.agents/skills/learn-x-process/resources/weekly-output-rules.md` 和 `layer-rules.md`。",
    "3. Codex / 脚本只生成 `_dist` 和 `04_output/weekly/YYYY-WW.md` 最小壳；如果 Output 文件已有内容，不覆盖。",
    "4. 人再决定是否把正文写入 `04_output/weekly/YYYY-WW.md`，以及是否进入 Memory、正式 `道/`、`法/`、`术`、Prompt 或 Skill。",
    "",
    "## 1. 处理信息",
    "",
    `- 周期：${payload.range.start.slice(0, 10)} 到 ${payload.range.end.slice(0, 10)}`,
    `- 周目录：\`${payload.selection.path}\``,
    `- 选择方式：${payload.selection.mode}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 原始文件数：${payload.stats.fileCount}`,
    `- 有效材料数：${payload.stats.itemCount}`,
    `- 去重后材料数：${payload.stats.uniqueItemCount}`,
    `- 去重数量：${payload.stats.duplicateCount}`,
    `- 被状态侧车排除的旧文件：${payload.stats.excludedFileCount}`,
    `- JSON 中间材料：\`04_output/_dist/weekly/${distWeekId(payload.week)}/input.json\``,
    "",
    "## 2. 输入与压缩总表",
    "",
    renderInputAuditTable(payload, fileSummaries, compression),
    "",
    "## 3. 来源状态",
    "",
    renderSourceStatuses(payload),
    "",
    "## 4. 来源覆盖",
    "",
    renderSourceCoverage(sourceSummaries),
    "",
    "## 5. 来源索引",
    "",
    renderSourceIndex(fileSummaries),
    "",
    "## 6. 统一压缩概览",
    "",
    renderCompressionSummary(compression),
    "",
    "## 7. 材料正文",
    "",
    renderFileMaterials(items, fileSummaries)
  ].join("\n");
}

export function buildInputAuditRows(payload, fileSummaries, compression) {
  const summariesByFile = new Map(fileSummaries.map((file) => [path.basename(file.path), file]));
  const statusesByFile = new Map(Object.entries(payload.sourceStatuses || {}).map(([source, entry]) => [entry.file, { source, entry }]));
  const fixedFiles = new Set(FIXED_WEEKLY_INPUTS.map((definition) => definition.file));
  const rows = FIXED_WEEKLY_INPUTS.map((definition) => buildInputAuditRow({
    payload,
    definition,
    fileSummary: summariesByFile.get(definition.file),
    statusInfo: definition.statusSource ? statusesByFile.get(definition.file) : undefined
  }));

  for (const fileSummary of fileSummaries) {
    const fileName = path.basename(fileSummary.path);
    if (fixedFiles.has(fileName)) continue;
    rows.push({
      ...buildInputAuditRow({ payload, definition: { file: fileName, type: "其他", source: fileSummary.source || "未命名来源", mode: "extra" }, fileSummary }),
      status: "ready（其他）",
      result: "纳入；如持续出现，请补入固定来源目录"
    });
  }

  return rows;
}

function buildInputAuditRow({ payload, definition, fileSummary, statusInfo }) {
  const entry = statusInfo?.entry;
  const isManual = definition.mode === "manual";
  const hasMaterial = Boolean(fileSummary);
  const isReady = entry?.status === "ready" || (!entry && hasMaterial);
  const status = entry?.status || (hasMaterial ? (isManual ? "ready（人工）" : "ready（兼容）") : "未发现");
  const stale = entry?.preservedStaleFile ? "；旧文件保留但过期、不计入" : "";
  const present = hasMaterial || Boolean(payload.excludedFiles?.some((file) => file.file === definition.file && file.present));
  const filePath = fileSummary?.path || `03_input/weekly/${distWeekId(payload.week)}/${definition.file}`;
  const link = present ? localFileLink(filePath, definition.file) : "—";

  let result;
  if (entry && entry.status !== "ready") {
    result = `排除：${entry.summary || entry.status}${stale}`;
  } else if (entry?.status === "ready" && !hasMaterial) {
    result = "异常：状态为 ready，但没有可纳入的有效材料";
  } else if (isReady) {
    result = isManual ? "纳入（人工文件）" : "纳入";
  } else if (isManual) {
    result = definition.note || "可选，当前未发现";
  } else {
    result = "未执行或未登记；不计入";
  }

  return {
    type: definition.type,
    source: definition.source,
    file: definition.file,
    status,
    count: isReady && fileSummary ? (entry?.count ?? fileSummary.itemCount) : (entry?.count ?? 0),
    rawChars: isReady && fileSummary ? fileSummary.rawChars : "—",
    effectiveChars: isReady && fileSummary ? fileSummary.effectiveChars : "—",
    processChars: isReady && fileSummary ? fileSummary.processChars : "—",
    compressionNote: "",
    result,
    link,
    note: entry?.summary || definition.note || "",
    optional: Boolean(definition.optional)
  };
}

export function renderInputAuditTable(payload, fileSummaries, compression) {
  const rows = buildInputAuditRows(payload, fileSummaries, compression);
  return [
    "> 固定顺序：文件类型 / 来源 → 状态 → 记录/材料 → 字符链路（原始 → 纳入）→ 结果；只有发生实际语义压缩时才在字符链路后标注。`ready` 才计入，`empty/failed/unavailable` 和过期旧文件均不计入。",
    `> 本轮需关注：${renderInputAttention(rows)}`,
    "",
    "| 输入类型 | 来源 | 文件 | 状态 | 记录/材料 | 字符链路（原始 → 纳入） | 结果 |",
    "| --- | --- | --- | --- | ---: | ---: | --- |",
    ...rows.map((row) => {
      const detail = compression.files?.find((item) => item.path.endsWith(`/${row.file}`));
      const compressionNote = detail ? `（Voice-X 压缩，保留 ${Math.round(detail.retainedRatio * 100)}%）` : "";
      const characterChain = row.rawChars === "—" ? "—" : `${row.rawChars} → ${row.processChars}${compressionNote}`;
      const fileCell = row.link === "—" ? row.file : row.link;
      return `| ${row.type} | ${row.source} | ${fileCell} | ${row.status} | ${row.count} | ${characterChain} | ${escapeTableCell(row.result)} |`;
    })
  ].join("\n");
}

function renderInputAttention(rows) {
  const attention = rows
    .filter((row) => !row.optional && (/^(empty|failed|unavailable|未发现)$/.test(row.status) || row.result.startsWith("异常")))
    .map((row) => `${row.source}（${row.file}：${row.status}）`);
  return attention.length ? attention.join("；") : "无";
}

export function compressWeeklyProcessItems(items, files = []) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const processItems = items.map((item) => {
    if (!item.path.endsWith("/voice.md")) return item;
    const compressed = compressVoiceForProcessPack(item.text);
    return { ...item, text: compressed };
  });
  const voiceItems = items.filter((item) => item.path.endsWith("/voice.md"));
  const compressedVoiceItems = processItems.filter((item) => item.path.endsWith("/voice.md"));
  const sourceChars = voiceItems.reduce((sum, item) => sum + (filesByPath.get(item.path)?.rawChars ?? inputSize(item.text).chars), 0);
  const outputChars = compressedVoiceItems.reduce((sum, item) => sum + inputSize(item.text).chars, 0);
  return {
    items: processItems,
    compression: {
      sourceCount: voiceItems.length,
      sourceChars,
      outputChars,
      retainedRatio: sourceChars ? Number((outputChars / sourceChars).toFixed(3)) : 0,
      reductionRatio: sourceChars ? Number((1 - outputChars / sourceChars).toFixed(3)) : 0,
      targetRetainedRatio: VOICE_TARGET_RETAINED_RATIO,
      warnings: sourceChars > MAX_VOICE_WEEKLY_INPUT_CHARS
        ? [`Voice.md 原始内容 ${sourceChars} 字符，超过提示线 ${MAX_VOICE_WEEKLY_INPUT_CHARS} 字符；仍保留完整输入，并在 Process Pack 统一压缩。`]
        : [],
      files: voiceItems.map((item, index) => ({
        path: item.path,
        ...voiceCompressionMetrics(item.text, compressedVoiceItems[index]?.text || "").overall,
        sourceChars: filesByPath.get(item.path)?.rawChars ?? inputSize(item.text).chars
      }))
    }
  };
}

function renderCompressionSummary(compression) {
  if (!compression.sourceCount) return "- 本周没有 Voice-X 内容需要统一压缩。";
  return [
    `- Voice-X：整体原始 ${compression.sourceChars} 字符 → Process Pack ${compression.outputChars} 字符；整体保留比例 ${Math.round(compression.retainedRatio * 100)}%，整体压缩幅度 ${Math.round(compression.reductionRatio * 100)}%；目标保留比例 ${Math.round(compression.targetRetainedRatio * 100)}%。`,
    ...compression.warnings.map((warning) => `- 强提示：${warning}`),
    "",
    "| 文件 | 原始字符 | 纳入 Process Pack 字符 | 保留比例 |",
    "| --- | ---: | ---: | ---: |",
    ...compression.files.map((file) => `| ${file.path} | ${file.sourceChars} | ${file.candidateChars} | ${Math.round(file.retainedRatio * 100)}% |`)
  ].join("\n");
}

function renderSourceStatuses(payload) {
  const rows = Object.entries(payload.sourceStatuses || {}).map(([source, entry]) => {
    const usable = entry.status === "ready" ? "计入" : "排除";
    const stale = entry.preservedStaleFile ? "旧文件已保留但过期" : "无旧文件";
    const present = payload.files.some((file) => file.path.endsWith(`/${entry.file}`))
      || payload.excludedFiles.some((file) => file.file === entry.file && file.present);
    const link = present ? localFileLink(`${payload.selection.path}/${entry.file}`, entry.file) : "—";
    return `| ${source} | ${entry.status} | ${entry.count} | ${link} | ${usable} | ${stale}；${entry.summary} |`;
  });
  if (!rows.length) return "- 未发现状态侧车；按历史周兼容规则读取现有文件。";
  return [
    "| 来源 | 状态 | 记录数 | 核查文件 | 本轮处理 | 说明 |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...rows
  ].join("\n");
}

async function ensureWeeklyOutputShell(weekId) {
  const outputPath = path.join(repoRoot, "04_output/weekly", `${outputWeekId(weekId)}.md`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (existing.trim()) return outputPath;

  const distId = distWeekId(weekId);
  const content = [
    `# Learn-X Weekly Output｜${outputWeekId(weekId)}`,
    "",
    `> 基于 \`04_output/_dist/weekly/${distId}/\` 由用户使用 AI Chat 生成正文后填入。`,
    ""
  ].join("\n");

  await writeFile(outputPath, content, "utf8");
  return outputPath;
}

function buildSourceSummaries(payload) {
  const bySource = new Map();
  for (const file of payload.files) {
    const key = `${file.category}:${file.source}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        category: file.category || "input",
        source: file.source,
        fileCount: 0,
        itemCount: 0,
        files: []
      });
    }

    const entry = bySource.get(key);
    entry.fileCount += 1;
    entry.files.push(file.shortPath || file.path);
  }

  for (const item of payload.items) {
    const category = item.category || "input";
    const source = item.source || "input";
    const key = `${category}:${source}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        category,
        source,
        fileCount: 0,
        itemCount: 0,
        files: []
      });
    }
    bySource.get(key).itemCount += 1;
  }

  return [...bySource.values()].sort((a, b) => `${a.category}/${a.source}`.localeCompare(`${b.category}/${b.source}`, "zh-Hans-CN"));
}

function buildFileSummaries(payload, processItems = payload.items) {
  const byPath = new Map();
  for (const file of payload.files) {
    byPath.set(file.path, {
      path: file.path,
      shortPath: file.shortPath || file.path,
      category: file.category,
      source: file.source,
      modifiedAt: file.modifiedAt,
      size: file.size,
      rawChars: file.rawChars,
      effectiveChars: file.effectiveChars,
      processChars: 0,
      itemCount: 0,
      samples: []
    });
  }

  for (const item of processItems) {
    if (!byPath.has(item.path)) continue;
    const file = byPath.get(item.path);
    file.itemCount += 1;
    file.processChars += inputSize(item.text).chars;
    if (file.samples.length < 2) {
      file.samples.push(`${item.title}: ${truncateInline(item.text, 120)}`);
    }
  }

  return [...byPath.values()].sort((a, b) => a.shortPath.localeCompare(b.shortPath, "zh-Hans-CN"));
}

function renderSourceCoverage(sourceSummaries) {
  if (!sourceSummaries.length) return "- 暂无来源文件。\n";

  const rows = sourceSummaries.map((source) => {
    const sampleFiles = source.files.slice(0, 3).map((file) => `\`${file}\``).join("、") || "-";
    return `| ${source.category} | ${source.source} | ${source.fileCount} | ${source.itemCount} | ${sampleFiles} |`;
  });

  return [
    "| 输入类型 | 来源 | 文件数 | 有效材料数 | 示例文件 |",
    "| --- | --- | ---: | ---: | --- |",
    ...rows
  ].join("\n");
}

function renderSourceIndex(fileSummaries) {
  if (!fileSummaries.length) return "- 本周没有可核对来源。";

  const rows = fileSummaries.map((file, index) => {
    const sourceId = sourceFileId(index);
    return `| ${sourceId} | ${file.category} | ${file.source} | ${localFileLink(file.path)} | ${file.itemCount} | ${file.rawChars} → ${file.processChars} |`;
  });

  return [
    "> source id 用于在 AI Chat 中回溯来源；完整机器字段见同目录 `input.json`。",
    "",
    "| source id | 输入类型 | 来源 | 核查文件 | 材料数 | 字符链路（原始 → 纳入） |",
    "| --- | --- | --- | --- | ---: | ---: |",
    ...rows
  ].join("\n");
}

function localFileLink(filePath, label = path.basename(filePath)) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
  return `[${label}](learnx://${encodeURIComponent(relativePath)})`;
}

function escapeTableCell(value) {
  return String(value ?? "").replaceAll("|", "／").replace(/[\r\n]+/g, " ").trim();
}

function renderFileMaterials(items, fileSummaries) {
  if (!items.length) return "- 本周没有有效材料。";

  const itemsByPath = new Map();
  for (const item of items) {
    if (!itemsByPath.has(item.path)) itemsByPath.set(item.path, []);
    itemsByPath.get(item.path).push(item);
  }

  return fileSummaries.map((file, index) => {
    const sourceId = sourceFileId(index);
    const fileItems = itemsByPath.get(file.path) || [];
    const body = fileItems.length === 1
      ? renderTextBlock(fileItems[0].text)
      : fileItems.map((item) => [
        `#### ${item.title}`,
        "",
        renderTextBlock(item.text)
      ].join("\n")).join("\n\n");

    return [
      `### ${sourceId}｜${file.category}｜${file.source}｜${file.shortPath}`,
      "",
      body
    ].join("\n");
  }).join("\n\n");
}

function sourceFileId(index) {
  return `F${String(index + 1).padStart(3, "0")}`;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function truncateInline(text, maxLength) {
  const normalized = oneLine(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function renderTextBlock(text) {
  const normalized = String(text).replace(/[ \t]+$/gm, "");
  const longestFence = Math.max(2, ...[...normalized.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return [fence, normalized, fence].join("\n");
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
  const result = await generateWeeklyProcessPack(parseArgs(process.argv.slice(2)));

  console.log(`Weekly input pack generated: 04_output/_dist/weekly/${distWeekId(result.payload.week)}/input.json`);
  console.log(`Weekly process pack generated: ${path.relative(repoRoot, result.outputPath)}`);
  console.log(`Weekly output shell ready: ${path.relative(repoRoot, result.shellPath)}`);
  console.log(`Input files: ${result.payload.stats.fileCount}`);
  console.log(`Unique items: ${result.payload.stats.uniqueItemCount}`);
  console.log(`Sources: ${result.sourceSummaries.map((source) => `${source.source}:${source.itemCount}`).join(", ") || "none"}`);
  const attention = Object.entries(result.payload.sourceStatuses || {})
    .filter(([, entry]) => entry.status !== "ready")
    .map(([source, entry]) => `${source}:${entry.status}（${entry.summary}）`);
  console.log(`Input attention: ${attention.join("；") || "none"}`);
}

function distWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-(\d{1,2})$/, (_match, year, week) => `${year}-W${String(week).padStart(2, "0")}`);
}

function outputWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-W?(\d{1,2})$/, (_match, year, week) => `${year}-${String(week).padStart(2, "0")}`);
}

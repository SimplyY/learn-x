import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compressVoiceForProcessPack, voiceCompressionMetrics } from "../../learn-x-input/scripts/collect-voice-weekly.mjs";
import { inputSize, MAX_VOICE_WEEKLY_INPUT_CHARS, VOICE_TARGET_RETAINED_RATIO } from "../../learn-x-input/scripts/lib/input-limits.mjs";
import { defaultWeeklyReviewWeek, writeWeeklyInput } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

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
    "## 2. 来源状态",
    "",
    renderSourceStatuses(payload),
    "",
    "## 3. 来源覆盖",
    "",
    renderSourceCoverage(sourceSummaries),
    "",
    "## 4. 来源索引",
    "",
    renderSourceIndex(fileSummaries),
    "",
    "## 5. 统一压缩概览",
    "",
    renderCompressionSummary(compression),
    "",
    "## 6. 材料正文",
    "",
    renderFileMaterials(items, fileSummaries)
  ].join("\n");
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
    const link = present ? localFileLink(`../../../../${payload.selection.path}`, entry.file) : "—";
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
    return `| ${sourceId} | ${file.category} | ${file.source} | ${localFileLink("../../../../", file.path)} | ${file.itemCount} | ${file.rawChars} | ${file.processChars} |`;
  });

  return [
    "> source id 用于在 AI Chat 中回溯来源；完整机器字段见同目录 `input.json`。",
    "",
    "| source id | 输入类型 | 来源 | 核查文件 | 材料数 | 原始字符数 | 纳入 Process Pack 字符数 |",
    "| --- | --- | --- | --- | ---: | ---: | ---: |",
    ...rows
  ].join("\n");
}

function localFileLink(basePath, fileName) {
  const normalizedBase = String(basePath).replace(/\/$/, "");
  return `[${fileName}](${normalizedBase}/${fileName})`;
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
}

function distWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-(\d{1,2})$/, (_match, year, week) => `${year}-W${String(week).padStart(2, "0")}`);
}

function outputWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-W?(\d{1,2})$/, (_match, year, week) => `${year}-${String(week).padStart(2, "0")}`);
}

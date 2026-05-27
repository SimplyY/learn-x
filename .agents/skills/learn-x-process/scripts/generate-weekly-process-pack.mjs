import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentIsoWeek, writeWeeklyInput } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const candidatesRoot = path.join(repoRoot, "output/candidates");

export async function generateWeeklyProcessPack(options = {}) {
  const week = options.week || currentIsoWeek();
  const { payload } = await writeWeeklyInput({ week });
  const sourceSummaries = buildSourceSummaries(payload);
  const processPack = renderProcessPack(payload, sourceSummaries);

  await mkdir(candidatesRoot, { recursive: true });
  const outputPath = path.join(candidatesRoot, `${payload.week}.process-pack.md`);
  await writeFile(outputPath, processPack, "utf8");

  return {
    payload,
    sourceSummaries,
    outputPath
  };
}

function renderProcessPack(payload, sourceSummaries) {
  return [
    `# Learn-X Process Pack｜${payload.week}`,
    "",
    "> 这是给 Codex / AI 审稿用的中间材料包，不是最终 Weekly Output。",
    "> 本文件只保留来源、编号、清洗文本和覆盖情况；不要在这里做道 / 法 / 术 / Prompt / Skill 判断。",
    "",
    "## 0. 使用方式",
    "",
    "1. 先读取本文件和同周 `.input.json`。",
    "2. 再读取 `.agents/skills/learn-x-process/resources/output-requirements.md` 和 `layer-rules.md`。",
    "3. 由 Codex 按 Skill 规则生成 `output/weekly/YYYY-WW.md`。",
    "4. 人再决定是否进入正式 `道/`、`法/`、`术/`、Prompt 或 Skill。",
    "",
    "## 1. 处理信息",
    "",
    `- 周期：${payload.range.start.slice(0, 10)} 到 ${payload.range.end.slice(0, 10)}`,
    `- 选择方式：${payload.selection.mode === "manifest" ? `weekly manifest (${payload.selection.path})` : "文件修改时间"}`,
    `- Manifest 引用路径数：${payload.selection.referencedPathCount}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 原始文件数：${payload.stats.fileCount}`,
    `- 有效材料数：${payload.stats.itemCount}`,
    `- 去重后材料数：${payload.stats.uniqueItemCount}`,
    `- 去重数量：${payload.stats.duplicateCount}`,
    `- JSON 中间材料：\`output/candidates/${payload.week}.input.json\``,
    "",
    "## 2. 来源覆盖",
    "",
    renderSourceCoverage(sourceSummaries),
    "",
    "## 3. 文件清单",
    "",
    renderFileTable(payload.files),
    "",
    "## 4. 材料清单",
    "",
    renderItems(payload.items)
  ].join("\n");
}

function buildSourceSummaries(payload) {
  const bySource = new Map();
  for (const file of payload.files) {
    if (!bySource.has(file.source)) {
      bySource.set(file.source, {
        source: file.source,
        fileCount: 0,
        itemCount: 0,
        files: []
      });
    }

    const entry = bySource.get(file.source);
    entry.fileCount += 1;
    entry.files.push(file.path);
  }

  for (const item of payload.items) {
    const source = item.source || "input";
    if (!bySource.has(source)) {
      bySource.set(source, {
        source,
        fileCount: 0,
        itemCount: 0,
        files: []
      });
    }
    bySource.get(source).itemCount += 1;
  }

  return [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source, "zh-Hans-CN"));
}

function renderSourceCoverage(sourceSummaries) {
  if (!sourceSummaries.length) return "- 暂无来源文件。\n";

  const rows = sourceSummaries.map((source) => {
    const sampleFiles = source.files.slice(0, 3).map((file) => `\`${file}\``).join("、") || "-";
    return `| ${source.source} | ${source.fileCount} | ${source.itemCount} | ${sampleFiles} |`;
  });

  const expected = ["ai", "flomo", "reading", "podcast", "docs", "theme-read"];
  const covered = new Set(sourceSummaries.filter((source) => source.itemCount > 0 || source.fileCount > 0).map((source) => source.source));
  const missing = expected.filter((source) => !covered.has(source));

  return [
    "| 来源 | 文件数 | 有效材料数 | 示例文件 |",
    "| --- | ---: | ---: | --- |",
    ...rows,
    "",
    `明显缺口：${missing.length ? missing.map((source) => `\`${source}/\``).join("、") : "本周常见来源均有覆盖或已有自定义来源。"}`
  ].join("\n");
}

function renderFileTable(files) {
  if (!files.length) return "- 本周没有读取到输入文件。";

  const rows = files.map((file, index) => {
    const sourceId = sourceFileId(index);
    return `| ${sourceId} | ${file.source} | \`${file.path}\` | ${file.modifiedAt} | ${file.size} |`;
  });

  return [
    "| source id | 来源 | 原始路径 | 文件时间 | 字节数 |",
    "| --- | --- | --- | --- | ---: |",
    ...rows
  ].join("\n");
}

function renderItems(items) {
  if (!items.length) return "- 本周没有有效材料。";

  return items.map((item, index) => {
    const itemId = sourceItemId(index);
    const duplicateInfo = item.duplicateSources?.length
      ? `\n- 重复来源：${item.duplicateSources.map((source) => `\`${source}\``).join("、")}`
      : "";

    return [
      `### ${itemId}｜${item.source}｜${item.title}`,
      "",
      `- 原始路径：\`${item.path}\``,
      `- 原始片段 id：\`${item.id}\``,
      `- 文件时间：${item.modifiedAt}`,
      `- 指纹：\`${item.fingerprint}\`${duplicateInfo}`,
      "",
      renderTextBlock(truncateText(item.text, 1200))
    ].join("\n");
  }).join("\n\n");
}

function sourceFileId(index) {
  return `F${String(index + 1).padStart(3, "0")}`;
}

function sourceItemId(index) {
  return `I${String(index + 1).padStart(3, "0")}`;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}\n\n[片段已截断，完整内容见同周 .input.json]`;
}

function renderTextBlock(text) {
  const longestFence = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return [fence, text, fence].join("\n");
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

  console.log(`Weekly input pack generated: output/candidates/${result.payload.week}.input.json`);
  console.log(`Weekly process pack generated: ${path.relative(repoRoot, result.outputPath)}`);
  console.log(`Input files: ${result.payload.stats.fileCount}`);
  console.log(`Unique items: ${result.payload.stats.uniqueItemCount}`);
  console.log(`Sources: ${result.sourceSummaries.map((source) => `${source.source}:${source.itemCount}`).join(", ") || "none"}`);
}

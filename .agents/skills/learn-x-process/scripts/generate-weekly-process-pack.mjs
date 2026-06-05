import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentIsoWeek, writeWeeklyInput } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function generateWeeklyProcessPack(options = {}) {
  const week = options.week || currentIsoWeek();
  const { payload } = await writeWeeklyInput({ week });
  const sourceSummaries = buildSourceSummaries(payload);
  const fileSummaries = buildFileSummaries(payload);
  const processPack = renderProcessPack(payload, sourceSummaries, fileSummaries);
  const outputRoot = path.join(repoRoot, "04_output/_dist/weekly", distWeekId(payload.week));
  const shellPath = await ensureWeeklyOutputShell(payload.week);

  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "process-pack.md");
  await writeFile(outputPath, processPack, "utf8");

  return {
    payload,
    sourceSummaries,
    fileSummaries,
    outputPath,
    shellPath
  };
}

function renderProcessPack(payload, sourceSummaries, fileSummaries) {
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
    `- JSON 中间材料：\`04_output/_dist/weekly/${distWeekId(payload.week)}/input.json\``,
    "",
    "## 2. 来源覆盖",
    "",
    renderSourceCoverage(sourceSummaries),
    "",
    "## 3. 来源索引",
    "",
    renderSourceIndex(fileSummaries),
    "",
    "## 4. 材料正文",
    "",
    renderFileMaterials(payload.items, fileSummaries)
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

function buildFileSummaries(payload) {
  const byPath = new Map();
  for (const file of payload.files) {
    byPath.set(file.path, {
      path: file.path,
      shortPath: file.shortPath || file.path,
      category: file.category,
      source: file.source,
      modifiedAt: file.modifiedAt,
      size: file.size,
      itemCount: 0,
      totalChars: 0,
      samples: []
    });
  }

  for (const item of payload.items) {
    if (!byPath.has(item.path)) continue;
    const file = byPath.get(item.path);
    file.itemCount += 1;
    file.totalChars += item.text.length;
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

  const expected = ["inbox", "action", "log"];
  const covered = new Set(sourceSummaries.filter((source) => source.itemCount > 0 || source.fileCount > 0).map((source) => source.category));
  const missing = expected.filter((source) => !covered.has(source));

  return [
    "| 输入类型 | 来源 | 文件数 | 有效材料数 | 示例文件 |",
    "| --- | --- | ---: | ---: | --- |",
    ...rows,
    "",
    `明显缺口：${missing.length ? missing.map((source) => `\`${source}/\``).join("、") : "本周常见来源均有覆盖或已有自定义来源。"}`
  ].join("\n");
}

function renderSourceIndex(fileSummaries) {
  if (!fileSummaries.length) return "- 本周没有可核对来源。";

  const rows = fileSummaries.map((file, index) => {
    const sourceId = sourceFileId(index);
    return `| ${sourceId} | ${file.category} | ${file.source} | \`${file.shortPath}\` | ${file.itemCount} | ${file.totalChars} |`;
  });

  return [
    "> source id 用于在 AI Chat 中回溯来源；完整机器字段见同目录 `input.json`。",
    "",
    "| source id | 输入类型 | 来源 | 短路径 | 材料数 | 字符数 |",
    "| --- | --- | --- | --- | ---: | ---: |",
    ...rows
  ].join("\n");
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

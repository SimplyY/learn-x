import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);
const ignoredFileNames = new Set(["README.md", ".gitkeep"]);

async function generateMonthlyProcessPack(options = {}) {
  const months = options.months?.length ? options.months : [currentMonthId()];
  const results = [];

  for (const month of months) {
    const payload = await collectMonthlyInput(month);
    const outputRoot = path.join(repoRoot, "04_output/_dist/monthly", payload.month);
    await mkdir(outputRoot, { recursive: true });

    const inputPath = path.join(outputRoot, "input.json");
    const processPackPath = path.join(outputRoot, "process-pack.md");
    const shellPath = await ensureMonthlyOutputShell(payload.month);

    await writeFile(inputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(processPackPath, renderProcessPack(payload), "utf8");

    results.push({ payload, inputPath, processPackPath, shellPath });
  }

  return results;
}

async function collectMonthlyInput(monthId) {
  const month = normalizeMonthId(monthId);
  const inputDirName = inputMonthDirName(month);
  const inputRoot = path.join(repoRoot, "03_input/monthly", inputDirName);
  const files = await collectInputFiles(inputRoot);
  const activeFiles = [];
  const rawItems = [];

  for (const file of files) {
    const info = await stat(file.absolutePath);
    const content = await readFile(file.absolutePath, "utf8");
    const text = cleanText(parseFileContent(content, file.relativePath));
    if (text.length < 12) continue;

    activeFiles.push({
      path: file.relativePath,
      shortPath: shortMonthlyPath(file.relativePath, inputDirName),
      source: sourceFromPath(file.relativePath, inputDirName),
      modifiedAt: info.mtime.toISOString(),
      size: info.size
    });

    rawItems.push({
      id: `${file.relativePath}#1`,
      source: sourceFromPath(file.relativePath, inputDirName),
      path: file.relativePath,
      shortPath: shortMonthlyPath(file.relativePath, inputDirName),
      modifiedAt: info.mtime.toISOString(),
      title: titleFromContent(content, file.relativePath),
      text
    });
  }

  const items = dedupeItems(rawItems);

  return {
    month,
    selection: {
      mode: "month-directory",
      path: `03_input/monthly/${inputDirName}`
    },
    generatedAt: new Date().toISOString(),
    files: activeFiles,
    items,
    stats: {
      fileCount: activeFiles.length,
      itemCount: rawItems.length,
      uniqueItemCount: items.length,
      duplicateCount: rawItems.length - items.length
    }
  };
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

    if (entry.isDirectory()) {
      files.push(...(await collectInputFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith("_")) continue;
    if (ignoredFileNames.has(entry.name)) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    files.push({ absolutePath, relativePath });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
}

function renderProcessPack(payload) {
  return [
    `# Learn-X Monthly Process Pack｜${payload.month}`,
    "",
    "> 这是给用户在 AI Chat 中生成 Monthly Output 的上下文材料包，不是最终 Monthly Output。",
    "> 本文件只保留必要来源索引和清洗正文；不要在这里做道 / 法 / 术判断。",
    "",
    "## 0. 使用方式",
    "",
    "1. 常规只把本文件交给 AI Chat；`input.json` 是脚本中间态，仅在排错或核查来源时使用。",
    "2. 如需生成 Monthly Output 正文，由用户自己在 AI Chat 中使用本文件。",
    "3. Codex / 脚本只生成 `_dist` 和 `04_output/monthly/YYYY-MM.md` 最小壳；如果 Output 文件已有内容，不覆盖。",
    "4. 人再决定是否把正文写入 `04_output/monthly/YYYY-MM.md`，以及是否进入 Memory 或正式长期资产。",
    "",
    "## 1. 处理信息",
    "",
    `- 月份：${payload.month}`,
    `- 月目录：\`${payload.selection.path}\``,
    `- 选择方式：${payload.selection.mode}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 原始文件数：${payload.stats.fileCount}`,
    `- 有效材料数：${payload.stats.itemCount}`,
    `- 去重后材料数：${payload.stats.uniqueItemCount}`,
    `- 去重数量：${payload.stats.duplicateCount}`,
    `- JSON 中间材料：\`04_output/_dist/monthly/${payload.month}/input.json\``,
    "",
    "## 2. 来源覆盖",
    "",
    renderSourceCoverage(payload),
    "",
    "## 3. 来源索引",
    "",
    renderSourceIndex(payload.files, payload.items),
    "",
    "## 4. 材料正文",
    "",
    renderItems(payload.items)
  ].join("\n");
}

function renderSourceCoverage(payload) {
  if (!payload.files.length) return "- 本月没有读取到输入文件。";

  const bySource = new Map();
  for (const file of payload.files) {
    if (!bySource.has(file.source)) {
      bySource.set(file.source, { fileCount: 0, itemCount: 0, files: [] });
    }
    const entry = bySource.get(file.source);
    entry.fileCount += 1;
    entry.files.push(file.shortPath);
  }
  for (const item of payload.items) {
    if (!bySource.has(item.source)) continue;
    bySource.get(item.source).itemCount += 1;
  }

  const rows = [...bySource.entries()].map(([source, entry]) => {
    const files = entry.files.slice(0, 4).map((file) => `\`${file}\``).join("、");
    return `| ${source} | ${entry.fileCount} | ${entry.itemCount} | ${files} |`;
  });

  return [
    "| 来源 | 文件数 | 有效材料数 | 示例文件 |",
    "| --- | ---: | ---: | --- |",
    ...rows
  ].join("\n");
}

function renderSourceIndex(files, items) {
  if (!files.length) return "- 本月没有读取到输入文件。";

  const countsByPath = new Map();
  for (const item of items) {
    const entry = countsByPath.get(item.path) || { count: 0, chars: 0 };
    entry.count += 1;
    entry.chars += item.text.length;
    countsByPath.set(item.path, entry);
  }

  const rows = files.map((file, index) => {
    const entry = countsByPath.get(file.path) || { count: 0, chars: 0 };
    return `| ${sourceFileId(index)} | ${file.source} | \`${file.shortPath}\` | ${entry.count} | ${entry.chars} |`;
  });

  return [
    "> source id 用于在 AI Chat 中回溯来源；完整机器字段见同目录 `input.json`。",
    "",
    "| source id | 来源 | 短路径 | 材料数 | 字符数 |",
    "| --- | --- | --- | ---: | ---: |",
    ...rows
  ].join("\n");
}

function renderItems(items) {
  if (!items.length) return "- 本月没有有效材料。";

  return items.map((item, index) => {
    return [
      `### ${sourceFileId(index)}｜${item.source}｜${item.shortPath}`,
      "",
      renderTextBlock(item.text)
    ].join("\n");
  }).join("\n\n");
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

  const content = [
    `# Learn-X Monthly Output｜${month}`,
    "",
    `> 基于 \`04_output/_dist/monthly/${month}/\` 由用户使用 AI Chat 生成正文后填入。`,
    ""
  ].join("\n");

  await writeFile(outputPath, content, "utf8");
  return outputPath;
}

function parseFileContent(content, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return htmlToText(content);
  if (extension === ".json") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
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

function titleFromContent(content, filePath) {
  const heading = String(content).match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(filePath, path.extname(filePath));
}

function sourceFromPath(relativePath, inputDirName) {
  const shortPath = shortMonthlyPath(relativePath, inputDirName);
  if (shortPath === "monthly.md") return "monthly";
  if (shortPath.startsWith("weekly/")) return "weekly";
  return shortPath.split("/")[0] || "monthly";
}

function shortMonthlyPath(relativePath, inputDirName) {
  const prefix = `03_input/monthly/${inputDirName}/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath;
}

function cleanText(text) {
  return String(text)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashText(text) {
  return createHash("sha1").update(text.toLowerCase().replace(/\s+/g, "")).digest("hex").slice(0, 12);
}

function renderTextBlock(text) {
  const longestFence = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return [fence, text, fence].join("\n");
}

function sourceFileId(index) {
  return `F${String(index + 1).padStart(3, "0")}`;
}

function normalizeMonthId(monthId) {
  return String(monthId).replace(/^(\d{4})-(\d{1,2})$/, (_match, year, month) => `${year}-${String(month).padStart(2, "0")}`);
}

function inputMonthDirName(monthId) {
  return String(monthId).replace(/^(\d{4})-0?(\d{1,2})$/, "$1-$2");
}

function currentMonthId(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toWebPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function parseArgs(argv) {
  const options = { months: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--month") {
      options.months.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argv[index] === "--months") {
      options.months.push(...argv[index + 1].split(",").map((month) => month.trim()).filter(Boolean));
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await generateMonthlyProcessPack(parseArgs(process.argv.slice(2)));
  for (const result of results) {
    console.log(`Monthly input pack generated: ${path.relative(repoRoot, result.inputPath)}`);
    console.log(`Monthly process pack generated: ${path.relative(repoRoot, result.processPackPath)}`);
    console.log(`Monthly output shell ready: ${path.relative(repoRoot, result.shellPath)}`);
    console.log(`Input files: ${result.payload.stats.fileCount}`);
    console.log(`Unique items: ${result.payload.stats.uniqueItemCount}`);
  }
}

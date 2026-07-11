import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputKindFromRelativePath } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);
const ignoredFileNames = new Set(["README.md", ".gitkeep"]);
const sourceMarker = "learn-x-weekly-source";

export async function collectMonthlyWeeklyInputs(options = {}) {
  const month = normalizeMonthId(options.month || previousMonthId());
  const weeks = weeksIntersectingMonth(month);
  const sources = [];

  for (const week of weeks) {
    const weekRoot = path.join(repoRoot, "03_input/weekly", week);
    const files = await collectInputFiles(weekRoot);
    if (!files.length) throw new Error(`月度原始输入缺失：${weekRoot}`);

    for (const file of files) {
      const buffer = await readFile(file.absolutePath);
      const info = await stat(file.absolutePath);
      const shortPath = toWebPath(path.relative(weekRoot, file.absolutePath));
      sources.push({
        week,
        path: file.relativePath,
        shortPath,
        ...inputKindFromRelativePath(file.relativePath),
        modifiedAt: info.mtime.toISOString(),
        bytes: buffer.byteLength,
        chars: buffer.toString("utf8").length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        text: buffer.toString("utf8")
      });
    }
  }

  const outputPath = path.join(repoRoot, "03_input/monthly", inputMonthDirName(month), "weekly-inputs.md");
  const rendered = renderMonthlyWeeklyInputs({ month, weeks, sources, generatedAt: new Date().toISOString() });
  verifyRenderedSources(rendered, sources);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");

  return {
    month,
    weeks,
    sources,
    outputPath,
    stats: {
      fileCount: sources.length,
      byteCount: sources.reduce((sum, source) => sum + source.bytes, 0),
      categories: [...new Set(sources.map((source) => source.category))].sort()
    }
  };
}

export function renderMonthlyWeeklyInputs({ month, weeks, sources, generatedAt }) {
  const totalBytes = sources.reduce((sum, source) => sum + source.bytes, 0);
  const blocks = sources.map((source) => {
    const metadata = JSON.stringify({
      week: source.week,
      path: source.path,
      shortPath: source.shortPath,
      category: source.category,
      source: source.source,
      modifiedAt: source.modifiedAt,
      bytes: source.bytes,
      chars: source.chars,
      sha256: source.sha256
    });
    const fence = "`".repeat(Math.max(3, longestBacktickRun(source.text) + 1));
    const separator = source.text.endsWith("\n") ? "" : "\n";
    return [
      `## ${source.week}｜\`${source.shortPath}\``,
      "",
      `<!-- ${sourceMarker} ${metadata} -->`,
      `${fence}text`,
      `${source.text}${separator}${fence}`
    ].join("\n");
  });

  return [
    `# ${month} 月度周原始输入`,
    "",
    "> 本文件由确定性脚本逐字节汇集周度输入；不是摘要，不得人工压缩后替换。",
    "> 月度以相交 ISO 周为原子证据单元；月初/月末边界周完整保留，可能包含少量相邻月份内容，并在每条来源中标明周与原路径。",
    "",
    `- 目标月：${month}`,
    `- 相交周：${weeks.join("、")}`,
    `- 原始文件数：${sources.length}`,
    `- 原始总字节数：${totalBytes}`,
    `- 生成时间：${generatedAt}`,
    "",
    ...blocks,
    ""
  ].join("\n");
}

export function parseMonthlyWeeklyInputs(content) {
  const markerPattern = new RegExp(`<!-- ${sourceMarker} (\\{[^\\n]+\\}) -->\\n`, "g");
  const sources = [];

  for (const match of content.matchAll(markerPattern)) {
    const metadata = JSON.parse(match[1]);
    const fenceStart = match.index + match[0].length;
    const fenceEnd = content.indexOf("\n", fenceStart);
    if (fenceEnd < 0) throw new Error(`来源 ${metadata.path} 缺少代码块起始行`);
    const textStart = fenceEnd + 1;
    const text = content.slice(textStart, textStart + metadata.chars);
    const actualHash = createHash("sha256").update(Buffer.from(text)).digest("hex");
    if (Buffer.byteLength(text) !== metadata.bytes || actualHash !== metadata.sha256) {
      throw new Error(`月度原始输入校验失败：${metadata.path}`);
    }
    sources.push({ ...metadata, text });
  }

  const declaredCount = Number(content.match(/^- 原始文件数：(\d+)$/m)?.[1]);
  const declaredBytes = Number(content.match(/^- 原始总字节数：(\d+)$/m)?.[1]);
  const actualBytes = sources.reduce((sum, source) => sum + source.bytes, 0);
  if (!Number.isInteger(declaredCount) || declaredCount !== sources.length) {
    throw new Error(`月度原始输入数量不守恒：声明 ${declaredCount || 0}，解析 ${sources.length}`);
  }
  if (!Number.isInteger(declaredBytes) || declaredBytes !== actualBytes) {
    throw new Error(`月度原始输入字节数不守恒：声明 ${declaredBytes || 0}，解析 ${actualBytes}`);
  }

  return sources;
}

function verifyRenderedSources(content, expected) {
  const parsed = parseMonthlyWeeklyInputs(content);
  if (parsed.length !== expected.length) {
    throw new Error(`月度原始输入数量不守恒：源文件 ${expected.length}，写入 ${parsed.length}`);
  }
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
    if (entry.isDirectory()) {
      files.push(...(await collectInputFiles(absolutePath)));
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith("_") || ignoredFileNames.has(entry.name)) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    files.push({ absolutePath, relativePath: toWebPath(path.relative(repoRoot, absolutePath)) });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hans-CN"));
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

function longestBacktickRun(text) {
  return Math.max(2, ...[...String(text).matchAll(/`+/g)].map((match) => match[0].length));
}

function normalizeMonthId(monthId) {
  const match = String(monthId).match(/^(\d{4})-(\d{1,2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`月份格式无效：${monthId}`);
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
}

function inputMonthDirName(monthId) {
  return monthId.replace(/^(\d{4})-0?(\d{1,2})$/, "$1-$2");
}

function previousMonthId(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const previous = new Date(Date.UTC(Number(values.year), Number(values.month) - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toWebPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--month") options.month = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await collectMonthlyWeeklyInputs(parseArgs(process.argv.slice(2)));
  console.log(`月度周原始输入已生成：${path.relative(repoRoot, result.outputPath)}`);
  console.log(`相交周：${result.weeks.join(", ")}`);
  console.log(`原始文件：${result.stats.fileCount}，总字节：${result.stats.byteCount}`);
}

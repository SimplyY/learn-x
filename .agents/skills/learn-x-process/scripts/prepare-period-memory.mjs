import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
export async function preparePeriodMemory(options = {}) {
  const period = normalizePeriod(options);
  const outputPath = sourceOutputPath(period);
  const content = await readFile(outputPath, "utf8");
  const candidates = extractMemoryCandidates(content);
  const target = memoryTarget(period);
  const distRoot = path.join(repoRoot, "04_output/_dist", period.type, period.id);

  await mkdir(distRoot, { recursive: true });

  const candidatePath = path.join(distRoot, "memory-candidates.md");
  await writeFile(candidatePath, renderCandidatePack(period, outputPath, target, candidates), "utf8");

  return {
    period,
    outputPath,
    candidatePath,
    target,
    counts: {
      checked: candidates.checked.length,
      observations: candidates.observations.length,
      unchecked: candidates.unchecked.length,
      explicit: candidates.explicit.length
    }
  };
}

export function extractMemoryCandidates(content) {
  const required = extractRequiredSections(content);
  const checked = [];
  const observations = [];
  const unchecked = [];
  let section = "";
  let candidateLevel = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      section = heading[2].trim();
      if (candidateLevel && level <= candidateLevel && !isCandidateHeading(section)) candidateLevel = 0;
      if (isCandidateHeading(section)) candidateLevel = level;
      continue;
    }

    if (!candidateLevel) continue;

    const checkedMatch = line.match(/^[-*]\s+\[[xX]\]\s+(.+)$/);
    if (checkedMatch) {
      const item = { section, text: cleanLine(checkedMatch[1]) };
      (isObservationSection(section) ? observations : checked).push(item);
      continue;
    }

    const uncheckedMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (uncheckedMatch && candidateLevel) {
      unchecked.push({ section, text: cleanLine(uncheckedMatch[1]) });
      continue;
    }
  }

  return {
    coreSummary: required.coreSummary,
    mungerInsights: required.mungerInsights,
    checked: uniqueCandidates(checked),
    observations: uniqueCandidates(observations),
    unchecked: uniqueCandidates(unchecked),
    explicit: []
  };
}

function isCandidateHeading(title) {
  return /人工确认清单|Memory 候选|值得进入 Memory|继续追踪|候选观察|道\s*\/\s*法\s*\/\s*术|器/.test(title);
}

function isObservationSection(title) {
  return /道\s*\/\s*法\s*\/\s*术|道候选|法候选|术候选|器候选|候选观察/.test(title);
}

export function extractRequiredSections(content) {
  const lines = String(content).split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: normalizeHeading(match[2]) });
  }

  const result = { coreSummary: [], mungerInsights: [] };
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const key = heading.title === "全文核心重点纪要" ? "coreSummary" : heading.title === "芒格之魂的洞察" ? "mungerInsights" : "";
    if (!key) continue;
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const body = lines.slice(heading.index + 1, next?.index ?? lines.length).join("\n").trim();
    if (body && !/^(todo|待补充|暂无|无|占位)$/i.test(body)) result[key].push({ section: heading.title, text: body });
  }
  result.coreSummary = uniqueCandidates(result.coreSummary);
  result.mungerInsights = uniqueCandidates(result.mungerInsights);
  return result;
}

function normalizeHeading(title) {
  return String(title).replace(/[\*_`]/g, "").replace(/^\d+\s*[.、．]\s*/, "").trim();
}

function renderCandidatePack(period, outputPath, target, candidates) {
  return [
    `# Learn-X ${period.label} Memory Candidates｜${period.id}`,
    "",
    "> 这是给 Codex 生成 Memory 的候选材料，不是最终 Memory。",
    "> 脚本只抽取候选；最终写入需要 Codex 按 `memory-rules.md` 无损整理并写入。",
    "",
    "## 处理信息",
    "",
    `- 来源 Output：\`${toRepoPath(outputPath)}\``,
    `- 输出目标：\`${target.file}\``,
    `- 建议小节：\`${target.section}\``,
    "",
    "## 已确认内容",
    "",
    renderList(candidates.checked),
    "",
    "## 系统确认：全文核心重点纪要",
    "",
    renderBlocks(candidates.coreSummary),
    "",
    "## 系统确认：芒格之魂的洞察",
    "",
    renderBlocks(candidates.mungerInsights),
    "",
    "## 候选观察（只进入季度候选池，不进入普通 Memory）",
    "",
    renderList(candidates.observations),
    "",
    "## 明确标记内容",
    "",
    "- 本工具不从普通正文中的“重要 / 保留 / 确认 / 继续追踪”等词语推断记忆。",
    "",
    "## 未勾选候选",
    "",
    "> 默认不直接写入 Memory；仅在用户明确要求 Codex 代为判断时，才可作为待确认池。",
    "",
    renderList(candidates.unchecked),
    "",
    "## 生成要求",
    "",
    "- 仅候选区内已勾选内容进入 Memory，不设数量上限。",
    "- 系统确认章节仅限精确标题“全文核心重点纪要”和“芒格之魂的洞察”。",
    "- 只做无损整理：去掉 checkbox、归类、去除完全重复项。",
    "- 不要改写用户已确认的关键语义。",
    "- 道 / 法 / 术 / 器候选观察写入目标 Memory 文件顶部的 `候选观察池`，并保留来源周期。",
    "- 如果没有确认内容，先报告候选不足，不要强行写入。",
    "- 未勾选内容默认不写入。",
    "- 不替代正式 `道/`、`法/`、`术/`。"
  ].join("\n");
}

function normalizePeriod(options) {
  if (options.month) {
    const id = String(options.month).replace(/^(\d{4})-(\d{1,2})$/, (_match, year, month) => `${year}-${String(month).padStart(2, "0")}`);
    if (!/^\d{4}-\d{2}$/.test(id)) throw new Error(`Invalid month format: ${options.month}. Use YYYY-MM.`);
    return { type: "monthly", id, label: "Monthly" };
  }

  if (options.year) {
    const id = String(options.year);
    if (!/^\d{4}$/.test(id)) throw new Error(`Invalid year format: ${options.year}. Use YYYY.`);
    return { type: "yearly", id, label: "Yearly" };
  }

  throw new Error("Missing period. Use --month YYYY-MM or --year YYYY.");
}

function sourceOutputPath(period) {
  const folder = period.type === "monthly" ? "monthly" : "yearly";
  const fileName = period.type === "monthly" ? `${period.id}.md` : `${period.id}.md`;
  return path.join(repoRoot, "04_output", folder, fileName);
}

function memoryTarget(period) {
  if (period.type === "monthly") {
    const [year, month] = period.id.split("-").map(Number);
    const quarter = Math.floor((month - 1) / 3) + 1;
    return {
      file: `01_core/memory/${year}-Q${quarter}.memory.md`,
      section: `## Monthly｜${period.id}`
    };
  }

  return {
    file: `01_core/memory/${period.id}.memory.md`,
    section: `## Yearly｜${period.id}`
  };
}

function renderList(items) {
  if (!items.length) return "- 暂无。";
  return items.map((item) => {
    const section = item.section ? `（${item.section}）` : "";
    return `- ${section}${item.text}`;
  }).join("\n");
}

function renderBlocks(items) {
  if (!items.length) return "- 暂无。";
  return items.map((item) => `### ${item.section}\n\n${item.text}`).join("\n\n");
}

function uniqueCandidates(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.text.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function cleanLine(line) {
  return String(line)
    .replace(/^[-*]\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--month") {
      options.month = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--year") {
      options.year = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await preparePeriodMemory(parseArgs(process.argv.slice(2)));

  console.log(`${result.period.label} memory candidates generated: ${toRepoPath(result.candidatePath)}`);
  console.log(`Memory target: ${result.target.file}`);
  console.log(`Suggested section: ${result.target.section}`);
  console.log(`Checked items: ${result.counts.checked}`);
  console.log(`Explicit markers: ${result.counts.explicit}`);
  console.log(`Unchecked candidates: ${result.counts.unchecked}`);
}

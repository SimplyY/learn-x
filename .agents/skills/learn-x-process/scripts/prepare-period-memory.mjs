import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const explicitSignals = ["进入记忆", "继续追踪", "重要", "保留", "确认"];

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
      unchecked: candidates.unchecked.length,
      explicit: candidates.explicit.length
    }
  };
}

function extractMemoryCandidates(content) {
  const checked = [];
  const unchecked = [];
  const explicit = [];
  let section = "";
  let inCandidateSection = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      section = heading[2].trim();
      inCandidateSection = /Memory|记忆|人工确认|候选|继续追踪/.test(section);
      continue;
    }

    const checkedMatch = line.match(/^[-*]\s+\[[xX]\]\s+(.+)$/);
    if (checkedMatch) {
      checked.push({ section, text: cleanLine(checkedMatch[1]) });
      continue;
    }

    const uncheckedMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (uncheckedMatch && inCandidateSection) {
      unchecked.push({ section, text: cleanLine(uncheckedMatch[1]) });
      continue;
    }

    if (explicitSignals.some((signal) => line.includes(signal))) {
      explicit.push({ section, text: cleanLine(line) });
    }
  }

  return {
    checked: uniqueCandidates(checked),
    unchecked: uniqueCandidates(unchecked),
    explicit: uniqueCandidates(explicit)
  };
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
    "## 明确标记内容",
    "",
    renderList(candidates.explicit),
    "",
    "## 未勾选候选",
    "",
    "> 默认不直接写入 Memory；仅在用户明确要求 Codex 代为判断时，才可作为待确认池。",
    "",
    renderList(candidates.unchecked),
    "",
    "## 生成要求",
    "",
    "- 已勾选内容必须进入 Memory，不设数量上限。",
    "- 只做无损整理：去掉 checkbox、归类、去除完全重复项。",
    "- 不要改写用户已确认的关键语义。",
    "- 道 / 法 / 术候选观察写入目标 Memory 文件顶部的 `候选观察池`，并保留来源周期。",
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

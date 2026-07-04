import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const weeklyRoot = path.join(repoRoot, "04_output/weekly");

const explicitSignals = ["进入记忆", "继续追踪", "重要", "保留", "确认"];

export async function prepareWeeklyMemory(options = {}) {
  const week = normalizeWeekId(options.week || defaultWeeklyReviewWeek());
  const quarter = quarterFromIsoWeek(week);
  const weeklyPath = path.join(weeklyRoot, `${outputWeekFileId(week)}.md`);
  const content = await readFile(weeklyPath, "utf8");
  const candidates = extractMemoryCandidates(content);
  const candidatePack = renderCandidatePack(week, quarter, weeklyPath, candidates);
  const candidatesRoot = path.join(repoRoot, "04_output/_dist/weekly", distWeekId(week));

  await mkdir(candidatesRoot, { recursive: true });
  const outputPath = path.join(candidatesRoot, "memory-candidates.md");
  await writeFile(outputPath, candidatePack, "utf8");

  return {
    week,
    quarter,
    outputPath,
    counts: {
      checked: candidates.checked.length,
      explicit: candidates.explicit.length,
      core: candidates.core.length
    }
  };
}

export function extractMemoryCandidates(content) {
  const checked = [];
  const unchecked = [];
  const explicit = [];
  const core = [];
  let section = "";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }

    const checkedMatch = line.match(/^[-*]\s+\[[xX]\]\s+(.+)$/);
    if (checkedMatch) {
      checked.push({ section, text: cleanLine(checkedMatch[1]) });
      continue;
    }

    const uncheckedMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (uncheckedMatch) {
      unchecked.push({ section, text: cleanLine(uncheckedMatch[1]) });
      continue;
    }

    if (matchesExplicitSignal(line)) {
      explicit.push({ section, text: cleanLine(line) });
      continue;
    }

    if (/^(本周主线|关键不是|真正学习|缺口：)/.test(line)) {
      core.push({ section, text: cleanLine(line) });
    }
  }

  return {
    checked: uniqueCandidates(checked),
    unchecked: uniqueCandidates(unchecked),
    explicit: uniqueCandidates(explicit),
    core: uniqueCandidates(core)
  };
}

function renderCandidatePack(week, quarter, weeklyPath, candidates) {
  return [
    `# Learn-X Memory Candidates｜${memoryWeekSectionId(week)}`,
    "",
    "> 这是给 Codex 生成 Weekly Memory 的候选材料，不是最终 Memory。",
    "> 脚本只抽取已勾选和明确标记内容；最终 Memory 需要 Codex 按 `memory-rules.md` 无损整理并写入。",
    "",
    "## 处理信息",
    "",
    `- Weekly Output：\`${path.relative(repoRoot, weeklyPath).split(path.sep).join("/")}\``,
    `- 输出目标：\`01_core/memory/${quarter}.memory.md\``,
    `- 建议小节：\`## ${memoryWeekSectionId(week)}\``,
    "",
    "## 已勾选内容",
    "",
    renderList(candidates.checked),
    "",
    "## 明确标记内容",
    "",
    renderList(candidates.explicit),
    "",
    "## 核心线索",
    "",
    renderList(candidates.core),
    "",
    "## 生成要求",
    "",
    "- 已勾选内容必须进入 Memory，不设数量上限。",
    "- 只做无损整理：去掉 checkbox、归类、去除完全重复项。",
    "- 不要改写用户已确认的关键语义。",
    "- 道 / 法 / 术候选观察写入目标 Memory 文件顶部的 `候选观察池`，并保留来源周。",
    "- 未勾选内容默认不写入。",
    "- 不要替代正式 `道/`、`法/`、`术/`。"
  ].join("\n");
}

function quarterFromIsoWeek(weekId) {
  const { year, week } = parseWeekId(weekId);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

function normalizeWeekId(weekId) {
  const { year, week } = parseWeekId(weekId);
  return `${year}-${String(week).padStart(2, "0")}`;
}

function parseWeekId(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}. Use YYYY-WW or YYYY-Www, for example 2026-22 or 2026-W22.`);

  return {
    year: Number(match[1]),
    week: Number(match[2])
  };
}

function outputWeekFileId(weekId) {
  return normalizeWeekId(weekId);
}

function memoryWeekSectionId(weekId) {
  const { year, week } = parseWeekId(weekId);
  return `${year}-W${String(week).padStart(2, "0")}`;
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

function matchesExplicitSignal(line) {
  const normalized = line.replace(/^[-*]\s*/, "");
  return explicitSignals.some((signal) => new RegExp(`^(?:明确)?${signal}[：:]`).test(normalized));
}

function cleanLine(line) {
  return String(line)
    .replace(/^[-*]\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const result = await prepareWeeklyMemory(parseArgs(process.argv.slice(2)));

  console.log(`Weekly memory candidates generated: ${path.relative(repoRoot, result.outputPath)}`);
  console.log(`Quarterly memory target: 01_core/memory/${result.quarter}.memory.md`);
  console.log(`Checked items: ${result.counts.checked}`);
  console.log(`Explicit markers: ${result.counts.explicit}`);
  console.log(`Core clues: ${result.counts.core}`);
}

function distWeekId(weekId) {
  return memoryWeekSectionId(weekId);
}

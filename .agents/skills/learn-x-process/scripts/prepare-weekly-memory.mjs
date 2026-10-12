import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const MEMORY_APPROVAL_BACKUP_ROOTS = ["01_core", "03_input", "04_output", "05_library"];

export async function prepareWeeklyMemory(options = {}) {
  const week = normalizeWeekId(options.week || defaultWeeklyReviewWeek());
  const root = options.repoRoot || repoRoot;
  const quarter = quarterFromIsoWeek(week);
  const weeklyPath = path.join(root, "04_output/weekly", `${outputWeekFileId(week)}.md`);
  const content = await readFile(weeklyPath, "utf8");
  const candidates = extractMemoryCandidates(content);
  const candidatePack = renderCandidatePack(week, quarter, weeklyPath, candidates, root);
  const candidatesRoot = path.join(root, "04_output/_dist/weekly", distWeekId(week));

  await mkdir(candidatesRoot, { recursive: true });
  const outputPath = path.join(candidatesRoot, "memory-candidates.md");
  await writeFile(outputPath, candidatePack, "utf8");

  return {
    week,
    quarter,
    outputPath,
    counts: {
      coreSummary: candidates.coreSummary.length,
      mungerInsights: candidates.mungerInsights.length,
      checked: candidates.checked.length,
      observations: candidates.observations.length,
      explicit: candidates.explicit.length,
      core: candidates.core.length
    }
  };
}

export async function bindWeeklyMemoryApproval({ week, repoRoot: root = repoRoot } = {}) {
  const normalizedWeek = normalizeWeekId(week);
  const quarter = quarterFromIsoWeek(normalizedWeek);
  const directory = path.join(root, "04_output/_dist/weekly", distWeekId(normalizedWeek));
  const files = {
    weeklyOutput: path.join(root, "04_output/weekly", `${outputWeekFileId(normalizedWeek)}.md`),
    candidates: path.join(directory, "memory-candidates.md"),
    proposal: path.join(directory, "memory-proposed.md"),
    currentMemoryTarget: path.join(root, "01_core/memory", `${quarter}.memory.md`)
  };
  const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, key === "currentMemoryTarget" ? await hashOptionalFile(file) : sha256(await readFile(file, "utf8"))])));
  const payload = {
    schemaVersion: 1,
    week: normalizedWeek,
    quarter,
    hashes,
    scope: memoryApprovalScope(normalizedWeek, quarter)
  };
  const fingerprint = sha256(JSON.stringify(payload));
  const manifestPath = path.join(directory, "_memory-approval.json");
  await writeFile(manifestPath, `${JSON.stringify({ ...payload, fingerprint }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(manifestPath, 0o600);
  return { week: normalizedWeek, fingerprint, hashes, scope: payload.scope, manifestPath };
}

export async function verifyWeeklyMemoryApproval({ week, fingerprint, repoRoot: root = repoRoot } = {}) {
  const normalizedWeek = normalizeWeekId(week);
  const directory = path.join(root, "04_output/_dist/weekly", distWeekId(normalizedWeek));
  const manifestPath = path.join(directory, "_memory-approval.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const { fingerprint: storedFingerprint, ...payload } = manifest;
  if (manifest.schemaVersion !== 1 || manifest.week !== normalizedWeek
    || storedFingerprint !== fingerprint || sha256(JSON.stringify(payload)) !== storedFingerprint) {
    throw new Error("memory-approval-fingerprint-mismatch");
  }
  const expectedScope = memoryApprovalScope(normalizedWeek, quarterFromIsoWeek(normalizedWeek));
  if (JSON.stringify(manifest.scope) !== JSON.stringify(expectedScope)) throw new Error("memory-approval-scope-mismatch");

  const files = {
    weeklyOutput: path.join(root, "04_output/weekly", `${outputWeekFileId(normalizedWeek)}.md`),
    candidates: path.join(directory, "memory-candidates.md"),
    proposal: path.join(directory, "memory-proposed.md"),
    currentMemoryTarget: path.join(root, "01_core/memory", `${manifest.quarter}.memory.md`)
  };
  let currentHashes;
  try {
    currentHashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, key === "currentMemoryTarget" ? await hashOptionalFile(file) : sha256(await readFile(file, "utf8"))])));
  } catch {
    throw new Error("memory-approval-stale: approved source or proposal is missing");
  }
  if (JSON.stringify(currentHashes) !== JSON.stringify(manifest.hashes)) throw new Error("memory-approval-stale: weekly output, candidates, or proposed memory changed");
  return { verified: true, week: normalizedWeek, fingerprint: storedFingerprint, manifestPath };
}

function memoryApprovalScope(week, quarter) {
  return {
    memoryPath: `01_core/memory/${quarter}.memory.md`,
    imagePath: `04_output/_dist/weekly/${memoryWeekSectionId(week)}/weekly-core.png`,
    backupRoots: MEMORY_APPROVAL_BACKUP_ROOTS,
    backupDestination: "Learn-X Backups / Learn-X Backup Index / Snapshots",
    ywnext: "refresh from confirmed 01_core/memory/*.memory.md",
    flomo: [`03_input/weekly/${memoryWeekSectionId(week)}/weekly.md`, `01_core/memory/${quarter}.memory.md`]
  };
}

function sha256(value) { return createHash("sha256").update(String(value), "utf8").digest("hex"); }

async function hashOptionalFile(file) {
  try { return sha256(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function extractMemoryCandidates(content) {
  const required = extractRequiredSections(content);
  const checked = [];
  const observations = [];
  const unchecked = [];
  const core = [];
  let section = "";
  let candidateLevel = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const level = heading[0].match(/^#+/)[0].length;
      section = normalizeHeading(heading[1]);
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
    if (uncheckedMatch) {
      unchecked.push({ section, text: cleanLine(uncheckedMatch[1]) });
      continue;
    }

    if (/^(本周主线|关键不是|真正学习|缺口：)/.test(line)) core.push({ section, text: cleanLine(line) });
  }

  return {
    coreSummary: required.coreSummary,
    mungerInsights: required.mungerInsights,
    checked: uniqueCandidates(checked),
    observations: uniqueCandidates(observations),
    unchecked: uniqueCandidates(unchecked),
    explicit: [],
    core: uniqueCandidates(core)
  };
}

function isCandidateHeading(title) {
  return /^值得长期保留(?:$|[（(])/.test(title)
    || /人工确认清单|Memory 候选|值得进入 Memory|继续追踪|候选观察|道\s*\/\s*法\s*\/\s*术|器/.test(title);
}

function isObservationSection(title) {
  return /道\s*\/\s*法\s*\/\s*术|道候选|法候选|术候选|器候选|候选观察/.test(title);
}

function renderCandidatePack(week, quarter, weeklyPath, candidates, root = repoRoot) {
  return [
    `# Learn-X Memory Candidates｜${memoryWeekSectionId(week)}`,
    "",
    "> 这是给 Codex 生成 Weekly Memory 的候选材料，不是最终 Memory。",
    "> 标题 11/12 是系统确认内容；问题、背景和回答保留在 Weekly Output，不进入 Memory 候选。脚本只抽取候选区内已勾选内容。",
    "",
    "## 处理信息",
    "",
    `- Weekly Output：\`${path.relative(root, weeklyPath).split(path.sep).join("/")}\``,
    `- 输出目标：\`01_core/memory/${quarter}.memory.md\``,
    `- 建议小节：\`## ${memoryWeekSectionId(week)}\``,
    "",
    "## 系统确认：全文核心重点纪要",
    "",
    renderBlocks(candidates.coreSummary),
    "",
    "## 系统确认：芒格之魂的洞察",
    "",
    renderBlocks(candidates.mungerInsights),
    "",
    "## 默认排除",
    "",
    "- Weekly Output 的问题、背景和回答不迁移到 Memory；仅在用户本次明确指定具体内容时例外。",
    "",
    "## 已勾选内容",
    "",
    renderList(candidates.checked),
    "",
    "## 历史兼容候选观察（只读）",
    "",
    renderList(candidates.observations),
    "",
    "## 明确标记内容",
    "",
    "- 本工具不从普通正文中的“重要 / 保留 / 确认 / 继续追踪”等词语推断记忆。",
    "",
    "## 核心线索",
    "",
    renderList(candidates.core),
    "",
    "## 生成要求",
    "",
    "- 非空的「全文核心重点纪要」必须写入当周 `Memory`。",
    "- 非空的「芒格之魂的洞察」必须写入季度 Memory 顶部的芒格洞察候选池。",
    "- 两个系统确认章节无需 checkbox；只过滤空白、`todo` 和占位文本。",
    "- 问题、背景和回答默认整体排除，不因回答完整或已确认而自动迁移。",
    "- 可以轻度去重和压缩重复表述，但不得删除独立判断、限定、反转、隐喻或行动边界。",
    "- 新 Weekly Output 只把「值得长期保留」章节中已勾选的条目作为长期候选；0 条合法，不得补造、催促补勾或强行写入。",
    "- 历史旧候选标题仍可解析；历史道 / 法 / 术 / 器观察只供查阅，不作为本期写入候选。",
    "- 只做无损整理：去掉 checkbox、归类、去除完全重复项。",
    "- 不要改写用户已确认的关键语义。",
    "- 未勾选内容默认不写入。",
    "- 不要替代正式 `道/`、`法/`、`术/`。"
  ].join("\n");
}

export function extractRequiredSections(content) {
  const lines = String(content).split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    headings.push({ index, level: match[1].length, title: normalizeHeading(match[2]) });
  }

  const result = { coreSummary: [], mungerInsights: [] };
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const key = requiredSectionKey(heading.title);
    if (!key) continue;

    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const body = lines
      .slice(heading.index + 1, next?.index ?? lines.length)
      .join("\n")
      .replace(/(?:\n\s*---\s*)+$/g, "")
      .trim();
    const acceptedBody = filterPlaceholderOnlyLines(body);
    if (!isSubstantiveSection(acceptedBody)) continue;
    result[key].push({ section: heading.title, text: acceptedBody });
  }

  result.coreSummary = uniqueCandidates(result.coreSummary);
  result.mungerInsights = uniqueCandidates(result.mungerInsights);
  return result;
}

function filterPlaceholderOnlyLines(body) {
  return String(body)
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return true;
      const content = text
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)、．]\s*/, "")
        .replace(/^>\s*/, "")
        .trim();
      return Boolean(content) && !/^(?:todo|待补充|暂无|无|占位|x{1,3}|…+|\.{3,})[。.!！]?$/i.test(content);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeading(title) {
  return String(title)
    .replace(/[\*_`]/g, "")
    .replace(/^\d+\s*[.、．]\s*/, "")
    .trim();
}

function requiredSectionKey(title) {
  const compact = String(title).replace(/\s+/g, "");
  if (/^全文核心重点纪要(?:$|[（(:：—–-])/.test(compact)) return "coreSummary";
  if (/^芒格之魂的洞察(?:$|[（(:：—–-])/.test(compact)) return "mungerInsights";
  return "";
}

function isSubstantiveSection(body) {
  const plain = String(body)
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.、．]\s+/gm, "")
    .replace(/[\s*_`>#。.!！-]/g, "")
    .toLowerCase();
  return Boolean(plain) && !["todo", "待补充", "暂无", "无", "占位"].includes(plain) && !isPlaceholderList(body);
}

function isPlaceholderList(body) {
  const lines = String(body).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^\d+[.)、．]\s*x+$/i.test(line));
}

export function quarterFromIsoWeek(weekId) {
  const { year, week } = parseWeekId(weekId);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
  return `${start.getUTCFullYear()}-Q${quarter}`;
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") {
      options.week = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--bind-approval") {
      options.bindApproval = true;
    } else if (argv[index] === "--verify-approval") {
      options.verifyApproval = true;
    } else if (argv[index] === "--fingerprint") {
      options.fingerprint = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.bindApproval && options.verifyApproval) throw new Error("choose one approval operation");
  if (options.bindApproval) {
    const result = await bindWeeklyMemoryApproval(options);
    console.log(JSON.stringify({ status: "bound", ...result }));
  } else if (options.verifyApproval) {
    const result = await verifyWeeklyMemoryApproval(options);
    console.log(JSON.stringify(result));
  } else {
    const result = await prepareWeeklyMemory(options);
    console.log(`Weekly memory candidates generated: ${path.relative(repoRoot, result.outputPath)}`);
    console.log(`Quarterly memory target: 01_core/memory/${result.quarter}.memory.md`);
    console.log(`Core summary sections: ${result.counts.coreSummary}`);
    console.log(`Munger insight sections: ${result.counts.mungerInsights}`);
    console.log(`Checked items: ${result.counts.checked}`);
    console.log(`Explicit markers: ${result.counts.explicit}`);
    console.log(`Core clues: ${result.counts.core}`);
  }
}

function distWeekId(weekId) {
  return memoryWeekSectionId(weekId);
}

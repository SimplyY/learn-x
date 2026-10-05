import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWeeklyReviewWeek } from "./collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const weeklyRoot = path.join(repoRoot, "04_output/weekly");
const NON_ANSWER_MARKERS = new Set([
  "跳过", "主动跳过", "选择跳过", "先跳过", "本周跳过", "本周主动跳过", "本周选择跳过", "本周先跳过",
  "这周跳过", "这周主动跳过", "本次跳过", "本次主动跳过", "这次跳过", "这次主动跳过", "略过",
  "跳过本题", "跳过此题", "跳过这个问题", "略过本题", "未回答", "本周未回答", "本次未回答",
  "尚未回答", "还未回答", "暂未回答", "暂不回答", "暂时不回答", "先不回答", "不回答", "没有回答",
  "未作答", "尚未作答", "还未作答", "暂未作答", "暂不作答", "暂时不作答", "先不作答", "不作答",
  "待回答", "待作答", "无答案", "暂无答案", "没有答案", "未填写", "暂不填写"
]);
const QUESTION_REFERENCE = "(?:本题|这题|此题|这个问题|该问题)";
const NON_ANSWER_ACTION = `(?:(?:暂时还未|暂时没有|暂时没|暂缓|暂时不|暂不|先不|还没有|还未|还没|尚未|尚无|未曾|并未|没能|不能|无法|不会|不想|不愿|不予|不打算|不|没有|没|未|暂时|暂|待)(?:回答|作答|填写)(?:${QUESTION_REFERENCE})?|(?:暂时还没有|暂时没有|暂时还没|还没有|还没|暂无|尚无|没有|没|无)答案|(?:答案|结论|判断)(?:尚未|还未|未|暂未|暂无|没有|还没有|没)(?:形成|得出|确定|给出|作出)|(?:暂时|暂|暂缓|先|目前|本周|这周)?(?:搁置|搁一搁|放一放|暂缓)(?:${QUESTION_REFERENCE})?)`;
const EXPLICIT_NON_ANSWER_PREFIX = new RegExp(`^(?:(?:本周|这周|本次|这次)?${QUESTION_REFERENCE}?(?:主动|选择|先)?(?:跳过|略过)(?:${QUESTION_REFERENCE})?|${QUESTION_REFERENCE}?${NON_ANSWER_ACTION})(?=$|[,，。.!！;；:：（(])`);
const NON_ANSWER_CONTEXT = `(?:(?:我|我们|本人)(?:${QUESTION_REFERENCE})?|${QUESTION_REFERENCE}(?:(?:我|我们|本人))?|对(?:于)?${QUESTION_REFERENCE}|本周|这周|本次|这次)`;
const NON_ANSWER_CONTEXT_BRIDGE = "(?:(?:我|我们|本人|本周|这周|本次|这次|明确|主动|选择|选择了|选了|决定|先|暂时|暂|目前|现在|正在|不再|暂时不|暂不|先不|暂时还未|暂时没有|暂时没|还没有|还未|还没|尚未|未能|未|没有|没能|无法|不会|不想|不愿|不予|不打算|不|(?:还没|尚未|暂时没|没)想(?:好|清楚)[,，]?))*";
const NON_ANSWER_CONTEXTUAL_STATUS = new RegExp(
  `${NON_ANSWER_CONTEXT}${NON_ANSWER_CONTEXT_BRIDGE}(?<state>(?:跳过|略过)(?:${QUESTION_REFERENCE})?|${NON_ANSWER_ACTION})(?:${QUESTION_REFERENCE})?`,
  "g"
);
const CONTRASTED_NON_ANSWER = /(?:而是|但是|不过|但|却)(?:(?:本题|这题|此题|这个问题|该问题|我|我们|本人|本周|这周|本次|这次))?(?:还没有|还没|尚未|未曾|并未|暂时还未|暂时没有|暂时没|暂缓|暂不|先不|不予|不想|不会|不)(?:回答|作答|填写)|(?:而是|但是|不过|但|却)(?:还没有|还没|尚未|未曾|并未)(?:形成|得出|确定|给出|作出)?答案/;

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
      coreSummary: candidates.coreSummary.length,
      mungerInsights: candidates.mungerInsights.length,
      questionsAnswers: candidates.questionsAnswers.length,
      checked: candidates.checked.length,
      observations: candidates.observations.length,
      explicit: candidates.explicit.length,
      core: candidates.core.length
    }
  };
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
    questionsAnswers: required.questionsAnswers,
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

function renderCandidatePack(week, quarter, weeklyPath, candidates) {
  return [
    `# Learn-X Memory Candidates｜${memoryWeekSectionId(week)}`,
    "",
    "> 这是给 Codex 生成 Weekly Memory 的候选材料，不是最终 Memory。",
  "> 标题 11/12/13 是系统确认内容；脚本只抽取候选区内已勾选内容。最终由 Codex 按 `memory-rules.md` 整理并写入。",
    "",
    "## 处理信息",
    "",
    `- Weekly Output：\`${path.relative(repoRoot, weeklyPath).split(path.sep).join("/")}\``,
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
    "## 系统确认：本周最值得思考的问题与回答",
    "",
    renderBlocks(candidates.questionsAnswers),
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
    "- 非空的「本周最值得思考的问题与回答」必须写入当周 `Memory`，问题和对应回答成对保留。",
    "- 三个系统确认章节无需 checkbox；只过滤空白、`todo` 和占位文本。",
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

  const result = { coreSummary: [], mungerInsights: [], questionsAnswers: [] };
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
    const acceptedBody = key === "questionsAnswers" ? filterAnsweredQuestionAnswers(body) : filterPlaceholderOnlyLines(body);
    if (!isSubstantiveSection(acceptedBody)) continue;
    result[key].push({ section: heading.title, text: acceptedBody });
  }

  result.coreSummary = uniqueCandidates(result.coreSummary);
  result.mungerInsights = uniqueCandidates(result.mungerInsights);
  result.questionsAnswers = uniqueCandidates(result.questionsAnswers);
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
  if (title === "全文核心重点纪要") return "coreSummary";
  if (title === "芒格之魂的洞察") return "mungerInsights";
  const compact = String(title).replace(/\s+/g, "");
  if ((compact.includes("最值得思考") && compact.includes("问题")) || /问题(?:与|和|及)(?:回答|答案)/.test(compact)) return "questionsAnswers";
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

function filterAnsweredQuestionAnswers(body) {
  const lines = String(body).split(/\r?\n/);
  const numberedStarts = lines
    .map((line, index) => /^\d+[.)、．]\s+/.test(line) ? index : -1)
    .filter((index) => index >= 0);
  const questionStarts = lines
    .map((line, index) => /^(?:[-*]\s*)?问题(?:\s*[一二三四五六七八九十\d]+)?\s*[：:]\s*\S/.test(line) ? index : -1)
    .filter((index) => index >= 0);
  const starts = numberedStarts.length ? numberedStarts : questionStarts;

  if (starts.length) {
    const answered = starts.flatMap((start, index) => {
      const end = starts[index + 1] ?? lines.length;
      const block = lines.slice(start, end);
      return isAnsweredQuestionEntry(block) ? [block.join("\n").trimEnd()] : [];
    });
    return answered.join("\n\n").trim();
  }

  return isAnsweredQuestionEntry(lines) ? String(body).trim() : "";
}

function isAnsweredQuestionEntry(lines) {
  const textLines = lines
    .map((line) => line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim())
    .filter(Boolean);
  if (!textLines.length) return false;

  const first = textLines[0].replace(/^\d+[.)、．]\s+/, "").replace(/^[-*]\s+/, "").trim();
  const hasQuestion = /[？?]/.test(first) || /^问题(?:\s*[一二三四五六七八九十\d]+)?\s*[：:]/.test(first);
  if (!hasQuestion) return false;
  const questionMark = Math.max(first.indexOf("？"), first.indexOf("?"));
  const questionText = (questionMark >= 0 ? first.slice(0, questionMark) : first)
    .replace(/^问题(?:\s*[一二三四五六七八九十\d]+)?\s*[：:]\s*/, "");
  if (!isSubstantiveText(questionText)) return false;

  for (let index = 0; index < textLines.length; index += 1) {
    const line = textLines[index].replace(/^\d+[.)、．]\s+/, "").replace(/^[-*]\s+/, "").trim();
    const answer = line.match(/^(?:回答|答案|A)\s*[：:]\s*(.*)$/i);
    if (answer) {
      const continuation = answer[1] || textLines.slice(index + 1).find((next) => next.trim()) || "";
      if (isSubstantiveAnswer(continuation)) return true;
    }

    const questionMark = Math.max(line.lastIndexOf("？"), line.lastIndexOf("?"));
    if (questionMark >= 0 && isSubstantiveAnswer(line.slice(questionMark + 1).replace(/^(?:回答|答案|A)\s*[：:]\s*/i, ""))) {
      return true;
    }
  }
  return false;
}

function isSubstantiveAnswer(value) {
  const raw = String(value)
    .replace(/^[-*+>]\s*/, "")
    .replace(/^(?:回答|答案|A)\s*[：:]\s*/i, "")
    .replace(/[ *_`>#]/g, "")
    .trim()
    .toLowerCase();
  const compact = raw.replace(/\s/g, "");
  const comparable = compact.replace(/[。.!！,，:：;；?？…-]/g, "");
  return isSubstantiveText(value)
    && !NON_ANSWER_MARKERS.has(comparable)
    && !isExplicitNonAnswerStatus(compact);
}

function isSubstantiveText(value) {
  const normalized = String(value)
    .replace(/^[-*+>]\s*/, "")
    .replace(/[\s*_`>#。.!！,，:：;；?？…-]/g, "")
    .toLowerCase();
  return Boolean(normalized)
    && !["todo", "待补充", "暂无", "无", "占位", "xx"].includes(normalized);
}

function isExplicitNonAnswerStatus(compact) {
  if (EXPLICIT_NON_ANSWER_PREFIX.test(compact)) return true;

  for (const match of compact.matchAll(NON_ANSWER_CONTEXTUAL_STATUS)) {
    const stateStart = match.index + match[0].lastIndexOf(match.groups.state);
    const statement = compact.slice(0, stateStart + match.groups.state.length);
    const preceding = compact.slice(0, stateStart);
    const skipState = /^(?:跳过|略过)/.test(match.groups.state);
    const negated = skipState
      ? /(?:不是|并非|不要|别|不应(?:该)?|不该|不必|不需要|无需|不用|不能|不可以|不可|不建议|不值得|不想|不打算|不会|没有|没|还没|还未|尚未|未|未曾|并未|暂不|先不|不|没必要|禁止)(?:(?:把|将|去|再|就|直接|主动|选择|我|我们|本人|本周|这周|本次|这次|不想|不打算|暂不|先不|不)|(?:本题|这题|此题|这个问题|该问题))*$/.test(preceding)
      : /(?:没有|没|并未|未曾|并非|不是)(?:(?:选择|决定|打算|计划|准备|想|愿意|需要|主动))+(?:暂时|暂缓|暂|先)?(?:不想|不愿|不予|暂不|先不|不|未|没有|没)?(?:回答|作答|填写)/.test(statement);
    if (!negated) return true;
  }

  return CONTRASTED_NON_ANSWER.test(compact);
}

function isPlaceholderList(body) {
  const lines = String(body).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^\d+[.)、．]\s*x+$/i.test(line));
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
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await prepareWeeklyMemory(parseArgs(process.argv.slice(2)));

  console.log(`Weekly memory candidates generated: ${path.relative(repoRoot, result.outputPath)}`);
  console.log(`Quarterly memory target: 01_core/memory/${result.quarter}.memory.md`);
  console.log(`Core summary sections: ${result.counts.coreSummary}`);
  console.log(`Munger insight sections: ${result.counts.mungerInsights}`);
  console.log(`Question and answer sections: ${result.counts.questionsAnswers}`);
  console.log(`Checked items: ${result.counts.checked}`);
  console.log(`Explicit markers: ${result.counts.explicit}`);
  console.log(`Core clues: ${result.counts.core}`);
}

function distWeekId(weekId) {
  return memoryWeekSectionId(weekId);
}

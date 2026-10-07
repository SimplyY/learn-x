import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { compressVoiceForProcessPack, voiceCompressionMetrics } from "../../learn-x-input/scripts/collect-voice-weekly.mjs";
import { isoWeekRangeShanghai } from "../../learn-x-input/scripts/collect-weread-weekly.mjs";
import { countInputChars, inputSize, MAX_VOICE_WEEKLY_INPUT_CHARS, VOICE_TARGET_RETAINED_RATIO, VOICE_TARGET_RETAINED_RATIO_RANGE } from "../../learn-x-input/scripts/lib/input-limits.mjs";
import { WEEKLY_SOURCE_CONFIG, compareWeeklySources, weeklySourceForFile, weeklySourceForId } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { defaultWeeklyReviewWeek, isoWeekRange, collectWeeklyInput } from "./collect-weekly-input.mjs";
import { validateAiReview } from "./monthly-process-input.mjs";
import { loadWeeklyPreparation, prepareWeeklyProcessInputs } from "./weekly-preprocessing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const JOURNAL_INPUT = { file: "weekly.md", type: "日志", source: "飞书周记", mode: "manual", group: "stage", priority: null, blocksPack: true, note: "阶段前提：已确认目标周周记" };
const FIXED_WEEKLY_INPUTS = [
  WEEKLY_SOURCE_CONFIG[0],
  JOURNAL_INPUT,
  ...WEEKLY_SOURCE_CONFIG.slice(1).map((source) => ({
    ...source,
    statusSource: source.id,
    mode: source.id === "ai" || source.id === "wechat" ? "manual" : undefined,
    optional: !source.blocksPack
  }))
];

export async function generateWeeklyProcessPack(options = {}) {
  const week = options.week || defaultWeeklyReviewWeek();
  const root = options.repoRoot || repoRoot;
  const payload = await collectWeeklyInput({ week, repoRoot: root, allowOversized: true });
  const outputRoot = path.join(root, "04_output/_dist/weekly", distWeekId(payload.week));

  if (options.prepare) {
    const preparation = await prepareWeeklyProcessInputs({ week: payload.week, repoRoot: root, payload });
    return { payload, preparation, outputRoot, prepared: true };
  }

  const gate = await validateWeeklyProcessInputs({ week: payload.week, repoRoot: root, payload });
  if (gate.length) throw new Error(`weekly-process-blocked:\n${gate.map((item) => `- ${item}`).join("\n")}`);

  const { manifest, manifestPath } = await loadWeeklyPreparation({ week: payload.week, repoRoot: root, payload });
  const { processPayload, items, compression } = applyWeeklyPreparation(payload, manifest);
  const sourceSummaries = buildSourceSummaries(processPayload);
  const fileSummaries = buildFileSummaries(processPayload, items);
  const previousOutput = await readPreviousWeeklyOutput(payload.week, root);
  const processPack = renderProcessPack(processPayload, sourceSummaries, fileSummaries, items, compression, previousOutput);
  await mkdir(outputRoot, { recursive: true });
  const inputPath = path.join(outputRoot, "input.json");
  const outputPath = path.join(outputRoot, "process-pack.md");
  const shellPath = await ensureWeeklyOutputShell(payload.week, root);
  await atomicWrite(inputPath, `${JSON.stringify(payload, null, 2)}\n`);
  await atomicWrite(outputPath, processPack);

  return {
    payload,
    processPayload,
    manifestPath,
    sourceSummaries,
    fileSummaries,
    compression,
    previousOutput,
    outputPath,
    shellPath
  };
}

export async function validateWeeklyProcessInputs({ week, repoRoot: root = repoRoot, payload }) {
  const byFile = new Map(payload.files.map((file) => [path.basename(file.path), file]));
  const status = payload.sourceStatuses || {};
  const issues = [];
  const targetWeek = distWeekId(week);

  const daily = status.daily;
  if (daily?.status !== "ready" || (daily.count ?? 0) < 1 || !byFile.has("daily.md")) {
    issues.push(`日记 daily.md 必须为 ready 且至少有一条有效记录（当前 ${daily?.status || "未登记"}，${daily?.count ?? 0} 条）`);
  }

  const flomo = status.flomo;
  if (flomo?.status === "ready") {
    const file = byFile.get("flomo.md");
    if ((flomo.count ?? 0) < 1 || !file) issues.push("Flomo 标记 ready，但没有有效记录或 flomo.md");
    else await validateFlomoReady({ root, file, status: flomo, week: targetWeek, issues });
  } else if (!(flomo?.status === "empty" && flomo.count === 0 && hasTrustedEmptyScan(flomo.summary, targetWeek, "flomo"))) {
    issues.push(`Flomo flomo.md 必须完整采集成功（允许有完整扫描证据的零条结果；当前 ${flomo?.status || "未登记"}）`);
  }

  const voice = status.voice;
  if (voice?.status === "ready") {
    if ((voice.count ?? 0) < 1 || !byFile.has("voice.md")) {
      issues.push("Voice 标记 ready，但没有有效记录或 voice.md");
    } else {
      const text = await readFile(path.join(root, byFile.get("voice.md").path), "utf8");
      await validateVoiceReady({ text, status: voice, week: targetWeek, issues });
    }
  } else if (!(voice?.status === "empty" && voice.count === 0 && hasTrustedEmptyScan(voice.summary, targetWeek, "voice"))) {
    issues.push(`Voice voice.md 必须完整采集成功（允许有完整扫描证据的零条结果；当前 ${voice?.status || "未登记"}）`);
  }

  const aiFile = byFile.get("ai.md");
  if (!aiFile) {
    issues.push("AI 周回顾 ai.md 缺失，Process Pack 需要有效 AI 回顾");
  } else {
    const text = await readFile(path.join(root, aiFile.path), "utf8");
    const validation = validateAiReview(text);
    if (!validation.valid) issues.push(`AI 周回顾结构无效（${validation.reasons.join(", ")}）`);
    const aiSidecarPath = path.join(root, "03_input/weekly", targetWeek, "_ai-generated.json");
    let aiSidecar;
    try { aiSidecar = JSON.parse(await readFile(aiSidecarPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") issues.push("AI 周回顾运行状态侧车无法验证"); }
    if (aiSidecar) {
      if (aiSidecar.status !== "confirmed" || aiSidecar.targetWeek !== targetWeek) issues.push(`AI 周回顾未确认为目标周 ${targetWeek}`);
    } else {
      const declaredWeek = text.match(/^# .*?(\d{4}-W\d{2})\s*$/m)?.[1];
      if (declaredWeek !== targetWeek) issues.push(`AI 周回顾目标周标记缺失或不匹配（应为 ${targetWeek}）`);
    }
  }

  const weeklyFile = byFile.get("weekly.md");
  if (!weeklyFile) {
    issues.push("已确认的目标周周记 weekly.md 缺失");
  } else {
    const text = await readFile(path.join(root, weeklyFile.path), "utf8");
    const weekTag = text.match(/(?:目标周|覆盖周|目标覆盖周)[：:]\s*(\d{4}-W\d{2})/i)?.[1];
    if (text.includes("【待优化】AI 基础草稿")) issues.push("weekly.md 仍带有未确认草稿标记");
    if (weekTag !== targetWeek) issues.push(`weekly.md 目标周标记缺失或不匹配（应为 ${targetWeek}）`);
    if (!hasSubstantiveWeeklyJournal(text)) issues.push("weekly.md 只有模板、占位或空内容，不能作为已确认周记");
  }

  return issues;
}

async function validateFlomoReady({ root, file, status, week, issues }) {
  const text = await readFile(path.join(root, file.path), "utf8");
  const range = expectedSourceRange(week, "flomo");
  if (!text.includes(`# Flomo 周输入｜${week}`)) issues.push(`Flomo 目标周标记缺失或不匹配（应为 ${week}）`);
  if (!text.includes(`- 采集范围：${range.start} 至 ${range.endExclusive}（不含结束时刻）`)
    || !hasCompleteScanSummary(status.summary, range, status.count)) issues.push("Flomo 扫描范围、完整扫描状态或下界证据与目标周不匹配");
  if (!text.includes("- 完整扫描：是") || !text.includes("- 下界已覆盖：是")) issues.push("Flomo 文件缺少完整扫描或下界覆盖证据");
  const fileCount = Number(text.match(/^- 目标周记录：\s*(\d+)\s*$/m)?.[1]);
  const sidecarCount = Number(status.count);
  const pageCount = Number(text.match(/^- 分页：已完成（(\d+) 页）$/m)?.[1]);
  const summaryPages = Number(String(status.summary || "").match(/分页\s*(\d+)\s*页/)?.[1]);
  const recordCount = (text.match(/^## \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/gm) || []).length;
  if (!Number.isInteger(sidecarCount) || fileCount !== sidecarCount || recordCount !== sidecarCount) issues.push("Flomo 文件记录数与来源状态侧车不一致");
  if (!Number.isInteger(pageCount) || pageCount < 1 || summaryPages !== pageCount) issues.push("Flomo 分页完整性与来源状态侧车不一致");
}

async function validateVoiceReady({ text, status, week, issues }) {
  const range = expectedSourceRange(week, "voice");
  if (!text.includes(`# Voice-X 核心重点｜${week}`)) issues.push(`Voice-X 目标周标记缺失或不匹配（应为 ${week}）`);
  if (!text.includes(`- 采集范围：${range.start} 至 ${range.endExclusive}（不含结束时刻）`)
    || !hasCompleteScanSummary(status.summary, range, status.count)) issues.push("Voice-X 扫描范围、完整扫描状态或下界证据与目标周不匹配");
  if (!text.includes("- 完整扫描：是") || !text.includes("- 下界已覆盖：是")) issues.push("Voice-X 文件缺少完整扫描或下界覆盖证据");
  const fileCount = Number(text.match(/^- 记录数：\s*(\d+)\s*$/m)?.[1]);
  const sidecarCount = Number(status.count);
  const recordCount = (text.match(/^- 录制时间：/gm) || []).length;
  const pageCount = Number(text.match(/^- 分页：已完成（(\d+) 页）$/m)?.[1]);
  const summaryPages = Number(String(status.summary || "").match(/分页\s*(\d+)\s*页/)?.[1]);
  if (!Number.isInteger(sidecarCount) || fileCount !== sidecarCount || recordCount !== sidecarCount) issues.push("Voice-X 文件记录数与来源状态侧车不一致");
  if (!Number.isInteger(pageCount) || pageCount < 1 || summaryPages !== pageCount) issues.push("Voice-X 分页完整性与来源状态侧车不一致");
}

function hasTrustedEmptyScan(summary, week, source) {
  const text = String(summary || "");
  const range = expectedSourceRange(week, source);
  const expectedRange = `完整扫描 ${range.start} 至 ${range.endExclusive} 完成`;
  return text.includes(expectedRange)
    && /(?:下界已覆盖|范围已覆盖)[：:]\s*是/.test(text)
    && /(?:0\s*条|零条|无匹配)/.test(text)
    && Number(text.match(/分页\s*(\d+)\s*页/)?.[1]) >= 1;
}

function hasCompleteScanSummary(summary, range, count) {
  const text = String(summary || "");
  return text.includes(`完整扫描 ${range.start} 至 ${range.endExclusive} 完成`)
    && /(?:下界已覆盖|范围已覆盖)[：:]\s*是/.test(text)
    && new RegExp(`(?:^|[；; ])${Number(count)} 条`).test(text);
}

function expectedSourceRange(week, source) {
  const { startEpoch, endEpoch } = isoWeekRangeShanghai(week);
  const format = (epoch, seconds) => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23"
  }).format(new Date(epoch * 1000));
  const withSeconds = source === "voice";
  return { start: format(startEpoch, withSeconds), endExclusive: format(endEpoch, withSeconds) };
}

function hasSubstantiveWeeklyJournal(content) {
  const lines = String(content).split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^(?:来源|目标周|覆盖周|目标覆盖范围|写作日标题|定位依据|采集时间)[：:]/.test(line))
    .filter((line) => !/^(?:[-*]\s*)?(?:待补充|待填写|xx+|todo|暂无)[。.!！?？]?$/i.test(line));
  return lines.some((line) => countInputChars(line.replace(/[`*_>#|]/g, "").trim()) >= 12);
}

function applyWeeklyPreparation(payload, manifest) {
  const exclusions = new Map((manifest.exclusions || []).map((item) => [item.sourcePath, item.reason]));
  const preparedByItem = new Map((manifest.preparedItems || []).filter((item) => item.itemId).map((item) => [item.itemId, item]));
  const preparedByPath = new Map((manifest.preparedItems || []).filter((item) => !item.itemId).map((item) => [item.path, item]));
  const replacedPaths = new Set(preparedByPath.keys());
  const rawItems = payload.items.filter((item) => !exclusions.has(item.path) && !replacedPaths.has(item.path));
  const items = rawItems.map((item) => {
    const prepared = preparedByItem.get(item.id);
    if (prepared) return { ...item, text: prepared.text, preparedKind: prepared.kind };
    if (item.path.endsWith("/voice.md")) throw new Error(`weekly-preprocessing-required: voice cache missing for ${item.path}; rerun --prepare`);
    return item;
  });
  for (const [filePath, prepared] of preparedByPath) {
    if (exclusions.has(filePath)) continue;
    const first = payload.items.find((item) => item.path === filePath);
    if (first) items.push({ ...first, id: `${filePath}#prepared`, text: prepared.text, preparedKind: prepared.kind });
  }
  const uniqueItems = dedupeWeeklyProcessItems(items);
  const includedFiles = payload.files;
  const processPayload = {
    ...payload,
    files: includedFiles,
    items: uniqueItems,
    preprocessing: { exclusions: [...exclusions].map(([sourcePath, reason]) => ({ sourcePath, reason })) },
    stats: {
      ...payload.stats,
      fileCount: includedFiles.length,
      itemCount: items.length,
      uniqueItemCount: uniqueItems.length,
      duplicateCount: items.length - uniqueItems.length
    }
  };
  const voiceItems = uniqueItems.filter((item) => item.path.endsWith("/voice.md"));
  const voiceSourceChars = payload.files.filter((file) => file.path.endsWith("/voice.md")).reduce((sum, file) => sum + (file.rawChars || 0), 0);
  const voiceOutputChars = voiceItems.reduce((sum, item) => sum + inputSize(item.text).chars, 0);
  const compression = {
    sourceCount: voiceItems.length,
    sourceChars: voiceSourceChars,
    outputChars: voiceOutputChars,
    retainedRatio: voiceSourceChars ? Number((voiceOutputChars / voiceSourceChars).toFixed(3)) : 0,
    reductionRatio: voiceSourceChars ? Number((1 - voiceOutputChars / voiceSourceChars).toFixed(3)) : 0,
    targetRetainedRatio: VOICE_TARGET_RETAINED_RATIO,
    targetRetainedRatioRange: VOICE_TARGET_RETAINED_RATIO_RANGE,
    warnings: voiceSourceChars > MAX_VOICE_WEEKLY_INPUT_CHARS
      ? [`Voice.md 原始内容 ${voiceSourceChars} 字符，超过提示线 ${MAX_VOICE_WEEKLY_INPUT_CHARS} 字符；已使用预处理缓存。`]
      : [],
    files: voiceItems.map((item) => {
      const original = payload.items.find((candidate) => candidate.id === item.id);
      return {
        path: item.path,
        ...voiceCompressionMetrics(original?.text || "", item.text).overall,
        sourceChars: inputSize(original?.text || "").chars
      };
    })
  };
  return { processPayload, items: uniqueItems, compression };
}

export function dedupeWeeklyProcessItems(items) {
  const seen = new Map();
  for (const item of items) {
    const fingerprint = createItemFingerprint(item.text);
    if (!seen.has(fingerprint)) {
      seen.set(fingerprint, { ...item, fingerprint, duplicateSources: [] });
      continue;
    }
    seen.get(fingerprint).duplicateSources.push(item.path);
  }
  return [...seen.values()];
}

function createItemFingerprint(text) {
  return createHash("sha256").update(String(text).toLowerCase().replace(/\s+/g, "")).digest("hex");
}

async function atomicWrite(filePath, content) {
  const temp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temp, filePath); }
  finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

export function renderProcessPack(payload, sourceSummaries, fileSummaries, items, compression, previousOutput = {}) {
  return [
    `# Learn-X Process Pack｜${payload.week}`,
    "",
    "> 这是给 AI Chat 生成最终 Weekly Output 的上下文材料包；行动与反馈直接来自第 7 节各来源材料正文。",
    "> 本文件只保留必要来源索引和清洗正文；不要在这里做道 / 法 / 术 / Prompt / Skill 判断。",
    "",
    "## 0. 使用方式",
    "",
    "1. 第 9 节若含上周 Output，只能用于跨周对照；本周事实以本文件第 1–7 节为准。使用本文件和完整受治理 Weekly Output 主提示词生成最终 Weekly Output；`input.json` 是脚本中间态，仅在排错或核查来源时使用。",
    "2. Codex / 脚本只生成 `_dist` 和 `04_output/weekly/YYYY-WW.md` 最小壳；如果 Output 文件已有内容，不覆盖。",
    "3. 人再决定是否把正文写入 `04_output/weekly/YYYY-WW.md`，以及是否进入 Memory、正式 `道/`、`法/`、`术`、Prompt 或 Skill。",
    "",
    "## 1. 处理信息",
    "",
    `- 周期：${payload.range.start.slice(0, 10)} 到 ${inclusiveRangeEnd(payload.range.end)}`,
    `- 周目录：\`${payload.selection.path}\``,
    `- 选择方式：${payload.selection.mode}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 原始文件数：${payload.stats.fileCount}`,
    `- 有效材料数：${payload.stats.itemCount}`,
    `- 去重后材料数：${payload.stats.uniqueItemCount}`,
    `- 去重数量：${payload.stats.duplicateCount}`,
    `- 状态侧车排除的文件：${payload.stats.excludedFileCount}`,
    `- JSON 中间材料：\`04_output/_dist/weekly/${distWeekId(payload.week)}/input.json\``,
    "",
    "## 2. 输入与压缩总表",
    "",
    renderInputAuditTable(payload, fileSummaries, compression),
    "",
    "## 3. 来源状态",
    "",
    renderSourceStatuses(payload),
    "",
    "## 4. 来源覆盖",
    "",
    renderSourceCoverage(sourceSummaries),
    "",
    "## 5. 来源索引",
    "",
    renderSourceIndex(fileSummaries),
    "",
    "## 6. 统一压缩概览",
    "",
    renderCompressionSummary(compression),
    "",
    "## 7. 材料正文",
    "",
    renderFileMaterials(items, fileSummaries, payload.preprocessing),
    "",
    "## 9. 上周 Weekly Output（仅作对照）",
    "",
    renderPreviousWeeklyOutput(previousOutput)
  ].join("\n");
}

export async function readPreviousWeeklyOutput(weekId, root = repoRoot) {
  const week = previousWeeklyPeriod(weekId);
  const relativePath = `04_output/weekly/${outputWeekId(week)}.md`;
  try {
    const content = await readFile(path.join(root, relativePath), "utf8");
    return { week, relativePath, status: classifyWeeklyOutput(content), content };
  } catch (error) {
    if (error.code === "ENOENT") return { week, relativePath, status: "missing", content: "" };
    throw error;
  }
}

export function previousWeeklyPeriod(weekId) {
  const { start } = isoWeekRange(weekId);
  start.setUTCDate(start.getUTCDate() - 7);
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - jan4Weekday + 1);
  const week = Math.floor((start.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function classifyWeeklyOutput(content) {
  const text = String(content || "").trim();
  if (!text) return "empty";
  const bodyLines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^# Learn-X Weekly Output(?:｜|\|)/.test(line))
    .filter((line) => !/^> 基于 `04_output\/_dist\/weekly\/[^`]+` 由用户使用 AI Chat 生成正文后填入。?$/.test(line));
  const substantive = bodyLines.filter((line) => !/^#{1,6}\s/.test(line) && !isWeeklyOutputPlaceholderLine(line));
  return substantive.length ? "ready" : "shell";
}

function isWeeklyOutputPlaceholderLine(line) {
  const placeholder = line.trim()
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/^(?:问题|背景补充|回答)[：:]\s*/, "");
  return /^(?:xx+|todo|待补充|待填写|…+|\.\.\.)[。.!！?？]?$/i.test(placeholder);
}

function renderPreviousWeeklyOutput(previousOutput) {
  const week = previousOutput.week || "未知";
  const status = previousOutput.status || "missing";
  const pathNote = previousOutput.relativePath ? `；路径：\`${previousOutput.relativePath}\`` : "";
  if (status !== "ready") {
    return `- 基线：${week}，${status === "missing" ? "missing" : status === "empty" ? "empty" : "shell"}；不可比较${pathNote}。不回退到更早周。`;
  }
  const content = String(previousOutput.content || "").trim();
  const fenceLength = Math.max(3, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(fenceLength);
  return [
    `- 基线：${week}，ready${pathNote}。`,
    "> 以下是上周完整 Weekly Output，只作对照，不是本周事实；本周事实以 Process Pack 当前周材料为准。",
    "",
    `${fence}markdown`,
    content,
    fence
  ].join("\n");
}

export function buildInputAuditRows(payload, fileSummaries, compression) {
  const summariesByFile = new Map(fileSummaries.map((file) => [path.basename(file.path), file]));
  const statusesByFile = new Map(Object.entries(payload.sourceStatuses || {}).map(([source, entry]) => [entry.file, { source, entry }]));
  const fixedFiles = new Set(FIXED_WEEKLY_INPUTS.map((definition) => definition.file));
  const rows = FIXED_WEEKLY_INPUTS
    .filter((definition) => !payload.omittedSources?.includes(definition.statusSource))
    .map((definition) => buildInputAuditRow({
    payload,
    definition,
    fileSummary: summariesByFile.get(definition.file),
    statusInfo: definition.statusSource ? statusesByFile.get(definition.file) : undefined
  }));

  for (const fileSummary of fileSummaries) {
    const fileName = path.basename(fileSummary.path);
    if (fixedFiles.has(fileName)) continue;
    rows.push({
      ...buildInputAuditRow({ payload, definition: { file: fileName, type: "其他", source: fileSummary.source || "未命名来源", mode: "extra" }, fileSummary }),
      status: "ready（其他）",
      result: "纳入；如持续出现，请补入固定来源目录"
    });
  }

  return rows;
}

function buildInputAuditRow({ payload, definition, fileSummary, statusInfo }) {
  const entry = statusInfo?.entry;
  const isManual = definition.mode === "manual";
  const hasMaterial = Boolean(fileSummary);
  const isReady = entry?.status === "ready" || (!entry && hasMaterial);
  const status = entry?.status || (hasMaterial ? (isManual ? "ready（人工）" : "ready（兼容）") : "未发现");
  const stale = entry?.preservedStaleFile ? "；旧文件保留但过期、不计入" : "";
  const present = hasMaterial || Boolean(payload.excludedFiles?.some((file) => file.file === definition.file && file.present));
  const filePath = fileSummary?.path || `03_input/weekly/${distWeekId(payload.week)}/${definition.file}`;
  const link = present ? localFileLink(filePath, definition.file) : "—";

  let result;
  const preparedExclusion = payload.preprocessing?.exclusions?.find((item) => item.sourcePath === fileSummary?.path);
  if (entry && entry.status !== "ready") {
    result = `排除：${entry.summary || entry.status}${stale}`;
  } else if (preparedExclusion) {
    result = `排除：预处理未就绪（${preparedExclusion.reason}）`;
  } else if (entry?.status === "ready" && !hasMaterial) {
    result = "异常：状态为 ready，但没有可纳入的有效材料";
  } else if (isReady) {
    result = isManual ? "纳入（人工文件）" : "纳入";
  } else if (isManual) {
    result = definition.note || "可选，当前未发现";
  } else {
    result = "未执行或未登记；不计入";
  }

  return {
    type: definition.type,
    source: definition.source,
    group: definition.group || "extra",
    priority: definition.priority,
    blocksPack: Boolean(definition.blocksPack),
    file: definition.file,
    status: preparedExclusion ? `${status}（预处理排除）` : status,
    count: isReady && fileSummary ? (entry?.count ?? fileSummary.itemCount) : (entry?.count ?? 0),
    rawChars: isReady && fileSummary ? fileSummary.rawChars : "—",
    effectiveChars: isReady && fileSummary ? fileSummary.effectiveChars : "—",
    processChars: isReady && fileSummary ? fileSummary.processChars : "—",
    compressionNote: "",
    result,
    link,
    note: entry?.summary || definition.note || "",
    optional: Boolean(definition.optional),
    trustedEmpty: Boolean(entry?.status === "empty" && entry.count === 0
      && ["flomo", "voice"].includes(statusInfo?.source)
      && hasTrustedEmptyScan(entry.summary, payload.week, statusInfo.source))
  };
}

export function renderInputAuditTable(payload, fileSummaries, compression) {
  const rows = buildInputAuditRows(payload, fileSummaries, compression);
  return [
    "> 周记是阶段前提，自动来源按统一配置排序。输入行展示文件原始 → 解析清洗有效（去重前）→ Process Pack 最终纳入；只有发生实际压缩时才显示比例。",
    `> 本轮需关注：${renderInputAttention(rows)}`,
    "",
    "| 组别 / 优先级 | 类型 / 产物 | 来源 | 文件 | 状态 | 记录/材料 | 字符链路（文件原始 → 清洗有效〔去重前〕→ 最终纳入） | 结果 |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- |",
    ...rows.map((row) => {
      const detail = compression.files?.find((item) => item.path.endsWith(`/${row.file}`));
      const compressionNote = detail && detail.retainedRatio < 1 ? `（Voice-X 压缩，保留 ${Math.round(detail.retainedRatio * 100)}%）` : "";
      const characterChain = row.rawChars === "—" ? "—" : `${row.rawChars} → ${row.effectiveChars} → ${row.processChars}${compressionNote}`;
      const fileCell = row.link === "—" ? row.file : row.link;
      const group = row.group === "stage" ? "阶段前提" : `${row.blocksPack ? "重要" : "可选"} / P${row.priority}`;
      return `| ${group} | ${row.type} | ${row.source} | ${fileCell} | ${row.status} | ${row.count} | ${characterChain} | ${escapeTableCell(row.result)} |`;
    })
  ].join("\n");
}

function renderInputAttention(rows) {
  const attention = rows
    .filter((row) => !row.trustedEmpty && (row.blocksPack || row.priority === 0)
      && (/^(empty|failed|unavailable|未发现|未登记|needs_review|待人工审核)/.test(row.status) || row.result.startsWith("异常")))
    .map((row) => `${row.blocksPack ? "阻断" : "P0缺口"}：${row.source}（${row.file}：${row.status}）`);
  return attention.length ? attention.join("；") : "无";
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
      targetRetainedRatioRange: VOICE_TARGET_RETAINED_RATIO_RANGE,
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
  const [minimumRetainedRatio, maximumRetainedRatio] = compression.targetRetainedRatioRange || VOICE_TARGET_RETAINED_RATIO_RANGE;
  return [
    `- Voice-X：整体原始 ${compression.sourceChars} 字符 → Process Pack ${compression.outputChars} 字符；整体保留比例 ${Math.round(compression.retainedRatio * 100)}%，整体压缩幅度 ${Math.round(compression.reductionRatio * 100)}%；目标保留 ${Math.round(minimumRetainedRatio * 100)}%–${Math.round(maximumRetainedRatio * 100)}%（压缩预算中心 ${Math.round(compression.targetRetainedRatio * 1000) / 10}%）。`,
    ...compression.warnings.map((warning) => `- 强提示：${warning}`),
    "",
    "| 文件 | 原始字符 | 纳入 Process Pack 字符 | 保留比例 |",
    "| --- | ---: | ---: | ---: |",
    ...compression.files.map((file) => `| ${file.path} | ${file.sourceChars} | ${file.candidateChars} | ${Math.round(file.retainedRatio * 100)}% |`)
  ].join("\n");
}

function renderSourceStatuses(payload) {
  const rows = Object.entries(payload.sourceStatuses || {})
    .filter(([source]) => !payload.omittedSources?.includes(source))
    .sort(([left], [right]) => (weeklySourceForId(left)?.order ?? Number.MAX_SAFE_INTEGER) - (weeklySourceForId(right)?.order ?? Number.MAX_SAFE_INTEGER))
    .map(([source, entry]) => {
    const usable = entry.status === "ready" ? "计入" : "排除";
    const stale = entry.preservedStaleFile ? "旧文件已保留但过期" : "无旧文件";
    const present = payload.files.some((file) => file.path.endsWith(`/${entry.file}`))
      || payload.excludedFiles.some((file) => file.file === entry.file && file.present);
    const link = present ? localFileLink(`${payload.selection.path}/${entry.file}`, entry.file) : "—";
    return `| ${source} | ${entry.status} | ${entry.count} | ${link} | ${usable} | ${stale}；${entry.summary} |`;
  });
  if (!rows.length) return "- 未发现状态侧车；按历史周兼容规则读取现有文件。";
  return [
    "| 来源 | 状态 | 记录数 | 核查文件 | 本轮处理 | 说明 |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...rows
  ].join("\n");
}

function inclusiveRangeEnd(exclusiveEnd) {
  const date = new Date(exclusiveEnd);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function ensureWeeklyOutputShell(weekId, root = repoRoot) {
  const outputPath = path.join(root, "04_output/weekly", `${outputWeekId(weekId)}.md`);
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

export function buildSourceSummaries(payload) {
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

  return [...bySource.values()].sort(compareWeeklySources);
}

export function buildFileSummaries(payload, processItems = payload.items) {
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

  return [...byPath.values()].sort(compareWeeklySources);
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
    return `| ${sourceId} | ${file.category} | ${file.source} | ${localFileLink(file.path)} | ${file.itemCount} | ${file.rawChars} → ${file.effectiveChars} → ${file.processChars} |`;
  });

  return [
    "> source id 用于在 AI Chat 中回溯来源；完整机器字段见同目录 `input.json`。",
    "",
    "| source id | 输入类型 | 来源 | 核查文件 | 材料数 | 字符链路（原始 → 纳入） |",
    "| --- | --- | --- | --- | ---: | ---: |",
    ...rows
  ].join("\n");
}

function localFileLink(filePath, label = path.basename(filePath)) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
  return `[${label}](learnx://${encodeURIComponent(relativePath)})`;
}

function escapeTableCell(value) {
  return String(value ?? "").replaceAll("|", "／").replace(/[\r\n]+/g, " ").trim();
}

function renderFileMaterials(items, fileSummaries, preprocessing = {}) {
  if (!items.length) return "- 本周没有有效材料。";

  const itemsByPath = new Map();
  for (const item of items) {
    if (!itemsByPath.has(item.path)) itemsByPath.set(item.path, []);
    itemsByPath.get(item.path).push(item);
  }

  return fileSummaries.map((file, index) => {
    const sourceId = sourceFileId(index);
    const fileItems = itemsByPath.get(file.path) || [];
    const excluded = preprocessing.exclusions?.find((item) => item.sourcePath === file.path);
    const body = excluded
      ? `- 排除：预处理未就绪（${excluded.reason}）。原始输入保留在 \`${file.path}\`。`
      : fileItems.length === 1
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
    if (argv[index] === "--prepare") options.prepare = true;
    if (argv[index] === "--week") {
      options.week = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateWeeklyProcessPack(parseArgs(process.argv.slice(2)));

  if (result.prepared) {
    console.log(`Weekly preprocessing manifest: ${path.relative(repoRoot, result.preparation.manifestPath)}`);
    console.log(`Preparation requests: ${result.preparation.requests.length}`);
    console.log(`Pack-blocking preparation: ${result.preparation.requests.filter((request) => request.required).length}`);
    console.log(`Optional exclusions: ${result.preparation.exclusions.length}`);
    for (const request of result.preparation.requests) {
      console.log(`Candidate required (${request.required ? "blocks Pack" : "optional"}): ${request.sourcePath} -> ${request.candidatePath} (${request.reason})`);
    }
  } else {
    console.log(`Weekly input pack generated: 04_output/_dist/weekly/${distWeekId(result.payload.week)}/input.json`);
    console.log(`Weekly process pack generated: ${path.relative(repoRoot, result.outputPath)}`);
    console.log(`Previous Weekly Output baseline: ${result.previousOutput.week} (${result.previousOutput.status}) at ${result.previousOutput.relativePath}`);
    console.log(`Weekly output shell ready: ${path.relative(repoRoot, result.shellPath)}`);
    console.log(`Input files: ${result.payload.stats.fileCount}`);
    console.log(`Unique items: ${result.processPayload.stats.uniqueItemCount}`);
    console.log(`Sources: ${result.sourceSummaries.map((source) => `${source.source}:${source.itemCount}`).join(", ") || "none"}`);
    const attention = Object.entries(result.payload.sourceStatuses || {})
      .filter(([, entry]) => entry.status !== "ready")
      .map(([source, entry]) => `${source}:${entry.status}（${entry.summary}）`);
    console.log(`Input attention: ${attention.join("；") || "none"}`);
  }
}

function distWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-(\d{1,2})$/, (_match, year, week) => `${year}-W${String(week).padStart(2, "0")}`);
}

function outputWeekId(weekId) {
  return String(weekId).replace(/^(\d{4})-W?(\d{1,2})$/, (_match, year, week) => `${year}-${String(week).padStart(2, "0")}`);
}

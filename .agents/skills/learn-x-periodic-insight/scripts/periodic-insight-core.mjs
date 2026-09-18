import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readPromptAssets, verifyPromptAssets } from "../../../../app/code/scripts/prompt-assets.mjs";

export const RANGE_IDS = new Set(["1m", "3m", "6m", "1y", "all", "custom"]);
export const SELECTABLE_MATERIAL_TYPES = ["life-core", "target-journal", "history-backbone", "flomo"];
export const MATERIAL_TYPES = ["target-output", ...SELECTABLE_MATERIAL_TYPES];
const DAY = 86_400_000;
const PLACEHOLDER_RE = /^(?:TODO|待补充|暂无内容|占位|请在此|未完成|内容为空)/i;
const SECTION_RE = /^(#{1,6})\s+(.+?)\s*$/gm;

const LIFE_CORE_RELATIVE = "01_core/道/人生核心议题.md";
const REQUIRED_LIFE_CORE_H1 = ["长期核心议题", "中期核心议题", "短期核心议题"];
// Learn-X 反向同步 memo 的生成标题前缀；普通正文仅提到 Learn-X 不受影响。
const REVERSE_SYNC_TITLE_PREFIXES = ["Learn-X 周记", "Learn-X 月记", "Learn-X 记忆", "Learn-X 同步校验", "AI 基础草稿", "# 飞书周记"];
// 远 6 个月之外的高信号标签：先按首段前缀匹配，再匹配精确标签；"问题类标签"按包含"问题"判断。
const OLDER_FLOMO_TAG_PREFIXES = ["回顾", "需回顾", "常用", "自我认知", "重大决策", "规划", "第一性原理", "语音日记", "旅行", "旅游", "博物馆", "美术馆", "生活", "城市", "电影", "展览"];
const OLDER_FLOMO_TAG_EXACT = ["写作/文章", "记录/思考"];

export async function readPeriodicConfig(repoRoot) { const config = JSON.parse(await readFile(path.join(repoRoot, "00_config/periodic-insights.json"), "utf8")); return validatePeriodicConfig(config); }
export function validatePeriodicConfig(config) {
  if (!config || config.schemaVersion !== 2 || !config.contextPolicies || !Array.isArray(config.tasks)) throw new Error("周期洞察配置契约无效");
  for (const [id, policy] of Object.entries(config.contextPolicies)) {
    if (!validMaterialTypeList(policy?.defaultMaterialTypes) || !RANGE_IDS.has(policy.defaultRange) || !Number.isInteger(policy.maxContextChars) || policy.maxContextChars <= 0 || (policy.maxPromptChars !== undefined && (!Number.isInteger(policy.maxPromptChars) || policy.maxPromptChars <= 0)) || !policy.timezone) throw new Error(`Context Policy 无效：${id}`);
  }
  const ids = new Set();
  for (const task of config.tasks) {
    if (!/^[a-z0-9-]+$/.test(task.id || "") || ids.has(task.id) || !task.name || !task.prompt || typeof task.prompt.productionReady !== "boolean" || !Array.isArray(task.prompt.defaultEnhancerIds) || !task.target || !["month", "week"].includes(task.target.preferred) || (task.target.fallback && !["month", "week"].includes(task.target.fallback)) || !config.contextPolicies[task.contextPolicyId]) throw new Error(`洞察任务无效：${task.id || "unknown"}`);
    if (task.automation && (typeof task.automation.enabled !== "boolean" || !["weekly", "monthly"].includes(task.automation.cadence))) throw new Error(`洞察自动化配置无效：${task.id}`);
    if (task.output && (task.output.local !== true || typeof task.output.feishu !== "boolean")) throw new Error(`洞察输出配置无效：${task.id}`);
    ids.add(task.id);
  }
  return config;
}
function validMaterialTypeList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const seen = new Set();
  for (const item of list) { if (!SELECTABLE_MATERIAL_TYPES.includes(item) || seen.has(item)) return null; seen.add(item); }
  return list;
}
export function findTask(config, taskId) { const task = (config.tasks || []).find((item) => item.id === taskId); if (!task) throw new Error(`未知洞察任务：${taskId}`); return task; }
export function isSubstantive(content) { const value = String(content || "").replace(/<!--[^]*?-->/g, "").trim(); const body = value.replace(/^#{1,6}\s+[^\n]+\n+/, "").trim(); return value.length >= 120 && !PLACEHOLDER_RE.test(body); }

// includeTypes 参数解析：未传时使用全部默认类型；未知值、重复值、路径注入一律失败；
// target-output 永远有效且不能被关闭。
export function resolveMaterialTypes(param, policy) {
  const defaults = validMaterialTypeList(policy?.defaultMaterialTypes) || [...SELECTABLE_MATERIAL_TYPES];
  if (param === undefined || param === null || param === "") return { selected: [...defaults], available: [...MATERIAL_TYPES], disabled: [] };
  const parts = Array.isArray(param) ? param : String(param).split(",");
  if (parts.some((part) => !/^[a-z][a-z-]*$/.test(part))) throw new Error(`includeTypes 含未知材料类型：${param}`);
  if (new Set(parts).size !== parts.length) throw new Error(`includeTypes 含重复材料类型：${param}`);
  for (const part of parts) if (!MATERIAL_TYPES.includes(part)) throw new Error(`includeTypes 含未知材料类型：${part}`);
  const selected = parts.filter((part) => part !== "target-output");
  return { selected, available: [...MATERIAL_TYPES], disabled: defaults.filter((type) => !selected.includes(type)) };
}

export function parseMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/); if (!match) throw new Error(`月份格式无效：${value}`);
  const year = Number(match[1]); const month = Number(match[2]);
  return { kind: "month", id: `${match[1]}-${match[2]}`, start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}
export function parseIsoWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W?(\d{2})$/i); if (!match) throw new Error(`ISO 周格式无效：${value}`);
  const year = Number(match[1]); const week = Number(match[2]); if (week < 1 || week > 53) throw new Error(`ISO 周无效：${value}`);
  const jan4 = new Date(Date.UTC(year, 0, 4)); const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY);
  const thursday = new Date(monday.getTime() + 3 * DAY); if (thursday.getUTCFullYear() !== year) throw new Error(`ISO 周无效：${value}`);
  return { kind: "week", id: `${year}-W${String(week).padStart(2, "0")}`, start: monday, end: new Date(monday.getTime() + 7 * DAY) };
}
export function parseTarget(value) { return /^\d{4}-\d{2}$/.test(String(value || "")) ? parseMonth(value) : parseIsoWeek(value); }
export function parseRange(range = "1y", from, to, upperBound = new Date()) {
  if (!RANGE_IDS.has(range)) throw new Error(`不支持的 Context 范围：${range}`);
  const bound = new Date(upperBound); bound.setUTCHours(23, 59, 59, 999); const customStart = toDate(from); const customEnd = toDate(to); if ((from && !customStart) || (to && !customEnd) || (range === "custom" && (!customStart || !customEnd))) throw new Error("Context 日期范围需要有效的 from/to，且 from 不晚于 to"); const requestedEnd = customEnd || bound; requestedEnd.setUTCHours(23, 59, 59, 999); const end = new Date(Math.min(requestedEnd.getTime(), bound.getTime()));
  if (range === "all") return { id: range, start: new Date(0), end };
  if (range === "custom") { if (customStart > end) throw new Error("Context 日期范围需要有效的 from/to，且 from 不晚于 to"); customStart.setUTCHours(0, 0, 0, 0); return { id: range, start: customStart, end }; }
  const amount = Number(range.slice(0, -1)); const months = range.endsWith("y") ? amount * 12 : amount;
  return { id: range, start: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1)), end };
}

// ---- 时区与自然月 ----
function tzOffsetMs(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) - instant;
}
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const naive = Date.parse(`${dateStr}T${timeStr || "00:00:00"}Z`);
  if (!Number.isFinite(naive)) return null;
  const assumed = naive - tzOffsetMs(naive, timeZone);
  return new Date(naive - tzOffsetMs(assumed, timeZone));
}
function zonedDateStr(instant, timeZone) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant)); }
function monthIdOfDateStr(dateStr) { return dateStr.slice(0, 7); }
function addMonths(monthId, delta) { const [year, month] = monthId.split("-").map(Number); const shifted = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`; }
function unpaddedMonthDir(monthId) { const [, month] = monthId.split("-").map(Number); return `${monthId.slice(0, 4)}-${month}`; }
function isoWeekOf(date) {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (cursor.getUTCDay() + 6) % 7;
  const thursday = new Date(cursor.getTime() + (3 - dayNum) * DAY);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  const week = Math.round((thursday.getTime() - week1Monday.getTime()) / (7 * DAY)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function mondayOf(date) { const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); return new Date(cursor.getTime() - ((cursor.getUTCDay() + 6) % 7) * DAY); }
function weeksIntersectingMonth(monthId) {
  const period = parseMonth(monthId); const weekIds = [];
  for (let monday = mondayOf(period.start); monday < period.end; monday = new Date(monday.getTime() + 7 * DAY)) weekIds.push(isoWeekOf(monday));
  return [...new Set(weekIds)];
}

export async function resolveTarget(repoRoot, task, requested = "auto", now = new Date()) {
  const today = startOfDayShanghai(now);
  if (requested && requested !== "auto") { const target = parseTarget(requested); if (target.end > today) return null; const file = await targetFile(repoRoot, target); return file && isSubstantive(file.content) ? { ...target, ...file } : null; }
  const months = await listPeriodFiles(repoRoot, "month");
  const weeks = await listPeriodFiles(repoRoot, "week");
  if (task.target.preferred === "month") {
    const currentMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const previousMonth = months.find((item) => item.id === monthId(new Date(currentMonthStart.getTime() - DAY)) && item.end <= today);
    if (previousMonth && isSubstantive(previousMonth.content)) return previousMonth;
    if (task.target.fallback !== "week") return null;
    for (const item of [...weeks].reverse()) if (item.end <= today && isSubstantive(item.content)) return item;
    return null;
  }
  for (const item of [...weeks].reverse()) if (item.end <= today && isSubstantive(item.content)) return item;
  return null;
}

// ---- Context Builder：目标对象 + 可选材料类型 + 统一预算 ----
export async function buildInsightContext({ repoRoot, taskId, target = "auto", range, from, to, includeTypes, now = new Date() }) {
  const config = await readPeriodicConfig(repoRoot); const task = findTask(config, taskId); const policy = config.contextPolicies?.[task.contextPolicyId];
  if (!policy) throw new Error(`缺少 Context Policy：${task.contextPolicyId}`);
  const types = resolveMaterialTypes(includeTypes, policy);
  const budget = { contextChars: policy.maxContextChars, promptChars: policy.maxPromptChars || 120000 };
  const resolved = await resolveTarget(repoRoot, task, target, now);
  if (!resolved) {
    const manifest = { schemaVersion: 2, taskId, target: null, range: null, budget, availableTypes: types.available, selectedTypes: ["target-output", ...types.selected], chars: 0, included: [], excluded: [{ reason: "no-substantive-target" }] };
    return { task, target: null, range: null, budget, availableTypes: types.available, selectedTypes: manifest.selectedTypes, included: manifest.included, excluded: manifest.excluded, content: "", chars: 0, sha256: sha256(""), manifest };
  }
  const historyRange = parseRange(range || policy.defaultRange, from, to, new Date(resolved.end.getTime() - 1));
  const tz = policy.timezone;
  const targetStartMonth = monthIdOfDateStr(zonedDateStr(resolved.start, tz));
  const inventory = await buildInputInventory(repoRoot);

  const units = []; const excluded = []; const internal = { flomo: [] };
  const overlapsTarget = (period) => period.start < resolved.end && period.end > resolved.start;

  // 1) 目标周期 Output：隐式强制，唯一洞察对象。
  units.push({ id: "target-output", type: "target-output", kind: "target-output", phase: 1, tier: 1, order: 0, forced: true, path: resolved.path, dateBasis: resolved.id, content: resolved.content });
  // 2) 人生核心议题：本地最后有效镜像，不受历史范围约束。
  if (types.selected.includes("life-core")) {
    const raw = await readOptional(path.join(repoRoot, LIFE_CORE_RELATIVE));
    if (raw === null || !isSubstantive(raw)) excluded.push({ path: LIFE_CORE_RELATIVE, role: "life-core", kind: "life-core", chars: charCount(raw || ""), reason: "missing-or-empty" });
    else {
      const { header, body } = parseMirrorHeader(raw);
      units.push({ id: "life-core", type: "life-core", kind: "life-core", phase: 0, order: 0, tier: 1, path: LIFE_CORE_RELATIVE, dateBasis: "long-term", content: body, sync: { status: header.status === "stale" ? "stale" : "fresh", syncedAt: header["last-synced-at"] || null, revision: header.revision || null, bodySha256: header["body-sha256"] || null } });
    }
  }
  // 3) 目标周期周记。
  if (types.selected.includes("target-journal")) await collectTargetJournals({ repoRoot, resolved, units, excluded });
  // 4) 历史骨架：Memory 日期段 → 月记 → 周记 逐周期补位。
  if (types.selected.includes("history-backbone")) await collectHistoryBackbone({ repoRoot, resolved, historyRange, tz, targetStartMonth, inventory, units, excluded, overlapsTarget });
  // 5) Flomo：近 6 个月全量 + 更早高信号精选，全局去重。
  if (types.selected.includes("flomo")) await collectFlomo({ repoRoot, historyRange, tz, targetStartMonth, inventory, units, excluded, internal });
  for (const type of types.disabled) excluded.push({ role: type, kind: type, reason: "user-disabled" });

  // 预算：目标 Output 先行保留（自身超限即失败关闭），其余按预算顺序贪心装填，整项加入、不截断。
  const header = [`# PERIODIC INSIGHT CONTEXT`, ``, `- 任务：${task.name}（${task.id}）`, `- 目标周期：${resolved.id}（${resolved.kind}）`, `- 历史范围：${historyRange.id}`, `- 时区：${tz}`, `- 材料类型：${["target-output", ...types.selected].join(", ")}`, ``, "以下材料由固定白名单按类型、日期和预算装配；目标输出与历史背景不可混淆。", ""].join("\n");
  const targetUnit = units.find((unit) => unit.id === "target-output");
  const chosen = [targetUnit];
  let total = charCount(header) + renderUnit(targetUnit).length + 7;
  if (total > budget.contextChars) throw new Error(`Context 超过 ${budget.contextChars} 字符上限`);
  const chargedFiles = new Set();
  for (const unit of units.filter((item) => item !== targetUnit).sort((a, b) => a.tier - b.tier || a.order - b.order)) {
    let size = renderUnit(unit).length + (unit.type === "flomo" ? 2 : 7);
    if (unit.type === "flomo" && !chargedFiles.has(unit.path)) { chargedFiles.add(unit.path); size += `## Flomo · ${unit.path}\n\n`.length + 7; }
    if (total + size <= budget.contextChars) { total += size; chosen.push(unit); }
    else excluded.push({ path: unit.path, role: unit.type, kind: unit.kind, chars: renderUnit(unit).length, dateBasis: unit.dateBasis, reason: "context-budget" });
  }

  // 组装：人生核心议题 → 目标输出 → 目标周记 → 历史骨架 → Flomo；Flomo 同文件 memo 聚合为一个块。
  const assembly = [...chosen].sort((a, b) => a.phase - b.phase || a.order - b.order);
  const groupBlocks = new Map();
  const blocks = [];
  for (const unit of assembly) {
    if (unit.type !== "flomo") { blocks.push(blockFor(unit)); continue; }
    let block = groupBlocks.get(unit.path);
    if (!block) { block = { path: unit.path, parts: [] }; groupBlocks.set(unit.path, block); blocks.push(block); }
    block.parts.push(renderUnit(unit));
  }
  const content = `${header}${blocks.map((block) => typeof block === "string" ? block : `## Flomo · ${block.path}\n\n${[...block.parts].sort((a, b) => a.slice(4, 24).localeCompare(b.slice(4, 24))).join("\n\n")}\n`).join("\n---\n\n")}`.trimEnd() + "\n";
  if (charCount(content) > budget.contextChars) throw new Error(`Context 超过 ${budget.contextChars} 字符上限`);

  const included = aggregateIncluded(assembly);
  const manifest = {
    schemaVersion: 2,
    taskId,
    target: { id: resolved.id, kind: resolved.kind, path: resolved.path, start: resolved.start.toISOString().slice(0, 10), end: new Date(resolved.end.getTime() - 1).toISOString().slice(0, 10) },
    range: { id: historyRange.id, from: historyRange.start.toISOString().slice(0, 10), to: historyRange.end.toISOString().slice(0, 10) },
    budget,
    availableTypes: types.available,
    selectedTypes: ["target-output", ...types.selected],
    chars: charCount(content),
    included,
    excluded: aggregateExcluded(excluded),
    internal
  };
  return { task, target: manifest.target, range: manifest.range, budget, availableTypes: types.available, selectedTypes: manifest.selectedTypes, included, excluded: manifest.excluded, chars: manifest.chars, sha256: sha256(content), content, manifest };
}

function renderUnit(unit) { return unit.type === "flomo" ? `### ${unit.memo.label}\n\n${unit.memo.body.trim()}` : unit.content; }
function blockFor(unit) {
  if (unit.id === "life-core") return `## 人生核心议题 · ${LIFE_CORE_RELATIVE}\n\n${unit.content.trim()}\n`;
  if (unit.type === "target-output") return `## 目标输出 · ${unit.path}\n\n${unit.content.trim()}\n`;
  if (unit.type === "target-journal") return `## 目标周记 · ${unit.path}\n\n${unit.content.trim()}\n`;
  if (unit.kind === "memory-month" || unit.kind === "memory-week") return `## 历史记忆 · ${unit.path} · ${unit.heading}\n\n${unit.content.trim()}\n`;
  if (unit.kind === "monthly-journal") return `## 月记 · ${unit.path}\n\n${unit.content.trim()}\n`;
  return `## 历史周记 · ${unit.path}\n\n${unit.content.trim()}\n`;
}

function aggregateIncluded(chosen) {
  const entries = []; const byPath = new Map();
  for (const unit of chosen) {
    const key = `${unit.type}|${unit.kind}|${unit.path}`;
    const chars = renderUnit(unit).length;
    const existing = byPath.get(key);
    if (existing) { existing.items += 1; existing.chars += chars; existing.dateRange = mergeDateRange(existing.dateRange, unit.dateBasis); if (unit.sync) existing.sync = unit.sync; continue; }
    const entry = { path: unit.path, role: unit.type, kind: unit.kind, tier: unit.tier, items: 1, chars, dateBasis: unit.dateBasis, dateRange: unit.dateBasis };
    if (unit.sync) entry.sync = unit.sync;
    byPath.set(key, entry); entries.push(entry);
  }
  return entries;
}
function mergeDateRange(current, next) {
  const values = [current, next].flat().filter(Boolean);
  const dates = values.flatMap((value) => String(value).split("..")).sort();
  return dates.length > 1 ? `${dates[0]}..${dates[dates.length - 1]}` : dates[0] || null;
}
function aggregateExcluded(excluded) {
  const map = new Map();
  for (const item of excluded) {
    const key = `${item.role || ""}|${item.kind || ""}|${item.path || ""}|${item.reason}`;
    const entry = map.get(key) || { ...(item.path ? { path: item.path } : {}), role: item.role, ...(item.kind ? { kind: item.kind } : {}), items: 0, chars: 0, reason: item.reason };
    entry.items += 1; entry.chars += item.chars || 0;
    if (item.dateBasis) entry.dateBasis = mergeDateRange(entry.dateBasis, item.dateBasis);
    map.set(key, entry);
  }
  return [...map.values()];
}

// ---- 目标周期周记 ----
async function collectTargetJournals({ repoRoot, resolved, units, excluded }) {
  let weekIds;
  if (resolved.kind === "week") weekIds = [resolved.id];
  else {
    const input = await readJson(path.join(repoRoot, "04_output/_dist/monthly", resolved.id, "input.json"));
    const declared = (input?.selection?.weeklyPaths || []).map((dir) => String(dir).match(/(\d{4}-W\d{2})$/)?.[1]).filter(Boolean);
    weekIds = declared.length ? declared : weeksIntersectingMonth(resolved.id);
  }
  let order = 30;
  for (const weekId of weekIds) {
    const journal = await readWeeklyJournal(repoRoot, weekId);
    if (!journal || !isSubstantive(journal.content)) { excluded.push({ path: journal?.path || weeklyJournalPath(weekId), role: "target-journal", kind: "weekly-journal", chars: charCount(journal?.content || ""), dateBasis: weekId, reason: "missing-or-empty" }); continue; }
    units.push({ id: `target-journal:${weekId}`, type: "target-journal", kind: "weekly-journal", phase: 2, tier: 1, order: order += 1, path: journal.path, dateBasis: weekId, content: journal.content });
  }
}
function weeklyJournalPath(weekId) { return `03_input/weekly/${weekId}/weekly.md`; }
async function readWeeklyJournal(repoRoot, weekId) {
  for (const relative of [weeklyJournalPath(weekId), `03_input/weekly-history/${weekId}/weekly.md`]) {
    const content = await readOptional(path.join(repoRoot, relative));
    if (content !== null) return { path: relative, content };
  }
  return null;
}

// ---- 历史骨架 ----
async function collectHistoryBackbone({ repoRoot, resolved, historyRange, tz, targetStartMonth, inventory, units, excluded, overlapsTarget }) {
  const memories = await listMemoryFiles(repoRoot);
  for (const invalid of memories.invalid) excluded.push({ path: invalid.path, role: "history-backbone", kind: "memory-invalid", chars: invalid.chars, reason: "invalid-period" });
  const candidates = [];
  for (const memory of memories.valid) {
    for (const segment of parseMemorySegments(memory.content)) {
      const text = segment.content.trim();
      // 未注明日期的候选观察池不作为历史骨架，但保留排除证据。
      if (segment.kind === "undated") { if (text) excluded.push({ path: memory.path, role: "history-backbone", kind: "memory-undated", chars: text.length, reason: "undated-candidate-pool" }); continue; }
      let period;
      try { period = segment.kind === "month" ? parseMonth(segment.id) : parseIsoWeek(segment.id); } catch { excluded.push({ path: memory.path, role: "history-backbone", kind: "memory-invalid", chars: text.length, dateBasis: segment.id, reason: "invalid-period" }); continue; }
      const basis = { path: memory.path, heading: segment.heading, kind: segment.kind, id: segment.id, period, content: segment.content };
      if (overlapsTarget(basis.period)) excluded.push({ path: memory.path, role: "history-backbone", kind: "memory-overlap", chars: text.length, dateBasis: segment.id, reason: "overlaps-target" });
      else if (basis.period.end > resolved.start) excluded.push({ path: memory.path, role: "history-backbone", kind: "memory-overlap", chars: text.length, dateBasis: segment.id, reason: "after-target" });
      else if (basis.period.end <= historyRange.start || basis.period.start > historyRange.end) excluded.push({ path: memory.path, role: "history-backbone", kind: basis.kind === "month" ? "memory-month" : "memory-week", chars: text.length, dateBasis: segment.id, reason: "outside-range" });
      else if (!text || PLACEHOLDER_RE.test(text)) excluded.push({ path: memory.path, role: "history-backbone", kind: basis.kind === "month" ? "memory-month" : "memory-week", chars: text.length, dateBasis: segment.id, reason: "empty-or-placeholder" });
      else candidates.push(basis);
    }
  }
  const memoryWeekIds = new Set(candidates.filter((item) => item.kind === "week").map((item) => item.id));
  const monthByStart = new Map();
  // 月级 Memory 覆盖与其相交的周 Memory（按周期相交判断，而非仅按起始月分组）。
  const monthMemoryPeriods = candidates.filter((item) => item.kind === "month").map((item) => item.period);
  const backbone = candidates.filter((candidate) => {
    if (candidate.kind !== "week") return true;
    if (!monthMemoryPeriods.some((period) => candidate.period.start < period.end && candidate.period.end > period.start)) return true;
    excluded.push({ path: candidate.path, role: "history-backbone", kind: "memory-week", chars: candidate.content.trim().length, dateBasis: candidate.id, reason: "superseded-by-month-memory" });
    return false;
  });
  for (const candidate of backbone) {
    const monthId = monthIdOfDateStr(zonedDateStr(candidate.period.start, tz));
    if (!monthByStart.has(monthId)) monthByStart.set(monthId, []);
    monthByStart.get(monthId).push(candidate);
  }
  const monthDirsWithJournal = new Set();
  for (const monthId of inventory.months) if (await readOptional(path.join(repoRoot, "03_input/monthly", unpaddedMonthDir(monthId), "monthly-journal.md")) !== null) monthDirsWithJournal.add(monthId);
  const weekDirMonths = new Set();
  for (const weekId of inventory.weeks.keys()) {
    let week;
    try { week = parseIsoWeek(weekId); } catch { excluded.push({ path: inventory.weeks.get(weekId), role: "history-backbone", kind: "weekly-directory", dateBasis: weekId, reason: "invalid-period" }); continue; }
    weekDirMonths.add(monthIdOfDateStr(zonedDateStr(week.start, tz)));
  }
  const rangeStartMonth = monthIdOfDateStr(zonedDateStr(historyRange.start, tz));
  const potential = [...new Set([...monthByStart.keys(), ...monthDirsWithJournal, ...weekDirMonths])].filter((monthId) => monthId >= rangeStartMonth && monthId <= targetStartMonth).sort();
  let order = 100;
  const addedWeekJournals = new Set();
  for (let monthId = potential[0]; monthId && monthId <= targetStartMonth; monthId = addMonths(monthId, 1)) {
    const period = parseMonth(monthId);
    if (period.end <= historyRange.start || period.start > historyRange.end) continue;
    const forMonth = (monthByStart.get(monthId) || []).sort((a, b) => a.period.start - b.period.start);
    const monthMemory = forMonth.find((candidate) => candidate.kind === "month");
    if (monthMemory) { units.push({ id: `memory:${monthMemory.path}:${monthMemory.heading}`, type: "history-backbone", kind: "memory-month", phase: 3, tier: 2, order: order += 1, path: monthMemory.path, heading: monthMemory.heading, dateBasis: monthMemory.id, content: monthMemory.content }); for (const candidate of forMonth.filter((item) => item !== monthMemory)) excluded.push({ path: candidate.path, role: "history-backbone", kind: "memory-week", chars: candidate.content.trim().length, dateBasis: candidate.id, reason: "superseded-by-month-memory" }); continue; }
    if (forMonth.length) { for (const candidate of forMonth) units.push({ id: `memory:${candidate.path}:${candidate.heading}`, type: "history-backbone", kind: "memory-week", phase: 3, tier: 2, order: order += 1, path: candidate.path, heading: candidate.heading, dateBasis: candidate.id, content: candidate.content }); continue; }
    if (monthDirsWithJournal.has(monthId) && period.end <= resolved.start) {
      const monthJournal = await readMonthlyJournal(repoRoot, monthId);
      if (monthJournal && isSubstantive(monthJournal.content)) { units.push({ id: `monthly-journal:${monthId}`, type: "history-backbone", kind: "monthly-journal", phase: 3, tier: 2, order: order += 1, path: monthJournal.path, dateBasis: monthId, content: monthJournal.content }); continue; }
      if (monthJournal) excluded.push({ path: monthJournal.path, role: "history-backbone", kind: "monthly-journal", chars: charCount(monthJournal.content), dateBasis: monthId, reason: "empty-or-placeholder" });
    }
    let covered = false;
    for (const weekId of weeksIntersectingMonth(monthId)) {
      if (parseIsoWeek(weekId).end > resolved.start || memoryWeekIds.has(weekId) || addedWeekJournals.has(weekId)) continue;
      const journal = await readWeeklyJournal(repoRoot, weekId);
      if (!journal) continue;
      covered = true; addedWeekJournals.add(weekId);
      if (isSubstantive(journal.content)) units.push({ id: `weekly-journal:${weekId}`, type: "history-backbone", kind: "weekly-journal", phase: 3, tier: 2, order: order += 1, path: journal.path, dateBasis: weekId, content: journal.content });
      else excluded.push({ path: journal.path, role: "history-backbone", kind: "weekly-journal", chars: charCount(journal.content), dateBasis: weekId, reason: "empty-or-placeholder" });
    }
    if (!covered) excluded.push({ role: "history-backbone", kind: "history-gap", dateBasis: monthId, reason: "no-backbone-material" });
  }
}
async function readMonthlyJournal(repoRoot, monthId) {
  for (const dir of [unpaddedMonthDir(monthId), monthId]) {
    const relative = `03_input/monthly/${dir}/monthly-journal.md`;
    const content = await readOptional(path.join(repoRoot, relative));
    if (content !== null) return { path: relative, content };
  }
  return null;
}
export function parseMemorySegments(markdown) {
  const segments = []; let current = null;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const match = line.match(/^##(?!#)\s+(.+?)\s*$/);
    if (match) {
      const heading = match[1].trim();
      const weekId = /^(\d{4}-W\d{2})$/i.test(heading) ? heading.toUpperCase() : /^(\d{4}-\d{2})$/i.test(heading) ? heading.replace(/^(\d{4})-(\d{2})$/, (_, y, w) => `${y}-W${w}`) : null;
      const monthId = heading.match(/^Monthly｜(\d{4}-\d{2})$/)?.[1] || null;
      current = { kind: monthId ? "month" : weekId ? "week" : "undated", id: monthId || weekId, heading, lines: [] };
      segments.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const segment of segments) segment.content = segment.lines.join("\n").trim();
  return segments;
}

// ---- Flomo：近 6 个月全量 + 更早高信号精选，按 memo 粒度入预算，同文件聚合渲染 ----
async function collectFlomo({ repoRoot, historyRange, tz, targetStartMonth, inventory, units, excluded, internal }) {
  const recentFrom = addMonths(targetStartMonth, -5);
  const seen = new Map();
  const memoExcluded = new Map();
  const pushExcluded = (filePath, reason, memo, chars) => {
    const key = `${filePath}|${reason}`;
    const entry = memoExcluded.get(key) || { path: filePath, role: "flomo", kind: "flomo-memo", items: 0, chars: 0, reason, dateBasis: null };
    entry.items += 1; entry.chars += chars; entry.dateBasis = mergeDateRange(entry.dateBasis, memo?.dateStr);
    memoExcluded.set(key, entry);
  };
  const dirs = [...inventory.weeks.values(), ...inventory.months.map((monthId) => `03_input/monthly/${unpaddedMonthDir(monthId)}`)].sort();
  for (const dir of dirs) {
    const filePath = `${dir}/flomo.md`;
    const content = await readOptional(path.join(repoRoot, filePath));
    if (content === null) continue;
    for (const memo of parseFlomoMemos(content)) {
      const created = zonedTimeToUtc(memo.dateStr, memo.timeStr, tz);
      const cleaned = cleanFlomoMemoBody(memo.body);
      const record = (decision, reason, extra = {}) => internal.flomo.push({ path: filePath, created: `${memo.dateStr} ${memo.timeStr}`.trim(), chars: cleaned.length, decision, ...(reason ? { reason } : {}), ...extra });
      if (!created) { pushExcluded(filePath, "undated-memo", memo, cleaned.length); record("excluded", "undated-memo"); continue; }
      const reason = flomoExclusionReason(cleaned);
      if (reason) { pushExcluded(filePath, reason, memo, cleaned.length); record("excluded", reason); continue; }
      if (!cleaned) { pushExcluded(filePath, "empty-or-placeholder", memo, 0); record("excluded", "empty-or-placeholder"); continue; }
      const key = `${memo.dateStr} ${memo.timeStr}|${cleaned.replace(/\s+/g, "")}`;
      if (seen.has(key)) { pushExcluded(filePath, "duplicate", memo, cleaned.length); record("excluded", `duplicate-of:${seen.get(key)}`); continue; }
      seen.set(key, filePath);
      if (created < historyRange.start || created > historyRange.end) { const outside = created > historyRange.end ? "after-target" : "outside-range"; pushExcluded(filePath, outside, memo, cleaned.length); record("excluded", outside); continue; }
      const tags = extractFlomoTags(cleaned);
      const monthId = monthIdOfDateStr(memo.dateStr);
      const isPoem = tags.includes("写诗") && cleaned.length <= 300;
      // tier + order 决定预算顺序；phase 决定组装区段（全部 Flomo 在末段）。
      let tier; let kind; let order;
      const newestFirst = 1e15 - created.getTime();
      if (isPoem) { tier = 1; kind = "flomo-poem"; order = newestFirst; }
      else if (monthId >= recentFrom && monthId <= targetStartMonth) { tier = 3; kind = "flomo-recent"; order = newestFirst; }
      else if (olderKeepReason(tags)) { const manual = tags.some((tag) => OLDER_FLOMO_TAG_PREFIXES.slice(0, 3).includes(tag.split("/")[0])); tier = 4; kind = "flomo-older"; order = (manual ? 0 : 1e15) + newestFirst; }
      else { pushExcluded(filePath, "older-low-signal", memo, cleaned.length); record("excluded", "older-low-signal", { tags }); continue; }
      units.push({ id: `flomo:${key}`, type: "flomo", kind, tier, phase: 4, order, path: filePath, dateBasis: memo.dateStr, memo: { label: `${memo.dateStr} ${memo.timeStr}`.trim(), body: cleaned } });
      record("included", null, { tier, kind, tags });
    }
  }
  excluded.push(...memoExcluded.values());
}
function olderKeepReason(tags) {
  if (tags.some((tag) => OLDER_FLOMO_TAG_EXACT.includes(tag))) return true;
  if (tags.some((tag) => OLDER_FLOMO_TAG_PREFIXES.includes(tag.split("/")[0]))) return true;
  if (tags.some((tag) => tag.includes("问题"))) return true;
  return false;
}
// 输入清单：weekly / weekly-history（weekly 优先）/ monthly 一次性扫描。
async function buildInputInventory(repoRoot) {
  const weeks = new Map(); const months = [];
  const scanDir = async (relative) => {
    let names = [];
    try { names = await readdir(path.join(repoRoot, relative)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    return names.filter((name) => !name.startsWith("00_") && !name.startsWith("_") && !name.startsWith("."));
  };
  for (const dir of ["03_input/weekly-history", "03_input/weekly"]) {
    for (const name of await scanDir(dir)) {
      const weekId = name.match(/^(\d{4}-W\d{2})$/i)?.[1];
      if (weekId) weeks.set(weekId.toUpperCase(), `${dir}/${name}`);
    }
  }
  for (const name of await scanDir("03_input/monthly")) {
    const match = name.match(/^(\d{4})-(\d{1,2})$/);
    if (match) months.push(`${match[1]}-${match[2].padStart(2, "0")}`);
  }
  return { weeks, months: months.sort() };
}
const FLOMO_MEMO_RE = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2})(?::(\d{2}))?)?\s*$/;
const FLOMO_SUBMemo_RE = /^###\s+(\d{1,2}:\d{2})(?::(\d{2}))?\s*$/;
export function parseFlomoMemos(markdown) {
  const memos = []; let currentDate = null; let current = null;
  const flush = () => { if (current) { memos.push({ dateStr: current.dateStr, timeStr: current.timeStr, body: current.lines.join("\n") }); current = null; } };
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(FLOMO_MEMO_RE);
    if (heading) {
      flush();
      if (heading[2]) current = { dateStr: heading[1], timeStr: `${heading[2].padStart(5, "0")}:${heading[3] || "00"}`, lines: [] };
      else { currentDate = heading[1]; }
      continue;
    }
    const sub = line.match(FLOMO_SUBMemo_RE);
    if (sub && currentDate && (!current || current.fromSub)) { flush(); current = { dateStr: currentDate, timeStr: `${sub[1].padStart(5, "0")}:${sub[2] || "00"}`, lines: [], fromSub: true }; continue; }
    if (current) current.lines.push(line);
    else if (/^#{1,6}\s+/.test(line)) { currentDate = null; }
  }
  flush();
  return memos;
}
const FLOMO_NOISE_LINE_RE = [
  /^[-*]?\s*(?:来源|Source|链接|URL)\s*[：:]\s*\S*https?:\/\//i,
  /^https?:\/\/\S+\s*$/,
  /^!\[[^\]]*\]\([^)]*\)\s*$/,
  /^<img\b/i,
  /^(?:附件|Attachment|图片)\s*[：:]/i,
  /^\*{0,2}(?:附件|图片)\*{0,2}$/
];
export function cleanFlomoMemoBody(body) {
  return String(body || "").split(/\r?\n/).filter((line) => { const trimmed = line.trim(); return !trimmed || !FLOMO_NOISE_LINE_RE.some((pattern) => pattern.test(trimmed)); }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function extractFlomoTags(body) {
  const tags = [];
  for (const match of String(body || "").matchAll(/#([^\s#]+)/g)) {
    tags.push(match[1].replace(/[`、，,.。;；:：!？?）)》]+$/g, ""));
  }
  return tags.filter(Boolean);
}
export function flomoExclusionReason(cleanedBody) {
  const tags = extractFlomoTags(cleanedBody);
  if (tags.some((tag) => tag === "learn-x" || tag.startsWith("learn-x/"))) return "reverse-sync-tag";
  if (tags.some((tag) => tag === "ai洞察" || tag.endsWith("/ai洞察"))) return "ai-insight-tag";
  if (tags.some((tag) => tag === "不洞察" || tag === "不回顾")) return "user-excluded-tag";
  const trimmed = String(cleanedBody || "").trimStart();
  if (REVERSE_SYNC_TITLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "reverse-sync-memo";
  return null;
}
function parseMirrorHeader(raw) {
  const text = String(raw || "");
  const match = text.match(/^<!--\n([^]*?)-->\n?/);
  const header = {};
  if (match) for (const line of match[1].split("\n")) { const pair = line.match(/^([\w-]+):\s*(.*)$/); if (pair) header[pair[1]] = pair[2]; }
  const body = (match ? text.slice(match[0].length) : text).replace(/<!--[^]*?-->/g, "").trim();
  return { header, body };
}

export async function buildInsightPrompt({ repoRoot, context, task, target, maxPromptChars = 120000 }) {
  const declaredSubtype = String(task.chatPackSubtypeId || `insight.${task.id}`); const subtypeSlug = declaredSubtype.startsWith("insight.") ? declaredSubtype.slice("insight.".length) : ""; if (!/^[a-z0-9-]+$/.test(subtypeSlug)) throw new Error(`洞察子类型标识无效：${task.chatPackSubtypeId || task.id}`);
  const subtype = await readOptional(path.join(repoRoot, "02_prompts/chatpack/insight", `${subtypeSlug}.md`)); const enhancer = task.prompt.defaultEnhancerIds.includes("munger-soul") ? await readOptional(path.join(repoRoot, "02_prompts/chatpack/enhancers/munger-soul.md")) : "";
  await verifyPromptAssets(repoRoot, await readPromptAssets(repoRoot));
  const prompt = ["你正在执行 Learn-X 周期洞察。", `任务：${task.name}（${task.id}）。`, `洞察对象：${target.id}（${target.kind}）。`, "历史 Context 仅用于理解背景，不得替代洞察对象。", "输出必须是 Markdown，明确区分事实、推断与未知，并标记为候选洞察。", "--- 子类型输出适配 ---", subtype?.trim(), enhancer ? "--- 芒格之魂增强器（唯一正文来源） ---" : "", enhancer?.trim(), "--- Context ---", context.trim()].filter(Boolean).join("\n\n");
  if (charCount(prompt) > maxPromptChars) throw new Error(`最终 Prompt 超过 ${maxPromptChars} 字符上限`); return prompt;
}

export async function buildPromptAssets({ repoRoot, task }) {
  const manifest = await readPromptAssets(repoRoot);
  const verified = await verifyPromptAssets(repoRoot, manifest);
  const paths = [`02_prompts/chatpack/insight/${String(task.chatPackSubtypeId || `insight.${task.id}`).replace(/^insight\./, "")}.md`];
  if (task.prompt.defaultEnhancerIds.includes("munger-soul")) paths.push("02_prompts/chatpack/enhancers/munger-soul.md");
  return paths.map((promptPath) => {
    const promptId = Object.entries(manifest.assets || {}).find(([, asset]) => asset.local_path === promptPath)?.[0];
    return promptId && verified[promptId] ? {
      prompt_id: promptId,
      prompt_revision: verified[promptId].revision,
      prompt_sha256: verified[promptId].sha256,
      prompt_synced_at: verified[promptId].synced_at
    } : null;
  }).filter(Boolean);
}

// 使用时校准：在线消费 Snapshot 前跑 governance check --live；远端有新版本且本地干净时自动 pull。
// 所有失败都不阻塞运行（离线允许使用本地副本），但必须显式留下告警，不允许旧 Snapshot 静默存在。
export function resolveGovernanceScript(env = process.env, home = homedir()) {
  const candidates = [
    env.PROMPT_GOVERNANCE_MANAGE,
    env.CODEX_HOME && path.join(env.CODEX_HOME, "skills/prompt-governance/scripts/manage-prompts.mjs"),
    path.join(home, ".codex/skills/prompt-governance/scripts/manage-prompts.mjs"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("prompt-governance manage-prompts.mjs 不可用");
  return found;
}

export async function preflightSnapshotFreshness({ repoRoot, script, run, log = () => {} } = {}) {
  const warnings = [];
  const exec = run || ((args) => {
    const resolved = script || resolveGovernanceScript();
    try { return { status: 0, stdout: execFileSync(process.execPath, [resolved, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }) }; }
    catch (error) { return { status: error.status ?? 1, stdout: String(error.stdout || ""), stderr: String(error.stderr || error.message || "") }; }
  });
  let check;
  try {
    check = JSON.parse(exec(["check", "--live", "--project", repoRoot]).stdout);
  } catch (error) {
    const warning = `prompt snapshot check 失败（governance 不可用），继续使用本地副本：${String(error.message || error).split("\n")[0]}`;
    warnings.push(warning); warnings.forEach(log);
    return { checked: false, pulled: false, stale_ids: [], remote_changed_ids: [], warnings };
  }
  if (!check || !Array.isArray(check.assets)) {
    const warning = "prompt snapshot check 输出无效，继续使用本地副本";
    warnings.push(warning); warnings.forEach(log);
    return { checked: false, pulled: false, stale_ids: [], remote_changed_ids: [], warnings };
  }
  const staleIds = check.assets.filter((asset) => asset.freshness === "stale").map((asset) => asset.prompt_id);
  if (staleIds.length) warnings.push(`prompt snapshot 超过 ${check.fresh_limit_days} 天未校准：${staleIds.join(", ")}`);
  for (const asset of check.assets.filter((asset) => asset.live_error)) warnings.push(`prompt 远端检查失败，继续使用本地副本（可能是 offline）：${asset.prompt_id}: ${asset.live_error}`);
  const changedIds = check.assets.filter((asset) => asset.remote_changed).map((asset) => asset.prompt_id);
  let pulled = false;
  if (changedIds.length) {
    try {
      const result = JSON.parse(exec(["pull", "--project", repoRoot, "--all", "--confirm"]).stdout);
      pulled = result?.ok === true;
      if (pulled) warnings.push(`飞书有新版本 Prompt，已自动 pull 本地 Snapshot：${changedIds.join(", ")}`);
      else warnings.push(`飞书有新版本 Prompt 但自动 pull 未确认成功，保留本地旧版本：${changedIds.join(", ")}`);
    } catch (error) {
      warnings.push(`飞书有新版本 Prompt 但自动 pull 被拒绝（本地脏或漂移），保留旧版本：${changedIds.join(", ")}；${String(error.stderr || error.message || "").split("\n")[0]}`);
    }
  }
  warnings.forEach(log);
  return { checked: true, pulled, stale_ids: staleIds, remote_changed_ids: changedIds, warnings };
}

async function targetFile(repoRoot, target) { const candidates = target.kind === "month" ? [`04_output/monthly/${target.id}.md`] : [`04_output/weekly/${target.id}.md`, `04_output/weekly/${target.id.replace("-W", "-")}.md`]; for (const filePath of candidates) { const content = await readOptional(path.join(repoRoot, filePath)); if (content !== null) return { path: filePath, content, ...target }; } return null; }
async function listPeriodFiles(repoRoot, kind) { const dir = path.join(repoRoot, kind === "month" ? "04_output/monthly" : "04_output/weekly"); let names = []; try { names = await readdir(dir); } catch (error) { if (error.code !== "ENOENT") throw error; } const result = []; for (const name of names) { if (!name.endsWith(".md")) continue; const id = name.slice(0, -3); let period; try { period = kind === "month" ? parseMonth(id) : parseIsoWeek(id); } catch { continue; } result.push({ ...period, path: `${kind === "month" ? "04_output/monthly" : "04_output/weekly"}/${name}`, content: await readFile(path.join(dir, name), "utf8") }); } return result.sort((a, b) => a.start - b.start); }
async function listMemoryFiles(repoRoot) { const dir = path.join(repoRoot, "01_core/memory"); let names = []; try { names = await readdir(dir); } catch (error) { if (error.code !== "ENOENT") throw error; } names.sort(); const validNames = names.filter((name) => /^\d{4}-Q[1-4]\.memory\.md$/i.test(name)); const invalidNames = names.filter((name) => name.endsWith(".md") && !validNames.includes(name)); const valid = await Promise.all(validNames.map(async (name) => { const match = name.match(/(\d{4})-Q([1-4])/i); const year = Number(match[1]); const quarter = Number(match[2]); return { id: `${year}-Q${quarter}`, path: `01_core/memory/${name}`, start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)), end: new Date(Date.UTC(year, quarter * 3, 1)), content: await readFile(path.join(dir, name), "utf8") }; })); const invalid = await Promise.all(invalidNames.map(async (name) => ({ path: `01_core/memory/${name}`, chars: charCount(await readFile(path.join(dir, name), "utf8")) }))); return { valid, invalid }; }
export function markdownSections(markdown) { const value = String(markdown || ""); const matches = [...value.matchAll(SECTION_RE)]; return matches.map((match, index) => ({ heading: match[2].trim(), content: value.slice(match.index, matches[index + 1]?.index || value.length).trim() })); }
async function readJson(filePath) { try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
function toDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null; }
function monthId(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function startOfDayShanghai(date) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`); }
async function readOptional(filePath) { try { return await readFile(filePath, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
function charCount(value) { return String(value || "").length; }
function sha256(value) { return createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }

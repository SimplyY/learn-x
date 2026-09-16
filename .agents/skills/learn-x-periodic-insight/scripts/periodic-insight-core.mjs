import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readPromptAssets, verifyPromptAssets } from "../../../../app/code/scripts/prompt-assets.mjs";

export const RANGE_IDS = new Set(["1m", "3m", "6m", "1y", "all", "custom"]);
const DAY = 86_400_000;
const PLACEHOLDER_RE = /^(?:TODO|待补充|暂无内容|占位|请在此|未完成|内容为空)/i;
const SECTION_RE = /^(#{1,6})\s+(.+?)\s*$/gm;

export async function readPeriodicConfig(repoRoot) { const config = JSON.parse(await readFile(path.join(repoRoot, "00_config/periodic-insights.json"), "utf8")); return validatePeriodicConfig(config); }
export function validatePeriodicConfig(config) {
  if (!config || config.schemaVersion !== 1 || !config.contextPolicies || !Array.isArray(config.tasks)) throw new Error("周期洞察配置契约无效");
  for (const [id, policy] of Object.entries(config.contextPolicies)) {
    if (!RANGE_IDS.has(policy.defaultRange) || !Number.isInteger(policy.maxContextChars) || policy.maxContextChars <= 0 || (policy.maxPromptChars !== undefined && (!Number.isInteger(policy.maxPromptChars) || policy.maxPromptChars <= 0)) || !Number.isInteger(policy.historicalBudgetChars) || policy.historicalBudgetChars < 0 || !policy.timezone) throw new Error(`Context Policy 无效：${id}`);
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
export function findTask(config, taskId) { const task = (config.tasks || []).find((item) => item.id === taskId); if (!task) throw new Error(`未知洞察任务：${taskId}`); return task; }
export function isSubstantive(content) { const value = String(content || "").replace(/<!--[^]*?-->/g, "").trim(); const body = value.replace(/^#{1,6}\s+[^\n]+\n+/, "").trim(); return value.length >= 120 && !PLACEHOLDER_RE.test(body); }

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

export async function buildInsightContext({ repoRoot, taskId, target = "auto", range, from, to, now = new Date() }) {
  const config = await readPeriodicConfig(repoRoot); const task = findTask(config, taskId); const policy = config.contextPolicies?.[task.contextPolicyId];
  if (!policy) throw new Error(`缺少 Context Policy：${task.contextPolicyId}`);
  const resolved = await resolveTarget(repoRoot, task, target, now);
  const budget = { contextChars: policy.maxContextChars, promptChars: policy.maxPromptChars || 120000, historicalChars: policy.historicalBudgetChars };
  if (!resolved) {
    const manifest = { schemaVersion: 1, taskId, target: null, range: null, budget, chars: 0, included: [], excluded: [{ reason: "no-substantive-target" }] };
    return { task, target: null, range: null, budget, included: [], excluded: manifest.excluded, content: "", chars: 0, sha256: sha256(""), manifest };
  }
  const historyRange = parseRange(range || policy.defaultRange, from, to, new Date(resolved.end.getTime() - 1));
  const included = []; const excluded = [];
  const add = (entry, role, content) => included.push({ path: entry.path, role, chars: charCount(content), dateBasis: entry.id, content });
  add(resolved, "target-output", resolved.content);
  const processPath = `04_output/_dist/${resolved.kind === "month" ? "monthly" : "weekly"}/${resolved.id}/process-pack.md`;
  const processContent = await readOptional(path.join(repoRoot, processPath));
  const processCandidate = processContent && isSubstantive(processContent) ? { path: processPath, id: resolved.id, content: processContent } : null;
  if (!processCandidate) excluded.push({ path: processPath, role: "process-pack", chars: charCount(processContent || ""), dateBasis: resolved.id, reason: "missing-or-empty" });
  const outputs = [...await listPeriodFiles(repoRoot, "month"), ...await listPeriodFiles(repoRoot, "week")].filter((item) => item.id !== resolved.id || item.kind !== resolved.kind).filter((item) => item.end > historyRange.start && item.start <= historyRange.end).sort((a, b) => b.start - a.start || a.path.localeCompare(b.path));
  const historicalUnits = [];
  for (const output of outputs) {
    if (!isSubstantive(output.content)) { excluded.push({ path: output.path, role: "confirmed-output", chars: charCount(output.content), dateBasis: output.id, reason: "empty-or-placeholder" }); continue; }
    const sections = markdownSections(output.content);
    if (!sections.length) { excluded.push({ path: output.path, role: "confirmed-output", chars: charCount(output.content), dateBasis: output.id, reason: "no-whitelisted-sections" }); continue; }
    let selected = false;
    for (const section of sections) {
      if (/核心|总判断|总览|问题|洞察|芒格|反思|判断/i.test(section.heading)) { historicalUnits.push({ path: output.path, id: output.id, role: "confirmed-output", ...section }); selected = true; }
      else excluded.push({ path: output.path, role: "confirmed-output", chars: charCount(section.content), dateBasis: output.id, section: section.heading, reason: "section-not-whitelisted" });
    }
    if (!selected) excluded.push({ path: output.path, role: "confirmed-output", chars: charCount(output.content), dateBasis: output.id, reason: "no-whitelisted-sections" });
  }
  const memories = await listMemoryFiles(repoRoot);
  for (const invalid of memories.invalid) excluded.push({ path: invalid.path, role: "quarterly-memory", chars: invalid.chars, reason: "invalid-period" });
  for (const memory of memories.valid) {
    const overlaps = memory.end > historyRange.start && memory.start <= historyRange.end;
    if (overlaps && isSubstantive(memory.content)) historicalUnits.push({ ...memory, role: "quarterly-memory", heading: memory.id });
    else excluded.push({ path: memory.path, role: "quarterly-memory", chars: charCount(memory.content), dateBasis: memory.id, reason: overlaps ? "empty-or-placeholder" : "outside-range" });
  }
  let historicalChars = 0;
  for (const unit of historicalUnits) {
    const text = `## ${unit.path} · ${unit.heading}\n\n${unit.content.trim()}\n`;
    if (historicalChars + charCount(text) > policy.historicalBudgetChars) { excluded.push({ path: unit.path, role: unit.role, chars: charCount(text), dateBasis: unit.id, section: unit.heading, reason: "historical-budget" }); continue; }
    historicalChars += charCount(text); add(unit, unit.role, text);
  }
  const header = [`# PERIODIC INSIGHT CONTEXT`, ``, `- 任务：${task.name}（${task.id}）`, `- 目标周期：${resolved.id}（${resolved.kind}）`, `- 历史范围：${historyRange.id}`, `- 时区：${policy.timezone}`, ``, "以下材料由固定白名单按日期和预算装配；目标输出与历史 Context 不可混淆。", ""].join("\n");
  const targetText = included.filter((item) => item.role === "target-output").map((item) => `## 目标输出 · ${item.path}\n\n${item.content.trim()}\n`).join("\n");
  const historicalText = included.filter((item) => item.role !== "target-output").map((item) => item.content).join("\n---\n\n");
  const supportParts = [];
  const processEntries = [];
  if (processCandidate) {
    const full = `## Process Pack · ${processCandidate.path}\n\n${processCandidate.content.trim()}\n`;
    if (charCount(header + targetText + full + historicalText) <= policy.maxContextChars) {
      supportParts.push(full); processEntries.push({ path: processPath, role: "process-pack", chars: charCount(processCandidate.content), dateBasis: resolved.id, content: processCandidate.content });
    } else {
      const sections = markdownSections(processCandidate.content);
      if (!sections.length) excluded.push({ path: processPath, role: "process-pack", chars: charCount(processCandidate.content), dateBasis: resolved.id, reason: "context-budget" });
      for (const section of sections) {
        const part = `## Process Pack · ${processPath} · ${section.heading}\n\n${section.content.trim()}\n`;
        if (charCount(header + targetText + supportParts.join("\n---\n\n") + part + historicalText) > policy.maxContextChars) { excluded.push({ path: processPath, role: "process-pack", chars: charCount(section.content), dateBasis: resolved.id, section: section.heading, reason: "context-budget" }); continue; }
        supportParts.push(part); processEntries.push({ path: processPath, role: "process-pack", chars: charCount(section.content), dateBasis: resolved.id, section: section.heading, content: section.content });
      }
    }
  }
  const content = `${header}${targetText}\n---\n\n${[...supportParts, historicalText].filter(Boolean).join("\n---\n\n")}`.trimEnd() + "\n";
  if (charCount(content) > policy.maxContextChars) throw new Error(`Context 超过 ${policy.maxContextChars} 字符上限`);
  const orderedIncluded = [...included.filter((item) => item.role === "target-output"), ...processEntries, ...included.filter((item) => item.role !== "target-output")];
  const manifest = { schemaVersion: 1, taskId, target: { id: resolved.id, kind: resolved.kind, path: resolved.path, start: resolved.start.toISOString().slice(0, 10), end: new Date(resolved.end.getTime() - 1).toISOString().slice(0, 10) }, range: { id: historyRange.id, from: historyRange.start.toISOString().slice(0, 10), to: historyRange.end.toISOString().slice(0, 10) }, budget, chars: charCount(content), included: orderedIncluded.map(({ content: _content, ...item }) => item), excluded };
  return { task, target: manifest.target, range: manifest.range, budget, included: manifest.included, excluded, chars: manifest.chars, sha256: sha256(content), content, manifest };
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

async function targetFile(repoRoot, target) { const candidates = target.kind === "month" ? [`04_output/monthly/${target.id}.md`] : [`04_output/weekly/${target.id}.md`, `04_output/weekly/${target.id.replace("-W", "-")}.md`]; for (const filePath of candidates) { const content = await readOptional(path.join(repoRoot, filePath)); if (content !== null) return { path: filePath, content, ...target }; } return null; }
async function listPeriodFiles(repoRoot, kind) { const dir = path.join(repoRoot, kind === "month" ? "04_output/monthly" : "04_output/weekly"); let names = []; try { names = await readdir(dir); } catch (error) { if (error.code !== "ENOENT") throw error; } const result = []; for (const name of names) { if (!name.endsWith(".md")) continue; const id = name.slice(0, -3); let period; try { period = kind === "month" ? parseMonth(id) : parseIsoWeek(id); } catch { continue; } result.push({ ...period, path: `${kind === "month" ? "04_output/monthly" : "04_output/weekly"}/${name}`, content: await readFile(path.join(dir, name), "utf8") }); } return result.sort((a, b) => a.start - b.start); }
async function listMemoryFiles(repoRoot) { const dir = path.join(repoRoot, "01_core/memory"); let names = []; try { names = await readdir(dir); } catch (error) { if (error.code !== "ENOENT") throw error; } names.sort(); const validNames = names.filter((name) => /^\d{4}-Q[1-4]\.memory\.md$/i.test(name)); const invalidNames = names.filter((name) => name.endsWith(".md") && !validNames.includes(name)); const valid = await Promise.all(validNames.map(async (name) => { const match = name.match(/(\d{4})-Q([1-4])/i); const year = Number(match[1]); const quarter = Number(match[2]); return { id: `${year}-Q${quarter}`, path: `01_core/memory/${name}`, start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)), end: new Date(Date.UTC(year, quarter * 3, 1)), content: await readFile(path.join(dir, name), "utf8") }; })); const invalid = await Promise.all(invalidNames.map(async (name) => ({ path: `01_core/memory/${name}`, chars: charCount(await readFile(path.join(dir, name), "utf8")) }))); return { valid, invalid }; }
export function markdownSections(markdown) { const value = String(markdown || ""); const matches = [...value.matchAll(SECTION_RE)]; return matches.map((match, index) => ({ heading: match[2].trim(), content: value.slice(match.index, matches[index + 1]?.index || value.length).trim() })); }
function toDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null; }
function monthId(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function startOfDayShanghai(date) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`); }
async function readOptional(filePath) { try { return await readFile(filePath, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
function charCount(value) { return String(value || "").length; }
function sha256(value) { return createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }

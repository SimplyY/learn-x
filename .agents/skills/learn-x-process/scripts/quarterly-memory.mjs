#!/usr/bin/env node
// Learn-X 季度长期 Memory 审查与压缩：上下文包生成（pack）与 ChatGPT 交付导入（import）。
// 语义判断由 ChatGPT 完成；本脚本只做确定性工作。校验与晋级复用 memory-compression.mjs 引擎。

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyQuarterlyProtection,
  budgetForAge,
  lastCompleteQuarter,
  parseAsOf,
  parseMemoryUnits,
  quarterEndDate,
  readActiveMemoryFiles,
  validateMemoryCompression,
  weekLabelsInQuarter
} from "./memory-compression.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const MEMORY_ROOT = "01_core/memory";
const REVIEW_ROOT = "04_output/_dist/memory-compression";
const PROMPT_RESOURCE = "02_prompts/meta/chatgpt-quarterly-memory-review.md";
import { countInputChars } from "../../learn-x-input/scripts/lib/input-limits.mjs";

function countMemoryCharsLocal(value) {
  return countInputChars(String(value).replace(/\r\n?/g, "\n"));
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function exists(filePath) {
  try { await stat(filePath); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function toPosix(value) { return value.split(path.sep).join("/"); }

// ===== 季度材料清点 =====

async function collectQuarterSources(repoRoot, quarter) {
  const match = String(quarter).match(/^(\d{4})-Q([1-4])$/);
  if (!match) throw new Error("Invalid quarter label: " + quarter + ".");
  const year = Number(match[1]);
  const startMonth = (Number(match[2]) - 1) * 3 + 1;
  const weeks = [];
  for (const label of weekLabelsInQuarter(quarter)) {
    const dir = path.join(repoRoot, "03_input/weekly", label);
    const entry = { label, dir: "03_input/weekly/" + label, exists: await exists(dir), files: [], sources: [] };
    if (entry.exists) {
      const names = (await readdir(dir, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => item.name).sort();
      entry.files = names;
      for (const name of names) {
        const content = await readFile(path.join(dir, name), "utf8");
        entry.sources.push({ file: name, chars: countMemoryCharsLocal(content), sha256: sha256(content) });
      }
      const statusPath = path.join(dir, "_source-status.json");
      entry.statusFileExists = await exists(statusPath);
      if (entry.statusFileExists) {
        try {
          const status = JSON.parse(await readFile(statusPath, "utf8"));
          entry.statuses = Object.fromEntries(Object.entries(status.sources ?? {}).map(([key, value]) => [key, value?.status ?? "unknown"]));
        } catch {
          entry.statuses = null;
          entry.statusFileInvalid = true;
        }
      }
    }
    weeks.push(entry);
  }
  const months = [];
  for (let month = startMonth; month < startMonth + 3; month += 1) {
    const label = String(year) + "-" + month;
    const dir = path.join(repoRoot, "03_input/monthly", label);
    const entry = { month: label, dir: "03_input/monthly/" + label, exists: await exists(dir), files: [], sources: [] };
    if (entry.exists) {
      const names = (await readdir(dir, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".md")).map((item) => item.name).sort();
      entry.files = names;
      for (const name of names) {
        const content = await readFile(path.join(dir, name), "utf8");
        entry.sources.push({ file: name, chars: countMemoryCharsLocal(content), sha256: sha256(content) });
      }
    }
    months.push(entry);
  }
  const outputs = [];
  for (const label of weekLabelsInQuarter(quarter)) {
    const weekNumber = Number(label.slice(6));
    const weekYear = Number(label.slice(0, 4));
    const padded = "04_output/weekly/" + weekYear + "-" + String(weekNumber).padStart(2, "0") + ".md";
    const plain = "04_output/weekly/" + weekYear + "-" + weekNumber + ".md";
    const outputPath = (await exists(path.join(repoRoot, padded))) ? padded : (await exists(path.join(repoRoot, plain))) ? plain : null;
    if (outputPath) {
      const content = await readFile(path.join(repoRoot, outputPath), "utf8");
      outputs.push({ label, path: outputPath, chars: countMemoryCharsLocal(content), sha256: sha256(content) });
    } else {
      outputs.push({ label, path: null, missing: true });
    }
  }
  const monthlyOutputs = [];
  for (let month = startMonth; month < startMonth + 3; month += 1) {
    const outputPath = "04_output/monthly/" + year + "-" + String(month).padStart(2, "0") + ".md";
    if (await exists(path.join(repoRoot, outputPath))) {
      const content = await readFile(path.join(repoRoot, outputPath), "utf8");
      monthlyOutputs.push({ month: year + "-" + month, path: outputPath, chars: countMemoryCharsLocal(content), sha256: sha256(content) });
    } else {
      monthlyOutputs.push({ month: year + "-" + month, path: null, missing: true });
    }
  }
  return { weeks, months, outputs, monthlyOutputs };
}

function quarterlySourceGaps(sources) {
  const gaps = [];
  for (const week of sources.weeks) {
    if (!week.exists) gaps.push("周输入目录缺失：" + week.dir);
    else {
      if (!week.files.includes("weekly.md")) gaps.push(week.dir + " 缺少 weekly.md");
      if (!week.statusFileExists) gaps.push(week.dir + " 缺少 _source-status.json");
      else if (week.statuses === null) gaps.push(week.dir + " _source-status.json 无法解析");
      else {
        for (const [key, status] of Object.entries(week.statuses ?? {})) {
          if (status === "failed" || status === "unavailable") gaps.push(week.dir + " 来源 " + key + " 状态 " + status);
        }
      }
    }
  }
  for (const month of sources.months) {
    if (!month.exists) gaps.push("月度输入目录缺失：" + month.dir);
  }
  for (const output of sources.outputs) if (output.missing) gaps.push("周报缺失：04_output/weekly/" + output.label.replace("-W", "-") + ".md");
  for (const output of sources.monthlyOutputs) if (output.missing) gaps.push("月报缺失：04_output/monthly/" + output.month + ".md");
  return gaps;
}

// ===== 上下文包渲染 =====

function deliveryContractText() {
  const sample = {
    quarter: "2026-Q3",
    noChange: false,
    targets: [{
      targetFile: "2026-Q3.memory.md",
      changeSummary: { whatChanged: "2-4 个短段/列表，含至少两个具体锚点", primaryRisk: "最核心的一项语义风险" },
      changes: [{ topic: "主题", original: "之前是什么", candidate: "现在是什么", kind: "压缩/合并|删除|改动|保留", action: "做了什么", review: "人工需确认什么", risk: "高|中|低", riskReason: "风险原因（可选）" }],
      otherChanges: [{ topic: "主题", before: "原文", after: "压缩后", examples: "例子", category: "分类", change: "说明", risk: "高|中|低" }]
    }],
    confirmedCorrections: [{ targetFile: "2026-Q2.memory.md", unitText: "逐字复制被修改单元的原文片段", evidence: "新证据与来源", summary: "用户确认说明（旧内容/新证据/影响）" }],
    notes: "其他需要向导入方说明的事项"
  };
  return [
    "**交付目录结构**（用户从 ChatGPT 下载后放入任意目录，交给 `npm run memory:quarterly -- import <目录>`）：",
    "",
    "```text",
    "<交付目录>/",
    "  changes.json                     # 机器可读变更记录（必须）",
    "  2026-Q3.memory.md                # 每个实际修改的目标文件一个完整 Markdown 正文",
    "  （多文件时可另附一个 ZIP 包，解包后同构）",
    "```",
    "",
    "**changes.json 结构（示例）**：",
    "",
    "```json",
    JSON.stringify(sample, null, 2),
    "```",
    "",
    "**硬规则**：changes 数量按真实变化计，不凑固定条数；无需修改时 targets 为空数组且 noChange=true，不生成无意义文件；`unitText` 必须逐字复制原文片段且在目标文件中唯一匹配；文件正文不含聊天记录、技术元数据、占位符；不得提供哈希/字数/路径校验信息（导入程序按真实仓库计算并忽略外来值）。"
  ].join("\n");
}

function renderQuarterlyPack(context) {
  const { targetQuarter, asOf, resolution, targetFile, activeFiles, budget, sources, gaps, annualize, promptResource } = context;
  const weeklyRows = sources.weeks.map((week) => {
    const statusText = week.exists ? (week.statusFileExists ? Object.entries(week.statuses ?? {}).map(([key, value]) => key + "=" + value).join("、") || "无状态记录" : "缺 _source-status.json") : "目录缺失";
    const existsText = week.exists ? "是（" + week.files.length + " 个 .md 文件，" + week.sources.reduce((sum, item) => sum + item.chars, 0) + " 字）" : "否";
    return "| " + week.label + " | " + existsText + " | " + statusText + " |";
  });
  const monthRows = sources.months.map((month) => "| " + month.month + " | " + (month.exists ? "是（" + (month.files.join("、") || "空目录") + "）" : "否") + " |");
  const outputRows = sources.outputs.map((output) => "| " + output.label + " | " + (output.missing ? "**缺失**" : "[" + output.path + "](" + output.path + ")（" + output.chars + " 字）") + " |");
  const monthlyOutputRows = sources.monthlyOutputs.map((output) => "| " + output.month + " | " + (output.missing ? "**缺失**" : "[" + output.path + "](" + output.path + ")（" + output.chars + " 字）") + " |");
  const otherFiles = activeFiles.filter((file) => file.relativePath !== (targetFile ? targetFile.relativePath : ""));
  const activeRows = otherFiles.map((file) => "| `" + file.relativePath + "` | " + (file.kind === "quarter" ? "季度" : "年度") + " | " + file.chars + " | `" + file.sha256.slice(0, 16) + "…` |");
  const gapRows = gaps.length ? gaps.map((gap) => "- " + gap).join("\n") : "- 未发现结构性缺口（不等于材料完整无缺口，语义缺口由 ChatGPT 在审查中识别）";
  const targetSection = targetFile
    ? "### 目标季度正式 Memory 完整原文：`" + targetFile.relativePath + "`\n\n当前 " + targetFile.chars + " 字，SHA-256 `" + targetFile.sha256 + "`。原文如下（逐字，未修改）：\n\n```markdown\n" + targetFile.content + "\n```"
    : "### 目标季度正式 Memory\n\n`01_core/memory/" + targetQuarter + ".memory.md` 不存在：该季度没有已迁移的正式 Memory。本次审查仍可针对其他历史文件做确认纠偏，但季度整理本身无目标文件。";
  const annualizeSection = annualize
    ? "### 跨年协调（本季度为 " + annualize.year + " 年 Q4）\n\n本季度整理完成后，" + annualize.year + " 年的季度文件（" + (annualize.quarterFiles.join("、") || "无") + "）可合并为年度文件 `01_core/memory/" + annualize.year + ".memory.md`（年度预算：硬上限 " + annualize.budget.hard + "，目标 " + annualize.budget.target + "）。为避免重复压缩：**先完成并晋级 Q4 季度候选，再基于晋级后的真实仓库状态生成/导入年度合并候选**；两阶段在同一次评审会话中顺序执行，年度候选的源哈希以晋级后状态为准。"
    : "### 跨年协调\n\n本季度不是 Q4，无年度合并协调项。";
  const lines = [
    "# Learn-X 季度长期 Memory 审查上下文包｜" + targetQuarter,
    "",
    resolution + "；生成日期（as-of）：" + asOf + "。本包由确定性脚本生成，只读正式 Memory 与输入材料；生成过程不修改任何原始文件。所有路径相对仓库根目录。",
    "",
    "## A｜过去是什么",
    "",
    targetSection,
    "",
    "### 其他活动 Memory 文件（可作为跨期纠偏对象，修改须逐单元用户确认）",
    "",
    "| 文件 | 类型 | 字符 | SHA-256（前 16 位） |",
    "| --- | --- | ---: | --- |",
    ...activeRows,
    "",
    "## B｜现在是什么（本季度可信材料清点）",
    "",
    "### 周输入目录（03_input/weekly/）",
    "",
    "| 周目录 | 目录存在 | 来源状态（_source-status.json） |",
    "| --- | --- | --- |",
    ...weeklyRows,
    "",
    "### 月度输入目录（03_input/monthly/）",
    "",
    "| 月目录 | 目录存在 | 文件 |",
    "| --- | --- | --- |",
    ...monthRows,
    "",
    "### 已确认周报（04_output/weekly/）",
    "",
    "| 周目录 | 文件 |",
    "| --- | --- |",
    ...outputRows,
    "",
    "### 已确认月报（04_output/monthly/）",
    "",
    "| 月 | 文件 |",
    "| --- | --- |",
    ...monthlyOutputRows,
    "",
    "### 结构性缺口清单",
    "",
    gapRows,
    "",
    "### 材料清单与哈希",
    "",
    "全部来源文件、字符数与 SHA-256 见同目录 `quarterly-sources-manifest.json`（程序生成，供追溯核对）。",
    "",
    "## C｜目标是什么",
    "",
    "- 为未来 5–10 年的 AI 协作保留高价值个人上下文；提高事实准确性、认知连续性与信息密度。",
    "- 压缩重复、过期、低价值内容；不删除会改变未来理解、判断或行动的重要信息。",
    "- 成功指标是未来 AI 理解用户的准确性、上下文效率与可追溯性，不是压缩率。",
    "",
    "## D｜约束是什么",
    "",
    "```text",
    "预算口径（Unicode 字符，Array.from 含标题符号换行）：",
    "硬上限 = max(200, floor(8000 × 0.6^年龄))；压缩目标 = floor(硬上限 × 0.75)",
    "目标 " + targetQuarter + " 年龄 = " + budget.age + "，硬上限 " + budget.hard + "，目标 " + budget.target,
    "超出目标未超硬上限 → needs_review；超过硬上限 → 停止晋级并报告，不得静默删减",
    "```",
    "",
    "**保护规则（季度评审语义）**：",
    "",
    "1. 目标季度 " + targetQuarter + " 已关闭，其文件内可归因单元可压缩合并。",
    "2. 无法识别来源的单元默认保护；确需修改必须列入用户确认清单。",
    "3. 目标季度之外的历史文件：任何修改都必须逐单元获得用户具体确认；未确认内容保持原样。",
    "4. 目标季度之后周期（进行中的季度）的单元一律保护。",
    "",
    "**跨期纠偏确认协议**：ChatGPT 在多轮讨论中逐项列出旧内容、新证据、建议改法与影响；用户具体确认后，在 changes.json 的 confirmedCorrections 中逐条记录（targetFile + unitText 逐字复制原文 + evidence 证据 + summary 确认说明）。导入程序按 unitText 精确匹配解析到具体单元，解析失败即拒绝导入。",
    "",
    "**校验与晋级**：`--import` 只做确定性导入与元数据填充；`--validate` 校验哈希、保护、预算与记录完整性；`--promote <候选目录> --confirm` 由用户明确确认后逐候选目录执行，归档旧版并原子替换。校验通过不等于语义无损证明。",
    "",
    annualizeSection,
    "",
    "## E｜如何执行与交付",
    "",
    "### ChatGPT 执行 Prompt（完整正文，语义冻结，不得改写）",
    "",
    promptResource.trim(),
    "",
    "### 交付契约",
    "",
    deliveryContractText(),
    ""
  ].join("\n");
  return lines + "\n";
}

// ===== 季度上下文包生成 =====

export async function planQuarterlyPack({ repoRoot = defaultRepoRoot, asOf, quarter } = {}) {
  const date = parseAsOf(asOf);
  const resolution = quarter ? "目标季度由 --quarter 显式指定" : "目标季度为默认解析：最后一个在 as-of 之前完整结束的自然季度";
  const targetQuarter = quarter ? quarter : lastCompleteQuarter(date);
  const quarterEnd = quarterEndDate(targetQuarter);
  if (quarterEnd > date) throw new Error("Quarter " + targetQuarter + " is not complete as of " + date + ".");
  const activeFiles = await readActiveMemoryFiles(repoRoot, date.slice(0, 7));
  const targetPath = MEMORY_ROOT + "/" + targetQuarter + ".memory.md";
  const targetFile = activeFiles.find((file) => file.relativePath === targetPath) ?? null;
  const budget = budgetForAge(Number(date.slice(0, 4)) - Number(targetQuarter.slice(0, 4)));
  const sources = await collectQuarterSources(repoRoot, targetQuarter);
  const gaps = quarterlySourceGaps(sources);
  let annualize = null;
  if (Number(targetQuarter.slice(6)) === 4) {
    const year = Number(targetQuarter.slice(0, 4));
    annualize = {
      year,
      quarterFiles: activeFiles.filter((file) => file.year === year && file.kind === "quarter").map((file) => file.relativePath),
      yearlyTargetPath: MEMORY_ROOT + "/" + year + ".memory.md",
      budget: budgetForAge(Number(date.slice(0, 4)) - year)
    };
  }
  const promptPath = path.join(repoRoot, PROMPT_RESOURCE);
  if (!await exists(promptPath)) throw new Error("Missing prompt resource " + PROMPT_RESOURCE + "; create it before generating a quarterly pack.");
  const promptResource = await readFile(promptPath, "utf8");
  const outputDir = path.join(repoRoot, REVIEW_ROOT, "quarterly-" + targetQuarter);
  await mkdir(outputDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    kind: "quarterly-sources-manifest",
    quarter: targetQuarter,
    asOf: date,
    generatedAt: new Date().toISOString(),
    target: targetFile ? { path: targetFile.relativePath, chars: targetFile.chars, sha256: targetFile.sha256 } : { path: targetPath, missing: true },
    budget,
    sources,
    gaps,
    annualize
  };
  const manifestPath = path.join(outputDir, "quarterly-sources-manifest.json");
  const packPath = path.join(outputDir, "quarterly-compression-pack.md");
  const packMarkdown = renderQuarterlyPack({
    targetQuarter,
    asOf: date,
    resolution,
    targetFile: targetFile ? { ...targetFile, content: await readFile(targetFile.absolutePath, "utf8") } : null,
    activeFiles,
    budget,
    sources,
    gaps,
    annualize,
    promptResource
  });
  await writeFile(packPath, packMarkdown, "utf8");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return {
    status: "pack_ready",
    quarter: targetQuarter,
    asOf: date,
    resolution,
    packPath: toPosix(path.relative(repoRoot, packPath)),
    manifestPath: toPosix(path.relative(repoRoot, manifestPath)),
    targetFile: targetFile ? { path: targetFile.relativePath, chars: targetFile.chars, sha256: targetFile.sha256 } : { path: targetPath, missing: true },
    budget,
    annualize,
    gapCount: gaps.length
  };
}

// ===== ChatGPT 交付导入 =====

function resolveConfirmedCorrections(units, entries, targetFile, targetPath) {
  const resolved = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") throw new Error("confirmedCorrections entries must be objects.");
    if (entry.targetFile !== targetFile) continue;
    const needle = entry.unitText;
    if (typeof needle !== "string" || !needle.trim()) throw new Error("confirmedCorrections for " + targetFile + " is missing unitText.");
    const matches = units.filter((unit) => unit.text.includes(needle));
    if (matches.length !== 1) throw new Error("confirmedCorrections unitText for " + targetFile + " matched " + matches.length + " units (must be exactly 1): " + JSON.stringify(needle.slice(0, 80)) + "…");
    resolved.push({ sourcePath: targetPath, unitId: matches[0].id, evidence: String(entry.evidence ?? ""), summary: String(entry.summary ?? ""), confirmed: true });
  }
  return resolved;
}

export async function importQuarterlyDelivery({ repoRoot = defaultRepoRoot, deliveryPath, quarter, asOf, packRef } = {}) {
  if (!deliveryPath) throw new Error("Missing deliveryPath.");
  const date = parseAsOf(asOf);
  const absoluteDelivery = path.resolve(repoRoot, deliveryPath);
  if (!await exists(absoluteDelivery)) throw new Error("Delivery directory not found: " + deliveryPath);
  const changesPath = path.join(absoluteDelivery, "changes.json");
  if (!await exists(changesPath)) throw new Error("Delivery is missing changes.json.");
  const changes = JSON.parse(await readFile(changesPath, "utf8"));
  const deliveredTargets = (await readdir(absoluteDelivery, { withFileTypes: true }))
    .filter((item) => item.isFile() && item.name.endsWith(".memory.md"))
    .map((item) => item.name)
    .sort();
  if (quarter && changes.quarter && quarter !== changes.quarter) throw new Error("Quarter mismatch: --quarter " + quarter + " vs changes.json " + changes.quarter + ".");
  const resolvedQuarter = quarter ?? changes.quarter ?? lastCompleteQuarter(date);
  quarterEndDate(resolvedQuarter);
  if (changes.noChange === true) {
    if (deliveredTargets.length) throw new Error("Delivery declares noChange but contains target memory files.");
    const noChangeDir = path.join(repoRoot, REVIEW_ROOT, "quarterly-" + resolvedQuarter);
    await mkdir(noChangeDir, { recursive: true });
    const receiptPath = path.join(noChangeDir, "no-change-receipt.json");
    await writeFile(receiptPath, JSON.stringify({ kind: "quarterly-no-change-receipt", quarter: resolvedQuarter, asOf: date, notes: changes.notes ?? "", deliveredAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
    return { status: "no_change", quarter: resolvedQuarter, receiptPath: toPosix(path.relative(repoRoot, receiptPath)) };
  }
  if (!Array.isArray(changes.targets) || !changes.targets.length) throw new Error("changes.json must contain a non-empty targets array (or noChange=true).");
  const targetFiles = changes.targets.map((target) => target && target.targetFile);
  for (const name of deliveredTargets) {
    if (!targetFiles.includes(name)) throw new Error("Delivered file " + name + " has no matching targets entry in changes.json.");
  }
  for (const target of changes.targets) {
    if (!target || typeof target.targetFile !== "string" || !target.targetFile.endsWith(".memory.md")) throw new Error("targets[].targetFile is invalid.");
    if (!deliveredTargets.includes(target.targetFile)) throw new Error("targets entry " + target.targetFile + " has no delivered Markdown file in the delivery directory.");
  }
  const reviewRoot = path.join(repoRoot, REVIEW_ROOT, "quarterly-" + resolvedQuarter);
  const imported = [];
  const validationResults = [];
  for (const target of changes.targets) {
    const targetFile = target.targetFile;
    const targetPath = MEMORY_ROOT + "/" + targetFile;
    const absoluteTarget = path.join(repoRoot, targetPath);
    if (!await exists(absoluteTarget)) throw new Error("Target memory file does not exist: " + targetPath + ". Import refuses to create new formal files.");
    const sourceContent = await readFile(absoluteTarget, "utf8");
    const sourceSha = sha256(sourceContent);
    const units = parseMemoryUnits(sourceContent, targetPath, null);
    const confirmedCorrections = resolveConfirmedCorrections(units, changes.confirmedCorrections, targetFile, targetPath);
    const metadataLike = { mode: "quarterly", quarter: resolvedQuarter, targetPath, confirmedCorrections };
    applyQuarterlyProtection(units, metadataLike, targetPath);
    const protectedUnitIds = units.filter((unit) => unit.protected).map((unit) => unit.id);
    const budget = budgetForAge(Number(date.slice(0, 4)) - Number(resolvedQuarter.slice(0, 4)));
    const metadata = {
      schemaVersion: 2,
      mode: "quarterly",
      operationId: "quarterly-" + resolvedQuarter,
      asOf: date,
      quarter: resolvedQuarter,
      targetPath,
      sourcePaths: [targetPath],
      sourceHashes: { [targetPath]: sourceSha },
      hardLimit: budget.hard,
      targetChars: budget.target,
      currentMonth: date.slice(0, 7),
      protectedUnitIds,
      confirmedCorrections,
      coreDifferences: Array.isArray(target.changes) ? target.changes : [],
      otherChanges: Array.isArray(target.otherChanges) ? target.otherChanges : [],
      changeSummary: target.changeSummary ?? null
    };
    if (packRef) metadata.packRef = packRef;
    const outputDir = path.join(reviewRoot, targetFile.replace(/\.md$/i, ""));
    await mkdir(outputDir, { recursive: true });
    const candidateBody = await readFile(path.join(absoluteDelivery, targetFile), "utf8");
    const candidatePath = path.join(outputDir, targetFile.replace(/\.md$/i, ".compressed.md"));
    if (await exists(candidatePath)) {
      const existing = await readFile(candidatePath, "utf8");
      if (existing !== candidateBody) throw new Error("Candidate already exists with different content: " + toPosix(path.relative(repoRoot, candidatePath)) + ". A reviewed candidate is never silently overwritten.");
    }
    await writeFile(candidatePath, candidateBody, "utf8");
    await writeFile(path.join(outputDir, ".memory-compression.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
    const validation = await validateMemoryCompression({ repoRoot, candidatePath: outputDir });
    imported.push(toPosix(path.relative(repoRoot, candidatePath)));
    validationResults.push({ candidatePath: toPosix(path.relative(repoRoot, outputDir)), status: validation.status, stale: validation.stale, hardLimitOk: validation.hardLimitOk, protectedOk: validation.protectedOk, coreDifferencesOk: validation.coreDifferencesOk, otherChangesOk: validation.otherChangesOk, changeSummaryOk: validation.changeSummaryOk, chars: validation.totalChars, hardLimit: validation.hardLimit, targetChars: validation.targetChars });
  }
  const status = validationResults.every((result) => result.status === "ready") ? "ready"
    : validationResults.some((result) => result.stale) ? "stale" : "needs_review";
  return { status, quarter: resolvedQuarter, asOf: date, imported, validationResults };
}

// ===== CLI =====

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--as-of") options.asOf = argv[++index];
    else if (arg === "--quarter") options.quarter = argv[++index];
    else if (arg === "--pack-ref") options.packRef = argv[++index];
    else if (!options.positional) options.positional = arg;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "pack") {
    console.log(JSON.stringify(await planQuarterlyPack({ asOf: options.asOf, quarter: options.quarter }), null, 2));
  } else if (options.command === "import") {
    console.log(JSON.stringify(await importQuarterlyDelivery({ deliveryPath: options.positional, quarter: options.quarter, asOf: options.asOf, packRef: options.packRef }), null, 2));
  } else {
    throw new Error("Usage: quarterly-memory.mjs pack [--as-of YYYY-MM-DD] [--quarter YYYY-QN] | import <deliveryDir> [--quarter YYYY-QN] [--as-of YYYY-MM-DD] [--pack-ref <path>]");
  }
}

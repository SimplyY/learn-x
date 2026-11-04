import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultCoreRoot = "/Users/yuwei/code/core";
const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

function rangeId(weeks) {
  if (weeks.length === 1) return weeks[0];
  const first = weeks[0], last = weeks.at(-1);
  return first.slice(0, 4) === last.slice(0, 4) ? `${first}-${last.slice(5)}` : `${first}-${last}`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Local receipts are accepted only after link-core has read the live links back. */
export async function assertWeeklyCoreLinks(weeks, { repoRoot = defaultRepoRoot } = {}) {
  if (weeks.length === 1) {
    const week = weeks[0];
    let anchor;
    try { anchor = await readJson(path.join(repoRoot, "03_input/weekly", week, "_weekly-journal-anchor.json")); }
    catch { throw new Error(`weekly-process-blocked-core-link: ${week}: 周记锚点或 Core 链接回执缺失`); }
    const link = anchor.coreLink;
    if (anchor.week !== week || link?.week !== week || link.status !== "verified"
      || link.headingId !== anchor.targetBlockId || !link.documentId
      || link.url !== `https://ywhome.feishu.cn/docx/${link.documentId}`) {
      throw new Error(`weekly-process-blocked-core-link: ${week}: 周记内 Core 链接尚未读回核验`);
    }
    return [{ week, documentId: link.documentId }];
  }

  const periodId = rangeId(weeks);
  let anchor, manifest;
  try {
    [anchor, manifest] = await Promise.all([
      readJson(path.join(repoRoot, "03_input/weekly", periodId, "_weekly-journal-anchor.json")),
      readJson(path.join(repoRoot, "03_input/weekly", periodId, "_range-manifest.json"))
    ]);
  } catch { throw new Error(`weekly-process-blocked-core-link: ${periodId}: 范围周记锚点或 Core 链接回执缺失`); }
  const anchorLinks = new Map((anchor.coreLinks || []).map(item => [item.week, item]));
  const manifestLinks = new Map((manifest.core?.links || []).map(item => [item.week, item]));
  if (anchor.periodId !== periodId || manifest.period?.id !== periodId || manifest.core?.status !== "links-verified"
    || anchor.documentId !== manifest.journal?.documentId || anchor.targetBlockId !== manifest.journal?.targetBlockId
    || JSON.stringify(anchor.weeks) !== JSON.stringify(weeks) || weeks.some(week => {
      const link = anchorLinks.get(week), recorded = manifestLinks.get(week);
      return !link || !recorded || link.status !== "verified" || recorded.status !== "verified"
        || link.documentId !== recorded.documentId || link.url !== `https://ywhome.feishu.cn/docx/${link.documentId}`;
    })) {
    throw new Error(`weekly-process-blocked-core-link: ${periodId}: 组成周 Core 链接未全部核验`);
  }
  return weeks.map(week => ({ week, documentId: anchorLinks.get(week).documentId }));
}

async function runCoreGate(week, coreRoot = defaultCoreRoot) {
  const script = path.join(coreRoot, ".agents/skills/core-weekly/scripts/weekly-review.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, "gate", "--week", week, "--json"], {
      cwd: coreRoot, timeout: 60_000, maxBuffer: 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim()) {
      try { return JSON.parse(error.stdout); } catch { /* report the command boundary below */ }
    }
    throw new Error(`Core 门禁不可用（${week}）：${error.code || error.message}`);
  }
}

export async function requireCoreWeeklyGate(weeks, { coreRoot = defaultCoreRoot, repoRoot = defaultRepoRoot, runGate, validateJournalLinks = true } = {}) {
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 4
    || weeks.some(week => !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week))) {
    throw new Error("weekly-process-blocked-core: ISO week list is invalid");
  }
  if (validateJournalLinks) await assertWeeklyCoreLinks(weeks, { repoRoot });
  const gate = runGate || (week => runCoreGate(week, coreRoot));
  const results = [];
  const issues = [];
  for (const week of weeks) {
    let result;
    try { result = await gate(week); }
    catch (error) {
      issues.push(`${week}: Core 门禁不可用（${error.message}）`);
      continue;
    }
    if (result?.ok !== true || result.week !== week || !result.docId) {
      const missing = Array.isArray(result?.missingFields)
        ? result.missingFields.map(item => `第 ${item.row} 行 ${item.fields.join("、")}`).join("；")
        : "Core 文档或字段结构未通过验证";
      issues.push(`${week}: ${missing}${result?.reason ? `（${result.reason}）` : ""}`);
      continue;
    }
    results.push({ week, docId: result.docId, checkedAt: result.checkedAt ?? null });
  }
  if (issues.length) throw new Error(`weekly-process-blocked-core: ${issues.join("；")}`);
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const weeks = process.argv.slice(2);
  const result = await requireCoreWeeklyGate(weeks);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

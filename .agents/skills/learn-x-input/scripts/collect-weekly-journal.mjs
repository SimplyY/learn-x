import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countInputChars } from "./lib/input-limits.mjs";
import { defaultWeeklyReviewWeek, isoWeekRange } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
export const WEEKLY_JOURNAL_DOCUMENT_URL = "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac";
export const WEEKLY_JOURNAL_ANCHOR_FILE = "_weekly-journal-anchor.json";

export async function recordWeeklyJournalAnchor({ week, writeDate, targetTitle, targetBlockId, documentId, repoRoot: root = repoRoot }) {
  const normalizedWeek = normalizeWeek(week);
  const expected = expectedJournalDates(normalizedWeek);
  if (writeDate !== expected.writeDate) throw new Error(`weekly-journal-anchor-invalid: write date must be ${expected.writeDate}`);
  if (typeof targetTitle !== "string" || !hasExpectedJournalDate(targetTitle, expected.shortTitle)) {
    throw new Error(`weekly-journal-anchor-invalid: target title must include ${expected.shortTitle}`);
  }
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(targetBlockId || ""))) throw new Error("weekly-journal-anchor-invalid: target block id is missing or malformed");
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(documentId || ""))) throw new Error("weekly-journal-anchor-invalid: document id is missing or malformed");

  const weekDir = path.join(root, "03_input/weekly", normalizedWeek);
  const anchorPath = path.join(weekDir, WEEKLY_JOURNAL_ANCHOR_FILE);
  const anchor = {
    schemaVersion: 1,
    week: normalizedWeek,
    documentUrl: WEEKLY_JOURNAL_DOCUMENT_URL,
    documentId,
    targetTitle: targetTitle.trim(),
    targetBlockId,
    writeDate,
    coverage: { start: expected.start, end: expected.end },
    savedAt: new Date().toISOString()
  };
  await mkdir(weekDir, { recursive: true });
  try {
    const current = JSON.parse(await readFile(anchorPath, "utf8"));
    assertSameAnchorTarget(current, anchor);
    return { anchor: current, anchorPath, unchanged: true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tempPath = `${anchorPath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(anchor, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(tempPath, anchorPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const current = JSON.parse(await readFile(anchorPath, "utf8"));
    assertSameAnchorTarget(current, anchor);
    return { anchor: current, anchorPath, unchanged: true };
  } finally {
    await unlink(tempPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  return { anchor, anchorPath };
}

function assertSameAnchorTarget(current, requested) {
  if (current.schemaVersion !== 1 || current.week !== requested.week || current.documentUrl !== requested.documentUrl
    || current.documentId !== requested.documentId || current.targetBlockId !== requested.targetBlockId
    || current.targetTitle !== requested.targetTitle || current.writeDate !== requested.writeDate
    || current.coverage?.start !== requested.coverage.start || current.coverage?.end !== requested.coverage.end) {
    throw new Error("weekly-journal-anchor-conflict: an existing anchor points to a different target; preserve it and inspect the journal before replacing");
  }
}

export async function collectConfirmedWeeklyJournal({ week, repoRoot: root = repoRoot, fetchSection = fetchWeeklyJournalSection }) {
  const normalizedWeek = normalizeWeek(week || defaultWeeklyReviewWeek());
  const weekDir = path.join(root, "03_input/weekly", normalizedWeek);
  const anchorPath = path.join(weekDir, WEEKLY_JOURNAL_ANCHOR_FILE);
  let anchor;
  try { anchor = JSON.parse(await readFile(anchorPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`weekly-journal-anchor-missing: run input:weekly-anchor after the draft is written and read back for ${normalizedWeek}`);
    throw new Error("weekly-journal-anchor-invalid: anchor JSON cannot be read");
  }
  validateAnchor(anchor, normalizedWeek);

  const response = await fetchSection({
    docUrl: WEEKLY_JOURNAL_DOCUMENT_URL,
    blockId: anchor.targetBlockId,
    timeoutMs: 60_000
  });
  const document = response?.data?.document || response?.document;
  if (response?.ok !== true || response?.identity !== "bot" || !document || typeof document.content !== "string") {
    throw new Error("weekly-journal-fetch-failed: Feishu did not return a verified bot read of the target section");
  }
  if (document.document_id !== anchor.documentId) throw new Error("weekly-journal-target-mismatch: the section belongs to a different document");
  const section = unwrapFragment(document.content).trim();
  if (!section.includes(anchor.targetTitle)) throw new Error("weekly-journal-target-mismatch: fetched section does not contain the anchored heading");
  if (section.includes("【待优化】AI 基础草稿")) throw new Error("weekly-journal-unconfirmed: target section still contains the draft marker");
  if (!hasSubstantiveText(section)) throw new Error("weekly-journal-empty: target section has no substantive journal text");

  const capturedAt = new Date().toISOString();
  const outputPath = path.join(weekDir, "weekly.md");
  const sourceMarker = [
    `- 来源 URL：${WEEKLY_JOURNAL_DOCUMENT_URL}`,
    `- 周记写作日标题：${anchor.targetTitle}`,
    `- 目标周：${normalizedWeek}`,
    `- 目标覆盖范围：${anchor.coverage.start} 至 ${anchor.coverage.end}`,
    `- 定位依据：已确认标题 block ${anchor.targetBlockId}`
  ];
  const output = [
    `# Confirmed weekly journal input｜${normalizedWeek}`,
    ...sourceMarker,
    `- 采集时间：${capturedAt}`,
    "",
    section,
    ""
  ].join("\n");
  try {
    const existing = await readFile(outputPath, "utf8");
    if (!sourceMarker.every((line) => existing.includes(line)) || !existing.includes(section)) {
      throw new Error("weekly-journal-input-conflict: an existing weekly.md differs; refusing to overwrite it");
    }
    return { week: normalizedWeek, outputPath, chars: countInputChars(section), capturedAt, unchanged: true, documentRevision: document.revision_id ?? null };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await atomicWrite(outputPath, output);
  }
  return { week: normalizedWeek, outputPath, chars: countInputChars(section), capturedAt, documentRevision: document.revision_id ?? null };
}

export async function fetchWeeklyJournalSection({ docUrl, blockId, timeoutMs = 60_000 }) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("lark-cli", [
      "docs", "+fetch", "--as", "bot", "--doc", docUrl,
      "--scope", "section", "--start-block-id", blockId,
      "--detail", "with-ids", "--doc-format", "markdown"
    ], { timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    const kind = error.killed || error.code === "ETIMEDOUT" ? "timeout" : error.code === "ENOENT" ? "cli-unavailable" : "cli-error";
    throw new Error(`weekly-journal-fetch-failed: ${kind}`);
  }
  try { return JSON.parse(stdout); }
  catch { throw new Error("weekly-journal-fetch-failed: CLI response was not valid JSON"); }
}

function validateAnchor(anchor, week) {
  const expected = expectedJournalDates(week);
  if (!anchor || anchor.schemaVersion !== 1 || anchor.week !== week || anchor.documentUrl !== WEEKLY_JOURNAL_DOCUMENT_URL
    || typeof anchor.documentId !== "string" || typeof anchor.targetBlockId !== "string"
    || !anchor.coverage || anchor.coverage.start !== expected.start || anchor.coverage.end !== expected.end
    || anchor.writeDate !== expected.writeDate || typeof anchor.targetTitle !== "string" || !hasExpectedJournalDate(anchor.targetTitle, expected.shortTitle)) {
    throw new Error("weekly-journal-anchor-invalid: week, target document, title, or coverage did not match");
  }
}

function hasExpectedJournalDate(title, shortTitle) {
  const escaped = shortTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\d])${escaped}(?!\\d)`).test(title);
}

function expectedJournalDates(week) {
  const { start, end } = isoWeekRange(week);
  const lastCoveredDate = new Date(end.getTime() - 86_400_000);
  const writeDate = new Date(lastCoveredDate.getTime() + 86_400_000);
  const isoDate = (date) => date.toISOString().slice(0, 10);
  return {
    start: isoDate(start),
    end: isoDate(lastCoveredDate),
    writeDate: isoDate(writeDate),
    shortTitle: `${writeDate.getUTCMonth() + 1}.${writeDate.getUTCDate()}`
  };
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`invalid-week: ${value}`);
  return `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
}

function unwrapFragment(content) {
  return String(content).replace(/^\s*<fragment\b[^>]*>/i, "").replace(/<\/fragment>\s*$/i, "");
}

function hasSubstantiveText(content) {
  const lines = String(content).split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^(?:待补充|待填写|xx+|todo|暂无)[。.!！?？]?$/i.test(line));
  return lines.some((line) => countInputChars(line.replace(/[`*_>#|]/g, "").trim()) >= 12);
}

async function atomicWrite(filePath, content) {
  const temp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temp, filePath); }
  finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--record-anchor") options.recordAnchor = true;
    else if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--write-date") options.writeDate = argv[++index];
    else if (argv[index] === "--target-title") options.targetTitle = argv[++index];
    else if (argv[index] === "--target-block-id") options.targetBlockId = argv[++index];
    else if (argv[index] === "--document-id") options.documentId = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.recordAnchor
    ? await recordWeeklyJournalAnchor(options)
    : await collectConfirmedWeeklyJournal(options);
  process.stdout.write(`${JSON.stringify({ ...result, anchor: result.anchor && { ...result.anchor, documentUrl: WEEKLY_JOURNAL_DOCUMENT_URL } })}\n`);
}

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countInputChars } from "./lib/input-limits.mjs";
import { fetchWeeklyJournalSection, hasExpectedJournalDate, WEEKLY_JOURNAL_DOCUMENT_URL } from "./collect-weekly-journal.mjs";
import { requireCoreWeeklyGate } from "../../learn-x-process/scripts/lib/core-weekly-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

export async function collectConfirmedWeeklyRangeJournal({ periodId, repoRoot: root = repoRoot, fetchSection = fetchWeeklyJournalSection, requireCoreGate = requireCoreWeeklyGate }) {
  const directory = path.join(root, "03_input/weekly", periodId);
  const manifestPath = path.join(directory, "_range-manifest.json");
  const anchorPath = path.join(directory, "_weekly-journal-anchor.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const anchor = JSON.parse(await readFile(anchorPath, "utf8"));
  const weeks = validateRange(periodId, manifest.period?.weeks);
  const expected = rangeDates(weeks);
  if (manifest.period?.id !== periodId || anchor.periodId !== periodId
    || JSON.stringify(anchor.weeks) !== JSON.stringify(weeks)
    || anchor.documentId !== manifest.journal?.documentId
    || anchor.targetBlockId !== manifest.journal?.targetBlockId
    || anchor.coverage?.start !== expected.start || anchor.coverage?.end !== expected.end
    || anchor.writeDate !== expected.writeDate) {
    throw new Error("weekly-range-journal-anchor-invalid: period, weeks, target, or coverage mismatch");
  }
  await requireCoreGate(weeks, { repoRoot: root });

  const response = await fetchSection({ docUrl: WEEKLY_JOURNAL_DOCUMENT_URL, blockId: anchor.targetBlockId, timeoutMs: 60_000 });
  const document = response?.data?.document || response?.document;
  if (response?.ok !== true || response?.identity !== "bot" || !document || typeof document.content !== "string"
    || document.document_id !== anchor.documentId) {
    throw new Error("weekly-range-journal-fetch-failed: verified bot read did not match the bound document");
  }
  const section = unwrapFragment(document.content).trim();
  const liveTitle = section.match(/^#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim();
  if (!liveTitle || !hasExpectedJournalDate(liveTitle, expected.shortTitle)
    || !liveTitle.includes(weeks[0]) || !liveTitle.includes(weeks.at(-1).slice(5))) {
    throw new Error("weekly-range-journal-target-mismatch: latest heading does not match the confirmed range and write date");
  }
  if (section.includes("【待优化】AI 基础草稿")) throw new Error("weekly-range-journal-unconfirmed: draft marker remains");
  if (!hasSubstantiveText(section)) throw new Error("weekly-range-journal-empty: no substantive journal text");

  const capturedAt = new Date().toISOString();
  const sourceHash = sha256(section);
  const weeklyPath = path.join(directory, "weekly.md");
  const output = [
    `# Confirmed weekly journal input｜${periodId}`,
    `- 目标周期：${periodId}`,
    `- 目标覆盖范围：${expected.start} 至 ${expected.end}`,
    `- 周记写作日标题：${liveTitle}`,
    `- 来源 URL：${WEEKLY_JOURNAL_DOCUMENT_URL}`,
    `- 来源 revision：${document.revision_id == null ? "unknown" : String(document.revision_id)}`,
    `- 定位依据：已确认标题 block ${anchor.targetBlockId}`,
    `- 用户确认依据：本线程明确回复“继续”；最新读回无草稿标记`,
    `- 采集时间：${capturedAt}`,
    `- 目标内容 SHA-256：${sourceHash}`,
    "",
    section,
    ""
  ].join("\n");
  await writeNoOverwrite(weeklyPath, output);
  const saved = await readFile(weeklyPath, "utf8");
  if (!saved.includes(section) || sha256(section) !== sourceHash) throw new Error("weekly-range-journal-readback-mismatch");

  const confirmedAnchor = {
    ...anchor,
    targetTitle: liveTitle,
    revisionId: document.revision_id ?? null,
    draftStatus: "confirmed",
    confirmationEvidence: "本线程明确回复“继续”；最新 bot 读回的目标标题无草稿标记",
    confirmedAt: capturedAt,
    contentSha256: sourceHash,
    savedAt: capturedAt
  };
  await atomicReplace(anchorPath, `${JSON.stringify(confirmedAnchor, null, 2)}\n`);
  manifest.journal = {
    ...manifest.journal,
    status: "confirmed-readback",
    targetTitle: liveTitle,
    revisionId: document.revision_id ?? null,
    readBackVerified: true,
    contentSha256: sourceHash,
    confirmedAt: capturedAt,
    confirmationEvidence: confirmedAnchor.confirmationEvidence,
    weeklyPath: `03_input/weekly/${periodId}/weekly.md`,
    weeklySha256: sha256(saved)
  };
  await atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    periodId,
    weeks,
    weeklyPath,
    chars: countInputChars(section),
    sourceHash,
    weeklyHash: sha256(saved),
    documentId: document.document_id,
    revisionId: document.revision_id ?? null,
    targetTitle: liveTitle,
    targetBlockId: anchor.targetBlockId,
    capturedAt
  };
}

function validateRange(periodId, values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) throw new Error("weekly-range-invalid: expected 1 to 4 ISO weeks");
  const weeks = values.map(normalizeWeek);
  for (let index = 1; index < weeks.length; index += 1) {
    if (nextWeek(weeks[index - 1]) !== weeks[index]) throw new Error("weekly-range-invalid: weeks must be contiguous");
  }
  if (makePeriodId(weeks) !== periodId) throw new Error("weekly-range-invalid: period id does not match its weeks");
  return weeks;
}

function normalizeWeek(value) {
  const match = String(value).match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`weekly-range-invalid-week: ${value}`);
  return `${match[1]}-W${match[2]}`;
}

function nextWeek(week) {
  const start = weekStart(week);
  start.setUTCDate(start.getUTCDate() + 7);
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const number = Math.floor((start.getTime() - monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(number).padStart(2, "0")}`;
}

function weekStart(week) {
  const [year, number] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (number - 1) * 7);
  return start;
}

function makePeriodId(weeks) {
  if (weeks.length === 1) return weeks[0];
  const [first, last] = [weeks[0], weeks.at(-1)];
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${first}-${last.slice(5)}`
    : `${first}-${last}`;
}

function rangeDates(weeks) {
  const start = weekStart(weeks[0]);
  const after = weekStart(weeks.at(-1));
  after.setUTCDate(after.getUTCDate() + 7);
  const end = new Date(after);
  end.setUTCDate(end.getUTCDate() - 1);
  const writeDate = after;
  return {
    start: isoDate(start), end: isoDate(end), writeDate: isoDate(writeDate),
    shortTitle: `${writeDate.getUTCMonth() + 1}.${writeDate.getUTCDate()}`
  };
}

function isoDate(date) { return date.toISOString().slice(0, 10); }
function unwrapFragment(content) { return String(content).replace(/^\s*<fragment\b[^>]*>/i, "").replace(/<\/fragment>\s*$/i, ""); }
function sha256(value) { return createHash("sha256").update(String(value), "utf8").digest("hex"); }

function hasSubstantiveText(content) {
  return String(content).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^(?:待补充|待填写|xx+|todo|暂无)[。.!！?？]?$/i.test(line))
    .some((line) => countInputChars(line.replace(/[`*_>#|]/g, "").trim()) >= 12);
}

async function writeNoOverwrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== content) throw new Error("weekly-range-journal-conflict: existing weekly.md differs; refusing to overwrite");
    return;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await atomicCreate(target, content);
}

async function atomicCreate(target, content) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await link(temporary, target); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(target, "utf8");
    if (existing !== content) throw new Error("weekly-range-journal-conflict: concurrent file differs");
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

async function atomicReplace(target, content) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temporary, target); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const periodId = process.argv.find((argument) => argument.startsWith("--period="))?.slice("--period=".length);
  if (!periodId) throw new Error("usage: node collect-weekly-range-journal.mjs --period=YYYY-Www-Www");
  try {
    const result = await collectConfirmedWeeklyRangeJournal({ periodId });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error?.message?.startsWith("weekly-process-blocked-core")) {
      console.error(error.message);
      process.exitCode = 3;
    } else {
      throw error;
    }
  }
}

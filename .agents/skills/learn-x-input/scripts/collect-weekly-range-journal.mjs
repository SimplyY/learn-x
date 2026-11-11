import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countInputChars } from "./lib/input-limits.mjs";
import { fetchWeeklyJournalSection, hasExpectedJournalDate, mirrorLearnXPersonalFilesToYWContext, WEEKLY_JOURNAL_DOCUMENT_URL } from "./collect-weekly-journal.mjs";
import { requireCoreWeeklyGate } from "../../learn-x-process/scripts/lib/core-weekly-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

export async function recordWeeklyRangeAnchor({
  periodId,
  targetTitle,
  targetBlockId,
  documentId,
  writeDate,
  automationId,
  scheduledAt,
  repoRoot: root = repoRoot,
  fetchSection = fetchWeeklyJournalSection
}) {
  const weeks = weeksFromPeriodId(periodId);
  const expected = rangeDates(weeks);
  const title = String(targetTitle || "").trim();
  if (writeDate !== expected.writeDate || !hasExpectedJournalDate(title, expected.shortTitle)
    || !title.includes(periodId) || !title.includes(expected.start) || !title.includes(expected.end)) {
    throw new Error("weekly-range-journal-anchor-invalid: period, title, or write date mismatch");
  }
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(targetBlockId || ""))) throw new Error("weekly-range-journal-anchor-invalid: target block id is missing or malformed");
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(documentId || ""))) throw new Error("weekly-range-journal-anchor-invalid: document id is missing or malformed");
  if (typeof automationId !== "string" || !automationId.trim()) throw new Error("weekly-range-journal-anchor-invalid: automation id is required");
  if (!Number.isFinite(Date.parse(scheduledAt))) throw new Error("weekly-range-journal-anchor-invalid: scheduled time is invalid");

  const response = await fetchSection({ docUrl: WEEKLY_JOURNAL_DOCUMENT_URL, blockId: targetBlockId, timeoutMs: 60_000 });
  const document = response?.data?.document || response?.document;
  if (response?.ok !== true || response?.identity !== "bot" || !document || typeof document.content !== "string"
    || document.document_id !== documentId || !Number.isSafeInteger(Number(document.revision_id))) {
    throw new Error("weekly-range-journal-anchor-readback-failed: verified bot read did not match the bound document");
  }
  const section = unwrapFragment(document.content).trim();
  const liveTitle = section.match(/^#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim();
  if (liveTitle !== title || !liveTitle.includes(periodId) || !liveTitle.includes(expected.start) || !liveTitle.includes(expected.end)
    || !hasExpectedJournalDate(liveTitle, expected.shortTitle)) {
    throw new Error("weekly-range-journal-anchor-readback-mismatch: live title does not match the requested range");
  }
  if (!liveTitle.includes("【待优化】AI 基础草稿")) throw new Error("weekly-range-journal-anchor-readback-mismatch: draft marker is missing");
  if (!hasSubstantiveText(section)) throw new Error("weekly-range-journal-anchor-readback-mismatch: draft has no substantive content");

  const directory = path.join(root, "03_input/weekly", periodId);
  const anchorPath = path.join(directory, "_weekly-journal-anchor.json");
  const manifestPath = path.join(directory, "_range-manifest.json");
  const relativeAnchorPath = `03_input/weekly/${periodId}/_weekly-journal-anchor.json`;
  const capturedAt = new Date().toISOString();
  const targetUrl = `https://ywhome.feishu.cn/docx/${documentId}#${targetBlockId}`;
  const anchor = {
    schemaVersion: 1,
    periodId,
    weeks,
    documentUrl: WEEKLY_JOURNAL_DOCUMENT_URL,
    documentId,
    targetTitle: liveTitle,
    targetBlockId,
    targetUrl,
    writeDate: expected.writeDate,
    coverage: { start: expected.start, end: expected.end },
    revisionId: Number(document.revision_id),
    draftStatus: "draft",
    savedAt: capturedAt,
    contentSha256: sha256(section)
  };
  const sourceStatusByWeek = await readRangeSourceStatusByWeek(root, weeks);
  const manifest = {
    schemaVersion: 1,
    run: { automationId: automationId.trim(), scheduledAt: new Date(scheduledAt).toISOString() },
    period: {
      id: periodId, weeks, start: expected.start, endInclusive: expected.end,
      timezone: "Asia/Shanghai", writeDate: expected.writeDate
    },
    workflow: {
      temporaryRangeOverride: true,
      oneCombinedJournal: true,
      oneCombinedProcessPack: true,
      noSeparateWeeklyOutputs: true,
      chatgptBridge: "manual-by-user"
    },
    sourceStatusByWeek,
    journal: {
      anchorPath: relativeAnchorPath,
      status: "draft",
      targetTitle: liveTitle,
      targetBlockId,
      documentId,
      targetUrl,
      revisionId: Number(document.revision_id),
      readBackVerified: true,
      savedAt: capturedAt,
      contentSha256: sha256(section)
    }
  };

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const existingManifest = await readOptionalJson(manifestPath);
  const existingAnchor = await readOptionalJson(anchorPath);
  if (existingManifest) assertManifestBinding(existingManifest, manifest);
  if (existingAnchor) assertAnchorBinding(existingAnchor, anchor);
  if (!existingManifest) await writeJsonExclusive(manifestPath, manifest, value => assertManifestBinding(value, manifest));
  if (!existingAnchor) await writeJsonExclusive(anchorPath, anchor, value => assertAnchorBinding(value, anchor));
  return {
    periodId,
    weeks,
    manifestPath: path.relative(root, manifestPath).split(path.sep).join("/"),
    anchorPath: path.relative(root, anchorPath).split(path.sep).join("/"),
    targetUrl,
    revisionId: Number(document.revision_id),
    unchanged: Boolean(existingManifest && existingAnchor)
  };
}

export async function collectConfirmedWeeklyRangeJournal({ periodId, repoRoot: root = repoRoot, fetchSection = fetchWeeklyJournalSection, requireCoreGate = requireCoreWeeklyGate }) {
  const directory = path.join(root, "03_input/weekly", periodId);
  const manifestPath = path.join(directory, "_range-manifest.json");
  const anchorPath = path.join(directory, "_weekly-journal-anchor.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const anchor = JSON.parse(await readFile(anchorPath, "utf8"));
  const weeks = validateRange(periodId, manifest.period?.weeks);
  const expected = rangeDates(weeks);
  if (manifest.schemaVersion !== 1 || manifest.period?.id !== periodId || manifest.period?.start !== expected.start
    || manifest.period?.endInclusive !== expected.end || manifest.period?.writeDate !== expected.writeDate
    || anchor.periodId !== periodId
    || JSON.stringify(anchor.weeks) !== JSON.stringify(weeks)
    || anchor.documentId !== manifest.journal?.documentId
    || anchor.targetBlockId !== manifest.journal?.targetBlockId
    || anchor.targetTitle !== manifest.journal?.targetTitle || manifest.journal?.readBackVerified !== true
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
  const confirmedTitle = String(anchor.targetTitle || "").replace(/^【待优化】AI 基础草稿[:：]?\s*/, "");
  if (!liveTitle || liveTitle !== confirmedTitle || !hasExpectedJournalDate(liveTitle, expected.shortTitle)
    || !liveTitle.includes(periodId) || !liveTitle.includes(expected.start) || !liveTitle.includes(expected.end)) {
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
  const ywContextMirror = await mirrorLearnXPersonalFilesToYWContext(root);
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
    capturedAt,
    ywContextMirror
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
  weekStart(`${match[1]}-W${match[2]}`);
  return `${match[1]}-W${match[2]}`;
}

function weeksFromPeriodId(periodId) {
  const value = String(periodId || "");
  const single = value.match(/^(\d{4}-W\d{2})$/);
  if (single) return [normalizeWeek(single[1])];
  const sameYear = value.match(/^(\d{4})-W(\d{2})-W(\d{2})$/);
  const crossYear = value.match(/^(\d{4})-W(\d{2})-(\d{4})-W(\d{2})$/);
  const match = sameYear
    ? [`${sameYear[1]}-W${sameYear[2]}`, `${sameYear[1]}-W${sameYear[3]}`]
    : crossYear ? [`${crossYear[1]}-W${crossYear[2]}`, `${crossYear[3]}-W${crossYear[4]}`] : null;
  if (!match) throw new Error("weekly-range-invalid: unsupported period id");
  const first = normalizeWeek(match[0]);
  const last = normalizeWeek(match[1]);
  const weeks = [first];
  while (weeks.at(-1) !== last && weeks.length <= 4) weeks.push(nextWeek(weeks.at(-1)));
  if (weeks.at(-1) !== last || weeks.length > 4 || makePeriodId(weeks) !== value) {
    throw new Error("weekly-range-invalid: expected 1 to 4 contiguous ISO weeks");
  }
  return weeks;
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
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error(`weekly-range-invalid-week: ${week}`);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekOneMonday = new Date(jan4);
  weekOneMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const nextJan4 = new Date(Date.UTC(year + 1, 0, 4));
  const nextWeekOneMonday = new Date(nextJan4);
  nextWeekOneMonday.setUTCDate(nextJan4.getUTCDate() - ((nextJan4.getUTCDay() || 7) - 1));
  const weeksInYear = Math.round((nextWeekOneMonday.getTime() - weekOneMonday.getTime()) / (7 * 86_400_000));
  if (!Number.isInteger(number) || number < 1 || number > weeksInYear) throw new Error(`weekly-range-invalid-week: ${week}`);
  const start = new Date(weekOneMonday);
  start.setUTCDate(weekOneMonday.getUTCDate() + (number - 1) * 7);
  return start;
}

async function readRangeSourceStatusByWeek(root, weeks) {
  const snapshots = [];
  for (const week of weeks) {
    const directory = path.join(root, "03_input/weekly", week);
    const statusPath = path.join(directory, "_source-status.json");
    const retryPath = path.join(directory, "_weekly-retry-state.json");
    const status = await readJson(statusPath, "weekly-range-source-status-missing");
    const retry = await readJson(retryPath, "weekly-range-retry-state-missing");
    if (status.week !== week || !status.sources || typeof status.sources !== "object"
      || retry.schemaVersion !== 1 || retry.week !== week || !retry.sources || typeof retry.sources !== "object") {
      throw new Error(`weekly-range-source-state-invalid: ${week}`);
    }
    const sources = Object.fromEntries(Object.entries(status.sources).map(([source, item]) => [source, {
      status: typeof item?.status === "string" ? item.status : "unknown",
      ...(item?.file ? { file: path.posix.basename(normalizeSourcePath(week, item.file)) } : {}),
      ...(Number.isFinite(item?.count) ? { count: item.count } : {}),
      ...(typeof item?.summary === "string" ? { summary: item.summary } : {}),
      ...(typeof item?.updatedAt === "string" ? { updatedAt: item.updatedAt } : {})
    }]));
    const retrySummary = Object.fromEntries(Object.entries(retry.sources).map(([source, item]) => [source, {
      status: typeof item?.status === "string" ? item.status : "unknown",
      attempts: Number.isInteger(item?.attempts) ? item.attempts : 0,
      retries: Number.isInteger(item?.retries) ? item.retries : 0,
      rescueUsed: item?.rescueUsed === true,
      ...(typeof item?.lastErrorSignal === "string" ? { lastErrorSignal: item.lastErrorSignal } : {}),
      ...(typeof item?.lastAttemptAt === "string" ? { lastAttemptAt: item.lastAttemptAt } : {}),
      ...(typeof item?.nextRetryAt === "string" ? { nextRetryAt: item.nextRetryAt } : {}),
      ...(typeof item?.lastErrorClass === "string" ? { lastErrorClass: item.lastErrorClass } : {})
    }]));
    snapshots.push({ week, directory: `03_input/weekly/${week}`, updatedAt: status.updatedAt || null, sources, retry: retrySummary });
  }
  return snapshots;
}

function normalizeSourcePath(week, value) {
  const file = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!file || path.posix.isAbsolute(file) || file.split("/").includes("..")) throw new Error(`weekly-range-source-path-invalid: ${week}`);
  return file.startsWith(`03_input/weekly/${week}/`) ? file : `03_input/weekly/${week}/${file}`;
}

async function readJson(filePath, errorPrefix) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`${errorPrefix}: ${filePath}`);
    throw new Error(`weekly-range-state-json-invalid: ${filePath}`);
  }
}

async function readOptionalJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`weekly-range-state-json-invalid: ${filePath}`);
  }
}

async function writeJsonExclusive(filePath, value, validateExisting) {
  const temporary = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(temporary, filePath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    validateExisting(await readJson(filePath, "weekly-range-state-missing"));
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

function assertManifestBinding(existing, expected) {
  if (existing.schemaVersion !== 1 || existing.period?.id !== expected.period.id
    || JSON.stringify(existing.period?.weeks) !== JSON.stringify(expected.period.weeks)
    || existing.period?.start !== expected.period.start || existing.period?.endInclusive !== expected.period.endInclusive
    || existing.period?.writeDate !== expected.period.writeDate || existing.period?.timezone !== expected.period.timezone
    || existing.journal?.documentId !== expected.journal.documentId
    || existing.journal?.targetBlockId !== expected.journal.targetBlockId
    || existing.journal?.targetTitle !== expected.journal.targetTitle) {
    throw new Error("weekly-range-journal-manifest-conflict: preserve existing range state and inspect it before replacing");
  }
}

function assertAnchorBinding(existing, expected) {
  if (existing.schemaVersion !== 1 || existing.periodId !== expected.periodId
    || JSON.stringify(existing.weeks) !== JSON.stringify(expected.weeks)
    || existing.documentUrl !== expected.documentUrl || existing.documentId !== expected.documentId
    || existing.targetTitle !== expected.targetTitle || existing.targetBlockId !== expected.targetBlockId
    || existing.writeDate !== expected.writeDate || existing.coverage?.start !== expected.coverage.start
    || existing.coverage?.end !== expected.coverage.end) {
    throw new Error("weekly-range-journal-anchor-conflict: preserve existing anchor and inspect it before replacing");
  }
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

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--record-anchor") options.recordAnchor = true;
    else if (argument.startsWith("--") && argument.includes("=")) {
      const separator = argument.indexOf("=");
      options[argument.slice(2, separator).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argument.slice(separator + 1);
    } else if (argument.startsWith("--")) {
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const periodId = options.periodId;
  if (!periodId) throw new Error("usage: node collect-weekly-range-journal.mjs --period=YYYY-Www-Www");
  if (options.recordAnchor) {
    const result = await recordWeeklyRangeAnchor(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
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
}

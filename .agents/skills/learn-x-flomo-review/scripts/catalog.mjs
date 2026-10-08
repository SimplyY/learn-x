import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateSourceStatusDocument } from "../../learn-x-input/scripts/lib/source-status.mjs";
import { flomoTags, learnXGeneratedReason } from "../../learn-x-input/scripts/lib/flomo-filter.mjs";

const ROOTS = ["03_input/weekly", "03_input/weekly-history", "03_input/monthly", "03_input/yearly"];
const IDENTITY_BACKFILL_FILE = "03_input/_archives/flomo/identity-backfill.json";
const SOURCE_LINE = /^[-*]?\s*(?:来源|Source|链接|URL)\s*[：:]\s*(.+)$/i;
const DATE_HEADING = /^(#{2,3})\s+(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?\s*$/;
const TIME_HEADING = /^###\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:?\d{2}))?\s*$/;

function flomoSourceMemoId(value) {
  const source = String(value || "").trim();
  const markdown = source.match(/^\[[^\]\r\n]*\]\((https?:\/\/[^()\s]+)\)$/);
  const angle = source.match(/^<(https?:\/\/[^<>\s]+)>$/);
  const bare = source.match(/^(https?:\/\/\S+)$/);
  const candidate = markdown?.[1] || angle?.[1] || bare?.[1];
  if (!candidate) return null;
  let parsed;
  try { parsed = new URL(candidate); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "v.flomoapp.com" || parsed.username || parsed.password || parsed.port || parsed.hash || parsed.pathname.replace(/\/$/, "") !== "/mine") return null;
  const ids = parsed.searchParams.getAll("memo_id");
  return ids.length === 1 && ids[0].trim() ? ids[0] : null;
}

export function normalizeBody(body) {
  return String(body).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function bodyHash(body) {
  return createHash("sha256").update(normalizeBody(body)).digest("hex");
}
export const hashBody = bodyHash;

function parseTime(date, time, zone = "+08:00") {
  const d = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const t = time?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!d || !t) return null;
  const [, year, month, day] = d.map(Number);
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  const second = Number(t[3] || 0);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return null;
  const z = zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${z}`;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function exclusionReason(body) {
  const generated = learnXGeneratedReason(body);
  if (generated) return generated;
  const tags = flomoTags(body);
  if (tags.some((tag) => ["不回顾", "不洞察", "ai洞察"].includes(tag) || tag.endsWith("/ai洞察"))) return "excluded-tag";
  if (!body.trim()) return "empty-body";
  if (/^(?:TODO|待补充|暂无内容|占位|内容为空|（该笔记无可提取文字）)\s*$/i.test(body.trim())) return "placeholder-body";
  return null;
}

function parseArchive(markdown, filePath) {
  const memos = [];
  let current = null;
  let date = null;
  const flush = () => {
    if (!current) return;
    const lines = [...current.lines];
    while (lines.length && (!lines[0].trim() || lines[0].trim() === "---")) lines.shift();
    while (lines.length && (!lines.at(-1).trim() || lines.at(-1).trim() === "---")) lines.pop();
    let url = null;
    let memoId = null;
    // Consume only a complete, recognized Flomo identity URL; source-like prose is memo text.
    while (lines.length) {
      if (!lines[0].trim()) { lines.shift(); continue; }
      const source = lines[0].match(SOURCE_LINE);
      if (!source) break;
      const id = flomoSourceMemoId(source[1]);
      if (!id) break;
      if (memoId && memoId !== id) current.identityConflict = true;
      memoId = id;
      url = `https://v.flomoapp.com/mine/?memo_id=${encodeURIComponent(id)}`;
      lines.shift();
    }
    const body = normalizeBody(lines.join("\n"));
    if (current.dayHeading && !body && !memoId) { current = null; return; }
    memos.push({ createdAt: current.createdAt, body, bodyHash: bodyHash(body), memoId, source: { path: filePath, line: current.line, url }, reason: current.identityConflict ? "source-id-conflict" : !current.createdAt ? "invalid-created-at" : exclusionReason(body) });
    current = null;
  };
  for (const [index, line] of markdown.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const heading = line.match(DATE_HEADING);
    const sub = line.match(TIME_HEADING);
    // A dated H3 inside a dated H2 memo is original text, not another memo.
    if (heading && !(heading[1] === "###" && current?.level === 2 && !current.dayHeading)) {
      flush();
      date = heading[2];
      current = { createdAt: heading[3] ? parseTime(date, heading[3], heading[4]) : null, dayHeading: !heading[3], line: index + 1, level: heading[1].length, lines: [] };
      continue;
    }
    if (sub && date && (!current || current.level === 3 || current.dayHeading)) {
      flush();
      current = { createdAt: parseTime(date, sub[1], sub[2]), line: index + 1, level: 3, lines: [] };
      continue;
    }
    if (/^#{2,3}\s+\d{4}-\d/.test(line) && !heading && !(current?.level === 2 && line.startsWith("###"))) {
      flush();
      current = { createdAt: null, line: index + 1, level: line.startsWith("###") ? 3 : 2, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else if (/^#{1,3}\s+/.test(line)) date = null;
  }
  flush();
  return memos;
}

async function archiveFiles(repoRoot) {
  const found = [];
  async function walk(relative, optional = false) {
    let entries;
    try { entries = await readdir(path.join(repoRoot, relative), { withFileTypes: true }); }
    catch (error) { if (optional && error.code === "ENOENT") return; throw new Error(`archive-directory-read-failed:${relative}`, { cause: error }); }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name.startsWith(".") || entry.name.startsWith("00_") || entry.name.startsWith("_")) continue;
      const item = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`archive-symlink-not-supported:${item}`);
      if (entry.isDirectory()) await walk(item);
      else if (entry.isFile() && entry.name === "flomo.md") found.push(item);
    }
  }
  for (const root of ROOTS) await walk(root, true);
  return found.sort();
}

async function statusFor(repoRoot, relative) {
  let raw;
  try { raw = await readFile(path.join(repoRoot, path.dirname(relative), "_source-status.json"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error(`source-status-read-failed:${relative}`, { cause: error }); }
  let document;
  try {
    const parsed = JSON.parse(raw);
    const folderWeek = path.basename(path.dirname(relative));
    document = validateSourceStatusDocument(parsed, /^\d{4}-W\d{2}$/.test(folderWeek) ? folderWeek : parsed.week);
  } catch (error) { throw new Error(`source-status-invalid:${relative}`, { cause: error }); }
  if (!document.sources.flomo) return { status: "unverified", count: 0, week: document.week };
  return { ...document.sources.flomo, week: document.week };
}

function completeEvidence(markdown, status, records) {
  const prefix = markdown.split(/\r?\n/);
  const firstRecord = prefix.findIndex((line) => DATE_HEADING.test(line));
  const header = prefix.slice(0, firstRecord < 0 ? prefix.length : firstRecord).filter((line) => /^[-*]\s/.test(line)).join("\n");
  const evidence = `${header}\n${status.summary}`;
  if (!/下界已覆盖\s*[：:]\s*是/.test(evidence)) return false;
  if (!/(?:目标范围|采集范围|完整扫描|完整.*范围)/.test(evidence)) return false;
  if (!/(?:采集时间|扫描完成|完整扫描)/.test(evidence)) return false;
  if (status.count !== records.length || records.length === 0) return false;
  const countMatch = header.match(/(?:记录数|目标周记录)\s*[：:]\s*(\d+)/);
  if (!countMatch || Number(countMatch[1]) !== records.length) return false;
  const year = Number(status.week.slice(0, 4));
  const week = Number(status.week.slice(-2));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000 + (week - 1) * 7 * 86400000 - 8 * 3600000;
  if (records.some((memo) => !memo.createdAt || Date.parse(memo.createdAt) < monday || Date.parse(memo.createdAt) >= monday + 7 * 86400000)) return false;
  // Full exclusive boundaries prevent a current-week partial snapshot being trusted.
  return evidence.split("\n").some((line) => {
    if (!/(?:目标范围|采集范围|完整扫描)/.test(line)) return false;
    const boundaries = [...line.matchAll(/(\d{4}-\d{1,2}-\d{1,2})[T\s]+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:?\d{2}))?/g)].map((match) => Date.parse(parseTime(match[1], match[2], match[3])));
    return boundaries.length >= 2 && boundaries[0] === monday && boundaries[1] === monday + 7 * 86400000;
  });
}

function sameTime(a, b) { return Date.parse(a) === Date.parse(b); }

function identitySignature(timeMs, bodyHash) { return `${timeMs}:${bodyHash}`; }

async function identityBackfill(repoRoot) {
  let raw;
  try { raw = JSON.parse(await readFile(path.join(repoRoot, IDENTITY_BACKFILL_FILE), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (raw?.schemaVersion !== 1 || raw.complete !== true || raw.lowerBoundCovered !== true || !Array.isArray(raw.identities)) throw new Error("identity-backfill-invalid");
  const map = new Map();
  for (const item of raw.identities) {
    if (!item?.memoId || !Number.isInteger(item.timeMs) || !/^[0-9a-f]{64}$/.test(item.bodyHash || "")) throw new Error("identity-backfill-invalid");
    const signature = identitySignature(item.timeMs, item.bodyHash);
    const list = map.get(signature) || [];
    list.push(item);
    map.set(signature, list);
  }
  return map;
}
function uniqueSources(sources) {
  return [...new Map(sources.map((source) => [`${source.path}:${source.line}`, source])).values()].sort((a, b) => a.path.localeCompare(b.path, "en") || a.line - b.line);
}
function localKey(memo) { return `local:${bodyHash(`${new Date(memo.createdAt).toISOString()}\n${memo.body}`)}`; }
function realKey(memo) { return memo.memoId ? `flomo:${memo.memoId}` : localKey(memo); }
function previousQuality(previous, memo) {
  const q = previous?.quality;
  return q && q.bodyHash === memo.bodyHash && q.policyVersion === "1" && Number.isInteger(q.score) && q.score >= 0 && q.score <= 4 && typeof q.summary === "string" && typeof q.reason === "string" ? { ...q } : null;
}

/** Reads archive files only; callers own persistence and semantic quality assessment. */
export async function scanArchive(repoRoot, { previous } = {}) {
  if (previous && (previous.schemaVersion !== 1 || !Array.isArray(previous.notes))) throw new Error("previous-catalog-invalid");
  const activeOldKeys = new Set((previous?.notes || []).map((note) => note.noteKey));
  const quarantinedOldKeys = new Set((previous?.excluded || []).map((entry) => entry.previousNote?.noteKey).filter((key) => key && !activeOldKeys.has(key)));
  const old = [...new Map([...(previous?.notes || []), ...(previous?.excluded || []).map((entry) => entry.previousNote).filter(Boolean)].map((note) => [note.noteKey, note])).values()];
  if (old.some((note) => typeof note.noteKey !== "string" || !note.noteKey || typeof note.groupKey !== "string" || !note.groupKey || typeof note.body !== "string" || bodyHash(note.body) !== note.bodyHash || !Number.isFinite(Date.parse(note.createdAt)) || !Array.isArray(note.aliases) || note.aliases.some((alias) => typeof alias !== "string") || (note.groupAliases && !Array.isArray(note.groupAliases)) || !note.source?.path || !Number.isInteger(note.source.line))) throw new Error("previous-catalog-invalid");
  const sources = [];
  const excluded = [];
  const records = [];
  const backfill = await identityBackfill(repoRoot);
  for (const file of await archiveFiles(repoRoot)) {
    const status = await statusFor(repoRoot, file);
    if (status && status.status !== "ready") {
      sources.push({ path: file, status: status.status, records: status.count, included: 0, completeEvidence: false });
      excluded.push({ source: { path: file, line: 1, url: null }, reason: `source-${status.status}`, count: status.count });
      continue; // A known stale source is never opened.
    }
    let markdown;
    try { markdown = await readFile(path.join(repoRoot, file), "utf8"); }
    catch (error) { throw new Error(`archive-file-read-failed:${file}`, { cause: error }); }
    const parsed = parseArchive(markdown, file);
    const complete = status ? completeEvidence(markdown, status, parsed) : false;
    const source = { path: file, status: status ? "ready" : "legacy", fileHash: createHash("sha256").update(markdown).digest("hex"), records: parsed.length, included: 0, completeEvidence: complete, updatedAt: status?.updatedAt || null };
    sources.push(source);
    if (status && !complete) {
      excluded.push({ source: { path: file, line: 1, url: null }, reason: "source-integrity-unverified", count: parsed.length });
      continue;
    }
    for (const memo of parsed) {
      if (memo.reason) excluded.push({ source: memo.source, memoId: memo.memoId, reason: memo.reason, count: 1 });
      else {
        if (!memo.memoId && backfill) {
          const matches = backfill.get(identitySignature(Date.parse(memo.createdAt), memo.bodyHash)) || [];
          if (matches.length === 1) {
            memo.memoId = matches[0].memoId;
            memo.source.url = `https://v.flomoapp.com/mine/?memo_id=${encodeURIComponent(memo.memoId)}`;
          }
        }
        records.push(memo);
        source.included += 1;
      }
    }
  }

  // Conflicting current versions of one real identity are quarantined together.
  const byId = new Map();
  for (const record of records) if (record.memoId) {
    const list = byId.get(record.memoId) || [];
    list.push(record); byId.set(record.memoId, list);
  }
  const blocked = new Set();
  for (const list of byId.values()) if (new Set(list.map((memo) => `${Date.parse(memo.createdAt)}:${memo.bodyHash}`)).size > 1) {
    for (const memo of list) { blocked.add(memo); excluded.push({ source: memo.source, memoId: memo.memoId, reason: "memo-id-conflict", count: 1 }); }
  }
  const available = records.filter((memo) => !blocked.has(memo));
  const notes = [];
  const usedOld = new Set();
  const usedCurrent = new Set();
  // Real identities first so a legacy copy can become an alias of an identified memo.
  for (const memo of [...available].sort((a, b) => Number(Boolean(b.memoId)) - Number(Boolean(a.memoId)) || a.source.path.localeCompare(b.source.path, "en") || a.source.line - b.source.line)) {
    if (usedCurrent.has(memo)) continue;
    const sameId = memo.memoId ? available.filter((item) => item.memoId === memo.memoId) : [];
    const exactLegacy = available.filter((item) => !item.memoId && sameTime(item.createdAt, memo.createdAt) && item.bodyHash === memo.bodyHash);
    const twinsWithIds = available.filter((item) => item.memoId && sameTime(item.createdAt, memo.createdAt) && item.bodyHash === memo.bodyHash);
    if (!memo.memoId && twinsWithIds.length > 1) { excluded.push({ source: memo.source, reason: "ambiguous-legacy-identity", count: 1 }); usedCurrent.add(memo); continue; }
    const previousById = memo.memoId ? old.filter((item) => item.memoId === memo.memoId || item.aliases.includes(`flomo:${memo.memoId}`)) : [];
    const previousLegacy = twinsWithIds.length <= 1 ? old.filter((item) => !item.memoId && sameTime(item.createdAt, memo.createdAt) && item.bodyHash === memo.bodyHash) : [];
    const matches = [...new Set([...previousById, ...previousLegacy])];
    if (previousById.length > 1 || (previousById[0] && !sameTime(previousById[0].createdAt, memo.createdAt))) {
      for (const item of [...sameId, ...exactLegacy, memo]) { usedCurrent.add(item); excluded.push({ source: item.source, reason: "previous-identity-conflict", count: 1 }); }
      continue;
    }
    if (!memo.memoId && old.some((item) => !item.memoId && sameTime(item.createdAt, memo.createdAt) && item.bodyHash !== memo.bodyHash && [item.source, ...(item.sources || [])].some((source) => source?.path === memo.source.path))) {
      usedCurrent.add(memo); excluded.push({ source: memo.source, reason: "ambiguous-legacy-edit", count: 1 }); continue;
    }
    if (!memo.memoId && available.some((item) => item !== memo && !item.memoId && sameTime(item.createdAt, memo.createdAt) && item.bodyHash !== memo.bodyHash && item.source.path === memo.source.path)) {
      usedCurrent.add(memo); excluded.push({ source: memo.source, reason: "ambiguous-legacy-identity", count: 1 }); continue;
    }
    const copies = [...new Set([memo, ...sameId, ...(twinsWithIds.length <= 1 ? exactLegacy : [])])];
    for (const item of copies) usedCurrent.add(item);
    const prior = previousById[0] || matches.sort((a, b) => a.noteKey.localeCompare(b.noteKey, "en"))[0];
    for (const match of matches) usedOld.add(match);
    const origins = uniqueSources(copies.map((item) => item.source));
    const noteKey = prior?.noteKey || realKey(memo);
    const aliases = [...new Set([noteKey, ...copies.map(realKey), ...matches.flatMap((item) => [item.noteKey, ...item.aliases])])].sort();
    notes.push({ noteKey, memoId: memo.memoId || null, aliases, groupKey: prior?.groupKey || `content:${memo.bodyHash}`, groupAliases: [...new Set(matches.flatMap((item) => [item.groupKey, ...(item.groupAliases || [])]))].sort(), createdAt: memo.createdAt, body: memo.body, bodyHash: memo.bodyHash, source: origins[0], sources: origins, quality: quarantinedOldKeys.has(prior?.noteKey) ? null : previousQuality(prior, memo) });
  }
  // Identical bodies always share exposure, including distinct real memo IDs.
  const groups = new Map();
  for (const note of notes) { const group = groups.get(note.bodyHash) || []; group.push(note); groups.set(note.bodyHash, group); }
  for (const group of groups.values()) {
    const aliases = [...new Set(group.flatMap((note) => [note.groupKey, ...note.groupAliases]))].sort();
    const canonical = group.find((note) => old.some((item) => item.noteKey === note.noteKey))?.groupKey || aliases[0];
    for (const note of group) { note.groupKey = canonical; note.groupAliases = aliases.filter((alias) => alias !== canonical); }
  }
  // Quarantine keeps prior identity available for a future verified recovery.
  for (const prior of old) if (!usedOld.has(prior) && !notes.some((note) => note.noteKey === prior.noteKey || note.aliases.includes(prior.noteKey))) excluded.push({ source: prior.source, noteKey: prior.noteKey, previousNote: prior, reason: "previous-note-not-currently-verified", count: 1 });
  notes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.noteKey.localeCompare(b.noteKey, "en"));
  const dates = notes.map((note) => Date.parse(note.createdAt));
  return { schemaVersion: 1, notes, excluded, sources, coverage: { archiveSnapshot: true, remoteFullCoverage: false, totalFiles: sources.length, parsedRecords: sources.filter((source) => source.status === "legacy" || source.status === "ready").reduce((sum, source) => sum + source.records, 0), noteCount: notes.length, legacyFiles: sources.filter((source) => source.status === "legacy").length, unverifiedFiles: sources.filter((source) => source.status !== "legacy" && !source.completeEvidence).length, excludedCount: excluded.reduce((sum, entry) => sum + entry.count, 0), identityConflicts: excluded.filter((entry) => /identity|conflict|ambiguous/.test(entry.reason)).length, firstCreatedAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null, lastCreatedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null } };
}

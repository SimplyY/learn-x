#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile, unlink, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateAnchor, expectedJournalDates, hasExpectedJournalDate } from "../../learn-x-input/scripts/collect-weekly-journal.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const JOURNAL = "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac";
const PLACEHOLDER = "Core 复盘入口（待链接）";
const LABEL = "进入本周 Core 复盘";
const ID = /^[A-Za-z0-9_-]{6,}$/;

async function lark(args) {
  const { stdout } = await exec("lark-cli", [...args, "--format", "json"], { timeout: 60000, maxBuffer: 12 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function section(response, documentId, headingId, week) {
  const doc = response?.data?.document;
  if (response?.ok !== true || response.identity !== "bot" || doc?.document_id !== documentId || typeof doc.content !== "string") throw new Error("journal-readback-invalid");
  const heading = doc.content.match(new RegExp(`<h2\\b[^>]*\\bid="${headingId}"[^>]*>([\\s\\S]*?)</h2>`));
  if (!doc.content.includes(`requested-start="${headingId}"`) || !heading || !hasExpectedJournalDate(heading[1].replace(/<[^>]*>/g, ""), expectedJournalDates(week).shortTitle)) throw new Error("journal-heading-mismatch");
  return doc;
}

/** Replaces only a reserved placeholder in the already anchored weekly section. */
export async function linkCore({ anchor, binding, week, slotId, fetchSection, fetchCore, update, journalUrl = JOURNAL,
  loadIntent = async () => null, saveIntent = async () => {}, clearIntent = async () => {}, persistVerification = async () => {} }) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week) || anchor?.schemaVersion !== 1 || anchor.week !== week || anchor.documentUrl !== journalUrl || binding?.week !== week) throw new Error("week-or-anchor-invalid");
  validateAnchor(anchor, week, journalUrl);
  if (![anchor.documentId, anchor.targetBlockId, binding.docId, slotId].every(id => ID.test(String(id || "")))) throw new Error("identity-invalid");
  if (!["skeleton", "prepared", "adopted-readonly"].includes(binding.stage)) throw new Error("core-not-verified");
  const core = await fetchCore(binding.docId);
  if (core?.ok !== true || core.identity !== "bot" || core?.data?.document?.document_id !== binding.docId) throw new Error("core-readback-invalid");
  const url = `https://ywhome.feishu.cn/docx/${binding.docId}`;
  const before = section(await fetchSection(anchor.targetBlockId), anchor.documentId, anchor.targetBlockId, week);
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(`<p\\b[^>]*>\\s*<a\\b[^>]*href="${escapedUrl}"[^>]*>${LABEL}</a>\\s*</p>`, "g");
  const links = [...before.content.matchAll(linkPattern)];
  const hash = text => createHash("sha256").update(text).digest("hex");
  const intent = await loadIntent();
  if (intent && (intent.week !== week || intent.documentId !== anchor.documentId || intent.headingId !== anchor.targetBlockId || intent.slotId !== slotId || intent.url !== url || !/^[a-f0-9]{64}$/.test(intent.outsideHash || ""))) throw new Error("link-intent-conflict");
  if (links.length === 1 && !before.content.includes(PLACEHOLDER)) {
    const heading = before.content.match(new RegExp(`<h2\\b[^>]*\\bid="${anchor.targetBlockId}"[^>]*>[\\s\\S]*?</h2>`));
    if (!heading || before.content.slice(heading.index + heading[0].length, links[0].index).trim() !== "") throw new Error("link-not-after-heading");
    if (intent) await clearIntent();
    await persistVerification({ week, documentId: binding.docId, url, journalDocumentId: anchor.documentId, headingId: anchor.targetBlockId, revisionId: before.revision_id ?? null });
    return { result: intent ? "recovered" : "reused", week, url };
  }
  if (links.length || before.content.split(PLACEHOLDER).length !== 2) throw new Error("link-or-placeholder-ambiguous");
  const placeholder = `<p id="${slotId}">${PLACEHOLDER}</p>`;
  if (!before.content.includes(placeholder) || before.content.indexOf(placeholder) !== before.content.lastIndexOf(placeholder)) throw new Error("reserved-slot-not-unchanged");
  const immediateSlot = new RegExp(`<h2\\b[^>]*\\bid="${anchor.targetBlockId}"[^>]*>[^<]*</h2>\\s*<p id="${slotId}">${PLACEHOLDER}</p>`);
  if (!immediateSlot.test(before.content)) throw new Error("reserved-slot-not-after-heading");
  const replacement = `<p><a href="${url}">${LABEL}</a></p>`;
  const beforeOutside = before.content.replace(placeholder, "<CORE_LINK_SLOT/>");
  // Replacing the same uniquely re-read placeholder is content-idempotent: a
  // delayed prior request can only replace this same slot with the same link.
  // A changed slot or ambiguous link fails closed before this retry.
  if (!intent) await saveIntent({ week, documentId: anchor.documentId, headingId: anchor.targetBlockId, slotId, url, outsideHash: hash(beforeOutside) });
  try { await update({ slotId, replacement, revisionId: before.revision_id }); } catch { /* result uncertain: read back before any further action */ }
  const after = section(await fetchSection(anchor.targetBlockId), anchor.documentId, anchor.targetBlockId, week);
  const afterLinks = [...after.content.matchAll(linkPattern)];
  if (afterLinks.length !== 1 || after.content.includes(PLACEHOLDER)) throw new Error("link-write-unknown");
  const afterOutside = after.content.replace(afterLinks[0][0], "<CORE_LINK_SLOT/>");
  if (beforeOutside !== afterOutside) throw new Error("journal-readback-conflict");
  await clearIntent();
  await persistVerification({ week, documentId: binding.docId, url, journalDocumentId: anchor.documentId, headingId: anchor.targetBlockId, revisionId: after.revision_id ?? null });
  return { result: intent ? "recovered" : "written", week, url, revisionId: after.revision_id ?? null };
}

const RANGE_LABEL = week => `进入 ${week} Core 复盘`;

function validatePeriod(periodId, weeks) {
  if (!Array.isArray(weeks) || weeks.length < 1 || weeks.length > 4) throw new Error("period-weeks-invalid");
  const normalized = weeks.map(value => {
    if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value)) throw new Error("period-week-invalid");
    return value;
  });
  for (let index = 1; index < normalized.length; index += 1) {
    if (nextIsoWeek(normalized[index - 1]) !== normalized[index]) throw new Error("period-weeks-not-contiguous");
  }
  const expectedId = normalized.length === 1 ? normalized[0]
    : normalized[0].slice(0, 4) === normalized.at(-1).slice(0, 4)
      ? `${normalized[0]}-${normalized.at(-1).slice(5)}`
      : `${normalized[0]}-${normalized.at(-1)}`;
  if (periodId !== expectedId) throw new Error("period-id-mismatch");
  return normalized;
}

function nextIsoWeek(week) {
  const [year, number] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (number - 1) * 7 + 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstJan4 = new Date(Date.UTC(isoYear, 0, 4));
  const firstMonday = new Date(firstJan4);
  firstMonday.setUTCDate(firstJan4.getUTCDate() - ((firstJan4.getUTCDay() || 7) - 1));
  const isoNumber = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-W${String(isoNumber).padStart(2, "0")}`;
}

function rangeSection(response, documentId, anchor) {
  const doc = response?.data?.document;
  if (response?.ok !== true || response.identity !== "bot" || doc?.document_id !== documentId || typeof doc.content !== "string") throw new Error("journal-readback-invalid");
  const heading = doc.content.match(new RegExp(`<h2\\b[^>]*\\bid="${anchor.targetBlockId}"[^>]*>[\\s\\S]*?</h2>`));
  const title = heading?.[0].replace(/<[^>]*>/g, "").replaceAll("&amp;", "&").trim() || "";
  const [year, month, day] = String(anchor.writeDate || "").split("-").map(Number);
  const expectedDate = `${month}.${day}`;
  if (!doc.content.includes(`requested-start="${anchor.targetBlockId}"`) || !heading
    || !title.includes(anchor.weeks[0]) || !title.includes(anchor.weeks.at(-1).slice(5)) || !title.includes(expectedDate)) throw new Error("journal-range-heading-mismatch");
  return doc;
}

function linkParagraph(content, url, label) {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`<p\\b[^>]*>\\s*<a\\b[^>]*href="${escapedUrl}"[^>]*>${escapedLabel}</a>\\s*</p>`));
  return match?.[0] ?? null;
}

function linkCount(content, url) {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...content.matchAll(new RegExp(`href="${escapedUrl}"`, "g"))].length;
}

function rangeLinkParagraphs(content, links) {
  const paragraphs = [];
  let cursor = content.indexOf("</h2>") + "</h2>".length;
  for (const item of links) {
    const rest = content.slice(cursor);
    const node = rest.match(/^\s*(<p\b[^>]*>[\s\S]*?<\/p>)/)?.[1];
    const expected = node && linkParagraph(node, item.url, item.label);
    if (!expected) return null;
    paragraphs.push(expected);
    cursor += rest.indexOf(node) + node.length;
  }
  return { paragraphs, outside: content.slice(0, content.indexOf("</h2>") + "</h2>".length)
    + content.slice(cursor) };
}

/** Add one direct link per week to a single confirmed range-journal heading. */
export async function linkCoreRange({ periodId, anchor, bindings, fetchSection, fetchCore, update, journalUrl = JOURNAL,
  loadIntent = async () => null, saveIntent = async () => {}, clearIntent = async () => {}, persistVerification = async () => {} }) {
  const weeks = validatePeriod(periodId, anchor?.weeks);
  if (anchor?.schemaVersion !== 1 || anchor.periodId !== periodId || anchor.documentUrl !== journalUrl
    || !ID.test(String(anchor.documentId || "")) || !ID.test(String(anchor.targetBlockId || ""))
    || !/^\d{4}-\d{2}-\d{2}$/.test(anchor.writeDate || "")) throw new Error("range-anchor-invalid");
  if (!Array.isArray(bindings) || bindings.length !== weeks.length) throw new Error("range-core-bindings-invalid");

  const links = [];
  for (const week of weeks) {
    const binding = bindings.find(item => item?.week === week);
    if (!binding || !ID.test(String(binding.docId || "")) || !["skeleton", "prepared", "adopted-readonly"].includes(binding.stage)) throw new Error(`core-binding-invalid:${week}`);
    const core = await fetchCore(binding.docId);
    if (core?.ok !== true || core.identity !== "bot" || core?.data?.document?.document_id !== binding.docId) throw new Error(`core-readback-invalid:${week}`);
    links.push({ week, docId: binding.docId, url: `https://ywhome.feishu.cn/docx/${binding.docId}`, label: RANGE_LABEL(week) });
  }

  const beforeDoc = rangeSection(await fetchSection(anchor.targetBlockId), anchor.documentId, { ...anchor, periodId });
  const before = beforeDoc.content;
  const headingMatch = before.match(new RegExp(`<h2\\b[^>]*\\bid="${anchor.targetBlockId}"[^>]*>[\\s\\S]*?</h2>`));
  const found = links.map(item => linkParagraph(before, item.url, item.label));
  if (links.some(item => linkCount(before, item.url) > 1)) throw new Error("range-link-duplicate");
  const intent = await loadIntent();
  const hash = text => createHash("sha256").update(text).digest("hex");
  if (intent && (intent.periodId !== periodId || intent.documentId !== anchor.documentId || intent.headingId !== anchor.targetBlockId
    || JSON.stringify(intent.urls) !== JSON.stringify(links.map(item => item.url)) || !/^[a-f0-9]{64}$/.test(intent.outsideHash || ""))) throw new Error("range-link-intent-conflict");

  const exact = rangeLinkParagraphs(before, links);
  if (found.every(Boolean)) {
    if (!exact) throw new Error("range-links-not-after-heading");
    if (intent && hash(exact.outside) !== intent.outsideHash) throw new Error("range-link-readback-conflict");
    if (intent) await clearIntent();
    const result = intent ? "recovered" : "reused";
    await persistVerification({ periodId, documentId: anchor.documentId, headingId: anchor.targetBlockId, revisionId: beforeDoc.revision_id ?? null,
      links: links.map(({ week, docId, url }) => ({ week, documentId: docId, url, status: "verified" })) });
    return { result, periodId, revisionId: beforeDoc.revision_id ?? null, links: links.map(({ week, url }) => ({ week, url })) };
  }
  if (found.some(Boolean) || !headingMatch) throw new Error("range-links-partial-or-ambiguous");
  if (intent) throw new Error("range-link-write-unknown");

  const outsideHash = hash(before);
  await saveIntent({ periodId, documentId: anchor.documentId, headingId: anchor.targetBlockId, urls: links.map(item => item.url), outsideHash });
  const content = links.map(item => `<p><a href="${item.url}">${item.label}</a></p>`).join("");
  try { await update({ headingId: anchor.targetBlockId, content, revisionId: beforeDoc.revision_id ?? -1 }); } catch { /* Read back once; never blindly retry an uncertain insert. */ }
  const afterDoc = rangeSection(await fetchSection(anchor.targetBlockId), anchor.documentId, { ...anchor, periodId });
  const after = afterDoc.content;
  const afterFound = links.map(item => linkParagraph(after, item.url, item.label));
  const afterExact = rangeLinkParagraphs(after, links);
  if (!afterFound.every(Boolean) || !afterExact) throw new Error("range-link-write-unknown");
  if (hash(afterExact.outside) !== outsideHash) throw new Error("range-link-readback-conflict");
  await clearIntent();
  await persistVerification({ periodId, documentId: anchor.documentId, headingId: anchor.targetBlockId, revisionId: afterDoc.revision_id ?? null,
    links: links.map(({ week, docId, url }) => ({ week, documentId: docId, url, status: "verified" })) });
  return { result: "written", periodId, revisionId: afterDoc.revision_id ?? null, links: links.map(({ week, url }) => ({ week, url })) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const equal = token.indexOf("=");
    if (equal > 0) args[token.slice(2, equal)] = token.slice(equal + 1);
    else { args[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  const { week, "slot-id": slotId } = args;
  const periodId = args.period;
  if (periodId) {
    const directory = path.join(ROOT, "03_input/weekly", periodId);
    const anchorPath = path.join(directory, "_weekly-journal-anchor.json");
    const manifestPath = path.join(directory, "_range-manifest.json");
    const anchor = JSON.parse(await readFile(anchorPath, "utf8"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const weeks = validatePeriod(periodId, manifest.period?.weeks);
    if (manifest.period?.id !== periodId || manifest.journal?.documentId !== anchor.documentId
      || manifest.journal?.targetBlockId !== anchor.targetBlockId || JSON.stringify(anchor.weeks) !== JSON.stringify(weeks)) {
      throw new Error("range-journal-binding-invalid");
    }
    const bindings = await Promise.all(weeks.map(async value => JSON.parse(await readFile(path.join("/Users/yuwei/code/core/runtime/weekly-review", value, "binding.json"), "utf8"))));
    const fetchSection = block => lark(["docs", "+fetch", "--as", "bot", "--doc", JOURNAL, "--scope", "section", "--start-block-id", block, "--detail", "full", "--doc-format", "xml"]);
    const fetchCore = id => lark(["docs", "+fetch", "--as", "bot", "--doc", id, "--scope", "outline", "--max-depth", "1", "--detail", "with-ids"]);
    const update = ({ headingId, content, revisionId }) => lark(["docs", "+update", "--as", "bot", "--doc", JOURNAL, "--command", "block_insert_after", "--block-id", headingId, "--content", content, "--doc-format", "xml", "--revision-id", String(revisionId ?? -1)]);
    const intentPath = path.join(directory, "_core-link-intent.json");
    const loadIntent = async () => { try { return JSON.parse(await readFile(intentPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
    const saveIntent = intent => writeFile(intentPath, `${JSON.stringify(intent)}\n`, { flag: "wx", mode: 0o600 });
    const clearIntent = () => unlink(intentPath);
    const persistVerification = async receipt => {
      const coreLinks = receipt.links.map(item => ({ ...item, verifiedAt: new Date().toISOString(), journalRevisionId: receipt.revisionId }));
      const nextAnchor = { ...anchor, coreLinks, coreLinksVerifiedAt: new Date().toISOString(), revisionId: manifest.journal?.revisionId ?? anchor.revisionId };
      const nextManifest = { ...manifest, core: { ...(manifest.core || {}), status: "links-verified", links: coreLinks, verifiedAt: nextAnchor.coreLinksVerifiedAt, journalRevisionId: receipt.revisionId } };
      await atomicReplace(anchorPath, `${JSON.stringify(nextAnchor, null, 2)}\n`);
      await atomicReplace(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    };
    const result = await linkCoreRange({ periodId, anchor, bindings, fetchSection, fetchCore, update, loadIntent, saveIntent, clearIntent, persistVerification });
    console.log(JSON.stringify(result));
    return result;
  }
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week || "")) throw new Error("week-invalid");
  const anchor = JSON.parse(await readFile(path.join(ROOT, "03_input/weekly", week, "_weekly-journal-anchor.json"), "utf8"));
  const binding = JSON.parse(await readFile(path.join("/Users/yuwei/code/core/runtime/weekly-review", week, "binding.json"), "utf8"));
  const fetchSection = block => lark(["docs", "+fetch", "--as", "bot", "--doc", JOURNAL, "--scope", "section", "--start-block-id", block, "--detail", "full", "--doc-format", "xml"]);
  const fetchCore = id => lark(["docs", "+fetch", "--as", "bot", "--doc", id, "--scope", "outline", "--max-depth", "1", "--detail", "with-ids"]);
  const update = ({ slotId: id, replacement, revisionId }) => lark(["docs", "+update", "--as", "bot", "--doc", JOURNAL, "--command", "block_replace", "--block-id", id, "--content", replacement, "--doc-format", "xml", "--revision-id", String(revisionId ?? -1)]);
  const intentPath = path.join(ROOT, "03_input/weekly", week, "_core-link-intent.json");
  const loadIntent = async () => { try { return JSON.parse(await readFile(intentPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
  const saveIntent = intent => writeFile(intentPath, `${JSON.stringify(intent)}\n`, { flag: "wx", mode: 0o600 });
  const clearIntent = () => unlink(intentPath);
  const persistVerification = async receipt => {
    const current = JSON.parse(await readFile(path.join(ROOT, "03_input/weekly", week, "_weekly-journal-anchor.json"), "utf8"));
    if (current.week !== week || current.documentId !== receipt.journalDocumentId || current.targetBlockId !== receipt.headingId) throw new Error("journal-anchor-changed-during-link");
    const coreLink = { week, documentId: receipt.documentId, url: receipt.url, status: "verified", headingId: receipt.headingId, journalRevisionId: receipt.revisionId, verifiedAt: new Date().toISOString() };
    await atomicReplace(path.join(ROOT, "03_input/weekly", week, "_weekly-journal-anchor.json"), `${JSON.stringify({ ...current, coreLink }, null, 2)}\n`);
  };
  const result = await linkCore({ anchor, binding, week, slotId, fetchSection, fetchCore, update, loadIntent, saveIntent, clearIntent, persistVerification });
  console.log(JSON.stringify(result));
}

async function atomicReplace(target, content) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temporary, target); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });

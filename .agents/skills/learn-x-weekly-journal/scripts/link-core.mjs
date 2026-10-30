#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
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
export async function linkCore({ anchor, binding, week, slotId, fetchSection, fetchCore, update, loadIntent = async () => null, saveIntent = async () => {}, clearIntent = async () => {} }) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week) || anchor?.schemaVersion !== 1 || anchor.week !== week || anchor.documentUrl !== JOURNAL || binding?.week !== week) throw new Error("week-or-anchor-invalid");
  validateAnchor(anchor, week);
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
    if (intent && hash(before.content.replace(links[0][0], "<CORE_LINK_SLOT/>")) !== intent.outsideHash) throw new Error("journal-readback-conflict");
    if (intent) await clearIntent();
    return { result: intent ? "recovered" : "reused", week, url };
  }
  if (links.length || before.content.split(PLACEHOLDER).length !== 2) throw new Error("link-or-placeholder-ambiguous");
  const placeholder = `<p id="${slotId}">${PLACEHOLDER}</p>`;
  if (!before.content.includes(placeholder) || before.content.indexOf(placeholder) !== before.content.lastIndexOf(placeholder)) throw new Error("reserved-slot-not-unchanged");
  const immediateSlot = new RegExp(`<h2\\b[^>]*\\bid="${anchor.targetBlockId}"[^>]*>[^<]*</h2>\\s*<p id="${slotId}">${PLACEHOLDER}</p>`);
  if (!immediateSlot.test(before.content)) throw new Error("reserved-slot-not-after-heading");
  const replacement = `<p><a href="${url}">${LABEL}</a></p>`;
  const beforeOutside = before.content.replace(placeholder, "<CORE_LINK_SLOT/>");
  if (intent) {
    if (hash(beforeOutside) !== intent.outsideHash) throw new Error("journal-readback-conflict");
    // The prior request may still commit after this read. An unchanged slot is
    // not proof of non-submission and cannot authorize a second write.
    throw new Error("link-write-unknown");
  }
  await saveIntent({ week, documentId: anchor.documentId, headingId: anchor.targetBlockId, slotId, url, outsideHash: hash(beforeOutside) });
  try { await update({ slotId, replacement, revisionId: before.revision_id }); } catch { /* result uncertain: read back before any further action */ }
  const after = section(await fetchSection(anchor.targetBlockId), anchor.documentId, anchor.targetBlockId, week);
  const afterLinks = [...after.content.matchAll(linkPattern)];
  if (afterLinks.length !== 1 || after.content.includes(PLACEHOLDER)) throw new Error("link-write-unknown");
  const afterOutside = after.content.replace(afterLinks[0][0], "<CORE_LINK_SLOT/>");
  if (beforeOutside !== afterOutside) throw new Error("journal-readback-conflict");
  await clearIntent();
  return { result: "written", week, url, revisionId: after.revision_id ?? null };
}

export async function main(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(argv.reduce((out, v, i) => { if (v.startsWith("--")) out.push([v.slice(2), argv[i + 1]]); return out; }, []));
  const { week, "slot-id": slotId } = args;
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
  const result = await linkCore({ anchor, binding, week, slotId, fetchSection, fetchCore, update, loadIntent, saveIntent, clearIntent });
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });

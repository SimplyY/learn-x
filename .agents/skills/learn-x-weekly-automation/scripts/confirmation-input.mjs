// Construct reviewable Learn-X items only from the exact fingerprinted proposal.
// No writes to Memory, Feishu or any external service occur in this module.
import { readFile, lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { bindWeeklyMemoryApproval, verifyWeeklyMemoryApproval } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';
import { acquireWeeklyFileLock } from '../../learn-x-input/scripts/lib/source-status.mjs';

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

// Supported format: headings, blank lines, and top-level bullet items with
// indented continuations. Reject anything ambiguous instead of dropping text.
export function parseMemoryProposal(proposal) {
  if (typeof proposal !== 'string' || !proposal || proposal.includes('\r')) throw new Error('unsupported memory proposal');
  const lines = proposal.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const parts = [];
  let item = null;
  for (const line of lines) {
    if (/^[-*] /.test(line)) {
      item = { kind: 'item', text: line }; parts.push(item); continue;
    }
    if (/^\s*$/.test(line)) { parts.push({ kind: 'structure', text: line }); item = null; continue; }
    if (/^#{1,6}\s+/.test(line)) { parts.push({ kind: 'structure', text: line }); item = null; continue; }
    if (item && /^(?: {2,}|\t)/.test(line)) { item.text += line; continue; }
    throw new Error('ambiguous memory proposal format');
  }
  if (parts.map(part => part.text).join('') !== proposal) throw new Error('proposal mapping incomplete');
  return parts;
}

// Explicit closeout entries must enumerate concrete action and destination;
// their authority still comes exclusively from the later unified user consent.
export async function buildLearnXConfirmationInputs({ root, week, fingerprint, closeoutEntries }) {
  if (!root || !/^\d{4}-W\d{2}$/.test(week) || !/^[a-f0-9]{64}$/.test(fingerprint || '') || !Array.isArray(closeoutEntries)) throw new Error('invalid approval input');
  await verifyWeeklyMemoryApproval({ week, fingerprint, repoRoot: root });
  const dir = path.join(root, '04_output/_dist/weekly', week);
  const manifest = JSON.parse(await readFile(path.join(dir, '_memory-approval.json'), 'utf8'));
  const proposal = await readFile(path.join(dir, 'memory-proposed.md'), 'utf8');
  if (manifest.fingerprint !== fingerprint || manifest.hashes.proposal !== hash(proposal)) throw new Error('proposal fingerprint mismatch');
  const parts = parseMemoryProposal(proposal);
  let index = 0;
  const memoryItems = parts.filter(part => part.kind === 'item').map(part => {
    const id = `memory-${++index}`;
    part.id = id;
    return { id, domain: 'learn-x', source: 'human', locator: `${manifest.scope.memoryPath}#${week}/${id}`, originalValue: '', value: part.text, targets: ['memory'] };
  });
  const required = new Set(['image', 'backup', 'retention', 'ywnext', 'flomo']);
  const ids = new Set();
  const closeoutItems = closeoutEntries.map(entry => {
    if (!entry || !required.has(entry.id) || ids.has(entry.id) || typeof entry.action !== 'string' || !entry.action.trim() || typeof entry.destination !== 'string' || !entry.destination.trim()) throw new Error('invalid closeout entry');
    ids.add(entry.id);
    return { id: `closeout-${entry.id}`, domain: 'learn-x', source: 'human', locator: entry.destination, originalValue: '', value: entry.action, targets: ['weekly-closeout'] };
  });
  if (ids.size !== required.size) throw new Error('closeout scope incomplete');
  // Avoid approving actions to targets outside the existing bound scope.
  const allowed = manifest.scope;
  const find = id => closeoutEntries.find(e => e.id === id).destination;
  const flomo = closeoutEntries.find(e => e.id === 'flomo');
  if (find('image') !== allowed.imagePath || find('backup') !== allowed.backupDestination || find('retention') !== allowed.backupDestination || find('ywnext') !== allowed.ywnext || !Array.isArray(flomo.sources) || JSON.stringify(flomo.sources) !== JSON.stringify(allowed.flomo) || !/^Flomo\/.+/.test(flomo.destination)) throw new Error('closeout destination differs from bound scope');
  if (!allowed.backupRoots.every(root => closeoutEntries.find(e => e.id === 'backup').action.includes(root))) throw new Error('backup scope incomplete');
  closeoutItems.find(e => e.id === 'closeout-flomo').value += `；来源：${flomo.sources.join('、')}`;
  return { week, fingerprint, proposalHash: hash(proposal), parts, items: [...memoryItems, ...closeoutItems], scope: allowed };
}

// Rebuild exactly from approved per-item values; omitted IDs are excluded.
export function reconstructApprovedMemory({ parts, approved }) {
  if (!Array.isArray(parts) || !approved || typeof approved !== 'object' || Array.isArray(approved)) throw new Error('invalid approved entries');
  const ids = new Set(parts.filter(part => part.kind === 'item').map(part => part.id));
  if (Object.keys(approved).some(id => !ids.has(id) || typeof approved[id] !== 'string' || !/^[-*] /.test(approved[id]))) throw new Error('invalid approved memory item');
  return parts.map(part => part.kind === 'structure' ? part.text : Object.hasOwn(approved, part.id) ? approved[part.id] : '').join('');
}

// Edits/exclusions are staged before display and before approval. Rebind the
// existing Learn-X manifest to the exact resulting proposal; this is not user
// confirmation and performs no Memory or remote write.
export async function stageLearnXCard({ root, week, fingerprint, selectedIds, edits = {}, closeoutEntries }) {
  const dir = path.join(root, '04_output/_dist/weekly', week);
  const release = await acquireWeeklyFileLock(dir, '_unified-card.lock');
  try {
    const initial = await buildLearnXConfirmationInputs({ root, week, fingerprint, closeoutEntries });
    if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !initial.items.some(item => item.id === id)) || Object.keys(edits).some(id => !selectedIds.includes(id) || !initial.items.some(item => item.id === id && item.targets.includes('memory')))) throw new Error('invalid selected items');
    const memory = initial.items.filter(item => item.targets.includes('memory'));
    const approved = {};
    for (const item of memory) if (selectedIds.includes(item.id)) approved[item.id] = Object.hasOwn(edits, item.id) ? edits[item.id] : item.value;
    const nextProposal = reconstructApprovedMemory({ parts: initial.parts, approved });
    const parsedNext = parseMemoryProposal(nextProposal);
    if (parsedNext.filter(part => part.kind === 'item').length !== Object.keys(approved).length) throw new Error('edited memory mapping ambiguous');
    const file = path.join(dir, 'memory-proposed.md');
    if (!(await lstat(file)).isFile()) throw new Error('proposal must be a regular file');
    const current = await readFile(file, 'utf8');
    if (hash(current) !== initial.proposalHash) throw new Error('proposal changed during staging');
    let newFingerprint = fingerprint;
    if (nextProposal !== current) {
      const temp = `${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600); await handle.writeFile(nextProposal, 'utf8'); await handle.sync(); await handle.close(); handle = null;
        if (hash(await readFile(file, 'utf8')) !== initial.proposalHash) throw new Error('proposal changed during staging');
        await rename(temp, file);
      } finally { if (handle) await handle.close(); await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
      if (await readFile(file, 'utf8') !== nextProposal) throw new Error('proposal readback mismatch');
      newFingerprint = (await bindWeeklyMemoryApproval({ week, repoRoot: root })).fingerprint;
    }
    const next = await buildLearnXConfirmationInputs({ root, week, fingerprint: newFingerprint, closeoutEntries });
    const chosenCloseout = new Set(selectedIds.filter(id => id.startsWith('closeout-')));
    const finalItems = next.items.filter(item => item.targets.includes('memory') || chosenCloseout.has(item.id));
    const excludedItems = initial.items.filter(item => !selectedIds.includes(item.id)).map(item => ({ ...item, id: `excluded-${item.id}` }));
    return { ...next, items: finalItems, excludedItems, staged: nextProposal !== current };
  } finally { await release(); }
}

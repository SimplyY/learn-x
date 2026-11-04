// Preparation only. The actual confirmation must be read from the trusted
// conversation host; CLI arguments or local JSON are never approval evidence.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, unlink, readdir, lstat } from 'node:fs/promises';
import { stageLearnXCard } from './confirmation-input.mjs';
import { verifyConfirmedWeeklyMemoryWrite, verifyWeeklyMemoryApproval, verifyWeeklyMemoryApprovalSources } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultLearnXRoot = path.resolve(here, '../../../..');
const defaultCoreRoot = path.resolve(defaultLearnXRoot, '../core');

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonicalWeek = value => {
  const match = /^(\d{4})-W?(\d{2})$/.exec(value || '');
  return match ? `${match[1]}-W${match[2]}` : null;
};
const pendingPath = (coreRoot, week, fingerprint) => path.join(coreRoot, 'runtime/weekly-review', week, 'cards', 'pending', `${fingerprint}.json`);

async function writeImmutable(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const text = `${JSON.stringify(value)}\n`;
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null;
    try { await link(temp, file); } catch (error) { if (error.code !== 'EEXIST' || await readFile(file, 'utf8') !== text) throw error; }
    const dir = await open(path.dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } finally { if (handle) await handle.close(); await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  if (await readFile(file, 'utf8') !== text) throw new Error('pending card readback mismatch');
  return file;
}

async function loadPending({ coreRoot = defaultCoreRoot, stateRoot = coreRoot, week, fingerprint }) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week || '') || !/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('invalid pending card identity');
  const file = pendingPath(stateRoot, week, fingerprint);
  const value = JSON.parse(await readFile(file, 'utf8'));
  const { prepareConfirmationCard } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs')).href);
  const rebuilt = prepareConfirmationCard(value.unified?.card);
  if (value.schemaVersion !== 1 || value.week !== week || rebuilt.fingerprint !== fingerprint || value.unified.display !== renderDisplay(rebuilt, value.unified.excluded)) throw new Error('pending card invalid');
  return value.unified;
}

function renderDisplay(card, excluded) {
  const lines = [`最终确认｜${card.reviewWeek}`];
  for (const domain of ['learn-x', 'core']) {
    const group = card.items.filter(item => item.domain === domain);
    if (!group.length) continue;
    lines.push('', domain === 'learn-x' ? 'Learn-X' : 'Core');
    for (const item of group) {
      lines.push(`- ${item.id}｜${item.locator}｜${item.source === 'ai' ? 'AI 候选（本人选择）' : '本人内容'}`, `  内容：${JSON.stringify(item.value)}`, `  目标：${item.targets.join('、')}`);
      if (item.originalValue !== item.value) lines.push(`  原文：${JSON.stringify(item.originalValue)}`);
      for (const target of ['annual', 'overview']) if (item.targetBindings?.[target]) lines.push(`  ${target}：${item.targetBindings[target].documentId}｜${item.targetBindings[target].locator}`);
    }
  }
  if (excluded.length) { lines.push(''); for (const item of excluded) lines.push(`排除：${item.id}｜内容：${JSON.stringify(item.value)}｜目标：${item.targets.join('、')}`); }
  lines.push('', card.confirmationText);
  return lines.join('\n');
}

async function confirmedCoreItems({ coreRoot, stateRoot, week }) {
  const dir = path.join(stateRoot, 'runtime/weekly-review', week, 'confirmations');
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const { readConfirmedBatch } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs')).href);
  const confirmed = [];
  for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
    let batch;
    try { batch = await readConfirmedBatch(path.join(dir, entry.name)); }
    catch (error) { throw new Error(`Core confirmation history unreadable; refusing to repeat items: ${error.message}`); }
    if (batch.reviewWeek !== week) throw new Error('Core confirmation history week mismatch');
    for (const item of batch.items) if (item.domain === 'core') confirmed.push({ item, proposalSha256: batch.sourceBindings?.coreReview?.proposalSha256 ?? null });
  }
  return confirmed;
}

function coreItemHistoryKey(item) {
  const targets = ['annual', 'overview'].filter(target => item.targets.includes(target))
    .map(target => [target, item.targetBindings?.[target]?.documentId ?? '', item.targetBindings?.[target]?.locator ?? '']);
  return JSON.stringify([item.source, item.originalValue, [...item.targets].sort(), targets]);
}

function wasCoreItemAlreadyConfirmed(candidate, history, proposalSha256) {
  const sourceValue = candidate.sourceValue ?? candidate.value;
  const key = coreItemHistoryKey(candidate);
  return history.some(({ item, proposalSha256: previousProposalSha256 }) => {
    if (coreItemHistoryKey(item) !== key) return false;
    if (typeof item.sourceValue === 'string') return item.sourceValue === sourceValue;
    return item.value === sourceValue || (!!proposalSha256 && previousProposalSha256 === proposalSha256);
  });
}

export async function prepareUnifiedPreview({ learnXRoot = defaultLearnXRoot, coreRoot = defaultCoreRoot, stateRoot = coreRoot, week, learnX, coreCandidates = [], coreSelectedIds = [], coreSource = null }) {
  const { buildUnifiedCard } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation-session.mjs')).href);
  const proposedCoreItems = Array.isArray(coreCandidates) ? coreCandidates : coreCandidates?.items;
  const proposedRequiredByItem = Array.isArray(coreCandidates) ? {} : (coreCandidates?.requiredByItem ?? {});
  coreSource ??= Array.isArray(coreCandidates) ? null : coreCandidates?.sourceBinding ?? null;
  if (!Array.isArray(proposedCoreItems) || !Array.isArray(coreSelectedIds) || proposedCoreItems.some(item => item.domain !== 'core')) throw new Error('invalid Core candidates');
  const history = await confirmedCoreItems({ coreRoot, stateRoot, week });
  const alreadyConfirmedCoreIds = new Set();
  const coreItems = proposedCoreItems.filter(item => {
    if (!wasCoreItemAlreadyConfirmed(item, history, coreSource?.proposalSha256)) return true;
    alreadyConfirmedCoreIds.add(item.id);
    return false;
  });
  const requiredByItem = Object.fromEntries(Object.entries(proposedRequiredByItem)
    .filter(([id]) => !alreadyConfirmedCoreIds.has(id))
    .map(([id, required]) => [id, required.filter(requiredId => !alreadyConfirmedCoreIds.has(requiredId))]));
  let staged = null;
  if (learnX) staged = await stageLearnXCard({ root: learnXRoot, week, ...learnX });
  const learnItems = staged?.items ?? [];
  const candidates = [...learnItems, ...(staged?.excludedItems ?? []), ...coreItems];
  const selected = new Set([...learnItems.map(item => item.id), ...coreSelectedIds.filter(id => !alreadyConfirmedCoreIds.has(id))]);
  for (const id of [...selected]) for (const required of requiredByItem[id] ?? []) selected.add(required);
  const selectedIds = [...selected];
  const sourceBindings = {
    ...(learnItems.length ? { learnxMemoryFingerprint: staged.fingerprint } : {}),
    ...(coreItems.some(item => selected.has(item.id)) ? { coreReview: coreSource } : {})
  };
  if (coreItems.some(item => selected.has(item.id)) && !sourceBindings.coreReview) throw new Error('Core review source binding required');
  if (!candidates.length && alreadyConfirmedCoreIds.size) return { status: 'no-new-items', unified: null, pendingCardPath: null, alreadyConfirmedCoreIds: [...alreadyConfirmedCoreIds], learnXFingerprint: staged?.fingerprint ?? null, learnXProposalHash: staged?.proposalHash ?? null, staged: staged?.staged ?? false };
  const unified = buildUnifiedCard({ reviewWeek: week, candidates, selectedIds, sourceBindings });
  const file = await writeImmutable(pendingPath(stateRoot, week, unified.card.fingerprint), { schemaVersion: 1, week, unified });
  return { status: 'ready', unified, pendingCardPath: file, alreadyConfirmedCoreIds: [...alreadyConfirmedCoreIds], learnXFingerprint: staged?.fingerprint ?? null, learnXProposalHash: staged?.proposalHash ?? null, staged: staged?.staged ?? false };
}

function tableFromXml(xml, parseTable) {
  const matches = [...String(xml).matchAll(/<table\b[\s\S]*?<\/table>/g)];
  if (matches.length !== 1) throw new Error('Core snapshot table missing or ambiguous');
  return parseTable(matches[0][0]);
}

function candidateQuarter(timestamp) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(new Date(timestamp));
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error('Core target period unavailable');
  return `Q${Math.floor((month - 1) / 3) + 1}`;
}

// Build per-cell Core confirmation items only from the versioned weekly review
// document and a validated Core changeset. Remote targets are resolved now and
// are re-read immediately before confirmation.
export async function buildCoreConfirmationCandidates({ coreRoot = defaultCoreRoot, stateRoot = coreRoot, week, confirmedAt = new Date().toISOString(), ctx: injectedContext, validation: injectedValidation, adapter: injectedAdapter } = {}) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week || '') || !Number.isFinite(Date.parse(confirmedAt))) throw new Error('invalid Core candidate period');
  const dir = path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib');
  const [{ buildContext, cmdValidate }, content, sync] = await Promise.all([
    import(pathToFileURL(path.join(dir, 'commands.mjs')).href),
    import(pathToFileURL(path.join(dir, 'content.mjs')).href),
    import(pathToFileURL(path.join(dir, 'sync-feishu.mjs')).href)
  ]);
  const ctx = injectedContext ?? await buildContext({ repoRoot: coreRoot });
  const validation = injectedValidation ?? await cmdValidate(ctx, { week });
  if (validation.week !== week || validation.ok !== true || !Array.isArray(validation.items)) throw new Error(`Core changeset not ready: ${(validation.blocked ?? []).map(item => item.reason).join('; ') || 'validation failed'}`);
  const runtime = path.join(stateRoot, 'runtime/weekly-review', week);
  const [binding, manifest, reviewXml, candidateXml, overviewXml, proposalBytes] = await Promise.all([
    readFile(path.join(runtime, 'binding.json'), 'utf8').then(JSON.parse),
    readFile(path.join(runtime, 'snapshot/manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(runtime, 'snapshot/review-doc.xml'), 'utf8'),
    readFile(path.join(runtime, 'candidate.xml'), 'utf8'),
    readFile(path.join(runtime, 'snapshot/overview-q4.xml'), 'utf8'),
    readFile(path.join(runtime, 'changeset/proposal.json'))
  ]);
  const proposal = JSON.parse(proposalBytes.toString('utf8'));
  if (binding.week !== week || !binding.docId || manifest.week !== week || manifest.reviewDoc?.docId !== binding.docId || String(manifest.reviewDoc?.revisionId ?? '') === '' || proposal.week !== week || proposal.source?.reviewDocId !== binding.docId) throw new Error('Core review source identity mismatch');
  const tables = [...candidateXml.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(match => content.parseTable(match[0]));
  if (tables.length !== 3) throw new Error('Core candidate tables incomplete');
  const overview = tableFromXml(overviewXml, content.parseTable);
  const adapter = injectedAdapter ?? sync.createCoreFeishuAdapter(ctx);
  const quarter = candidateQuarter(confirmedAt);
  const sourceBinding = {
    docId: binding.docId,
    revisionId: String(manifest.reviewDoc.revisionId),
    documentSha256: hash(reviewXml),
    proposalSha256: hash(proposalBytes)
  };
  const candidateItems = [];
  const requiredByItem = {};
  const proposalToCandidateIds = {};
  const rowMeta = new Map();
  const idFor = (source, table, row, column) => `core-${source.id}-${table}-${row}-${column}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 150);
  const makeItem = async ({ source, table, rowIndex, columnIndex, rowCells, headers, scope, newValue, itemIndex }) => {
    const sourceValue = rowCells[columnIndex] ?? '';
    const value = newValue ?? sourceValue;
    const originalValue = scope === 'row' && columnIndex === 0 ? source.originalValue : sourceValue;
    const rowKey = rowCells[0] ?? '';
    if (!rowKey) throw new Error(`Core row identity missing: ${source.targetHint}`);
    const rowKeyAfter = columnIndex === 0 && value !== rowKey ? value : null;
    const annualColumn = headers[columnIndex];
    const targets = table === 'A'
      ? ['annual', 'overview', 'export']
      : table === 'B' ? ['annual', 'export'] : ['overview', 'export'];
    const isOverviewCandidate = table === 'O';
    // Confirmed B-table values remain attributed to their AI origin. Explicit
    // modifications are the user's wording; A/O are existing human-authored state.
    const coreSource = table === 'B' && source.classification === 'explicit-confirm' ? 'ai' : 'human';
    const item = {
      id: idFor(source, table, rowIndex, columnIndex), domain: 'core', source: coreSource,
      locator: `Core ${table} 行 ${rowIndex + 1}｜${annualColumn}`,
      originalValue, value, sourceValue: value, targets
    };
    const makeLocator = (target) => {
      const column = target === 'overview' && table === 'A' ? ({ 'Core':'议题', '核心内容简介':'核心内容介绍' }[annualColumn] ?? annualColumn) : annualColumn;
      return JSON.stringify({ section: target === 'annual' ? week : quarter, table: target === 'annual' ? table : (isOverviewCandidate ? 'overview' : 'overview'), rowKey, ...(rowKeyAfter ? { rowKeyAfter } : {}), column });
    };
    const targetBindings = {};
    for (const target of targets.filter(target => target === 'annual' || target === 'overview')) {
      const targetYear = target === 'annual' ? Number(week.slice(0, 4)) : content.shanghaiDateParts(new Date(confirmedAt)).year;
      const documentId = content.resolveFeishuTarget(ctx.config, target, targetYear)?.documentId;
      if (!documentId) throw new Error(`Core ${target} document unavailable`);
      const locator = makeLocator(target);
      const draftBinding = { documentId, locator, beforeValue: '', beforeStructure: '', afterStructure: '' };
      const observed = await adapter.readTarget({ target, binding: draftBinding, item, batch: { reviewWeek: week, confirmedAt } });
      if (observed?.documentId !== documentId || observed.locator !== locator || observed.unique !== true || typeof observed.value !== 'string' || typeof observed.structure !== 'string') throw new Error(`Core ${target} baseline could not be uniquely read`);
      const sectionAbsent = target === 'annual' && observed.structure === '<absent-week-section/>' && observed.value === '';
      if (!sectionAbsent && observed.value !== originalValue && observed.value !== value) throw new Error(`Core ${target} baseline changed from the reviewed source: ${item.locator}`);
      const afterStructure = observed.value === value ? observed.structure : sync.normalizedStructure(sync.renderParagraph(value));
      targetBindings[target] = { documentId, locator, beforeValue: observed.value, beforeStructure: observed.structure, afterStructure };
      if (target === 'annual' && sectionAbsent) item._requiresAnnualRow = true;
    }
    item.targetBindings = targetBindings;
    item._reviewSource = { docId: binding.docId, revisionId: sourceBinding.revisionId };
    item._table = table;
    item._rowIndex = rowIndex;
    item._columnIndex = columnIndex;
    item._rowKey = rowKey;
    return item;
  };
  for (const source of validation.items) {
    const table = source.hint?.domain === 'weekly-section' ? source.hint.table : source.hint?.domain === 'overview' ? 'O' : null;
    const parsed = table === 'A' ? tables[0] : table === 'B' ? tables[1] : table === 'O' ? overview : null;
    if (!parsed || !Number.isInteger(source.hint.row) || source.hint.row < 0 || source.hint.row >= parsed.rows.length) throw new Error(`Core source row unavailable: ${source.targetHint}`);
    const rowCells = parsed.rows[source.hint.row].cells.map(cell => cell.text);
    const rowKey = rowCells[0];
    if (!rowKey) throw new Error(`Core row identity missing: ${source.targetHint}`);
    const columns = source.scope === 'row' ? rowCells.map((_, index) => index) : [source.cellIndex];
    if (columns.some(index => !Number.isInteger(index) || index < 0 || index >= rowCells.length || !parsed.headers[index])) throw new Error(`Core source column unavailable: ${source.targetHint}`);
    rowMeta.set(`${table}\0${source.hint.row}`, { source, table, rowIndex: source.hint.row, rowCells, headers: parsed.headers });
    for (const columnIndex of columns) {
      const newValue = source.scope === 'cell' ? source.proposedValue : (columnIndex === 0 && source.proposedValue !== source.originalValue ? source.proposedValue : rowCells[columnIndex]);
      const candidate = await makeItem({ source, table, rowIndex: source.hint.row, columnIndex, rowCells, headers: parsed.headers, scope: source.scope, newValue });
      candidateItems.push(candidate);
      (proposalToCandidateIds[source.id] ??= []).push(candidate.id);
    }
  }
  const absentRows = new Map();
  for (const item of candidateItems) if (item._requiresAnnualRow) {
    const key = `${item._table}\0${item._rowIndex}`;
    const group = absentRows.get(key) ?? [];
    group.push(item);
    absentRows.set(key, group);
  }
  for (const [key, group] of absentRows) {
    const [table, rowIndexText] = key.split('\0');
    const rowIndex = Number(rowIndexText);
    const meta = rowMeta.get(key);
    if (!meta) throw new Error('Core annual row source metadata missing');
    const keyItems = group.filter(item => item._columnIndex === 0);
    if (keyItems.length > 1 && new Set(keyItems.map(item => item.value)).size > 1) throw new Error('Core row identity proposals conflict');
    let identity = keyItems[0];
    if (!identity) {
      const syntheticSource = { ...meta.source, id: `row-identity-${table}-${rowIndex}`, targetHint: `${table}:${rowIndex}` };
      identity = await makeItem({ source: syntheticSource, table, rowIndex, columnIndex: 0, rowCells: meta.rowCells, headers: meta.headers, scope: 'cell', newValue: meta.rowCells[0] });
      identity.id = `core-row-identity-${table}-${rowIndex}`;
      identity.source = 'human';
      identity.locator = `Core ${table} 行 ${rowIndex + 1}｜年度周报行标识（建档依赖）`;
      identity.targets = ['annual'];
      identity.targetBindings = { annual: identity.targetBindings.annual };
      candidateItems.push(identity);
    }
    for (const item of group) if (item._columnIndex !== 0) requiredByItem[item.id] = [identity.id];
  }
  const locators = new Set();
  for (const item of candidateItems) for (const target of item.targets) {
    const binding = item.targetBindings?.[target];
    const key = `${target}\0${binding?.locator ?? item.locator}`;
    if (locators.has(key)) throw new Error(`Core proposals target the same cell more than once: ${item.locator}`);
    locators.add(key);
  }
  const items = candidateItems.map(({ _requiresAnnualRow, _reviewSource, _table, _rowIndex, _columnIndex, _rowKey, ...item }) => item);
  return { items, sourceBinding, requiredByItem, proposalToCandidateIds };
}

// Invoke immediately before accepting the user's confirmation. Core target
// baselines are independently re-read through the caller's trusted adapter.
export async function validateUnifiedBaselines({ learnXRoot = defaultLearnXRoot, card, validateCore, confirmedAt }) {
  if (!card || typeof validateCore !== 'function') return { ok: false, reason: 'missing trusted Core validator' };
  if (card.sourceBindings?.learnxMemoryFingerprint) {
    try { await verifyWeeklyMemoryApproval({ week: card.reviewWeek, fingerprint: card.sourceBindings.learnxMemoryFingerprint, repoRoot: learnXRoot }); }
    catch (error) { return { ok: false, reason: `Learn-X: ${error.message}` }; }
  }
  if (card.items.some(item => item.domain === 'core')) {
    const result = await validateCore(card, confirmedAt);
    if (result?.ok !== true) return { ok: false, reason: 'Core source or target changed' };
  }
  return { ok: true };
}

// Host-only: readThread must call the Codex app tool, not load JSON supplied
// by the user. These functions are deliberately unavailable through the CLI.
async function codexReaders(coreRoot, host, threadId) {
  if (!host || typeof host.readThread !== 'function') throw new Error('trusted Codex host required');
  const dir = path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib');
  const session = await import(pathToFileURL(path.join(dir, 'confirmation-session.mjs')).href);
  const { readCodexEvidence } = await import(pathToFileURL(path.join(dir, 'codex-session-evidence.mjs')).href);
  const page = Promise.resolve().then(() => host.readThread(threadId));
  const evidence = async (itemId, role) => readCodexEvidence({ threadId, itemId, role, page: await page });
  return { session, display: id => evidence(id, 'assistant'), reply: id => evidence(id, 'user') };
}

// Build the host callback from responses returned by the official Codex
// read_thread tool. Recovery can span cursor pages; callers pass each thread's
// pages in newest-to-oldest order. No CLI or user-supplied JSON path exists.
export async function createCodexHostAdapter(pagesByThread, { coreRoot = defaultCoreRoot } = {}) {
  const entries = pagesByThread instanceof Map ? [...pagesByThread] : Object.entries(pagesByThread ?? {});
  if (!entries.length) throw new Error('official Codex read_thread pages required');
  const { parseCodexReadThreadPage } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/codex-session-evidence.mjs')).href);
  const pages = new Map();
  for (const [threadId, input] of entries) {
    if (typeof threadId !== 'string' || !threadId || pages.has(threadId)) throw new Error('Codex thread page identity invalid');
    const inputs = Array.isArray(input) ? input : [input];
    if (!inputs.length) throw new Error(`Codex pages missing: ${threadId}`);
    const parsed = inputs.map(parseCodexReadThreadPage);
    if (parsed.some(page => page.thread?.id !== threadId)) throw new Error('Codex thread identity mismatch');
    const order = parsed[0].page?.order;
    if (!order || parsed.some(page => page.page?.order !== order)) throw new Error('Codex page order mismatch');
    const turns = [];
    const byId = new Map();
    for (const page of parsed) for (const turn of page.turns) {
      if (!turn?.id) throw new Error('Codex turn identity missing');
      const prior = byId.get(turn.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(turn)) throw new Error('Codex cursor pages conflict');
      if (!prior) { byId.set(turn.id, turn); turns.push(turn); }
    }
    const page = parsed.length === 1 ? inputs[0] : { ...parsed[0], turns };
    pages.set(threadId, page);
  }
  return Object.freeze({ readThread: async threadId => {
    if (!pages.has(threadId)) throw new Error(`official Codex read_thread page missing: ${threadId}`);
    return pages.get(threadId);
  } });
}

export async function recordCodexCard({ coreRoot = defaultCoreRoot, stateRoot = coreRoot, unified, week, fingerprint, threadId, displayMessageId, host }) {
  if (!unified) unified = await loadPending({ coreRoot, stateRoot, week, fingerprint });
  const { session, display } = await codexReaders(coreRoot, host, threadId);
  return session.recordDisplayedCard({ root: stateRoot, unified, displayMessageId, chatId: threadId, expectedBot: 'codex-assistant', fetchDisplay: display });
}

export async function confirmCodexCard({ learnXRoot = defaultLearnXRoot, coreRoot = defaultCoreRoot, stateRoot = coreRoot, week, fingerprint, threadId, receiptFile, displayMessageId, messageId, host, validateCore }) {
  const unified = await loadPending({ coreRoot, stateRoot, week, fingerprint });
  const page = await host?.readThread?.(threadId);
  const { parseCodexReadThreadPage } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/codex-session-evidence.mjs')).href);
  const parsed = parseCodexReadThreadPage(page);
  if (parsed.thread?.id !== threadId) throw new Error('Codex thread identity mismatch');
  const matches = [];
  const turns = parsed.page?.order === 'newest_first' ? parsed.turns : [...parsed.turns].reverse();
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex];
    for (let itemIndex = 0; itemIndex < (turn.items || []).length; itemIndex += 1) {
      const item = turn.items[itemIndex];
      const assistantText = item.type === 'agentMessage' ? item.text : null;
      const userText = item.type === 'userMessage' && Array.isArray(item.content) && item.content.length === 1 && item.content[0]?.type === 'text' ? item.content[0].text : null;
      if (assistantText === unified.display) matches.push({ role: 'assistant', item, turn, turnIndex, itemIndex });
      if (userText === unified.card.confirmationText) matches.push({ role: 'user', item, turn, turnIndex, itemIndex });
    }
  }
  const confirmations = matches.filter(entry => entry.role === 'user');
  if (!confirmations.length) throw new Error('exact user confirmation not found in official thread');
  const confirmation = confirmations[0];
  const displays = matches.filter(entry => entry.role === 'assistant' && entry.turnIndex > confirmation.turnIndex);
  if (!displays.length) throw new Error('displayed card not found before confirmation');
  const selectedDisplay = displays.sort((a, b) => a.turnIndex - b.turnIndex)[0];
  displayMessageId ??= selectedDisplay.item.id;
  messageId ??= confirmation.item.id;
  if (selectedDisplay.item.id !== displayMessageId || confirmation.item.id !== messageId) throw new Error('message selection mismatch');
  // Use the same official read_thread snapshot to establish both item identities
  // and their ordering; separate pages can have different relative indexes.
  const snapshotHost = { readThread: async () => page };
  if (!receiptFile) receiptFile = (await recordCodexCard({ coreRoot, stateRoot, unified, threadId, displayMessageId, host: snapshotHost })).file;
  const { session, display: fetchDisplay, reply } = await codexReaders(coreRoot, snapshotHost, threadId);
  return session.confirmDisplayedCard({ root: stateRoot, receiptFile, messageId, chatId: threadId, expectedBot: 'codex-assistant', expectedSender: 'codex-user', fetchDisplay, fetchMessage: reply, validateBaselines: (card, message) => validateUnifiedBaselines({ learnXRoot, card, validateCore, confirmedAt: message.sentAt }) });
}

export async function validateCoreConfirmationTargets({ coreRoot = defaultCoreRoot, stateRoot = coreRoot, card, confirmedAt, ctx: injectedContext, adapter: injectedAdapter }) {
  if (!card || typeof confirmedAt !== 'string') return { ok: false, reason: 'missing confirmation timestamp' };
  if (!card.items.some(item => item.domain === 'core')) return { ok: true };
  const source = card.sourceBindings?.coreReview;
  if (!source) return { ok: false, reason: 'Core review source binding missing' };
  const dir = path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib');
  const [{ buildContext }, { createCoreFeishuAdapter }] = await Promise.all([
    import(pathToFileURL(path.join(dir, 'commands.mjs')).href),
    import(pathToFileURL(path.join(dir, 'sync-feishu.mjs')).href)
  ]);
  const ctx = injectedContext ?? await buildContext({ repoRoot: coreRoot });
  const adapter = injectedAdapter ?? createCoreFeishuAdapter(ctx);
  try {
    const binding = JSON.parse(await readFile(path.join(stateRoot, 'runtime/weekly-review', card.reviewWeek, 'binding.json'), 'utf8'));
    const proposalBytes = await readFile(path.join(stateRoot, 'runtime/weekly-review', card.reviewWeek, 'changeset/proposal.json'));
    if (binding.week !== card.reviewWeek || binding.docId !== source.docId || hash(proposalBytes) !== source.proposalSha256) return { ok: false, reason: 'Core review source or changeset changed' };
    const response = await ctx.larkFactory({ dryRun: false }).fetchDoc({ doc: source.docId, scope: 'full', detail: 'full', docFormat: 'xml', identity: 'user' });
    const document = response?.data?.document;
    if (response?.ok !== true || document?.document_id !== source.docId || typeof document?.content !== 'string' || hash(document.content) !== source.documentSha256) return { ok: false, reason: 'Core review document changed or unreadable' };
  } catch (error) { return { ok: false, reason: `Core source verification failed: ${error.message}` }; }
  const batch = { reviewWeek: card.reviewWeek, confirmedAt };
  for (const item of card.items.filter(value => value.domain === 'core')) for (const target of item.targets.filter(value => value === 'annual' || value === 'overview')) {
    const binding = item.targetBindings?.[target];
    if (!binding) return { ok: false, reason: `missing ${target} target binding` };
    const actual = await adapter.readTarget({ target, binding, item, batch });
    if (actual.documentId !== binding.documentId || actual.locator !== binding.locator || actual.unique !== true || actual.value !== binding.beforeValue || actual.structure !== binding.beforeStructure) return { ok: false, reason: `Core ${target} baseline changed` };
  }
  return { ok: true };
}

export async function verifyCodexConfirmationBatch({ coreRoot = defaultCoreRoot, batch, host }) {
  if (!batch || batch.schemaVersion !== 3 || !batch.hostEvidence || !host || typeof host.readThread !== 'function') return { ok: false, reason: 'official Codex evidence required' };
  const evidence = batch.hostEvidence;
  const threadId = evidence.threadId;
  if (batch.confirmation?.sender !== 'codex-user' || batch.confirmation?.messageId == null) return { ok: false, reason: 'confirmation identity invalid' };
  if (batch.items.some(item => item.domain === 'core') && !batch.sourceBindings?.coreReview) return { ok: false, reason: 'Core review source binding missing' };
  const { prepareConfirmationCard } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs')).href);
  const card = prepareConfirmationCard({ reviewWeek: batch.reviewWeek, items: batch.items, sourceBindings: batch.sourceBindings });
  if (card.fingerprint !== batch.cardFingerprint || card.confirmationText !== batch.confirmation.text) return { ok: false, reason: 'confirmed card no longer matches batch' };
  const receiptFile = path.join(coreRoot, 'runtime/weekly-review', batch.reviewWeek, 'cards', `${card.fingerprint}--${evidence.displayMessageId}.json`);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.chatId !== threadId || receipt.displayMessageId !== evidence.displayMessageId || receipt.displayTurnId !== evidence.displayTurnId || receipt.displayHash !== hash(receipt.display) || receipt.card?.fingerprint !== card.fingerprint || receipt.display !== renderDisplay(card, receipt.excluded)) return { ok: false, reason: 'display receipt mismatch' };
  const { display, reply } = await codexReaders(coreRoot, host, threadId);
  const [actualDisplay, actualReply] = await Promise.all([display(evidence.displayMessageId), reply(batch.confirmation.messageId)]);
  if (actualDisplay.text !== receipt.display || actualDisplay.sentAt !== receipt.displayedAt || actualDisplay.turnId !== evidence.displayTurnId || actualReply.text !== card.confirmationText || actualReply.sender !== 'codex-user' || actualReply.turnId !== evidence.confirmationTurnId || actualReply.sentAt !== batch.confirmedAt || actualReply.turnIndex >= actualDisplay.turnIndex) return { ok: false, reason: 'official Codex messages do not match confirmed batch' };
  return { ok: true, evidence: hash(JSON.stringify([threadId, actualDisplay.id, actualDisplay.text, actualDisplay.turnId, actualReply.id, actualReply.text, actualReply.sentAt, card.fingerprint])) };
}

export async function syncCodexConfirmedBatch({ coreRoot = defaultCoreRoot, batchFile, host, feishuUrl = null }) {
  if (!host || typeof host.readThread !== 'function') throw new Error('trusted Codex host required');
  const dir = path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib');
  const [{ buildContext }, { createCoreFeishuAdapter }, { syncConfirmedBatch }, { readConfirmedBatch }] = await Promise.all([
    import(pathToFileURL(path.join(dir, 'commands.mjs')).href),
    import(pathToFileURL(path.join(dir, 'sync-feishu.mjs')).href),
    import(pathToFileURL(path.join(dir, 'sync-confirmed.mjs')).href),
    import(pathToFileURL(path.join(dir, 'confirmation.mjs')).href)
  ]);
  const ctx = await buildContext({ repoRoot: coreRoot });
  const adapter = createCoreFeishuAdapter(ctx);
  const batch = await readConfirmedBatch(batchFile);
  const verifyConfirmation = current => verifyCodexConfirmationBatch({ coreRoot, batch: current, host });
  return syncConfirmedBatch({ root: coreRoot, batchFile, ...adapter, verifyConfirmation, feishuUrl });
}

// One host call completes the recognition boundary and then hands the immutable
// batch to Core's independently recoverable targets. Learn-X's existing Memory
// and closeout steps remain owned by their existing workflow after this returns.
export async function confirmAndSyncCodexBatch({ coreRoot = defaultCoreRoot, learnXRoot = defaultLearnXRoot, stateRoot = coreRoot, week, fingerprint, threadId, receiptFile, displayMessageId, messageId, host, validateCore = validateCoreConfirmationTargets, syncBatch = syncCodexConfirmedBatch }) {
  const confirmed = await confirmCodexCard({ learnXRoot, coreRoot, stateRoot, week, fingerprint, threadId, receiptFile, displayMessageId, messageId, host, validateCore });
  const hasCoreItems = confirmed.batch.items.some(item => item.domain === 'core');
  let coreSync = { ok: true, status: 'not-applicable' };
  if (hasCoreItems) {
    try { coreSync = await syncBatch({ coreRoot, batchFile: confirmed.file, host }); }
    catch (error) { coreSync = { ok: false, status: 'pending', error: error?.message ?? String(error) }; }
    if (coreSync?.ok !== true) coreSync = { ...(coreSync && typeof coreSync === 'object' ? coreSync : {}), ok: false, syncStatus: coreSync?.status ?? null, status: 'pending' };
  }
  return { ...confirmed, coreSync };
}

// The weekly Skill calls this only after writing and reading back the confirmed
// Learn-X Memory items. It binds closeout to the same immutable confirmation
// batch and runs only its selected actions through the existing executors.
export async function executeConfirmedLearnXCloseout({ batch, learnXRoot = defaultLearnXRoot, stateRoot = defaultCoreRoot, approvalEvidence = null, memoryWriteEvidence = null, verifyMemoryApproval = verifyWeeklyMemoryApproval, executors, recover = false }) {
  if (!batch || !Array.isArray(batch.items)) throw new Error('confirmed batch required');
  const closeoutItems = batch.items.filter(item => item.domain === 'learn-x' && item.targets.includes('weekly-closeout'));
  if (!closeoutItems.length) return { status: 'not-applicable', results: {}, plan: { parallel: [], afterParallel: [] } };
  const fingerprint = batch.sourceBindings?.learnxMemoryFingerprint;
  if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('Learn-X approval binding missing');
  approvalEvidence ??= await verifyMemoryApproval({ week: batch.reviewWeek, fingerprint, repoRoot: learnXRoot });
  if (approvalEvidence?.verified !== true || canonicalWeek(approvalEvidence.week) !== canonicalWeek(batch.reviewWeek) || approvalEvidence.fingerprint !== fingerprint) throw new Error('Learn-X approval evidence does not match confirmed batch at closeout boundary');
  approvalEvidence = { ...approvalEvidence, week: batch.reviewWeek };
  const hasMemoryWrites = batch.items.some(item => item.domain === 'learn-x' && item.targets.includes('memory'));
  const { executeApprovedCloseout, recoverApprovedCloseout, hasVerifiedCloseoutEvidence } = await import('./closeout-actions.mjs');
  if (hasMemoryWrites && !hasVerifiedCloseoutEvidence(memoryWriteEvidence)) {
    return { status: 'pending-memory-readback', results: {}, plan: { parallel: [], afterParallel: [] } };
  }
  const execute = recover ? recoverApprovedCloseout : executeApprovedCloseout;
  const outcome = await execute({ batch, executors, stateRoot, approvalEvidence, memoryWriteEvidence: hasMemoryWrites ? memoryWriteEvidence : null });
  if (outcome.locked) return { ...outcome, status: 'busy' };
  const complete = Object.values(outcome.results).every(result => result.status === 'completed');
  return { ...outcome, status: complete && Object.keys(outcome.results).length ? 'completed' : 'partial' };
}

// Called only from existing Learn-X trigger opportunities. It scans every Core
// confirmation week, but touches only batches whose verified export or one of
// their per-target receipts is missing/incomplete.
export async function recoverCodexConfirmedBatches({ coreRoot = defaultCoreRoot, learnXRoot = defaultLearnXRoot, stateRoot = coreRoot, host, syncBatch = syncCodexConfirmedBatch, closeoutExecutors = null, verifyConfirmation = verifyCodexConfirmationBatch, verifyMemoryApproval = verifyWeeklyMemoryApproval, verifyMemoryWrite = null } = {}) {
  const runtimeRoot = path.join(stateRoot, 'runtime/weekly-review');
  const [{ readConfirmedBatch }, { isVerifiedTargetReceipt }, { inspectApprovedCloseout }] = await Promise.all([
    import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs')).href),
    import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/sync-confirmed.mjs')).href),
    import('./closeout-actions.mjs')
  ]);
  const { confirmationWeek } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/content.mjs')).href);
  let weeks;
  try { weeks = await readdir(runtimeRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { considered: 0, completed: [], pending: [], skipped: [] }; throw error; }
  const results = { considered: 0, completed: [], pending: [], skipped: [] };
  for (const weekEntry of weeks.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const confirmationDir = path.join(runtimeRoot, weekEntry.name, 'confirmations');
    let files;
    try { files = await readdir(confirmationDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of files.filter(value => value.isFile() && value.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
      const batchFile = path.join(confirmationDir, entry.name);
      let batch;
      try {
        if (!(await lstat(batchFile)).isFile()) throw new Error('confirmation is not a regular file');
        batch = await readConfirmedBatch(batchFile);
      } catch (error) {
        results.pending.push({ batchFile, status: 'needs_review', reason: `confirmed batch unreadable: ${error.message}` });
        results.considered += 1;
        continue;
      }
      if (batch.schemaVersion !== 3 || !batch.hostEvidence) { results.skipped.push({ batchId: batch.batchId, status: 'legacy-unverified' }); continue; }
      if (batch.reviewWeek !== weekEntry.name) {
        results.pending.push({ batchId: batch.batchId, status: 'needs_review', reason: 'review week directory mismatch' });
        results.considered += 1;
        continue;
      }
      const coreItems = batch.items.filter(item => item.domain === 'core');
      const closeoutItems = batch.items.filter(item => item.domain === 'learn-x' && item.targets.includes('weekly-closeout'));
      if (!coreItems.length && !closeoutItems.length) { results.skipped.push({ batchId: batch.batchId, status: 'no-recoverable-targets' }); continue; }
      results.considered += 1;
      const expectedTargets = coreItems.flatMap(item => item.targets.filter(target => target === 'annual' || target === 'overview').map(target => ({ item, target })));
      const expectedKeys = expectedTargets.map(({ item, target }) => `${item.id}:${target}`).sort();
      const stateFile = path.join(runtimeRoot, batch.reviewWeek, 'sync', `${batch.batchId}.json`);
      let state = null;
      try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') state = { invalid: error.message }; }
      const stateComplete = expectedKeys.length === 0
        ? state == null || state?.schemaVersion === 1 && state.batchId === batch.batchId && state.reviewWeek === batch.reviewWeek && state.confirmedAt === batch.confirmedAt && Object.keys(state.entries ?? {}).length === 0
        : state?.schemaVersion === 1 && state.batchId === batch.batchId && state.reviewWeek === batch.reviewWeek && state.confirmedAt === batch.confirmedAt && state.entries && typeof state.entries === 'object' && !Array.isArray(state.entries) && Object.keys(state.entries).sort().join('\0') === expectedKeys.join('\0') && expectedTargets.every(({ item, target }) => isVerifiedTargetReceipt({ batch, item, target, entry: state.entries[`${item.id}:${target}`] }));
      const exportItems = batch.items.some(item => item.domain === 'core' && item.targets.includes('export'));
      let exportComplete = !exportItems;
      if (exportItems) {
        const confirmedWeek = confirmationWeek(new Date(batch.confirmedAt));
        const stem = `${batch.reviewWeek}--${batch.batchId}`;
        const bodyPath = path.join(stateRoot, 'runtime/exports', confirmedWeek, `${stem}.md`);
        const metaPath = path.join(stateRoot, 'runtime/exports', confirmedWeek, `${stem}.json`);
        try {
          const [body, meta] = await Promise.all([readFile(bodyPath, 'utf8'), readFile(metaPath, 'utf8').then(JSON.parse)]);
          const items = coreItems.filter(item => item.targets.includes('export'));
          const expectedBody = [`## ${batch.reviewWeek}`, '', ...items.flatMap(item => [`### ${item.locator}`, '', ...item.value.split('\n').map(line => `> ${line}`), ''])].join('\n');
          const expectedItems = items.map(({ id, locator }) => ({ id, locator }));
          exportComplete = body === expectedBody && meta.schemaVersion === '2' && meta.status === 'confirmed' && meta.batchId === batch.batchId && meta.reviewWeek === batch.reviewWeek && meta.frozenAt === batch.confirmedAt && meta.sha256 === hash(body) && JSON.stringify(meta.confirmedItems) === JSON.stringify(expectedItems);
        } catch { exportComplete = false; }
      }
      let closeoutState = { complete: true, results: {}, stateFile: null };
      if (closeoutItems.length) {
        try { closeoutState = await inspectApprovedCloseout({ batch, stateRoot }); }
        catch (error) {
          closeoutState = { complete: false, results: {}, stateFile: null, error: `closeout recovery state invalid: ${error.message}` };
        }
      }
      const coreComplete = stateComplete && exportComplete;
      if (coreComplete && closeoutState.complete) { results.completed.push({ batchId: batch.batchId, status: 'already-complete' }); continue; }
      if (!host || typeof host.readThread !== 'function') {
        results.pending.push({ batchId: batch.batchId, batchFile, threadId: batch.hostEvidence?.threadId ?? null, displayMessageId: batch.hostEvidence?.displayMessageId ?? null, confirmationMessageId: batch.confirmation?.messageId ?? null, status: 'awaiting-host', reason: 'official Codex thread reader unavailable' });
        continue;
      }
      let confirmation;
      try { confirmation = await verifyConfirmation({ coreRoot, batch, host }); }
      catch (error) {
        results.pending.push({ batchId: batch.batchId, batchFile, threadId: batch.hostEvidence?.threadId ?? null, status: 'awaiting-host', reason: `official confirmation readback failed: ${error.message}` });
        continue;
      }
      if (confirmation?.ok !== true) {
        results.pending.push({ batchId: batch.batchId, status: 'needs_review', reason: confirmation?.reason ?? 'official confirmation could not be reverified' });
        continue;
      }
      const outcomes = {};
      if (coreItems.length && !coreComplete) {
        try { outcomes.core = await syncBatch({ coreRoot, batchFile, host }); }
        catch (error) { outcomes.core = { ok: false, status: 'pending', error: error?.message ?? String(error) }; }
        if (outcomes.core?.ok !== true) outcomes.core = { ...(outcomes.core && typeof outcomes.core === 'object' ? outcomes.core : {}), ok: false, syncStatus: outcomes.core?.status ?? null, status: 'pending' };
      }
      if (closeoutItems.length && !closeoutState.complete) {
        if (closeoutState.error) outcomes.learnXCloseout = { status: 'needs_review', reason: closeoutState.error };
        else if (!closeoutExecutors) outcomes.learnXCloseout = { status: 'pending', reason: 'closeout executor adapter unavailable' };
        else {
          try {
            let memoryWriteEvidence = closeoutState.memoryWriteEvidence;
            const hasMemoryWrites = batch.items.some(item => item.domain === 'learn-x' && item.targets.includes('memory'));
            if (hasMemoryWrites && !memoryWriteEvidence) {
              const verifyWrite = verifyMemoryWrite ?? verifyConfirmedWeeklyMemoryWrite;
              memoryWriteEvidence = await verifyWrite({ batch, repoRoot: learnXRoot });
            }
            let approvalEvidence = closeoutState.approvalEvidence;
            if (!approvalEvidence) {
              const verification = hasMemoryWrites && memoryWriteEvidence?.ok === true && memoryWriteEvidence?.status === 'verified'
                ? verifyWeeklyMemoryApprovalSources
                : verifyMemoryApproval;
              approvalEvidence = await verification({ week: batch.reviewWeek, fingerprint: batch.sourceBindings?.learnxMemoryFingerprint, repoRoot: learnXRoot });
            }
            outcomes.learnXCloseout = await executeConfirmedLearnXCloseout({ batch, learnXRoot, stateRoot, approvalEvidence, memoryWriteEvidence, verifyMemoryApproval, executors: closeoutExecutors, recover: true });
          } catch (error) { outcomes.learnXCloseout = { status: 'pending', reason: error?.message ?? String(error) }; }
        }
      }
      const coreDone = coreComplete || outcomes.core?.ok === true;
      const closeoutDone = closeoutState.complete || outcomes.learnXCloseout?.status === 'completed';
      if (coreDone && closeoutDone) results.completed.push({ batchId: batch.batchId, status: 'recovered', outcomes });
      else results.pending.push({ batchId: batch.batchId, status: 'pending_recovery', outcomes });
    }
  }
  return results;
}

async function main() {
  if (process.argv.slice(2).join(' ') !== 'preview') throw new Error('only preview is available; confirmation requires trusted host');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('input too large'); }
  const params = JSON.parse(input);
  if ('coreRoot' in params || 'learnXRoot' in params) throw new Error('root override unavailable in CLI');
  const result = await prepareUnifiedPreview(params);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (globalThis.process?.argv?.[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); globalThis.process.exitCode = 1; });

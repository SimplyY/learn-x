import { readFile, writeFile, mkdir, rename, unlink, readdir, open, copyFile, lstat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { scanArchive, scanOnlineSnapshot, hashBody } from './catalog.mjs';
import { assertFlomoPathWithinRoot, defaultFlomoPrivateDataRoot, readVerifiedStagedOnlineFlomoSnapshot,
  resolveFlomoPathAllowed, resolveFlomoPathAllowedSync } from '../../learn-x-input/scripts/lib/flomo-full-snapshot.mjs';
import { flomoTags } from '../../learn-x-input/scripts/lib/flomo-filter.mjs';
import { validateSelection, eligibleNotes, simulateSupply, isoWeek, activeWeeks, MIN_REVIEW_ITEMS, TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS, MAX_REVIEW_REASON_CHARS } from './policy.mjs';
import { preflightDelivery, auditRecentReviewHistory, sendRecommendation, recoverRecommendation, collectFeedback, cardContentSha256 } from './delivery.mjs';
import { buildReviewContext, validateEvidence, sha256, shanghaiDate, validDate } from './context.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
function safeProjectPath(projectRoot, candidate) {
  return assertFlomoPathWithinRoot(projectRoot, resolveFlomoPathAllowedSync(candidate));
}
function safePrivatePath(p, candidate) {
  return safeProjectPath(p.privateRoot, candidate);
}
function safeBackupPath(p, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw Error('online-storage-backup-invalid');
  const safe = safePrivatePath(p, candidate);
  const relative = path.relative(p.backupsRoot, safe);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Error('online-storage-backup-invalid');
  }
  return safe;
}
async function resolveProjectPath(projectRoot, candidate) {
  const safeRoot = await resolveFlomoPathAllowed(projectRoot);
  return assertFlomoPathWithinRoot(safeRoot, await resolveFlomoPathAllowed(candidate));
}
async function writeProjectFile(projectRoot, file, content, options) {
  await writeFile(await resolveProjectPath(projectRoot, file), content, options);
}
async function makeProjectDirectory(projectRoot, directory) {
  const safeDirectory = await resolveProjectPath(projectRoot, directory);
  await mkdir(safeDirectory, { recursive: true });
  return safeDirectory;
}
async function copyProjectFile(projectRoot, source, destination) {
  await copyFile(await resolveProjectPath(projectRoot, source), await resolveProjectPath(projectRoot, destination));
}
async function unlinkProjectFile(projectRoot, file) {
  await unlink(await resolveProjectPath(projectRoot, file));
}
export function paths(root = repoRoot) {
  const projectRoot = resolveFlomoPathAllowedSync(root);
  const insideProject = (candidate) => assertFlomoPathWithinRoot(projectRoot, resolveFlomoPathAllowedSync(candidate));
  const legacyRuntime = insideProject(path.join(projectRoot, '04_output/_dist/flomo-review'));
  const legacyCatalog = insideProject(path.join(projectRoot, '03_input/_archives/flomo/catalog.json'));
  const privateRoot = insideProject(defaultFlomoPrivateDataRoot(projectRoot));
  const storageModePath = insideProject(path.join(privateRoot, 'storage-mode.json'));
  const onlineStorageActive = existsSync(storageModePath);
  let storageState = null;
  if (onlineStorageActive) {
    try { storageState = JSON.parse(readFileSync(storageModePath, 'utf8')); }
    catch { throw Error('online-storage-state-invalid'); }
  }
  const runtime = onlineStorageActive ? privateRoot : legacyRuntime;
  const versionedPath = (field, fallback, suffix) => {
    const value = storageState?.[field];
    if (value == null) return insideProject(path.join(privateRoot, fallback));
    if (typeof value !== 'string' || !new RegExp(`^snapshots/[A-Za-z0-9_-]+\\.${suffix}\\.json$`).test(value)) throw Error('online-storage-state-invalid');
    return insideProject(path.join(privateRoot, value));
  };
  let activeSnapshotRelativePath = null;
  let activeSnapshotPath = null;
  let backupPath = null;
  const backupsRoot = insideProject(path.join(privateRoot, 'backups'));
  if (onlineStorageActive) {
    activeSnapshotRelativePath = storageState?.activeSnapshotPath;
    if (typeof activeSnapshotRelativePath !== 'string' || !/^snapshots\/[A-Za-z0-9_-]+\.json$/.test(activeSnapshotRelativePath)) {
      throw Error('online-storage-state-invalid');
    }
    activeSnapshotPath = insideProject(path.join(privateRoot, activeSnapshotRelativePath));
    if (typeof storageState?.backupPath !== 'string' || !path.isAbsolute(storageState.backupPath)) throw Error('online-storage-state-invalid');
    backupPath = insideProject(storageState.backupPath);
    const backupRelative = path.relative(backupsRoot, backupPath);
    if (!backupRelative || backupRelative === '..' || backupRelative.startsWith(`..${path.sep}`) || path.isAbsolute(backupRelative)) {
      throw Error('online-storage-state-invalid');
    }
  }
  const catalog = onlineStorageActive ? versionedPath('activeCatalogPath', 'catalog.json', 'catalog') : legacyCatalog;
  const ledger = onlineStorageActive ? versionedPath('activeLedgerPath', 'ledger.json', 'ledger') : insideProject(path.join(runtime, 'ledger.json'));
  return { root: projectRoot, runtime, catalog, ledger, config: insideProject(path.join(projectRoot, '00_config/flomo-review.json')),
    privateRoot, lockPath: insideProject(path.join(privateRoot, 'write.lock')), storageModePath,
    onlineStorageActive, legacyRuntime, legacyCatalog, activeSnapshotRelativePath, activeSnapshotPath, backupsRoot, backupPath };
}
export async function readJson(file, fallback) {
  const safeFile = await resolveFlomoPathAllowed(file);
  try { return JSON.parse(await readFile(safeFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e; }
}
export async function atomicJson(file, value, projectRoot) {
  const safeFile = projectRoot ? await resolveProjectPath(projectRoot, file) : await resolveFlomoPathAllowed(file);
  await mkdir(path.dirname(safeFile), { recursive: true });
  const tmp = `${safeFile}.${randomUUID()}.tmp`, fd = await open(tmp, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
  try { await rename(tmp, safeFile); } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function checkPrivateDirectory(directory, { create = false, projectRoot } = {}) {
  const safeDirectory = projectRoot ? await resolveProjectPath(projectRoot, directory) : await resolveFlomoPathAllowed(directory);
  if (create) await mkdir(safeDirectory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw Error('review-private-directory-insecure');
  }
}
async function ensurePrivateDirectory(directory, projectRoot) {
  await checkPrivateDirectory(directory, { create: true, projectRoot });
}
export async function withLock(root, action) {
  const p = paths(root), { privateRoot, lockPath } = p;
  await ensurePrivateDirectory(privateRoot, p.root);
  const safeRoot = await resolveFlomoPathAllowed(privateRoot);
  const lock = assertFlomoPathWithinRoot(safeRoot, await resolveFlomoPathAllowed(lockPath)); let fd;
  try { fd = await open(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw Error('review-locked-inspect-owner-before-recovery'); throw e; }
  try { await fd.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await action(); }
  finally { await fd.close(); await unlink(lock); }
}
export const emptyLedger = () => ({ schemaVersion: 1, batches: {}, feedback: {}, failures: [] });
function assertLedger(value) {
  if (value.schemaVersion !== 1 || !value.batches || typeof value.batches !== 'object' || !value.feedback) throw Error('ledger-invalid');
  return value;
}
export function catalogHash(catalog) {
  return sha256(JSON.stringify({ sourceMode: catalog.sourceMode || 'legacy-archive', snapshot: catalog.snapshot || null,
    dedupeGeneration: catalog.dedupeGeneration || 'legacy',
    notes: catalog.notes.map(n => ({ noteKey: n.noteKey, aliases: n.aliases, groupKey: n.groupKey, groupAliases: n.groupAliases, bodyHash: n.bodyHash, quality: n.quality, sources: n.sources })) }));
}
function assertMatchingDedupeGeneration(catalog, ledger) {
  if ((catalog.dedupeGeneration || 'legacy') !== (ledger.dedupeGeneration || 'legacy')) throw Error('dedupe-generation-mismatch');
}
export async function refreshArchive(root = repoRoot) {
  return withLock(root, async () => {
    const p = paths(root), previous = await readJson(p.catalog, { schemaVersion: 1, notes: [] });
    let catalog;
    if (p.onlineStorageActive) {
      const state = await readJson(p.storageModePath);
      if (state.schemaVersion !== 1 || state.sourceMode !== 'flomo-online-full' ||
          typeof state.activeSnapshotPath !== 'string' || !/^snapshots\/[A-Za-z0-9_-]+\.json$/.test(state.activeSnapshotPath) ||
          state.activeSnapshotPath !== p.activeSnapshotRelativePath) {
        throw Error('online-storage-state-invalid');
      }
      const snapshotPath = safePrivatePath(p, path.join(p.privateRoot, state.activeSnapshotPath));
      const snapshot = await readJson(snapshotPath);
      catalog = scanOnlineSnapshot(snapshot, { previous, sourcePath: snapshotPath });
    } else catalog = await scanArchive(root, { previous });
    catalog.updatedAt = new Date().toISOString(); catalog.catalogHash = catalogHash(catalog);
    await atomicJson(p.catalog, catalog, p.root);
    return { notes: catalog.notes.length, eligibleQuality: catalog.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: catalog.excluded.length, coverage: catalog.coverage };
  });
}

export async function activateOnlineSnapshot(root = repoRoot, stagedSnapshotPath, { beforeCommit } = {}) {
  if (typeof stagedSnapshotPath !== 'string' || !stagedSnapshotPath) throw Error('online-snapshot-path-required');
  const before = paths(root);
  const { snapshot: staged } = await readVerifiedStagedOnlineFlomoSnapshot(path.resolve(stagedSnapshotPath), { storageRoot: before.privateRoot });
  if (staged.sourceMode !== 'flomo-online-full' || typeof staged.snapshotId !== 'string' || !staged.snapshotId) throw Error('online-snapshot-invalid');
  if (before.onlineStorageActive) {
    const state = await readJson(before.storageModePath);
    if (state.activeSnapshotId === staged.snapshotId) return { status: 'already-active', snapshotId: staged.snapshotId, coverage: state.coverage };
  }
  return withLock(root, async () => {
    const p = paths(root);
    const activeState = p.onlineStorageActive ? await readJson(p.storageModePath) : null;
    if (activeState?.activeSnapshotId === staged.snapshotId) {
      return { status: 'already-active', snapshotId: staged.snapshotId, coverage: activeState.coverage };
    }
    if (activeState && (activeState.schemaVersion !== 1 || activeState.sourceMode !== 'flomo-online-full' ||
        !activeState.dedupeGeneration || !activeState.activeSnapshotPath || !activeState.backupPath)) throw Error('online-storage-state-invalid');
    if (activeState) {
      if (activeState.activeSnapshotPath !== p.activeSnapshotRelativePath) throw Error('online-storage-state-invalid');
      const activeSnapshot = await readJson(safePrivatePath(p, path.join(p.privateRoot, activeState.activeSnapshotPath)));
      const activeCapturedAt = Date.parse(activeSnapshot.capturedAt || activeSnapshot.scanFinishedAt || '');
      const stagedCapturedAt = Date.parse(staged.capturedAt || staged.scanFinishedAt || '');
      if (!Number.isFinite(activeCapturedAt) || !Number.isFinite(stagedCapturedAt)) throw Error('online-snapshot-timestamp-invalid');
      if (stagedCapturedAt <= activeCapturedAt) throw Error('online-snapshot-not-newer-than-active');
    }
    const previousCatalog = p.onlineStorageActive ? await readJson(p.catalog) : await readJson(p.legacyCatalog, { schemaVersion: 1, notes: [], excluded: [] });
    const previousLedger = p.onlineStorageActive
      ? assertLedger(await readJson(p.ledger))
      : assertLedger(await readJson(path.join(p.legacyRuntime, 'ledger.json'), emptyLedger()));
    const generation = activeState?.dedupeGeneration || `online-${staged.snapshotId}`;
    const snapshotRelativePath = `snapshots/${staged.snapshotId}.json`;
    const catalogRelativePath = `snapshots/${staged.snapshotId}.catalog.json`;
    const ledgerRelativePath = `snapshots/${staged.snapshotId}.ledger.json`;
    const snapshotAbsolutePath = path.join(p.privateRoot, snapshotRelativePath);
    const snapshotsRoot = path.join(p.privateRoot, 'snapshots');
    const backupsRoot = path.join(p.privateRoot, 'backups');
    await ensurePrivateDirectory(snapshotsRoot, p.root);
    await ensurePrivateDirectory(backupsRoot, p.root);
    let backupPath = activeState ? safeBackupPath(p, activeState.backupPath) : null;
    if (!activeState) {
      backupPath = path.join(backupsRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
      await ensurePrivateDirectory(backupPath, p.root);
      for (const [source, name] of [[p.legacyCatalog, 'legacy-catalog.json'], [path.join(p.legacyRuntime, 'ledger.json'), 'legacy-ledger.json']]) {
        try { await copyProjectFile(p.root, source, path.join(backupPath, name)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } else {
      await checkPrivateDirectory(backupsRoot, { projectRoot: p.root });
      await checkPrivateDirectory(backupPath, { projectRoot: p.root });
    }
    await atomicJson(snapshotAbsolutePath, staged, p.root);
    const catalog = scanOnlineSnapshot(staged, { previous: previousCatalog, sourcePath: snapshotAbsolutePath });
    catalog.dedupeGeneration = generation;
    catalog.updatedAt = new Date().toISOString();
    catalog.catalogHash = catalogHash(catalog);
    const ledger = structuredClone(previousLedger);
    ledger.dedupeGeneration = generation;
    if (!activeState) ledger.dedupeGenerationCreatedAt = new Date().toISOString();
    for (const batch of Object.values(ledger.batches)) if (!batch.dedupeGeneration) batch.dedupeGeneration = 'legacy';
    await atomicJson(path.join(p.privateRoot, catalogRelativePath), catalog, p.root);
    await atomicJson(path.join(p.privateRoot, ledgerRelativePath), ledger, p.root);
    const storageState = {
      schemaVersion: 1, sourceMode: 'flomo-online-full', dedupeGeneration: generation,
      activeSnapshotId: staged.snapshotId, activeSnapshotPath: snapshotRelativePath,
      activeCatalogPath: catalogRelativePath, activeLedgerPath: ledgerRelativePath,
      activatedAt: new Date().toISOString(), coverage: structuredClone(staged.coverage),
      backupPath,
    };
    await beforeCommit?.();
    await atomicJson(p.storageModePath, storageState, p.root);
    return { status: activeState ? 'updated' : 'activated', snapshotId: staged.snapshotId, dedupeGeneration: generation,
      notes: catalog.notes.length, eligibleQuality: 0, excluded: catalog.excluded.length,
      coverage: catalog.coverage, backupPath, ledgerBatchesPreserved: Object.keys(ledger.batches).length };
  });
}

export async function restoreOnlineSnapshotBackup(root = repoRoot) {
  const before = paths(root);
  if (!before.onlineStorageActive) throw Error('online-storage-not-active');
  return withLock(root, async () => {
    const p = paths(root);
    if (!p.onlineStorageActive) throw Error('online-storage-not-active');
    const state = await readJson(p.storageModePath);
    const backupPath = safeBackupPath(p, state.backupPath);
    const backupsRoot = p.backupsRoot;
    if (state.schemaVersion !== 1 || state.sourceMode !== 'flomo-online-full') throw Error('online-storage-backup-invalid');
    await checkPrivateDirectory(backupsRoot, { projectRoot: p.root });
    await checkPrivateDirectory(backupPath, { projectRoot: p.root });
    const restoredCatalog = await readJson(path.join(backupPath, 'legacy-catalog.json'));
    assertLedger(await readJson(path.join(backupPath, 'legacy-ledger.json')));
    if (restoredCatalog.schemaVersion !== 1 || !Array.isArray(restoredCatalog.notes)) throw Error('online-storage-backup-invalid');
    // Keep the live ledger so messages and feedback recorded since migration
    // survive rollback. The source change starts a fresh exposure generation;
    // the same-day occupancy check still sees every batch across generations.
    const ledger = assertLedger(await readJson(p.ledger));
    const generation = `rollback-${randomUUID()}`;
    restoredCatalog.sourceMode = 'legacy-archive';
    restoredCatalog.dedupeGeneration = generation;
    restoredCatalog.updatedAt = new Date().toISOString();
    restoredCatalog.catalogHash = catalogHash(restoredCatalog);
    ledger.dedupeGeneration = generation;
    ledger.dedupeGenerationCreatedAt = new Date().toISOString();
    for (const batch of Object.values(ledger.batches)) if (!batch.dedupeGeneration) batch.dedupeGeneration = 'legacy';
    const safetyPath = path.join(backupsRoot, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
    await ensurePrivateDirectory(safetyPath, p.root);
    for (const [source, name] of [[p.catalog, 'online-catalog.json'], [p.ledger, 'online-ledger.json']]) {
      await copyProjectFile(p.root, source, path.join(safetyPath, name));
    }
    await atomicJson(p.legacyCatalog, restoredCatalog, p.root);
    await atomicJson(path.join(p.legacyRuntime, 'ledger.json'), ledger, p.root);
    await unlinkProjectFile(p.root, p.storageModePath);
    return { status: 'restored', sourceMode: restoredCatalog.sourceMode, dedupeGeneration: generation,
      notes: restoredCatalog.notes.length, ledgerBatchesPreserved: Object.keys(ledger.batches).length,
      originalBackupPath: backupPath, safetyBackupPath: safetyPath };
  });
}
export function qualityPackets(catalog, maxChars = 24000) {
  const packets = []; let notes = [], chars = 0;
  for (const note of catalog.notes.filter(n => !n.quality || n.quality.bodyHash !== n.bodyHash || n.quality.policyVersion !== '1')) {
    const record = { noteKey: note.noteKey, bodyHash: note.bodyHash, createdAt: note.createdAt, body: note.body };
    const size = JSON.stringify(record).length;
    if (notes.length && chars + size > maxChars) { packets.push({ schemaVersion: 1, policyVersion: '1', notes }); notes = []; chars = 0; }
    notes.push(record); chars += size;
  }
  if (notes.length) packets.push({ schemaVersion: 1, policyVersion: '1', notes });
  return packets;
}
export async function acceptQuality(root, decisions) {
  return withLock(root, async () => {
    const p = paths(root), catalog = await readJson(p.catalog);
    if (decisions.policyVersion !== '1' || !Array.isArray(decisions.items) || !decisions.items.length) throw Error('quality-contract-invalid');
    const seen = new Set();
    for (const d of decisions.items) {
      const note = catalog.notes.find(n => n.noteKey === d.noteKey);
      const shortFullBodyQuote = typeof note?.body === 'string' && Array.from(note.body.trim()).length > 0 &&
        Array.from(note.body.trim()).length < 4 && d.quote === note.body.trim();
      const quoteValid = typeof d.quote === 'string' && note?.body?.includes(d.quote) &&
        (Array.from(d.quote.trim()).length >= 4 || shortFullBodyQuote);
      if (!note || seen.has(d.noteKey) || d.bodyHash !== note.bodyHash || hashBody(note.body) !== note.bodyHash || !Number.isInteger(d.score) || d.score < 0 || d.score > 4 || !d.reason?.trim() || !quoteValid) throw Error('quality-decision-untraceable');
      seen.add(d.noteKey);
    }
    let updated = 0, unchanged = 0;
    const assessedAt = new Date().toISOString();
    for (const d of decisions.items) {
      const note = catalog.notes.find(n => n.noteKey === d.noteKey);
      const current = note.quality;
      if (current?.policyVersion === '1' && current.bodyHash === d.bodyHash && current.score === d.score &&
          current.reason === d.reason && current.quote === d.quote) {
        unchanged += 1;
        continue;
      }
      note.quality = { ...d, policyVersion: '1', assessedAt };
      updated += 1;
    }
    if (updated) { catalog.catalogHash = catalogHash(catalog); await atomicJson(p.catalog, catalog, p.root); }
    return { assessed: decisions.items.length, updated, unchanged, qualified: catalog.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, total: catalog.notes.length };
  });
}
export async function prepareReview(root = repoRoot, date = shanghaiDate(), options = {}) {
  validDate(date); await refreshArchive(root);
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  assertMatchingDedupeGeneration(catalog, ledger);
  const context = await buildReviewContext(root, { date, ...options });
  const eligible = eligibleNotes({ date, notes: catalog.notes, ledger });
  const packet = { schemaVersion: 1, date, contextHash: context.contextHash, catalogHash: catalogHash(catalog), context,
    sourceMode: catalog.sourceMode || 'legacy-archive', snapshot: catalog.snapshot || null,
    notes: eligible.map(({ noteKey, groupKey, createdAt, bodyHash, quality, source }) => ({ noteKey, groupKey, createdAt, bodyHash, quality, source })),
    feedback: Object.values(ledger.feedback).filter(e => !e.superseded && eligible.some(n => n.noteKey === e.noteKey)),
    instruction: `完整读取上下文；单次推荐${MIN_REVIEW_ITEMS}–${MAX_REVIEW_ITEMS}条，常规数量与整体平均目标均为7–8条。先选与近期周/月Output强匹配的高质量笔记；前三条可使用高质量长期背景关联并说明关联，第4–${MAX_REVIEW_ITEMS}条必须强匹配。若只有${MIN_REVIEW_ITEMS}–${TARGET_MIN_REVIEW_ITEMS - 1}条同时满足质量与对应序号上下文要求，可少于常规目标发送，必须填写countDeviationReason说明质量或匹配原因；不得为了达到数量或平均目标降低质量。按整周年龄统计优化近30天与近365天软比例；比例偏离时必须填ageDeviationReason解释，不得为配比降低质量。少于${MIN_REVIEW_ITEMS}条则报告blocked，不凑数。每条reason不超过${MAX_REVIEW_REASON_CHARS}字，只写一条可执行的回看问题或判断，不写解释段落。复读每条原文，引用真实上下文。输出{date,contextHash,catalogHash,countDeviationReason,ageDeviationReason,items:[{noteKey,bodyHash,relevance:strong|background,reason,contextEvidence:[{path,quote}]}]}。` };
  const directory = path.join(p.runtime, date); await atomicJson(path.join(directory, 'request.json'), packet, p.root);
  return { date, qualifiedEligible: eligible.length, contextHash: packet.contextHash, catalogHash: packet.catalogHash,
    sourceMode: packet.sourceMode, snapshot: packet.snapshot, requestPath: path.join(directory, 'request.json'), missing: context.manifest.missing };
}

function displayTitle(note) {
  const poem = flomoTags(note.body).includes('写诗');
  const firstLine = String(note.body || '').split('\n').find(line => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('>'));
  if (!firstLine) return poem ? '诗：一首' : '回顾';
  const rawTitle = firstLine.trim().replace(/<br\s*\/?>/giu, ' ').replace(/ {2,}/gu, ' ');
  const punctuation = rawTitle.search(/[，。：；！？、,.:;!?]/u);
  const baseTitle = (punctuation === -1 ? rawTitle : rawTitle.slice(0, punctuation)).trim();
  const title = [...baseTitle].slice(0, 10).join('').trim() ||
    [...rawTitle].slice(0, 10).join('').trim();
  return poem ? `诗：${title}` : title;
}

function cardBody(note) {
  const source = String(note.body || '').trim()
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const parts = [];
  const generatedBreakOffsets = [];
  const generatedSpacerOffsets = [];
  let contentLength = 0;
  let inList = false;
  let pendingBreaks = 0;
  const appendParagraphBreaks = () => {
    for (let index = 0; index <= pendingBreaks; index += 1) append('&nbsp;<br>', false, true);
  };
  const append = (value, generatedBreak = false, generatedSpacer = false) => {
    if (generatedBreak) generatedBreakOffsets.push(contentLength, contentLength + 4);
    if (generatedSpacer) generatedSpacerOffsets.push(contentLength, contentLength + value.length);
    parts.push(value);
    contentLength += value.length;
  };
  for (const rawLine of source) {
    const list = rawLine.match(/^\s*([-*+]|\d+[.)、])(?:\s*)(.*)$/);
    const text = rawLine.trim();
    if (!text) {
      pendingBreaks += 1;
      continue;
    }
    if (list) {
      if (parts.length) {
        if (pendingBreaks) appendParagraphBreaks();
        else append('\n');
      }
      const marker = /^\d/.test(list[1]) ? `${list[1].replace(/[、)]$/, '.')} ` : '- ';
      append(`${marker}${list[2].trim()}`);
      inList = true;
      pendingBreaks = 0;
    } else {
      if (parts.length) {
        if (pendingBreaks) appendParagraphBreaks();
        else append(inList ? '\n' : '<br>');
      }
      append(text);
      inList = false;
      pendingBreaks = 0;
    }
  }
  const untrimmed = parts.join('');
  const leadingTrim = untrimmed.length - untrimmed.trimStart().length;
  return { content: untrimmed.trim(), generatedBreakOffsets: generatedBreakOffsets.map(offset => offset - leadingTrim),
    generatedSpacerOffsets: generatedSpacerOffsets.map(offset => offset - leadingTrim) };
}

function reviewSnapshotSubtitle(date, snapshot) {
  if (!snapshot || snapshot.sourceMode !== 'flomo-online-full' || !snapshot.coverage) return `回顾日期：${date}`;
  const at = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot.capturedAt));
  const coverage = snapshot.coverage;
  return `回顾日期：${date} · 笔记快照：${at} · 覆盖 ${coverage.observedCount}/${coverage.expectedCount}`;
}

export function renderReview(decision, notes, snapshot = null) {
  const title = `# Flomo 回顾｜${decision.date}`;
  const provenance = snapshot?.sourceMode === 'flomo-online-full' && snapshot.coverage
    ? `笔记快照：${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot.capturedAt))} · 覆盖 ${snapshot.coverage.observedCount}/${snapshot.coverage.expectedCount}`
    : null;
  const message = [title, '', ...(provenance ? [provenance, ''] : [])], full = [title, '', ...(provenance ? [provenance, ''] : [])];
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS) {
    const note = `本日符合质量与上下文要求的笔记不足${TARGET_MIN_REVIEW_ITEMS}条，实际推荐${decision.items.length}条。原因：${decision.countDeviationReason.trim()}`;
    message.push(note, '');
    full.push(note, '');
  }
  for (const [index, item] of decision.items.entries()) {
    const note = notes.find(n => n.noteKey === item.noteKey);
    const heading = `## ${index + 1}. ${displayTitle(note)}`;
    const date = shanghaiDate(new Date(note.createdAt));
    const quote = [...note.body].slice(0, 220).join('');
    message.push(heading, '', ...quote.split('\n').map(x => `> ${x}`), '', `回顾理由：${reviewReason(item)}`, '', `[Flomo原文](${note.source.url})`, '');
    full.push(heading, '', `创建日期：${date}`, `来源：${note.source.url || `${note.source.path}:${note.source.line}`}`, '', note.body, '', `回顾理由：${item.reason}`, '', '---', '');
  }
  const lastItemNumber = decision.items.length;
  message.push(`可以回复本条消息：“第2条有帮助”“第1条跳过”或“第${lastItemNumber}条已回顾”。`);
  const cardElements = [
    ...(decision.items.length < TARGET_MIN_REVIEW_ITEMS ? [{ tag: 'markdown', content: `本日符合质量与上下文要求的笔记不足${TARGET_MIN_REVIEW_ITEMS}条，实际推荐${decision.items.length}条。原因：${decision.countDeviationReason.trim()}` }] : []),
  ];
  const cardReadbackBreaks = [];
  const cardReadbackSpacers = [];
  for (const [index, item] of decision.items.entries()) {
    const note = notes.find(n => n.noteKey === item.noteKey);
    const metadata = `${shanghaiDate(new Date(note.createdAt))}${item.relevance === 'background' ? ' · 背景' : ''}${note.source.url ? ` · [Flomo原文](${note.source.url})` : ''}`;
    const prefix = `**${index + 1}. ${displayTitle(note)}**<br>${metadata}<br><br>`;
    const titlePrefixLength = `**${index + 1}. ${displayTitle(note)}**`.length;
    const prefixBreakOffsets = [
      titlePrefixLength, titlePrefixLength + 4,
      titlePrefixLength + 4 + metadata.length, titlePrefixLength + 4 + metadata.length + 8,
    ];
    const renderedBody = cardBody(note);
    const elementIndex = cardElements.length;
    cardElements.push({ tag: 'markdown', content: `${prefix}${renderedBody.content}` });
    const breakOffsets = [...prefixBreakOffsets, ...renderedBody.generatedBreakOffsets.map(offset => prefix.length + offset)];
    if (breakOffsets.length) {
      cardReadbackBreaks.push({ elementIndex, offsets: breakOffsets });
    }
    if (renderedBody.generatedSpacerOffsets.length) {
      cardReadbackSpacers.push({ elementIndex, offsets: renderedBody.generatedSpacerOffsets.map(offset => prefix.length + offset) });
    }
    cardElements.push(
      { tag: 'markdown', content: `> 回顾理由：${reviewReason(item)}` },
    );
    if (index < decision.items.length - 1) cardElements.push({ tag: 'hr' });
  }
  const card = { schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `Flomo 回顾｜${decision.date}` },
      subtitle: { tag: 'plain_text', content: reviewSnapshotSubtitle(decision.date, snapshot) },
      template: 'indigo',
    },
    body: { elements: [...cardElements, { tag: 'markdown', content: `可以回复本条消息：“第2条有帮助”“第1条跳过”或“第${lastItemNumber}条已回顾”。` }] } };
  return { markdown: `${message.join('\n')}\n`, fullMarkdown: `${full.join('\n')}\n`, card, cardReadbackBreaks, cardReadbackSpacers };
}
export async function inspectDecision(root, decision, { freshContext = false, contextOptions = {} } = {}) {
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  assertMatchingDedupeGeneration(catalog, ledger);
  const request = await readJson(path.join(p.runtime, validDate(decision.date), 'request.json'));
  if (decision.contextHash !== request.contextHash || decision.catalogHash !== catalogHash(catalog)) throw Error('decision-input-changed');
  const context = freshContext ? await buildReviewContext(root, { date: decision.date, ...contextOptions }) : request.context;
  if (context.contextHash !== decision.contextHash) throw Error('live-context-changed-reselect');
  validateEvidence(decision.items, context);
  for (const item of decision.items) {
    const note = catalog.notes.find(n => n.noteKey === item.noteKey);
    if (!note || hashBody(note.body) !== note.bodyHash) throw Error('note-body-hash-invalid');
    if (typeof item.reason !== 'string' || ![...item.reason.trim()].length || [...item.reason.trim()].length > MAX_REVIEW_REASON_CHARS) throw Error('review-reason-length-invalid');
  }
  const stats = validateSelection({ date: decision.date, items: decision.items, notes: catalog.notes, ledger });
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS && (typeof decision.countDeviationReason !== 'string' || !decision.countDeviationReason.trim())) throw Error('count-shortfall-needs-reason');
  if (stats.age.deviations.length && !decision.ageDeviationReason?.trim()) throw Error('age-deviation-needs-reason');
  stats.age.deviationReason = stats.age.deviations.length ? decision.ageDeviationReason.trim() : null;
  return { catalog, ledger, context, stats, ...renderReview(decision, catalog.notes, catalog.snapshot) };
}
export async function previewReview(root, decision) {
  const result = await inspectDecision(root, decision), p = paths(root), dir = path.join(p.runtime, decision.date);
  await makeProjectDirectory(p.root, dir);
  await atomicJson(path.join(dir, 'decision.json'), decision, p.root);
  await writeProjectFile(p.root, path.join(dir, 'review.md'), result.fullMarkdown, { mode: 0o600 });
  await writeProjectFile(p.root, path.join(dir, 'message.md'), result.markdown, { mode: 0o600 });
  await atomicJson(path.join(dir, 'validation.json'), result.stats, p.root);
  return { date: decision.date, count: decision.items.length, stats: result.stats, snapshot: result.catalog.snapshot || null, previewPath: path.join(dir, 'review.md') };
}
export async function sendReview(root, decision, { now = new Date(), deliveryOptions = {}, contextOptions = {} } = {}) {
  if (decision.date !== shanghaiDate(now)) throw Error('stale-date-no-backfill-send');
  // Refresh current source tags/status before reserving; an edited or filtered note invalidates the decision.
  await refreshArchive(root);
  return withLock(root, async () => {
    const p = paths(root), config = await readJson(p.config);
    const check = await inspectDecision(root, decision, { freshContext: true, contextOptions });
    const previous = check.ledger.batches[decision.date];
    if (previous && ['delivered', 'sending', 'needs_review', 'reserved'].includes(previous.status)) throw Error('date-already-reserved-or-delivered');
    const preflight = await preflightDelivery({ ...config.delivery, now, runCli: deliveryOptions.runCli });
    const dateTime = Date.parse(`${decision.date}T00:00:00Z`);
    const mondayOffset = (new Date(dateTime).getUTCDay() + 6) % 7;
    const historyStartDate = new Date(dateTime - (mondayOffset + 21) * 86400000).toISOString().slice(0, 10);
    await auditRecentReviewHistory({ chatId: config.delivery.chatId, startDate: historyStartDate, end: now,
      weeks: activeWeeks(decision.date), batches: check.ledger.batches, botSenderIds: preflight.botSenderIds,
      profile: preflight.profile, runCli: deliveryOptions.runCli });
    const dir = path.join(p.runtime, decision.date); await makeProjectDirectory(p.root, dir);
    const auditPath = path.join(dir, 'review.md'); await writeProjectFile(p.root, auditPath, check.fullMarkdown, { mode: 0o600 });
    const batch = { date: decision.date, status: 'reserved', dedupeGeneration: check.catalog.dedupeGeneration || 'legacy',
      snapshot: check.catalog.snapshot || null, contextHash: decision.contextHash, catalogHash: decision.catalogHash,
      items: decision.items.map(i => {
        const note = check.catalog.notes.find(n => n.noteKey === i.noteKey);
        return { ...i, groupKey: note.groupKey, historyIdentity: { memoId: note.memoId || null, noteKey: note.noteKey,
          groupKey: note.groupKey, createdAt: note.createdAt, bodyHash: note.bodyHash } };
      }),
      ...(decision.items.length < TARGET_MIN_REVIEW_ITEMS ? { countDeviationReason: decision.countDeviationReason.trim() } : {}),
      stats: check.stats, chatId: config.delivery.chatId, profile: preflight.profile, botSenderId: preflight.botSenderId, botSenderIds: preflight.botSenderIds, idempotencyKey: `learn-x-flomo-review:${decision.date}`,
      card: check.card, cardReadbackBreaks: check.cardReadbackBreaks, cardReadbackSpacers: check.cardReadbackSpacers, cardContentSha256: cardContentSha256(check.card), auditPath, auditSha256: sha256(check.fullMarkdown), createdAt: now.toISOString() };
    check.ledger.batches[decision.date] = batch; await atomicJson(p.ledger, check.ledger, p.root);
    batch.status = 'sending'; batch.sendStartedAt = new Date().toISOString(); await atomicJson(p.ledger, check.ledger, p.root);
    try {
      const sent = await sendRecommendation({ chatId: batch.chatId, card: batch.card,
        dateMarker: `回顾日期：${batch.date}`, idempotencyKey: batch.idempotencyKey, profile: batch.profile, botSenderId: batch.botSenderId, botSenderIds: batch.botSenderIds,
        onUploaded: async receipt => { Object.assign(batch, receipt); await atomicJson(p.ledger, check.ledger, p.root); },
        runCli: deliveryOptions.runCli, cardReadbackBreaks: batch.cardReadbackBreaks, cardReadbackSpacers: batch.cardReadbackSpacers });
      Object.assign(batch, sent, { status: 'delivered', deliveredAt: new Date().toISOString() });
      await atomicJson(p.ledger, check.ledger, p.root);
      return { date: batch.date, status: batch.status, count: batch.items.length, messageId: batch.messageId };
    } catch (error) {
      batch.status = error.uncertain === false ? 'failed' : 'needs_review';
      batch.error = error.message; if (error.messageId) batch.messageId = error.messageId;
      if (batch.status === 'failed') {
        batch.failedAt = new Date().toISOString();
        check.ledger.failures ??= [];
        if (!Array.isArray(check.ledger.failures)) throw Error('ledger-failures-invalid');
        check.ledger.failures.push({ date: batch.date, createdAt: batch.createdAt, failedAt: batch.failedAt, error: batch.error,
          countDeviationReason: batch.countDeviationReason ?? null, ageDeviationReason: batch.stats?.age?.deviationReason ?? null,
          items: batch.items.map(item => ({ ...item })), stats: batch.stats, contextHash: batch.contextHash, catalogHash: batch.catalogHash,
          cardContentSha256: batch.cardContentSha256, auditSha256: batch.auditSha256 });
      }
      await atomicJson(p.ledger, check.ledger, p.root); throw error;
    }
  });
}

function reviewReason(item) {
  return item.reason.trim();
}

export async function recoverReview(root, date, deliveryOptions = {}) {
  return withLock(root, async () => {
    const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), batch = ledger.batches[validDate(date)];
    if (!batch || !['sending', 'needs_review', 'reserved', 'delivered'].includes(batch.status)) throw Error('batch-not-recoverable');
    const result = await recoverRecommendation({ ...batch, dateMarker: `回顾日期：${date}`, expectedCard: batch.card,
      expectedMarkdown: batch.markdown, runCli: deliveryOptions.runCli });
    if (!result?.messageId) throw Error('send-recovery-unresolved-no-resend');
    Object.assign(batch, result, { status: 'delivered', recoveredAt: new Date().toISOString() }); await atomicJson(p.ledger, ledger, p.root);
    return { date, status: batch.status, messageId: batch.messageId };
  });
}
export async function feedbackReview(root, { date = shanghaiDate(), targetDate, ...options } = {}) {
  const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), config = await readJson(p.config), weeks = activeWeeks(date);
  const batches = Object.values(ledger.batches).filter(b => b.status === 'delivered' && (targetDate ? b.date === targetDate : weeks.includes(b.stats?.week)));
  const result = await collectFeedback({ batches, ownerId: config.delivery.ownerId, profile: config.delivery.profile, ...options });
  if (result.complete !== true || result.errors?.length || result.truncated || !Array.isArray(result.replyObservations)) throw Error('feedback-incomplete-do-not-advance');
  return withLock(root, async () => {
    const current = assertLedger(await readJson(p.ledger, emptyLedger()));
    let newEvents = 0, newObservations = 0;
    current.feedbackReplyVersions ??= {};
    const versionTime = event => /^\d+$/.test(event.updateTime) ? Number(event.updateTime) * (Number(event.updateTime) < 1e12 ? 1000 : 1) : new Date(event.updateTime).getTime();
    const sameVersion = (a, b) => a.replyId === b.replyId && versionTime(a) === versionTime(b);
    for (const observation of result.replyObservations ?? []) {
      if (!observation.observationKey || !observation.replyId || !Number.isFinite(versionTime(observation)) || !['present', 'deleted'].includes(observation.state) || !Array.isArray(observation.eventKeys)) throw Error('feedback-observation-invalid');
      const previous = Object.values(current.feedbackReplyVersions).find(value => sameVersion(value, observation));
      if (previous && (previous.rootMessageId !== observation.rootMessageId || previous.state !== observation.state || previous.contentSha256 !== observation.contentSha256 || JSON.stringify(previous.eventKeys) !== JSON.stringify(observation.eventKeys))) throw Error('feedback-version-conflict');
      if (!previous) { current.feedbackReplyVersions[observation.observationKey] = observation; newObservations += 1; }
    }
    for (const event of result.events) {
      if (!event.eventKey || !event.replyId || !event.updateTime) throw Error('feedback-event-identity-invalid');
      if (current.feedback[event.eventKey]) continue;
      current.feedback[event.eventKey] = event; newEvents += 1;
    }
    const latestByReply = new Map();
    for (const event of Object.values(current.feedback)) {
      const version = versionTime(event);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(event.replyId);
      if (!previous || version > versionTime(previous)) latestByReply.set(event.replyId, event);
    }
    for (const observation of Object.values(current.feedbackReplyVersions)) {
      const version = versionTime(observation);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(observation.replyId);
      if (!previous || version >= versionTime(previous)) latestByReply.set(observation.replyId, observation);
    }
    for (const event of Object.values(current.feedback)) {
      const latest = latestByReply.get(event.replyId);
      event.superseded = versionTime(event) < versionTime(latest) || latest.state === 'deleted' || (Array.isArray(latest.eventKeys) && !latest.eventKeys.includes(event.eventKey));
    }
    current.feedbackCheckedAt = new Date().toISOString(); await atomicJson(p.ledger, current, p.root);
    return { checkedBatches: batches.length, events: result.events.length, newEvents, newObservations, totalFeedback: Object.keys(current.feedback).length };
  });
}
export async function simulateCapacity(root = repoRoot, startDate = shanghaiDate(), days = 28) {
  const catalog = await readJson(paths(root).catalog);
  const simulation = simulateSupply({ notes: catalog.notes, startDate, days });
  const counts = simulation.schedule.map(day => day.items.length);
  const overlaps = simulation.schedule.flatMap(day => day.pairOverlaps.map(pair => pair.overlap));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startDate,
    days,
    possible: simulation.possible,
    targetDailyCountRange: [TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS],
    averageDailyCountTargetRange: [7, 8],
    ...(simulation.reason ? { reason: simulation.reason } : {}),
    ...(simulation.date ? { failedDate: simulation.date } : {}),
    uniqueQualified: simulation.uniqueQualified,
    minimum: simulation.minimum,
    scheduledDays: simulation.schedule.length,
    dailyCountRange: counts.length ? [Math.min(...counts), Math.max(...counts)] : [],
    maximumRepeatCount: Math.max(0, ...simulation.schedule.map(day => day.repeats)),
    maximumPairOverlap: Math.max(0, ...overlaps),
  };
  const p = paths(root), reportPath = path.join(p.runtime, `capacity-${days}-verified-${isoWeek(startDate)}.json`);
  await atomicJson(reportPath, report, p.root);
  return { ...report, reportPath };
}
async function main(argv) {
  const [command] = argv, arg = key => argv[argv.indexOf(key) + 1], date = argv.includes('--date') ? validDate(arg('--date')) : shanghaiDate();
  const p = paths();
  if (command === 'archive') return refreshArchive();
  if (command === 'activate-snapshot') return activateOnlineSnapshot(repoRoot, arg('--file'));
  if (command === 'restore-snapshot-backup') return restoreOnlineSnapshotBackup();
  if (command === 'quality-packets') {
    const catalog = await readJson(p.catalog), packets = qualityPackets(catalog); const dir = await makeProjectDirectory(p.root, path.join(p.runtime, 'quality-packets'));
    for (const [i, packet] of packets.entries()) await atomicJson(path.join(dir, `${String(i + 1).padStart(3, '0')}.json`), packet, p.root);
    return { packets: packets.length, notes: packets.reduce((s, x) => s + x.notes.length, 0), directory: dir };
  }
  if (command === 'quality-accept') return acceptQuality(repoRoot, await readJson(path.resolve(arg('--file'))));
  if (command === 'prepare') return prepareReview(repoRoot, date);
  if (command === 'preview' || command === 'send') {
    const decision = await readJson(path.resolve(arg('--file')));
    return command === 'preview' ? previewReview(repoRoot, decision) : sendReview(repoRoot, decision);
  }
  if (command === 'recover') return recoverReview(repoRoot, date);
  if (command === 'feedback') return feedbackReview(repoRoot, { date, targetDate: argv.includes('--target-date') ? arg('--target-date') : undefined });
  if (command === 'simulate') return simulateCapacity(repoRoot, date, argv.includes('--days') ? Number(arg('--days')) : 28);
  if (command === 'status') {
    const c = await readJson(p.catalog, { notes: [], excluded: [] }), l = assertLedger(await readJson(p.ledger, emptyLedger()));
    return { notes: c.notes.length, qualified: c.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: c.excluded.length, batches: Object.values(l.batches).map(({ date, status, messageId }) => ({ date, status, messageId })), feedback: Object.keys(l.feedback).length };
  }
  throw Error('usage: archive|activate-snapshot --file|restore-snapshot-backup|quality-packets|quality-accept --file|prepare|preview --file|send --file|feedback|recover|simulate|status');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(async e => {
    const p = paths(); await makeProjectDirectory(p.root, p.runtime);
    await atomicJson(path.join(p.runtime, 'last-failure.json'), { at: new Date().toISOString(), command: process.argv[2], error: e.message }, p.root).catch(() => {});
    console.error(JSON.stringify({ status: 'blocked', error: e.message })); process.exitCode = 1;
  });
}

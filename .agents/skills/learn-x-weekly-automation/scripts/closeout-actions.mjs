import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, link, unlink, rename, lstat } from 'node:fs/promises';
import path from 'node:path';

// The confirmed batch is the only source of authority for optional Learn-X
// closeout. Each selected action has its own durable state so Core targets and
// Learn-X closeout can recover independently.
// `ywnext` is accepted only while reading historical confirmed batches. It is
// never scheduled or executed. New YWContext work is derived from the batch's
// confirmed Memory items and does not require a separate closeout selection.
const known = new Set(['backup', 'ywnext', 'flomo']);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonicalWeek = value => {
  const match = /^(\d{4})-W?(\d{2})$/.exec(value || '');
  return match ? `${match[1]}-W${match[2]}` : null;
};

export const hasVerifiedCloseoutEvidence = result => result?.ok === true
  && result?.status === 'verified'
  && result.evidence != null
  && (typeof result.evidence === 'string' ? result.evidence.trim().length > 0 : typeof result.evidence === 'object' && !Array.isArray(result.evidence) && Object.keys(result.evidence).length > 0);

function batchIdentity(batch, actions) {
  return hash(canonical({
    batchId: batch.batchId,
    reviewWeek: batch.reviewWeek,
    confirmedAt: batch.confirmedAt,
    actions: actions.map(({ action, item }) => ({ action, itemId: item.id, itemSha256: hash(canonical(item)) }))
  }));
}

function statePath(stateRoot, batch) {
  return path.join(stateRoot, 'runtime', 'weekly-review', batch.reviewWeek, 'closeout', `${batch.batchId}.json`);
}

function lockPath(stateRoot, batch) {
  return path.join(stateRoot, 'runtime', 'weekly-review', batch.reviewWeek, 'locks', `${batch.batchId}.closeout.lock`);
}

function closeoutState(batch, actions, { legacy = false } = {}) {
  const actionFingerprint = batchIdentity(batch, actions);
  const retiredYwnext = batch.items?.find(item => item?.domain === 'learn-x'
    && item.id === 'closeout-ywnext' && item.targets?.includes('weekly-closeout'));
  return {
    schemaVersion: 2,
    batchId: batch.batchId,
    reviewWeek: batch.reviewWeek,
    confirmedAt: batch.confirmedAt,
    batchFingerprint: legacy ? actionFingerprint : hash(canonical({
      actionFingerprint,
      retiredYwnextItemSha256: retiredYwnext ? hash(canonical(retiredYwnext)) : null
    })),
    actions: Object.fromEntries(actions.map(({ action, item }) => [action, {
      itemId: item.id,
      itemSha256: hash(canonical(item)),
      status: 'pending',
      attempts: 0
    }]))
  };
}

function confirmedMemoryItems(batch) {
  if (!Array.isArray(batch.items)) return [];
  return batch.items.filter(item => item?.domain === 'learn-x' && Array.isArray(item.targets) && item.targets.includes('memory'));
}

function memoryBinding(batch, items = confirmedMemoryItems(batch)) {
  if (!items.length) return null;
  const week = canonicalWeek(batch.reviewWeek);
  if (!week) throw new Error('invalid confirmed Learn-X Memory batch');
  const itemIds = [];
  let targetPath;
  for (const item of items) {
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item.id)
      || typeof item.value !== 'string' || typeof item.locator !== 'string') throw new Error('invalid confirmed Learn-X Memory item');
    const match = /^(01_core\/memory\/\d{4}-Q[1-4]\.memory\.md)#(\d{4}-W\d{2})\/([A-Za-z0-9][A-Za-z0-9._:-]*)$/.exec(item.locator);
    if (!match || match[2] !== week || match[3] !== item.id || (targetPath && targetPath !== match[1]) || itemIds.includes(item.id)) {
      throw new Error('confirmed Learn-X Memory identity does not match its locator');
    }
    targetPath = match[1];
    itemIds.push(item.id);
  }
  return {
    targetPath,
    week,
    itemIds,
    sourceItemsSha256: hash(canonical(items.map(({ id, locator, value }) => ({ id, locator, value }))))
  };
}

function expectedYwContextSourceRevision(batch, memoryEvidence) {
  const items = confirmedMemoryItems(batch);
  const binding = memoryBinding(batch, items);
  const sourceSha256 = memoryEvidence?.evidence?.sha256;
  if (!binding || !validSha256(sourceSha256)) return null;
  const fingerprints = items.map(item => {
    if (item.source !== 'human' || typeof item.value !== 'string' || !item.value.trim()
      || item.value.includes('\r') || item.value.length > 100_000) return null;
    const text = item.value.replace(/\n+$/u, '');
    const bodySha256 = hash(text);
    return {
      logical_id: `${binding.week}-${item.id}`,
      source_version: `memory-item-v1:${binding.week}:${bodySha256}`,
      sha256: bodySha256
    };
  });
  if (fingerprints.some(item => !item)) return null;
  fingerprints.sort((a, b) => a.logical_id.localeCompare(b.logical_id));
  const recordsSha256 = hash(canonical(fingerprints));
  return {
    sourceRevision: `${binding.week}:${sourceSha256}:${recordsSha256}`,
    recordCount: items.length,
    targetPath: binding.targetPath,
    itemIds: binding.itemIds,
    sourceSha256
  };
}

function ywcontextAction(binding) {
  if (!binding) return null;
  return {
    action: 'ywcontext',
    item: {
      id: 'automatic-ywcontext-p1-content',
      domain: 'learn-x',
      source: 'automatic-from-confirmed-memory',
      locator: `${binding.targetPath}#${binding.week}/${binding.itemIds.join(',')}`,
      targetPath: binding.targetPath,
      week: binding.week,
      itemIds: binding.itemIds,
      sourceItemsSha256: binding.sourceItemsSha256,
      value: 'Sync full confirmed Memory content to YWContext P1 after verified writeback',
      targets: ['weekly-closeout']
    }
  };
}

function legacyCloseoutPlan(batch) {
  const byAction = new Map();
  for (const item of batch.items.filter(item => item?.domain === 'learn-x' && item.targets?.includes('weekly-closeout'))) {
    const action = item.id.startsWith('closeout-') ? item.id.slice('closeout-'.length) : '';
    if (!known.has(action) || byAction.has(action)) throw new Error('invalid historical closeout action');
    byAction.set(action, item);
  }
  return {
    parallel: ['backup', 'ywnext'].filter(action => byAction.has(action)).map(action => ({ action, item: byAction.get(action) })),
    afterParallel: byAction.has('flomo') ? [{ action: 'flomo', item: byAction.get('flomo') }] : []
  };
}

function validateApprovalEvidence(state, batch) {
  if (state.approvalEvidence != null && (state.approvalEvidence?.verified !== true
    || canonicalWeek(state.approvalEvidence.week) !== canonicalWeek(batch.reviewWeek)
    || state.approvalEvidence.fingerprint !== batch.sourceBindings?.learnxMemoryFingerprint
    || (state.approvalEvidence.schemaVersion != null && ![1, 2].includes(state.approvalEvidence.schemaVersion)))) throw new Error('invalid persisted Learn-X approval evidence');
}

function validateActionStates(state, expected, legacy = false) {
  const memory = state.memoryWriteEvidence;
  for (const [action, entry] of Object.entries(state.actions)) {
    const baseline = expected.actions[action];
    if (!entry || entry.itemId !== baseline.itemId || entry.itemSha256 !== baseline.itemSha256
      || !['pending', 'running', 'completed', 'unknown', 'partial', 'conflict'].includes(entry.status)
      || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0
      || (entry.status === 'completed' && !(action === 'ywcontext'
        ? isStoredYwContextResult(entry.result, ywcontextBinding(memory, baseline))
        : isStoredVerifiedReceipt(entry.result)))) {
      throw new Error(`invalid ${legacy ? 'legacy ' : ''}closeout state for ${action}`);
    }
  }
}

async function migrateLegacyState(file, state, batch, actions) {
  const legacyPlan = legacyCloseoutPlan(batch);
  const legacyActions = [...legacyPlan.parallel, ...legacyPlan.afterParallel];
  const expectedLegacy = closeoutState(batch, legacyActions, { legacy: true });
  if (state?.schemaVersion !== 1 || state.batchId !== batch.batchId || state.reviewWeek !== batch.reviewWeek
    || state.confirmedAt !== batch.confirmedAt || state.batchFingerprint !== expectedLegacy.batchFingerprint
    || !state.actions || typeof state.actions !== 'object' || Array.isArray(state.actions)
    || Object.keys(state.actions).sort().join('\0') !== Object.keys(expectedLegacy.actions).sort().join('\0')) {
    throw new Error('legacy closeout state does not match immutable confirmed batch');
  }
  validateApprovalEvidence(state, batch);
  validateActionStates(state, expectedLegacy, true);

  const migrated = closeoutState(batch, actions);
  if (state.approvalEvidence) migrated.approvalEvidence = state.approvalEvidence;
  // v1 stored only a digest of the Memory readback. Force recovery to re-read
  // the actual target before any automatic YWContext attempt.
  migrated.memoryWriteEvidence = null;
  for (const action of ['backup', 'flomo']) {
    if (migrated.actions[action] && state.actions[action]) migrated.actions[action] = state.actions[action];
  }
  if (state.actions.ywnext) {
    migrated.retiredActions = {
      ywnext: {
        status: 'retired',
        legacyStatus: state.actions.ywnext.status,
        itemId: state.actions.ywnext.itemId,
        itemSha256: state.actions.ywnext.itemSha256,
        evidenceSha256: state.actions.ywnext.result?.evidence?.sha256 ?? null
      }
    };
  }
  await writeState(file, migrated);
  return migrated;
}

async function readState(file, batch, actions) {
  let state;
  try {
    if (!(await lstat(file)).isFile()) throw new Error('closeout state is not a regular file');
    state = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return closeoutState(batch, actions);
    throw error;
  }
  if (state?.schemaVersion === 1) return migrateLegacyState(file, state, batch, actions);
  const expected = closeoutState(batch, actions);
  if (state?.schemaVersion !== 2 || state.batchId !== batch.batchId || state.reviewWeek !== batch.reviewWeek
    || state.confirmedAt !== batch.confirmedAt || state.batchFingerprint !== expected.batchFingerprint
    || !state.actions || typeof state.actions !== 'object' || Array.isArray(state.actions)
    || Object.keys(state.actions).sort().join('\0') !== Object.keys(expected.actions).sort().join('\0')) {
    throw new Error('closeout state does not match immutable confirmed batch');
  }
  validateApprovalEvidence(state, batch);
  const itemBinding = memoryBinding(batch);
  if (state.memoryWriteEvidence != null && !isStoredMemoryWriteEvidence(state.memoryWriteEvidence, itemBinding)) throw new Error('invalid persisted Learn-X Memory readback evidence');
  validateActionStates(state, expected);
  return state;
}

function hasEvidence(evidence) {
  return typeof evidence === 'string' ? evidence.trim().length > 0
    : evidence != null && typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length > 0;
}

function evidenceDigest(evidence) {
  return { sha256: hash(canonical(evidence)) };
}

function isStoredVerifiedReceipt(value) {
  return value?.ok === true && value.status === 'verified'
    && value.evidence && typeof value.evidence === 'object' && !Array.isArray(value.evidence)
    && Object.keys(value.evidence).length === 1 && /^[a-f0-9]{64}$/.test(value.evidence.sha256 || '');
}

function validSha256(value) { return /^[a-f0-9]{64}$/.test(value || ''); }

function isStoredMemoryWriteEvidence(value, binding) {
  return Boolean(binding && value?.ok === true && value.status === 'verified'
    && value.evidence && value.evidence.targetPath === binding.targetPath
    && canonicalWeek(value.evidence.week) === binding.week
    && canonical(value.evidence.itemIds) === canonical(binding.itemIds)
    && validSha256(value.evidence.sha256));
}

function normalizeMemoryWriteEvidence(batch, evidence) {
  const binding = memoryBinding(batch);
  if (!binding) {
    if (evidence != null && !(evidence?.ok === true && evidence?.status === 'verified'
      && evidence.evidence?.week && canonicalWeek(evidence.evidence.week) === canonicalWeek(batch.reviewWeek)
      && evidence.evidence?.noMemoryWrite === true && canonical(evidence.evidence.itemIds) === '[]')) {
      throw new Error('unexpected Learn-X Memory readback evidence without Memory items');
    }
    return null;
  }
  if (!hasVerifiedCloseoutEvidence(evidence) || !isStoredMemoryWriteEvidence(evidence, binding)) {
    throw new Error('Learn-X Memory readback evidence does not match confirmed batch');
  }
  return {
    ok: true,
    status: 'verified',
    evidence: {
      targetPath: binding.targetPath,
      week: binding.week,
      itemIds: binding.itemIds,
      sha256: evidence.evidence.sha256
    }
  };
}

function validYwContextPublishReceipt(receipt, binding) {
  return Boolean(binding && receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && receipt.schema === 'yw-context-p1-publish-receipt/v1'
    && receipt.source_id === 'learn-x-memory-p1-content'
    && receipt.source_revision === binding.sourceRevision
    && receipt.source_sha256 === binding.sourceSha256
    && Number.isSafeInteger(receipt.p1_record_count) && receipt.p1_record_count === binding.recordCount
    && validSha256(receipt.p1_records_sha256)
    && validSha256(receipt.p1_bundle_sha256)
    && /^[a-z0-9][a-z0-9-]{0,99}$/.test(receipt.p2_batch_id || '')
    && /^[a-f0-9]{40}$/.test(receipt.p2_remote_commit || '')
    && /^[a-z0-9][a-z0-9-]{0,99}$/.test(receipt.batch_id || '')
    && /^[a-f0-9]{40}$/.test(receipt.published_commit || '')
    && receipt.remote_readback_commit === receipt.published_commit
    && receipt.targetPath === binding.targetPath
    && canonical(receipt.itemIds) === canonical(binding.itemIds)
    && receipt.sourceSha256 === binding.sourceSha256);
}

function isStoredYwContextResult(value, binding) {
  return value?.ok === true && value.status === 'verified' && validYwContextPublishReceipt(value.evidence, binding);
}

function isBoundYwContextRecovery(value, binding, stage) {
  const evidence = value?.evidence;
  return Boolean(binding && value?.status === stage && (stage !== 'not-applied' || value.baselineUnchanged === true)
    && evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && evidence.schema === 'yw-context-p1-resolution/v1'
    && evidence.source_id === 'learn-x-memory-p1-content'
    && evidence.source_revision === binding.sourceRevision
    && evidence.record_count === binding.recordCount
    && /^[a-z0-9][a-z0-9-]{0,99}$/.test(evidence.p1_batch_id || '')
    && /^[a-z0-9][a-z0-9-]{0,99}$/.test(evidence.p2_batch_id || '')
    && evidence.source_sha256 === binding.sourceSha256
    && evidence.targetPath === binding.targetPath
    && canonical(evidence.itemIds) === canonical(binding.itemIds)
    && /^[a-f0-9]{40}$/.test(evidence.remote_commit || '')
    && validSha256(evidence.catalog_sha256)
    && (stage === 'not-applied' ? evidence.p2_present === false && evidence.p1_present === false
      : evidence.p2_present === true && evidence.p1_present === false));
}

function ywcontextBinding(memoryEvidence, item, batch) {
  if (!memoryEvidence || !item) return null;
  const expected = expectedYwContextSourceRevision(batch, memoryEvidence);
  if (!expected || item.targetPath !== expected.targetPath || canonical(item.itemIds) !== canonical(expected.itemIds)) return null;
  return {
    ...expected
  };
}

async function writeState(file, state) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${canonical(state)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temp, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  const saved = JSON.parse(await readFile(file, 'utf8'));
  if (canonical(saved) !== canonical(state)) throw new Error('closeout state readback mismatch');
}

async function publishExclusive(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${canonical(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await link(temp, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : true; }
}

async function withBatchLock(stateRoot, batch, callback) {
  if (!stateRoot) return callback();
  const file = lockPath(stateRoot, batch);
  const token = randomUUID();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let claimed = false;
    try { await publishExclusive(file, { schemaVersion: 1, pid: process.pid, token, startedAt: new Date().toISOString() }); claimed = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await readFile(file, 'utf8')); }
      catch { return { locked: true }; }
      const alive = isProcessAlive(owner.pid);
      if (alive !== false) return { locked: true };
      try { await unlink(file); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') return { locked: true }; }
    }
    if (claimed) {
      try { return await callback(); }
      finally {
        try {
          const owner = JSON.parse(await readFile(file, 'utf8'));
          if (owner.token === token) await unlink(file);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return { locked: true };
}

export function approvedCloseoutPlan(batch, { memoryApprovalSchemaVersion } = {}) {
  if (!batch || !Array.isArray(batch.items)) throw new Error('confirmed batch required');
  const items = batch.items.filter(item => item.domain === 'learn-x' && item.targets.includes('weekly-closeout'));
  const byAction = new Map();
  for (const item of items) {
    const action = item.id.startsWith('closeout-') ? item.id.slice('closeout-'.length) : '';
    if (action === 'ywnext' && memoryApprovalSchemaVersion !== 1) throw new Error('retired YWNext action cannot enter a current closeout');
    if (!known.has(action) || byAction.has(action) || typeof item.value !== 'string' || !item.value.trim() || typeof item.locator !== 'string' || !item.locator.trim()) throw new Error('invalid confirmed closeout item');
    byAction.set(action, item);
  }
  if (byAction.has('flomo') && !byAction.has('backup')) throw new Error('Flomo requires confirmed backup');
  const automaticYwcontext = memoryApprovalSchemaVersion === 2 ? ywcontextAction(memoryBinding(batch)) : null;
  return {
    parallel: [
      ...(byAction.has('backup') ? [{ action: 'backup', item: byAction.get('backup') }] : []),
      ...(automaticYwcontext ? [automaticYwcontext] : [])
    ],
    afterParallel: byAction.has('flomo') ? [{ action: 'flomo', item: byAction.get('flomo') }] : []
  };
}

function executorParts(executor) {
  if (typeof executor === 'function') return { execute: executor, resolve: executor.resolve };
  if (executor && typeof executor === 'object') return { execute: executor.execute, resolve: executor.resolve };
  return {};
}

function resultStatus(result) {
  if (hasVerifiedCloseoutEvidence(result)) return 'completed';
  if (result?.status === 'partial') return 'partial';
  if (result?.status === 'conflict') return 'conflict';
  // A failed call may have applied its remote side effect before failing. It
  // remains unknown until an action-specific readback resolves it.
  return 'unknown';
}

function resultStatusForAction(action, result, binding) {
  if (action === 'ywcontext') {
    if (isStoredYwContextResult(result, binding)) return 'completed';
    if (result?.status === 'pending') return 'pending';
    if (result?.status === 'partial') return 'partial';
    if (result?.status === 'conflict') return 'conflict';
    return 'unknown';
  }
  return resultStatus(result);
}

function evidenceResult(action, entry) {
  return { status: entry.status, ...(entry.reason ? { reason: entry.reason } : {}), ...(entry.result ? { evidence: entry.result.evidence } : {}), action };
}

async function runApprovedCloseout({ batch, executors, stateRoot, approvalEvidence = null, memoryWriteEvidence = null, memoryApprovalSchemaVersion, recover }) {
  if (!executors || typeof executors !== 'object' || Array.isArray(executors)) throw new Error('closeout executors required');
  const plan = approvedCloseoutPlan(batch, { memoryApprovalSchemaVersion });
  const actions = [...plan.parallel, ...plan.afterParallel];
  if (!actions.length) return { results: {}, plan: { parallel: [], afterParallel: [] }, stateFile: null };
  const stateFile = stateRoot ? statePath(stateRoot, batch) : null;
  const run = async () => {
    const state = await readState(stateFile ?? '', batch, actions);
    if (approvalEvidence != null) {
      if (approvalEvidence?.verified !== true || canonicalWeek(approvalEvidence.week) !== canonicalWeek(batch.reviewWeek)
        || !/^[a-f0-9]{64}$/.test(approvalEvidence.fingerprint || '')
        || approvalEvidence.fingerprint !== batch.sourceBindings?.learnxMemoryFingerprint) throw new Error('Learn-X approval evidence does not match confirmed batch');
      const normalizedApprovalEvidence = { ...approvalEvidence, week: batch.reviewWeek };
      const sameLegacyApproval = state.approvalEvidence?.schemaVersion == null
        && state.approvalEvidence?.verified === true
        && canonicalWeek(state.approvalEvidence.week) === canonicalWeek(normalizedApprovalEvidence.week)
        && state.approvalEvidence.fingerprint === normalizedApprovalEvidence.fingerprint;
      if (state.approvalEvidence && canonical(state.approvalEvidence) !== canonical(normalizedApprovalEvidence) && !sameLegacyApproval) throw new Error('Learn-X approval evidence changed during closeout recovery');
      state.approvalEvidence = normalizedApprovalEvidence;
    }
    if (memoryWriteEvidence != null) {
      const safeProof = normalizeMemoryWriteEvidence(batch, memoryWriteEvidence);
      if (safeProof && state.memoryWriteEvidence && canonical(state.memoryWriteEvidence) !== canonical(safeProof)) throw new Error('Learn-X Memory readback evidence changed during closeout recovery');
      state.memoryWriteEvidence = safeProof;
    }
    if (stateFile && (approvalEvidence != null || memoryWriteEvidence != null)) await writeState(stateFile, state);
    const results = {};
    const executeStep = async ({ action, item }) => {
      const saved = state.actions[action];
      if (saved.status === 'completed') { results[action] = evidenceResult(action, saved); return; }
      const actionMemoryEvidence = action === 'ywcontext' ? state.memoryWriteEvidence : null;
      const publishBinding = action === 'ywcontext' ? ywcontextBinding(actionMemoryEvidence, item, batch) : null;
      if (action === 'ywcontext' && !publishBinding) {
        saved.status = 'pending'; saved.reason = 'memory-writeback-not-verified';
        if (stateFile) await writeState(stateFile, state);
        results[action] = evidenceResult(action, saved); return;
      }
      const { execute, resolve } = executorParts(executors[action]);
      if (typeof execute !== 'function') {
        saved.status = 'pending'; saved.reason = action === 'ywcontext' ? 'dynamic_ywcontext_sync_unavailable' : 'executor-unavailable';
        if (stateFile) await writeState(stateFile, state);
        results[action] = evidenceResult(action, saved); return;
      }
      if (recover && saved.status !== 'pending') {
        if (typeof resolve !== 'function') {
          saved.status = 'unknown'; saved.reason = 'readback-resolver-unavailable';
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
        let resolution;
        try { resolution = await resolve(item, batch, saved, actionMemoryEvidence); }
        catch { resolution = { status: 'unknown' }; }
        const verifiedResolution = action === 'ywcontext'
          ? isStoredYwContextResult(resolution, publishBinding)
          : hasVerifiedCloseoutEvidence(resolution);
        if (verifiedResolution) {
          saved.status = 'completed'; saved.reason = undefined;
          saved.result = {
            ok: true,
            status: 'verified',
            evidence: action === 'ywcontext' ? resolution.evidence : evidenceDigest(resolution.evidence)
          };
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
        if (resolution?.status === 'conflict') {
          saved.status = 'conflict'; saved.reason = 'target-conflict';
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
        let safeYwContextRetry = false;
        if (action === 'ywcontext') {
          const safeNotApplied = isBoundYwContextRecovery(resolution, publishBinding, 'not-applied');
          const safeP2Stage = isBoundYwContextRecovery(resolution, publishBinding, 'p2-ready-for-p1');
          safeYwContextRetry = safeNotApplied || safeP2Stage;
          if (safeYwContextRetry) {
            saved.status = 'pending';
            saved.reason = safeNotApplied ? 'authoritative-readback-proves-no-publication' : 'authoritative-readback-proves-p2-stage-complete';
            if (stateFile) await writeState(stateFile, state);
          } else {
            saved.status = resolution?.status === 'partial' ? 'partial' : resolution?.status === 'conflict' ? 'conflict' : 'unknown';
            saved.reason = saved.status === 'partial' ? 'target-partial' : saved.status === 'conflict' ? 'target-conflict' : 'ywcontext-retry-requires-authoritative-readback';
            if (stateFile) await writeState(stateFile, state);
            results[action] = evidenceResult(action, saved); return;
          }
        }
        const safeGenericRetry = resolution?.status === 'not-applied'
          && resolution.baselineUnchanged === true && hasEvidence(resolution.evidence);
        if (!safeYwContextRetry && !safeGenericRetry) {
          saved.status = resolution?.status === 'partial' ? 'partial' : 'unknown';
          saved.reason = resolution?.status === 'partial' ? 'target-partial' : 'readback-does-not-prove-safe-retry';
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
      } else if (recover && ['running', 'unknown', 'partial', 'conflict'].includes(saved.status)) {
        saved.status = 'unknown'; saved.reason = 'readback-resolver-unavailable';
        if (stateFile) await writeState(stateFile, state);
        results[action] = evidenceResult(action, saved); return;
      }

      saved.status = 'running';
      saved.attempts += 1;
      saved.lastAttemptAt = new Date().toISOString();
      delete saved.reason;
      if (stateFile) await writeState(stateFile, state);
      try {
        const result = await execute(item, batch, actionMemoryEvidence);
        const verified = action === 'ywcontext'
          ? isStoredYwContextResult(result, publishBinding)
          : hasVerifiedCloseoutEvidence(result);
        saved.status = verified ? 'completed' : resultStatusForAction(action, result, publishBinding);
        saved.result = {
          ok: verified,
          status: verified ? 'verified' : (result?.status ?? 'unknown'),
          ...(verified ? { evidence: action === 'ywcontext' ? result.evidence : evidenceDigest(result.evidence) } : {})
        };
        if (saved.status !== 'completed') saved.reason = action === 'ywcontext' && /^[a-z0-9._-]{1,100}$/.test(result?.error_code || '')
          ? result.error_code : 'completion-evidence-unverified';
      } catch (error) {
        saved.status = 'unknown';
        saved.reason = 'executor-threw';
        saved.errorType = String(error?.name ?? 'Error');
        delete saved.result;
      }
      if (stateFile) await writeState(stateFile, state);
      results[action] = evidenceResult(action, saved);
    };

    // Each step updates the same durable state object and atomically replaces
    // the same ledger file. Keep this phase sequential so concurrent readback
    // checks cannot race or persist a stale snapshot.
    for (const step of plan.parallel) await executeStep(step);
    for (const step of plan.afterParallel) {
      const prerequisites = step.action === 'flomo' ? ['backup'] : [];
      const failed = prerequisites.find(action => results[action]?.status !== 'completed');
      if (failed) {
        const saved = state.actions[step.action];
        if (saved.status !== 'completed') {
          saved.status = 'pending'; saved.reason = `prerequisite-${failed}-not-complete`;
          if (stateFile) await writeState(stateFile, state);
        }
        results[step.action] = evidenceResult(step.action, saved);
        continue;
      }
      await executeStep(step);
    }
    return { results, plan: { parallel: plan.parallel.map(x => x.action), afterParallel: plan.afterParallel.map(x => x.action) }, stateFile };
  };
  return withBatchLock(stateRoot, batch, run);
}

export async function inspectApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion }) {
  if (!stateRoot) throw new Error('closeout state root required');
  const hasMemoryWrites = confirmedMemoryItems(batch).length > 0;
  if (hasMemoryWrites && ![1, 2].includes(memoryApprovalSchemaVersion)) {
    return {
      complete: false,
      results: { ywcontext: { status: 'pending', reason: 'memory-approval-version-unverified', action: 'ywcontext' } },
      approvalEvidence: null,
      memoryWriteEvidence: null,
      stateFile: statePath(stateRoot, batch)
    };
  }
  const plan = approvedCloseoutPlan(batch, { memoryApprovalSchemaVersion });
  const actions = [...plan.parallel, ...plan.afterParallel];
  if (!actions.length) return { complete: true, results: {}, stateFile: null };
  const file = statePath(stateRoot, batch);
  const state = await readState(file, batch, actions);
  const results = Object.fromEntries(Object.entries(state.actions).map(([action, entry]) => [action, evidenceResult(action, entry)]));
  return {
    complete: Object.values(state.actions).every(entry => entry.status === 'completed'),
    results,
    approvalEvidence: state.approvalEvidence ?? null,
    memoryWriteEvidence: state.memoryWriteEvidence ?? null,
    stateFile: file
  };
}

export async function executeApprovedCloseout(options) {
  return runApprovedCloseout({ ...options, recover: false });
}

export async function recoverApprovedCloseout(options) {
  return runApprovedCloseout({ ...options, recover: true });
}

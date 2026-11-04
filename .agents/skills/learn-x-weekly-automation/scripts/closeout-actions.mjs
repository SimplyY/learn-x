import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, link, unlink, rename, lstat } from 'node:fs/promises';
import path from 'node:path';

// The confirmed batch is the only source of authority for optional Learn-X
// closeout. Each selected action has its own durable state so Core targets and
// Learn-X closeout can recover independently.
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

function closeoutState(batch, actions) {
  return {
    schemaVersion: 1,
    batchId: batch.batchId,
    reviewWeek: batch.reviewWeek,
    confirmedAt: batch.confirmedAt,
    batchFingerprint: batchIdentity(batch, actions),
    actions: Object.fromEntries(actions.map(({ action, item }) => [action, {
      itemId: item.id,
      itemSha256: hash(canonical(item)),
      status: 'pending',
      attempts: 0
    }]))
  };
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
  const expected = closeoutState(batch, actions);
  if (state?.schemaVersion !== 1 || state.batchId !== batch.batchId || state.reviewWeek !== batch.reviewWeek
    || state.confirmedAt !== batch.confirmedAt || state.batchFingerprint !== expected.batchFingerprint
    || !state.actions || typeof state.actions !== 'object' || Array.isArray(state.actions)
    || Object.keys(state.actions).sort().join('\0') !== Object.keys(expected.actions).sort().join('\0')) {
    throw new Error('closeout state does not match immutable confirmed batch');
  }
  if (state.approvalEvidence != null && (state.approvalEvidence?.verified !== true
    || canonicalWeek(state.approvalEvidence.week) !== canonicalWeek(batch.reviewWeek)
    || state.approvalEvidence.fingerprint !== batch.sourceBindings?.learnxMemoryFingerprint)) throw new Error('invalid persisted Learn-X approval evidence');
  if (state.memoryWriteEvidence != null && !isStoredVerifiedReceipt(state.memoryWriteEvidence)) throw new Error('invalid persisted Learn-X Memory readback evidence');
  for (const [action, entry] of Object.entries(state.actions)) {
    const baseline = expected.actions[action];
    if (!entry || entry.itemId !== baseline.itemId || entry.itemSha256 !== baseline.itemSha256
      || !['pending', 'running', 'completed', 'unknown', 'partial', 'conflict'].includes(entry.status)
      || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0
      || (entry.status === 'completed' && !isStoredVerifiedReceipt(entry.result))) {
      throw new Error(`invalid closeout state for ${action}`);
    }
  }
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

export function approvedCloseoutPlan(batch) {
  if (!batch || !Array.isArray(batch.items)) throw new Error('confirmed batch required');
  const items = batch.items.filter(item => item.domain === 'learn-x' && item.targets.includes('weekly-closeout'));
  const byAction = new Map();
  for (const item of items) {
    const action = item.id.startsWith('closeout-') ? item.id.slice('closeout-'.length) : '';
    if (!known.has(action) || byAction.has(action) || typeof item.value !== 'string' || !item.value.trim() || typeof item.locator !== 'string' || !item.locator.trim()) throw new Error('invalid confirmed closeout item');
    byAction.set(action, item);
  }
  if (byAction.has('flomo') && (!byAction.has('backup') || !byAction.has('ywnext'))) throw new Error('Flomo requires confirmed backup and YW Next steps');
  return {
    parallel: ['backup', 'ywnext'].filter(action => byAction.has(action)).map(action => ({ action, item: byAction.get(action) })),
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

function evidenceResult(action, entry) {
  return { status: entry.status, ...(entry.reason ? { reason: entry.reason } : {}), ...(entry.result ? { evidence: entry.result.evidence } : {}), action };
}

async function runApprovedCloseout({ batch, executors, stateRoot, approvalEvidence = null, memoryWriteEvidence = null, recover }) {
  if (!executors || typeof executors !== 'object' || Array.isArray(executors)) throw new Error('closeout executors required');
  const plan = approvedCloseoutPlan(batch);
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
      if (state.approvalEvidence && canonical(state.approvalEvidence) !== canonical(normalizedApprovalEvidence)) throw new Error('Learn-X approval evidence changed during closeout recovery');
      state.approvalEvidence = normalizedApprovalEvidence;
    }
    if (memoryWriteEvidence != null) {
      if (!hasVerifiedCloseoutEvidence(memoryWriteEvidence)) throw new Error('Learn-X Memory readback evidence is not verified');
      const safeProof = isStoredVerifiedReceipt(memoryWriteEvidence)
        ? memoryWriteEvidence
        : { ok: true, status: 'verified', evidence: evidenceDigest(memoryWriteEvidence.evidence) };
      if (state.memoryWriteEvidence && canonical(state.memoryWriteEvidence) !== canonical(safeProof)) throw new Error('Learn-X Memory readback evidence changed during closeout recovery');
      state.memoryWriteEvidence = safeProof;
    }
    if (stateFile && (approvalEvidence != null || memoryWriteEvidence != null)) await writeState(stateFile, state);
    const results = {};
    const executeStep = async ({ action, item }) => {
      const saved = state.actions[action];
      if (saved.status === 'completed') { results[action] = evidenceResult(action, saved); return; }
      const { execute, resolve } = executorParts(executors[action]);
      if (typeof execute !== 'function') {
        saved.status = 'pending'; saved.reason = 'executor-unavailable';
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
        try { resolution = await resolve(item, batch, saved); }
        catch { resolution = { status: 'unknown' }; }
        if (hasVerifiedCloseoutEvidence(resolution)) {
          saved.status = 'completed'; saved.reason = undefined;
          saved.result = { ok: true, status: 'verified', evidence: evidenceDigest(resolution.evidence) };
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
        if (resolution?.status === 'conflict') {
          saved.status = 'conflict'; saved.reason = 'target-conflict';
          if (stateFile) await writeState(stateFile, state);
          results[action] = evidenceResult(action, saved); return;
        }
        if (!(resolution?.status === 'not-applied' && resolution.baselineUnchanged === true && hasEvidence(resolution.evidence))) {
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
        const result = await execute(item, batch);
        saved.status = resultStatus(result);
        saved.result = {
          ok: hasVerifiedCloseoutEvidence(result),
          status: hasVerifiedCloseoutEvidence(result) ? 'verified' : (result?.status ?? 'unknown'),
          ...(hasVerifiedCloseoutEvidence(result) ? { evidence: evidenceDigest(result.evidence) } : {})
        };
        if (saved.status !== 'completed') saved.reason = 'completion-evidence-unverified';
      } catch (error) {
        saved.status = 'unknown';
        saved.reason = 'executor-threw';
        saved.errorType = String(error?.name ?? 'Error');
        delete saved.result;
      }
      if (stateFile) await writeState(stateFile, state);
      results[action] = evidenceResult(action, saved);
    };

    await Promise.all(plan.parallel.map(executeStep));
    for (const step of plan.afterParallel) {
      const prerequisites = step.action === 'flomo' ? ['backup', 'ywnext'] : [];
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

export async function inspectApprovedCloseout({ batch, stateRoot }) {
  if (!stateRoot) throw new Error('closeout state root required');
  const plan = approvedCloseoutPlan(batch);
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

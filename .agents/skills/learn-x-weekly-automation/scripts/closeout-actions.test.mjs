import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { approvedCloseoutPlan, executeApprovedCloseout, inspectApprovedCloseout, recoverApprovedCloseout } from './closeout-actions.mjs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const item = action => ({ id: `closeout-${action}`, domain: 'learn-x', targets: ['weekly-closeout'], locator: `/target/${action}`, value: `approved ${action}` });
const memoryItem = () => ({ id: 'memory-1', domain: 'learn-x', source: 'human', targets: ['memory'], locator: '01_core/memory/2026-Q3.memory.md#2026-W40/memory-1', value: '- confirmed full Memory text\n' });
const memoryProof = (sha = 'a'.repeat(64)) => ({ ok: true, status: 'verified', evidence: { targetPath: '01_core/memory/2026-Q3.memory.md', week: '2026-W40', itemIds: ['memory-1'], sha256: sha } });
const batchWithMemory = extraItems => ({ batchId: 'batch-ywcontext-test', reviewWeek: '2026-W40', confirmedAt: '2026-10-31T10:00:00+08:00', sourceBindings: { learnxMemoryFingerprint: 'f'.repeat(64) }, items: [memoryItem(), ...extraItems] });
const expectedSourceRevision = proof => {
  const week = '2026-W40';
  const value = memoryItem().value.replace(/\n+$/u, '');
  const bodySha256 = hash(value);
  const rows = [{ logical_id: `${week}-memory-1`, source_version: `memory-item-v1:${week}:${bodySha256}`, sha256: bodySha256 }];
  return `${week}:${proof.evidence.sha256}:${hash(canonical(rows))}`;
};
const ywcontextReceipt = proof => ({ ok: true, status: 'verified', evidence: {
  schema: 'yw-context-p1-publish-receipt/v1', source_id: 'learn-x-memory-p1-content', source_revision: expectedSourceRevision(proof),
  source_sha256: proof.evidence.sha256, p1_record_count: proof.evidence.itemIds.length,
  p2_batch_id: 'learn-x-memory-abc123', p2_remote_commit: 'd'.repeat(40), batch_id: 'learn-x-memory-p1-content-abc123',
  p1_records_sha256: 'b'.repeat(64), published_commit: 'c'.repeat(40), remote_readback_commit: 'c'.repeat(40),
  p1_bundle_sha256: 'e'.repeat(64), targetPath: proof.evidence.targetPath, itemIds: proof.evidence.itemIds,
  sourceSha256: proof.evidence.sha256
} });
const ywcontextResolution = (proof, stage = 'p2-ready-for-p1') => ({
  schema: 'yw-context-p1-resolution/v1', source_id: 'learn-x-memory-p1-content',
  p1_batch_id: 'learn-x-memory-p1-content-abc123', p2_batch_id: 'learn-x-memory-abc123',
  source_revision: expectedSourceRevision(proof), record_count: proof.evidence.itemIds.length,
  source_sha256: proof.evidence.sha256, targetPath: proof.evidence.targetPath, itemIds: proof.evidence.itemIds,
  remote_commit: 'd'.repeat(40), catalog_sha256: 'e'.repeat(64),
  p2_present: stage === 'p2-ready-for-p1', p1_present: false
});
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

test('v2 Memory writeback automatically schedules full-content YWContext', async () => {
  const calls = [];
  const batch = batchWithMemory([item('backup'), item('flomo'), { id:'candidate', domain:'core', targets:['export'], locator:'x', value:'not a closeout' }]);
  assert.deepEqual(approvedCloseoutPlan(batch, { memoryApprovalSchemaVersion: 2 }).parallel.map(x => x.action), ['backup', 'ywcontext']);
  const proof = memoryProof();
  const result = await executeApprovedCloseout({ batch, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof, executors: {
    backup: async () => { calls.push('backup'); return { ok: true, status: 'verified', evidence: 'backup readback' }; },
    ywnext: async () => { calls.push('ywnext'); return { ok: true, status: 'verified', evidence: 'must not run' }; },
    ywcontext: async (_item, _batch, receivedProof) => { calls.push('ywcontext'); assert.deepEqual(receivedProof, proof); return ywcontextReceipt(proof); },
    flomo: async () => { calls.push('flomo'); return { ok: true, status: 'verified', evidence: 'Flomo readback' }; }
  } });
  assert.deepEqual(calls.sort(), ['backup','flomo','ywcontext']);
  assert.deepEqual(result.plan, { parallel:['backup','ywcontext'], afterParallel:['flomo'] });
  assert.equal(result.results.ywcontext.status, 'completed');
});

test('failed backup suppresses Flomo while independent automatic YWContext can proceed', async () => {
  const calls = [];
  const batch = batchWithMemory([item('backup'), item('flomo')]);
  const proof = memoryProof();
  const result = await executeApprovedCloseout({ batch, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof, executors: {
    backup: async () => { calls.push('backup'); throw new Error('backup failed'); },
    ywcontext: async () => { calls.push('ywcontext'); return ywcontextReceipt(proof); },
    flomo: async () => calls.push('flomo'),
    image: async () => calls.push('unapproved-image')
  } });
  assert.deepEqual(calls.sort(), ['backup','ywcontext']);
  assert.equal(result.results.flomo.status, 'pending');
  assert.equal(result.results.image, undefined);
});

test('invalid YWContext receipt remains unknown and does not gate Flomo', async () => {
  const calls = [];
  const batch = batchWithMemory([item('backup'), item('flomo')]);
  const proof = memoryProof();
  const invalidReceipt = ywcontextReceipt(proof);
  invalidReceipt.evidence.remote_readback_commit = 'e'.repeat(40);
  const result = await executeApprovedCloseout({ batch, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof, executors: {
    backup: async () => ({ ok: true, status: 'verified', evidence: 'backup readback' }),
    ywcontext: async () => invalidReceipt,
    flomo: async () => { calls.push('flomo'); return { ok: true, status: 'verified', evidence: 'Flomo readback' }; }
  } });
  assert.equal(result.results.ywcontext.status, 'unknown');
  assert.equal(result.results.flomo.status, 'completed');
  assert.deepEqual(calls, ['flomo']);
});

test('missing dynamic publisher stays pending; mismatched Memory receipt blocks invocation', async () => {
  const batch = batchWithMemory([]);
  const pending = await executeApprovedCloseout({ batch, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: memoryProof(), executors: {} });
  assert.equal(pending.results.ywcontext.status, 'pending');
  assert.equal(pending.results.ywcontext.reason, 'dynamic_ywcontext_sync_unavailable');
  let calls = 0;
  await assert.rejects(executeApprovedCloseout({ batch, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: { ...memoryProof(), evidence: { ...memoryProof().evidence, itemIds: ['other-id'] } }, executors: { ywcontext: async () => { calls += 1; } } }), /does not match confirmed batch/);
  assert.equal(calls, 0);
});

test('P2-only remote publication is verified before safely resuming the P1 publication stage', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-ywcontext-recovery-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = batchWithMemory([]);
  const proof = memoryProof();
  let calls = 0;
  await executeApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof,
    executors: { ywcontext: async () => { calls += 1; return { status: 'unknown' }; } } });
  const recovered = await recoverApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion: 2,
    executors: { ywcontext: Object.assign(async () => { calls += 1; return ywcontextReceipt(proof); }, {
      resolve: async () => ({ status: 'p2-ready-for-p1', evidence: ywcontextResolution(proof) })
    }) } });
  assert.equal(recovered.results.ywcontext.status, 'completed');
  assert.equal(calls, 2);
});

test('P2-stage recovery requires the exact confirmed source revision and record count', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-ywcontext-p2-binding-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = batchWithMemory([]);
  const proof = memoryProof();
  for (const invalid of [
    { source_revision: undefined, record_count: undefined },
    { source_revision: 'other-revision', record_count: 1 },
    { source_revision: expectedSourceRevision(proof), record_count: 2 },
  ]) {
    const scopedRoot = await mkdtemp(path.join(stateRoot, 'case-'));
    let calls = 0;
    await executeApprovedCloseout({ batch, stateRoot: scopedRoot, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof,
      executors: { ywcontext: async () => { calls += 1; return { status: 'unknown' }; } } });
    const evidence = { ...ywcontextResolution(proof), ...invalid };
    const recovered = await recoverApprovedCloseout({ batch, stateRoot: scopedRoot, memoryApprovalSchemaVersion: 2,
      executors: { ywcontext: Object.assign(async () => { calls += 1; return ywcontextReceipt(proof); }, {
        resolve: async () => ({ status: 'p2-ready-for-p1', evidence })
      }) } });
    assert.equal(recovered.results.ywcontext.status, 'unknown');
    assert.equal(calls, 1);
  }
});

test('unbound YWContext not-applied claims do not trigger an automatic retry', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-ywcontext-unbound-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = batchWithMemory([]);
  const proof = memoryProof();
  let calls = 0;
  await executeApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion: 2, memoryWriteEvidence: proof,
    executors: { ywcontext: async () => { calls += 1; return { status: 'unknown' }; } } });
  const recovered = await recoverApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion: 2,
    executors: { ywcontext: Object.assign(async () => { calls += 1; return ywcontextReceipt(proof); }, {
      resolve: async () => ({ status: 'not-applied', baselineUnchanged: true, evidence: { statement: 'no write' } })
    }) } });
  assert.equal(recovered.results.ywcontext.status, 'unknown');
  assert.equal(calls, 1);
});

test('empty evidence cannot be used as positive completion proof', async () => {
  const batch = { items: [item('backup')] };
  const result = await executeApprovedCloseout({ batch, executors: { backup: async () => ({ ok: true, status: 'verified', evidence: {} }) } });
  assert.equal(result.results.backup.status, 'unknown');
  assert.equal(result.results.backup.reason, 'completion-evidence-unverified');
});

test('invalid or legacy closeout entries cannot authorize a hidden action', () => {
  assert.throws(() => approvedCloseoutPlan({ items:[item('retention')] }), /invalid/);
  assert.throws(() => approvedCloseoutPlan({ items:[item('image')] }), /invalid/);
  assert.throws(() => approvedCloseoutPlan({ items:[item('flomo')] }), /requires confirmed backup/);
  assert.throws(() => approvedCloseoutPlan({ items:[item('backup'), item('backup')] }), /invalid/);
  assert.throws(() => approvedCloseoutPlan({ items:[item('ywnext')] }), /retired YWNext/);
});

test('逐动作状态落盘；未知结果先核查，只有证明未落地且基线未变才重试', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-state-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = { batchId: 'batch-closeout-recovery', reviewWeek: '2026-W40', confirmedAt: '2026-10-31T10:00:00+08:00', sourceBindings: { learnxMemoryFingerprint: 'a'.repeat(64) }, items: [item('backup')] };
  let writes = 0;
  const first = await executeApprovedCloseout({ batch, stateRoot, approvalEvidence: { verified: true, week: batch.reviewWeek, fingerprint: 'a'.repeat(64) }, executors: { backup: async () => { writes += 1; throw new Error('transport lost after request'); } } });
  assert.equal(first.results.backup.status, 'unknown');
  const saved = await inspectApprovedCloseout({ batch, stateRoot });
  assert.equal(saved.complete, false);
  assert.equal(saved.results.backup.status, 'unknown');
  const unknown = await recoverApprovedCloseout({ batch, stateRoot, executors: { backup: Object.assign(async () => { writes += 1; return { ok: true, status: 'verified', evidence: 'readback' }; }, { resolve: async () => ({ status: 'unknown', evidence: 'target unavailable' }) }) } });
  assert.equal(unknown.results.backup.status, 'unknown');
  assert.equal(writes, 1);
  const recovered = await recoverApprovedCloseout({ batch, stateRoot, executors: { backup: Object.assign(async () => { writes += 1; return { ok: true, status: 'verified', evidence: { readback: 'backup index entry' } }; }, { resolve: async () => ({ status: 'not-applied', baselineUnchanged: true, evidence: 'destination unchanged at original hash' }) }) } });
  assert.equal(recovered.results.backup.status, 'completed');
  assert.equal(writes, 2);
  assert.equal((await inspectApprovedCloseout({ batch, stateRoot })).complete, true);
  const ledger = JSON.parse(await readFile(recovered.stateFile, 'utf8'));
  assert.equal(ledger.reviewWeek, batch.reviewWeek);
  assert.equal(ledger.confirmedAt, batch.confirmedAt);
  assert.equal(ledger.actions.backup.attempts, 2);
  assert.deepEqual(Object.keys(ledger.actions.backup.result.evidence), ['sha256']);
  assert.equal((await stat(recovered.stateFile)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(recovered.stateFile))).mode & 0o777, 0o700);
});

test('v1 YWNext closeout state migrates as retired and cannot satisfy automatic YWContext', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-retire-ywnext-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const backup = item('backup');
  const ywnext = item('ywnext');
  const flomo = item('flomo');
  const batch = batchWithMemory([backup, ywnext, flomo]);
  const oldActions = [['backup', backup], ['ywnext', ywnext], ['flomo', flomo]];
  const fingerprint = hash(canonical({
    batchId: batch.batchId,
    reviewWeek: batch.reviewWeek,
    confirmedAt: batch.confirmedAt,
    actions: oldActions.map(([action, actionItem]) => ({ action, itemId: actionItem.id, itemSha256: hash(canonical(actionItem)) }))
  }));
  const digest = value => ({ ok: true, status: 'verified', evidence: { sha256: hash(canonical(value)) } });
  const state = {
    schemaVersion: 1,
    batchId: batch.batchId,
    reviewWeek: batch.reviewWeek,
    confirmedAt: batch.confirmedAt,
    batchFingerprint: fingerprint,
    memoryWriteEvidence: { ok: true, status: 'verified', evidence: { sha256: 'a'.repeat(64) } },
    actions: Object.fromEntries(oldActions.map(([action, actionItem]) => [action, {
      itemId: actionItem.id,
      itemSha256: hash(canonical(actionItem)),
      status: 'completed',
      attempts: 1,
      result: digest({ action })
    }]))
  };
  const stateFile = path.join(stateRoot, 'runtime/weekly-review', batch.reviewWeek, 'closeout', `${batch.batchId}.json`);
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state));
  const calls = [];
  const result = await recoverApprovedCloseout({ batch, stateRoot, memoryApprovalSchemaVersion: 1, executors: {
    backup: async () => calls.push('backup'),
    ywcontext: async () => calls.push('ywcontext'),
    flomo: async () => calls.push('flomo')
  } });
  assert.deepEqual(calls, []);
  assert.equal(result.results.ywcontext, undefined);
  assert.equal(result.results.backup.status, 'completed');
  assert.equal(result.results.flomo.status, 'completed');
  const migrated = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.actions.ywnext, undefined);
  assert.equal(migrated.actions.ywcontext, undefined);
  assert.equal(migrated.retiredActions.ywnext.status, 'retired');
  assert.equal(migrated.retiredActions.ywnext.legacyStatus, 'completed');
  assert.equal(migrated.memoryWriteEvidence, null);
});

test('恢复读取已完成动作的回执，不重复执行；失配批次拒绝使用旧状态', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-receipt-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = { batchId: 'batch-closeout-proof', reviewWeek: '2026-W40', confirmedAt: '2026-10-31T10:00:00+08:00', items: [item('backup')] };
  let writes = 0;
  const executors = { backup: async () => { writes += 1; return { ok: true, status: 'verified', evidence: { file: 'snapshot', sha256: 'b'.repeat(64) } }; } };
  await executeApprovedCloseout({ batch, stateRoot, executors });
  const repeated = await recoverApprovedCloseout({ batch, stateRoot, executors });
  assert.equal(repeated.results.backup.status, 'completed');
  assert.equal(writes, 1);
  await assert.rejects(inspectApprovedCloseout({ batch: { ...batch, confirmedAt: '2026-10-31T11:00:00+08:00' }, stateRoot }), /does not match/);
});

test('同一确认批次并发触发只允许一个收尾执行器运行', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'closeout-lock-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const batch = { batchId: 'batch-closeout-lock', reviewWeek: '2026-W40', confirmedAt: '2026-10-31T10:00:00+08:00', items: [item('backup')] };
  let calls = 0;
  let started;
  let release;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const executors = { backup: async () => { calls += 1; started(); await gate; return { ok: true, status: 'verified', evidence: { sha256: 'c'.repeat(64) } }; } };
  const firstPromise = executeApprovedCloseout({ batch, stateRoot, executors });
  await startedPromise;
  const second = await executeApprovedCloseout({ batch, stateRoot, executors });
  assert.equal(second.locked, true);
  release();
  const first = await firstPromise;
  assert.equal(first.results.backup.status, 'completed');
  assert.equal(calls, 1);
});

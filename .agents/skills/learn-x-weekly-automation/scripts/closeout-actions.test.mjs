import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedCloseoutPlan, executeApprovedCloseout, inspectApprovedCloseout, recoverApprovedCloseout } from './closeout-actions.mjs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const item = action => ({ id: `closeout-${action}`, domain: 'learn-x', targets: ['weekly-closeout'], locator: `/target/${action}`, value: `approved ${action}` });

test('only explicitly confirmed steps are scheduled; Flomo waits for selected backup and YW Next', async () => {
  const calls = [];
  const batch = { items: [item('backup'), item('ywnext'), item('flomo'), { id:'candidate', domain:'core', targets:['export'], locator:'x', value:'not a closeout' }] };
  assert.deepEqual(approvedCloseoutPlan(batch).parallel.map(x => x.action), ['backup', 'ywnext']);
  const result = await executeApprovedCloseout({ batch, executors: Object.fromEntries(['backup','ywnext','flomo'].map(action => [action, async () => { calls.push(action); return { ok: true, status: 'verified', evidence: { readback: `${action}-readback` } }; }])) });
  assert.deepEqual(calls.sort(), ['backup','flomo','ywnext']);
  assert.deepEqual(result.plan, { parallel:['backup','ywnext'], afterParallel:['flomo'] });
});

test('excluded actions never run and failed prerequisite suppresses dependent Flomo', async () => {
  const calls = [];
  const batch = { items: [item('backup'), item('ywnext'), item('flomo')] };
  const result = await executeApprovedCloseout({ batch, executors: {
    backup: async () => { calls.push('backup'); throw new Error('backup failed'); },
    ywnext: async () => { calls.push('ywnext'); return { ok: true, status:'verified', evidence: 'YW Next output validation' }; },
    flomo: async () => calls.push('flomo'),
    image: async () => calls.push('unapproved-image')
  } });
  assert.deepEqual(calls.sort(), ['backup','ywnext']);
  assert.equal(result.results.flomo.status, 'pending');
  assert.equal(result.results.image, undefined);
});

test('executor return without positive readback evidence is not completed and blocks dependent Flomo', async () => {
  const calls = [];
  const batch = { items: [item('backup'), item('ywnext'), item('flomo')] };
  const result = await executeApprovedCloseout({ batch, executors: {
    backup: async () => ({ ok: false, status: 'failed' }),
    ywnext: async () => ({ ok: true }),
    flomo: async () => { calls.push('flomo'); return { ok: true, status: 'verified', evidence: 'should not run' }; }
  } });
  assert.equal(result.results.backup.status, 'unknown');
  assert.equal(result.results.ywnext.status, 'unknown');
  assert.equal(result.results.flomo.status, 'pending');
  assert.deepEqual(calls, []);
});

test('unknown and partial executor results remain recoverable states', async () => {
  const batch = { items: [item('backup'), item('ywnext')] };
  const result = await executeApprovedCloseout({ batch, executors: {
    backup: async () => ({ status: 'partial', evidence: 'uploaded but not read back' }),
    ywnext: async () => ({ ok: true, status: 'verified', evidence: 'checked output files' })
  } });
  assert.equal(result.results.backup.status, 'partial');
  assert.equal(result.results.ywnext.status, 'completed');
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
  assert.throws(() => approvedCloseoutPlan({ items:[item('flomo')] }), /requires confirmed/);
  assert.throws(() => approvedCloseoutPlan({ items:[item('backup'), item('backup')] }), /invalid/);
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

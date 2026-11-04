import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recoverCodexConfirmedBatches } from './unified-confirmation.mjs';
import { bindWeeklyMemoryApproval, prepareWeeklyMemory, verifyConfirmedWeeklyMemoryWrite, verifyWeeklyMemoryApproval, verifyWeeklyMemoryApprovalSources } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';

const coreRoot = '/Users/yuwei/code/core';
const week = '2026-W40';
const confirmedAt = '2026-10-31T09:00:00+08:00';
const sourceBindings = { coreReview: { docId: 'review-doc', revisionId: 'r-1', documentSha256: 'a'.repeat(64), proposalSha256: 'b'.repeat(64) } };

async function makeBatch(root, reviewWeek = week) {
  const { prepareConfirmationCard, confirmCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const card = prepareConfirmationCard({ reviewWeek, items: [{ id: 'core-summary', domain: 'core', source: 'human', locator: 'Core B 行 1｜本周行动', originalValue: '', value: 'Synthetic approved weekly action', targets: ['export'] }], sourceBindings });
  return confirmCard({ root, card, messageId: `reply-${reviewWeek}`, expectedSender: 'codex-user', hostEvidence: { schemaVersion: 1, threadId: `thread-${reviewWeek}`, displayMessageId: `display-${reviewWeek}`, displayTurnId: 'display-turn', confirmationTurnId: 'confirm-turn', displayTurnIndex: 1, confirmationTurnIndex: 0 }, fetchConfirmation: async id => ({ id, sender: 'codex-user', text: card.confirmationText, sentAt: confirmedAt }) });
}

test('既有周流程扫描所有历史未完成批次并只调用不完整项', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const first = await makeBatch(stateRoot, '2026-W39');
  const second = await makeBatch(stateRoot, '2026-W40');
  const calls = [];
  const syncBatch = async args => { calls.push(args.batchFile); return { ok: false, batchId: path.basename(args.batchFile, '.json'), targets: { overview: { result: 'unknown' } } }; };
  const host = { readThread: async () => ({}) };
  const verifyConfirmation = async () => ({ ok: true, evidence: 'mock trusted host reread' });
  const initial = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, host, syncBatch, verifyConfirmation });
  assert.equal(initial.considered, 2);
  assert.equal(initial.pending.length, 2);
  assert.deepEqual(new Set(calls), new Set([first.file, second.file]));

  const { publishConfirmedExport } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  await publishConfirmedExport({ root: stateRoot, batchFile: first.file, verifyConfirmation: async () => ({ ok: true, evidence: 'mock official host' }) });
  calls.length = 0;
  const next = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, host, syncBatch, verifyConfirmation });
  assert.equal(next.considered, 2);
  assert.equal(next.completed.filter(item => item.status === 'already-complete').length, 1);
  assert.deepEqual(calls, [second.file]);
});

test('没有官方线程读取器时保留待恢复状态，不触发写入', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-host-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  await makeBatch(stateRoot);
  let writes = 0;
  const result = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, syncBatch: async () => { writes += 1; return { ok: true }; } });
  assert.equal(result.pending[0].status, 'awaiting-host');
  assert.equal(writes, 0);
});

test('Core 暂缓时恢复 Learn-X-only 收尾，并对未知结果先核查再安全重试', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-learnx-only-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const { prepareConfirmationCard, confirmCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const card = prepareConfirmationCard({
    reviewWeek: week,
    sourceBindings: { learnxMemoryFingerprint: 'c'.repeat(64) },
    items: [{ id: 'closeout-backup', domain: 'learn-x', source: 'human', locator: 'Learn-X Backups / index', originalValue: '', value: '备份已确认目录并校验', targets: ['weekly-closeout'] }]
  });
  const { batch } = await confirmCard({ root: stateRoot, card, messageId: 'learnx-only-reply', expectedSender: 'codex-user', hostEvidence: { schemaVersion: 1, threadId: 'learnx-only-thread', displayMessageId: 'learnx-only-display', displayTurnId: 'display-turn', confirmationTurnId: 'confirm-turn', displayTurnIndex: 1, confirmationTurnIndex: 0 }, fetchConfirmation: async id => ({ id, sender: 'codex-user', text: card.confirmationText, sentAt: confirmedAt }) });
  const host = { readThread: async () => ({}) };
  const verifyConfirmation = async () => ({ ok: true, evidence: 'mock host readback' });
  const verifyMemoryApproval = async ({ week: approvedWeek, fingerprint }) => ({ verified: true, week: approvedWeek, fingerprint });
  let writes = 0;
  const unknownExecutors = { backup: Object.assign(async () => { writes += 1; throw new Error('mock transport lost'); }, { resolve: async () => ({ status: 'unknown', evidence: 'mock target unavailable' }) }) };
  const first = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, host, verifyConfirmation, verifyMemoryApproval, closeoutExecutors: unknownExecutors });
  assert.equal(first.considered, 1);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.pending[0].status, 'pending_recovery');
  assert.equal(first.pending[0].outcomes.learnXCloseout.results.backup.status, 'unknown');
  assert.equal(writes, 1);
  const safeExecutors = { backup: Object.assign(async () => ({ ok: true, status: 'verified', evidence: { backupIndex: 'mock-readback' } }), { resolve: async () => ({ status: 'not-applied', baselineUnchanged: true, evidence: 'mock unchanged baseline' }) }) };
  const recovered = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, host, verifyConfirmation, verifyMemoryApproval, closeoutExecutors: safeExecutors });
  assert.equal(recovered.completed[0].status, 'recovered');
  assert.equal(recovered.pending.length, 0);
  assert.equal(writes, 1);
  const ledger = JSON.parse(await readFile(path.join(stateRoot, 'runtime/weekly-review', week, 'closeout', `${batch.batchId}.json`), 'utf8'));
  assert.equal(ledger.reviewWeek, week);
  assert.equal(ledger.confirmedAt, confirmedAt);
  assert.equal(ledger.actions.backup.status, 'completed');
});

test('Memory 写入后进程中断时，恢复只读验证已批准条目并继续 Learn-X 收尾', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-memory-write-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const proposalDir = path.join(stateRoot, '04_output/_dist/weekly', week);
  await mkdir(proposalDir, { recursive: true });
  await mkdir(path.join(stateRoot, '04_output/weekly'), { recursive: true });
  await mkdir(path.join(stateRoot, '01_core/memory'), { recursive: true });
  await writeFile(path.join(stateRoot, '04_output/weekly/2026-40.md'), '# Learn-X Weekly Output｜2026-40\n\n## 11. 全文核心重点纪要\n本周合成结论\n\n## 12. 芒格之魂的洞察\n本周合成洞察\n');
  await prepareWeeklyMemory({ week, repoRoot: stateRoot });
  await writeFile(path.join(proposalDir, 'memory-proposed.md'), '## 2026-W40\n\n- 合成且已认可的记忆条目\n');
  const targetPath = path.join(stateRoot, '01_core/memory/2026-Q3.memory.md');
  await writeFile(targetPath, '# 合成季度记忆\n');
  const binding = await bindWeeklyMemoryApproval({ week, repoRoot: stateRoot });
  const { prepareConfirmationCard, confirmCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const card = prepareConfirmationCard({
    reviewWeek: week,
    sourceBindings: { learnxMemoryFingerprint: binding.fingerprint },
    items: [
      { id: 'memory-1', domain: 'learn-x', source: 'human', locator: `${binding.scope.memoryPath}#${week}/memory-1`, originalValue: '', value: '- 合成且已认可的记忆条目\n', targets: ['memory'] },
      { id: 'closeout-backup', domain: 'learn-x', source: 'human', locator: 'Learn-X Backups / index', originalValue: '', value: '备份已确认目录并校验', targets: ['weekly-closeout'] }
    ]
  });
  const { batch } = await confirmCard({ root: stateRoot, card, messageId: 'memory-write-recovery', expectedSender: 'codex-user', hostEvidence: { schemaVersion: 1, threadId: 'memory-write-thread', displayMessageId: 'memory-write-display', displayTurnId: 'display-turn', confirmationTurnId: 'confirm-turn', displayTurnIndex: 1, confirmationTurnIndex: 0 }, fetchConfirmation: async id => ({ id, sender: 'codex-user', text: card.confirmationText, sentAt: confirmedAt }) });
  await writeFile(targetPath, '# 合成季度记忆\n\n## 2026-W40\n\n### Memory\n\n- 合成且已认可的记忆条目\n\n### 继续追踪\n\n');
  await assert.rejects(verifyWeeklyMemoryApproval({ week, fingerprint: binding.fingerprint, repoRoot: stateRoot }), /memory-approval-stale/);
  const memoryProof = await verifyConfirmedWeeklyMemoryWrite({ batch, repoRoot: stateRoot });
  assert.equal(memoryProof.ok, true, JSON.stringify(memoryProof));
  const sourceProof = await verifyWeeklyMemoryApprovalSources({ week, fingerprint: binding.fingerprint, repoRoot: stateRoot });
  assert.equal(sourceProof.week, '2026-40');
  assert.equal(sourceProof.fingerprint, batch.sourceBindings.learnxMemoryFingerprint);
  const host = { readThread: async () => ({}) };
  const result = await recoverCodexConfirmedBatches({ coreRoot, learnXRoot: stateRoot, stateRoot, host, verifyConfirmation: async () => ({ ok: true, evidence: 'mock host readback' }), closeoutExecutors: { backup: async () => ({ ok: true, status: 'verified', evidence: { indexSha256: 'e'.repeat(64) } }) } });
  assert.equal(result.completed[0]?.status, 'recovered', JSON.stringify(result));
  assert.equal(result.pending.length, 0);
  const ledger = JSON.parse(await readFile(path.join(stateRoot, 'runtime/weekly-review', week, 'closeout', `${batch.batchId}.json`), 'utf8'));
  assert.deepEqual(Object.keys(ledger.memoryWriteEvidence.evidence), ['sha256']);
  assert.equal(ledger.reviewWeek, week);
  assert.equal(ledger.confirmedAt, confirmedAt);
});

test('恢复仅接受与确认批次和目标绑定的真实回执 proof', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-receipt-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const { prepareConfirmationCard, confirmCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const { syncConfirmedBatch } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/sync-confirmed.mjs');
  const card = prepareConfirmationCard({
    reviewWeek: week,
    items: [{
      id: 'core-annual', domain: 'core', source: 'human', locator: '年度周报｜核心行动',
      originalValue: 'before', value: 'Synthetic approved annual update', targets: ['annual'],
      targetBindings: { annual: { documentId: 'annual-doc', locator: 'Annual!A1', beforeValue: 'before', beforeStructure: 'before-structure', afterStructure: 'after-structure' } }
    }],
    sourceBindings
  });
  const { file, batch } = await confirmCard({
    root: stateRoot, card, messageId: 'receipt-confirmation', expectedSender: 'codex-user',
    hostEvidence: { schemaVersion: 1, threadId: 'receipt-thread', displayMessageId: 'receipt-display', displayTurnId: 'display-turn', confirmationTurnId: 'confirm-turn', displayTurnIndex: 1, confirmationTurnIndex: 0 },
    fetchConfirmation: async id => ({ id, sender: 'codex-user', text: card.confirmationText, sentAt: confirmedAt })
  });
  let actual = { value: 'before', structure: 'before-structure', revision: 'rev-before' };
  const adapter = {
    readTarget: async ({ binding }) => ({ documentId: binding.documentId, locator: binding.locator, unique: true, ...actual }),
    writeTarget: async ({ item, binding }) => { actual = { value: item.value, structure: binding.afterStructure, revision: 'rev-after' }; }
  };
  const synced = await syncConfirmedBatch({ root: stateRoot, batchFile: file, ...adapter, verifyConfirmation: async () => ({ ok: true, evidence: 'mock trusted confirmation' }) });
  assert.equal(synced.ok, true);

  const verifyConfirmation = async () => ({ ok: true, evidence: 'mock trusted host reread' });
  const valid = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, verifyConfirmation });
  assert.equal(valid.completed[0].status, 'already-complete');

  const stateFile = path.join(stateRoot, 'runtime/weekly-review', week, 'sync', `${batch.batchId}.json`);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.entries['core-annual:annual'].proof = 'non-empty-but-forged';
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  const forged = await recoverCodexConfirmedBatches({ coreRoot, stateRoot, verifyConfirmation });
  assert.equal(forged.completed.length, 0);
  assert.equal(forged.pending[0].status, 'awaiting-host');
});

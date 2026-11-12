import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mirrorCoreOverviewToYWContext, recoverCodexConfirmedBatches, verifyPublishedCoreMirror } from './unified-confirmation.mjs';
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

test('Core 写入已完成但 YWContext 镜像失败时，下次既有恢复入口会持久化补齐', async t => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-recovery-ywcontext-mirror-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const { prepareConfirmationCard, confirmCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const { syncConfirmedBatch } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/sync-confirmed.mjs');
  const card = prepareConfirmationCard({
    reviewWeek: week,
    sourceBindings,
    items: [{
      id: 'core-overview', domain: 'core', source: 'human', locator: '2026｜总览/行动重点', originalValue: 'before',
      value: 'Synthetic approved overview update', targets: ['overview'],
      targetBindings: { overview: { documentId: 'overview-doc', locator: 'Overview!A1', beforeValue: 'before', beforeStructure: 'before-structure', afterStructure: 'after-structure' } }
    }]
  });
  const { file, batch } = await confirmCard({
    root: stateRoot, card, messageId: 'mirror-recovery-confirmation', expectedSender: 'codex-user',
    hostEvidence: { schemaVersion: 1, threadId: 'mirror-recovery-thread', displayMessageId: 'mirror-recovery-display', displayTurnId: 'display-turn', confirmationTurnId: 'confirm-turn', displayTurnIndex: 1, confirmationTurnIndex: 0 },
    fetchConfirmation: async id => ({ id, sender: 'codex-user', text: card.confirmationText, sentAt: confirmedAt })
  });
  let actual = { value: 'before', structure: 'before-structure', revision: 'rev-before' };
  const coreSync = await syncConfirmedBatch({
    root: stateRoot, batchFile: file,
    readTarget: async ({ binding }) => ({ documentId: binding.documentId, locator: binding.locator, unique: true, ...actual }),
    writeTarget: async ({ item, binding }) => { actual = { value: item.value, structure: binding.afterStructure, revision: 'rev-after' }; },
    verifyConfirmation: async () => ({ ok: true, evidence: 'trusted confirmation readback' })
  });
  assert.equal(coreSync.ok, true);
  const verifiedTargets = { targets: { 'core-overview:overview': { result: 'verified' } } };
  const firstMirror = await mirrorCoreOverviewToYWContext({
    coreRoot, stateRoot, batch, coreSync: verifiedTargets, env: { YW_CONTEXT_ROOT: path.resolve(coreRoot, '../yw-context') },
    run: async () => { throw new Error('synthetic publisher unavailable'); }
  });
  assert.equal(firstMirror.status, 'failed');
  const statePath = path.join(stateRoot, 'runtime/weekly-review', week, 'yw-context-mirror', `${batch.batchId}.json`);
  const pendingState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(pendingState.current.status, 'failed');
  assert.equal(pendingState.attemptCount, 1);

  let retries = 0;
  const host = { readThread: async () => ({}) };
  const recovered = await recoverCodexConfirmedBatches({
    coreRoot, stateRoot, host, verifyConfirmation: async () => ({ ok: true, evidence: 'trusted host reread' }),
    syncBatch: async ({ batch: _ignored, batchFile: recoveredFile }) => {
      retries += 1;
      assert.equal(recoveredFile, file);
      const receipt = await mirrorCoreOverviewToYWContext({
        coreRoot, stateRoot, batch,
        coreSync: verifiedTargets,
        env: { YW_CONTEXT_ROOT: path.resolve(coreRoot, '../yw-context') },
        run: async () => ({ stdout: JSON.stringify({ status: 'published_and_read_back', source_id: 'core-personal-docs', batch_id: 'core-personal-docs-fixture', source_revision: 'core-revision-2', record_count: 2, commit: 'a'.repeat(40) }) })
      });
      return { ok: true, ywContextMirror: receipt };
    },
    verifyYwContextMirror: async () => true,
  });
  assert.equal(retries, 1);
  assert.equal(recovered.completed[0]?.status, 'recovered');
  assert.equal(recovered.pending.length, 0);
  const finalState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(finalState.current.status, 'published_and_read_back');
  assert.equal(finalState.attemptCount, 2);
  assert.equal(finalState.current.sourceRevision, 'core-revision-2');
  assert.equal(finalState.current.commit, 'a'.repeat(40));

  finalState.current.sourceRevision = 'not-the-published-revision';
  await writeFile(statePath, `${JSON.stringify(finalState)}\n`);
  const forgedState = await recoverCodexConfirmedBatches({
    coreRoot, stateRoot, verifyYwContextMirror: async () => false,
  });
  assert.equal(forgedState.completed.length, 0);
  assert.equal(forgedState.pending[0].status, 'awaiting-host');
});

test('YWContext 镜像恢复只接受远端提交中绑定同一来源版本、确认 revision 和 P1 正文的收据', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'verified-ywcontext-mirror-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'yw-context');
  const bare = path.join(root, 'origin.git');
  await mkdir(repo, { recursive: true });
  await mkdir(bare, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { encoding: 'utf8', stdio: 'ignore' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  const documentId = 'YGbcdcvz0osWSoxy4Iecb0X2nZd';
  const wikiNodeId = 'QIaQwXf07iMvqokKQf3cp3XmnMC';
  const sourceVersion = `feishu-revision:560:sha256:${'a'.repeat(64)}`;
  const p1Version = `full-content:${sourceVersion}:policy-v1`;
  const contentPath = 'data/records/p1/core-personal-docs/p1-content-2026-overview/versions/body.md';
  const body = Buffer.from('# Core overview\n\nVerified body\n');
  const p1Hash = createHash('sha256').update(body).digest('hex');
  const record = (logical_id, level, version, sha256, storage_mode) => ({ logical_id, level, source_version: version, sha256, storage_mode });
  const readbackCommit = '2026-11-12T00:00:00.000Z';
  const publicationReceipt = {
    schema: 'yw-context-publication-receipt/v1', source_id: 'core-personal-docs', batch_id: 'core-personal-docs-fixture',
    source_revision: 'core-personal-docs-v1:fixture', record_count: 2, verified_at: readbackCommit,
    records: [record('2026-overview', 'P2', sourceVersion, 'a'.repeat(64), 'external'), record('p1-content-2026-overview', 'P1', p1Version, p1Hash, 'git')]
  };
  const catalog = { records: {
    'core-personal-docs/2026-overview': { source_identity: { document_id: documentId, wiki_node_id: wikiNodeId }, versions: [{ source_version: sourceVersion, sha256: 'a'.repeat(64) }] },
    'core-personal-docs/p1-content-2026-overview': { versions: [{ source_version: p1Version, sha256: p1Hash, source_reference: { source_version: sourceVersion, sha256: 'a'.repeat(64) }, content_path: contentPath }] }
  } };
  const sourceState = { schema: 'yw-context-source-state/v1', source_id: 'core-personal-docs', status: 'verified', last_verified_batch: publicationReceipt.batch_id, source_revision: publicationReceipt.source_revision, record_count: 2 };
  const registry = { sources: [{ id: 'core-personal-docs', registered_documents: [{ logical_id: '2026-overview', document_id: documentId, level: 'P1' }] }] };
  const files = {
    [`data/receipts/core-personal-docs/${publicationReceipt.batch_id}.json`]: publicationReceipt,
    'data/state/core-personal-docs.json': sourceState,
    'data/catalog.json': catalog,
    'sources/registry.json': registry,
  };
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(repo, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value)}\n`);
  }
  await mkdir(path.dirname(path.join(repo, contentPath)), { recursive: true });
  await writeFile(path.join(repo, contentPath), body);
  git('add', '.');
  git('commit', '-m', 'verified fixture');
  const commit = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', bare);
  git('push', '-u', 'origin', 'main');

  const batch = {
    batchId: 'codex-confirmed-batch', reviewWeek: week,
    items: [{ id: 'overview-item', domain: 'core', targets: ['overview'], targetBindings: { overview: { documentId } } }]
  };
  const mirrorState = { schemaVersion: 1, batchId: batch.batchId, reviewWeek: week, current: {
    status: 'published_and_read_back', sourceId: 'core-personal-docs', batchId: publicationReceipt.batch_id,
    sourceRevision: publicationReceipt.source_revision, recordCount: 2, commit, verifiedAt: readbackCommit,
  } };
  const coreSyncState = { entries: { 'overview-item:overview': { result: 'verified', revision: '560' } } };
  assert.equal(await verifyPublishedCoreMirror({ contextRoot: repo, batch, mirrorState, coreSyncState }), true);
  const forged = structuredClone(mirrorState);
  forged.current.sourceRevision = 'not-the-published-revision';
  assert.equal(await verifyPublishedCoreMirror({ contextRoot: repo, batch, mirrorState: forged, coreSyncState }), false);
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
  const verifyMemoryApproval = async ({ week: approvedWeek, fingerprint }) => ({ verified: true, week: approvedWeek, fingerprint, schemaVersion: 2 });
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
  assert.equal(result.completed.length, 0);
  assert.equal(result.pending[0]?.status, 'pending_recovery', JSON.stringify(result));
  assert.equal(result.pending[0]?.outcomes.learnXCloseout.results.ywcontext.status, 'pending');
  assert.equal(result.pending[0]?.outcomes.learnXCloseout.results.ywcontext.reason, 'yw_context_sync_entrypoint_unavailable');
  const ledger = JSON.parse(await readFile(path.join(stateRoot, 'runtime/weekly-review', week, 'closeout', `${batch.batchId}.json`), 'utf8'));
  assert.equal(ledger.reviewWeek, week);
  assert.equal(ledger.confirmedAt, confirmedAt);
  assert.equal(ledger.actions.ywcontext.status, 'pending');
  assert.deepEqual({ targetPath: ledger.memoryWriteEvidence.evidence.targetPath, week: ledger.memoryWriteEvidence.evidence.week, itemIds: ledger.memoryWriteEvidence.evidence.itemIds }, { targetPath: '01_core/memory/2026-Q3.memory.md', week, itemIds: ['memory-1'] });
  assert.match(ledger.memoryWriteEvidence.evidence.sha256, /^[a-f0-9]{64}$/);
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

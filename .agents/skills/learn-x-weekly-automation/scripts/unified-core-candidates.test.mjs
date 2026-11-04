import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCoreConfirmationCandidates, validateCoreConfirmationTargets } from './unified-confirmation.mjs';

const week = '2026-W40';
const confirmedAt = '2026-10-31T09:00:00+08:00';
const reviewDoc = '<doc><h1>review</h1><p>synthetic</p></doc>';
const rowA = ['Invest', 'P1', 'snapshot intro', 'snapshot action', 'snapshot feedback', 'snapshot thinking'];
const rowB = ['Health', 'weekly action', 'reality feedback', 'human thought', 'next action'];
const rowA2 = ['Learning', 'P2', 'second intro', 'second action', 'second feedback', 'second thinking'];
const rowB2 = ['Drawing', 'second action', 'second feedback', 'second thought', 'second next'];

async function fixture(t, config = { feishu: { annual: { year: 2026, weeklyDocumentId: 'annual-doc' }, overview: { documentId: 'overview-doc' } } }) {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'unified-core-candidates-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const runtime = path.join(stateRoot, 'runtime/weekly-review', week);
  await mkdir(path.join(runtime, 'snapshot'), { recursive: true });
  await mkdir(path.join(runtime, 'changeset'), { recursive: true });
  const { renderTableXml, SNAPSHOT_HEADERS, REVIEW_HEADERS, OVERVIEW_HEADERS, SIX_COL_WIDTHS, FIVE_COL_WIDTHS, OVERVIEW_COL_WIDTHS } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/content.mjs');
  const candidateXml = [
    renderTableXml({ headers: SNAPSHOT_HEADERS, rows: [rowA, rowA2], widths: SIX_COL_WIDTHS }),
    renderTableXml({ headers: REVIEW_HEADERS, rows: [rowB, rowB2], widths: FIVE_COL_WIDTHS }),
    renderTableXml({ headers: OVERVIEW_HEADERS, rows: [rowA.slice(0, 5)], widths: OVERVIEW_COL_WIDTHS })
  ].join('\n');
  const overviewXml = `<h2>Q4</h2>${renderTableXml({ headers: OVERVIEW_HEADERS, rows: [rowA.map((value, index) => index === 0 ? 'Invest' : value)], widths: OVERVIEW_COL_WIDTHS })}`;
  const proposal = { week, business: 'core-weekly', source: { reviewDocId: 'review-doc' }, items: [] };
  await Promise.all([
    writeFile(path.join(runtime, 'binding.json'), JSON.stringify({ week, docId: 'review-doc', stage: 'prepared' })),
    writeFile(path.join(runtime, 'snapshot/manifest.json'), JSON.stringify({ week, reviewDoc: { docId: 'review-doc', revisionId: 'r-1' } })),
    writeFile(path.join(runtime, 'snapshot/review-doc.xml'), reviewDoc),
    writeFile(path.join(runtime, 'candidate.xml'), candidateXml),
    writeFile(path.join(runtime, 'snapshot/overview-q4.xml'), overviewXml),
    writeFile(path.join(runtime, 'changeset/proposal.json'), JSON.stringify(proposal))
  ]);
  const ctx = {
    repoRoot: '/Users/yuwei/code/core',
    config,
    larkFactory: () => ({ fetchDoc: async ({ doc, identity }) => ({ ok: true, identity, data: { document: { document_id: doc, revision_id: 'r-1', content: reviewDoc } } }) })
  };
  const validation = { week, ok: true, items: [] };
  let baselineChanged = false;
  const adapter = { readTarget: async ({ target, binding, item }) => {
    const annual = target === 'annual';
    const value = annual ? (baselineChanged ? 'human concurrent edit' : '') : (baselineChanged ? 'human concurrent edit' : item.originalValue);
    return {
      documentId: binding.documentId, locator: binding.locator, unique: true, value,
      structure: annual ? '<absent-week-section/>' : `<p>${item.originalValue}</p>`
    };
  } };
  return { stateRoot, runtime, ctx, validation, adapter, setBaselineChanged(value) { baselineChanged = value; } };
}

const item = (id, table, row, cellIndex, classification, proposedValue, scope = 'cell', originalValue) => ({
  id, classification, targetHint: `${table === 'O' ? 'overview#O' : `weekly-section#${table}`}:${row}`,
  hint: table === 'O' ? { domain: 'overview', table: 'O', row } : { domain: 'weekly-section', table, row },
  scope, cellIndex, proposedValue, originalValue: originalValue ?? (table === 'A' ? rowA[cellIndex] : table === 'B' ? rowB[cellIndex] : rowA[cellIndex])
});

test('A/B 新年度段落对每行只生成一个可见身份依赖，覆盖多单元格和整行确认', async t => {
  const f = await fixture(t);
  f.validation.items = [
    item('a-cell', 'A', 0, 2, 'explicit-modify', 'approved snapshot intro'),
    item('b-cell-one', 'B', 0, 1, 'explicit-confirm', 'AI action accepted'),
    item('b-cell-two', 'B', 0, 2, 'explicit-modify', 'human feedback edit'),
    item('a-row', 'A', 1, 0, 'explicit-confirm', rowA2[0], 'row', rowA2[0]),
    item('b-row', 'B', 1, 0, 'explicit-confirm', rowB2[0], 'row', rowB2[0])
  ];
  const result = await buildCoreConfirmationCandidates({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, week, confirmedAt, ctx: f.ctx, validation: f.validation, adapter: f.adapter });
  const identities = result.items.filter(candidate => candidate.locator.includes('年度周报行标识'));
  assert.deepEqual(identities.map(candidate => candidate.id).sort(), ['core-row-identity-A-0', 'core-row-identity-B-0']);
  assert.equal(result.items.filter(candidate => candidate.locator.includes('年度周报行标识')).length, 2);
  assert.equal(result.items.find(candidate => candidate.id.startsWith('core-b-cell-one')).source, 'ai');
  assert.equal(result.items.find(candidate => candidate.id.startsWith('core-b-cell-two')).source, 'human');
  const aCell = result.proposalToCandidateIds['a-cell'][0];
  const bOne = result.proposalToCandidateIds['b-cell-one'][0];
  const bTwo = result.proposalToCandidateIds['b-cell-two'][0];
  assert.deepEqual(result.requiredByItem[aCell], ['core-row-identity-A-0']);
  assert.deepEqual(result.requiredByItem[bOne], ['core-row-identity-B-0']);
  assert.deepEqual(result.requiredByItem[bTwo], ['core-row-identity-B-0']);
  assert.equal(result.proposalToCandidateIds['a-row'].length, 6);
  assert.equal(result.proposalToCandidateIds['b-row'].length, 5);
  assert.equal(Object.values(result.requiredByItem).filter(ids => ids[0] === 'core-row-identity-B-1').length, 0);
});

test('source 与目标基线在用户确认前复读；任何一方改变都关闭确认', async t => {
  const f = await fixture(t);
  f.validation.items = [item('b-cell', 'B', 0, 1, 'explicit-confirm', 'AI action accepted')];
  const result = await buildCoreConfirmationCandidates({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, week, confirmedAt, ctx: f.ctx, validation: f.validation, adapter: f.adapter });
  const { prepareConfirmationCard } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
  const card = prepareConfirmationCard({ reviewWeek: week, items: result.items.filter(candidate => candidate.id === result.proposalToCandidateIds['b-cell'][0]), sourceBindings: { coreReview: result.sourceBinding } });
  assert.deepEqual(await validateCoreConfirmationTargets({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, card, confirmedAt, ctx: f.ctx, adapter: f.adapter }), { ok: true });
  f.setBaselineChanged(true);
  assert.deepEqual(await validateCoreConfirmationTargets({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, card, confirmedAt, ctx: f.ctx, adapter: f.adapter }), { ok: false, reason: 'Core annual baseline changed' });
  f.setBaselineChanged(false);
  await writeFile(path.join(f.runtime, 'changeset/proposal.json'), JSON.stringify({ week, business: 'core-weekly', source: { reviewDocId: 'review-doc' }, items: [{ changed: true }] }));
  assert.deepEqual(await validateCoreConfirmationTargets({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, card, confirmedAt, ctx: f.ctx, adapter: f.adapter }), { ok: false, reason: 'Core review source or changeset changed' });
});

test('跨年晚确认仍绑定覆盖周年度周报与认可时适用的总览', async t => {
  const f = await fixture(t, { feishu: {
    annual: { year: 2027, weeklyDocumentId: 'annual-2027', documentsByYear: { '2026': { documentId: 'annual-2026' }, '2027': { documentId: 'annual-2027' } } },
    overview: { year: 2027, documentId: 'overview-2027', documentsByYear: { '2027': { documentId: 'overview-2027' } } }
  } });
  f.validation.items = [item('snapshot-cell', 'A', 0, 2, 'explicit-confirm', 'snapshot intro')];
  const result = await buildCoreConfirmationCandidates({ coreRoot: '/Users/yuwei/code/core', stateRoot: f.stateRoot, week, confirmedAt: '2027-01-02T09:00:00+08:00', ctx: f.ctx, validation: f.validation, adapter: f.adapter });
  const candidate = result.items.find(entry => entry.id.startsWith('core-snapshot-cell'));
  assert.ok(candidate);
  assert.equal(candidate.targetBindings.annual.documentId, 'annual-2026');
  assert.equal(candidate.targetBindings.overview.documentId, 'overview-2027');
  assert.match(candidate.targetBindings.annual.locator, /2026-W40/);
  assert.match(candidate.targetBindings.overview.locator, /Q1/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { activeWeeks, ageBand, eligibleNotes, isoWeek, simulate28Days, simulateSupply, validateSelection } from './policy.mjs';

function notes(count = 100) {
  return Array.from({ length: count }, (_, i) => ({ noteKey: `n${String(i).padStart(3, '0')}`, groupKey: `g${i}`, aliases: [], groupAliases: [], createdAt: '2025-12-01T08:00:00+08:00', body: `Thought ${i}`, bodyHash: `hash${i}`, quality: { score: 3, bodyHash: `hash${i}`, policyVersion: '1' } }));
}
function items(catalog, indices = [90, 91, 92, 93, 94]) {
  return indices.map((i) => ({ noteKey: catalog[i].noteKey, bodyHash: catalog[i].bodyHash, relevance: 'strong', reason: 'Useful reflection', contextEvidence: [{ path: 'weekly.md', quote: 'Confirmed context' }] }));
}
function history(catalog, datesAndIndices) {
  return { batches: Object.fromEntries(datesAndIndices.map(([date, indices, status = 'delivered']) => [date, { date, status, items: indices.map((i) => ({ noteKey: catalog[i].noteKey, groupKey: catalog[i].groupKey })) }])) };
}

test('ISO weeks and four-week windows cross year boundaries and leap dates', () => {
  assert.equal(isoWeek('2021-01-01'), '2020-W53');
  assert.equal(isoWeek('2021-01-04'), '2021-W01');
  assert.deepEqual(activeWeeks('2021-01-04'), ['2021-W01', '2020-W53', '2020-W52', '2020-W51']);
  assert.equal(isoWeek('2024-02-29'), '2024-W09');
  assert.throws(() => isoWeek('2026-02-29'), /invalid-date/);
});

test('Shanghai end-of-day age includes today and exact 30/365 day boundaries', () => {
  const date = '2026-10-06';
  assert.equal(ageBand('2026-10-06T23:59:59.999+08:00', date), 'recent');
  assert.equal(ageBand('2026-09-06T23:59:59.999+08:00', date), 'recent');
  assert.equal(ageBand('2026-09-06T23:59:59.998+08:00', date), 'year');
  assert.equal(ageBand('2025-10-06T23:59:59.999+08:00', date), 'year');
  assert.equal(ageBand('2025-10-06T23:59:59.998+08:00', date), 'older');
  assert.equal(ageBand('2026-10-06', date), 'recent');
  assert.throws(() => ageBand('2026-10-07T00:00:00+08:00', date), /future-created-at/);
  assert.throws(() => ageBand('2026-10-06 08:00', date), /invalid-created-at/);
  assert.throws(() => ageBand('2026-02-30T08:00:00+08:00', date), /invalid-created-at/);
});

test('five-to-seven target selection supports quality-current notes and requires evidence', () => {
  const catalog = notes();
  const selection = items(catalog);
  selection[2].relevance = 'background';
  const result = validateSelection({ date: '2026-10-06', notes: catalog, items: selection });
  assert.equal(result.items.length, 5);
  assert.equal(result.repeats, 0);
  assert.equal(result.age.nearYearRatio, 1);
  assert.equal(result.ageObserved.total, 0);
  assert.ok(result.age.deviations.length);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: selection.slice(0, 2) }), /count-must-be-5-to-7/);
  const seven = items(catalog, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(validateSelection({ date: '2026-10-06', notes: catalog, items: seven }).items.length, 7);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: items(catalog, [0, 1, 2, 3, 4, 5, 6, 7]) }), /count-must-be-5-to-7/);
  const extra = items(catalog, [0, 1, 2, 3, 4]); extra[3].relevance = 'background';
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: extra }), /extra-item-must-be-strong/);
  const noEvidence = items(catalog); noEvidence[0].contextEvidence = [];
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: noEvidence }), /context-evidence/);
  const stale = notes(); stale[90].quality.bodyHash = 'old';
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: stale, items: items(stale) }), /quality-not-current/);
  const low = notes(); low[90].quality.score = 2;
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: low, items: items(low) }), /quality-not-current/);
  const wrongHash = items(catalog); wrongHash[0].bodyHash = 'other';
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: wrongHash }), /hash-mismatch/);
});

test('age statistics use the selected memo identity when identical content has different dates', () => {
  const catalog = notes(101);
  const sharedBody = '同一内容的两个 Flomo 副本。';
  const sharedHash = 'shared-content-hash';
  Object.assign(catalog[0], { noteKey: 'old-copy', groupKey: 'shared-content', createdAt: '2020-01-01T09:00:00+08:00', body: sharedBody, bodyHash: sharedHash, quality: { score: 3, bodyHash: sharedHash, policyVersion: '1' } });
  Object.assign(catalog[1], { noteKey: 'new-copy', groupKey: 'shared-content', createdAt: '2026-10-01T09:00:00+08:00', body: sharedBody, bodyHash: sharedHash, quality: { score: 3, bodyHash: sharedHash, policyVersion: '1' } });
  for (const note of catalog.slice(2)) note.createdAt = '2026-10-05T09:00:00+08:00';

  const first = validateSelection({ date: '2026-10-08', notes: catalog, items: items(catalog, [1, 2, 3, 95, 96]) });
  assert.deepEqual(first.age.counts, { recent: 5, year: 0, older: 0 });
  assert.deepEqual(first.ageObserved.counts, { recent: 0, year: 0, older: 0 });

  const delivered = history(catalog, [['2026-10-05', [1, 2, 3, 97, 98]]]);
  const second = validateSelection({ date: '2026-10-08', notes: catalog, ledger: delivered, items: items(catalog, [4, 5, 6, 99, 100]) });
  assert.deepEqual(second.ageObserved.counts, { recent: 5, year: 0, older: 0 });
  assert.deepEqual(second.age.counts, { recent: 10, year: 0, older: 0 });

  delivered.batches['2026-10-05'].items[0] = { groupKey: 'shared-content' };
  assert.throws(() => validateSelection({ date: '2026-10-08', notes: catalog, ledger: delivered, items: items(catalog, [4, 5, 6, 99, 100]) }), /age-identity-ambiguous/);
});

test('same-week duplicate groups and alias identity remain occupied after edits and merges', () => {
  const catalog = notes();
  catalog[0].aliases = ['old-local-key'];
  catalog[0].groupAliases = ['old-group'];
  const ledger = history(catalog, [['2026-10-05', [0, 1, 2]]]);
  ledger.batches['2026-10-05'].items[0] = { noteKey: 'old-local-key', groupKey: 'old-group' };
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 90, 91, 92, 93]) }), /same-week-repeat/);
  // The current group alias can recover a historical note key whose source key disappeared.
  ledger.batches['2026-10-05'].items[0].noteKey = 'lost-old-key';
  assert.ok(!eligibleNotes({ date: '2026-10-06', notes: catalog, ledger }).some((n) => n.groupKey === catalog[0].groupKey));
  const duplicate = { ...catalog[90], noteKey: 'copy', groupKey: catalog[90].groupKey };
  const duplicateItems = items(catalog);
  duplicateItems[1] = { ...duplicateItems[0], noteKey: 'copy' };
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: [...catalog, duplicate], items: duplicateItems }), /same-week-repeat/);
});

test('pair overlap allows five, rejects six, and releases the fifth week', () => {
  const catalog = notes();
  const ledger = history(catalog, [['2026-09-28', [0, 1, 2, 3, 4, 5]]]);
  assert.equal(validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4, 90, 91]) }).repeats, 5);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4, 5, 90]) }), /pair-overlap-exceeds-5/);
  assert.equal(validateSelection({ date: '2026-10-26', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4, 5, 90]) }).repeats, 0);
});

test('four-week repetition allows ten, rejects eleven independently of pair overlap', () => {
  const catalog = notes();
  const ledger = history(catalog, [
    ['2026-09-14', [0, 1, 2, 3, 4, 5]],
    ['2026-09-21', [0, 1, 2, 6, 7, 8]],
    ['2026-09-28', [0, 3, 6, 9, 10, 11]]
  ]);
  const valid = validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 95]) });
  assert.equal(valid.repeats, 10);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4]) }), /four-week-repeats-exceed-10/);
});

test('reserved, sending, delivered and needs_review block date and weekly exposures; failed releases them', () => {
  const catalog = notes();
  for (const status of ['reserved', 'sending', 'delivered', 'needs_review']) {
    const ledger = history(catalog, [['2026-10-05', [0, 1, 2, 3, 4], status]]);
    assert.throws(() => validateSelection({ date: '2026-10-05', notes: catalog, ledger, items: items(catalog) }), /date-already-occupied/);
    assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 90, 91, 92, 93]) }), /same-week-repeat/);
    const result = validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog) });
    assert.equal(result.ageObserved.total, status === 'delivered' ? 5 : 0);
  }
  const failed = history(catalog, [['2026-10-05', [0, 1, 2, 3, 4], 'failed']]);
  assert.doesNotThrow(() => validateSelection({ date: '2026-10-05', notes: catalog, ledger: failed, items: items(catalog, [0, 1, 2, 3, 4]) }));
});

test('unknown or conflicting active historical identity fails closed, even when selection is different', () => {
  const catalog = notes();
  const ledger = history(catalog, [['2026-10-05', [0, 1, 2]]]);
  ledger.batches['2026-10-05'].items[0] = { noteKey: 'unknown', groupKey: 'unknown' };
  assert.throws(() => eligibleNotes({ date: '2026-10-06', notes: catalog, ledger }), /unknown-history-identity/);
  ledger.batches['2026-10-05'].items[0] = { noteKey: catalog[0].noteKey, groupKey: catalog[1].groupKey };
  assert.throws(() => eligibleNotes({ date: '2026-10-06', notes: catalog, ledger }), /history-identity-conflict/);
  const ambiguous = notes(); ambiguous[1].aliases = [ambiguous[0].noteKey];
  assert.throws(() => eligibleNotes({ date: '2026-10-06', notes: ambiguous }), /ambiguous-alias/);
});

test('same-group duplicate aliases fail closed instead of changing historical age attribution', () => {
  const catalog = notes(7);
  catalog[0].groupKey = catalog[1].groupKey = 'shared-content';
  catalog[0].aliases = ['legacy-key'];
  catalog[1].aliases = ['legacy-key'];
  catalog[0].createdAt = '2020-01-01T09:00:00+08:00';
  catalog[1].createdAt = '2026-10-05T09:00:00+08:00';
  const ledger = { batches: { '2026-10-05': {
    date: '2026-10-05', status: 'delivered', items: [{ noteKey: 'legacy-key', groupKey: 'shared-content' }]
  } } };
  assert.throws(() => validateSelection({ date: '2026-10-08', notes: catalog, ledger, items: items(catalog, [2, 3, 4, 5, 6]) }), /ambiguous-alias/);
});

test('eligibility excludes unscored, stale, low-quality and invalid or future-dated notes', () => {
  const catalog = notes(8);
  catalog[0].quality = undefined;
  catalog[1].quality.score = 2;
  catalog[2].quality.bodyHash = 'previous-version';
  catalog[3].createdAt = '2026-10-07T00:00:00+08:00';
  catalog[4].createdAt = '2026-02-30T00:00:00+08:00';
  catalog[5].quality.policyVersion = 'old';
  assert.deepEqual(eligibleNotes({ date: '2026-10-06', notes: catalog }).map((n) => n.noteKey), ['n006', 'n007']);
  const malformed = items(notes(), [0, 1, 2, 3, 4]); malformed[0].reason = 12;
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: notes(), items: malformed }), /missing-recommendation-reason/);
});

test('capacity simulation proves 157 impossible and 158 feasible over four complete ISO weeks', () => {
  const impossible = simulate28Days({ notes: notes(157), startDate: '2026-10-05' });
  assert.equal(impossible.possible, false);
  assert.equal(impossible.minimum, 158);
  const possible = simulate28Days({ notes: notes(158), startDate: '2026-10-05' });
  assert.equal(possible.possible, true);
  assert.equal(possible.schedule.length, 28);
  assert.equal(possible.schedule.at(-1).repeats, 10);
  for (const day of possible.schedule) {
    assert.equal(day.items.length, 6);
    assert.ok(day.repeats <= 10);
    assert.ok(day.pairOverlaps.every((pair) => pair.overlap <= 5));
  }
  assert.equal(simulateSupply({ notes: notes(41), startDate: '2026-10-05', days: 7 }).possible, false);
  assert.equal(simulateSupply({ notes: notes(42), startDate: '2026-10-05', days: 7 }).possible, true);
});

test('28-day capacity simulations cross ISO year and non-Monday start without reset errors', () => {
  for (const startDate of ['2026-12-21', '2026-10-06']) {
    const result = simulate28Days({ notes: notes(158), startDate });
    assert.equal(result.possible, true);
    assert.equal(result.schedule.length, 28);
  }
});

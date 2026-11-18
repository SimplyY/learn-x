import assert from 'node:assert/strict';
import test from 'node:test';
import { activeWeeks, ageBand, eligibleNotes, isoWeek, simulate28Days, simulateSupply, validateSelection } from './policy.mjs';

function notes(count = 100) {
  const bands = [
    '2026-09-21T08:00:00+08:00', '2026-07-15T08:00:00+08:00', '2026-04-10T08:00:00+08:00',
    '2025-11-20T08:00:00+08:00', '2025-09-01T08:00:00+08:00',
  ];
  return Array.from({ length: count }, (_, i) => ({ noteKey: `n${String(i).padStart(3, '0')}`, groupKey: `g${i}`, aliases: [], groupAliases: [], createdAt: bands[i % bands.length], body: `Thought ${i}`, bodyHash: `hash${i}`, quality: { score: 3, bodyHash: `hash${i}`, policyVersion: '1' }, source: { url: `https://v.flomoapp.com/mine/?memo_id=${i}` } }));
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

test('Shanghai end-of-day age includes today and exact composition boundaries', () => {
  const date = '2026-10-06';
  assert.equal(ageBand('2026-10-06T23:59:59.999+08:00', date), 'recent');
  assert.equal(ageBand('2026-09-06T23:59:59.999+08:00', date), 'recent');
  assert.equal(ageBand('2026-09-06T23:59:59.998+08:00', date), 'quarter');
  assert.equal(ageBand('2026-07-08T23:59:59.999+08:00', date), 'quarter');
  assert.equal(ageBand('2026-07-08T23:59:59.998+08:00', date), 'half_year');
  assert.equal(ageBand('2026-04-07T23:59:59.999+08:00', date), 'half_year');
  assert.equal(ageBand('2026-04-07T23:59:59.998+08:00', date), 'year');
  assert.equal(ageBand('2025-10-06T23:59:59.999+08:00', date), 'year');
  assert.equal(ageBand('2025-10-06T23:59:59.998+08:00', date), 'older');
  assert.equal(ageBand('2026-10-06', date), 'recent');
  assert.throws(() => ageBand('2026-10-07T00:00:00+08:00', date), /future-created-at/);
  assert.throws(() => ageBand('2026-10-06 08:00', date), /invalid-created-at/);
  assert.throws(() => ageBand('2026-02-30T08:00:00+08:00', date), /invalid-created-at/);
});

test('five-to-ten selection keeps five as the floor and seven as the daily target', () => {
  const catalog = notes();
  const selection = items(catalog);
  selection[2].relevance = 'background';
  const result = validateSelection({ date: '2026-10-06', notes: catalog, items: selection });
  assert.equal(result.items.length, 5);
  assert.equal(result.repeats, 0);
  assert.equal(result.age.recentRatio, .2);
  assert.equal(result.ageObserved.total, 0);
  assert.deepEqual(result.age.deviations, []);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: selection.slice(0, 2) }), /count-must-be-5-to-10/);
  const seven = items(catalog, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(validateSelection({ date: '2026-10-06', notes: catalog, items: seven }).items.length, 7);
  const eight = items(catalog, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(validateSelection({ date: '2026-10-06', notes: catalog, items: eight }).items.length, 8);
  const ten = items(catalog, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(validateSelection({ date: '2026-10-06', notes: catalog, items: ten }).items.length, 10);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: items(catalog, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }), /count-must-be-5-to-10/);
  const extra = items(catalog, [0, 1, 2, 3, 4]); extra[3].relevance = 'background';
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: extra }), /extra-item-must-be-strong/);
  const noEvidence = items(catalog); noEvidence[0].contextEvidence = [];
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, items: noEvidence }), /context-evidence/);
  const stale = notes(); stale[90].quality.bodyHash = 'old';
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: stale, items: items(stale) }), /quality-not-current/);
  const noUrl = notes(); noUrl[90].source = { url: null };
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: noUrl, items: items(noUrl) }), /flomo-url-required/);
  assert.ok(!eligibleNotes({ date: '2026-10-06', notes: noUrl, ledger: { batches: {} } }).some(note => note.noteKey === 'n090'));
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
  for (const [index, createdAt] of [[3, '2025-11-20T09:00:00+08:00'], [4, '2025-09-01T09:00:00+08:00'], [6, '2026-07-15T09:00:00+08:00'], [7, '2026-04-10T09:00:00+08:00']]) {
    catalog[index].createdAt = createdAt;
  }

  for (const index of [95, 96, 97, 98, 99]) catalog[index].createdAt = [
    '2026-04-12T09:00:00+08:00', '2025-11-22T09:00:00+08:00', '2026-09-21T09:00:00+08:00',
    '2026-07-15T09:00:00+08:00', '2025-09-01T09:00:00+08:00',
  ][index - 95];
  const first = validateSelection({ date: '2026-10-08', notes: catalog, items: items(catalog, [95, 96, 97, 98, 99]) });
  assert.deepEqual(first.age.counts, { recent: 1, quarter: 1, half_year: 1, year: 1, older: 1 });
  assert.deepEqual(first.ageObserved.counts, { recent: 0, quarter: 0, half_year: 0, year: 0, older: 0 });

  const delivered = history(catalog, [['2026-10-05', [1, 3, 97, 98, 99]]]);
  const second = validateSelection({ date: '2026-10-08', notes: catalog, ledger: delivered, items: items(catalog, [4, 6, 7, 95, 96]) });
  assert.deepEqual(second.ageObserved.counts, { recent: 2, quarter: 1, half_year: 0, year: 1, older: 1 });
  assert.deepEqual(second.age.counts, { recent: 2, quarter: 2, half_year: 2, year: 2, older: 2 });

  delivered.batches['2026-10-05'].items[0] = { groupKey: 'shared-content' };
  assert.throws(() => validateSelection({ date: '2026-10-08', notes: catalog, ledger: delivered, items: items(catalog, [4, 6, 7, 95, 96]) }), /age-identity-ambiguous/);
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

test('four-week exposure rejects one repeat and releases it after the window', () => {
  const catalog = notes();
  const ledger = history(catalog, [['2026-09-28', [0, 1, 2, 3, 4, 5]]]);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 90, 91, 92, 93]) }), /pair-overlap-exceeds-0/);
  assert.equal(validateSelection({ date: '2026-10-26', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4]) }).repeats, 0);
});

test('four-week repetition rejects even one independently of pair overlap', () => {
  const catalog = notes();
  const ledger = history(catalog, [
    ['2026-09-14', [0, 1, 2, 3, 4, 5]],
    ['2026-09-21', [0, 1, 2, 6, 7, 8]],
    ['2026-09-28', [0, 3, 6, 9, 10, 11]]
  ]);
  assert.throws(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 90, 91, 92, 93]) }), /pair-overlap-exceeds-0/);
});

test('historical pair overlap from past deliveries no longer blocks a clean new week', () => {
  const catalog = notes();
  const ledger = history(catalog, [
    ['2026-09-28', [0, 1, 2, 3, 4, 5]],
    ['2026-09-21', [0, 6, 7, 8, 9, 10]]
  ]);
  const result = validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [11, 12, 13, 14, 15]) });
  assert.equal(result.repeats, 1);
  assert.ok(result.pairOverlaps.some((entry) => entry.overlap > 0));
  const eligible = eligibleNotes({ date: '2026-10-06', notes: catalog, ledger });
  const exposed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => catalog[index].noteKey);
  assert.ok(!eligible.some((note) => exposed.includes(note.noteKey)));
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

test('a new dedupe generation resets old exposure but keeps same-day occupancy', () => {
  const catalog = notes();
  const ledger = {
    dedupeGeneration: 'online-current',
    batches: {
      '2026-10-05': { date: '2026-10-05', status: 'delivered', dedupeGeneration: 'legacy', items: [{ noteKey: 'retired-key', groupKey: 'retired-group' }] }
    }
  };
  assert.doesNotThrow(() => validateSelection({ date: '2026-10-06', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 4]) }));
  assert.throws(() => validateSelection({ date: '2026-10-05', notes: catalog, ledger, items: items(catalog) }), /date-already-occupied/);
});

test('current-generation exposure retains deleted memo identity and age from send-time history', () => {
  const catalog = notes();
  const ledger = {
    dedupeGeneration: 'online-current',
    batches: {
      '2026-10-05': {
        date: '2026-10-05', status: 'delivered', dedupeGeneration: 'online-current',
        items: [{ noteKey: 'deleted-note', groupKey: 'deleted-body', historyIdentity: {
          memoId: 'deleted-memo', noteKey: 'deleted-note', groupKey: 'deleted-body',
          createdAt: '2020-01-01T09:00:00+08:00', bodyHash: 'deleted-hash'
        } }]
      }
    }
  };
  const result = validateSelection({ date: '2026-10-08', notes: catalog, ledger, items: items(catalog, [0, 1, 2, 3, 5]) });
  assert.deepEqual(result.ageObserved.counts, { recent: 0, quarter: 0, half_year: 0, year: 0, older: 1 });
  assert.equal(result.ageObserved.total, 1);
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

test('capacity simulation proves 167 impossible and 168 feasible over four complete ISO weeks', () => {
  const impossible = simulate28Days({ notes: notes(167), startDate: '2026-10-05' });
  assert.equal(impossible.possible, false);
  assert.equal(impossible.minimum, 168);
  const possible = simulate28Days({ notes: notes(168), startDate: '2026-10-05' });
  assert.equal(possible.possible, true);
  assert.equal(possible.schedule.length, 28);
  assert.equal(possible.schedule.at(-1).repeats, 0);
  for (const day of possible.schedule) {
    assert.equal(day.items.length, 6);
    assert.equal(day.repeats, 0);
    assert.ok(day.pairOverlaps.every((pair) => pair.overlap <= 0));
  }
  assert.equal(simulateSupply({ notes: notes(41), startDate: '2026-10-05', days: 7 }).possible, false);
  assert.equal(simulateSupply({ notes: notes(42), startDate: '2026-10-05', days: 7 }).possible, true);
});

test('28-day capacity simulations cross ISO year and non-Monday start without reset errors', () => {
  for (const startDate of ['2026-12-21', '2026-10-06']) {
    const result = simulate28Days({ notes: notes(186), startDate });
    assert.equal(result.possible, true);
    assert.equal(result.schedule.length, 28);
  }
});

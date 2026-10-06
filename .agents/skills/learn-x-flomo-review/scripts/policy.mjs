const DAY = 86400000;
const OCCUPIED = new Set(['reserved', 'sending', 'delivered', 'needs_review']);

function fail(reason) { throw new Error(`flomo-review-${reason}`); }
function dayTime(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) fail('invalid-date');
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) fail('invalid-date');
  return time;
}
function dateString(time) { return new Date(time).toISOString().slice(0, 10); }
export function isoWeek(date) {
  const day = new Date(dayTime(date));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const number = Math.ceil(((day - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(number).padStart(2, '0')}`;
}
export function activeWeeks(date) {
  const time = dayTime(date);
  return Array.from({ length: 4 }, (_, i) => isoWeek(dateString(time - i * 7 * DAY)));
}

// Age is measured at Shanghai 23:59:59.999; exact 30/365-day boundaries are included.
export function ageBand(createdAt, date) {
  const target = dayTime(date) + DAY - 8 * 3600000 - 1;
  let created;
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt || '')) created = dayTime(createdAt) - 8 * 3600000;
  else {
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt || '')) fail('invalid-created-at');
    try { dayTime(createdAt.slice(0, 10)); } catch { fail('invalid-created-at'); }
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d/.test(createdAt)) fail('invalid-created-at');
    const timestamp = Date.parse(createdAt);
    if (!Number.isFinite(timestamp)) fail('invalid-created-at');
    created = timestamp;
  }
  const days = (target - created) / DAY;
  if (days < 0) fail('future-created-at');
  return days <= 30 ? 'recent' : days <= 365 ? 'year' : 'older';
}

function catalogIndex(notes) {
  if (!Array.isArray(notes)) fail('invalid-catalog');
  const byKey = new Map();
  const groups = new Map();
  const byGroup = new Map();
  for (const note of notes) {
    if (!note || typeof note.noteKey !== 'string' || !note.noteKey || typeof note.groupKey !== 'string' || !note.groupKey) fail('unknown-identity');
    if ((note.aliases != null && !Array.isArray(note.aliases)) || (note.groupAliases != null && !Array.isArray(note.groupAliases))) fail('invalid-catalog-aliases');
    for (const key of [note.noteKey, ...(note.aliases || [])]) {
      if (byKey.has(key) && byKey.get(key).groupKey !== note.groupKey) fail('ambiguous-alias');
      byKey.set(key, note);
    }
    if (!groups.has(note.groupKey)) groups.set(note.groupKey, note);
    for (const group of [note.groupKey, ...(note.groupAliases || [])]) {
      if (byGroup.has(group) && byGroup.get(group).groupKey !== note.groupKey) fail('ambiguous-group-alias');
      byGroup.set(group, note);
    }
  }
  return { byKey, groups, byGroup };
}
function qualified(note) {
  return typeof note.body === 'string' && note.body.trim() && typeof note.bodyHash === 'string'
    && note.bodyHash && note.quality?.policyVersion === '1' && note.quality.bodyHash === note.bodyHash
    && Number.isFinite(note.quality.score) && note.quality.score >= 3;
}
function exposure({ date, ledger = { batches: {} }, index }) {
  const weeks = activeWeeks(date);
  const byWeek = new Map(weeks.map((week) => [week, new Set()]));
  const current = ledger.batches?.[date];
  if (current && OCCUPIED.has(current.status)) fail('date-already-occupied');
  for (const [key, batch] of Object.entries(ledger.batches || {})) {
    if (!batch || typeof batch !== 'object') fail('invalid-ledger-batch');
    if (batch.status === 'failed') continue;
    if (!OCCUPIED.has(batch.status)) fail('invalid-ledger-status');
    if (batch.date !== key) fail('ledger-date-mismatch');
    const week = isoWeek(key);
    if (!byWeek.has(week)) continue;
    if (key > date) fail('future-ledger-batch');
    if (!Array.isArray(batch.items) || !batch.items.length) fail('incomplete-ledger-batch');
    for (const item of batch.items) {
      if (!item || typeof item !== 'object') fail('invalid-history-item');
      const byNote = index.byKey.get(item.noteKey);
      const byGroup = index.byGroup.get(item.groupKey);
      if (byNote && byGroup && byNote.groupKey !== byGroup.groupKey) fail('history-identity-conflict');
      const note = byNote || byGroup;
      if (!note) fail('unknown-history-identity');
      // Resolve aliases through the current catalog, so later merges never reset exposure.
      const set = byWeek.get(week);
      if (set.has(note.groupKey)) fail('history-same-week-repeat');
      set.add(note.groupKey);
    }
  }
  return byWeek;
}
function budgets(byWeek) {
  const entries = [...byWeek];
  const union = new Set(entries.flatMap(([, set]) => [...set]));
  const repeats = entries.reduce((sum, [, set]) => sum + set.size, 0) - union.size;
  const pairOverlaps = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const overlap = [...entries[i][1]].filter((key) => entries[j][1].has(key)).length;
    pairOverlaps.push({ weeks: [entries[i][0], entries[j][0]], overlap });
    if (overlap > 5) fail('pair-overlap-exceeds-5');
  }
  if (repeats > 10) fail('four-week-repeats-exceed-10');
  return { repeats, pairOverlaps };
}
function addGroups(byWeek, week, groups) {
  const next = new Map([...byWeek].map(([key, set]) => [key, new Set(set)]));
  for (const group of groups) {
    if (next.get(week).has(group)) fail('same-week-repeat');
    next.get(week).add(group);
  }
  return next;
}
function ageStatistics(byWeek, week, index, date) {
  const counts = { recent: 0, year: 0, older: 0 };
  for (const group of byWeek.get(week)) counts[ageBand(index.groups.get(group).createdAt, date)]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const recentRatio = total ? counts.recent / total : 0;
  const nearYearRatio = total ? (counts.recent + counts.year) / total : 0;
  const olderRatio = total ? counts.older / total : 0;
  const deviations = [];
  if (total && (recentRatio < .2 || recentRatio > .3)) deviations.push('recent-outside-20-30-percent');
  if (total && (nearYearRatio < .8 || nearYearRatio > .9)) deviations.push('near-year-outside-80-90-percent');
  if (total && olderRatio > .2) deviations.push('older-exceeds-20-percent');
  return { counts, total, recentRatio, nearYearRatio, olderRatio, deviations };
}

export function validateSelection({ date, items, notes, ledger }) {
  dayTime(date);
  if (!Array.isArray(items) || items.length < 3 || items.length > 6) fail('selection-count-must-be-3-to-6');
  const index = catalogIndex(notes);
  const byWeek = exposure({ date, ledger, index });
  const normalized = items.map((item, position) => {
    if (!item || typeof item !== 'object') fail('invalid-selection-item');
    const note = index.byKey.get(item.noteKey);
    if (!note) fail('unknown-selection-identity');
    if (!qualified(note)) fail('quality-not-current-or-below-3');
    if (item.bodyHash !== note.bodyHash) fail('selection-body-hash-mismatch');
    ageBand(note.createdAt, date);
    if (!['strong', 'background'].includes(item.relevance)) fail('invalid-relevance');
    if (position >= 3 && item.relevance !== 'strong') fail('extra-item-must-be-strong');
    if (typeof item.reason !== 'string' || !item.reason.trim()) fail('missing-recommendation-reason');
    if (!Array.isArray(item.contextEvidence) || !item.contextEvidence.length || item.contextEvidence.some((e) => !e || typeof e.path !== 'string' || !e.path.trim() || typeof e.quote !== 'string' || !e.quote.trim())) fail('missing-context-evidence');
    return { ...item, noteKey: note.noteKey, groupKey: note.groupKey };
  });
  const week = isoWeek(date);
  const next = addGroups(byWeek, week, normalized.map((item) => item.groupKey));
  const delivered = exposure({ date, index, ledger: { batches: Object.fromEntries(Object.entries(ledger?.batches || {}).filter(([, batch]) => batch.status === 'delivered')) } });
  return { date, week, items: normalized, ...budgets(next), age: { ...ageStatistics(addGroups(delivered, week, normalized.map((item) => item.groupKey)), week, index, date), basis: 'delivered-plus-proposed' }, ageObserved: { ...ageStatistics(delivered, week, index, date), basis: 'delivered-only' } };
}
export const normalizeSelection = validateSelection;

export function eligibleNotes({ date, notes, ledger }) {
  const index = catalogIndex(notes);
  const byWeek = exposure({ date, ledger, index });
  budgets(byWeek);
  const seen = new Set();
  return notes.filter((note) => {
    if (!qualified(note) || seen.has(note.groupKey) || byWeek.get(isoWeek(date)).has(note.groupKey)) return false;
    try { ageBand(note.createdAt, date); } catch { return false; }
    try { budgets(addGroups(byWeek, isoWeek(date), [note.groupKey])); }
    catch { return false; }
    seen.add(note.groupKey);
    return true;
  });
}

// A deterministic capacity check, not a semantic recommendation or send-ready batch.
export function simulateSupply({ notes, startDate, days = 28 }) {
  if (![7, 28].includes(days)) fail('simulation-days-must-be-7-or-28');
  const first = dayTime(startDate);
  const eligible = eligibleNotes({ date: startDate, notes, ledger: { batches: {} } });
  const minimum = days === 28 ? 74 : 21;
  if (eligible.length < minimum) return { possible: false, reason: 'insufficient-distinct-quality-supply', uniqueQualified: eligible.length, minimum, schedule: [] };
  const ledger = { batches: {} };
  const counts = new Map();
  const schedule = [];
  const index = catalogIndex(notes);
  for (let i = 0; i < days; i++) {
    const date = dateString(first + i * DAY);
    let byWeek = exposure({ date, ledger, index });
    const candidates = eligibleNotes({ date, notes, ledger }).sort((a, b) => (counts.get(a.groupKey) || 0) - (counts.get(b.groupKey) || 0) || a.noteKey.localeCompare(b.noteKey));
    const items = [];
    for (const note of candidates) {
      try {
        const next = addGroups(byWeek, isoWeek(date), [note.groupKey]);
        budgets(next);
        byWeek = next;
        items.push({ noteKey: note.noteKey, groupKey: note.groupKey });
      } catch { continue; }
      if (items.length === 3) break;
    }
    if (items.length < 3) return { possible: false, reason: 'constraint-supply-exhausted', date, uniqueQualified: eligible.length, minimum, schedule };
    for (const item of items) counts.set(item.groupKey, (counts.get(item.groupKey) || 0) + 1);
    ledger.batches[date] = { date, status: 'delivered', items };
    schedule.push({ date, week: isoWeek(date), items, ...budgets(byWeek) });
  }
  return { possible: true, uniqueQualified: eligible.length, minimum, schedule };
}
export function simulate28Days(options) { return simulateSupply({ ...options, days: 28 }); }

import { readFile, writeFile, mkdir, rename, unlink, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { scanArchive, hashBody } from './catalog.mjs';
import { validateSelection, eligibleNotes, simulateSupply, isoWeek, activeWeeks, MIN_REVIEW_ITEMS, TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS } from './policy.mjs';
import { preflightDelivery, sendRecommendation, recoverRecommendation, collectFeedback, normalizeMessageMarkdown } from './delivery.mjs';
import { buildReviewContext, validateEvidence, sha256, shanghaiDate, validDate } from './context.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export function paths(root = repoRoot) {
  const runtime = path.join(root, '04_output/_dist/flomo-review');
  return { runtime, catalog: path.join(root, '03_input/_archives/flomo/catalog.json'), ledger: path.join(runtime, 'ledger.json'), config: path.join(root, '00_config/flomo-review.json') };
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e; }
}
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`, fd = await open(tmp, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
  try { await rename(tmp, file); } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function withLock(root, action) {
  const { runtime } = paths(root); await mkdir(runtime, { recursive: true });
  const lock = path.join(runtime, 'write.lock'); let fd;
  try { fd = await open(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw Error('review-locked-inspect-owner-before-recovery'); throw e; }
  try { await fd.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await action(); }
  finally { await fd.close(); await unlink(lock); }
}
export const emptyLedger = () => ({ schemaVersion: 1, batches: {}, feedback: {}, failures: [] });
function assertLedger(value) {
  if (value.schemaVersion !== 1 || !value.batches || typeof value.batches !== 'object' || !value.feedback) throw Error('ledger-invalid');
  return value;
}
export function catalogHash(catalog) {
  return sha256(JSON.stringify(catalog.notes.map(n => ({ noteKey: n.noteKey, aliases: n.aliases, groupKey: n.groupKey, groupAliases: n.groupAliases, bodyHash: n.bodyHash, quality: n.quality, sources: n.sources }))));
}
export async function refreshArchive(root = repoRoot) {
  return withLock(root, async () => {
    const p = paths(root), previous = await readJson(p.catalog, { schemaVersion: 1, notes: [] });
    const catalog = await scanArchive(root, { previous });
    catalog.updatedAt = new Date().toISOString(); catalog.catalogHash = catalogHash(catalog);
    await atomicJson(p.catalog, catalog);
    return { notes: catalog.notes.length, eligibleQuality: catalog.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: catalog.excluded.length, coverage: catalog.coverage };
  });
}
export function qualityPackets(catalog, maxChars = 24000) {
  const packets = []; let notes = [], chars = 0;
  for (const note of catalog.notes.filter(n => !n.quality || n.quality.bodyHash !== n.bodyHash || n.quality.policyVersion !== '1')) {
    const record = { noteKey: note.noteKey, bodyHash: note.bodyHash, createdAt: note.createdAt, body: note.body };
    const size = JSON.stringify(record).length;
    if (notes.length && chars + size > maxChars) { packets.push({ schemaVersion: 1, policyVersion: '1', notes }); notes = []; chars = 0; }
    notes.push(record); chars += size;
  }
  if (notes.length) packets.push({ schemaVersion: 1, policyVersion: '1', notes });
  return packets;
}
export async function acceptQuality(root, decisions) {
  return withLock(root, async () => {
    const p = paths(root), catalog = await readJson(p.catalog);
    if (decisions.policyVersion !== '1' || !Array.isArray(decisions.items) || !decisions.items.length) throw Error('quality-contract-invalid');
    const seen = new Set();
    for (const d of decisions.items) {
      const note = catalog.notes.find(n => n.noteKey === d.noteKey);
      if (!note || seen.has(d.noteKey) || d.bodyHash !== note.bodyHash || hashBody(note.body) !== note.bodyHash || !Number.isInteger(d.score) || d.score < 0 || d.score > 4 || !d.summary?.trim() || !d.reason?.trim() || typeof d.quote !== 'string' || d.quote.trim().length < 4 || !note.body.includes(d.quote)) throw Error('quality-decision-untraceable');
      seen.add(d.noteKey);
    }
    for (const d of decisions.items) catalog.notes.find(n => n.noteKey === d.noteKey).quality = { ...d, policyVersion: '1', assessedAt: new Date().toISOString() };
    catalog.catalogHash = catalogHash(catalog); await atomicJson(p.catalog, catalog);
    return { assessed: decisions.items.length, qualified: catalog.notes.filter(n => n.quality?.score >= 3).length, total: catalog.notes.length };
  });
}
export async function prepareReview(root = repoRoot, date = shanghaiDate(), options = {}) {
  validDate(date); await refreshArchive(root);
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  const context = await buildReviewContext(root, { date, ...options });
  const eligible = eligibleNotes({ date, notes: catalog.notes, ledger });
  const packet = { schemaVersion: 1, date, contextHash: context.contextHash, catalogHash: catalogHash(catalog), context,
    notes: eligible.map(({ noteKey, groupKey, createdAt, bodyHash, quality, source }) => ({ noteKey, groupKey, createdAt, bodyHash, quality, source })),
    feedback: Object.values(ledger.feedback).filter(e => !e.superseded && eligible.some(n => n.noteKey === e.noteKey)),
    instruction: `完整读取上下文；常规目标选择${TARGET_MIN_REVIEW_ITEMS}–${MAX_REVIEW_ITEMS}条。先选与近期周/月Output强匹配的高质量笔记；前三条可使用高质量长期背景关联并说明关联，第4–${MAX_REVIEW_ITEMS}条必须强匹配。若只有${MIN_REVIEW_ITEMS}–${TARGET_MIN_REVIEW_ITEMS - 1}条同时满足质量与对应序号上下文要求，可少于目标数量发送，必须填写countDeviationReason说明未达到${TARGET_MIN_REVIEW_ITEMS}条的质量或匹配原因；不得为了达到目标降低质量。按整周年龄统计优化近30天与近365天软比例；比例偏离时必须填ageDeviationReason解释，不得为配比降低质量。少于${MIN_REVIEW_ITEMS}条则报告blocked，不凑数。复读每条原文，引用真实上下文。输出{date,contextHash,catalogHash,countDeviationReason,ageDeviationReason,items:[{noteKey,bodyHash,relevance:strong|background,reason,contextEvidence:[{path,quote}]}]}。` };
  const directory = path.join(p.runtime, date); await atomicJson(path.join(directory, 'request.json'), packet);
  return { date, qualifiedEligible: eligible.length, contextHash: packet.contextHash, catalogHash: packet.catalogHash, requestPath: path.join(directory, 'request.json'), missing: context.manifest.missing };
}
export function renderReview(decision, notes) {
  const title = `# Flomo 回顾｜${decision.date}`, message = [title, ''], full = [title, ''];
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS) {
    const note = `本日符合质量与上下文要求的笔记不足${TARGET_MIN_REVIEW_ITEMS}条，实际推荐${decision.items.length}条。原因：${decision.countDeviationReason.trim()}`;
    message.push(note, '');
    full.push(note, '');
  }
  for (const [index, item] of decision.items.entries()) {
    const note = notes.find(n => n.noteKey === item.noteKey), summary = note.quality.summary;
    const link = note.source.url ? `[Flomo原文](${note.source.url})` : '原文见随附Markdown';
    const heading = `## ${index + 1}. ${summary}`;
    const date = shanghaiDate(new Date(note.createdAt));
    const quote = [...note.body].slice(0, 220).join('');
    const source = note.source.url ? `[Flomo原文](${note.source.url})` : '';
    message.push(heading, '', `创建日期：${date} · ${link}`, '', ...quote.split('\n').map(x => `> ${x}`), '', `回顾理由：${reviewReason(item)}`, '');
    full.push(heading, '', `创建日期：${date}`, `来源：${note.source.url || `${note.source.path}:${note.source.line}`}`, '', note.body, '', `回顾理由：${item.reason}`, '', '---', '');
  }
  message.push('可以回复本条消息：“第2条有帮助”“第1条跳过”或“第3条已回顾”。', '', `回顾日期：${decision.date}`);
  return { markdown: `${message.join('\n')}\n`, fullMarkdown: `${full.join('\n')}\n` };
}
export async function inspectDecision(root, decision, { freshContext = false, contextOptions = {} } = {}) {
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  const request = await readJson(path.join(p.runtime, validDate(decision.date), 'request.json'));
  if (decision.contextHash !== request.contextHash || decision.catalogHash !== catalogHash(catalog)) throw Error('decision-input-changed');
  const context = freshContext ? await buildReviewContext(root, { date: decision.date, ...contextOptions }) : request.context;
  if (context.contextHash !== decision.contextHash) throw Error('live-context-changed-reselect');
  validateEvidence(decision.items, context);
  for (const item of decision.items) {
    const note = catalog.notes.find(n => n.noteKey === item.noteKey);
    if (!note || hashBody(note.body) !== note.bodyHash) throw Error('note-body-hash-invalid');
  }
  const stats = validateSelection({ date: decision.date, items: decision.items, notes: catalog.notes, ledger });
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS && (typeof decision.countDeviationReason !== 'string' || !decision.countDeviationReason.trim())) throw Error('count-shortfall-needs-reason');
  if (stats.age.deviations.length && !decision.ageDeviationReason?.trim()) throw Error('age-deviation-needs-reason');
  stats.age.deviationReason = stats.age.deviations.length ? decision.ageDeviationReason.trim() : null;
  return { catalog, ledger, context, stats, ...renderReview(decision, catalog.notes) };
}
export async function previewReview(root, decision) {
  const result = await inspectDecision(root, decision), dir = path.join(paths(root).runtime, decision.date);
  await atomicJson(path.join(dir, 'decision.json'), decision);
  await writeFile(path.join(dir, 'review.md'), result.fullMarkdown, { mode: 0o600 });
  await writeFile(path.join(dir, 'message.md'), result.markdown, { mode: 0o600 });
  await atomicJson(path.join(dir, 'validation.json'), result.stats);
  return { date: decision.date, count: decision.items.length, stats: result.stats, previewPath: path.join(dir, 'review.md') };
}
export async function sendReview(root, decision, { now = new Date(), deliveryOptions = {}, contextOptions = {} } = {}) {
  if (decision.date !== shanghaiDate(now)) throw Error('stale-date-no-backfill-send');
  // Refresh current source tags/status before reserving; an edited or filtered note invalidates the decision.
  await refreshArchive(root);
  return withLock(root, async () => {
    const p = paths(root), config = await readJson(p.config);
    const check = await inspectDecision(root, decision, { freshContext: true, contextOptions });
    const previous = check.ledger.batches[decision.date];
    if (previous && ['delivered', 'sending', 'needs_review', 'reserved'].includes(previous.status)) throw Error('date-already-reserved-or-delivered');
    const preflight = await preflightDelivery({ ...config.delivery, now, ...deliveryOptions });
    const dir = path.join(p.runtime, decision.date); await mkdir(dir, { recursive: true });
    const attachmentPath = path.join(dir, 'review.md'); await writeFile(attachmentPath, check.fullMarkdown, { mode: 0o600 });
    const batch = { date: decision.date, status: 'reserved', contextHash: decision.contextHash, catalogHash: decision.catalogHash,
      items: decision.items.map(i => ({ ...i, groupKey: check.catalog.notes.find(n => n.noteKey === i.noteKey).groupKey })),
      ...(decision.items.length < TARGET_MIN_REVIEW_ITEMS ? { countDeviationReason: decision.countDeviationReason.trim() } : {}),
      stats: check.stats, chatId: config.delivery.chatId, profile: preflight.profile, botSenderId: preflight.botSenderId, botSenderIds: preflight.botSenderIds, idempotencyKey: `learn-x-flomo-review:${decision.date}`,
      markdown: check.markdown, markdownSha256: sha256(normalizeMessageMarkdown(check.markdown)), attachmentPath, attachmentSha256: sha256(check.fullMarkdown), createdAt: now.toISOString() };
    check.ledger.batches[decision.date] = batch; await atomicJson(p.ledger, check.ledger);
    batch.status = 'sending'; batch.sendStartedAt = new Date().toISOString(); await atomicJson(p.ledger, check.ledger);
    try {
      const sent = await sendRecommendation({ chatId: batch.chatId, markdown: batch.markdown, attachmentPath: batch.attachmentPath, attachmentSha256: batch.attachmentSha256,
        dateMarker: `回顾日期：${batch.date}`, idempotencyKey: batch.idempotencyKey, profile: batch.profile, botSenderId: batch.botSenderId, botSenderIds: batch.botSenderIds,
        onUploaded: async receipt => { Object.assign(batch, receipt); await atomicJson(p.ledger, check.ledger); }, ...deliveryOptions });
      Object.assign(batch, sent, { status: 'delivered', deliveredAt: new Date().toISOString() });
      await atomicJson(p.ledger, check.ledger);
      return { date: batch.date, status: batch.status, count: batch.items.length, messageId: batch.messageId };
    } catch (error) {
      batch.status = error.uncertain === false ? 'failed' : 'needs_review';
      batch.error = error.message; if (error.messageId) batch.messageId = error.messageId;
      if (batch.status === 'failed') {
        batch.failedAt = new Date().toISOString();
        check.ledger.failures ??= [];
        if (!Array.isArray(check.ledger.failures)) throw Error('ledger-failures-invalid');
        check.ledger.failures.push({ date: batch.date, createdAt: batch.createdAt, failedAt: batch.failedAt, error: batch.error,
          countDeviationReason: batch.countDeviationReason ?? null, ageDeviationReason: batch.stats?.age?.deviationReason ?? null,
          items: batch.items.map(item => ({ ...item })), stats: batch.stats, contextHash: batch.contextHash, catalogHash: batch.catalogHash,
          markdownSha256: batch.markdownSha256, attachmentSha256: batch.attachmentSha256 });
      }
      await atomicJson(p.ledger, check.ledger); throw error;
    }
  });
}

function reviewReason(item) {
  return item.relevance === 'background' ? `${item.reason}（背景）` : item.reason;
}

export async function recoverReview(root, date, deliveryOptions = {}) {
  return withLock(root, async () => {
    const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), batch = ledger.batches[validDate(date)];
    if (!batch || !['sending', 'needs_review', 'reserved', 'delivered'].includes(batch.status)) throw Error('batch-not-recoverable');
    const result = await recoverRecommendation({ ...batch, dateMarker: `回顾日期：${date}`, expectedCard: batch.card, expectedMarkdown: batch.markdown, ...deliveryOptions });
    if (!result?.messageId) throw Error('send-recovery-unresolved-no-resend');
    Object.assign(batch, result, { status: 'delivered', recoveredAt: new Date().toISOString() }); await atomicJson(p.ledger, ledger);
    return { date, status: batch.status, messageId: batch.messageId };
  });
}
export async function feedbackReview(root, { date = shanghaiDate(), targetDate, ...options } = {}) {
  const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), config = await readJson(p.config), weeks = activeWeeks(date);
  const batches = Object.values(ledger.batches).filter(b => b.status === 'delivered' && (targetDate ? b.date === targetDate : weeks.includes(b.stats?.week)));
  const result = await collectFeedback({ batches, ownerId: config.delivery.ownerId, profile: config.delivery.profile, ...options });
  if (result.complete !== true || result.errors?.length || result.truncated || !Array.isArray(result.replyObservations)) throw Error('feedback-incomplete-do-not-advance');
  return withLock(root, async () => {
    const current = assertLedger(await readJson(p.ledger, emptyLedger()));
    let newEvents = 0, newObservations = 0;
    current.feedbackReplyVersions ??= {};
    const versionTime = event => /^\d+$/.test(event.updateTime) ? Number(event.updateTime) * (Number(event.updateTime) < 1e12 ? 1000 : 1) : new Date(event.updateTime).getTime();
    const sameVersion = (a, b) => a.replyId === b.replyId && versionTime(a) === versionTime(b);
    for (const observation of result.replyObservations ?? []) {
      if (!observation.observationKey || !observation.replyId || !Number.isFinite(versionTime(observation)) || !['present', 'deleted'].includes(observation.state) || !Array.isArray(observation.eventKeys)) throw Error('feedback-observation-invalid');
      const previous = Object.values(current.feedbackReplyVersions).find(value => sameVersion(value, observation));
      if (previous && (previous.rootMessageId !== observation.rootMessageId || previous.state !== observation.state || previous.contentSha256 !== observation.contentSha256 || JSON.stringify(previous.eventKeys) !== JSON.stringify(observation.eventKeys))) throw Error('feedback-version-conflict');
      if (!previous) { current.feedbackReplyVersions[observation.observationKey] = observation; newObservations += 1; }
    }
    for (const event of result.events) {
      if (!event.eventKey || !event.replyId || !event.updateTime) throw Error('feedback-event-identity-invalid');
      if (current.feedback[event.eventKey]) continue;
      current.feedback[event.eventKey] = event; newEvents += 1;
    }
    const latestByReply = new Map();
    for (const event of Object.values(current.feedback)) {
      const version = versionTime(event);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(event.replyId);
      if (!previous || version > versionTime(previous)) latestByReply.set(event.replyId, event);
    }
    for (const observation of Object.values(current.feedbackReplyVersions)) {
      const version = versionTime(observation);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(observation.replyId);
      if (!previous || version >= versionTime(previous)) latestByReply.set(observation.replyId, observation);
    }
    for (const event of Object.values(current.feedback)) {
      const latest = latestByReply.get(event.replyId);
      event.superseded = versionTime(event) < versionTime(latest) || latest.state === 'deleted' || (Array.isArray(latest.eventKeys) && !latest.eventKeys.includes(event.eventKey));
    }
    current.feedbackCheckedAt = new Date().toISOString(); await atomicJson(p.ledger, current);
    return { checkedBatches: batches.length, events: result.events.length, newEvents, newObservations, totalFeedback: Object.keys(current.feedback).length };
  });
}
export async function simulateCapacity(root = repoRoot, startDate = shanghaiDate(), days = 28) {
  const catalog = await readJson(paths(root).catalog);
  const simulation = simulateSupply({ notes: catalog.notes, startDate, days });
  const counts = simulation.schedule.map(day => day.items.length);
  const overlaps = simulation.schedule.flatMap(day => day.pairOverlaps.map(pair => pair.overlap));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startDate,
    days,
    possible: simulation.possible,
    targetDailyCountRange: [TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS],
    ...(simulation.reason ? { reason: simulation.reason } : {}),
    ...(simulation.date ? { failedDate: simulation.date } : {}),
    uniqueQualified: simulation.uniqueQualified,
    minimum: simulation.minimum,
    scheduledDays: simulation.schedule.length,
    dailyCountRange: counts.length ? [Math.min(...counts), Math.max(...counts)] : [],
    maximumRepeatCount: Math.max(0, ...simulation.schedule.map(day => day.repeats)),
    maximumPairOverlap: Math.max(0, ...overlaps),
  };
  const reportPath = path.join(paths(root).runtime, `capacity-${days}-verified-${isoWeek(startDate)}.json`);
  await atomicJson(reportPath, report);
  return { ...report, reportPath };
}
async function main(argv) {
  const [command] = argv, arg = key => argv[argv.indexOf(key) + 1], date = argv.includes('--date') ? validDate(arg('--date')) : shanghaiDate();
  const p = paths();
  if (command === 'archive') return refreshArchive();
  if (command === 'quality-packets') {
    const catalog = await readJson(p.catalog), packets = qualityPackets(catalog); const dir = path.join(p.runtime, 'quality-packets'); await mkdir(dir, { recursive: true });
    for (const [i, packet] of packets.entries()) await atomicJson(path.join(dir, `${String(i + 1).padStart(3, '0')}.json`), packet);
    return { packets: packets.length, notes: packets.reduce((s, x) => s + x.notes.length, 0), directory: dir };
  }
  if (command === 'quality-accept') return acceptQuality(repoRoot, await readJson(path.resolve(arg('--file'))));
  if (command === 'prepare') return prepareReview(repoRoot, date);
  if (command === 'preview' || command === 'send') {
    const decision = await readJson(path.resolve(arg('--file')));
    return command === 'preview' ? previewReview(repoRoot, decision) : sendReview(repoRoot, decision);
  }
  if (command === 'recover') return recoverReview(repoRoot, date);
  if (command === 'feedback') return feedbackReview(repoRoot, { date, targetDate: argv.includes('--target-date') ? arg('--target-date') : undefined });
  if (command === 'simulate') return simulateCapacity(repoRoot, date, argv.includes('--days') ? Number(arg('--days')) : 28);
  if (command === 'status') {
    const c = await readJson(p.catalog, { notes: [], excluded: [] }), l = assertLedger(await readJson(p.ledger, emptyLedger()));
    return { notes: c.notes.length, qualified: c.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: c.excluded.length, batches: Object.values(l.batches).map(({ date, status, messageId }) => ({ date, status, messageId })), feedback: Object.keys(l.feedback).length };
  }
  throw Error('usage: archive|quality-packets|quality-accept --file|prepare|preview --file|send --file|feedback|recover|simulate|status');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(async e => {
    const p = paths(); await mkdir(p.runtime, { recursive: true });
    await atomicJson(path.join(p.runtime, 'last-failure.json'), { at: new Date().toISOString(), command: process.argv[2], error: e.message }).catch(() => {});
    console.error(JSON.stringify({ status: 'blocked', error: e.message })); process.exitCode = 1;
  });
}

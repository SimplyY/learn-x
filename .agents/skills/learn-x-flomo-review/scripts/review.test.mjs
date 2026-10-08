import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshArchive, acceptQuality, prepareReview, previewReview, renderReview, sendReview, recoverReview, feedbackReview, simulateCapacity, readJson, atomicJson, paths, emptyLedger } from './review.mjs';
import { cardContentSha256 } from './delivery.mjs';
import { sha256 } from './context.mjs';

const date = '2026-10-06', now = new Date(`${date}T20:00:00+08:00`);
const chatId = 'oc_test', ownerId = 'ou_owner', appId = 'cli_test', profile = 'test_profile';
const envelope = (data, meta = {}) => ({ ok: true, identity: 'bot', data, meta });
const output = '# 人工保存的Output\n\n近期正在重新辨认长期方向与现实反馈。'.repeat(12);
async function downloadedMessage(root, content, messageId = 'om_sent') {
  const card = typeof content === 'string' ? JSON.parse(content) : content;
  return { message_id: messageId, chat_id: chatId, msg_type: 'interactive', sender: { id: appId, sender_type: 'app' }, deleted: false,
    content: JSON.stringify(card), resources: [] };
}
const readDao = async () => ({ kind: 'dao', content: '# 道\n\n长期原则经过现实反馈检验。', revision: 7, sha256: sha256('# 道\n\n长期原则经过现实反馈检验。'), sourceUrl: 'https://example.test/dao', readAt: now.toISOString() });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (p, content) => { await mkdir(path.dirname(path.join(root, p)), { recursive: true }); await writeFile(path.join(root, p), content); };
  await put('00_config/flomo-review.json', JSON.stringify({ schemaVersion: 1, delivery: { chatId, ownerId, profile } }));
  await put('04_output/weekly/2026-40.md', output);
  await put('04_output/monthly/2026-09.md', output);
  await put('01_core/memory/2026-Q3.memory.md', '# Memory\n\n已确认的长期学习判断。');
  const archive = Array.from({ length: 8 }, (_, i) => `## 2026-09-${20 + i} 09:00\n\n我从第${i + 1}次真实实验中观察到，先记录反馈才能辨认限制条件。\n`).join('\n---\n\n');
  await put('03_input/monthly/2026-9/flomo.md', archive);
  await refreshArchive(root);
  let catalog = await readJson(paths(root).catalog);
  await acceptQuality(root, { policyVersion: '1', items: catalog.notes.map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, score: 3, summary: '真实实验的判断', reason: '记录经验并提炼可迁移判断', quote: '先记录反馈' })) });
  const prepared = await prepareReview(root, date, { readDao });
  catalog = await readJson(paths(root).catalog);
  const decision = { date, contextHash: prepared.contextHash, catalogHash: prepared.catalogHash, ageDeviationReason: '本测试库只有近期合格来源；先遵守质量与硬去重，年龄比例按整周继续观察。', items: catalog.notes.slice(0, 6).map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '现实反馈需再检验', contextEvidence: [{ path: '04_output/weekly/2026-40.md', quote: '近期正在重新辨认长期方向与现实反馈。' }] })) };
  return { root, put, decision, options: { now, contextOptions: { readDao } } };
}

function deliveryMock(root, { sendError = false, timeout = false, preflightGate } = {}) {
  const calls = [];
  let sentCard;
  const runCli = async (args) => {
    calls.push(args);
    assert.equal(args[args.indexOf('--profile') + 1], profile);
    assert.equal(args[args.indexOf('--as') + 1], 'bot');
    if (args[0] === 'whoami') { if (preflightGate) await preflightGate; return { identity: 'bot', profile, appId, available: true }; }
    if (args[1] === '+chat-members-list') return envelope({ chat_id: chatId, users: [{ member_id: ownerId }], bots: [{ member_id: 'ou_bot', app_id: appId }], user_total: 1, bot_total: 1, has_more: false });
    if (args[1] === '+chat-messages-list') return envelope({ messages: [], has_more: false });
    if (args[1] === '+messages-send') {
      const batch = (await readJson(paths(root).ledger)).batches[date];
      assert.equal(batch.status, 'sending');
      assert.ok(batch.sendStartedAt);
      assert.equal(batch.cardContentSha256, cardContentSha256(batch.card));
      assert.ok(batch.auditPath.endsWith('/review.md'));
      assert.deepEqual(batch.botSenderIds, ['ou_bot', appId]);
      sentCard = JSON.parse(args[args.indexOf('--content') + 1]);
      assert.deepEqual(sentCard, batch.card);
      assert.ok(args.includes('--msg-type') && args.includes('interactive'));
      assert.ok(!args.includes('--markdown') && !args.includes('--attachment'));
      assert.ok(!JSON.stringify(sentCard).includes('创建日期'));
      assert.ok(!JSON.stringify(sentCard).includes('原文见随附Markdown'));
      if (sendError) throw Error('send-error');
      if (timeout) throw Error('timeout-after-send');
      return envelope({ chat_id: chatId, message_id: 'om_sent' });
    }
    if (args[1] === '+messages-mget') return envelope({ messages: [await downloadedMessage(root, sentCard)] });
    throw Error('unexpected-mock-command');
  };
  return { runCli, calls, sentCard: () => sentCard };
}

test('send persists reservation/sending before mutation, verifies delivery and rejects same-day rerun', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root);
  const result = await sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } });
  assert.equal(result.status, 'delivered');
  const ledger = await readJson(paths(root).ledger), batch = ledger.batches[date];
  assert.equal(batch.messageId, 'om_sent');
  assert.equal(batch.profile, profile);
  assert.equal(batch.items.length, 6);
  assert.equal(batch.card.schema, '2.0');
  assert.equal(batch.cardContentSha256, cardContentSha256(batch.card));
  assert.ok(batch.auditPath.endsWith('/review.md'));
  await recoverReview(root, date, { runCli: mock.runCli });
  assert.equal((await readJson(paths(root).ledger)).batches[date].normalizationVersion, 2);
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), /date-already/);
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('mutual lock rejects concurrent attempts while one process owns the send', async (t) => {
  const { root, decision, options } = await fixture(t);
  let release, arrived;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { arrived = resolve; });
  const mock = deliveryMock(root, { preflightGate: gate });
  const runCli = async args => { if (args[0] === 'whoami') arrived(); return mock.runCli(args); };
  const first = sendReview(root, decision, { ...options, deliveryOptions: { runCli } });
  await reached;
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli } }), /review-locked/);
  release(); await first;
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('timeout retains occupied needs_review and recovery only reads the exact saved body', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root, { timeout: true });
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), error => error.uncertain === true);
  let ledger = await readJson(paths(root).ledger);
  assert.equal(ledger.batches[date].status, 'needs_review');
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), /date-already/);
  const calls = [];
  const result = await recoverReview(root, date, { runCli: async args => {
    calls.push(args);
    assert.ok(['+chat-messages-list', '+messages-mget'].includes(args[1]));
    return envelope({ messages: [await downloadedMessage(root, mock.sentCard(), 'om_recovered')], has_more: false });
  } });
  assert.equal(result.messageId, 'om_recovered');
  ledger = await readJson(paths(root).ledger);
  assert.equal(ledger.batches[date].status, 'delivered');
  assert.equal(calls.length, 2);
  assert.equal(ledger.batches[date].cardContentSha256, cardContentSha256(ledger.batches[date].card));
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('failed send retains occupancy as needs_review', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root, { sendError: true });
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), error => error.uncertain === true);
  assert.equal((await readJson(paths(root).ledger)).batches[date].status, 'needs_review');
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('edited archive or current context rejects decision before any delivery call', async (t) => {
  const { root, decision, put, options } = await fixture(t);
  let calls = 0;
  await put('04_output/weekly/2026-40.md', `${output}\n新事实导致上下文版本变化。`);
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: async () => { calls++; throw Error('must-not-call'); } } }), /live-context-changed/);
  await put('04_output/weekly/2026-40.md', output);
  const archivePath = path.join(root, '03_input/monthly/2026-9/flomo.md');
  await writeFile(archivePath, (await readFile(archivePath, 'utf8')).replace('先记录反馈', '先记录新的反馈'));
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: async () => { calls++; throw Error('must-not-call'); } } }), /decision-input-changed/);
  assert.equal(calls, 0);
  assert.deepEqual((await readJson(paths(root).ledger, emptyLedger())).batches, {});
});

async function feedbackSetup(t) {
  const { root } = await fixture(t), ledger = emptyLedger();
  const card = { schema: '2.0', body: { elements: [{ tag: 'markdown', content: `回复反馈｜回顾日期：${date}` }] } };
  ledger.batches[date] = { date, status: 'delivered', chatId, profile, botSenderId: appId, botSenderIds: ['ou_bot', appId], messageId: 'om_sent', stats: { week: '2026-W41' }, card, cardContentSha256: cardContentSha256(card), items: Array.from({ length: 10 }, (_, index) => ({ noteKey: `note_${index}` })) };
  await atomicJson(paths(root).ledger, ledger);
  const run = (content, version, incomplete = false, replyExtra = {}) => async args => {
    const batch = ledger.batches[date];
    assert.equal(args[args.indexOf('--profile') + 1], profile);
    if (args[1] === '+messages-mget') return envelope({ messages: [{ message_id: 'om_sent', chat_id: chatId, sender: { id: appId, sender_type: 'app' }, content: JSON.stringify(batch.card), deleted: false, thread_id: 'omt_sent' }] });
    return envelope({ has_more: incomplete, messages: [{ message_id: 'om_reply', chat_id: chatId, root_id: 'om_sent', thread_id: 'omt_sent', sender: { id: ownerId, sender_type: 'user' }, content, create_time: now.getTime(), ...(version ? { updated: true, update_time: now.getTime() + version } : {}), ...replyExtra }] });
  };
  return { root, run };
}

test('feedback persists each ordinal, deduplicates rereads and preserves edited versions', async (t) => {
  const { root, run } = await feedbackSetup(t);
  const first = await feedbackReview(root, { date, runCli: run('第1条跳过；第2条有帮助') });
  assert.equal(first.newEvents, 2);
  const again = await feedbackReview(root, { date, runCli: run('第1条跳过；第2条有帮助') });
  assert.equal(again.newEvents, 0);
  const edited = await feedbackReview(root, { date, runCli: run('第1条已回顾', 1000) });
  assert.equal(edited.newEvents, 1);
  const feedback = Object.values((await readJson(paths(root).ledger)).feedback);
  assert.equal(feedback.length, 3);
  assert.equal(feedback.filter(event => event.superseded).length, 2);
  assert.equal(feedback.find(event => !event.superseded).feedback, '已回顾');
});

test('feedback accepts decimal and Chinese tenth ordinal', async (t) => {
  const { root, run } = await feedbackSetup(t);
  const result = await feedbackReview(root, { date, runCli: run('第9条跳过；第10条有帮助') });
  assert.equal(result.newEvents, 2);
  const feedback = Object.values((await readJson(paths(root).ledger)).feedback);
  assert.deepEqual(feedback.map(event => event.number), [9, 10]);
});

test('incomplete feedback leaves previous events and checkedAt untouched', async (t) => {
  const { root, run } = await feedbackSetup(t);
  await feedbackReview(root, { date, runCli: run('第2条有帮助') });
  const before = await readFile(paths(root).ledger, 'utf8');
  await assert.rejects(feedbackReview(root, { date, runCli: run('第1条跳过', 1000, true) }), /feedback-incomplete/);
  assert.equal(await readFile(paths(root).ledger, 'utf8'), before);
});

for (const content of ['普通聊天', '']) test(`edit to ${content || 'empty'} supersedes active skip without creating a negative event`, async (t) => {
  const { root,run }=await feedbackSetup(t);
  await feedbackReview(root,{date,runCli:run('第1条跳过')});
  const changed=await feedbackReview(root,{date,runCli:run(content,1000)});
  assert.equal(changed.newEvents,0);assert.equal(changed.newObservations,1);
  let ledger=await readJson(paths(root).ledger);
  assert.equal(Object.values(ledger.feedback).filter(e=>!e.superseded).length,0);
  assert.equal(Object.keys(ledger.feedbackReplyVersions).length,2);
  const again=await feedbackReview(root,{date,runCli:run(content,1000)});
  assert.equal(again.newObservations,0);
  // A later-arriving stale snapshot cannot reactivate the withdrawn skip.
  await feedbackReview(root,{date,runCli:run('第1条跳过')});
  ledger=await readJson(paths(root).ledger);
  assert.equal(Object.values(ledger.feedback).filter(e=>!e.superseded).length,0);
});

test('versioned explicit deletion withdraws old feedback and retains audit evidence',async(t)=>{
  const {root,run}=await feedbackSetup(t);
  await feedbackReview(root,{date,runCli:run('第1条跳过')});
  await feedbackReview(root,{date,runCli:run('',1000,false,{deleted:true})});
  const ledger=await readJson(paths(root).ledger);
  assert.equal(Object.values(ledger.feedback)[0].superseded,true);
  assert.equal(Object.values(ledger.feedbackReplyVersions).filter(e=>e.state==='deleted').length,1);
});

for(const [name,content,version,extra,incomplete] of [
  ['plain edit missing timestamp','普通聊天',1000,{update_time:undefined},false],
  ['delete missing timestamp','',0,{deleted:true},false],
  ['delete invalid timestamp','',1000,{deleted:true,update_time:'unknown'},false],
  ['same timestamp changed content','普通聊天',0,{},false],
  ['incomplete edited thread','普通聊天',1000,{},true],
])test(`${name} leaves full ledger bytes untouched`,async(t)=>{
  const {root,run}=await feedbackSetup(t);
  await feedbackReview(root,{date,runCli:run('第1条跳过')});
  const before=await readFile(paths(root).ledger,'utf8');
  await assert.rejects(feedbackReview(root,{date,runCli:run(content,version,incomplete,extra)}),/feedback-incomplete|feedback-version-conflict/);
  assert.equal(await readFile(paths(root).ledger,'utf8'),before);
});

test('absent reply from a complete thread does not imply deletion or silence as negative feedback',async(t)=>{
  const {root,run}=await feedbackSetup(t);
  await feedbackReview(root,{date,runCli:run('第1条跳过')});
  const rootMock=run('',1000);
  await feedbackReview(root,{date,runCli:async(args)=>args[1]==='+messages-mget'?rootMock(args):envelope({messages:[],has_more:false})});
  const ledger=await readJson(paths(root).ledger);
  assert.equal(Object.values(ledger.feedback)[0].superseded,false);
  assert.equal(Object.keys(ledger.feedbackReplyVersions).length,1);
});

test('review reason is constrained to the declared card limit', async (t) => {
  const { root, decision, options } = await fixture(t);
  const tooLong = structuredClone(decision);
  tooLong.items[0].reason = '结合本周真实反馈，重新核对判断和现实条件。';
  await assert.rejects(previewReview(root, tooLong, options), /review-reason-length-invalid/);
  const preview = await previewReview(root, decision, options);
  assert.equal(preview.count, 6);
  const message = await readFile(path.join(root, '04_output/_dist/flomo-review', date, 'message.md'), 'utf8');
  assert.match(message, /回顾理由：现实反馈需再检验/);
});

test('poem cards use a compact poem title while other notes keep their summary', () => {
  const poem = { noteKey: 'poem', createdAt: '2025-10-04T09:00:00+08:00', body: '风来东湖涌，\n\n桥卧山水间。\n\n#写诗', bodyHash: 'poem-hash', source: { path: 'flomo.md', line: 1 }, quality: { score: 3, summary: '东湖桥云与心安' } };
  const regular = { noteKey: 'regular', createdAt: '2026-07-15T09:00:00+08:00', body: '真实实验的判断。', bodyHash: 'regular-hash', source: { path: 'flomo.md', line: 2 }, quality: { score: 3, summary: '真实实验的判断' } };
  const decision = { date, countDeviationReason: '测试渲染', items: [poem, regular].map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '现实反馈需再检验' })) };
  const result = renderReview(decision, [poem, regular]);
  assert.match(JSON.stringify(result.card), /1\. 东湖诗/);
  assert.match(JSON.stringify(result.card), /2\. 真实实验的判断/);
});

test('capacity report supports seven and twenty-eight days without exposing note identities', async (t) => {
  const { root } = await fixture(t);
  for (const days of [7, 28]) {
    const result = await simulateCapacity(root, '2026-10-08', days);
    assert.equal(result.possible, false);
    assert.equal(result.minimum, days === 7 ? 42 : 158);
    assert.equal(result.scheduledDays, 0);
    const saved = JSON.parse(await readFile(result.reportPath, 'utf8'));
    assert.equal(saved.days, days);
  assert.deepEqual(saved.targetDailyCountRange, [6, 7]);
    assert.ok(!JSON.stringify(saved).includes('noteKey'));
    assert.ok(!JSON.stringify(saved).includes('note_'));
  }
});

test('under-target high-quality selection requires and shows its shortfall reason', async (t) => {
  const { root, decision } = await fixture(t);
  const shortfall = structuredClone(decision);
  shortfall.items = shortfall.items.slice(0, 5);
  await assert.rejects(previewReview(root, shortfall), /count-shortfall-needs-reason/);
  shortfall.countDeviationReason = '符合近期上下文且达到质量门槛的候选只有5条';
  const preview = await previewReview(root, shortfall);
  assert.equal(preview.count, 5);
  const message = await readFile(path.join(root, '04_output/_dist/flomo-review', date, 'message.md'), 'utf8');
  assert.match(message, /实际推荐5条/);
  assert.match(message, /符合质量与上下文要求的笔记不足6条/);
});

test('prepared request declares the age-deviation field required by preview validation', async (t) => {
  const { root } = await fixture(t);
  const request = await readJson(path.join(paths(root).runtime, date, 'request.json'));
  assert.match(request.instruction, /ageDeviationReason/);
  assert.match(request.instruction, /比例偏离时必须填ageDeviationReason/);
});

test('under-target selection carries its quality shortfall through a complete send and readback', async (t) => {
  const { root, decision, options } = await fixture(t);
  decision.items = decision.items.slice(0, 5);
  decision.countDeviationReason = '符合近期上下文且达到质量门槛的候选只有5条';
  const mock = deliveryMock(root);
  const result = await sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } });
  assert.equal(result.status, 'delivered');
  assert.equal(result.count, 5);
  assert.match(JSON.stringify(mock.sentCard()), /符合质量与上下文要求的笔记不足6条/);
  const batch = (await readJson(paths(root).ledger)).batches[date];
  assert.equal(batch.countDeviationReason, decision.countDeviationReason);
  assert.equal(batch.cardContentSha256, cardContentSha256(batch.card));
});

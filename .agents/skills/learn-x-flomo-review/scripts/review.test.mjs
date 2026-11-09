import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, chmod, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshArchive, activateOnlineSnapshot, restoreOnlineSnapshotBackup, acceptQuality, prepareReview, previewReview, renderReview, sendReview, recoverReview, feedbackReview, simulateCapacity, readJson, atomicJson, paths, emptyLedger } from './review.mjs';
import { cardContentSha256 } from './delivery.mjs';
import { sha256 } from './context.mjs';
import { flomoBodyHash, flomoMemoUrl, writeStagedOnlineFlomoSnapshot } from '../../learn-x-input/scripts/lib/flomo-full-snapshot.mjs';

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
  const archive = Array.from({ length: 8 }, (_, i) => `## 2026-09-${20 + i} 09:00\n\n- 来源：<https://v.flomoapp.com/mine/?memo_id=M${20 + i}>\n\n我从第${i + 1}次真实实验中观察到，先记录反馈才能辨认限制条件。\n`).join('\n---\n\n');
  await put('03_input/monthly/2026-9/flomo.md', archive);
  await refreshArchive(root);
  let catalog = await readJson(paths(root).catalog);
  await acceptQuality(root, { policyVersion: '1', items: catalog.notes.map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, score: 3, reason: '记录经验并提炼可迁移判断', quote: '先记录反馈' })) });
  const prepared = await prepareReview(root, date, { readDao });
  catalog = await readJson(paths(root).catalog);
  const decision = { date, contextHash: prepared.contextHash, catalogHash: prepared.catalogHash, countDeviationReason: '测试样本只有六条，用于覆盖低于七条目标时仍保留质量门槛。', ageDeviationReason: '本测试库只有近期合格来源；先遵守质量与硬去重，年龄比例按整周继续观察。', items: catalog.notes.slice(0, 6).map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '现实反馈需再检验', contextEvidence: [{ path: '04_output/weekly/2026-40.md', quote: '近期正在重新辨认长期方向与现实反馈。' }] })) };
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

test('delivery options cannot replace the configured identity, recipient or persisted card', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root);
  const forgedCard = { schema: '2.0', header: { title: { tag: 'plain_text', content: 'forged' }, subtitle: { tag: 'plain_text', content: 'forged' } }, body: { elements: [{ tag: 'markdown', content: 'forged' }] } };
  const result = await sendReview(root, decision, { ...options, deliveryOptions: {
    runCli: mock.runCli, chatId: 'oc_forged', ownerId: 'ou_forged', profile: 'forged_profile',
    botSenderId: 'cli_forged', botSenderIds: ['cli_forged'], card: forgedCard, dateMarker: '伪造日期',
  } });
  assert.equal(result.status, 'delivered');
  const batch = (await readJson(paths(root).ledger)).batches[date];
  assert.equal(batch.chatId, chatId);
  assert.equal(batch.profile, profile);
  assert.deepEqual(batch.card, mock.sentCard());
  const sendArgs = mock.calls.find(args => args[1] === '+messages-send');
  assert.equal(sendArgs[sendArgs.indexOf('--chat-id') + 1], chatId);
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

test('recovery options cannot replace the persisted card or its canonical hash', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root, { timeout: true });
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), error => error.uncertain === true);
  const original = mock.sentCard();
  const forged = structuredClone(original);
  forged.body.elements[0].content += ' 改写内容';
  const forgedMessage = await downloadedMessage(root, forged, 'om_forged');
  const runCli = async args => {
    if (args[1] === '+chat-messages-list') return envelope({ messages: [forgedMessage], has_more: false });
    if (args[1] === '+messages-mget') return envelope({ messages: [forgedMessage] });
    throw Error('recovery must stay read-only');
  };
  await assert.rejects(recoverReview(root, date, {
    runCli,
    expectedCard: forged,
    cardContentSha256: cardContentSha256(forged),
  }), { code: 'message-content-hash-mismatch', uncertain: true });
  assert.equal((await readJson(paths(root).ledger)).batches[date].status, 'needs_review');
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
    if (args[1] === '+messages-mget') return envelope({ messages: [{ message_id: 'om_sent', chat_id: chatId, msg_type: 'interactive', sender: { id: appId, sender_type: 'app' }, content: JSON.stringify(batch.card), deleted: false, thread_id: 'omt_sent' }] });
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

test('cards use original opening text as titles and include Flomo links', () => {
  const poem = { noteKey: 'poem', createdAt: '2025-10-04T09:00:00+08:00', body: '风来东湖涌，\n\n桥卧山水间。\n\n#写诗', bodyHash: 'poem-hash', source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=poem' }, quality: { score: 3 } };
  const regular = { noteKey: 'regular', createdAt: '2026-07-15T09:00:00+08:00', body: '鱼不存在，世俗的成就。\n普通换行保留。\n1.对于复杂概率，人大概率计算错\n2.人天然对随机性无法合理预测。', bodyHash: 'regular-hash', source: { path: 'flomo.md', line: 2, url: 'https://v.flomoapp.com/mine/?memo_id=regular' }, quality: { score: 3 } };
  const longTitle = { noteKey: 'long-title', createdAt: '2026-07-15T09:00:00+08:00', body: '标题超过六个字的判断。', bodyHash: 'long-title-hash', source: { path: 'flomo.md', line: 3, url: 'https://v.flomoapp.com/mine/?memo_id=long-title' }, quality: { score: 3 } };
  const notes = [poem, regular, longTitle];
  const decision = { date, countDeviationReason: '测试渲染', items: notes.map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '现实反馈需再检验' })) };
  const snapshot = { sourceMode: 'flomo-online-full', capturedAt: '2026-10-11T14:05:56.141Z', coverage: { observedCount: 950, expectedCount: 951 } };
  const result = renderReview(decision, notes, snapshot);
  assert.equal(result.cardReadbackBreaks.length, 3);
  assert.equal(result.cardReadbackSpacers.length, 1);
  assert.equal(result.cardReadbackSpacers[0].offsets.length, 8);
  assert.match(JSON.stringify(result.card), /1\. 诗：风来东湖/);
assert.match(JSON.stringify(result.card), /风来东湖涌，&nbsp;<br>&nbsp;<br>桥卧山水间/);
assert.match(JSON.stringify(result.card), /鱼不存在，世俗的成就。<br>普通换行保留。\\n1\. 对于复杂概率/);
assert.match(JSON.stringify(result.card), /1\. 对于复杂概率，人大概率计算错\\n2\. 人天然对随机性无法合理预测。/);
  assert.match(JSON.stringify(result.card), /2\. 鱼不存在/);
  assert.match(JSON.stringify(result.card), /3\. 标题超过六个/);
  assert.ok(!JSON.stringify(result.card).match(/[ ](?=")/));
  for (const rendered of [result.markdown, JSON.stringify(result.card)]) {
    assert.match(rendered, /第3条已回顾/);
    assert.ok(!rendered.includes('第10条已回顾'));
  }
  for (const rendered of [result.markdown, result.fullMarkdown, JSON.stringify(result.card)]) {
    assert.match(rendered, /笔记快照：2026-10-11 22:05 · 覆盖 950\/951/);
  }
  assert.ok(!JSON.stringify(result.card).includes('原文见随附Markdown'));
});

test('card titles occupy their own line and blank lines separate paragraphs', () => {
  const note = { noteKey: 'layout', createdAt: '2026-10-15T09:00:00+08:00',
    body: '第一段。\n\n第二段。', bodyHash: 'layout-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=layout' }, quality: { score: 3 } };
  const decision = { date, countDeviationReason: '布局测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查布局' }] };
  const result = renderReview(decision, [note]);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('1. 第一段')).content;
  assert.match(content, /^\*\*1\. 第一段\*\*<br>2026-10-15 · \[Flomo原文\]\(https:\/\/v\.flomoapp\.com\/mine\/\?memo_id=layout\)<br><br>/);
assert.match(content, /第一段。&nbsp;<br>&nbsp;<br>第二段。/);
});

test('card body preserves literal break tags without renderer-added breaks', () => {
  const note = { noteKey: 'literal-break', createdAt: '2026-07-15T09:00:00+08:00',
    body: '正文保留字面 <br> 标签。\n\n新段落。', bodyHash: 'literal-break-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=literal-break' }, quality: { score: 3 } };
  const decision = { date, countDeviationReason: '单条渲染测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查原文换行' }] };
  const result = renderReview(decision, [note]);
  assert.equal(result.cardReadbackBreaks.length, 1);
  assert.equal(result.cardReadbackSpacers[0].offsets.length, 4);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('正文保留字面')).content;
  assert.equal([...content.matchAll(/<br><br>/g)].length, 1);
  assert.equal([...content.matchAll(/&nbsp;<br>/g)].length, 2);
  assert.equal([...content.matchAll(/正文保留字面 <br> 标签/g)].length, 1);
});

test('card body keeps original paragraph and plain line breaks visible', () => {
  const note = { noteKey: 'plain-breaks', createdAt: '2026-10-15T09:00:00+08:00',
    body: '第一段。\n第二段。\n\n第三段。\n第四段。', bodyHash: 'plain-breaks-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=plain-breaks' }, quality: { score: 3 } };
  const decision = { date, countDeviationReason: '换行渲染测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查原文换行' }] };
  const result = renderReview(decision, [note]);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('1. 第一段')).content;
assert.match(content, /第一段。<br>第二段。&nbsp;<br>&nbsp;<br>第三段。<br>第四段。/);
});

test('card body preserves consecutive blank lines as separate paragraph gaps', () => {
  const note = { noteKey: 'consecutive-blank-lines', createdAt: '2026-10-15T09:00:00+08:00',
    body: '第一段。\n\n\n第二段。', bodyHash: 'consecutive-blank-lines-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=consecutive-blank-lines' }, quality: { score: 3 } };
  const decision = { date, countDeviationReason: '连续空行测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查连续空行' }] };
  const result = renderReview(decision, [note]);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('1. 第一段')).content;
assert.match(content, /第一段。&nbsp;<br>&nbsp;<br>&nbsp;<br>第二段。/);
  assert.equal(result.cardReadbackSpacers[0].offsets.length, 6);
});

test('card body keeps complete flomo text and resumes plain paragraphs after lists', () => {
  const note = { noteKey: 'zhuangzi', createdAt: '2026-08-31T11:48:00+08:00',
    body: '#记录/读书笔记\n\n庄子逍遥游\n\n什么是逍遥游？\n\n1.定义一\n2.定义二\n\n如何逍遥游？\n\n1.无尺子\n2.无期望', bodyHash: 'zhuangzi-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=zhuangzi' }, quality: { score: 4 } };
  const decision = { date, countDeviationReason: '单条渲染测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查完整原文' }] };
  const result = renderReview(decision, [note]);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('庄子逍遥游')).content;
assert.match(content, /定义一\n2\. 定义二&nbsp;<br>&nbsp;<br>如何逍遥游\？/);
  assert.match(content, /无尺子\n2\. 无期望/);
assert.match(content, /#记录\/读书笔记&nbsp;<br>&nbsp;<br>庄子逍遥游&nbsp;<br>&nbsp;<br>什么是逍遥游\？/);
});

test('card body preserves nested list hierarchy', () => {
  const note = { noteKey: 'nested-list', createdAt: '2026-10-31T14:49:00+08:00',
    body: '健康读书记录：\n\n1. 人体简史\n  1. 现代健康问题\n    1. 包括饮食\n    2. 让健康行为嵌入生活\n2. 超越百岁', bodyHash: 'nested-list-hash',
    source: { path: 'flomo.md', line: 1, url: 'https://v.flomoapp.com/mine/?memo_id=nested-list' }, quality: { score: 3 } };
  const decision = { date, countDeviationReason: '嵌套列表测试', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '检查层级' }] };
  const result = renderReview(decision, [note]);
  const content = result.card.body.elements.find(element => element.tag === 'markdown' && element.content.includes('人体简史')).content;
  assert.match(content, /1\. 人体简史\n  1\. 现代健康问题\n    1\. 包括饮食\n    2\. 让健康行为嵌入生活\n2\. 超越百岁/);
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
    assert.deepEqual(saved.targetDailyCountRange, [6, 10]);
    assert.deepEqual(saved.averageDailyCountTargetRange, [6, 6]);
    assert.ok(!JSON.stringify(saved).includes('noteKey'));
    assert.ok(!JSON.stringify(saved).includes('note_'));
  }
});

test('under-target high-quality selection requires and shows its shortfall reason', async (t) => {
  const { root, decision } = await fixture(t);
  const shortfall = structuredClone(decision);
  shortfall.items = shortfall.items.slice(0, 5);
  delete shortfall.countDeviationReason;
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
  assert.match(request.instruction, /单次推荐5–10条，常规数量与整体平均目标均为6条/);
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

function stagedOnlineScan(id = 'memo-online', body = '线上笔记的完整真实正文。', {
  scanStartedAt = '2026-10-11T01:00:00.000Z',
  scanFinishedAt = '2026-10-11T01:02:00.000Z',
} = {}) {
  return {
    mode: 'full', complete: true, libraryCount: 1, scanned: 1, pageCount: 2,
    scanStartedAt, scanFinishedAt,
    termination: { reason: 'library-count-and-stable-ids', enumerationComplete: true,
      expectedCount: 1, observedUniqueIds: 1, missingCount: 0, stableScrollPasses: 2,
      atBottom: true, hasMore: false, loading: false },
    detailVerification: { verified: true, memoId: id, bodyLength: body.length,
      bodyHash: flomoBodyHash(body), method: 'original-link-detail-sheet-tiptap-prosemirror' },
    records: [{ memoId: id, url: flomoMemoUrl(id), createdAt: '2026-10-10T01:00:00.000Z',
      timeText: '2026-10-10 09:00', bodyText: body, bodyComplete: true, isPinned: false }],
  };
}

test('first online activation backs up legacy state, preserves ledger occupancy, and is idempotent', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-online-activation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const staging = { storageRoot: paths(root).privateRoot };
  const before = paths(root);
  const legacyBody = '旧 catalog 的质量和正文用于验证可恢复备份。';
  const legacyCatalog = { schemaVersion: 1, sourceMode: 'legacy-archive', dedupeGeneration: 'legacy',
    notes: [{ noteKey: 'legacy-key', memoId: null, aliases: ['legacy-key'], groupKey: 'old-group', groupAliases: [],
      createdAt: '2026-10-01T01:00:00.000Z', body: legacyBody, bodyHash: flomoBodyHash(legacyBody),
      source: { path: 'old-archive.md', line: 1, url: null }, sources: [],
      quality: { score: 4, reason: '已通过的历史质量判断', quote: legacyBody, bodyHash: flomoBodyHash(legacyBody), policyVersion: '1' } }], excluded: [] };
  const legacyLedger = emptyLedger();
  legacyLedger.batches['2026-10-11'] = { date: '2026-10-11', status: 'delivered', messageId: 'om-already-sent',
    items: [{ noteKey: 'old-key', groupKey: 'old-group' }] };
  await atomicJson(before.legacyCatalog, legacyCatalog);
  await atomicJson(path.join(before.legacyRuntime, 'ledger.json'), legacyLedger);
  const incompleteStage = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan(), staging);
  await unlink(incompleteStage.bundlePath);
  await assert.rejects(activateOnlineSnapshot(root, incompleteStage.snapshotPath), /online-snapshot-bundle-invalid/);
  assert.equal(paths(root).onlineStorageActive, false, 'incomplete staged artifacts cannot activate');
  const stagedBundle = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan(), staging);
  const stagedPath = stagedBundle.snapshotPath;

  const activated = await activateOnlineSnapshot(root, stagedPath);
  assert.equal(activated.status, 'activated');
  assert.equal(activated.eligibleQuality, 0);
  assert.equal(activated.ledgerBatchesPreserved, 1);
  const activePaths = paths(root);
  assert.equal(activePaths.onlineStorageActive, true);
  assert.equal(activePaths.lockPath, before.lockPath, 'the same lock path protects both storage modes');
  for (const directory of [activePaths.privateRoot, path.join(activePaths.privateRoot, 'snapshots'),
    path.join(activePaths.privateRoot, 'backups'), path.join(activePaths.privateRoot, 'backups', path.basename((await readJson(activePaths.storageModePath)).backupPath))]) {
    assert.equal((await lstat(directory)).mode & 0o777, 0o700, `private directory mode: ${directory}`);
  }
  const catalog = await readJson(activePaths.catalog);
  const ledger = await readJson(activePaths.ledger);
  const storageMode = await readJson(activePaths.storageModePath);
  assert.equal(catalog.sourceMode, 'flomo-online-full');
  assert.equal(catalog.notes[0].quality, null);
  assert.equal(catalog.dedupeGeneration, storageMode.dedupeGeneration);
  assert.equal(ledger.dedupeGeneration, storageMode.dedupeGeneration);
  assert.equal(ledger.batches['2026-10-11'].status, 'delivered');
  assert.equal(ledger.batches['2026-10-11'].messageId, 'om-already-sent');
  assert.equal(ledger.batches['2026-10-11'].dedupeGeneration, 'legacy');
  assert.deepEqual(JSON.parse(await readFile(path.join(storageMode.backupPath, 'legacy-catalog.json'), 'utf8')), legacyCatalog);
  assert.deepEqual(JSON.parse(await readFile(path.join(storageMode.backupPath, 'legacy-ledger.json'), 'utf8')), legacyLedger);
  assert.deepEqual(await activateOnlineSnapshot(root, stagedPath), {
    status: 'already-active', snapshotId: catalog.snapshot.snapshotId, coverage: storageMode.coverage,
  });
  const otherStage = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan('memo-other', undefined, {
    scanStartedAt: '2026-10-11T02:00:00.000Z', scanFinishedAt: '2026-10-11T02:02:00.000Z',
  }), staging);
  const updated = await activateOnlineSnapshot(root, otherStage.snapshotPath);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.dedupeGeneration, activated.dedupeGeneration, 'weekly snapshots remain in the same exposure generation');
  const updatedPaths = paths(root);
  assert.notEqual(updatedPaths.catalog, activePaths.catalog, 'the active storage pointer switches to a versioned catalog');
  assert.ok(await readFile(activePaths.catalog, 'utf8'), 'previous catalog remains available as a rollback point');
  assert.equal((await readJson(updatedPaths.catalog)).notes[0].memoId, 'memo-other');
  assert.equal((await readJson(updatedPaths.ledger)).batches['2026-10-11'].messageId, 'om-already-sent');
  const staleStage = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan('memo-stale', undefined, {
    scanStartedAt: '2026-10-11T01:30:00.000Z', scanFinishedAt: '2026-10-11T01:32:00.000Z',
  }), staging);
  await assert.rejects(activateOnlineSnapshot(root, staleStage.snapshotPath), /online-snapshot-not-newer-than-active/);
  assert.equal((await readJson(paths(root).storageModePath)).activeSnapshotId, otherStage.snapshot.snapshotId,
    'a delayed older scan cannot roll the active snapshot back');
  await unlink(updatedPaths.ledger);
  await assert.rejects(restoreOnlineSnapshotBackup(root), /ENOENT/);
  assert.equal(paths(root).onlineStorageActive, true, 'missing live ledger must leave online mode active');
  await atomicJson(updatedPaths.ledger, ledger);
  const restored = await restoreOnlineSnapshotBackup(root);
  assert.equal(restored.status, 'restored');
  assert.equal(paths(root).onlineStorageActive, false);
  const restoredCatalog = await readJson(paths(root).catalog);
  const restoredLedger = await readJson(paths(root).ledger);
  assert.equal(restoredCatalog.sourceMode, 'legacy-archive');
  assert.equal(restoredCatalog.notes[0].quality.score, 4);
  assert.equal(restoredCatalog.dedupeGeneration, restoredLedger.dedupeGeneration);
  assert.equal(restoredLedger.batches['2026-10-11'].messageId, 'om-already-sent');
  assert.equal(restoredLedger.batches['2026-10-11'].status, 'delivered');
  const refreshed = await refreshArchive(root);
  assert.equal(refreshed.coverage.archiveSnapshot, true);
  assert.equal((await readJson(paths(root).catalog)).dedupeGeneration, restored.dedupeGeneration);
  assert.ok(await readFile(path.join(restored.safetyBackupPath, 'online-ledger.json'), 'utf8'));
});

test('online archive refresh reads only the active snapshot and never scans local Flomo markdown', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-online-refresh-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const p = paths(root);
  const snapshotBody = '#记录/播客 1. 第一句2. 第二句';
  const staged = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan('REMOTE-ID', snapshotBody), { storageRoot: p.privateRoot });
  await activateOnlineSnapshot(root, staged.snapshotPath);
  const localArchive = path.join(root, '03_input/monthly/2026-10/flomo.md');
  await mkdir(path.dirname(localArchive), { recursive: true });
  await symlink(path.join(root, 'unread-historical-flomo.md'), localArchive);

  await refreshArchive(root);

  const catalog = await readJson(paths(root).catalog);
  assert.equal(catalog.sourceMode, 'flomo-online-full');
  assert.equal(catalog.notes[0].body, snapshotBody);
  assert.equal(catalog.notes[0].bodyHash, sha256(snapshotBody));
});

test('quality review accepts the exact complete body when a note is shorter than four characters', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-short-quality-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const body = '好';
  const note = { noteKey: 'flomo:short', memoId: 'short', aliases: ['flomo:short'], groupKey: 'content:short',
    groupAliases: [], createdAt: '2026-10-10T01:00:00.000Z', body, bodyHash: flomoBodyHash(body),
    source: { path: 'online-snapshot:fixture', line: 1, url: flomoMemoUrl('short') }, sources: [], quality: null };
  await atomicJson(paths(root).catalog, { schemaVersion: 1, sourceMode: 'flomo-online-full', dedupeGeneration: 'online-test', notes: [note], excluded: [] });
  const decisions = { policyVersion: '1', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash,
    score: 0, reason: '正文只有一个字，无法证明有可回顾的独立判断。', quote: body }] };
  const accepted = await acceptQuality(root, decisions);
  assert.equal(accepted.assessed, 1);
  assert.equal((await readJson(paths(root).catalog)).notes[0].quality.quote, body);
  const acceptedBytes = await readFile(paths(root).catalog, 'utf8');
  const repeated = await acceptQuality(root, decisions);
  assert.equal(repeated.updated, 0);
  assert.equal(repeated.unchanged, 1);
  assert.equal(await readFile(paths(root).catalog, 'utf8'), acceptedBytes);
  await assert.rejects(acceptQuality(root, { policyVersion: '1', items: [{ noteKey: note.noteKey, bodyHash: note.bodyHash,
    score: 0, reason: '短正文必须完整引用。', quote: '不在正文中的短引文' }] }), /quality-decision-untraceable/);
});

test('online activation rejects a verified staged snapshot outside the private root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-online-activation-project-'));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'flomo-online-activation-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });
  const staged = await writeStagedOnlineFlomoSnapshot(outsideRoot, stagedOnlineScan());
  await assert.rejects(activateOnlineSnapshot(root, staged.snapshotPath), /online-snapshot-path-outside-storage-root/);
  assert.equal(paths(root).onlineStorageActive, false, 'outside artifacts cannot change the project active pointer');
});

test('online activation refuses an insecure private root before writing or switching storage', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-online-insecure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const p = paths(root);
  const staged = await writeStagedOnlineFlomoSnapshot(root, stagedOnlineScan(), { storageRoot: p.privateRoot });
  await chmod(p.privateRoot, 0o755);
  await assert.rejects(activateOnlineSnapshot(root, staged.snapshotPath), /review-private-directory-insecure/);
  assert.equal(paths(root).onlineStorageActive, false);
  assert.equal((await lstat(p.privateRoot)).mode & 0o777, 0o755, 'activation does not silently change an existing directory');
});

test('review paths reject Library symlinks before probing or reading storage state', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-library-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const forbidden = path.join(os.homedir(), 'Library', 'Application Support', 'Learn-X', 'flomo-review');
  const privateRoot = paths(root).privateRoot;
  await mkdir(path.dirname(privateRoot), { recursive: true, mode: 0o700 });
  await symlink(forbidden, privateRoot);
  assert.throws(() => paths(root), /flomo-storage-root-library-forbidden/);
  await assert.rejects(refreshArchive(root), /flomo-storage-root-library-forbidden/);

  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-library-state-link-'));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const statePaths = paths(stateRoot);
  await mkdir(statePaths.privateRoot, { recursive: true, mode: 0o700 });
  await symlink(path.join(forbidden, 'storage-mode.json'), statePaths.storageModePath);
  assert.throws(() => paths(stateRoot), /flomo-storage-root-library-forbidden/);
});

test('review paths reject an active snapshot pointer that escapes or symlinks into Library', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-library-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initial = paths(root);
  await mkdir(path.join(initial.privateRoot, 'snapshots'), { recursive: true, mode: 0o700 });
  await mkdir(initial.backupsRoot, { recursive: true, mode: 0o700 });
  const state = { schemaVersion: 1, sourceMode: 'flomo-online-full', activeSnapshotPath: 'snapshots/active.json',
    activeCatalogPath: 'snapshots/active.catalog.json', activeLedgerPath: 'snapshots/active.ledger.json',
    backupPath: path.join(initial.backupsRoot, 'legacy') };
  const storageMode = initial.storageModePath;
  await writeFile(storageMode, JSON.stringify({ ...state, activeSnapshotPath: 'snapshots/../../Library/escape.json' }));
  assert.throws(() => paths(root), /online-storage-state-invalid/);

  await writeFile(storageMode, JSON.stringify(state));
  const forbidden = path.join(os.homedir(), 'Library', 'Application Support', 'Learn-X', 'flomo-review', 'snapshot.json');
  await symlink(forbidden, path.join(initial.privateRoot, state.activeSnapshotPath));
  assert.throws(() => paths(root), /flomo-storage-root-library-forbidden/);
});

test('review JSON helpers reject Library paths before filesystem reads or writes', async () => {
  const forbidden = path.join(os.homedir(), 'Library', 'Application Support', 'Learn-X', 'flomo-review', 'probe.json');
  await assert.rejects(readJson(forbidden), /flomo-storage-root-library-forbidden/);
  await assert.rejects(atomicJson(forbidden, { shouldNotWrite: true }), /flomo-storage-root-library-forbidden/);
  const root = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-library-file-link-'));
  try {
    const alias = path.join(root, 'probe.json');
    await symlink(forbidden, alias);
    await assert.rejects(readJson(alias), /flomo-storage-root-library-forbidden/);
    await assert.rejects(atomicJson(alias, { shouldNotWrite: true }), /flomo-storage-root-library-forbidden/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshArchive, acceptQuality, prepareReview, previewReview, sendReview, recoverReview, feedbackReview, simulateCapacity, readJson, atomicJson, paths, emptyLedger } from './review.mjs';
import { cardContentSha256, normalizeMessageMarkdown } from './delivery.mjs';
import { sha256 } from './context.mjs';

const date = '2026-10-06', now = new Date(`${date}T20:00:00+08:00`);
const chatId = 'oc_test', ownerId = 'ou_owner', appId = 'cli_test', profile = 'test_profile';
const envelope = (data, meta = {}) => ({ ok: true, identity: 'bot', data, meta });
const output = '# 人工保存的Output\n\n近期正在重新辨认长期方向与现实反馈。'.repeat(12);
async function downloadedMessage(root, content, messageId = 'om_sent') {
  const batch = (await readJson(paths(root).ledger)).batches[date];
  const downloadRoot = path.join(path.dirname(batch.attachmentPath), 'lark-im-resources');
  await mkdir(downloadRoot, { recursive: true });
  const localPath = path.join(downloadRoot, 'file_message.md');
  const bytes = await readFile(batch.attachmentPath);
  await writeFile(localPath, bytes);
  return { message_id: messageId, chat_id: chatId, msg_type: 'post', sender: { id: appId, sender_type: 'app' }, deleted: false,
    content: `${content}\n<file key="file_message" name="review.md"/>`,
    resources: [{ message_id: messageId, type: 'file', key: 'file_message', local_path: localPath, size_bytes: bytes.length }] };
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
  const decision = { date, contextHash: prepared.contextHash, catalogHash: prepared.catalogHash, ageDeviationReason: '本测试库只有近期合格来源；先遵守质量与硬去重，年龄比例按整周继续观察。', items: catalog.notes.slice(0, 5).map(note => ({ noteKey: note.noteKey, bodyHash: note.bodyHash, relevance: 'strong', reason: '现实反馈需再检验', contextEvidence: [{ path: '04_output/weekly/2026-40.md', quote: '近期正在重新辨认长期方向与现实反馈。' }] })) };
  return { root, put, decision, options: { now, contextOptions: { readDao } } };
}

function deliveryMock(root, { sendError = false, timeout = false, preflightGate } = {}) {
  const calls = [];
  let sentMarkdown;
  const runCli = async (args) => {
    calls.push(args);
    assert.equal(args[args.indexOf('--profile') + 1], profile);
    assert.equal(args[args.indexOf('--as') + 1], 'bot');
    if (args[0] === 'whoami') { if (preflightGate) await preflightGate; return { identity: 'bot', profile, appId, available: true }; }
    if (args[1] === '+chat-members-list') return envelope({ chat_id: chatId, users: [{ member_id: ownerId }], bots: [{ member_id: 'ou_bot', app_id: appId }], user_total: 1, bot_total: 1, has_more: false });
    if (args[1] === '+chat-messages-list') return envelope({ messages: [], has_more: false });
    if (args[1] === 'files' && args[2] === 'create') {
      const batch = (await readJson(paths(root).ledger)).batches[date];
      assert.equal(batch.status, 'sending');
      assert.ok(batch.sendStartedAt);
      assert.ok(batch.attachmentPath);
      assert.deepEqual(batch.botSenderIds, ['ou_bot', appId]);
      return envelope({ file_key: 'file_upload' });
    }
    if (args[1] === '+messages-send') {
      const batch = (await readJson(paths(root).ledger)).batches[date];
      assert.equal(batch.status, 'sending');
      assert.ok(batch.sendStartedAt);
      assert.equal(batch.markdownSha256, sha256(normalizeMessageMarkdown(batch.markdown)));
      assert.equal(batch.uploadKey, 'file_upload');
      assert.deepEqual(batch.botSenderIds, ['ou_bot', appId]);
      sentMarkdown = args[args.indexOf('--markdown') + 1];
      assert.equal(args[args.indexOf('--attachment') + 1], 'file_upload');
      assert.ok(!args.includes('--content'));
      if (sendError) throw Error('send-error');
      if (timeout) throw Error('timeout-after-send');
      return envelope({ chat_id: chatId, message_id: 'om_sent' });
    }
    if (args[1] === '+messages-mget') return envelope({ messages: [await downloadedMessage(root, sentMarkdown)] });
    throw Error('unexpected-mock-command');
  };
  return { runCli, calls, sentMarkdown: () => sentMarkdown };
}

test('send persists reservation/sending before mutation, verifies delivery and rejects same-day rerun', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root);
  const result = await sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } });
  assert.equal(result.status, 'delivered');
  const ledger = await readJson(paths(root).ledger), batch = ledger.batches[date];
  assert.equal(batch.messageId, 'om_sent');
  assert.equal(batch.profile, profile);
  assert.equal(batch.items.length, 5);
  assert.equal(batch.uploadKey, 'file_upload');
  assert.equal(batch.attachmentKey, 'file_message');
  assert.equal(batch.attachmentReadback, true);
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
    return envelope({ messages: [await downloadedMessage(root, mock.sentMarkdown(), 'om_recovered')], has_more: false });
  } });
  assert.equal(result.messageId, 'om_recovered');
  ledger = await readJson(paths(root).ledger);
  assert.equal(ledger.batches[date].status, 'delivered');
  assert.equal(calls.length, 2);
  assert.equal(ledger.batches[date].attachmentKey, 'file_message');
  assert.equal(ledger.batches[date].attachmentReadback, true);
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('failed send retains occupancy as needs_review', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root, { sendError: true });
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } }), error => error.uncertain === true);
  assert.equal((await readJson(paths(root).ledger)).batches[date].status, 'needs_review');
  assert.equal(mock.calls.filter(args => args[1] === '+messages-send').length, 1);
});

test('definitely unsent attempts retain audit evidence when the date is retried', async (t) => {
  const { root, decision, options } = await fixture(t), mock = deliveryMock(root);
  const failUpload = async args => {
    if (args[1] === 'files' && args[2] === 'create') throw Error('temporary-upload-failure');
    return mock.runCli(args);
  };
  await assert.rejects(sendReview(root, decision, { ...options, deliveryOptions: { runCli: failUpload } }), error => error.uncertain === false);
  let ledger = await readJson(paths(root).ledger);
  assert.equal(ledger.batches[date].status, 'failed');
  assert.equal(ledger.failures.length, 1);
  assert.equal(ledger.failures[0].items.length, 5);
  const retry = await sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } });
  ledger = await readJson(paths(root).ledger);
  assert.equal(retry.status, 'delivered');
  assert.equal(ledger.batches[date].status, 'delivered');
  assert.equal(ledger.failures.length, 1);
  assert.equal(ledger.failures[0].error, 'send-result-uncertain');
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
  ledger.batches[date] = { date, status: 'delivered', chatId, profile, botSenderId: appId, botSenderIds: ['ou_bot', appId], messageId: 'om_sent', stats: { week: '2026-W41' }, card, cardContentSha256: cardContentSha256(card), items: [{ noteKey: 'note_a' }, { noteKey: 'note_b' }, { noteKey: 'note_c' }] };
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

test('review reason length is not truncated by an undeclared limit', async (t) => {
  const { root, decision, options } = await fixture(t);
  const richReason = structuredClone(decision);
  richReason.items[0].reason = '结合本周真实反馈，重新核对当时形成的判断和现在的现实条件。';
  const preview = await previewReview(root, richReason, options);
  assert.equal(preview.count, 5);
  assert.match(await readFile(path.join(root, '04_output/_dist/flomo-review', date, 'review.md'), 'utf8'), /结合本周真实反馈/);
});

test('capacity report supports seven and twenty-eight days without exposing note identities', async (t) => {
  const { root } = await fixture(t);
  for (const days of [7, 28]) {
    const result = await simulateCapacity(root, '2026-10-08', days);
    assert.equal(result.possible, false);
    assert.equal(result.minimum, days === 7 ? 35 : 130);
    assert.equal(result.scheduledDays, 0);
    const saved = JSON.parse(await readFile(result.reportPath, 'utf8'));
    assert.equal(saved.days, days);
    assert.deepEqual(saved.targetDailyCountRange, [5, 8]);
    assert.ok(!JSON.stringify(saved).includes('noteKey'));
    assert.ok(!JSON.stringify(saved).includes('note_'));
  }
});

test('under-target high-quality selection requires and shows its shortfall reason', async (t) => {
  const { root, decision } = await fixture(t);
  const shortfall = structuredClone(decision);
  shortfall.items = shortfall.items.slice(0, 4);
  await assert.rejects(previewReview(root, shortfall), /count-shortfall-needs-reason/);
  shortfall.countDeviationReason = '符合近期上下文且达到质量门槛的候选只有4条';
  const preview = await previewReview(root, shortfall);
  assert.equal(preview.count, 4);
  const message = await readFile(path.join(root, '04_output/_dist/flomo-review', date, 'message.md'), 'utf8');
  assert.match(message, /实际推荐4条/);
  assert.match(message, /符合质量与上下文要求的笔记不足5条/);
});

test('prepared request declares the age-deviation field required by preview validation', async (t) => {
  const { root } = await fixture(t);
  const request = await readJson(path.join(paths(root).runtime, date, 'request.json'));
  assert.match(request.instruction, /ageDeviationReason/);
  assert.match(request.instruction, /比例偏离时必须填ageDeviationReason/);
});

test('under-target selection carries its quality shortfall through a complete send and readback', async (t) => {
  const { root, decision, options } = await fixture(t);
  decision.items = decision.items.slice(0, 4);
  decision.countDeviationReason = '符合近期上下文且达到质量门槛的候选只有4条';
  const mock = deliveryMock(root);
  const result = await sendReview(root, decision, { ...options, deliveryOptions: { runCli: mock.runCli } });
  assert.equal(result.status, 'delivered');
  assert.equal(result.count, 4);
  assert.match(mock.sentMarkdown(), /符合质量与上下文要求的笔记不足5条/);
  const batch = (await readJson(paths(root).ledger)).batches[date];
  assert.equal(batch.countDeviationReason, decision.countDeviationReason);
  assert.equal(batch.attachmentReadback, true);
});

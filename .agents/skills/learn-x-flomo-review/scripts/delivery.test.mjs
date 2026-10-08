import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { preflightDelivery, sendRecommendation, recoverRecommendation, collectFeedback, normalizeMessageMarkdown, cardContentSha256 } from './delivery.mjs';

const chatId = 'oc_test', ownerId = 'ou_owner', appId = 'cli_workflow';
const now = new Date('2026-10-06T12:00:00Z');
const markdown = '# Flomo 回顾｜2026-10-06\n\n1. **第一条**\n\n经验值得回顾。\n\n回顾日期：2026-10-06';
const legacyTextHash = createHash('sha256').update(normalizeMessageMarkdown(markdown)).digest('hex');
const idempotencyKey = 'learn-x-flomo-review:2026-10-06';
const envelope = (data, meta = {}) => ({ ok: true, identity: 'bot', data, meta });
const memberData = () => ({ chat_id: chatId, users: [{ member_id: ownerId }], bots: [{ member_id: 'ou_bot', app_id: appId }], user_total: 1, bot_total: 1, has_more: false, truncations: [] });
const message = (extra = {}) => ({ message_id: 'om_root', chat_id: chatId, msg_type: 'post', deleted: false, create_time: String(now.getTime() - 1000), sender: { id: appId, sender_type: 'app' }, content: `${markdown}\n<file key="file_upload" name="review.md"/>`, ...extra });
const mockPreflight = ({ who, members, recent, meta } = {}) => async (args) => {
  if (args[0] === 'whoami') return envelope(who ?? { identity: 'bot', app: { appId } });
  if (args[1] === '+chat-members-list') return envelope(members ?? memberData());
  if (args[1] === '+chat-messages-list') return envelope({ messages: recent ?? [], has_more: false }, meta ?? {});
  throw Error('unexpected-call');
};

test('preflight verifies one owner, workflow app membership, complete pages and recent bot rate', async () => {
  const calls = [];
  const mock = mockPreflight({ recent: [message(), message({ message_id: 'om_other', sender: { id: 'cli_other', sender_type: 'app' } })] });
  const result = await preflightDelivery({ chatId, ownerId, now, runCli: async (args) => { calls.push(args); return mock(args); } });
  assert.equal(result.botSenderId, appId);
  assert.equal(result.sentInLastMinute, 1);
  assert.deepEqual(result.botSenderIds, ['ou_bot', appId]);
  assert.ok(calls.every((args) => args[args.indexOf('--as') + 1] === 'bot'));
});

for (const [name, options, code] of [
  ['second human', { members: { ...memberData(), users: [{ member_id: ownerId }, { member_id: 'ou_other' }] } }, 'recipient-scope-mismatch'],
  ['wrong owner', { members: { ...memberData(), users: [{ member_id: 'ou_other' }] } }, 'recipient-scope-mismatch'],
  ['server member cap', { members: { ...memberData(), truncations: [{ member_type: 'user', limit: 100 }] } }, 'member-list-incomplete'],
  ['unfinished members', { members: { ...memberData(), has_more: true } }, 'member-list-incomplete'],
  ['unknown bot account', { members: { ...memberData(), bots: [{ member_id: 'ou_bot' }] } }, 'group-bot-unverified'],
  ['wrong app', { who: { identity: 'bot', appId: 'cli_other' } }, 'workflow-bot-membership-unverified'],
  ['unknown app', { who: { identity: 'bot' } }, 'bot-app-unverified'],
  ['incomplete recent messages', { meta: { pagination: { complete: false } } }, 'recent-messages-incomplete'],
  ['unidentified recent sender', { recent: [message({ sender: {} })] }, 'recent-message-identity-or-time-unknown'],
  ['unknown recent time', { recent: [message({ create_time: null })] }, 'recent-message-identity-or-time-unknown'],
  ['fifth message', { recent: Array.from({ length: 4 }, (_, index) => message({ message_id: `om_${index}` })) }, 'send-frequency-limit'],
]) test(`preflight rejects ${name}`, async () => {
  await assert.rejects(preflightDelivery({ chatId, ownerId, now, runCli: mockPreflight(options) }), { code });
});

async function attachment(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flomo-delivery-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'review.md');
  await writeFile(file, '完整原文\n');
  return file;
}

async function downloaded(attachmentPath, root = message(), { resource = {}, bytes, localPath } = {}) {
  const directory = path.join(path.dirname(await realpath(attachmentPath)), 'lark-im-resources');
  await mkdir(directory, { recursive: true });
  const key = root.content.match(/<file key="([^"]+)"/)?.[1] ?? 'file_message';
  const filePath = localPath ?? path.join(directory, `${key}.md`);
  const content = bytes ?? await readFile(attachmentPath);
  await writeFile(filePath, content);
  return { ...root, resources: [{ key, local_path: filePath, message_id: root.message_id, size_bytes: Buffer.byteLength(content), type: 'file', ...resource }] };
}

const reviewCard = (content = markdown) => ({ schema: '2.0', body: { elements: [{ tag: 'markdown', content }] } });
const cardMessage = (card, extra = {}) => message({ msg_type: 'interactive', content: JSON.stringify(card), resources: [], ...extra });

test('one post attaches complete Markdown and persists upload before send, then verifies changed attachment key bytes', async (t) => {
  const attachmentPath = await attachment(t), calls = [];
  let persisted;
  const runCli = async (args, options) => {
    calls.push({ args, options });
    assert.equal(options.cwd, path.dirname(await realpath(attachmentPath)));
    if (args[1] === 'files') {
      assert.equal(args[2], 'create');
      assert.deepEqual(JSON.parse(args[args.indexOf('--data') + 1]), {file_type:'stream',file_name:'review.md'});
      assert.equal(args[args.indexOf('--file') + 1], 'file=./review.md');
      return envelope({file_key:'file_upload'});
    }
    if (args[1] === '+messages-send') { assert.ok(persisted); return envelope({ message_id: 'om_root', chat_id: chatId }); }
    if (args[1] === '+messages-mget') { assert.ok(args.includes('--download-resources')); return envelope({ messages: [await downloaded(attachmentPath,message({content:`${markdown}\n<file key="file_message" name="review.md"/>`}))] }); }
    throw Error('unexpected');
  };
  const result = await sendRecommendation({ chatId, markdown, attachmentPath, idempotencyKey, botSenderId: appId, onUploaded: async(value)=>{persisted=value;}, runCli });
  assert.equal(result.messageId, 'om_root');
  assert.equal(result.readback, true);
  assert.equal(result.markdownSha256,legacyTextHash);
  assert.equal(result.attachmentReadback,true);
  assert.equal(result.attachmentKey,'file_message');
  assert.equal(persisted.uploadKey,'file_upload');
  assert.equal(persisted.attachmentKey,undefined);
  assert.equal(result.uploadKey,'file_upload');
  assert.equal(result.attachmentSha256,createHash('sha256').update(await readFile(attachmentPath)).digest('hex'));
  assert.equal(calls.filter(({ args }) => args[1] === '+messages-send').length, 1);
  const send = calls.find(({ args }) => args[1] === '+messages-send').args;
  assert.equal(send[send.indexOf('--markdown') + 1],markdown);
  assert.equal(send[send.indexOf('--attachment') + 1],'file_upload');
  assert.equal(send[send.indexOf('--idempotency-key') + 1],idempotencyKey);
  assert.ok(!send.includes('--content'));
  assert.ok(calls.every(({args})=>args[args.indexOf('--as')+1]==='bot'));
});

for (const [name, mismatch] of [
  ['body', { content: `${markdown} 被修改\n<file key="file_upload"/>` }],
  ['recipient', { chat_id: 'oc_wrong' }],
  ['sender', { sender: { id: 'cli_wrong', sender_type: 'app' } }],
  ['deletion', { deleted: true }],
]) test(`readback ${name} mismatch remains uncertain and never resends`, async (t) => {
  const attachmentPath = await attachment(t);
  let sends = 0;
  const runCli = async (args) => {
    if (args[1] === 'files') return envelope({file_key:'file_upload'});
    if (args[1] === '+messages-send') { sends++; return envelope({ message_id: 'om_root', chat_id: chatId }); }
    return envelope({ messages: [await downloaded(attachmentPath,message(mismatch))] });
  };
  await assert.rejects(sendRecommendation({ chatId, markdown, attachmentPath, idempotencyKey, botSenderId: appId, runCli }), (error) => error.uncertain === true && error.messageId === 'om_root');
  assert.equal(sends, 1);
});

test('send timeout is uncertain and invalid input never uploads or sends', async (t) => {
  const attachmentPath=await attachment(t);let sends=0;
  const runCli = async(args)=>{if(args[1]==='files')return envelope({file_key:'file_upload'});sends++;throw Error('timeout');};
  await assert.rejects(sendRecommendation({ chatId, markdown, attachmentPath, idempotencyKey, botSenderId:appId, runCli }), {uncertain:true});
  assert.equal(sends,1);
  await assert.rejects(sendRecommendation({ chatId, markdown, idempotencyKey, runCli: async () => { throw Error('must-not-send'); } }), { code: 'send-input-invalid',uncertain:false });
});

test('timeout without message ID recovers using persisted uploadKey and original hashes despite message key rebasing',async(t)=>{
  const attachmentPath=await attachment(t);let persisted,sends=0;
  await assert.rejects(sendRecommendation({chatId,markdown,attachmentPath,idempotencyKey,botSenderId:appId,
    onUploaded:async value=>{persisted=value;},
    runCli:async(args)=>{if(args[1]==='files')return envelope({file_key:'file_upload'});sends++;throw Error('timeout-after-submission');}
  }),error=>error.uncertain===true&&error.messageId===undefined);
  assert.equal(persisted.uploadKey,'file_upload');
  assert.equal(persisted.attachmentKey,undefined);
  const input={chatId,idempotencyKey,dateMarker:'回顾日期：2026-10-06',expectedMarkdown:markdown,sendStartedAt:now.toISOString(),botSenderId:appId,...persisted};
  const root=message({content:`${markdown}\n<file key="file_message"/>`});
  const calls=[];
  const recover=async(bytes)=>recoverRecommendation({...input,runCli:async(args,options)=>{
    calls.push(args[1]);
    if(args[1]==='+chat-messages-list')return envelope({messages:[root],has_more:false});
    assert.equal(args[1],'+messages-mget');assert.ok(args.includes('--download-resources'));
    assert.equal(options.cwd,path.dirname(await realpath(attachmentPath)));
    return envelope({messages:[await downloaded(attachmentPath,root,{bytes})]});
  }});
  const result=await recover();
  assert.equal(result.status,'delivered');assert.equal(result.messageId,'om_root');
  assert.equal(result.uploadKey,'file_upload');assert.equal(result.attachmentKey,'file_message');
  assert.equal(result.attachmentSha256,persisted.attachmentSha256);assert.equal(result.attachmentReadback,true);
  assert.deepEqual(calls,['+chat-messages-list','+messages-mget']);
  await assert.rejects(recover('错误的附件\n'),{code:'attachment-bytes-hash-mismatch',uncertain:true});
  assert.equal(sends,1);
  assert.ok(calls.every(command=>['+chat-messages-list','+messages-mget'].includes(command)));
});

for (const [name,extra,code] of [
  ['different bytes',{bytes:'另一份完整原文\n'},'attachment-bytes-hash-mismatch'],
  ['resource belongs to another message',{resource:{message_id:'om_other'}},'attachment-resource-mismatch'],
  ['resource key differs from post attachment',{resource:{key:'file_other'}},'attachment-resource-mismatch'],
  ['image instead of file',{resource:{type:'image'}},'attachment-resource-mismatch'],
  ['explicit resource download error',{resource:{error:true}},'attachment-resource-mismatch'],
  ['wrong byte size',{resource:{size_bytes:1}},'attachment-resource-size-invalid'],
  ['empty downloaded bytes',{bytes:''},'attachment-resource-size-invalid'],
]) test(`post send rejects ${name} and never resends`,async(t)=>{
  const attachmentPath=await attachment(t);let sends=0;
  await assert.rejects(sendRecommendation({chatId,markdown,attachmentPath,idempotencyKey,botSenderId:appId,runCli:async(args)=>{
    if(args[1]==='files')return envelope({file_key:'file_upload'});
    if(args[1]==='+messages-send'){sends++;return envelope({message_id:'om_root',chat_id:chatId});}
    return envelope({messages:[await downloaded(attachmentPath,message(),extra)]});
  }}),{code,uncertain:true,messageId:'om_root'});
  assert.equal(sends,1);
});

for(const kind of ['missing-resource','duplicate-resource','outside-root','duplicate-attachment'])test(`post send rejects ${kind}`,async(t)=>{
  const attachmentPath=await attachment(t);let sends=0;
  await assert.rejects(sendRecommendation({chatId,markdown,attachmentPath,idempotencyKey,botSenderId:appId,runCli:async(args)=>{
    if(args[1]==='files')return envelope({file_key:'file_upload'});
    if(args[1]==='+messages-send'){sends++;return envelope({message_id:'om_root',chat_id:chatId});}
    const root=message();
    if(kind==='duplicate-attachment')root.content+='\n<file key="file_extra"/>';
    const fixture=await downloaded(attachmentPath,root,kind==='outside-root'?{localPath:path.join(path.dirname(attachmentPath),'outside.md')}:{});
    if(kind==='missing-resource')delete fixture.resources;
    if(kind==='duplicate-resource')fixture.resources.push(fixture.resources[0]);
    return envelope({messages:[fixture]});
  }}),{code:kind==='outside-root'?'attachment-resource-path-outside-download-root':kind==='duplicate-attachment'?'attachment-readback-missing':'attachment-download-missing-or-not-unique',uncertain:true});
  assert.equal(sends,1);
});

for(const kind of ['upload-timeout','bad-upload-key','persist-failed','changed-original'])test(`${kind} never submits a post and is a definite unsent failure`,async(t)=>{
  const attachmentPath=await attachment(t);let sends=0;
  await assert.rejects(sendRecommendation({chatId,markdown,attachmentPath,idempotencyKey,botSenderId:appId,
    onUploaded:async()=>{if(kind==='persist-failed')throw Error('cannot-persist');if(kind==='changed-original')await writeFile(attachmentPath,'已修改\n');},
    runCli:async(args)=>{if(args[1]==='files'){if(kind==='upload-timeout')throw Error('upload-timeout');return envelope({file_key:kind==='bad-upload-key'?'invalid':'file_upload'});}sends++;throw Error('must-not-send');}
  }),{uncertain:false});
  assert.equal(sends,0);
});

for(const [name,body] of [['missing-date','内容'],['invalid-date',`${markdown}\n回顾日期：2026-02-30`]])test(`post refuses ${name} before upload`,async(t)=>{
  const attachmentPath=await attachment(t);let calls=0;
  await assert.rejects(sendRecommendation({chatId,markdown:body,attachmentPath,dateMarker:name==='invalid-date'?'回顾日期：2026-02-30':undefined,idempotencyKey,botSenderId:appId,runCli:async()=>{calls++;throw Error('must-not-call');}}),{code:'date-marker-invalid',uncertain:false});
  assert.equal(calls,0);
});

test('card-only input sends interactive content and verifies exact readback',async()=>{
  const card=reviewCard(`回顾日期：2026-10-06`),calls=[];
  const result=await sendRecommendation({chatId,card,idempotencyKey,botSenderId:appId,runCli:async args=>{
    calls.push(args);
    if(args[1]==='+messages-send') return envelope({message_id:'om_root',chat_id:chatId});
    if(args[1]==='+messages-mget') return envelope({messages:[cardMessage(card)]});
    throw Error('unexpected-call');
  }});
  assert.deepEqual(calls[0].slice(0,8),['im','+messages-send','--chat-id',chatId,'--msg-type','interactive','--content',JSON.stringify(card)]);
  assert.equal(result.messageId,'om_root');
  assert.equal(result.cardContentSha256,cardContentSha256(card));
  assert.equal(result.readback,true);
});

test('recovery checks exact date, expected canonical hash, configured sender and bounded complete time window', async (t) => {
  const attachmentPath = await attachment(t);
  let command;
  const result = await recoverRecommendation({ chatId, idempotencyKey, dateMarker: '回顾日期：2026-10-06', expectedMarkdown: markdown, markdownSha256: legacyTextHash, attachmentKey: 'file_upload', attachmentPath, attachmentSha256: createHash('sha256').update(await readFile(attachmentPath)).digest('hex'), sendStartedAt: now.toISOString(), botSenderId: appId, runCli: async (args) => { if(args[1] === '+messages-mget') return envelope({messages:[await downloaded(attachmentPath)]}); command = args; return envelope({ messages: [message(), message({ message_id: 'om_human', sender: { id: ownerId, sender_type: 'user' } })], has_more: false }); } });
  assert.equal(result.messageId, 'om_root');
  assert.equal(command[command.indexOf('--start') + 1], new Date(now.getTime() - 60_000).toISOString());
  assert.equal(command[command.indexOf('--end') + 1], new Date(now.getTime() + 300_000).toISOString());
});

test('recovery absence never grants resend; duplicate and wrong body block', async (t) => {
  const attachmentPath = await attachment(t);
  const input = { chatId, idempotencyKey, dateMarker: '回顾日期：2026-10-06', expectedMarkdown: markdown, markdownSha256: legacyTextHash, attachmentKey: 'file_upload', attachmentPath, attachmentSha256: createHash('sha256').update(await readFile(attachmentPath)).digest('hex'), sendStartedAt: now, botSenderId: appId };
  const empty = await recoverRecommendation({ ...input, runCli: async () => envelope({ messages: [], has_more: false }) });
  assert.equal(empty.safeToResend, false);
  await assert.rejects(recoverRecommendation({ ...input, runCli: async () => envelope({ messages: [message(), message({ message_id: 'om_duplicate' })], has_more: false }) }), { code: 'recovery-multiple-matches', uncertain: true });
  await assert.rejects(recoverRecommendation({ ...input, runCli: async () => envelope({ messages: [message({ content: `${markdown}\n不相同\n<file key="file_upload"/>` })], has_more: false }) }), { code: 'message-content-hash-mismatch', uncertain: true });
  await assert.rejects(recoverRecommendation({ ...input, runCli: async () => envelope({ messages: [message()], has_more: true }) }), { code: 'recovery-messages-incomplete', uncertain: true });
});

test('recovery can distinguish one exact body from another same-day recommendation', async (t) => {
  const attachmentPath = await attachment(t);
  const result = await recoverRecommendation({ chatId, idempotencyKey, dateMarker: '回顾日期：2026-10-06', expectedMarkdown: markdown, markdownSha256: legacyTextHash, attachmentKey: 'file_upload', attachmentPath, attachmentSha256: createHash('sha256').update(await readFile(attachmentPath)).digest('hex'), sendStartedAt: now, botSenderId: appId, runCli: async (args) => args[1] === '+messages-mget' ? envelope({messages:[await downloaded(attachmentPath)]}) : envelope({ messages: [message(), message({ message_id: 'om_otherbody', content: `${markdown}\n其他正文\n<file key="file_upload"/>` })], has_more: false }) });
  assert.equal(result.messageId, 'om_root');
});

const feedbackBatch = () => ({ date: '2026-10-06', status: 'delivered', chatId, messageId: 'om_root', markdownSha256:legacyTextHash, attachmentPath:'/private/tmp/legacy-fixture/review.md', attachmentSha256:'a'.repeat(64), attachmentKey:'file_upload', botSenderId:appId, items: [{ noteKey: 'note_a' }, { noteKey: 'note_b' }, { noteKey: 'note_c' }] });
const reply = (extra = {}) => ({ message_id: 'om_reply', chat_id: chatId, root_id: 'om_root', thread_id: 'omt_root', sender: { id: ownerId, sender_type: 'user' }, create_time: now.getTime(), content: '第2条有帮助；第1条跳过；第3条已回顾', ...extra });
const feedbackMock = (replies, threadOptions = {}) => async (args) => args[1] === '+messages-mget' ? envelope({ messages: [message({ thread_id: 'omt_root', thread_has_more: true, thread_replies: [reply()] })] }) : envelope({ messages: replies, has_more: false, ...threadOptions });

test('feedback binds verified root and note ordinal, accepts explicit owner clauses, deduplicates reply versions', async () => {
  const result = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply(), reply(), reply({ message_id: 'om_other', sender: { id: 'ou_other', sender_type: 'user' } }), reply({ message_id: 'om_wrongroot', root_id: 'om_else' }), reply({ message_id: 'om_question', content: '第1条是否有帮助？' })]) });
  assert.equal(result.complete, true);
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.events.map((event) => [event.noteKey, event.feedback]), [['note_b', '有帮助'], ['note_a', '跳过'], ['note_c', '已回顾']]);
  assert.ok(result.events.every((event) => event.replyId === 'om_reply' && event.rootMessageId === 'om_root'));
});

test('feedback accepts Arabic and Chinese ordinals for recommendations seven and eight', async () => {
  const batch = { ...feedbackBatch(), items: Array.from({ length: 8 }, (_, index) => ({ number: index + 1, noteKey: `note_${index + 1}` })) };
  const result = await collectFeedback({ batches: [batch], ownerId, runCli: feedbackMock([reply({ content: '第7条已回顾；第八条跳过' })]) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.events.map(({ number, noteKey, feedback }) => [number, noteKey, feedback]), [[7, 'note_7', '已回顾'], [8, 'note_8', '跳过']]);
});

test('feedback edited message uses update_time; missing edit version fails collection', async () => {
  const result = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply({ updated: true, update_time: now.getTime() + 1000 })]) });
  assert.equal(result.events[0].updateTime, String(now.getTime() + 1000));
  const failed = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply({ updated: true })]) });
  assert.equal(failed.complete, false);
  assert.deepEqual(failed.events, []);
  assert.equal(failed.errors[0].code, 'feedback-edit-version-missing');
});

test('feedback capped thread or missing root never becomes a successful empty result', async () => {
  const capped = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply()], { has_more: true }) });
  assert.equal(capped.truncated, true);
  assert.equal(capped.complete, false);
  assert.deepEqual(capped.events, []);
  const absent = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: async () => envelope({ messages: [] }) });
  assert.equal(absent.complete, false);
  assert.equal(absent.errors[0].code, 'feedback-root-invalid');
});

test('contradictory feedback for the same ordinal is not guessed', async () => {
  const result = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply({ content: '第1条跳过；第1条有帮助' })]) });
  assert.equal(result.complete, false);
  assert.equal(result.errors[0].code, 'feedback-conflicting-clauses');
  assert.deepEqual(result.events, []);
});

test('canonical Markdown retains real content changes while allowing post decoration and whitespace', () => {
  assert.equal(normalizeMessageMarkdown('# 标题\n\n1. **原文**'), normalizeMessageMarkdown('**标题**\n1. 原文'));
  assert.notEqual(normalizeMessageMarkdown('原文A'), normalizeMessageMarkdown('原文B'));
  assert.notEqual(normalizeMessageMarkdown('[来源](https://source/a)'), normalizeMessageMarkdown('[来源](https://source/b)'));
});

// Sanitized live +messages-mget fixture: resources belong to each message, not the envelope.
const liveUploadKey = 'file_v3_00167_d1b8_fixture56g';
const liveMessageKey = 'file_v3_00167_3d46_fixtureabg';
const livePost = (extra = {}) => message({ content: `${markdown}\n<file key="${liveMessageKey}" name="review.md"/>`, message_position: '0', updated: false, ...extra });

test('recovery verifies changed message key against saved original bytes without sending; later original changes block', async (t) => {
  const attachmentPath = await attachment(t);
  const attachmentSha256 = createHash('sha256').update(await readFile(attachmentPath)).digest('hex');
  const input = { chatId, messageId: 'om_root', dateMarker: '回顾日期：2026-10-06', idempotencyKey, expectedMarkdown: markdown, markdownSha256: legacyTextHash, attachmentKey: 'file_upload', attachmentPath, attachmentSha256, attachmentKey: liveUploadKey, botSenderId: appId };
  let calls = 0;
  const runCli = async (args) => { calls++; assert.equal(args[1], '+messages-mget'); assert.ok(args.includes('--download-resources')); return envelope({ messages: [await downloaded(attachmentPath, livePost())] }); };
  const result = await recoverRecommendation({ ...input, runCli });
  assert.equal(result.attachmentKey, liveMessageKey);
  assert.equal(result.attachmentSha256, attachmentSha256);
  assert.equal(result.attachmentReadback, true);
  assert.equal(calls, 1);
  await writeFile(attachmentPath, '本地原件已变\n');
  await assert.rejects(recoverRecommendation({ ...input, runCli }), { code: 'attachment-original-hash-mismatch', uncertain: true });
  assert.equal(calls, 1);
});

test('feedback checks persisted message attachment key without downloading; edits fail closed', async () => {
  const markdownSha256 = createHash('sha256').update(normalizeMessageMarkdown(markdown)).digest('hex');
  const batch = { ...feedbackBatch(), markdownSha256, attachmentKey: liveMessageKey, attachmentSha256: 'a'.repeat(64), botSenderId: appId };
  const runCli = async (args) => { assert.ok(!args.includes('--download-resources')); return envelope({ messages: [livePost()] }); };
  const result = await collectFeedback({ batches: [batch], ownerId, runCli });
  assert.equal(result.complete, true);
  const changed = await collectFeedback({ batches: [batch], ownerId, runCli: async () => envelope({ messages: [message()] }) });
  assert.equal(changed.complete, false);
  assert.equal(changed.errors[0].code, 'attachment-readback-missing');
});


test('recovery cannot infer attachment integrity from an unversioned local original', async (t) => {
  await assert.rejects(recoverRecommendation({chatId, messageId:'om_root', dateMarker:'回顾日期：2026-10-06', idempotencyKey, expectedMarkdown:markdown, attachmentPath:await attachment(t), botSenderId:appId, runCli:async()=>{throw Error('must-not-read');}}), {code:'recovery-input-invalid'});
});

test('edited feedback root fails closed even if rendered body is unchanged', async () => {
  const result = await collectFeedback({batches:[feedbackBatch()],ownerId,runCli:async()=>envelope({messages:[message({updated:true})]})});
  assert.equal(result.complete,false);
  assert.equal(result.errors[0].code,'feedback-root-edited');
});

for (const content of ['普通聊天', '', '第2条是否有帮助？']) test(`owner reply observation survives non-feedback content: ${content || 'empty'}`, async () => {
  const result = await collectFeedback({ batches: [feedbackBatch()], ownerId, runCli: feedbackMock([reply({content,updated:true,update_time:now.getTime()+1000})]) });
  assert.equal(result.complete,true);
  assert.deepEqual(result.events,[]);
  assert.equal(result.replyObservations.length,1);
  assert.equal(result.replyObservations[0].state,'present');
  assert.deepEqual(result.replyObservations[0].eventKeys,[]);
});

test('explicit owner deletion yields a versioned tombstone without negative feedback', async () => {
  const result = await collectFeedback({batches:[feedbackBatch()],ownerId,runCli:feedbackMock([reply({deleted:true,delete_time:now.getTime()+1000,content:''})])});
  assert.equal(result.complete,true);
  assert.deepEqual(result.events,[]);
  assert.equal(result.replyObservations[0].state,'deleted');
  assert.equal(result.replyObservations[0].updateTime,String(now.getTime()+1000));
});

for (const [name,extra,code] of [
  ['plain edit without version',{content:'普通聊天',updated:true},'feedback-edit-version-missing'],
  ['empty edit invalid version',{content:'',updated:true,update_time:'unknown'},'feedback-version-invalid'],
  ['deletion missing version',{deleted:true,content:''},'feedback-delete-version-missing'],
  ['deletion unverified owner',{deleted:true,update_time:now.getTime()+1000,sender:{}},'feedback-delete-owner-unverified'],
  ['deletion time precedes creation',{deleted:true,delete_time:now.getTime()-1000},'feedback-version-invalid'],
]) test(`feedback refuses ${name} without partial observations`,async()=>{
  const result=await collectFeedback({batches:[feedbackBatch()],ownerId,runCli:feedbackMock([reply(),reply({message_id:'om_changed',...extra})])});
  assert.equal(result.complete,false);assert.equal(result.errors[0].code,code);
  assert.deepEqual(result.events,[]);assert.deepEqual(result.replyObservations,[]);
});


test('strict canonicalization preserves ordinal and decimal content',()=>{
  assert.notEqual(normalizeMessageMarkdown('1.苹果\n2.香蕉'),normalizeMessageMarkdown('2.苹果\n1.香蕉'));
  assert.notEqual(normalizeMessageMarkdown('1.5%'),normalizeMessageMarkdown('2.5%'));
  assert.notEqual(normalizeMessageMarkdown('第1条跳过'),normalizeMessageMarkdown('第2条跳过'));
  assert.equal(normalizeMessageMarkdown('## 1. **苹果**'),normalizeMessageMarkdown('**1. 苹果**'));
});

for (const [name,body,wrongBody] of [['ordinal','1.苹果\n2.香蕉','2.苹果\n1.香蕉'],['decimal','1.5%','2.5%']]) test(`readback refuses changed ${name} content`,async(t)=>{
  const attachmentPath=await attachment(t);let sends=0;
  await assert.rejects(sendRecommendation({chatId,markdown:`${body}\n回顾日期：2026-10-06`,attachmentPath,idempotencyKey,botSenderId:appId,runCli:async(args)=>{
    if(args[1]==='files')return envelope({file_key:'file_upload'});
    if(args[1]==='+messages-send'){sends++;return envelope({message_id:'om_root',chat_id:chatId});}
    return envelope({messages:[await downloaded(attachmentPath,message({content:`${wrongBody}\n回顾日期：2026-10-06\n<file key="file_upload"/>`}))]});
  }}),{code:'message-content-hash-mismatch',uncertain:true});
  assert.equal(sends,1);
});


test('server-filtered minute boundary counts all four workflow messages despite minute-only display time',async()=>{
  const boundaryNow=new Date('2026-10-06T18:28:45+08:00');let request;
  const base=mockPreflight({recent:Array.from({length:4},(_,i)=>message({message_id:`om_boundary_${i}`,create_time:'2026-10-06 18:27'}))});
  await assert.rejects(preflightDelivery({chatId,ownerId,now:boundaryNow,runCli:async(args)=>{if(args[1]==='+chat-messages-list')request=args;return base(args);}}),{code:'send-frequency-limit'});
  assert.equal(request[request.indexOf('--start')+1],'2026-10-06T10:27:45.000Z');
  assert.equal(request[request.indexOf('--end')+1],'2026-10-06T10:28:45.000Z');
  assert.ok(request.includes('--page-all'));
});

test('precise timestamps within the same complete server query retain rate counts and exclude other bots',async()=>{
  const recent=[...Array.from({length:3},(_,i)=>message({message_id:`om_precise_${i}`,create_time:now.getTime()-5000-i*1000})),...Array.from({length:4},(_,i)=>message({message_id:`om_other_${i}`,create_time:'2026-10-06 18:27',sender:{id:'cli_other',sender_type:'app'}}))];
  const result=await preflightDelivery({chatId,ownerId,now,runCli:mockPreflight({recent})});
  assert.equal(result.sentInLastMinute,3);
});

async function historicalLegacy(t, body = markdown) {
  const attachmentPath = await attachment(t);
  return { ...feedbackBatch(), idempotencyKey, expectedMarkdown:body, markdown:body,
    markdownSha256:createHash('sha256').update(normalizeMessageMarkdown(body)).digest('hex'),
    attachmentPath, attachmentSha256:createHash('sha256').update(await readFile(attachmentPath)).digest('hex'),
    attachmentKey:liveMessageKey, botSenderIds:[appId], normalizationVersion:2 };
}

test('historical delivered post fixture recovers read-only and accepts complete zero-feedback root',async(t)=>{
  const batch=await historicalLegacy(t);const calls=[];
  const fixture=await downloaded(batch.attachmentPath,livePost());
  const runCli=async(args,options)=>{calls.push(args);assert.equal(args[1],'+messages-mget');if(args.includes('--download-resources'))assert.equal(options.cwd,path.dirname(await realpath(batch.attachmentPath)));return envelope({messages:[fixture],total:1});};
  const receipt=await recoverRecommendation({...batch,dateMarker:'回顾日期：2026-10-06',runCli});
  assert.equal(receipt.messageId,batch.messageId);assert.equal(receipt.attachmentReadback,true);
  assert.equal(receipt.markdownSha256,batch.markdownSha256);assert.equal(receipt.attachmentKey,batch.attachmentKey);
  const feedback=await collectFeedback({batches:[{...batch,...receipt}],ownerId,runCli});
  assert.equal(feedback.complete,true);assert.deepEqual(feedback.events,[]);assert.deepEqual(feedback.replyObservations,[]);
  assert.equal(calls.length,2);assert.ok(!calls[1].includes('--download-resources'));
});

for(const [kind,body,replace] of [['wrong-body',markdown,'被修改'],['wrong-ordinal',`${markdown}\n1.苹果\n2.香蕉`,null],['wrong-decimal',`${markdown}\n1.5%`,null],['wrong-file-bytes',markdown,null]])test(`historical legacy rejects ${kind} without converting or resending`,async(t)=>{
  const batch=await historicalLegacy(t,body);let calls=0;
  let wrong=body;if(kind==='wrong-body')wrong+=replace;if(kind==='wrong-ordinal')wrong=wrong.replace('1.苹果\n2.香蕉','2.苹果\n1.香蕉');if(kind==='wrong-decimal')wrong=wrong.replace('1.5%','2.5%');
  const fixture=await downloaded(batch.attachmentPath,livePost({content:`${wrong}\n<file key="${liveMessageKey}" name="review.md"/>`}),kind==='wrong-file-bytes'?{bytes:'错误附件\n'}:{});
  await assert.rejects(recoverRecommendation({...batch,dateMarker:'回顾日期：2026-10-06',runCli:async(args)=>{calls++;assert.equal(args[1],'+messages-mget');return envelope({messages:[fixture]});}}),{code:kind==='wrong-file-bytes'?'attachment-bytes-hash-mismatch':'message-content-hash-mismatch',uncertain:true});
  assert.equal(calls,1);
});

test('historical legacy refuses mixed card receipt and refuses weak markdown-only input',async(t)=>{
  const batch=await historicalLegacy(t);let calls=0;const card={schema:'2.0',body:{elements:[{tag:'markdown',content:'回顾日期：2026-10-06'}]}};
  const mixed={...batch,cardContentSha256:cardContentSha256(card),expectedCard:card};
  await assert.rejects(recoverRecommendation({...mixed,dateMarker:'回顾日期：2026-10-06',runCli:async()=>{calls++;throw Error('must-not-call');}}),{code:'receipt-format-ambiguous'});
  await assert.rejects(recoverRecommendation({...batch,markdownSha256:undefined,dateMarker:'回顾日期：2026-10-06',runCli:async()=>{calls++;throw Error('must-not-call');}}),{code:'recovery-input-invalid'});
  assert.equal(calls,0);
  const result=await collectFeedback({batches:[mixed],ownerId,runCli:async()=>envelope({messages:[livePost()]})});
  assert.equal(result.complete,false);assert.equal(result.errors[0].code,'receipt-format-ambiguous');
});

test('card-only recovery and feedback remain independent of historical post receipts',async()=>{
  const card={schema:'2.0',body:{elements:[{tag:'markdown',content:'回顾日期：2026-10-06'}]}};
  const batch={date:'2026-10-06',status:'delivered',chatId,messageId:'om_root',botSenderId:appId,idempotencyKey,card,cardContentSha256:cardContentSha256(card),items:[]};
  const root=message({msg_type:'interactive',content:JSON.stringify(card),resources:[]});
  const runCli=async(args)=>{assert.equal(args[1],'+messages-mget');return envelope({messages:[root]});};
  const recovered=await recoverRecommendation({...batch,expectedCard:card,dateMarker:'回顾日期：2026-10-06',runCli});
  assert.equal(recovered.cardContentSha256,batch.cardContentSha256);
  const feedback=await collectFeedback({batches:[batch],ownerId,runCli});assert.equal(feedback.complete,true);
});

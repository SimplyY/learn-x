import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
export const MESSAGE_NORMALIZATION_VERSION = 2;
const BOT_ARGS = ['--as', 'bot', '--format', 'json'];
const hash = (value) => createHash('sha256').update(value).digest('hex');

export class DeliveryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'DeliveryError';
    this.code = code;
    Object.assign(this, details);
  }
}

/** Never log CLI stdout/stderr: responses may include private content. */
export async function runLarkCli(args, options = {}) {
  try {
    const { stdout } = await execFileAsync('lark-cli', args, {
      cwd: options.cwd || process.cwd(), timeout: 45_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    });
    return JSON.parse(stdout);
  } catch (error) {
    throw new DeliveryError('lark-cli-failed', { timedOut: Boolean(error.killed), exitCode: error.code });
  }
}

async function call(runCli, args, options) {
  let result = await runCli(args, options);
  if (typeof result === 'string') result = JSON.parse(result);
  if (typeof result?.stdout === 'string') result = JSON.parse(result.stdout);
  if (!result || result.ok === false) throw new DeliveryError('lark-response-failed', { errorType: result?.error?.type });
  if (result.identity !== undefined && result.identity !== 'bot') throw new DeliveryError('identity-mismatch');
  return result;
}

function dataOf(result) { return result.data ?? result; }
function useProfile(runCli, profile) {
  if (!profile) return runCli;
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) throw new DeliveryError('profile-invalid');
  return (args, options) => runCli([...args, '--profile', profile], options);
}
function assertId(value, prefix, code) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new DeliveryError(code);
}
function assertComplete(result, code) {
  const data = dataOf(result);
  const pagination = result.meta?.pagination ?? data.meta?.pagination;
  if (data.has_more === true || pagination?.complete === false || data.truncations?.length || result.meta?.truncations?.length) throw new DeliveryError(code);
  if (data.has_more !== false && pagination?.complete !== true) throw new DeliveryError(`${code}-unknown`);
}
function messagesOf(result) {
  const data = dataOf(result);
  const messages = data.messages ?? data.items;
  if (!Array.isArray(messages)) throw new DeliveryError('message-list-invalid');
  return messages;
}
function timestamp(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (/^\d+$/.test(String(value))) { const n = Number(value); return n < 1e12 ? n * 1000 : n; }
  return new Date(value).getTime();
}
function senderKind(sender) {
  const kind = sender?.sender_type ?? sender?.type ?? sender?.id_type;
  if (['app', 'bot', 'app_id'].includes(kind)) return 'bot';
  if (['user', 'open_id', 'user_id', 'union_id'].includes(kind)) return 'user';
  return null;
}
function senderIds(sender) {
  return [sender?.id, sender?.member_id, sender?.open_id, sender?.open_bot_id, sender?.app_id].filter(Boolean);
}

export async function preflightDelivery({ chatId, ownerId, profile, runCli = runLarkCli, now = new Date() }) {
  runCli = useProfile(runCli, profile);
  assertId(chatId, 'oc_', 'chat-id-invalid');
  assertId(ownerId, 'ou_', 'owner-id-invalid');
  const who = dataOf(await call(runCli, ['whoami', '--as', 'bot']));
  if (who.identity !== 'bot') throw new DeliveryError('bot-identity-unverified');
  if (who.available === false || (profile && who.profile !== profile)) throw new DeliveryError('workflow-profile-unverified');
  const appId = who.appId ?? who.app_id ?? who.app?.appId ?? who.app?.app_id ?? who.app?.id;
  if (typeof appId !== 'string' || !appId.startsWith('cli_')) throw new DeliveryError('bot-app-unverified');
  const membership = await call(runCli, ['im', '+chat-members-list', '--chat-id', chatId, '--member-id-type', 'open_id', '--member-types', 'user,bot', '--page-all', '--page-limit', '0', ...BOT_ARGS]);
  assertComplete(membership, 'member-list-incomplete');
  const members = dataOf(membership);
  if (members.chat_id !== chatId || !Array.isArray(members.users) || !Array.isArray(members.bots)) throw new DeliveryError('member-list-invalid');
  if (members.users.length !== 1 || members.users[0].member_id !== ownerId) throw new DeliveryError('recipient-scope-mismatch');
  if (members.user_total !== undefined && Number(members.user_total) !== members.users.length) throw new DeliveryError('member-count-mismatch');
  if (members.bot_total !== undefined && Number(members.bot_total) !== members.bots.length) throw new DeliveryError('member-count-mismatch');
  if (members.bots.some((bot) => !bot.member_id || !bot.app_id)) throw new DeliveryError('group-bot-unverified');
  const workflowBots = members.bots.filter((bot) => bot.app_id === appId);
  if (workflowBots.length !== 1) throw new DeliveryError('workflow-bot-membership-unverified');
  const workflowBot = workflowBots[0];
  const botIds = new Set([workflowBot.member_id, workflowBot.app_id]);
  const end = new Date(now);
  if (!Number.isFinite(end.getTime())) throw new DeliveryError('now-invalid');
  const start = new Date(end.getTime() - 60_000);
  const recent = await call(runCli, ['im', '+chat-messages-list', '--chat-id', chatId, '--start', start.toISOString(), '--end', end.toISOString(), '--order', 'asc', '--page-all', '--page-limit', '1000', '--no-reactions', ...BOT_ARGS]);
  assertComplete(recent, 'recent-messages-incomplete');
  let sentInLastMinute = 0;
  for (const message of messagesOf(recent)) {
    if (message.chat_id && message.chat_id !== chatId) throw new DeliveryError('recent-message-chat-mismatch');
    if (message.msg_type === 'system') continue;
    const time = timestamp(message.create_time);
    const kind = senderKind(message.sender);
    if (!Number.isFinite(time) || !kind || !senderIds(message.sender).length) throw new DeliveryError('recent-message-identity-or-time-unknown');
    // The chat API already filters this complete start/end window in seconds.
    // CLI create_time is display text that may omit seconds; filtering it again loses boundary messages.
    if (kind === 'bot' && senderIds(message.sender).some((id) => botIds.has(id))) sentInLastMinute += 1;
  }
  if (sentInLastMinute >= 4) throw new DeliveryError('send-frequency-limit');
  return { identity: 'bot', chatId, ownerId, appId, profile: who.profile ?? profile, botSenderId: workflowBot.app_id, botSenderIds: [...botIds], sentInLastMinute, checkedAt: end.toISOString(), memberCount: members.users.length + members.bots.length };
}

/** Compare human-readable content across Markdown → Feishu post rendering. */
export function normalizeMessageMarkdown(markdown) {
  return String(markdown).replace(/\r\n?/g, '\n').normalize('NFC')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/(?:\*\*|__|`)/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*[-_*]{3,}\s*$/gm, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function cardJSON(content) {
  const text = typeof content === 'object' && content !== null ? JSON.stringify(content) : String(content ?? '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map(canonicalJSON);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJSON(value[key])]));
}

export function cardContentSha256(content) {
  const card = cardJSON(content);
  if (!card) throw new DeliveryError('card-content-invalid');
  return hash(JSON.stringify(canonicalJSON(card)));
}

function messageContent(content) {
  const text = String(content ?? '');
  const attachments = [...text.matchAll(/<(?:file|folder)\s+[^>]*key=["']([^"']+)["'][^>]*\/?>(?:<\/file>)?/g)].map((match) => match[1]);
  const stripped = text.replace(/<(?:file|folder)\s+[^>]*\/?>(?:<\/file>)?/g, '').trim();
  return { markdownSha256: hash(normalizeMessageMarkdown(stripped)), attachments, body: stripped };
}

function legacyReceiptReady(value) {
  const bots = [...(value.botSenderIds ?? []), ...(value.botSenderId ? [value.botSenderId] : [])];
  const keys = [value.uploadKey, value.attachmentKey].filter(key => key !== undefined);
  return /^[a-f0-9]{64}$/.test(value.markdownSha256 ?? '') && typeof value.attachmentPath === 'string' && value.attachmentPath.length > 0 && /^[a-f0-9]{64}$/.test(value.attachmentSha256 ?? '') && keys.length > 0 && keys.every(key => /^file_[A-Za-z0-9_-]+$/.test(key ?? '')) && bots.length > 0;
}

function receiptFormat(value) {
  const hasCard = Boolean(value.cardContentSha256 || value.expectedCard || value.card);
  const hasLegacy = Boolean(value.markdownSha256 || value.attachmentKey || value.uploadKey);
  if (hasCard && hasLegacy) throw new DeliveryError('receipt-format-ambiguous');
  if (hasCard) return 'card';
  if (hasLegacy && legacyReceiptReady(value)) return 'legacy-markdown';
  throw new DeliveryError('receipt-format-missing-or-incomplete');
}

function verifyLegacyMessage(message, { chatId, messageId, markdownSha256, attachmentKey, dateMarker, botSenderId, botSenderIds }) {
  if (!message || message.message_id !== messageId || message.chat_id !== chatId || message.deleted !== false) throw new DeliveryError('message-readback-invalid');
  const bots = [...(botSenderIds ?? []), ...(botSenderId ? [botSenderId] : [])];
  if (!bots.length || senderKind(message.sender) !== 'bot' || !senderIds(message.sender).some(id => bots.includes(id))) throw new DeliveryError('message-bot-mismatch');
  if (message.msg_type !== 'post' || cardJSON(message.content)) throw new DeliveryError('legacy-message-type-mismatch');
  const content = messageContent(message.content);
  if (content.markdownSha256 !== markdownSha256) throw new DeliveryError('message-content-hash-mismatch');
  if (content.attachments.length !== 1 || (attachmentKey && content.attachments[0] !== attachmentKey)) throw new DeliveryError('attachment-readback-missing');
  if (dateMarker && !content.body.split(/\r?\n/).some(line => normalizeMessageMarkdown(line) === normalizeMessageMarkdown(dateMarker))) throw new DeliveryError('date-marker-mismatch');
  return { messageId, chatId, normalizationVersion: MESSAGE_NORMALIZATION_VERSION, markdownSha256: content.markdownSha256, attachmentKeys: content.attachments, readback: true, threadId: message.thread_id ?? null };
}

function verifyMessage(message, { chatId, messageId, cardContentSha256: expectedCardSha256, dateMarker, botSenderId, botSenderIds }) {
  if (!message || message.message_id !== messageId || message.chat_id !== chatId || message.deleted !== false) throw new DeliveryError('message-readback-invalid');
  const allowedBots = [...(botSenderIds ?? []), ...(botSenderId ? [botSenderId] : [])];
  if (senderKind(message.sender) !== 'bot' || !senderIds(message.sender).length || (allowedBots.length && !senderIds(message.sender).some((id) => allowedBots.includes(id)))) throw new DeliveryError('message-bot-mismatch');
  const card = cardJSON(message.content);
  if (!card || card.schema !== '2.0') throw new DeliveryError('card-readback-invalid');
  const contentSha256 = cardContentSha256(message.content);
  if (expectedCardSha256 && contentSha256 !== expectedCardSha256) throw new DeliveryError('card-content-hash-mismatch');
  if (dateMarker && !String(message.content).includes(dateMarker)) throw new DeliveryError('date-marker-mismatch');
  return { messageId, chatId, normalizationVersion: MESSAGE_NORMALIZATION_VERSION, cardContentSha256: contentSha256, readback: true, threadId: message.thread_id ?? null };
}

async function originalAttachment(attachmentPath, expectedSha256) {
  const filePath = await realpath(attachmentPath);
  const info = await stat(filePath);
  if (!filePath.endsWith('.md') || !info.isFile() || !info.size || info.size > 30 * 1024 * 1024) throw new DeliveryError('attachment-invalid');
  const attachmentSha256 = hash(await readFile(filePath));
  if (expectedSha256 && attachmentSha256 !== expectedSha256) throw new DeliveryError('attachment-original-hash-mismatch');
  return { attachmentPath: filePath, attachmentSha256, cwd: path.dirname(filePath) };
}

/** Feishu changes upload keys when attaching files to a post. Verify downloaded bytes. */
async function verifyDownloadedAttachment(message, original) {
  const keys = messageContent(message.content).attachments;
  if (keys.length !== 1) throw new DeliveryError('attachment-readback-not-unique');
  if (!Array.isArray(message.resources) || message.resources.length !== 1 || message.resource_errors?.length) throw new DeliveryError('attachment-download-missing-or-not-unique');
  const resource = message.resources[0];
  if (resource.error || resource.message_id !== message.message_id || resource.type !== 'file' || resource.key !== keys[0]) throw new DeliveryError('attachment-resource-mismatch');
  if (typeof resource.local_path !== 'string') throw new DeliveryError('attachment-resource-path-invalid');
  const downloadRoot = path.join(original.cwd, 'lark-im-resources');
  const actualPath = await realpath(path.resolve(original.cwd, resource.local_path));
  if (!actualPath.startsWith(`${downloadRoot}${path.sep}`) || !actualPath.endsWith('.md')) throw new DeliveryError('attachment-resource-path-outside-download-root');
  const info = await stat(actualPath);
  const bytes = await readFile(actualPath);
  if (!info.isFile() || !bytes.length || Number(resource.size_bytes) !== bytes.length) throw new DeliveryError('attachment-resource-size-invalid');
  const attachmentSha256 = hash(bytes);
  if (attachmentSha256 !== original.attachmentSha256) throw new DeliveryError('attachment-bytes-hash-mismatch');
  return { attachmentKey: keys[0], attachmentSha256, attachmentPath: original.attachmentPath, attachmentReadback: true };
}

async function readDownloadedMessage(runCli, messageId, cwd) {
  const fetched = await call(runCli, ['im', '+messages-mget', '--message-ids', messageId, '--download-resources', '--no-reactions', ...BOT_ARGS], { cwd });
  const messages = messagesOf(fetched).filter((message) => message.message_id === messageId);
  if (messages.length !== 1) throw new DeliveryError('message-readback-not-unique');
  return messages[0];
}

export async function sendRecommendation({ chatId, card, markdown, attachmentPath, attachmentSha256, dateMarker, idempotencyKey, botSenderId, botSenderIds, profile, onUploaded, runCli = runLarkCli }) {
  runCli = useProfile(runCli, profile);
  assertId(chatId, 'oc_', 'chat-id-invalid');
  let messageId, sendAttempted = false;
  try {
    const bots = [...(botSenderIds ?? []), ...(botSenderId ? [botSenderId] : [])];
    if (!bots.length || !/^[A-Za-z0-9:_-]{1,50}$/.test(idempotencyKey ?? '')) throw new DeliveryError('send-input-invalid');
    if (card) {
      dateMarker ??= JSON.stringify(card).match(/回顾日期：\d{4}-\d{2}-\d{2}/)?.[0];
      if (markdown || attachmentPath || typeof dateMarker !== 'string' || card.schema !== '2.0' || !/^(?:回顾日期：)(\d{4}-\d{2}-\d{2})$/.test(dateMarker) || !JSON.stringify(card).includes(dateMarker)) throw new DeliveryError('card-send-input-invalid');
      const cardSha256 = cardContentSha256(card);
      sendAttempted = true;
      const sent = dataOf(await call(runCli, ['im', '+messages-send', '--chat-id', chatId, '--msg-type', 'interactive', '--content', JSON.stringify(card), '--idempotency-key', idempotencyKey, ...BOT_ARGS]));
      messageId = sent.message_id;
      assertId(messageId, 'om_', 'sent-message-id-missing');
      if (sent.chat_id !== chatId) throw new DeliveryError('sent-chat-mismatch');
      const message = await readDownloadedMessage(runCli, messageId);
      return { ...verifyMessage(message, { chatId, messageId, cardContentSha256: cardSha256, dateMarker, botSenderId, botSenderIds }), idempotencyKey };
    }
    if (typeof markdown !== 'string' || !markdown.trim() || !attachmentPath) throw new DeliveryError('send-input-invalid');
    dateMarker ??= markdown.split(/\r?\n/).find(line => /^回顾日期：\d{4}-\d{2}-\d{2}$/.test(line.trim()))?.trim();
    const date = dateMarker?.match(/^回顾日期：(\d{4}-\d{2}-\d{2})$/)?.[1];
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || !markdown.split(/\r?\n/).some(line => normalizeMessageMarkdown(line) === dateMarker)) throw new DeliveryError('date-marker-invalid');
    if (messageContent(markdown).attachments.length) throw new DeliveryError('markdown-contains-attachment');
    const original = await originalAttachment(attachmentPath, attachmentSha256);
    const markdownSha256 = hash(normalizeMessageMarkdown(markdown));
    const uploaded = dataOf(await call(runCli, ['im', 'files', 'create', '--data', JSON.stringify({ file_type: 'stream', file_name: path.basename(original.attachmentPath) }), '--file', `file=./${path.basename(original.attachmentPath)}`, ...BOT_ARGS], { cwd: original.cwd }));
    assertId(uploaded.file_key, 'file_', 'uploaded-file-key-invalid');
    if (onUploaded) await onUploaded({ uploadKey: uploaded.file_key, attachmentSha256: original.attachmentSha256, attachmentPath: original.attachmentPath, markdownSha256 });
    // A callback or concurrent edit must not change the original after its hash was persisted.
    await originalAttachment(original.attachmentPath, original.attachmentSha256);
    sendAttempted = true;
    const sent = dataOf(await call(runCli, ['im', '+messages-send', '--chat-id', chatId, '--markdown', markdown, '--attachment', uploaded.file_key, '--idempotency-key', idempotencyKey, ...BOT_ARGS], { cwd: original.cwd }));
    messageId = sent.message_id;
    assertId(messageId, 'om_', 'sent-message-id-missing');
    if (sent.chat_id !== chatId) throw new DeliveryError('sent-chat-mismatch');
    const message = await readDownloadedMessage(runCli, messageId, original.cwd);
    const receipt = verifyLegacyMessage(message, { chatId, messageId, markdownSha256, dateMarker, botSenderId, botSenderIds });
    return { ...receipt, ...await verifyDownloadedAttachment(message, original), uploadKey: uploaded.file_key, idempotencyKey };
  } catch (error) {
    throw new DeliveryError(error.code ?? 'send-result-uncertain', { uncertain: sendAttempted, ...(messageId ? { messageId } : {}) });
  }
}

export async function recoverRecommendation({ chatId, messageId, idempotencyKey, dateMarker, expectedCard, cardContentSha256: expectedCardSha256, expectedMarkdown, markdownSha256, attachmentPath, attachmentSha256, uploadKey, attachmentKey, sendStartedAt, botSenderId, botSenderIds, profile, runCli = runLarkCli }) {
  runCli = useProfile(runCli, profile);
  assertId(chatId, 'oc_', 'chat-id-invalid');
  let format;
  try { format = receiptFormat({ expectedCard, cardContentSha256: expectedCardSha256, markdownSha256, attachmentPath, attachmentSha256, uploadKey, attachmentKey, botSenderId, botSenderIds }); }
  catch (error) { throw new DeliveryError(error.code === 'receipt-format-ambiguous' ? error.code : 'recovery-input-invalid'); }
  expectedCardSha256 ??= expectedCard ? cardContentSha256(expectedCard) : undefined;
  const expectedHash = format === 'card' ? expectedCardSha256 : markdownSha256;
  const allowedBots = [...(botSenderIds ?? []), ...(botSenderId ? [botSenderId] : [])];
  if (!/^[A-Za-z0-9:_-]{1,50}$/.test(idempotencyKey ?? '') || !dateMarker || !/^[a-f0-9]{64}$/.test(expectedHash ?? '') || !allowedBots.length) throw new DeliveryError('recovery-input-invalid');
  try {
    const original = format === 'legacy-markdown' ? await originalAttachment(attachmentPath, attachmentSha256) : null;
    if (format === 'legacy-markdown' && (!expectedMarkdown || hash(normalizeMessageMarkdown(expectedMarkdown)) !== markdownSha256)) throw new DeliveryError('legacy-original-markdown-hash-mismatch');
    let candidates;
    if (messageId) {
      assertId(messageId, 'om_', 'message-id-invalid');
      candidates = [await readDownloadedMessage(runCli, messageId, original?.cwd)];
    } else {
      const started = timestamp(sendStartedAt);
      if (!Number.isFinite(started)) throw new DeliveryError('recovery-send-started-at-missing');
      const response = await call(runCli, ['im', '+chat-messages-list', '--chat-id', chatId, '--start', new Date(started - 60_000).toISOString(), '--end', new Date(started + 300_000).toISOString(), '--order', 'asc', '--page-all', '--page-limit', '1000', '--no-reactions', ...BOT_ARGS]);
      assertComplete(response, 'recovery-messages-incomplete');
      candidates = messagesOf(response);
    }
    const matching = candidates.filter((message) => message.message_id === messageId || (!messageId && message.chat_id === chatId && senderKind(message.sender) === 'bot' && senderIds(message.sender).some((id) => allowedBots.includes(id)) && (format === 'card' ? cardJSON(message.content) && String(message.content).includes(dateMarker) : String(message.content ?? '').split(/\r?\n/).some(line => normalizeMessageMarkdown(line) === normalizeMessageMarkdown(dateMarker)))));
    if (!matching.length) return { status: 'not-found', matched: false, safeToResend: false };
    const exact = matching.filter((message) => (format === 'card' ? cardContentSha256(message.content) : messageContent(message.content).markdownSha256) === expectedHash);
    if (!exact.length) throw new DeliveryError('message-content-hash-mismatch');
    if (exact.length !== 1) throw new DeliveryError('recovery-multiple-matches');
    const message = messageId ? exact[0] : await readDownloadedMessage(runCli, exact[0].message_id, original?.cwd);
    if (format === 'legacy-markdown') {
      // Upload keys can be rebased by Feishu. Recover the actual message key by verifying downloaded bytes.
      const receipt = verifyLegacyMessage(message, { chatId, messageId: exact[0].message_id, markdownSha256, dateMarker, botSenderId, botSenderIds });
      return { status: 'delivered', matched: true, ...receipt, ...await verifyDownloadedAttachment(message, original), ...(uploadKey ? { uploadKey } : {}) };
    }
    const receipt = verifyMessage(message, { chatId, messageId: exact[0].message_id, cardContentSha256: expectedCardSha256, dateMarker, botSenderId, botSenderIds });
    return { status: 'delivered', matched: true, ...receipt };
  } catch (error) { throw new DeliveryError(error.code ?? 'recovery-uncertain', { uncertain: true }); }
}

function batchItems(batch) {
  const items = batch.items ?? batch.notes ?? batch.selections ?? [];
  return items.map((item, index) => ({ number: item.number ?? item.position ?? index + 1, noteKey: item.noteKey ?? item.note_key ?? item.noteId ?? item.id }));
}

function observeReply(message, batch, ownerId) {
  if (message.message_id === batch.messageId || (message.root_id && message.root_id !== batch.messageId)) return null;
  if (!message.root_id && !message.__verifiedThread) return null;
  const kind = senderKind(message.sender), ids = senderIds(message.sender);
  if (message.deleted === true && (!kind || !ids.length)) throw new DeliveryError('feedback-delete-owner-unverified');
  if (kind !== 'user' || !ids.includes(ownerId)) return null;
  if (message.deleted === true && !message.delete_time && !message.update_time) throw new DeliveryError('feedback-delete-version-missing');
  if (message.updated === true && !message.update_time && !(message.deleted === true && message.delete_time)) throw new DeliveryError('feedback-edit-version-missing');
  const updateTime = String(message.deleted === true ? (message.delete_time ?? message.update_time) : (message.update_time ?? message.create_time));
  if (!message.message_id || !Number.isFinite(timestamp(updateTime)) || (Number.isFinite(timestamp(message.create_time)) && timestamp(updateTime) < timestamp(message.create_time))) throw new DeliveryError('feedback-version-invalid');
  const state = message.deleted === true ? 'deleted' : 'present';
  return { observationKey: `${message.message_id}:${updateTime}`, replyId: message.message_id, updateTime, state,
    rootMessageId: batch.messageId, batchId: batch.batchId ?? batch.id ?? batch.date, ownerId,
    contentSha256: hash(state === 'deleted' ? 'deleted' : String(message.content ?? '')), eventKeys: [] };
}

function feedbackEvents(message, batch, ownerId) {
  if (message.deleted === true || senderKind(message.sender) !== 'user' || !senderIds(message.sender).includes(ownerId)) return [];
  if (message.message_id === batch.messageId) return [];
  if (message.root_id && message.root_id !== batch.messageId) return [];
  // All replies must either declare the root or have been fetched from its verified thread.
  if (!message.root_id && !message.__verifiedThread) return [];
  const raw = String(message.content ?? '').trim();
  const clauses = raw.split(/[，,；;。\n]+/).map((part) => part.trim()).filter(Boolean);
  const items = batchItems(batch);
  const events = [];
  for (const clause of clauses) {
    const match = clause.match(/^第\s*(10|十|[1-9一二三四五六七八九])\s*条\s*(有帮助|跳过|已回顾)[!！]?$/);
    if (!match) continue;
    const number = /^(?:10|十)$/.test(match[1]) ? 10 : /^[1-9]$/.test(match[1]) ? Number(match[1]) : '一二三四五六七八九'.indexOf(match[1]) + 1;
    const item = items.find((candidate) => candidate.number === number);
    if (!item?.noteKey) continue;
    if (message.updated === true && !message.update_time) throw new DeliveryError('feedback-edit-version-missing');
    const updated = message.update_time ?? message.create_time;
    if (!message.message_id || !Number.isFinite(timestamp(updated))) throw new DeliveryError('feedback-version-invalid');
    events.push({ eventKey: `${message.message_id}:${updated}:${number}`, batchId: batch.batchId ?? batch.id ?? batch.date, rootMessageId: batch.messageId, replyId: message.message_id, updateTime: String(updated), number, noteKey: item.noteKey, feedback: match[2], ownerId });
  }
  const byNumber = new Map();
  for (const event of events) {
    const previous = byNumber.get(event.number);
    if (previous && previous.feedback !== event.feedback) throw new DeliveryError('feedback-conflicting-clauses');
    byNumber.set(event.number, event);
  }
  return [...byNumber.values()];
}

/** Errors do not become empty feedback: the caller commits only complete collection. */
export async function collectFeedback({ batches, ownerId, profile, runCli = runLarkCli }) {
  runCli = useProfile(runCli, profile);
  assertId(ownerId, 'ou_', 'owner-id-invalid');
  if (!Array.isArray(batches)) throw new DeliveryError('feedback-batches-invalid');
  const delivered = batches.filter((batch) => ['delivered', 'completed'].includes(batch.status));
  const events = [];
  const observations = [];
  const errors = [];
  const roots = new Map();
  for (let offset = 0; offset < delivered.length; offset += 50) {
    const group = delivered.slice(offset, offset + 50);
    try {
      group.forEach((batch) => assertId(batch.messageId, 'om_', 'feedback-root-id-invalid'));
      const response = await call(runCli, ['im', '+messages-mget', '--message-ids', group.map((batch) => batch.messageId).join(','), '--no-reactions', ...BOT_ARGS]);
      for (const message of messagesOf(response)) roots.set(message.message_id, message);
    } catch (error) { errors.push({ code: error.code ?? 'feedback-root-read-failed', batchIds: group.map((batch) => batch.batchId ?? batch.id ?? batch.date) }); }
  }
  for (const batch of delivered) {
    try {
      const root = roots.get(batch.messageId);
      if (!root || root.chat_id !== batch.chatId || root.deleted !== false) throw new DeliveryError('feedback-root-invalid');
      if (root.updated === true) throw new DeliveryError('feedback-root-edited');
      const format = receiptFormat(batch);
      if (format === 'card') verifyMessage(root, { chatId: batch.chatId, messageId: batch.messageId, cardContentSha256: batch.cardContentSha256, dateMarker: `回顾日期：${batch.date}`, botSenderId: batch.botSenderId, botSenderIds: batch.botSenderIds });
      else verifyLegacyMessage(root, { chatId: batch.chatId, messageId: batch.messageId, markdownSha256: batch.markdownSha256, attachmentKey: batch.attachmentKey, dateMarker: `回顾日期：${batch.date}`, botSenderId: batch.botSenderId, botSenderIds: batch.botSenderIds });
      if (!root.thread_id) {
        if (root.thread_replies?.length || root.thread_has_more || root.thread_replies_error) throw new DeliveryError('feedback-thread-id-missing');
        continue;
      }
      const thread = await call(runCli, ['im', '+threads-messages-list', '--thread', root.thread_id, '--order', 'asc', '--page-all', '--page-limit', '1000', '--no-reactions', ...BOT_ARGS]);
      assertComplete(thread, 'feedback-thread-incomplete');
      for (const reply of messagesOf(thread)) {
        if (reply.chat_id && reply.chat_id !== batch.chatId) throw new DeliveryError('feedback-chat-mismatch');
        if (reply.thread_id && reply.thread_id !== root.thread_id) throw new DeliveryError('feedback-thread-mismatch');
        const verifiedReply = { ...reply, __verifiedThread: true };
        const observation = observeReply(verifiedReply, batch, ownerId);
        if (!observation) continue;
        const replyEvents = feedbackEvents(verifiedReply, batch, ownerId);
        observation.eventKeys = replyEvents.map(event => event.eventKey);
        observations.push(observation);
        events.push(...replyEvents);
      }
    } catch (error) { errors.push({ code: error.code ?? 'feedback-collection-failed', batchId: batch.batchId ?? batch.id ?? batch.date, messageId: batch.messageId }); }
  }
  const unique = new Map(events.map((event) => [event.eventKey, event]));
  const uniqueObservations = new Map();
  for (const observation of observations) {
    const previous = uniqueObservations.get(observation.observationKey);
    if (previous && JSON.stringify(previous) !== JSON.stringify(observation)) errors.push({ code: 'feedback-version-conflict', replyId: observation.replyId });
    uniqueObservations.set(observation.observationKey, observation);
  }
  return { events: errors.length ? [] : [...unique.values()], replyObservations: errors.length ? [] : [...uniqueObservations.values()], errors, complete: errors.length === 0, truncated: errors.some((error) => /incomplete/.test(error.code)), attemptedBatches: delivered.length };
}

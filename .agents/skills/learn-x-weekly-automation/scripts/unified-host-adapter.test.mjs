import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexHostAdapter } from './unified-confirmation.mjs';

const coreRoot = '/Users/yuwei/code/core';

function toolPage({ threadId = 'thread-a', turns }) {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, thread: { id: threadId }, page: { order: 'newest_first', limit: 2 }, turns }) }] };
}

test('Codex host adapter accepts official tool pages and merges cursor pages in order', async () => {
  const confirmationTurn = { id: 'turn-2', startedAt: 1_798_000_000, items: [{ id: 'message-2', type: 'userMessage', content: [{ type: 'text', text: '确认此卡' }] }] };
  const displayTurn = { id: 'turn-1', startedAt: 1_797_999_900, items: [{ id: 'message-1', type: 'agentMessage', text: '最终确认｜2026-W40' }] };
  const host = await createCodexHostAdapter(new Map([['thread-a', [toolPage({ turns: [confirmationTurn] }), toolPage({ turns: [displayTurn] })]]]), { coreRoot });
  const page = await host.readThread('thread-a');
  assert.deepEqual(page.turns.map(turn => turn.id), ['turn-2', 'turn-1']);
  const { readCodexEvidence } = await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/codex-session-evidence.mjs');
  const confirmation = await readCodexEvidence({ threadId: 'thread-a', itemId: 'message-2', role: 'user', page });
  const display = await readCodexEvidence({ threadId: 'thread-a', itemId: 'message-1', role: 'assistant', page });
  assert.equal(confirmation.text, '确认此卡');
  assert.equal(display.text, '最终确认｜2026-W40');
  assert.ok(confirmation.turnIndex < display.turnIndex);
});

test('Codex host adapter rejects a mismatched thread or conflicting cursor turn', async () => {
  await assert.rejects(createCodexHostAdapter({ 'thread-a': toolPage({ threadId: 'thread-b', turns: [] }) }, { coreRoot }), /thread identity mismatch/);
  const original = { id: 'turn-1', startedAt: 1_797_999_900, items: [] };
  const changed = { ...original, items: [{ id: 'other', type: 'agentMessage', text: 'changed' }] };
  await assert.rejects(createCodexHostAdapter({ 'thread-a': [toolPage({ turns: [original] }), toolPage({ turns: [changed] })] }, { coreRoot }), /cursor pages conflict/);
  await assert.rejects(createCodexHostAdapter({}), /pages required/);
});

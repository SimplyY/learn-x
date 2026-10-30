// Preparation only. The actual confirmation must be read from the trusted
// conversation host; CLI arguments or local JSON are never approval evidence.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { stageLearnXCard } from './confirmation-input.mjs';
import { verifyWeeklyMemoryApproval } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultLearnXRoot = path.resolve(here, '../../../..');
const defaultCoreRoot = path.resolve(defaultLearnXRoot, '../core');

export async function prepareUnifiedPreview({ learnXRoot = defaultLearnXRoot, coreRoot = defaultCoreRoot, week, learnX, coreCandidates = [], coreSelectedIds = [] }) {
  const { buildUnifiedCard } = await import(pathToFileURL(path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation-session.mjs')).href);
  if (!Array.isArray(coreCandidates) || !Array.isArray(coreSelectedIds) || coreCandidates.some(item => item.domain !== 'core')) throw new Error('invalid Core candidates');
  let staged = null;
  if (learnX) staged = await stageLearnXCard({ root: learnXRoot, week, ...learnX });
  const learnItems = staged?.items ?? [];
  const candidates = [...learnItems, ...(staged?.excludedItems ?? []), ...coreCandidates];
  const selectedIds = [...learnItems.map(item => item.id), ...coreSelectedIds];
  const sourceBindings = learnItems.length ? { learnxMemoryFingerprint: staged.fingerprint } : undefined;
  const unified = buildUnifiedCard({ reviewWeek: week, candidates, selectedIds, sourceBindings });
  return { unified, learnXFingerprint: staged?.fingerprint ?? null, learnXProposalHash: staged?.proposalHash ?? null, staged: staged?.staged ?? false };
}

// Invoke immediately before accepting the user's confirmation. Core target
// baselines are independently re-read through the caller's trusted adapter.
export async function validateUnifiedBaselines({ learnXRoot = defaultLearnXRoot, card, validateCore }) {
  if (!card || typeof validateCore !== 'function') return { ok: false, reason: 'missing trusted Core validator' };
  if (card.sourceBindings?.learnxMemoryFingerprint) {
    try { await verifyWeeklyMemoryApproval({ week: card.reviewWeek, fingerprint: card.sourceBindings.learnxMemoryFingerprint, repoRoot: learnXRoot }); }
    catch (error) { return { ok: false, reason: `Learn-X: ${error.message}` }; }
  }
  if (card.items.some(item => item.domain === 'core')) {
    const result = await validateCore(card);
    if (result?.ok !== true) return { ok: false, reason: 'Core source or target changed' };
  }
  return { ok: true };
}

// Host-only: readThread must call the Codex app tool, not load JSON supplied
// by the user. These functions are deliberately unavailable through the CLI.
async function codexReaders(coreRoot, host, threadId) {
  if (!host || typeof host.readThread !== 'function' || typeof host.readRollout !== 'function') throw new Error('trusted Codex host required');
  const dir = path.join(coreRoot, '.agents/skills/core-weekly/scripts/weekly-review-lib');
  const session = await import(pathToFileURL(path.join(dir, 'confirmation-session.mjs')).href);
  const { readCodexEvidence } = await import(pathToFileURL(path.join(dir, 'codex-session-evidence.mjs')).href);
  const evidence = (itemId, role) => readCodexEvidence({ threadId, itemId, role, readThread: host.readThread, readRollout: host.readRollout });
  return { session, display: id => evidence(id, 'assistant'), reply: id => evidence(id, 'user') };
}

export async function recordCodexCard({ coreRoot = defaultCoreRoot, stateRoot = coreRoot, unified, threadId, displayMessageId, host }) {
  const { session, display } = await codexReaders(coreRoot, host, threadId);
  return session.recordDisplayedCard({ root: stateRoot, unified, displayMessageId, chatId: threadId, expectedBot: 'codex-assistant', fetchDisplay: display });
}

export async function confirmCodexCard({ learnXRoot = defaultLearnXRoot, coreRoot = defaultCoreRoot, stateRoot = coreRoot, threadId, receiptFile, messageId, host, validateCore }) {
  const { session, display, reply } = await codexReaders(coreRoot, host, threadId);
  return session.confirmDisplayedCard({ root: stateRoot, receiptFile, messageId, chatId: threadId, expectedBot: 'codex-assistant', expectedSender: 'codex-user', fetchDisplay: display, fetchMessage: reply, validateBaselines: card => validateUnifiedBaselines({ learnXRoot, card, validateCore }) });
}

async function main() {
  if (process.argv.slice(2).join(' ') !== 'preview') throw new Error('only preview is available; confirmation requires trusted host');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('input too large'); }
  const params = JSON.parse(input);
  if ('coreRoot' in params || 'learnXRoot' in params) throw new Error('root override unavailable in CLI');
  const result = await prepareUnifiedPreview(params);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });

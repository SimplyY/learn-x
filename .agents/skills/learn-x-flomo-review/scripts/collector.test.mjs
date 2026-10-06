import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildEgoScanScript, runEgoScript } from '../../learn-x-input/scripts/collect-flomo-weekly.mjs';
import { isoWeekRangeShanghai } from '../../learn-x-input/scripts/collect-weread-weekly.mjs';

test('Ego subprocess receives EOF so an eval runner waiting for stdin completes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flomo-ego-stdin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'ego-browser'), '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({stdinEnded:true})));\n', { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  try {
    const { stdout } = await runEgoScript('console.log("probe")', { timeout: 2000 });
    assert.equal(JSON.parse(stdout).stdinEnded, true);
  } finally { process.env.PATH = originalPath; }
});

test('generated browser program selects real Shanghai week boundaries and excludes adjacent weeks', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flomo-browser-range-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const resultPath = path.join(dir, 'scan.json');
  const cards = [
    ['future', '2026-10-05 00:00'], ['last', '2026-10-04 23:59'],
    ['first', '2026-09-28 00:00'], ['past', '2026-09-27 23:59'],
  ].map(([memoId, timeText]) => ({ memoId, timeText, bodyText: `完整原文${memoId}`, bodyComplete: true, bodyFound: true, needsExpand: false }));
  let finished = false;
  const page = { goto: async () => {}, waitForLoadState: async () => {}, evaluate: async () => ({ cards, hasList: true, loading: false, atBottom: false, hasMore: false }) };
  const task = { ownership: 'agent', page: () => page, finish: async () => { finished = true; } };
  const script = buildEgoScanScript({ week: '2026-W40', range: isoWeekRangeShanghai('2026-W40'), taskName: 'range-test', resultPath, maxSteps: 2 });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('taskSpace', 'cliLog', script)(async () => task, () => {});
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.deepEqual(result.memos.map(n => n.memoId), ['last', 'first']);
  assert.equal(result.lowerBoundCovered, true);
  assert.equal(result.complete, true);
  assert.equal(finished, true);
});

test('browser extraction separates date badges, waits for expansion and retains live paragraph breaks', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flomo-browser-dom-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const resultPath = path.join(dir, 'scan.json');
  const original = '第一段真实原文。\n\n第二段保留段落。';
  const cards = [['target', '2026-09-29 09:00', 'AI'], ['older', '2026-09-27 09:00', '摘录']].map(([id, date, badge]) => {
    const time = { href: `https://v.flomoapp.com/mine/?memo_id=${id}`, innerText: `${date}\n${badge}`, querySelector: () => ({ innerText: date }) };
    let folded = id === 'target';
    const button = { click: () => setTimeout(() => { folded = false; }, 25) };
    const body = { innerText: original, classList: { contains: () => folded }, scrollHeight: 200, get clientHeight() { return folded ? 100 : 200; },
      cloneNode: () => ({ innerText: original.replace(/\n/g, ''), querySelectorAll: () => [] }) };
    return { innerText: original, querySelectorAll: () => [time],
      querySelector: selector => selector.startsWith('a') ? time : selector.startsWith('.richText') ? body : selector === '.showBtn' && folded ? button : null };
  });
  const prior = globalThis.document;
  t.after(() => { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; });
  globalThis.document = { querySelector: () => ({ scrollTop: 0, clientHeight: 100, scrollHeight: 200 }),
    querySelectorAll: selector => selector === 'div.memo' ? cards : [] };
  const page = { goto: async () => {}, waitForLoadState: async () => {}, evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn, arg, { timeout }) => {
      const until = Date.now() + timeout;
      while (!fn(arg)) { if (Date.now() >= until) throw Error('test-wait-timeout'); await new Promise(resolve => setTimeout(resolve, 5)); }
    } };
  const task = { ownership: 'agent', page: () => page, finish: async () => {} };
  const script = buildEgoScanScript({ week: '2026-W40', range: isoWeekRangeShanghai('2026-W40'), taskName: 'dom-test', resultPath, maxSteps: 2 });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('taskSpace', 'cliLog', script)(async () => task, () => {});
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.equal(result.complete, true);
  assert.equal(result.memos.length, 1);
  assert.equal(result.memos[0].timeText, '2026-09-29 09:00');
  assert.equal(result.memos[0].bodyText, original);
});

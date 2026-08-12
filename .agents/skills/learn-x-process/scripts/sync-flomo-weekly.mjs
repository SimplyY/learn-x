import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, loadSpecs, normalizeMemoText, reconcile } from "./flomo-sync-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const statePath = path.join(repoRoot, "04_output/_dist/flomo-sync/state.json");

export async function syncFlomoWeekly({ week, dryRun = false, only, browser } = {}) {
  if (!week) throw new Error("Use --week YYYY-Www.");
  if (only && !["weekly", "memory"].includes(only)) throw new Error("Use --only weekly|memory.");
  const input = await loadSpecs(repoRoot, week);
  const specs = only ? input.specs.filter((spec) => spec.kind === only) : input.specs;
  const skipped = only ? input.skipped.filter((item) => item.kind === only) : input.skipped;
  const state = await readState();
  const client = browser || (dryRun ? dryRunClient : createEgoClient());
  const results = [];

  for (const spec of specs) {
    const previous = state.memos[spec.key];
    const found = await client.find(spec);
    if (found.matches.length > 1) throw new Error(`${spec.key}: found multiple matching Flomo memos.`);
    if (found.legacy) throw new Error(`${spec.key}: found an unmarked legacy memo; adopt it manually before syncing.`);

    let content = spec.content;
    let remoteReadBack;
    let needsRemoteWrite = false;
    if (found.matches.length === 1) {
      const remote = await client.read(found.matches[0]);
      remoteReadBack = remote;
      const local = normalizeMemoText(spec.content);
      const remoteContent = normalizeMemoText(remote.content);
      if (!previous) {
        if (!remoteContent.includes(spec.verification)) throw new Error(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
      } else {
        const merged = reconcile({ base: previous.baseContent, local, remote: remoteContent });
        if (merged.stop) throw new Error(`${spec.key}: ${merged.stop} (${merged.magnitude ?? 0}).`);
        content = merged.content;
        needsRemoteWrite = normalizeMemoText(content) !== remoteContent;
        if (merged.writeBack && merged.writeBack !== spec.content && !dryRun) await writeFile(spec.filePath, merged.writeBack, "utf8");
      }
    }

    if (dryRun) {
      results.push({ key: spec.key, action: found.matches.length ? "would-update" : "would-create" });
      continue;
    }
    const memo = found.matches.length ? (previous && needsRemoteWrite ? await client.update(found.matches[0], content) : found.matches[0]) : await client.create(content);
    const readBack = remoteReadBack && !previous ? remoteReadBack : await client.read(memo);
    const canonicalContent = normalizeMemoText(content);
    if (!normalizeMemoText(readBack.content).includes(spec.verification)) throw new Error(`${spec.key}: Flomo readback lacks the source verification marker.`);
    state.memos[spec.key] = { memoId: memo.memoId, baseContent: canonicalContent, hash: digest(canonicalContent), syncedAt: new Date().toISOString() };
    results.push({ key: spec.key, action: found.matches.length ? (previous ? (needsRemoteWrite ? "updated" : "unchanged") : "adopted") : "created", memoId: memo.memoId });
  }
  if (!dryRun) await writeState(state);
  return { ...input, specs, skipped, results };
}

const dryRunClient = { find: async () => ({ matches: [], legacy: false }) };

function createEgoClient() {
  const taskName = `learn-x-flomo-sync-${process.pid}`;
  return {
    find: (spec) => runEgo(taskName, "find", spec),
    read: (memo) => runEgo(taskName, "read", memo),
    create: (content) => runEgo(taskName, "create", { content }),
    update: (memo, content) => runEgo(taskName, "update", { ...memo, content })
  };
}

async function runEgo(taskName, action, payload) {
  const script = `
const task = await useOrCreateTaskSpace(${JSON.stringify(taskName)});
try {
await openOrReuseTab('https://v.flomoapp.com/mine', { wait: true, timeout: 20 });
const action = ${JSON.stringify(action)};
const payload = ${JSON.stringify(payload)};
const search = async (query) => {
  await gotoAndWait('https://v.flomoapp.com/mine', { timeout: 20 });
  await fillInput('css:input[placeholder="⌘+K"]', query);
  await pressKey('ENTER');
  await wait(1);
  return await js(String.raw\`(() => [...document.querySelectorAll('div.memo')].map(card => {
    const text = card.innerText.trim();
    const href = card.querySelector('a[href*="memo_id="]')?.href;
    const memoId = new URL(href || location.href).searchParams.get('memo_id');
    return { text, memoId };
  }).filter(item => item.memoId))()\`);
};
const contentFromCard = (memoId, title) => js("(() => { const memoId = " + JSON.stringify(memoId) + "; const title = " + JSON.stringify(title) + "; const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(memoId)); const card = anchor?.closest('div.memo'); const text = card?.innerText || ''; const start = text.indexOf(title); if (start < 0) throw new Error('Flomo memo body is not fully readable.'); return text.slice(start).trim(); })()");
if (action === 'find') {
  const tagged = (await search(payload.tag)).filter(item => item.text.includes(payload.title) && item.text.includes(payload.tag));
  const titleMatches = (await search(payload.title)).filter(item => item.text.includes(payload.title));
  const taggedIds = new Set(tagged.map(item => item.memoId));
  cliLog(JSON.stringify({ matches: tagged, legacy: titleMatches.some(item => !taggedIds.has(item.memoId)) }));
} else if (action === 'read') {
  await gotoAndWait('https://v.flomoapp.com/mine/?memo_id=' + payload.memoId, { timeout: 20 });
  await wait(1);
  await js("(() => { const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(" + JSON.stringify(payload.memoId) + ")); const card = anchor?.closest('div.memo'); const expander = [...(card?.querySelectorAll('*') || [])].find(item => item.innerText?.trim() === '展开'); expander?.click(); })()");
  await wait(1);
  const title = await js("(() => { const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(" + JSON.stringify(payload.memoId) + ")); const lines = (anchor?.closest('div.memo')?.innerText || '').split(String.fromCharCode(10)); return lines.find(line => line.startsWith('Learn-X 周记｜') || line.startsWith('Learn-X 记忆｜')); })()");
  if (!title) throw new Error('Flomo memo not found for readback.');
  let content = await contentFromCard(payload.memoId, title);
  if (content.endsWith('展开')) content = content.slice(0, -2).trim();
  cliLog(JSON.stringify({ memoId: payload.memoId, content }));
} else {
  const editor = 'div.tiptap.ProseMirror';
  if (action === 'update') {
    const cards = await search(payload.memoId);
    const memo = cards.find(item => item.memoId === payload.memoId);
    if (!memo) throw new Error('Flomo memo not found for update.');
    await doubleClick('a[href*="memo_id=' + payload.memoId + '"]');
    await wait(1);
  }
  await click(editor);
  await typeText('__learn_x_probe__');
  const probeVisible = await js("document.querySelector('.tiptap.ProseMirror')?.innerText.includes('__learn_x_probe__')");
  if (!probeVisible) throw new Error('Flomo editor probe failed.');
  await js("(() => { const editor = document.querySelector('.tiptap.ProseMirror'); editor.focus(); editor.innerHTML = '<p><br></p>'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })); })()");
  await click(editor);
  await typeText(payload.content);
  const rendered = await js("document.querySelector('.tiptap.ProseMirror')?.innerText");
  const title = payload.content.split(String.fromCharCode(10))[0];
  const tag = payload.content.split(String.fromCharCode(10)).findLast(line => line.startsWith('#learn-x/'));
  if (!rendered?.startsWith(title) || !tag || !rendered.includes(tag) || rendered.length < payload.content.length * 0.9) throw new Error('Flomo editor did not retain the prepared content.');
  await click('svg.saveBtn', { label: '发布 Learn-X 同步' });
  await wait(2);
  const cards = await search(payload.content.match(/#learn-x\\/(?:weekly|memory)\\/[^\\s]+/)?.[0]);
  const memo = cards.find(item => item.text.includes(payload.content.split('\\n')[0]));
  if (!memo) throw new Error('Flomo did not expose the written memo for readback.');
  cliLog(JSON.stringify({ memoId: memo.memoId }));
}
} finally {
await completeTaskSpace(task.id, { keep: false });
}
`;
  const output = await runCommand("ego-browser", ["nodejs"], script);
  const line = `${output.stdout}\n${output.stderr}`.trim().split("\n").findLast((item) => item.trim().startsWith("{"));
  if (!line) throw new Error(`ego-browser returned no result: ${output.stderr}`);
  return JSON.parse(line);
}

function runCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`ego-browser failed (${code}): ${stderr}`)));
    child.stdin.end(input);
  });
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { version: 1, memos: {} }; throw error; }
}

async function writeState(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    if (argv[index] === "--dry-run") options.dryRun = true;
    if (argv[index] === "--only") options.only = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncFlomoWeekly(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ week: result.week, skipped: result.skipped, results: result.results }, null, 2));
}

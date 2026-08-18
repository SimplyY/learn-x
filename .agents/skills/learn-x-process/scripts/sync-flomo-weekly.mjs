import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, loadManifestSpecs, loadSpecs, normalizeMemoText, reconcile } from "./flomo-sync-core.mjs";
import { runEgoBatch } from "./flomo-sync-ego-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const statePath = path.join(repoRoot, "04_output/_dist/flomo-sync/state.json");

export async function syncFlomoWeekly({ week, manifestPath, dryRun = false, only, skipKeys = [], overwriteConflicts = false, overwriteKeys = [], browser } = {}) {
  if (!week && !manifestPath) throw new Error("Use --week YYYY-Www or --manifest path.");
  if (only && !["weekly", "monthly", "memory"].includes(only)) throw new Error("Use --only weekly|monthly|memory.");
  if (overwriteConflicts && (!manifestPath || !overwriteKeys.length)) throw new Error("Conflict overwrite requires --manifest and --overwrite-key.");
  const input = manifestPath ? await loadManifestSpecs(repoRoot, path.resolve(manifestPath)) : await loadSpecs(repoRoot, week);
  const skipSet = new Set(skipKeys);
  const selectedInput = only ? input.specs.filter((spec) => spec.kind === only) : input.specs;
  const missingOverwriteKeys = overwriteConflicts ? overwriteKeys.filter((key) => !selectedInput.some((spec) => spec.key === key)) : [];
  if (missingOverwriteKeys.length) throw new Error(`Conflict overwrite targets are not in the manifest: ${missingOverwriteKeys.join(", ")}`);
  const overwriteSet = new Set(overwriteKeys);
  const specs = selectedInput.filter((spec) => !skipSet.has(spec.key) && (!overwriteConflicts || overwriteSet.has(spec.key)));
  const skipped = [
    ...(only ? input.skipped.filter((item) => item.kind === only) : input.skipped),
    ...input.specs.filter((spec) => skipSet.has(spec.key)).map((spec) => ({ kind: spec.kind, id: spec.id, key: spec.key, reason: "batch-skipped", filePath: spec.filePath }))
  ];
  const state = await readState();
  const client = browser || (dryRun ? dryRunClient : createEgoClient());
  const results = [];
  const plans = [];
  const preflightErrors = [];
  // ponytail: reuse the deterministic editor path for every real sync; keep the legacy client only for injected tests.
  const useBatch = Boolean(!dryRun && !browser);
  const batchPreflight = useBatch
    ? new Map((await runEgoBatch("preflight", { allowLegacy: overwriteConflicts, compactResult: overwriteConflicts, specs: specs.map(({ key, title, tag }) => ({ key, title, tag })) })).completed.map((item) => [item.key, item]))
    : null;

  for (const spec of specs) {
    const previous = state.memos[spec.key];
    const preflight = batchPreflight?.get(spec.key);
    const found = preflight?.found ?? await client.find(spec);
    if (found.matches.length > 1) throw new Error(`${spec.key}: found multiple matching Flomo memos.`);
    if (found.legacy && !overwriteConflicts) throw new Error(`${spec.key}: found an unmarked legacy memo; adopt it manually before syncing.`);

    let content = spec.content;
    let remoteReadBack;
    let needsRemoteWrite = false;
    if (found.matches.length === 1) {
      const remote = preflight?.remote ?? await client.read(found.matches[0], spec.title);
      remoteReadBack = remote;
      const local = normalizeMemoText(spec.content);
      const remoteContent = typeof remote.content === "string" ? normalizeMemoText(remote.content) : null;
      if (overwriteConflicts) {
        const remoteMatches = remoteContent !== null ? local === remoteContent : digest(local) === remote.hash;
        plans.push({ spec, previous, found, content, remoteReadBack, needsRemoteWrite: !remoteMatches, overwrite: true });
        continue;
      }
      if (previous && previous.memoId !== found.matches[0].memoId) {
        preflightErrors.push(`${spec.key}: tagged Flomo memo identity differs from local sync state.`);
        continue;
      }
      if (useBatch && !previous && !remoteContent.includes(spec.verification)) {
        preflightErrors.push(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
        continue;
      }
      if (!previous) {
        if (!remoteContent.includes(spec.verification)) {
          if (useBatch) {
            preflightErrors.push(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
            continue;
          }
          throw new Error(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
        }
      } else {
        const merged = reconcile({ base: previous.baseContent, local, remote: remoteContent });
        if (merged.stop) {
          if (useBatch) {
            preflightErrors.push(`${spec.key}: ${merged.stop} (${merged.magnitude ?? 0}).`);
            continue;
          }
          throw new Error(`${spec.key}: ${merged.stop} (${merged.magnitude ?? 0}).`);
        }
        content = merged.content;
        needsRemoteWrite = normalizeMemoText(content) !== remoteContent;
        if (merged.writeBack && merged.writeBack !== spec.content && !dryRun) await writeFile(spec.filePath, merged.writeBack, "utf8");
      }
    }

    if (overwriteConflicts && found.matches.length !== 1) {
      preflightErrors.push(`${spec.key}: conflict overwrite requires exactly one existing memo.`);
      continue;
    }

    plans.push({ spec, previous, found, content, remoteReadBack, needsRemoteWrite });
  }

  if (preflightErrors.length) throw new Error(`Flomo preflight blocked:\n${preflightErrors.map((item) => `- ${item}`).join("\n")}`);

  if (overwriteConflicts && !dryRun) await writeOverwriteAudit(plans);

  if (dryRun) {
    for (const plan of plans) results.push({ key: plan.spec.key, action: plan.found.matches.length ? "would-update" : "would-create" });
  } else if (useBatch) {
    const batchPlans = plans
      .filter((plan) => plan.overwrite ? plan.needsRemoteWrite : (!plan.found.matches.length || (plan.previous && plan.needsRemoteWrite)))
      .map((plan) => ({
        key: plan.spec.key,
        action: plan.found.matches.length ? "update" : "create",
        memoId: plan.found.matches[0]?.memoId,
        title: plan.spec.title,
        content: plan.content
      }));
    const planByKey = new Map(plans.map((plan) => [plan.spec.key, plan]));
    const checkpoint = async (item, plan = planByKey.get(item.key)) => {
      if (!plan) throw new Error(`${item.key}: batch result has no local plan.`);
      const readBack = item.readBack ?? item.remote ?? item;
      const canonicalContent = normalizeMemoText(plan.content);
      const readBackContent = typeof readBack.content === "string" ? normalizeMemoText(readBack.content) : null;
      const readBackMatches = plan.overwrite
        ? (readBackContent !== null ? readBackContent === canonicalContent : readBack.hash === digest(canonicalContent))
        : readBackContent?.includes(plan.spec.verification);
      if (!readBackMatches) {
        throw new Error(`${item.key}: Flomo readback does not match the prepared local source.`);
      }
      state.memos[item.key] = { memoId: item.memoId, baseContent: canonicalContent, hash: digest(canonicalContent), syncedAt: new Date().toISOString() };
      await writeState(state);
      const action = item.action === "update" ? "updated" : item.action === "create" ? "created" : item.action;
      results.push({ key: item.key, action, memoId: item.memoId });
    };
    try {
      for (const batchPlan of batchPlans) {
        const applied = await runEgoBatch("apply", { plans: [batchPlan] });
        for (const item of applied.completed) await checkpoint(item);
      }
    } catch (error) {
      for (const item of error.completed ?? []) await checkpoint(item);
      throw error;
    }
    for (const plan of plans.filter((item) => !batchPlans.some((batchPlan) => batchPlan.key === item.spec.key))) {
      await checkpoint({
        key: plan.spec.key,
        memoId: plan.found.matches[0].memoId,
        readBack: plan.remoteReadBack,
        action: plan.found.matches.length ? (plan.overwrite ? "unchanged" : (plan.previous ? (plan.needsRemoteWrite ? "updated" : "unchanged") : "adopted")) : "created"
      }, plan);
    }
  } else {
    for (const plan of plans) {
      const { spec, previous, found, content, remoteReadBack, needsRemoteWrite } = plan;
      let memo;
      try {
        if (overwriteConflicts && !found.matches.length) throw new Error("Conflict overwrite target is missing.");
        memo = found.matches.length ? ((overwriteConflicts || previous) && needsRemoteWrite ? await client.update(found.matches[0], content, spec.title) : found.matches[0]) : await client.create(content);
      } catch (error) {
        throw new Error(`${spec.key}: ${error.message}`, { cause: error });
      }
      const readBack = remoteReadBack && !previous && !overwriteConflicts ? remoteReadBack : await client.read(memo, spec.title);
      const canonicalContent = normalizeMemoText(content);
      const readBackContent = normalizeMemoText(readBack.content);
      if (overwriteConflicts ? readBackContent !== canonicalContent : !readBackContent.includes(spec.verification)) throw new Error(`${spec.key}: Flomo readback does not match the prepared local source.`);
      state.memos[spec.key] = { memoId: memo.memoId, baseContent: canonicalContent, hash: digest(canonicalContent), syncedAt: new Date().toISOString() };
      await writeState(state);
      results.push({ key: spec.key, action: found.matches.length ? (overwriteConflicts ? (needsRemoteWrite ? "updated" : "unchanged") : (previous ? (needsRemoteWrite ? "updated" : "unchanged") : "adopted")) : "created", memoId: memo.memoId });
    }
  }
  if (!dryRun) await writeState(state);
  return { ...input, specs, skipped, results };
}

async function writeOverwriteAudit(plans) {
  const auditPath = path.join(repoRoot, "04_output/_dist/flomo-sync/overwrite-audit.json");
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "local-source-overwrite",
    items: plans.map(({ spec, previous, found, remoteReadBack, needsRemoteWrite }) => {
      const local = normalizeMemoText(spec.content);
      const remote = typeof remoteReadBack?.content === "string" ? normalizeMemoText(remoteReadBack.content) : "";
      const remoteHash = remoteReadBack?.hash ?? digest(remote);
      const remoteLength = remoteReadBack?.length ?? remote.length;
      return {
        key: spec.key,
        memoId: found.matches[0]?.memoId,
        action: needsRemoteWrite ? "update" : "unchanged",
        localHash: digest(local),
        remoteHash,
        previousHash: previous?.hash ?? null,
        localLength: local.length,
        remoteLength,
        hasVerificationMarker: remoteReadBack?.hasVerificationMarker ?? remote.includes(spec.verification)
      };
    })
  }, null, 2)}\n`, "utf8");
}

const dryRunClient = { find: async () => ({ matches: [], legacy: false }) };

function createEgoClient() {
  const taskName = `learn-x-flomo-sync-${process.pid}`;
  return {
    find: (spec) => runEgo(taskName, "find", spec),
    read: (memo, title) => runEgo(taskName, "read", { ...memo, title }),
    create: (content) => runEgo(taskName, "create", { content }),
    update: (memo, content, title) => runEgo(taskName, "update", { ...memo, content, title })
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
  await gotoAndWait('https://v.flomoapp.com/mine?source=search&query=' + encodeURIComponent(query), { timeout: 20 });
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
  const titleMatches = (await search(payload.title)).filter(item => item.text.includes(payload.title));
  const tagged = titleMatches.filter(item => item.text.includes(payload.tag));
  cliLog(JSON.stringify({ matches: tagged, legacy: titleMatches.some(item => !item.text.includes(payload.tag)) }));
} else if (action === 'read') {
  await gotoAndWait('https://v.flomoapp.com/mine?source=search&query=' + encodeURIComponent(payload.title), { timeout: 20 });
  await wait(1);
  await js("(() => { const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(" + JSON.stringify(payload.memoId) + ")); const card = anchor?.closest('div.memo'); const expander = [...(card?.querySelectorAll('*') || [])].find(item => item.innerText?.trim() === '展开'); expander?.click(); })()");
  await wait(1);
  let content = await contentFromCard(payload.memoId, payload.title);
  if (content.endsWith('展开')) content = content.slice(0, -2).trim();
  cliLog(JSON.stringify({ memoId: payload.memoId, content }));
} else {
  const editor = 'div.tiptap.ProseMirror';
  if (action === 'update') {
    const cards = await search(payload.title);
    const memo = cards.find(item => item.memoId === payload.memoId);
    if (!memo) throw new Error('Flomo memo not found for update.');
    const displayPoint = await js("(() => { const memoId = " + JSON.stringify(payload.memoId) + "; const memo = [...document.querySelectorAll('div.memo')].find(item => item.dataset.slug === memoId); const rect = memo?.querySelector('.display')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo display is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
    await doubleClick(displayPoint);
    await wait(2);
    const editorReady = await js("Boolean(document.querySelector('div.tiptap.ProseMirror'))");
    if (!editorReady) {
      const contentPoint = await js("(() => { const memoId = " + JSON.stringify(payload.memoId) + "; const memo = [...document.querySelectorAll('div.memo')].find(item => item.dataset.slug === memoId); const rect = memo?.querySelector('.mainContent')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo content is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
      await doubleClick(contentPoint);
      await wait(2);
      await doubleClick(displayPoint);
      await wait(2);
    }
  }
  await js("document.querySelector('div.tiptap.ProseMirror')?.focus()");
  await typeText('__learn_x_probe__');
  const probeVisible = await js("document.querySelector('.tiptap.ProseMirror')?.innerText.includes('__learn_x_probe__')");
  if (!probeVisible) throw new Error('Flomo editor probe failed.');
  await js("(() => { const editor = document.querySelector('div.tiptap.ProseMirror'); editor.focus(); editor.innerHTML = '<p><br></p>'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })); editor.focus(); })()");
  // ponytail: 100-character chunks avoid Ego Lite paste truncation; keep the readback gate before changing this ceiling.
  for (let index = 0; index < payload.content.length; index += 100) {
    await typeText(payload.content.slice(index, index + 100));
    await wait(1);
  }
  const rendered = await js("document.querySelector('.tiptap.ProseMirror')?.innerText");
  const title = payload.content.split(String.fromCharCode(10))[0];
  const tag = payload.content.split(String.fromCharCode(10)).findLast(line => line.startsWith('#learn-x/'));
  if (!rendered?.startsWith(title) || !tag || !rendered.includes(tag) || rendered.length < payload.content.length * 0.9) throw new Error('Flomo editor did not retain the prepared content.');
  await wait(2);
  await js("(() => { const button = [...document.querySelectorAll('svg.saveBtn')].find(item => item.getBoundingClientRect().width > 0); button?.scrollIntoView({ block: 'center', inline: 'nearest' }); })()");
  await wait(1);
  const savePoint = await js("(() => { const button = [...document.querySelectorAll('svg.saveBtn')].find(item => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }); if (!button) throw new Error('Flomo save button is not visible.'); const rect = button.getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
  await click(savePoint, { label: '发布 Learn-X 同步' });
  await wait(10);
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
    if (argv[index] === "--manifest") options.manifestPath = argv[++index];
    if (argv[index] === "--skip-key") options.skipKeys = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    if (argv[index] === "--overwrite-conflicts") options.overwriteConflicts = true;
    if (argv[index] === "--overwrite-key") options.overwriteKeys = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    if (argv[index] === "--dry-run") options.dryRun = true;
    if (argv[index] === "--only") options.only = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncFlomoWeekly(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ week: result.week, manifestPath: result.manifestPath, skipped: result.skipped, results: result.results }, null, 2));
}

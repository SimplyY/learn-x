import { spawn } from "node:child_process";

export async function runEgoBatch(action, payload) {
  if (!["preflight", "apply"].includes(action)) throw new Error(`Unsupported Ego batch action: ${action}`);
  const taskName = `learn-x-flomo-sync-batch-${process.pid}`;
const script = `
const { createHash } = await import('node:crypto');
const canonicalText = (value) => { let text = String(value ?? '').replaceAll(String.fromCharCode(13), '').trim(); const newline = String.fromCharCode(10); while (text.includes(newline.repeat(3))) text = text.replaceAll(newline.repeat(3), newline.repeat(2)); text = text.replaceAll(newline + newline + '>', newline + '>').replaceAll(newline + newline + '#learn-x/', newline + '#learn-x/'); const lines = text.split(newline); const listItem = (line) => /^\\s*(?:[-*+]|\\d+[.)])\\s+/.test(line); return lines.filter((line, index) => !(line === '' && listItem(lines[index - 1] ?? '') && listItem(lines[index + 1] ?? ''))).join(newline).trim(); };
const digestText = (value) => createHash('sha256').update(canonicalText(value)).digest('hex');
const action = ${JSON.stringify(action)};
const payload = ${JSON.stringify(payload)};
const completed = [];
let task;
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
const readMemo = async (memo, title, navigate = true) => {
  if (navigate) {
    await gotoAndWait('https://v.flomoapp.com/mine?source=search&query=' + encodeURIComponent(title), { timeout: 20 });
    await wait(1);
  }
  const displayPoint = await js("(() => { const memoId = " + JSON.stringify(memo.memoId) + "; const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(memoId)); const rect = anchor?.closest('div.memo')?.querySelector('.display')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo display is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
  await doubleClick(displayPoint);
  await wait(2);
  if (!(await js("Boolean(document.querySelector('div.tiptap.ProseMirror'))"))) {
    const contentPoint = await js("(() => { const memoId = " + JSON.stringify(memo.memoId) + "; const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(memoId)); const rect = anchor?.closest('div.memo')?.querySelector('.mainContent')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo content is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
    await doubleClick(contentPoint);
    await wait(2);
  }
  if (!(await js("Boolean(document.querySelector('div.tiptap.ProseMirror'))"))) throw new Error('Flomo memo editor is not readable.');
  const contentJson = await js("JSON.stringify(document.querySelector('div.tiptap.ProseMirror').innerText)");
  const content = JSON.parse(contentJson);
  await js("document.querySelector('button.cancel-btn')?.focus()");
  await pressKey('Enter');
  await wait(1);
  return { memoId: memo.memoId, content };
};
const findOne = async (spec, allowLegacy = false) => {
  const titleMatches = (await search(spec.title)).filter(item => item.text.includes(spec.title));
  const tagged = titleMatches.filter(item => item.text.includes(spec.tag));
  return { matches: allowLegacy ? titleMatches : tagged, legacy: titleMatches.some(item => !item.text.includes(spec.tag)) };
};
const writeMemo = async (plan) => {
  const editor = 'div.tiptap.ProseMirror';
  if (plan.action === 'update') {
    const cards = await search(plan.searchQuery || plan.title);
    const memo = cards.find(item => item.memoId === plan.memoId);
    if (!memo) throw new Error('Flomo memo not found for update.');
    const displayPoint = await js("(() => { const memoId = " + JSON.stringify(plan.memoId) + "; const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(memoId)); const rect = anchor?.closest('div.memo')?.querySelector('.display')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo display is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
    await doubleClick(displayPoint);
    await wait(2);
    const editorReady = await js("Boolean(document.querySelector('div.tiptap.ProseMirror'))");
    if (!editorReady) {
      const contentPoint = await js("(() => { const memoId = " + JSON.stringify(plan.memoId) + "; const anchor = [...document.querySelectorAll('a[href*=\\\"memo_id=\\\"]')].find(item => item.href.includes(memoId)); const rect = anchor?.closest('div.memo')?.querySelector('.mainContent')?.getBoundingClientRect(); if (!rect) throw new Error('Flomo memo content is not visible.'); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()");
      await doubleClick(contentPoint);
      await wait(2);
      await doubleClick(displayPoint);
      await wait(2);
    }
  } else {
    await gotoAndWait('https://v.flomoapp.com/mine', { timeout: 20 });
    await wait(1);
  }
  await js("document.querySelector('div.tiptap.ProseMirror')?.focus()");
  await typeText('__learn_x_probe__');
  const probeVisible = await js("document.querySelector('.tiptap.ProseMirror')?.innerText.includes('__learn_x_probe__')");
  if (!probeVisible) throw new Error('Flomo editor probe failed.');
  const contentLines = plan.content.split(String.fromCharCode(10));
  const inlineContent = contentLines.flatMap((line, index) => [...(index ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
  const contentDoc = { type: "doc", content: [{ type: "paragraph", content: inlineContent }] };
  await js("(() => { const button = [...document.querySelectorAll('svg.saveBtn')].find(item => item.getBoundingClientRect().width > 0); const editor = button?.__vue__?.$parent?.$refs?.editor_content?.editor; if (!editor?.commands?.setContent) throw new Error('Flomo editor setter is unavailable.'); editor.commands.setContent(" + JSON.stringify(contentDoc) + "); })()");
  const rendered = await js("document.querySelector('.tiptap.ProseMirror')?.innerText");
  const title = plan.content.split(String.fromCharCode(10))[0];
  const tag = plan.content.split(String.fromCharCode(10)).findLast(line => line.startsWith('#learn-x/'));
  const compact = (value) => {
    let text = String(value ?? "").replaceAll(String.fromCharCode(13), "").trim();
    const newline = String.fromCharCode(10);
    while (text.includes(newline.repeat(3))) text = text.replaceAll(newline.repeat(3), newline.repeat(2));
    text = text.replaceAll(newline + newline + ">", newline + ">").replaceAll(newline + newline + "#learn-x/", newline + "#learn-x/");
    const lines = text.split(newline);
    const listItem = (line) => /^\\s*(?:[-*+]|\\d+[.)])\\s+/.test(line);
    return lines.filter((line, index) => !(line === "" && listItem(lines[index - 1] ?? "") && listItem(lines[index + 1] ?? ""))).join(newline).trim();
  };
  if (compact(rendered) !== compact(plan.content) || !rendered.startsWith(title) || !tag || !rendered.includes(tag)) { const renderedLines = compact(rendered).split(String.fromCharCode(10)); const expectedLines = compact(plan.content).split(String.fromCharCode(10)); throw new Error("Flomo editor did not retain the prepared content (rendered=" + compact(rendered).length + ", expected=" + compact(plan.content).length + ", renderedLines=" + renderedLines.length + ", expectedLines=" + expectedLines.length + ", renderedVector=" + renderedLines.map((line) => line.length).join(",") + ", expectedVector=" + expectedLines.map((line) => line.length).join(",") + ")."); }
  await wait(2);
  await js("(() => { const button = [...document.querySelectorAll('svg.saveBtn')].find(item => item.getBoundingClientRect().width > 0); button?.scrollIntoView({ block: 'center', inline: 'nearest' }); })()");
  await wait(1);
  // ponytail: the fixed editor can place the SVG below the viewport; reuse Flomo's bound submit handler and keep readback as the safety gate.
  await js("(() => { const button = [...document.querySelectorAll('svg.saveBtn')].find(item => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }); const editor = button?.__vue__?.$parent; if (!editor?.onSubmit) throw new Error('Flomo save handler is unavailable.'); return editor.onSubmit(); })()");
  await wait(10);
  const cards = await search(tag);
  const memo = cards.find(item => item.text.includes(title));
  if (!memo) throw new Error('Flomo did not expose the written memo for readback.');
  return await readMemo(memo, title);
};
try {
  task = await useOrCreateTaskSpace(${JSON.stringify(taskName)});
  await openOrReuseTab('https://v.flomoapp.com/mine', { wait: true, timeout: 20 });
  if (action === 'preflight') {
    for (const spec of payload.specs) {
      const found = await findOne(spec, payload.allowLegacy === true);
      if (found.matches.length > 1) throw new Error(spec.key + ': found multiple matching Flomo memos.');
      if (found.legacy && payload.allowLegacy !== true) throw new Error(spec.key + ': found an unmarked legacy memo; adopt it manually before syncing.');
      const remote = found.matches.length ? await readMemo(found.matches[0], spec.title, false) : null;
      completed.push({ key: spec.key, found, remote });
    }
  } else {
    for (const plan of payload.plans) {
      const result = await writeMemo(plan);
      completed.push({ key: plan.key, action: plan.action, ...result });
    }
  }
  const outputCompleted = payload.compactResult ? completed.map((item) => { const { content, ...rest } = item; return { ...rest, found: item.found ? { legacy: item.found.legacy, matches: item.found.matches.map((match) => ({ memoId: match.memoId })) } : item.found, remote: item.remote ? { memoId: item.remote.memoId, hash: digestText(item.remote.content), length: canonicalText(item.remote.content).length } : null }; }) : completed;
  cliLog(JSON.stringify({ ok: true, completed: outputCompleted }));
} catch (error) {
  cliLog(JSON.stringify({ ok: false, completed, error: error?.stack || String(error) }));
} finally {
  if (task) await completeTaskSpace(task.id, { keep: false });
}
`;
  const output = await runCommand("ego-browser", ["nodejs"], script);
  const line = `${output.stdout}\n${output.stderr}`.trim().split("\n").findLast((item) => item.trim().startsWith("{"));
  if (!line) throw new Error(`ego-browser returned no batch result: ${output.stderr}`);
  const result = JSON.parse(line);
  if (!result.ok) {
    const error = new Error(result.error || `Ego batch ${action} failed.`);
    error.completed = result.completed ?? [];
    throw error;
  }
  return result;
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

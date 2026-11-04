import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { flomoComparableText } from "./flomo-sync-core.mjs";

const actions = new Set(["preflight", "apply", "close"]);

export function buildEgoBatchScript(action, payload, taskName) {
  if (!actions.has(action)) throw new Error(`Unsupported Ego batch action: ${action}`);
  return `
const { createHash } = await import("node:crypto");
const action = ${JSON.stringify(action)};
const payload = ${JSON.stringify(payload)};
const taskName = ${JSON.stringify(taskName)};
const canonicalText = (value) => {
  let text = String(value ?? "").replaceAll(String.fromCharCode(13), "").trim();
  const newline = String.fromCharCode(10);
  while (text.includes(newline.repeat(3))) text = text.replaceAll(newline.repeat(3), newline.repeat(2));
  text = text.replaceAll(newline + newline + ">", newline + ">").replaceAll(newline + newline + "#learn-x/", newline + "#learn-x/");
  const lines = text.split(newline);
  const listItem = (line) => /^\\s*(?:[-*+]|\\d+[.)])\\s+/.test(line);
  return lines.filter((line, index) => !(line === "" && listItem(lines[index - 1] ?? "") && listItem(lines[index + 1] ?? ""))).join(newline).trim();
};
const digestText = (value) => createHash("sha256").update(canonicalText(value)).digest("hex");
const flomoComparableText = ${flomoComparableText.toString()};
const completed = [];
let task;

const failIfLoggedOut = async (page) => {
  const state = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    passwordField: Boolean(document.querySelector('input[type="password"]')),
    loginText: /登录|验证码|sign in/i.test(document.body?.innerText ?? ""),
  }));
  if (!state.href.startsWith("https://v.flomoapp.com/") || state.passwordField || state.loginText) {
    throw new Error("Flomo is not in an authenticated user page; stop without switching browsers.");
  }
};

const navigate = async (page, url) => {
  await page.goto(url);
  await page.waitForLoadState();
  await failIfLoggedOut(page);
};

const extractCards = async (page) => page.evaluate(() =>
  [...document.querySelectorAll(".searchPage .memos div.memo")].map((card) => {
    const anchor = card.querySelector('a[href*="memo_id="]');
    const memoId = anchor ? new URL(anchor.href).searchParams.get("memo_id") : card.dataset.slug;
    return { text: card.innerText.trim(), memoId };
  }).filter((item) => item.memoId)
);

const extractFeedCards = async (page) => page.evaluate(() =>
  [...document.querySelectorAll(".memo.normal")].map((card) => {
    const anchor = card.querySelector('a[href*="memo_id="]');
    const memoId = anchor ? new URL(anchor.href).searchParams.get("memo_id") : card.dataset.slug;
    return { text: card.innerText.trim(), memoId };
  }).filter((item) => item.memoId)
);

const search = async (page, query) => {
  const url = "https://v.flomoapp.com/mine?source=search&query=" + encodeURIComponent(query);
  await navigate(page, url);
  // Search results are rendered asynchronously. Wait for the query to appear
  // in its input and for either result cards or Flomo's explicit empty state.
  await page.waitForFunction((expectedQuery) => {
    const root = document.querySelector(".searchPage .memos");
    const input = document.querySelector(".searchPage input");
    if (!root || input?.value !== expectedQuery) return false;
    return root.querySelectorAll("div.memo").length > 0 || /无搜索结果|没有结果|no results/i.test(root.innerText ?? "");
  }, query, { timeout: 12000 });
  const cards = await extractCards(page);
  if (cards.length) return cards;
  const state = await page.evaluate(() => ({
    empty: /无搜索结果|没有结果|no results/i.test(document.querySelector(".searchPage .memos")?.innerText ?? ""),
  }));
  if (state.empty) return [];
  throw new Error("Flomo search returned no cards and no verifiable empty state; stop before writing.");
};

const memoSelector = (memoId, child) => {
  const safeId = String(memoId).replace(/[^a-zA-Z0-9_-]/g, "");
  return ':is(div.memo:has(a[href*="memo_id=' + safeId + '"]), div.memo[data-slug="' + safeId + '"]) ' + child;
};

const readMemo = async (page, memo) => {
  const returnUrl = await page.url();
  const displaySelector = memoSelector(memo.memoId, ".display");
  await page.dblclick(displaySelector, { label: "open Flomo memo" });
  const editorSelector = memoSelector(memo.memoId, ".tiptap.ProseMirror");
  await page.waitForSelector(editorSelector, { state: "visible", timeout: 7000 });
  const content = await page.evaluate((selector) => document.querySelector(selector)?.innerText ?? null, editorSelector);
  if (typeof content !== "string") throw new Error("Flomo memo editor did not expose readable content.");
  // Read without editing, then return to the exact search URL. The current UI
  // has no cancel button; navigation closes this read-only editor safely.
  await navigate(page, returnUrl);
  return { memoId: memo.memoId, content };
};

const findOne = async (page, spec, allowLegacy = false) => {
  let titleMatches = (await search(page, spec.title)).filter((item) => item.text.includes(spec.title));
  // New Flomo notes appear in the main feed before its search index catches up.
  // Check that same visible feed before treating a verified empty search as absent.
  if (!titleMatches.length) {
    await navigate(page, "https://v.flomoapp.com/mine");
    titleMatches = (await extractFeedCards(page)).filter((item) => item.text.includes(spec.title));
  }
  const tagged = titleMatches.filter((item) => item.text.includes(spec.tag));
  return { matches: allowLegacy ? titleMatches : tagged, legacy: titleMatches.some((item) => !item.text.includes(spec.tag)) };
};

const writeMemo = async (page, plan) => {
  let memo;
  if (plan.action === "update") {
    const cards = await search(page, plan.searchQuery || plan.title);
    memo = cards.find((item) => item.memoId === plan.memoId);
    if (!memo) throw new Error("Flomo memo not found for update.");
    await page.dblclick(memoSelector(memo.memoId, ".display"), { label: "edit Flomo memo" });
    await page.waitForSelector("div.tiptap.ProseMirror", { state: "visible", timeout: 7000 });
  } else {
    await navigate(page, "https://v.flomoapp.com/mine");
    await page.waitForSelector("div.tiptap.ProseMirror", { state: "visible", timeout: 7000 });
  }

  const editor = "div.tiptap.ProseMirror";
  await page.click(editor, { label: "focus Flomo memo editor" });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  const cleared = await page.evaluate(() => (document.querySelector("div.tiptap.ProseMirror")?.innerText ?? "").trim().length === 0);
  if (!cleared) throw new Error("Flomo editor could not be cleared safely; stopped before paste or save.");
  await page.keyboard.paste({ text: plan.content });
  await page.waitForFunction((expectedTitle) => {
    const current = document.querySelector("div.tiptap.ProseMirror")?.innerText;
    return typeof current === "string" && current.includes(expectedTitle);
  }, plan.title, { timeout: 7000 });
  const rendered = await page.evaluate(() => {
    const editor = document.querySelector("div.tiptap.ProseMirror");
    return editor?.innerText ?? null;
  });
  const expectedComparable = flomoComparableText(plan.content);
  const actualComparable = flomoComparableText(rendered);
  if (actualComparable !== expectedComparable) {
    await page.keyboard.press("ControlOrMeta+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    throw new Error("Flomo editor content differs from the prepared memo after Markdown formatting normalization; stopped before save (expected "
      + expectedComparable.length + "/" + digestText(expectedComparable) + ", actual "
      + actualComparable.length + "/" + digestText(actualComparable) + ").");
  }

  await page.click(".editor-menu-bar .pin-right", { label: "publish Flomo memo" });
  const tag = plan.content.split(String.fromCharCode(10)).findLast((line) => line.startsWith("#learn-x/"));
  const title = plan.content.split(String.fromCharCode(10))[0];
  if (!tag || !title) throw new Error("Prepared Flomo memo is missing its title or sync tag.");
  await navigate(page, "https://v.flomoapp.com/mine");
  await page.waitForFunction((expectedTitle) => [...document.querySelectorAll(".memo.normal")].some((card) => (card.innerText ?? "").includes(expectedTitle)), title, { timeout: 15000 });
  const after = await extractFeedCards(page);
  memo = after.find((item) => item.text.includes(title) && item.text.includes(tag));
  if (!memo) throw new Error("Flomo did not expose the written memo for readback.");
  return await readMemo(page, memo);
};

try {
  task = await taskSpace(taskName);
  const taskId = task.spaceId;
  if (!taskId || task.ownership === "user" || task.ownership === "inactive") {
    throw new Error("The new Flomo TaskSpace is not Agent-owned and active.");
  }
  if (action === "close") {
    if (payload.taskId && payload.taskId !== taskId) throw new Error("Refusing to close a different Ego Lite TaskSpace.");
    const receipt = await task.finish({ keep: [] });
    console.log(JSON.stringify({ ok: true, taskId, closedTaskId: taskId, receipt, completed }));
  } else {
    const page = task.page("p1");
    if (action === "preflight") {
      await navigate(page, "https://v.flomoapp.com/mine");
      // Inspect this page once before choosing selectors or taking any action.
      await page.snapshot();
      for (const spec of payload.specs) {
        const found = await findOne(page, spec, payload.allowLegacy === true);
        if (found.matches.length > 1) throw new Error(spec.key + ": found multiple matching Flomo memos.");
        if (found.legacy && payload.allowLegacy !== true) throw new Error(spec.key + ": found an unmarked legacy memo; adopt it manually before syncing.");
        const remote = found.matches.length ? await readMemo(page, found.matches[0]) : null;
        completed.push({ key: spec.key, found, remote });
      }
    } else if (action === "apply") {
      for (const plan of payload.plans) {
        const readBack = await writeMemo(page, plan);
        completed.push({ key: plan.key, action: plan.action, ...readBack });
      }
    }
    const compact = completed.map((item) => ({
      key: item.key,
      ...(item.action ? { action: item.action } : {}),
      ...(item.found ? { found: { legacy: item.found.legacy, matches: item.found.matches.map(({ memoId }) => ({ memoId })) } } : {}),
      ...(item.remote ? { remote: { memoId: item.remote.memoId, hash: digestText(item.remote.content), length: canonicalText(item.remote.content).length, content: item.remote.content } } : {}),
      ...(item.content ? { memoId: item.memoId, readBackHash: digestText(item.content), readBackLength: canonicalText(item.content).length, readBack: { content: item.content } } : {}),
    }));
    console.log(JSON.stringify({ ok: true, taskId, taskName: task.name, ownership: task.ownership, completed: compact }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, taskId: task?.spaceId ?? null, completed, error: error?.stack || String(error) }));
}
`;
}

export async function runEgoBatch(action, payload, { taskName = `learn-x-v2-flomo-sync-${randomUUID()}` } = {}) {
  const script = buildEgoBatchScript(action, payload, taskName);
  const output = await runCommand("ego-browser", ["nodejs"], script);
  const line = `${output.stdout}\n${output.stderr}`.trim().split("\n").findLast((item) => item.trim().startsWith("{"));
  if (!line) throw new Error(`ego-browser returned no batch result: ${output.stderr}`);
  const result = JSON.parse(line);
  if (!result.ok) {
    const error = new Error(result.error || `Ego batch ${action} failed.`);
    error.completed = result.completed ?? [];
    error.taskId = result.taskId ?? null;
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

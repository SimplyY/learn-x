import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const waitFor = async (condition, description) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${description}; status=${globalThis.document?.querySelector("#learningStatus")?.textContent}; reads=${globalThis.__coreTruthTestReads ?? "n/a"}; preview=${globalThis.document?.querySelector("#chatPackPreview")?.value?.slice(-500)}`);
};

test("Chat Pack rereads Core truth, carries provenance, clears on failure, and ignores stale concurrent responses", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/#learning" });
  const coreDao = { path: "Core/道", title: "道", kind: "dao", layer: "dao", external: true, live: true, defaultStrategy: "normal" };
  const coreFa = { path: "Core/法", title: "法", kind: "fa", layer: "fa", external: true, live: true, defaultStrategy: "normal" };
  dom.window.LEARN_X_GRAPH = {
    runtime: { target: "local", canEditChatPack: true, includesPrivateContext: true, contextEnabled: true },
    appConfig: { brand: { title: "Learn-X", subtitle: "Test", mark: "LX" }, menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }] },
    chatPackConfig: {
      contextBudget: { models: [] },
      usage: { schemaVersion: 1, mergedThrough: "2026-08", subtypes: {}, enhancers: {} },
      dialogueTypes: [{ id: "question", name: "问题", subtypes: [{ id: "question.deep", name: "深入分析", includeBaseRecommendedSources: true, recommendedSources: [] }] }],
      enhancers: []
    },
    files: [], sources: [], contextFiles: [], customContextFiles: [coreDao, coreFa], domains: []
  };
  dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame")
  };
  let readMode = "normal";
  let reads = 0;
  let usagePosts = 0;
  const copiedTexts = [];
  const pending = [];
  const readResult = (revision) => ({
    path: "Core/道", title: "道", kind: "dao", layer: "dao", live: true, external: true,
    sourceUrl: "https://example.test/core-dao", documentId: "dao-id", revision,
    sha256: `hash-${revision}`, readAt: `2026-10-03T00:00:${String(revision).padStart(2, "0")}.000Z`,
    content: `# 道\n\nLIVE_CORE_BODY_${revision}`
  });
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text) => { copiedTexts.push(text); } }
  });

  try {
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      fetch: async (url, options) => {
        const target = String(url);
        if (target.includes("prompts")) return { ok: true, json: async () => ({ subtypes: { "question.deep": "Question prompt" }, enhancers: {}, assets: {} }) };
        if (target.includes("api/chatpack/usage")) { usagePosts += 1; return { ok: false, status: 503, json: async () => ({}) }; }
        if (target.includes("api/context-files")) return { ok: true, json: async () => ({ files: [{ path: "Documents/notes.md" }] }) };
        if (target.includes("content")) return { ok: true, json: async () => ({ files: [], customContextFiles: [] }) };
        if (target.includes("api/file")) {
          assert.equal(options?.cache, "no-store", "live Core requests bypass the browser cache");
          reads += 1;
          globalThis.__coreTruthTestReads = reads;
          if (readMode === "failure") return { ok: false, status: 503, json: async () => ({ error: "Core unavailable" }) };
          if (readMode === "concurrent") return new Promise((resolve) => pending.push({ revision: reads, resolve }));
          return { ok: true, json: async () => readResult(reads) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: dom.window.navigator
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: () => 0
    });

    await import("../public/app.js");
    await waitFor(() => document.querySelector("#learningStatus").textContent === "已加载 Chat Pack 类型体系。", "Chat Pack boot");
    const generate = document.querySelector("#generateChatPackBtn");

    generate.click();
    await waitFor(() => document.querySelector("#chatPackPreview").value.includes("LIVE_CORE_BODY_1"), "first live generation");
    let output = document.querySelector("#chatPackPreview").value;
    assert.match(output, /revision 1/);
    assert.match(output, /sha256 hash-1/);
    assert.match(output, /readAt 2026-10-03T00:00:01\.000Z/);

    generate.click();
    await waitFor(() => document.querySelector("#chatPackPreview").value.includes("LIVE_CORE_BODY_2"), "updated live revision");
    assert.equal(reads, 2, "the second generation performs a fresh read");
    assert.doesNotMatch(document.querySelector("#chatPackPreview").value, /LIVE_CORE_BODY_1/);

    readMode = "failure";
    generate.click();
    await waitFor(() => document.querySelector("#learningStatus").textContent.includes("上下文读取失败"), "failed live read");
    output = document.querySelector("#chatPackPreview").value;
    assert.doesNotMatch(output, /LIVE_CORE_BODY_2/);
    assert.equal(output.includes("LIVE_CORE_BODY_3"), false);

    readMode = "concurrent";
    generate.click();
    await waitFor(() => pending.length === 1, "first overlapping live read");
    generate.click();
    await waitFor(() => pending.length === 2, "second overlapping live read");
    pending[1].resolve({ ok: true, json: async () => readResult(pending[1].revision) });
    await waitFor(() => document.querySelector("#chatPackPreview").value.includes("LIVE_CORE_BODY_5"), "newer concurrent response");
    await waitFor(() => copiedTexts.length === 3, "single copy from current concurrent generation");
    const overlapUsagePosts = usagePosts;
    pending[0].resolve({ ok: true, json: async () => readResult(pending[0].revision) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    output = document.querySelector("#chatPackPreview").value;
    assert.match(output, /LIVE_CORE_BODY_5/);
    assert.doesNotMatch(output, /LIVE_CORE_BODY_4/);
    assert.equal(copiedTexts.length, 3, "the stale generation must not copy a second Chat Pack");
    assert.equal(usagePosts, overlapUsagePosts, "the stale generation must not record usage");
    assert.match(copiedTexts[2], /LIVE_CORE_BODY_5/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (key === "navigator" || key === "requestAnimationFrame") continue;
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    if (previous.navigator) Object.defineProperty(globalThis, "navigator", previous.navigator);
    else delete globalThis.navigator;
    if (previous.requestAnimationFrame) Object.defineProperty(globalThis, "requestAnimationFrame", previous.requestAnimationFrame);
    else delete globalThis.requestAnimationFrame;
  }
});

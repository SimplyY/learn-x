import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("有上下文生成后记录子类型和普通增强器，并提供复制入口", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/#learning" });
  const graph = {
    runtime: { target: "public", canEditChatPack: false, includesPrivateContext: false, contextEnabled: true },
    appConfig: { brand: { title: "Learn-X", subtitle: "Test", mark: "LX" }, menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }] },
    chatPackConfig: {
      contextBudget: { models: [] },
      usage: { schemaVersion: 1, mergedThrough: "2026-08", subtypes: { "test-type.example": 20 }, enhancers: { "munger-soul": 20 } },
      dialogueTypes: [{ id: "test-type", name: "测试", subtypes: [{ id: "test-type.example", name: "示例", recommendedSources: ["README.md"] }] }],
      enhancers: [{ id: "munger-soul", name: "芒格之魂" }, { id: "length-100", name: "100字", group: "length" }]
    },
    files: [{ path: "README.md", title: "README", content: "context", size: 7, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }],
    sources: [],
    contextFiles: [{ path: "README.md", title: "README", content: "context", size: 7, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }],
    customContextFiles: [{ path: "README.md", title: "README", content: "context", size: 7, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }],
    domains: []
  };
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, navigator: globalThis.navigator, fetch: globalThis.fetch, requestAnimationFrame: globalThis.requestAnimationFrame };
  let copied = "";
  try {
    dom.window.LEARN_X_GRAPH = graph;
    dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
    dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
    Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (value) => { copied = value; } }, configurable: true });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      requestAnimationFrame: dom.window.requestAnimationFrame,
      fetch: async (url) => {
        if (String(url).includes("prompts")) return { ok: true, json: async () => ({ subtypes: { "test-type.example": "PROTOCOL" }, enhancers: { "munger-soul": "ENHANCER" } }) };
        return { ok: true, json: async () => ({}) };
      }
    });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
    await import("../public/app.js");
    for (let attempt = 0; attempt < 100 && document.querySelector("#learningStatus").textContent !== "已加载 Chat Pack 类型体系。"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(document.querySelector(".budget-summary"), null);
    assert.equal(document.querySelector("#chatPackMetrics"), null);
    assert.equal(document.querySelector("#contextBudgetList"), null);
    assert.equal(document.querySelector("#dialogueSubtypeList button").textContent, "示例（20）");
    assert.equal(document.querySelector("#enhancerList .dialogue-subtype-btn").textContent, "芒格之魂（20）");
    document.querySelector("#enhancerList .dialogue-subtype-btn").click();
    const lengthSelect = document.querySelector('#enhancerList select[aria-label="输出字数"]');
    lengthSelect.value = "length-100";
    lengthSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && !copied.includes("# Chat Pack"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const assembledText = document.querySelector("#chatPackPreview").value;
    const summary = document.querySelector("#selectedContextSummary").textContent;
    const totalChars = Number(summary.match(/总计约 ([\d,]+) 字/)?.[1]?.replaceAll(",", ""));
    assert.equal(totalChars, assembledText.replace(/\s/g, "").length);
    const stored = JSON.parse(localStorage.getItem("learn-x:chatpack-usage"));
    assert.ok(stored);
    const month = Object.keys(stored.months)[0];
    assert.equal(stored.months[month].subtypes["test-type.example"], 1);
    assert.equal(stored.months[month].enhancers["munger-soul"], 1);
    assert.equal(stored.months[month].enhancers["length-100"], undefined);
    assert.equal(document.querySelector("#copyChatPackUsageBtn").hidden, false);
    document.querySelector("#copyChatPackUsageBtn").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(copied, /learn-x-prompt-usage/);
    const exported = JSON.parse(copied.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.deepEqual(Object.keys(exported).sort(), ["months", "schemaVersion"]);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else if (key === "navigator") Object.defineProperty(globalThis, key, { value, configurable: true });
      else globalThis[key] = value;
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("有上下文生成后只记录使用次数，不重绘选择器，并提供复制入口", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/#learning" });
  const sourceText = "认知😀 ".repeat(4000);
  const expectedSourceChars = Array.from(sourceText.replace(/\s/gu, "")).length;
  const documentsText = "外部😀 ";
  const expectedSelectedChars = expectedSourceChars + Array.from(documentsText.replace(/\s/gu, "")).length;
  const contextFiles = [
    { path: "README.md", title: "README", size: 7, visibleChars: expectedSourceChars, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" },
    ...Array.from({ length: 20 }, (_, index) => ({ path: `extra-${index}.md`, title: `Extra ${index}`, size: 1, ...(index === 0 ? { content: "😀 " } : { visibleChars: 1 }), links: [], preview: "x", previewHtml: "", defaultStrategy: "normal" }))
  ];
  const documentsFile = { path: "Documents/extra.md", title: "Extra document", size: 10, external: true, links: [], defaultStrategy: "normal" };
  const graph = {
    runtime: { target: "public", canEditChatPack: false, includesPrivateContext: false, contextEnabled: true },
    appConfig: { brand: { title: "Learn-X", subtitle: "Test", mark: "LX" }, menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }] },
    chatPackConfig: {
      contextBudget: { models: [] },
      usage: { schemaVersion: 1, mergedThrough: "2026-08", subtypes: { "test-type.example": 20 }, enhancers: { "munger-soul": 20 } },
      dialogueTypes: [{ id: "test-type", name: "测试", subtypes: [{ id: "test-type.example", name: "示例", recommendedSources: ["README.md", "Documents/extra.md"] }] }],
      enhancers: [{ id: "munger-soul", name: "芒格之魂" }, { id: "length-100", name: "100字", group: "length" }]
    },
    files: [{ path: "README.md", title: "README", content: "context", size: 7, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }],
    sources: [],
    contextFiles,
    customContextFiles: [...contextFiles, documentsFile],
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
        if (String(url).includes("content")) return { ok: true, json: async () => ({ files: { "README.md": { content: sourceText } } }) };
        if (String(url).includes("/api/file?path=Documents")) return { ok: true, json: async () => ({ content: documentsText }) };
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
    const subtypeList = document.querySelector("#dialogueSubtypeList");
    const subtypeButton = document.querySelector("#dialogueSubtypeList button");
    document.querySelector("#enhancerList .dialogue-subtype-btn").click();
    const lengthSelect = document.querySelector('#enhancerList select[aria-label="输出字数"]');
    lengthSelect.value = "length-100";
    lengthSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    for (let attempt = 0; attempt < 100 && !document.querySelector("#selectedContextSummary").textContent.includes(expectedSelectedChars.toLocaleString("zh-CN")); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const selectedSummaryBeforeGeneration = document.querySelector("#selectedContextSummary").textContent;
    assert.match(selectedSummaryBeforeGeneration, new RegExp(`总计 ${expectedSelectedChars.toLocaleString("zh-CN")} 字`));
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && !copied.includes("# Chat Pack"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const assembledText = document.querySelector("#chatPackPreview").value;
    const summary = document.querySelector("#selectedContextSummary").textContent;
    const totalChars = Number(summary.match(/总计 ([\d,]+) 字/)?.[1]?.replaceAll(",", ""));
    assert.equal(totalChars, expectedSelectedChars);
    assert.notEqual(totalChars, Array.from(assembledText.replace(/\s/gu, "")).length);
    const stored = JSON.parse(localStorage.getItem("learn-x:chatpack-usage"));
    assert.ok(stored);
    const month = Object.keys(stored.months)[0];
    assert.equal(stored.months[month].subtypes["test-type.example"], 1);
    assert.equal(stored.months[month].enhancers["munger-soul"], 1);
    assert.equal(stored.months[month].enhancers["length-100"], undefined);
    assert.equal(document.querySelector("#dialogueSubtypeList"), subtypeList);
    assert.equal(document.querySelector("#dialogueSubtypeList button"), subtypeButton);
    assert.equal(document.querySelector("#dialogueSubtypeList button").textContent, "示例（20）");
    assert.equal(document.querySelector("#copyChatPackUsageBtn").hidden, false);
    document.querySelector("#selectAllSourcesBtn").click();
    assert.match(document.querySelector("#selectedContextSummary").textContent, /建议 20 个以内/);
    assert.match(document.querySelector("#selectedContextSummary").textContent, new RegExp(`总计 ${(expectedSelectedChars + 20).toLocaleString("zh-CN")} 字`));
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

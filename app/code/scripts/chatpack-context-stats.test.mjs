import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("选中 Core 实时来源时显示已知字数与 Core 状态，编排完成后显示整体总字数", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/#learning" });
  const normalText = "认知😀 ".repeat(10);
  const expectedNormalChars = Array.from(normalText.replace(/\s/gu, "")).length;
  const coreText = "道法自然";
  const expectedCoreChars = Array.from(coreText.replace(/\s/gu, "")).length;
  const contextFiles = [
    { path: "README.md", title: "README", size: 7, visibleChars: expectedNormalChars, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }
  ];
  const graph = {
    runtime: { target: "public", canEditChatPack: false, includesPrivateContext: false, contextEnabled: true },
    appConfig: { brand: { title: "Learn-X", subtitle: "Test", mark: "LX" }, menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }] },
    chatPackConfig: {
      usage: { schemaVersion: 1, mergedThrough: "2026-08", subtypes: {}, enhancers: {} },
      dialogueTypes: [{ id: "test-type", name: "测试", subtypes: [{ id: "test-type.example", name: "示例", recommendedSources: ["README.md", "Core/道"] }] }],
      enhancers: []
    },
    files: [{ path: "README.md", title: "README", content: "context", size: 7, links: [], preview: "context", previewHtml: "", defaultStrategy: "high" }],
    sources: [],
    contextFiles,
    customContextFiles: [
      ...contextFiles,
      { path: "Core/道", title: "道", size: 0, visibleChars: null, links: [], preview: "", previewHtml: "", defaultStrategy: "high", external: true, live: true }
    ],
    domains: []
  };
  const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, navigator: globalThis.navigator, fetch: globalThis.fetch, requestAnimationFrame: globalThis.requestAnimationFrame };
  try {
    dom.window.LEARN_X_GRAPH = graph;
    dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
    dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      requestAnimationFrame: dom.window.requestAnimationFrame,
      fetch: async (url) => {
        if (String(url).includes("Core")) return { ok: true, json: async () => ({ content: coreText }) };
        if (String(url).includes("content")) return { ok: true, json: async () => ({ files: { "README.md": { content: normalText } } }) };
        return { ok: true, json: async () => ({}) };
      }
    });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
    await import("../public/app.js");
    for (let attempt = 0; attempt < 100 && document.querySelector("#learningStatus").textContent !== "已加载 Chat Pack 类型体系。"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const summary = document.querySelector("#selectedContextSummary").textContent;
    assert.match(summary, new RegExp(`已知 ${expectedNormalChars.toLocaleString("zh-CN")} 字`));
    assert.match(summary, /Core 正文在生成时实时读取/);
    assert.doesNotMatch(summary, /总计/);
    assert.match(document.querySelector("#sourceChecklist").textContent, /1 个文件 · 字数待读取/);
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (/已编排 2 个文件的上下文，总计 [\d,]+ 字。/.test(document.querySelector("#learningStatus").textContent)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const expectedTotal = (expectedNormalChars + expectedCoreChars).toLocaleString("zh-CN");
    assert.match(document.querySelector("#learningStatus").textContent, new RegExp(`已编排 2 个文件的上下文，总计 ${expectedTotal} 字。`));
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else if (key === "navigator") Object.defineProperty(globalThis, key, { value, configurable: true });
      else globalThis[key] = value;
    }
  }
});
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { renderExecutionContract, renderFinalTaskAnchor } from "../public/chatpack.js";

test("完整模式：执行契约覆盖全部已启用 Prompt 自检项", () => {
  const out = renderExecutionContract({ categoryEnabled: true, subtypeEnabled: true, enhancerEnabled: true });
  assert.match(out, /^## Execution Protocol/);
  assert.match(out, /执行规范，不是参考材料/);
  assert.match(out, /大类 Prompt 是否实际生效/);
  assert.match(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.match(out, /增强器是否实际作用/);
  assert.match(out, /是否被某个强主线压缩掉其他必要视角/);
  assert.match(out, /多视角是否只是同义重复/);
  assert.match(out, /Context 是否喧宾夺主/);
  assert.match(out, /先自动修正，再输出最终答案/);
});

test("空提示词模式：不出现大类/子类型专属自检项，保留通用项", () => {
  const out = renderExecutionContract({ categoryEnabled: false, subtypeEnabled: false, enhancerEnabled: false });
  assert.match(out, /^## Execution Protocol/);
  assert.doesNotMatch(out, /大类 Prompt 是否实际生效/);
  assert.doesNotMatch(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.doesNotMatch(out, /多视角是否只是同义重复/);
  assert.match(out, /Context 是否喧宾夺主/);
  assert.match(out, /是否存在明确要求但最终答案没有留下有效结果的部分/);
});

test("增强器模式：出现增强器自检项但不出现子类型专属项", () => {
  const out = renderExecutionContract({ categoryEnabled: false, subtypeEnabled: false, enhancerEnabled: true });
  assert.match(out, /增强器是否实际作用/);
  assert.doesNotMatch(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.match(out, /多视角是否只是同义重复/);
});

test("回归：Final Task Anchor 保持既有输出", () => {
  const out = renderFinalTaskAnchor({ finalText: "Q" }, "Current Question、Assembled Prompt");
  assert.match(out, /^## Final Task Anchor/);
  assert.match(out, /Q/);
  assert.match(out, /回答时优先遵守：Current Question、Assembled Prompt。/);
});

test("异步 Prompt 装载后刷新自动装配，切换与失败重试不丢失正文", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/#learning" });
  const graph = {
    runtime: { target: "public", canEditChatPack: false, includesPrivateContext: false, contextEnabled: false },
    appConfig: {
      brand: { title: "Learn-X", subtitle: "Test", mark: "LX" },
      menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }]
    },
    chatPackConfig: {
      contextBudget: { models: [] },
      dialogueTypes: [{
        id: "test-type",
        name: "测试",
        subtypes: [
          { id: "test-type.example", name: "示例" },
          { id: "test-type.second", name: "第二" }
        ]
      }],
      enhancers: []
    },
    files: [],
    sources: [],
    contextFiles: [],
    customContextFiles: [],
    domains: []
  };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch
  };
  let releasePromptPayload;
  let promptFetchStarted;
  let promptAttempts = 0;
  let firstPromptFailed = false;
  const promptFetchStartedPromise = new Promise((resolve) => {
    promptFetchStarted = resolve;
  });
  const promptPayloadPromise = new Promise((resolve) => {
    releasePromptPayload = resolve;
  });

  try {
    dom.window.LEARN_X_GRAPH = graph;
    dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      fetch: async (url) => {
        if (String(url).includes("prompts")) {
          promptAttempts += 1;
          promptFetchStarted();
          await promptPayloadPromise;
          if (promptAttempts === 1) {
            firstPromptFailed = true;
            return { ok: false, status: 503, json: async () => ({}) };
          }
          return { ok: true, json: async () => ({ subtypes: {
            "test-type.example": "FIRST PROTOCOL",
            "test-type.second": "SECOND PROTOCOL"
          }, enhancers: {} }) };
        }
        return { ok: true, json: async () => ({ files: {}, customContextFiles: {} }) };
      }
    });

    const app = await import("../public/app.js");
    for (let attempt = 0; attempt < 100 && document.querySelector("#learningStatus").textContent !== "已加载 Chat Pack 类型体系。"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await promptFetchStartedPromise;
    assert.doesNotMatch(document.querySelector("#metaPrompt").value, /PROTOCOL/);

    document.querySelectorAll("#dialogueSubtypeList button")[1].click();
    assert.match(document.querySelector("#metaPrompt").value, /第二/);
    releasePromptPayload();

    for (let attempt = 0; attempt < 100 && !firstPromptFailed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.ensurePromptProtocols();
    assert.match(document.querySelector("#metaPrompt").value, /SECOND PROTOCOL/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

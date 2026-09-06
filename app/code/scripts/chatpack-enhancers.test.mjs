import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("配置契约：周输出/月输出默认增强器 id 必须存在", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../../00_config/chatpack.config.json", import.meta.url), "utf8")
  );
  const enhancerIds = new Set(config.enhancers.map((enhancer) => enhancer.id));
  const subtypes = config.dialogueTypes.flatMap((type) => type.subtypes || []);
  for (const subtypeId of ["reflective-decision.weekly-output", "reflective-decision.monthly-output"]) {
    const subtype = subtypes.find((item) => item.id === subtypeId);
    assert.ok(subtype, `缺少子类型 ${subtypeId}`);
    assert.deepEqual(subtype.defaultEnhancerIds, ["language-edge", "one-step-deeper"]);
    for (const enhancerId of subtype.defaultEnhancerIds) {
      assert.ok(enhancerIds.has(enhancerId), `${subtypeId} 引用了不存在的增强器 ${enhancerId}`);
    }
  }
});

test("切换子类型时增强器重置：周输出默认勾选，其他子类型反选清空", async () => {
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
      dialogueTypes: [
        {
          id: "reflective-decision",
          name: "learn-x 相关",
          subtypes: [
            {
              id: "reflective-decision.weekly-output",
              name: "周输出",
              defaultEnhancerIds: ["language-edge", "one-step-deeper"]
            },
            { id: "reflective-decision.plain", name: "普通" }
          ]
        }
      ],
      enhancers: [
        { id: "language-edge", name: "语言锋芒" },
        { id: "one-step-deeper", name: "多思考一步" },
        { id: "munger-soul", name: "芒格之魂" }
      ]
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

  try {
    dom.window.LEARN_X_GRAPH = graph;
    dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      fetch: async () => ({ ok: true, json: async () => ({ files: {}, customContextFiles: {} }) })
    });

    await import("../public/app.js");
    for (
      let attempt = 0;
      attempt < 100 && document.querySelector("#learningStatus").textContent !== "已加载 Chat Pack 类型体系。";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const subtypeButtons = () => [...document.querySelectorAll("#dialogueSubtypeList .dialogue-subtype-btn")];
    const enhancerButtons = () => [...document.querySelectorAll("#enhancerList .dialogue-subtype-btn")];
    const activeEnhancerNames = () =>
      enhancerButtons()
        .filter((button) => button.classList.contains("active"))
        .map((button) => button.textContent.trim());
    const stored = () => JSON.parse(globalThis.localStorage.getItem("learn-x:enhancers") || "[]");
    const clickSubtype = (name) => subtypeButtons().find((button) => button.textContent.trim() === name).click();
    const clickEnhancer = (name) => enhancerButtons().find((button) => button.textContent.trim() === name).click();

    assert.deepEqual(stored(), ["language-edge", "one-step-deeper"]);
    assert.deepEqual(activeEnhancerNames(), ["语言锋芒", "多思考一步"]);

    clickSubtype("普通");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(stored(), []);
    assert.deepEqual(activeEnhancerNames(), []);

    clickEnhancer("芒格之魂");
    assert.deepEqual(stored(), ["munger-soul"]);
    clickSubtype("周输出");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(stored(), ["language-edge", "one-step-deeper"]);
    assert.deepEqual(activeEnhancerNames(), ["语言锋芒", "多思考一步"]);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

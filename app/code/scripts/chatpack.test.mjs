import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { renderExecutionContract, renderFinalTaskAnchor } from "../public/chatpack.js";
import { buildChatPackPromptPayload } from "./static-graph.mjs";

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
  const [promptPayload, weeklyRules, monthlyRules] = await Promise.all([
    buildChatPackPromptPayload({ target: "local" }),
    readFile(new URL("../../../.agents/skills/learn-x-process/resources/weekly-output-rules.md", import.meta.url), "utf8"),
    readFile(new URL("../../../.agents/skills/learn-x-process/resources/monthly-output-rules.md", import.meta.url), "utf8")
  ]);
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/#learning" });
  const graph = {
    runtime: { target: "public", canEditChatPack: false, includesPrivateContext: false, contextEnabled: false },
    appConfig: {
      brand: { title: "Learn-X", subtitle: "Test", mark: "LX" },
      menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }]
    },
    chatPackConfig: {
      contextBudget: { models: [] },
      usage: {
        schemaVersion: 1,
        mergedThrough: "2026-08",
        subtypes: {
          "test-type.example": 200,
          "test-type.second": 10,
          "reflective-decision.weekly-output": 40,
          "reflective-decision.monthly-output": 30
        },
        enhancers: { "munger-soul": 50 }
      },
      dialogueTypes: [{
        id: "test-type",
        name: "测试",
        subtypes: [
          { id: "test-type.example", name: "示例" },
          { id: "test-type.second", name: "第二" },
          {
            id: "reflective-decision.weekly-output",
            name: "周输出",
            includeBaseRecommendedSources: false,
            recommendedSources: [".agents/skills/learn-x-process/resources/weekly-output-rules.md"]
          },
          {
            id: "reflective-decision.monthly-output",
            name: "月输出",
            includeBaseRecommendedSources: false,
            recommendedSources: [".agents/skills/learn-x-process/resources/monthly-output-rules.md"]
          }
        ]
      }],
      enhancers: [{ id: "munger-soul", name: "芒格之魂" }]
    },
    files: [],
    sources: [],
    contextFiles: [],
    customContextFiles: [
      {
        path: ".agents/skills/learn-x-process/resources/weekly-output-rules.md",
        title: "Weekly Output 规则",
        content: weeklyRules
      },
      {
        path: ".agents/skills/learn-x-process/resources/monthly-output-rules.md",
        title: "Monthly Output 规则",
        content: monthlyRules
      },
      {
        path: "04_output/_dist/weekly/2026-W20/process-pack.md",
        title: "旧周 Process Pack",
        content: "OLDER_WEEK_PACK_SENTINEL"
      },
      {
        path: "04_output/_dist/weekly/2026-W21/process-pack.md",
        title: "本周 Process Pack",
        content: "# 本周 Process Pack\n\nCURRENT_WEEK_PROCESS_PACK_SENTINEL\n\n## 9. 上周 Weekly Output（仅作对照）\n\n### 上周 Weekly Output 全文\n\nPREVIOUS_WEEK_OUTPUT_COMPLETE_SENTINEL"
      },
      {
        path: "04_output/_dist/monthly/2026-08/process-pack.md",
        title: "旧月 Process Pack",
        content: "OLDER_MONTH_PACK_SENTINEL"
      },
      {
        path: "04_output/_dist/monthly/2026-09/process-pack.md",
        title: "本月 Process Pack",
        content: "# 本月 Process Pack\n\nCURRENT_MONTH_PROCESS_PACK_SENTINEL\n\n## 上月 Monthly Output 对照材料｜2026-08\n\n### 上月 Monthly Output 全文\n\nPREVIOUS_MONTH_OUTPUT_COMPLETE_SENTINEL"
      }
    ],
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
          return { ok: true, json: async () => ({
            ...promptPayload,
            subtypes: {
              ...promptPayload.subtypes,
              "test-type.example": "FIRST PROTOCOL",
              "test-type.second": "SECOND PROTOCOL"
            }
          }) };
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

    assert.equal(document.querySelectorAll("#dialogueSubtypeList button")[0].textContent, "示例（高）");
    const hiddenOption = [...document.querySelectorAll("#dialogueSubtypeList select option")]
      .map((option) => option.textContent)
      .find((text) => text.includes("第二"));
    assert.equal(hiddenOption, "第二（低）");
    assert.equal(document.querySelector("#enhancerList .dialogue-subtype-btn").textContent, "芒格之魂（中）");
    assert.doesNotMatch(document.querySelector("#dialogueSubtypeList").textContent, /（\d+）$/);

    const hiddenSelect = document.querySelector('#dialogueSubtypeList select[aria-label="其他提示词"]');
    hiddenSelect.value = "test-type.second";
    hiddenSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.match(document.querySelector("#metaPrompt").value, /第二/);
    releasePromptPayload();

    for (let attempt = 0; attempt < 100 && !firstPromptFailed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.ensurePromptProtocols();
    assert.match(document.querySelector("#metaPrompt").value, /SECOND PROTOCOL/);

    graph.runtime.contextEnabled = true;
    app.renderDialogueSubtypes();
    const weeklySubtype = [...document.querySelectorAll("#dialogueSubtypeList button")]
      .find((button) => button.textContent.includes("周输出"));
    assert.ok(weeklySubtype, "weekly subtype is selectable in Chat Pack");
    weeklySubtype.click();
    assert.equal(document.querySelector("#periodSelect").value, "2026-W21");
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && !document.querySelector("#chatPackPreview").value.includes("CURRENT_WEEK_PROCESS_PACK_SENTINEL"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const weeklyChatPack = document.querySelector("#chatPackPreview").value;
    assert.match(weeklyChatPack, /本周与上周对照/);
    assert.match(weeklyChatPack, /600 字/);
    assert.match(weeklyChatPack, /比较当前已存在的实质内容/);
    assert.match(weeklyChatPack, /Weekly Output 规则/);
    assert.match(weeklyChatPack, /Normal Context[\s\S]*CURRENT_WEEK_PROCESS_PACK_SENTINEL/);
    assert.match(weeklyChatPack, /PREVIOUS_WEEK_OUTPUT_COMPLETE_SENTINEL/);
    assert.doesNotMatch(weeklyChatPack, /OLDER_WEEK_PACK_SENTINEL/);

    const periodSubtypePicker = document.querySelector('#dialogueSubtypeList select[aria-label="其他提示词"]');
    periodSubtypePicker.value = "reflective-decision.monthly-output";
    periodSubtypePicker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#periodSelect").value, "2026-09");
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && !document.querySelector("#chatPackPreview").value.includes("CURRENT_MONTH_PROCESS_PACK_SENTINEL"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const monthlyChatPack = document.querySelector("#chatPackPreview").value;
    assert.match(monthlyChatPack, /上月与本月对照/);
    assert.match(monthlyChatPack, /1200 字/);
    assert.match(monthlyChatPack, /比较当前已存在的实质内容/);
    assert.match(monthlyChatPack, /Monthly Output 规则/);
    assert.match(monthlyChatPack, /High Priority Context[\s\S]*CURRENT_MONTH_PROCESS_PACK_SENTINEL/);
    assert.match(monthlyChatPack, /PREVIOUS_MONTH_OUTPUT_COMPLETE_SENTINEL/);
    assert.doesNotMatch(monthlyChatPack, /OLDER_MONTH_PACK_SENTINEL/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

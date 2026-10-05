import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("本地 Chat Pack 只装载周期 Prompt 的 latest 路由，不装载本地正文", async () => {
  const graph = await buildChatPackPromptPayload({ target: "local" });
  const config = JSON.parse(await readFile(new URL("../../../00_config/chatpack.config.json", import.meta.url), "utf8"));
  const subtypes = new Map(config.dialogueTypes.flatMap((type) => type.subtypes.map((subtype) => [subtype.id, subtype])));

  for (const id of [
    "reflective-decision.weekly-output",
    "reflective-decision.monthly-output",
    "reflective-decision.yearly-output"
  ]) {
    assert.equal(graph.subtypes[id], "", `${id} body is not packaged locally`);
    assert.match(graph.assets[id].prompt_id, /^chatpack\./, `${id} has a managed live route`);
    assert.equal(graph.assets[id].runtime, "feishu-latest");
    const subtype = subtypes.get(id);
    assert.ok(subtype, `${id} is enabled in config`);
    assert.equal(subtype.recommendedSources.some((source) => /(?:weekly|monthly|yearly)-output-rules\.md$/.test(source)), false);
  }
});

test("异步 Prompt 装载后刷新自动装配，切换与失败重试不丢失正文", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const promptPayload = await buildChatPackPromptPayload({ target: "local" });
  const managedAsset = (promptId, content) => ({
    contract_version: "prompt-asset/v1",
    prompt_id: promptId,
    prompt_revision: 1,
    prompt_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    prompt_fetched_at: "2026-10-04T00:00:00.000Z",
    content
  });
  promptPayload.assets = {
    ...promptPayload.assets,
    "test-type.example": managedAsset("test-type.example", "LATEST_EXAMPLE_PROMPT"),
    "test-type.second": managedAsset("test-type.second", "LATEST_SECOND_PROMPT")
  };
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
          { id: "test-type.example", name: "示例", managedPrompt: { prompt_id: "test-type.example" } },
          { id: "test-type.second", name: "第二", managedPrompt: { prompt_id: "test-type.second" } },
          {
            id: "reflective-decision.weekly-output",
            name: "周输出",
            includeBaseRecommendedSources: false,
            recommendedSources: []
          },
          {
            id: "reflective-decision.monthly-output",
            name: "月输出",
            includeBaseRecommendedSources: false,
            recommendedSources: []
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
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator")
  };
  let releasePromptPayload;
  let promptFetchStarted;
  let releaseLatestPrompt;
  let latestPromptFetchStarted;
  let releaseContextRead;
  let contextReadStarted;
  let promptAttempts = 0;
  let firstPromptFailed = false;
  let deferLatestPrompt = false;
  let latestPromptFetches = 0;
  let deferContextRead = false;
  let contextReadWasStarted = false;
  let usageWrites = 0;
  const copiedChatPacks = [];
  const promptFetchStartedPromise = new Promise((resolve) => {
    promptFetchStarted = resolve;
  });
  const promptPayloadPromise = new Promise((resolve) => {
    releasePromptPayload = resolve;
  });
  const latestPromptPayloadPromise = new Promise((resolve) => {
    releaseLatestPrompt = resolve;
  });
  const latestPromptFetchStartedPromise = new Promise((resolve) => {
    latestPromptFetchStarted = resolve;
  });
  const contextReadPromise = new Promise((resolve) => {
    releaseContextRead = resolve;
  });
  const contextReadStartedPromise = new Promise((resolve) => {
    contextReadStarted = resolve;
  });

  try {
    dom.window.LEARN_X_GRAPH = graph;
    dom.window.requestIdleCallback = (callback) => dom.window.setTimeout(callback, 0);
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => copiedChatPacks.push(text) }
    });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      requestAnimationFrame: (callback) => dom.window.setTimeout(callback, 0),
      fetch: async (url, options = {}) => {
        if (String(url).includes("api/chatpack/prompts/latest")) {
          latestPromptFetches += 1;
          if (deferLatestPrompt) {
            deferLatestPrompt = false;
            latestPromptFetchStarted();
            return latestPromptPayloadPromise;
          }
          const promptIds = JSON.parse(options.body || "{}").prompt_ids || [];
          return { ok: true, json: async () => ({
            assets: Object.fromEntries(promptIds.map((id) => {
              const existing = promptPayload.assets[id];
              return [id, existing?.content ? existing : managedAsset(id, `LIVE_${id}`)];
            }))
          }) };
        }
        if (String(url).includes("api/file?path=") && deferContextRead) {
          deferContextRead = false;
          contextReadWasStarted = true;
          contextReadStarted();
          return contextReadPromise;
        }
        if (String(url).includes("api/chatpack/usage")) {
          usageWrites += 1;
          return { ok: true, json: async () => ({ ok: true }) };
        }
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
    const { state } = await import("../public/runtime.js");
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
    assert.doesNotMatch(document.querySelector("#metaPrompt").value, /SECOND PROTOCOL/);

    // If the user changes the selected governed prompt while its latest read is pending,
    // the originally selected asset must not be copied or counted as the new selection.
    state.runtime.target = "local";
    state.runtime.contextEnabled = true;
    assert.equal(state.runtime.contextEnabled, true);
    [...document.querySelectorAll("#dialogueSubtypeList button")]
      .find((button) => button.textContent.includes("示例"))
      .click();
    deferLatestPrompt = true;
    document.querySelector("#generateChatPackBtn").click();
    await latestPromptFetchStartedPromise;
    const currentHiddenSelect = document.querySelector('#dialogueSubtypeList select[aria-label="其他提示词"]');
    currentHiddenSelect.value = "test-type.second";
    currentHiddenSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    releaseLatestPrompt({ ok: true, json: async () => ({ assets: { "test-type.example": promptPayload.assets["test-type.example"] } }) });
    for (let attempt = 0; attempt < 100 && !document.querySelector("#learningStatus").textContent.includes("Prompt 选择在读取期间发生变化"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.match(document.querySelector("#learningStatus").textContent, /Prompt 选择在读取期间发生变化/);
    assert.deepEqual(copiedChatPacks, []);
    assert.equal(usageWrites, 0, "a selection change during latest read must not write usage");

    app.renderDialogueSubtypes();
    const weeklySubtype = [...document.querySelectorAll("#dialogueSubtypeList button")]
      .find((button) => button.textContent.includes("周输出"));
    assert.ok(weeklySubtype, "weekly subtype is selectable in Chat Pack");
    weeklySubtype.click();
    assert.equal(state.runtime.contextEnabled, true, "context generation is active during the race check");
    assert.equal(document.querySelector("#periodSelect").value, "2026-W21");
    const currentWeekContext = graph.customContextFiles.find((file) => file.path === "04_output/_dist/weekly/2026-W21/process-pack.md");
    assert.ok(currentWeekContext, "weekly context fixture exists");
    const currentWeekContent = currentWeekContext.content;
    currentWeekContext.content = undefined;
    currentWeekContext.external = true;
    assert.equal(state.contextFileMap.get(currentWeekContext.path)?.content, undefined, "runtime context cache uses the delayed test file");
    deferContextRead = true;
    const contextRaceLatestFetchCount = latestPromptFetches;
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && !contextReadWasStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(contextReadWasStarted, true, `context read was not started: ${document.querySelector("#learningStatus").textContent}`);
    await contextReadStartedPromise;
    assert.ok(latestPromptFetches > contextRaceLatestFetchCount, "generation reads latest before waiting on context");
    const contextRacePicker = document.querySelector('#dialogueSubtypeList select[aria-label="其他提示词"]');
    contextRacePicker.value = "reflective-decision.monthly-output";
    contextRacePicker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    releaseContextRead({ ok: true, json: async () => ({ content: currentWeekContent }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(copiedChatPacks, [], "a selection change during context read must not copy output");
    assert.equal(usageWrites, 0, "a selection change during context read must not write usage");

    weeklySubtype.click();
    currentWeekContext.content = currentWeekContent;
    currentWeekContext.external = false;
    const weeklyCopyCount = copiedChatPacks.length;
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && copiedChatPacks.length === weeklyCopyCount; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const weeklyChatPack = copiedChatPacks.at(-1);
    assert.ok(weeklyChatPack, "weekly generation is copied only after the latest prompt is read");
    assert.match(weeklyChatPack, /LIVE_chatpack\.weekly-output/);
    assert.match(weeklyChatPack, /Normal Context[\s\S]*CURRENT_WEEK_PROCESS_PACK_SENTINEL/);
    assert.match(weeklyChatPack, /PREVIOUS_WEEK_OUTPUT_COMPLETE_SENTINEL/);
    assert.doesNotMatch(weeklyChatPack, /OLDER_WEEK_PACK_SENTINEL/);

    const periodSubtypePicker = document.querySelector('#dialogueSubtypeList select[aria-label="其他提示词"]');
    periodSubtypePicker.value = "reflective-decision.monthly-output";
    periodSubtypePicker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(document.querySelector("#periodSelect").value, "2026-09");
    const monthlyCopyCount = copiedChatPacks.length;
    document.querySelector("#generateChatPackBtn").click();
    for (let attempt = 0; attempt < 100 && copiedChatPacks.length === monthlyCopyCount; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const monthlyChatPack = copiedChatPacks.at(-1);
    assert.ok(monthlyChatPack, "monthly generation is copied only after the latest prompt is read");
    assert.match(monthlyChatPack, /LIVE_chatpack\.monthly-output/);
    assert.match(monthlyChatPack, /High Priority Context[\s\S]*CURRENT_MONTH_PROCESS_PACK_SENTINEL/);
    assert.match(monthlyChatPack, /PREVIOUS_MONTH_OUTPUT_COMPLETE_SENTINEL/);
    assert.doesNotMatch(monthlyChatPack, /OLDER_MONTH_PACK_SENTINEL/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (key === "navigator") {
        if (value) Object.defineProperty(globalThis, "navigator", value);
        else delete globalThis.navigator;
      } else if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

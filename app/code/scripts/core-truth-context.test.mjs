import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const waitFor = async (condition, description) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${description}; status=${globalThis.document?.querySelector("#chatPackOperationStatus")?.textContent}; preview=${globalThis.document?.querySelector("#chatPackPreview")?.value?.slice(-500)}`);
};

test("local Chat Pack uses complete Core cache, preserves the last result on failure, and cancels stale generation", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:4173/#learning" });
  const coreDao = { path: "Core/道", title: "道", kind: "dao", layer: "dao", external: true, live: true, defaultStrategy: "normal" };
  dom.window.LEARN_X_GRAPH = {
    runtime: { target: "local", canEditChatPack: true, includesPrivateContext: true, contextEnabled: true },
    appConfig: { brand: { title: "Learn-X", subtitle: "Test", mark: "LX" }, menu: [{ id: "learning", label: "学", module: "learning", title: "学习" }] },
    chatPackConfig: {
      contextBudget: { models: [] },
      usage: { schemaVersion: 1, mergedThrough: "2026-08", subtypes: {}, enhancers: {} },
      dialogueTypes: [{ id: "question", name: "问题", subtypes: [{ id: "question.deep", name: "深入分析", includeBaseRecommendedSources: false, recommendedSources: ["Core/道"] }] }],
      enhancers: []
    },
    files: [], sources: [], contextFiles: [], customContextFiles: [coreDao], domains: []
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
  let cacheRevision = 1;
  let cacheReadMode = "normal";
  let cacheRefreshMode = "normal";
  let raceReadCount = 0;
  let cacheStatusMode = "normal";
  let cacheRefreshState = "recovering";
  let cacheRefreshes = 0;
  let cacheReads = 0;
  let cacheStatusRequests = 0;
  let manualRefreshRequests = 0;
  let cacheStatusPollCallback = null;
  let directCoreReads = 0;
  let usagePosts = 0;
  let clipboardShouldFail = false;
  let deferClipboardWrite = false;
  let clipboardWriteStartedResolver;
  let cacheServiceUnavailable = false;
  let expireGenerationDeadline = false;
  let expireCacheStatusDeadline = false;
  let expireManualRefreshDeadline = false;
  let latestGenerationDeadline;
  let releaseClipboardWrite;
  let rejectClipboardWrite;
  const armClipboardWriteStarted = () => new Promise((resolve) => { clipboardWriteStartedResolver = resolve; });
  let deferredReadStarted;
  const deferredReadStartedPromise = new Promise((resolve) => { deferredReadStarted = resolve; });
  const copiedTexts = [];
  const nativeWindowSetTimeout = dom.window.setTimeout.bind(dom.window);
  const nativeWindowSetInterval = dom.window.setInterval.bind(dom.window);
  dom.window.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 90_000) latestGenerationDeadline = callback;
    if (milliseconds === 8_000 && expireCacheStatusDeadline) {
      return nativeWindowSetTimeout(callback, 0, ...args);
    }
    if (milliseconds === 10_000 && expireManualRefreshDeadline) {
      return nativeWindowSetTimeout(callback, 0, ...args);
    }
    return nativeWindowSetTimeout(callback, expireGenerationDeadline && milliseconds === 90_000 ? 0 : milliseconds, ...args);
  };
  dom.window.setInterval = (callback, milliseconds, ...args) => {
    if (milliseconds === 5_000) {
      cacheStatusPollCallback = callback;
      return 0;
    }
    return nativeWindowSetInterval(callback, milliseconds, ...args);
  };
  const coreAsset = (revision) => {
    const content = `# 道\n\nCACHED_CORE_BODY_${revision}`;
    return {
      kind: "dao", sourceUrl: "https://example.test/core-dao", documentId: "dao-id", revision,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      readAt: `2026-10-20T00:00:0${revision}.000Z`, cache_age_ms: revision * 1_000, content
    };
  };
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text) => {
      if (clipboardShouldFail) throw new Error("clipboard permission denied");
      if (deferClipboardWrite) {
        clipboardWriteStartedResolver?.();
        clipboardWriteStartedResolver = null;
        await new Promise((resolve, reject) => {
          releaseClipboardWrite = resolve;
          rejectClipboardWrite = reject;
        });
      }
      copiedTexts.push(text);
    } }
  });

  try {
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      requestAnimationFrame: (callback) => dom.window.setTimeout(callback, 0),
      fetch: async (url, options = {}) => {
        const target = String(url);
        if (cacheServiceUnavailable && target.includes("api/chatpack/cache/")) throw new TypeError("Failed to fetch");
        if (target.includes("prompts")) return { ok: true, json: async () => ({ subtypes: { "question.deep": "Question prompt" }, enhancers: {}, assets: {} }) };
        if (target.includes("api/chatpack/cache/status")) {
          cacheStatusRequests += 1;
          if (cacheStatusMode === "hang") {
            if (options.signal?.aborted) throw new Error("request aborted");
            return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true }));
          }
          if (cacheStatusMode === "json-hang") {
            return { ok: true, json: async () => new Promise((_resolve, reject) => {
              if (options.signal?.aborted) reject(new Error("request aborted"));
              else options.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
            }) };
          }
          const failedRequiredRead = ["failure", "required-failure-running"].includes(cacheReadMode);
          const refreshedDuringRead = ["race", "race-stuck"].includes(cacheReadMode);
          return { ok: true, json: async () => ({
            summary: { total: 16, available: 16, unavailable: 0 },
            resources: [{
              key: "core:dao", kind: "core", id: "dao",
              cache_status: failedRequiredRead ? "expired" : cacheReadMode === "missing" ? "not_fetched" : "available",
              refresh_status: failedRequiredRead ? "failed" : refreshedDuringRead ? "succeeded" : "queued",
              refresh_error: failedRequiredRead ? "permission denied" : "",
              revision: cacheRevision, fetched_at: "2026-10-20T00:00:00.000Z", age_ms: cacheRevision * 1_000
            }],
            refresh: {
              state: cacheReadMode === "failure" ? "failed" : refreshedDuringRead ? "succeeded" : cacheRefreshState,
              completed: refreshedDuringRead ? 16 : 8, total: 16, failed: cacheReadMode === "failure" ? 1 : 0,
              retry_at: cacheRefreshState === "recovering" ? new Date(Date.now() + 5_000).toISOString() : null
            }
          }) };
        }
        if (target.includes("api/chatpack/cache/refresh")) {
          if (options.method === "POST") manualRefreshRequests += 1;
          cacheRefreshes += 1;
          const request = JSON.parse(options.body || "{}");
          if (request.core_kinds) assert.deepEqual(request.core_kinds, ["dao"]);
          else assert.equal(options.method, "POST", "only a manual refresh may request the full cache without priority resources");
          if (cacheRefreshMode === "hang") {
            if (options.signal?.aborted) throw new Error("request aborted");
            return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true }));
          }
          if (cacheRefreshMode === "unavailable") return { ok: false, status: 503, json: async () => ({ error: "refresh lock unavailable" }) };
          return { ok: true, status: 202, json: async () => ({ accepted: true, state: "running" }) };
        }
        if (target.includes("api/chatpack/cache/read")) {
          cacheReads += 1;
          if (cacheReadMode === "race-stuck") return { ok: false, status: 409, json: async () => ({
            error: "必需缓存尚不可用", missing: [{ key: "core:dao", cache_status: "not_fetched", refresh_status: "queued", refresh_error: "" }]
          }) };
          if (cacheReadMode === "race" && raceReadCount++ === 0) return { ok: false, status: 409, json: async () => ({
            error: "必需缓存尚不可用", missing: [{ key: "core:dao", cache_status: "not_fetched", refresh_status: "queued", refresh_error: "" }]
          }) };
          if (cacheReadMode === "invalid-json") return { ok: true, status: 200, json: async () => { throw new SyntaxError("invalid JSON"); } };
          if (cacheReadMode === "missing") return { ok: false, status: 409, json: async () => ({
            error: "必需缓存尚不可用", missing: [{ key: "core:dao", cache_status: "not_fetched", refresh_status: "queued", refresh_error: "" }]
          }) };
          if (cacheReadMode === "defer") {
            deferredReadStarted();
            if (options.signal?.aborted) throw new Error("request aborted");
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
            });
          }
          if (["failure", "required-failure-running"].includes(cacheReadMode)) return { ok: false, status: 409, json: async () => ({
            error: "必需缓存尚不可用", missing: [{ key: "core:dao", cache_status: "expired", refresh_status: "failed", refresh_error: "permission denied" }]
          }) };
          const request = JSON.parse(options.body || "{}");
          assert.deepEqual(request.prompt_ids, []);
          return { ok: true, json: async () => ({ source: "learn-x-chatpack-cache", prompts: {}, cores: { dao: coreAsset(cacheRevision) } }) };
        }
        if (target.includes("api/chatpack/usage")) {
          if (options.method === "POST") usagePosts += 1;
          return { ok: true, json: async () => ({ ok: true, usage: { schemaVersion: 1, months: {} } }) };
        }
        if (target.includes("api/context-files")) return { ok: true, json: async () => ({ files: [] }) };
        if (target.includes("api/file")) {
          directCoreReads += 1;
          return { ok: false, status: 503, json: async () => ({ error: "Core API should not be used for Chat Pack generation" }) };
        }
        if (target.includes("content")) return { ok: true, json: async () => ({ files: [], customContextFiles: [] }) };
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: dom.window.navigator });
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, writable: true, value: () => 0 });

    await import("../public/app.js");
    await waitFor(() => document.querySelector("#learningStatus").textContent === "已加载 Chat Pack 类型体系。", "Chat Pack boot");
    await waitFor(() => document.querySelector("#chatPackCacheRefreshStatus").textContent.includes("正在确认刷新锁"), "cache lock recovery state is distinct from active refresh");
    const generate = document.querySelector("#generateChatPackBtn");

    generate.click();
    await waitFor(() => copiedTexts.length === 1, "first cached Core generation");
    assert.match(copiedTexts[0], /CACHED_CORE_BODY_1/);
    assert.match(copiedTexts[0], /revision 1/);
    assert.match(copiedTexts[0], /sha256 [a-f0-9]{64}/);
    assert.match(copiedTexts[0], /readAt 2026-10-20T00:00:01\.000Z/);
    assert.equal(directCoreReads, 0, "Chat Pack uses Core from the cache route");

    cacheRevision = 2;
    clipboardShouldFail = true;
    generate.click();
    await waitFor(() => !document.querySelector("#retryCopyChatPackBtn").hidden, "copy retry after clipboard refusal");
    assert.equal(copiedTexts.length, 1);
    assert.match(document.querySelector("#chatPackOperationStatus").textContent, /未确认写入/);
    assert.match(document.querySelector("#chatPackPreview").value, /CACHED_CORE_BODY_2/);
    assert.equal(directCoreReads, 0);
    assert.equal(cacheRefreshes, 2, "each generation asks for a background full refresh");

    clipboardShouldFail = false;
    document.querySelector("#retryCopyChatPackBtn").click();
    await waitFor(() => copiedTexts.length === 2, "clipboard retry");
    await waitFor(() => document.querySelector("#retryCopyChatPackBtn").hidden, "hide copy retry after success");
    assert.match(copiedTexts[1], /CACHED_CORE_BODY_2/);
    assert.doesNotMatch(copiedTexts[1], /CACHED_CORE_BODY_1/);
    assert.equal(document.querySelector("#retryCopyChatPackBtn").hidden, true);

    cacheReadMode = "failure";
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("permission denied"), "required Core refresh error");
    assert.equal(copiedTexts.length, 2, "expired required cache is never copied");
    assert.match(document.querySelector("#chatPackPreview").value, /CACHED_CORE_BODY_2/, "the last generated result stays visible after a failure");

    cacheReadMode = "required-failure-running";
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("permission denied"), "required cache failure while unrelated refresh remains active");
    assert.equal(generate.disabled, false, "required-resource failure ends generation while full refresh continues");
    assert.equal(copiedTexts.length, 2, "a failed required resource is never copied during unrelated refresh work");

    cacheReadMode = "defer";
    generate.click();
    assert.equal(generate.disabled, true, "button enters busy state synchronously on click");
    assert.match(generate.textContent, /准备|等待/);
    await deferredReadStartedPromise;
    document.querySelector("#currentQuestion").value = "changed during cache wait";
    document.querySelector("#currentQuestion").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("已取消"), "generation cancellation after selection change");
    assert.equal(copiedTexts.length, 2, "cancelled old generation never writes to clipboard");
    assert.equal(usagePosts, 2, "cancelled old generation does not record usage");
    assert.equal(cacheReads >= 4, true);

    cacheReadMode = "normal";
    deferClipboardWrite = true;
    const delayedWriteStarted = armClipboardWriteStarted();
    generate.click();
    const operationControlIds = new Set(["generateChatPackBtn", "refreshChatPackCacheBtn", "retryCopyChatPackBtn", "reloadChatPackAfterClipboardHangBtn"]);
    const selectionControls = [...document.querySelectorAll("#learningWorkspace button, #learningWorkspace input, #learningWorkspace select, #learningWorkspace textarea")]
      .filter((control) => !operationControlIds.has(control.id));
    const originalSelectionDisabled = selectionControls.map((control) => control.disabled);
    await delayedWriteStarted;
    assert.equal(document.querySelector("#currentQuestion").disabled, true, "generation inputs are locked during the async clipboard commit");
    assert.equal(document.querySelector("#metaPrompt").disabled, true, "the assembled Prompt cannot change during the async clipboard commit");
    assert.ok(selectionControls.includes(document.querySelector("#currentQuestion")) && selectionControls.includes(document.querySelector("#metaPrompt")));
    assert.ok(selectionControls.every((control) => control.disabled), "all rendered selection controls are locked during the async clipboard commit");
    assert.match(document.querySelector("#chatPackOperationStatus").textContent, /复制中/);
    releaseClipboardWrite();
    await waitFor(() => copiedTexts.length === 3, "delayed clipboard commit");
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("已复制"), "delayed clipboard confirmation");
    assert.equal(document.querySelector("#currentQuestion").disabled, false, "generation inputs are restored after clipboard completion");
    assert.deepEqual(selectionControls.map((control) => control.disabled), originalSelectionDisabled, "selection controls return to their prior disabled states");

    const neverSettlingWriteStarted = armClipboardWriteStarted();
    latestGenerationDeadline = null;
    generate.click();
    await neverSettlingWriteStarted;
    assert.equal(typeof latestGenerationDeadline, "function", "generation deadline is available for the in-flight copy");
    latestGenerationDeadline();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("复制状态未知"), "hung clipboard write exposes an unknown state and recovery");
    assert.equal(document.querySelector("#reloadChatPackAfterClipboardHangBtn").hidden, false, "hung clipboard write exposes page reload recovery");
    assert.equal(generate.disabled, true, "new generation stays blocked while the browser clipboard write is unresolved");
    assert.equal(document.querySelector("#currentQuestion").disabled, true, "selection stays locked while clipboard outcome is unknown");
    releaseClipboardWrite();
    await waitFor(() => document.querySelector("#reloadChatPackAfterClipboardHangBtn").hidden, "late clipboard completion clears the recovery state");
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("超时后写入剪贴板"), "late clipboard success is reported truthfully");
    assert.equal(generate.disabled, false, "late clipboard completion restores generation");
    assert.equal(document.querySelector("#currentQuestion").disabled, false, "late clipboard completion restores selection controls");
    assert.equal(copiedTexts.length, 4, "the original delayed write is not duplicated");
    deferClipboardWrite = false;

    const cacheReadsBeforeClipboardRetry = cacheReads;
    deferClipboardWrite = true;
    const rejectedWriteStarted = armClipboardWriteStarted();
    latestGenerationDeadline = null;
    generate.click();
    await rejectedWriteStarted;
    latestGenerationDeadline();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("复制状态未知"), "second hung clipboard write exposes unknown state");
    assert.equal(cacheReads, cacheReadsBeforeClipboardRetry + 1, "one generation reads cache before starting its copy");
    assert.equal(generate.disabled, true, "a second generation cannot overlap the unresolved clipboard write");
    deferClipboardWrite = false;
    rejectClipboardWrite(new Error("clipboard write rejected after timeout"));
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("剪贴板写入失败"), "late clipboard rejection is reported truthfully");
    await waitFor(() => !document.querySelector("#retryCopyChatPackBtn").hidden, "late clipboard rejection restores the copy retry");
    assert.equal(generate.disabled, false, "late clipboard rejection restores generation");
    assert.equal(document.querySelector("#currentQuestion").disabled, false, "late clipboard rejection restores selection controls");
    deferClipboardWrite = true;
    const hangingRetryStarted = armClipboardWriteStarted();
    latestGenerationDeadline = null;
    document.querySelector("#retryCopyChatPackBtn").click();
    await hangingRetryStarted;
    assert.equal(typeof latestGenerationDeadline, "function", "copy retry has its own bounded deadline");
    latestGenerationDeadline();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("复制状态未知"), "hung clipboard retry exposes unknown state and recovery");
    assert.equal(document.querySelector("#reloadChatPackAfterClipboardHangBtn").hidden, false, "hung copy retry exposes page reload recovery");
    assert.equal(generate.disabled, true, "generation stays blocked while the copy retry is unresolved");
    deferClipboardWrite = false;
    releaseClipboardWrite();
    await waitFor(() => copiedTexts.length === 5, "retry succeeds after late clipboard rejection");
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("重试在超时后写入剪贴板"), "late copy-retry success is reported truthfully");
    await waitFor(() => document.querySelector("#retryCopyChatPackBtn").hidden, "successful retry clears late rejection state");
    assert.equal(document.querySelector("#reloadChatPackAfterClipboardHangBtn").hidden, true);
    assert.equal(generate.disabled, false, "late copy-retry completion restores generation");

    cacheReadMode = "invalid-json";
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("无效 JSON"), "invalid cache response JSON");
    assert.equal(generate.disabled, false, "invalid JSON stops generation and restores the button");
    assert.equal(copiedTexts.length, 5, "invalid cache JSON is never copied");

    cacheReadMode = "defer";
    expireGenerationDeadline = true;
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("超过 90 秒"), "bounded generation timeout");
    assert.equal(generate.disabled, false, "generation timeout restores the button");
    assert.equal(copiedTexts.length, 5, "timed-out generation is never copied");
    expireGenerationDeadline = false;
    cacheReadMode = "normal";

    cacheReadMode = "missing";
    await new Promise((resolve) => setTimeout(resolve, 20));
    cacheStatusMode = "hang";
    expireGenerationDeadline = true;
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("超过 90 秒"), "hung cache status request obeys generation deadline");
    assert.equal(generate.disabled, false, "hung cache status request still restores the button");
    assert.equal(copiedTexts.length, 5, "hung status lookup never permits a partial or stale copy");
    expireGenerationDeadline = false;
    cacheReadMode = "normal";
    cacheStatusMode = "normal";

    cacheServiceUnavailable = true;
    generate.click();
    await waitFor(() => !generate.disabled && document.querySelector("#chatPackOperationStatus").textContent.includes("Failed to fetch"), "cache service disconnect");
    await waitFor(() => document.querySelector("#chatPackCacheSummary").textContent.includes("缓存服务不可用"), "cache status endpoint disconnect");
    assert.equal(copiedTexts.length, 5, "disconnected cache service is never treated as an empty cache or copied");

    cacheServiceUnavailable = false;
    cacheReadMode = "race";
    raceReadCount = 0;
    const readsBeforeRefreshRace = cacheReads;
    generate.click();
    await waitFor(() => copiedTexts.length === 6, "generation retries cache read after the required resource becomes available");
    assert.equal(cacheReads, readsBeforeRefreshRace + 2, "a fresh cache read follows a stale 409 after refresh completion");
    assert.match(copiedTexts[5], /CACHED_CORE_BODY_2/);
    assert.match(document.querySelector("#chatPackOperationStatus").textContent, /已复制/);

    cacheReadMode = "race-stuck";
    const readsBeforePersistentMismatch = cacheReads;
    generate.click();
    await waitFor(() => document.querySelector("#chatPackOperationStatus").textContent.includes("完整缓存读取仍缺失"), "inconsistent available status fails after one retry");
    assert.equal(cacheReads, readsBeforePersistentMismatch + 2, "an inconsistent available status cannot cause an unbounded read loop");
    assert.equal(copiedTexts.length, 6, "a persistent cache/status mismatch never copies a partial result");
    assert.equal(generate.disabled, false, "a bounded cache/status mismatch restores the generate button");

    cacheReadMode = "normal";
    cacheRefreshMode = "unavailable";
    cacheRefreshState = "failed";
    const readsBeforeRefreshFailure = cacheReads;
    generate.click();
    await waitFor(() => copiedTexts.length === 7, "valid required cache still generates when background refresh returns 503");
    assert.equal(cacheReads, readsBeforeRefreshFailure + 1, "the complete cache is checked after background refresh failure");
    assert.match(document.querySelector("#chatPackOperationStatus").textContent, /已复制/);
    assert.match(document.querySelector("#chatPackCacheRefreshStatus").textContent, /更新失败/);
    assert.equal(generate.disabled, false, "background refresh failure does not leave the button busy");

    cacheStatusMode = "hang";
    expireCacheStatusDeadline = true;
    const statusReadsBeforePolling = cacheStatusRequests;
    cacheStatusPollCallback();
    cacheStatusPollCallback();
    await Promise.resolve();
    assert.equal(cacheStatusRequests, statusReadsBeforePolling + 1, "cache status polling coalesces while a request is pending");
    await waitFor(() => document.querySelector("#chatPackCacheSummary").textContent.includes("缓存服务不可用"), "idle cache status polling timeout");
    assert.match(document.querySelector("#chatPackCacheSummary").textContent, /超过 8 秒/);
    expireCacheStatusDeadline = false;
    cacheStatusMode = "normal";

    cacheStatusMode = "json-hang";
    expireCacheStatusDeadline = true;
    document.querySelector("#chatPackCacheSummary").textContent = "缓存状态待测试";
    const statusReadsBeforeJsonHang = cacheStatusRequests;
    cacheStatusPollCallback();
    await Promise.resolve();
    assert.equal(cacheStatusRequests, statusReadsBeforeJsonHang + 1, "a cache status response body is requested once");
    await waitFor(() => document.querySelector("#chatPackCacheSummary").textContent.includes("缓存服务不可用"), "hung cache status JSON body timeout");
    assert.match(document.querySelector("#chatPackCacheSummary").textContent, /超过 8 秒/);
    expireCacheStatusDeadline = false;
    cacheStatusMode = "normal";

    cacheRefreshMode = "hang";
    expireManualRefreshDeadline = true;
    const manualRefreshButton = document.querySelector("#refreshChatPackCacheBtn");
    const manualRefreshesBefore = manualRefreshRequests;
    manualRefreshButton.click();
    await waitFor(() => !manualRefreshButton.disabled, "manual refresh request timeout restores its button");
    assert.equal(manualRefreshRequests, manualRefreshesBefore + 1, "manual refresh is requested once");
    assert.match(document.querySelector("#chatPackCacheRefreshStatus").textContent, /手动刷新失败：.*超过 10 秒/);
    expireManualRefreshDeadline = false;
    cacheRefreshMode = "normal";
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

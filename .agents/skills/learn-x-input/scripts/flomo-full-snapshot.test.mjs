import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { buildEgoFullScanScript, collectFlomoFullSnapshot } from "./collect-flomo-weekly.mjs";
import {
  createOnlineFlomoSnapshot,
  flomoBodyHash,
  normalizeFlomoBody,
  readVerifiedStagedOnlineFlomoSnapshot,
  renderOnlineFlomoCard,
  renderOnlineFlomoPreview,
  validateFullFlomoScan,
  writeStagedOnlineFlomoSnapshot,
} from "./lib/flomo-full-snapshot.mjs";

const sourceRecord = (memoId, bodyText, overrides = {}) => ({
  memoId,
  url: `https://v.flomoapp.com/mine/?memo_id=${encodeURIComponent(memoId)}`,
  timeText: "2026-10-05 08:30",
  createdAt: "2026-10-05T00:30:00.000Z",
  bodyText,
  bodyComplete: true,
  isPinned: false,
  ...overrides,
});

function fullScan(records, overrides = {}) {
  return {
    mode: "full",
    complete: true,
    libraryCount: records.length,
    scanned: records.length,
    pageCount: 2,
    scanStartedAt: "2026-10-05T00:00:00.000Z",
    scanFinishedAt: "2026-10-05T00:01:00.000Z",
    records,
    termination: {
      reason: "library-count-and-stable-ids",
      enumerationComplete: true,
      expectedCount: records.length,
      observedUniqueIds: records.length,
      missingCount: 0,
      stableScrollPasses: 2,
      atBottom: true,
      hasMore: false,
      loading: false,
    },
    detailVerification: records[0] ? {
      verified: true,
      memoId: records[0].memoId,
      bodyLength: normalizeFlomoBody(records[0].bodyText).length,
      bodyHash: flomoBodyHash(records[0].bodyText),
      method: "original-link-detail-sheet-tiptap-prosemirror",
    } : null,
    ...overrides,
  };
}

test("validates full-scan termination, identities, body text, and detail evidence", () => {
  const duplicateText = fullScan([
    sourceRecord("memo-a", "同一正文"),
    sourceRecord("memo-b", "同一正文", { createdAt: "2026-10-05T00:31:00.000Z" }),
  ]);
  const validated = validateFullFlomoScan(duplicateText);
  assert.equal(validated.records.length, 2, "same text with distinct IDs stays distinct");
  assert.equal(validated.records[0].bodyHash, validated.records[1].bodyHash);

  const acceptedGap = fullScan([
    sourceRecord("memo-a", "正文 A"),
    sourceRecord("memo-b", "正文 B", { createdAt: "2026-10-05T00:31:00.000Z" }),
  ], {
    libraryCount: 3,
    termination: {
      reason: "stable-bottom-with-accepted-count-gap",
      enumerationComplete: true,
      expectedCount: 3,
      observedUniqueIds: 2,
      missingCount: 1,
      stableScrollPasses: 2,
      atBottom: true,
      hasMore: false,
      loading: false,
    },
  });
  assert.deepEqual(validateFullFlomoScan(acceptedGap).coverage, {
    status: "accepted-with-gaps", expectedCount: 3, observedCount: 2, omittedCount: 1,
    ratio: 2 / 3, policy: "up-to-ten-unresolved-records-v1",
  });
  const tenMissing = fullScan([sourceRecord("memo-a", "正文")], {
    libraryCount: 11,
    termination: { reason: "stable-bottom-with-accepted-count-gap", enumerationComplete: true,
      expectedCount: 11, observedUniqueIds: 1, missingCount: 10, stableScrollPasses: 2,
      atBottom: true, hasMore: false, loading: false },
  });
  assert.equal(validateFullFlomoScan(tenMissing).coverage.omittedCount, 10);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    libraryCount: 12,
    termination: { reason: "stable-bottom-with-accepted-count-gap", enumerationComplete: true,
      expectedCount: 12, observedUniqueIds: 1, missingCount: 11, stableScrollPasses: 2,
      atBottom: true, hasMore: false, loading: false },
  })), /termination-unproven/);

  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    termination: { ...fullScan([]).termination, stableScrollPasses: 1 },
  })), /termination-unproven/);
  for (const stableScrollPasses of [undefined, "2"]) {
    const scan = fullScan([sourceRecord("memo-a", "正文")]);
    if (stableScrollPasses === undefined) delete scan.termination.stableScrollPasses;
    else scan.termination.stableScrollPasses = stableScrollPasses;
    assert.throws(() => validateFullFlomoScan(scan), /termination-unproven/);
  }
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    detailVerification: null,
  })), /detail-verification-missing/);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    detailVerification: { verified: true, memoId: "memo-other", bodyLength: -7, bodyHash: "wrong", method: "fake" },
  })), /detail-verification-invalid/);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    detailVerification: { ...fullScan([sourceRecord("memo-a", "正文")]).detailVerification, bodyHash: "wrong" },
  })), /detail-verification-invalid/);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文")], {
    detailVerification: { ...fullScan([sourceRecord("memo-a", "正文")]).detailVerification, method: "original-link-full-body-equality" },
  })), /detail-verification-invalid/);
  assert.throws(() => validateFullFlomoScan(fullScan([
    sourceRecord("memo-a", "正文"), sourceRecord("memo-a", "冲突正文"),
  ])), /identity-invalid/);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "  \n ")])), /body-incomplete/);
  assert.throws(() => validateFullFlomoScan(fullScan([sourceRecord("memo-a", "正文", { url: "https://example.com" })])), /link-invalid/);
});

test("creates a private staged snapshot and a Card 2.0 preview bound to the same record", async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-full-stage-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const longBody = "长文原文：这是经 TipTap 核验的线上正文。".repeat(20);
  const records = [
    sourceRecord("memo-short", "较短的普通笔记正文。"),
    sourceRecord("memo-long", longBody, { isPinned: true }),
  ];
  const scan = fullScan(records, { detailVerification: {
    verified: true,
    memoId: "memo-long",
    bodyLength: normalizeFlomoBody(longBody).length,
    bodyHash: flomoBodyHash(longBody),
    method: "original-link-detail-sheet-tiptap-prosemirror",
  } });
  const result = await writeStagedOnlineFlomoSnapshot(repoRoot, scan);
  const stageDirectory = path.dirname(result.snapshotPath);
  assert.equal((await lstat(stageDirectory)).mode & 0o777, 0o700);
  const snapshot = JSON.parse(await readFile(result.snapshotPath, "utf8"));
  const card = JSON.parse(await readFile(result.cardPath, "utf8"));
  const preview = await readFile(result.previewPath, "utf8");

  const verifiedRecord = snapshot.records.find((record) => record.memoId === "memo-long");
  assert.equal(verifiedRecord.body, longBody);
  assert.equal(verifiedRecord.bodyHash, flomoBodyHash(longBody));
  assert.equal(snapshot.totalCount, 2);
  assert.deepEqual(snapshot.coverage, {
    status: "complete", expectedCount: 2, observedCount: 2, omittedCount: 0,
    ratio: 1, policy: "up-to-ten-unresolved-records-v1",
  });
  assert.equal(card.schema, "2.0");
  assert.match(card.header.subtitle.content, /漏项 0 条/);
  assert.match(card.header.subtitle.content, /100\.00%/);
  assert.match(card.header.subtitle.content, /策略 up-to-ten-unresolved-records-v1/);
  assert.match(card.header.subtitle.content, /^笔记快照：2026-10-05.*覆盖 2\/2/);
  assert.match(card.body.elements[1].content, /https:\/\/v\.flomoapp\.com\/mine\/\?memo_id=memo-long/);
  assert.doesNotMatch(card.body.elements[1].content, /memo-short/);
  assert.match(card.body.elements[0].content, /长文原文：这是经 TipTap 核验的线上正文/);
  assert.match(preview, /https:\/\/v\.flomoapp\.com\/mine\/\?memo_id=memo-long/);
  assert.match(preview, /在 Flomo 打开/);
  assert.match(preview, /不发送/);
});

test("the full-snapshot entry point validates once and stages its browser result", async (t) => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-full-entry-"));
  t.after(() => rm(storageRoot, { recursive: true, force: true }));
  const record = sourceRecord("memo-entry", "经过浏览器采集的完整正文。");
  const result = await collectFlomoFullSnapshot({ storageRoot, scan: async () => fullScan([record]) });
  const staged = await readVerifiedStagedOnlineFlomoSnapshot(result.snapshotPath);
  assert.equal(result.totalCount, 1);
  assert.equal(staged.snapshot.records[0].memoId, record.memoId);
  assert.equal(staged.snapshot.records[0].body, record.bodyText);
  assert.equal(staged.snapshot.detailVerification.bodyHash, flomoBodyHash(record.bodyText));
});

test("refuses to stage memo bodies in a group- or world-readable directory", async (t) => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-full-insecure-"));
  t.after(() => rm(storageRoot, { recursive: true, force: true }));
  await chmod(storageRoot, 0o755);
  await assert.rejects(
    writeStagedOnlineFlomoSnapshot(storageRoot, fullScan([sourceRecord("memo-a", "私人正文")]), { storageRoot }),
    /storage-directory-not-private/,
  );
});

test("surfaces an accepted omission and coverage ratio in snapshot and preview", () => {
  const records = [sourceRecord("memo-a", "正文 A"), sourceRecord("memo-b", "正文 B")];
  const scan = fullScan(records, {
    libraryCount: 3,
    termination: {
      reason: "stable-bottom-with-accepted-count-gap", enumerationComplete: true,
      expectedCount: 3, observedUniqueIds: 2, missingCount: 1,
      stableScrollPasses: 2, atBottom: true, hasMore: false, loading: false,
    },
  });
  const snapshot = createOnlineFlomoSnapshot(scan);
  const card = renderOnlineFlomoCard(snapshot, snapshot.records[0]);
  const preview = renderOnlineFlomoPreview(snapshot, card, snapshot.records[0]);
  assert.equal(snapshot.coverage.status, "accepted-with-gaps");
  assert.equal(snapshot.coverage.omittedCount, 1);
  assert.match(card.header.subtitle.content, /漏项 1 条/);
  assert.match(card.header.subtitle.content, /66\.67%/);
  assert.match(card.header.subtitle.content, /策略 up-to-ten-unresolved-records-v1/);
  assert.match(card.header.subtitle.content, /覆盖 2\/3/);
  assert.match(preview, /覆盖率 66\.67%，漏项约 1 条/);
  assert.match(preview, /稳定到底并在策略上限内接受 1 条未枚举缺口（2\/3）/);
  assert.doesNotMatch(preview, /UI 笔记总数与稳定 ID 集一致/);
});

function makeBrowserHarness({ initialRecords, nextRecords = [], libraryCount, detailRecord, detailEditorText, detailEditorInnerText, listEditorText, detailSheetHasLink = true, detailPageUrl, detailCardUsesMemoClass = true, detailSheetHasRelatedDuplicateLink = false, truncateVisibleBodyAt, editorUnavailable = false, cancelUnavailable = false, foldFirst = false, foldNext = false, gotoError, initialPageState, initialTailLoader = false, offscreenLongestLink = false, relativeTimeLinkHrefs = false, taskSpaceName }) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://v.flomoapp.com/mine" });
  const { document, window } = dom.window;
  Object.defineProperty(dom.window.Element.prototype, "innerText", {
    configurable: true,
    get() {
      const text = this.textContent || "";
      return truncateVisibleBodyAt && this.classList?.contains("richText")
        ? [...text].slice(0, truncateVisibleBodyAt).join("")
        : text;
    },
    set(value) { this.textContent = value; },
  });
  Object.defineProperty(dom.window.Element.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentElement || document.body; },
  });
  dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};

  let records = initialRecords;
  let scanPhase = "list";
  let list;
  let loadPending = false;
  let loadStarted = false;
  let loadPolls = 0;
  let delayedLayoutPolls = 0;
  let delayedBody;
  let finished = 0;
  let gotoCount = 0;
  let semanticClickCalls = 0;
  let lastSemanticClickHref = null;
  let targetLinkScrolled = false;
  let doubleClickCalls = 0;
  let editorOpenedInDetailSheet = false;
  let mode = "success";

  const recordMarkup = (record, index, { folded = false } = {}) => {
    const card = document.createElement("div");
    card.className = "memo";
    const parsedUrl = new URL(record.url);
    const timeLinkHref = relativeTimeLinkHrefs ? `${parsedUrl.pathname}${parsedUrl.search}` : record.url;
    card.innerHTML = `<a class="time" href="${timeLinkHref}"><span class="text">${record.timeText}</span></a><div class="display"><div class="mainContent"><div class="content copy-allowed richText${folded ? " is-fold" : ""}">${record.bodyMarkup ?? record.bodyText}</div></div></div>${folded ? '<button class="showBtn">展开</button>' : ""}`;
    const timeLink = card.querySelector("a.time");
    timeLink?.addEventListener("click", (event) => {
      event.preventDefault();
      if (detailRecord?.memoId !== record.memoId || document.querySelector(".memo-detail-sheet")) return;
      scanPhase = "detail";
      window.history.pushState({}, "", detailPageUrl || detailRecord.url);
      const sheet = document.createElement("div");
      sheet.className = "memo-detail-sheet";
      sheet.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 400, width: 400, height: 100 });
      const detailCard = document.createElement("div");
      detailCard.className = detailCardUsesMemoClass ? "memo normal" : "normal";
      const detailLink = detailSheetHasLink ? `<a class="time" href="${detailRecord.url}">${detailRecord.timeText}</a>` : "";
      detailCard.innerHTML = `${detailLink}<div class="display"><div class="mainContent"><div class="content copy-allowed richText">${detailRecord.bodyMarkup ?? detailRecord.bodyText}</div></div></div>`;
      const detailBody = detailCard.querySelector(".richText");
      detailBody.getBoundingClientRect = () => ({ top: 150, bottom: 230, left: 0, right: 400, width: 400, height: 80 });
      sheet.append(detailCard);
      if (detailSheetHasRelatedDuplicateLink) {
        const relatedCard = document.createElement("div");
        relatedCard.className = "memo-card normal";
        relatedCard.innerHTML = `<a class="inner_memo_link" href="${detailRecord.url}">关联笔记</a><div class="display"><div class="content richText">相关笔记摘要</div></div>`;
        sheet.append(relatedCard);
      }
      document.body.append(sheet);
    });
    if (timeLink) {
      timeLink.getBoundingClientRect = () => {
        const offscreen = offscreenLongestLink && record.memoId === detailRecord?.memoId && !targetLinkScrolled;
        return { top: offscreen ? -65_920 : 70, bottom: offscreen ? -65_900 : 90, left: 250, right: 350, width: 100, height: 20 };
      };
      timeLink.scrollIntoView = () => {
        if (offscreenLongestLink && record.memoId === detailRecord?.memoId) targetLinkScrolled = true;
      };
    }
    card.getBoundingClientRect = () => ({ top: index * 100, bottom: index * 100 + 80, left: 0, right: 400, width: 400, height: 80 });
    for (const target of card.querySelectorAll(".display, .mainContent")) {
      target.getBoundingClientRect = () => ({ top: 0, bottom: 80, left: 0, right: 400, width: 400, height: 80 });
    }
    const body = card.querySelector(".richText");
    body.getBoundingClientRect = () => ({ top: 10, bottom: 90, left: 0, right: 400, width: 400, height: 80 });
    body._scrollHeight = Math.max(80, record.bodyText.length);
    body._clientHeight = folded ? 50 : body._scrollHeight;
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, get() { return this._scrollHeight; } },
      clientHeight: { configurable: true, get() { return this._clientHeight; } },
    });
    const button = card.querySelector(".showBtn");
    if (button) button.addEventListener("click", () => {
      body.classList.remove("is-fold");
      button.remove();
      body._clientHeight = Math.min(body._scrollHeight, 100);
      if (body._clientHeight < body._scrollHeight) {
        delayedLayoutPolls = 2;
        delayedBody = body;
      }
    });
    return card;
  };

  const render = (items, { count = libraryCount, isDetail = false } = {}) => {
    document.body.replaceChildren();
    const heading = document.createElement("div");
    heading.innerHTML = `<strong>${count}</strong><span class="type typography-foot-note">笔记</span>`;
    Object.defineProperty(heading, "innerText", { configurable: true, get() { return `${count}\n笔记`; } });
    document.body.append(heading);
    list = document.createElement("div");
    list.className = "memos";
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get() { return Math.max(100, items.length * 100 + (initialTailLoader && !isDetail && !loadStarted ? 54 : 0)); } },
    });
    list.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 400, width: 400, height: 100 });
    items.forEach((record, index) => list.append(recordMarkup(record, index, { folded: !isDetail && (foldFirst && index === 0 || foldNext && index >= initialRecords.length) })));
    if (!isDetail && initialTailLoader && !loadStarted) {
      const loading = document.createElement("div");
      loading.className = "loading normal";
      loading.innerText = "loading";
      list.append(loading);
    }
    document.body.append(list);
    if (items.length === 0 && count === 0) {
      const empty = document.createElement("p");
      empty.innerText = "暂无笔记";
      document.body.append(empty);
    }
    if (!isDetail && nextRecords.length && !loadStarted) {
      list.addEventListener("scroll", () => {
        if (loadStarted || mode !== "success") return;
        loadStarted = true;
        loadPending = true;
        loadPolls = 2;
        const loading = document.createElement("div");
        loading.className = "loading";
        loading.setAttribute("aria-busy", "true");
        loading.innerText = "Loading";
        if (!initialTailLoader) document.body.append(loading);
      });
    }
  };

  render(initialRecords);
  const advance = () => {
    if (delayedLayoutPolls > 0 && delayedBody) {
      delayedLayoutPolls -= 1;
      if (delayedLayoutPolls === 0) delayedBody._clientHeight = delayedBody._scrollHeight;
    }
    if (loadPending) {
      loadPolls -= 1;
      if (loadPolls <= 0) {
        loadPending = false;
        records = [...records, ...nextRecords];
        render(records);
      }
    }
  };
  const fakePage = {
    async goto(url) {
      gotoCount += 1;
      if (!url.includes("memo_id=") && gotoError) throw new Error(gotoError);
      if (url.includes("memo_id=")) {
        const id = new URL(url).searchParams.get("memo_id");
        scanPhase = "detail";
        render(detailRecord ? [detailRecord] : [], { count: detailRecord ? 1 : 0, isDetail: true });
        return;
      }
      if (initialPageState === "blank") {
        document.body.replaceChildren();
        return;
      }
      scanPhase = "list";
      render(initialRecords);
    },
    async waitForLoadState() {},
    async evaluate(fn, argument) {
      return fn(argument);
    },
    async click(selector) {
      semanticClickCalls += 1;
      const nth = selector.match(/^(.*) >> nth=(-?\d+)$/);
      const matches = [...document.querySelectorAll(nth?.[1] || selector)];
      const index = nth ? Number(nth[2]) < 0 ? matches.length + Number(nth[2]) : Number(nth[2]) : 0;
      if (!matches.length || (!nth && matches.length !== 1) || index < 0 || index >= matches.length) {
        throw new Error("selector did not resolve to exactly one element");
      }
      const link = matches[index];
      const rect = link.getBoundingClientRect();
      if (!rect || rect.top < 0 || rect.bottom > window.innerHeight) throw new Error("selector target is outside the viewport");
      lastSemanticClickHref = link.href;
      link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    },
    mouse: {
      async click(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || y < 0 || y > 100) throw new Error("click point is outside the visible page");
        const card = [...document.querySelectorAll("div.memo")].find((item) => {
          try { return new URL(item.querySelector("a.time").href).searchParams.get("memo_id") === detailRecord?.memoId; } catch { return false; }
        });
        const link = card?.querySelector("a.time");
        const rect = link?.getBoundingClientRect();
        if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        }
      },
    },
    async waitForFunction(fn, argument, options = {}) {
      const attempts = options.timeout === 5000 ? 3 : 8;
      for (let index = 0; index < attempts; index += 1) {
        if (fn(argument)) return true;
        advance();
      }
      throw new Error(`Timeout ${options.timeout || 30000} ms exceeded`);
    },
    async waitForTimeout() { advance(); },
  };

  return {
    document,
    window,
    page: fakePage,
    taskSpace: async () => ({
      ownership: "agent",
      spaceId: 98,
      name: taskSpaceName || "learn-x-full-snapshot-test",
      page: () => fakePage,
      finish: async () => { finished += 1; },
    }),
    get finished() { return finished; },
    get gotoCount() { return gotoCount; },
    get semanticClickCalls() { return semanticClickCalls; },
    get lastSemanticClickHref() { return lastSemanticClickHref; },
    get doubleClickCalls() { return doubleClickCalls; },
    get editorOpenedInDetailSheet() { return editorOpenedInDetailSheet; },
    async doubleClick(point) {
      doubleClickCalls += 1;
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new Error("missing double-click target");
      const card = [...document.querySelectorAll("div.memo, .memo-detail-sheet .normal")].find((item) => {
        let memoId;
        try {
          const link = item.querySelector("a.time");
          if (link) memoId = new URL(link.href).searchParams.get("memo_id");
        } catch {}
        const rect = item.querySelector(".richText")?.getBoundingClientRect();
        const primaryDetailRoot = Boolean(item.closest(".memo-detail-sheet") && item.matches("div.normal:not(.memo-card)") &&
          document.querySelectorAll(".memo-detail-sheet div.normal:not(.memo-card)").length === 1);
        const identityMatches = memoId === detailRecord?.memoId || primaryDetailRoot || Boolean(item.closest(".memo-detail-sheet") && new URL(window.location.href).searchParams.get("memo_id") === detailRecord?.memoId);
        return identityMatches && rect && point[0] >= rect.left && point[0] <= rect.right && point[1] >= rect.top && point[1] <= rect.bottom;
      });
      const body = card?.querySelector(".richText");
      if (!card || !body || scanPhase !== "detail" || editorUnavailable) return;
      editorOpenedInDetailSheet = Boolean(card.closest(".memo-detail-sheet"));
      const editor = document.createElement("div");
      editor.className = "tiptap ProseMirror";
      editor.contentEditable = "true";
      editor.textContent = editorOpenedInDetailSheet
        ? detailEditorText ?? detailRecord?.bodyText ?? ""
        : listEditorText ?? detailEditorText ?? detailRecord?.bodyText ?? "";
      if (editorOpenedInDetailSheet && detailEditorInnerText !== undefined) {
        Object.defineProperty(editor, "innerText", { configurable: true, get() { return detailEditorInnerText; } });
      }
      body.replaceWith(editor);
      if (!cancelUnavailable) {
        const cancel = document.createElement("button");
        cancel.className = "cancel-btn";
        cancel.textContent = "取消";
        cancel.addEventListener("click", () => {
          editor.replaceWith(body);
          cancel.remove();
        });
        card.append(cancel);
      }
    },
    get editorActive() { return Boolean(document.querySelector("div.tiptap.ProseMirror")); },
    setMode(value) { mode = value; },
    close() { dom.window.close(); },
  };
}

async function runBrowserScan(t, config) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-browser-scan-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const harness = makeBrowserHarness(config);
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalEvent = globalThis.Event;
  const originalLocation = globalThis.location;
  const originalNode = globalThis.Node;
  const originalDoubleClick = globalThis.doubleClick;
  globalThis.document = harness.document;
  globalThis.window = harness.window;
  globalThis.Event = harness.window.Event;
  globalThis.location = harness.window.location;
  globalThis.Node = harness.window.Node;
  globalThis.doubleClick = harness.doubleClick;
  const script = buildEgoFullScanScript({
    taskName: "learn-x-full-snapshot-test",
    taskSpaceId: 98,
    taskSpaceName: "learn-x-full-snapshot-test",
    resultPath: path.join(temp, "result.json"),
    maxSteps: 20,
    keepTaskSpace: false,
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try {
    await new AsyncFunction("taskSpace", "cliLog", "doubleClick", script)(harness.taskSpace, () => {}, harness.doubleClick);
    const result = JSON.parse(await readFile(path.join(temp, "result.json"), "utf8"));
    return { result, harness };
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalEvent === undefined) delete globalThis.Event;
    else globalThis.Event = originalEvent;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
    if (originalDoubleClick === undefined) delete globalThis.doubleClick;
    else globalThis.doubleClick = originalDoubleClick;
    harness.close();
  }
}

test("full browser scan opens the longest note through its original time link and verifies its identity", async (t) => {
  const pinned = sourceRecord("memo-a", "同一正文", { timeText: "置顶・2026-10-05 08:30", isPinned: true });
  const ordinary = sourceRecord("memo-a", "同一正文");
  const second = sourceRecord("memo-b", "很长正文".repeat(40), { createdAt: "2026-10-05T00:31:00.000Z" });
  const third = sourceRecord("memo-c", "同一正文", { createdAt: "2026-10-05T00:32:00.000Z" });
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [pinned, ordinary],
    nextRecords: [second, third],
    libraryCount: 3,
    detailRecord: second,
    foldFirst: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scanned, 3);
  assert.equal(harness.semanticClickCalls, 1, "longest-note detail uses an exact semantic link selector");
  assert.equal(harness.lastSemanticClickHref, second.url);
  assert.equal(harness.gotoCount, 1, "longest-note verification should use the in-list detail pane without full navigation");
  assert.equal(result.records.find((item) => item.memoId === "memo-a").isPinned, true);
  assert.equal(result.records.find((item) => item.memoId === "memo-b").bodyText, second.bodyText);
  assert.equal(result.detailVerification.verified, true);
  assert.equal(result.detailVerification.method, "original-link-detail-sheet-tiptap-prosemirror");
  assert.equal(harness.doubleClickCalls, 1, "the full editor is opened through the browser's real double-click helper");
  assert.doesNotThrow(() => validateFullFlomoScan(result));
  assert.equal(harness.finished, 1);
});

test("full browser scan preserves exact DOM tags separately when their body text is concatenated", async (t) => {
  const bodyText = "#自我认知/ai洞察启发性反思：后续正文";
  const memo = sourceRecord("memo-tag-boundary", bodyText, {
    bodyMarkup: '<span class="tag">#自我认知/ai洞察</span>启发性反思：后续正文',
  });
  const { result } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.records[0].bodyText, bodyText);
  assert.deepEqual(result.records[0].tags, ["自我认知/ai洞察"]);
  assert.doesNotThrow(() => validateFullFlomoScan(result));
});

test("full browser scan restores inline link URLs and ignores editor-only layout whitespace", async (t) => {
  const opening = `链接前的完整正文。${"内容段落。".repeat(30)}`;
  const url = "https://example.com/source-note";
  const bodyText = `${opening}<a href="${url}">网页标题</a>链接后的完整正文。`;
  const sourceText = `${opening}${url}链接后的完整正文。`;
  const memo = sourceRecord("memo-inline-link", bodyText);
  const editorLayoutText = `${opening.slice(0, 20)}\n\n${opening.slice(20)}${url}\n链接后的完整正文。`;
  const { result } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: sourceText,
    detailEditorInnerText: editorLayoutText,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.records[0].bodyText, sourceText);
  assert.equal(result.detailVerification.bodyHash, flomoBodyHash(sourceText));
  assert.doesNotMatch(result.records[0].bodyText, /网页标题/);
  assert.doesNotMatch(JSON.stringify(result), /bodySourceText/);
  assert.doesNotThrow(() => validateFullFlomoScan(result));
});

test("full browser scan scrolls the nested memo list to an offscreen exact-ID link before clicking", async (t) => {
  const memo = sourceRecord("memo-offscreen", "列表深处的最长笔记");
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    offscreenLongestLink: true,
    relativeTimeLinkHrefs: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.semanticClickCalls, 1);
  assert.equal(harness.lastSemanticClickHref, memo.url);
  assert.equal(result.detailVerification.memoId, memo.memoId);
});

test("full browser scan rejects list and detail cards that both hide the same long-note tail", async (t) => {
  const body = `Visible opening.${"Hidden tail content. ".repeat(20)}`;
  const memo = sourceRecord("memo-long", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    truncateVisibleBodyAt: 24,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "detail-body-mismatch");
  assert.equal(result.stage, "cancel-longest-editor");
  assert.equal(harness.editorActive, false, "read-only editor is canceled before failure is reported");
  assert.equal(harness.finished, 0, "failed owned space remains available for recovery");
});

test("longest-note TipTap verification stays inside the exact-ID original detail sheet", async (t) => {
  const body = `完整正文开头。${"完整正文尾段。".repeat(20)}`;
  const memo = sourceRecord("memo-long", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    listEditorText: "列表卡片中的错误编辑器内容",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.editorOpenedInDetailSheet, true, "same-ID list cards cannot stand in for the linked detail record");
  assert.equal(result.detailVerification.memoId, "memo-long");
  assert.equal(result.detailVerification.bodyHash, flomoBodyHash(body));
});

test("longest-note detail binds a relative panel link to its non-memo full-body root", async (t) => {
  const body = `详情卡不是 memo 类名。${"长文完整内容。".repeat(16)}`;
  const memo = sourceRecord("memo-detail-normal", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    detailCardUsesMemoClass: false,
    detailSheetHasRelatedDuplicateLink: true,
    detailPageUrl: "https://v.flomoapp.com/mine/",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.editorOpenedInDetailSheet, true);
  assert.equal(result.detailVerification.memoId, memo.memoId);
  assert.equal(result.detailVerification.bodyHash, flomoBodyHash(body));
});

test("longest-note detail binds the unique primary panel root after an exact list-link click", async (t) => {
  const body = `无路由 ID 的主详情卡。${"编辑器完整正文。".repeat(14)}`;
  const memo = sourceRecord("memo-primary-detail", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    detailCardUsesMemoClass: false,
    detailSheetHasLink: false,
    detailSheetHasRelatedDuplicateLink: true,
    detailPageUrl: "https://v.flomoapp.com/mine/",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.editorOpenedInDetailSheet, true);
  assert.equal(result.detailVerification.memoId, memo.memoId);
  assert.equal(result.detailVerification.bodyHash, flomoBodyHash(body));
});

test("route-less primary detail editor must match the exact list body", async (t) => {
  const listBody = `列表版本。${"列表内容。".repeat(10)}`;
  const detailBody = `详情版本。${"已变化内容。".repeat(10)}`;
  const memo = sourceRecord("memo-edited-during-scan", listBody);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: detailBody,
    detailCardUsesMemoClass: false,
    detailSheetHasLink: false,
    detailSheetHasRelatedDuplicateLink: true,
    detailPageUrl: "https://v.flomoapp.com/mine/",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "detail-body-mismatch");
  assert.equal(harness.editorOpenedInDetailSheet, true);
});

test("longest-note detail can bind by exact page URL when the panel has no memo link", async (t) => {
  const body = `面板 URL 身份。${"由编辑器核对的完整正文。".repeat(12)}`;
  const memo = sourceRecord("memo-route-bound", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    detailSheetHasLink: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.editorOpenedInDetailSheet, true);
  assert.equal(result.detailVerification.memoId, "memo-route-bound");
  assert.equal(result.detailVerification.bodyHash, flomoBodyHash(body));
});

test("longest-note detail rejects an unrelated route and reports only structural diagnostics", async (t) => {
  const body = "隐私正文不进入诊断";
  const memo = sourceRecord("memo-route-bound", body);
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo],
    libraryCount: 1,
    detailRecord: memo,
    detailEditorText: body,
    detailSheetHasLink: false,
    detailPageUrl: "https://v.flomoapp.com/mine/?memo_id=another-memo",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "network-timeout");
  assert.equal(result.stage, "wait-longest-note");
  assert.deepEqual(result.pageDiagnostics.detail, {
    sheetVisible: true,
    routeMatches: false,
    targetLinkCount: 0,
    bodyPresent: false,
    editorPresent: false,
    targetListLinkVisible: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /memo-route-bound|隐私正文/);
  assert.equal(harness.finished, 0);
});

test("full browser scan fails closed when the independent TipTap editor cannot be opened", async (t) => {
  const memo = sourceRecord("memo-long", "需要由完整编辑器读取的正文");
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo], libraryCount: 1, detailRecord: memo, editorUnavailable: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "detail-editor-unavailable");
  assert.equal(result.cleanup, "retained-after-error");
  assert.equal(harness.editorActive, false);
  assert.equal(harness.finished, 0);
});

test("full browser scan reloads the untouched original page when the editor has no cancel control", async (t) => {
  const memo = sourceRecord("memo-long", "只读详情正文");
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [memo], libraryCount: 1, detailRecord: memo, cancelUnavailable: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "detail-editor-cancel-unavailable");
  assert.equal(result.cleanup, "retained-after-error");
  assert.equal(harness.editorActive, false, "fallback navigation leaves the untouched memo display open");
  assert.equal(harness.finished, 0);
});

test("full browser scan will not navigate or close an agent-owned space with a different name", async (t) => {
  const first = sourceRecord("memo-a", "正文");
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [first],
    libraryCount: 1,
    detailRecord: first,
    taskSpaceName: "another-agent-task",
  });
  assert.equal(result.error, "taskspace-binding-mismatch");
  assert.equal(result.stage, "taskspace-binding");
  assert.equal(result.taskSpaceId, null);
  assert.equal(result.taskSpaceName, null);
  assert.equal(harness.gotoCount, 0);
  assert.equal(harness.finished, 0);
});

test("full browser scan records a bounded ordinary duplicate-ID count gap", async (t) => {
  const first = sourceRecord("memo-a", "同一正文");
  const duplicate = sourceRecord("memo-a", "同一正文");
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [first, duplicate],
    libraryCount: 2,
    detailRecord: first,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.termination.reason, "stable-bottom-with-accepted-count-gap");
  assert.equal(result.termination.expectedCount, 2);
  assert.equal(result.termination.observedUniqueIds, 1);
  assert.equal(result.termination.missingCount, 1);
  assert.equal(result.observedCards, 2);
  assert.equal(harness.semanticClickCalls, 1, "duplicate cards resolve through one exact-ID original link");
  assert.equal(harness.lastSemanticClickHref, first.url);
  assert.equal(harness.finished, 1);
});

test("full browser scan rejects a stable gap larger than the accepted limit", async (t) => {
  const first = sourceRecord("memo-a", "同一正文");
  const duplicates = Array.from({ length: 12 }, () => ({ ...first }));
  const { result, harness } = await runBrowserScan(t, { initialRecords: duplicates, libraryCount: 12 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "library-count-gap-exceeds-tolerance");
  assert.equal(result.expectedCount, 12);
  assert.equal(result.observedUniqueIds, 1);
  assert.equal(harness.finished, 0);
});

test("full browser scan scrolls through an in-list tail loader before waiting for pagination", async (t) => {
  const first = sourceRecord("memo-a", "首屏正文");
  const next = sourceRecord("memo-b", "下一页正文", { createdAt: "2026-10-05T00:31:00.000Z" });
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [first], nextRecords: [next], libraryCount: 2, initialTailLoader: true, foldNext: true,
    detailRecord: next,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scanned, 2);
  assert.equal(result.detailVerification.verified, true);
  assert.doesNotThrow(() => validateFullFlomoScan(result));
  assert.deepEqual(result.records.map((item) => item.memoId), ["memo-a", "memo-b"]);
  assert.equal(harness.finished, 1);
});

test("full browser scan rejects an ID-less card and retains its owned task space for recovery", async (t) => {
  const invalid = sourceRecord("memo-a", "正文", { url: "https://v.flomoapp.com/mine/" });
  const { result, harness } = await runBrowserScan(t, { initialRecords: [invalid], libraryCount: 1 });
  assert.deepEqual({ ok: result.ok, error: result.error, cleanup: result.cleanup, taskSpaceId: result.taskSpaceId, taskOwnership: result.taskOwnership, executionFinished: result.executionFinished }, {
    ok: false, error: "memo-id-missing", cleanup: "retained-after-error", taskSpaceId: 98, taskOwnership: "agent", executionFinished: true,
  });
  assert.equal(harness.finished, 0);
});

test("full browser scan reports a safe failure phase and progress counts after navigation timeout", async (t) => {
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [sourceRecord("memo-a", "正文")],
    libraryCount: 1,
    gotoError: "Navigation timeout of 30000 ms exceeded",
  });
  assert.equal(result.error, "network-timeout");
  assert.equal(result.stage, "navigate-library");
  assert.equal(result.observedUniqueIds, 0);
  assert.equal(result.cleanup, "retained-after-error");
  assert.equal(result.taskSpaceId, 98);
  assert.equal(result.executionFinished, true);
  assert.equal(harness.finished, 0);
});

test("full browser scan exposes structural-only diagnostics when the library never loads", async (t) => {
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [sourceRecord("memo-private", "这段正文不能进入错误诊断")],
    libraryCount: 1,
    initialPageState: "blank",
  });
  assert.equal(result.error, "network-timeout");
  assert.equal(result.stage, "wait-initial-library");
  assert.deepEqual(result.pageDiagnostics, {
    host: "v.flomoapp.com",
    path: "/mine",
    pageTitleHasFlomo: false,
    hasMemoList: false,
    hasCountLabel: false,
    libraryCount: null,
    memoCardCount: 0,
    loadingVisible: false,
    emptyStateVisible: false,
    loginIndicator: false,
    captchaIndicator: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /这段正文不能进入错误诊断/);
  assert.equal(result.cleanup, "retained-after-error");
  assert.equal(result.taskSpaceId, 98);
  assert.equal(harness.finished, 0);
});

test("full browser scan rejects a conflicting body for an ID encountered on a later page", async (t) => {
  const first = sourceRecord("memo-a", "初始正文");
  const second = sourceRecord("memo-b", "另一正文", { createdAt: "2026-10-05T00:31:00.000Z" });
  const conflict = sourceRecord("memo-a", "扫描期间被改写的正文");
  const third = sourceRecord("memo-c", "第三正文", { createdAt: "2026-10-05T00:32:00.000Z" });
  const { result, harness } = await runBrowserScan(t, {
    initialRecords: [first, second], nextRecords: [conflict, third], libraryCount: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "scan-record-conflict");
  assert.equal(result.cleanup, "retained-after-error");
  assert.equal(result.taskSpaceId, 98);
  assert.equal(harness.finished, 0);
});

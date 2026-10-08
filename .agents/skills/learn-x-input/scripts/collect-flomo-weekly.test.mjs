import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEgoScanScript, collectFlomoWeekly, parseMemoTime, validateCompleteScan } from "./collect-flomo-weekly.mjs";

function scanFixture({ memos = [], pinned = [], scanned = memos.length + pinned.length, complete = true, lowerBoundCovered = true } = {}) {
  return {
    week: "2026-W40",
    complete,
    lowerBoundCovered,
    scanned,
    pageCount: 2,
    scanStartedAt: "2026-10-05T00:00:00.000Z",
    scanFinishedAt: "2026-10-05T00:00:03.000Z",
    memos,
    pinned
  };
}

test("writes only complete target-week Flomo records, deduplicates, filters generated notes, and refreshes one readable pin", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-weekly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "03_input/weekly/2026-W40");
  const mirrorPath = path.join(root, "03_input/_mirrors/flomo-top.md");
  const sourceMemo = { memoId: "memo-1", timeText: "2026-09-28 09:00", bodyText: "本周记录：完成一项重要工作，并整理了真实依据。", bodyComplete: true };
  const result = await collectFlomoWeekly({
    week: "2026-W40",
    outputRoot,
    mirrorPath,
    scan: async () => scanFixture({
      scanned: 9,
      memos: [
        sourceMemo,
        { ...sourceMemo, memoId: "memo-duplicate" },
        { memoId: "memo-generated", timeText: "2026-10-02 18:00", bodyText: "Learn-X 周记\n自动生成的内容", bodyComplete: true },
        { memoId: "memo-2", timeText: "2026-10-03 23:59", bodyText: "周六持续推进另一件实际工作，保留证据。", bodyComplete: true }
      ],
      pinned: [{ memoId: "memo-pin", timeText: "置顶・2025-02-03 08:30", bodyText: "置顶的长期笔记。", bodyComplete: true }]
    })
  });
  const weekly = await readFile(path.join(outputRoot, "flomo.md"), "utf8");
  const mirror = await readFile(mirrorPath, "utf8");
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(result.count, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.excludedGenerated, 1);
  assert.equal(result.mirror.status, "updated");
  assert.equal((weekly.match(/memo-1/g) || []).length, 1);
  assert.doesNotMatch(weekly, /memo-generated|自动生成的内容/);
  assert.match(weekly, /完整扫描：是/);
  assert.match(weekly, /下界已覆盖：是/);
  assert.match(mirror, /置顶的长期笔记/);
  assert.equal(status.sources.flomo.status, "ready");
  assert.equal(status.sources.flomo.count, 2);
});

test("records a complete trusted empty scan without reading or replacing a stale Flomo file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(outputRoot, { recursive: true });
  const old = "人工保留的历史正文\n";
  await writeFile(path.join(outputRoot, "flomo.md"), old);
  const result = await collectFlomoWeekly({
    week: "2026-W40",
    outputRoot,
    mirrorPath: path.join(root, "mirror.md"),
    scan: async () => scanFixture({ memos: [], scanned: 87, pinned: [] })
  });
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(result.count, 0);
  assert.equal(await readFile(path.join(outputRoot, "flomo.md"), "utf8"), old);
  assert.equal(status.sources.flomo.status, "empty");
  assert.match(status.sources.flomo.summary, /完整扫描.*下界已覆盖：是；0 条/);
  assert.equal(status.sources.flomo.preservedStaleFile, true);
});

test("a failed scan preserves the old file but marks the source failed so it cannot enter Process Pack", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-failed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(outputRoot, { recursive: true });
  const old = "# Flomo 周输入｜2026-W40\n旧版本不应进入本次 Process Pack\n";
  await writeFile(path.join(outputRoot, "flomo.md"), old);
  await assert.rejects(collectFlomoWeekly({
    week: "2026-W40",
    outputRoot,
    scan: async () => scanFixture({ complete: false, memos: [] })
  }), /flomo-weekly-scan-integrity-check-failed/);
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(await readFile(path.join(outputRoot, "flomo.md"), "utf8"), old);
  assert.equal(status.sources.flomo.status, "failed");
  assert.equal(status.sources.flomo.preservedStaleFile, true);
});

test("preserves a transient Flomo transport signal for the retry supervisor", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-retry-classification-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "03_input/weekly/2026-W40");

  await assert.rejects(collectFlomoWeekly({
    week: "2026-W40", outputRoot,
    scan: async () => { throw new Error("EAI_AGAIN: temporary name resolution failure"); }
  }), /flomo-weekly-network-transient/);
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(status.sources.flomo.status, "failed");
  assert.match(status.sources.flomo.summary, /network-transient/);
});

test("classifies HTTP 429 as a retryable Flomo service limit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-rate-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "03_input/weekly/2026-W40");

  await assert.rejects(collectFlomoWeekly({
    week: "2026-W40", outputRoot,
    scan: async () => { throw new Error("HTTP 429 Too Many Requests"); }
  }), /flomo-weekly-service-rate-limit/);
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(status.sources.flomo.status, "failed");
  assert.match(status.sources.flomo.summary, /service-rate-limit/);
});

test("classifies network, timeout, and rate-limit errors raised inside the browser task", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-browser-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, "result.json");
  const previousTaskSpace = globalThis.taskSpace;
  const previousCliLog = globalThis.cliLog;
  globalThis.cliLog = () => {};
  try {
    for (const [signal, expected] of [
      ["net::ERR_NAME_NOT_RESOLVED", "network-transient"],
      ["Navigation timeout of 30000 ms exceeded", "network-timeout"],
      ["HTTP 429 Too Many Requests", "service-rate-limit"],
      ["unexpected selector failure", "scan-failed"]
    ]) {
      let finishes = 0;
      globalThis.taskSpace = async () => ({
        ownership: "agent",
        page: () => ({ goto: async () => { throw new Error(signal); } }),
        finish: async () => { finishes += 1; }
      });
      const script = buildEgoScanScript({
        week: "2026-W40", range: { startEpoch: 1_790_000_000, endEpoch: 1_790_100_000 },
        taskName: "learn-x-v2-flomo-error-test", resultPath, maxSteps: 2
      });
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction("taskSpace", "cliLog", script)(globalThis.taskSpace, globalThis.cliLog);
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      assert.equal(result.error, expected, signal);
      assert.equal(result.cleanup, "finished", signal);
      assert.equal(finishes, 1, signal);
    }
  } finally {
    if (previousTaskSpace === undefined) delete globalThis.taskSpace;
    else globalThis.taskSpace = previousTaskSpace;
    if (previousCliLog === undefined) delete globalThis.cliLog;
    else globalThis.cliLog = previousCliLog;
  }
});

test("forwards sanitized browser failure classes into the weekly retry contract", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-browser-retry-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  const egoPath = path.join(bin, "ego-browser");
  await writeFile(egoPath, `#!/usr/bin/env node
const fs = require("node:fs");
const source = process.argv.at(-1);
const resultPath = JSON.parse(source.match(/const resultPath = ("[^"]+");/)[1]);
fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: process.env.LEARN_X_TEST_EGO_RESULT_ERROR }), { mode: 0o600 });
`, { mode: 0o700 });

  const previousPath = process.env.PATH;
  const previousError = process.env.LEARN_X_TEST_EGO_RESULT_ERROR;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`;
  try {
    for (const [browserError, expected] of [
      ["network-transient", "network-transient"],
      ["network-timeout", "network-timeout"],
      ["service-rate-limit", "service-rate-limit"],
      ["scan-failed", "browser-scan-failed"]
    ]) {
      const outputRoot = path.join(root, expected);
      process.env.LEARN_X_TEST_EGO_RESULT_ERROR = browserError;
      await assert.rejects(collectFlomoWeekly({ week: "2026-W40", outputRoot }), new RegExp(`flomo-weekly-${expected}`));
      const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
      assert.equal(status.sources.flomo.status, "failed", browserError);
      assert.match(status.sources.flomo.summary, new RegExp(expected), browserError);
    }
  } finally {
    process.env.PATH = previousPath;
    if (previousError === undefined) delete process.env.LEARN_X_TEST_EGO_RESULT_ERROR;
    else process.env.LEARN_X_TEST_EGO_RESULT_ERROR = previousError;
  }
});

test("finishes only this collector's Ego task after a non-handoff scan failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-task-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, "result.json");
  let finishes = 0;
  const previousTaskSpace = globalThis.taskSpace;
  const previousCliLog = globalThis.cliLog;
  globalThis.taskSpace = async () => ({
    ownership: "agent",
    page: () => ({ goto: async () => {}, waitForLoadState: async () => {}, evaluate: async () => ({ hasList: false }) }),
    finish: async () => { finishes += 1; }
  });
  globalThis.cliLog = () => {};
  try {
    const script = buildEgoScanScript({
      week: "2026-W40", range: { startEpoch: 1_790_000_000, endEpoch: 1_790_100_000 },
      taskName: "learn-x-v2-flomo-test", resultPath, maxSteps: 2
    });
    await import(`data:text/javascript,${encodeURIComponent(script)}`);
  } finally {
    if (previousTaskSpace === undefined) delete globalThis.taskSpace;
    else globalThis.taskSpace = previousTaskSpace;
    if (previousCliLog === undefined) delete globalThis.cliLog;
    else globalThis.cliLog = previousCliLog;
  }
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.error, "list-unavailable");
  assert.equal(result.cleanup, "finished");
  assert.equal(finishes, 1);
});

test("does not finish the Ego task after control has passed to the user", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-task-handoff-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, "result.json");
  let finishes = 0;
  const previousTaskSpace = globalThis.taskSpace;
  const previousCliLog = globalThis.cliLog;
  globalThis.taskSpace = async () => ({
    ownership: "user",
    page: () => { throw new Error("a handed-off page must not be accessed"); },
    finish: async () => { finishes += 1; }
  });
  globalThis.cliLog = () => {};
  try {
    const script = buildEgoScanScript({
      week: "2026-W40", range: { startEpoch: 1_790_000_000, endEpoch: 1_790_100_000 },
      taskName: "learn-x-v2-flomo-handoff", resultPath, maxSteps: 2
    });
    await import(`data:text/javascript,${encodeURIComponent(script)}`);
  } finally {
    if (previousTaskSpace === undefined) delete globalThis.taskSpace;
    else globalThis.taskSpace = previousTaskSpace;
    if (previousCliLog === undefined) delete globalThis.cliLog;
    else globalThis.cliLog = previousCliLog;
  }
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.error, "user-control");
  assert.equal(result.cleanup, "not-needed");
  assert.equal(finishes, 0);
});

test("rejects unknown timestamps and incomplete target-week note bodies", () => {
  assert.equal(parseMemoTime("2026-09-28 00:00"), Date.parse("2026-09-27T16:00:00.000Z"));
  assert.equal(parseMemoTime("置顶・2026-09-28 00:00"), Date.parse("2026-09-27T16:00:00.000Z"));
  assert.equal(parseMemoTime("2026-02-30 12:00"), null);
  assert.throws(() => validateCompleteScan(scanFixture({ memos: [{ memoId: "memo", timeText: "unknown", bodyText: "正文", bodyComplete: true }] }), "2026-W40"), /flomo-weekly-record-incomplete/);
  assert.throws(() => validateCompleteScan(scanFixture({ memos: [{ memoId: "memo", timeText: "2026-09-29 09:00", bodyText: "正文", bodyComplete: false }] }), "2026-W40"), /flomo-weekly-record-incomplete/);
});

test("weekly collection preserves handwritten Learn-X discussion and excludes exact tags and marker lines", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-flomo-filter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "weekly");
  const handwritten = [
    "我手写讨论 Learn-X 周记的输入设计，发现减少重复处理更有效。",
    "Learn-X 周记帮我看见了过去忽略的生活细节。",
    "AI 基础草稿让我发现缺少真实经历，需要自己补充。",
    "#learn-xtra 是我自己的不同标签。"
  ];
  const generated = ["正文 #LEARN-X", "正文#Learn-X/周记，", "Learn-X 周记\n自动生成", "# 飞书周记", "【待优化】AI 基础草稿", "**Learn-X 月记｜2026-09**"];
  const result = await collectFlomoWeekly({
    week: "2026-W40", outputRoot, mirrorPath: path.join(root, "mirror.md"),
    scan: async () => scanFixture({ memos: [...handwritten, ...generated].map((bodyText, i) => ({ memoId: `FILTER-${i}`, timeText: "2026-09-29 09:00", bodyText, bodyComplete: true })) })
  });
  const weekly = await readFile(path.join(outputRoot, "flomo.md"), "utf8");
  assert.equal(result.count, handwritten.length);
  assert.equal(result.excludedGenerated, generated.length);
  for (const body of handwritten) assert.ok(weekly.includes(body));
  for (let i = handwritten.length; i < handwritten.length + generated.length; i++) assert.ok(!weekly.includes(`memo_id=FILTER-${i}`));
});

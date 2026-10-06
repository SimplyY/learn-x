import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canRetrySource, classifyWeeklyFailure, createWeeklyRetryState,
  recordWeeklyStage, runWeeklyRetrySupervisor
} from "./weekly-retry-supervisor.mjs";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";

test("classifies recoverable network faults separately from login, schema, and uncertain AI submissions", () => {
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET"), { errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.equal(classifyWeeklyFailure("login expired").retryable, false);
  assert.equal(classifyWeeklyFailure("field contract mismatch").errorClass, "source-contract-mismatch");
  assert.equal(classifyWeeklyFailure("observer-window-ended", { sourceId: "ai" }).errorClass, "ai-submission-state-uncertain");
  assert.equal(classifyWeeklyFailure("ECONNRESET", { sourceId: "ai" }).retryable, false);
});

test("records measured Stage 2 and Stage 3 card timings without storing content", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-stage-metrics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordWeeklyStage({ week: "2026-W40", stage: "authorization_card", durationMs: 812, repoRoot: root });
  await recordWeeklyStage({ week: "2026-W40", stage: "memory_card", durationMs: 1_200, outcome: "failed", repoRoot: root });
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(state.diagnostics.map(({ step, durationMs, outcome }) => ({ step, durationMs, outcome })), [
    { step: "authorization_card", durationMs: 812, outcome: "success" },
    { step: "memory_card", durationMs: 1_200, outcome: "failed" }
  ]);
  assert.doesNotMatch(JSON.stringify(state.diagnostics), /Memory body|private-note|token/);
});

test("collects Flomo before the dependent review import and Wisdom Gate source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-wisdom-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000,
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; },
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00")
  });
  assert.ok(calls.indexOf("flomo") >= 0);
  assert.ok(calls.indexOf("wisdom") > calls.indexOf("flomo"));
});

test("important source retries at 20-minute intervals up to four times after the initial attempt", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-important-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = Date.parse("2026-10-05T05:00:00.000+08:00");
  const waits = [];
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40",
    repoRoot: root,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async (source) => source.id === "daily" ? null : { status: "ready", count: 1 },
    runSource: async (source) => { calls.push(source.id); return { status: "failed", error: "ECONNRESET" }; },
    maxDurationMs: 2 * 60 * 60_000
  });
  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(calls, ["daily", "daily", "daily", "daily", "daily"]);
  assert.deepEqual(waits, [20 * 60_000, 20 * 60_000, 20 * 60_000, 20 * 60_000]);
  assert.equal(state.sources.daily.attempts, 5);
  assert.equal(state.sources.daily.status, "failed");
  assert.equal(state.sources.daily.sameErrorCount, 5);
  assert.equal(result.sources.daily.retries, 4);
});

test("does not retry successful empty sources or restart sources already marked successful", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-success-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40",
    repoRoot: root,
    runSource: async (source) => { calls.push(source.id); return { status: "failed", error: "ECONNRESET" }; },
    readOutcome: async () => ({ status: "empty", count: 0, summary: "complete query" }),
    now: () => Date.parse("2026-10-05T05:00:00Z"),
    sleep: async () => assert.fail("successful empty results must not wait or retry")
  });
  assert.deepEqual(calls, []);
});

test("07:00 rescue consumes one extra eligible attempt without resetting earlier retries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily,
    status: "failed", attempts: 5, retries: 4, lastErrorClass: "network-transient",
    nextRetryAt: "2026-10-05T07:00:00.000+08:00", rescueUsed: false
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let calls = 0;
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:01:00.000+08:00"),
    runSource: async () => { calls += 1; return { status: "failed", error: "EAI_AGAIN" }; },
    readOutcome: async () => null
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(calls, 1);
  assert.equal(saved.sources.daily.attempts, 6);
  assert.equal(saved.sources.daily.rescueUsed, true);
  assert.equal(saved.sources.daily.status, "failed");
  assert.equal(canRetrySource(WEEKLY_SOURCE_CONFIG.find((item) => item.id === "daily"), saved.sources.daily, "rescue", Date.parse("2026-10-05T08:00:00+08:00")), false);
  assert.equal(result.mode, "rescue");
});

test("07:00 rescue ignores stale success sidecars and records only a diagnostic hypothesis", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-stale-sidecar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.wisdom = {
    ...state.sources.wisdom,
    status: "failed", attempts: 1, lastAttemptAt: "2026-10-05T06:30:00.000+08:00",
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T06:50:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const events = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async (source) => source.id === "wisdom"
      ? { status: "ready", count: 1, updatedAt: "2026-10-05T06:00:00.000+08:00" }
      : null,
    runSource: async () => {
      calls += 1;
      throw new Error("ECONNRESET private-note https://example.invalid/token");
    },
    onEvent: (event) => events.push(event)
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(calls, 1, "the stale ready sidecar must not suppress the eligible retry");
  assert.equal(saved.sources.wisdom.status, "failed");
  assert.equal(saved.sources.wisdom.attempts, 2);
  assert.equal(saved.sources.wisdom.rescueUsed, true);
  const failure = events.find((event) => event.step === "source-collection" && event.sourceId === "wisdom" && event.outcome === "failed");
  assert.equal(failure.rootCauseStatus, "unconfirmed");
  assert.equal(failure.hypothesis, "network-transient");
  assert.equal(failure.errorSignal, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(events), /private-note|example\.invalid|token/);
});

test("AI work interrupted with no confirmed result is observed as needs_review and never resubmitted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-ai-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.ai.status = "running";
  state.sources.ai.attempts = 1;
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let called = false;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00Z"),
    runSource: async () => { called = true; return { status: "success" }; },
    readOutcome: async () => null
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(called, false);
  assert.equal(saved.sources.ai.status, "needs_review");
  assert.equal(saved.sources.ai.lastErrorClass, "ai-submission-state-uncertain");
});

test("retry workers cap CLI concurrency at three and browser work at one", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) {
    const entry = state.sources[source.id];
    entry.status = source.collector ? "failed" : "manual-input";
    entry.attempts = 1;
    entry.lastErrorClass = "network-transient";
    entry.nextRetryAt = "2026-10-05T07:00:00.000Z";
  }
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const active = { cli: 0, browser: 0 };
  const peak = { cli: 0, browser: 0 };
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T08:00:00Z"),
    readOutcome: async () => null,
    runSource: async (source) => {
      active[source.queue] += 1;
      peak[source.queue] = Math.max(peak[source.queue], active[source.queue]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active[source.queue] -= 1;
      return { status: "failed", error: "schema contract mismatch" };
    }
  });
  assert.ok(peak.cli <= 3);
  assert.equal(peak.browser, 1);
});

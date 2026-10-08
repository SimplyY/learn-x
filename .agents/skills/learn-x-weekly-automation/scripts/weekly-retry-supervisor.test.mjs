import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canRetrySource, classifyOutcome, classifyWeeklyFailure, createWeeklyRetryState,
  recordWeeklyStage, runWeeklyRetrySupervisor
} from "./weekly-retry-supervisor.mjs";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";

test("classifies recoverable network faults separately from login, schema, and uncertain AI submissions", () => {
  assert.deepEqual(classifyWeeklyFailure("ECONNRESET"), { errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.equal(classifyWeeklyFailure("login expired").retryable, false);
  assert.equal(classifyWeeklyFailure("field contract mismatch").errorClass, "source-contract-mismatch");
  assert.equal(classifyWeeklyFailure("observer-window-ended", { sourceId: "ai" }).errorClass, "unknown-failure");
  assert.equal(classifyWeeklyFailure("ECONNRESET", { sourceId: "ai" }).retryable, true);
});

test("AI retries only a confirmed preflight network failure and observes uncertain submissions", () => {
  assert.deepEqual(classifyOutcome("ai", {
    status: "failed", error: "ECONNRESET", diagnostics: { rateLimitPhase: "preflight" }
  }), { status: "failed", errorClass: "network-transient", retryable: true, retryAfterMs: 20 * 60_000 });
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "login-required", diagnostics: { rateLimitPhase: "preflight" }
  }).retryable, false);
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "field contract mismatch", diagnostics: { rateLimitPhase: "preflight" }
  }).errorClass, "source-contract-mismatch");
  assert.equal(classifyOutcome("ai", {
    status: "failed", error: "ECONNRESET", diagnostics: { rateLimitPhase: "submit" }
  }).status, "needs_review");
  assert.equal(classifyOutcome("ai", { status: "failed", error: "bridge-timeout" }).errorClass, "ai-submission-state-uncertain");
  assert.equal(classifyOutcome("ai", { status: "needs_review", error: "observer-window-ended" }).retryable, false);
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

test("prepares the local input snapshot after each successful collection", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-prepare-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const collected = [];
  const prepared = [];
  const events = [];
  await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source) => { collected.push(source.id); return { status: "ready", count: 1 }; },
    prepareInputs: async (source) => { prepared.push(source.id); },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual([...prepared].sort(), [...collected].sort());
  assert.ok(events.some((event) => event.step === "weekly-preprocess" && event.sourceId === "daily" && event.outcome === "succeeded"));
});

test("preprocessing failure is diagnostic and does not relabel a successful source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-prepare-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", repoRoot: root, maxDurationMs: 1_000,
    now: () => Date.parse("2026-10-05T05:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async () => ({ status: "ready", count: 1 }),
    prepareInputs: async (source) => { if (source.id === "daily") throw new Error("candidate-version-mismatch"); }
  });

  const state = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W40/_weekly-retry-state.json"), "utf8"));
  assert.equal(result.sources.daily.status, "succeeded");
  assert.ok(state.diagnostics.some((event) => event.step === "weekly-preprocess" && event.sourceId === "daily" && event.outcome === "failed"));
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

test("07:00 rescue runs a safe collector left pending by a bounded 05:00 run exactly once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.calendar = { ...state.sources.calendar, status: "pending", attempts: 0, rescueUsed: false };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(calls, ["calendar"]);
  assert.equal(result.sources.calendar.attempts, 1);
  assert.equal(result.sources.calendar.rescueUsed, true);
});

test("07:00 rescue preserves Flomo-before-Wisdom dependency and marks both bounded starts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-wisdom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.flomo = { ...state.sources.flomo, status: "pending", attempts: 0, rescueUsed: false };
  state.sources.wisdom = { ...state.sources.wisdom, status: "pending", attempts: 0, rescueUsed: false };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(calls, ["flomo", "wisdom"]);
  assert.equal(result.sources.flomo.rescueUsed, true);
  assert.equal(result.sources.wisdom.rescueUsed, true);
});

test("07:00 rescue waits for the persisted nextRetryAt and respects its bounded window", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-cooldown-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily, status: "failed", attempts: 5, retries: 4, rescueUsed: false,
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T07:10:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 20 * 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(waits, [10 * 60_000]);
  assert.equal(calls, 1);

  const lateRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-late-"));
  t.after(() => rm(lateRoot, { recursive: true, force: true }));
  const lateWeekRoot = path.join(lateRoot, "03_input/weekly/2026-W40");
  await mkdir(lateWeekRoot, { recursive: true });
  const lateState = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) lateState.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  lateState.sources.daily = {
    ...lateState.sources.daily, status: "failed", attempts: 5, rescueUsed: false,
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T08:00:00.000+08:00"
  };
  await writeFile(path.join(lateWeekRoot, "_weekly-retry-state.json"), `${JSON.stringify(lateState)}\n`);
  let lateNow = Date.parse("2026-10-05T07:00:00.000+08:00");
  let lateCalls = 0;
  const bounded = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: lateRoot, maxDurationMs: 20 * 60_000,
    now: () => lateNow,
    sleep: async (ms) => { lateNow += ms; },
    readOutcome: async () => null,
    runSource: async () => { lateCalls += 1; return { status: "ready", count: 1 }; }
  });
  const lateSaved = JSON.parse(await readFile(path.join(lateWeekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(lateCalls, 0);
  assert.equal(lateSaved.sources.daily.rescueUsed, false);
  assert.equal(bounded.sources.daily.nextRetryAt, "2026-10-05T08:00:00.000+08:00");
  assert.ok(lateSaved.diagnostics.some((event) => event.outcome === "bounded-window-ending" || event.outcome === "bounded-window-ended"));
});

test("07:00 rescue handles every eligible source as its own cooldown expires", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-staggered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  for (const [sourceId, minute] of [["daily", "10"], ["core", "15"]]) {
    state.sources[sourceId] = {
      ...state.sources[sourceId], status: "failed", attempts: 5, rescueUsed: false,
      lastErrorClass: "network-transient", nextRetryAt: `2026-10-05T07:${minute}:00.000+08:00`
    };
  }
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  const calls = [];
  const result = await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 20 * 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; },
    readOutcome: async () => null,
    runSource: async (source) => { calls.push(source.id); return { status: "ready", count: 1 }; }
  });

  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.deepEqual(waits, [10 * 60_000, 5 * 60_000]);
  assert.deepEqual(calls, ["daily", "core"]);
  assert.equal(saved.sources.daily.attempts, 6);
  assert.equal(saved.sources.core.attempts, 6);
  assert.equal(saved.sources.daily.rescueUsed, true);
  assert.equal(saved.sources.core.rescueUsed, true);
  assert.equal(result.sources.daily.status, "succeeded");
  assert.equal(result.sources.core.status, "succeeded");
});

test("rescue waits for a running initial invocation, then reads its persisted state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-rescue-active-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily, status: "failed", attempts: 1, lastErrorClass: "network-transient",
    nextRetryAt: "2026-10-05T07:00:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  const lockPath = path.join(weekRoot, "_weekly-retry-state.lock");
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: "active-initial" }));
  let current = Date.parse("2026-10-05T07:00:00.000+08:00");
  const waits = [];
  let calls = 0;
  await runWeeklyRetrySupervisor({
    week: "2026-W40", mode: "rescue", repoRoot: root, maxDurationMs: 60_000,
    now: () => current,
    sleep: async (ms) => { waits.push(ms); current += ms; await rm(lockPath, { force: true }); },
    readOutcome: async () => null,
    runSource: async () => { calls += 1; return { status: "ready", count: 1 }; }
  });
  assert.deepEqual(waits, [30_000]);
  assert.equal(calls, 1);
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

test("only one concurrent invocation reclaims a dead run lock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-retry-lock-reaper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W40");
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState("2026-W40");
  for (const source of WEEKLY_SOURCE_CONFIG) state.sources[source.id].status = source.collector ? "succeeded" : "recheck-only";
  state.sources.daily = {
    ...state.sources.daily,
    status: "failed", attempts: 1, lastAttemptAt: "2026-10-05T06:30:00.000+08:00",
    lastErrorClass: "network-transient", nextRetryAt: "2026-10-05T06:50:00.000+08:00"
  };
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);
  await writeFile(path.join(weekRoot, "_weekly-retry-state.lock"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));

  let releaseSource;
  let enteredSource;
  const sourceEntered = new Promise((resolve) => { enteredSource = resolve; });
  const sourceBlocked = new Promise((resolve) => { releaseSource = resolve; });
  let calls = 0;
  const options = {
    week: "2026-W40", repoRoot: root, maxDurationMs: 60_000,
    now: () => Date.parse("2026-10-05T07:00:00.000+08:00"),
    readOutcome: async () => null,
    runSource: async () => { calls += 1; enteredSource(); await sourceBlocked; return { status: "ready", count: 1 }; }
  };
  const first = runWeeklyRetrySupervisor(options);
  await sourceEntered;
  const second = await runWeeklyRetrySupervisor({ ...options, runSource: async () => { calls += 100; return { status: "ready" }; } });
  assert.equal(second.skipped, "supervisor-already-running");
  releaseSource();
  const firstResult = await first;
  assert.equal(firstResult.sources.daily.status, "succeeded");
  assert.equal(calls, 1);
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

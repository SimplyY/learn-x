import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateUsage,
  rangeForWeek,
  resolveTargetWeek,
} from "./usage-aggregation.mjs";

const ts = (value) => `2026-08-${value}T12:00:00.000+08:00`;

test("resolves the latest complete Shanghai week", () => {
  assert.equal(resolveTargetWeek(new Date("2026-08-10T00:15:00+08:00")), "2026-W32");
  assert.equal(resolveTargetWeek(new Date("2026-08-09T21:00:00+08:00")), "2026-W31");

  const range = rangeForWeek("2026-W32");
  assert.deepEqual(
    { start: range.startDate, end: range.endDate },
    { start: "2026-08-03", end: "2026-08-09" },
  );
});

test("uses an inclusive Monday start and exclusive next Monday end", () => {
  const range = rangeForWeek("2026-W32");
  const entries = [
    { ts: "2026-08-03T00:00:00+08:00", phase: "intake", event: "enter", scope: "s", sender: "u" },
    { ts: "2026-08-09T23:59:59+08:00", phase: "intake", event: "enter", scope: "s", sender: "u" },
    { ts: "2026-08-10T00:00:00+08:00", phase: "intake", event: "enter", scope: "s", sender: "u" },
  ];
  assert.equal(aggregateUsage(entries, range).demand.inbound, 2);
});

test("aggregates demand, runs, delivery, latency, and follow-up proxy", () => {
  const range = rangeForWeek("2026-W32");
  const entries = [
    { ts: ts("03"), phase: "intake", event: "enter", chatId: "oc-secret-chat", scope: "oc-secret-chat", sender: "ou-secret-user", preview: "secret prompt" },
    { ts: ts("03"), phase: "run", event: "started", runId: "run-1", scope: "oc-secret-chat", source: "im", queueWaitMs: 10, model: "ark-code-latest", resumed: false },
    { ts: ts("03"), phase: "run", event: "started", runId: "run-1", scope: "oc-secret-chat", source: "im", queueWaitMs: 10, model: "ark-code-latest", resumed: false },
    { ts: ts("03"), phase: "run", event: "first-event", runId: "run-1", firstEventMs: 100 },
    { ts: ts("03"), phase: "run", event: "first-visible", runId: "run-1", firstVisibleMs: 200 },
    { ts: ts("03"), phase: "session", event: "model", runId: "run-1", actual: "glm-5.2" },
    { ts: ts("03"), phase: "run", event: "completed", runId: "run-1", result: "done", durationMs: 1000 },
    { ts: ts("03"), phase: "outbound", event: "sent", runId: "run-1", scope: "oc-secret-chat", type: "markdown", chars: 20 },
    { ts: "2026-08-03T13:00:00.000+08:00", phase: "intake", event: "enter", chatId: "oc-secret-chat", scope: "oc-secret-chat", sender: "ou-secret-user" },
    { ts: ts("04"), phase: "intake", event: "skip-no-mention", scope: "oc-secret-chat" },
    { ts: ts("04"), phase: "intake", event: "skip-not-allowed-user", scope: "oc-secret-chat" },
    { ts: ts("04"), phase: "intake", event: "reject", scope: "oc-secret-chat" },
    { ts: ts("04"), phase: "intake", event: "command", scope: "oc-secret-chat" },
    { ts: ts("04"), phase: "run", event: "started", runId: "run-2", scope: "oc-secret-chat", source: "im", queueWaitMs: 20, model: "ark-code-latest", resumed: true },
    { ts: ts("04"), phase: "run", event: "failed", runId: "run-2", result: "error", durationMs: 2000 },
    { ts: ts("05"), phase: "run", event: "started", runId: "run-3", scope: "oc-secret-chat", source: "im", model: "ark-code-latest" },
    { ts: ts("05"), phase: "run", event: "completed", runId: "run-3", result: "interrupted", durationMs: 3000 },
    { ts: ts("05"), phase: "outbound", event: "markdown-stream-fallback", runId: "run-3" },
    { ts: ts("05"), phase: "outbound", event: "error", level: "error", runId: "run-3" },
    { ts: ts("06"), phase: "session", event: "model", scope: "oc-secret-chat", actual: "legacy-model" },
    { ts: "2026-08-02T23:59:59.000+08:00", phase: "intake", event: "enter", chatId: "old-chat", scope: "old-chat", sender: "old-user" },
    { ts: "2026-08-09T23:59:59.000+08:00", phase: "intake", event: "enter", chatId: "oc-secret-chat", scope: "oc-secret-chat", sender: "ou-secret-user" },
    { ts: "2026-08-10T00:00:00.000+08:00", phase: "intake", event: "enter", chatId: "future-chat", scope: "future-chat", sender: "future-user" },
    { ts: ts("06"), phase: "outbound", event: "sent", scope: "oc-secret-chat", type: "text", chars: 0 },
    { ts: ts("06"), phase: "outbound", event: "sent", scope: "oc-secret-chat", type: "text", chars: 0 },
    "malformed json object",
  ];

  const result = aggregateUsage(entries, range);
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.demand, {
    inbound: 3,
    activeUsers: 1,
    activeChats: 1,
    activeScopes: 1,
    activeDays: 2,
    rejected: 1,
    noMention: 1,
    notAllowed: 1,
    commands: 1,
    queued: 0,
  });
  assert.equal(result.service.started, 3);
  assert.equal(result.service.completed, 1);
  assert.equal(result.service.failed, 1);
  assert.equal(result.service.interrupted, 1);
  assert.equal(result.service.resumed, 1);
  assert.equal(result.service.durationMs.p50, 2000);
  assert.equal(result.service.durationMs.p95, 3000);
  assert.deepEqual(result.service.actualModels, { "glm-5.2": 1, "legacy-model": 1 });
  assert.equal(result.service.degradedModelCorrelation, 1);
  assert.deepEqual(result.service.sources, { im: 3 });
  assert.equal(result.delivery.sent, 2);
  assert.equal(result.delivery.markdown, 1);
  assert.equal(result.delivery.correlatedRuns, 1);
  assert.equal(result.delivery.degradedCorrelation, 1);
  assert.equal(result.delivery.streamFallbacks, 1);
  assert.equal(result.delivery.errors, 1);
  assert.equal(result.delivery.emptyReplies, 1);
  assert.equal(result.behaviorProxy.followUpMessages, 1);
  assert.equal(result.behaviorProxy.followUpWithin24hRuns, 1);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { safeBusinessOutcomeReason, writeBridgeBusinessOutcome } from "./bridge-business-outcome.mjs";

const bridgePath = process.env.LEARN_X_CHATGPT_BRIDGE
  || path.join(os.homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const sentinel = "PRIVATE_PROMPT_REPLY_SESSION_SENTINEL";

async function journalText(root) {
  const files = await readdir(path.join(root, "journal"));
  return (await Promise.all(files.map((file) => readFile(path.join(root, "journal", file), "utf8")))).join("\n");
}

test("Learn-X business outcome adapter uses Bridge sanitization and records the caller identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-bridge-outcome-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "runtime");
  const result = await writeBridgeBusinessOutcome({
    source: "learn-x", caller: "learn-x:periodic-insight", attemptId: "attempt-periodic-1",
    clientRequestId: "attempt-periodic-1", runId: "bridge-run-1", status: "succeeded",
    deliveryStatus: "pending", reason: sentinel, prompt: sentinel, reply: sentinel, conversationUrl: `https://${sentinel}.invalid/c/${sentinel}`,
  }, { bridgePath, runtimeDir });

  assert.equal(result.status, "recorded");
  const text = await journalText(runtimeDir);
  assert.match(text, /learn-x:periodic-insight/);
  assert.match(text, /attempt-periodic-1/);
  assert.doesNotMatch(text, new RegExp(sentinel));
  assert.match(text, /"reason":"unknown"/);
});

test("business outcome reason classification keeps canonical codes and drops free-form details", async () => {
  assert.equal(await safeBusinessOutcomeReason({ status: "needs_review", reason: "invalid-output:PRIVATE_REPLY" }, { bridgePath }), "invalid-output");
  assert.equal(await safeBusinessOutcomeReason({ status: "archive_pending", reason: "private archive error" }, { bridgePath }), "archive-pending");
  assert.equal(await safeBusinessOutcomeReason({ status: "failed", reason: "private filesystem path" }, { bridgePath }), "business-operation-failed");
  assert.equal(await safeBusinessOutcomeReason({ status: "needs_review", reason: "observer-timeout" }, { bridgePath }), "observer-timeout");
  assert.equal(await safeBusinessOutcomeReason({ status: "needs_review", reason: "synthetic-private-reply-as-hyphenated-text" }, { bridgePath }), "unknown");
  assert.equal(await safeBusinessOutcomeReason({ status: "needs_review", reason: "PRIVATE_PROMPT_BODY" }, { bridgePath }), "unknown");
});

test("Learn-X business outcome adapter falls back to the client journal when the primary sink is unavailable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-bridge-outcome-fallback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeDir = path.join(root, "primary-file");
  await writeFile(runtimeDir, "not a directory");
  const clientJournalDir = path.join(root, "client");
  const result = await writeBridgeBusinessOutcome({
    source: "learn-x", caller: "learn-x:voice-insight", attemptId: "attempt-voice-1",
    clientRequestId: "attempt-voice-1", runId: "bridge-run-2", status: "needs_review",
    deliveryStatus: "needs_review", failureStage: "validation",
  }, { bridgePath, runtimeDir, clientJournalDir });

  assert.equal(result.status, "recorded");
  assert.equal(result.persistenceTarget, "primary-fallback");
  const text = await journalText(clientJournalDir);
  assert.match(text, /learn-x:voice-insight/);
  assert.match(text, /diagnostic-write-failed/);
  assert.match(text, /EEXIST|ENOTDIR/);
});

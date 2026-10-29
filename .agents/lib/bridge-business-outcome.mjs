import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultBridgePath = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");

// Persist stable business reason codes only. Free-form exception text stays in
// the caller's private state file and is never copied into the shared journal.
export async function safeBusinessOutcomeReason(state = {}, {
  bridgePath = process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath,
} = {}) {
  const reason = typeof state.reason === "string" ? state.reason : "";
  if (reason.startsWith("invalid-output:")) return "invalid-output";
  if (state.status === "archive_pending") return "archive-pending";
  if (reason) {
    try {
      const bridge = await import(pathToFileURL(await realpath(bridgePath)).href);
      if (typeof bridge.isSafeBridgeJournalReason === "function" && bridge.isSafeBridgeJournalReason(reason)) return reason;
    } catch { /* unknown when the canonical Bridge reason contract is unavailable */ }
  }
  if (state.status === "failed") return "business-operation-failed";
  return "unknown";
}

// Resolve the installed Bridge implementation and delegate its strict event
// validation, privacy allowlist, primary journal, and client outbox fallback.
// The event contains only IDs and outcome metadata; no prompt or response text.
export async function writeBridgeBusinessOutcome(event, {
  bridgePath = process.env.LEARN_X_CHATGPT_BRIDGE || defaultBridgePath,
  runtimeDir,
  clientJournalDir,
} = {}) {
  const moduleUrl = pathToFileURL(await realpath(bridgePath)).href;
  const bridge = await import(moduleUrl);
  if (typeof bridge.recordBridgeBusinessOutcome !== "function") {
    return { status: "failed", persistenceTarget: "unavailable", errorCode: "business-outcome-recorder-unavailable" };
  }
  return bridge.recordBridgeBusinessOutcome(event, {
    ...(runtimeDir ? { runtimeDir } : {}),
    ...(clientJournalDir ? { clientJournalDir } : {}),
  });
}

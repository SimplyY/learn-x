import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPrompt,
  DEFAULT_BRIDGE_GAP_MS,
  diffLines,
  exportChatgptUnderstanding,
  extractOutput,
  sha256,
  validateOutputs
} from "./export-chatgpt-understanding.mjs";
import { importLearnXCandidate } from "../../learn-x-weekly-automation/scripts/manual-handoff-adapter.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-monthly-understanding-"));
  await mkdir(path.join(root, "02_prompts/meta"), { recursive: true });
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "02_prompts/meta/chatgpt-self-reading.md"), "自我提示词");
  await writeFile(path.join(root, "02_prompts/meta/chatgpt-ai-memory.md"), "记忆提示词");
  return root;
}

test("builds two independent bridge prompts", () => {
  const selfPrompt = buildPrompt("SELF", "self");
  const memoryPrompt = buildPrompt("MEMORY", "memory");
  assert.match(selfPrompt, /SELF/);
  assert.match(memoryPrompt, /MEMORY/);
  assert.doesNotMatch(selfPrompt, /旧版|上月|本月|月度/);
  assert.doesNotMatch(memoryPrompt, /旧版|上月|本月|月度/);
});

test("monthly caller keeps private context-pack receipts and does not expand an explicit timeout", async () => {
  const root = await fixture();
  const seen = [];
  const pack = { status: "ready", path: "/private/monthly-request.txt" };
  try {
    const output = await exportChatgptUnderstanding({ repoRoot: root, month: "2026-08", bridgeTimeoutMs: 1234, bridgeGapMs: 0,
      runBridge: async (prompt, options) => {
        seen.push({ prompt, options });
        return { result: { status: "needs_review", reason: "ego-host-unavailable", runId: "fixture-run", contextPack: pack } };
      } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].options.callerLabel, "learn-x:monthly-understanding");
    assert.equal(seen[0].options.timeoutMs, 1234);
    assert.equal(seen[0].prompt, buildPrompt("自我提示词", "self"));
    assert.deepEqual(output.runs.self.contextPack, pack);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unverified account Memory blocks a manual handoff before any browser submission", async () => {
  const root = await fixture();
  try {
    const result = await exportChatgptUnderstanding({ repoRoot: root, month: "2026-08", bridgeGapMs: 0 });
    assert.equal(result.status, "needs_review");
    assert.equal(result.reason, "history-materials-unverified");
    assert.equal(await readFile(path.join(root, "01_core/ChatGPT-自我阅读版.md"), "utf8").catch(() => null), null);
    assert.equal(await stat(path.join(root, ".runtime/manual-handoffs")).then(() => true, () => false), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("monthly understanding resumes sequential manual candidates through the shared Learn-X handoff", async (t) => {
  const root = await fixture();
  const waits = [];
  const options = {
    repoRoot: root, month: "2026-08", sleep: async (milliseconds) => { waits.push(milliseconds); },
    historyDependency: { required: true, completenessVerified: true,
      items: [{ id: "synthetic-account-memory-export", sha256: "a".repeat(64), scope: "test fixture" }] },
  };
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await exportChatgptUnderstanding(options);
  assert.equal(first.status, "awaiting_manual");
  assert.ok(first.runs.self.handoffId);
  assert.equal(first.runs.memory, undefined);

  const self = await importLearnXCandidate({ repoRoot: root, handoffId: first.runs.self.handoffId,
    eventId: "codex-test:self-result", sourceClaim: "synthetic test result", resultBytes: Buffer.from("自我阅读结果") });
  assert.equal(self.status, "received");
  const second = await exportChatgptUnderstanding(options);
  assert.equal(second.status, "awaiting_manual");
  assert.equal(second.runs.self.candidateId, self.candidate.candidateId);
  assert.ok(second.runs.memory.handoffId);

  const memory = await importLearnXCandidate({ repoRoot: root, handoffId: second.runs.memory.handoffId,
    eventId: "codex-test:memory-result", sourceClaim: "synthetic test result", resultBytes: Buffer.from("AI 记忆结果") });
  assert.equal(memory.status, "received");
  const completed = await exportChatgptUnderstanding(options);
  assert.equal(completed.status, "succeeded");
  const state = JSON.parse(await readFile(path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json"), "utf8"));
  assert.equal(state.completionSource, "user-asserted");
  assert.equal(state.runs.self.candidateId, self.candidate.candidateId);
  assert.equal(state.runs.memory.candidateId, memory.candidate.candidateId);
  assert.deepEqual(waits, []);
  assert.match(await readFile(path.join(root, "01_core/ChatGPT-自我阅读版.md"), "utf8"), /自我阅读结果/);
  assert.match(await readFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), "utf8"), /AI 记忆结果/);
});

test("uses a one-minute gap between independent bridge prompts", async () => {
  const root = await fixture();
  const waits = [];
  try {
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      runBridge: async (_prompt, options) => ({
        result: { status: "succeeded", runId: `run-${options.understandingPart}`, text: "内容" }
      }),
      sleep: async (milliseconds) => { waits.push(milliseconds); }
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(waits, [DEFAULT_BRIDGE_GAP_MS]);
    assert.equal(DEFAULT_BRIDGE_GAP_MS, 60_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not skip a configured gap for an injected bridge runner", async () => {
  const root = await fixture();
  const startedAt = Date.now();
  try {
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 5,
      runBridge: async (_prompt, options) => ({
        result: { status: "succeeded", runId: `run-${options.understandingPart}`, text: "内容" }
      })
    });
    assert.equal(result.status, "succeeded");
    assert.ok(Date.now() - startedAt >= 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracts each independent bridge output and validates both", () => {
  const outputs = {
    self: extractOutput("<SELF_READING>没有固定章节</SELF_READING>", "SELF_READING"),
    memory: extractOutput("<AI_MEMORY>## 事实\n稳定偏好</AI_MEMORY>", "AI_MEMORY")
  };
  assert.equal(validateOutputs(outputs).valid, true);
});

test("does not require a model-controlled comparison section", () => {
  assert.equal(validateOutputs({ self: "内容由模型组织", memory: "协作记忆" }).valid, true);
});

test("bridge failure is recorded and does not block or overwrite existing files", async () => {
  const root = await fixture();
  try {
    const selfPath = path.join(root, "01_core/ChatGPT-自我阅读版.md");
    const memoryPath = path.join(root, "01_core/memory/ChatGPT-AI记忆版.md");
    await writeFile(selfPath, "旧自我阅读版\n");
    await writeFile(memoryPath, "旧 AI 记忆版\n");
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 0,
      runBridge: async () => ({ result: { status: "needs_review", reason: "observer-timeout", runId: "run-1" } })
    });
    assert.equal(result.status, "needs_review");
    assert.equal(await readFile(selfPath, "utf8"), "旧自我阅读版\n");
    assert.equal(await readFile(memoryPath, "utf8"), "旧 AI 记忆版\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed bridge run requires explicit retry and preserves diagnostics", async () => {
  const root = await fixture();
  try {
    const statePath = path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, month: "2026-08", status: "failed", reason: "bridge-process-exit-2" }));
    let called = false;
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 0,
      runBridge: async () => { called = true; return { result: null, exit: { code: 2, signal: null, timedOut: false } }; }
    });
    assert.equal(result.reason, "previous-run-failed");
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit retry can recover from an assistant selector failure", async () => {
  const root = await fixture();
  try {
    const statePath = path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1, month: "2026-08", status: "needs_review", reason: "assistant-selector-missing"
    }));
    let calls = 0;
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      retry: true,
      bridgeGapMs: 0,
      runBridge: async (_prompt, options) => {
        calls += 1;
        return { result: { status: "succeeded", runId: `run-${options.understandingPart}`, text: "全量内容" } };
      }
    });
    assert.equal(result.status, "succeeded");
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an interrupted or validated run never resubmits without explicit retry", async () => {
  const root = await fixture();
  try {
    const statePath = path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, month: "2026-08", status: "running" }));
    let called = false;
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      runBridge: async () => { called = true; return { result: { status: "succeeded", text: "unexpected" } }; }
    });
    assert.equal(result.reason, "previous-run-uncertain");
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local cooldown short-circuits before the bridge is called", async () => {
  const root = await fixture();
  try {
    const statePath = path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1, month: "2026-08", status: "needs_review", reason: "local-rate-limit-cooldown",
      retryNotBefore: Date.now() + 60_000, completedAt: new Date().toISOString()
    }));
    let called = false;
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      retry: true,
      runBridge: async () => { called = true; return { result: { status: "succeeded" } }; }
    });
    assert.equal(result.reason, "local-rate-limit-cooldown");
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful output updates both files and writes the complete diff", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "01_core/ChatGPT-自我阅读版.md"), "旧\n");
    await writeFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), "旧记忆\n");
    const prompts = [];
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 0,
      runBridge: async (prompt, options) => {
        prompts.push({ prompt, part: options.understandingPart });
        return { result: {
          status: "succeeded",
          runId: `run-${options.understandingPart}`,
          text: options.understandingPart === "self" ? "模型自定结构\n新增一项" : "模型自定结构\n新记忆"
        }, prompt
        };
      }
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(prompts.map(({ part }) => part), ["self", "memory"]);
    assert.doesNotMatch(prompts[1].prompt, /旧/);
    assert.equal("selfReading" in result, false);
    assert.equal("diff" in result, false);
    assert.match(result.files.diff, /chatgpt-understanding\.diff\.md$/);
    const diff = await readFile(result.files.diff, "utf8");
    assert.match(diff, /--- previous/);
    assert.match(diff, /\+模型自定结构/);
    assert.doesNotMatch(prompts[0].prompt, /旧自我阅读版/);
    assert.match(await readFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), "utf8"), /新记忆/);
    const state = JSON.parse(await readFile(path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json"), "utf8"));
    assert.equal(state.outputSha256.self, sha256((await readFile(path.join(root, "01_core/ChatGPT-自我阅读版.md"), "utf8")).trim()));
    assert.equal(state.outputSha256.memory, sha256((await readFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), "utf8")).trim()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a legacy successful state skips the bridge when outputs are unchanged", async () => {
  const root = await fixture();
  try {
    const selfPath = path.join(root, "01_core/ChatGPT-自我阅读版.md");
    const memoryPath = path.join(root, "01_core/memory/ChatGPT-AI记忆版.md");
    const self = "稳定自我阅读版";
    const memory = "稳定 AI 记忆版";
    await writeFile(selfPath, `${self}\n`);
    await writeFile(memoryPath, `${memory}\n`);
    const statePath = path.join(root, "04_output/_dist/monthly/2026-08/chatgpt-understanding.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1, month: "2026-08", status: "succeeded",
      outputSha256: { self: sha256(self), memory: sha256(memory) }
    }));
    let called = false;
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      runBridge: async () => { called = true; return { result: { status: "succeeded" } }; }
    });
    assert.equal(result.status, "skipped");
    assert.equal(called, false);
    assert.deepEqual(result.files, { self: selfPath, memory: memoryPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic redaction removes sensitive output before writing", async () => {
  const root = await fixture();
  try {
    const fakePhone = "138" + "00138000"; // 标准假号，仅用于验证脱敏
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 0,
      runBridge: async () => ({ result: {
        status: "succeeded",
        runId: "run-3",
        text: `<SELF_READING>手机号：${fakePhone}</SELF_READING><AI_MEMORY>安全</AI_MEMORY>`
      } })
    });
    assert.equal(result.status, "succeeded");
    assert.match(await readFile(path.join(root, "01_core/ChatGPT-自我阅读版.md"), "utf8"), /已脱敏手机号/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diff is explicit when a file has no previous version", () => {
  assert.match(diffLines("", "新的一行\n"), /\+新的一行/);
});

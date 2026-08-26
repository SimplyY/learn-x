import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPrompt,
  DEFAULT_BRIDGE_GAP_MS,
  diffLines,
  exportChatgptUnderstanding,
  extractOutput,
  validateOutputs
} from "./export-chatgpt-understanding.mjs";

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

test("uses a five-minute gap between independent bridge prompts", async () => {
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
    assert.equal(DEFAULT_BRIDGE_GAP_MS, 300_000);
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

test("successful output updates both files and exposes the complete diff", async () => {
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
    assert.match(result.diff, /--- previous/);
  assert.match(result.diff, /\+模型自定结构/);
    assert.doesNotMatch(prompts[0].prompt, /旧自我阅读版/);
    assert.match(await readFile(path.join(root, "01_core/memory/ChatGPT-AI记忆版.md"), "utf8"), /新记忆/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic redaction removes sensitive output before writing", async () => {
  const root = await fixture();
  try {
    const result = await exportChatgptUnderstanding({
      repoRoot: root,
      month: "2026-08",
      bridgeGapMs: 0,
      runBridge: async () => ({ result: {
        status: "succeeded",
        runId: "run-3",
        text: "<SELF_READING>手机号：13800138000</SELF_READING><AI_MEMORY>安全</AI_MEMORY>"
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

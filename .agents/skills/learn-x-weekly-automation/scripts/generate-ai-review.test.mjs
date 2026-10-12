import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildReviewPrompt,
  confirmManualAiReview,
  DEFAULT_BRIDGE_TIMEOUT_MS,
  generateAiReview,
  manualAiShell,
  normalizeAiReviewText,
  promoteAiReview,
  runBridgeCli,
  sha256,
  stripOuterMarkdownFence
} from "./generate-ai-review.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-ai-review-"));
  await writeFile(path.join(root, "03-input-placeholder"), "", "utf8").catch(() => {});
  await writeFile(path.join(root, "unused"), "", "utf8").catch(() => {});
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, "03_input/weekly/00_template"), { recursive: true }));
  await writeFile(path.join(root, "03_input/weekly/00_template/ai.md"), "# AI 对话提示词", "utf8");
  return root;
}

const validReview = "# Learn-X 周回顾\n\n## 具体的人和事（独立主线，优先保留）\n\n本周未发现可可靠提炼的具体人/事。\n\n## 本周议题\n\n真实判断\n\n## 精华议题摘要\n\n真实答案";

test("bridge adapter timeout covers the Bridge protocol budget", () => {
  assert.ok(DEFAULT_BRIDGE_TIMEOUT_MS >= 210_000);
});

test("Bridge adapter passes the preallocated stable run ID through its CLI", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridgePath = path.join(root, "bridge-stub.mjs");
  await writeFile(bridgePath, "const index = process.argv.indexOf('--run-id'); const urlIndex = process.argv.indexOf('--conversation-url'); process.stdout.write(JSON.stringify({ status: 'needs_review', runId: process.argv[index + 1], conversationUrl: process.argv[urlIndex + 1] }) + '\\n');\n", "utf8");
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  const conversationUrl = "https://chatgpt.com/";
  const result = await runBridgeCli("synthetic prompt", { bridgePath, preallocatedRunId: runId, conversationUrl });
  assert.equal(result.result.runId, runId);
  assert.equal(result.result.conversationUrl, conversationUrl);
});

test("manual fallback shell is stable and does not contain the prompt", () => {
  assert.equal(manualAiShell("2026-W27"), "# AI 周回顾｜2026-W27\n\n<!-- 手动完成后，将 ChatGPT 返回的完整 Markdown 正文粘贴到这里；不要粘贴提示词或外层代码块。 -->\n");
});

test("confirms a valid user-completed manual fallback without resubmitting or rewriting ai.md", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W27";
  const weekDir = path.join(root, "03_input/weekly", week);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
  const formalPath = path.join(weekDir, "ai.md");
  const manualText = `${validReview}\n`;
  const manualPrompt = buildReviewPrompt("# 原有提示词", week);
  await writeFile(formalPath, manualText, "utf8");
  await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
    schemaVersion: 1, targetWeek: week, status: "needs_review", reason: "snapshot-mismatch",
    manualPrompt, manualPath: formalPath, source: "chatgpt-web-bridge"
  }), "utf8");

  const first = await confirmManualAiReview({ repoRoot: root, week, confirm: true });
  assert.equal(first.status, "confirmed");
  assert.equal(first.completionSource, "user-manual");
  assert.equal(first.manualConfirmation.sha256, sha256(manualText));
  assert.equal(await readFile(formalPath, "utf8"), manualText);

  const second = await confirmManualAiReview({ repoRoot: root, week, confirm: true });
  assert.equal(second.status, "confirmed");
  assert.equal(second.alreadyConfirmed, true);
  assert.equal(await readFile(formalPath, "utf8"), manualText);
});

test("manual confirmation requires explicit confirmation, a valid fallback state, and valid AI structure", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W27";
  const weekDir = path.join(root, "03_input/weekly", week);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
  const formalPath = path.join(weekDir, "ai.md");
  await writeFile(formalPath, "# incomplete", "utf8");
  await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
    schemaVersion: 1, targetWeek: week, status: "needs_review", reason: "snapshot-mismatch",
    manualPrompt: "manual prompt", manualPath: formalPath
  }), "utf8");

  await assert.rejects(() => confirmManualAiReview({ repoRoot: root, week, confirm: false }), /manual-confirmation-requires-explicit-confirmation/);
  await assert.rejects(() => confirmManualAiReview({ repoRoot: root, week, confirm: true }), /manual-ai-review-invalid/);
  const sidecar = JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8"));
  assert.equal(sidecar.status, "needs_review", "invalid manual content must not change workflow status");
});

test("template keeps people-and-events as an independent evidence-first axis", async () => {
  const template = await readFile(new URL("../../../../03_input/weekly/00_template/ai.md", import.meta.url), "utf8");
  assert.match(template, /## 具体的人和事（独立主线，优先保留）/);
  assert.match(template, /先做两次独立扫描/);
  assert.match(template, /截图是证据/);
  assert.match(template, /AI 推测\/待确认/);
  assert.match(template, /不得自行翻译或创造别名/);
  assert.match(template, /没有足够材料时写/);
});

test("builds target-week prompt and strips only the outer markdown fence", () => {
  const prompt = buildReviewPrompt("# 原有提示词", "2026-W27");
  assert.match(prompt, /2026-W27/);
  assert.match(prompt, /## 本周议题/);
  assert.match(prompt, /## 精华议题摘要/);
  assert.equal(stripOuterMarkdownFence("```markdown\n正文\n```"), "正文");
  assert.equal(stripOuterMarkdownFence("正文\n```代码```"), "正文\n```代码```");
  const normalized = normalizeAiReviewText("具体的人和事（独立主线，优先保留）\n\n本周反复思考的核心问题\n\n真实判断\n\n精华问题摘要\n\n真实答案");
  assert.match(normalized, /^## 具体的人和事/m);
  assert.match(normalized, /## 本周议题/);
  assert.match(normalized, /## 精华议题摘要/);
  assert.doesNotMatch(normalized, /核心问题|精华问题摘要/);
  assert.match(normalizeAiReviewText("精华议题摘要\n\n真实判断"), /^## 精华议题摘要/m);
});

test("auto-confirms a valid generated draft into formal ai.md", async () => {
  const root = await fixture();
  try {
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-1", text: `\`\`\`markdown\n${validReview}\n\`\`\`` } })
    });
    assert.equal(result.status, "confirmed");
    assert.equal(await readFile(path.join(root, "03_input/weekly/2026-W27/ai.md"), "utf8"), `${validReview}\n`);
    assert.equal(await readdir(path.join(root, "03_input/weekly/2026-W27")).then((files) => files.includes("ai.generated.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not resend after an automatically confirmed draft", async () => {
  const root = await fixture();
  try {
    let calls = 0;
    const options = { repoRoot: root, week: "2026-W27", runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-1", text: validReview } }; } };
    assert.equal((await generateAiReview(options)).status, "confirmed");
    assert.equal((await generateAiReview(options)).status, "confirmed");
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only retries explicitly approved pre-submit environment failures", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({ status: "needs_review", reason: "ego-bootstrap-permission", manualPrompt: "fallback" }), "utf8");
    let calls = 0;
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      retry: true,
      runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-retry", text: validReview } }; }
    });
    assert.equal(result.status, "confirmed");
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lets an explicit retry re-check an expired local cooldown", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({ status: "needs_review", reason: "local-rate-limit-cooldown", manualPrompt: "fallback" }), "utf8");
    let calls = 0;
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      retry: true,
      runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-cooldown-retry", text: validReview } }; }
    });
    assert.equal(result.status, "confirmed");
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a saved invalid draft after deterministic heading normalization", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const recoverable = "具体的人和事（独立主线，优先保留）\n\n本周发生了一件事。\n\n## 本周反复思考的核心问题\n\n真实判断";
    const template = await readFile(path.join(root, "03_input/weekly/00_template/ai.md"), "utf8");
    const prompt = buildReviewPrompt(template, "2026-W27");
    await writeFile(path.join(weekDir, "_ai-invalid.generated.md"), `${recoverable}\n`, "utf8");
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({ status: "needs_review", reason: "invalid-ai-review", promptSha256: sha256(prompt), runId: "run-invalid", conversationUrl: "https://chatgpt.com/c/invalid", manualPrompt: prompt }), "utf8");
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => { throw new Error("should-not-resubmit"); }
    });
    assert.equal(result.status, "confirmed");
    assert.equal(result.recoveredFrom.endsWith("_ai-invalid.generated.md"), true);
    assert.match(await readFile(path.join(weekDir, "ai.md"), "utf8"), /^## 具体的人和事/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not resend after a submitted but uncertain result", async () => {
  const root = await fixture();
  try {
    let calls = 0;
    const options = {
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => {
        calls += 1;
        return { result: { status: "needs_review", runId: "run-timeout", reason: "observer-timeout" } };
      }
    };
    const first = await generateAiReview(options);
    const second = await generateAiReview({ ...options, retry: true });
    assert.equal(first.status, "needs_review");
    assert.equal(first.reason, "observer-timeout");
    assert.equal(second.reason, "previous-run-needs-review");
    assert.equal(calls, 1);
    assert.equal(await readFile(path.join(root, "03_input/weekly/2026-W27/ai.md"), "utf8"), manualAiShell("2026-W27"));
    assert.match(second.manualPrompt, /目标回顾周期：2026-W27/);
    assert.equal(await readdir(path.join(root, "03_input/weekly/2026-W27")).then((files) => files.includes("ai.generated.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists dispatch intent before Bridge submit and never resubmits when the returned run identity is missing", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const sidecarPath = path.join(root, "03_input/weekly", week, "_ai-generated.json");
    let calls = 0;
    const first = await generateAiReview({
      repoRoot: root, week,
      runBridge: async (_prompt, bridgeOptions) => {
        calls += 1;
        const started = JSON.parse(await readFile(sidecarPath, "utf8"));
        assert.equal(started.status, "dispatching");
        assert.equal(started.dispatchState, "started");
        assert.ok(started.localAttemptId);
        assert.equal(started.runId, started.localAttemptId);
        assert.equal(started.conversationUrl, "https://chatgpt.com/");
        assert.equal(bridgeOptions.preallocatedRunId, started.runId);
        assert.equal(bridgeOptions.conversationUrl, started.conversationUrl);
        return { result: null, exit: { timedOut: true } };
      }
    });
    assert.equal(first.status, "needs_review");
    assert.equal(first.submissionStateUncertain, true);
    assert.equal(first.reason, "bridge-timeout");
    let observations = 0;
    let observedRunId;
    const second = await generateAiReview({
      repoRoot: root, week, observeUncertain: true, retry: true,
      observeBridge: async (previous) => { observations += 1; observedRunId = previous.runId; return { result: { status: "needs_review", runId: previous.runId, reason: "observer-window-ended" } }; },
      runBridge: async () => { calls += 1; throw new Error("must not resend"); }
    });
    assert.equal(second.status, "needs_review");
    assert.equal(second.submissionStateUncertain, true);
    assert.equal(calls, 1);
    assert.equal(observations, 1);
    assert.equal(observedRunId, first.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a legacy crash after persisting dispatch intent blocks observe and resubmit without a stable Bridge run ID", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "dispatching", dispatchState: "started", localAttemptId: "local-attempt-1", promptSha256: "synthetic"
    }), "utf8");
    let observations = 0;
    let submissions = 0;
    const result = await generateAiReview({
      repoRoot: root, week, observeUncertain: true,
      observeBridge: async () => { observations += 1; return { result: { status: "succeeded" } }; },
      runBridge: async () => { submissions += 1; return { result: { status: "succeeded" } }; }
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.reason, "dispatch-receipt-missing");
    assert.equal(observations, 0);
    assert.equal(submissions, 0);
    assert.equal(JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8")).dispatchState, "uncertain");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observes a stable Bridge run ID after a crash between dispatch intent and receipt", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "dispatching", dispatchState: "started", localAttemptId: runId, runId, promptSha256: "synthetic",
      callerLabel: "learn-x:weekly-ai", conversationUrl: "https://chatgpt.com/"
    }), "utf8");
    let observations = 0;
    let submissions = 0;
    const result = await generateAiReview({
      repoRoot: root, week, observeUncertain: true,
      observeBridge: async (previous) => {
        observations += 1;
        assert.equal(previous.runId, runId);
        return { result: { status: "succeeded", runId, conversationUrl: "https://chatgpt.com/c/recovered", text: validReview } };
      },
      runBridge: async () => { submissions += 1; throw new Error("must-not-resubmit"); }
    });
    assert.equal(result.status, "confirmed");
    assert.equal(observations, 1);
    assert.equal(submissions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not guess a missing conversation URL for a legacy interrupted dispatch", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "dispatching", dispatchState: "started", localAttemptId: runId, runId,
      promptSha256: "synthetic", callerLabel: "learn-x:weekly-ai"
    }), "utf8");
    let observations = 0;
    const result = await generateAiReview({
      repoRoot: root, week, observeUncertain: true,
      observeBridge: async () => { observations += 1; return { result: { status: "succeeded", runId, text: validReview } }; },
      runBridge: async () => { throw new Error("must-not-resubmit"); }
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.reason, "bridge-conversation-url-missing");
    assert.equal(observations, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observes the original uncertain Bridge run and formalizes its returned result without resubmitting", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const template = await readFile(path.join(root, "03_input/weekly/00_template/ai.md"), "utf8");
    const prompt = buildReviewPrompt(template, week);
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    const conversationUrl = "https://chatgpt.com/c/ai-observed";
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "needs_review", targetWeek: week, promptSha256: sha256(prompt), runId, conversationUrl,
      callerLabel: "learn-x:weekly-ai", reason: "observer-window-ended", manualPrompt: prompt
    }));
    let observed = 0;
    let submitted = 0;
    const result = await generateAiReview({
      repoRoot: root, week, observeUncertain: true,
      observeBridge: async (previous, options) => {
        observed += 1;
        assert.equal(previous.runId, runId);
        assert.equal(options.observeUncertain, true);
        return { result: { status: "succeeded", runId, conversationUrl, text: validReview, format: "markdown" } };
      },
      runBridge: async () => { submitted += 1; throw new Error("must-not-resubmit"); }
    });
    assert.equal(observed, 1);
    assert.equal(submitted, 0);
    assert.equal(result.status, "confirmed");
    assert.equal(result.runId, runId);
    assert.equal(await readFile(path.join(weekDir, "ai.md"), "utf8"), `${validReview}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records an unsuccessful observe-only check without resubmitting", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const template = await readFile(path.join(root, "03_input/weekly/00_template/ai.md"), "utf8");
    const prompt = buildReviewPrompt(template, week);
    const runId = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "needs_review", targetWeek: week, promptSha256: sha256(prompt), runId,
      conversationUrl: "https://chatgpt.com/c/ai-observed", reason: "observer-window-ended", manualPrompt: prompt
    }));
    let submitted = 0;
    const result = await generateAiReview({
      repoRoot: root, week, observeUncertain: true,
      observeBridge: async () => ({ result: { status: "needs_review", runId, reason: "chatgpt-rate-limited", diagnostics: { rateLimited: true } } }),
      runBridge: async () => { submitted += 1; }
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.observation.reason, "chatgpt-rate-limited");
    assert.equal(submitted, 0);
    assert.equal(JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8")).observation.status, "needs_review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("allows one explicitly confirmed retry only for this exact complete snapshot mismatch", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const template = await readFile(path.join(root, "03_input/weekly/00_template/ai.md"), "utf8");
    const prompt = buildReviewPrompt(template, week);
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "needs_review", targetWeek: week, promptSha256: sha256(prompt), runId: "old-run",
      reason: "snapshot-mismatch", completedAt: "2026-10-11T21:05:45.951Z",
      diagnostics: { conversationMatched: true, promptSeen: true, assistantPresent: true, outputReady: true, markersSeen: true, stop: false, rateLimited: false, stableReadCount: 8, snapshot: { ok: false } }
    }));
    let calls = 0;
    const result = await generateAiReview({
      repoRoot: root, week, resubmitUncertain: true, confirm: true,
      runBridge: async () => {
        calls += 1;
        const started = JSON.parse(await readFile(path.join(weekDir, "_ai-generated.json"), "utf8"));
        assert.equal(started.reason, "uncertain-resubmission-in-progress", "persist the one-shot guard before external submission");
        assert.equal(started.resubmissionOf.runId, "old-run");
        return { result: { status: "succeeded", runId: "new-run", text: validReview } };
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "confirmed");
    assert.equal(result.runId, "new-run");
    assert.equal(result.resubmissionOf.runId, "old-run");
    const repeated = await generateAiReview({ repoRoot: root, week, resubmitUncertain: true, confirm: true, runBridge: async () => { calls += 1; } });
    assert.equal(repeated.status, "confirmed", "a completed resubmission is idempotently observed");
    assert.equal(calls, 1, "a repeated call does not submit another external request");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires explicit confirmation and refuses unrelated uncertain states", async () => {
  const root = await fixture();
  try {
    const week = "2026-W27";
    const weekDir = path.join(root, "03_input/weekly", week);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const template = await readFile(path.join(root, "03_input/weekly/00_template/ai.md"), "utf8");
    const prompt = buildReviewPrompt(template, week);
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({
      status: "needs_review", targetWeek: week, promptSha256: sha256(prompt), runId: "old-run",
      reason: "observer-timeout", diagnostics: { outputReady: true, snapshot: { ok: false }, stableReadCount: 8 }
    }));
    let calls = 0;
    await assert.rejects(() => generateAiReview({ repoRoot: root, week, resubmitUncertain: true, runBridge: async () => { calls += 1; } }), /requires-confirmed/);
    await assert.rejects(() => generateAiReview({ repoRoot: root, week, resubmitUncertain: true, confirm: true, runBridge: async () => { calls += 1; } }), /eligible/);
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves substantive manual ai.md when automatic review needs review", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    const manual = "# 人工周回顾\n\n这是用户已经写好的内容。\n";
    await writeFile(path.join(weekDir, "ai.md"), manual, "utf8");
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "needs_review", runId: "run-manual", reason: "observer-window-ended" } })
    });
    assert.equal(result.status, "needs_review");
    assert.equal(await readFile(path.join(weekDir, "ai.md"), "utf8"), manual);
    assert.equal(result.manualPath, path.join(weekDir, "ai.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid output and returns the manual fallback prompt", async () => {
  const root = await fixture();
  try {
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-2", text: "不完整" } })
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.reason, "invalid-ai-review");
    assert.match(result.manualPrompt, /原有提示词开始/);
    assert.equal(await readFile(path.join(root, "03_input/weekly/2026-W27/ai.md"), "utf8"), manualAiShell("2026-W27"));
    assert.deepEqual(result.validation, ["placeholder", "too-few-sections", "missing-people-and-events", "missing-review-content"]);
    assert.equal(await readFile(path.join(root, "03_input/weekly/2026-W27/_ai-invalid.generated.md"), "utf8"), "不完整\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects output over the 15000-character boundary", async () => {
  const root = await fixture();
  try {
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-large", text: `${validReview}\n${"x".repeat(15_000)}` } })
    });
    assert.equal(result.status, "needs_review");
    assert.equal(result.reason, "ai-review-too-large");
    assert.equal(await readdir(path.join(root, "03_input/weekly/2026-W27")).then((files) => files.includes("ai.generated.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promotes a confirmed draft and backs up substantive ai.md", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    await writeFile(path.join(weekDir, "ai.md"), "# 旧的人工回顾\n\n保留证据", "utf8");
    const generated = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-3", text: validReview } })
    });
    assert.equal(generated.status, "confirmed");
    assert.equal(await readFile(path.join(weekDir, "ai.md"), "utf8"), `${validReview}\n`);
    assert.equal(sha256(validReview), generated.outputSha256);
    const archive = await readdir(path.join(root, "04_output/_dist/weekly/2026-W27"));
    assert.equal(archive.some((file) => file.startsWith("ai.previous.")), true);
    assert.equal(archive.some((file) => file.startsWith("ai.generated.") && file.endsWith(".md")), true);
    assert.equal(generated.auditPath.endsWith(".md"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses promotion after the generated draft is tampered with", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(weekDir, { recursive: true }));
    await writeFile(path.join(weekDir, "ai.generated.md"), `${validReview}\n`, "utf8");
    await writeFile(path.join(weekDir, "_ai-generated.json"), JSON.stringify({ status: "generated", outputSha256: sha256(validReview) }), "utf8");
    await writeFile(path.join(weekDir, "ai.generated.md"), `${validReview}\n篡改`, "utf8");
    await assert.rejects(() => promoteAiReview({ repoRoot: root, week: "2026-W27", confirm: true }), /integrity/);
    assert.equal(await readFile(path.join(weekDir, "ai.generated.md"), "utf8"), `${validReview}\n篡改`);
    assert.equal(await readdir(weekDir).then((files) => files.includes("ai.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

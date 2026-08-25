import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildReviewPrompt,
  generateAiReview,
  normalizeAiReviewText,
  promoteAiReview,
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

const validReview = "# Learn-X 周回顾\n\n## 具体的人和事（独立主线，优先保留）\n\n本周未发现可可靠提炼的具体人/事。\n\n## 本周反复思考的核心问题\n\n真实判断\n\n## 精华问题摘要\n\n真实答案";

test("template keeps people-and-events as an independent evidence-first axis", async () => {
  const template = await readFile(new URL("../../../../03_input/weekly/00_template/ai.md", import.meta.url), "utf8");
  assert.match(template, /## 具体的人和事（独立主线，优先保留）/);
  assert.match(template, /先做两次独立扫描/);
  assert.match(template, /截图是证据/);
  assert.match(template, /AI 推测\/待确认/);
  assert.match(template, /没有足够材料时写/);
});

test("builds target-week prompt and strips only the outer markdown fence", () => {
  const prompt = buildReviewPrompt("# 原有提示词", "2026-W27");
  assert.match(prompt, /2026-W27/);
  assert.match(prompt, /## 具体的人和事（独立主线，优先保留）/);
  assert.equal(stripOuterMarkdownFence("```markdown\n正文\n```"), "正文");
  assert.equal(stripOuterMarkdownFence("正文\n```代码```"), "正文\n```代码```");
  assert.match(normalizeAiReviewText("具体的人和事（独立主线，优先保留）\n\n本周反复思考的核心问题\n\n真实判断\n\n精华问题摘要\n\n真实答案"), /^## 具体的人和事/m);
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
    assert.equal(await readdir(path.join(root, "03_input/weekly/2026-W27")).then((files) => files.includes("ai.generated.md")), false);
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

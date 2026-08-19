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

const validReview = "# Learn-X 周回顾\n\n## 本周反复思考的核心问题\n\n真实判断\n\n## 精华问题摘要\n\n真实答案";

test("builds target-week prompt and strips only the outer markdown fence", () => {
  const prompt = buildReviewPrompt("# 原有提示词", "2026-W27");
  assert.match(prompt, /2026-W27/);
  assert.equal(stripOuterMarkdownFence("```markdown\n正文\n```"), "正文");
  assert.equal(stripOuterMarkdownFence("正文\n```代码```"), "正文\n```代码```");
  assert.match(normalizeAiReviewText("本周反复思考的核心问题\n\n真实判断\n\n精华问题摘要\n\n真实答案"), /^## 本周反复思考的核心问题/m);
});

test("writes a generated draft and sidecar without touching formal ai.md", async () => {
  const root = await fixture();
  try {
    const result = await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-1", text: `\`\`\`markdown\n${validReview}\n\`\`\`` } })
    });
    assert.equal(result.status, "generated");
    assert.equal(await readFile(path.join(root, "03_input/weekly/2026-W27/ai.generated.md"), "utf8"), `${validReview}\n`);
    assert.equal(await readdir(path.join(root, "03_input/weekly/2026-W27")).then((files) => files.includes("ai.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not resend while a draft is pending", async () => {
  const root = await fixture();
  try {
    let calls = 0;
    const options = { repoRoot: root, week: "2026-W27", runBridge: async () => { calls += 1; return { result: { status: "succeeded", runId: "run-1", text: validReview } }; } };
    assert.equal((await generateAiReview(options)).status, "generated");
    assert.equal((await generateAiReview(options)).reason, "pending-review");
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
    assert.equal(result.status, "generated");
    assert.equal(calls, 1);
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
    await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-3", text: validReview } })
    });
    const result = await promoteAiReview({ repoRoot: root, week: "2026-W27", confirm: true });
    assert.equal(result.status, "confirmed");
    assert.equal(await readFile(path.join(weekDir, "ai.md"), "utf8"), `${validReview}\n`);
    assert.equal(sha256(validReview), result.outputSha256);
    const archive = await readdir(path.join(root, "04_output/_dist/weekly/2026-W27"));
    assert.equal(archive.some((file) => file.startsWith("ai.previous.")), true);
    assert.equal(archive.some((file) => file.startsWith("ai.generated.") && file.endsWith(".md")), true);
    assert.equal(result.auditPath.endsWith(".md"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses promotion after the generated draft is tampered with", async () => {
  const root = await fixture();
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W27");
    await generateAiReview({
      repoRoot: root,
      week: "2026-W27",
      runBridge: async () => ({ result: { status: "succeeded", runId: "run-4", text: validReview } })
    });
    await writeFile(path.join(weekDir, "ai.generated.md"), `${validReview}\n篡改`, "utf8");
    await assert.rejects(() => promoteAiReview({ repoRoot: root, week: "2026-W27", confirm: true }), /integrity/);
    assert.equal(await readFile(path.join(weekDir, "ai.generated.md"), "utf8"), `${validReview}\n篡改`);
    assert.equal(await readdir(weekDir).then((files) => files.includes("ai.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

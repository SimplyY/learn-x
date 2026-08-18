import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyCompressionReview, createCompressionReview } from "./compress-weekly-input.mjs";

test("creates a review candidate without touching the original Voice-X input", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-compress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W33");
  await mkdir(weekRoot, { recursive: true });
  const source = [
    "# Voice-X 核心重点｜2026-W33",
    "",
    "## with 测试",
    "",
    "# 核心总结",
    "保留核心。",
    "",
    "# 对我的建议",
    "排除建议。",
    "",
    "# 压缩原文",
    "排除全文。".repeat(4_000)
  ].join("\n");
  await writeFile(path.join(weekRoot, "voice.md"), source, "utf8");
  const result = await createCompressionReview({ week: "2026-W33", root });
  const candidate = result.manifest.entries[0].candidate;
  assert.ok(candidate);
  assert.ok(candidate.chars <= 15_000);
  assert.match(await readFile(path.join(root, candidate.path), "utf8"), /保留核心/);
  assert.doesNotMatch(await readFile(path.join(root, candidate.path), "utf8"), /排除建议|排除全文/);
  assert.equal(await readFile(path.join(weekRoot, "voice.md"), "utf8"), source);
});

test("requires explicit confirmation before applying candidates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-compress-confirm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "03_input/weekly/2026-W33"), { recursive: true });
  await writeFile(path.join(root, "03_input/weekly/2026-W33/voice.md"), "x".repeat(15_001), "utf8");
  await createCompressionReview({ week: "2026-W33", root });
  await assert.rejects(applyCompressionReview({ week: "2026-W33", root }), /--confirm/);
});

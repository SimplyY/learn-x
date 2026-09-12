import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyCompressionReview, createCompressionReview } from "./compress-weekly-input.mjs";

test("does not create an early Voice-X compression candidate", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-compress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W33");
  await mkdir(weekRoot, { recursive: true });
  const source = [
    "# Voice-X 核心重点｜2026-W33",
    "",
    "## with 测试",
    "",
    "## 核心总结",
    "保留核心。",
    "",
    "## 对我的建议",
    "保留建议。",
    "",
    "## 压缩原文",
    "保留原文要点。".repeat(4_000)
  ].join("\n");
  await writeFile(path.join(weekRoot, "voice.md"), source, "utf8");
  const result = await createCompressionReview({ week: "2026-W33", root });
  assert.equal(result.overLimitCount, 0);
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

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWeeklyImagePrompt,
  generateWeeklyImage,
  imageDataUrl,
  weeklyOutputPath
} from "./generate-weekly-image.mjs";
import { DEFAULT_BRIDGE_TIMEOUT_MS, IMAGE_BRIDGE_TIMEOUT_MS } from "./generate-ai-review.mjs";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const weeklyOutput = `# Weekly Output｜2026-W38

## 9. 人工确认清单

* [ ] Memory：未勾选条目不进入提示词。

## 11. 全文核心重点纪要

1. 核心纪要第一条，真实判断。
2. 核心纪要第二条，真实边界。

## 12. 芒格之魂的洞察

1. 洞察第一条，真实反转。

## 13. 本周最值得思考的 3 个问题与回答

1. **问题：真实问题？**
   回答：真实回答。
`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-image-"));
  await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  await writeFile(path.join(root, "04_output/weekly/2026-38.md"), weeklyOutput, "utf8");
  return root;
}

function succeedingBridge(options = {}) {
  const calls = [];
  return {
    calls,
    runBridge: async (prompt, bridgeOptions) => {
      calls.push({ prompt, options: bridgeOptions });
      return { result: { status: "succeeded", runId: "run-image-1", imageBase64: options.imageBase64 || PNG_DATA_URL } };
    }
  };
}

test("image bridge budget covers the image observation window", () => {
  assert.ok(IMAGE_BRIDGE_TIMEOUT_MS >= 690_000);
  assert.ok(IMAGE_BRIDGE_TIMEOUT_MS > DEFAULT_BRIDGE_TIMEOUT_MS);
});

test("builds portrait prompt from substantive core sections only", async () => {
  const { extractRequiredSections } = await import("../../learn-x-process/scripts/prepare-weekly-memory.mjs");
  const prompt = buildWeeklyImagePrompt(extractRequiredSections(weeklyOutput));
  assert.match(prompt, /要求竖屏，不要横屏/);
  assert.match(prompt, /全文核心重点纪要/);
  assert.match(prompt, /核心纪要第一条，真实判断。/);
  assert.match(prompt, /芒格之魂的洞察/);
  assert.match(prompt, /洞察第一条，真实反转。/);
  assert.doesNotMatch(prompt, /未勾选条目不进入提示词/);
  assert.doesNotMatch(prompt, /真实问题/);
  assert.throws(() => buildWeeklyImagePrompt({ coreSummary: [], mungerInsights: [] }), /no-substantive-core-content/);
});

test("generates the weekly core image from bridge bytes and records hash", async () => {
  const root = await fixture();
  try {
    const { calls, runBridge } = succeedingBridge();
    const result = await generateWeeklyImage({ repoRoot: root, week: "2026-W38", runBridge });
    assert.equal(result.status, "succeeded");
    assert.equal(result.imageFormat, "png");
    assert.equal(result.imageBytes, 70);
    assert.match(result.imageSha256, /^[0-9a-f]{64}$/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.image, true);
    const saved = await stat(result.outputPath);
    assert.ok(saved.isFile() && saved.size > 0);
    const written = await readFile(result.outputPath);
    assert.equal(written.length, 70);
    assert.match(result.outputPath, /04_output\/_dist\/weekly\/2026-W38\/weekly-core\.png$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("treats an existing non-empty image as already-success and never overwrites it", async () => {
  const root = await fixture();
  try {
    const outputDir = path.join(root, "04_output/_dist/weekly/2026-W38");
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "weekly-core.png");
    await writeFile(outputPath, "existing-bytes", "utf8");
    const { calls, runBridge } = succeedingBridge();
    const result = await generateWeeklyImage({ repoRoot: root, week: "2026-W38", runBridge });
    assert.equal(result.status, "succeeded");
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already-success");
    assert.equal(calls.length, 0);
    assert.equal(await readFile(outputPath, "utf8"), "existing-bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when the weekly output is missing or has no substantive core content", async () => {
  const root = await fixture();
  try {
    const missing = await generateWeeklyImage({ repoRoot: root, week: "2026-W99", runBridge: succeedingBridge().runBridge });
    assert.equal(missing.status, "failed");
    assert.match(missing.reason, /weekly-output-missing/);

    await writeFile(path.join(root, "04_output/weekly/2026-37.md"), "# Weekly Output｜2026-W37\n\ntodo\n", "utf8");
    const empty = await generateWeeklyImage({ repoRoot: root, week: "2026-W37", runBridge: succeedingBridge().runBridge });
    assert.equal(empty.status, "failed");
    assert.equal(empty.reason, "no-substantive-core-content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not write any bytes when the bridge fails or returns an invalid image", async () => {
  const root = await fixture();
  try {
    const failed = await generateWeeklyImage({
      repoRoot: root,
      week: "2026-W38",
      runBridge: async () => ({ result: { status: "needs_review", reason: "ego-bootstrap-permission", runId: "run-2" } })
    });
    assert.equal(failed.status, "needs_review");
    assert.equal(failed.reason, "ego-bootstrap-permission");

    const invalidBridge = succeedingBridge({ imageBase64: "data:text/plain;base64,bm90LWFuLWltYWdl" });
    const invalid = await generateWeeklyImage({
      repoRoot: root,
      week: "2026-W38",
      runBridge: invalidBridge.runBridge
    });
    assert.equal(invalid.status, "needs_review");
    assert.equal(invalid.reason, "invalid-image-output");

    const thrown = await generateWeeklyImage({
      repoRoot: root,
      week: "2026-W38",
      runBridge: async () => { throw new Error("spawn failed"); }
    });
    assert.equal(thrown.status, "needs_review");
    assert.match(thrown.reason, /spawn failed/);

    await assert.rejects(
      stat(path.join(root, "04_output/_dist/weekly/2026-W38/weekly-core.png")),
      /ENOENT/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("imageDataUrl parses image payloads and rejects everything else", () => {
  const parsed = imageDataUrl("data:image/jpeg;base64,AAEC");
  assert.equal(parsed.extension, "jpg");
  assert.deepEqual([...parsed.bytes], [0, 1, 2]);
  assert.equal(imageDataUrl("data:image/png;base64,"), null);
  assert.equal(imageDataUrl("not-a-data-url"), null);
  assert.equal(imageDataUrl(undefined), null);
});

test("weeklyOutputPath stays inside the weekly _dist product tree", () => {
  assert.match(weeklyOutputPath("/repo", "2026-W38"), /^\/repo\/04_output\/_dist\/weekly\/2026-W38\/weekly-core\.png$/);
});

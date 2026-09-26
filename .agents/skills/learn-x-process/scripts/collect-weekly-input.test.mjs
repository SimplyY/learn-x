import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { collectWeeklyInput, defaultWeeklyReviewWeek, filterFilesBySourceStatus, findOversizedWeeklyInputs, inputKindFromRelativePath, isIgnoredWeeklyInputFile, writeWeeklyInput } from "./collect-weekly-input.mjs";

test("defaults weekly review to previous week on weekdays and current week on weekends", () => {
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-03T04:00:00Z")), "2026-W26");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-04T04:00:00Z")), "2026-W27");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-06T04:00:00Z")), "2026-W27");
});

test("keeps source classification for weekly input files", () => {
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/coach.md"), {
    category: "action",
    source: "coach"
  });
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/wisdom.md"), {
    category: "input",
    source: "wisdom"
  });
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/feishu-docs.md"), {
    category: "inbox",
    source: "feishu-docs"
  });
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/jingdu.md"), {
    category: "inbox",
    source: "jingdu"
  });
});

test("keeps Time-X summaries as ordinary input", () => {
  assert.deepEqual(inputKindFromRelativePath("03_input/weekly/2026-W29/time.md"), {
    category: "input",
    source: "time"
  });
});

test("reports every oversized weekly input instead of truncating it", () => {
  const result = findOversizedWeeklyInputs([
    { path: "voice.md", content: "x".repeat(15_001) },
    { path: "daily.md", content: "ok" },
    { path: "flomo.md", content: "y".repeat(15_002) }
  ]);
  assert.deepEqual(result, [
    { path: "flomo.md", chars: 15_002 }
  ]);
});

test("keeps the full Voice-X record without a Process input gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-voice-limit-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "voice.md"), [
      "# Voice-X 核心重点｜2026-W29", "", "## with 测试", "", "## 核心总结", "", "内容。".repeat(3_000),
      "", "## 芒格之魂洞察", "", "洞察。"
    ].join("\n"), "utf8");
    const result = await collectWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.equal(result.files[0].path, "03_input/weekly/2026-W29/voice.md");
    assert.equal(result.items.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("excludes stale automatic files while keeping legacy files without status", () => {
  const files = [{ relativePath: "03_input/weekly/2026-W29/daily.md" }, { relativePath: "03_input/weekly/2026-W29/weekly.md" }];
  assert.deepEqual(filterFilesBySourceStatus(files, { daily: { file: "daily.md", status: "empty" } }), [files[1]]);
  assert.deepEqual(filterFilesBySourceStatus(files, {}), files);
});

test("blocks Process when Feishu Docs provenance needs review or the ready snapshot is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-docs-gate-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "feishu-docs.md"), "本人文档快照\n", "utf8");
    await writeFile(path.join(weekDir, "_source-status.json"), JSON.stringify({
      version: 1,
      week: "2026-W29",
      updatedAt: "2026-07-20T00:00:00.000Z",
      sources: {
        "feishu-docs": {
          status: "needs_review", file: "feishu-docs.md", count: 1,
          summary: "编辑者身份待核对", updatedAt: "2026-07-20T00:00:00.000Z", preservedStaleFile: false
        }
      }
    }), "utf8");
    await assert.rejects(() => collectWeeklyInput({ repoRoot: root, week: "2026-W29" }), /已阻止生成 Weekly Process/);

    const ready = JSON.parse(await readFile(path.join(weekDir, "_source-status.json"), "utf8"));
    ready.sources["feishu-docs"].status = "ready";
    await writeFile(path.join(weekDir, "_source-status.json"), JSON.stringify(ready), "utf8");
    await rm(path.join(weekDir, "feishu-docs.md"));
    await assert.rejects(() => collectWeeklyInput({ repoRoot: root, week: "2026-W29" }), /ready，但本轮文件缺失/);

    await writeFile(path.join(weekDir, "feishu-docs.md"), "x".repeat(15_001), "utf8");
    ready.sources["feishu-docs"].status = "ready";
    await writeFile(path.join(weekDir, "_source-status.json"), JSON.stringify(ready), "utf8");
    await assert.rejects(() => collectWeeklyInput({ repoRoot: root, week: "2026-W29" }), /超过单文件上限 15000 字符/);

    ready.sources = {};
    await writeFile(path.join(weekDir, "_source-status.json"), JSON.stringify(ready), "utf8");
    await assert.rejects(() => collectWeeklyInput({ repoRoot: root, week: "2026-W29" }), /缺少本轮来源状态/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the unconfirmed AI draft out of weekly process input", () => {
  assert.equal(isIgnoredWeeklyInputFile("ai.generated.md"), true);
  assert.equal(isIgnoredWeeklyInputFile("_ai-generated.json"), true);
  assert.equal(isIgnoredWeeklyInputFile("ai.md"), false);
});

test("records raw and effective character counts for each Process file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-char-counts-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "wisdom.md"), [
      "# 智慧之门｜2026-W29", "", "## 记录", "", "### 2026-07-17",
      "- 所属主题：主题 A", "- 核心问题和使用场景：问题与场景", "- 一句话精华：一句话判断",
      `- 长篇内容、原始内容：${"这是一大段原始正文。".repeat(20)}`, "- 层级：法", "- 智慧时效性：长期"
    ].join("\n"), "utf8");
    const result = await collectWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.equal(result.files.length, 1);
    assert.ok(result.files[0].rawChars > 0);
    assert.ok(result.files[0].effectiveChars > 0);
    assert.equal(result.files[0].effectiveChars, result.items[0].text.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("counts effective characters by Unicode code point", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-unicode-counts-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "research.md"), "# 研究\n\n🙂🙂🙂🙂🙂🙂", "utf8");
    const result = await collectWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.equal(result.files[0].effectiveChars, Array.from(result.items[0].text).length);
    assert.notEqual(result.files[0].effectiveChars, result.items[0].text.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collects from an explicit repo root and excludes only the unconfirmed draft", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-input-"));
  try {
    const weekDir = path.join(root, "03_input/weekly/2026-W29");
    await mkdir(weekDir, { recursive: true });
    await writeFile(path.join(weekDir, "ai.generated.md"), "## 草稿\n\n未确认", "utf8");
    await writeFile(path.join(weekDir, "ai.md"), "## 正式周回顾\n\n已确认的实质内容", "utf8");
    const result = await collectWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.deepEqual(result.files.map((file) => file.path), ["03_input/weekly/2026-W29/ai.md"]);
    const written = await writeWeeklyInput({ repoRoot: root, week: "2026-W29" });
    assert.deepEqual(written.payload.files.map((file) => file.path), ["03_input/weekly/2026-W29/ai.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

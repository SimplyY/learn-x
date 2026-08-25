import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectOne, compressWisdomContent, wisdomCompressionProfile } from "./collect-base-weekly.mjs";
import { filterByRange } from "./lib/base-collector.mjs";

const config = {
  name: "智慧之门",
  sourceUrl: "https://example.test/base",
  tableId: "target-table",
  fields: [
    "所属主题", "核心问题和使用场景", "一句话精华",
    "层级", "智慧时效性", "创建时间",
  ],
  filterField: "创建时间",
  outputFile: "wisdom.md",
  title: "智慧之门",
  compression: { sourceField: "长篇内容、原始内容", minChars: 200, maxChars: 500 }
};

test("Wisdom collector preserves an old empty result and writes ready records", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-wisdom-status-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const output = path.join(outputRoot, "wisdom.md");
  await writeFile(output, "old wisdom\n", "utf8");
  const empty = await collectOne(config, "2026-W24", dependencies([] , outputRoot));
  assert.equal(empty.written, false);
  assert.equal(await readFile(output, "utf8"), "old wisdom\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "empty"/);

  const ready = await collectOne(config, "2026-W24", dependencies([
    { values: {
      "创建时间": "2026-06-08 10:00:00",
      "一句话精华": "真实智慧记录",
      "长篇内容、原始内容": [
        "数学的本质：把复杂现实压缩成可以推理的结构。",
        "真正重要的不是算得快，而是把混乱问题变成可思考问题。",
        "从确定答案走向认识边界。",
        "这是一段不应原样进入本地输入的长篇原始正文。",
      ].join("\n"),
    } }
  ], outputRoot));
  assert.equal(ready.written, true);
  const content = await readFile(output, "utf8");
  assert.match(content, /真实智慧记录/);
  assert.match(content, /核心压缩内容/);
  assert.doesNotMatch(content, /长篇内容、原始内容：/);
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "ready"/);
});

test("uses an adaptive 200-500 character budget instead of a fixed ratio", () => {
  const source = [
    "本质：把复杂现实压缩成可以推理的结构。",
    "普通解释和铺垫不应占据输入空间。",
    "真正重要的是识别问题、因果与边界。",
    "最后结论：先定义问题，再判断结果。",
  ].join("\n").repeat(8);
  const profile = wisdomCompressionProfile(source, { anchor: "识别问题与边界", level: "法", timeliness: "长期" });
  const compressed = compressWisdomContent(source, { ...profile, anchor: "识别问题与边界" });
  assert.match(compressed, /本质|真正重要|结论/);
  assert.ok(profile.targetChars >= 200 && profile.targetChars <= 500);
  assert.ok([...compressed].length <= profile.targetChars);
  assert.ok(compressed.length > 0);
});

test("gives more budget to content with more independent core signals", () => {
  const lowSignal = "普通说明。".repeat(220);
  const highSignal = [
    "本质：定义问题。", "核心：建立模型。", "关键：用反馈校正。", "因此：先验收再扩张。",
    "风险：方向错误会放大错误。", "结论：长期竞争力来自持续学习。",
  ].join("\n").repeat(8);
  const low = wisdomCompressionProfile(lowSignal);
  const high = wisdomCompressionProfile(highSignal, { level: "法", timeliness: "长期" });
  assert.ok(low.targetChars >= 200 && low.targetChars <= 500);
  assert.ok(high.targetChars > low.targetChars);
});

test("Wisdom collector marks a query failure without replacing the old file", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-wisdom-fail-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const output = path.join(outputRoot, "wisdom.md");
  await writeFile(output, "old wisdom\n", "utf8");
  await assert.rejects(
    collectOne(config, "2026-W24", { ...dependencies([], outputRoot), resolveBase: async () => { throw new Error("query failed"); } }),
    /query failed/
  );
  assert.equal(await readFile(output, "utf8"), "old wisdom\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "failed"/);
});

function dependencies(records, outputRoot) {
  return {
    outputRoot,
    resolveBase: async () => "base",
    listTables: async () => [{ id: "target-table", name: "智慧之门" }],
    verifyFields: async () => {},
    listRecords: async () => ({ records, pages: 1, complete: true }),
    filterByRange
  };
}

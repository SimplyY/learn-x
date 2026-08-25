import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildVoiceFilter, collectVoiceWeekly, extractUrl, isStructuredInsight, renderVoiceMarkdown, stripAdviceFromVoiceMarkdown, writeVoiceWeekly } from "./collect-voice-weekly.mjs";

class FakeCollectorTransport {
  constructor(pages, documents = {}) { this.pages = pages; this.documents = documents; this.prepared = 0; this.fetched = []; this.failPrepare = false; this.failUrl = ""; }
  async prepare() { this.prepared += 1; if (this.failPrepare) throw new Error("query failed"); }
  async listRecords({ offset }) { return this.pages.get(offset) || { records: [], hasMore: false }; }
  async fetchMarkdown(url) { this.fetched.push(url); if (url === this.failUrl) throw new Error("document read failed"); return this.documents[url]; }
}

function insight(text = "核心总结。", munger = "洞察。") { return `# Voice-X AI 洞察\n\n## 核心总结\n\n${text}\n\n## 芒格之魂洞察\n\n${munger}`; }
function record(id, title, recordedAt, coreUrl, rawUrl = "https://raw.invalid/RAW_SENTINEL", insightUrl = `https://insight.invalid/${id}`) {
  return { id, fields: { 标题: title, 录制时间: recordedAt, 原始文字稿: rawUrl, "处理后原文": coreUrl, "AI 洞察文档": insightUrl, 内容指纹: `hash-${id}` } };
}

test("extracts the actual target from a Markdown link", () => {
  assert.equal(extractUrl("[https://example.invalid/label](https://example.invalid/target)"), "https://example.invalid/target");
});

test("collects only the summary and insight from a new-format AI insight document", () => {
  const document = "# AI 洞察\n\n## 1. 核心总结\n保留总结。\n\n## 2. 洞察与思考\n保留洞察。\n\n## 3. 对我的建议（仅留档，不采集到 Learn-X）\n不得采集。";
  const collected = stripAdviceFromVoiceMarkdown(document);
  assert.match(collected, /保留总结|保留洞察/);
  assert.doesNotMatch(collected, /不得采集/);
  assert.equal(stripAdviceFromVoiceMarkdown("# 历史核心重点\n保留全部内容。"), "# 历史核心重点\n保留全部内容。");
});

test("recognizes the live Voice-X headings and excludes full detail text", () => {
  const document = "# 核心总结\n保留核心。\n\n# 对我的建议\n排除建议。\n\n# 压缩原文\n排除全文。";
  const collected = stripAdviceFromVoiceMarkdown(document);
  assert.equal(collected, "# 核心总结\n保留核心。");
  assert.doesNotMatch(collected, /排除建议|排除全文/);
});

test("accepts only the new two-section insight format", () => {
  assert.equal(isStructuredInsight(insight()), true);
  assert.equal(isStructuredInsight("# AI 洞察 · 语音标题\n\n" + insight()), true);
  assert.equal(isStructuredInsight("# AI 洞察\n\n历史内容"), false);
  assert.equal(isStructuredInsight(`${insight()}\n\n# 压缩原文\n全文`), false);
});

test("builds an inclusive weekly lower bound with supported datetime operators", () => {
  assert.deepEqual(buildVoiceFilter(1780848000, 1781452800), { logic: "and", conditions: [
    ["录制时间", ">", "ExactDate(2026-06-07T23:59:59+08:00)"],
    ["录制时间", "<", "ExactDate(2026-06-15T00:00:00+08:00)"],
    ["处理后原文", "non_empty", null]
  ] });
});

test("collects the target week, core-only records, all pages, and stable time order", async () => {
  const pages = new Map([
    [0, { hasMore: true, records: [
      record("rec2", "较晚记录标题内容", "2026-06-10T12:00:00+08:00", "https://core/2"),
      record("outside", "上周记录标题内容", "2026-06-07T23:59:59+08:00", "https://core/outside")
    ] }],
    [2, { hasMore: false, records: [
      record("rec1", "较早记录标题内容", "2026-06-08T09:00:00+08:00", "https://core/1"),
      record("empty", "空核心记录标题内容", "2026-06-09T09:00:00+08:00", "", "", "")
    ] }]
  ]);
  const transport = new FakeCollectorTransport(pages, { "https://core/1": "# 早\n\n完整 Markdown", "https://core/2": "# 晚\n\n完整 Markdown", "https://insight.invalid/rec1": insight("早总结", "早洞察"), "https://insight.invalid/rec2": insight("晚总结", "晚洞察") });
  const payload = await collectVoiceWeekly({ week: "2026-W24", generatedAt: "2026-06-15T00:00:00.000Z", transport });
  assert.equal(payload.pagination.pages, 2);
  assert.deepEqual(payload.records.map((item) => item.id), ["rec1", "rec2"]);
  assert.deepEqual(transport.fetched, ["https://core/1", "https://insight.invalid/rec1", "https://core/2", "https://insight.invalid/rec2"]);
  const markdown = renderVoiceMarkdown(payload);
  assert.match(markdown, /早总结/);
  assert.match(markdown, /处理后原文字符数/);
  assert.doesNotMatch(markdown, /完整 Markdown|RAW_SENTINEL|raw\.invalid|上周记录|空核心记录/);
});

test("uses the stable business key when recorded times are equal", async () => {
  const transport = new FakeCollectorTransport(new Map([[0, { hasMore: false, records: [
    { ...record("b", "B 标题记录内容", "2026-06-08T09:00:00+08:00", "https://core/b"), fields: { ...record("b", "B 标题记录内容", "2026-06-08T09:00:00+08:00", "https://core/b").fields, 内容指纹: "b" } },
    { ...record("a", "A 标题记录内容", "2026-06-08T09:00:00+08:00", "https://core/a"), fields: { ...record("a", "A 标题记录内容", "2026-06-08T09:00:00+08:00", "https://core/a").fields, 内容指纹: "a" } }
  ] }]]), { "https://core/a": "A", "https://core/b": "B", "https://insight.invalid/a": insight(), "https://insight.invalid/b": insight() });
  const payload = await collectVoiceWeekly({ week: "2026-W24", transport });
  assert.deepEqual(payload.records.map((item) => item.id), ["a", "b"]);
});

test("separates pending and legacy records without falling back to the rough original", async () => {
  const ready = record("ready", "已完成洞察记录", "2026-06-08T09:00:00+08:00", "https://core/ready");
  const pending = record("pending", "待处理洞察记录", "2026-06-08T10:00:00+08:00", "https://core/pending", "", "");
  const legacy = record("legacy", "旧格式洞察记录", "2026-06-08T11:00:00+08:00", "https://core/legacy", "", "https://insight.invalid/legacy");
  const transport = new FakeCollectorTransport(new Map([[0, { hasMore: false, records: [ready, pending, legacy] }]]), {
    "https://core/ready": "粗加工 ready",
    "https://core/pending": "粗加工 pending，不应进入周报",
    "https://core/legacy": "粗加工 legacy，不应进入周报",
    "https://insight.invalid/ready": insight("完成总结", "完成洞察"),
    "https://insight.invalid/legacy": "# AI 洞察\n\n历史交互"
  });
  const payload = await collectVoiceWeekly({ week: "2026-W24", transport });
  assert.deepEqual(payload.records.map((item) => item.id), ["ready"]);
  assert.deepEqual(payload.counts, { ready: 1, pending: 1, legacy: 1 });
  assert.equal(payload.allRecords.find((item) => item.id === "pending").insightStatus, "pending");
  assert.equal(payload.allRecords.find((item) => item.id === "legacy").insightStatus, "legacy");
  assert.doesNotMatch(renderVoiceMarkdown(payload), /粗加工 pending|粗加工 legacy/);
});

test("records an empty source without creating a zero-record file", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-voice-zero-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const notesPath = path.join(outputRoot, "voice.md");
  await writeFile(notesPath, "old voice\n", "utf8");
  const result = await writeVoiceWeekly({ week: "2026-W24", outputRoot, transport: new FakeCollectorTransport(new Map([[0, { records: [], hasMore: false }]])) });
  assert.equal(result.notesPath, null);
  assert.deepEqual((await readdir(outputRoot)).sort(), ["_source-status.json", "voice.md"]);
  assert.equal(await readFile(notesPath, "utf8"), "old voice\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "empty"/);
});

test("query and second-page document failures preserve the old voice.md", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-voice-fail-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const notesPath = path.join(outputRoot, "voice.md");
  await writeFile(notesPath, "keep old voice\n", "utf8");

  const queryFailure = new FakeCollectorTransport(new Map());
  queryFailure.failPrepare = true;
  await assert.rejects(writeVoiceWeekly({ week: "2026-W24", outputRoot, transport: queryFailure }), /query failed/);
  assert.equal(await readFile(notesPath, "utf8"), "keep old voice\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "failed"/);

  const pages = new Map([
    [0, { hasMore: true, records: [record("first", "第一页记录标题", "2026-06-08T09:00:00+08:00", "https://core/first")] }],
    [1, { hasMore: false, records: [record("second", "第二页记录标题", "2026-06-09T09:00:00+08:00", "https://core/second")] }]
  ]);
  const documentFailure = new FakeCollectorTransport(pages, { "https://core/first": "first", "https://core/second": "second", "https://insight.invalid/first": insight(), "https://insight.invalid/second": insight() });
  documentFailure.failUrl = "https://core/second";
  await assert.rejects(writeVoiceWeekly({ week: "2026-W24", outputRoot, transport: documentFailure }), /document read failed/);
  assert.equal(await readFile(notesPath, "utf8"), "keep old voice\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "failed"/);
});

test("fails closed when pagination claims more without advancing", async () => {
  const transport = new FakeCollectorTransport(new Map([[0, { records: [], hasMore: true }]]));
  await assert.rejects(collectVoiceWeekly({ week: "2026-W24", transport }), /没有新增记录/);
});

test("preserves the previous voice file when the compressed output exceeds 15000 characters", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-voice-limit-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const notesPath = path.join(outputRoot, "voice.md");
  await writeFile(notesPath, "keep old voice\n", "utf8");
  const transport = new FakeCollectorTransport(new Map([[0, { hasMore: false, records: [record("large", "超长记录", "2026-06-08T09:00:00+08:00", "https://core/large")] }]]), {
    "https://core/large": "# 处理后原文\n事实底稿",
    "https://insight.invalid/large": insight("保留核心。".repeat(4000), "洞察")
  });
  await assert.rejects(writeVoiceWeekly({ week: "2026-W24", outputRoot, transport }), /超过周输入上限/);
  assert.equal(await readFile(notesPath, "utf8"), "keep old voice\n");
});

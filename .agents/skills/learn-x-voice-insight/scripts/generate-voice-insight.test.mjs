import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseBatchOutput, runVoiceInsight } from "./generate-voice-insight.mjs";

const structured = (summary = "总结", insight = "洞察") => `# Voice-X AI 洞察\n\n## 核心总结\n\n${summary}\n\n## 芒格之魂洞察\n\n${insight}`;
function makeRecord(id, insightUrl = "") { return { id, title: `语音 ${id}`, recordedAt: "2026-06-08T09:00:00+08:00", coreUrl: `core:${id}`, insightUrl }; }

class FakeTransport {
  constructor(records) { this.records = records; this.docs = new Map(records.flatMap((record) => [[record.coreUrl, record.coreText || `处理后原文 ${record.id}`], ...(record.insightUrl ? [[record.insightUrl, record.insightText || "# AI 洞察\n\n> 占位文档"]] : [])])); }
  async prepare() {}
  async listRecords() { return this.records; }
  async fetchMarkdown(url) { return this.docs.get(url); }
}

function batch(records) { return records.map((record) => `<!-- VOICE_RECORD: ${record.id} -->\n${structured(`总结 ${record.id}`, `洞察 ${record.id}`)}\n<!-- END VOICE_RECORD: ${record.id} -->`).join("\n\n"); }

test("preview writes private context and does not call the bridge", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-preview-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  let bridgeCalls = 0;
  const result = await runVoiceInsight({ outputRoot, week: "2026-W24", transport: new FakeTransport([makeRecord("rec1", "placeholder:rec1")]), refreshVoice: false, runBridge: async () => { bridgeCalls += 1; } });
  assert.equal(result.status, "preview");
  assert.equal(bridgeCalls, 0);
  assert.match(await readFile(path.join(outputRoot, "_voice-insight-context.md"), "utf8"), /处理后原文 rec1/);
  assert.match(result.manualPrompt, /Voice-X/);
});

test("submits one batch, validates every block, archives, and refreshes voice input", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-batch-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const records = [makeRecord("rec1", "placeholder:rec1"), makeRecord("rec2", "placeholder:rec2")];
  let bridgeCalls = 0;
  const archived = [];
  const statusTrail = [];
  let refreshed = 0;
  const result = await runVoiceInsight({ outputRoot, week: "2026-W24", send: true, confirm: true, transport: new FakeTransport(records), runBridge: async () => { bridgeCalls += 1; return { result: { status: "succeeded", runId: "run1", conversationUrl: "https://chat.invalid/1", text: batch(records) } }; }, archive: async (record) => { statusTrail.push(JSON.parse(await readFile(path.join(outputRoot, "_voice-insight-status.json"))).status); archived.push(record.id); return { insightUrl: `insight:${record.id}` }; }, refreshVoice: async () => { refreshed += 1; } });
  assert.equal(result.status, "completed");
  assert.equal(bridgeCalls, 1);
  assert.deepEqual(archived, ["rec1", "rec2"]);
  assert.equal(refreshed, 1);
  assert.deepEqual(statusTrail, ["archive_pending", "archive_pending"]);
  assert.match(await readFile(path.join(outputRoot, "_voice-insight.generated.md"), "utf8"), /VOICE_RECORD: rec2/);
});

test("needs_review is not automatically resent", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-review-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const transport = new FakeTransport([makeRecord("rec1", "placeholder:rec1")]);
  let calls = 0;
  const first = await runVoiceInsight({ outputRoot, week: "2026-W24", send: true, confirm: true, transport, refreshVoice: false, runBridge: async () => { calls += 1; return { result: { status: "needs_review", runId: "run-review", reason: "login-required", conversationUrl: "https://chat.invalid/review" } }; } });
  const second = await runVoiceInsight({ outputRoot, week: "2026-W24", transport, refreshVoice: false, runBridge: async () => { calls += 1; throw new Error("must not resend"); } });
  assert.equal(first.status, "needs_review");
  assert.equal(second.status, "needs_review");
  assert.equal(calls, 1);
  assert.equal(second.reason, "login-required");
  assert.equal(second.runId, "run-review");
});

test("partial archive resumes from generated output without another bridge call", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-resume-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const records = [makeRecord("rec1", "placeholder:rec1"), makeRecord("rec2", "placeholder:rec2")];
  const transport = new FakeTransport(records);
  let bridgeCalls = 0;
  let failSecond = true;
  const archive = async (record) => {
    if (record.id === "rec2" && failSecond) { failSecond = false; throw new Error("temporary archive failure"); }
    record.insightUrl = `insight:${record.id}`;
    transport.docs.set(record.insightUrl, structured());
    return { insightUrl: record.insightUrl };
  };
  const first = await runVoiceInsight({ outputRoot, week: "2026-W24", send: true, confirm: true, transport, refreshVoice: false, runBridge: async () => { bridgeCalls += 1; return { result: { status: "succeeded", text: batch(records), runId: "run1" } }; }, archive });
  const second = await runVoiceInsight({ outputRoot, week: "2026-W24", send: true, confirm: true, transport, refreshVoice: false, runBridge: async () => { bridgeCalls += 1; throw new Error("must not resend"); }, archive });
  assert.equal(first.status, "archive_pending");
  assert.equal(second.status, "completed");
  assert.equal(bridgeCalls, 1);
});

test("rejects duplicate or missing batch blocks before archive", () => {
  const one = makeRecord("rec1");
  assert.throws(() => parseBatchOutput(batch([one, one]), ["rec1"]), /数量或标识|区块缺失或重复/);
  assert.throws(() => parseBatchOutput(batch([one]), ["rec1", "rec2"]), /数量或标识/);
  assert.throws(() => parseBatchOutput(`${batch([one])}\n额外文本`, ["rec1"]), /未标记文本/);
  assert.throws(() => parseBatchOutput(batch([one]).replace("END VOICE_RECORD: rec1", "END VOICE_RECORD: rec2"), ["rec1"]), /起止标识不一致/);
});

test("resume rejects generated output with an extra record block", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-extra-block-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const record = makeRecord("rec1", "placeholder:rec1");
  await writeFile(path.join(outputRoot, "_voice-insight.generated.md"), batch([record, makeRecord("rec2")]), "utf8");
  await assert.rejects(() => runVoiceInsight({ outputRoot, week: "2026-W24", transport: new FakeTransport([record]), refreshVoice: false }), /数量或标识/);
});

test("missing insight link is pending and is not sent in this batch", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-pending-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  let bridgeCalls = 0;
  const result = await runVoiceInsight({ outputRoot, week: "2026-W24", transport: new FakeTransport([makeRecord("rec1")]), refreshVoice: false, runBridge: async () => { bridgeCalls += 1; } });
  assert.equal(result.status, "completed");
  assert.equal(result.counts.pending, 1);
  assert.equal(bridgeCalls, 0);
});

test("unexpected Base failure is persisted as failed", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-failed-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const transport = new FakeTransport([]);
  transport.prepare = async () => { throw new Error("base unavailable"); };
  await assert.rejects(() => runVoiceInsight({ outputRoot, week: "2026-W24", transport, refreshVoice: false }), /base unavailable/);
  const status = JSON.parse(await readFile(path.join(outputRoot, "_voice-insight-status.json")));
  assert.equal(status.status, "failed");
  assert.equal(status.reason, "base unavailable");
});

test("legacy processed-original content is pending and is never sent as rough context", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-legacy-core-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const record = makeRecord("rec1", "placeholder:rec1");
  record.coreText = "# 核心总结\n\n旧总结。\n\n# 压缩原文\n\n旧底稿。";
  let bridgeCalls = 0;
  const result = await runVoiceInsight({ outputRoot, week: "2026-W24", transport: new FakeTransport([record]), refreshVoice: false, runBridge: async () => { bridgeCalls += 1; } });
  assert.equal(result.status, "completed");
  assert.equal(result.counts.pending, 1);
  assert.equal(bridgeCalls, 0);
  assert.match(await readFile(path.join(outputRoot, "_voice-insight-context.md"), "utf8"), /没有可处理/);
});

test("legacy migration marks the archive as versioned", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "voice-insight-legacy-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const record = makeRecord("legacy", "insight:legacy");
  record.insightText = "# AI 洞察\n\n历史实质内容";
  let legacyFlag = false;
  const result = await runVoiceInsight({ outputRoot, week: "2026-W24", migrateLegacy: true, confirm: true, transport: new FakeTransport([record]), refreshVoice: false, runBridge: async () => ({ result: { status: "succeeded", text: batch([record]) } }), archive: async (_record, _content, options) => { legacyFlag = options.legacy; return {}; } });
  assert.equal(result.status, "completed");
  assert.equal(legacyFlag, true);
});

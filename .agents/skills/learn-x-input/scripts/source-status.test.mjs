import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readWeeklySourceStatus, updateWeeklySourceStatus } from "./lib/source-status.mjs";

test("source status merges sources atomically and reads back", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-"));
  try {
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "daily", status: "empty", file: "daily.md", count: 0, summary: "本周 0 条记录，文件未生成", preservedStaleFile: true });
    await writeFile(path.join(root, "voice.md"), "voice evidence\n", "utf8");
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "voice", status: "ready", file: "voice.md", count: 2, summary: "本周有核心记录" });
    const result = await readWeeklySourceStatus(root, "2026-W32");
    assert.equal(result.sources.daily.status, "empty");
    assert.equal(result.sources.voice.status, "ready");
    assert.match(await readFile(path.join(root, "_source-status.json"), "utf8"), /0 条记录/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source status rejects unsafe or unknown entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-"));
  try {
    await assert.rejects(() => updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "unknown", status: "empty", file: "x.md", count: 0, summary: "" }), /未知输入源/);
    await assert.rejects(() => updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "daily", status: "empty", file: "../daily.md", count: 0, summary: "" }), /非法来源文件名/);
    await assert.rejects(() => updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "daily", status: "empty", file: "daily.md", count: -1, summary: "" }), /非法来源计数/);
    await assert.rejects(() => updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "daily", status: "ready", file: "daily.md", count: 1, summary: "有记录" }), /ready 来源文件不存在/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source status redacts URLs, credentials, and technical identifiers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-"));
  try {
    await updateWeeklySourceStatus({
      weekRoot: root,
      week: "2026-W32",
      source: "flomo",
      status: "failed",
      file: "flomo.md",
      count: 0,
      summary: "token=secret record_id=rec123456 https://example.test/?key=value"
    });
    const document = await readWeeklySourceStatus(root, "2026-W32");
    assert.doesNotMatch(document.sources.flomo.summary, /secret|rec123456|https?:|key=value/);
    assert.match(document.sources.flomo.summary, /redacted|\[id\]|\[url\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source status truncates long summaries so failure state can be recorded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-"));
  try {
    await updateWeeklySourceStatus({
      weekRoot: root,
      week: "2026-W32",
      source: "voice",
      status: "failed",
      file: "voice.md",
      count: 0,
      summary: `采集失败：${"x".repeat(400)}`
    });
    const result = await readWeeklySourceStatus(root, "2026-W32");
    assert.equal(result.sources.voice.summary.length, 240);
    assert.match(result.sources.voice.summary, /\.\.\.$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid source status sidecar fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-"));
  try {
    await writeFile(path.join(root, "_source-status.json"), "{\"version\": 1,\"week\": \"2026-W32\",\"sources\": {\"daily\": {\"status\": \"empty\"}}}");
    await assert.rejects(() => readWeeklySourceStatus(root, "2026-W32"), /来源状态侧车/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

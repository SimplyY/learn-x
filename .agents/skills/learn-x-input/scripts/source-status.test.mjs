import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileExists, readWeeklySourceStatus, updateWeeklySourceStatus } from "./lib/source-status.mjs";

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

test("source status sidecar is private when created and when replacing a permissive file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-mode-"));
  try {
    const target = path.join(root, "_source-status.json");
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "flomo", status: "empty", file: "flomo.md", count: 0, summary: "" });
    assert.equal((await stat(target)).mode & 0o777, 0o600);

    await chmod(target, 0o644);
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W32", source: "daily", status: "empty", file: "daily.md", count: 0, summary: "" });
    assert.equal((await stat(target)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent collectors preserve every source status update", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-race-"));
  const entries = [
    ["daily", "daily.md"], ["flomo", "flomo.md"], ["weread", "weread.md"], ["jingdu", "jingdu.md"],
    ["calendar", "calendar.md"], ["voice", "voice.md"], ["coach", "coach.md"], ["wisdom", "wisdom.md"],
    ["wechat", "wechat.md"], ["build", "build.md"], ["build-bot", "build-bot.md"], ["health", "health.md"],
    ["open-actions", "open-actions.md"], ["core", "core.md"]
  ];
  try {
    await Promise.all(entries.map(([source, file]) => updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W32", source, status: "empty", file, count: 0, summary: "扫描完成，0条"
    })));
    const { sources } = await readWeeklySourceStatus(root, "2026-W32");
    assert.deepEqual(Object.keys(sources).sort(), entries.map(([source]) => source).sort());
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

test("jingdu registers as a weekly source with fail-closed ready and fileless empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-jingdu-"));
  try {
    await assert.rejects(() => updateWeeklySourceStatus({ weekRoot: root, week: "2026-W38", source: "jingdu", status: "ready", file: "jingdu.md", count: 2, summary: "精读加工" }), /ready 来源文件不存在/);
    await writeFile(path.join(root, "jingdu.md"), "# 精读\n\n原始划线及来源 + 本人理解/判断\n", "utf8");
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W38", source: "jingdu", status: "ready", file: "jingdu.md", count: 2, summary: "精读加工" });
    const ready = await readWeeklySourceStatus(root, "2026-W38");
    assert.equal(ready.sources.jingdu.status, "ready");
    assert.equal(ready.sources.jingdu.file, "jingdu.md");

    await rm(path.join(root, "jingdu.md"), { force: true });
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W38", source: "jingdu", status: "empty", file: "jingdu.md", count: 0, summary: "本周 0 条（全部跳过），文件未生成" });
    const empty = await readWeeklySourceStatus(root, "2026-W38");
    assert.equal(empty.sources.jingdu.status, "empty");
    assert.equal(await fileExists(path.join(root, "jingdu.md")), false);
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

test("legacy sidecar without new fields stays readable and field-free", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-legacy-"));
  try {
    await writeFile(path.join(root, "_source-status.json"), JSON.stringify({
      version: 1,
      week: "2026-W40",
      updatedAt: "2026-10-05T00:00:00.000Z",
      sources: {
        weread: { status: "ready", file: "weread.md", count: 3, summary: "本周有阅读活动", updatedAt: "2026-10-05T00:00:00.000Z", preservedStaleFile: false, futureUnknownField: { x: 1 } }
      }
    }, null, 2));
    const result = await readWeeklySourceStatus(root, "2026-W40");
    assert.equal(result.sources.weread.status, "ready");
    assert.equal(result.sources.weread.contentSha256, undefined);
    assert.equal(result.sources.weread.commitJournal, undefined);
    assert.equal(result.sources.weread.futureUnknownField, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commit journal survives unrelated collector updates inside the merge lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-journal-"));
  try {
    await writeFile(path.join(root, "weread.md"), "weread evidence\n", "utf8");
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W41", source: "weread", status: "ready", file: "weread.md", count: 3, summary: "本周有阅读活动" });
    await updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W41", source: "jingdu", status: "needs_review", file: "jingdu.md", count: 2, summary: "两阶段提交进行中",
      appendJournal: [{ action: "pending", at: "2026-10-22T08:00:00.000Z", expectSha256: "a".repeat(64) }]
    });
    // An unrelated collector touches weread afterwards; jingdu journal must survive.
    await updateWeeklySourceStatus({ weekRoot: root, week: "2026-W41", source: "weread", status: "ready", file: "weread.md", count: 4, summary: "本周有阅读活动" });
    const mid = await readWeeklySourceStatus(root, "2026-W41");
    assert.equal(mid.sources.jingdu.commitJournal.length, 1);
    assert.equal(mid.sources.jingdu.commitJournal[0].action, "pending");

    await writeFile(path.join(root, "jingdu.md"), "# 精读｜2026-W41\n", "utf8");
    await updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W41", source: "jingdu", status: "ready", file: "jingdu.md", count: 2, summary: "本周精读 2 条",
      contentSha256: "b".repeat(64),
      appendJournal: [{ action: "commit", at: "2026-10-22T08:01:00.000Z", sha256: "b".repeat(64) }]
    });
    const done = await readWeeklySourceStatus(root, "2026-W41");
    assert.equal(done.sources.jingdu.status, "ready");
    assert.equal(done.sources.jingdu.contentSha256, "b".repeat(64));
    assert.deepEqual(done.sources.jingdu.commitJournal.map((item) => item.action), ["pending", "commit"]);
    assert.equal(done.sources.jingdu.commitJournal[0].expectSha256, "a".repeat(64));
    assert.equal(done.sources.jingdu.commitJournal[1].sha256, "b".repeat(64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupted commit journal is tolerated on read and dropped entries never block the sidecar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-corrupt-"));
  try {
    await writeFile(path.join(root, "_source-status.json"), JSON.stringify({
      version: 1,
      week: "2026-W39",
      updatedAt: "2026-09-28T00:00:00.000Z",
      sources: {
        jingdu: {
          status: "ready", file: "jingdu.md", count: 1, summary: "本周精读 1 条",
          updatedAt: "2026-09-28T00:00:00.000Z", preservedStaleFile: false,
          contentSha256: "c".repeat(64),
          commitJournal: [
            { action: "pending", at: "2026-09-28T00:00:00.000Z", expectSha256: "d".repeat(64) },
            "garbage",
            null,
            { action: "bogus", at: "2026-09-28T00:00:00.000Z" },
            { action: "commit", at: "not-a-date", sha256: "e".repeat(64) },
            { action: "commit", at: "2026-09-28T00:01:00.000Z", sha256: "e".repeat(64), note: "recover" }
          ]
        }
      }
    }, null, 2));
    const result = await readWeeklySourceStatus(root, "2026-W39");
    const entry = result.sources.jingdu;
    assert.equal(entry.status, "ready");
    assert.equal(entry.contentSha256, "c".repeat(64));
    assert.equal(entry.commitJournal.length, 2);
    assert.equal(entry.commitJournal[0].action, "pending");
    assert.equal(entry.commitJournal[1].action, "commit");
    assert.equal(entry.commitJournal[1].note, "recover");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("write side rejects malformed journal entries and bad content hashes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-status-strict-"));
  try {
    await assert.rejects(() => updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W41", source: "jingdu", status: "empty", file: "jingdu.md", count: 0, summary: "",
      appendJournal: [{ action: "pending", at: "not-a-date" }]
    }), /非法提交日志条目/);
    await assert.rejects(() => updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W41", source: "jingdu", status: "empty", file: "jingdu.md", count: 0, summary: "",
      contentSha256: 12345
    }), /非法来源内容哈希/);
    await assert.rejects(() => updateWeeklySourceStatus({
      weekRoot: root, week: "2026-W41", source: "jingdu", status: "empty", file: "jingdu.md", count: 0, summary: "",
      appendJournal: "pending"
    }), /非法提交日志/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

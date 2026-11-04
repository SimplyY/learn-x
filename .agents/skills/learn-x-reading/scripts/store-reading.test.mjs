import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storeReadingBatch, updateReadingRecord } from "./store-reading.mjs";

function wereadBatch(overrides = {}) {
  return {
    batchId: "batch-one",
    companionPack: "# 伴读包\n\n本次值得深入理解的核心观点。",
    source: "weread",
    book: { title: "边界与判断", author: "作者甲", bookId: "weread-book-1", edition: "2026版" },
    entries: [{
      sourceId: "weread-bookmark:weread-book-1:mark-1",
      sourceEvidence: { text: "来源正文", range: "42-58", chapterUid: "3", createTime: 1793672100 },
      location: "第三章 / p.42",
      date: "2026-11-03",
      kind: "划线",
      authorContent: "作者指出，判断质量取决于是否识别了问题的约束。",
      foundations: ["先明确约束，再比较方案"],
      questions: ["约束由谁定义？"],
      aiInference: "这是对决策边界的分析。",
      status: "ready",
      visibility: "public"
    }],
    ...overrides
  };
}

test("stores a concise public book context and deterministic index with private readback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-store-"));
  try {
    const result = await storeReadingBatch(wereadBatch(), { root });
    assert.equal(result.localSaved, true);
    assert.equal(result.publicReadbackVerified, true);
    assert.equal(result.addedCount, 1);
    assert.equal(result.records.length, 1);
    assert.match(result.records[0].recordId, /^weread-/);
    assert.equal(result.publicSaved, true);
    assert.equal(result.companionPackAvailable, true);
    const publicPath = path.join(root, result.publicPath);
    const content = await readFile(publicPath, "utf8");
    assert.match(content, /作者内容提炼：作者指出/);
    assert.match(content, /思想基石：先明确约束/);
    assert.match(content, /AI 分析（未代表用户认可）/);
    assert.doesNotMatch(content, /weread-bookmark:weread-book-1:mark-1/);
    assert.match(await readFile(path.join(root, "05_library/reading/_index.md"), "utf8"), /边界与判断/);
    assert.equal((await stat(path.join(root, ".runtime/reading"))).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(root, ".runtime/reading/state.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(root, result.companionPackPath))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(path.join(root, "05_library/reading"))).sort(), ["_index.md", path.basename(publicPath)].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reprocessing a source is idempotent and a newly collected entry is incremental", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-dedupe-"));
  try {
    const first = wereadBatch();
    const initial = await storeReadingBatch(first, { root });
    const duplicate = await storeReadingBatch(first, { root });
    assert.equal(duplicate.addedCount, 0);
    assert.equal(duplicate.duplicateCount, 1);
    const changedPackReplay = await storeReadingBatch(wereadBatch({ companionPack: "# 重新生成的伴读包\n\n同一批次重放时保留首次交付内容。" }), { root });
    assert.equal(changedPackReplay.addedCount, 0);
    assert.equal(changedPackReplay.duplicateCount, 1);
    assert.match(await readFile(path.join(root, initial.companionPackPath), "utf8"), /本次值得深入理解/);
    assert.doesNotMatch(await readFile(path.join(root, initial.companionPackPath), "utf8"), /重新生成的伴读包/);
    const state = JSON.parse(await readFile(path.join(root, ".runtime/reading/state.json"), "utf8"));
    const pendingPath = path.join(root, ".runtime/reading/pending/batch-one.json");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(pendingPath), { recursive: true }));
    await writeFile(pendingPath, JSON.stringify({
      version: 1,
      batchId: "batch-one",
      source: "weread",
      book: first.book,
      entries: [state.records[initial.records[0].recordId]],
      companionPack: first.companionPack,
      intent: null,
      status: "failed"
    }), "utf8");
    const recovered = await storeReadingBatch(wereadBatch({ companionPack: "# 再生成的伴读包\n\n已完成批次仍保留首次交付版本。" }), { root });
    assert.equal(recovered.addedCount, 0);
    assert.equal(recovered.duplicateCount, 1);
    assert.match(await readFile(path.join(root, initial.companionPackPath), "utf8"), /本次值得深入理解/);
    await assert.rejects(storeReadingBatch(wereadBatch({ entries: [{ ...first.entries[0], sourceId: "weread-bookmark:weread-book-1:other-mark" }] }), { root }), /reading-completed-batch-conflict/);
    const next = wereadBatch({
      batchId: "batch-two",
      entries: [
        first.entries[0],
        { ...first.entries[0], sourceId: "weread-bookmark:weread-book-1:mark-2", location: "第三章 / p.43", authorContent: "作者补充了另一项条件。" }
      ]
    });
    const added = await storeReadingBatch(next, { root });
    assert.equal(added.addedCount, 1);
    assert.equal(added.duplicateCount, 1);
    const content = await readFile(path.join(root, initial.publicPath), "utf8");
    assert.match(content, /p\.42/);
    assert.match(content, /p\.43/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deduplicates repeated source IDs within one batch and rejects conflicting copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-batch-dedupe-"));
  try {
    const entry = wereadBatch().entries[0];
    const result = await storeReadingBatch(wereadBatch({ entries: [entry, { ...entry }] }), { root });
    assert.equal(result.inputCount, 2);
    assert.equal(result.addedCount, 1);
    assert.equal(result.duplicateCount, 1);
    const bookText = await readFile(path.join(root, result.publicPath), "utf8");
    assert.equal(bookText.match(/来源记录：/g).length, 1);

    const conflictingRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-batch-conflict-"));
    try {
      await assert.rejects(storeReadingBatch(wereadBatch({ entries: [entry, { ...entry, authorContent: "同一来源 ID 的另一种内容" }] }), { root: conflictingRoot }), /source-duplicate-conflict/);
      await assert.rejects(readFile(path.join(conflictingRoot, ".runtime/reading/state.json"), "utf8"), /ENOENT/);
    } finally {
      await rm(conflictingRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects changed content when an already stored source ID is replayed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-replay-conflict-"));
  try {
    const initial = wereadBatch();
    const stored = await storeReadingBatch(initial, { root });
    const changed = wereadBatch({
      batchId: "same-source-changed-content",
      entries: [{ ...initial.entries[0], sourceEvidence: { text: "来源正文已变更", range: "42-58", chapterUid: "3", createTime: 1793672100 }, authorContent: "同一来源 ID 返回了不同内容。" }]
    });
    await assert.rejects(storeReadingBatch(changed, { root }), /reading-source-replay-conflict/);
    const bookText = await readFile(path.join(root, stored.publicPath), "utf8");
    assert.match(bookText, /判断质量取决于是否识别了问题的约束/);
    assert.doesNotMatch(bookText, /同一来源 ID 返回了不同内容/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private and needs-review entries stay out of all public paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-private-"));
  try {
    const baseEntry = wereadBatch().entries[0];
    const result = await storeReadingBatch(wereadBatch({
      entries: [
        { ...baseEntry, authorContent: "可公开的一处标记" },
        { ...baseEntry, sourceId: "weread-bookmark:weread-book-1:mark-private", location: "p.44", visibility: "private", authorContent: "绝不公开的私人内容" },
        { ...baseEntry, sourceId: "weread-bookmark:weread-book-1:mark-pending", location: "p.45", status: "needs_review", authorContent: "尚不可靠的内容" }
      ]
    }), { root });
    const publicText = await readFile(path.join(root, result.publicPath), "utf8");
    const indexText = await readFile(path.join(root, result.indexPath), "utf8");
    assert.match(publicText, /可公开的一处标记/);
    assert.doesNotMatch(publicText, /私人内容|尚不可靠/);
    assert.doesNotMatch(indexText, /私人内容|尚不可靠/);
    const state = JSON.parse(await readFile(path.join(root, ".runtime/reading/state.json"), "utf8"));
    assert.match(JSON.stringify(state), /绝不公开的私人内容/);
    assert.equal(result.privateOrPendingCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists a WeRead personal thought without inventing author content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-thought-only-"));
  try {
    const result = await storeReadingBatch({
      source: "weread",
      book: { title: "只有想法的书", bookId: "thought-book" },
      entries: [{
        sourceId: "weread-review:thought-book:review-1",
        sourceEvidence: { content: "我想检验这个观点在团队决策中的适用边界。", abstract: "", chapterUid: "2", createTime: 1793672100 },
        location: "第二章",
        date: "2026-11-03",
        kind: "章节点评",
        userThought: "我想检验这个观点在团队决策中的适用边界。",
        status: "ready"
      }]
    }, { root });
    const content = await readFile(path.join(root, result.publicPath), "utf8");
    assert.match(content, /用户明确表达：我想检验这个观点/);
    assert.doesNotMatch(content, /作者内容提炼/);

    const state = JSON.parse(await readFile(path.join(root, ".runtime/reading/state.json"), "utf8"));
    const record = Object.values(state.records)[0];
    const expectedVersion = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    const updated = await updateReadingRecord({
      recordId: record.recordId,
      expectedVersion,
      action: "modify",
      patch: { userThought: "我还要检查这个边界在不同团队里的变化。" },
      companionPack: "# 更新后的想法伴读包\n\n只基于用户明确表达。"
    }, { root });
    assert.equal(updated.localReadbackVerified, true);
    assert.equal(updated.companionPackAvailable, true);
    assert.match(await readFile(path.join(root, updated.companionPackPath), "utf8"), /更新后的想法伴读包/);
    const updatedText = await readFile(path.join(root, result.publicPath), "utf8");
    assert.match(updatedText, /用户明确表达：我还要检查这个边界/);
    assert.doesNotMatch(updatedText, /作者内容提炼/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WeRead records require stable source IDs and protect externally edited managed files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-conflict-"));
  try {
    await assert.rejects(storeReadingBatch({ source: "weread", book: { title: "书" }, entries: [{ authorContent: "正文" }] }, { root }), /source-id-missing/);
    await assert.rejects(storeReadingBatch({ source: "physical", book: { title: "书" }, entries: [{ authorContent: "正文" }] }, { root }), /physical-book collection is deferred/);
    await assert.rejects(storeReadingBatch(wereadBatch({ entries: [{ ...wereadBatch().entries[0], visibility: "not_public" }] }), { root }), /reading-visibility-invalid/);
    await assert.rejects(storeReadingBatch(wereadBatch({ entries: [{ ...wereadBatch().entries[0], status: "public" }] }), { root }), /reading-status-invalid/);
    await assert.rejects(storeReadingBatch(wereadBatch({ entries: [{ ...wereadBatch().entries[0], publicEligible: "false" }] }), { root }), /reading-public-eligibility-invalid/);
    await assert.rejects(storeReadingBatch(wereadBatch({ entries: [{ ...wereadBatch().entries[0], visibility: "public", publicEligible: false }] }), { root }), /reading-visibility-conflict/);
    const result = await storeReadingBatch({
      source: "weread",
      book: { title: "书", author: "作者", bookId: "w-1" },
      entries: [{ sourceId: "weread-bookmark:w-1:123", sourceEvidence: { text: "原始来源" }, location: "第 1 章", date: "2026-11-03", authorContent: "精炼命题", status: "ready" }]
    }, { root });
    await writeFile(path.join(root, result.publicPath), "manual edit\n", "utf8");
    await assert.rejects(storeReadingBatch({
      source: "weread",
      book: { title: "书", author: "作者", bookId: "w-1" },
      entries: [{ sourceId: "weread-bookmark:w-1:124", sourceEvidence: { text: "新原始来源" }, location: "第 2 章", date: "2026-11-03", authorContent: "新内容", status: "ready" }]
    }, { root }), /managed-file-conflict/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses symlinks for private runtime data and public reading files", async () => {
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-private-symlink-"));
  const privateOutside = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-private-outside-"));
  const publicRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-public-symlink-"));
  const publicOutside = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-public-outside-"));
  try {
    await symlink(privateOutside, path.join(privateRoot, ".runtime"));
    await assert.rejects(storeReadingBatch(wereadBatch(), { root: privateRoot }), /reading-path-symlink/);
    assert.deepEqual(await readdir(privateOutside), []);

    await symlink(publicOutside, path.join(publicRoot, "05_library"));
    await assert.rejects(storeReadingBatch(wereadBatch(), { root: publicRoot }), /reading-path-symlink/);
    assert.deepEqual(await readdir(publicOutside), []);
  } finally {
    await Promise.all([privateRoot, privateOutside, publicRoot, publicOutside].map((directory) => rm(directory, { recursive: true, force: true })));
  }
});

test("failed writes retain a private intent and retry recovers without duplicating public records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-recover-"));
  try {
    const indexPath = path.join(root, "05_library/reading/_index.md");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(indexPath), { recursive: true }));
    await writeFile(indexPath, "unmanaged existing index\n", "utf8");
    const batch = wereadBatch();
    await assert.rejects(storeReadingBatch(batch, { root }), /unmanaged-file-exists/);
    const pendingPath = path.join(root, ".runtime/reading/pending/batch-one.json");
    const pending = await readFile(pendingPath, "utf8");
    assert.match(pending, /"status": "failed"/);
    assert.match(pending, /"companionPack": "# 伴读包/);
    await assert.rejects(storeReadingBatch(wereadBatch({ companionPack: "# 不同伴读包\n\n不允许替换 pending 内容。" }), { root }), /reading-pending-companion-conflict/);
    const changedRetry = wereadBatch({ entries: [{ ...batch.entries[0], authorContent: "不同的重试内容" }] });
    await assert.rejects(storeReadingBatch(changedRetry, { root }), /reading-pending-source-conflict/);
    const bookPath = (await readdir(path.join(root, "05_library/reading"))).find((file) => file.endsWith(".md") && file !== "_index.md");
    assert.ok(bookPath, "book Markdown was atomically written before index conflict");

    await rm(indexPath, { force: true });
    const retried = await storeReadingBatch(batch, { root });
    assert.equal(retried.addedCount, 1);
    assert.equal(retried.duplicateCount, 0);
    assert.equal(retried.publicReadbackVerified, true);
    await assert.rejects(readFile(pendingPath, "utf8"), /ENOENT/);
    assert.equal((await readFile(path.join(root, "05_library/reading", bookPath), "utf8")).match(/来源记录：/g).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modifies by record version, rejects stale edits, and revokes public text with readback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-modify-"));
  const sourceId = "bookmark:book-1:entry-1";
  const recordId = `weread-${createHash("sha256").update(sourceId).digest("hex").slice(0, 24)}`;
  const batch = {
    batchId: "modify-case",
    source: "weread",
    book: { title: "可靠判断", author: "作者乙", bookId: "book-1" },
    entries: [{ sourceId, sourceEvidence: { text: "先检验问题，再选择方案。", chapterUid: "2", createTime: 1793672100 }, location: "第二章", date: "2026-11-03", authorContent: "先检验问题，再选择方案。", questions: ["什么证据会推翻它？"] }]
  };
  try {
    const stored = await storeReadingBatch(batch, { root });
    const statePath = path.join(root, ".runtime/reading/state.json");
    const initialState = JSON.parse(await readFile(statePath, "utf8"));
    const initialRecord = initialState.records[recordId];
    assert.ok(initialRecord);
    const expectedVersion = createHash("sha256").update(JSON.stringify(initialRecord)).digest("hex");

    await assert.rejects(updateReadingRecord({ recordId, expectedVersion, action: "modfiy", patch: { userThought: "typo" }, companionPack: "# pack" }, { root }), /reading-action-invalid/);
    await assert.rejects(updateReadingRecord({ recordId, expectedVersion, action: "modify", patch: {}, companionPack: "# pack" }, { root }), /reading-modification-empty/);
    await assert.rejects(updateReadingRecord({ recordId, expectedVersion, action: "revoke", patch: { userThought: "ignored input" }, companionPack: "# pack" }, { root }), /reading-revoke-patch-invalid/);

    const modified = await updateReadingRecord({
      recordId,
      expectedVersion,
      action: "modify",
      patch: { userThought: "我想先找出选择受到的约束。" },
      companionPack: "# 修改后伴读包\n\n包含修订后的个人理解。"
    }, { root });
    assert.equal(modified.localReadbackVerified, true);
    assert.equal(modified.companionPackAvailable, true);
    assert.match(await readFile(path.join(root, modified.companionPackPath), "utf8"), /修改后伴读包/);
    assert.notEqual(modified.recordVersion, expectedVersion);
    const modifiedBookText = await readFile(path.join(root, stored.publicPath), "utf8");
    assert.match(modifiedBookText, /用户明确表达：我想先找出选择受到的约束/);

    await assert.rejects(updateReadingRecord({
      recordId,
      expectedVersion,
      action: "modify",
      patch: { questions: ["过期编辑不应覆盖"] },
      companionPack: "# 过期修改包"
    }, { root }), /reading-version-conflict/);

    const replay = await storeReadingBatch(batch, { root });
    assert.equal(replay.addedCount, 0);
    assert.equal(replay.duplicateCount, 1);
    assert.match(await readFile(path.join(root, stored.publicPath), "utf8"), /用户明确表达：我想先找出选择受到的约束/);

    const modifiedState = JSON.parse(await readFile(statePath, "utf8"));
    const currentRecord = modifiedState.records[recordId];
    const currentVersion = createHash("sha256").update(JSON.stringify(currentRecord)).digest("hex");
    const revoked = await updateReadingRecord({ recordId, expectedVersion: currentVersion, action: "revoke", companionPack: "# 撤销后的伴读包\n\n已移除该条记录。" }, { root });
    assert.equal(revoked.remoteHistoryMayRemain, true);
    assert.equal(revoked.publicPath, null);
    await assert.rejects(readFile(path.join(root, stored.publicPath), "utf8"), /ENOENT/);
    assert.doesNotMatch(await readFile(path.join(root, stored.indexPath), "utf8"), /可靠判断/);
    const revokedState = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(revokedState.records[recordId].status, "withdrawn");
    assert.equal(revokedState.records[recordId].visibility, "private");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pending modification can only resume with the exact same request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-modify-recover-"));
  try {
    const stored = await storeReadingBatch(wereadBatch(), { root });
    const statePath = path.join(root, ".runtime/reading/state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const { recordId } = stored.records[0];
    const expectedVersion = createHash("sha256").update(JSON.stringify(state.records[recordId])).digest("hex");
    const indexPath = path.join(root, stored.indexPath);
    const originalIndex = await readFile(indexPath, "utf8");
    await writeFile(indexPath, "concurrent manual edit\n", "utf8");
    const request = { recordId, expectedVersion, action: "modify", patch: { authorContent: "经用户明确修订的命题。" }, companionPack: "# 待处理的修改伴读包\n\n保留待恢复内容。" };

    await assert.rejects(updateReadingRecord(request, { root }), /reading-managed-file-conflict/);
    await assert.rejects(updateReadingRecord({ ...request, patch: { authorContent: "另一项不同修改。" } }, { root }), /reading-modification-pending-conflict/);
    await writeFile(indexPath, originalIndex, "utf8");
    const recovered = await updateReadingRecord(request, { root });
    assert.equal(recovered.localReadbackVerified, true);
    assert.match(await readFile(path.join(root, stored.publicPath), "utf8"), /经用户明确修订的命题/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

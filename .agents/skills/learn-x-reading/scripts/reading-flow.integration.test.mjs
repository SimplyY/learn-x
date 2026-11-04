import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectWereadRange } from "../../learn-x-input/scripts/collect-weread-range.mjs";
import { storeReadingBatch } from "./store-reading.mjs";

test("mock WeRead range flows through curation fields, private source hashes, public save and companion pack", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-reading-flow-"));
  try {
    const now = new Date("2026-11-03T02:15:00Z");
    const current = Math.floor(now.getTime() / 1000) - 300;
    const collected = await collectWereadRange({
      now,
      skillVersion: "mock",
      callApi: async ({ api_name }) => {
        if (api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "mock-book", sort: current, book: { title: "模拟阅读书", author: "合成作者" } }] };
        if (api_name === "/book/bookmarklist") return {
          chapters: [{ chapterUid: "c1", title: "第一章" }],
          updated: [{ bookmarkId: "m1", chapterUid: "c1", range: "1-3", markText: "合成标记内容", createTime: current }]
        };
        if (api_name === "/review/list/mine") return {
          hasMore: 0,
          reviews: [{ reviewId: "r1", review: { reviewId: "r1", chapterUid: "c1", chapterName: "第一章", content: "合成用户想法", createTime: current } }]
        };
        throw new Error(`unexpected request: ${api_name}`);
      }
    });

    assert.equal(collected.complete, true);
    assert.deepEqual(collected.counts, { candidateBooks: 1, books: 1, acquiredHighlights: 1, acquiredThoughts: 1, unusableEntries: 0 });
    const book = collected.books[0];
    const entries = [
      ...book.highlights.map((item) => ({
        sourceId: item.sourceId,
        sourceEvidence: item.sourceEvidence,
        location: item.chapterTitle,
        date: item.date,
        kind: "划线",
        authorContent: "合成转述：决策前先识别问题边界。",
        foundations: ["合成思想基石"],
        status: "ready",
        visibility: "public"
      })),
      ...book.thoughts.map((item) => ({
        sourceId: item.sourceId,
        sourceEvidence: item.sourceEvidence,
        location: item.chapterTitle,
        date: item.date,
        kind: item.type,
        userThought: item.content,
        status: "ready",
        visibility: "public"
      }))
    ];
    const stored = await storeReadingBatch({
      batchId: "mock-reading-flow",
      source: "weread",
      book: { title: book.title, author: book.author, bookId: book.bookId },
      entries,
      companionPack: "# 模拟伴读包\n\n仅用于离线贯通验收。"
    }, { root });

    assert.equal(stored.addedCount, 2);
    assert.equal(stored.publicReadbackVerified, true);
    assert.equal(stored.companionPackAvailable, true);
    const markdown = await readFile(path.join(root, stored.publicPath), "utf8");
    assert.match(markdown, /作者内容提炼：合成转述/);
    assert.match(markdown, /用户明确表达：合成用户想法/);
    assert.doesNotMatch(markdown, /weread-bookmark:mock-book:m1|合成标记内容/);
    const state = JSON.parse(await readFile(path.join(root, ".runtime/reading/state.json"), "utf8"));
    const storedRecords = Object.values(state.records);
    assert.equal(storedRecords.length, 2);
    assert.ok(storedRecords.every((entry) => /^[a-f0-9]{64}$/.test(entry.sourceFingerprint)));
    assert.ok(storedRecords.every((entry) => !Object.hasOwn(entry, "sourceEvidence")));
    assert.match(await readFile(path.join(root, stored.companionPackPath), "utf8"), /模拟伴读包/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectWereadRange, defaultRecentRange, parseShanghaiDateRange, writeWereadRange } from "./collect-weread-range.mjs";

test("default range is Shanghai midnight for today and the prior two days through now", () => {
  const now = new Date("2026-11-03T02:15:00Z"); // 10:15 Shanghai
  assert.deepEqual(defaultRecentRange(now), { startEpoch: 1793462400, endEpoch: 1793672100 });
});

test("explicit date range uses Shanghai calendar dates and includes the end date", () => {
  assert.deepEqual(parseShanghaiDateRange({ from: "2026-11-01", to: "2026-11-03", now: new Date("2026-11-03T03:00:00Z") }), {
    startEpoch: 1793462400,
    endEpoch: 1793721600
  });
  assert.throws(() => parseShanghaiDateRange({ from: "2026-02-30", to: "2026-03-01" }), /date-invalid/);
  assert.throws(() => parseShanghaiDateRange({ from: "2026-11-03" }), /range-incomplete/);
});

test("collects range highlights and thoughts with stable source IDs and acquired/complete counts", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const start = defaultRecentRange(now).startEpoch;
  const current = start + 58 * 3600 - 1;
  const calls = [];
  const payload = await collectWereadRange({
    now,
    skillVersion: "1.0.5",
    callApi: async (request) => {
      calls.push(request);
      if (request.api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "book-1", sort: current, book: { title: "边界之书", author: "作者" } }] };
      if (request.api_name === "/book/bookmarklist") return {
        book: { title: "边界之书" },
        chapters: [{ chapterUid: 7, title: "第二章" }],
        updated: [
          { bookmarkId: "mark-1", chapterUid: 7, range: "100-140", markText: "核心划线", createTime: current },
          { bookmarkId: "old", chapterUid: 7, markText: "范围外", createTime: start - 1 }
        ]
      };
      if (request.api_name === "/review/list/mine") return { hasMore: 0, reviews: [{ reviewId: "thought-1", review: { reviewId: "thought-1", bookId: "book-1", chapterUid: 7, chapterName: "第二章", content: "我的想法", createTime: current } }] };
      throw new Error(`unexpected request ${request.api_name}`);
    }
  });

  assert.equal(payload.complete, true);
  assert.deepEqual(payload.counts, { candidateBooks: 1, books: 1, acquiredHighlights: 1, acquiredThoughts: 1, unusableEntries: 0 });
  assert.equal(payload.books[0].bookId, "book-1");
  assert.equal(payload.books[0].highlights[0].sourceId, "weread-bookmark:book-1:mark-1");
  assert.equal(payload.books[0].highlights[0].chapterTitle, "第二章");
  assert.equal(payload.books[0].thoughts[0].sourceId, "weread-review:book-1:thought-1");
  assert.equal(calls.some((request) => request.api_name === "/readdata/detail"), false);
});

test("includes books with later notebook activity when collecting an earlier range", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const { startEpoch } = parseShanghaiDateRange({ from: "2026-11-01", to: "2026-11-01", now });
  const endEpoch = parseShanghaiDateRange({ from: "2026-11-01", to: "2026-11-01", now }).endEpoch;
  const payload = await collectWereadRange({
    from: "2026-11-01",
    to: "2026-11-01",
    now,
    skillVersion: "1.0.5",
    callApi: async (request) => {
      if (request.api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "book-later", sort: endEpoch + 60, book: { title: "后续仍在读" } }] };
      if (request.api_name === "/book/bookmarklist") return {
        book: { title: "后续仍在读" },
        chapters: [],
        updated: [{ bookmarkId: "in-range", markText: "范围内划线", createTime: startEpoch + 60 }]
      };
      if (request.api_name === "/review/list/mine") return { hasMore: 0, reviews: [] };
      throw new Error(`unexpected request ${request.api_name}`);
    }
  });
  assert.equal(payload.complete, true);
  assert.equal(payload.counts.books, 1);
  assert.equal(payload.counts.acquiredHighlights, 1);
});

test("uses detail title when notebook title is absent and marks invalid entry times incomplete", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const start = defaultRecentRange(now).startEpoch;
  const payload = await collectWereadRange({
    now,
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => {
      if (api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "book-no-title", sort: start + 10 }] };
      if (api_name === "/book/bookmarklist") return {
        book: { title: "详情备用书名", author: "作者" },
        chapters: [],
        updated: [
          { bookmarkId: "good", markText: "可定位记录", createTime: start + 20 },
          { bookmarkId: "bad", markText: "时间缺失的记录" }
        ]
      };
      if (api_name === "/review/list/mine") return { hasMore: 0, reviews: [{ reviewId: "bad-review", review: { content: "时间缺失的想法" } }] };
      throw new Error(`unexpected request ${api_name}`);
    }
  });
  assert.equal(payload.complete, false);
  assert.equal(payload.counts.books, 1);
  assert.equal(payload.books[0].title, "详情备用书名");
  assert.equal(payload.counts.acquiredHighlights, 1);
  assert.ok(payload.errors.some((error) => /highlight entries had missing or invalid createTime/.test(error.reason)));
  assert.ok(payload.errors.some((error) => /thought entries had missing or invalid createTime/.test(error.reason)));
});

test("marks stable WeRead entries with empty source text incomplete", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const start = defaultRecentRange(now).startEpoch;
  const payload = await collectWereadRange({
    now,
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => {
      if (api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "empty-book", sort: start + 20, book: { title: "空正文来源" } }] };
      if (api_name === "/book/bookmarklist") return {
        chapters: [],
        updated: [{ bookmarkId: "empty-mark", markText: "  ", createTime: start + 10 }]
      };
      if (api_name === "/review/list/mine") return {
        hasMore: 0,
        reviews: [{ reviewId: "empty-thought", review: { reviewId: "empty-thought", content: "", abstract: "", createTime: start + 11 } }]
      };
      throw new Error(`unexpected request ${api_name}`);
    }
  });
  assert.equal(payload.complete, false);
  assert.equal(payload.counts.unusableEntries, 2);
  assert.ok(payload.errors.some((error) => /2 entries had valid identities\/timestamps but no readable/.test(error.reason)));
});

test("reports partial book failure without claiming a complete collection", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const start = defaultRecentRange(now).startEpoch;
  const payload = await collectWereadRange({
    now,
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => {
      if (api_name === "/user/notebooks") return { hasMore: 0, books: [{ bookId: "book-1", sort: start + 10, book: { title: "失败书" } }] };
      if (api_name === "/book/bookmarklist") throw new Error("bookmarks unavailable");
      throw new Error("unexpected call");
    }
  });
  assert.equal(payload.complete, false);
  assert.equal(payload.counts.books, 0);
  assert.match(payload.errors[0].reason, /bookmarks unavailable/);
});

test("rejects stalled notebook pagination and ambiguous title filters", async () => {
  const now = new Date("2026-11-03T02:15:00Z");
  const start = defaultRecentRange(now).startEpoch;
  let pages = 0;
  const stalled = await collectWereadRange({
    now,
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => {
      if (api_name === "/user/notebooks") {
        pages += 1;
        return { hasMore: 1, books: [{ bookId: `book-${pages}`, sort: start + 10, book: { title: "同名书" } }] };
      }
      throw new Error("unexpected call");
    }
  });
  assert.equal(stalled.complete, false);
  assert.ok(stalled.errors.some((error) => /cursor did not advance/.test(error.reason)));

  await assert.rejects(collectWereadRange({
    from: "2026-11-01",
    to: "2026-11-01",
    book: "同名书",
    now,
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => api_name === "/user/notebooks"
      ? { hasMore: 0, books: [
        { bookId: "book-a", sort: start + 5, book: { title: "同名书" } },
        { bookId: "book-b", sort: start + 6, book: { title: "同名书" } }
      ] }
      : { hasMore: 0, reviews: [] }
  }), /book-ambiguous/);
});

test("marks notebook entries without a usable recent-note sort as incomplete", async () => {
  const payload = await collectWereadRange({
    from: "2026-11-01",
    to: "2026-11-01",
    now: new Date("2026-11-03T02:15:00Z"),
    skillVersion: "1.0.5",
    callApi: async ({ api_name }) => api_name === "/user/notebooks"
      ? { hasMore: 0, books: [{ bookId: "book-no-sort", book: { title: "缺少排序时间" } }] }
      : { hasMore: 0, reviews: [] }
  });
  assert.equal(payload.complete, false);
  assert.ok(payload.errors.some((error) => /missing or invalid recent-note sort/.test(error.reason)));
});

test("writes a private collection snapshot atomically and reads it back", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-range-"));
  const outputPath = path.join(root, "private", "range.json");
  try {
    const result = await writeWereadRange({
      from: "2026-11-01",
      to: "2026-11-01",
      now: new Date("2026-11-03T02:15:00Z"),
      root,
      skillVersion: "1.0.5",
      outputPath,
      callApi: async ({ api_name }) => {
        if (api_name === "/user/notebooks") return { hasMore: 0, books: [] };
        throw new Error(`unexpected request ${api_name}`);
      }
    });
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).complete, true);
    assert.equal((await stat(path.dirname(outputPath))).mode & 0o777, 0o700);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(result.payload.counts.books, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a symlink in the private collection output path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-symlink-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-symlink-outside-"));
  try {
    await symlink(outside, path.join(root, ".runtime"));
    let apiCalls = 0;
    await assert.rejects(writeWereadRange({
      root,
      now: new Date("2026-11-03T02:15:00Z"),
      skillVersion: "1.0.5",
      callApi: async ({ api_name }) => {
        apiCalls += 1;
        return api_name === "/user/notebooks" ? { hasMore: 0, books: [] } : { hasMore: 0, reviews: [] };
      }
    }), /reading-path-symlink/);
    assert.equal(apiCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

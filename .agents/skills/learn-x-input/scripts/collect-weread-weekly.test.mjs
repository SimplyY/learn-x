import assert from "node:assert/strict";
import test from "node:test";
import { collectWereadWeekly, isoWeekRangeShanghai, normalizeWeek, renderMarkdown } from "./collect-weread-weekly.mjs";

test("normalizes week ids and calculates Shanghai boundaries", () => {
  assert.equal(normalizeWeek("2026-24"), "2026-W24");
  assert.deepEqual(isoWeekRangeShanghai("2026-W24"), {
    startEpoch: 1780848000,
    endEpoch: 1781452800
  });
});

test("collects only highlights and thoughts inside the requested week", async () => {
  const responses = new Map([
    ["/user/notebooks", { hasMore: 0, books: [{ bookId: "book-1", sort: 1781183617, book: { title: "测试书", author: "作者" } }] }],
    ["/readdata/detail", {
      totalReadTime: 5400,
      readDays: 2,
      dayAverageReadTime: 1350,
      readTimes: { 1780848000: 1800, 1781107200: 3600 },
      readLongest: [{ book: { bookId: "book-1" }, readTime: 3600 }]
    }],
    ["/shelf/sync", {
      books: [
        { bookId: "book-1", title: "测试书", author: "作者", readUpdateTime: 1781185000 },
        { bookId: "book-3", title: "刚加入书架", author: "作者", readUpdateTime: 1781185000 },
        { bookId: "book-2", title: "上周读的书", author: "作者", readUpdateTime: 1780847999 }
      ]
    }],
    ["/book/getprogress", { book: { chapterUid: 2, progress: 45 } }],
    ["/book/chapterinfo", { chapters: [{ chapterUid: 2, title: "第二章" }] }],
    ["/book/bookmarklist", {
      updated: [
        { bookmarkId: "in", bookId: "book-1", chapterUid: 1, range: "10-20", markText: "本周划线内容", createTime: 1781183617 },
        { bookmarkId: "out", bookId: "book-1", chapterUid: 1, range: "30-40", markText: "上周划线内容", createTime: 1780847999 }
      ],
      chapters: [{ chapterUid: 1, title: "第一章" }]
    }],
    ["/review/list/mine", {
      hasMore: 0,
      reviews: [{ reviewId: "thought-1", review: { reviewId: "thought-1", bookId: "book-1", chapterUid: 1, chapterName: "第一章", range: "10-20", abstract: "本周划线内容", content: "本周想法内容", createTime: 1781184000 } }]
    }]
  ]);
  const callApi = async ({ api_name, bookId }) => {
    if (api_name === "/book/getprogress" && bookId === "book-3") return { book: { progress: 0 } };
    return responses.get(api_name);
  };
  const payload = await collectWereadWeekly({ week: "2026-W24", apiKey: "test", callApi });

  assert.equal(payload.stats.highlightCount, 1);
  assert.equal(payload.stats.thoughtCount, 1);
  assert.equal(payload.stats.readBookCount, 1);
  assert.equal(payload.reading.totalReadTime, 5400);
  assert.equal(payload.reading.books[0].currentChapter, "第二章");
  assert.equal(payload.reading.books[0].readTime, 3600);
  assert.equal(payload.reading.dailyReadTimes.length, 7);
  assert.equal(payload.reading.dailyReadTimes[0].seconds, 1800);
  assert.equal(payload.reading.dailyReadTimes[1].seconds, 0);
  assert.equal(payload.reading.books[0].bookId, undefined);
  assert.equal(payload.books[0].bookId, undefined);
  assert.equal(payload.books[0].highlights[0].id, undefined);
  assert.equal(payload.books[0].highlights[0].range, undefined);
  assert.equal(payload.books[0].thoughts[0].id, undefined);
  const markdown = renderMarkdown(payload);
  assert.match(markdown, /阅读 \/ 收听总时长：1 小时 30 分钟/);
  assert.match(markdown, /最近阅读到：第二章/);
  assert.match(markdown, /本周书籍阅读时长：1 小时/);
  assert.match(markdown, /2026-06-08（周一）：30 分钟/);
  assert.match(markdown, /2026-06-09（周二）：0 分钟/);
  assert.doesNotMatch(markdown, /刚加入书架/);
  assert.match(markdown, /本周想法内容/);
  assert.doesNotMatch(markdown, /上周划线内容/);
  assert.doesNotMatch(markdown, /ID：|位置：|weread:\/\//);
});

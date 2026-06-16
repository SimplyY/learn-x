import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const API_URL = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.3";
const KEYCHAIN_SERVICE = "learn-x-weread-api-key";
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export async function collectWereadWeekly(options = {}) {
  const apiKey = options.apiKey || process.env.WEREAD_API_KEY || await readApiKeyFromKeychain();
  if (!apiKey) {
    throw new Error(`WeRead API Key is not configured. Set WEREAD_API_KEY or store it in macOS Keychain service ${KEYCHAIN_SERVICE}.`);
  }

  const week = normalizeWeek(options.week || currentShanghaiIsoWeek());
  const range = isoWeekRangeShanghai(week);
  const callApi = options.callApi || ((payload) => callWereadApi(payload, apiKey));
  const [notebooks, readingDetail, shelf] = await Promise.all([
    collectCandidateBooks(callApi, range.startEpoch),
    callApi({ api_name: "/readdata/detail", mode: "weekly", baseTime: range.startEpoch }),
    callApi({ api_name: "/shelf/sync" })
  ]);
  const reading = await collectReadingActivity(callApi, range, readingDetail, shelf);
  const books = [];

  for (const notebook of notebooks) {
    const [bookmarkResponse, reviews] = await Promise.all([
      callApi({ api_name: "/book/bookmarklist", bookId: notebook.bookId }),
      collectBookReviews(callApi, notebook.bookId)
    ]);
    const chapterTitles = new Map((bookmarkResponse.chapters || []).map((chapter) => [String(chapter.chapterUid), chapter.title]));
    const highlights = (bookmarkResponse.updated || [])
      .filter((item) => inRange(item.createTime, range))
      .map((item) => normalizeHighlight(item, chapterTitles));
    const thoughts = reviews
      .filter((item) => inRange(item.review?.createTime, range))
      .map(normalizeThought);

    if (!highlights.length && !thoughts.length) continue;
    books.push({
      title: notebook.book?.title || bookmarkResponse.book?.title || "未命名书籍",
      author: notebook.book?.author || bookmarkResponse.book?.author || "",
      highlights,
      thoughts
    });
  }

  books.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  const generatedAt = new Date().toISOString();
  return {
    week,
    timezone: "Asia/Shanghai",
    range: {
      start: formatShanghaiDateTime(range.startEpoch),
      endExclusive: formatShanghaiDateTime(range.endEpoch)
    },
    generatedAt,
    skillVersion: SKILL_VERSION,
    reading,
    stats: {
      candidateBookCount: notebooks.length,
      readBookCount: reading.books.length,
      bookCount: books.length,
      highlightCount: books.reduce((sum, book) => sum + book.highlights.length, 0),
      thoughtCount: books.reduce((sum, book) => sum + book.thoughts.length, 0)
    },
    books
  };
}

async function readApiKeyFromKeychain() {
  if (process.platform !== "darwin" || !process.env.USER) return "";
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a", process.env.USER,
      "-s", KEYCHAIN_SERVICE,
      "-w"
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function collectReadingActivity(callApi, range, readingDetail, shelf) {
  const rankedReadTimes = new Map(
    (readingDetail.readLongest || [])
      .filter((item) => item.book?.bookId)
      .map((item) => [String(item.book.bookId), Number(item.readTime)])
  );
  const recentBooks = (shelf.books || []).filter((book) => inRange(book.readUpdateTime, range));
  const bookCandidates = await Promise.all(recentBooks.map(async (book) => {
    const progressResponse = await callApi({ api_name: "/book/getprogress", bookId: book.bookId });
    const progress = progressResponse.book || {};
    let currentChapter = "未知章节";

    if (progress.chapterUid != null) {
      const chapterResponse = await callApi({ api_name: "/book/chapterinfo", bookId: book.bookId });
      currentChapter = (chapterResponse.chapters || [])
        .find((chapter) => String(chapter.chapterUid) === String(progress.chapterUid))?.title || "未知章节";
    }

    const rankedReadTime = rankedReadTimes.get(String(book.bookId));
    return {
      title: book.title || "未命名书籍",
      author: book.author || "",
      lastReadDate: formatShanghaiDate(book.readUpdateTime),
      progress: Number.isFinite(Number(progress.progress)) ? Number(progress.progress) : null,
      currentChapter,
      readTime: Number.isFinite(rankedReadTime) ? rankedReadTime : null
    };
  }));
  const books = bookCandidates.filter((book) =>
    (book.progress != null && book.progress > 0)
    || book.currentChapter !== "未知章节"
    || (book.readTime != null && book.readTime > 0)
  );

  books.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  return {
    totalReadTime: finiteNumber(readingDetail.totalReadTime),
    readDays: finiteNumber(readingDetail.readDays),
    dayAverageReadTime: finiteNumber(readingDetail.dayAverageReadTime),
    dailyReadTimes: buildDailyReadTimes(range, readingDetail.readTimes),
    wrReadTime: finiteNumber(readingDetail.wrReadTime),
    wrListenTime: finiteNumber(readingDetail.wrListenTime),
    books
  };
}

export async function writeWereadWeekly(options = {}) {
  const payload = await collectWereadWeekly(options);
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", payload.week);
  const notesPath = path.join(outputRoot, "weread.md");
  const suffix = `${process.pid}-${Date.now()}`;
  const notesTempPath = `${notesPath}.${suffix}.tmp`;

  await mkdir(outputRoot, { recursive: true });
  await writeFile(notesTempPath, renderMarkdown(payload), "utf8");
  await rename(notesTempPath, notesPath);

  return { payload, notesPath };
}

async function collectCandidateBooks(callApi, startEpoch) {
  const books = [];
  let lastSort;

  while (true) {
    const response = await callApi({ api_name: "/user/notebooks", count: 100, ...(lastSort ? { lastSort } : {}) });
    const page = response.books || [];
    for (const book of page) {
      if (Number(book.sort) >= startEpoch) books.push(book);
    }

    const oldestSort = Number(page.at(-1)?.sort || 0);
    if (!response.hasMore || !page.length || oldestSort < startEpoch) break;
    lastSort = oldestSort;
  }

  return books;
}

async function collectBookReviews(callApi, bookId) {
  const reviews = [];
  let synckey = 0;

  while (true) {
    const response = await callApi({ api_name: "/review/list/mine", bookid: bookId, synckey, count: 100 });
    reviews.push(...(response.reviews || []));
    if (!response.hasMore) break;
    if (!response.synckey || response.synckey === synckey) {
      throw new Error(`WeRead review pagination did not advance for book ${bookId}.`);
    }
    synckey = response.synckey;
  }

  return reviews;
}

async function callWereadApi(payload, apiKey) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...payload, skill_version: SKILL_VERSION })
  });
  if (!response.ok) throw new Error(`WeRead API HTTP ${response.status}.`);

  const data = await response.json();
  if (data.upgrade_info) {
    throw new Error(data.upgrade_info.message || "The WeRead Skill must be upgraded before retrying.");
  }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeRead API error ${data.errcode}: ${data.errmsg || "unknown error"}`);
  }
  return data;
}

function normalizeHighlight(item, chapterTitles) {
  return {
    createTime: Number(item.createTime),
    date: formatShanghaiDate(item.createTime),
    chapterTitle: chapterTitles.get(String(item.chapterUid)) || "未知章节",
    text: cleanText(item.markText)
  };
}

function normalizeThought(item) {
  const review = item.review || {};
  return {
    createTime: Number(review.createTime),
    date: formatShanghaiDate(review.createTime),
    chapterTitle: review.chapterName || review.chapterTitle || (review.chapterUid ? "未知章节" : "整本书"),
    abstract: cleanText(review.abstract || review.contextAbstract || ""),
    content: cleanText(review.content || ""),
    type: review.range ? "划线想法" : review.chapterUid ? "章节点评" : "整本书评"
  };
}

export function renderMarkdown(payload) {
  const lines = [
    `# 微信读书｜${payload.week}`,
    "",
    `- 来源：微信读书阅读统计、阅读进度、个人划线与个人想法`,
    `- 采集范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 本周阅读书籍：${payload.stats.readBookCount} 本`,
    `- 产生笔记书籍：${payload.stats.bookCount} 本`,
    `- 划线：${payload.stats.highlightCount} 条`,
    `- 想法：${payload.stats.thoughtCount} 条`,
    "",
    "## 本周阅读活动",
    "",
    `- 阅读 / 收听总时长：${formatDuration(payload.reading.totalReadTime)}`,
    `- 有效阅读天数：${payload.reading.readDays ?? 0} 天`,
    `- 自然日均时长：${formatDuration(payload.reading.dayAverageReadTime)}`,
    "",
    "### 每日阅读时长",
    "",
    ...payload.reading.dailyReadTimes.map((item) => `- ${item.date}（${item.weekday}）：${formatDuration(item.seconds)}`)
  ];

  if (payload.reading.wrReadTime != null) lines.push(`- 文字阅读时长：${formatDuration(payload.reading.wrReadTime)}`);
  if (payload.reading.wrListenTime != null) lines.push(`- 收听时长：${formatDuration(payload.reading.wrListenTime)}`);
  lines.push("");

  if (!payload.reading.books.length) {
    lines.push("本周没有检测到书籍阅读记录。", "");
  } else {
    lines.push("> 章节为每本书截至本周最近阅读时的当前章节，不代表完整的逐章阅读历史。单书时长仅在微信读书本周排行返回时展示。", "");
    for (const book of payload.reading.books) {
      lines.push(`### 《${book.title}》${book.author ? `｜${book.author}` : ""}`, "");
      lines.push(`- 最近阅读：${book.lastReadDate}`);
      if (book.progress != null) lines.push(`- 当前进度：${book.progress}%`);
      lines.push(`- 最近阅读到：${book.currentChapter}`);
      if (book.readTime != null) lines.push(`- 本周书籍阅读时长：${formatDuration(book.readTime)}`);
      lines.push("");
    }
  }

  lines.push(
    "## 本周划线与想法",
    ""
  );

  if (!payload.books.length) {
    lines.push("本周没有新增划线或想法。", "");
    return lines.join("\n");
  }

  for (const book of payload.books) {
    lines.push(`### 《${book.title}》${book.author ? `｜${book.author}` : ""}`, "");
    const entries = [
      ...book.highlights.map((item) => ({ ...item, kind: "划线" })),
      ...book.thoughts.map((item) => ({ ...item, kind: item.type }))
    ].sort((a, b) => a.createTime - b.createTime
      || a.kind.localeCompare(b.kind, "zh-Hans-CN")
      || String(a.text || a.content).localeCompare(String(b.text || b.content), "zh-Hans-CN"));
    let currentChapter;

    for (const entry of entries) {
      if (entry.chapterTitle !== currentChapter) {
        currentChapter = entry.chapterTitle;
        lines.push(`#### ${currentChapter}`, "");
      }
      lines.push(`##### ${entry.kind}｜${entry.date}`, "");
      if (entry.kind === "划线") {
        lines.push(...quoteLines(entry.text), "");
      } else {
        if (entry.abstract) lines.push(...quoteLines(entry.abstract), "");
        lines.push(entry.content || "（无正文）", "");
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function quoteLines(text) {
  return String(text || "").split("\n").map((line) => `> ${line}`);
}

function inRange(timestamp, range) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value >= range.startEpoch && value < range.endEpoch;
}

function cleanText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildDailyReadTimes(range, readTimes = {}) {
  const timesByDate = new Map();
  for (const [timestamp, seconds] of Object.entries(readTimes || {})) {
    const date = formatShanghaiDate(timestamp);
    timesByDate.set(date, (timesByDate.get(date) || 0) + (finiteNumber(seconds) || 0));
  }

  return Array.from({ length: 7 }, (_, index) => {
    const timestamp = range.startEpoch + index * 24 * 60 * 60;
    return {
      date: formatShanghaiDate(timestamp),
      weekday: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index],
      seconds: timesByDate.get(formatShanghaiDate(timestamp)) || 0
    };
  });
}

function formatDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} 分钟`;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

export function normalizeWeek(week) {
  const match = String(week).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${week}. Use YYYY-Www, for example 2026-W24.`);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) throw new Error(`Invalid ISO week number: ${weekNumber}.`);
  return `${match[1]}-W${String(weekNumber).padStart(2, "0")}`;
}

export function isoWeekRangeShanghai(week) {
  const normalized = normalizeWeek(week);
  const [, yearText, weekText] = normalized.match(/^(\d{4})-W(\d{2})$/);
  const year = Number(yearText);
  const weekNumber = Number(weekText);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayUtc = Date.UTC(year, 0, 4 - jan4Day + 1 + (weekNumber - 1) * 7);
  const startEpoch = Math.floor(mondayUtc / 1000) - SHANGHAI_OFFSET_SECONDS;
  return { startEpoch, endEpoch: startEpoch + 7 * 24 * 60 * 60 };
}

function currentShanghaiIsoWeek(date = new Date()) {
  const shanghai = new Date(date.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  const localDateAsUtc = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()));
  const day = localDateAsUtc.getUTCDay() || 7;
  localDateAsUtc.setUTCDate(localDateAsUtc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(localDateAsUtc.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((localDateAsUtc - yearStart) / 86400000 + 1) / 7);
  return `${localDateAsUtc.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function formatShanghaiDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Number(timestamp) * 1000));
}

function formatShanghaiDateTime(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(Number(timestamp) * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") {
      options.week = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeWereadWeekly(parseArgs(process.argv.slice(2)));
  console.log(`WeRead weekly input written: ${path.relative(repoRoot, result.notesPath)}`);
  console.log(`WeRead raw audit written: ${path.relative(repoRoot, result.rawPath)}`);
  console.log(`Books: ${result.payload.stats.bookCount}`);
  console.log(`Highlights: ${result.payload.stats.highlightCount}`);
  console.log(`Thoughts: ${result.payload.stats.thoughtCount}`);
}

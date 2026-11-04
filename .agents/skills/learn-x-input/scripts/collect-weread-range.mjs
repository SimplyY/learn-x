import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readFile, mkdir, writeFile, rename, chmod, lstat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readInstalledWereadSkillVersion } from "./collect-weread-weekly.mjs";

const API_URL = "https://i.weread.qq.com/api/agent/gateway";
const KEYCHAIN_SERVICE = "learn-x-weread-api-key";
const DAY_SECONDS = 24 * 60 * 60;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function defaultRecentRange(now = new Date()) {
  const endEpoch = Math.floor(now.getTime() / 1000);
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  const startOfToday = Date.UTC(shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), shanghaiNow.getUTCDate()) / 1000 - SHANGHAI_OFFSET_SECONDS;
  return { startEpoch: startOfToday - 2 * DAY_SECONDS, endEpoch };
}

export function parseShanghaiDateRange({ from, to, now = new Date() } = {}) {
  if (!from && !to) return defaultRecentRange(now);
  if (!from || !to) throw new Error("range-incomplete: provide both --from and --to dates.");
  const startEpoch = parseRangeEndpoint(from, "start");
  const endEpoch = parseRangeEndpoint(to, "end");
  if (endEpoch <= startEpoch) throw new Error("range-invalid: --to must be on or after --from.");
  return { startEpoch, endEpoch };
}

function shanghaiMidnight(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`date-invalid: expected YYYY-MM-DD, received ${value}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`date-invalid: ${value} is not a calendar date.`);
  }
  return utc / 1000 - SHANGHAI_OFFSET_SECONDS;
}

function parseRangeEndpoint(value, endpoint) {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const midnight = shanghaiMidnight(text);
    return endpoint === "end" ? midnight + DAY_SECONDS : midnight;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error(`datetime-invalid: expected YYYY-MM-DD or ISO timestamp with timezone, received ${value}.`);
  }
  shanghaiMidnight(text.slice(0, 10));
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`datetime-invalid: ${value} is not a valid timestamp.`);
  return Math.floor(milliseconds / 1000);
}

export async function collectWereadRange(options = {}) {
  const now = options.now || new Date();
  const range = parseShanghaiDateRange({ from: options.from, to: options.to, now });
  range.endEpoch = Math.min(range.endEpoch, Math.floor(now.getTime() / 1000));
  if (range.endEpoch <= range.startEpoch) throw new Error("range-empty: requested range is in the future or has no elapsed time.");
  const apiKey = options.apiKey || process.env.WEREAD_API_KEY || await readApiKeyFromKeychain();
  if (!apiKey && !options.callApi) throw new Error(`WeRead API Key is not configured. Set WEREAD_API_KEY or store it in macOS Keychain service ${KEYCHAIN_SERVICE}.`);
  const skillVersion = options.skillVersion || await readInstalledWereadSkillVersion(options.skillPath);
  const callApi = options.callApi || ((payload) => callWereadApi(payload, apiKey, skillVersion));
  const discovery = await collectCandidateBooks(callApi, range.startEpoch, range.endEpoch);
  const filter = options.book ? String(options.book).trim() : "";
  const matched = filter ? resolveBookFilter(discovery.books, filter) : discovery.books;
  const books = [];
  const errors = [...discovery.errors];

  for (const notebook of matched) {
    try {
      const [bookmarkFetch, reviewFetch] = await Promise.allSettled([
        callApi({ api_name: "/book/bookmarklist", bookId: notebook.bookId }),
        collectBookReviews(callApi, notebook.bookId)
      ]);
      let bookmarkResponse = {};
      let highlights = [];
      if (bookmarkFetch.status === "fulfilled") {
        bookmarkResponse = bookmarkFetch.value;
        if (!Array.isArray(bookmarkResponse.updated) || !Array.isArray(bookmarkResponse.chapters)) {
          errors.push({ bookId: String(notebook.bookId), title: notebook.book?.title || notebook.title || "未命名书籍", reason: "bookmark-response-invalid: missing updated entries or chapters." });
        } else {
          const chapterTitles = new Map(bookmarkResponse.chapters.map((chapter) => [String(chapter.chapterUid), chapter.title]));
          const selected = selectRangeEntries(bookmarkResponse.updated, (item) => item.createTime, range);
          highlights = selected.items
            .map((item) => normalizeHighlight(item, notebook, chapterTitles));
          if (selected.invalidTimestampCount) errors.push({
            bookId: String(notebook.bookId),
            title: notebook.book?.title || notebook.title || "未命名书籍",
            reason: `${selected.invalidTimestampCount} highlight entries had missing or invalid createTime values.`
          });
        }
      } else {
        errors.push({ bookId: String(notebook.bookId), title: notebook.book?.title || notebook.title || "未命名书籍", reason: `bookmark-fetch-failed: ${bookmarkFetch.reason.message}` });
      }
      let reviewResult;
      if (reviewFetch.status === "fulfilled") reviewResult = reviewFetch.value;
      else reviewResult = { reviews: [], complete: false, error: `review-fetch-failed: ${reviewFetch.reason.message}` };
      if (!reviewResult.complete) errors.push({ bookId: String(notebook.bookId), title: notebook.book?.title || notebook.title || "未命名书籍", reason: reviewResult.error });
      const selectedThoughts = selectRangeEntries(reviewResult.reviews, (item) => item.review?.createTime, range);
      const thoughts = selectedThoughts.items
        .map((item) => normalizeThought(item, notebook));
      if (selectedThoughts.invalidTimestampCount) errors.push({
        bookId: String(notebook.bookId),
        title: notebook.book?.title || notebook.title || "未命名书籍",
        reason: `${selectedThoughts.invalidTimestampCount} thought entries had missing or invalid createTime values.`
      });

      const unusableContentCount = highlights.filter((item) => !item.text)
        .length + thoughts.filter((item) => !item.content && !item.abstract).length;
      if (unusableContentCount) errors.push({
        bookId: String(notebook.bookId),
        title: notebook.book?.title || notebook.title || "未命名书籍",
        reason: `${unusableContentCount} entries had valid identities/timestamps but no readable highlight text or thought content.`
      });

      const missingIdentityCount = [...highlights, ...thoughts].filter((item) => !item.identityVerified).length;
      if (missingIdentityCount) errors.push({
        bookId: String(notebook.bookId),
        title: notebook.book?.title || notebook.title || "未命名书籍",
        reason: `${missingIdentityCount} entries were missing stable WeRead source IDs.`
      });

      if (!highlights.length && !thoughts.length) continue;
      books.push({
        bookId: String(notebook.bookId),
        title: notebook.book?.title || notebook.title || bookmarkResponse.book?.title || "未命名书籍",
        author: notebook.book?.author || notebook.author || bookmarkResponse.book?.author || "",
        highlights,
        thoughts
      });
    } catch (error) {
      errors.push({ bookId: String(notebook.bookId), title: notebook.book?.title || notebook.title || "未命名书籍", reason: error.message });
    }
  }

  books.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN") || a.bookId.localeCompare(b.bookId));
  const highlightCount = books.reduce((sum, book) => sum + book.highlights.length, 0);
  const thoughtCount = books.reduce((sum, book) => sum + book.thoughts.length, 0);
  const unusableEntries = books.reduce((sum, book) => sum + book.highlights.filter((item) => !item.text).length + book.thoughts.filter((item) => !item.content && !item.abstract).length, 0);
  return {
    source: "weread",
    timezone: "Asia/Shanghai",
    range: { start: formatShanghaiDateTime(range.startEpoch), endExclusive: formatShanghaiDateTime(range.endEpoch) },
    complete: discovery.complete && errors.length === 0,
    skillVersion,
    requestedBook: filter || null,
    counts: { candidateBooks: matched.length, books: books.length, acquiredHighlights: highlightCount, acquiredThoughts: thoughtCount, unusableEntries },
    errors,
    books
  };
}

function resolveBookFilter(books, filter) {
  const byId = books.filter((book) => String(book.bookId) === filter);
  if (byId.length === 1) return byId;
  const byTitle = books.filter((book) => String(book.book?.title || book.title || "").trim() === filter);
  if (byTitle.length === 1) return byTitle;
  if (byTitle.length > 1) throw new Error(`book-ambiguous: ${filter} matches ${byTitle.length} WeRead books; use bookId.`);
  if (byId.length > 1) throw new Error(`book-ambiguous: ${filter} matches multiple book IDs.`);
  throw new Error(`book-not-found: ${filter} was not found among books with activity in this range.`);
}

async function collectCandidateBooks(callApi, startEpoch, endEpoch) {
  const books = [];
  const errors = [];
  let lastSort;
  let complete = true;
  const seenCursors = new Set();
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    let response;
    try {
      response = await callApi({ api_name: "/user/notebooks", count: 100, ...(lastSort ? { lastSort } : {}) });
    } catch (error) {
      errors.push({ reason: `notebook-page-${pageNumber + 1}: ${error.message}` });
      complete = false;
      break;
    }
    if (!Array.isArray(response.books) || response.hasMore == null) {
      errors.push({ reason: `notebook-page-${pageNumber + 1}: response missing books or hasMore.` });
      complete = false;
      break;
    }
    const page = response.books;
    for (const book of page) {
      const id = book.bookId ?? book.book?.bookId;
      if (!id) {
        errors.push({ reason: `notebook-page-${pageNumber + 1}: a book has no stable bookId.` });
        complete = false;
        continue;
      }
      const sort = Number(book.sort);
      if (book.sort == null || String(book.sort).trim() === "" || !Number.isFinite(sort) || sort <= 0) {
        errors.push({ reason: `notebook-page-${pageNumber + 1}: book ${String(id)} has a missing or invalid recent-note sort value.` });
        complete = false;
        continue;
      }
      // `sort` is the book's latest note time. A book with a later note may
      // still contain entries inside the requested historical range, so only
      // use the lower bound to prune older pages; filter each entry by both
      // bounds after fetching its detail.
      if (Number.isFinite(sort) && sort >= startEpoch) books.push({ ...book, bookId: String(id) });
    }
    if (!response.hasMore || response.hasMore === 0) break;
    if (!page.length) {
      errors.push({ reason: `notebook-page-${pageNumber + 1}: hasMore was true for an empty page.` });
      complete = false;
      break;
    }
    const nextSort = Number(page.at(-1)?.sort);
    if (!Number.isFinite(nextSort) || (lastSort != null && nextSort >= Number(lastSort)) || seenCursors.has(String(nextSort))) {
      errors.push({ reason: `notebook-page-${pageNumber + 1}: pagination cursor did not advance.` });
      complete = false;
      break;
    }
    lastSort = nextSort;
    seenCursors.add(String(nextSort));
    if (nextSort < startEpoch) break;
    if (pageNumber === 499) {
      errors.push({ reason: "notebook-pagination-limit: exceeded 500 pages." });
      complete = false;
    }
  }
  return { books, errors, complete };
}

async function collectBookReviews(callApi, bookId) {
  const reviews = [];
  let synckey = 0;
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    const response = await callApi({ api_name: "/review/list/mine", bookid: bookId, synckey, count: 100 });
    if (!Array.isArray(response.reviews) || response.hasMore == null) {
      return { reviews, complete: false, error: `review-page-${pageNumber + 1}: response missing reviews or hasMore.` };
    }
    reviews.push(...response.reviews);
    if (!response.hasMore || response.hasMore === 0) return { reviews, complete: true, error: null };
    if (response.synckey == null || String(response.synckey) === String(synckey)) {
      return { reviews, complete: false, error: `review-page-${pageNumber + 1}: pagination cursor did not advance.` };
    }
    synckey = response.synckey;
    if (pageNumber === 499) return { reviews, complete: false, error: "review-pagination-limit: exceeded 500 pages." };
  }
  return { reviews, complete: false, error: "review-pagination-limit: exceeded 500 pages." };
}

function normalizeHighlight(item, notebook, chapterTitles) {
  const id = item.bookmarkId ?? item.id;
  const text = cleanText(item.markText);
  return {
    sourceId: id == null ? null : `weread-bookmark:${notebook.bookId}:${id}`,
    bookId: String(notebook.bookId),
    createTime: Number(item.createTime),
    date: formatShanghaiDate(item.createTime),
    chapterUid: item.chapterUid == null ? null : String(item.chapterUid),
    chapterTitle: chapterTitles.get(String(item.chapterUid)) || "未知章节",
    range: item.range ?? null,
    text,
    sourceEvidence: { text, range: item.range ?? null, chapterUid: item.chapterUid == null ? null : String(item.chapterUid), createTime: Number(item.createTime) },
    identityVerified: id != null
  };
}

function normalizeThought(item, notebook) {
  const review = item.review || {};
  const id = review.reviewId ?? item.reviewId ?? item.id;
  const abstract = cleanText(review.abstract || review.contextAbstract || "");
  const content = cleanText(review.content || "");
  return {
    sourceId: id == null ? null : `weread-review:${notebook.bookId}:${id}`,
    bookId: String(notebook.bookId),
    createTime: Number(review.createTime),
    date: formatShanghaiDate(review.createTime),
    chapterUid: review.chapterUid == null ? null : String(review.chapterUid),
    chapterTitle: review.chapterName || review.chapterTitle || (review.chapterUid ? "未知章节" : "整本书"),
    range: review.range ?? null,
    abstract,
    content,
    sourceEvidence: {
      abstract,
      content,
      chapterUid: review.chapterUid == null ? null : String(review.chapterUid),
      range: review.range ?? null,
      createTime: Number(review.createTime)
    },
    type: review.range ? "划线想法" : review.chapterUid ? "章节点评" : "整本书评",
    identityVerified: id != null
  };
}

function inRange(timestamp, range) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value >= range.startEpoch && value < range.endEpoch;
}

function selectRangeEntries(items, getTimestamp, range) {
  const selected = [];
  let invalidTimestampCount = 0;
  for (const item of items) {
    const raw = getTimestamp(item);
    const timestamp = Number(raw);
    if (raw == null || String(raw).trim() === "" || !Number.isFinite(timestamp) || timestamp <= 0) {
      invalidTimestampCount += 1;
      continue;
    }
    if (inRange(timestamp, range)) selected.push(item);
  }
  return { items: selected, invalidTimestampCount };
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function formatShanghaiDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Number(timestamp) * 1000));
}

function formatShanghaiDateTime(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(Number(timestamp) * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

async function readApiKeyFromKeychain() {
  if (process.platform !== "darwin" || !process.env.USER) return "";
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", process.env.USER, "-s", KEYCHAIN_SERVICE, "-w"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function callWereadApi(payload, apiKey, skillVersion) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, skill_version: skillVersion })
  });
  if (!response.ok) throw new Error(`WeRead API HTTP ${response.status}.`);
  const data = await response.json();
  if (data.upgrade_info) throw new Error(`weread-skill-upgrade-required: ${data.upgrade_info.message || "The WeRead Skill must be upgraded before retrying."}`);
  if (data.errcode && data.errcode !== 0) throw new Error(`WeRead API error ${data.errcode}: ${data.errmsg || "unknown error"}`);
  return data;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (["--from", "--to", "--book"].includes(argv[index])) {
      options[{ "--from": "from", "--to": "to", "--book": "book" }[argv[index]]] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

export async function writeWereadRange(options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const outputPath = path.resolve(options.outputPath || path.join(root, ".runtime/reading/weread-range-latest.json"));
  await ensureSafeDirectory(root, path.dirname(outputPath), 0o700);
  await assertNoSymlinkPath(root, outputPath);
  const payload = await collectWereadRange(options);
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const readback = JSON.parse(await readFile(outputPath, "utf8"));
  if (JSON.stringify(readback) !== JSON.stringify(payload)) throw new Error("weread-range-readback-mismatch: local readback did not match collected payload.");
  return { payload, outputPath };
}

async function ensureSafeDirectory(root, directoryPath, mode) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(directoryPath);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("reading-path-outside-root: refusing to write outside the Learn-X root.");
  }
  const rootInfo = await lstat(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("reading-path-symlink: Learn-X root must be a real directory.");
  const segments = relative.split(path.sep).filter(Boolean);
  let current = absoluteRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: index === segments.length - 1 ? mode : 0o755 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("reading-path-symlink: refusing to follow a symlink in the reading output path.");
    if (!info.isDirectory()) throw new Error("reading-path-not-directory: reading output parent must be a directory.");
  }
  if (segments.length) await chmod(absoluteDirectory, mode);
}

async function assertNoSymlinkPath(root, targetPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("reading-path-outside-root: refusing to write outside the Learn-X root.");
  }
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("reading-path-symlink: refusing to follow a symlink in the reading output path.");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeWereadRange(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({
    output: path.relative(repoRoot, result.outputPath),
    range: result.payload.range,
    complete: result.payload.complete,
    bookCount: result.payload.counts.books,
    highlightCount: result.payload.counts.acquiredHighlights,
    thoughtCount: result.payload.counts.acquiredThoughts,
    errors: result.payload.errors
  }, null, 2));
}

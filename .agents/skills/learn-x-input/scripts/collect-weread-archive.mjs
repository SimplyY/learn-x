import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const API_URL = "https://i.weread.qq.com/api/agent/gateway";
// SKILL_VERSION 是 WeRead Agent Gateway 的协议版本参数（与 collect-weread-weekly.mjs 保持一致、已实测可用），不是产物版本号，不得随脚本演进改动。
const SKILL_VERSION = "1.0.4";
const KEYCHAIN_SERVICE = "learn-x-weread-api-key";
const GROUPS = ["fiction", "nonfiction"];
const GROUP_TITLES = { fiction: "小说", nonfiction: "非小说" };
const UNCATEGORIZED_LABEL = "未分类";
const UNKNOWN_YEAR = "unknown";
// ponytail: 小说类目白名单——WeRead 出现新小说类目时往 Set 里加一项即可；命中→fiction，其余（含 category 缺失）一律 nonfiction。
const NOVEL_CATEGORIES = new Set(["小说", "网络小说", "影视小说", "青春文学", "悬疑推理", "科幻", "武侠", "言情"]);
const REQUEST_DELAY_MS = 150;
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
// 书间排序：最近划线时间降序，并列按书名稳定排序
const recentFirst = (a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")) || a.title.localeCompare(b.title, "zh-Hans-CN");

export async function collectWereadArchive(options = {}) {
  const apiKey = options.apiKey || process.env.WEREAD_API_KEY || await readApiKeyFromKeychain();
  if (!apiKey) {
    throw new Error(`WeRead API Key is not configured. Set WEREAD_API_KEY or store it in macOS Keychain service ${KEYCHAIN_SERVICE}.`);
  }

  const callApi = options.callApi || ((payload) => callWereadApi(payload, apiKey));
  const sleep = options.sleep || defaultSleep;
  const now = options.now || (() => new Date());
  const notebooks = await collectAllNotebooks(callApi);
  const books = [];

  for (const notebook of notebooks) {
    await sleep(REQUEST_DELAY_MS);
    const info = await callApi({ api_name: "/book/info", bookId: notebook.bookId });
    await sleep(REQUEST_DELAY_MS);
    const bookmarkResponse = await callApi({ api_name: "/book/bookmarklist", bookId: notebook.bookId });
    const category = String(info.category || "").trim();
    const chapterTitles = new Map((bookmarkResponse.chapters || []).map((chapter) => [String(chapter.chapterUid), chapter.title]));
    const highlights = (bookmarkResponse.updated || [])
      .map((item) => normalizeHighlight(item, chapterTitles))
      .sort((a, b) => a.createTime - b.createTime);

    if (!highlights.length) continue;
    // 年归属：整本书归入「划线最多的年份」（并列取最近年），绝不劈开；全部无有效日期 → unknown
    const validTimes = highlights.map((item) => item.createTime).filter(isValidTimestamp);
    books.push({
      bookId: String(notebook.bookId),
      title: notebook.book?.title || bookmarkResponse.book?.title || info.title || "未命名书籍",
      author: notebook.book?.author || bookmarkResponse.book?.author || info.author || "",
      category,
      group: classifyGroup(category),
      highlights,
      chars: highlights.reduce((sum, item) => sum + [...item.text].length, 0),
      firstAt: validTimes.length ? formatShanghaiDate(validTimes[0]) : null,
      lastAt: validTimes.length ? formatShanghaiDate(validTimes[validTimes.length - 1]) : null,
      assignedYear: assignYear(highlights)
    });
  }

  books.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  const categoryDistribution = {};
  for (const book of books) {
    const key = book.category || "";
    if (!categoryDistribution[key]) categoryDistribution[key] = { group: book.group, books: 0, highlights: 0 };
    categoryDistribution[key].books += 1;
    categoryDistribution[key].highlights += book.highlights.length;
  }

  return {
    generatedAt: now().toISOString(),
    skillVersion: SKILL_VERSION,
    totals: Object.fromEntries(GROUPS.map((group) => [group, groupStats(books, group)])),
    books,
    perBook: books.map((book) => ({
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      category: book.category,
      group: book.group,
      highlightCount: book.highlights.length,
      chars: book.chars,
      assignedYear: book.assignedYear,
      file: `${book.group}/${book.assignedYear || UNKNOWN_YEAR}.md`,
      firstAt: book.firstAt,
      lastAt: book.lastAt
    })),
    yearDistribution: buildYearDistribution(books),
    categoryDistribution,
    unclassifiedBooks: books.filter((book) => !book.category).map((book) => book.title)
  };
}

export async function writeWereadArchive(options = {}) {
  const outputRoot = options.outputRoot || path.join(repoRoot, "05_library/weread");
  const payload = await collectWereadArchive(options);
  const manifest = {
    generatedAt: payload.generatedAt,
    skillVersion: payload.skillVersion,
    totals: payload.totals,
    perBook: payload.perBook,
    yearDistribution: payload.yearDistribution,
    categoryDistribution: payload.categoryDistribution,
    unclassifiedBooks: payload.unclassifiedBooks
  };
  const files = [
    ...yearFileEntries(payload).map(([group, year, books]) => [path.join(outputRoot, group, `${year}.md`), renderYearFile(group, year, books, payload.generatedAt)]),
    [path.join(outputRoot, "_index.md"), renderIndex(payload)],
    [path.join(outputRoot, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`]
  ];
  const suffix = `${process.pid}-${Date.now()}`;
  const staged = [];

  try {
    for (const group of GROUPS) await mkdir(path.join(outputRoot, group), { recursive: true });
    for (const [filePath, content] of files) {
      const tempPath = `${filePath}.${suffix}.tmp`;
      await writeFile(tempPath, content, "utf8");
      staged.push([tempPath, filePath]);
    }
    for (const [tempPath, filePath] of staged) await rename(tempPath, filePath);
    await removeStaleYearFiles(outputRoot, new Set(files.map(([filePath]) => path.relative(outputRoot, filePath))));
  } catch (error) {
    // 已知边界：rename 阶段个别失败（如同名目录阻塞）时，已 rename 的年文件为新内容、其余为旧内容（混合态）。
    // 同目录 rename 在 tmp 写成功后失败概率极低；全量重建每周覆盖，下一轮自动自愈，不做回滚复杂度。
    for (const [tempPath] of staged) await rm(tempPath, { force: true });
    throw error;
  }

  return { outputRoot, payload };
}

// 清理两个分组目录下不在本轮年份集合（含 unknown.md 仅当有 unknown 书）的 .md；不动 _index.md/_manifest.json。
async function removeStaleYearFiles(outputRoot, expectedRelative) {
  for (const group of GROUPS) {
    const groupDir = path.join(outputRoot, group);
    for (const entry of await readdir(groupDir)) {
      if (entry.endsWith(".md") && !expectedRelative.has(path.join(group, entry))) {
        await rm(path.join(groupDir, entry), { force: true });
      }
    }
  }
}

// 分组 → 年 → 整本书列表（书间按最近划线时间降序）
function yearFileEntries(payload) {
  const grouped = new Map();
  for (const book of payload.books) {
    const year = book.assignedYear || UNKNOWN_YEAR;
    const key = `${book.group}/${year}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(book);
  }
  return [...grouped.entries()].map(([key, books]) => {
    const [group, year] = key.split("/");
    return [group, year, books.sort(recentFirst)];
  });
}

function renderYearFile(group, year, books, generatedAt) {
  const lines = [
    `# 微信读书划线｜${GROUP_TITLES[group]}｜${year}`,
    "",
    `- 分组：${GROUP_TITLES[group]}`,
    `- 年份：${year}`,
    `- 书数：${books.length}`,
    `- 划线数：${books.reduce((sum, book) => sum + book.highlights.length, 0)}`,
    `- 字符数：${books.reduce((sum, book) => sum + book.chars, 0)}`,
    `- 生成时间：${generatedAt}`,
    `- 口径：全量重建·不蒸馏`,
    ""
  ];
  for (const book of books) lines.push(renderBookSection(book), "");
  return `${lines.join("\n").trim()}\n`;
}

// renderBook 降为年文件内的书节：分类/首次/最近 bullet 保留，章节 + 划线引用块升序不变
function renderBookSection(book) {
  const lines = [
    `## 《${book.title}》${book.author ? `｜${book.author}` : ""}`,
    "",
    `- 分类：${book.category || UNCATEGORIZED_LABEL}`,
    `- 首次划线：${book.firstAt || "未知"}`,
    `- 最近划线：${book.lastAt || "未知"}`,
    ""
  ];
  let currentChapter;

  for (const highlight of book.highlights) {
    if (highlight.chapterTitle !== currentChapter) {
      currentChapter = highlight.chapterTitle;
      lines.push(`### ${currentChapter}`, "");
    }
    lines.push(...quoteLines(highlight.text), "");
  }

  return lines.join("\n").trim();
}

// 按年降序分节；节内先小说后非小说，unknown 书单列在末节
function renderIndex(payload) {
  const lines = [
    "# 微信读书划线归档索引",
    "",
    `- 生成时间：${payload.generatedAt}`,
    `- 小说：${payload.totals.fiction.bookCount} 本 / ${payload.totals.fiction.highlightCount} 条 / ${payload.totals.fiction.chars} 字符`,
    `- 非小说：${payload.totals.nonfiction.bookCount} 本 / ${payload.totals.nonfiction.highlightCount} 条 / ${payload.totals.nonfiction.chars} 字符`,
    ""
  ];
  const byYear = new Map();

  for (const book of payload.books) {
    const year = book.assignedYear || UNKNOWN_YEAR;
    if (!byYear.has(year)) byYear.set(year, { fiction: [], nonfiction: [] });
    byYear.get(year)[book.group].push(book);
  }

  for (const year of [...byYear.keys()].sort(compareYearDesc)) {
    lines.push(`## ${year}`, "");
    const yearGroups = byYear.get(year);
    for (const group of GROUPS) {
      const groupBooks = yearGroups[group].sort(recentFirst);
      if (!groupBooks.length) continue;
      lines.push(`### ${GROUP_TITLES[group]}（${group}/${year}.md）`, "");
      for (const book of groupBooks) {
        lines.push(`- 《${book.title}》${book.author ? `｜${book.author}` : ""}｜${book.highlights.length} 条｜${book.chars} 字符｜最近 ${book.lastAt || "未知"}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

// 分类规则（ADR 0002 决策 3）：一级分类（"-"前）含「小说」或命中 NOVEL_CATEGORIES（一级或全串）→ fiction
// （实测真实形如「精品小说-玄幻小说」「男生小说-东方玄幻」「科幻-中国科幻」）；其余（含「文学-*」与缺失）→ nonfiction。
// 扩展时只改 NOVEL_CATEGORIES 或本函数。
export function classifyGroup(category) {
  const raw = String(category || "").trim();
  if (!raw) return "nonfiction";
  const primary = raw.split("-")[0];
  return primary.includes("小说") || NOVEL_CATEGORIES.has(raw) || NOVEL_CATEGORIES.has(primary) ? "fiction" : "nonfiction";
}

// 划线 createTime（epoch 秒）→ Asia/Shanghai 年份；0/负数/缺失/超出合理范围视为无有效日期
function shanghaiYear(timestamp) {
  if (!isValidTimestamp(timestamp)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date(Number(timestamp) * 1000));
}

// 上界 4102444800 = 2100-01-01：防毫秒级/畸形时间戳在 new Date 时抛 Invalid time value 使整轮崩溃
const MAX_REASONABLE_EPOCH_SECONDS = 4102444800;

function isValidTimestamp(timestamp) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_REASONABLE_EPOCH_SECONDS;
}

// 众数年；并列取最近年；全部无有效日期 → null（整本书进 unknown.md）
function assignYear(highlights) {
  const counts = new Map();
  for (const highlight of highlights) {
    const year = shanghaiYear(highlight.createTime);
    if (year) counts.set(year, (counts.get(year) || 0) + 1);
  }
  let assigned = null;
  for (const [year, count] of counts) {
    if (!assigned || count > counts.get(assigned) || (count === counts.get(assigned) && year > assigned)) assigned = year;
  }
  return assigned;
}

function buildYearDistribution(books) {
  const distribution = {};
  for (const book of books) {
    const year = book.assignedYear || UNKNOWN_YEAR;
    const groupBuckets = distribution[book.group] || (distribution[book.group] = {});
    const bucket = groupBuckets[year] || (groupBuckets[year] = { books: 0, highlights: 0, chars: 0 });
    bucket.books += 1;
    bucket.highlights += book.highlights.length;
    bucket.chars += book.chars;
  }
  for (const group of Object.keys(distribution)) {
    distribution[group] = Object.fromEntries(Object.keys(distribution[group]).sort(compareYearDesc).map((year) => [year, distribution[group][year]]));
  }
  return distribution;
}

function compareYearDesc(a, b) {
  return (a === UNKNOWN_YEAR) - (b === UNKNOWN_YEAR) || b.localeCompare(a);
}

function formatShanghaiDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Number(timestamp) * 1000));
}

async function collectAllNotebooks(callApi) {
  const books = [];
  let lastSort;

  while (true) {
    const response = await callApi({ api_name: "/user/notebooks", count: 100, ...(lastSort ? { lastSort } : {}) });
    const page = response.books || [];
    books.push(...page);
    const oldestSort = Number(page.at(-1)?.sort || 0);
    if (!response.hasMore) break;
    // hasMore=1 但空页：游标协议异常，fail-closed 防静默丢书
    if (!page.length) throw new Error("WeRead notebooks pagination returned an empty page with hasMore=1.");
    if (!oldestSort || oldestSort === lastSort) throw new Error(`WeRead notebooks pagination did not advance (lastSort=${lastSort}).`);
    lastSort = oldestSort;
  }

  return books;
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
    const suffix = data.upgrade_info.upgrade_url ? ` Upgrade URL: ${data.upgrade_info.upgrade_url}` : "";
    throw new Error(`${data.upgrade_info.message || "The WeRead Skill must be upgraded before retrying."}${suffix}`);
  }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeRead API error ${data.errcode}: ${data.errmsg || "unknown error"}`);
  }
  return data;
}

function normalizeHighlight(item, chapterTitles) {
  return {
    createTime: Number(item.createTime),
    chapterTitle: chapterTitles.get(String(item.chapterUid)) || "未知章节",
    text: cleanText(item.markText)
  };
}

function groupStats(books, group) {
  const groupBooks = books.filter((book) => book.group === group);
  return {
    bookCount: groupBooks.length,
    highlightCount: groupBooks.reduce((sum, book) => sum + book.highlights.length, 0),
    chars: groupBooks.reduce((sum, book) => sum + book.chars, 0)
  };
}

function quoteLines(text) {
  return String(text || "").split("\n").map((line) => `> ${line}`);
}

function cleanText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output-dir") {
      options.outputRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeWereadArchive(parseArgs(process.argv.slice(2)));
  const { payload } = result;
  for (const group of GROUPS) {
    const yearFileCount = new Set(payload.books.filter((book) => book.group === group).map((book) => book.assignedYear || UNKNOWN_YEAR)).size;
    console.log(`WeRead archive ${group}: ${path.relative(repoRoot, path.join(result.outputRoot, group))} (${yearFileCount} year files, ${payload.totals[group].bookCount} books)`);
  }
  console.log(`Highlights: fiction ${payload.totals.fiction.highlightCount} / nonfiction ${payload.totals.nonfiction.highlightCount} (total ${payload.totals.fiction.highlightCount + payload.totals.nonfiction.highlightCount})`);
  console.log(`Chars: fiction ${payload.totals.fiction.chars} / nonfiction ${payload.totals.nonfiction.chars} (total ${payload.totals.fiction.chars + payload.totals.nonfiction.chars})`);
  console.log(`Books without valid dates: ${payload.books.filter((book) => !book.assignedYear).length}`);
}

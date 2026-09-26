import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyGroup, collectWereadArchive, writeWereadArchive } from "./collect-weread-archive.mjs";

test("classifyGroup maps composite WeRead categories per ADR 0002", () => {
  assert.equal(classifyGroup("精品小说-玄幻小说"), "fiction");
  assert.equal(classifyGroup("男生小说-东方玄幻"), "fiction");
  assert.equal(classifyGroup("小说"), "fiction");
  assert.equal(classifyGroup("青春文学"), "fiction");
  assert.equal(classifyGroup("文学-散文杂著"), "nonfiction");
  assert.equal(classifyGroup("文学-古典文学"), "nonfiction");
  assert.equal(classifyGroup("经济理财-财经"), "nonfiction");
  assert.equal(classifyGroup("漫画-科普漫画"), "nonfiction");
  assert.equal(classifyGroup(""), "nonfiction");
  assert.equal(classifyGroup(null), "nonfiction");
});

const execFileAsync = promisify(execFile);
const NOW = () => new Date("2026-09-26T00:00:00Z");
// epoch 秒；对应 Asia/Shanghai 当日 16:00，UTC 与上海同日
const TS = {
  y2024: 1721462400,
  y2025: 1742025600,
  y2026a: 1767254400,
  y2026b: 1782806400
};

function buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId } = {}) {
  const calls = [];
  const sleeps = [];
  const callApi = async (payload) => {
    calls.push(payload);
    if (payload.api_name === "/user/notebooks") return notebooksPages[calls.filter((call) => call.api_name === "/user/notebooks").length - 1];
    if (payload.api_name === "/book/info") return infoByBookId[payload.bookId];
    if (payload.api_name === "/book/bookmarklist") return bookmarksByBookId[payload.bookId];
    throw new Error(`Unexpected api_name: ${payload.api_name}`);
  };
  const sleep = async (ms) => { sleeps.push(ms); };
  return { callApi, sleep, calls, sleeps };
}

// 小说书：2025/2026 各 1 条（并列 → 取最近年 2026，整本不劈）
// 众数书：2024 两条 + 2026 一条（众数 2024 压过最近年，含 2026 划线整本归 2024 文件）
// 无期书：createTime=0 全部无效 → unknown.md
function fixture() {
  const notebooksPages = [
    { hasMore: 1, books: [{ bookId: "b-novel", sort: 900, book: { title: "小说书", author: "作者甲" } }] },
    {
      hasMore: 0,
      books: [
        { bookId: "b-history", sort: 800, book: { title: "历史书", author: "作者乙" } },
        { bookId: "b-mode", sort: 750, book: { title: "众数书", author: "作者戊" } },
        { bookId: "b-none", sort: 700, book: { title: "无类书", author: "作者丙" } },
        { bookId: "b-unknown", sort: 650, book: { title: "无期书", author: "作者己" } },
        { bookId: "b-empty", sort: 600, book: { title: "空笔记", author: "作者丁" } }
      ]
    }
  ];
  const infoByBookId = {
    "b-novel": { bookId: "b-novel", title: "小说书", author: "作者甲", category: "小说" },
    "b-history": { bookId: "b-history", title: "历史书", author: "作者乙", category: "历史" },
    "b-mode": { bookId: "b-mode", title: "众数书", author: "作者戊", category: "历史" },
    "b-none": { bookId: "b-none", title: "无类书", author: "作者丙" },
    "b-unknown": { bookId: "b-unknown", title: "无期书", author: "作者己", category: "小说" },
    "b-empty": { bookId: "b-empty", title: "空笔记", author: "作者丁", category: "小说" }
  };
  const bookmarksByBookId = {
    "b-novel": {
      updated: [
        { chapterUid: 1, markText: "𠮷字测试", createTime: TS.y2026a },
        { chapterUid: 2, markText: "第二章内容", createTime: TS.y2025 }
      ],
      chapters: [{ chapterUid: 1, title: "第一章" }, { chapterUid: 2, title: "第二章" }]
    },
    "b-history": {
      updated: [{ chapterUid: 9, markText: "历史内容", createTime: TS.y2024 }],
      chapters: [{ chapterUid: 9, title: "近代史" }]
    },
    "b-mode": {
      updated: [
        { chapterUid: 1, markText: "早年划线一", createTime: TS.y2024 },
        { chapterUid: 1, markText: "早年划线二", createTime: TS.y2024 + 3600 },
        { chapterUid: 2, markText: "新近划线", createTime: TS.y2026b }
      ],
      chapters: [{ chapterUid: 1, title: "上卷" }, { chapterUid: 2, title: "下卷" }]
    },
    "b-none": {
      updated: [{ chapterUid: 5, markText: "无类划线", createTime: TS.y2026b }],
      chapters: [{ chapterUid: 5, title: "第一章" }]
    },
    "b-unknown": {
      updated: [{ chapterUid: 3, markText: "无日期划线", createTime: 0 }],
      chapters: [{ chapterUid: 3, title: "序章" }]
    },
    "b-empty": { updated: [], chapters: [] }
  };
  return { notebooksPages, infoByBookId, bookmarksByBookId };
}

async function listRelative(root) {
  const entries = [];
  async function walk(dir, prefix) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else entries.push(relative);
    }
  }
  await walk(root, "");
  return entries;
}

async function snapshot(root) {
  const files = await listRelative(root);
  const contents = await Promise.all(files.map((file) => readFile(path.join(root, ...file.split("/")), "utf8")));
  return { files, contents };
}

test("collects all notebooks across pages with lastSort cursor, >=150ms delays, and whole-book year assignment", async () => {
  const { notebooksPages, infoByBookId, bookmarksByBookId } = fixture();
  const { callApi, sleep, calls, sleeps } = buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId });
  const payload = await collectWereadArchive({ apiKey: "test", callApi, sleep });

  const notebookCalls = calls.filter((call) => call.api_name === "/user/notebooks");
  assert.equal(notebookCalls.length, 2);
  assert.deepEqual(notebookCalls[0], { api_name: "/user/notebooks", count: 100 });
  assert.deepEqual(notebookCalls[1], { api_name: "/user/notebooks", count: 100, lastSort: 900 });
  assert.equal(sleeps.length, 12); // 6 本笔记（含空笔记）×（info/bookmarklist 各一次间隔）
  assert.ok(sleeps.every((ms) => ms >= 150));
  assert.deepEqual(payload.books.map((book) => book.title), ["历史书", "无类书", "无期书", "小说书", "众数书"]);
  assert.ok(!payload.books.some((book) => book.title === "空笔记"));
  assert.deepEqual(payload.totals, {
    fiction: { bookCount: 2, highlightCount: 3, chars: 14 },
    nonfiction: { bookCount: 3, highlightCount: 5, chars: 22 }
  });

  const yearByBookId = Object.fromEntries(payload.books.map((book) => [book.bookId, book.assignedYear]));
  assert.equal(yearByBookId["b-novel"], "2026"); // 1:1 并列取最近年
  assert.equal(yearByBookId["b-mode"], "2024"); // 众数 2:1 压过最近年 2026
  assert.equal(yearByBookId["b-history"], "2024");
  assert.equal(yearByBookId["b-unknown"], null); // 全部划线无有效日期
});

test("maps categories: novel set hit, miss, and missing default to nonfiction with unclassified listing", async () => {
  const { notebooksPages, infoByBookId, bookmarksByBookId } = fixture();
  const { callApi, sleep } = buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId });
  const payload = await collectWereadArchive({ apiKey: "test", callApi, sleep });

  assert.equal(payload.books.find((book) => book.title === "小说书").group, "fiction");
  assert.equal(payload.books.find((book) => book.title === "历史书").group, "nonfiction");
  assert.equal(payload.books.find((book) => book.title === "无类书").group, "nonfiction");
  assert.deepEqual(payload.unclassifiedBooks, ["无类书"]);
  assert.deepEqual(payload.categoryDistribution, {
    "小说": { group: "fiction", books: 2, highlights: 3 },
    "历史": { group: "nonfiction", books: 2, highlights: 4 },
    "": { group: "nonfiction", books: 1, highlights: 1 }
  });
});

test("writes one year file per group/year; books stay whole, ordered by recent highlight desc", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-files-"));
  try {
    const { notebooksPages, infoByBookId, bookmarksByBookId } = fixture();
    const { callApi, sleep } = buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId });
    await writeWereadArchive({ apiKey: "test", callApi, sleep, now: NOW, outputRoot });

    assert.deepEqual(await listRelative(outputRoot), [
      "_index.md",
      "_manifest.json",
      "fiction/2026.md",
      "fiction/unknown.md",
      "nonfiction/2024.md",
      "nonfiction/2026.md"
    ]);

    // 跨年书整本不劈：2025 的划线随小说书落在 fiction/2026.md，且不存在 fiction/2025.md
    const fiction = await readFile(path.join(outputRoot, "fiction", "2026.md"), "utf8");
    assert.match(fiction, /^# 微信读书划线｜小说｜2026\n/);
    assert.match(fiction, /- 分组：小说\n- 年份：2026\n- 书数：1\n- 划线数：2\n- 字符数：9\n- 生成时间：2026-09-26T00:00:00\.000Z\n- 口径：全量重建·不蒸馏\n/);
    assert.match(fiction, /## 《小说书》｜作者甲\n\n- 分类：小说\n- 首次划线：2025-03-15\n- 最近划线：2026-01-01\n/);
    assert.ok(fiction.indexOf("### 第二章") < fiction.indexOf("### 第一章"), "highlights sorted by createTime");
    assert.match(fiction, /### 第二章\n\n> 第二章内容\n\n### 第一章\n\n> 𠮷字测试/);

    // 众数书（lastAt 2026-06-30）排在历史书（2024-07-20）前；2026 的划线随整本书留在 2024 文件
    const mode = await readFile(path.join(outputRoot, "nonfiction", "2024.md"), "utf8");
    assert.match(mode, /^# 微信读书划线｜非小说｜2024\n/);
    assert.match(mode, /- 书数：2\n- 划线数：4\n- 字符数：18\n/);
    assert.ok(mode.indexOf("《众数书》") < mode.indexOf("《历史书》"), "books sorted by last highlight desc");
    assert.match(mode, /## 《众数书》｜作者戊\n\n- 分类：历史\n- 首次划线：2024-07-20\n- 最近划线：2026-06-30\n/);
    assert.match(mode, /### 下卷\n\n> 新近划线/);
    assert.match(mode, /## 《历史书》｜作者乙\n\n- 分类：历史\n- 首次划线：2024-07-20\n- 最近划线：2024-07-20\n/);
    assert.match(mode, /### 近代史\n\n> 历史内容/);

    const unknown = await readFile(path.join(outputRoot, "fiction", "unknown.md"), "utf8");
    assert.match(unknown, /^# 微信读书划线｜小说｜unknown\n/);
    assert.match(unknown, /- 年份：unknown\n- 书数：1\n- 划线数：1\n- 字符数：5\n/);
    assert.match(unknown, /## 《无期书》｜作者己\n\n- 分类：小说\n- 首次划线：未知\n- 最近划线：未知\n/);
    assert.match(unknown, /### 序章\n\n> 无日期划线/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("index lists year sections desc, fiction before nonfiction, unknown last", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-index-"));
  try {
    const { notebooksPages, infoByBookId, bookmarksByBookId } = fixture();
    const { callApi, sleep } = buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId });
    await writeWereadArchive({ apiKey: "test", callApi, sleep, now: NOW, outputRoot });

    const index = await readFile(path.join(outputRoot, "_index.md"), "utf8");
    assert.match(index, /^# 微信读书划线归档索引\n/);
    assert.match(index, /- 生成时间：2026-09-26T00:00:00\.000Z\n/);
    assert.match(index, /- 小说：2 本 \/ 3 条 \/ 14 字符\n/);
    assert.match(index, /- 非小说：3 本 \/ 5 条 \/ 22 字符\n/);

    const i2026 = index.indexOf("## 2026");
    const i2024 = index.indexOf("## 2024");
    const iUnknown = index.indexOf("## unknown");
    assert.ok(i2026 > -1 && i2026 < i2024 && i2024 < iUnknown, "year sections desc with unknown last");

    const section2026 = index.slice(i2026, i2024);
    assert.ok(section2026.indexOf("### 小说") < section2026.indexOf("### 非小说"), "fiction before nonfiction");
    assert.match(section2026, /### 小说（fiction\/2026\.md）\n\n- 《小说书》｜作者甲｜2 条｜9 字符｜最近 2026-01-01\n/);
    assert.match(section2026, /### 非小说（nonfiction\/2026\.md）\n\n- 《无类书》｜作者丙｜1 条｜4 字符｜最近 2026-06-30\n/);

    const section2024 = index.slice(i2024, iUnknown);
    assert.match(section2024, /### 非小说（nonfiction\/2024\.md）\n\n- 《众数书》｜作者戊｜3 条｜14 字符｜最近 2026-06-30\n- 《历史书》｜作者乙｜1 条｜4 字符｜最近 2024-07-20\n/);

    const sectionUnknown = index.slice(iUnknown);
    assert.match(sectionUnknown, /### 小说（fiction\/unknown\.md）\n\n- 《无期书》｜作者己｜1 条｜5 字符｜最近 未知\n/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("manifest keeps totals/categories and records assignedYear, file, and yearDistribution", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-manifest-"));
  try {
    const { notebooksPages, infoByBookId, bookmarksByBookId } = fixture();
    const { callApi, sleep } = buildCallApi({ notebooksPages, infoByBookId, bookmarksByBookId });
    await writeWereadArchive({ apiKey: "test", callApi, sleep, now: NOW, outputRoot });

    const manifest = JSON.parse(await readFile(path.join(outputRoot, "_manifest.json"), "utf8"));
    assert.equal(manifest.skillVersion, "1.0.4");
    assert.equal(manifest.generatedAt, "2026-09-26T00:00:00.000Z");
    assert.deepEqual(manifest.totals, {
      fiction: { bookCount: 2, highlightCount: 3, chars: 14 },
      nonfiction: { bookCount: 3, highlightCount: 5, chars: 22 }
    });
    const perBookByBookId = Object.fromEntries(manifest.perBook.map((book) => [book.bookId, book]));
    assert.deepEqual(perBookByBookId["b-novel"], {
      bookId: "b-novel", title: "小说书", author: "作者甲", category: "小说", group: "fiction",
      highlightCount: 2, chars: 9, assignedYear: "2026", file: "fiction/2026.md", firstAt: "2025-03-15", lastAt: "2026-01-01"
    });
    assert.deepEqual(perBookByBookId["b-mode"], {
      bookId: "b-mode", title: "众数书", author: "作者戊", category: "历史", group: "nonfiction",
      highlightCount: 3, chars: 14, assignedYear: "2024", file: "nonfiction/2024.md", firstAt: "2024-07-20", lastAt: "2026-06-30"
    });
    assert.deepEqual(perBookByBookId["b-unknown"], {
      bookId: "b-unknown", title: "无期书", author: "作者己", category: "小说", group: "fiction",
      highlightCount: 1, chars: 5, assignedYear: null, file: "fiction/unknown.md", firstAt: null, lastAt: null
    });
    assert.deepEqual(manifest.yearDistribution, {
      fiction: { "2026": { books: 1, highlights: 2, chars: 9 }, "unknown": { books: 1, highlights: 1, chars: 5 } },
      nonfiction: { "2024": { books: 2, highlights: 4, chars: 18 }, "2026": { books: 1, highlights: 1, chars: 4 } }
    });
    assert.deepEqual(manifest.categoryDistribution, {
      "小说": { group: "fiction", books: 2, highlights: 3 },
      "历史": { group: "nonfiction", books: 2, highlights: 4 },
      "": { group: "nonfiction", books: 1, highlights: 1 }
    });
    assert.deepEqual(manifest.unclassifiedBooks, ["无类书"]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("rebuilding with identical data and clock is byte-identical with no extra files", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-idem-"));
  try {
    const options = { apiKey: "test", now: NOW, outputRoot };
    const first = buildCallApi(fixture());
    const second = buildCallApi(fixture());
    await writeWereadArchive({ ...options, callApi: first.callApi, sleep: first.sleep });
    const before = await snapshot(outputRoot);
    assert.equal(before.files.length, 6);
    await writeWereadArchive({ ...options, callApi: second.callApi, sleep: second.sleep });
    const after = await snapshot(outputRoot);
    assert.deepEqual(after.files, before.files);
    assert.deepEqual(after.contents, before.contents);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("full rebuild removes stale year files (incl. unknown.md) but keeps _index/_manifest and non-archive files", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-stale-"));
  try {
    const data = fixture();
    const first = buildCallApi(data);
    await writeWereadArchive({ apiKey: "test", callApi: first.callApi, sleep: first.sleep, now: NOW, outputRoot });
    // 旧版聚合文件遗留：不在两个分组目录内，不属于清理范围；人为遗留旧年文件应被清掉
    await writeFile(path.join(outputRoot, "fiction.md"), "legacy aggregate", "utf8");
    await writeFile(path.join(outputRoot, "nonfiction", "1999.md"), "stale year", "utf8");

    const second = buildCallApi({
      notebooksPages: [{ hasMore: 0, books: [{ bookId: "b-history", sort: 800, book: { title: "历史书", author: "作者乙" } }] }],
      infoByBookId: { "b-history": data.infoByBookId["b-history"] },
      bookmarksByBookId: { "b-history": data.bookmarksByBookId["b-history"] }
    });
    await writeWereadArchive({ apiKey: "test", callApi: second.callApi, sleep: second.sleep, now: NOW, outputRoot });

    assert.deepEqual(await listRelative(outputRoot), [
      "_index.md",
      "_manifest.json",
      "fiction.md",
      "nonfiction/2024.md"
    ]);
    assert.equal(await readFile(path.join(outputRoot, "fiction.md"), "utf8"), "legacy aggregate");
    const manifest = JSON.parse(await readFile(path.join(outputRoot, "_manifest.json"), "utf8"));
    assert.deepEqual(manifest.perBook.map((book) => book.bookId), ["b-history"]);
    assert.deepEqual(manifest.perBook.map((book) => book.file), ["nonfiction/2024.md"]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("failed run after a successful round leaves previous output untouched and cleans temp files", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-fail-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const data = fixture();
  const good = buildCallApi(data);
  await writeWereadArchive({ apiKey: "test", callApi: good.callApi, sleep: good.sleep, now: NOW, outputRoot });
  const before = await snapshot(outputRoot);

  const bad = async (payload) => {
    if (payload.api_name === "/user/notebooks") {
      return {
        hasMore: 0,
        books: [
          { bookId: "b-novel", sort: 900, book: { title: "小说书", author: "作者甲" } },
          { bookId: "b-late", sort: 100, book: { title: "晚处理书", author: "作者乙" } }
        ]
      };
    }
    if (payload.api_name === "/book/info") return { bookId: payload.bookId, category: "小说" };
    if (payload.bookId === "b-novel") return data.bookmarksByBookId["b-novel"];
    throw new Error("bookmark boom for " + payload.bookId);
  };
  await assert.rejects(
    writeWereadArchive({ apiKey: "test", callApi: bad, sleep: async () => {}, now: NOW, outputRoot }),
    /bookmark boom/
  );

  const after = await snapshot(outputRoot);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(after.contents, before.contents);
});

test("CLI prints two group dirs with year file counts, group stats, and unknown-book count without highlight text", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-weread-archive-cli-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const preload = path.join(outputRoot, "fake-fetch.cjs");
  await writeFile(preload, `
    const fixture = ${JSON.stringify(fixture())};
    let notebookPage = 0;
    globalThis.fetch = async (url, options) => {
      const payload = JSON.parse(options.body);
      let data;
      if (payload.api_name === "/user/notebooks") data = fixture.notebooksPages[notebookPage++];
      else if (payload.api_name === "/book/info") data = fixture.infoByBookId[payload.bookId];
      else if (payload.api_name === "/book/bookmarklist") data = fixture.bookmarksByBookId[payload.bookId];
      else throw new Error("unexpected api " + payload.api_name);
      return { ok: true, json: async () => data };
    };
  `, "utf8");
  const scriptPath = fileURLToPath(new URL("./collect-weread-archive.mjs", import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--output-dir", outputRoot], {
    env: { ...process.env, WEREAD_API_KEY: "test", NODE_OPTIONS: `--require ${preload}` }
  });

  assert.match(stdout, /WeRead archive fiction: .+ \(2 year files, 2 books\)/);
  assert.match(stdout, /WeRead archive nonfiction: .+ \(2 year files, 3 books\)/);
  assert.match(stdout, /Highlights: fiction 3 \/ nonfiction 5 \(total 8\)/);
  assert.match(stdout, /Chars: fiction 14 \/ nonfiction 22 \(total 36\)/);
  assert.match(stdout, /Books without valid dates: 1/);
  assert.ok(!stdout.includes("𠮷字测试"), "CLI output must not contain highlight text");
  assert.ok(!/api[- ]?key|bearer|authorization/i.test(stdout), "API key material must never be printed");
});

// 解析当周 weread.md 的「本周划线与想法」小节。
// 生成端见 learn-x-input/scripts/collect-weread-weekly.mjs（§renderWeekly 300-351 行附近）：
//   ### 《书名》｜作者
//   #### 章节名
//   ##### 划线｜YYYY-MM-DD   → 后随 "> " 引用行 = 划线原文（一字不改）
//   ##### 想法｜YYYY-MM-DD   → 后随 "> " 引用行 = 摘要（abstract），普通行 = 想法正文
// 解析保持文件原有顺序，不改写任何原文。

const BOOK_PATTERN = /^### 《(.+?)》(?:｜(.*))?\s*$/;
const CHAPTER_PATTERN = /^#### (.+?)\s*$/;
const ENTRY_PATTERN = /^##### (.+?)｜(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_TITLE = "## 本周划线与想法";
const EMPTY_MARKER = "本周没有新增划线或想法";

export function parseWereadMarkdown(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const sectionIndex = lines.findIndex((line) => line.trim() === SECTION_TITLE);
  if (sectionIndex === -1) {
    return { hasSection: false, empty: true, books: [], highlightCount: 0, ideaCount: 0 };
  }
  const books = [];
  let book = null;
  let chapter = null;
  let entry = null;
  let highlightCount = 0;
  let ideaCount = 0;
  let empty = true;

  for (let i = sectionIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const bookMatch = line.match(BOOK_PATTERN);
    if (bookMatch) {
      book = { title: bookMatch[1], author: bookMatch[2]?.trim() || "", chapters: [] };
      books.push(book);
      chapter = null;
      entry = null;
      continue;
    }
    const chapterMatch = line.match(CHAPTER_PATTERN);
    if (chapterMatch && book) {
      chapter = { title: chapterMatch[1], entries: [], ideas: [] };
      book.chapters.push(chapter);
      entry = null;
      continue;
    }
    const entryMatch = line.match(ENTRY_PATTERN);
    if (entryMatch && book && chapter) {
      entry = { kind: entryMatch[1].trim(), date: entryMatch[2], quoteLines: [], contentLines: [] };
      if (entry.kind === "划线") chapter.entries.push(entry);
      else chapter.ideas.push(entry);
      continue;
    }
    if (!entry) continue;
    if (line.startsWith(">")) {
      entry.quoteLines.push(line.replace(/^>\s?/, ""));
    } else if (line.trim()) {
      entry.contentLines.push(line.trim());
    }
  }

  let seq = 0;
  for (const currentBook of books) {
    for (const currentChapter of currentBook.chapters) {
      for (const highlight of currentChapter.entries) {
        highlight.seq = ++seq;
        highlight.text = highlight.quoteLines.join("\n").trim();
        highlightCount += 1;
        empty = false;
      }
      for (const idea of currentChapter.ideas) {
        idea.abstract = idea.quoteLines.join("\n").trim();
        idea.content = idea.contentLines.join("\n").trim();
        ideaCount += 1;
        empty = false;
      }
    }
  }

  return {
    hasSection: true,
    empty: empty || books.every((currentBook) => currentBook.chapters.every((currentChapter) => !currentChapter.entries.length && !currentChapter.ideas.length)),
    emptyMarker: lines.slice(sectionIndex + 1).some((line) => line.includes(EMPTY_MARKER)),
    books,
    highlightCount,
    ideaCount
  };
}

// 每条原始划线逐行返回（回读校验按行逐字匹配，见 docs/cases/weread-highlights/codex-weekly-automation-prompt.md §4 转义说明）。
export function highlightLinesOf(highlight) {
  return String(highlight.text ?? "").split("\n").filter((line) => line.length > 0);
}

export function chapterKey(book, chapter) {
  return `${book.title}｜${chapter.title}`;
}

// jingdu.md 周输入的结构化读写。
// 格式基准：docs/cases/weread-highlights/codex-weekly-automation-prompt.md §6（78-95 行）。
// 只转录用户在精读文档中明确写下的内容；思考原话照录，不改写不扩写。

export function renderJingduMarkdown({ week, docUrl, rangeLabel, generatedAt, books }) {
  const count = books.reduce((sum, book) => sum + book.entries.length, 0);
  const lines = [
    `# 精读｜${week}`,
    "",
    `- 来源：飞书精读文档 ${docUrl ?? "（未绑定）"}`,
    `- 范围：${rangeLabel}，时区 Asia/Shanghai`,
    `- 生成时间：${generatedAt}，加工 ${count} 条`,
    ""
  ];
  for (const book of books) {
    lines.push(`## 《${book.title}》${book.author ? `｜${book.author}` : ""}`, "");
    for (const entry of book.entries) {
      lines.push(`### ${entry.summary}｜${entry.chapter}`, "");
      lines.push("- 原始划线：");
      for (const quote of entry.quoteLines) lines.push(`  > ${quote}`);
      lines.push("- 我的思考：");
      for (const thought of entry.thoughtLines) lines.push(`  ${thought}`);
      if (entry.actionLines?.length) {
        lines.push("- 可选行动：");
        for (const action of entry.actionLines) lines.push(`  ${action}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function parseJingduMarkdown(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const weekMatch = lines[0]?.match(/^# 精读｜(\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))\s*$/);
  const books = [];
  let book = null;
  let current = null;
  let field = null;

  for (const line of lines) {
    const bookMatch = line.match(/^## 《(.+?)》(?:｜(.*))?\s*$/);
    if (bookMatch) {
      book = { title: bookMatch[1], author: bookMatch[2]?.trim() || "", entries: [] };
      books.push(book);
      current = null;
      continue;
    }
    const entryMatch = line.match(/^### (.+?)\s*$/);
    if (entryMatch && book) {
      const text = entryMatch[1];
      const separator = text.lastIndexOf("｜");
      current = {
        summary: separator === -1 ? text : text.slice(0, separator),
        chapter: separator === -1 ? "" : text.slice(separator + 1),
        quoteLines: [],
        thoughtLines: [],
        actionLines: []
      };
      book.entries.push(current);
      field = null;
      continue;
    }
    if (!current) continue;
    if (/^- 原始划线：\s*$/.test(line)) { field = "quoteLines"; continue; }
    if (/^- 我的思考：\s*$/.test(line)) { field = "thoughtLines"; continue; }
    if (/^- 可选行动：\s*$/.test(line)) { field = "actionLines"; continue; }
    if (/^- /.test(line) || line.startsWith("#")) { field = null; continue; }
    if (!line.trim()) continue;
    if (field === "quoteLines" && line.startsWith(">")) current.quoteLines.push(line.replace(/^>\s?/, ""));
    else if (field) current[field].push(line.replace(/^ {2}/, "").trimEnd());
  }
  return { week: weekMatch?.[1] ?? null, books };
}

export function entryKey({ book, chapter, summary }) {
  return `${book}｜${chapter}｜${summary}`;
}

// 已渲染文档中的全部条目（拍平 book 结构）。
export function collectEntries(books) {
  const collected = [];
  for (const book of books) {
    for (const entry of book.entries) {
      collected.push({ book: book.title, author: book.author, ...entry });
    }
  }
  return collected;
}

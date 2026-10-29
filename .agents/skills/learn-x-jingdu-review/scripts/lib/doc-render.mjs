// 精读飞书文档渲染（--doc-format xml）与回读逐字校验。
// 基准：docs/cases/weread-highlights/codex-weekly-automation-prompt.md §4（47-62 行）——
// XML + colgroup 列宽 160/390/150/290/290；`&` `<` `>` 按 XML 转义；
// 回读校验：每条原始划线逐行能在回读 Markdown 逐字找到。

export const COLGROUP_WIDTHS = [160, 390, 150, 290, 290];

export const USAGE_NOTE = [
  "用法：每张表列出该章节的全部划线。值得深读的行，直接在「我的思考」列写下你自己的话（可含「行动：…」）——新写内容 = 明确新增的本人判断；",
  "在下方【AI 分析候选】段落底下写「认可」= 明确认可该分析；改写候选文字 = 明确修改；不填 = 保持候选，不会同步。",
  "划线原文一字不改，AI 不会替你写思考。"
].join("");

export function escapeXml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cellParagraphs(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join("") || "<p></p>";
}

function bookHeading(book) {
  return `《${book.title}》${book.author ? `｜${book.author}` : ""}`;
}

// books: parseWereadMarkdown 的输出；aiCandidates: Map<chapterKey, string[]>；
// insights: Map<highlightText, {summary, questions[]}>（由主持 AI 会话预写 runtime/<week>/insights.json，可选）。
export function renderDocXml({ week, books, aiCandidates = new Map(), insights = new Map(), usageNote = USAGE_NOTE }) {
  const lines = [`<title>精读｜${escapeXml(week)}</title>`, `<p>${escapeXml(usageNote)}</p>`];
  for (const book of books) {
    lines.push(`<h1>${escapeXml(bookHeading(book))}</h1>`);
    for (const chapter of book.chapters) {
      if (!chapter.entries.length && !chapter.ideas.length) continue;
      lines.push(`<h2>${escapeXml(chapter.title)}</h2>`);
      const colgroup = COLGROUP_WIDTHS.map((width) => `<col width="${width}"/>`).join("");
      const head = ["概括", "原始划线", "洞察问题", "我的思考", "可选行动"]
        .map((name) => `<th><p>${name}</p></th>`).join("");
      const rows = chapter.entries.map((highlight) => {
        const insight = insights.get(highlight.text);
        const summary = insight?.summary?.trim() ? `${highlight.seq}. ${insight.summary.trim()}` : `${highlight.seq}. 划线`;
        const questions = insight?.questions?.length ? insight.questions.slice(0, 2).map((question, index) => `${index === 0 ? "①" : "②"}${question}`).join("") : "";
        return `<tr><td><p>${escapeXml(summary)}</p></td><td>${cellParagraphs(highlight.text)}</td><td><p>${escapeXml(questions)}</p></td><td><p></p></td><td><p></p></td></tr>`;
      }).join("");
      lines.push(`<table><colgroup>${colgroup}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      for (const idea of chapter.ideas) {
        const body = idea.abstract ? `${idea.abstract}\n${idea.content}` : idea.content;
        if (body) lines.push(`<p>想法｜${escapeXml(idea.date)}：${escapeXml(body)}</p>`);
      }
      const candidates = aiCandidates.get(`${book.title}｜${chapter.title}`) ?? [];
      for (const candidate of candidates) {
        lines.push(`<p>【AI 分析候选】${escapeXml(candidate)}</p>`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

// 回读校验：markdown 中 '\|' '\<' 等转义先还原再逐字匹配（转义是渲染产物，不是内容差异）。
export function readbackHaystack(markdown) {
  return String(markdown ?? "").replace(/\\([|<>`*_[\]])/g, "$1");
}

export function verifyReadback({ books, markdown }) {
  const haystack = readbackHaystack(markdown);
  const missing = [];
  for (const book of books) {
    for (const chapter of book.chapters) {
      for (const highlight of chapter.entries) {
        for (const line of highlight.text.split("\n")) {
          if (!line) continue;
          if (!haystack.includes(line)) missing.push({ seq: highlight.seq, book: book.title, chapter: chapter.title, line });
        }
      }
    }
  }
  return { ok: missing.length === 0, missing };
}

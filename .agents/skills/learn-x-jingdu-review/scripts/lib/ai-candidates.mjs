// 从 ai.md（AI 周回顾）确定性挑选与书籍/章节相关的「AI 分析候选」段落。
// 规则：只搬运 ai.md 已有文字，不改写、不拼接造句；无相关段落就不输出（宁缺勿造）。
// 匹配方式：书名+章节名与 ai.md 段落的 CJK 二元组/拉丁词元重叠计分，达阈值才入选。

export function extractParagraphs(aiMarkdown) {
  return String(aiMarkdown ?? "")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean).join("\n"))
    .filter((text) => text && !text.startsWith("#"));
}

export function tokensOf(text) {
  const tokens = new Map();
  const source = String(text ?? "");
  for (const run of source.match(/[A-Za-z0-9]+/g) ?? []) {
    const token = run.toLowerCase();
    if (token.length >= 2) tokens.set(token, (tokens.get(token) ?? 0) + 1);
  }
  const cjk = source.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let i = 0; i < cjk.length - 1; i++) {
    const bigram = cjk[i] + cjk[i + 1];
    tokens.set(bigram, (tokens.get(bigram) ?? 0) + 1);
  }
  return tokens;
}

function overlapScore(left, right) {
  let score = 0;
  for (const [token, count] of left) {
    const other = right.get(token);
    if (other) score += Math.min(count, other);
  }
  return score;
}

export function selectAiCandidates({ aiMarkdown, contextText, max = 2, minScore = 3 }) {
  const paragraphs = extractParagraphs(aiMarkdown);
  if (!paragraphs.length) return [];
  const probe = tokensOf(contextText);
  if (![...probe.keys()].length) return [];
  return paragraphs
    .map((text) => ({ text, score: overlapScore(probe, tokensOf(text)) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, "zh-Hans-CN"))
    .slice(0, max)
    .map((item) => item.text);
}

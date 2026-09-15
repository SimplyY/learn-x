import test from "node:test";
import assert from "node:assert/strict";
import { extractRequiredSections } from "./prepare-weekly-memory.mjs";

test("extracts numbered core-summary and Munger sections with multiline content", () => {
  const result = extractRequiredSections(`# Weekly

## 10. 全文核心重点纪要

1. 判断一
2. 判断二

## 11. 芒格之魂的洞察

1. 洞察一：

   - 限定条件

## 12. 本周最值得思考的 3 个问题

1. 问题一：应该选择什么？
   回答：先验证最小行动。

## 13. 其他

不应进入。`);

  assert.equal(result.coreSummary.length, 1);
  assert.match(result.coreSummary[0].text, /判断一[\s\S]*判断二/);
  assert.equal(result.mungerInsights.length, 1);
  assert.match(result.mungerInsights[0].text, /洞察一[\s\S]*限定条件/);
  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /问题一[\s\S]*回答：先验证最小行动/);
  assert.doesNotMatch(result.mungerInsights[0].text, /不应进入/);
});

test("supports legacy nested headings and rejects placeholders", () => {
  const result = extractRequiredSections(`# Weekly

## 9. 芒格之魂的洞察 & 全文核心重点纪要

### 芒格之魂的洞察

todo

### 全文核心重点纪要

- 保留这条。

## 附录

结束。`);

  assert.deepEqual(result.mungerInsights, []);
  assert.equal(result.coreSummary.length, 1);
  assert.equal(result.coreSummary[0].text, "- 保留这条。");
});

test("rejects numbered xx placeholders", () => {
  const result = extractRequiredSections(`# Weekly

## 10. 全文核心重点纪要

1. xx
2. xx
3. xx

## 11. 芒格之魂的洞察

1. xx
2. xx
3. xx

## 12. 本周最值得思考的问题与回答

1. xx
2. xx
3. xx`);

  assert.deepEqual(result.coreSummary, []);
  assert.deepEqual(result.mungerInsights, []);
  assert.deepEqual(result.questionsAnswers, []);
});

test("supports a renamed question-and-answer heading", () => {
  const result = extractRequiredSections(`# Weekly

## 核心问题与回答

问题：什么值得继续？

回答：保留可验证的行动。`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /问题：[\s\S]*回答：/);
});

test("does not migrate unanswered questions", () => {
  const result = extractRequiredSections(`# Weekly

## 12. 本周最值得思考的 3 个问题

1. 问题一：什么值得继续？
2. 问题二：什么需要放弃？
3. 问题三：什么需要验证？`);

  assert.deepEqual(result.questionsAnswers, []);
});

test("keeps inline answers after question punctuation", () => {
  const result = extractRequiredSections(`# Weekly

## 12. 本周最值得思考的 3 个问题

1. 哪个选择值得长期积累？减少选择权，换取健康。
2. 哪个条件可以放松？放松金钱，保留真实反馈。
3. 什么结果能证明进入积累期？出现 AI 反馈循环。`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /减少选择权[\s\S]*AI 反馈循环/);
});

test("does not infer memory from ordinary prose or checks outside candidate sections", async () => {
  const { extractMemoryCandidates } = await import("./prepare-weekly-memory.mjs");
  const result = extractMemoryCandidates(`# Weekly

## 1. 正文

重要：普通正文。
- [x] 正文 checkbox。

## 8. 人工确认清单

### Memory 候选

- [x] 候选 checkbox。
- [ ] 未确认 checkbox。

### 道 / 法 / 术候选观察

- [x] 只进季度候选池。
`);

  assert.deepEqual(result.checked.map((item) => item.text), ["候选 checkbox。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["只进季度候选池。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["未确认 checkbox。"]);
  assert.deepEqual(result.explicit, []);
});

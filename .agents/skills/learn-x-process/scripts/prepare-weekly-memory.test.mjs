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

## 12. 其他

不应进入。`);

  assert.equal(result.coreSummary.length, 1);
  assert.match(result.coreSummary[0].text, /判断一[\s\S]*判断二/);
  assert.equal(result.mungerInsights.length, 1);
  assert.match(result.mungerInsights[0].text, /洞察一[\s\S]*限定条件/);
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

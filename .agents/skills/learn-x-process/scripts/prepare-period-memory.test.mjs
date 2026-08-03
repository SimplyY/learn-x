import test from "node:test";
import assert from "node:assert/strict";
import { extractMemoryCandidates } from "./prepare-period-memory.mjs";

test("period memory only extracts candidate-zone checks and exact system sections", () => {
  const result = extractMemoryCandidates(`# Monthly

## 0. 总判断

重要：这只是正文判断。
确认：不应进入 Memory。
- [x] 正文里的 checkbox 也不应进入。

## 7. 人工确认清单

### 7.1 值得进入 Memory

- [x] 只迁移这条。
- [ ] 不迁移这条。

### 器候选观察

- [x] 只进季度候选池。

## 全文核心重点纪要

1. 系统确认纪要。

## 芒格之魂的洞察

1. 系统确认洞察。

## 8. 结语

继续追踪：这只是正文。
`);

  assert.deepEqual(result.checked.map((item) => item.text), ["只迁移这条。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["只进季度候选池。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["不迁移这条。"]);
  assert.deepEqual(result.explicit, []);
  assert.match(result.coreSummary[0].text, /系统确认纪要/);
  assert.match(result.mungerInsights[0].text, /系统确认洞察/);
});

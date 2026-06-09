# 04_output

`04_output/` 是 Learn-X 的周期审稿区。

这里保存两类东西：

- 脚本生成的 `_dist` 材料包；
- 用户基于 AI Chat / Chat Pack 写入的 Weekly、Monthly、Yearly Output 正文。

这里不是长期真值源。正式的道 / 法 / 术、Prompt、Skill 和 Memory 需要经过人工确认后再进入各自位置。

## 文件分工

- `README.md`：说明 `04_output/` 是什么、目录怎么分、边界是什么。
- `usage.md`：说明 `_dist` 已生成后，如何写 Output、审核、Memorize。

## 目录

```text
04_output/
  _dist/      # 脚本生成的中间材料
  weekly/     # 周 Output，YYYY-WW.md
  monthly/    # 月 Output，YYYY-MM.md
  yearly/     # 年 Output，YYYY.md
```

`_dist` 常见结构：

```text
_dist/weekly/YYYY-Www/input.json
_dist/weekly/YYYY-Www/process-pack.md
_dist/weekly/YYYY-Www/memory-candidates.md

_dist/monthly/YYYY-MM/input.json
_dist/monthly/YYYY-MM/process-pack.md

_dist/yearly/YYYY/process-pack.md
```

## 核心文件

- `process-pack.md`：默认给 AI Chat 读取的材料包，保留来源索引和清洗后的正文。
- `input.json`：结构化中间态，用于来源审计和排错；常规不放进 AI Chat。
- `memory-candidates.md`：从 Output 中抽取的已确认内容候选，供 Memorize 使用。

## 边界

- Codex / 脚本只生成 `_dist` 和 Output 最小壳，不代写最终正文。
- Output 是周期审稿材料，不是正式入库结论。
- Memory 写入 `01_core/memory/`，不放在 `04_output/`。
- 不把 `process-pack.md` 当最终报告。
- 不把 AI 生成的漂亮表达直接写入长期资产。

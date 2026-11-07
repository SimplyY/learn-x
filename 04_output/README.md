# 04_output

`04_output/` 是 Learn-X 的周期记忆与复盘产物区。

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

- `process-pack.md`：给 AI Chat 读取的材料包，保留来源索引和清洗后的正文；行动与反馈直接来自材料正文（原第 8 节 Action Feedback 快照已于 2026-10 退役）。
- `input.json`：metadata-only 审计清单，记录来源路径、哈希、过滤、去重和压缩统计，不保存正文，也不放进 AI Chat。
- `memory-candidates.md`：从 Output 的系统确认章节和已勾选“值得长期保留”内容中抽取的候选；周/月各 0–3 项，0 项合法，供用户决定是否进入 Memorize。
- YWContext：确认写入并读回的 Learn-X P1 Memory 内容自动尝试同步为完整 P1 内容。跨系统消费者统一从 YWContext 路由读取 P0 精简版或 P1 完整版。当前若缺少动态发布入口或远端消费者读回，状态必须明确为 `pending` / `unknown`，不能依赖旧快照。

### 已退役历史（只读）

此前由 YWNext 生成的 `runtime/evidence/YYYY-Www.md`、`runtime/core-context/{full,weighted,core,full-full}.md` 和 `runtime/candidate-list.md` 仅保留作历史记录，已经退役；不再生成、刷新或作为消费入口。

## 边界

- Codex / 脚本只生成 `_dist` 和 Output 最小壳，不代写最终正文。
- Weekly Output 保存未来有解释价值的周度人生纹理；Monthly Output 从跨周样本寻找结构；Yearly Output 复盘年度轨迹。
- Weekly / Monthly Output 的长期候选不是批量产物；0 项合法，AI 不自动写入 Memory、道或法。
- Output 不是正式入库结论。
- Memory 写入 `01_core/memory/`，不放在 `04_output/`。
- 不把 `process-pack.md` 当最终报告。
- 不把 AI 生成的漂亮表达直接写入长期资产。

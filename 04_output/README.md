# 04_output 使用说明

`04_output/` 是 Learn-X 输出区。这里保存 `_dist` 自动化中间材料，以及由用户自己基于 AI Chat 生成和写入的 Weekly / Monthly / Yearly Output；这里的内容不是正式入库结论。

## 目录

- `usage.md`：`_dist` 生成后的输出写作、人工审核和 Memory 使用流程。
- `weekly/`：每周 Output 文件，命名为 `YYYY-WW.md`；Codex 只创建最小壳，正文由用户自己写入。
- `monthly/`：每月 Output 文件，命名为 `YYYY-MM.md`；当前可人工维护。
- `yearly/`：每年 Output 文件，命名为 `YYYY.md`；当前可人工维护。
- `_dist/weekly/YYYY-Www/`：Weekly 脚本生成的中间材料，例如 `input.json`、`process-pack.md`、`memory-candidates.md`。
- `_dist/monthly/YYYY-MM/`：Monthly 脚本生成的中间材料，例如 `input.json`、`process-pack.md`。
- `_dist/yearly/YYYY/`：Yearly 中间材料预留目录。

Memory 不放在这里，人工审核后的极薄 Memory 写入 `01_core/memory/YYYY-QN.memory.md`。

## 中间材料

- `input.json`：脚本生成 `process-pack.md` 的结构化中间态，保留路径、文件时间、去重指纹、重复来源等机器字段；常规不作为 AI Chat 上下文。
- `process-pack.md`：给 AI Chat 阅读的默认材料包，按来源聚合清洗正文，保留必要 source id 和短路径。
- `memory-candidates.md`：从 Weekly Output 中抽取的已勾选和明确标记内容，供 Codex 压缩成 Memory。

这些文件不做道 / 法 / 术 / Prompt / Skill 判断，只负责把混乱输入变成可信输入。

Weekly Process 以 `03_input/weekly/YYYY-Www/` 周目录作为处理范围，不再使用 weekly index 或文件修改时间推断范围。

## 报告用途

Weekly Output 由用户自己基于 AI Chat 生成，用来综合判断：

- 本周有哪些信息输入；
- 本周有哪些真实行动；
- 本周有哪些自我反馈；
- 哪些行动产生了现实反馈；
- 哪些判断被验证、修正或暴露问题。

Weekly Output 可发现少量必要候选：

- 道 / 法 / 术 / 素材 / 删除候选；
- 做中学复盘，含行动闭环检查；

Chat Pack 里的「判断决策自省」提供周、月、年 Output 子类型。选择对应子类型后，页面会出现周期快捷选择，只需选择第几周、第几月或第几年；系统只会自动勾选对应 `_dist` 目录下的 `process-pack.md`。

`input.json` 是结构化中间态，不会被周期快捷选择默认勾选。只有需要核查来源覆盖、重复来源或清洗结果时，再通过自定义上下文手动加入。

## Weekly Memory

Weekly Memory 用来保存本周人工确认后最值得跨周复用的极少量内容。

- 目标路径：`01_core/memory/YYYY-QN.memory.md`
- 每周 4-5 条以内，每条 20-30 字左右，最多不超过 40 字。
- 不保存过程，不保存所有候选，不替代正式长期资产。
- 主要来自 Weekly Output 中已勾选的 checkbox 和明确标记为重要、保留、继续追踪的内容。

`03_input/weekly/YYYY-Www/00_log/` 是自我反馈输入；`01_core/memory/` 是人工确认后的输出。二者不能混淆。

## 人工审核流程

1. 先读「本周总览」。
2. 检查 `inbox + action + log` 是否都有被正确理解。
3. 对「术」优先做一次真实任务验证。
4. 对「法」检查领域、边界、反例和迁移性。
5. 对「道」保持最保守，必须能约束真实选择。
6. 图谱、Prompt、Skill、写作、Demo、第一性原理不作为每周固定输出模块；只有强信号且服务行动闭环时才简短提及。

## 边界

- 不自动修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或 `.agents/skills/`。
- 不由 Codex 在 `process:weekly` 阶段代写 Output 正文；Codex 只生成 `_dist` 和最小壳。
- 不把候选报告当作事实真值。
- 不把 AI 生成的漂亮表达直接写成长期信念。
- 不把 `process-pack.md` 当作最终报告，它只是 AI 审稿材料。
- 不把 Memory 当作正式道法入库结论，它只是跨周复用上下文。
- 不追求一次处理完成所有判断；每周只做候选发现和人工审核辅助。

# 04_output 使用说明

`04_output/` 是 Learn-X 每周处理结果区。这里保存 Weekly Output 和确定性中间材料，用于人工审核；这里的内容不是正式入库结论。

## 目录

- `weekly/`：每周人读版 Output 报告，命名为 `YYYY-WW.md`。
- `_dist/YYYY-WW/`：脚本生成的中间材料，例如 `input.json`、`process-pack.md`、`memory-candidates.md`。

Memory 不放在这里，人工审核后的极薄 Memory 写入 `01_core/memory/YYYY-QN.memory.md`。

## 中间材料

- `input.json`：完整可审计输入包，包含输入类型、来源、路径、文件时间、清洗文本、去重指纹和重复来源。
- `process-pack.md`：给 AI 阅读的材料包，包含来源覆盖、source id、原始路径、正文片段和重复信息。
- `memory-candidates.md`：从 Weekly Output 中抽取的已勾选和明确标记内容，供 Codex 压缩成 Memory。

这些文件不做道 / 法 / 术 / Prompt / Skill 判断，只负责把混乱输入变成可信输入。

如果存在 `03_input/index/weekly/YYYY-WW.index.md`，本周中间材料以该索引引用的 `03_input/...` 路径为处理范围；如果不存在，则回退到按文件修改时间筛选本周输入。

## 报告用途

Weekly Output 用来综合判断：

- 本周有哪些信息输入；
- 本周有哪些真实行动；
- 本周有哪些自我反馈；
- 哪些行动产生了现实反馈；
- 哪些判断被验证、修正或暴露问题。

Weekly Output 还会发现候选：

- 道 / 法 / 术 / 素材 / 删除候选；
- Prompt 候选；
- Skill 候选；
- 行动 / Demo / 写作候选；
- 来源摘要与输入覆盖情况。

## Weekly Memory

Weekly Memory 用来保存本周人工确认后最值得跨周复用的极少量内容。

- 目标路径：`01_core/memory/YYYY-QN.memory.md`
- 每周 4-5 条以内，每条 20-30 字左右，最多不超过 40 字。
- 不保存过程，不保存所有候选，不替代正式长期资产。
- 主要来自 Weekly Output 中已勾选的 checkbox 和明确标记为重要、保留、继续追踪的内容。

`03_input/log/` 是自我反馈输入；`01_core/memory/` 是人工确认后的输出。二者不能混淆。

## 人工审核流程

1. 先读「本周总览」和「来源覆盖」。
2. 检查 `inbox + action + log` 是否都有被正确理解。
3. 再看「删除候选」，清理明显噪声和过期内容。
4. 对「术」优先做一次真实任务验证。
5. 对「法」检查领域、边界、反例和迁移性。
6. 对「道」保持最保守，必须能约束真实选择。
7. Prompt 和 Skill 候选只作为能力资产线索，不自动写入 `02_prompts/` 或 `.agents/skills/`。

## 边界

- 不自动修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或 `.agents/skills/`。
- 不把候选报告当作事实真值。
- 不把 AI 生成的漂亮表达直接写成长期信念。
- 不把 `process-pack.md` 当作最终报告，它只是 AI 审稿材料。
- 不把 Memory 当作正式道法入库结论，它只是跨周复用上下文。
- 不追求一次处理完成所有判断；每周只做候选发现和人工审核辅助。

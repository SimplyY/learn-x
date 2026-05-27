# output 使用说明

`output/` 是 Learn-X 每周处理结果区。

这里保存 `learn-x-process` 生成的候选报告和中间材料，用于人工审核。这里的内容不是正式入库结论。

## 目录

- `weekly/`：每周人读版 Output 报告，命名为 `YYYY-WW.md`，由 Codex 按 Skill 规则生成，供人工审核。
- `candidates/`：脚本生成的中间材料，命名为 `YYYY-WW.input.json`、`YYYY-WW.process-pack.md`。
- `memory/`：人工审核后生成的极薄季度 Memory，命名为 `YYYY-QN.memory.md`，按周分节，供跨周复用和月度/季度沉积。

## 中间材料

- `YYYY-WW.input.json`：完整可审计输入包，包含来源、路径、文件时间、清洗文本、去重指纹和重复来源。
- `YYYY-WW.process-pack.md`：给 AI 阅读的材料包，包含来源覆盖、source id、原始路径、正文片段和重复信息。
- `YYYY-WW.memory-candidates.md`：从 Weekly Output 中抽取的已勾选和明确标记内容，供 Codex 压缩成 Memory。

这两个文件不做道 / 法 / 术 / Prompt / Skill 判断，只负责把混乱输入变成可信输入。

如果存在 `input/weekly/YYYY-WW.md`，本周中间材料以该清单引用的 `input/...` 路径为处理范围；如果不存在，则回退到按文件修改时间筛选本周输入。

## 报告用途

Weekly Output 用来发现候选：

- 道 / 法 / 术 / 素材 / 删除候选。
- Prompt 候选。
- Skill 候选。
- 行动 / Demo / 写作候选。
- 来源摘要与输入覆盖情况。

## Weekly Memory

Weekly Memory 用来保存本周人工确认后最值得跨周复用的极少量内容。

- 目标路径：`output/memory/YYYY-QN.memory.md`
- 每周 4-5 条以内，每条 20-30 字左右，最多不超过 40 字。
- 每周最好 150 字以内，最多不超过 250 字。
- 不保存过程，不保存所有候选，不替代正式长期资产。
- 主要来自 Weekly Output 中已勾选的 checkbox 和明确标记为重要、保留、继续追踪的内容。
- 每周作为季度文件中的一个小节追加或更新，避免一周一个文件过碎。

## 人工审核流程

1. 先读「本周核心摘要」和「来源摘要与输入覆盖情况」。
2. 再看「删除候选」，清理明显噪声和过期内容。
3. 对「素材」保持观察，不急着入库。
4. 对「术」优先做一次真实任务验证。
5. 对「法」检查领域、边界、反例和迁移性。
6. 对「道」保持最保守，必须能约束真实选择。
7. Prompt 和 Skill 候选只作为能力资产线索，不自动写入 `01_meta-prompts/` 或 `.agents/skills/`。

## 边界

- 不自动修改 `README.md`、`道/`、`法/`、`术/`、`01_meta-prompts/` 或 `.agents/skills/`。
- 不把候选报告当作事实真值。
- 不把 AI 生成的漂亮表达直接写成长期信念。
- 不把 `process-pack.md` 当作最终报告，它只是 AI 审稿材料。
- 不把 `memory.md` 当作正式入库结论，它只是跨周复用上下文。
- 不追求一次处理完成所有判断；每周只做候选发现和人工审核辅助。

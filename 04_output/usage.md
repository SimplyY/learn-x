# 04_output Usage

本文件只处理 `_dist` 已生成之后的流程。

如果还没有生成材料包，先看 `03_input/usage.md` 或调用 `learn-x-process`。

## 流程

```text
阶段 1 采集输入并同步核心议题 -> 生成周记与 Action Feedback 草稿（有效行动默认选中） -> 用户共同审核 / 修改 -> 用户说“周记已确认” -> 阶段 2 一次生成含 Action Feedback 快照及上周 Output 对照材料的 Process Pack -> Chat Pack 生成最终 Weekly Output（含不超过 600 字的周对照） -> 芒格之魂补充洞察与核心纪要 -> 阶段 3 生成并校验 Memory 候选 -> 唯一确认卡 -> 正式 Memory -> ChatGPT Bridge 核心图 -> Action Feedback / 备份 / YW Next / Flomo
```

## 1. 确认材料包

按周期确认 `process-pack.md` 存在：

```text
04_output/_dist/weekly/YYYY-Www/process-pack.md
04_output/_dist/weekly/YYYY-Www/action-feedback.md
04_output/_dist/monthly/YYYY-MM/process-pack.md
04_output/_dist/yearly/YYYY/process-pack.md
```

每周生成 Weekly Output 时，把 `process-pack.md` 交给 AI Chat；第 8 节已嵌入同目录 `action-feedback.md` 的完整快照，作为核心行动 / 反馈输入。该独立文件已在阶段 1 与周记草稿共同审核；若 Pack 生成后还要修改，再运行 `npm run process:weekly -- --week YYYY-Www` 刷新快照。`input.json` 不含正文，只在核查来源、日期过滤、缺口、重复、哈希和压缩结果时使用。

周 Process Pack 还会把上一周完整 Weekly Output 放在单独的“仅作对照”章节。旧 Output 不能成为本周事实；本周事实以当前 Process Pack 为准。基线缺失、为空或只有壳时，对照章节标注不可比较，不回退到更早周，也不读取旧周记替代。

## 2. 生成并写入 Output

在 Chat Pack 选择对应的判断类 Output：

- Weekly Output
- Monthly Output
- Yearly Output

Weekly Output 应保留恰好 3 个由 AI 提出、由用户补充回答的整周根本问题，并新增不超过 600 字的周度对照；问题核心以 10–20 字为目标、最多 50 字，含背景补充的单题总长最多 100 字。Monthly Output 应新增不超过 1200 字的月度对照和 3 个面向整月根本问题的用户回答入口；问题核心以 10–20 字为目标、最多 50 字，含背景补充的单题总长最多 100 字；它与“本月议题”中的 AI 阶段性答案分开。

生成后，由用户人工确认并写入：

```text
04_output/weekly/YYYY-WW.md
04_output/monthly/YYYY-MM.md
04_output/yearly/YYYY.md
```

Output 正文应服务于审稿：哪些输入改变了理解，哪些判断值得追踪，哪些只是噪声。

### 芒格之魂洞察（可选、推荐）

在周、月、年 Output 的 Chat Pack 中启用“芒格之魂”时，系统会切换为独立洞察模式：

- 当前问题明确要求只解析周期材料，不生成对应 Output 正文；
- 字数默认选择 `1000字`；
- 推荐上下文保留周期 `process-pack.md`、`01_core/道/` 和 `01_core/memory/`，移除 Output 生成规则与说明文件；
- 洞察由用户人工确认后写入 Output 的“芒格之魂手动洞察”区，Memorize 时作为独立候选进入 Memory 顶部候选观察池，不自动升级为正式道 / 法 / 术。

在 Learn-X 每周自动化中，以下 1—5 项属于同一个人工 Chat Pack 完成门槛；自动化汇报不得把 Weekly Output 与芒格之魂拆成两个“下一步”。阶段 2 完成后按顺序处理：

1. 使用 Learn-X Chat Pack 的 Weekly Output 功能，基于最新 `process-pack.md` 生成并审核周报正文。
2. 继续在 Chat Pack 启用“芒格之魂”，生成独立洞察。
3. 在 `04_output/weekly/YYYY-WW.md` 底部完善“芒格之魂的洞察 & 全文核心重点纪要”，并补充“本周最值得思考的 3 个问题”的回答。
4. 审核并勾选 Memory 候选，最后回复“继续记忆”。图片不再是进入阶段 3 前的人工前置步骤；公众号发布仍由用户人工完成。

Action Feedback 已在阶段 1 与周记草稿共同审核，不需要逐行勾选；有证据且填写完整的候选默认 `[x]`，将在阶段 3 最后确认后写入 Base。发现问题时可删除或修改；如需保留在 Weekly Output 但不写入 Base，可改为 `[ ]`。如果此处还要改报告，先重跑 `process:weekly` 刷新 Pack 快照。

Action Feedback 的规格见 `docs/ACTION_FEEDBACK.md`；它按当前季度短期核心议题生成，与最终 Weekly Output 分离，但属于 Process Pack 中的核心输入。Weekly Output 使用共同审核后的有效行，不复制完整表格。默认选中的有效行动行在阶段 3 写入按时间保存的 Action Feedback Base 事件。

自动化不得代替用户访问 AI Chat 或编写洞察。

## 3. 人工标记

在 Output 候选区用 checkbox 标记确认内容：

```md
- [x] 值得进入 Memory
- [ ] 值得继续追踪
- [ ] 法：候选内容
```

只有已勾选或明确标记的内容进入 Memorize。未确认的漂亮表达不写入 Memory。

## 4. Memorize

Memorize 交给 Codex 执行，不需要用户手动跑脚本。

在每周自动化线程中，完成 Action Feedback、Weekly Output、芒格洞察与核心纪要、回答本周 3 个问题、审核 Memory 候选后，回复“继续生成记忆”或同义表达，即进入阶段 3。阶段 3 必须先确认 Output 非空、芒格洞察和问题与回答非空且存在已勾选或用户明确确认的 Memory 内容；任一条件未满足时停止，不硬凑 Memory。自动化先生成并校验 `memory-candidates.md`，再展示一次包含正式 Memory、图片路径、Action Feedback Base、备份、YW Next 和 Flomo 的确认卡；用户确认后按“正式 Memory → ChatGPT Bridge 核心图（`04_output/_dist/weekly/YYYY-Www/weekly-core.png`）→ Action Feedback Base / 备份 / YW Next / Flomo”执行，并读回校验。图片失败不回滚 Memory，公众号不自动发布。

可以直接说：

```text
调用 learn-x-process，Memorize 2026-W24
Memorize 2026-05 月报
Memorize 2026 年度输出
```

Codex 会读取对应 Output 和规则，必要时生成 `memory-candidates.md`，再把已确认内容无损迁移到：

```text
01_core/memory/YYYY-QN.memory.md
01_core/memory/YYYY.memory.md
```

如果确认内容不足，Codex 应报告“不建议写入 Memory”，不要硬凑。

阶段 3 必须可重复执行：同一周已写入的完全重复条目不得再次追加。未勾选但包含“继续追踪”“重要”“保留”等关键词的候选，仍视为未确认，不能仅靠关键词写入。

## 5. Memory 压缩人工审核

月度自动化会旁路生成历史 Memory 压缩预览，但不替换正式文件。候选和 comparison 报告位于：

```text
04_output/_dist/memory-compression/YYYY-MM/
```

先检查源/候选字符数、保护内容、来源标签以及报告中的问题，再手动修改不含技术注释的候选正文。隐藏的 `.memory-compression.json` 由流程维护，不要手动删除或修改。校验：

```bash
npm run memory:compress -- --validate 04_output/_dist/memory-compression/YYYY-MM
```

只有人工确认后才显式晋级：

```bash
npm run memory:compress -- --promote 04_output/_dist/memory-compression/YYYY-MM --confirm
```

晋级前会重新校验源哈希、保护块、预算和候选覆盖，并将旧季度归档；失败时不应继续操作，修改候选后重新校验即可。`ready` 只代表确定性检查通过，不代表语义无损已自动证明。

## 边界

- `_dist` 是材料区，不是最终报告。
- Output 是审稿区，不是长期真值源。
- Memory 是跨期上下文，不替代 `道/`、`法/`、`术/`。
- 人保留最终确认权；Codex 不自动升级正式资产。

# 04_output Usage

本文件只处理 `_dist` 已生成之后的流程。

如果还没有生成材料包，先看 `03_input/usage.md` 或调用 `learn-x-process`。

## 流程

```text
阶段 1 采集输入 -> 人工完成 ai.md -> 自动生成并人工确认周/ 月记草稿 -> 阶段 2 生成 _dist -> Chat Pack 生成 Output -> 芒格之魂补充洞察与核心纪要 -> 阶段 3 Memorize
```

## 1. 确认材料包

按周期确认 `process-pack.md` 存在：

```text
04_output/_dist/weekly/YYYY-Www/process-pack.md
04_output/_dist/monthly/YYYY-MM/process-pack.md
04_output/_dist/yearly/YYYY/process-pack.md
```

常规只把 `process-pack.md` 交给 AI Chat。`input.json` 不含正文，只在核查来源、日期过滤、缺口、重复、哈希和压缩结果时使用。

## 2. 生成并写入 Output

在 Chat Pack 选择对应的判断类 Output：

- Weekly Output
- Monthly Output
- Yearly Output

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

在 Learn-X 每周自动化中，以下 1—4 项属于同一个人工 Chat Pack 完成门槛；自动化汇报不得把 Weekly Output 与芒格之魂拆成两个“下一步”。阶段 2 完成后按顺序处理：

1. 使用 Learn-X Chat Pack 的 Weekly Output 功能生成并审核周报正文。
2. 继续在 Chat Pack 启用“芒格之魂”，生成独立洞察。
3. 在 `04_output/weekly/YYYY-WW.md` 底部完善“芒格之魂的洞察 & 全文核心重点纪要”。
4. 审核并勾选 Memory 候选，最后回复“继续记忆”。

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

在每周自动化线程中，完成 Weekly Output、补充芒格洞察与核心纪要、勾选候选后，回复“继续生成记忆”或同义表达，即进入阶段 3。阶段 3 必须先确认 Output 非空、芒格洞察非空且存在已勾选或用户明确确认的内容；任一条件未满足时停止，不硬凑 Memory。

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

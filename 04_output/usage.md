# 04_output Usage

本文件只处理 `_dist` 已生成之后的流程。

如果还没有生成材料包，先看 `03_input/usage.md` 或调用 `learn-x-process`。

## 流程

```text
03_input -> _dist/process-pack.md -> AI Chat 生成 Output -> 人工审核 -> Memorize
```

## 1. 确认材料包

按周期确认 `process-pack.md` 存在：

```text
04_output/_dist/weekly/YYYY-Www/process-pack.md
04_output/_dist/monthly/YYYY-MM/process-pack.md
04_output/_dist/yearly/YYYY/process-pack.md
```

常规只把 `process-pack.md` 交给 AI Chat。`input.json` 只在核查来源、缺口、重复或脚本结果时使用。

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

## 边界

- `_dist` 是材料区，不是最终报告。
- Output 是审稿区，不是长期真值源。
- Memory 是跨期上下文，不替代 `道/`、`法/`、`术/`。
- 人保留最终确认权；Codex 不自动升级正式资产。

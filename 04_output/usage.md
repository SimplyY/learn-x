# 04_output Usage

`04_output/usage.md` 用于 `_dist` 已经生成之后。

`03_input/usage.md` 负责输入源管理和生成 `_dist`；本文件负责说明如何基于 `_dist`，由用户自己使用 AI Chat 生成 Weekly / Monthly / Yearly Output 正文，并在人工确认后处理 Memory。

## 阶段边界

### 生成 `_dist` 前

使用 `03_input/usage.md` 生成 dist


### 生成 `_dist` 后

使用本文件：

- 检查 `_dist` 中的来源覆盖和材料包；
- 自己在 AI Chat（chat pack 功能） 中生成 Output 正文；
- 手动写入 `04_output/weekly/`、`04_output/monthly/` 或 `04_output/yearly/`；
- 人工确认是否生成 Memory 或进入长期资产。

## Output 后处理流程

生成 Weekly Output 后，不直接结束。

### 1. 人工勾选

在 Weekly Output 中用 checkbox 标记：

- [x] 值得进入 Memory
- [x] 值得继续追踪
- [x] 值得作为道 / 法 / 术候选观察

### 2. 生成 Memory 候选



## Weekly Output

### 1. 检查自动化产物

确认以下文件存在：

```text
04_output/_dist/weekly/YYYY-Www/input.json
04_output/_dist/weekly/YYYY-Www/process-pack.md
04_output/weekly/YYYY-WW.md
```

`input.json` 是脚本中间态；`process-pack.md` 是给 AI Chat 使用的默认上下文材料包。

### 2. 准备 AI Chat 上下文

推荐用 Chat Pack 功能组装上下文

选择「周输出」时，Chat Pack 会自动勾选：

- `01_core/道/`
- `01_core/memory/`
- `.agents/skills/learn-x-process/resources/weekly-output-rules.md`
- `04_output/README.md`
- `04_output/usage.md`
- 对应周的 `04_output/_dist/weekly/YYYY-Www/process-pack.md`

### 3. 写入正式 Output 文件

AI Chat 生成正文后，手动写入：

```text
04_output/weekly/YYYY-WW.md
```


## Monthly / Yearly Output

Monthly 和 Yearly 的原则与 Weekly 一致，但数据流更长，默认不要重复读取原始输入。

选择「月输出」时，Chat Pack 会自动勾选：

- `01_core/道/`
- `01_core/memory/`
- `.agents/skills/learn-x-process/resources/monthly-output-rules.md`
- 对应月的 `04_output/_dist/monthly/YYYY-MM/process-pack.md`

月度 `process-pack.md` 已经包含 `03_input/monthly/YYYY-M/` 下月记和周记等清洗正文；除非核查来源覆盖或补洞，不要再手动加入同月 `03_input/` 原始材料。

选择「年输出」时，Chat Pack 会自动勾选：

- `01_core/道/`
- `01_core/memory/`
- `.agents/skills/learn-x-process/resources/yearly-output-rules.md`
- 如果存在，优先使用 `04_output/_dist/yearly/YYYY/process-pack.md`
- 如果年度过程包不存在，使用本年度已生成的 `04_output/monthly/YYYY-*.md`

年度默认数据流是 `03_input` → monthly `_dist/process-pack.md` → Monthly Output → Yearly Output。不要默认直接读取 `03_input/` 原始材料。


## Weekly Memory

Memory 不是 Weekly Output 摘要，也不是正式 `道/`、`法/`、`术` 入库结论。

它的用途是：把人工确认后、值得跨周复用或追踪的少量判断，压缩到季度 Memory 文件中，给后续 AI Chat / Chat Pack 提供更干净的上下文。

规则位置：

```text
.agents/skills/learn-x-process/resources/memory-rules.md
```

生成候选时使用：

```bash
npm run memory:weekly
```

脚本会读取 Weekly Output，生成：

```text
04_output/_dist/weekly/YYYY-Www/memory-candidates.md
```

之后再按 `memory-rules.md` 人工压缩并写入：

```text
01_core/memory/YYYY-QN.memory.md
```

## 边界

- `04_output/_dist/weekly/`、`04_output/_dist/monthly/`、`04_output/_dist/yearly/` 是自动化材料区，不是最终报告。
- `04_output/weekly/`、`monthly/`、`yearly/` 是人工写入的 Output 区。
- Codex 可以生成 `_dist` 和最小壳，但不代写 Output 正文。
- `weekly-output-rules.md` 和 `layer-rules.md` 是生成正文时的参考规则，不复制到 `_dist`，避免冗余。
- `memory-rules.md` 只用于人工确认后的 Memory 压缩，不用于自动改写长期资产。

# 04_output Usage

`04_output/usage.md` 用于 `_dist` 已经生成之后。

`03_input/usage.md` 负责输入源管理和生成 `_dist`；本文件负责说明如何基于 `_dist`，由用户自己使用 AI Chat 生成 Weekly / Monthly / Yearly Output 正文，并在人工确认后处理 Memory。

## 阶段边界

### 生成 `_dist` 前

使用 `03_input/usage.md`：

- 建立 `03_input/weekly/YYYY-Www/` 等输入目录；
- 放入 `00_log/`、`01_inbox/`、`02_action/` 材料；
- 让 Codex 调用 `learn-x-process`；
- 生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`；
- 创建 `04_output/weekly/YYYY-WW.md` 最小壳。

### 生成 `_dist` 后

使用本文件：

- 检查 `_dist` 中的来源覆盖和材料包；
- 自己在 AI Chat 中生成 Output 正文；
- 手动写入 `04_output/weekly/`、`04_output/monthly/` 或 `04_output/yearly/`；
- 人工确认是否生成 Memory 或进入长期资产。

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

推荐用 Chat Pack 组装上下文：

1. 选择「判断决策自省」。
2. 按周期选择「周输出」「月输出」或「年输出」。
3. 在周期快捷选择里选择具体第几周、第几月或第几年。
4. 页面会自动勾选对应 `_dist` 目录下的 `process-pack.md`；需要排错或核查来源时，再通过自定义上下文手动加入 `input.json`。

Weekly 常用路径：

```text
04_output/_dist/weekly/YYYY-Www/process-pack.md
```

脚本中间态路径，常规不加入 AI Chat：

```text
04_output/_dist/weekly/YYYY-Www/input.json
```

需要输出规则时，自己打开：

```text
.agents/skills/learn-x-process/resources/weekly-output-rules.md
.agents/skills/learn-x-process/resources/layer-rules.md
```

不要让 Codex 在 `process:weekly` 阶段代写 Weekly Output 正文。Weekly Output 正文应由用户自己基于 AI Chat 生成和判断。

### 3. 写入正式 Output 文件

AI Chat 生成正文后，手动写入：

```text
04_output/weekly/YYYY-WW.md
```

如果文件已有最小壳，保留标题也可以；正文由你自己决定是否替换、扩写或重写。

## Monthly / Yearly Output

Monthly 和 Yearly 的原则与 Weekly 一致：

- 自动化产物只进入 `04_output/_dist/weekly/`、`04_output/_dist/monthly/` 或 `04_output/_dist/yearly/`；
- 正式 Output 文件只作为人工写入容器；
- AI Chat 的默认上下文来自对应周期的 `_dist/process-pack.md`；`input.json` 只在需要来源审计时手动加入；
- 不由脚本自动做长期价值判断。

建议路径：

```text
04_output/monthly/YYYY-MM.md
04_output/yearly/YYYY.md
```

当前自动化支持 Weekly 和 Monthly；Yearly 在脚本成熟前可以手动汇总对应 `_dist` 或输入材料后再生成。

Monthly `_dist` 生成命令：

```bash
npm run process:monthly -- --month YYYY-MM
```

也可以一次生成多个存量月份：

```bash
npm run process:monthly -- --months 2026-01,2026-02,2026-03
```

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

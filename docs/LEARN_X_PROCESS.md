# Learn-X Process 功能说明

Learn-X Process 是周期输入到人工审稿的处理流程。它把指定周或月的 Input 确定性整理为可追溯的 Process Pack，创建 Output 最小壳，并在人工确认后准备 Memory 候选。

## 解决什么问题

- 把分散的周期材料整理成 AI 可读、来源可查的材料包。
- 分开确定性处理、AI 判断和人工确认，避免脚本替人做价值判断。
- 让 Weekly、Monthly、Yearly Output 与 Memory 形成可重复的闭环。

## 三阶段流程

```text
阶段 1：采集 Input
  -> 阶段 2：生成 input.json、process-pack.md 和 Output 最小壳
  -> AI Chat 生成并人工审核 Output
  -> 阶段 3：应用已确认的行动反馈变更，并提取候选 Memorize
```

| 阶段 | 主要输入 | 主要产物 | 责任主体 |
| --- | --- | --- | --- |
| 采集 | 日记、周记、AI 摘要、Flomo、微信读书等 | `03_input/<period>/` | 人 + `learn-x-input` |
| Process | 指定周期 Input | `_dist/.../input.json`、`process-pack.md`、Output 最小壳 | `learn-x-process` 脚本 |
| Output | Process Pack、规则、必要的道与 Memory | 周 / 月 / 年 Output 正文 | AI Chat 辅助，人审核 |
| 行动反馈 / Memorize | 已审核的行动变更与明确勾选的 Output 候选 | 行动反馈 Base、Memory 候选与周期 Memory | Codex 执行，人确认 |

## 核心产物

- `input.json`：metadata-only 审计清单。Monthly 记录周度与月度来源、日期过滤、哈希、去重和压缩统计，不保存正文。
- `process-pack.md`：给 AI Chat 的自包含材料包。Monthly 由确定性过滤材料与 Codex 事件压缩共同组成，默认不超过 100 KB。
- Output 最小壳：只保证目标文件存在，不代写正文，不覆盖已有内容。
- `memory-candidates.md`：只收集已勾选或明确确认的候选，供 Memorize 使用。

目录和人工操作分别见 [03_input/README.md](../03_input/README.md)、[03_input/usage.md](../03_input/usage.md)、[04_output/README.md](../04_output/README.md) 和 [04_output/usage.md](../04_output/usage.md)。

## 功能边界

- Weekly 读取指定周目录；Monthly 读取目标月相交周目录和指定月目录，不按文件修改时间猜测范围。
- 脚本负责读取、清洗、去重、编号、来源追踪和生成材料包。
- Monthly 的语义压缩由 Codex 按 Skill 规则完成；脚本只生成请求并校验来源哈希、月份、事件预算和总大小。
- AI Chat 负责生成判断草稿，人负责审核、取舍和最终沉淀。
- 已有 Output 不覆盖；未确认候选不写入 Memory；重复执行不重复追加同一条目。
- 不自动修改 `01_core/道/`、`01_core/法/` 或 Prompt、Skill 等正式资产。
- 不引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。

## 与 Chat Pack 的关系

Learn-X Process 负责准备可信材料；Chat Pack 负责把材料、周期规则和 Prompt 组装成 AI Chat 可用的对话包。两者不互相替代：

```text
learn-x-process 生成 Process Pack -> Chat Pack 组装对话 -> 人工审核 Output -> Memorize
```

Chat Pack 的功能说明见 [Chat Pack 功能说明](CHAT_PACK.md)。

## 维护位置

| 内容 | 维护位置 |
| --- | --- |
| 功能目标、阶段和边界 | 本文档 |
| Agent 调用条件、命令和执行规则 | `.agents/skills/learn-x-process/SKILL.md` |
| 输出判断与 Memory 规则 | `.agents/skills/learn-x-process/resources/` |
| 确定性处理 | `.agents/skills/learn-x-process/scripts/` |
| 用户输入 / 输出操作 | `03_input/usage.md`、`04_output/usage.md` |

实现命令和验证入口见 [TECH.md](TECH.md)。

# Learn-X Process 功能说明

Learn-X Process 是周期输入到人工审稿的处理流程。它把指定周或月的 Input 确定性整理为可追溯的 Process Pack，创建 Output 最小壳，并在人工确认后准备 Memory 候选。

## 解决什么问题

- 把分散的周期材料整理成 AI 可读、来源可查的材料包。
- 分开确定性处理、AI 判断和人工确认，避免脚本替人做价值判断。
- 让 Weekly、Monthly、Yearly Output 与 Memory 形成可重复的闭环。

## 三阶段流程

```text
阶段 1：采集 Input
  -> 周/ 月记草稿：仅以已落盘 Input 生成飞书草稿，人工确认后采回定稿
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
- Memory 压缩候选：`04_output/_dist/memory-compression/YYYY-MM/` 下的候选与 comparison 报告；只读规划、人工修改和显式晋级，不覆盖源文件。

目录和人工操作分别见 [03_input/README.md](../03_input/README.md)、[03_input/usage.md](../03_input/usage.md)、[04_output/README.md](../04_output/README.md) 和 [04_output/usage.md](../04_output/usage.md)。

## 功能边界

- Weekly 读取指定周目录；Monthly 读取实际存在的目标月相交周目录和指定月目录，不按文件修改时间猜测范围。缺少相交周目录或周来源时写入缺口审计，不创建空容器，也不阻断月度生成。
- 脚本负责读取、清洗、去重、编号、来源追踪和生成材料包。
- Monthly 的语义整理由 Codex 按 Skill 规则完成；脚本只生成请求并校验来源哈希、月份、AI 逐周核心事件、结构化正文和总大小。月记、周记、Daily、Flomo 等高密度个人输入默认只做确定性清洗；微信读书、Builder 和长调研承担主要压缩量。AI Coach 与智慧之门的新增/回顾边界由采集器负责；Process 不再对已落盘文件做来源内容排除。
- Monthly 额外读取各周 Weekly Output 中系统确认的「全文核心重点纪要」和非占位「芒格之魂的洞察」，不读取其它周报正文代替原始 Input。
- AI Chat 负责生成判断草稿，人负责审核、取舍和最终沉淀。
- 已有 Output 不覆盖；未确认候选不写入 Memory；重复执行不重复追加同一条目。
- Memory 压缩按 Unicode 字符预算运行：当前年硬上限 8000、目标 6000；旧年度按 `max(200, floor(8000 × 0.6^年龄))` 衰减，目标为硬上限的 75%。当前月、跨月周块和无法识别来源的条目保护；内容压缩由 Codex 完成，脚本只校验。比较报告先说明整份文件实际减少量，再展示稳定的 Markdown 5—10 条核心变化表；按净减少字数排序，实际改动量按字符级删除加新增计算，实际改动量不超过 10 字的变化归类，较大但未入选核心的变化汇总，最后展示量化校验。语义合并必须保留重要、反复出现且承载证据或行动的具象锚点，例如 `出门`、`读书会`、`写诗`、`运动`、人物、地点、项目和方法名。
- 不自动修改 `01_core/道/`、`01_core/法/` 或 Prompt、Skill 等正式资产。
- 不引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。

## Memory 月度压缩

月度目标月解析后旁路生成一次压缩预览：

```text
读取活动 Memory 与源哈希 -> 计算保护范围和预算
  -> Codex 生成候选 -> 脚本生成 comparison 并校验
  -> 人工修改 -> 显式 --promote --confirm 才晋级
```

候选始终位于 `04_output/_dist/memory-compression/`，正文只保留 Markdown 记忆；源哈希、预算和保护范围放在同目录隐藏 sidecar，并在 comparison 中展示。已有候选不覆盖；源变化标记 `stale`。当前年仍按季度文件组织，上一年度在新年度开始后合并为年度文件；年度晋级先归档旧季度到 `01_core/memory-archive/` 并校验哈希。归档目录不参与活动 Memory、Chat Pack 或公开静态图。

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

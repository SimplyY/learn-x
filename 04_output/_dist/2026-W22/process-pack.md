# Learn-X Process Pack｜2026-22

> 这是给 Codex / AI 审稿用的中间材料包，不是最终 Weekly Output。
> 本文件只保留来源、编号、清洗文本和覆盖情况；不要在这里做道 / 法 / 术 / Prompt / Skill 判断。

## 0. 使用方式

1. 先读取本文件和同周 `.input.json`。
2. 再读取 `.agents/skills/learn-x-process/resources/output-requirements.md` 和 `layer-rules.md`。
3. 由 Codex 按 Skill 规则生成 `04_output/weekly/YYYY-WW.md`。
4. 人再决定是否进入正式 `道/`、`法/`、`术/`、Prompt 或 Skill。

## 1. 处理信息

- 周期：2026-05-25 到 2026-06-01
- 选择方式：hybrid manifest + mtime candidates (03_input/index/weekly/2026-22.index.md)
- Manifest 引用路径数：12
- Manifest 排除路径数：2
- 生成时间：2026-05-28T06:07:56.305Z
- 原始文件数：11
- 有效材料数：132
- 去重后材料数：132
- 去重数量：0
- JSON 中间材料：`04_output/_dist/2026-W22/input.json`

## 2. 来源覆盖

| 输入类型 | 来源 | 文件数 | 有效材料数 | 选择方式 | 示例文件 |
| --- | --- | ---: | ---: | --- | --- |
| action | action/build | 1 | 14 | both:1 | `03_input/action/build/2026-05-27_weekly-codex-build.md` |
| inbox | inbox/ai | 1 | 39 | both:1 | `03_input/inbox/ai/20026-5-26.md` |
| inbox | inbox/flomo | 1 | 33 | both:1 | `03_input/inbox/flomo/20026-5-26.html` |
| inbox | inbox/reading | 5 | 45 | both:5 | `03_input/inbox/reading/教育/非学校化社会.md`、`03_input/inbox/reading/教育/认知天性-ai.md`、`03_input/inbox/reading/教育/认知天性.md` |
| inbox | inbox/theme-read | 3 | 1 | manifest:2、both:1 | `03_input/inbox/theme-read/初探心理学.md`、`03_input/inbox/theme-read/跨学科思维.md`、`03_input/inbox/theme-read/游戏.md` |

明显缺口：`log/`

## 3. 文件清单

| source id | 输入类型 | 来源 | 选择方式 | 入选原因 | 原始路径 | 文件时间 | 字节数 |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| F001 | action | action/build | both | weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选 | `03_input/action/build/2026-05-27_weekly-codex-build.md` | 2026-05-27T05:53:24.000Z | 7182 |
| F002 | inbox | inbox/ai | both | weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选 | `03_input/inbox/ai/20026-5-26.md` | 2026-05-26T10:03:49.219Z | 11206 |
| F003 | inbox | inbox/flomo | both | weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选 | `03_input/inbox/flomo/20026-5-26.html` | 2026-05-26T09:41:13.972Z | 15691 |
| F004 | inbox | inbox/reading | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/reading/教育/非学校化社会.md` | 2026-05-26T10:45:13.503Z | 79 |
| F005 | inbox | inbox/reading | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/reading/教育/认知天性-ai.md` | 2026-05-26T10:45:13.502Z | 11640 |
| F006 | inbox | inbox/reading | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/reading/教育/认知天性.md` | 2026-05-26T10:45:13.502Z | 2343 |
| F007 | inbox | inbox/reading | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/reading/教育/如何阅读一本书-ai.md` | 2026-05-26T10:45:13.500Z | 9956 |
| F008 | inbox | inbox/reading | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/reading/教育/如何阅读一本书.md` | 2026-05-26T10:45:13.501Z | 3661 |
| F009 | inbox | inbox/theme-read | manifest | weekly index 显式引用 | `03_input/inbox/theme-read/初探心理学.md` | 2026-05-18T02:30:36.165Z | 0 |
| F010 | inbox | inbox/theme-read | both | weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为 | `03_input/inbox/theme-read/跨学科思维.md` | 2026-05-26T10:45:05.803Z | 163 |
| F011 | inbox | inbox/theme-read | manifest | weekly index 显式引用 | `03_input/inbox/theme-read/游戏.md` | 2026-05-18T02:30:26.003Z | 0 |

## 4. 材料清单

### I001｜action｜action/build｜本周 Codex Build 复盘

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#1`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`9468564e8f3b`

```
# 本周 Codex Build 复盘

生成时间：2026-05-27
```

### I002｜action｜action/build｜2026-05-27_weekly-codex-build 2

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#2`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`3711afbb382e`

```
本复盘覆盖 2026-05-20 至 2026-05-27，实际可验证活动主要集中在 2026-05-26 至 2026-05-27。

可用来源：

- 项目真值源与实现索引：`AGENTS.md`、`README.md`、`app/code/docs/FEAT.md`、`app/code/docs/TECH.md`。
- 本地 Git 记录：`ad21b54 v0.5`、`19ec7df v0.6`，以及当前未提交改动。
- 本地 Codex 会话记录：`~/.codex/sessions/2026/05/26/`、`~/.codex/sessions/2026/05/27/`、`~/.codex/archived_sessions/`。
- 本周输入与输出材料：`03_input/`、`04_output/`、`01_core/memory/2026-Q2.memory.md`。
- 自动化记忆：`~/.codex/automations/learn-x/memory.md`。

不可用或不完整来源：

- 无法确认是否覆盖所有 ChatGPT、Code X、外部 IDE、浏览器或手机端对话。
- 本地 Codex 记录可读，但部分长会话输出存在截断风险。
- 本复盘不虚构不可访问聊天内容，只基于本地项目和可读会话证据。
```

### I003｜action｜action/build｜2026-05-27_weekly-codex-build 3

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#3`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`17e45d66e2a5`

```
1. Learn-X 从“知识库 / Prompt 工具”升级为更清晰的个人认知进化系统：输入、处理、输出、记忆、行动边界被重新拆开。
2. Chat Pack 从 `Prompt + Context` 升级为“当前问题 + 对话类型 + 小类协议 + 上下文编排 + Prompt”的对话启动器。
3. `learn-x-process` Skill 从“脚本分类器”被纠偏为三层架构：确定性脚本搬运清洗，AI 按 Markdown 规则判断压缩，人做最终价值确认。
4. 项目目录完成一次大的边界重构：`01_core`、`02_prompts`、`03_input`、`04_output`、`app` 的责任更清楚。
```

### I004｜action｜action/build｜2026-05-27_weekly-codex-build 4

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#4`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`ba1990bb51fb`

```
### Chat Pack

- 新增 4 类对话类型：问清问题、学习理解、判断决策、创造执行。
- 每类保留少量高频小类，小类 ID 采用 `主类型.小类`，并映射到 `02_prompts/chatpack/<主类型>/<小类>.md`。
- `00_config/chatpack.config.json` 独立出来，维护上下文预算、对话类型和小类元数据。
- 逐步去掉 `promptPath` 等冗余字段，转向“约定大于配置”：ID 决定文件路径。
- Chat Pack 预览增加上下文预算提示，用软提示提醒是否超过常用模型建议窗口。
- 上下文编排从复杂状态收敛为：文件不选 / 使用 / 置顶；目录未选 / 部分 / 全选。
- 全局审计推荐路径从隐式 `"all"` 改成显式路径数组，减少黑箱行为。
```

### I005｜action｜action/build｜2026-05-27_weekly-codex-build 5

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#5`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`32306ab529c0`

```
- 线上形态被明确为静态站：构建期生成图谱，运行时不依赖业务 API。
- `app/code/server.mjs` 只作为本地预览薄壳。
- `npm run build` 生成根级 `dist/` 静态产物。
- 配置移到 `00_config/`，应用代码收进 `app/code/`，资产收进 `app/assets/`。
- 保留 GitHub Pages / release 自动化方向，但当前主要证据显示仓库仍处于本地快速迭代阶段。
```

### I006｜action｜action/build｜2026-05-27_weekly-codex-build 6

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#6`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`a46a1113a23a`

```
- `learn-x-distill` 被重命名和升级为 `learn-x-process`。
- 输入从旧 `input/` 迁移到 `03_input/`，输出从旧 `output/` 迁移到 `04_output/`。
- `03_input/index/weekly/YYYY-WW.index.md` 用于确认本周处理清单，避免只靠文件修改时间猜测。
- `03_input/log/weekly/*.review.md` 与 weekly index 明确区分：前者是周记，后者是处理清单。
- `npm run process:weekly` 只生成 `input.json` 与 `process-pack.md`，不再让 JS 自动写最终人读周报。
- Weekly Output 由 Codex 按 `output-requirements.md` 生成人读版，保留来源覆盖和候选判断。
```

### I007｜action｜action/build｜2026-05-27_weekly-codex-build 7

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#7`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`d3ff92835bb6`

```
- 增加极薄 Memory 层：Weekly Output 经人工确认后，压缩进季度文件。
- 当前 Memory 文件为 `01_core/memory/2026-Q2.memory.md`。
- 每周 Memory 控制在 4-5 条，每条 20-30 字左右，最多 40 字。
- Memory 被纳入 Chat Pack 上下文编排，并默认高优先级，作为“过程记忆”跨周复用。
```

### I008｜action｜action/build｜2026-05-27_weekly-codex-build 8

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#8`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`1fa31d133128`

```
本周 Codex / Code X 最重要的工作不是单个页面，而是不断把边界调对：

- README 被压缩为项目内核，强调 `AI 效果 = Prompt × Context × Model × Feedback × Action`。
- Prompt 正文从代码配置中抽出，变成文件维护。
- Chat Pack UI 被多次减法：从多个按钮、领域地图、隐式默认，收敛为一个生成动作、显式推荐路径和可维护配置。
- Weekly Process 被多轮纠偏：先从候选分桶脚本变成人读报告，再从“AI 周回顾优先”撤回为“来源平等，内容主导”，最后确定脚本只做确定性 Process Pack。
- Input 的时间切片问题被识别，并用 weekly index 解决：内容目录按来源 / 主题组织，处理范围按周清单组织。
- Memory 从一周一个文件调整为季度聚合，避免长期记忆碎片化。
- 目录结构完成从旧 `道/法/input/output/code/assets` 到新 `01_core/03_input/04_output/app` 的迁移。
```

### I009｜action｜action/build｜2026-05-27_weekly-codex-build 9

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#9`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`56c898805af0`

```
本周最关键的进展是：Learn-X 的“器”开始服从“道 / 法 / 术”的边界。

代码没有继续扩张成判断系统，而是退回到确定性自动化：扫描、清洗、索引、构建、校验。AI 则负责判断、取舍、压缩、改写。人保留最终价值判断权。

这让 Learn-X 更接近一个认知审稿台，而不是资料仓库、Prompt 仓库或自动分类器。
```

### I010｜action｜action/build｜2026-05-27_weekly-codex-build 10

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#10`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`454787cf6a7b`

```
### 必须做

- 固化一条真实周流程：准备 weekly index → 生成 process pack → Codex 写 Weekly Output → 人工勾选 → 更新 Memory。
- 给 `03_input/action/build/` 持续补行动证据，尤其是 Codex 构建、调试、失败和上线记录。
- 保持 `01_core/道`、`01_core/法` 的人工确认边界，不允许自动写入。
```

### I011｜action｜action/build｜2026-05-27_weekly-codex-build 11

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#11`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`7b7e53736dd2`

```
- 为 Chat Pack 增加更清晰的“当前任务态上下文包”：问题、假设、约束、证据、待验证点。
- 为 `learn-x-process` 增加“行动状态层”候选：本周实验、观察指标、失败标准、下次复盘时间。
- 给全局审计、领域研究、构建执行分别沉淀一版高质量小类 Prompt。
```

### I012｜action｜action/build｜2026-05-27_weekly-codex-build 12

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#12`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`e93555286fb7`

```
- 不要做全自动入库。
- 不要把 Memory 做厚。
- 不要上数据库或复杂后台队列。
- 不要先追求复杂 UI；当前瓶颈仍是流程契约和内容质量。
```

### I013｜action｜action/build｜2026-05-27_weekly-codex-build 13

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#13`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`32ede8a516d5`

```
最缺的是稳定的行动证据，而不是更多上下文。

现在系统已经能整理、打包、复盘、压缩，但还需要更明确地记录：

- 本周真实构建了什么。
- 哪些判断被现实验证或证伪。
- 哪些功能减少了摩擦，哪些只是增加了复杂度。
- 哪些 AI 输出真正改变了下周行为。
```

### I014｜action｜action/build｜2026-05-27_weekly-codex-build 14

- 原始路径：`03_input/action/build/2026-05-27_weekly-codex-build.md`
- 原始片段 id：`03_input/action/build/2026-05-27_weekly-codex-build.md#14`
- 文件时间：2026-05-27T05:53:24.000Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，行动证据高置信自动候选
- 指纹：`79bd6c8922b4`

```
1. 连续跑一轮完整周流程，并记录到 `03_input/action/build/`。
2. 用新 Chat Pack 做一次真实高价值对话，验证“对话类型 + 小类 Prompt + Memory 高优上下文”是否有效。
3. 给 `learn-x-process` 加一个轻量行动状态输出，不进入 `道/法`，只服务下周行动。
4. 检查目录迁移后的旧路径残留，特别是文档、脚本和静态图谱忽略规则。
5. 把本周 Codex Build 复盘作为 input build 材料，在下次 Weekly Output 中检验是否真的能促进行动。
```

### I015｜inbox｜inbox/ai｜2026-05-26.md

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#1`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`d32cfdd2bf29`

```
# 2026-05-26.md
```

### I016｜inbox｜inbox/ai｜20026-5-26 2

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#2`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`ae0821fb3141`

```
## 0. 本周总览

本周主线不是单点知识积累，而是你在重构一套「如何用 AI 帮自己长期进化」的系统。核心集中在三件事：

1. **Learn-X 如何从手工笔记，升级为可周期运行的认知蒸馏系统。**
2. **教育创业如何在健康、资产、时间约束下保持小而美。**
3. **如何用苏轼 / 孔子 / 孟岩作为内在坐标，抵抗焦虑、外部评价和工具异化。**

本周最重要的变化：你开始把「和 AI 聊天」本身视为重要数据源，而不是零散对话；也开始意识到 Prompt、Context、Skill、Codex、人工确认清单需要被纳入同一个系统。
```

### I017｜inbox｜inbox/ai｜20026-5-26 3

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#3`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`d7655ed94dc7`

```
## 1. 本周反复思考的 2～3 个核心问题
```

### I018｜inbox｜inbox/ai｜20026-5-26 4

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#4`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`b73bba58d634`

```
你反复追问：Learn-X 不是简单知识库，也不是普通总结工具，而应该成为一个「认知 → 行动 → 反馈 → 再沉淀」的个人进化系统。关键难点不在于能不能总结，而在于如何从 ChatGPT 对话、Flomo、读书笔记、项目实践中提炼出真正值得长期保留的「道 / 法 / 术 / 素材」。
```

### I019｜inbox｜inbox/ai｜20026-5-26 5

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#5`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`1043594a7300`

```
你意识到，AI 效果的核心变量是 **Prompt + Context + 数据质量**。所以本周集中讨论了：不同场景是否需要不同 Prompt、常用工作流是否应升级为 Skill、什么时候用 Chat、什么时候用 Skill、什么时候交给 Codex，以及如何让这些上下文在电脑和手机上都能快速加载。
```

### I020｜inbox｜inbox/ai｜20026-5-26 6

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#6`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`caa7fc0331ea`

```
你不想回到高强度工作，也不想为赚钱牺牲身体。教育创业方向逐渐从「做课」转向「在真实项目中发生教育」：小而美、低压力、周末投入、依托靠谱合作者。资产上，你反复推演卖房、去昆明 / 玉溪、降低生活压力的可能性，本质是在寻找一种更慢、更稳、更自由的生活结构。
```

### I021｜inbox｜inbox/ai｜20026-5-26 7

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#7`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`9865490869c3`

```
## 2. 最值得沉淀为「道 / 法 / 术」的判断
```

### I022｜inbox｜inbox/ai｜20026-5-26 8

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#8`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`4a08d01bae2b`

```
- **身体、自由、意义，应高于收入最大化。** 对你而言，人生战略不宜再围绕「赚更多钱」展开，而应围绕「健康地长期创造」展开。
- **AI 是放大器，不是人生目的。** Learn-X 的目标不是把自己变成更高效的机器，而是帮助你更清醒地读书、行动、创业、修身。
- **苏轼是核心人格锚点。** 孟岩给现实理性，孔子给教育理想，苏轼负责生命力、旷达、审美与不被困住。
```

### I023｜inbox｜inbox/ai｜20026-5-26 9

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#9`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`2dd4f90f6c41`

```
- **判断是否进入沉淀系统，要区分道 / 法 / 术 / 素材。** 道必须少而稳；法负责判断框架；术负责可复用动作；素材只是未来可能使用的原料。
- **每周回顾应优先输出人工确认项，而不是自动归档。** Learn-X 的关键不是替你决定，而是把高价值候选物推到审稿台。
- **创业判断要同时看：健康成本、时间占比、合作人质量、真实项目密度、长期复利。**
```

### I024｜inbox｜inbox/ai｜20026-5-26 10

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#10`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`d07887b95a8a`

```
- 每周做一次 Learn-X 周回顾，提取核心问题、道法术、人工确认项、Skill 候选、Codex 候选。
- 对高频 Prompt 做分类沉淀，而不是堆在一个文档里。
- 对重复工作流，优先考虑 Skill；对明确工程任务，交给 Codex。
```

### I025｜inbox｜inbox/ai｜20026-5-26 11

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#11`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`62a304b8597f`

```
## 3. 我应该人工确认的清单
```

### I026｜inbox｜inbox/ai｜20026-5-26 12

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#12`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`59262c325d7b`

```
- [ ] 确认 Learn-X 的最小闭环：输入、蒸馏、人工确认、归档、下周行动。
- [ ] 确认「道 / 法 / 术 / 素材」判断规则是否足够清晰，尤其是「道」是否过度扩张。
- [ ] 确认每周回顾模板是否采用本次这个精简版，而不是 5000～10000 字大报告。
- [ ] 确认 ChatGPT 对话是否作为每周最重要输入源之一。
- [ ] 确认 Flomo、读书笔记、AI 对话的优先级与处理频率。
```

### I027｜inbox｜inbox/ai｜20026-5-26 13

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#13`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`67c5b7357cd8`

```
- [ ] 确认哪些 Prompt 只是模板，哪些已经应该升级为 Skill。
- [ ] 确认常用上下文如何快速加载：电脑、手机、ChatGPT、其他 AI。
- [ ] 确认 Prompt 合集是否继续放飞书文档，同时与 Learn-X 目录体系打通。
- [ ] 确认 Skill 的目录结构是否能被 Codex 正确读取与执行。
- [ ] 确认「审计 Prompt」是否作为高价值长期模板沉淀。
```

### I028｜inbox｜inbox/ai｜20026-5-26 14

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#14`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`59cbc8c1cb76`

```
- [ ] 确认教育创业是否坚持「小而美、周末投入、不重运营」。
- [ ] 确认与丽姐合作的边界：她负责社群与线下资源，你负责 AI / 数字化 / 理财 / 系统化能力。
- [ ] 确认是否将教育从「课程」转向「真实项目中的成长」。
- [ ] 确认 OPC 创业孵化平台是否是现阶段最值得探索的容器。
```

### I029｜inbox｜inbox/ai｜20026-5-26 15

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#15`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`4e7d65c39798`

```
- [ ] 确认未来 3～5 年是否大概率卖房降压。
- [ ] 确认昆明 / 玉溪是否作为慢生活与低成本生活的重点备选。
- [ ] 确认当前资产是否足以支持「小钱 + 小而美 + 健康优先」路线。
- [ ] 确认创业时间上限，避免再次进入高压工作结构。
```

### I030｜inbox｜inbox/ai｜20026-5-26 16

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#16`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`28255f4b7f92`

```
## 4. 下周最该做的 3 件事

1. **完成 Learn-X 最小闭环设计。** 
 不追求完美系统，只确认：每周输入什么、输出什么、人工确认什么、归档到哪里。

2. **把本周回顾模板固化为一个可复用 Prompt。** 
 重点是短、准、能产生人工确认清单，而不是生成长篇流水账。

3. **选择一个教育创业最小真实项目。** 
 不急着做课程体系，先选一个真实场景：AI 工具、理财小课、时间管理、亲子摆摊、个人项目孵化等。
```

### I031｜inbox｜inbox/ai｜20026-5-26 17

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#17`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`5d4488d74ccc`

```
## 5. 精华问题摘要
```

### I032｜inbox｜inbox/ai｜20026-5-26 18

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#18`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`e7f00aad5d72`

```
核心答案：因为它不是存资料，而是帮助你从对话、笔记、读书、行动中提炼长期判断，并推动下一步行动。

- 精华摘要：Learn-X 的价值不在「记住更多」，而在「筛掉噪声、提炼判断、形成反馈」。它应该像认知审稿台，而不是资料垃圾桶。
```

### I033｜inbox｜inbox/ai｜20026-5-26 19

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#19`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`dd9cf95a9557`

```
核心答案：一次性探索用 Chat；可复用表达用 Prompt；稳定流程用 Skill；明确工程执行用 Codex。

- 精华摘要：Chat 适合思考，Prompt 适合复用，Skill 适合流程，Codex 适合工程。不要把所有问题都塞进 Prompt，也不要过早工程化。
```

### I034｜inbox｜inbox/ai｜20026-5-26 20

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#20`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`1f5079998812`

```
核心答案：不是先做一门课，而是在真实项目中让教育发生，形成一人一项目、一人一杰作的实践场。

- 精华摘要：教育创业更适合从真实问题切入：时间、金钱、AI、表达、经营、亲子共创。教育在项目中发生，比单纯讲课更有生命力。
```

### I035｜inbox｜inbox/ai｜20026-5-26 21

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#21`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`9e8ca3d67375`

```
## 6. 最值得升级为 Skill 的重复工作流
```

### I036｜inbox｜inbox/ai｜20026-5-26 22

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#22`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`5bd4118f85a1`

```
输入：一周对话、Flomo、读书笔记、项目记录。 
输出：核心问题、道法术候选、人工确认清单、下周行动、Skill / Codex 候选。 
价值：高频、稳定、长期复利明显。
```

### I037｜inbox｜inbox/ai｜20026-5-26 23

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#23`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`17f270c2cdc5`

```
输入：一批候选内容。 
输出：分类建议、保留 / 删除 / 观察、人工确认项。 
价值：可以防止把短期情绪、漂亮句子、一次性顿悟误写成长期信念。
```

### I038｜inbox｜inbox/ai｜20026-5-26 24

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#24`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`8f1600e63ea8`

```
输入：当前场景。 
输出：应加载的背景、Prompt 模板、注意事项。 
价值：解决你最常见的问题：每次和 AI 聊天时如何快速进入高质量上下文。
```

### I039｜inbox｜inbox/ai｜20026-5-26 25

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#25`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`7cf94ebd3047`

```
输入：一个系统、计划或人生决策。 
输出：误判、反例、激励扭曲、目标偏移、复杂度风险。 
价值：适合 Learn-X、创业、资产配置、重大选择。
```

### I040｜inbox｜inbox/ai｜20026-5-26 26

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#26`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`1f4cd3aae7f7`

```
## 7. 最值得交给 Codex 执行的 1～2 个任务
```

### I041｜inbox｜inbox/ai｜20026-5-26 27

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#27`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`20ecc17eb4eb`

```
做一个最小可用目录与脚本框架：读取本周输入文件，生成 weekly distill 草稿、候选清单、人工确认文件。

验收方向：能跑通，不追求自动化完美；目录清晰；输出能直接进入人工编辑。
```

### I042｜inbox｜inbox/ai｜20026-5-26 28

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#28`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`bf851144cec0`

```
做一个轻量工具，用来按场景选择 Prompt 与上下文，方便复制到 ChatGPT 或其他 AI。

验收方向：先解决「快速找到、快速复制、快速组合」，不要一开始做复杂 GUI。
```

### I043｜inbox｜inbox/ai｜20026-5-26 29

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#29`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`4a449fcfd97c`

```
## 8. 值得进入写作、Demo 或真实行动的方向
```

### I044｜inbox｜inbox/ai｜20026-5-26 30

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#30`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`53cf7e05c842`

```
- 《AI 时代，如何建立个人认知蒸馏系统》
- 《从知识库到认知审稿台：Learn-X 的真正目标》
- 《苏轼、孔子、孟岩：一个现代人的内在积分牌》
- 《小而美教育创业：在真实项目中让教育发生》
```

### I045｜inbox｜inbox/ai｜20026-5-26 31

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#31`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`426d27290106`

```
- Learn-X 周回顾最小 Demo
- 道 / 法 / 术 / 素材判断器
- Prompt / Context 场景加载器
- 教育创业项目孵化看板
```

### I046｜inbox｜inbox/ai｜20026-5-26 32

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#32`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`ceb610738d59`

```
- 和丽姐确认一个最小教育项目试点。
- 整理一个个人 AI 使用小课或工作坊雏形。
- 用本周模板连续做 3 周 Learn-X 周回顾，验证是否真的有用。
- 针对资产和生活方式，做一版「卖房 / 不卖房 / 延后卖房」三情景表。
```

### I047｜inbox｜inbox/ai｜20026-5-26 33

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#33`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`add89ccfebf5`

```
## 9. 应该删除、降权或继续观察的短期情绪 / 噪声
```

### I048｜inbox｜inbox/ai｜20026-5-26 34

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#34`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`806a136b6ac4`

```
例如手机控制 Codex、代理、浏览器连接、本地任务没连上等。这些是阶段性操作问题，不应进入长期系统，只保留可复用解决方案。

处理建议：删除情绪，只沉淀排障步骤。
```

### I049｜inbox｜inbox/ai｜20026-5-26 35

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#35`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`741f30030f9d`

```
你多次调整 Learn-X 周回顾 Prompt，本质是在逼近更好格式。但「不满」本身不是知识，只需要保留最终有效模板。

处理建议：删除过程抱怨，保留模板迭代结论。
```

### I050｜inbox｜inbox/ai｜20026-5-26 36

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#36`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`f42995a063b3`

```
你一度倾向让 Skill / Codex 自动处理大量内容，但本周也意识到人工确认不可替代。过早自动化会制造幻觉和复杂度。

处理建议：观察，暂不扩大系统边界。
```

### I051｜inbox｜inbox/ai｜20026-5-26 37

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#37`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`248184612ab8`

```
AI 投资、OpenAI 上市、泡沫顶峰、美债、美联储等讨论有价值，但本周对你更核心的是资产压力、生活方式和风险暴露，而不是宏观预测本身。

处理建议：降权。只保留对个人资产配置有直接影响的判断。
```

### I052｜inbox｜inbox/ai｜20026-5-26 38

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#38`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`a7bcfaa4559c`

```
南斯拉夫、学校调研、诗歌评分、书籍解读等有内容价值，但本周不应抢占 Learn-X 主线。

处理建议：分别进入素材库，不进入本周核心系统判断。
```

### I053｜inbox｜inbox/ai｜20026-5-26 39

- 原始路径：`03_input/inbox/ai/20026-5-26.md`
- 原始片段 id：`03_input/inbox/ai/20026-5-26.md#39`
- 文件时间：2026-05-26T10:03:49.219Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`08db4eb1090c`

```
## 10. 本周最压缩结论

你这一周真正做的事，是把「我如何更好地和 AI 对话」升级成「我如何借助 AI 建立个人进化系统」。

Learn-X 的下一步不应该是做大，而是做小闭环：每周输入、精炼输出、人工确认、少量行动。 
教育创业的下一步不应该是做课程体系，而是选一个真实小项目。 
生活战略的下一步不应该是追求更多收入，而是确认什么结构能让你健康、自由、长期创造。

一句话： 
**用 AI 做减法，用项目做验证，用身体和内在积分牌做最终裁判。**
```

### I054｜inbox｜inbox/flomo｜20026-5-26 1

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#1`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`4c6cab661f05`

```
flomo · 浮墨笔记
```

### I055｜inbox｜inbox/flomo｜20026-5-26 3

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#3`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`62987e8dd028`

```
于 2026-5-26 导出 11 条 MEMO
```

### I056｜inbox｜inbox/flomo｜20026-5-26 4

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#4`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`5c93eef89709`

```
选择年月 
 2026-05
```

### I057｜inbox｜inbox/flomo｜20026-5-26 5

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#5`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`006d62108866`

```
选择标签 
 常用 常用/ai 道 回顾 回顾/好问题 记录 记录/思考 写诗 哲学 自我认知
```

### I058｜inbox｜inbox/flomo｜20026-5-26 7

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#7`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`972d2e14517e`

```
2026-05-26 15:41:34
```

### I059｜inbox｜inbox/flomo｜20026-5-26 8

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#8`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`19a5103d97a0`

```
决定大多数人的思想的核心要素：
```

### I060｜inbox｜inbox/flomo｜20026-5-26 10

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#10`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`1530b85ba71a`

```
屁股（资产负债表、身份、工作等），屁股决定脑袋
```

### I061｜inbox｜inbox/flomo｜20026-5-26 11

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#11`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`896b8c9f87a1`

```
2026-05-22 22:46:24
```

### I062｜inbox｜inbox/flomo｜20026-5-26 12

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#12`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`f1f22e25821d`

```
生命是流动的，而不是固态的。
```

### I063｜inbox｜inbox/flomo｜20026-5-26 14

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#14`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`e6d44339416b`

```
2026-05-21 08:21:53
```

### I064｜inbox｜inbox/flomo｜20026-5-26 15

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#15`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`632cf9b9abf1`

```
我不应用外在来衡量自己，比方说钱、世俗的名望，
```

### I065｜inbox｜inbox/flomo｜20026-5-26 16

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#16`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`80f001400568`

```
我应该用内在积分牌，而我的内在计分牌就是：
```

### I066｜inbox｜inbox/flomo｜20026-5-26 17

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#17`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`e148a8225193`

```
日常时，我今天是否更像苏轼、孟岩、孔子了呢？
```

### I067｜inbox｜inbox/flomo｜20026-5-26 18

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#18`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`edcd09886323`

```
焦虑时，如果苏轼、孟岩、孔子是我，他们会怎么思考、选择、行动？
```

### I068｜inbox｜inbox/flomo｜20026-5-26 19

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#19`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`52cd049cad03`

```
#回顾/好问题 #记录/思考
```

### I069｜inbox｜inbox/flomo｜20026-5-26 20

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#20`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`6abc59052595`

```
2026-05-20 18:59:33
```

### I070｜inbox｜inbox/flomo｜20026-5-26 21

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#21`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`c586b05e8a8d`

```
心底之问：你是否更像苏轼、孟岩、孔子？
```

### I071｜inbox｜inbox/flomo｜20026-5-26 22

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#22`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`5f4c70274559`

```
苏轼、孟岩、孔子，就是我的人生导师。
```

### I072｜inbox｜inbox/flomo｜20026-5-26 25

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#25`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`1bba9a6b3e4b`

```
很多小问题无所谓怎么选，
```

### I073｜inbox｜inbox/flomo｜20026-5-26 26

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#26`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`ad1bed169796`

```
其他纠结、迷茫、后悔、焦虑统统没。
```

### I074｜inbox｜inbox/flomo｜20026-5-26 27

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#27`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`bd5f6d4d25cc`

```
#回顾/好问题 #常用/ai #道 #自我认知
```

### I075｜inbox｜inbox/flomo｜20026-5-26 28

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#28`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`b7b607554cf3`

```
2026-05-20 16:44:11
```

### I076｜inbox｜inbox/flomo｜20026-5-26 30

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#30`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`5b452dae15df`

```
纯文字但信息占比仅7％。
```

### I077｜inbox｜inbox/flomo｜20026-5-26 35

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#35`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`80cba21dd82c`

```
2026-05-20 16:32:33
```

### I078｜inbox｜inbox/flomo｜20026-5-26 36

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#36`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`9a995f1e35c3`

```
沃野千里，白云似海，高铁如龙欲飞天。
```

### I079｜inbox｜inbox/flomo｜20026-5-26 37

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#37`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`13c1fcfd34c5`

```
枣阳汉城，皇宫巨茧，行路万里方知命。
```

### I080｜inbox｜inbox/flomo｜20026-5-26 39

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#39`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`3471c90153fd`

```
2026-05-20 15:38:43
```

### I081｜inbox｜inbox/flomo｜20026-5-26 40

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#40`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`3752e4e2318a`

```
汉宫汉城超出预期，尤其是动物园
```

### I082｜inbox｜inbox/flomo｜20026-5-26 41

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#41`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`a20bbe2a4c0c`

```
2026-05-20 10:13:45
```

### I083｜inbox｜inbox/flomo｜20026-5-26 47

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#47`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`e45d94f8f179`

```
2026-05-19 19:04:02
```

### I084｜inbox｜inbox/flomo｜20026-5-26 48

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#48`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`41d1d24cd575`

```
烟消云散处，花开满露台。
```

### I085｜inbox｜inbox/flomo｜20026-5-26 49

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#49`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`dcfdfbe65d8f`

```
2026-05-19 15:52:01
```

### I086｜inbox｜inbox/flomo｜20026-5-26 55

- 原始路径：`03_input/inbox/flomo/20026-5-26.html`
- 原始片段 id：`03_input/inbox/flomo/20026-5-26.html#55`
- 文件时间：2026-05-26T09:41:13.972Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，外部导入高置信自动候选
- 指纹：`2683fe11af37`

```
2026-05-19 13:36:04
```

### I087｜inbox｜inbox/reading｜认知天性-ai

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#1`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`dc4ff7ce2e50`

```
#+title: 伴读：认知天性 (Make It Stick)
#+date: [2026-05-11 Mon 17:51]
#+filetags: :reading:cognitive_science:learning:
#+identifier: 20260511T175128
#+source: 实体书/电子版精读萃取
```

### I088｜inbox｜inbox/reading｜认知天性-ai 3

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#3`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`0eda3907fb50`

```
** 一句话摘要
学习的本质是反直觉的：让你觉得毫不费力的流畅输入，只是在制造"熟练度错觉"；真正能改变神经突触、形成长期心智模型的学习，必须包含令人受挫的*合意困难* (Desirable Difficulties)。
```

### I089｜inbox｜inbox/reading｜认知天性-ai 4

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#4`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`9fadd8d5d3cd`

```
** 结构地图
+---------------------------------------------------+
| 现象层：熟练度错觉 (The Illusion of Knowing) |
| [肌] 集中练习 (Massed) + 反复阅读 (Rereading) |
| ---> 极低的短期摩擦力 = 极高的长期遗忘率 |
+---------------------------------------------------+
 | 破除/反转
 v
+---------------------------------------------------+
| 机制层：合意困难 (Desirable Difficulties) |
| [骨] 提取练习 (Retrieval) : 从记忆中强行调取 |
| [骨] 间隔练习 (Spacing) : 引入时间带来的遗忘 |
| [骨] 穿插练习 (Interleaving): 破坏单一模式的连贯 |
+---------------------------------------------------+
 | 结网
 v
+---------------------------------------------------+
| 终局层：知识的编织 (Elaboration & Mental Models) |
| [筋] 将新知识用自己的语言与已知体系产生硬连接 |
| ---> 构建出可迁移的底层思维格栅 |
+---------------------------------------------------+
```

### I090｜inbox｜inbox/reading｜认知天性-ai 5

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#5`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`1b013d3e0bd0`

```
** 段落分类概览
- 引言与常识批判：[骨] 核心论证（学习的反直觉性）
- 飞行员与医生的案例：[肌] 肌肉段（极端环境下的提取测试）
- 遗忘曲线与记忆机制：[骨] 核心论证（存储强度 vs 提取强度）
- 学习策略的具体实施：[筋] 筋膜段（方法论的过渡）
```

### I091｜inbox｜inbox/reading｜认知天性-ai 7

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#7`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`0e1db80f7235`

```
** 第一段：流畅度的陷阱 (The Trap of Fluency)
*** 翻译
[直译] Rereading text and massed practice of a skill or new knowledge are by far the preferred study strategies of learners of all stripes, but they are also among the least productive. 
(反复阅读文本和对一项技能或新知识的集中练习，是迄今为止所有类型的学习者最偏爱的学习策略，但它们也是最缺乏成效的。)
```

### I092｜inbox｜inbox/reading｜认知天性-ai 8

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#8`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`2e064949bc5f`

```
[意译] 我们最本能的学习动作——捧着书一遍遍看，或者把一个题型连刷几十遍——其实效率极低。这种低效被一种心理错觉掩盖了：因为材料在你眼前变得越来越熟悉，你的大脑分泌了多巴胺，让你产生了一种“我已经掌握了它”的幻觉。
```

### I093｜inbox｜inbox/reading｜认知天性-ai 9

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#9`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`e836f4e879fd`

```
[点睛] *Fluency Illusion* (流畅度错觉)。英文中的 Fluency 本意是液体流动的顺畅感。作者在这里点破了一个残酷的真相：输入端的顺畅（流畅度），恰恰是输出端（掌握度）的死敌。看着平滑的K线图以为自己懂了市场规律，和看着划满重点的书以为自己懂了知识，在大脑的底层机制里是完全同构的欺骗。
```

### I094｜inbox｜inbox/reading｜认知天性-ai 10

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#10`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`2068d2ee1cc1`

```
*** 结构标注
核心观点：对人类出厂设置（直觉）的开场暴击。
```

### I095｜inbox｜inbox/reading｜认知天性-ai 11

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#11`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`2ad4d6fe83b4`

```
*** 注疏
[同构（侧光）]
这里的论证结构，和*价值投资中的短期波动与长期复利*是同一个形状。集中练习（短线频繁交易）能带来极高的短期情绪价值和虚假的掌控感，但无法跨越时间周期；而真正能沉淀为资产的心智模型，其构建过程往往在当下是迟缓的、反人性的、甚至伴随着账面浮亏的痛苦。
```

### I096｜inbox｜inbox/reading｜认知天性-ai 12

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#12`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`98e8a6900b6f`

```
*** 碰撞记录
Agent: 作者这段最想说服你接受的一个点是什么？你接受吗？
Reader: 他想说服我放弃"书读百遍其义自见"的错觉。理智上接受，但身体感受上很难受，因为反复阅读确实让人觉得很安心。
Agent: 这种"安心"就是他说的 Fluency。如果不让你反复阅读，剥夺了你的这种安心感，你会感到焦虑吗？
Reader: 会，会觉得心里没底，好像什么都没抓住。
Agent: 你的感受非常精准。*学习的本质，或许就是要学会在这种"失控的焦虑感"中停留。* 我们接着往下看他给出的解药。
```

### I097｜inbox｜inbox/reading｜认知天性-ai 13

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#13`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`1df778e07e89`

```
** 第二段：提取练习——大脑的缓存击穿 (Retrieval Practice)
*** 翻译
[直译] Retrieval practice—recalling facts or concepts or events from memory—is a more effective learning strategy than review by rereading. Flashcards are a simple example.
(提取练习——从记忆中回想事实、概念或事件——是比通过反复阅读来复习更有效的学习策略。抽认卡就是一个简单的例子。)
```

### I098｜inbox｜inbox/reading｜认知天性-ai 14

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#14`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`9a026b77add6`

```
[意译] 不要把知识"塞"进大脑，要试着把它"拽"出来。每一次你合上书本，强迫自己回忆刚才看了什么，哪怕想不起来而感到痛苦，这个"强行调取"的动作本身，就在物理层面上加固了神经元之间的连接。
```

### I099｜inbox｜inbox/reading｜认知天性-ai 15

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#15`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`5f0e2f0bc499`

```
[旁逸]
这里的提取过程，和计算机系统架构中的 *Cache Invalidation* (缓存失效) 极其相似。
反复阅读只是在刷新 L1 Cache（短期工作记忆），速度极快，调用极度丝滑，但一断电（睡一觉）就全没了。
提取练习，就是强制你清空缓存，逼迫系统顺着指针去硬盘（长期记忆区）里做一次全表扫描。这个过程耗时、卡顿、费算力，但只有这样，系统才会为了优化下一次查询，去重建底层的数据索引。所谓学习，建的不是数据，而是索引。
```

### I100｜inbox｜inbox/reading｜认知天性-ai 16

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#16`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`1b1020528874`

```
*** 结构标注
核心机制段：给出破局的第一性原理。
```

### I101｜inbox｜inbox/reading｜认知天性-ai 17

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#17`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`3a94c41d322e`

```
*** 碰撞记录
Agent: 读到这段你什么感觉？如果你今天的阅读任务就是看完这一章，你会怎么应用"提取"？
Reader: 我觉得我以前用 flomo 记笔记的方式有问题。我看到好的句子就高亮、摘录下来，以为存在 flomo 里就是我的了。
Agent: 极好的反思。摘录只是"搬运" (Fluency)。如果你要把它变成"提取" (Retrieval)，这个动作应该怎么变形？
Reader: 我应该在看完一段后，不看原文，用自己的话在空白文档里默写出核心逻辑。哪怕写得磕磕绊绊。
Agent: *Exactly.* 哪怕写得磕磕绊绊——这正是下一段要讲的核心机制。
```

### I102｜inbox｜inbox/reading｜认知天性-ai 18

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#18`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`184f3608c9d5`

```
** 第三段：合意困难 (Desirable Difficulties)
*** 翻译
[直译] When the mind has to work, learning sticks better. The greater the effort to retrieve learning, provided that you succeed, the more that learning is strengthened.
(当大脑必须努力工作时，学习会更牢固。为了提取所学知识而付出的努力越大，只要你最终成功了，这种学习被强化的程度就越高。)
```

### I103｜inbox｜inbox/reading｜认知天性-ai 19

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#19`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`b0fdb1c9b1b7`

```
[点睛] *Desirable Difficulties* (合意困难)。这是全书最昂贵的一个词。Difficulties (困难) 解释了为什么它反人性；Desirable (合意的/恰到好处的) 是它的边界限制。如果太难导致彻底失败，那是无用功；只有那种让你像举重时肌肉撕裂边缘的重量，才是*Desirable*的。
```

### I104｜inbox｜inbox/reading｜认知天性-ai 20

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#20`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`ec94515b9b7e`

```
*** 结构标注
全书灵魂段落：定义了有效学习的物理硬约束。
```

### I105｜inbox｜inbox/reading｜认知天性-ai 21

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#21`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`ef1bdb2457ac`

```
*** 注疏
[对手（逆光）]
最强的反对声音来自"认知负荷理论" (Cognitive Load Theory)。该理论认为，学习者的工作记忆容量极其有限。如果人为制造困难（比如打乱顺序、刻意延迟），会导致认知负荷超载，反而摧毁初学者的自信心。如果有人这样反驳，你怎么回应？
```

### I106｜inbox｜inbox/reading｜认知天性-ai 22

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#22`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`3fde9146f69e`

```
*** 碰撞记录
Reader: 这个反驳有道理。对于初学者，或者基础很差的学生（比如初三物理不及格的孩子），直接上"合意困难"会不会直接把他们劝退？
Agent: 你找到了极其关键的边界条件。如果作者补上这一点，论证还成立吗？
Reader: 成立，但需要分阶段。在知识导入期（破冰期），需要降低摩擦力，用低认知负荷建立正反馈；但一旦进入巩固期，就必须残忍地撤掉脚手架，引入"合意困难"。
Agent: 你不仅理解了它，你还把它重构成了你自己的教育方法论。这就是作者在最后要谈的——知识的编织。
```

### I107｜inbox｜inbox/reading｜认知天性-ai 23

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#23`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`3545030a4b63`

```
** 第四段：知识的编织与心智模型 (Elaboration & Mental Models)
*** 翻译
[直译] Elaboration is the process of giving new material meaning by expressing it in your own words and connecting it with what you already know.
(细化/编织，是用你自己的语言表达新材料，并将其与你已知的内容连接起来，从而赋予新材料意义的过程。)
```

### I108｜inbox｜inbox/reading｜认知天性-ai 24

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#24`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`fa6e05dead24`

```
[意译] 孤立的知识点像沙子，风一吹就散了。你必须在沙子中加入水泥和钢筋——也就是用你自己的话，把新概念强行缝合到你已有的知识网络里。当你能用物理学的熵增去解释历史规律，或者用计算机的底层逻辑去解释大脑记忆时，你就拥有了跨越领域的心智模型。
```

### I109｜inbox｜inbox/reading｜认知天性-ai 25

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#25`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`9eb4b5ed02bd`

```
*** 结构标注
终局升华段：从"术"的层面（怎么记），上升到"道"的层面（怎么想）。
```

### I110｜inbox｜inbox/reading｜认知天性-ai 26

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#26`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`6cb0d6b6481f`

```
*** 注疏
[源流（背光）]
查理·芒格 (Charlie Munger) 曾提出过著名的 "Latticework of Mental Models" (心智模型格栅)。本书作者提出的 Elaboration，在神经科学层面验证了芒格的哲学：当你拥有一百个来自不同学科的底层模型，且它们在你的大脑中相互连接时，你看到的将不再是现象，而是事物运行的动力学法则。
```

### I111｜inbox｜inbox/reading｜认知天性-ai 28

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#28`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`61726f85195c`

```
** 理解轨迹
在《认知天性》的这次伴读中，你的轨迹如下：
1. 【流畅度错觉】 -> 产生本能抵抗（"身体感受上很难受"），但理智上接纳了输入的流畅不等于输出的掌握。
2. 【提取练习】 -> 产生顿悟 (Aha moment)，主动反思了过去用 flomo 纯摘录的无效性，并推导出了"默写/重述"的正确路径。
3. 【合意困难】 -> 展现了深刻的批判性思考，用"认知负荷"作为制衡，推导出了因材施教（初学者与巩固期）的动态教学策略。
4. 【知识编织】 -> 成功将孤立概念整合进自身的系统认知中。
```

### I112｜inbox｜inbox/reading｜认知天性-ai 29

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#29`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`194715cd666b`

```
** 读后一句话
*(模拟读者输出)*
"学习不是往硬盘里塞死数据，而是通过制造受挫的检索阻力，在大脑里不断重建跨界索引的神经元连接工程。"
```

### I113｜inbox｜inbox/reading｜认知天性-ai 30

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#30`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`840efd6f12c9`

```
*(Agent 评估: L3 - 生出新东西了。不仅整合了计算机科学的隐喻，而且精准扣住了"受挫"与"重建"的核心。)*
```

### I114｜inbox｜inbox/reading｜认知天性-ai 31

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#31`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`927a8cef1985`

```
** 终局问题
如果在你正在构思的个人智能学习系统（如类似 Codex 驱动的 Learn-X 架构）中，不仅仅满足于"记录"与"搜索"，而是要设计一套机制，*在算法层面强迫未来的你定期受挫、进行痛苦但高效的「提取」*，你会如何设计这个数据库的架构和交互反馈？
```

### I115｜inbox｜inbox/reading｜认知天性-ai 32

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#32`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`d34f80a897be`

```
** 术语表
| 英文词汇 | 中文译法 | 本文含义 | 出现位置 |
| :--- | :--- | :--- | :--- |
| Fluency Illusion | 流畅度错觉 | 误把"熟悉感"当成"掌握度"的认知偏见 | 第一段 |
| Massed Practice | 集中练习 | 短时间内高强度重复单一技能（低效） | 第一段 |
| Retrieval Practice | 提取练习 | 不看资料，凭空回忆信息的动作 | 第二段 |
| Desirable Difficulties | 合意困难 | 恰到好处、能触发深度记忆重组的阻力 | 第三段 |
| Elaboration | 细化/编织 | 用自己的话将新知与旧网建立强连接 | 第四段 |
```

### I116｜inbox｜inbox/reading｜认知天性-ai 33

- 原始路径：`03_input/inbox/reading/教育/认知天性-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性-ai.md#33`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`a5609f7b81ba`

```
** 下一步线索
这个问题在哪里被继续推进了？
- 关于为何人类大脑极度厌恶"合意困难"，可推进至丹尼尔·卡尼曼对 System 1（好逸恶劳）与 System 2（高耗能）的论述。
- 关于教育系统如何实操，可检索 Robert Bjork (提出合意困难概念的认知心理学家) 关于 "Spacing and Interleaving" 的原典论文。
```

### I117｜inbox｜inbox/reading｜核心结构

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#1`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`5f44e4ecef12`

```
# 核心结构
[ 认知天性的逻辑骨架 ]
 Level 1: 现象 (Phenomenon)
 +---------------------------------------+
 | *Fluency Illusion* (熟练度错觉) |
 | - 重复阅读 = 伪装成努力的懒惰 |
 +---------------------------------------+
 |
 | (反转：从输入转为提取)
 v
 Level 2: 机制 (Mechanism)：费曼学习法
 +---------------------------------------+
 | *Desirable Difficulties* (合意困难) |
 | - Retrieval (提取): 脑力的"缓存击穿" |
 | - Spacing (间隔): 给遗忘留出空间 |
 | - Interleave(穿插): 破坏模式的连贯性 |
 +---------------------------------------+
 |
 | (升华：从记忆转为建模)
 v
 Level 3: 终局 (Endgame)：做中学、跨学科
 +---------------------------------------+
 | *Mental Models* (心智模型) |
 | - Elaboration (编织): 知识的"缝合" |
 | - Generation (生成): 预测后的修正 |
 +---------------------------------------+
> 我的理解，费曼学习法就是机制层，做中学就是终局层
```

### I118｜inbox｜inbox/reading｜认知天性 2

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#2`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`8fe367cfcf3a`

```
1. 学习的本质是反直觉的
 1. 让你觉得毫不费力的流畅输入，只是在制造"熟练度错觉"；真正能改变神经突触、形成长期心智模型的学习，必须包含令人受挫的
2. 输入端的顺畅是输出端的死敌
 1. 【流畅度错觉】作者在这里点破了一个残酷的真相：输入端的顺畅（流畅度），恰恰是输出端（掌握度）的死敌。
```

### I119｜inbox｜inbox/reading｜认知天性 3

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#3`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`ae852b5e1296`

```
1. 提取越费力，收益就越强。引发更费力处理过程的困难，会导致更持久的学习。
2. 当学习被整合进一个更大的先验知识网络时，它会变得更强。
```

### I120｜inbox｜inbox/reading｜认知天性 4

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#4`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`ebcf18d83ac0`

```
1. 忽略了情感能量的供给，尤其是人的动机、状态
2. 这本书讲的是“如何让知识粘得牢”，但没讲“哪些知识值得粘”。
```

### I121｜inbox｜inbox/reading｜认知天性 5

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#5`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`6b8582336259`

```
1. 如何建立合适的机制，温故而知新？
2. 做中学、跨学科，针对读过的书，如何行动？
```

### I122｜inbox｜inbox/reading｜认知天性 6

- 原始路径：`03_input/inbox/reading/教育/认知天性.md`
- 原始片段 id：`03_input/inbox/reading/教育/认知天性.md#6`
- 文件时间：2026-05-26T10:45:13.502Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`b3b2a67a5674`

```
1. 针对读过的书，每一本需要有笔记，且第二周、第二个月需要温故，且是语音的方式温故
2. 强制读书笔记模版，必须有我的行动。
```

### I123｜inbox｜inbox/reading｜如何阅读一本书-ai

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书-ai.md#1`
- 文件时间：2026-05-26T10:45:13.500Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`6ef542270373`

```
#+title: 伴读：《如何阅读一本书》 (How to Read a Book) 深度解码
#+date: [2026-05-11 Mon 21:30]
#+filetags: :reading:epistemology:active_learning:
#+identifier: 20260511T213000
#+source: 莫提默·艾德勒 & 查尔斯·范多伦

* 全局地图

** 一句话摘要
阅读并非信息接收，而是一场跨越时空的、极具“攻击性”的智力博弈；其终极目的是通过四层进阶，将读者的心智从“被动受众”锻造成“独立裁判”。

** 结构地图 (ASCII Art)

 [ 认知攀登的四重境界 ]
 
 Level 4: 主题阅读 (Synoptical)
 +-------------------------------------------+
 | 建立自己的坐标系：跨书本的对话，构建新意义 |
 +-------------------------------------------+
 ^
 | (连接与超越)
 Level 3: 分析阅读 (Analytical)
 +-------------------------------------------+
 | 咀嚼与消化：透视骨架、定义术语、主旨判断 |
 | *核心规则*：在说“我不同意”前，先说“我懂了” |
 +-------------------------------------------+
 ^
 | (深度与批判)
 Level 2: 检视阅读 (Inspectional)
 +-------------------------------------------+
 | 扫读与粗读：在有限时间内发现书的灵魂（骨架） |
 +-------------------------------------------+
 ^
 | (效率与结构)
 Level 1: 基础阅读 (Elementary)
 +-------------------------------------------+
 | 识字与语义：消灭字面上的“阅读障碍” |
 +-------------------------------------------+

** 段落分类概览
- *第一部分：阅读的层次* [骨] 核心论证（主动性与四层次定义）
- *第二部分：分析阅读的规则* [肌] 肌肉段（极其详尽的阅读技术指南）
- *第三部分：阅读不同读物的方法* [筋] 筋膜段（针对文学、历史、科学的适配）
- *第四部分：阅读的终极目标* [骨] 核心论证（心智的自我超越）

* 深度伴读记录：三重世界解码

** 1. 基石：阅读即“捕球” (Reading as Catching)
[

[片段已截断，完整内容见同周 .input.json]
```

### I124｜inbox｜inbox/reading｜如何阅读一本书-ai 2

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书-ai.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书-ai.md#2`
- 文件时间：2026-05-26T10:45:13.500Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`7379bddd48b2`

```
*伴读结语*：
你提到的每周 2 份结构化总结是非常棒的 *Retrieval Practice* (提取练习)。建议在写总结时，增加一个模块：*“这本书在哪个点上冒犯了我？”* 因为只有产生“冒犯”的地方，才是你心智模型发生真实扩张的地方。
```

### I125｜inbox｜inbox/reading｜核心结构

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#1`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`de0ac97f049e`

```
# 核心结构
全书本质是在构建一套“认知升级路径”，培养：独立、深度、可自我校正的思维能力。

** 结构地图 (ASCII Art)

 [ 认知攀登的四重境界 ]
 
 Level 4: 主题阅读 (Synoptical)
 +-------------------------------------------+
 | 建立自己的坐标系：跨书本的对话，构建新意义 |
 +-------------------------------------------+
 ^
 | (连接与超越)
 Level 3: 分析阅读 (Analytical)
 +-------------------------------------------+
 | 咀嚼与消化：透视骨架、定义术语、主旨判断 |
 | *核心规则*：在说“我不同意”前，先说“我懂了” |
 +-------------------------------------------+
 ^
 | (深度与批判)
 Level 2: 检视阅读 (Inspectional)
 +-------------------------------------------+
 | 扫读与粗读：在有限时间内发现书的灵魂（骨架） |
 +-------------------------------------------+
 ^
 | (效率与结构)
 Level 1: 基础阅读 (Elementary)
 +-------------------------------------------+
 | 识字与语义：消灭字面上的“阅读障碍” |
 +-------------------------------------------+
```

### I126｜inbox｜inbox/reading｜如何阅读一本书 2

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#2`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`669fa290487c`

```
1. **主动性**：阅读是一场对抗性的竞技。一切技巧的核心，皆源于对“主动性”的近乎苛刻的要求。
2. **主动思考**：真正的阅读，本质是“主动思考”。
3. **心智成长**：阅读不是信息摄入，而是心智成长。
4. **必须提问**：不提问是思考少的表现，容易读完就忘、没有收获。
5. **主题阅读**：针对你的核心问题，横跨多本书，建立一个你自创的关键词组。
6. **理解作者**
 1. 准确**复述作者逻辑**，找到其**核心前提**，发现其**推导路径**，看见其**边界条件**，再决定**赞同、反对的的内容**
```

### I127｜inbox｜inbox/reading｜如何阅读一本书 3

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#3`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`5a529ae7190e`

```
1. “阅读越主动，效果越好。”
 1. **阅读质量完全取决于读者的“攻击性”**。书不会自己跳进你的脑子里，你必须去“抓取”它。
2. *如果不先看见森林，你就永远读不懂每一棵树。*
 1. 检视阅读是在有限的时间内，通过目录、索引、序言和跳读，强行建立起书的“全局地图”。
3. “如果你读一本好书，却没感觉到被挑战，那你可能根本没读懂它。”
4. “伟大的书值得重读。”
```

### I128｜inbox｜inbox/reading｜如何阅读一本书 4

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#4`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`72f92bb220f5`

```
1. 本书没提
 1. 如何找到适合自己的好书？
 2. 如何培养好的长期阅读习惯？
2. 过分强调知，知和行都很重要，知行合一才是真正的智慧
 1. 阅读无法替代行动，知识无法替代生命体验。
```

### I129｜inbox｜inbox/reading｜如何阅读一本书 5

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#5`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`9fb4de8395e2`

```
1. ai 时代，很多人会丧失对于**好书深度阅读**的能力，对于**好问题持续深度思考**的能力，这正是这本书最有价值的地方。
2. ai 时代的读书方法？（读、聊、写、动）
 1. 把 AI 当作你的“辩论队友”。不要让它总结书，要让它反驳书。
```

### I130｜inbox｜inbox/reading｜如何阅读一本书 6

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#6`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`98933867002e`

```
1. 每周至少写 2 份结构化的读书总结，强迫自己多维度的思考、提问。
2. 每月至少 1 次深度的主题式阅读，并产出主题报告
```

### I131｜inbox｜inbox/reading｜如何阅读一本书 7

- 原始路径：`03_input/inbox/reading/教育/如何阅读一本书.md`
- 原始片段 id：`03_input/inbox/reading/教育/如何阅读一本书.md#7`
- 文件时间：2026-05-26T10:45:13.501Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`7221e4084bd3`

```
1. 掌握书的骨架，目录、背景、开头、结尾
2. 通过聊天等方式，提取书（这才是真正读懂书），通过做的方式，实践之（超出书）。
3. 主题式阅读，通过研究的方式，横跨多本书、领域，实现思维模型，并且实践迭代思维模型。
```

### I132｜inbox｜inbox/theme-read｜跨学科思维 4

- 原始路径：`03_input/inbox/theme-read/跨学科思维.md`
- 原始片段 id：`03_input/inbox/theme-read/跨学科思维.md#4`
- 文件时间：2026-05-26T10:45:05.803Z
- 选择方式：both
- 入选原因：weekly index 显式引用；mtime 本周修改，持续维护内容，需注意是否真是本周学习行为
- 指纹：`3ea04bfdc2b3`

```
# 最重要的 3 个点（for 没研究过的人）
```
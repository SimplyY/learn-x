# 本周 Codex Build 复盘

生成时间：2026-05-27

## 来源与覆盖范围

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

## 本周最核心事项

1. Learn-X 从“知识库 / Prompt 工具”升级为更清晰的个人认知进化系统：输入、处理、输出、记忆、行动边界被重新拆开。
2. Chat Pack 从 `Prompt + Context` 升级为“当前问题 + 对话类型 + 小类协议 + 上下文编排 + Prompt”的对话启动器。
3. `learn-x-process` Skill 从“脚本分类器”被纠偏为三层架构：确定性脚本搬运清洗，AI 按 Markdown 规则判断压缩，人做最终价值确认。
4. 项目目录完成一次大的边界重构：`01_core`、`02_prompts`、`03_input`、`04_output`、`app` 的责任更清楚。

## 核心功能与系统变化

### Chat Pack

- 新增 4 类对话类型：问清问题、学习理解、判断决策、创造执行。
- 每类保留少量高频小类，小类 ID 采用 `主类型.小类`，并映射到 `02_prompts/chatpack/<主类型>/<小类>.md`。
- `00_config/chatpack.config.json` 独立出来，维护上下文预算、对话类型和小类元数据。
- 逐步去掉 `promptPath` 等冗余字段，转向“约定大于配置”：ID 决定文件路径。
- Chat Pack 预览增加上下文预算提示，用软提示提醒是否超过常用模型建议窗口。
- 上下文编排从复杂状态收敛为：文件不选 / 使用 / 置顶；目录未选 / 部分 / 全选。
- 全局审计推荐路径从隐式 `"all"` 改成显式路径数组，减少黑箱行为。

### 静态站与工程流程

- 线上形态被明确为静态站：构建期生成图谱，运行时不依赖业务 API。
- `app/code/server.mjs` 只作为本地预览薄壳。
- `npm run build` 生成根级 `dist/` 静态产物。
- 配置移到 `00_config/`，应用代码收进 `app/code/`，资产收进 `app/assets/`。
- 保留 GitHub Pages / release 自动化方向，但当前主要证据显示仓库仍处于本地快速迭代阶段。

### Weekly Process

- `learn-x-distill` 被重命名和升级为 `learn-x-process`。
- 输入从旧 `input/` 迁移到 `03_input/`，输出从旧 `output/` 迁移到 `04_output/`。
- `03_input/index/weekly/YYYY-WW.index.md` 用于确认本周处理清单，避免只靠文件修改时间猜测。
- `03_input/log/weekly/*.review.md` 与 weekly index 明确区分：前者是周记，后者是处理清单。
- `npm run process:weekly` 只生成 `input.json` 与 `process-pack.md`，不再让 JS 自动写最终人读周报。
- Weekly Output 由 Codex 按 `output-requirements.md` 生成人读版，保留来源覆盖和候选判断。

### Memory

- 增加极薄 Memory 层：Weekly Output 经人工确认后，压缩进季度文件。
- 当前 Memory 文件为 `01_core/memory/2026-Q2.memory.md`。
- 每周 Memory 控制在 4-5 条，每条 20-30 字左右，最多 40 字。
- Memory 被纳入 Chat Pack 上下文编排，并默认高优先级，作为“过程记忆”跨周复用。

## 关键任务与项目推进

本周 Codex / Code X 最重要的工作不是单个页面，而是不断把边界调对：

- README 被压缩为项目内核，强调 `AI 效果 = Prompt × Context × Model × Feedback × Action`。
- Prompt 正文从代码配置中抽出，变成文件维护。
- Chat Pack UI 被多次减法：从多个按钮、领域地图、隐式默认，收敛为一个生成动作、显式推荐路径和可维护配置。
- Weekly Process 被多轮纠偏：先从候选分桶脚本变成人读报告，再从“AI 周回顾优先”撤回为“来源平等，内容主导”，最后确定脚本只做确定性 Process Pack。
- Input 的时间切片问题被识别，并用 weekly index 解决：内容目录按来源 / 主题组织，处理范围按周清单组织。
- Memory 从一周一个文件调整为季度聚合，避免长期记忆碎片化。
- 目录结构完成从旧 `道/法/input/output/code/assets` 到新 `01_core/03_input/04_output/app` 的迁移。

## 对 Learn-X 的意义

本周最关键的进展是：Learn-X 的“器”开始服从“道 / 法 / 术”的边界。

代码没有继续扩张成判断系统，而是退回到确定性自动化：扫描、清洗、索引、构建、校验。AI 则负责判断、取舍、压缩、改写。人保留最终价值判断权。

这让 Learn-X 更接近一个认知审稿台，而不是资料仓库、Prompt 仓库或自动分类器。

## 后续建议

### 必须做

- 固化一条真实周流程：准备 weekly index → 生成 process pack → Codex 写 Weekly Output → 人工勾选 → 更新 Memory。
- 给 `03_input/action/build/` 持续补行动证据，尤其是 Codex 构建、调试、失败和上线记录。
- 保持 `01_core/道`、`01_core/法` 的人工确认边界，不允许自动写入。

### 值得做

- 为 Chat Pack 增加更清晰的“当前任务态上下文包”：问题、假设、约束、证据、待验证点。
- 为 `learn-x-process` 增加“行动状态层”候选：本周实验、观察指标、失败标准、下次复盘时间。
- 给全局审计、领域研究、构建执行分别沉淀一版高质量小类 Prompt。

### 暂时不该做

- 不要做全自动入库。
- 不要把 Memory 做厚。
- 不要上数据库或复杂后台队列。
- 不要先追求复杂 UI；当前瓶颈仍是流程契约和内容质量。

## 当前最缺的东西

最缺的是稳定的行动证据，而不是更多上下文。

现在系统已经能整理、打包、复盘、压缩，但还需要更明确地记录：

- 本周真实构建了什么。
- 哪些判断被现实验证或证伪。
- 哪些功能减少了摩擦，哪些只是增加了复杂度。
- 哪些 AI 输出真正改变了下周行为。

## 下周优先级

1. 连续跑一轮完整周流程，并记录到 `03_input/action/build/`。
2. 用新 Chat Pack 做一次真实高价值对话，验证“对话类型 + 小类 Prompt + Memory 高优上下文”是否有效。
3. 给 `learn-x-process` 加一个轻量行动状态输出，不进入 `道/法`，只服务下周行动。
4. 检查目录迁移后的旧路径残留，特别是文档、脚本和静态图谱忽略规则。
5. 把本周 Codex Build 复盘作为 input build 材料，在下次 Weekly Output 中检验是否真的能促进行动。

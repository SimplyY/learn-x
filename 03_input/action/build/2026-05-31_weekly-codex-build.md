# 本周 Codex Build 复盘

生成时间：2026-05-31

## 来源与覆盖范围

本复盘覆盖 2026-05-24 至 2026-05-31。上次自动化已生成 `03_input/action/build/2026-05-27_weekly-codex-build.md`，所以本次重点关注 2026-05-27 之后的新变化，同时保留最近一周的主线。

可用来源：

- 项目上下文：`AGENTS.md`、`README.md`、`app/code/docs/FEAT.md`、`app/code/docs/TECH.md`。
- 核心认知边界：`01_core/道/`、`01_core/法/`、`01_core/memory/2026-Q2.memory.md`。
- Git 证据：主仓库 `ad21b54 v0.5`、`19ec7df v0.6`、`fff451b v0.8`，以及当前未提交改动；`app/code` 内嵌仓库的初始提交与当前未提交改动。
- 本地 Codex 会话：`~/.codex/sessions/2026/05/26/`、`2026/05/27/`、`2026/05/28/`、`2026/05/31/`，以及可读 archived sessions。
- 产物证据：`03_input/action/build/2026-05-27_weekly-codex-build.md`、`04_output/weekly/2026-22.md`、`04_output/_dist/2026-W22/`、`00_config/chatpack.config.json`、`02_prompts/chatpack/`、`.agents/skills/learn-x-process/`。

不可用或不完整来源：

- 无法确认是否覆盖所有 ChatGPT、Code X、Chrome、手机端、外部 IDE 或未保存的对话。
- 部分 Codex 会话包含中断、审批转录或长上下文截断，本文只纳入能与本地文件和 Git 状态互相印证的内容。
- 当前工作区有未提交改动，其中 `01_core/道/` 有人工内容变更痕迹；本复盘只记录存在，不替用户解释或改写其思想内容。

## 本周最核心事项

1. Learn-X 的核心定位进一步稳定为“认知审稿台”：不是资料仓库，也不是全自动判断器，而是把输入、行动、反馈和记忆压缩成可审计判断。
2. Chat Pack 类型体系继续收敛：大类定目标，子类型定场景，增强器定思考方式，Context 提供材料；Prompt 不再作为主要用户入口。
3. Prompt 资产从“配置字段 + 代码入口”转向“文件即正文、ID 即路径”的约定体系，减少未来维护成本。
4. Weekly Process 做了重要减法：行动闭环检查并入做中学复盘，图谱、Prompt、Skill、写作、Demo 不再作为固定周报模块。
5. 本周真实瓶颈从“能不能生成”转向“生成后是否进入行动证据、log、自我反馈和下一周行为”。

## 核心功能与系统变化

### Chat Pack 类型体系

- `00_config/chatpack.config.json` 已形成 5 个入口：学习洞察、判断决策自省、创造执行、画图生成、其他提示词。
- 新增或强化 `other-prompts`，把空提示词、芒格之魂这类常用但不属于主流程的 Prompt 收到低维护区。
- 创造执行新增 `create-execute.meta-prompt`，用于把原始需求压缩成可交给 AI 或 Codex 执行的高质量 Prompt。
- 增强器扩展为两类：思考增强器（问清问题、多思考一步、现实验证、挑战观点）和长度增强器（200 / 500 / 1000 / 2000 字）。
- 领域研究、系统审计、道法术器审计、广义投资决策等推荐上下文继续显式维护，避免隐式黑箱。

### Prompt 资产

- `02_prompts/chatpack/` 下的核心提示词被系统性重写或扩充：读书解码、AI 私教、领域研究、系统审计、道法术器审计、Codex 构建、提示词重构等。
- `book-decode.md` 明显从普通读书总结升级为“X 光阅读法”：强调问题意识、精神结构、未说出口的前提和作者盲点。
- 长度增强器把“输出多长”从临时口头要求变成可复用 Prompt 资产。
- `challenge-assumption.md` 补上了反方审稿人能力，直接服务 Learn-X 防止 AI 迎合和自我叙事闭环。

### Weekly Process

- `learn-x-process` 的输出规则继续做减法：周报默认围绕核心问题、做中学复盘、下周 3 件事、道 / 法 / 术、处理信息。
- 行动闭环检查不再单独成节，而是并入做中学复盘，避免报告机械分桶。
- `04_output/weekly/2026-22.md` 已被压缩成更短、更像人工审核材料的版本，保留来源、行动评分和最小下周动作。
- `01_core/memory/2026-Q2.memory.md` 已沉淀本周极薄 Memory：认知审稿台、周报成功标准、Process 边界、教育创业约束、内在积分牌。

### 工程与仓库状态

- 主仓库最近一周有 `v0.5`、`v0.6`、`v0.8` 三个提交，完成从初始实现、目录重构到 Chat Pack 类型体系升级。
- `app/code` 是内嵌 Git 仓库，已有初始提交，但当前存在大量未提交改动；主仓库也显示 `app/code` 为 modified。
- 当前工作区还有未提交的 Prompt、Skill、Weekly Output、`chatpack.config.json`、图片资产和 `01_core/道/` 变更；这些应在下一次提交前明确归属。
- 两个 PDF 在 `99_archive/00_mine/output-pdfs/` 中显示删除，属于归档材料变动，未纳入本周核心建设判断。

## 关键任务与项目推进

- 建立了“每周 Codex Build 复盘”自动化，并将其产物放入 `03_input/action/build/`，让 Codex 构建本身成为行动证据。
- 发现 `action/build` 进入 Weekly Output 的问题，并推动 Weekly Process 从纯 mtime / manifest 思路转向 index + 自动候选的混合选择。
- 将用户对 Prompt 文件的真实维护需求推进成 Chat Pack 的设计原则：用户维护 Markdown，配置维护元数据，构建期读取并装配。
- 对 `learn-x-process` 做了多轮边界校准：脚本只做搬运、清洗、去重、索引；AI 做判断草稿；人确认是否进入 Memory 或道法资产。
- 用真实 Chat Pack 请求推进了 meta-prompt、长度控制、挑战观点、芒格之魂等高频 Prompt 资产。

## 对 Learn-X 的意义

本周最重要的进展不是多了几个 Prompt，而是 Learn-X 开始形成“工具使用的反身性”：Codex 不只是写代码，也被记录为行动来源；Chat Pack 不只是调用 AI，也在反过来定义什么样的问题值得被问；Weekly Process 不只是总结一周，也在检查判断有没有进入行动。

这符合 Learn-X 的核心边界：道和法不被工具自动改写，术和器持续降低摩擦，行动证据决定哪些洞察有资格继续沉淀。

## 后续建议

### 必须做

- 先清理当前工作区状态：区分用户亲自改的 `01_core/道/`、Prompt 资产、Weekly Output、`app/code` 变更，再决定是否分批提交。
- 下周补 `03_input/log/weekly/`，否则 Weekly Output 会继续缺少自我反馈，只能从行动和输入推断。
- 给 `app/code` 内嵌 Git 仓库做一次明确决策：保留为子仓库、转为普通目录，或规范提交方式；否则主仓库状态会长期不清晰。
- 每周继续写入 `03_input/action/build/`，但只记录真正影响 Learn-X 架构、流程、Prompt 资产和学习闭环的 Codex 工作。

### 值得做

- 为 Chat Pack 增加一次端到端验收：任选一个真实问题，使用大类 + 子类型 + 增强器 + Memory，检查输出是否真的优于普通提问。
- 给 Prompt 资产建立轻量审核清单：是否有明确使用场景、是否和大类重复、是否可删除、是否需要现实验证。
- 让 Weekly Output 的“下周 3 件事”在下周复盘中被逐条检查，形成行为闭环，而不是只生成漂亮建议。
- 把“挑战观点”作为高风险判断的默认增强器之一，用于资产、创业、健康、关系等主题。

### 暂时不该做

- 不要继续扩张大类数量；`other-prompts` 已足够承接长尾。
- 不要把 Weekly Process 做成自动入库系统；当前价值在人工审核，而不是自动判断。
- 不要为了 prompt 库完整性批量生成大量小类；只沉淀被真实对话反复使用的入口。
- 不要急着引入数据库、RAG、多 Agent 或复杂后端；当前瓶颈仍是输入质量、行动证据和人工确认。

## 当前最缺的东西

最缺的是“验证记录”，不是“生成能力”。

现在 Learn-X 已经能生成 Chat Pack、周报、Process Pack、Memory 候选和 Codex Build 复盘，但还缺少三类证据：

- Chat Pack 生成后的真实对话质量对比。
- Prompt 资产被反复调用后的保留 / 删除判断。
- Weekly Output 的下周行动是否被完成、证伪或修正。

没有这些验证，系统会越来越会“整理自己”，但不一定越来越会改变现实行为。

## 下周优先级

1. 提交前做一次变更审计，尤其是 `01_core/道/`、`02_prompts/chatpack/`、`app/code` 和归档 PDF 删除。
2. 用 `create-execute.meta-prompt` 生成一次真实 Codex 任务，并记录结果到 `03_input/action/build/`。
3. 用 `learning-insight.book-decode` 重写一篇读书笔记，必须包含复述、反驳、行动。
4. 新增一条 `03_input/log/weekly/2026-22.review.md` 或下周对应 review，补齐自我反馈。
5. 复盘 `04_output/weekly/2026-22.md` 中的 3 个下周动作，明确完成、放弃或调整。

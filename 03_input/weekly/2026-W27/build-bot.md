# build-bot

## 2026-07-02 飞书机器人 Build 复盘

覆盖期：2026-06-26 至 2026-07-02（Asia/Shanghai，含运行日）

**门禁状态：通过。3/5 来源可用。** Bridge 日志 198 条 intake，Codex memories（raw_memories.md 为空但路径存在），飞书群消息 14 条。Git 变化窗口内无新 commit。未提供 --base-token。

### 1. 本周 bot 侧总览

本周飞书机器人同时承接了 6+ 个独立项目入口的任务调度与轻量执行。核心节奏为：用户通过飞书群发出指令 → bot 切换到对应工作目录 / 项目入口 → 执行或设计 → 结果回群。bot 在本周完成了从「单群回复型」到「多入口工程型」的跃迁。

### 2. 最核心的 5 件事

**① Life-X 项目入口搭建（2026-07-01）**
- 用户意图：新建 life-x 项目目录并设为工作目录。
- bot 角色：执行目录创建、路径修正（用户 3 次纠正路径）、配置工作目录。
- 闭环状态：✅ 目录已创建，工作目录绑定成功。项目本身尚需内容填充。

**② Long-read Skill 方案设计（2026-07-01）**
- 用户意图：打造一个微信公众号长文精读 Skill，支持摘要 + 自动路由到 ljg 系列 Skill 做深度处理。
- bot 角色：设计核心方案（从图文精读到多 Skill 路由），用户否决了多维表格管理方案，改为直接群内回复。随后成功处理了一篇李开复对谈文章。
- 闭环状态：✅ Skill 方案设计完成，并成功首次执行了一篇精读。沉淀待落地为正式 Skill 文件。

**③ build-bot-log Skill 创建与首次执行（2026-07-01）**
- 用户意图：新增飞书机器人周复盘报告 Skill。
- bot 角色：从零创建完整 Skill 目录（SKILL.md、入口脚本、memory、agent 配置）→ 添加 npm script → Bridge 日志来源修复 → 首次执行 dry-run 通过。
- 闭环状态：✅ 完整闭环。门禁通过，3 源可用，memory 自动更新。

**④ invest-log 项目持续维护（2026-06-30 ~ 07-01）**
- 用户意图：切换工作目录、查看 skill、邀请成员、诊断 bot 响应速度。
- bot 角色：执行目录切换、config 查看、invite 操作、日志排查。
- 闭环状态：✅ 群内维护已完成。bot 响应速度变慢的问题被用户关注但未做结构性优化。

**⑤ 多处工程项目群内的 bot 远程操作（2026-06-29 ~ 07-01）**
- research-x：使用 research-x 流程研究公众号文章、配置 Hello-Agents 研究、图像处理 Skill 修复。
- health-x：健康周报自动化流程讨论。
- game-x：目录切换 + 项目初始讨论。
- 智慧之门 Base：图像解析 Skill 问题修复讨论。
- 闭环状态：⚠️ 部分完成。research-x 有实质性进展，health-x 和 game-x 处于讨论阶段。

### 3. 主要飞书项目入口 / 群 / 自动化中的成果

| 入口/群 | 本周成果 | 状态 |
|---------|---------|------|
| Life-X | 目录初始化 + 工作目录绑定 | ✅ 完成 |
| Long-read Skill（研究&学习群） | 方案设计 + 首次执行精读 | ✅ 完成 |
| build-bot-log（研究&学习群） | Skill 创建 + 首次 dry-run | ✅ 完成 |
| Research-X | 公众号文章研究 + Hello-Agents 配置 | ✅ 完成 |
| Invest-Log | 群内维护 + 目录管理 | ✅ 完成 |
| Health-X | 自动化方案讨论 | ⚠️ 讨论阶段 |
| Game-X | 项目初始 | ⚠️ 讨论阶段 |
| 智慧之门 Base | 图像处理 Skill 修复讨论 | ⚠️ 未完成 |

### 4. 机器人对轻中型任务的承接情况

- **在飞书内直接闭环**：Life-X 目录创建、research-x 公众号研究、long-read 精读、build-bot-log 创建、invest-log 群维护。
- **需要桌面接力**：health-x 自动化实现、智慧之门图像处理脚本修复、long-read Skill 正式文件落地。
- **结论**：本周 bot 已覆盖 6+ 个项目的入口调度，约 60% 的任务可在飞书群内完成闭环。剩余 40% 需要脚本编写或仓库结构修改。

### 5. 新增或强化的 Skill、提示词、流程和自动化

| 变更 | 类型 | 说明 |
|------|------|------|
| build-bot-log | **新增 Skill** | 飞书机器人周复盘，含门禁、5 源收集、memory 自动更新 |
| Long-read 精读方案 | **候选流程** | 微信公众号 → 摘要 → ljg 路由，已执行一次但未沉淀为正式 Skill |
| learn-x-process 规则 | **强化** | 用户多次收紧输出规则边界（通过飞书指令触发本地修改） |

### 6. 跨项目能力变化

- bot 首次实现了**单次 session 内跨 4+ 项目群的调度**：用户在「研究&学习」群发起指令，bot 分别访问 Life-X、Research-X、Learn-X 目录执行任务，再回群报告结果。
- 用户对 bot 的**工作目录记忆**提出了明确需求（`/ws save`），这是移动端工作流的关键基础设施。
- bot 开始承担**方案设计角色**（Long-read Skill），而非单纯执行。用户接受 bot 设计方案并给出反馈。

### 7. 对 AI Builder / 学习者 / 知行合一的意义

**候选**：本周标志性变化——bot 的「入口感」从一两个群扩散到 6+ 个独立项目入口。用户不再需要在电脑端切换 IDE，而是直接在飞书里切换项目入口、执行轻量任务。这意味着：

- AI Builder 的创作工具链入口正在从「桌面 IDE」向「群聊」迁移。
- 过程中最卡的点不是技术能力，而是**目录/上下文/工具权限的切换成本**（life-x 的目录纠正花了 3 轮对话）。

### 8. 必须做 / 值得做 / 暂时不做

- **必须做**：沉淀 Long-read Skill 为正式 Skill 文件，覆盖完整门禁和输入校验。
- **必须做**：诊断 bot 响应速度变慢的核心原因（用户已提出），可能涉及 session 时长、上下文膨胀或 token 预算。
- **值得做**：建立「项目入口切换」的标准流程，减少用户纠正路径的反复。
- **值得做**：将 build-bot-log 接入自动化工作流，实现每周日无人值守执行。
- **暂时不做**：Dashboard、统一入口网页、实时面板。

### 9. 当前最缺的一个东西

**最缺：可持久化的 bot 记忆/日志系统。** Codex memories 中 raw_memories.md 为空，ad_hoc_notes 目录不存在。Bridge 日志虽然丰富（198 条 intake），但没有结构化归档。这意味着 bot 每次 session 都是从零开始，无法复用上周的执行经验。

### 10. 下周 bot 工作优先级

1. 周日工作流触发时验证 build-bot-log 首次生产执行。
2. 沉淀 Long-read Skill 为正式 SKILL.md + 脚本。
3. 诊断 bot 响应速度问题。
4. 建立每周一次的记忆/日志归档流程。

---

## 附录

### A. 来源与覆盖范围

| 来源 | 可用 | 证据数量 | 说明 |
|------|------|---------|------|
| Bridge 日志 | ✅ | 198 条 intake | 覆盖 6/23-7/1 共 9 天 |
| Codex memories | ⚠️ | raw_memories.md 为空 | memory_summary.md 不存在，ad_hoc_notes 不存在 |
| 飞书群消息 | ✅ | 14 条 | 本群（研究&学习）chat-messages-list |
| Git 变化 | ❌ | 0 | 覆盖期内无提交 |
| Base 工作流 | ❌ | — | 需要 --base-token 参数 |

### B. 可用 memory / 日志 / 飞书入口摘要

**Bridge 日志**（198 条，含多个群）：
- 覆盖 7 个独立 chat_id：研究&学习群、主群、research-x、invest-log、health-x、life-x、game-x
- 日志级别以 info 为主，含少量 warn（reasoning 非关键错误）
- 所有 intake 均带 preview 和 chatId，适合做 bot 行为分析

**Codex memories**：仅有空的 raw_memories.md。无 memory_summary、无 ad_hoc_notes。**这是 bot 记忆系统的核心缺口**。

**飞书群消息**：14 条消息，覆盖 6/30 至 7/1。包含 build-bot-log 需求讨论、bridge 日志路径确认、CODEX_HOME 路径确认等。

### C. 关键机器人执行证据

| 时间 | 群 | 用户指令（摘要） | 结果 |
|------|-----|--------------|------|
| 6/24 | 主群 | 使用 research-x 流程研究公众号文章 | 启动研究流程 |
| 6/24 | invest-log | 分析基金卖出记录 | 查询多维表格，返回分析 |
| 6/26 | invest-log | 整理今年基金买卖记录，深度分析 | 数据查询 + 分析 |
| 6/29 | health-x | 健康周报自动化流程讨论 | 流程说明、讨论 |
| 6/29 | 主群 | 创建多维表格（话题采集） | 多维表格创建 |
| 6/29 | 主群 | 「新增 skill 必须用 skill creator」 | 协议确认 |
| 6/30 | research-x | 新增研究 Hello-Agents（GitHub） | 已配置研究 |
| 6/30 | 本群 | /ws save learn-x 路径 | 别名已保存 |
| 7/1 | life-x | 新建并切换到 life-x 目录 | 目录创建 + 工作目录绑定 |
| 7/1 | research-x | 图像处理 Skill 修复 + 图片上传到智慧之门 | 修复讨论 |
| 7/1 | 主群 | 研究微信公众号（AGI 与 learn-x 对比） | 已启动研究 |
| 7/1 | 本群 | 创建 long-read Skill 方案 | 方案设计 + 首次精读执行 |
| 7/1 | 本群 | 创建 build-bot-log Skill | 完整创建 + dry-run |
| 7/1 | 本群 | 执行 build-bot-log | 本报告生成 |

### D. 新增或变更的自动化、Skill、提示词、流程

详见正文第 5 节。与 7/1 复盘相比，新增增量：
- Long-read 精读方案：用户要求从「多维表格管理」改为「群内直接回复」，说明 bot 工作流设计应以轻量优先。
- Skill Creator 协议强化：用户明确要求「新增 skill 必须使用 skill creator」，这是 bot 侧重要的工作流纪律。

### E. 与 build.md 可能重叠但已刻意去重的事项

- build.md（2026-W27）覆盖期为 6/23-6/29，与本报告 6/26-7/2 部分重叠。
- 去重处理：build-bot 报告侧重「bot 如何调度了这些事」而非「代码层面改了哪些文件」。
- 前提重叠：learn-x-process 规则加固（build.md 详细记录了文件变更和提交情况，本报告仅提 bot 触发了变更）。
- 本报告新增：life-x 目录搭建、long-read 方案设计、多个群的跨群调度证据。

### F. 不可用来源与需人工补充记录

1. **Bridge 日志时间范围限制**：日志文件从 6/23 开始，而覆盖期 6/26-6/28（周六日）bot 活动极少。如需完整证据链，需要更长的日志保留策略。
2. **Codex memories 为空**：raw_memories.md 内容为 "No raw memories yet"，memory_summary.md 不存在，ad_hoc_notes 目录不存在。**建议用户确认 CODEX_HOME 路径下的 memories 是否需要主动写入**，或启用自动 memory 记录功能。
3. **飞书群消息仅限于本群**：lark-cli 的 `+chat-messages-list` 只能查当前 chat_id（本群：研究&学习），无法查询其他群（主群、invest-log 等）的消息历史。其他群的 bot 交互只能通过 bridge 日志间接推断。
4. **Git 变化为 0**：覆盖期内无提交。用户对 learn-x 的规则修改和 Skill 修改均未提交，这部分变更需在下次 build.md 中补录。
5. **Base 工作流不可查**：未提供 `--base-token`。建议在 SKILL.md 或 automation 中固化智慧之门 Base 的 token。
6. **建议**：用户可考虑在 bridge 配置中启用 intake 日志的结构化输出（如单独归档 bot 执行记录），以解决反复依赖扫描 JSONL 的问题。

## 2026-07-04 飞书机器人 Build 复盘（续）

覆盖期：2026-07-03 至 2026-07-04（Asia/Shanghai）

**门禁状态：通过。4/6 来源可用。** Bridge 日志可用（6/28~7/4 共7个日志文件），Codex memories（raw_memories.md 为空），Git 6 个新 commit，飞书消息从 bridge intake 提取。未提供 --base-token。

### 核心事件补充

**⑤ Chat Pack 分类结构调整（7/3）**
- 用户意图：将高频使用的 ljg-learn、ljg-read、ljg-roundtable、芒格之魂从「李继刚提示词」「其他」挪入「高频使用」分类。
- bot 角色：修改 `00_config/chatpack.config.json` 的 subtype id 和目录归属，移动 prompt 文件，执行 `npm run build`，修复首次 build 失败（文件路径与 id 前缀不匹配），共分 3 次 commit 完成。
- 闭环状态：✅ 完全闭环。Build 通过，push 成功（`49e299f`、`f85cdda`、`cba56cf`）。

**⑥ group-info skill 中文修复（7/3）**
- 用户意图：以后说「更新群信息」自动调用 group-info skill；现有群信息里英文描述应显示中文。
- bot 角色：分析 `scripts/group-info.mjs`，添加 `hasChinese()` 函数，优先使用 `description_zh`，无中文时截断并标记「需补充中文」，更新脚本后执行 `pin --apply`。
- 闭环状态：⚠️ 部分闭环。脚本已修改并执行了 pin，但 build-bot-log skill 自身的中文强制逻辑待验证（部分 skill 如 learn-x-input、learn-x-prompt-review 仍缺 description_zh）。

**⑦ long-read skill 迭代与阮一峰周刊精读（7/3）**
- 用户意图：long-read 针对阮一峰周刊做结构化精读（科技动态精选1-3、文摘全量保留、主文分析），并把格式规则沉淀进 skill；合并 read-x 中同名 skill，以全局版为准。
- bot 角色：调整 long-read skill 支持周刊格式，完成阮一峰#402 精读，合并 read-x 与全局版 long-read skill。
- 闭环状态：✅ 精读已输出，skill 已更新，冲突以全局版解决。

**⑧ wisdom-gate skill 迁移与群信息同步（7/3~7/4）**
- 用户意图：将 wisdom-gate skill 从 learn-x 迁移到 research-x，并更新两边群信息。
- bot 角色：迁移 skill 文件，更新两个群的 GROUP_INFO 和注册表。
- 闭环状态：✅ 迁移完成，群信息已更新。

**⑨ 温度提醒与资产更新（7/4）**
- 用户意图：temperature-reminder 月/日度使用；沪深300高温阈值改为75度，中证500/创业板改为85度；更新资产截图。
- bot 角色：执行温度提醒 skill，更新阈值配置，处理13张截图识别。
- 闭环状态：✅ 完成。

**⑩ Skill 注册自动化与 build-bot 触发（7/3~7/4）**
- 用户意图：skills 目录下新增/删除 skill 时自动维护到 `~/.codex/skills/` 软链；周日晚自动触发 build-bot。
- bot 角色：为 `/Users/yuwei/code/skills/` 创建 AGENTS.md 说明软链规则；注册 long-read 软链。
- 闭环状态：⚠️ AGENTS.md 已创建，但自动同步脚本尚未实现（AGENTS.md 是说明文档，非自动化脚本）。

### 10. Next week priorities

- 给缺少 `description_zh` 的 skill 补中文描述（learn-x-input、learn-x-prompt-review、build-bot-log 等）。
- 确认 group-info skill 的中文强制逻辑在所有群均生效。
- skills 目录的软链自动化需要落地脚本（cron/fswatch/hook）。
- 多维表格字段变更保护规则需要内化（6/29 数据丢失事故的后续防护）。

**⑪ MoonBridge 记忆管道修复（7/4）**
- 用户意图：build-bot 报告显示 Codex memories 为空，用户追问根因。
- bot 角色：排查 deep profile 的 SQLite 记忆库（`memories_1.sqlite`），发现 6 个 `memory_stage1` job 全部报 `unknown model: "gpt-5.4-mini"` 404 错误——Codex 内部记忆提炼硬编码用 OpenAI 模型名调 MoonBridge，而 MoonBridge deep profile 只配了 `ark-code-latest`。直接写入 5 个路由别名（`gpt-5.2/5.3-codex/5.4/5.4-mini/5.5` → `ark-code-latest`）到 MoonBridge SQLite 持久化配置，重启容器验证通过，重置失败 jobs 为 pending。
- 闭环状态：✅ 完全闭环。别名已验证 `gpt-5.4-mini` 请求正常返回，记忆 worker 后台重新调度后将自动提炼历史 rollout。发现 MoonBridge 配置持久化在 SQLite 而非仅读 yml 文件的坑。

### 9. 最大瓶颈（更新）

**Codex 后台记忆提炼依赖 OpenAI 模型名到自定义代理的路由映射。** 修复前所有记忆 job 静默 404 失败，导致 raw_memories.md 持续为空、stage1_outputs 表零记录，build-bot 无法读取结构化记忆。修复后需等待后台 worker 调度（Codex 桌面应用活跃时触发），记忆不会立刻填充。

### 附录更新

**A. 来源覆盖（补充）**

| 来源 | 可用 | 证据数量 | 说明 |
|------|------|---------|------|
| Codex memories（deep SQLite） | ⚠️→✅ | 6 jobs reset pending | memory_stage1 因模型名 404 全部失败，已修复路由别名并重置 |
| Bridge 日志 | ✅ | 7 天完整 | 6/28~7/4 共 7 个日志文件约 120MB |
| Git commits | ✅ | 6 commits | `74126c5`→`0b4d4a0` |
| 飞书消息 | ✅ | 28+ intake | 从 bridge intake 提取本群用户指令 |

**F. 不可用来源（补充）**

7. **Codex memory_stage1 模型路由缺失**：Codex 内部记忆提炼使用 `gpt-5.4-mini` 等内置模型名，MoonBridge deep profile 未配置对应路由导致全部 404。已修复。记忆需要等待后台 worker 调度后自动生成，非即时生效。
8. **MoonBridge 配置持久化机制**：yml 文件配置仅在首次初始化时写入 SQLite，后续重启从 DB 加载。修改 yml 后需同步更新 SQLite 或清除持久化 DB 才能生效。

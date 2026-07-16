## 2026-07-12 飞书机器人 Build 复盘

### 1. Weekly bot overview

本周机器人高强度运行，5 天共 1492 次消息摄入（7/6-7 无日志，bridge 未运行）。核心主题是「基础设施修复 + 群信息体系重构」，从记忆管线根因排查到 Group Info 双向同步，几乎每天都有跨 Skill 的重构。

### 2. Top 3–5 items

**① 记忆管线全链路诊断与修复（7/8）**
用户意图：确认记忆功能是否修好。机器人经历了从模型路由排查 → MoonBridge 配置修复 → app-server 重启 → 桌面版误判修正的完整链条。最终定位：deep profile 的 app-server 由 bridge 管理，但未被正确拉起，导致 memory worker 从未调度。同轮还完成了 bot.md 架构文档创建。

**② Group Info 体系重构（7/9-10）**
用户意图：群信息更新不应打扰沉寂群，且需要全局汇总。机器人实现了：群聊活跃度检测（跳过两天无新消息的群）、/new 消息过滤（最近三条有 /new 则跳过）、上下文压缩阈值调整至 20 万 token。同时将 Group Info 同步逻辑内化到 group-info Skill 自身。

**③ 群标签链接双向同步（7/11）**
用户意图：群标签（管理标签页中的链接）应与 GROUP_INFO 双向同步，减少手动维护。机器人调研飞书群标签 API，实现了脚本化同步，并接入了 group-info Skill 的自动化流程。覆盖 10 个仓库的存量数据迁移。

**④ Skill 批量重命名与卡片化（7/12）**
用户意图：newold/newall 名称混乱，改为 ywnew/ywnewold/ywnewall。同时将即刻链接分享从纯文本改为卡片形式展示。机器人完成了 Skill 文件重命名、description 更新、即刻卡片改造。

**⑤ Monthly Process 架构重构（7/11）**
用户意图：月度输入处理流程太重。机器人将流程拆分为「确定性脚本（数据采集/清洗）」+「Codex 语义压缩（提炼/总结）」，新增 monthly-process-input Skill，降低维护面和 token 消耗。

### 3. Per-entry outcomes

- **learn-x**：Monthly Process 重构（3 个 Skill 新增/更新）、app.js 模块化拆分（chatpack/context/runtime/editor）
- **lark-channel-bridge**：bot.md 架构文档创建、README.zh.md 引用更新
- **skills**：ywnew 系列重命名、quick-cd 新建、group-info 同步逻辑增强、wisdom-gate 多图支持
- **投资**：黄金持仓查询、指数加减仓汇总（轻量查询，手机完成）

### 4. Light-task offload

全部任务通过手机飞书完成，无需桌面 Codex 介入。包括：
- 黄金持仓查询、投资品净值计算（手机即可）
- 群名修改、Skill 重命名、Group Info 批量更新（机器人直接操作）
- 记忆管线诊断（虽复杂但机器人全程驱动，用户只发指令）

需要接力桌面 Codex 的任务：无。本周全部任务在手机端闭环。

### 5. Skill / prompt / workflow changes

| 变更 | Skill | 类型 |
|------|-------|------|
| 拆分月度处理为脚本+语义压缩 | learn-x-monthly-automation, monthly-process-input | 重构 |
| 月记从日记/周记补全，不覆盖已有 | learn-x-monthly-journal | 更新 |
| 飞书日记/周记走 CLI，Flomo 走 CDP | learn-x-weekly-automation | 更新 |
| 多图支持 + --title | wisdom-gate | 增强 |
| 删除 | learn-x-prompt-review | 废弃 |
| 群活跃度检测 + /new 过滤 | group-info | 增强 |
| 群标签链接双向同步 | group-info | 新增 |
| newold → ywnew 系列 | ywnew, create-agents-md | 重命名 |
| 模糊匹配快速切换仓库 | quick-cd | 新建 |
| 即刻链接卡片化展示 | lark-im（隐式） | 增强 |

### 6. Cross-project capability shifts

- **group-info** 从单一仓库的 GROUP_INFO.md 生成，升级为「群信息全生命周期管理」：活跃度检测、标签同步、飞书文档汇总、卡片推送。能力可复用到所有注册仓库。
- **quick-cd** 打通了飞书群 → 本地 Code 目录的模糊路径切换，缩短了手机发起桌面任务的路径。
- **记忆管线诊断经验** 沉淀为 deep-memory-health.sh 脚本和记忆摘要中的诊断条目，后续同类问题可快速定位。

### 7. AI Builder / learner significance

本周是「系统自愈」的一周。记忆管线从 404 → JSON 解析失败 → 超时 → 静默失败，每一步都暴露了分布式系统（bridge → app-server → MoonBridge → 火山引擎）的脆弱点。机器人没有逃避复杂诊断，而是逐层排查，最终定位到 app-server 未拉起这一简单但隐蔽的根因。

另一个信号：群信息体系从「被动记录」升级为「主动感知」。群活跃度检测、标签同步、飞书文档汇总，都是让系统替用户操心，而不是让用户操心系统。

### 8. Must do / Worth doing / Skip

- **Must do**：确认 deep profile app-server 正常拉起，记忆管线持续产出（当前 stage1_outputs 仍为空）
- **Worth doing**：群标签同步的定时自动化（目前依赖手动触发）
- **Skip**：不要为群信息体系加网页控制台或统一面板——飞书群 + 飞书文档已经够用

### 9. Biggest bottleneck

**记忆管线不可靠。** deep profile 的 app-server 容易被重启/进程退出打断，且缺乏健康检查。memory worker 调度周期长、静默失败无告警，导致用户不确定记忆是否在积累。这是机器人长期价值的基础设施，优先级最高。

### 10. Next week bot priorities

1. 确保记忆管线稳定运行，验证 stage1_outputs 有持续产出
2. 群标签同步加入定时触发（或 group-info 更新时自动触发）
3. 测试 quick-cd 在飞书群中的实际使用体验
4. 关注 bridge 7/6-7 断连原因，防止再次出现日志空白

---

### Appendix

#### A. Source coverage table

| 数据源 | 状态 | 详情 |
|--------|------|------|
| Bridge 日志 | 部分可用 | 7/8-12 有日志（1492 条 intake），7/6-7 缺失 |
| Codex 记忆 | 可用 | memory_summary.md (5.5KB)、MEMORY.md (10.9KB)，最后更新 7/9 |
| 飞书消息搜索 | 可用 | @机器人搜索为空，fallback 到 chat-messages-list，50 条/页，7/8-12 有记录 |
| Git 变更 | 可用 | 10 个 commit，涉及 learn-x 和多个 Skill |
| Base workflow | 未检查 | 本次未触发 Base 工作流查询 |
| 现有 build.md | 不存在 | 2026-W28 目录首次创建 |

#### B. Available memory / log summary

记忆内容：lark-channel-bridge 核心架构、手机优先工作流、Skill 沉淀边界、飞书执行边界、deep profile 运行事实。7/9 写入，距今 3 天。Bridge 日志 7/8-12 共 5 天，7/6-7 缺失（bridge 可能在电脑重启后未自动拉起）。

#### C. Key bot execution evidence

| 时间 | 指令 | 结果 |
|------|------|------|
| 7/8 12:38 | 「你有什么功能」 | 功能列表回复 |
| 7/8 13:17 | 「记忆功能是不是修好了」 | 全链路诊断，定位 app-server 未拉起 |
| 7/8 15:32 | 「梳理飞书机器人架构，写 bot.md」 | bot.md 创建 + README 引用更新 |
| 7/9 | 「智慧之门」飞书文档学习 | 执行 wisdom-gate Skill |
| 7/9 | 「群名改了，仓库名路径也改」 | 仓库重命名 + Group Info 重新生成 |
| 7/10 | 「neat-all 优化，跳过沉寂群」 | group-info 活跃度检测逻辑 |
| 7/10 | 「上下文压缩改成 20 万」 | bridge 配置更新 |
| 7/11 | 「群标签链接调研」 | 飞书群标签 API 调研 + 同步脚本 |
| 7/12 | 「newold 改成 ywnew」 | Skill 批量重命名 |
| 7/12 | 「即刻链接用卡片展示」 | 卡片化改造 |

#### D. Automation / Skill / prompt changes this week

详见第 5 节表格。共 10 项 Skill 变更（3 新建/重构、4 更新、1 废弃、2 重命名）。

#### E. Dedup from build.md

build.md 不存在（本周目录首次创建），无重复内容。

#### F. Unavailable sources + manual supplement needed

- 7/6-7 bridge 日志缺失：需确认 bridge 是否在电脑重启后自动拉起，或手动补充那两天的机器人活动（如有）
- Base workflow 未检查：本次未触发，下次建议检查定时任务执行记录
- 飞书 @消息搜索为空：因 bridge 日志中 intake 记录显示用户实际通过发消息（非 @）触发机器人，搜索范围已通过 chat-messages-list 覆盖

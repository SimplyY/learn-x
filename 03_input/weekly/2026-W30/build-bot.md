## 2026-07-26 飞书机器人 Build 复盘

覆盖期：2026-07-20 至 2026-07-26（Asia/Shanghai）。证据源：bridge logs（7 天齐全，507 条 intake）、learn-x / read-x / skills / lark-channel-bridge 四仓库 git log、Codex memories（memory_summary.md 停在 07-09，raw_memories.md 为空）。

### 1. Weekly bot overview

机器人本周节奏前低后高，7 天 507 条用户消息摄入（7/20 单日 212 条峰值，7/26 仅 30 条收尾）。主线是「read-x 评分系统 v3 重构 + global-governance 编排器化 + ywnext/ywnew 执行稳定性强化 + problem-audit 统一门禁」，几乎每个主线都伴随"从第一性原理出发"的根因定位和多轮对抗性审查。

### 2. Top 3-5 items

**① read-x content-scoring v3 评分系统重构（7/23-7/26，本周最大工程）**
用户意图：评分要可信、可解释、不凭感觉。从 7/23 多群质疑"评分怎么算的"、"要从第一性原理作为领域专家评判"、"主领域和次领域专家动态生成"开始，机器人完成 read-x 仓库 9 个 commit：content-scoring v3 重构（四维质量 + 独立相关性 + 确定性路由）-> 评分权重重校准 -> 六维度展示 -> long-read 重构为隔离编排器 -> 卡片路由改私聊触发者 -> 公开前清理敏感文件重写 README。闭环：是，且做了公开前安全清理。

**② global-governance 重构为分布式多阶段编排器（7/21-7/24）**
用户意图：群规则治理要可执行、有证据。机器人完成 skills 仓库重构：global-governance 从单 skill 升级为分布式多阶段编排器，加热点/依赖图/趋势审计；skill-thinking 加膨胀检测（P0-P3 + 治理方案）。闭环：是。

**③ ywnext / ywnew 执行稳定性强化（7/21-7/24）**
用户意图：批量群发要可靠、不漏发、不误发。从 7/21 用户诊断 newold"没发、所有群发、串行发"开始，机器人完成：ywnew 分批并行发送 + 回读验证 + 80% 硬阈值 + 对抗性自测场景 5-8；ywnext 增加环境推断（季节/时段/天气标签）+ 日记明日规划软素材。闭环：是，含对抗性自测。

**④ problem-audit 统一问题审计迁移 + Deep 门禁升级（贯穿全周）**
用户意图：问题记录要有统一台账、门禁要硬。机器人完成：skill-change-audit -> problem-audit 统一迁移；lark-channel-bridge Deep 门禁升级 problem-audit 桥接适配；追加 W30 问题台账 4 条 PA 记录（read-x 评分/卡片/附录）。闭环：是，Deep 门禁已生效。

**⑤ lark-channel-bridge 稳定性 + 投资查询身份修复（7/20-7/22）**
用户意图：bridge 流式反馈体验 + 机器人身份发文。机器人完成：模型卡片支持流式进度更新 + codex argv fixes；bind externally created chats to workspaces（外部创建群绑定工作区）；投资查询/评分卡路由改私聊触发者（解决"以用户身份发文"问题）。闭环：是。

### 3. Per-entry outcomes

- **read-x**：content-scoring v3 上线（四维质量 + 独立相关性 + 确定性路由 + 六维度展示）；long-read 重构为隔离编排器；卡片路由改私聊触发者；公开前清理敏感文件重写 README
- **skills 仓库**：global-governance 重构为多阶段编排器；ywnew 分批并行 + 80% 硬阈值；ywnext 环境推断 + 软素材；problem-audit 统一迁移；skill-thinking 膨胀检测；diffall 大改动展开规则；new-repo 项目群绑定修复
- **lark-channel-bridge**：模型卡片流式进度更新；外部群绑定工作区；Deep 门禁 problem-audit 适配
- **learn-x**：book-decode 字数上限 3500->2500；long-article-research 追加「为什么梁文锋如此独特」研究记忆；W30 脚手架初始化
- **投资查询**：资产配置/操作记录查询稳定；机器人身份发文问题修复（卡片改私聊 senderId）

### 4. Entry / Executor / Model / Handoff

本周几乎全部任务「手机入口、bot CLI 执行、ark-code-latest 模型、无桌面交接」。但需明确区分：

- **read-x 评分 v3 重构（7/23-7/26）**：手机入口、bot CLI 直接改 read-x 仓库代码、ark-code-latest。无桌面交接。用户全程手机端指挥多轮对抗性审查。
- **global-governance 编排器化（7/21-7/24）**：手机入口、bot CLI 改 skills 仓库、ark-code-latest。无桌面交接。
- **ywnew/ywnext 稳定性强化（7/21）**：手机入口、bot CLI 改 skills 仓库、ark-code-latest。无桌面交接。
- **lark-channel-bridge 流式进度（7/20-7/22）**：手机入口、bot CLI 改 bridge 代码、ark-code-latest。无桌面交接。
- **problem-audit 门禁升级**：手机入口、bot CLI 改 bridge + skills、ark-code-latest。无桌面交接。

注意：build.md 覆盖 07-16-07-22 的桌面侧重构（Skill 治理、ywnew/diffall/neat-all 重构）与本报告 07-20-07-22 段重叠，但本报告从机器人执行链路补充证据，不重复桌面视角。read-x content-scoring v3 重构发生在 07-23-07-26，超出 build.md 覆盖期，是本报告独有。

### 5. Skill / prompt / workflow changes

| 变更 | Skill / 仓库 | 类型 |
|------|-------------|------|
| content-scoring v3 四维+确定性路由 | read-x | 重构 |
| long-read 隔离编排器 + JSON 校验 | read-x | 重构 |
| 评分卡路由改私聊触发者 | read-x, invest-x | bugfix |
| global-governance 多阶段编排器 | skills | 重构 |
| skill-thinking 膨胀检测 P0-P3 | skills | 新增 |
| ywnew 分批并行 + 80% 硬阈值 + 自测 5-8 | skills | 重构 |
| ywnext 环境推断 + 软素材 | skills | 增强 |
| problem-audit 统一迁移 | skills | 迁移 |
| diffall 大改动展开规则 | skills | 增强 |
| new-repo 项目群绑定 | skills | bugfix |
| 模型卡片流式进度更新 | lark-channel-bridge | 增强 |
| 外部群绑定工作区 | lark-channel-bridge | bugfix |
| Deep 门禁 problem-audit 适配 | lark-channel-bridge | 增强 |
| book-decode 字数 3500->2500 | learn-x | 优化 |

### 6. Cross-project capability shifts

- **content-scoring 评分引擎**从 read-x 内部能力升级为可复用引擎（四维质量 + 独立相关性），潜在可迁移到 long-article-research、wisdom-gate 等内容评估场景
- **problem-audit**从 read-x 专用迁移为全 Skill 统一门禁，Deep 门禁桥接适配后成为所有自建 Skill 修改的前置硬约束
- **global-governance 编排器化**后，群规则健康审计、热点依赖趋势图能力可跨群复用
- **卡片路由私聊化**模式（改 senderId 到触发者）从 read-x 评分卡扩散到投资查询，成为"敏感/个性化输出"的统一路由策略

### 7. AI Builder / learner significance

本周最深的转变是评分系统从"凭感觉打分"到"第一性原理 + 领域专家角色 + 确定性路由"。用户反复强调"作为那个领域的专家去评判，而不是凭感觉"，这映射到 AI Builder 的核心命题：AI 的判断力不能外包给模型直觉，必须落到可解释的维度和角色设定。read-x 公开前清理敏感文件、重写 README，是从"自用工具"到"可分享资产"的边界收拢，呼应"剑意是帮助有缘人进入 AI 时代"。

### 8. Must do / Worth doing / Skip

- **Must do**：read-x 评分 v3 跑一周真实文章验证稳定性；problem-audit 门禁在所有自建 Skill 修改路径上验证拦截有效性
- **Worth doing**：把 content-scoring 评分引擎抽象为独立 Skill 供跨项目复用；global-governance 趋势图首次真实跑一周看数据
- **Skip**：不要再扩 ywnext 软素材维度（季节/天气已够，多了是噪音）；不急着把 read-x README 做成完整产品站

### 9. Biggest bottleneck

评分系统的"专家角色动态生成"仍依赖模型对领域的判断，主领域和次领域的识别没有外部 ground truth 校验，存在"模型自评自洽"的风险。这是下周需要补的验证闭环。

### 10. Next week bot priorities

1. read-x content-scoring v3 接一周真实文章（微信 + 一席 + 新浪），验证四维评分稳定性与领域专家角色准确性
2. problem-audit 门禁在 ywnew/ywnext/global-governance 修改路径上做真实拦截验收
3. raw_memories.md 补本周决策（评分 v3、门禁升级、编排器化），memory_summary.md 从 07-09 推进到 07-26
4. global-governance 趋势图首次真实跑一周，看热点/依赖数据是否有信号
5. 投资查询卡片私聊路由跑一周，确认触发者身份稳定

## 附录

### A1. 来源覆盖

| 来源 | 状态 | 备注 |
|------|------|------|
| Bridge logs | 可用 | 7/20-7/26 全部 7 天文件齐全，已过滤 intake enter 事件提取 507 条用户指令，覆盖 16 个群/p2p |
| Codex memories | 部分可用 | memory_summary.md 停在 2026-07-09（v1），raw_memories.md 37 字节基本为空，本周无新增记忆沉淀 |
| Feishu message search | 未调用 | bridge logs 已覆盖用户指令面，未额外调 lark-cli messages-search |
| Git diff + status | 可用 | learn-x（6 commit）、read-x（9 commit）、skills（11 commit）、lark-channel-bridge（6 commit）四仓库本周 commit 已提取 |
| Base workflow records | 未调用 | 大佬情报季度自动化本周未触发，未跑 base workflow-list |
| 邻近 build.md | 可用 | W30/build.md 已读（覆盖 07-16-07-22），做去重参考 |

### A2. 可用记忆 / 日志摘要

memory_summary.md 内容停留在 07-09，覆盖手机优先分流、Skill 沉淀边界、飞书执行边界、中文输出规则、deep profile 运行事实。本周新决策（评分 v3 重构、problem-audit 门禁、global-governance 编排器化、卡片私聊路由）尚未沉淀到 raw_memories.md，是下周需补的记忆更新。连续两周记忆系统停滞，根因待查（可能 ad_hoc note 写了但未同步到 consolidated 文件）。

### A3. 关键 bot 执行证据

- `2026-07-20T10:10` 用户提"diffall 输出更详细，核心 commit 内容全部输出" -> skills 仓库 1b1f36d 落地 diffall 大改动展开规则
- `2026-07-20T21:38` 用户提"图咋没上传到附件，定位 bug，对抗性审查自测" -> read-x 链路图片上传修复 + 自测
- `2026-07-21T09:48` 用户诊断"newold 没发、所有群发、串行发，从第一原理定位" -> skills 600b87d ywnew 分批并行 + 80% 硬阈值 + 自测 5-8
- `2026-07-21T10:15` 用户反馈"为什么是我发出来？需要你以机器人身份发" -> read-x bb49ff2 卡片路由改私聊 senderId
- `2026-07-21T20:32` 用户提"调用 global gov skill，从第一性原理" -> skills 6b9f628 global-governance 重构为多阶段编排器
- `2026-07-23T22:45` 用户提"评分怎么算的？从第一性原理作为领域专家评判" -> read-x c4e718c content-scoring 评分引擎 + bb49ff2 v3 重构
- `2026-07-23T23:12` 用户提"主领域和次领域专家动态生成" -> read-x 评分角色设定改造
- `2026-07-24T10:31` 用户提"精读卡片不重复评分，评分和精读完成分离" -> read-x c935ed6 评分权重重校准 + 卡片只发原群
- `2026-07-24T12:15` 用户提"移除所有私聊发送的逻辑" -> read-x 卡片路由收敛
- `2026-07-25T16:25` 用户提一席演讲 read-6 -> read-x 精读链路验证

### A4. 本周自动化 / Skill / prompt 变更

见正文第 5 节表格。核心沉淀：read-x content-scoring v3（9 commit）、global-governance 编排器化、ywnew 分批并行 + 自测、problem-audit 统一门禁 + Deep 桥接、卡片私聊路由、模型卡片流式进度。

### A5. 与 build.md 去重

- build.md 覆盖 07-16-07-22 全局桌面视角（Skill 治理、lark-channel-bridge 迭代、ywnew/diffall/neat-all/long-read/people-intelligence 重构）。本报告聚焦 07-20-07-26 飞书机器人执行视角。
- 重叠点：07-20-07-22 段的 ywnew 重构、diffall 增强、lark-channel-bridge 迭代在两侧都出现，但本报告从 bot 触发与执行角度补充用户指令时间与闭环状态，不重复 build.md 的项目级摘要。
- read-x content-scoring v3 重构（07-23-07-26）超出 build.md 覆盖期，是本报告独有内容。
- build.md 提到的 time-x / learn-x / research-x 桌面重构不在本报告范围。

### A6. 不可用来源 + 需人工补证

- raw_memories.md 为空（37 字节），本周新决策未沉淀到记忆系统，连续两周停滞，下周需补并查根因
- 未调用 lark-cli messages-search / chat-messages-list / base workflow-list，bridge logs 已覆盖用户指令面，但 bot 回复详情（outbound phase）未全面提取
- read-x content-scoring v3 的真实评分效果（领域专家角色准确性）需下周接真实文章验证，本周只有代码层闭环
- global-governance 趋势图首次真实运行尚未发生，需跑一周看数据信号
- 评分系统"主领域/次领域专家动态生成"无外部 ground truth 校验，存在模型自评自洽风险，需补验证闭环

## 2026-08-02 飞书机器人 Build 复盘

覆盖期：2026-07-27 至 2026-08-02（Asia/Shanghai）。证据源：bridge logs（7 天齐全，飞鱼用户消息 200+ 条）、learn-x / read-x / skills / lark-channel-bridge 四仓库 git log、Codex memories（memory_summary.md 停在 07-09，raw_memories.md 为空，连续三周停滞）。

### 1. Weekly bot overview

机器人本周节奏「验证 + 止痛」双线并行。评分系统从上周代码闭环走向真实文章压测（7/29-7/30 几十条"仅评分"批量验证），并完成兴趣分引入和门槛分数线改革；授权机制成为本周最大痛点（7/30 批量授权 -> 8/2 又失效 -> bridge 层串行方案设计）。认知层有道法术器澄清与沉思引导落地，生活线活跃（建水玉溪旅行、读《悉达多》）。

### 2. Top 3-5 items

**① 文章评分系统真实验证 + 兴趣分引入（read-x，全周最重，贯穿 7/27-8/2）**
用户意图：评分要可信、相关性和兴趣都要纳入。从 7/27 质量评分争议（李开复 6.5 分太低）、相关性 1.5 vs 1 分之争，到"完全重新思考，相关性作额外加分"；7/31 引入兴趣分，相关+兴趣合最多 1.2 分（各 0.6），门槛分数线改质量+相关双门槛；阮一峰周刊特殊路由（跳过评分直接阅读）。7/29-7/30 几十条"仅评分"压测验证。read-x 落地 content-scoring v3 重构 + anchor/view 渲染脚本。闭环：代码层是，真实效果验证进行中。

**② 授权机制反复踩坑与 bridge 层方案（7/30 + 8/2 集中爆发，本周最痛）**
用户意图：一次性授权、不再反复。7/30 批量授权 + offline access 改一个月 + 授权链接手机一键操作记忆；8/2"咋回事？又失效了"，昨天授权今天又失效，并发刷 token、串行性能慢，用户要求 bridge 层统一方案 + 对抗性审查 + 验收矩阵。状态：方案设计完成，但 lark-channel-bridge 仓库本周无实质 commit，未落地，是本周最大未闭环项。

**③ ywnew 全发脚枪根除（skills，7/27 触发 -> 落地）**
用户意图：newold 决策不能误全发。7/27 用户质疑"安全阈值有必要吗""为什么直接全发了"，机器人落地 ywnew 只读决策脚本 check.js，固化逐群判断，根除总量阈值/全发脚枪，并完成 ywnext 清理 + problem-ledger W31。闭环：是。

**④ 道法术器认知澄清 + 沉思引导（learn-x + skills，7/31-8/2）**
用户意图：道法术器定义要清楚，不能滥用。7/31"这个改成法，哪有那么多道"，机器人学习 learn-x 仓库内化沉淀到 skill；8/1"ai 时代人何以自处"沉思；8/2 沉思引导引导词表权限 + 共鸣增加日记来源。闭环：认知澄清是，引导词表权限待一次性授权闭环。

**⑤ Voice-X 文档引用模式重构（7/27-7/28）**
用户意图：保存原稿和理解内容彻底分开，机器人不接收原文。7/27 读书会语音转写（云南历史：古滇国-大理国-张居正）+ "为什么这么慢"性能诊断；7/28 Voice-X 文档引用模式方案，leader skill 执行，移除 ai 生成文档内容逻辑，代码架构分析。闭环：是。

### 3. Per-entry outcomes

- **read-x**：content-scoring v3 重构 + anchor/view 渲染脚本；long-read 调整；兴趣分引入（相关+兴趣合 1.2 分）；门槛分数线改质量+相关双门槛；阮一峰周刊特殊路由；评分卡重复发送 bug 修复
- **skills**：ywnew 只读决策脚本 check.js（根除全发脚枪）；ywnext 清理；problem-ledger W31
- **learn-x**：GROUP_INFO 同步 4 次；道法术器定义内化；智慧之门多附件图片处理；group info 数据源改多维表格
- **lark-channel-bridge**：仅 GROUP_INFO 同步（授权 bridge 层方案未落地）
- **投资查询**：6/7 月详细操作 + 风险分级 + 指数维度表格；近两年风险维度资金操作年维度汇总
- **随时记/日记**：聂耳音乐广场、建水五龙湖、玉溪飞盘、聂耳图书馆《悉达多》；随时记总结格式优化（去标签、不换行、去标题字）

### 4. Entry / Executor / Model / Handoff

本周仍以「手机入口、bot CLI 执行、ark-code-latest 模型、无桌面交接」为主，但出现一个明确潜在交接点：

- **评分系统验证 + 兴趣分（7/27-8/2）**：手机入口、bot CLI 改 read-x 代码、ark-code-latest。无桌面交接。用户手机端指挥多轮"从第一性原理"+ 对抗性审查。
- **授权 bridge 层方案（8/2）**：手机入口、bot 设计方案、ark-code-latest。但用户明确要求"在 bridge 那一层实现"，bridge 仓库本周无实质 commit，落地可能需桌面 Codex。这是本周唯一潜在桌面交接点。
- **ywnew check.js（7/27）**：手机入口、bot CLI 改 skills 仓库、ark-code-latest。无桌面交接。
- **Voice-X 文档引用模式（7/28）**：手机入口、bot CLI + leader skill、ark-code-latest。无桌面交接。
- **道法术器内化（7/31）**：手机入口、bot 读 learn-x 仓库学习 + 改 skill、ark-code-latest。无桌面交接。

注意：本周 build.md 尚未生成（W31 目录新建），无桌面视角去重对象，本报告为本周唯一复盘。

### 5. Skill / prompt / workflow changes

| 变更 | Skill / 仓库 | 类型 |
|------|-------------|------|
| content-scoring v3 重构 + anchor/view 渲染 | read-x | 重构 |
| 兴趣分引入（相关+兴趣合 1.2 分） | read-x | 新增 |
| 门槛分数线改质量+相关双门槛 | read-x | 重构 |
| 阮一峰周刊特殊路由（跳过评分） | read-x | 新增 |
| 评分卡重复发送 bug 修复 | read-x | bugfix |
| long-read 调整 | read-x | 优化 |
| sync-codex-skills 同步工具 | read-x | 新增 |
| ywnew 只读决策脚本 check.js | skills | 重构 |
| ywnew 安全机制修复 + ywnext 清理 | skills | bugfix |
| problem-ledger W31 | skills | 更新 |
| 道法术器定义内化到 skill | skills | 增强 |
| 智慧之门多附件图片处理 | learn-x | 增强 |
| group info 数据源改多维表格 | learn-x | 重构 |
| 授权 bridge 层串行方案 | lark-channel-bridge | 设计未落地 |
| 沉思引导引导词表 + 共鸣日记来源 | learn-x | 增强 |

### 6. Cross-project capability shifts

- **评分引擎**从四维质量扩展为「质量 + 相关性 + 兴趣」三维加分，兴趣分是本周新维度，潜在可迁移到 wisdom-gate、long-article-research 内容评估
- **ywnew 只读决策脚本**模式（固化逐群判断、只读不写）从 ywnew 扩散为"批量决策类操作"的安全范式，可复用到 ywnext、群发场景
- **授权链接手机一键操作**模式（device flow + 前台阻塞）从 7/30 沉淀，成为未来所有授权的统一交互，但 bridge 层并发 token 串行方案未落地仍是隐患
- **道法术器分类**从 learn-x 思想内容升级为 skill 层判断框架，影响后续 Skill/知识归类的"道法"边界

### 7. AI Builder / learner significance

本周最深的是评分系统从"专家角色自评"走向"真实文章压测验证"。7/29-7/30 几十条"仅评分"批量测试，是对上周"主/次领域专家无 ground truth"风险的真实回应--用规模换信号。兴趣分的引入呼应"相关和兴趣都很重要，最终因为我要读"，把用户主体性注入评分，而非纯客观维度。道法术器澄清"哪有那么多道"，是用户对 AI 滥用高级概念的反拨，呼应"着力即差"--不要为了完整性强升层级。授权反复失效则暴露"手机端便利"与"系统层稳定"的张力，用户坚持 bridge 层根因方案而非仓库内打补丁，是"第一性原理"在工程边界的体现。

### 8. Must do / Worth doing / Skip

- **Must do**：授权 bridge 层串行方案落地 + 验收矩阵（本周设计未落地，是最大风险）；评分系统跑完本周压测后做效果复盘
- **Worth doing**：兴趣分真实效果验证（是否提升精读命中率）；道法术器内化后在后续 Skill 归类中验证判断一致性
- **Skip**：不要再扩评分维度（质量+相关+兴趣已够，多了是噪音）；不急着把授权方案做到所有仓库，先 bridge 层一处落地

### 9. Biggest bottleneck

授权机制未闭环。7 天有效期 + 并发刷 token + 串行性能慢，本周反复踩坑（7/30 批量授权 -> 8/2 又失效），bridge 层方案设计完成但仓库无 commit，用户已要求对抗性审查 + 验收矩阵却尚未落地。这是下周第一优先级。次要瓶颈：记忆系统连续三周停滞（停 7/9），本周新决策（评分演进、授权方案、道法术器）均未沉淀。

### 10. Next week bot priorities

1. 授权 bridge 层串行方案落地 + 对抗性审查 + 验收矩阵（本周设计未落地，最高优先）
2. 评分系统本周压测效果复盘（兴趣分是否提升精读命中率、领域专家角色准确性）
3. raw_memories.md + memory_summary.md 推进到 08-02（连续三周停滞，需查根因并补本周决策）
4. 道法术器内化后在智慧之门/情报局归类中验证判断一致性
5. 沉思引导引导词表权限 + 一次性授权闭环，共鸣日记来源跑一周看效果

## 附录

### A1. 来源覆盖

| 来源 | 状态 | 备注 |
|------|------|------|
| Bridge logs | 可用 | 7/27-8/2 全部 7 天文件齐全，已过滤 intake enter 提取飞鱼用户消息 200+ 条，覆盖 10+ 群/p2p |
| Codex memories | 部分可用 | memory_summary.md 停在 2026-07-09（v1），raw_memories.md 为空，连续三周停滞 |
| Feishu message search | 未调用 | bridge logs 已覆盖用户指令面，未额外调 lark-cli messages-search |
| Git diff + status | 可用 | learn-x（5 commit）、read-x（5）、skills（5）、lark-channel-bridge（5，均 GROUP_INFO sync）四仓库本周 commit 已提取 |
| Base workflow records | 未调用 | 定时提醒卡片本周稳定推送（8:00/9:00/21:00/22:00），未跑 base workflow-list |
| 邻近 build.md | 不可用 | W31 目录新建，本周 build.md 尚未生成，无桌面视角去重对象 |

### A2. 可用记忆 / 日志摘要

memory_summary.md 停在 07-09，覆盖手机优先分流、Skill 沉淀边界、飞书执行边界、中文输出规则、deep profile 运行事实。本周新决策（评分兴趣分引入、授权 bridge 层方案、道法术器内化、ywnew check.js）均未沉淀到 raw_memories.md，连续三周停滞，根因待查（W30 已提示，本周仍未补）。

### A3. 关键 bot 执行证据

- `2026-07-27T13:30` 用户提"完全重新思考整体方案，相关性评分应该是额外加分" -> read-x 评分相关性逻辑重构
- `2026-07-27T16:48` 用户提"精读深读合并，从第一性原理看配置可合并" -> read-x 精读/深读统一
- `2026-07-27T22:10` 用户质疑"安全阈值有必要吗？为什么直接全发了" -> skills ff963b7 ywnew 只读决策脚本 check.js
- `2026-07-28T08:42` 用户提"Voice-X 文档引用模式，保存原稿和理解内容分开" -> Voice-X 重构 + leader skill 执行
- `2026-07-29T20:09` 至 `07-30T15:55` p2p + f79c12bc 几十条"仅评分"批量压测 -> 评分系统真实文章验证
- `2026-07-30T08:21` 用户提"批量授权一次，减少未来授权次数" -> 授权链接手机一键模式 + offline access 改一个月
- `2026-07-31T11:21` 用户提"相关+兴趣合最多 1.2 分各 0.6" -> read-x 兴趣分引入
- `2026-07-31T17:07` 用户提"这个改成法，哪有那么多道，道法术器定义说清楚" -> skills 道法术器内化
- `2026-08-01T09:41` 用户提"评分完成卡片发了两遍，从第一性原理找根因" -> read-x 评分卡重复发送 bug 修复
- `2026-08-02T09:06` 用户提"授权又失效了，并发刷 token，bridge 层方案" -> 授权 bridge 层串行方案设计（未落地）

### A4. 本周自动化 / Skill / prompt 变更

见正文第 5 节表格。核心沉淀：read-x content-scoring v3 + 兴趣分 + 阮一峰路由 + 重复发送 bugfix；ywnew check.js 只读决策脚本；道法术器内化；智慧之门多附件；授权 bridge 层方案（设计未落地）。

### A5. 与 build.md 去重

本周 W31/build.md 尚未生成，无桌面视角去重对象。本报告为本周唯一复盘，从飞书机器人执行视角覆盖 07-27-08-02。授权 bridge 层方案、评分系统演进等若后续 build.md 涉及，以本报告执行链路证据为准。

### A6. 不可用来源 + 需人工补证

- raw_memories.md 为空，本周新决策未沉淀，连续三周停滞，下周需补并查根因
- 授权 bridge 层串行方案仅设计未落地（lark-channel-bridge 仓库本周无实质 commit），需下周落地 + 验收
- 未调用 lark-cli messages-search / chat-messages-list / base workflow-list，bridge logs 已覆盖用户指令面，但 bot 回复详情（outbound phase）未全面提取
- 评分系统兴趣分真实效果（精读命中率提升）需下周压测数据复盘，本周只有批量评分验证
- 道法术器内化后的判断一致性需在后续 Skill 归类中验证，本周只有内化动作

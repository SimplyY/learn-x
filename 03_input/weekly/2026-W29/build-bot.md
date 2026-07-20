## 2026-07-19 飞书机器人 Build 复盘

覆盖期：2026-07-13 至 2026-07-19（Asia/Shanghai）。证据源：bridge logs（7 天齐全）、skills 与 learn-x git log、Codex memories（memory_summary.md 停在 07-09，raw_memories.md 为空）。

### 1. Weekly bot overview

机器人本周高负荷运行，7 天共 587 条用户消息摄入（7/16 单日 182 条峰值）。主线是「Skill 治理 + 触发词硬规则 + 投资查询 skill 重构 + bot 效率根因排查」，几乎每天都有 Skill 改造、对抗性审查、bot 慢的诊断循环。

### 2. Top 3-5 items

**① 投资查询 Skill 从无到有并多轮收敛（7/16 全天）**
用户意图：手机快速查阅投资配置与操作。机器人从方案设计到落地：缓存（按年拉取复用）、按月净操作矩阵、现值列、手机端 9 列限制（全年拆两个卡片）、第一列锁列。多次反复：表格丢失、列数错、没合计、卡片宽度不对、用代码 vs 用 markdown skill 的取舍，最终回到 md skill 方式。

**② Skill 治理与触发词硬规则（7/14-7/19 贯穿）**
用户意图：自建 Skill 集中到 skills 仓库，触发词不再误识别。机器人完成：迁入 27 个自建 Skill 后撤回非自建、neat-all 强制先 diffall、newold 误识别为 new-repo 的根因修复（词面冲突）、7/19 落地触发词规范化 hook + global-governance skill + neat-all 飞书场景完成度硬规则。

**③ image-ocr 与智慧之门图片链路（7/13-7/14）**
用户意图：纯文本模型也能读图，且压缩图片体积。机器人从「明明可以读图却声称不能」根因排查，封装 image-ocr Skill，迁到全局 skills 仓库，图片压缩从 60% 调到 35-50%，智慧之门多图与压缩逻辑内化到 Skill。

**④ bot 慢的根因诊断与系统提示词收敛（7/16、7/18、7/19）**
用户意图：机器人回复变慢，从第一性原理排查。机器人多次诊断：图片解析超时（15s 太短，7/18 改 1-2 分钟）、联网工具分层冗余、semble 工具拖慢、Skill 调用链过长。同时把总结逻辑、回复结构、可读性、安全底线、恶意注入防范全部收敛到 SOUL.md / 全局 AGENTS.md。

**⑤ 大佬情报系统季度自动化（7/18）**
用户意图：研究群多维表格每季度自动跑一次大佬情报。机器人完成 Base automation 配置，关键决策：以用户身份发触发消息实现全自动（不再以多维表格身份发），把核心逻辑写入系统文件固化。

### 3. Per-entry outcomes

- **invest-x**：投资查询 Skill 上线（缓存 12 小时、按月矩阵、现值列、半年/全年分卡片、按现值排序、1 位小数）；2024/2025/2026 年度合计查询稳定输出
- **skills 仓库**：image-ocr、long-article-research、ywask、base-time-group、global-governance、skill-thinking、thinking-group 新增或迁入；neat-all/diffall/group-info/wisdom-gate/ywnew 系列重构
- **learn-x**：long-article-research skill 新增并接入 weekly-automation；learn-x-input 描述改中文；image-ocr 迁出
- **lark-channel-bridge**：buildCodexArgs 优先改配置；bridge 记挂 PM2 计划；输出字数限制；安全底线 + 注入防范写入全局 AGENTS.md
- **time-x**：日历增删改查冒烟测试、批量创建自测、time-x-note 本地原子存储
- **ai-coach**：人员表新增「地点」「合作关系」列；thinking 表新增内容；大佬情报季度自动化
- **read-x**：ljg-card 对 8 分以上文章额外生成；阮一峰科技周刊专项优化（言论完整保留、骨架 50 字、USER.md 视角解析）

### 4. Entry / Executor / Model / Handoff

本周几乎全部任务「手机入口、bot CLI 执行、ark-code-latest 模型、无桌面交接」。但有几类需要明确区分：

- **投资查询 Skill 重构（7/16）**：手机入口、bot CLI 执行、ark-code-latest。中途用户曾让切桌面 Codex，但被用户主动否决（"为什么需要桌面 CodeX 走呢？这个我理解是清扫工作"），全程手机闭环。
- **Skill 治理 hook 落地（7/19）**：手机入口、bot CLI 执行、ark-code-latest。无桌面交接。
- **bridge 配置与 buildCodexArgs（7/16 凌晨）**：手机入口、bot CLI 改配置（用户明确要求"优先改配置，不直接改代码"）、ark-code-latest。
- **长文研究 / 大佬情报（7/14、7/18）**：手机入口、bot CLI 调 Skill、ark-code-latest。无桌面交接。
- **系统提示词收敛（7/18）**：手机入口、bot CLI 改 SOUL.md / AGENTS.md、ark-code-latest。无桌面交接。

注意：本周桌面 Codex 在 time-x、learn-x、research-x 等仓库有独立重构工作（见 build.md），但那些不是机器人执行链路；机器人侧的全部任务都在手机端闭环，未发生桌面交接。这与 W28 复盘发现的「build-bot 不得写"全部手机完成"而与日记矛盾」一致：本节明确划分执行器边界。

### 5. Skill / prompt / workflow changes

| 变更 | Skill / 文件 | 类型 |
|------|-------------|------|
| 触发词 hook + 飞书场景完成度硬规则 | neat-all, global-governance | 新增 + 硬规则 |
| 强制先 diffall 再 neatfreak | neat-all | 重构 |
| 卡片化输出、禁止 raw diff | diffall | 增强 |
| 健康评分 + 群规则证据采集 | group-info, skills | 增强 |
| newold 误识别 new-repo 根因修复 | ywnew, new-repo | bugfix |
| /new 发送串行 sleep 30 | ywnew | 优化 |
| 缓存 + 按月矩阵 + 现值列 + 分卡片 | invest-x 查询 | 重构 |
| 图片压缩 35-50% + 多图 + ljg-card | wisdom-gate | 增强 |
| image-ocr 迁入全局 + 仅 deep 运行时 | image-ocr | 迁移 |
| 长文研究 + USER.md 视角 + 芒格之魂 | long-article-research | 新增 |
| 深度提问 + 多 Skill 组合 | ywask | 新增 |
| 多维表格时间分组 | base-time-group | 新增 |
| 阮一峰科技周刊专项（言论完整保留、骨架 50 字） | 精读链路 | 增强 |
| 总结逻辑 + 回复结构 + 可读性 | SOUL.md | 收敛 |
| 安全底线 + 注入防范 | 全局 AGENTS.md | 增强 |
| AUTO-SYNC 同步区块删除 | AGENTS.md | 清理 |
| 联网工具分层 / semble 移除 | 系统提示词 | 收敛 |

### 6. Cross-project capability shifts

- **neat-all / diffall / global-governance** 形成跨仓库治理链：先 diffall 卡片化输出、再 neatfreak 审查、最后 neat-all 强制门禁。能力可复用到所有注册仓库。
- **invest-x 查询 Skill** 把「拉取-缓存-聚合-卡片输出」打通，月度/年度/历史查询共用同一套逻辑，避免每次手写查询。
- **image-ocr** 从项目私有迁到全局 skills 仓库，并限定 deep 运行时；任意项目发图都走同一 OCR 链路。
- **总结逻辑 + 回复结构 + 安全底线** 从分散 Skill 内嵌收敛到 SOUL.md / 全局 AGENTS.md，所有项目共享同一套人格与边界。

### 7. AI Builder / learner significance

本周是「机器人自省」的一周。用户反复让机器人从第一性原理诊断自己的慢、长、错，并把诊断结论固化到系统文件。两个信号：

- 机器人不再只执行任务，开始被要求解释自己的行为模式（为什么没调李继刚 Skill、为什么以用户身份发消息、为什么输出偏长）。
- 治理从「写规则」升级为「写可被 hook 强制的硬规则」。触发词误识别的根因修复走了完整闭环：现象 → 根因（词面冲突）→ 修复 → 对抗性审查 → hook 固化。

风险：用户本周对 bot 慢的反馈密集（7/16、7/18、7/19 多次），说明效率仍是机器人长期价值的基础设施。15s 图片超时这类硬限制暴露后，需要在 bridge 层而非 Skill 层解决。

### 8. Must do / Worth doing / Skip

- **Must do**：把图片解析超时（1-2 分钟）与 bot 慢的根因修复落地到 bridge 配置；完成 neat-all 触发词 hook 的真实误报率观察
- **Worth doing**：invest-x 查询 Skill 跑一个月，看缓存命中率与卡片输出稳定性；大佬情报季度自动化跑通首次真实触发
- **Skip**：不为 Skill 治理加第二套框架；不把 SOUL.md 拆成多文件；不为 bot 慢加更多 Skill 层 workaround，根因在 bridge

### 9. Biggest bottleneck

**bot 响应速度。** 本周用户至少 10 次反馈"慢/卡/为什么这么慢"，根因分散：图片解析超时（15s）、联网工具分层、semble 工具、Skill 调用链过长、bridge 重启频次高。Skill 层已尽力收敛（输出字数、思考精简、第一性原理），但硬限制在 bridge 配置层（超时、模型路由、图片链路）。这是机器人长期价值的基础设施，下周最高优先级。

### 10. Next week bot priorities

1. 落地 bot 慢的根因修复：图片超时 1-2 分钟、移除 semble 与冗余联网分层、bridge 记挂 PM2
2. 跑一次 neat-all 触发词 hook 的真实误报率观察，只修有证据的缺陷
3. invest-x 查询 Skill 接一周真实查询，验证缓存与卡片稳定性
4. 大佬情报季度自动化首次真实触发验收
5. 把本周 SOUL.md / AGENTS.md 收敛跑一周，看输出长度与可读性是否稳定

## 附录

### A1. 来源覆盖

| 来源 | 状态 | 备注 |
|------|------|------|
| Bridge logs | 可用 | 7/13-7/19 全部 7 天文件齐全，已过滤 intake enter 事件提取用户指令 |
| Codex memories | 部分可用 | memory_summary.md 停在 2026-07-09，raw_memories.md 为空（"No raw memories yet."），本周无新增记忆沉淀 |
| Feishu message search | 未调用 | bridge logs 已覆盖用户指令面，未额外调 lark-cli messages-search |
| Git diff + status | 可用 | learn-x 与 skills 仓库本周 commit 已提取；learn-x 工作区仅 W29 目录未跟踪 |
| Base workflow records | 未调用 | 大佬情报季度自动化已通过聊天证据确认，未单独跑 base workflow-list |
| 邻近 build.md | 可用 | W29/build.md 已读，做去重参考 |

### A2. 可用记忆 / 日志摘要

memory_summary.md 内容停留在 07-09，覆盖手机优先分流、Skill 沉淀边界、飞书执行边界、中文输出规则、deep profile 运行事实。本周新决策（bot 慢根因、触发词 hook、SOUL.md 收敛、大佬情报自动化）尚未沉淀到 raw_memories.md，是下周需要补的记忆更新。

### A3. 关键 bot 执行证据

- `2026-07-13T22:07` 用户提"图片 OCR 能不能封装成 skill" -> 7/14 image-ocr Skill 上线并迁入全局 skills 仓库
- `2026-07-14T10:38` 用户提"封装新 skill 叫 ywask" -> 当日 ywask Skill 上线，玉溪宜居研究多版本输出
- `2026-07-16T04:43` 用户反馈"最近 3 条消息越来越慢" -> 多轮诊断，7/18 定位图片解析 15s 超时
- `2026-07-16T10:49` 用户反馈"new old 不是 New repo" -> 根因 new-repo `yw new` 与 ywnew `newold` 词面冲突，7/19 落地 hook
- `2026-07-16T15:30` 用户反馈"表格长宽度能不能窄一点" -> invest-x 查询改卡片输出，全年拆两个卡片
- `2026-07-17T21:47` 用户提"超过 8 分文章额外增加 ljg-card" -> 当日更新到精读 skill
- `2026-07-18T17:27` 用户提"每季度跑一遍大佬情报系统" -> 当日完成 Base automation，以用户身份发触发消息
- `2026-07-18T19:17` 用户提"总结逻辑写到人格 MD" -> 当日迁移到 SOUL.md
- `2026-07-19T08:17` 用户否决桌面 Codex 建议，要求手机闭环 -> 当日继续手机端完成 skill 清扫
- `2026-07-19T09:17` 用户触发"生成 build-bot" -> 本报告

### A4. 本周自动化 / Skill / prompt 变更

见正文第 5 节表格。核心沉淀：触发词 hook（skills 55ea996）、neat-all 硬规则、invest-x 查询 Skill、SOUL.md / 全局 AGENTS.md 收敛、大佬情报季度自动化。

### A5. 与 build.md 去重

- build.md 覆盖全局 Codex / 桌面视角（14 仓库、130 提交、Skill 治理、Time-X、Learn-X、Research-X）。本报告聚焦飞书机器人执行视角，不重复桌面侧重构。
- 重叠点：Skill 治理、安全底线、image-ocr、invest-x 查询 Skill 在两侧都出现，但本报告从 bot 触发与执行角度补充证据（用户指令时间、机器人响应、闭环状态），不重复 build.md 的项目级摘要。
- build.md 提到的 time-x / learn-x / research-x / read-x 桌面重构不在本报告范围；本报告只记录机器人侧的 time-x 冒烟测试、learn-x-input 描述优化、long-article-research skill 新增等机器人执行链路。

### A6. 不可用来源 + 需人工补证

- raw_memories.md 为空，本周新决策未沉淀到记忆系统，下周需补
- 未调用 lark-cli messages-search / chat-messages-list / base workflow-list，bridge logs 已覆盖用户指令面，但 bot 回复详情（outbound phase）未全面提取
- bot 慢的根因诊断在聊天中有结论（图片 15s 超时），但 bridge 配置层的实际修改证据需从 lark-channel-bridge 工作区 git log 补证（本报告未读取该仓库 git）
- 大佬情报季度自动化首次真实触发尚未发生，需等下季度验收

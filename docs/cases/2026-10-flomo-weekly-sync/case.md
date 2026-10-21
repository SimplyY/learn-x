# CASE: Learn-X Flomo 周一前置同步与重试

- 状态：已确认
- 最后核对日期：2026-10-21
- 上下游链接：../../requirements/2026-10-flomo-weekly-sync.md → execution-plan.md
- Type: Major
- Status: In Progress
- Requirement: [2026-10-flomo-weekly-sync](../../requirements/2026-10-flomo-weekly-sync.md)
- Architecture / Planning: None / [Execution Plan](execution-plan.md)
- ADR: None
- Implementation: 本轮工作区改动；未提交
- Acceptance: None
- Version: None

## 执行状态

- 当前有效方案：`execution-plan.md`「方案原文」；用户消息 `01a15c05-2b09-7761-a83d-6ebc22ce521c` 明确要求实施。
- 完整授权范围与阶段顺序：先 ywdev 持续完成方案，再进行第一轮 yw-testing；第一轮后由一名独立 subagent 执行新一轮只读 ywtest，发现授权范围内缺陷由协调者修复并交原测试者复测。依据用户在本会话的直接指令。
- 最后已验证里程碑：M0 规划资产保存；M1 实施与 ywdev 对抗审查完成；第一轮 yw-testing 发现的问题已修复并复测通过；第二轮独立只读 ywtest 发现的计数迁移边界也已修复并由独立测试者复核通过。
- 剩余事项：手动真实扫描已于 2026-10-21 完成 W42 验收；正式 W43 周一 00:10 调度及后续 05:00/07:00 消费与补救读回仍等待 2026-10-26 实际运行。
- 下一步：2026-10-26 后检查 W43 同周状态、活动快照、`flomo.md` 的快照 ID/采集时间与新建笔记筛选，并确认 05:00 消费成功状态而未重复全量扫描。
- 持续验收：已创建一次性 heartbeat `learn-x-flomo`，ACTIVE，定于 2026-10-26 10:00（Asia/Shanghai）恢复本线程并只读核验 00:10/05:00/07:00 实际运行证据；它不触发 Flomo 采集，也不是周期任务。由于触发日处于 ISO 周 44，预期采集目标为上一完整周 **2026-W43（10-19 至 10-25）**；回访提示已显式限定该周。
- 时区核验：本机 `/etc/localtime` 指向 `Asia/Shanghai`，Node.js 时区识别为 `Asia/Shanghai`，当前偏移 `+0800`；本地 RRULE 与自动化提示中的 Asia/Shanghai 时间一致。
- 调度复核（2026-10-21 16:06 Asia/Shanghai）：Flomo 周一 00:10、Codex Build 周一 00:10、05:00 主流程及 07:00 补救配置均为 `ACTIVE`；2026-10-26 是 ISO 周 44 的周一，正式采集目标周为 W43（2026-10-19 至 2026-10-25）。
- 自动化提示复核（2026-10-21 16:27 Asia/Shanghai）：直接检查 ACTIVE 的 `learn-x-flomo-00-10` 配置，10 项方案约束均匹配——最近完整 ISO 周、Flomo 单次入口及跳过参数、32 分钟单次/160 分钟总限、20 分钟与更长 Retry-After、人工处理硬停止、干净文件上的单文件修复、现有 Flomo 回归测试、哈希保护回退及成功即停止。10/10 检查通过；未触发采集。
- 下游入口复核（2026-10-21 16:28 Asia/Shanghai）：ACTIVE 的 05:00 与 07:00 自动化提示都要求读取 Learn-X 周流程 Skill；Skill 明确规定 05:00 复用同周已成功 Flomo 状态、不重复扫描，07:00 只恢复尚未成功且可自动重试的来源。现有回归测试 `weekly-retry-supervisor.test.mjs` 覆盖该成功去重/失败补救组合（测试起始行 1630）及 07:00 的冷却、限额和逐来源恢复；这证明执行契约，不替代 2026-10-26 真实调度读回。
- 阻塞 / 待核实副作用：W42 手动线上扫描成功；正式 2026-10-26 周一 00:10 Flomo 首次调度以及 05:00/07:00 实际调度行为待未来运行验证。
- 证据：2026-10-21 本轮读取 `/Users/yuwei/code/learn-x`；`rtk git status --short --branch` 显示 master 与 origin/master 同步，有 22 个已修改跟踪文件和一个未跟踪目录 `draft_5b4b062a_folder/`。其中涉及 Flomo 的既有修改须逐项审查，不做 reset/clean；不相关变更保持原状。
- 工作区核对时间：2026-10-21（Asia/Shanghai）。

## 来源与落点核对

- 用户完整原方案 → Requirement「来源原文」与 Execution Plan「方案原文」，逐项保持；本 Case 链接两者。
- 用户授权的阶段顺序（ywdev → yw-testing → 独立 subagent ywtest）→ 本 Case「执行状态」。
- Flomo 调度、重试、快照边界 → R1–R6；实时验证状态只按本轮命令与未来运行记录更新。

## 来源核验

- 状态：通过
- 机器收据：None
- 缺口报告：真实调度及 Flomo 线上采集只能在首次运行后验收。

## 执行入口

本任务由当前用户直接授权实施；完整方案与需求见本 Case 上游链接。续接者先重读两份来源文档和 Learn-X `AGENTS.md`，核对 git 状态及逐文件差异，保护所有既有未提交工作；对照 R1–R6 审查当前用户路径、调度入口、状态锁、尝试标识、TaskSpace、快照激活和 05:00/07:00 去重恢复行为。完成 ywdev 后按用户指定顺序执行两轮 yw-testing；真实线上采集与未来调度保持未验证，除非运行时实际发生并取得读回证据。

## 2026-10-21 ywdev 实施与对抗审查

- **实施：**新增并启用 Codex 自动化 `learn-x-flomo-00-10`，周一 00:10（Asia/Shanghai）调用 `weekly:retry` 的 Flomo 单次入口；保留 05:00 主流程、07:00 补救和 00:10 Codex Build。任务继续全量扫描，周 `flomo.md` 仅按创建时间收录目标周新建笔记；旧笔记编辑只反映到活动全量快照。
- **关键修正：**统一自动化真实 ID 与 Skill、运行参数、TaskSpace 名称和测试；单次入口尊重来源错误的 `retryable` 分类，不重复运行未知/完整性失败；专项失败将 20 分钟下限写入 `nextRetryAt`，并保留更长服务端等待。
- **运行边界：**每次真实尝试由执行器创建新 invocation UUID 和专属 TaskSpace；自动化在进程退出后重试。成功、人工处理错误、不可重试失败、160 分钟预算或三次上限均会停止；局部自动修复仅作为自动化 Prompt 的受限步骤，并要求干净文件、单文件差异、现有回归及哈希保护回退。
- **定向验证：**`rtk proxy node --test .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs`：**107/107**；覆盖 20 分钟边界、较长 Retry-After、非重试错误停止、认证/人工阻塞、第三次上限、旧快照保留、新建笔记筛选、05:00 去重和 07:00 补救。
- **其他校验：**周自动化 Skill `quick_validate.py` 通过；`rtk git diff --check` 通过。自动化 TOML 读回显示 `ACTIVE`、RRULE 为周一 00:10；脚本检查确认 ID、单次尝试、跳过预处理/导入、重试门槛与修复护栏一致；05:00、07:00 与 Codex Build RRULE 仍分别为原配置。
- **未验证边界：**未运行真实 Flomo 扫描、未触发 05:00/07:00 实际调度；自动化模型执行“第三次前修复与失败回退”只完成 Prompt/配置边界审查，没有真实自动化运行验证。隔离测试不能证明线上登录状态、实际覆盖数或首次调度结果。
- **阶段状态：**ywdev 已收口；下一步按用户授权执行第一轮 yw-testing，然后再启动独立第二轮 ywtest。

## 2026-10-21 第一轮 yw-testing 发现与回修

- **第一轮结论：**原测试者只读完成四个相关测试文件 107/107、Flomo 快照底层 26/26、全仓 `npm test` 688/688，以及语法与 diff 检查；同时用临时状态和纯函数复现两项需修正的 R3 边界。原工作区没有被测试者修改。
- **问题一与修复：**原三次尝试上限从最多保留 500 条的诊断历史推算，日志滚动时可多启动采集。现将每个 automation ID 的 Flomo 启动次数持久化在同周 `sources.flomo.automationAttemptCounts`；旧状态已有保留启动事件时先迁移，旧状态没有计数且日志已满时保守封顶；已有持久计数优先可信，所以计数为 2 时仍能执行第三次。新增三类迁移回归覆盖日志滚动、历史不可判定与保留第三次机会。
- **问题二与修复：**`Retry-After` 原先只识别秒数，未识别标准 HTTP-date。现按失败时钟解析日期并与 20 分钟下限取较长值；新增日期格式分类及重试到期边界回归，保留秒数格式的既有覆盖。
- **协调者回归：**第一轮发现的计数迁移反例修复后，四个相关测试文件 `rtk proxy node --test ...`：**110/110**；`node --check` 对监督器与测试文件通过；`rtk git diff --check` 通过。全仓和独立复测随后由原测试者完成。
- **最终复测：**原测试者对最终代码复测通过：四个相关测试文件 **110/110**，Flomo 快照底层 **26/26**，全仓 `rtk proxy npm test` **691/691**；9 个相关 `.mjs`/测试脚本语法检查及全仓 `rtk git diff --check` 均通过。00:10 Flomo、05:00 主流程、07:00 补查、00:10 Codex Build 均为 ACTIVE，RRULE 符合预期。
- **阶段状态：**第一轮 yw-testing 已闭环；用户授权的第二轮独立只读 ywtest 已启动。

## 2026-10-21 第二轮独立 ywtest 发现与回修

- **独立发现：**旧状态的 `automationAttemptCounts` 对象可能只有其他自动化键、缺少当前 `learn-x-flomo-00-10` 键；即使诊断日志已满，也不能把“映射对象存在”当作当前自动化计数可信。独立测试者用临时状态复现了会放行一次额外采集。
- **修复：**现在只信任当前自动化键存在且为非负整数的持久计数；当前键缺失且 500 条日志已满时保守封顶。已有有效计数 2 的情况仍保留第三次机会。
- **协调者回归：**四个相关测试文件 **111/111**；监督器与测试文件 `node --check` 通过；`rtk git diff --check` 通过。全仓 `npm test` 会由 `app/code/scripts/build-static-data.test.mjs` 调用构建脚本递归删除并重建 `dist/`；后续把完整当前 tracked diff 应用到 `/Users/yuwei/code/.tmp-learn-x-flomo-fulltest.*` 临时 worktree，在正确父目录并串行执行 `npm test -- --test-concurrency=1`，最终 **692/692** 通过。临时 worktree 已移除，原工作区 `dist/` 未被测试命令作为输出目录。
- **独立复核结论：**最终代码的四个相关测试文件 **111/111**、快照测试 **26/26**、来源适配器测试 **18/18**、8 个相关脚本语法检查和 `git diff --check` 均通过；复核自动化配置为 ACTIVE，确认 R5 修复护栏与首次调度前剩余验收边界。未发现新增缺陷。
- **阶段状态：**第二轮独立只读 ywtest 已闭环；下一里程碑是 2026-10-26 首次真实同步及 05:00 消费读回。

## 2026-10-21 手动 Flomo 真实验收

- **执行：**按用户指示提前运行 W42（2026-10-12 至 2026-10-18）真实全量扫描，调用同一 `weekly:retry` 手动 Flomo 来源入口，跳过周材料预处理和 Flomo 回顾导入，目标周状态锁与浏览器队列锁由执行器持有。
- **权限恢复：**受限沙箱中的首次子进程启动以 `EPERM` 失败，未进入 Flomo 采集，旧快照及周输入保持可用；随后在用户已授权的同一测试范围内获准使用 Full Access，新的 invocation 重跑并成功。没有启动自动重试或修复代码。
- **执行记录：**状态路径 `03_input/weekly/2026-W42/_weekly-retry-state.json`；成功 invocation `5e560ee7-ae58-4025-86e5-f2faf635af59`；测试 automation ID `learn-x-flomo-manual-test-2026-10-21`；扫描时长约 180 秒；尝试 guard 最终为 `active=false`。
- **快照与完整性：**活动快照 ID `567ed035-d8f7-4066-bded-86ec4c0df8c6`，采集时间 `2026-10-21T02:57:24.640Z`；全库观察 976 / 预期 978，缺口 2（在已配置的最多 10 条容差内），稳定到底，49 页。活动快照元数据与 W42 `flomo.md` 文件头的 ID 和采集时间一致。
- **周筛选：**W42 `flomo.md` 状态为 `ready`，包含 18 条及 18 个来源链接；所有标题创建日期均在 2026-10-12 至 2026-10-18 范围内（观测到的首末日期为 10-12 与 10-17）。检查只读取文件头、标题日期与计数，没有读取或展示笔记正文。
- **结论与缺口：**提前真实扫描、完整性门禁、活动快照激活、同一扫描周输入生成及创建时间筛选通过；2 条全库计数缺口按现有容差接受，不能描述为全库零遗漏。该 W42 手动测试不验证 W43 正式定时入口、05:00 去重消费或 07:00 补救；这些仍由 2026-10-26 后的只读回访验收。
- **当前回归复测：**本轮再次运行周重试监督器、周工作流模拟、Flomo 全量同步与采集器四个测试文件，**111/111 通过**；`rtk git diff --check` 通过。
- **正式入口幂等检查：**2026-10-21 以自动化 ID `learn-x-flomo-00-10` 在已成功的 W42 上运行其精确 `--single-attempt` 命令，返回 `flomo-already-succeeded`；没有新增 `source-collection` 启动、没有调用 Flomo 扫描器，来源启动数保持 6，自动化尝试计数保持 0。该检查证明已成功状态会阻止重复采集，但不替代 W43 正式定时触发与 05:00 消费验收。

## 2026-10-21 第二次手动限制性真实同步

- **执行：**按用户再次授权，在已完成的 W42 上用 `weekly:retry --mode manual --source flomo --skip-prepare --skip-flomo-review-import` 执行单次真实全量扫描；`--max-duration-ms 540000` 把本次测试限制为 9 分钟，不编排后续重试。执行前确认 W42 状态锁、浏览器队列锁均不存在，Flomo guard 非活动，且 W43 目录不存在。
- **执行记录：**automation ID `learn-x-flomo-manual-limited-2026-10-21`；invocation `f2a9f4a8-5aff-4b45-8952-83a395e48850`；运行约 157 秒后成功，W42 Flomo 尝试数由 6 增至 7；完成后 guard 为 `active=false`，锁已释放。
- **快照与筛选：**新活动快照 ID `64fad582-06db-4c16-b0d0-70fd24346bde`，采集时间 `2026-10-21T07:35:48.222Z`；976/978，缺口 2（在最多 10 条容差内），稳定到底，49 页。活动快照 ID/采集时间与 W42 `flomo.md` 一致；周输入为 `ready`，18 条及 18 个来源链接，标题创建日期均在 2026-10-12 至 2026-10-18。检查仅核对状态、快照元数据、标题日期和链接计数，没有读取或展示笔记正文。
- **结论与边界：**限制性真实扫描、快照激活和 W42 周材料同源性通过；W43 目录仍不存在，因此 2026-10-26 正式周一同步仍会扫描完整 W43。该测试不替代正式调度、05:00 去重消费及 07:00 补救验收。
- **后续调度核验：**2026-10-21 再次确认 Flomo 周一 00:10 自动化为 `ACTIVE`；首次运行验收 heartbeat 也为 `ACTIVE`，安排在 2026-10-26 10:00（Asia/Shanghai），提示仅只读检查 W43 正式运行及 05:00 消费证据，不手动触发采集。正式验收仍待运行后完成。

## 2026-10-21 第三次手动 W42 限制性真实同步

- **执行：**按用户指示再次运行 W42 单次 Flomo 全量扫描，使用 `weekly:retry --mode manual --source flomo --skip-prepare --skip-flomo-review-import --max-duration-ms 540000`；执行前确认同周状态锁、浏览器队列锁均不存在，Flomo guard 非活动，W43 目录不存在。
- **执行记录：**automation ID `learn-x-flomo-manual-limited-2026-10-21-r3`；invocation `a2cba99e-a410-4e7c-ac4c-27017b41f975`；运行 154.7 秒后成功，W42 Flomo 尝试数由 7 增至 8，本次 automation 尝试计数为 1。
- **快照与筛选：**活动快照 ID `7a2b6b66-7fa6-41e2-a6a9-c9553d3a5592`，采集时间 `2026-10-21T08:41:31.764Z`；976/978，缺口 2（在最多 10 条容差内），稳定到底，49 页。活动快照元数据与 W42 `flomo.md` 文件头的 ID/时间一致；周输入 `ready`，18 条及 18 个来源链接，18 个标题日期均落在 2026-10-12 至 2026-10-18 范围内（观测到的首末日期为 10-12 与 10-17）。仅检查状态、快照元数据、标题日期和链接计数，没有读取或展示笔记正文。
- **收尾与边界：**采集 guard 恢复为 `active=false`，两个锁均已释放；W43 目录仍不存在。W42 手动同步通过，但不替代 2026-10-26 的正式调度、05:00 去重消费和 07:00 补救验收。

## 2026-10-21 覆盖率缺口策略核验

- **代码语义：**现有快照策略 `MAX_ACCEPTED_MISSING_RECORDS=10` 会接受 1–10 条缺口并标记 `accepted-with-gaps`；采集器在列表到底且观测 ID 连续两轮稳定时结束。因此 `ready` 表示符合现行容差，不表示计数完全相等。证据：`.agents/skills/learn-x-input/scripts/lib/flomo-full-snapshot.mjs:7-8, 41-49, 106-113`、`.agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs:1194-1202`。
- **本次边界：**W42 三次真实扫描均记录 976/978、缺口 2。该成功快照没有逐项解释缺口来源；目前不能判断是线上计数与列表差异还是未枚举记录。没有据此修改采集代码或放宽/收紧策略，避免在根因未知时改变现行授权行为。
- **验收护栏：**更新一次性 heartbeat `learn-x-flomo`，要求 2026-W43 读回覆盖状态、预期/观察/遗漏数、比例及策略，并交叉核对状态侧车、活动快照和 `flomo.md`。策略内缺口要明确报告为“策略内接受但存在缺口”，不得表述为零遗漏或 100% 覆盖；继续禁止读取/展示正文、手动触发采集或改代码/调度。更新后状态为 `ACTIVE`，10 月 26 日 10:00 规则及当前线程目标保持不变。
- **验证：**自动化配置读回确认 ID、ACTIVE、一次性 RRULE、覆盖率字段、缺口措辞、正文保护和目标线程均正确；未改采集代码。W43 正式运行及 05:00 消费读回仍待发生。

## 2026-10-21 Flomo 覆盖策略定向复验

- **命令与结果：**`rtk proxy node --test .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs`：26/26 通过。测试明确覆盖“普通重复 ID 导致的有界计数缺口可接受”“超过阈值失败关闭”，并验证 `accepted-with-gaps` 与遗漏比例会呈现在快照/预览中。
- **结论：**该复验确认的是现行策略及其可见性，不证明 W42 两条缺口的实际来源。

## 2026-10-21 W43 只读验收证据门槛补充

- **快照读取：**验收 heartbeat 明确从 `storage-mode.json` 的 `activeSnapshotPath` 定位活动快照，只读顶层元数据，不访问 `records` 或笔记正文；交叉比较状态侧车、快照和 `flomo.md` 的来源 ID 与覆盖数。
- **05:00 去重证明：**要求取得该次 05:00 运行记录以及 Flomo 明确跳过/已成功的证据；尝试计数未变化单独不足以证明主流程消费了 W43 状态。heartbeat 保持 ACTIVE，未触发采集或更改调度。

## 2026-10-21 W42 状态复核

- **运行读回：**W42 状态侧车确认最新 invocation `a2cba99e-a410-4e7c-ac4c-27017b41f975`、automation ID `learn-x-flomo-manual-limited-2026-10-21-r3`、尝试 8、状态 `succeeded`；开始时间 `2026-10-21T08:38:57.369Z`（16:38:57 Asia/Shanghai），守卫于 `2026-10-21T08:41:32.070Z`（16:41:32）结束且 `active=false`。`_source-status.json` 为 `ready`、18 条；活动快照指针为 `7a2b6b66-7fa6-41e2-a6a9-c9553d3a5592`，覆盖状态 `accepted-with-gaps`，976/978、缺口 2，仍在最多 10 条策略内。
- **当前定向回归：**`rtk proxy node --test .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs`，111/111 通过；包含 05:00 成功消费 00:10 结果不重扫、07:00 对失败来源补救的模拟验证。`git diff --check` 通过。
- **核验范围说明：**本轮辅助统计脚本为了计算标题与链接计数，将生成的 `flomo.md` 全文读入内存，但没有输出或复制正文；因此本轮文件核验不能称为“只读取文件头”。之后只读验收应从文件头/侧车取元数据，不读取正文。

## 2026-10-21 调度时区复核

- **验证与未知：**主机 `date` 返回 `2026-10-21 16:54:53 CST +0800`，Node.js 时区为 `Asia/Shanghai`；自动化均为 `ACTIVE`。官方 Scheduled Tasks 文档确认支持本地项目和 RRULE，但没有说明 RRULE 的时区解释，因此主机时区不能单独证明实际触发时刻；须用首次运行记录中的时区时间核验。官方说明本地项目任务要求电脑和桌面应用保持运行。
- **同类 Cron 实测证据：**应用任务列表显示现有 `learn-x-flomo-20-00` 于 2026-10-07 创建（UTC），为 `kind=cron`、`execution_environment=local`，RRULE 每日 20:00；其 `Last run` 为 `2026-10-20T11:59:56.051Z`，换算为 Asia/Shanghai 是 19:59:56.051，距 20:00 仅早 3.949 秒。新增的周一 00:10 Flomo 任务也是本地项目 `cron`，配置 `FREQ=WEEKLY;BYDAY=MO;BYHOUR=0;BYMINUTE=10`。这条同类型、同环境的真实运行强烈支持 RRULE 按本地时区执行，但不替代 W43 首次运行与 05:00 消费验收，也不证明 heartbeat 的派发时区。
- **回访验收：**一次性 heartbeat 保留实际启动时间核验：从运行历史/来源状态记录核对 Flomo 00:10 首次尝试与 05:00 主流程启动时间，统一换算为 Asia/Shanghai，容许最多 30 分钟派发抖动；也记录 heartbeat 自身实际启动时间。缺少时间证据或窗口偏离时，调度验收失败且不关闭目标。按 OpenAI 官方 Scheduled Tasks 文档对固定时刻使用每日/每周规则的指引，将验收 RRULE 从分钟频率修正为 `FREQ=DAILY;INTERVAL=1;BYMONTH=10;BYMONTHDAY=26;BYHOUR=10;BYMINUTE=0;BYSECOND=0;COUNT=1`；日期、时刻、目标线程和单次触发意图不变，配置读回仍为 ACTIVE。文档：[Scheduled Tasks](https://learn.chatgpt.com/docs/automations)。

## 2026-10-21 调度时区短探针复核

- **17:08 探针：**一次性时间探针与当时线程的账户用量上限失败重叠，未得到可核对的触发时间；之后已清理临时任务，因此这次不能用来判断调度器时区。
- **20:32 探针：**截至 21:38（Asia/Shanghai）目标线程最近运行记录中未找到可见触发结果。应用侧删除返回 `not_found`，本地 TOML 仍残留 `ACTIVE`；本地残留不是运行证据，应用侧任务不存在也不足以区分“已触发后自动结束”和“未触发”。不据此推断时区，正式 2026-W43 运行验收保持未完成。
- **当前验收路径：**保留 `learn-x-flomo` 一次性 heartbeat（本地配置状态 `ACTIVE`，目标时间为 2026-10-26 10:00）；周一 00:10、05:00 的实际启动时间和消费证据仍须在运行后读回。未手动触发 W43 采集或修改调度。
- **短探针清理：**17:08、20:32、21:50、22:00、22:10 的 heartbeat 探针均未在目标线程产生可见时间标记；其中 17:08 与账户用量限制重叠，后续一次性任务因无运行历史无法区分延迟/未触发。22:10 双候选任务之后均通过应用侧 `deleteStatus=deleted` 清理，避免遗留到下个年度 RRULE 命中。探针结果不用于判断生产 `cron` 时区；生产时区以同类 Flomo `cron` 的实际 20:00 启动记录为当前最强证据。
- **22:20 同类 Cron 派发短测：**本地项目、`kind=cron` 临时任务最初设为 22:20 一次性 RRULE，未见运行线程后改为 `FREQ=MINUTELY;INTERVAL=5`。其独立线程 `01a15edf-b455-7fd1-a419-4810c686d33d` 于 `2026-10-21T14:31:22Z` 启动、14:31:33Z 完成，消息回报 `CRON_CANARY utc=2026-10-21T14:31:30Z local=2026-10-21 22:31:30 CST +0800`。这确认本地 Cron 可唤醒并回报时钟；因触发前已改成间隔规则，它不验证原 22:20 固定时刻的时区。首次回报后立即删除，应用返回 `deleteStatus=deleted`；只读治理文本和时钟，未访问 Flomo/项目数据。

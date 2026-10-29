# CASE: Learn-X Flomo 周一前置同步与重试

- 状态：已确认
- 最后核对日期：2026-10-24
- 上下游链接：../../requirements/2026-10-flomo-weekly-sync.md → execution-plan.md
- Type: Major
- Status: In Progress
- Requirement: [2026-10-flomo-weekly-sync](../../requirements/2026-10-flomo-weekly-sync.md)
- Architecture / Planning: None / [Execution Plan](execution-plan.md)
- ADR: None
- Implementation: commit `85424dc`（含初始 Flomo 专项实现）及其后的未提交路径保护、快照/状态安全和回归修复；当前工作树还含相关 Review / 输入流程改动与其他未跟踪工作，不做全树提交、重置或清理
- Acceptance: None
- Version: None

## 执行状态

- 当前有效方案：`execution-plan.md`「方案原文」；用户消息 `01a15c05-2b09-7761-a83d-6ebc22ce521c` 明确要求实施。
- 完整授权范围与阶段顺序：先 ywdev 持续完成方案，再进行第一轮 yw-testing；第一轮后由一名独立 subagent 执行新一轮只读 ywtest，发现授权范围内缺陷由协调者修复并交原测试者复测。依据用户在本会话的直接指令。
- 最后已验证里程碑：M0 规划资产保存；M1 实施与前两轮 yw-testing/ywtest 已完成。W42 经现有默认 EGO 的第三次有界尝试成功（978/980，容差内缺 2；周输入 18 条且 `ready`）；前两次默认沙箱尝试为网络错误。移除临时独立 EGO 后，专用服务/Profile 已卸载并删除，采集器与周一自动化复用现有默认 EGO。
- 剩余事项：2026-10-26 的 W43 正式派发、05:00 去重消费及 07:00 补救仍待运行读回。2026-10-24 只读检查时 W43 的 `_weekly-retry-state.json`、`_source-status.json` 和 `flomo.md` 均尚不存在，符合尚未到触发时间的状态。已按 Weekly Output 的 `projectless` / `~` 模式用隔离 mock 验证重试监督器和同步逻辑；这不证明真实定时唤醒或线上 Flomo 扫描。
- 下一步：不等待 Full Access 决策；隔离 mock 已走通可提前验证的流程，2026-10-26 10:00 heartbeat 将只读核验 W43 状态、活动快照、周文件头和 05:00/07:00 实际处理。
- 持续验收：已创建一次性 heartbeat `learn-x-flomo`，ACTIVE，定于 2026-10-26 10:00（Asia/Shanghai）恢复本线程并只读核验 00:10/05:00/07:00 实际运行证据；它不触发 Flomo 采集，也不是周期任务。2026-10-24 复核 `target_thread_id` 与当前任务 ID 一致，当前任务可见且为 active。由于触发日处于 ISO 周 44，预期采集目标为上一完整周 **2026-W43（10-19 至 10-25）**；回访提示已显式限定该周。
- 时区核验：本机 `/etc/localtime` 指向 `Asia/Shanghai`，Node.js 时区识别为 `Asia/Shanghai`，当前偏移 `+0800`；本地 RRULE 与自动化提示中的 Asia/Shanghai 时间一致。
- 调度复核（2026-10-21 16:06 Asia/Shanghai）：Flomo 周一 00:10、Codex Build 周一 00:10、05:00 主流程及 07:00 补救配置均为 `ACTIVE`；2026-10-26 是 ISO 周 44 的周一，正式采集目标周为 W43（2026-10-19 至 2026-10-25）。
- 自动化提示复核（2026-10-21 16:27 Asia/Shanghai）：直接检查 ACTIVE 的 `learn-x-flomo-00-10` 配置，10 项方案约束均匹配——最近完整 ISO 周、Flomo 单次入口及跳过参数、32 分钟单次/160 分钟总限、20 分钟与更长 Retry-After、人工处理硬停止、干净文件上的单文件修复、现有 Flomo 回归测试、哈希保护回退及成功即停止。10/10 检查通过；未触发采集。
- 下游入口复核（2026-10-21 16:28 Asia/Shanghai）：ACTIVE 的 05:00 与 07:00 自动化提示都要求读取 Learn-X 周流程 Skill；Skill 明确规定 05:00 复用同周已成功 Flomo 状态、不重复扫描，07:00 只恢复尚未成功且可自动重试的来源。现有回归测试 `weekly-retry-supervisor.test.mjs` 覆盖该成功去重/失败补救组合（测试起始行 1630）及 07:00 的冷却、限额和逐来源恢复；这证明执行契约，不替代 2026-10-26 真实调度读回。
- 独立 EGO Profile onboarding 已取消；临时新增的专用服务与 Profile 已卸载并删除，当前采集器和周一自动化复用现有默认 EGO。周一 00:10 Cron 与一次性验收 heartbeat 保持 `ACTIVE`；配置不能证明正式调度触发成功。三个允许自动修复的 Flomo 文件当前都有未提交改动，若届时仍如此，必须跳过代码修复并走原代码的新 TaskSpace 重试。
- 证据：2026-10-22 17:43（Asia/Shanghai）重新读取 `/Users/yuwei/code/learn-x`；`git status --short --branch` 显示 `master...origin/master [ahead 1]`，Flomo Review、输入与周自动化文件均有修改，另有未跟踪 `.agents/skills/learn-x-jingdu-review/` 与 `draft_5b4b062a_folder/`。均按既有工作保护，不做全树提交、reset 或 clean；`git diff --check` 通过。
- 工作区核对时间：2026-10-23（Asia/Shanghai）。

## 来源与落点核对

- 用户完整原方案 → Requirement「来源原文」与 Execution Plan「方案原文」，逐项保持；本 Case 链接两者。
- 用户授权的阶段顺序（ywdev → yw-testing → 独立 subagent ywtest）→ 本 Case「执行状态」。
- Flomo 调度、重试、快照及 Code-only 存储边界 → R1–R7；实时验证状态只按本轮命令与未来运行记录更新。

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

## 2026-10-22 固定时刻只读短测

- **执行与结果：**新增一次性本地项目 Cron `learn-x-cron-2026-10-21-22-50`，计划于 2026-10-21 22:50（Asia/Shanghai）只读取系统 UTC/本地时钟。次日 09:05 读回其自动化任务卡仍为 `Last run: never`，未找到运行线程或时间输出；应用侧删除返回 `deleteStatus=deleted`，本地自动化文件已消失。
- **解释边界：**这条按日历日期约束的一次性 RRULE 没有提供固定时刻派发证据；它与生产周一 `FREQ=WEEKLY` 规则不同，不能据此断言生产任务失效。短测只触发治理读取与自动化元数据核对，没有访问项目文件、Flomo、快照或笔记。
- **同类周规则实测：**另建与生产同为 `FREQ=WEEKLY` 结构的只读任务 `learn-x-cron-2026-10-22-09-15`，设定 09:15（Asia/Shanghai）。独立线程 `01a16130-88f9-7813-962c-00bdd5373764` 于 `2026-10-22T01:19:03Z` 启动，回报时钟为 `2026-10-22T01:19:06Z` / `2026-10-22 09:19:06 CST +0800`，比目标晚约 4 分钟；治理读取成功，只运行两条时钟命令。首次回报后应用删除返回 `deleteStatus=deleted`。
- **解释边界：**该实测支持本地周规则在 Asia/Shanghai 时间附近可唤醒，但实际派发晚约 4 分钟；它不等同于周一 00:10 生产时刻，也不替代 W43 正式调度及 05:00 消费验收。
- **当前状态：**生产 Flomo 00:10、05:00、07:00 与并行 Codex Build 配置仍为 `ACTIVE`；2026-W43 输入目录尚未生成。维持 2026-10-26 10:00 一次性 heartbeat，正式触发时间、周输入/快照一致性及 05:00 消费仍待 W43 实际运行证据。

## 2026-10-22 续接复核

- **实现状态：**当前 `HEAD` 为 `85424dc`（`feat(learn-x): add flomo preflight sync and retries`），包含本任务的监督器、同步器、采集器、测试与周流程 Skill 改动。最新 Flomo 同步器、采集器及快照实现文件无未提交差异；共享监督器及其测试文件出现一组 AI 手动提示完整性改动（哈希校验与回退），属于其他工作，本任务没有修改并已保留。
- **新鲜定向回归：**在上述 AI 手动提示完整性差异出现后，重新运行 `rtk proxy node --test .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-source-adapter.test.mjs`：**158/158 通过**；`rtk git diff --check` 通过。
- **调度读回：**`learn-x-flomo-00-10`、`learn-x-v2`、`learn-x-07-00`、`learn-x-codex-build` 与一次性 `learn-x-flomo` heartbeat 均为 `ACTIVE`；RRULE 分别仍为周一 00:10、05:00、07:00、00:10 与 2026-10-26 10:00 单次回访。
- **独立测试结论：**只读独立 ywtest 报告为 **PARTIAL**；专项测试、快照与来源适配器边界通过，真实自动化唤醒、W43 Flomo 运行及后续消费仍待实时验证。该结论与本轮回归一致，不把模拟测试升级为线上通过。
- **剩余事项：**W43 目录尚未生成；正式 00:10 实际启动时间、同周状态/尝试记录、活动快照与 `flomo.md` 同源性，以及 05:00 明确消费/跳过证据仍待 2026-10-26 运行后只读验收。07:00 只有在来源仍失败且可自动重试时才核查补救。
- **活动指针访问边界：**验收 heartbeat 原提示要求读取 `~/Library/Application Support/Learn-X/flomo-review/storage-mode.json` 及其活动快照元数据。项目代码 `defaultFlomoPrivateDataRoot()` 将此根目录解析到该路径；仓库侧状态虽保存 `snapshotId`/`capturedAt`，但不能单独证明活动指针当前值。本轮通过 Codex 自动化管理接口移除了 heartbeat 的直接读取指令，并加入禁止经脚本、CLI、子进程、Skill、插件或 MCP 间接访问的规则；若用户之后授权，heartbeat 也只读取 `storage-mode.json` 与活动快照顶层元数据，不读取 `records` 数组或笔记正文。00:10 Flomo 任务新增前置访问闸门，无确切路径授权时必须在调用 `weekly:retry` 前停止。读回确认两项任务均仍为 `ACTIVE`、原 RRULE 未变；heartbeat 无授权时须标记未验证并保持目标未完成。本轮没有读取该目录。正式验收若要求独立核对活动指针，须先取得用户对该目录只读访问的明确授权；Flomo 扫描还需要该根目录的读写授权；未获授权时不以侧车替代。
- **核对时间：**2026-10-22 09:34（Asia/Shanghai）。

## 2026-10-22 目标续接与新鲜回归

- **需求/阶段：**再次核对 Requirement R1–R6 与已确认方案；ywdev、首轮 yw-testing、用户指定的独立只读 ywtest 均已有完成记录。独立测试结论仍为 `PARTIAL`，因为正式 W43 调度与线上运行尚未发生。
- **本轮回归：**`rtk proxy node --test .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-source-adapter.test.mjs`：**158/158 通过**；四个核心实现文件 `node --check` 通过；`rtk git diff --check` 通过。
- **当前调度读回：**本地自动化配置中 `learn-x-flomo-00-10`、`learn-x-v2`、`learn-x-07-00`、`learn-x-codex-build` 均为 `ACTIVE`，对应周一 00:10、05:00、07:00、00:10；`learn-x-flomo` 一次性验收 heartbeat 为 `ACTIVE`，目标 2026-10-26 10:00。W43 周输入目录在 2026-10-22 09:37 尚不存在，符合正式运行前状态。
- **权限闸门：**自动化提示已要求对 `/Users/yuwei/Library/Application Support/Learn-X/flomo-review` 的明确路径授权；当前用户续接指令给予广泛任务授权，但未明确提及该具体路径。本轮没有读取或经由其他程序访问 `/Users/yuwei/Library/`。因此周一真实采集不能在授权缺失时启动；活动快照指针独立读回也保持未验证。
- **工作区保护：**本任务的全量同步、采集与快照实现文件当前无未提交差异；共享监督器及 Flomo 回顾交付文件仍有其他工作区改动，未修改。未运行可能递归重建 `dist/` 的全仓测试入口。
- **下一步：**若用户对上述确切目录给予读写授权，自动化可按现行方案执行 W43；否则访问闸门应停止任务，并由用户补充授权。无论哪种情况，2026-10-26 后都需读取实际调度/状态证据，核对活动快照、W43 `flomo.md` 及 05:00 消费；真实调度与数据结果未验证前保持 Case `In Progress`。
- **核对时间：**2026-10-22 09:37（Asia/Shanghai）。

## 2026-10-22 路径授权闸门复核

- **当前状态：**再次续接后复核到 2026-10-26 00:10 Flomo Cron 仍为 `ACTIVE`，一次性验收 heartbeat 仍为 `ACTIVE` 且计划于 10:00；W43 输入目录尚不存在。W43 真实采集和线上验收仍未发生。
- **授权条件：**当前用户重复确认继续目标和宽泛授权，但尚未明确点名并确认访问 `/Users/yuwei/Library/Application Support/Learn-X/flomo-review/`。由于该路径位于默认禁止访问的 `~/Library/` 下，00:10 自动化按现有前置闸门不得调用 `weekly:retry`；本轮没有访问该目录或其内容。
- **恢复条件：**用户明确授权上述确切路径的读写后，才能执行全量 Flomo 同步；活动指针验收仅需读 `storage-mode.json` 与活动快照顶层元数据，不读 `records` 或正文。收到授权后重新核对自动化上下文是否能承接该授权；若不能，先更新任务提示中的明确授权范围再执行。
- **核对时间：**2026-10-22 09:39（Asia/Shanghai）。

## 2026-10-22 Flomo 数据改存 Code 目录

- **用户决策：**今后项目数据与运行状态不存放在 `~/Library/Application Support`，优先放在 Code 项目目录。本任务只启用 Learn-X 忽略目录 `04_output/_dist/flomo-review/online-full/`；不读取、迁移或删除此前的 Library 数据。
- **实现：**快照库的默认路径由仓库内模块位置推导；采集器、周同步器、在线回顾共用该路径。另修正暂存函数未传 `storageRoot` 时仍回退到旧父目录的问题。运行目录权限为 `0700`，私有文件写入权限为 `0600`。该目录已由失败的手动扫描创建，模式为 `0700`，当前尚无 `storage-mode.json`。
- **自动化读回：**周一 00:10 Flomo Cron 与验收 heartbeat 的提示均改为 Code 路径；不再含 Library 路径或对应访问授权闸门。两条任务均保持 `ACTIVE`，原触发规则和目标线程未变。
- **W42 实测：**路径修改后的手动全量扫描于 `2026-10-22T02:45:01Z` 以 `network-transient` 失败；来源侧车为 `failed`、数量 `0`，记录保留已有周输入与最近成功快照，重试时间为 `2026-10-22T02:55:02Z`。因此尚未产生新的 Code 本地活动快照，真实采集链路仍需在冷却后重试。
- **验证：**Flomo 全仓专项 `npm run test:flomo:review` 为 **166/166 通过**。修改后核心同步、采集、快照、监督器与工作流模拟测试为 **161/161 通过**；两个 Skill 的 quick validation 均通过，`git diff --check` 通过。全仓 `npm test` 为 **700/702**；两项失败来自 `app/code/scripts/build-static-data.test.mjs` 的构建入口断言及本地构建子进程，和 Flomo 变更无关，仍需独立判断是否为并行构建测试冲突。
- **待办与边界：**等待网络状态改善后再决定是否重试 W42，不绕过冷却，也不在同一瞬时网络错误上盲目重复。之后由独立测试者复核路径回退、权限、快照激活与调度边界。W43 的周一正式调度、05:00 去重消费及 07:00 补救仍待实际运行验收。没有访问旧 Library 路径。
- **核对时间：**2026-10-22 02:46 UTC。

## 2026-10-22 Code 路径守卫复核与 W42 重试结果

- **用户存储偏好：**项目数据与运行状态不放在 `~/Library/Application Support`，优先使用 Code 项目内的忽略目录。该偏好已记录；未读取、迁移或删除旧路径数据。
- **路径审查修正：**独立复核发现 Flomo 归档读取和回顾上下文构建仍有仓库软链接越界路径；后续自查又覆盖到历史收据附件路径。`catalog.mjs`、`context.mjs` 与 `delivery.mjs` 现通过共享解析器限制读取路径，项目输入和附件均须落在 Learn-X 根目录内；新增归档根、来源侧车、周材料、Memory 目录及原始/下载附件的软链接拒绝测试。Library 测试只在临时目录创建软链接，校验目标路径字符串在探测或读取前被拒绝，没有访问目标。
- **回归证据：**`npm run test:flomo:review` **176/176 通过**；六个同步、采集、快照、监督器及周工作流文件 **163/163 通过**；变更模块/测试 `node --check` 与 `rtk git diff --check` 通过。独立路径复核确认直接路径、软链接、归档/上下文路径和项目外附件均在读取前被拒绝；复核者未运行可能触达 Library 的测试，也未访问 Library。
- **W42 线上结果：**Code 路径迁移后的最新尝试使用 automation ID `learn-x-flomo-code-root-migration-2026-10-22-r3`，invocation `484076cc-2b1a-4246-9d6d-f063f157ee9c`，于 `2026-10-22T03:07:35.676Z` 启动、`03:07:36.315Z` 结束，638 ms 后以 `network-transient` 失败。同周状态 `sameErrorCount=3`、`nextRetryAt=2026-10-22T03:17:36.315Z`；来源侧车为 `failed`、count 0、`preservedStaleFile=true`。Code 活动目录当前为空，没有新快照；状态保留的是既有成功快照元数据。没有绕过冷却或再次盲目重试。
- **待验收边界：**路径检查与文件打开之间仍存在需要并发恶意替换软链接才可触发的 TOCTOU 竞态，尚未用句柄式路径遍历消除或验证。W42 Code 路径真实采集仍未通过；周一 00:10 正式 W43 采集及 05:00/07:00 实际去重/补救仍待 2026-10-26 后读回。自动化调度保持原计划。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 Code 暂存路径补齐与 ywdev 续接

- **发现与修复：**复核真实调用链时发现 `scanFlomoWithEgo` 仍把包含笔记正文的浏览器结果 JSON 写进系统临时目录。现将每次扫描结果写入项目私有根 `04_output/_dist/flomo-review/online-full/staged/scan-result-<invocation>.json`，创建前校验目录和路径，目录权限 `0700`、结果文件权限 `0600`，父进程结束后删除；全量扫描和兼容的周扫描入口都使用该 Code 根。生产采集器不再引用 `os.tmpdir()`。
- **目录读回：**Code 私有根不是软链接且权限为 `0700`；`staged/` 权限为 `0700`、当前为空；`storage-mode.json` 尚不存在，因此当前没有新的活动快照。Git 忽略规则 `.gitignore:7` 的 `04_output/*` 覆盖该运行目录。
- **新鲜验证：**采集器、快照、同步器 3 个文件 **59/59 通过**；六个周监督、工作流、同步、采集、快照和来源适配器测试 **164/164 通过**；Flomo Review 专项 **176/176 通过**；隔离临时 worktree 中串行运行全仓 `npm test -- --test-concurrency=1` **708/708 通过**。三个相关 Skill 的 `quick_validate.py`、变更脚本 `node --check`、`git diff --check` 均通过。临时结果路径测试确认其位于指定私有根、目录为 `0700`、结果文件为 `0600`，失败后临时文件已删除。
- **W42 状态：**本轮重新读取的同周状态仍为 `failed`，最后一次 Code 路径采集于 `2026-10-22T03:07:36.315Z` 以 `network-transient` 结束，638ms；连续同类错误数为 3，冷却已过，活动尝试为空，来源侧车仍为 `count=0/preservedStaleFile=true`。没有新的 Ego 专属连通性证据，故不重复启动相同扫描。此项真实采集仍未通过。
- **方案边界更新：**本节之后的 Code 路径决定已取代本 Case 较早记录中的 Library 路径授权闸门与恢复条件。所有现行任务只使用 Learn-X Code 忽略目录；不得读取、迁移或删除旧 Library 数据。
- **阶段状态：**ywdev 本地实现与验证、协调者第一轮 yw-testing、一次新的独立只读 subagent ywtest 均已完成。该独立复测发现项目外暂存包可激活的 P2，修复后由同一测试者复测通过。W42 真实采集及 W43 正式调度、05:00 去重消费与 07:00 补救仍未验证。
- **核对时间：**2026-10-22 11:31（Asia/Shanghai）。

## 2026-10-22 暂存根越界修复与独立复测收口

- **复现：**使用合成记录，将暂存包写到模拟项目外的临时目录，再调用激活入口；原实现返回 `activated` 并创建模拟项目活动指针。真实 Learn-X 运行目录未被用于该复现。
- **根因：**采集器只把暂存产物限制在调用者传入的 `storageRoot`；该参数可以位于项目外。激活入口验证 bundle 完整性，却未在读取 bundle 前把解析后的快照路径限制到当前项目私有根。
- **修复：**共享解析器现在要求 storage root 位于对应项目目录内；周采集、全量采集、浏览器暂存和周同步入口都复用该检查。暂存包读取可带允许根，并在读取内容前拒绝根外路径；在线激活固定使用项目私有根。临时项目与真实 Learn-X 使用同一默认根推导。
- **新增回归：**项目外 storage root 在扫描启动与暂存写入前拒绝；项目外有效暂存包无法激活，项目活动指针保持未创建。
- **协调者验证：**核心 6 个测试文件 **147/147 通过**；Flomo Review **177/177 通过**；隔离 worktree 串行全仓 `npm test -- --test-concurrency=1` **709/709 通过**；变更 `.mjs` 的 `node --check` 与 `git diff --check` 通过。
- **独立 ywtest：**同一只读测试者确认两项新增回归通过，7 个 Flomo 采集、快照、周同步与 Review 测试文件 **218/218 通过**，14 个相关 `.mjs` 语法检查与 `git diff --check` 通过；未修改共享工作树，未启动真实采集。
- **线上边界：**W42 最后状态仍是 `network-transient`、来源 `failed/count=0`、保留旧周输入；Code 活动根无新 `storage-mode.json` 或活动快照。2026-10-26 W43 00:10、05:00、07:00 运行读回仍待实际触发。
- **访问边界说明：**本轮较早阶段曾调用 RTK 命令；不能确认 RTK 是否间接触及其 `~/Library/Application Support/rtk` 状态目录。发现与用户的 Library 禁止规则冲突后已停止使用 RTK；未直接读取、扫描或检查该目录，后续验证均用 `login:false` 的直接命令。不得据此声称从未发生间接访问。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 ywdev 续接与冷却路径复核

- **历史时间戳释义：**W42 记录中的第 9–11 次尝试均标为 `attemptKind=manual`，各自的 `nextRetryAt` 距失败时间约 10 分钟；这些记录来自普通手动入口，不能作为专项自动化冷却时长的证据。当前 `--single-attempt` 分支把失败完成时间 + 20 分钟与持久化 `nextRetryAt` 取较晚值，并限制每个自动化 ID 最多启动三次。
- **新鲜验证：**`node --test --test-name-pattern='Flomo single-attempt runner' .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs` **4/4 通过**；监督器完整测试 **84/84 通过**；Flomo 采集、快照、周同步测试 **60/60 通过**；Flomo Review 专项 **177/177 通过**。本轮 `git diff --check` 通过，未修改业务代码。
- **真实采集边界：**W42 最新状态仍为 `failed/network-transient`、`count=0/preservedStaleFile=true`，Code 根没有 `storage-mode.json`。本轮没有重启扫描。Ego Browser Skill 文档说明 TaskSpace 会选用浏览器 profile，且 profile cookie jar 与用户标签页及其他 TaskSpace 共享；本地说明没有给出底层 profile 的磁盘路径。因此在确认运行时不触及被禁止的 `~/Library/` 之前，不启动真实扫描，不把本地模拟当成线上通过。
- **调度读回：**`learn-x-flomo-00-10`、周一 05:00 主流程、07:00 补救流程、Codex Build 00:10 与 W43 一次性验收 heartbeat 均为 `ACTIVE`；这些是配置证据，不证明实际派发时间。W43 的真实采集、快照/周文件同源核对、05:00 去重消费及 07:00 补救仍待运行证据。
- **核对时间：**2026-10-22 15:47（Asia/Shanghai）。

## 2026-10-22 独立 ywtest 临时路径修复

- **独立复核：**协调者指定的只读 ywtest 子代理审查了 R1–R6、自动化配置、周同步入口与本地测试。它没有复现 P0/P1；真实浏览器端到端及定时运行仍未验证。审查期间一次搜索范围偏宽，输出意外包含受保护的未跟踪目录名下的少量行；复核者停止继续读取，未执行或修改该目录内容。
- **P2 夹具问题与修复：**测试原先把 CLI 全量扫描的 storage root 放到 Learn-X 仓库目录，且只清理子目录。测试现在把相关脚本复制到系统临时目录中的隔离 Learn-X 仓库，再在那里运行真实 CLI；先对临时根执行 `realpath`，使 macOS `/var/folders` 与 `/private/var/folders` 路径别名下的 CLI 入口判定保持一致。整个夹具由临时根 teardown 清理，不再创建仓库内测试数据目录；旧测试留下的空父目录也已用非递归 `rmdir` 清除，没有删除任何文件。
- **新鲜验证：**`node --test --test-reporter=dot .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs` 通过；采集器、全量快照、周同步三个文件合并复测 **60/60 通过**；`git diff --check` 通过。
- **剩余边界：**代码根目录的 W42 真实采集仍为 `network-transient`；未启动 Ego Browser，因为无法证明其 profile/runtime 不会访问被禁止的 Library 路径。W43 周一 00:10、05:00 去重消费、07:00 补救及调度时刻仍待实际运行读回。用户再次明确新项目数据/运行态不放 `~/Library/Application Support`，优先放对应 `~/code/<project>` 并设为私有权限；该偏好已写入持久记忆，本次未访问、迁移或删除任何旧 Library 数据。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 独立复核与 W42 单次重试

- **独立复核：**新的只读 ywtest 确认临时路径修复、CLI 失败诊断、0700/0600 权限和周新建筛选静态边界无新增缺陷；专属失败路径测试通过。它指出 05:00/07:00 实际调度行为仍需运行后读回，不把静态测试当线上验收。
- **W42 真实尝试：**按用户已授权的限制性测试入口运行一次：`npm run weekly:retry -- --week 2026-W42 --mode manual --source flomo --automation-id learn-x-flomo-w42-manual-test-2026-10-22 --single-attempt --skip-prepare --skip-flomo-review-import --max-duration-ms 1920000`，并将 `EGO_HOME` 指向 Learn-X Code 忽略目录 `04_output/_dist/flomo-review/ego-runtime/`。执行器于 `2026-10-22T08:20:52.149Z` 开始，`08:20:52.477Z` 以 `network-transient` 结束；invocation ID 为 `0fff52f4-5133-4a0b-872e-e320759282a4`，自动化尝试计数为 1，状态锁已释放。下次允许重试时间为 `08:40:52.477Z`。
- **失败保护读回：**W42 `_source-status.json` 为 `failed/count=0/preservedStaleFile=true`；Code 活动根仍无文件，未激活新快照，已有周输入被保留。Code 根目录权限为 `0700`。`ego-runtime` 目录未被创建；没有读取或枚举 Ego profiles，底层浏览器 profile 的磁盘位置仍未知，因此不能据本次失败宣称浏览器侧运行时路径已验证。
- **Ego 启动探针：**16:31（Asia/Shanghai）默认沙箱执行只读 `ego-browser nodejs` 探针失败，返回 Launch Services/XPC 启动错误；以 Full Access 重跑同一条不打开网页、不创建 TaskSpace、只读取 `process.env.EGO_HOME` 的探针后正常启动并输出 `null`。这证明嵌入式 Node 不继承外层 shell 的 `EGO_HOME`；并未证明 Ego profile 的底层存储位置，也未检查 profile。后续真实采集需使用可启动 Ego Lite 的 Full Access 命令，Flomo 快照仍固定写入 Code 项目根。
- **生产自动化权限门：**尝试将 `sandbox_permissions=require_escalated` 加到每周持久自动化 `learn-x-flomo-00-10`，但自动审查拒绝，理由是每周 Full Access 会扩大本机与浏览器运行时权限边界，而当前授权只明确覆盖 Flomo 自动化与 Code 存储。拒绝后生产自动化未修改，仍为 `ACTIVE`；一次性 W42 heartbeat 的有限重试指令已更新为请求 Full Access。持续生产权限需用户明确授权，未尝试任何绕过方式。
- **下一步与限制：**不在 20 分钟冷却前重试。当前 W42 结果仍未同步成功；一次性 heartbeat `learn-x-flomo-w42` 已读回为 `ACTIVE`，定于 2026-10-22 16:45（Asia/Shanghai）恢复本线程，冷却后按同一自动化 ID 执行剩余有界重试；原 W43 验收 heartbeat 保持不变。2026-10-26 W43 00:10 真实运行及 05:00 去重消费、07:00 补救仍待实际读回。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 W42 Code 根重试验收

- **真实运行：**冷却到期后以 Full Access 启动第二次单来源尝试；automation ID `learn-x-flomo-w42-manual-test-2026-10-22`，invocation `5386515f-d998-4cbe-8d37-1974603fffc1`，开始于 `2026-10-22T08:41:21.756Z`，采集于 `08:44:16.364Z` 完成，耗时 174,814 ms。该测试 ID 共 2 次真实尝试：第一次 `network-transient`，第二次 `succeeded`；W42 总尝试数 13，执行锁已释放。
- **快照与周输入读回：**状态 `ready/count=18`；活动快照 ID `3a5330f3-1d20-4def-b3ec-33257960bf05`，采集时间 `2026-10-22T08:44:16.364Z`，与 `storage-mode.json`、快照文件前 18 行元数据及 `flomo.md` 文件头一致。全库覆盖为 `accepted-with-gaps`，976/978，漏 2 条（99.80%，策略最多 10 条），不得表述为零遗漏；49 页完成。W42 文件头目标数 18；仅抽取条目标题日期，18 条均在 2026-10-12 至 2026-10-18 的目标周内，最早 10-12、最晚 10-17，无越界。活动根为 Code 忽略目录，目录 `0700`、快照/指针/周文件 `0600`。
- **验收脚本偏差：**首次标题日期计数脚本错误地对 `flomo.md` 调用了 `read_text()`，将全文（含笔记正文）载入进程内存；因标题与来源行之间有空行，脚本返回 0。它没有输出、复制或持久化正文。随后改用仅提取标题及来源标记的过滤器，得到上述 18 条日期结果。该首次读取超出了“只核对头部/计数/标题日期”的边界，作为本次验收偏差保留记录。
- **后续自动化：**一次性 W42 heartbeat 已在同步成功后删除，避免重复扫描；W43 首次运行验收 heartbeat 仍保留。周一生产 Cron 仍为 `ACTIVE`；将 Full Access 固定加入该每周任务的更新被自动审查拒绝，未作变更，等待用户明确授权。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 存储路径偏好与默认沙箱探针

- **存储路径偏好：**用户重申今后项目数据和运行状态不得放在 `~/Library/Application Support`，优先存放于对应 `~/code/<project>` 的 Git 忽略目录并使用私有权限。该偏好已存在长期记忆。本次未读取、迁移或删除任何 Library 下的数据。
- **活跃 Flomo 自动化核对：**`learn-x-flomo-00-10` 为 ACTIVE，提示词将活动快照和采集暂存固定在 `/Users/yuwei/code/learn-x/04_output/_dist/flomo-review/online-full/`，并明确禁止写入或访问 Library。每日 `learn-x-flomo-20-00` 也为 ACTIVE，提示词无 Library 路径引用；回顾运行时由 `review.mjs` 将运行文件写入 Learn-X 项目私有根。没有改动调度。
- **默认沙箱 Ego 启动探针：**执行 `ego-browser nodejs -e 'console.log("ego-bootstrap-ok")'`，默认沙箱成功并输出 `ego-bootstrap-ok`。未打开网页、未创建 TaskSpace，未检查或枚举浏览器 profile；因此只证明当前会话下嵌入式 Node 可启动，不代表已验证下周调度时的启动条件或 profile 磁盘位置。
- **核对时间：**2026-10-22 16:49（Asia/Shanghai）。

## 2026-10-22 yw-testing 当前工作树复测

- **Flomo 核心回归：**`node --test --test-concurrency=1 .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs .agents/skills/learn-x-input/scripts/source-status.test.mjs .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/backfill-flomo-identity.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-weekly-automation/scripts/generate-ai-review.test.mjs` **207/207 通过**。覆盖单次尝试冷却/硬阻塞/最多三次、05:00 成功去重和 07:00 补救、全量扫描失败保留快照、路径逃逸拒绝及目标周筛选。
- **Review 回归：**`npm run test:flomo:review -- --test-concurrency=1` **177/177 通过**，包含 Library 路径/软链接拒绝、活动指针逃逸拒绝与失败安全。
- **全仓测试：**`npm test -- --test-concurrency=1` 两次均为 **738/739**。第一次在 `build-static-data.test.mjs` 的 public 构建子进程失败；该文件隔离重跑 **7/7 通过**。第二次在 `chatpack-cache.test.mjs` 的 24 小时定时器用例失败；隔离复跑 **1/1 通过**。两次失败项不同，当前证据未指向 Flomo；全仓命令仍记录为非全绿，不宣称通过。测试后已重新生成本地 `dist`（`--target=local`），并确认本地周期洞察路由标记存在。
- **工作区保护：**`git diff --check` 通过；本轮未改业务代码，未触碰既有未跟踪 `draft_5b4b062a_folder/` 或 Jingdu 工作。相关修改继续留在原工作树。
- **剩余验收：**W43 周一 00:10 自动化真实派发及 05:00 去重消费、07:00 是否补救仍待 2026-10-26 运行后读回；配置 `ACTIVE`、W42 手动成功和本地测试都不能替代该证据。
- **核对时间：**2026-10-22 16:58（Asia/Shanghai）。

## 2026-10-22 私有状态侧车权限修复

- **现状与根因：**只读 W42 元数据确认全库状态为 `succeeded`、目标周来源 `ready/count=18`、活动快照 ID `3a5330f3-1d20-4def-b3ec-33257960bf05`；覆盖率为策略内接受的 976/978（漏 2 条）。快照根 `0700`，活动指针、快照、`flomo.md` 均为 `0600`，但 `_source-status.json` 原为 `0644`。根因是共享状态写入器用默认 umask 创建原子临时文件。
- **修复：**`.agents/skills/learn-x-input/scripts/lib/source-status.mjs` 原子临时文件现在显式使用 `0600`；新增测试验证首次创建和覆盖既有 `0644` 文件后都为 `0600`。将当前 W42 `_source-status.json` 权限收紧到 `0600`，未改其内容；仅读取状态字段和活动指针元数据，没有读取笔记正文或快照记录。
- **协调者验证：**`node --test --test-concurrency=1 .agents/skills/learn-x-input/scripts/source-status.test.mjs` **12/12 通过**；Flomo 输入、快照、状态、同步、重试及 AI 回顾相关测试 **208/208 通过**；Flomo Review 专项 **177/177 通过**。
- **独立复核：**此前独立测试者针对该修复复跑 `source-status.test.mjs`，**12/12 通过**；没有发现同一运行账户下的兼容回归。跨 UID 状态侧车消费者与非协作进程竞争未验证；当前仓库内消费者均按同一账户路径检查。
- **未完成验收：**W43 周一 00:10 实际派发、05:00 去重消费及 07:00 补救仍待 2026-10-26 运行后读取真实记录；本地测试和 W42 手动采集均不能替代该证据。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 Ego TaskSpace 路径配置核查

- **Learn-X 自有数据：**采集器通过 `resolveFlomoPrivateDataRoot` 将扫描结果暂存至 `04_output/_dist/flomo-review/online-full/staged/`，结束后清理；活动快照和周输入也固定在该 Code 忽略目录。
- **Ego 内部状态：**采集器通过 `execFile("ego-browser", ...)` 调用应用捆绑的 CLI。当前安装的 Ego Skill 与 `browser-runtime-governance` 文档说明 TaskSpace 生命周期/API，但没有提供其磁盘根目录配置；本地扫描器也没有引用 `EGO_HOME`。因此只确认 Learn-X 自有快照、状态和暂存位于 Code，Ego 内部 TaskSpace/Profile 状态路径仍未知，不能声称其也在 Code。
- **访问边界：**本次只读代码、Skill、治理文档和 CLI 二进制字符串，没有启动浏览器、创建 TaskSpace、读取或枚举 Profile，也没有访问 `~/Library/Application Support`。
- **调度状态：**周一 00:10 Flomo Cron 和 2026-10-26 10:00 一次性验收 heartbeat 仍为 `ACTIVE`；W43 输入目录尚未生成。未知的 Ego 内部状态路径不改变 Learn-X 自有数据根目录；W43 正式同步及 05:00/07:00 运行结果仍待实际验收。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 单次自动化旧状态去重修复与独立 ywtest

- **独立复现的缺陷：**若目标周侧车在新 `learn-x-flomo-00-10` 自动化启动前已是 `ready`，监督器先吸收旧成功状态，再把本次单次尝试判为已完成，结果扫描调用数为 0。这会使周一前置任务没有刷新全库快照。
- **根因与修复：**单次 Flomo 自动化此前仅按来源 `status=succeeded` 去重，没有确认成功尝试属于当前 automation ID。现在仅当当前 automation ID 已有持久成功尝试且 `lastAutomationId` 匹配时才跳过；新 automation 会执行一次扫描，后续重复触发仍会去重。
- **新增回归：**合成预置旧 `ready` 侧车后验证首次调用采集器并持久化本 automation 的尝试；再次调用同一 automation ID 则跳过。新增用例单项通过 **1/1**。
- **W42 当前态复读（2026-10-22 17:38 Asia/Shanghai）：**目标周状态仍为 `succeeded`，手动测试 automation ID 有 2 次尝试；`_source-status.json` 为 `ready/count=18`。状态快照 ID `3a5330f3-1d20-4def-b3ec-33257960bf05`、采集时间 `2026-10-22T08:44:16.364Z` 与 Code 活动指针 ID 一致；活动快照和 W42 文件头报告 976/978、遗漏 2 条（现行策略容差内）。仅读取状态侧车、活动指针及 `flomo.md` 前 14 行头部，没有读取笔记正文；这不替代 W43 自动调度验收。
- **周文件隐私落点复核（2026-10-22 17:40 Asia/Shanghai）：**W42 `flomo.md`、`_source-status.json` 与 `_weekly-retry-state.json` 均由 `.gitignore:36` 的 `03_input/weekly/*` 忽略，没有被 Git 跟踪；三个文件实际权限均为 `0600`。检查仅读取 Git 跟踪/忽略状态和文件元数据，没有读取正文。
- **协调者验证：**周采集、快照、周同步、共享状态、Flomo 单次重试和 AI Review 相关 8 个测试文件 **213/213 通过**；`git diff --check` 与重试监督器及新增测试的 `node --check` 通过。
- **独立 ywtest：**只读复核同步→校验→激活→周文件发布顺序、快照锁、时间单调性、尝试 UUID/TaskSpace 绑定、冷却/重试上限、失败分类及 05:00/07:00 本地流程。相关周/Flomo 回归 **158/158**、Flomo Review **177/177**、新增单项 **1/1**、语法及 diff 检查均通过；未发现其他已知 P0/P1 阻断问题。
- **本轮聚焦复跑（2026-10-22 17:39 Asia/Shanghai）：**仅运行新增的旧 `ready`/新自动化回归，用例 **1/1 通过**；`git diff --check` 通过。
- **05:00/07:00 本地流程复跑（2026-10-22 17:41 Asia/Shanghai）：**针对 05:00 复用 00:10 成功 Flomo 结果并避免重扫、07:00 对失败或 05:00 窗口内未完成来源的补救，三个定向用例 **3/3 通过**。这证明本地执行逻辑，不证明定时派发或真实运行结果。
- **Flomo 重试边界复跑（2026-10-22 17:42 Asia/Shanghai）：**重试错误分类、20 分钟冷却与更长持久化退避、成功即停止、非重试错误/登录/人工接管硬停止，以及日志滚动时三次尝试计数，定向用例 **6/6 通过**。第三次自动修复仍只有提示词/护栏审查证据，未触发真实失败编排。
- **快照与周筛选门禁复跑（2026-10-22 17:43 Asia/Shanghai）：**五个同步器合成用例 **5/5 通过**：同一扫描激活并生成周文件、旧笔记修改刷新全量快照但仅新建笔记进入目标周、遗漏超策略或不完整扫描不激活/不替换旧快照，以及过期尝试 token 不得切换活动指针。
- **存储路径偏好：**用户再次要求项目数据和运行状态不得放入 `~/Library/Application Support`，优先放对应 `~/code/<project>` 的私有忽略目录；Learn-X 快照与扫描暂存当前固定在 `04_output/_dist/flomo-review/online-full/`。本轮没有读取、迁移或删除旧 Library 数据。
- **第三次前的自动修复门禁：**当前提示允许检查的三个 Flomo 采集候选文件 `collect-flomo-weekly.mjs`、`sync-flomo-full-week.mjs`、`lib/flomo-full-snapshot.mjs` 都已有工作树改动。若第三次尝试前仍处于 dirty 状态，按用户方案不得修改这些文件；自动化只能在新 TaskSpace 用原代码作最后一次尝试。此门禁保护当前未提交工作，不代表自动修复路径已通过线上验证。
- **未完成线上验收：**W43 周一 00:10 实际唤醒、Ego Lite/Flomo 在线采集、与 Codex Build 并发、05:00 去重消费、07:00 补救，以及第三次失败时的自修复编排均尚未验证。不得以本地测试或配置 `ACTIVE` 宣称线上通过。
- **派发前置复核（2026-10-22 17:35 Asia/Shanghai）：**活动 Cron 配置仍为 `ACTIVE`、RRULE 周一 00:10；一次性验收 heartbeat 为 `ACTIVE`，计划 2026-10-26 10:00。Code 忽略根与 `staged/` 实际权限均为 `0700`，W43 输入目录尚不存在。该配置/目录证据不替代真实调度派发读回。
- **核对时间：**2026-10-22（Asia/Shanghai）。

## 2026-10-22 R1–R6 完成度审计与调度复核

- **R1｜部分完成：**Flomo 00:10、Codex Build 00:10、Learn-X 05:00 和 07:00 均仍为 `ACTIVE`；RRULE 都按周一本地时间设置，本机 `/etc/localtime` 与 Node IANA 区域为 `Asia/Shanghai`。这些是配置证据；W43 实际触发时间及各流程先后仍待运行历史核验。
- **R2｜W42 已实测，W43 待运行：**W42 全量快照成功，976/978，缺 2 条（策略内接受但存在缺口）；活动快照与周文件头 ID/时间一致，18 条标题均限于目标创建周。合成测试覆盖旧笔记编辑刷新全库快照而不进入本周材料。
- **R3｜本地执行逻辑已测，调度编排待实测：**单次 UUID/TaskSpace、20 分钟最短冷却、更长 `nextRetryAt`、硬阻塞与三次上限有监督器测试；自动化提示设置 32/160 分钟限制。多次失败之间的真实自动化编排尚未发生。
- **R4｜W42 与失败门禁通过，W43 待运行：**W42 `_source-status.json` 为 `ready/count=18`，活动快照 ID 与周文件头一致，coverage 为 `accepted-with-gaps` 976/978；合成测试确认缺口超限、不完整扫描或过期 token 不会激活/替换最后成功快照。
- **R5｜条件护栏已配置，修复分支未实测：**提示限制为第三次前、根因明确、单个干净的 Flomo 文件和现有回归测试；当前三个候选文件都 dirty，因此若第三次尝试前状态不变，只允许跳过修复并用新 TaskSpace 重试原代码。
- **R6｜部分完成：**W42 手动线上单次扫描通过，监督器本地测试覆盖冷却、硬阻塞、快照保护、05:00 去重和 07:00 补救；W43 自动化入口真实尝试、实际调度、05:00 消费与 07:00 处理仍无线上证据。
- **调度配置复核（2026-10-22 17:44 Asia/Shanghai）：**四个周自动化均 `ACTIVE`；Flomo 和 Codex Build 都设周一 00:10，05:00 主流程与 07:00 补救保持原时刻。此次仅检查元数据及本机时区，没有运行采集；预期触发校验仍以实际运行时间为准。
- **05:00/07:00 存储入口复核（2026-10-22 17:46 Asia/Shanghai）：**两项自动化都引用 `learn-x-weekly-automation/SKILL.md`，没有自定义 Flomo storage-root 覆盖，也未发现旧 Library Flomo 根路径；共享 `learn-x-input/SKILL.md` 将活动快照和暂存明确固定到 Code 忽略目录，并执行 Library 路径拒绝。此为配置/代码入口证据，仍不证明两条定时任务的真实运行结果。
- **Code 存储边界定向复跑（2026-10-22 17:47 Asia/Shanghai）：**项目默认根、直接 Library 路径、仓库外落点、宽权限暂存目录、项目外暂存包、活动指针/Review 软链接逃逸等 **9/9 用例通过**；验证均使用临时夹具，没有访问 Library 数据。
- **调度与周次边界复核（2026-10-22）：**直接读回 `/Users/yuwei/.codex/automations/learn-x-flomo-00-10/automation.toml`，状态为 `ACTIVE`、RRULE 为每周一 00:10；提示将快照、活动指针及暂存锁定在 `/Users/yuwei/code/learn-x/04_output/_dist/flomo-review/online-full/`，并禁止访问 `~/Library/Application Support`。用 `defaultWeeklyReviewWeek()` 计算上海时间 2026-10-26 00:10，结果为 `2026-W43`，周范围为 2026-10-19 至 2026-10-25；对应既有默认周次用例 **1/1 通过**。这些仍是配置和确定性逻辑证据，不替代真实调度运行读回。
- **当前工作树定向复测（2026-10-22）：**Flomo 周采集、全量快照、周同步、来源状态、重试监督器及周流程恢复相关六个测试文件 **208/208 通过**；`git diff --check` 通过。未运行线上采集，也未改业务代码。
- **W43 验收唤醒复核（2026-10-23 08:23 Asia/Shanghai）：**本机 heartbeat 配置 `learn-x-flomo` 仍为 `ACTIVE`，一次性计划 2026-10-26 10:00 恢复本线程做只读验收；本次只检查调度元数据，没有提前运行 W43 采集。真实 W43 快照与周输入以及 05:00/07:00 运行读回仍待 10-26。
- **Ego 运行目录选项核查（2026-10-23 08:24 Asia/Shanghai）：**只读检索当前 `ego-browser` Skill 的 Markdown 配置/安装说明，未发现 `EGO_HOME`、profile/user-data-dir 或 runtime storage root 的受支持配置说明；没有启动 Ego CLI 或浏览器。Learn-X 自有 Flomo 快照/暂存已固定在 Code 项目目录，但 Ego 内部 TaskSpace/Profile 的底层路径仍未知，因此不能宣称其运行状态也已迁入 Code。
- **验收 heartbeat 提示边界复核（2026-10-23 08:25 Asia/Shanghai）：**解析本机 `learn-x-flomo` heartbeat 的当前提示（1620 字符）：只核对 W43 状态、活动快照顶层元数据、周文件头/计数/标题日期及 00:10、05:00、07:00 的真实运行历史；明确禁止读取 `records` 或笔记正文、手动采集/重试、改代码或调度。运行时间需按 Asia/Shanghai 实证并满足 ±30 分钟窗口，不能仅以 Cron 配置推断。该提示只读，不含采集或写入命令。
- **W43 派发前状态复核（2026-10-23 08:27 Asia/Shanghai）：**Flomo 00:10 Cron 和 10:00 验收 heartbeat 均仍为 `ACTIVE`；`03_input/weekly/2026-W43/` 及其中的 `_weekly-retry-state.json`、`_source-status.json`、`flomo.md` 均尚不存在，符合周未结束、正式任务未派发的预期。仅读取配置元数据和路径存在性，没有读取周输入或快照正文。
- **Ego TaskSpace 存储边界复核（2026-10-23 08:36 Asia/Shanghai）：**Ego Lite 官方 [Space 文档](https://lite.ego.app/document/en/docs/space)说明每个 TaskSpace 是同一浏览器进程内独立 BrowserContext，包含各自的 cookies 与站点存储，全部留在本机；文档和当前已安装 Skill 未提供把 TaskSpace/Profile 存储根重定向到项目目录的受支持配置。当前只能确认 Learn-X 自有快照/暂存根在 Code，不能证明 EGO 自管上下文的底层路径。未启动 Ego CLI、未创建 TaskSpace、未读取或修改 `~/Library/Application Support`。已向用户确认该禁止规则是否覆盖 EGO 自管的 TaskSpace/Profile；答复前不擅自迁移现有 Profile。
- **TaskSpace 清理路径复核（2026-10-23）：**`collect-flomo-weekly.mjs` 的成功扫描调用 `task.finish({ keep: [] })` 关闭本次空间；扫描失败的最终分支则可能将 Agent-owned TaskSpace 标记为 `retained-after-error`。这说明失败重试可能留下 EGO 管理的任务上下文；由于其存储根不可验证，尚不能声称这些上下文满足 Code-only 约束。仅静态读取采集器生命周期，没有运行采集器或创建空间。
- **EGO TaskSpace Code-only 失败关闭门禁（2026-10-23 08:41 Asia/Shanghai）：**按用户已明确的禁止存入 `~/Library/Application Support`，在 `.agents/skills/learn-x-input/SKILL.md` 和 `learn-x-flomo-00-10` automation prompt 加入同一前置约束：必须有受支持且生效的 Code 存储根证据，否则在创建 TaskSpace/调用 `weekly:retry` 前停止并报告 `ego-taskspace-storage-unverified`；不得读取、迁移、删除或重配现有 Ego Profile。Cron 保持 `ACTIVE` 和周一 00:10；`git diff --check` 通过。未启动 EGO、未创建 TaskSpace、未触发采集。
- **Code-rooted EGO 命名服务接入（2026-10-23 08:49 Asia/Shanghai）：**Ego Lite 官方维护者在 [issue #150](https://github.com/citrolabs/ego-lite/issues/150) 说明以 `--user-data-dir=<dir> --startup-ego-browser-service=<name>` 启动独立 Profile、再用 `ego-browser --ego-server-name=<name>` 连接。已在 Learn-X Git 忽略目录创建权限 `0700` 的 `04_output/_dist/ego-flomo-profile/`，采集器固定连接 `learnx-flomo`；CLI 返回需要先完成 onboarding。当前未创建 TaskSpace、未扫描 Flomo。
- **EGO 动态服务与路径复核（2026-10-23 08:51 Asia/Shanghai）：**`launchctl print gui/$(id -u)` 显示命名端点位于 `com.apple.xpc.launchd.unmanaged.ego lite.45124` 的 dynamic endpoints；`ps -p 45124 -o command=` 只筛选出 `--user-data-dir=/Users/yuwei/code/learn-x/04_output/_dist/ego-flomo-profile` 与 `--startup-ego-browser-service=learnx-flomo`。直接查询该端点作为 launchd job label 会报不存在，根因是它属于动态端点，并非服务进程丢失。Skill 与 ACTIVE 周一 Cron 的 preflight 已改为检查 GUI 域端点、对应 PID 启动参数和命名 CLI；Cron RRULE 仍为周一 00:10。onboarding 仍待用户完成。
- **本轮实现验证（2026-10-23 08:50 Asia/Shanghai）：**Flomo 采集器定向回归 **19/19**；采集器和测试脚本 `node --check`、Skill `quick_validate.py`、`git diff --check` 通过。此为本地验证，不替代新 Profile 的真实 W42 采集与 W43 正式调度验收。
- **独立 EGO 配置移除（2026-10-23 09:03 Asia/Shanghai）：**按用户要求卸载 `com.yuwei.learnx.ego-flomo` launchd job 并删除新建的 `04_output/_dist/ego-flomo-profile/`；恢复采集器调用现有默认 `ego-browser` 服务，并更新 Skill、周一自动化与需求/方案记录，禁止再创建 Flomo 专用 Profile/服务。未触碰原有 Ego Lite Profile、身份或登录数据。复核显示专用目录不存在、launchd job 未加载、Cron 仍为 `ACTIVE` 且周一 00:10；采集器测试 **19/19**、Skill validator、脚本语法和 `git diff --check` 通过。尚未在现有 EGO 上执行 W42 采集。
- **默认 EGO W42 重验（2026-10-23 09:05 Asia/Shanghai）：**在用户此前授权范围内以 automation ID `learn-x-flomo-manual-existing-ego-20261023` 运行一次 `weekly:retry --source flomo --single-attempt`，限制 9 分钟。默认沙箱连接失败；提权只读连通性检查成功后，采集于 33 秒以 `network-timeout` 结束，状态安排下一次不早于 09:25。核对 W42 重试锁、浏览器队列锁和来源状态锁均已释放；失败尝试遗留的 Agent-owned TaskSpace 已按精确 ID/名称关闭，复核 Flomo TaskSpace 列表为空。活动快照仍为 `3a5330f3-1d20-4def-b3ec-33257960bf05`（采集时间 `2026-10-22T08:44:16.364Z`），W42 `flomo.md` 文件头相同，旧快照未被替换。此重验失败，不作为默认 EGO 端到端通过证据。
- **默认 EGO W42 第二次重验（2026-10-23 09:25 Asia/Shanghai）：**同一 automation ID 启动第二次 9 分钟上限的单次 Flomo 尝试；状态记录 `lastAttemptAt=2026-10-23T01:25:31.567Z`、`failedAt=2026-10-23T01:25:32.187Z`、`network-transient`，`retries=1`。W42 来源状态为 `failed/count=0`，摘要明确保留最近成功快照和已有周输入；活动快照仍为 `3a5330f3-1d20-4def-b3ec-33257960bf05`、采集时间 `2026-10-22T08:44:16.364Z`，与 `flomo.md` 头部 ID/时间一致。重试状态锁、来源状态锁和浏览器队列锁均不存在；专用 Ego Profile 目录不存在。
- **提交与消费一致性边界（2026-10-23）：**同步入口在扫描前先将周来源状态写为 `failed/count=0`；周文件在快照激活的提交钩子中发布，活动指针提交后才把来源状态改为 `ready/empty`。因此提交中断可能短暂留下周文件与活动指针不同代，但来源门禁保持失败，下游不会消费该输入。跨文件没有物理事务；成功态下同一快照 ID/采集时间的一致性由验收读回确认。
- **新鲜回归（2026-10-23）：**Flomo 采集、快照、周同步、来源状态和重试流程六文件 **164/164**；`npm run test:flomo:review` **178/178**；目标脚本 `node --check` 与 `git diff --check` 通过。复核现有周一自动化为 `ACTIVE`、RRULE 周一 00:10；采集器复用默认 `ego-browser`，专用 Profile 目录不存在。
- **默认 EGO W42 第三次重验成功（2026-10-23 11:29–11:32 Asia/Shanghai）：**同一 automation ID `learn-x-flomo-manual-existing-ego-20261023` 的第三次、也是上限内最后一次单来源尝试成功；invocation `1adc0a29-8a58-40d8-ac3b-c86dae4bea70`，耗时 151,070 ms。来源 `ready/count=18`；全库覆盖 `accepted-with-gaps`，978/980，漏 2 条（容差最多 10），49 页完成。活动快照 ID `5b13ac5b-e5af-4f59-a0ab-5f048527f440`、采集时间 `2026-10-23T03:32:10.970Z`，与 W42 `flomo.md` 头部一致；18 个日期标题全部位于 2026-10-12 至 2026-10-18（实际最晚 10-17），无越界。精确 invocation 的 TaskSpace 列表读回为空，重试锁、来源状态锁和浏览器队列锁均释放。专用 Profile 目录仍不存在。
- **调度权限边界复核（2026-10-23 11:34 Asia/Shanghai）：**第三次 W42 成功命令经一次性 `require_escalated` 执行；随后默认沙箱只读调用 `ego-browser nodejs`/`listTaskSpaces()` 返回 `Failed to start ego lite`，并提示默认 agent sandbox 应使用 Full Access。周一 Cron 仍为 `ACTIVE`、RRULE 周一 00:10，但没有持久 Full Access。此前将 Full Access 写入持久自动化的方案被自动审查拒绝，理由是扩大持续的本机与浏览器运行时权限；因此 W43 定时实跑能否启动 EGO仍待解决/实际验证。
- **自动化权限接口复核（2026-10-23 13:45 Asia/Shanghai）：**当前 `learn-x-flomo-00-10` 自动化配置仅声明本地执行、提示、状态与 RRULE；可用的 `automation_update` 接口没有单任务 sandbox/Full Access 字段。没有通过提示词、替代入口或 Profile 改造绕过权限拒绝；现有 Cron 与 EGO Profile 均未改动。持续 Full Access 是否批准仍待用户裁决。
- **Weekly Output 模式复用（2026-10-23 13:54:08 Asia/Shanghai）：**用户指出 Weekly Output 周自动化可运行并要求复用其模式。核对 `learn-x-v2`：`target=projectless`、`cwds=["~"]`、周一 05:00；其自动化记忆记载 2026-08-10 05:05 通过 Ego Lite 采集 Flomo 18 条。通过 Codex `automation_update` 将现有 `learn-x-flomo-00-10` 调整为相同 `projectless`/`~` 模式；保留 ACTIVE、周一 00:10、本地执行、原提示与 Learn-X Code 内快照路径/`~/Library/Application Support` 禁止项。配置读回匹配；未做 Full Access 设置，未触发新扫描。此模式调整后的 EGO 启动和 W43 实际调度仍待线上验收，之前沙箱失败的底层原因尚未单独隔离。

## 2026-10-23 W43 全链路隔离模拟

- **用户指示：**用户要求不要等待正式周一运行，用简单 mock 把流程走通。该模拟不代表 W43 真实调度、真实 Flomo 或 Ego Lite 验收。
- **自动化模式读回：**`learn-x-flomo-00-10` 仍为 ACTIVE、每周一 00:10，`target=projectless`、`cwds=["~"]`；与 05:00 `learn-x-v2` 的执行环境字段相同。Flomo 提示保留 Code 下快照路径、三次上限、硬阻塞停止和受限修复规则。
- **串联模拟：**临时合成仓库以 W42 mock 快照建立最后成功指针；W43 单次入口连续两次返回 `ECONNRESET`，每次间隔推进 20 分钟，状态计数分别为 1、2，活动指针未改变；第三次成功后，三次 invocation UUID 各异，监督器状态成功，`flomo.md` 快照 ID/采集时间与活动快照一致。合成全库快照保留一条旧笔记，W43 周文件只含目标周新建笔记。05:00 initial 零次重复采集；独立失败分支在 07:00 rescue 一次恢复成功。临时目录在脚本结束时清理。
- **隔离修复及定向回归：**发现三个 fake Ego 测试调用未固定 repoRoot，短暂把合成失败扫描结果写到默认 Code 暂存路径，扫描器 finally 删除了结果文件；未打开浏览器、未访问 Flomo、未读笔记正文、未激活快照。没有清理可能预先存在的目录。现将 full-snapshot 两处调用指向测试 mkdtemp 根，并让周采集失败分类测试通过临时 storageRoot 调用 fake scanner。之后重新运行采集、快照、周同步、来源状态和周重试监督器 **161/161 通过**；`git diff --check` 通过。此修复仅涉及测试隔离。
- **受限修复分支：**当前三份候选采集代码在工作树均有改动；自动化提示禁止改动不干净文件。因此第三次前根因修复条件当前不成立，自动化应保留原代码做最后一次重试。本模拟覆盖了该原代码重试路径，没有模拟代码补丁及失败回滚，以免触碰既有未提交工作。
- **仍待真实证据：**实际 W43 定时派发、Ego Lite 定时唤醒与登录环境、线上采集计数/完整性、正式 05:00 状态消费及 07:00 补救仍须运行后读回。模拟不能替代这些证据。
- **失败一致性修复与复测（2026-10-24）：**在临时合成仓库复现“周文件已发布、活动快照指针提交失败”的窗口；同步失败时现会在确认指针未切换且文件未被其他修改后回滚周文件，首次发布失败则移除未激活文件。覆盖了人工编辑并发保护与两类回滚的定向测试。Flomo/周重试六文件回归 **169/169**、Flomo Review **178/178**；`git diff --check` 与语法检查通过。全程未访问 Flomo、未读取真实笔记正文，mock 只使用临时目录并在测试后清理。
- **生产模块串联 W43 mock（2026-10-24）：**虚拟时钟依次运行 `runWeeklyRetrySupervisor` 与真实 `syncFlomoFullWeek`，扫描器仅返回合成快照/`ECONNRESET`。前置同步两次失败、两次冷却均为 20 分钟，第三次成功，三个 invocation UUID 各异；活动快照 ID/采集时间与 W43 `flomo.md` 文件头相同，全库快照含旧笔记编辑而周文件只含 W43 新建笔记。05:00 initial 没有重复 Flomo 扫描；另一隔离分支在 00:10 与 05:00 失败后由 07:00 rescue 成功。此为本地虚拟时序与合成扫描，不证明 Codex 实际唤醒、Ego Lite 或线上 Flomo 结果；临时目录已清理。
- **定时前定向回归（2026-10-24）：**执行 `rtk proxy node --test .agents/skills/learn-x-input/scripts/sync-flomo-full-week.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-weekly-automation/scripts/weekly-retry-supervisor.test.mjs .agents/skills/learn-x-process/scripts/flomo-sync-core.test.mjs`，**165/165 通过**。包括单次 Flomo 尝试、20 分钟重试、05:00 去重、07:00 补救与 mock 扫描边界；该命令没有手动启动线上采集。
- **计划触发遥测补充（2026-10-24）：**通过 Codex automation_update 让 `learn-x-flomo-00-10` 每次 supervisor 调用传 `--scheduled-at`：首次使用周一 00:10 计划时刻，后续尝试使用前次失败状态中的 `nextRetryAt`。读回确认状态仍为 `ACTIVE`、RRULE 仍为周一 00:10、`projectless` / `~` 未变；监督器计划/实际时间与 20 分钟重试间隔回归 **2/2** 通过；W43 自动化命令的完整参数经 `parseArgs` 读回 `scheduledAt=2026-10-25T16:10:00.000Z`、`maxDurationMs=1920000`。未触发真实采集。
- **Weekly Output 运行基线（2026-10-24）：**归档的 `learn-x-v2` 自动化任务记录含 `Automation ID=learn-x-v2`，cwd 为 `/Users/yuwei/code/learn-x`；执行轮次于 2026-10-12 05:01:21（Asia/Shanghai）启动、05:32:40 结束，turn 状态 `completed`，业务结果为 partial。它证明可从自动化任务记录读取实际启动时间；不证明 Flomo 00:10 或 W43 运行成功。当前 Flomo Cron 与 `learn-x-v2` 均为 `local`、`gpt-6-luna`。
- **存储路径复核（2026-10-24）：**生产默认路径解析为 `/Users/yuwei/code/learn-x/04_output/_dist/flomo-review/online-full/`，目录权限为 `0700` 且由仓库 `.gitignore` 排除。该次路径检查只检查路径和目录元数据；随后另一次核验的边界错误见下方记录。
- **验收边界纠正（2026-10-24）：**本轮 W43 周目录、`_weekly-retry-state.json`、`_source-status.json` 与 `flomo.md` 均不存在，未触发采集。一次只读核验脚本误用全文件读取了旧活动快照 JSON，虽然输出仅包含顶层元数据、没有输出或持久化笔记正文，但这违反“不读取正文”边界；已停止读取快照，并把验收 heartbeat 改为流式读取到顶层 `records` 标记即停止，同时保留计划/实际时刻遥测与自动化运行历史证据要求。该读取错误不构成 W43 运行证据。
- **任务记录读取边界（2026-10-24）：**探测归档 `learn-x-v2` 运行记录时，`read_thread(includeOutputs=false,maxOutputCharsPerItem=0)` 仍返回非空消息文本；本轮脚本只读取外层时间/状态元数据并测量消息长度，没有检查、打印或持久化消息文本值。由于该接口会返回任务消息正文，无法保证其中没有私人周内容，故不再用于本目标。验收 heartbeat 已改为仅用 `list_threads` 的任务 id/title/status/cwd/updatedAt，与目标周状态遥测交叉核对；不得打开任务消息或命令输出。
- **核对日期：**2026-10-24（Asia/Shanghai）。

### Retry-After 数据链修复（2026-10-23）

- **缺陷复现：**独立只读审查发现监督器能识别 Retry-After 文本，但全量采集先将 HTTP 429 规范化为 `service-rate-limit`，生产错误链未携带等待时长。新增合成浏览器响应测试，确认修复前失败结果没有 `retryAfterMs`，监督器会退回默认 20 分钟。
- **修复：**全量扫描监听 429/5xx 响应的 Retry-After，解析秒数或 HTTP 日期，仅在失败 JSON/CLI 诊断中传递有界毫秒数；错误输出不含原始响应头或笔记内容。同步 CLI、来源适配器和失败分类把该元数据送入持久化 `nextRetryAt`，保留至少 20 分钟冷却。超过 30 天自动重试窗口的超长等待标记为不可自动重试，避免提前请求或把目标周状态排到异常遥远的未来。
- **定向验证：**浏览器响应至安全扫描结果、CLI 格式化、适配器解析及重试时间持久化均有 mock 用例；包含秒数/HTTP-date、1 小时等待和超 30 天硬停止。采集、快照、全周同步、来源状态和周重试监督器测试 **164/164 通过**；三个改动脚本 `node --check` 与 `git diff --check` 通过。独立只读复核还用临时目录确认极大但可表示的延迟被硬停止且磁盘 `nextRetryAt` 为 null。未运行真实 Flomo、Ego Lite 或自动化调度。

### W43 调度前现场复核（2026-10-24 09:05 Asia/Shanghai）

- Flomo 00:10、Weekly Output 05:00、07:00 补救均为 `ACTIVE`、`execution_environment=local`、`target=projectless`、`cwds=["~"]`、模型 `gpt-6-luna`；Flomo 与 Weekly Output 的调度运行模式一致。00:10 Flomo 保持周一触发。
- Codex Build 仍按周一 00:10 原计划运行；用户已确认与 Flomo 互不影响，本次没有调整其调度。
- 本机时间为 `2026-10-24 09:05:49 +0800`，区域为 `Asia/Shanghai`。Flomo 默认数据根解析为 `/Users/yuwei/code/learn-x/04_output/_dist/flomo-review/online-full/`；目录权限 `0700`、非符号链接、受 `.gitignore` 排除。本次只检查路径/目录元数据，没有读取活动快照或笔记正文。
- W43 `_weekly-retry-state.json`、`_source-status.json`、`flomo.md` 尚不存在；符合计划触发前状态。没有手动采集。10 月 26 日 10:00 一次性验收 heartbeat 仍 `ACTIVE`。真实触发及后续 05:00/07:00 运行证据仍待自动化实际运行后核验。
- **提示完整性复核（2026-10-24 09:06 Asia/Shanghai）：**当前 00:10 Cron 提示明确单来源、单次入口、跳过周预处理/回顾导入、`--scheduled-at`、最多三次尝试、至少 20 分钟冷却、硬阻塞停止、Code 路径和禁止 Library；没有 Full Access 前置条件。10:00 heartbeat 仅用 `list_threads` 元数据，不调用 `read_thread`，并禁止读笔记正文。只检查了 automation 配置文本，没有派发任务或触碰 Flomo 数据。
- **验收唤醒目标复核（2026-10-24 09:07 Asia/Shanghai）：**heartbeat `learn-x-flomo` 仍为 `ACTIVE`，其 `target_thread_id` 与本目标线程 `01a15bd6-96f5-71f0-ba05-c0a1ecd61ac3` 一致；最近 50 条任务元数据中没有 W43 运行任务，且 W43 侧车仍未生成，符合正式触发前状态。`list_threads` 结果只提取 id/title/status/cwd/updatedAt，没有读取 summaries、消息或输出。
- **活动快照路径复核（2026-10-24）：**`storage-mode.json` 的 `activeSnapshotPath` 是相对于私有根的 `snapshots/<id>.json`，不是相对于仓库根。按采集器实现解析到 `04_output/_dist/flomo-review/online-full/snapshots/` 后，活动文件存在、权限 `0600`、非符号链接且被 `.gitignore` 排除；指针文件权限也为 `0600`。仅解析指针元数据并对目标执行 `lstat`，未读取快照内容。先前一次临时核对将相对路径按仓库根解析，现已按生产实现更正。

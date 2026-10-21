# CASE: 周记自动化效率优化

- 状态：原 M0–M3 的本地实现及 M4 安全接管能力和隔离回归已完成；2026-10-21 Chat Pack 自动续跑的 Skill 与定向契约/模拟测试已完成。整体验收仍为部分达成，生产 Runner 加载、真实来源采集、Codex 原线程续跑和定时端到端行为仍未验证。
- 最后核对日期：2026-10-21
- 上下游链接：../../requirements/2026-10-weekly-workflow-efficiency.md → execution-plan.md
- Type: Major
- Status: In Progress
- Requirement: [2026-10-weekly-workflow-efficiency](../../requirements/2026-10-weekly-workflow-efficiency.md)
- Architecture / Planning: [Architecture Truth](../../architecture.md) / [Execution Plan](execution-plan.md)
- Acceptance: [Deep acceptance report](acceptance.md)
- ADR: None
- Historical Implementation: 本地分级重试执行器、来源级预处理缓存与 generation/rawHash 防陈旧、确认版周记采回、Process Pack 快路径及字符统计、Stage 2 授权范围预览、Stage 3 Memory 与授权合并确认卡、授权指纹与异常诊断均已实现。关闭了旧 AI/null generation 更新死循环、非零 collector 退出被 sidecar 覆盖、常见问答漏提取和跳过/TODO 后续文本误纳入四条对抗缺陷。
- Historical Acceptance: 端到端隔离模拟 3/3，20分钟冷却由虚拟时钟推进，测试体约86–189ms；最终全仓 `npm test` 460/460（14.11秒）；独立定向对抗回归 102/102；周记自动化与 Process 两个 Skill 的 `quick_validate.py` 均通过；`git diff --check` 通过。真实飞书/Flomo/Ego Lite端到端、05:00/07:00实际唤醒、一分钟真实交付、收尾外部读回和三周用户用时仍待正常运行验证。
- Version: 本地代码已在工作区；本轮审查修复未提交。

## 当前执行状态（2026-10-12）

- 当前有效方案：Execution Plan「当前有效方案原文」，用户消息 01a12e0f-b2f4-70d3-bd19-e44e6a641e63 明确授权实施。
- 完整授权范围与阶段顺序：新方案 M0 → M1 → M2 → M3 → M4；M0 必须先保存并回读原文，再修改业务代码。
- 最后已验证：M0 需求、方案、Case 原文读回；M1 缺口 Pack、目标周 Build 对账和后续复核代码；M2 Health 本地导出、WeRead 版本与 Wisdom/Flomo 解耦；M3 Bridge 原 run 观察、AI 稳定 runId、Codex Build 原线程绑定收据；M4 问题记忆、复发候选与受控补丁护栏。
- M1：有效日记与确认版周记仍是硬门槛；补充来源无效时排除正文并可生成“有缺口已生成”Pack。Build 只按标题验证目标 ISO 周，后续对账会重新检查晚到产物。Skill 和 05:00/07:00 自动化指令要求日记就绪后先生成草稿；定时执行中并发交付尚未做真实运行验证。
- M2：WeRead 版本取自已安装 Skill 元数据，升级要求单独分类；Health-X `report --export-learn-x --week` 走本地报告并原子导出，不执行 Base 同步；Learn-X 本地 Health 报告和远端同步状态分开。智慧之门 Base 不依赖 Flomo，Flomo 导入只是增强。没有安装 WeRead 或运行真实来源采集。
- 2026-10-12 Health-X 兼容修复：定位到无 `--week` 时 CLI 将 `weekIndex=-1`，旧式首个位置参数会被误过滤；同时 Learn-X 导出模式仍尝试读 Diary Base 配置。现已修正位置参数解析，并让导出-only 路径不读 Base；Learn-X 采集器改为调用官方 `report --export-learn-x --week`，子进程只传 `PATH` 与 `LEARN_X_ROOT`，回读校验目标文件后再报告成功。Health-X 架构、README 和 Skill 已同步。合成 CLI 回归 2/2、Learn-X 采集器回归 5/5、Health-X Skill 校验通过；未读取健康样例或运行全量 Health-X 测试。
- M3：每个新 AI 提交先持久化 UUID，Bridge 以同一 UUID 写真实 run 和回执；中断后观察原 run，旧记录缺少稳定 ID 时不猜测。一次性重发仍受 snapshot-mismatch 和原子预占门禁约束。Codex Build helper 只允许对已绑定线程原子领取一次续跑；没有续跑真实 Codex 任务。
- M4：追加式事件为证据真源，playbook 可重建；同一运行跨层只计一次，未知错误不合并；人工修复无验证时保留候选。补丁须经独立审查、真实原失败测试与反例测试、文件哈希和共同截止时间校验；并发编辑时不回滚他人内容。
- 收据：Learn-X 全仓 `npm test` 592/592；恢复主链 85/85；Health-X exporter 3/3、Learn-X Health collector 6/6；Bridge observe/watchdog 定向回归 8/8 与 3/3；周自动化、Input、Process 三个 Skill 校验及 Learn-X、Health-X、Bridge `git diff --check` 通过。
- 未通过环境边界：Bridge 完整 socket/runner 套件曾有 7 项因沙箱 Unix socket `EPERM` 失败；本轮仅通过其定向合成测试，没有运行中的 Bridge 服务部署验证。Health-X 只运行了不含私人数据的导出合成测试，未跑全套或读取样例。
- 未执行：真实 WeRead 安装与采集、真实 Health 数据采集、Flomo/智慧之门/飞书来源读取、Build 续跑、AI 新提交、05:00/07:00 真实唤醒、Feishu 写入、Bridge 服务重启。05:00 与 07:00 自动化文件读回为 ACTIVE；CodeX Build 自动化为周一 00:10 ACTIVE。飞书机器人 Build 的独立 01:00 配置不在本机自动化目录中，未检查或修改。
- 工作区：保留全部既存改动，未提交、重置或清理。Health-X 和 browser-runtime-governance 工作区已有其他 dirty 路径；本轮仅触及授权功能路径，不把其他差异归到本 Case。
- M0 保存回读 SHA-256：Requirement 7bf3994dcf562139d6741554f162ce85e8dbe305bd32e2f09715fac7d6227ceb；Execution Plan fefe6e08181903087c905eaf8bd465d2d568a0987b7890db26c67cd780367f2a。Case 自身哈希不写入自身，避免自引用。
- M0 保存回读 SHA-256：Requirement 7bf3994dcf562139d6741554f162ce85e8dbe305bd32e2f09715fac7d6227ceb；Execution Plan fefe6e08181903087c905eaf8bd465d2d568a0987b7890db26c67cd780367f2a。Case 自身哈希不写入自身，避免自引用。
- 文档写入前 SHA-256：Requirement f4bd1489ba1af80e030e2953e546b3cf7ebf0c603b1bc43124563a00d7b1c3ef；Execution Plan 27bddd3ac842da7613022d8f99b93c5e54aec3d3de10dac37e964275d6e9080a；Case 61c8002aad3ebd9b15861fdd2cdf0f3031d0df5e10f446269ab1963817321908。
- 工作区核对时间：2026-10-12 Asia/Shanghai。
- 原文回读：本轮 6 条用户消息逐条与会话 source text 精确匹配；每条 UTF-8 字节长度及 SHA-256 已记录在 Requirement。当前完整方案 12,701 字节，SHA-256 d47d13bb038a2fe0c0a65b216cddac61f90a044d1d44bf08f12e47f2769ccaaf，与用户消息原文匹配。

## 历史执行状态（截至 2026-10-08；旧方案）

- 当前有效方案：execution-plan.md；01a10abc-80dc-7e33-a978-75e6b56b2abb授权实施，01a10ac2-4f98-7421-9307-4382c997e4c0追加卡片提前展示裁决。
- 完整授权范围与阶段顺序：M0 → M1 → M2 → M3 → M4；依据完整用户方案和其后续直接裁决。
- 最后已验证里程碑：M0资产已核对；M1–M4本地实现完成；隔离模拟穿过20分钟冷却后的07点补试、周记采回、预处理、Process Pack、Stage 2 范围预览契约及 Memory 候选准备；最终全仓测试 460/460通过。
- 2026-10-08重复验证：主流程隔离模拟连续三次通过，单次测试体约85.7ms、89.5ms、189.5ms（20分钟等待使用虚拟时钟）；独立定向对抗回归102/102；周记自动化与 Process Skill 格式校验通过。
- 2026-10-08独立故障注入：真实临时 Node 子进程写入新鲜成功 sidecar 后以 exit 7 / HTTP 503 退出，经默认 adapter→retry supervisor 仍记录失败并安排不少于20分钟重试；临时 CLI fixture 也穿过周自动化入口、合成 collector 和默认 `--prepare` 子命令，读取到目标周 manifest 与预处理事件。
- 非稳定试跑异常：较早两次全量试跑分别出现静态构建子进程退出 1、`sync-life-core` fixture 报 `body-too-short`；两者单测分别 7/7、3/3 通过，之后两种全量模式均通过。根因未复现，未改代码，也不据此推断为线上周记故障。
- 2026-10-07只核对了 2026-W40 的本地状态元数据：存在 `weekly.md`，但没有新流程的重试状态文件；来源侧标记 `core=unavailable`、`feishu-docs=needs_review`。未读取周记正文、未进入阶段 2，也未重跑真实采集。
- 剩余事项：真实周记锚点采回、Ego Lite 全量 Flomo 扫描、05/07调度实际唤醒、一分钟目标、Memory/图片/备份/YWNext/Flomo 的真实收尾读回及连续三周人类耗时仍待运行证据；本轮按用户授权仅做隔离模拟，未触发真实采集、调度或外部写入。
- 下一步：以后续正常周运行补足外部验收证据。
- 阻塞 / 待核实副作用：无本地实现阻塞；真实飞书、Ego Lite、调度恢复和用户时间数据未执行。本工作区另有既存 Flomo Review 改动，已保留且不属于本 Case。
- 证据：线程 01a10a89-3a0d-7e20-a177-a03e4ece3f63；完整方案源 01a10abc-80dc-7e33-a978-75e6b56b2abb；`learn-x-v2` 与 `learn-x-07-00` 更新结果均为 ACTIVE；`.agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs`连续3次通过；全仓测试 460/460、独立对抗回归102/102、两个 Skill 校验及 `git diff --check` 通过。
- 工作区核对时间：2026-10-08 Asia/Shanghai

## 来源与落点核对

- 相关用户原文 → Requirement Truth「来源原文」。
- 2026-10-12 用户消息 01a12cc5、01a12d8e、01a12da1、01a12db5、01a12e04、01a12e0f 的完整文本与来源 SHA-256 → Requirement Truth「来源原文」。
- 完整方案 → Execution Plan「方案原文」。
- 重试定稿与卡片提前裁决 → Requirement Truth「用户追加确认」及 Execution Plan「Execution Handoff」。

## 当前验收报告

最新独立验收结论、最短用法、Usage Truth、逐项判据与剩余边界见 [acceptance.md](acceptance.md)。2026-10-20 最新 Learn-X 全量回归为 652/652，周记自动化 scripts + lib 为 161/161；本 Case 的外部运行边界仍未验证。

## 当前来源核验（2026-10-12）

- 状态：本地实现和合成回归通过；整体部分达成，真实外部运行与实时调度证据待补。
- 机器收据：Learn-X 全仓 592/592；Health-X exporter 3/3；Learn-X Health collector 6/6；恢复主链 85/85；Bridge observe/receipt 8/8、watchdog lease 3/3；周自动化、Input、Process、Health-X 四个 Skill 校验及 Learn-X、Health-X `git diff --check` 通过。M0 原文及哈希见上文。
- 缺口报告：TOCTOU 目录替换压力测试未运行；Bridge 完整 socket 测试存在沙箱限制；真实 WeRead、Health、Flomo、智慧之门、AI、Build 以及 05:00/07:00 的端到端行为未执行。

## 历史来源核验（截至 2026-10-08）

- 状态：本地实现与模拟已核验；外部运行证据待补
- 机器收据：隔离周流程模拟3/3；全仓 `npm test` 460/460；独立定向对抗回归102/102；两个 Skill 校验、`git diff --check` 通过；自动化配置此前读回为 ACTIVE。
- 缺口报告：真实飞书采回、完整 Flomo/Ego Lite 扫描、05:00/07:00实际调度唤醒、一分钟真实交付、Memory和收尾外部读回及三周用户时间样本未执行。

## 当前执行入口

下一步在正常周中验证“日记先就绪，草稿先交付”，并由用户授权后再执行需要外部写入、真实来源采集或 Bridge 服务部署的步骤；监测连续运行数据以评估恢复率和复发率。

## 2026-10-12 对抗复核补充

- 修正 L3 门禁：L3 现在必须等待同来源两种 L2 动作均结束且仍未解决；L2 的两次上限不再误拦 L3。隔离验证覆盖“无 L2 拦截”与“两次 L2 失败后允许已验证补丁重采”。
- 修正修复知识失效：经验键使用来源、错误、版本、层级、动作码和已核验前提；说明文字仅作显示。相同修法后来失败时，无论说明文本变化与否，旧成功经验都被标为失效。
- 修正并发回滚：护栏先在隔离副本计算补丁后的精确字节；失败只回滚仍匹配该预期结果的文件。注入“补丁执行期间有人编辑”后，人工字节保留，记录为冲突。
- 新增 M1 隔离用例：Flomo 仍在执行时，Daily 的成功状态和有效来源文件已可读，采集器仍持有运行态。它证明自动化可以按 Skill 在同一会话中提前调用周记流程，不证明真实飞书草稿写入已发生。
- Learn-X 全仓 `npm test`：579/579 通过。恢复记忆 11/11、补丁护栏 5/5、L2/L3 门禁 3/3、早就绪模拟 1/1 通过。
- 独立审查收据由代码核对补丁哈希和不同的填报 reviewer ID，但不认证 reviewer 身份。运行者必须确认实际独立审查已发生；无法确认就不得应用小补丁。
- 仍未执行真实采集、飞书写入、AI 重发、Codex Build 续跑或 Bridge 服务部署；恢复率与自动化唤醒效果仍待真实运行证据。

## 历史执行入口

本地实现与回归通过后已更新架构真值；后续正常周运行补充外部验收证据。

## 2026-10-12 Bridge 对抗修复补充

- 独立审查复现了缓存成功收据掩盖 task space 清理失败、07:00 前 watchdog 可能回收旧 lease，以及收据写入错误未暴露三项缺陷。
- 共享 Bridge 现要求清理确认后才把恢复结果标为成功。清理失败时保留 `cleanupConfirmed: false` 的限时回执；下一次 observe 只重试原任务清理，读回成功后才返回完整成功。Learn-X AI lease 的保留截止设为 2 小时 15 分钟，watchdog 到期前不回收。
- 恢复收据只作用于 `learn-x:weekly-ai`，权限 0600、目录 0700、最多 15,000 字符、TTL 2 小时 15 分钟，不记录 prompt。收据无法写入时当前已验证结果仍可交付，但返回 `recoveryReceiptStatus: unavailable` 并写入不含正文的诊断事件。
- 恢复 observe 开始时按原 caller/runId 延长 active lease 至观察窗口加一分钟，并在每轮观察前续心跳；总期限不超过原 lease 创建后三小时。无匹配 active lease 时停止观察并返回明确缺口。
- Bridge 对抗定向测试 7/7、watchdog lease 测试 3/3 通过；Bridge `git diff --check` 通过。Learn-X 全仓测试上次为 579/579；本轮仅改 Learn-X 架构与 Case 文档，没有改 Learn-X 业务代码。
- 真实 Bridge Runner/watchdog 未部署、未启动；未查看本机运行配置。07:00 的实际任务保留与恢复仍未验证。此前 Bridge 完整套件受沙箱 socket `EPERM` 限制；本轮没有重跑完整套件。

### 2026-10-12 Bridge 观察硬截止补充

- 对抗复核指出：观察 Runner 可能在 `maxWaitSeconds` 墙钟截止后才返回成功；此前代码会继续接纳该迟到结果。
- `observeBridge()` 现在在处理 Runner 结果前复核硬截止。迟到结果返回 `needs_review / observer-window-ended`，不清理任务、不写成功收据，也不暴露迟到正文。
- Bridge 定向回归 8/8、watchdog 租约回归 3/3 通过；Bridge `git diff --check` 通过。Learn-X 本轮仅更新 Case/执行方案文档，没有改业务代码。
- 真实 Bridge/Runner/watchdog 仍未部署或启动；修复已通过隔离边界测试，线上行为仍待部署后观察。

### 2026-10-12 分层恢复对抗复测补充

- 独立复测发现并修复 UNKNOWN 故障跨层产生不同问题 ID、恢复记忆写入失败不能跨运行补写，以及 Build 收据路径穿越/符号链接目录逃逸。现在同一来源与执行 run 的 L1/L2/L3 共用问题 ID，不同 run 仍分离；事件写入失败会持久进入 weekly state，后续以 event ID 幂等补写；Build 收据和产物逐级校验周目录无 symlink，realpath 位于仓库内，收据与产物本身也拒绝 symlink。
- 补充 Build 周目录并发首建回归：两个首次调用同时创建目录时，`EEXIST` 会转入 `lstat` 再验证；另一调用可获得既有 `build-run-lock-busy`，不会把路径竞争误判成成功或写到别处。ISO 周边界按年份核验：`2025-W53` 拒绝，`2020-W53` 与 `2026-W53` 接受。
- 修复期间一次全仓测试暴露 `recorded` 变量作用域错误，已修复。最终 Learn-X `rtk proxy npm test` 587/587 通过；Build 续跑模块 8 项定向回归通过；恢复记忆 12/12、supervisor 43/43 通过；weekly automation、Input、Process 三个 Skill 均通过 `quick_validate.py`。Learn-X、Health-X、Bridge 三个仓库 `git diff --check` 均通过。
- 独立第一轮复核确认跨层 ID、待补写幂等恢复、路径穿越、文件/周目录 symlink 与 ISO 第 53 周测试通过；额外构造仓库外有效收据/周报也无法被认领。并发路径替换的 TOCTOU 压力边界未验证。
- 真实 WeRead/Health/Flomo/智慧之门/飞书来源、AI 重发、Codex 原线程续跑、Bridge 部署/Runner、飞书草稿写入及 05:00/07:00 实际唤醒仍未执行；恢复成功率和连续复发率尚无真实样本。结论仍为本地实现与合成测试通过、整体验收部分达成。

### 2026-10-12 ywuse 最终验收补充

- 第二轮新 reviewer 对未知错误指纹、ISO W53 共用校验和三处周目录 symlink 防护独立复测通过；未发现新 P1/P2。路径检查后并发替换的 TOCTOU 窗口尚未压力验证。
- 第二轮发现的问题已修复：不同未知错误使用脱敏哈希信号，不同指纹分离、相同指纹稳定；WeRead、supervisor 与 recovery-memory 共用 ISO 周规则；Learn-X Health collector 与 Health-X exporter 对周目录逐级拒绝软链接并核验真实路径。
- 最新收据：Learn-X `rtk proxy npm test` **592/592**；Health-X exporter **3/3**；Health collector **6/6**；恢复主链 **85/85**。仅使用合成夹具，未读取真实健康输入。
- Deep 验收报告：[acceptance.md](acceptance.md)。整体结论为部分达成；真实来源、Bridge 部署、Build 续跑、自动化唤醒及 TOCTOU 压力边界仍待后续验证。

## 2026-10-20 Bridge 诊断闭环回链

- 当前跨仓库主方案：[Ego Lite / ChatGPT Bridge 核心故障修复与持续诊断闭环](/Users/yuwei/code/browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/execution-plan.md)，来源为用户消息 01a15716-48ff-7e81-9921-f4b9ec9323ad。完整方案只保存在 Bridge Case，不在 Learn-X 复制。
- 本仓库实施证据继续写入本 Case：聚焦周记 AI 20 分钟单次重开、跨入口额度和产物晋升幂等、Flomo 错误信号保真、最终手动提示词与用户可见结果。原有周记阶段门、来源完整性政策、人工确认与 Memory 门槛保持有效。
- 2026-10-20 M0 工作区存在 9 个已修改路径和一个未跟踪目录；这些修改归属未核实前均作用户资产保护。另有会话 01a156f6-2e59-7ea1-9a00-33871816ec5c 处于 active，涉及相同周记脚本；修改前必须重读当前差异并避免覆盖并发编辑。

### 2026-10-20 实施验收补充

- 周记 AI 入口现在共用按目标周的令牌锁；CLI 不能用旧布尔参数绕锁。20分钟从实际派发时间起算，原任务先观察；条件满足后原子预留一次额度并派发 replacement，再观察最多20分钟。迟到结果可接纳；仍无结果时返回完整手动提示词，不再自动发第三次。
- 正式 `ai.md` 已写入但确认侧车未更新时，后续调用按输出摘要对账并补确认；已有实质人工内容不会被自动覆盖。Flomo 来源信号保留安全系统错误码，不将高层同步失败覆盖为另一类原始故障。
- Bridge 详细身份/提交错误经业务事件写入时保留原码，原始失败与后续观察阻塞分列；未知码仍折叠为 `unknown`。六个身份/提交原因、未知哨兵过滤及观察新原因/原始原因并列已覆盖测试，并经独立 reviewer 通过。
- 本仓库周记 AI、supervisor 和 lock 定向测试 **85/85**；Learn-X 技能层完整回归此前 **547/547**（新增一个 reason 用例前）。没有真实 AI 运行、真实 Feishu 写入或生产 journal 追加。完整仓库 `npm test` 有两项并发 ChatPack UI 测试失败并挂起，未记为通过；并发 UI 改动保留原样。
- 运行时是否已加载修复尚未验证；Bridge 主 Case 的 M4 状态为待排空加载，日常 06:00 诊断配置与周一报告配置已读回 ACTIVE。完整范围与验收见 [Bridge Case](../../../../browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/case.md) 及其 [验收报告](../../../../browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/acceptance.md)。

### 2026-10-20 Bridge 改动后的周记回归续验

- Bridge 源码近期增加共享准入、分离 runtime health 与 client failure，以及 Runner 维护能力校验；本仓库周记代码未因此改动。本次重跑 weekly automation 脚本测试 **140/140**，并重跑已修改的 Input/Process 测试 **31/31**。
- 周记单次重开、20分钟门限、replacement 独立观察窗、完整手动提示词、原因码保真与崩溃后晋升对账均仍通过。测试使用临时目录、合成时钟和 fake Bridge；没有真实 AI 请求、真实 Flomo 扫描、Feishu 写入或生产日志追加。
- Bridge 生产 Runner 目前不报告新准入 gate/源码清单能力，因此维护 CLI 会拒绝对它暂停；生产服务仍未加载本地改动。真实周记结果及其自动恢复行为只能在安全接管并加载后验证。
- Learn-X 全仓 `npm test` 本轮未执行为通过结论；既有 ChatPack 并发修改保留，不纳入此处周记回归结果。完整生产停止条件和跨仓库验收见 [Bridge acceptance](../../../../browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/acceptance.md)。

### 2026-10-20 20分钟门限回修与复核

- 独立验收发现真实时序缺口：首次 AI Bridge 约 4 分钟返回 `needs_review` 后，本次 supervisor 先观察原任务再退出；当时尚未满 20 分钟，因此不会在 20 分钟边界继续，自动重开被推迟到下一次周一/07:00 调度。
- supervisor 现在先完成该轮来源采集和瞬态重试，再处理 AI 恢复，避免 AI 等待拖住 Flomo 等来源。只有原 run 的身份、会话、提交确认、目标周、prompt 指纹、允许原因及无可用/人工产物等非时间门槛在假定的 20 分钟边界全部通过时，才会等待一次到达派发时间 + 20 分钟。
- 等待预算必须覆盖剩余等待、原 run 边界复看、第二次 Bridge 4 分钟预算、replacement 20 分钟观察窗与收尾余量。等待期间保留同周 AI 锁，释放 supervisor 状态锁与 Browser 队列锁，让同周 Flomo 手动入口和阶段记录继续运行；结束后有界重取状态锁并加载并发写入后的最新状态，再复看原 run。没有定时轮询。新增隔离并发测试覆盖阶段记录、Flomo 手动采集、状态合并、锁重取预算不足与手动提示词返回。预算不足、等待被中断、身份改变或复看后门槛失效时不重开，结果包含完整手动提示词。
- 门限到达后重新观察原 run，再读侧车、`ai.md` 与可用结果；迟到原结果优先交付。仅在安全门槛仍成立时调用已有原子预留，最多派发一个 replacement，并记录等待、预算跳过、原 run 迟到成功和预留派发事件。正式人工内容出现时不覆盖、不重开。
- replacement 派发后采用自己的 20 分钟单次定时等待，到期后只做一次边界观察；等待期间也释放共享状态锁与 Browser 队列锁，保留周记 AI 锁。重取门槛按 replacement 的收尾预算计算（不沿用首次等待时包含完整重开窗口的门槛），并加载最新并发状态；进程中断后从持久侧车恢复同一 replacement，不产生第三次提交。原 run 已满 20 分钟时，启动后的 `observe-existing` 即作为它的边界观察，不额外重复观察。
- 隔离回归：weekly-automation scripts 与 lib **152/152**，周记、Flomo 与 Process 受影响回归 **47/47**；覆盖原 run 与 replacement 的20分钟边界、迟到结果、单次额度、人工正文、预算不足、两个窗口期间的并发状态更新、中断续接及完整手动提示词。`node --check`、Learn-X `git diff --check` 通过。模拟时钟和 fake Bridge 不代表真实周记运行通过。
- 同一独立验收者已复核并发/中断边界；随后发现 replacement 收据缺少父 run ID 仍可能晋升的 P2。本轮增加父子 UUID 与派发时间校验及缺失父 ID 反例测试，现有隔离回归通过；对该修复的独立复核再次请求中。生产 Runner 未加载，真实 AI 提交和 20 分钟墙钟恢复仍未验证；M4 还缺可验证的精确回滚来源与恢复路径，因此保持生产服务原状。

### 2026-10-20 replacement 即时结果读回修复

- 一次性 replacement 收据必须有匹配的 UUID 子 run、有效且不同的 UUID 父 run、派发时间和目标周；Supervisor 在 Bridge 派发前把原 run ID 和预留时间写入周记持久状态。重启时 replacement 父 ID 必须匹配这个独立锚点；锚点缺失/不匹配或额度已预留但没有 replacement 收据时转 `needs_review`，不观察、不晋升、不再次提交。replacement 即时返回 `confirmed` 时，supervisor 立即验证目标周 `ai.md` 的内容结构与摘要，并与确认侧车对账；确认后结束，不再进入 20 分钟等待。重启后发现同一 replacement 已确认时，走相同的本地读回路径，不调用 Bridge。
- 即时返回 `generated` 时，复用已有 `promoteAiReview` 在持有周记 AI 锁期间验证生成稿、晋升正式文件并读回 `confirmed` 摘要；人工实质内容仍会阻止晋升并保留为 `needs_review`。晋升异常保持可见，不重新生成或提交。
- 回归覆盖派发前锚点落盘、reservation-only 中断后禁止重派、replacement 父 ID 缺失或有效但错误时拒绝晋升、即时 `confirmed`、即时 `generated` 和重启后确认收据；`weekly-automation scripts + lib` **158/158**，周记 supervisor **66/66**，周记/Flomo/Process 受影响回归 **36/36**。Browser Runtime 对应跨仓库完整隔离命令 **225/225**。`node --check` 和相关仓库 `git diff --check` 通过。测试用合成时钟及临时文件，没有真实 AI 提交、生产日志写入或真实来源采集。
- 父 run 锚点修复已独立复核通过，未发现新 P1/P2。复核构造了 child/parent UUID 均合法但 parent 错误的 generated 重启场景，确认收据保持原样、`ai.md` 不晋升、返回完整手动提示词；reservation-only 恢复也不重派。复核者定向测试 10/10、完整 supervisor 66/66，`node --check` 与 `git diff --check` 通过。
- 生产 Runner 未加载。06:00 日诊断首轮、下一份真实周报和 Ego App/BGE 运行链证据仍未完成，整体保持 PARTIAL。

### 2026-10-20 `ai.md` 晋升并发覆盖竞态修复

- 独立测试构造了正式文件存在性检查之后、rename 晋升之前人工创建 `ai.md` 的窗口，确认旧实现会覆盖人工正文。现在 shell 创建与生成稿晋升都用原子 no-clobber `link`；目标已存在时保留人工文件、草稿与 sidecar，返回 `needs_review`。对带稳定 run ID 的可恢复失败不提前创建空白正式 shell，避免阻止观察原 Bridge run 和晋升有效结果。旧版空白 shell 与生成稿并存时安全停在人工复核。
- 新增竞态注入、稳定 run observe 后晋升和 legacy shell 冲突用例；`generate-ai-review.test.mjs` 36/36，weekly automation scripts + lib 161/161，Learn-X `rtk proxy npm test` 652/652。首次并发执行测试时一项无关 Chat Pack cache 用例失败；该测试文件隔离回归 24/24，随后独立串行的全仓测试 652/652。原因未证实。相关语法检查和 `git diff --check` 通过。
- 新鲜独立复核者复跑 AI 晋升定向测试 36/36，并审查所有正式 `ai.md` 写入和清理路径，没有发现覆盖或删除人工正文的路径。legacy shell 冲突保留双方并进入 `needs_review`。
- 用户已澄清 BGE 即 Bridge，不存在独立 BGE 服务；真实 Bridge 生产加载、周记交付和自然周期仍未验证。没有执行真实周记 AI、Bridge 请求、Feishu 写入或生产 Runner 操作。整体跨仓验收仍为 PARTIAL，待生产安全加载、自然周期治理/周报和真实周记交付证据。

### 2026-10-20 19:16 CST 晋升确认竞态闭环

- **继续对抗复核发现：**直接把正式文件硬链接到生成草稿会令两者共享 inode；直接晋升与生成结果崩溃恢复还曾绕过统一的确认侧车读回。人工在正式文件安装后或确认侧车写入期间编辑，可能造成草稿被误删或状态仍显示 confirmed。
- **修复：**晋升先复制到独立临时文件，再以 no-clobber link 安装正式 `ai.md`，避免正式文件和生成草稿共享 inode。`persistConfirmedPromotion()` 现在统一自动生成、直接晋升、现有产物对账及崩溃恢复：sidecar 写入后读回，并再次读取正式文件核对摘要；不匹配时将状态写为 `needs_review`，保留人工正文和生成稿。调用方只在最终确认仍有效时清理草稿。
- **故障复现与回归：**分别注入人工在检查后创建 `ai.md`、正式文件安装后编辑、确认侧车落盘期间编辑、直接晋升旁路及恢复旁路。当前测试均确认人工正文不被覆盖，sidecar 不保留过期 confirmed，生成草稿不被删除。协调者运行 `generate-ai-review.test.mjs` 40/40 和 Learn-X `rtk proxy npm test` 656/656；独立复核者运行定向套件 40/40，并复跑恢复竞态夹具得到 `needs_review`、人工正文保留、生成草稿保留。
- **边界：**本轮未执行真实周记 AI、Bridge 请求或外部写入，也未加载生产 Runner。M4 精确恢复来源与安全加载、M5 自然日/周自动化运行及真实交付仍未验证；总体验收为 **PARTIAL**。BGE 是 Bridge 的别名。

## 2026-10-21 Chat Pack 自动续跑最终确认卡

- **来源映射：**当前会话中的用户原始需求、自动续跑选择与实施授权已追加至 Requirement Truth「2026-10-21 Chat Pack 完成后自动交付最终确认卡」；完整方案、失败边界、验收矩阵和 Execution Handoff 已追加至 Execution Plan 同名章节。本次沿用既有 Requirement / Execution Plan / Case，不覆盖历史方案。
- **用户裁决：**当前活动中的 Learn-X 周流程收到已人工审核、已定稿并读回有效的 Chat Pack Weekly Output 后，自动进入阶段 3 并在同一轮交付完整确认卡；不要求另外发送“已完成”或“继续”。最终卡仍是唯一写入授权点。
- **M0 工作区基线：**检查时间 2026-10-21 Asia/Shanghai。修改前已有 `.agents/skills/learn-x-weekly-automation/SKILL.md`、`generate-ai-review.mjs`、`generate-ai-review.test.mjs`、`weekly-retry-supervisor.mjs`、`weekly-retry-supervisor.test.mjs`、`weekly-source-adapter.test.mjs` 六个修改路径和未跟踪目录 `draft_5b4b062a_folder/`。Skill 有用户既有 AI 恢复改动；本次仅在同一文件增量编辑阶段交接规则，其余既有改动保持不动。
- **M0 读回：**Requirement R19 和原始请求位于需求文档新增章节；执行方案含自动续跑流程、失败边界、M0–M2 验收和测试交接；本 Case 已登记来源、决定和脏工作区基线。三份规划资产都保留此前内容。
- **M1 实施：**周自动化 Skill 改为以当前流程收到并定稿的 Weekly Output 内容作为交接，保存/读回并验证目标周、必需章节、正文完整性和占位文本后，同一回复运行阶段 3；移除额外完成/继续状态消息。保留阶段 2 授权范围预览、Chat Pack 人工审核和最终卡唯一写入授权。独立会话与单纯 mtime 变化不触发。
- **M2 定向验收：**`rtk proxy node --test .agents/skills/learn-x-weekly-automation/scripts/weekly-workflow-simulation.test.mjs .agents/skills/learn-x-process/scripts/generate-weekly-process-pack.test.mjs .agents/skills/learn-x-process/scripts/prepare-weekly-memory.test.mjs` **31/31**；覆盖有效内容保存/读回后候选准备、零长期候选仍可绑定完整卡、Weekly Output 改变后旧指纹失效、无确认时目标 Memory 不存在，以及 Skill 对错周/缺项/占位内容停止出卡、确认指纹校验先于写入的契约。`skill-creator` `quick_validate.py` 通过；`rtk git diff --check` 通过。
- **尚未验证：**没有运行真实 Chat Pack、真实周流程、Memory/图片/备份/YW Next/Flomo 写入或外部读回；无效内容的 fail-closed 由 Skill 阶段契约测试覆盖，不代表线上交互实测。修改前已存在的其他 AI 恢复脚本、测试和未跟踪目录保持原样。

### 2026-10-21 Goal 续接状态

- 当前组合顺序依照用户授权为 ywdev → 第一轮 yw-testing → 一个独立新 subagent ywtest；同一个 Goal 保持 active，不创建阶段 Goal。
- 本轮 ywdev 已完成当前已授权实现：Skill 交接边界、确认卡前置校验、完整方案原文落盘和对应工作流测试已更新。定向验证新鲜结果：相关测试 31/31、周自动化 Skill `quick_validate.py` 通过、`git diff --check` 通过。
- 下一步为首轮 yw-testing：运行本仓库完整 Learn-X 套件和风险相关静态/构建检查；随后按 `dev-workflow.testing` 提示词的固定委派配方，新建一个独立只读 subagent，从更多角度审查用户路径、fail-closed、指纹与授权边界。发现授权范围内缺陷时由协调者修复并交同一测试者复测。真实周采集和外部写入继续排除在本次测试范围外。

### 2026-10-21 Bridge 诊断续改回归

- 周记 AI 普通 `--retry` 不能绕过已耗尽的一次性 replacement 额度；supervisor 在手动提示词 sidecar 缺失时从 Learn-X 业务结果重建兜底，并在报告成功前核对 `ai.md` 读回摘要与确认状态。原文、回复正文和生产文件内容没有进入系统诊断日志。
- 最新 Learn-X `rtk proxy npm test` **660/660** 通过；独立测试者复跑同为 660/660。测试使用 fake Bridge 与临时文件，没有提交真实周记 AI 请求、读取正文或写外部服务。跨仓详细证据与 M4/M5 边界见 [Bridge Case](../../../../browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/case.md) 和 [验收报告](../../../../browser-runtime-governance/docs/cases/2026-10-chatgpt-bridge-diagnostics/acceptance.md)。

### 2026-10-21 第一轮 yw-testing 协调者结果

- 首次全量 `rtk proxy npm test` 为 **659/660**：`chatpack-cache.test.mjs` 的 mapping/hash 用例在 `t.after` 清理时报告 `ENOTEMPTY`。隔离复现后定位到测试夹具混用固定 2026-10-20 时钟与真实时钟；后两个缓存实例因此把每日刷新判为已到期，并在临时目录清理期间启动后台写入。
- 最小修正：mapping/hash 用例里的 remapped 与 corrupted 缓存实例改用 `fixture.getNow`，与创建缓存的测试时钟一致。隔离用例 **1/1**；随后全量 `rtk proxy npm test` **660/660**，0 failed / 0 skipped。
- 测试期间工作区还出现 `.agents/skills/learn-x-process/scripts/backup-weekly.mjs` 与 `docs/LEARN_X_BACKUP.md` 两个非本轮目标的脏路径；未读取、修改或重置其内容，保持原状。
- 独立只读 subagent 复核发现两个 P2 fail-closed 缺口：候选/绑定脚本未强制校验错周、缺章节和占位内容；prepare→bind 期间 Weekly Output 改动仍可绑定为有效指纹。协调者已在现有候选准备/绑定入口增加内容门和候选一致性检查，待同一 reviewer 复测。没有运行真实周流程、真实 Chat Pack、Memory/图片/备份/YW Next/Flomo 写入或真实飞书端到端操作；本轮变更不触发真实飞书行为，线上自动交卡仍未验证。

### 2026-10-21 对抗复核后的 fail-closed 补强

- **复核反例：**独立 reviewer 在临时目录实测错周标题、缺必需章节、纯占位章节、实质正文夹“待补充”均可经候选准备、指纹绑定及校验；另实测先生成候选、再改 Weekly Output、最后绑定，旧候选与新正文仍得到 `verified: true`。此前阶段契约主要验证 Skill 文案，未实际覆盖此执行入口。
- **最小修正：**`prepareWeeklyMemory` 与 `bindWeeklyMemoryApproval` 现在拒绝周标题不匹配、任一必需章节缺失/无实质内容及必需章节内独立占位行。绑定前按当前 Weekly Output 重新生成预期候选包，并与已保存候选逐字比对；来源内容变化时拒绝绑定，须重新准备候选和拟写卡。沿用既有接口、文件格式与指纹流程。
- **协调者定向回归：**`rtk proxy node --test .agents/skills/learn-x-process/scripts/prepare-weekly-memory.test.mjs` **20/20**；Learn-X 周自动化模拟 + Process Pack 契约 + Memory 准备/指纹三组 `rtk proxy node --test ...` **42/42**。覆盖错周、缺项、纯/混合占位和五类说明式占位标记、候选生成后源变更均拒绝出卡；原有零长期候选、绑定后文件改动失效及未确认不写入路径通过。
- **全量回归：**在 fail-closed 与占位标记修正后重新运行 `rtk proxy npm test`，**671/671**、0 failed / 0 skipped。Skill `quick_validate.py` 与 `rtk git diff --check` 通过。
- **仍待完成：**同一独立只读 reviewer 正在复测两个原始反例和全部相关路径。真实周流程和外部写入仍未执行。

### 2026-10-21 占位语义边界与最终复测

- **对抗复测反例：**同一 reviewer 发现基于子串的占位拦截会误拒“我用 TODO 清单记录了已确认的负责人和截止日期”和“待补充的数据尚未到位，因此本周没有据此修改结论”，同时会放过字段值 `xx`、`xxx` 与 `[填写内容]`。
- **修正：**仅识别完整占位行、带说明的明确占位标记、占位括号/HTML 注释及字段占位值。两个语义句现在通过验证并留在生成候选中；三个字段值占位和之前的注释/标记反例继续阻止准备和绑定。
- **协调者最终回归：**Memory 定向测试 **27/27**；工作流模拟、Process Pack 契约、Memory 准备/指纹 **49/49**；全量 `rtk proxy npm test` **678/678**，0 failed / 0 skipped。weekly automation 与 learn-x-process `quick_validate.py`、`rtk git diff --check` 均通过。
- **独立复测：**同一只读 reviewer 在临时目录验证三类自然语言 HTML 补全注释均阻止候选生成；此前列出的字段占位、普通 TODO/“待补充”语义句、错周/缺章节、prepare→bind 来源变化、mtime 未变但正文变化、零候选和确认前无正式 Memory 写入路径也复查通过。定向套件 **49/49**，无仓库改动或外部操作；未报告未解决的实现问题。
- **外部边界：**仍未运行真实 Chat Pack、真实周流程、Memory/图片/备份/YW Next/Flomo 写入或真实飞书端到端操作。测试使用临时目录，确认卡之前不执行收尾写入，因此真实 LLM 同轮交卡及用户可见完整呈现仍未实测。

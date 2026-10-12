# CASE: 周记自动化效率优化

- 状态：M0–M4 的本地实现与隔离回归已完成；整体验收为部分达成，真实来源采集、共享 Bridge 部署、Codex 原线程续跑和定时端到端行为仍未验证。
- 最后核对日期：2026-10-12
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

最新独立验收结论、最短用法、Usage Truth、逐项判据与剩余边界见 [acceptance.md](acceptance.md)。本轮本地全量回归为 592/592；三项独立复测发现的问题已修复。外部运行与并发目录替换边界仍未验证。

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

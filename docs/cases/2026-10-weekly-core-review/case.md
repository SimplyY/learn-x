# CASE: 周记与 Core 一体化复盘及可靠同步

- 状态：已确认
- 最后核对日期：2026-10-30
- 上下游链接：[Requirement](../../requirements/2026-10-weekly-core-review.md) → [Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Requirement: [Requirement](../../requirements/2026-10-weekly-core-review.md)
- Architecture / Planning: None / [Plan](execution-plan.md)
- ADR: None
- Implementation: Core M1 建档与安全补齐原型（未完成真实链路验收）：[commands.mjs](../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/commands.mjs)、[weekly-review.mjs](../../../../core/.agents/skills/core-weekly/scripts/weekly-review.mjs)；Learn-X 周记试点入口已接入 Skill，默认关闭；Core 骨架实现已提交 b46d2dc；后续只读关联和富文本比较改动尚未提交。
- Acceptance: None
- Version: None

## 执行状态
- 当前有效方案：本会话用户提交的 [Plan](execution-plan.md)，用户要求实施。
- 完整授权范围与阶段顺序：按 Plan M0–M4；用户追加授权 bot 身份创建或复用同周 Core 文档并在周记安全位置写链接。
- 最后已验证里程碑：M0 三份文档及三条来源逐字读回，Core 回链已读回。
- 剩余事项：完成 M1 从真实入口到链接点击及一体化周记链路验证；M2–M3 已有未接入生产的模拟实现，需完成真实确认入口、同步适配与验收；M4 调度接入及真实周复盘验收未完成。
- 下一步：接通可信宿主的实际卡片展示与用户确认、已确认内容的飞书逐目标执行；核验 Core 安全补齐原型及真实入口，验证用户可见、链接点击和人工内容保护。bot 对 Core 总览权限不足时保持该目标待恢复。
- 阻塞 / 待核实副作用：bot 对 Core 总览 edit 权限检查返回 false；尚无真实周记到 Core 文档的用户链路、链接点击或一体化证据，调度验证未知。试点保持关闭。
- 证据：本会话原始消息；Core 隔离测试 `node --test scripts/weekly-review.test.mjs`：53/53 通过；只读权限检查 `lark-cli drive permission.members auth --as bot --action edit --type docx --token <总览底层文档>` 返回 `auth_result: false`。隔离飞书文档 [测试文档](https://ywhome.feishu.cn/docx/BuCzdR91ooLkwSxFTVCcNoFQnQe) 由 bot 创建并以 user 读回：revision 4 验证单元格 `block_insert_after`，revision 5 验证链接 href，revision 7 验证空表 `block_replace` 及邻接块读回；未验证 GUI 点击。
- 2026-10-30 隔离集成：对 [Core 补齐测试文档](https://ywhome.feishu.cn/docx/J223dnToCoD9lgxXgGScVKmanvh)，使用 `/private/tmp/core-m1-e2e2/resume.mjs` 从原有 pending 恢复，生产 `cmdPrepare` 先核查再以 bot 补齐三表（`selected=[0,1,2]`）；user 身份独立读回 revision 6，三表各一行。Pack、总览与 AI 输入为合成桩，飞书写入和读回真实；该证据不证明真实周记到 Core 的完整链路、真实 Pack/AI 或 GUI 点击。M1 仍未验收。
- 2026-10-30 模拟进展：确认批次、v2 回流、逐目标恢复、Learn-X 条目修改/排除与确认指纹绑定已有代码和隔离测试；使用模拟的宿主消息与飞书目标覆盖部分完成、未知写入、人工冲突及多批次回流。Core 执行 `node --test scripts/confirmation.test.mjs scripts/confirmation-session.test.mjs scripts/sync-confirmed.test.mjs scripts/confirmed-row.test.mjs scripts/sync-feishu.test.mjs scripts/weekly-review.test.mjs scripts/weekly-unified-integration.test.mjs`：101/101；Learn-X 执行 `node --test .agents/skills/learn-x-weekly-automation/scripts/confirmation-input.test.mjs .agents/skills/learn-x-weekly-automation/scripts/unified-confirmation.test.mjs`：5/5。测试均为隔离数据，不能证明真实用户确认、正式飞书同步或完整生产流程已完成。
- 2026-10-30 验证限制：创建新的飞书隔离测试文档被自动审批拒绝，理由为此操作会真实创建文档并可能自动授予用户 `full_access`；未重试或绕过。年度表新增行真实传输和返回形态未验证，相关真实入口保持关闭；可信 Codex 宿主适配器也尚未接入，联合确认生产入口保持关闭。M1–M4 的真实用户链路和最终验收均未完成。
- 工作区核对时间：2026-10-30；Core 存在本任务后续未提交改动。

## 来源与落点核对
- 本会话用户原始需求 → Requirement 来源原文；实施方案 → Plan 方案原文；bot 裁决 → Requirement 用户追加确认。

## 来源核验
- 状态：通过（本次直接从唯一匹配的原始消息提取并逐字读回；未生成交接机器收据）
- 机器收据：None
- 缺口报告：None

## 执行入口
未生成；需完成来源核验。

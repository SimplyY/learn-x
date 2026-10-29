# CASE: 周记与 Core 一体化复盘及可靠同步

- 状态：已确认
- 最后核对日期：2026-10-29
- 上下游链接：[Requirement](../../requirements/2026-10-weekly-core-review.md) → [Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Requirement: [Requirement](../../requirements/2026-10-weekly-core-review.md)
- Architecture / Planning: None / [Plan](execution-plan.md)
- ADR: None
- Implementation: Core M1 建档与安全补齐原型（未完成真实链路验收）：[commands.mjs](../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/commands.mjs)、[weekly-review.mjs](../../../../core/.agents/skills/core-weekly/scripts/weekly-review.mjs)；Learn-X 周记试点入口已接入 Skill，默认关闭；尚无提交。
- Acceptance: None
- Version: None

## 执行状态
- 当前有效方案：本会话用户提交的 [Plan](execution-plan.md)，用户要求实施。
- 完整授权范围与阶段顺序：按 Plan M0–M4；用户追加授权 bot 身份创建或复用同周 Core 文档并在周记安全位置写链接。
- 最后已验证里程碑：M0 三份文档及三条来源逐字读回，Core 回链已读回。
- 剩余事项：完成 M1 从真实入口到链接点击及一体化周记链路验证；M2–M4 尚未开始，详见 Plan。
- 下一步：核验 Core 安全补齐原型及真实入口，验证用户可见、链接点击和人工内容保护；同时核实 bot 对 Core 总览的编辑权限，权限不足时保持对应同步待恢复。
- 阻塞 / 待核实副作用：bot 对 Core 总览 edit 权限检查返回 false；尚无真实周记到 Core 文档的用户链路、链接点击或一体化证据，调度验证未知。试点保持关闭。
- 证据：本会话原始消息；Core 隔离测试 `node --test scripts/weekly-review.test.mjs`：40/40 通过；只读权限检查 `lark-cli drive permission.members auth --as bot --action edit --type docx --token <总览底层文档>` 返回 `auth_result: false`。隔离飞书文档 [测试文档](https://ywhome.feishu.cn/docx/BuCzdR91ooLkwSxFTVCcNoFQnQe) 由 bot 创建并以 user 读回：revision 4 验证单元格 `block_insert_after`，revision 5 验证链接 href，revision 7 验证空表 `block_replace` 及邻接块读回；未验证 GUI 点击。这些隔离证据不证明生产周记到 Core 的完整链路。
- 工作区核对时间：2026-10-29。

## 来源与落点核对
- 本会话用户原始需求 → Requirement 来源原文；实施方案 → Plan 方案原文；bot 裁决 → Requirement 用户追加确认。

## 来源核验
- 状态：通过（本次直接从唯一匹配的原始消息提取并逐字读回；未生成交接机器收据）
- 机器收据：None
- 缺口报告：None

## 执行入口
未生成；需完成来源核验。

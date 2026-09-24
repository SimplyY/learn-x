# CASE: 微信 Evidence Source：TraceMemo 接入与 7 天 PoC

- Type: Major
- Status: In Progress（2026-09-24 节点②文档完成；里程碑 2：官方 2.4.0 arm64 已安装并启动，**等待用户在 GUI 完成首次微信连接**——应用约 15:00 被退出且无连接活动，需用户重新打开并完成连接；30 条核验工具已备好并合成自测通过）
- 开始于：2026-09-24
- Requirement: [wechat-evidence-source](../../requirements/wechat-evidence-source.md)（已冻结）
- Architecture / Planning: [architecture.md](../../architecture.md) · [execution-plan.md](execution-plan.md)
- ADR: [0001 按需新鲜度与覆盖边界](../../adr/0001-wechat-evidence-freshness-coverage.md)
- Implementation: 里程碑 2 已授权（2026-09-24）；官方 dmg 安装见 [install-receipt.md](install-receipt.md)
- Acceptance: 待节点④（按 requirement §6 验收矩阵与第 7 天 PoC 报告）
- Version: Learn-X 微信输入 v1（人工截图）→ v2（TraceMemo 派生 `WeChat.md`，PoC 评审中）

## 关键产物

- 冻结需求：`docs/requirements/wechat-evidence-source.md`（R1–R8、验收矩阵、停止条件）
- ADR 0001：按需新鲜度＋覆盖边界（绝对覆盖保持「未证实」）
- Architecture Truth：`docs/architecture.md` 已知边界 1–4 记录了接入前必须修正的四个工程事实（大小写冲突、未登记文件绕过过滤、备份整目录上传、单文件上限）
- 执行计划：`execution-plan.md`（里程碑 1–5、恢复点、回滚、停止条件）
- 安装凭证：`install-receipt.md`（官方来源、sha512、签名发现）
- 里程碑 2 核验工具：`verify-known-messages.mjs`（30 条已知消息逐条核对；已完成合成自测 3/3 路径，见 `verify-report.synthetic.json`；清单与 Token 放 `~/.tracememo/` 私有目录，不入仓库）

## 授权边界（Gate）

节点②已完成并落盘。授权状态：

1. 从官方 2.4.0 发布源安装 TraceMemo arm64 构建（里程碑 2）——**已授权（2026-09-24）并完成**，见 [install-receipt.md](install-receipt.md)。
2. 连接真实微信账号（里程碑 2）——**已授权（2026-09-24）**，连接与 30 条核验进行中。
3. 在共享 Skills 仓库实现 `wechat-evidence` Skill（里程碑 3）——**未授权**，不得开始。
4. 修改 Learn-X 周流程代码（里程碑 4）——**未授权**，不得开始。
5. 运行 7 天 PoC（里程碑 5）——**未授权**，不得开始。

## 工作区保护（实施时必须遵守）

- Learn-X 有两处既有月度 Process 未提交改动（`generate-monthly-process-pack.mjs`、`monthly-process-input.test.mjs`），共享 Skills 仓库另有一处无关未提交改动。实施节点③前先重看 diff，保留这些内容，不清理、不覆盖。
- 旧截图 `03_input/weekly/2026-W33、W34、W37/WeChat.md` 原样保留，不迁移、不删除。

# 部分达成（PARTIAL）｜Learn-X 分层智能恢复与问题修复记忆闭环

本次独立验收覆盖用户确认的 M0–M4 方案、Learn-X/Health-X 代码、仓库内操作文档和本轮新鲜测试证据。核心本地能力已实现，关键合成回归通过；证据足以确认代码路径行为，不足以证明外部服务和定时任务已在真实周运行成功。当前无需用户批准新的外部操作；真实来源、Bridge 部署和自动化唤醒仍需后续运行证据。

依据：冻结需求与实施授权见 [Requirement](../../requirements/2026-10-weekly-workflow-efficiency.md)，方案及阶段裁决见 [Execution Plan](execution-plan.md)，架构约束见 [Architecture Truth](../../architecture.md)。

## 实际用法与最短验收动作

05:00/07:00 仍由 `learn-x-weekly-automation` 调度；单次手动初始采集的入口仍为：

```sh
rtk proxy npm run weekly:retry -- --week 2026-W41 --mode initial
```

预期：执行器维持来源状态、三层预算、CLI/浏览器并发限制和恢复收据；Health、Build 及其他来源按目标周和产物读回校验。已确认周记后才运行 `input:weekly` 与 `process:weekly`；该阶段门槛未改变。

最短本地回归：`rtk proxy npm test`，本轮结果 **592/592 通过**。这只验证本地代码和合成夹具，不会触发真实来源采集或外部写入。

## Usage Truth

**无需更新外部 Feishu 使用页。** 用户触发方式和 CLI 入口未变；此次新增的层级诊断、中文交付状态与修复记忆属于自动化内部行为，具体约束已写入周自动化与 Process Skill。现有 [Learn-X Flomo 使用说明](https://ywhome.feishu.cn/wiki/JzzLwuVGZiJSIBkUhLbc2Mbwnwg) 仅覆盖 Flomo，不把它冒充为周自动化用法页；本轮未写入 Feishu，也未更新 README 的外部用法链接。

## 逐条需求结论与证据

| 需求 | 结论 | 证据 |
|---|---|---|
| M1：日记有效时先交付，补充来源失败不阻断 Pack；周记和日记继续作为硬门槛 | **部分达成** | `weekly-workflow-simulation.test.mjs` 覆盖 Daily 就绪早交付；Process Pack 对缺失/失败来源的隔离用例包含在全仓 **592/592** 中。真实飞书草稿写入未运行。 |
| M2：修复 WeRead、Health、Flomo、智慧之门及 Build 已知恢复路径 | **部分达成** | Learn-X Health collector **6/6**、Health-X exporter **3/3**；WeRead 周号/版本测试、Build 绑定续跑 **8/8**；supervisor 覆盖 Wisdom 不等待 Flomo。未安装 WeRead、未读取真实健康数据或来源服务。 |
| M3：AI 观察原任务，严格门禁下一次重发；Build 仅续跑绑定原线程 | **部分达成** | Learn-X AI/Build 合成测试与 Bridge observe/receipt 定向测试通过；独立 reviewer 对 Bridge 关键路径复核通过。Bridge 未部署，未观察真实会话或恢复真实 Codex Build。 |
| M4：三层恢复、关键问题记忆、修法复用/失效、复发候选和受控小补丁 | **达成（本地实现）** | Recovery Memory、Supervisor、Patch Guard 定向测试合计 **85/85**；未知错误哈希区分、同指纹稳定、ISO W53 校验、待补写幂等与补丁回滚均有测试。长期复发率及真实人工修复经验尚无运行样本。 |
| 预算、并发、状态门禁、内容隐私和不覆盖人工产物 | **达成（代码与合成场景）** | 全仓 **592/592**；绝大多数来源侧车不含原始正文。相关功能 `git diff --check` 通过；没有执行真实外部写入。 |

## 关键架构约束与重大回归

- 关键约束符合：来源并发由 supervisor 管理；Wisdom Base 进入 CLI 批次，Flomo 导入为独立增强；未知提交只观察原任务；Build 产物按真实覆盖周核验；Health-X 导出不依赖 Base 同步。
- 对抗复测新发现并修复三项问题：不同未知错误原先会合并；`2025-W53` 在恢复记忆入口被接受；Health 周目录符号链接可导致越界写入。现在错误指纹以脱敏哈希区分，周数共用 ISO 年规则，Learn-X/Health-X 周目录逐级拒绝链接并核对真实路径。
- 全仓回归 **592/592**；Health-X exporter **3/3**；Learn-X Health collector **6/6**；恢复主链 **85/85**；Bridge observe/receipt **8/8**、watchdog lease **3/3**；4 个相关 Skill 校验通过。独立第二轮复核未发现新 P1/P2。
- 剩余边界：目录检查和路径操作之间仍有 TOCTOU 竞态窗口，未做替换压力测试。异步任务额度恢复、真实外部提交归属、Bridge 服务部署与运行均未做端到端验证。
- 未运行真实 WeRead 安装、Health 私人数据、Flomo/Wisdom/Feishu 来源、AI 重发、Codex Build 续跑、05:00/07:00 唤醒或飞书文档写入。没有据合成测试推断线上成功率达到 80%–90%。

## 待验收事项与必要人工项

后续按正常授权运行补足真实采集读回、自动化时段唤醒、Bridge observe、Codex 原线程续跑以及至少数周的恢复率/复发数据。若要求消除 TOCTOU 窗口，需要单独设计并压力验证目录句柄级安全写入；当前路径校验已拦截静态符号链接逃逸。

## 最终结论

**部分达成（PARTIAL）｜2026-10-12 Asia/Shanghai。** 本地实现和合成验证已完成；外部运行证据与并发目录替换边界未验证，因此不宣称整套自动化已在生产环境验收通过。

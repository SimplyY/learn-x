# CASE: Learn-X Chat Pack 提速与缓存状态改造

- 状态：已确认
- 最后核对日期：2026-10-20
- 上下游链接：[Requirement](../../requirements/2026-10-chatpack-cache-performance.md) → [Execution Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Requirement: [2026-10-chatpack-cache-performance.md](../../requirements/2026-10-chatpack-cache-performance.md)
- Architecture / Planning: [Architecture Truth](../../architecture.md) / [Execution Plan](execution-plan.md)
- Testing: [yw-testing report](testing-report.md)
- ADR: None
- Implementation: `app/code/scripts/chatpack-cache.mjs`, `app/code/server.mjs`, `app/code/public/`
- Acceptance: [ywuse 报告](acceptance.md) — 部分达成
- Version: None

## 执行状态
- 当前有效方案：`execution-plan.md` 中本轮用户提供的完整方案；本轮用户明确授权实施。
- 完整授权范围与阶段顺序：M0 保存/核对方案；M1 穿通截图中的生成链路；M2 全量自动缓存；M3 异常回归与文档修正。
- 最后已验证里程碑：M0 文档落盘与读回通过；M1 截图组合在重启后的本地服务中从 16/16 磁盘缓存生成并确认复制；M2 刷新队列、14 天 TTL、节流/并发和故障语义有单测；M3 全仓 `npm test` 624/624，local、public、public + context off 三种静态构建均通过。独立 yw-testing 子代理复核生成和复制重试挂起后的未知状态、重入拦截和迟到结果恢复均通过；新增持久缓存 revision 更新读回测试。
- 剩余事项：ACC6 的十次连续真实页面性能验收已通过。仍待完整 24 小时观察每日刷新、DNS/网络恢复后的真实 Core 与 Prompt 更新，以及取得用户原始页面 JavaScript 堆栈以确认现场根因。
- 下一步：等待每日周期和飞书网络恢复后复验；继续保留原始 JS 根因和真实 Core 刷新为未验证项。
- 阻塞 / 待核实副作用：TaskSpace 8 已按用户继续指令恢复；真实页面生成覆盖剪贴板，未读取或转发正文。Ego Lite 通知有新版本可用，当前版本保持不变。其余既有未提交工作保持原样。
- 证据：M0 收据 `/private/tmp/learn-x-chatpack-m0/handoff-receipt.json`；修复前定向 Chat Pack 测试 34/34、全仓 `npm test` 618/618；新增缓存根 symlink 反例后定向 35/35、全仓 619/619；最终定向 Chat Pack 相关测试 13/13、全仓 624/624；三种构建均成功。截图组合 `learn-x 相关 / 周输出 / 多思考一步 / Core《道》` 在旧标签页未决剪贴板写入解除后，连续十次真实点击的按钮状态变化均为 1–4 ms，生成并确认复制为 61–171 ms，10/10 低于 2 秒；此前另有两次 3.3 ms、20.7 ms 反馈样本。旧标签页曾因剪贴板写入未结束而明确拦截新生成，当前页面重载后恢复，题目与选择保持。最近状态接口 16/16 可用、刷新 16/16 因 Prompt DNS 与 Core 读取错误失败，旧缓存成功时间未改写；手动刷新在冷却中显示倒计时。PM2 `ywdev-learn-x` 在此前快照中 online，重启计数在忽略规则调整后保持稳定。独立审查发现并修复父级 `.local` symlink 可绕过缓存叶目录检查的问题，新增反例验证拒绝外部写入。页面首轮曾发现 Core 缓存规范化缺少 `core_kind`，导致 Core 被误判“校验失败”；字段及回归测试已补齐。
- 工作区核对时间：2026-10-20 Asia/Shanghai

## 需求—实现—测试—证据

| 需求 | 实现位置 | 针对性验证 | 当前证据与状态 |
|---|---|---|---|
| R1：14 天持久缓存 | `app/code/scripts/chatpack-cache.mjs`、`app/code/server.mjs` | 缓存重启/过期、来源映射/hash、缓存损坏与写盘失败用例 | 单测通过；真实服务 16/16 可用，接口给出真实 `fetched_at` 与 14 天 `expires_at`。通过 |
| R2：启动、每日、生成及手动全量刷新 | `app/code/server.mjs`、`app/code/scripts/chatpack-cache.mjs`、`app/code/public/app.js` | 冷却到期重启恢复、刷新完成后状态与失败保留用例 | 全量接口运行中曾完成 16 项；最近一轮远端 16 项因 DNS 失败，保留旧缓存。每日周期尚未等待 24 小时实测。代码与离线验证通过 |
| R3：60 秒节流、合并、最多两路读取及优先级 | `app/code/scripts/chatpack-cache.mjs` | 并发合并、优先队列、两路并行上限、跨重启冷却用例 | 定向测试通过。通过 |
| R4：缓存/更新状态、年龄、错误与恢复入口 | `app/code/server.mjs`、`app/code/public/index.html`、`app/code/public/app.js`、`app/code/public/styles.css` | 状态只返回元数据、错误和非本机访问拒绝；UI 状态更新用例 | 真实页面观察到 16/16 可用、14 天有效，同时显示后台刷新失败；未将失败误报为未拉取。通过 |
| R5：必需项完整有效，更新失败时停止交付 | `app/code/scripts/chatpack-cache.mjs`、`app/code/public/app.js` | 部分包拒绝、必需资源失败先于无关任务结束、前端不复制过期/不完整数据 | 定向测试通过；真实组合使用有效缓存，在后台 DNS 故障时仍可生成。通过 |
| R6：快速反馈、超时、取消、剪贴板恢复 | `app/code/public/app.js` | 问题变化取消、延迟剪贴板锁定、复制失败重试、坏 JSON/服务断开/90 秒期限模拟 | 连续十次真实页面反馈为 1–4 ms，确认复制耗时 61–171 ms；旧标签页未决剪贴板写入拦截被现场复现，载入当前页面后恢复。原始用户 JS 堆栈未取得 |
| ACC11：更新、失效和持久写入故障 | `app/code/scripts/chatpack-cache.mjs` | 新 Prompt revision 正文更新、磁盘持久化并重启读回；来源/hash/损坏/symlink/写盘失败用例 | 针对性用例通过；远端真实 Core 更新仍受网络故障阻塞 |
| ACC12：兼容性与公开边界 | `app/code/scripts/*test.mjs`、构建脚本 | 全仓测试及 local/public/public-no-context 构建 | `npm test` 618/618；三种构建成功；公开构建检查确认不打包私有缓存。通过 |

未在用户原始浏览器中取得其当时 JavaScript 错误堆栈。现场观察到的具体状态是旧标签页保留未决剪贴板写入，并拦截后续生成；载入当前页面后恢复。这能说明一种实际故障路径，不证明它就是用户最初的 JS 根因。

## ywuse Deep 验收补充（2026-10-20）

已新增 [验收报告](acceptance.md)，总判定为部分达成。根据 `yw-acceptance` Deep 流程，在系统使用知识库新增 Learn-X Chat Pack 使用说明，更新导航首页入口并读回，仓库 README 加入同一链接。独立 yw-testing 子代理复核生成和复制重试挂起时的未知状态、刷新恢复入口、重入拦截，以及迟到 resolve/reject 后解锁与重试；报告通过。协调者将迟到 reject/重试加入页面故障测试，并增加新 Prompt revision/正文持久化后重启读回测试。新增缓存更新用例与剪贴板双结局页面用例的定向测试 13/13；最新完整 `npm test` 624/624。三种构建在生产代码变更后均成功。

## 来源与落点核对
- ywuse Deep 验收、Usage Truth 与逐项判定 → [Acceptance](acceptance.md)。
- 用户原始输入及两轮偏好确认 → Requirement「来源原文／用户追加确认」。
- 用户提交的完整实施方案 → Execution Plan「方案原文」。
- 执行进度与证据 → 本 Case「执行状态」。

## 来源核验
- 状态：待复核
- 机器收据：None
- 缺口报告：暂无。原始用户消息由当前会话 ID 和消息 ID 定位。

## 执行入口
剩余验收：等待 24 小时并观察每日刷新；DNS/网络恢复后重试全量远端更新和 Core 正式读取；取得用户原始页面 JavaScript 堆栈以确认最初无响应根因。ACC6 十次连续真实测量已由本轮完成。

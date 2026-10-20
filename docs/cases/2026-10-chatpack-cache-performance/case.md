# CASE: Learn-X Chat Pack 提速与缓存状态改造

- 状态：执行收口，验收部分达成
- 最后核对日期：2026-10-20
- 上下游链接：[Requirement](../../requirements/2026-10-chatpack-cache-performance.md) → [Execution Plan](execution-plan.md)
- Type: Major
- Status: Partial
- Requirement: [2026-10-chatpack-cache-performance.md](../../requirements/2026-10-chatpack-cache-performance.md)
- Architecture / Planning: [Architecture Truth](../../architecture.md) / [Execution Plan](execution-plan.md)
- Testing: [yw-testing report](testing-report.md)
- ADR: None
- Implementation: `app/code/scripts/chatpack-cache.mjs`, `app/code/server.mjs`, `app/code/public/`
- Acceptance: [ywuse 报告](acceptance.md) — 部分达成
- Version: None

## 执行状态
- 当前有效方案：`execution-plan.md` 中本轮用户提供的完整方案；本轮用户明确授权实施。
- 完整授权范围与阶段顺序：M0 保存/核对方案；M1 穿通截图中的生成链路；M2 全量自动缓存；M3 异常回归与文档修正；随后依用户本轮明确顺序执行 `yw-development → yw-testing 第一轮 → 一个新的独立 ywtest 子代理 → ywuse`，持续修复授权范围内发现的问题。
- 最后已验证里程碑：M0–M3、yw-development、协调者 yw-testing、独立只读 ywtest 与 Deep ywuse 均已执行。挂起状态查询/手动刷新 P2 已修复并由同一独立测试员复测；定向测试 48/48、全仓串行测试 648/648、三种构建均通过。真实截图组合 10/10 完成，首反馈 0.6–6.0 ms、复制确认 117.9–195.0 ms。当前 4173 缓存 16/16 可用，最新刷新受 DNS 失败影响。
- 剩余事项：Feishu 网络恢复后再确认一次全量刷新；记录真实 24 小时墙钟触发；如需定位旧页面最初 JS 根因，需取得原始堆栈；浏览器原生剪贴板 API 挂起尚未直接注入。现有功能和离线验收已收口，整体验收结论为部分达成。
- 下一步：无授权范围内代码步骤待执行。Feishu DNS 恢复后可由页面自动更新或手动“刷新全部缓存”；若用户能提供当时 JS 堆栈，可据此确认原始故障是否与本轮已覆盖的挂起请求/剪贴板路径相同。
- 副作用与工作区保护：用户授权接管 TaskSpace 3 完成测量；结束时释放了原有页面并保留两枚未托管用户标签页。未读取剪贴板正文；其它 weekly 脏文件和未跟踪 `draft_5b4b062a_folder/` 未触碰。
- 证据：M0 收据 `/private/tmp/learn-x-chatpack-m0/handoff-receipt.json`；最新定向 48/48、全仓串行 648/648、三种构建、10 次真实点击、状态接口 16/16 缓存与 DNS 刷新失败，以及 Usage Truth revision 5 读回，详见 [Testing](testing-report.md) 与 [Acceptance](acceptance.md)。
- 工作区核对时间：2026-10-20 10:02 UTC

## 需求—实现—测试—证据

| 需求 | 实现位置 | 针对性验证 | 当前证据与状态 |
|---|---|---|---|
| R1：14 天持久缓存 | `app/code/scripts/chatpack-cache.mjs`、`app/code/server.mjs` | 缓存重启/过期、来源映射/hash、缓存损坏与写盘失败用例 | 单测通过；真实服务 16/16 可用，接口给出真实 `fetched_at` 与 14 天 `expires_at`。通过 |
| R2：启动、每日、生成及手动全量刷新 | `app/code/server.mjs`、`app/code/scripts/chatpack-cache.mjs`、`app/code/public/app.js` | 冷却到期重启恢复、刷新完成后状态与失败保留用例 | 全量接口运行中曾完成 16 项；最近一轮远端 16 项因 DNS 失败，保留旧缓存。每日周期尚未等待 24 小时实测。代码与离线验证通过 |
| R3：刷新节流与立即重试 | `app/code/scripts/chatpack-cache.mjs` | 成功后 60 秒节流；全失败/部分失败立即重试；跨重启恢复失败状态；跨实例在途合并 | 缓存定向套件 24/24 通过，旧成功冷却与失败立即重试均有覆盖。通过 |
| R4：缓存/更新状态、年龄、错误与恢复入口 | `app/code/server.mjs`、`app/code/public/index.html`、`app/code/public/app.js`、`app/code/public/styles.css` | 状态只返回元数据、错误和非本机访问拒绝；UI 状态更新用例 | 真实页面观察到 16/16 可用、14 天有效，同时显示后台刷新失败；未将失败误报为未拉取。通过 |
| R5：必需项完整有效，更新失败时停止交付 | `app/code/scripts/chatpack-cache.mjs`、`app/code/public/app.js` | 部分包拒绝、必需资源失败先于无关任务结束、前端不复制过期/不完整数据 | 定向测试通过；真实组合使用有效缓存，在后台 DNS 故障时仍可生成。通过 |
| R6：快速反馈、超时、取消、剪贴板恢复 | `app/code/public/app.js` | 问题变化取消、延迟剪贴板锁定、复制失败重试、坏 JSON/断线、状态 JSON 挂起、8/10/90 秒期限与取消模拟 | 最新 10 次受信任点击首反馈 0.6–6.0 ms、复制确认 117.9–195.0 ms，10/10 成功；状态轮询 single-flight、挂起 JSON 与手动刷新恢复测试通过，独立复测无 P1/P2。旧标签页曾复现未决剪贴板写入阻断后续生成；用户最初 JS 堆栈仍未取得 |
| ACC11：更新、失效和持久写入故障 | `app/code/scripts/chatpack-cache.mjs` | 新 Prompt revision 正文更新、磁盘持久化并重启读回；来源/hash/损坏/symlink/写盘失败用例 | 针对性用例通过；远端真实 Core 更新仍受网络故障阻塞 |
| ACC12：兼容性与公开边界 | `app/code/scripts/*test.mjs`、构建脚本 | 全仓测试及 local/public/public-no-context 构建 | 最新定向 Chat Pack 48/48、全仓串行 648/648；local/public/public-no-context 构建均成功并最终恢复 local。公开构建未打包私有缓存，共享 Prompt/Core 仍按原实时读取语义工作。 |

未在用户原始浏览器中取得其当时 JavaScript 错误堆栈。现场观察到的具体状态是旧标签页保留未决剪贴板写入，并拦截后续生成；载入当前页面后恢复。这能说明一种实际故障路径，不证明它就是用户最初的 JS 根因。

## ywuse Deep 验收补充（2026-10-20）

已新增 [验收报告](acceptance.md)，总判定为部分达成。Usage Truth 页面已新增并更新导航入口；README 已加入同一链接。独立 yw-testing 子代理复核生成和复制重试挂起时的未知状态、刷新恢复入口、重入拦截，以及迟到 resolve/reject 后解锁与重试；最新针对 P2 的定向复测 48/48 通过。全仓串行回归 648/648，local/public/public-no-context 三种构建均成功。使用页补充 8 秒状态查询和 10 秒手动刷新超时语义，最终读回 revision 5。

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
剩余验收边界：Feishu DNS 恢复后的全量刷新、真实 24 小时墙钟触发、用户最初页面 JavaScript 堆栈和原生剪贴板挂起。ACC6 的最新十次真实测量已由用户再次授权后完成；跨进程状态恢复已通过当前代码的独立进程回归，4173/4181 曾于 09:32 UTC 同步报告同一轮刷新结果。

## 续验记录（2026-10-20 04:54 UTC）

真实状态接口于 04:52:23–24 UTC 显示 16/16 项缓存仍可用，最近全量刷新 16 项全部失败；Prompt 错误归类为 `open.feishu.cn` DNS，Core《道／法》读取失败。失败没有改变 04:49:23–27 的最后成功时间或 2026-11-03 到期时间。随后截图组合的缓存读取返回 HTTP 200，来源 `learn-x-chatpack-cache`，Prompt revision 65/12 与 Core《道》revision 7 均有有效 hash；页面状态清楚地将“缓存可用”与“后台冷却/更新错误”分开呈现。

本轮协调者定向用例 36/36、`npm test` 633/633 通过。对抗性审计提到的必需资源失败延迟与复制期间选择变化问题，当前代码和页面测试已有对应处理与断言；本轮未改生产代码。尝试复用同一独立测试员做只读复测时，平台因 usage limit 拒绝启动，因此没有新的独立复测证据。真实飞书全量成功更新、完整 24 小时定时周期及用户原始 JavaScript 堆栈仍未验证。

## 运行状态续查（2026-10-20 07:27 UTC）

原 Ego Lite TaskSpace 已从空间列表消失，没有新建替代空间。使用本机 Chat Pack 同源 API 只读核验：最新刷新于 07:26:23–24 UTC 结束，16 项均失败（Prompt DNS、Core 读取错误），但 16/16 项缓存仍有效；`fetched_at` 保持 04:49:23–27 UTC、到期时间保持 2026-11-03。刷新失败之后，截图组合的 cache/read 仍返回 HTTP 200、来源 `learn-x-chatpack-cache`，目标 Prompt revision 65/12 与 Core《道》revision 7 的 hash 校验通过。由于没有可用 Ego Lite 页面，本次续查未验证该时刻的 UI；04:52 UTC 的页面观察仍证明缓存可用性和后台冷却状态分开显示。按 60 秒冷却边界，本次没有重复触发刷新。

工作区续接时观察到 HEAD 已包含 `6aec8b4`（Chat Pack 缓存与周链自动化）及后续 `d08b792`（Flomo 换行修复）；本 agent 未执行提交、切换或清理。剩余周链脚本/Case 差异和未跟踪 `draft_5b4b062a_folder/` 均未触碰。

## 续验记录（2026-10-20 07:33 UTC）

独立复核复现“必需资源在 cache/read 返回 409 后、状态查询前刚刷新成功，但仍按旧缺失项报错”的竞态。已修复为按最新资源状态重新读取完整缓存包；若状态重复称可用但完整读取仍缺失，则一次重试后明确失败。修复后 Chat Pack 定向测试 36/36、独立 `core-truth-context.test.mjs` 1/1、local/public/public + context off 三种隔离构建均通过。独立全仓回归后来在并行变化的 weekly 测试和 `build-static-data.test.mjs` 构建子进程处失败；没有重跑或改动 weekly。再次查询本地 4173 状态接口时连接被拒绝，真实缓存现状需服务恢复后复验。详见 [Testing](testing-report.md) 与 [Acceptance](acceptance.md)。

## 运行态续验（2026-10-20 07:41 UTC）

运行态查明同仓另有 4181 服务进程，与 PM2 管理的 4173 共享磁盘缓存文件但内存刷新状态各自独立。4181 在 07:40:23–28 UTC 成功刷新 16/16；4173 仍保留先前失败状态。已按现有配置重启 PM2 `ywdev-learn-x`，4173 从磁盘读入新快照；随后截图组合的两条 Prompt 与 Core《道》cache/read 为 HTTP 200、来源标记正确、缓存年龄约 15 秒。未读取正文、未停止 4181。跨进程锁/状态同步未包含在当前方案，后续需确认本机是否只应保留一个服务实例。完整状态见 [Testing](testing-report.md) 与 [Acceptance](acceptance.md)。

## 真实页面续测（2026-10-20 16:30 Asia/Shanghai）

按用户确认继续测量时，Ego Lite `listTaskSpaces()` 初次返回空列表，没有可接管的既有空间；本次没有取得或更改此前用户空间 TaskSpace 8，而是在新建的 Agent 所有隔离空间中重开本地页面。测试前 Chat Pack 缓存 API 为 16/16 可用、更新冷却中，页面组合与截图一致。首轮辅助计时包含点击器派发延迟，不用于首反馈判定；随后把计时起点改为浏览器捕获的 `isTrusted=true` click 事件。连续十次全部由页面确认复制，click 到首个 UI 状态变化 0.4–1.8 ms，click 到复制确认 61.6–91.9 ms，10/10 低于 2 秒，按钮全部恢复可用。未读取剪贴板正文。两个新建测试空间 ID 1、2 均返回 `done=true` 并完成清理，剩余任务空间列表为空。

## 续验：本地运行图恢复与服务状态分叉（2026-10-20 08:43 UTC）

- 重新核对 4173 时，页面实际加载 `runtime.target=public`，因此缓存区按实现被隐藏；当前构建也不包含截图里的周输出子类型和已治理增强器。原因是前一轮 public 构建写入了 PM2 正在服务的共享 `dist/`。执行 `npm run build:local` 后，从隔离页面确认 4173 加载 `runtime.target=local`、159 个上下文文件、周输出和增强器恢复，缓存区重新可见；没有重启 PM2 或覆盖用户浏览器空间。
- 恢复后的页面当前选择与截图一致：`learn-x 相关 / 周输出 / 多思考一步 / 2026-W42 / Core《道》`，题目“周输出”。4173 状态接口返回 16/16 缓存可用、缓存年龄约 63 分钟，刷新失败单独呈现。最新状态再次显示 4173 与 4181 各自启动全量刷新，启动时间相差约 1.5 秒；4173 的 Prompt 读取因 Feishu DNS 失败，4181 已成功 13/16、仍在运行。两进程同写一个磁盘缓存但没有跨进程互斥和状态同步；这是已复现的服务级分叉，当前代码只保证进程内合并。
- 只读 `cache/read` API 对周输出、一步深化和 Core《道》执行 10 次完整读取，10/10 返回 HTTP 200、来源 `learn-x-chatpack-cache` 和完整资源集合；耗时 1.1–37.2 ms（首个请求 37.2 ms，之后 1.1–2.7 ms）。该数据不包含页面装配和剪贴板，不能替代 ACC6 浏览器计时。
- 在真实点击先导测量开始前，Ego Lite 明确报告 Agent 隔离空间 3 已由用户控制；本轮没有点击、接管或重试。已向用户请求是否再次授权接管。当前既有 10 次真实点击数据来自前轮；本轮本地运行图恢复后还需在用户交还空间时复测。
- 定向 Chat Pack 回归 `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/server.test.mjs app/code/scripts/chatpack.test.mjs` 为 36/36；`git diff --check` 通过。重新构建的本地静态产物位于被忽略的 `dist/`。

## 锁恢复、真实点击与收尾（2026-10-20 09:25 UTC）

- 用户明确再次授权接管隔离空间并完成测量。截图组合测试前服务状态显示缓存 16/16 可用。受信任 click 到首个 DOM 状态变化为 1.4–11.9 ms；点击到页面确认复制为 123.7–215.8 ms，10/10 成功且低于 2 秒。未读取剪贴板正文。
- 独立审计复现修复后的 stale 锁恢复：过期空/坏 JSON 主锁与孤立 recovery marker 均能回收；无 owner 的新鲜坏 marker 返回失败，不再永久假报运行。30 对独立 Node 进程与 120 组独立缓存实例临时竞争测试都只启动一次远端读取。为固化该证据，仓库新增三场景 OS 进程回归，覆盖正常并发、过期主锁和过期 recovery 锁；页面测试另验证恢复期明确显示“正在确认刷新锁”，而不是“正在更新”。
- 修复后 Chat Pack 定向测试 44/44。全仓默认并行 `npm test` 为 646/647；唯一失败在 `build-static-data.test.mjs` 调用的本地构建子进程，标准输出/错误未保留，根因未确认。使用 `rtk node --test --test-concurrency=1 ...` 对相同测试集合串行复跑，647/647 通过。local、public、public:no-context 三种构建成功，最终恢复 local 构建。`git diff --check` 与三个源文件 `node --check` 通过。
- 本机 4173 与 4181 的状态接口最新均显示缓存 16/16 可用、相同下次刷新时刻；刷新汇总仍分别为 16 项失败和 16 项成功。当前源码的跨进程文件锁已通过 OS 子进程验证；运行中的 4181 是否已装载新代码未验证，本轮未重启该服务。
- 本次验收仍为部分达成：24 小时周期未实际观察；原始页面 JS 堆栈和浏览器原生剪贴板挂起未取得；默认并行全仓失败根因未查明。缓存、界面及测量证据见 [Acceptance](acceptance.md)，测试细节见 [Testing](testing-report.md)。

## 续验：跨进程运行态收敛与每日调度覆盖（2026-10-20 09:32 UTC）

- 重新核对旧 4181 PID 34204：启动命令为本仓库 `node app/code/server.mjs`，但早于服务和缓存模块修改。按用户持续实施授权将其以 `SIGTERM` 退出，并在同一仓库以 `PORT=4181 HOST=127.0.0.1 node app/code/server.mjs` 启动当前代码；当前 4181 PID 61455、4173 PID 62494 均监听本仓库服务。
- 当前版本的 4181 启动后，4173/4181 两个状态 API 于 09:27 UTC 同时显示同一全量刷新：16/16 成功，启动时间 `2026-10-20T09:27:23.874Z`、完成时间 `09:27:28.391Z`。之后 09:30 UTC 的全量刷新在两端同样同步报告 16/16 失败；每项 Prompt 错误都是 `open.feishu.cn: no such host`，两个 Core 错误为 `Lark document read failed`。失败没有改变磁盘缓存；两端仍显示 16/16 `available`。这是外部 DNS 故障，不是跨进程状态差异。
- 4173 与 4181 对截图目标组合的 `POST /api/chatpack/cache/read` 均返回 HTTP 200、source=`learn-x-chatpack-cache`，Prompt revision 65 / 12 与 Core《道》revision 7 均带有效 hash；脚本只输出元数据，没有读取或打印正文。
- 在同一授权 Ego Lite TaskSpace 3 中保留了两个原有未托管用户标签页，并用新建 Agent 页确认截图组合 `learn-x 相关 / 周输出 / 多思考一步 / 2026-W42 / Core《道》`、题目“周输出”、8 个已选 Context 与 16/16 可用缓存。真实点击约 0.1 秒即由页面确认复制，按钮恢复可用；生成状态注明使用 4 分钟前拉取的缓存。测量页随后由 `finish({ keep: [] })` 关闭，两个用户标签页保留。
- 新增 `daily refresh starts a full update 24 hours after the last refresh` 可控时钟回归，用例覆盖定时器建立与全量刷新执行。Chat Pack 定向测试最新 **48/48**，测试脚本语法检查和 `git diff --check` 均通过；本轮未改生产代码。真实墙钟 24 小时触发仍待观察。
- 开发阶段至此收口；下一步按用户要求进入第一轮 `yw-testing`。随后另启动一个新的独立 ywtest 子代理，再做 Deep `ywuse`。全仓串行回归、原始错误栈与原生剪贴板挂起仍列为未验证。

## 最终复验：挂起请求与真实页面性能（2026-10-20 09:58 UTC）

- 独立复核发现状态轮询与手动刷新缺少请求期限。已补 8 秒状态 fetch+JSON 期限和 single-flight 合并、10 秒手动刷新期限及 finally 恢复按钮；超时显示结果未知，生成取消后不再启动新的状态请求。
- 新故障用例覆盖挂起 fetch、挂起 response.json、双轮询只发一条请求、手动刷新挂起与按钮恢复。定向套件 48/48；同一独立测试员复读复跑 48/48，未发现确认的 P1/P2；全仓串行 648/648。三种构建均通过。
- TaskSpace 3 的原有 4173 页面按截图组合连续 10 次可信点击，首反馈 0.6–6.0 ms，复制确认 117.9–195.0 ms，10/10 成功。未读取剪贴板正文；结束时释放原有用户页面并保留两枚未托管用户标签页。
- 最新同源状态接口显示缓存 16/16 可用；周输出 Prompt revision 65、一步深入 Prompt revision 12、Core《道》revision 7 的到期时间均为 2026-11-03 09:27 UTC。09:56 UTC 全量更新 0/16 成功，Prompt 报 Feishu DNS `no such host`，Core 读取失败，缓存成功时间未变化。
- Usage Truth 页面局部更新后读回 revision 5。剩余边界为恢复 DNS 后的刷新、24 小时墙钟观察、用户原始 JS 堆栈和浏览器原生剪贴板挂起。

## ywdebug：刷新失败后冷却过长（2026-10-20）

- 用户指出截图中全量刷新失败后仍显示冷却 52 秒，并要求失败后允许立即更新。复现测试先稳定失败：刷新结束后 `status.refresh.state` 仍为 `cooldown`，而不是 `failed`；立即调用 `requestRefresh()` 也会被 60 秒门槛拦截。
- 根因是 `lastRefreshStartedAt` 在每轮开始时写入并持久化，却被同时用作成功节流基准。状态接口与请求入口都只看该时间戳，不看最终 `failed/partial/succeeded` 结果。独立只读审计以临时缓存目录再次复现全失败后立即请求仍返回 `cooldown`。
- 修复后只对最近一轮成功全量刷新实施 60 秒节流。全失败或部分失败显示终态且 `next_allowed_at=null`，后续启动、生成和手动请求均可立即开始；在途跨实例请求仍通过锁合并，失败不会自动循环重试。原成功冷却时间仍在服务重启后保留。
- 红绿证据：新增断言在修复前因 `actual: cooldown, expected: failed` 稳定失败；修复后全失败、部分失败立即重试与重启恢复测试通过。缓存模块套件 `node --test app/code/scripts/chatpack-cache.test.mjs`：24/24 通过。
- 服务激活与边界：PM2 watch 起初未切换到新 PID；按项目现有配置定向执行 `pm2 restart ywdev-learn-x --update-env`，PM2 返回 online PID 98334。随后 `app/code/` 测试变更触发已配置的 watch，最终 `lsof` 确认 PID 98983 监听 `127.0.0.1:4173`。命令行本机 HTTP 状态请求仍被沙箱策略拦截，因此没有确认重启后的缓存状态或页面终态；本轮未额外触发 Feishu 全量读取。

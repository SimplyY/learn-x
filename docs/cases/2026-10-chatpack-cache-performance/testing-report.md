# yw-testing｜Learn-X Chat Pack 提速与缓存状态改造

- 日期：2026-10-20
- 阶段：第四轮挂起请求专项复测、用户授权真实点击复测与 ywuse 收口
- 结论：**PARTIAL**。Chat Pack 定向测试 48/48、全仓串行测试 648/648、三种构建及最新真实点击 10/10 通过。首个 UI 反馈 0.6–6.0 ms，页面确认复制 117.9–195.0 ms。当前 4173 缓存 16/16 仍有效，最新远端刷新受 Feishu DNS 故障影响而 16/16 失败；用户原始 JS 堆栈、完整墙钟 24 小时周期和原生剪贴板挂起仍未验证。
- 需求与执行方案：[Requirement](../../requirements/2026-10-chatpack-cache-performance.md) / [Execution Plan](execution-plan.md)

## 验证范围

依据原始需求 R1–R6 及 ACC1–ACC12，核查持久缓存、缓存状态、刷新并发与节流、完整读取、按钮生成/复制、异常恢复、其他 Prompt/Core 实时读取语义及公开构建边界。只用状态、revision、正文 hash 和成功/失败结果记录远端链路，不记录 Prompt 或 Core 正文。

## 第一轮协调者自测

| 检查 | 命令或动作 | 结果 |
|---|---|---|
| Chat Pack 定向单测 | `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/server.test.mjs app/code/scripts/chatpack.test.mjs` | 修复前 34/34；增加父级符号链接反例后 35/35 通过。覆盖 14 天期限与重启、来源/hash 损坏、写盘失败、缓存刷新合并和双并发、必需资源快速失败、无效 JSON、服务断开、挂起状态请求、90 秒期限、选择变化、延迟/拒绝剪贴板及重试、缓存根目录符号链接拒绝 |
| 全仓回归 | `npm test` | 修复前 618/618；父级缓存符号链接修复后 619/619；该轮最终回归 624/624 通过 |
| 构建兼容 | `npm run build:local`；`npm run build:public`；`npm run build:public:no-context` | 本次修复后均成功；构建测试确认公开产物无本地缓存/受治理正文 |
| 实际缓存权限 | `stat -f '%Sp %N' app/code/.local app/code/.local/chatpack-cache app/code/.local/chatpack-cache/cache.json` | 缓存目录 `0700`、文件 `0600`；`.local` 已被 Git 忽略 |
| 实际服务状态 | 同源 `GET /api/chatpack/cache/status` 与缓存状态区 | 最近一轮于 2026-10-20 04:41:58–59 UTC 完成：HTTP 200，16/16 缓存可用、14 天有效，刷新 16/16 失败。Prompt 因 `open.feishu.cn` DNS `no such host` 失败，Core 道/法为 `Lark document read failed`；旧 `fetched_at` 为 04:31:23–27 且未改变。冷却期内点击显示倒计时；请求合并到 60 秒边界后启动一轮，没有在间隔内并行读取。04:42:26 页面显示剩余 34 秒。 |
| 真实页面生成 | 截图组合 `learn-x 相关 / 周输出 / 多思考一步 / Core《道》` | 旧页面曾留有未决剪贴板写入，重新生成被明确拦截；载入当前页面后恢复题目与全部选择。此前一组连续 10 次由页面确认复制，首反馈 1–4 ms、完成 61–171 ms。2026-10-20 16:30 Asia/Shanghai 复测前缓存 16/16 可用；受信任 click 事件到首个状态 DOM 变化 0.4–1.8 ms，到复制确认 61.6–91.9 ms，10/10 复制成功且低于 2 秒，按钮每次恢复可用。用户原始 JS 堆栈仍未取得。 |

## 真实飞书读取

- 通过共享读取器分别读取 `chatpack.weekly-output` 和 `chatpack.one-step-deeper`。两项 latest 均成功，revision/hash 与本地缓存项相同：revision 65 / `041359c26d76664043cd1c741fbba1ba314e2e0e2519bd6872c0058a8571897b`，revision 12 / `613c0e55c9fd55aeb6f26963f7f9fa94a37c8474b1e53fb711df9cc9c7448e10`。正文未输出。
- 调用本地正式全量刷新接口后，后台 16 项均失败；失败项状态为 network/transport，缓存读取时间保持不变。单独以现有 Core 读取身份 `--as bot` 读 Dao/Fa 也返回 network/transport；`lark-cli auth status --json --verify` 显示 user token valid，bot verification failed。当前证据是网络传输故障，不足以推断为缺少 scope 或身份授权问题。
- 本地 `/api/chatpack/cache/read` 对周输出、一步深入和 Core《道》返回 HTTP 200、来源 `learn-x-chatpack-cache`、完整的两个 Prompt 加一个 Core；该读取验证命中本地缓存，不代表本次真实拉取 Core 成功。
- 因飞书刷新未能完成，按 `yw-testing` 要求将核心真实飞书 E2E 标为 **未验证 / BLOCKED**，不能以 mock、旧缓存或 Prompt 子集读取代替通过结论。

## 已修复的测试发现

自测发现必需缓存未命中后，前端等待状态接口时未传递本次生成的 AbortSignal，状态请求若挂起会绕过 90 秒期限。已让该查询共享取消信号，并令主动取消不误报缓存服务不可用；故障注入现在验证挂起状态查询在模拟的 90 秒期限结束并恢复按钮。

独立测试员另发现 `.local` 父目录为符号链接时可能把缓存写出预期根目录。已在缓存目录创建/使用前检查父级 `lstat` 并拒绝符号链接，新增隔离反例验证目标目录不会生成缓存文件、当前进程中的新正文仍可用。独立复测 `node --test app/code/scripts/chatpack-cache.test.mjs` 为 11/11；修复后的协调者定向测试 35/35、全仓测试 619/619、三种构建均通过。两个相关源文件在工作树中为未跟踪文件，普通 `git diff --check` 不会检查其内容；独立测试员用 `git diff --no-index --check /dev/null <file>` 检查后未见空白问题。

## 独立 yw-testing 子代理

- 独立只读复核检查了有效期、重启恢复、资源身份与正文 hash、刷新合并/并发、必需资源失败、剪贴板恢复、取消与超时、latest 兼容入口，以及缓存权限和公开边界；修复前全仓基线 618/618 通过。独立复测父目录符号链接反例通过，未确认其他 P0/P1 缺陷。
- 只读本地状态在 2026-10-20 04:16:49 UTC 返回 16/16 失败：Prompt 底层为 `open.feishu.cn` DNS `no such host`，Core 显示 `Lark document read failed`；缓存仍 16/16 可用，`fetched_at` 未被改写。截图组合 `cache/read` HTTP 200 且来源为 `learn-x-chatpack-cache`，只读取元数据。
- 独立验收当时判定为 **部分通过**：真实飞书刷新为 **未验证 / BLOCKED**；当时 ACC6 真实页面测量为 2/10。测试员未访问由用户接管的 Ego Lite TaskSpace 8，也未执行三种构建（协调者在修复后已执行）；本报告后续章节记录了用户明确继续后完成的 10 次连续页面测量。

## 新增真实页面复现与连续性能样本

- 实测前旧标签页状态：生成预览为只读、已生成内容长度 75,559 字符；内部剪贴板写入仍未结束。再次点击显示“已有剪贴板写入仍在处理；完成后再生成，避免旧结果晚到覆盖”，说明这是一个明确的重入锁状态。旧页面 DOM 缺少当前版本的 `刷新页面恢复操作` 按钮，状态仍残留此前的 90 秒失败文本。
- 对同一标签页载入当前页面后，剪贴板挂起锁被重置，恢复按钮存在，题目与 `learn-x 相关 / 周输出 / 多思考一步 / Core《道》` 选择恢复；缓存 UI 显示 16/16 可用、后台更新失败。之后 10 次连续真实点击全部生成并由成功状态确认复制。每次 click 事件到首个操作状态 DOM 变化为 1–4 ms；从 click 到完成复制状态为：150、87、79、84、61、68、129、145、171、129 ms，全部低于 2 秒。另有恢复前两个成功样本与后续补充样本，本次共 13 次成功生成。
- 这些证据复现了“旧页面未决剪贴板写入阻止后续生成”的具体故障路径，并验证当前页面恢复后性能目标达成；Ego Lite 页面事件缓冲没有返回原始 JavaScript 异常，因此不把这个复现等同于用户当时的具体 JS 根因。
- 两次冷却期间点击刷新均显示剩余时间，并把请求合并到下一个允许时间：刷新开始时间为 04:40:58.728 与 04:41:58.734 UTC。两轮均为 16 项失败，间隔至少 60 秒，原缓存保持可用，证明刷新状态与缓存状态分开表达。

## 待完成与边界

- ACC6 连续 10 次页面性能目标已通过；仍需等待完整 24 小时观察自动刷新触发。
- Core 飞书读取待 DNS/网络恢复后经正式缓存刷新链路复验；用户原始页面当时的 JavaScript 错误堆栈仍无法取得。
- 当前结论仅覆盖上述命令、环境和已记录的真实页面样本；两项新 Core 正式读取仍因网络故障未验证，不代表服务已经停止。

## 第二轮独立复核与最终针对性回归

协调者修复剪贴板请求永不 settle 时的恢复状态后，独立 yw-testing 子代理只读检查并复测：90 秒期限到达后，界面显示“复制状态未知”并提供刷新页面恢复入口；未确认的旧写入期间阻止重叠生成；迟到 resolve 和 reject 都能按实际结果恢复选择与生成控件；迟到 reject 保留复制重试，重试成功。其后独立复测复制重试自己的 90 秒期限：挂起时显示未知并提供刷新，禁用生成，迟到 resolve 后确认写入并恢复；迟到 reject 的变体也验证了再次显示复制重试入口并成功恢复。独立 JSDOM 变体、`node --check app/code/public/app.js` 和相关 `git diff --check` 均通过，未修改文件。浏览器原生剪贴板 API 尚未执行挂起故障注入。

协调者把迟到 reject 与重试加入正式页面回归，并新增“新 Prompt revision 与正文刷新后写入磁盘、重启后读回”的缓存用例。该轮定向 `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs` 为 13/13；该轮全仓 `npm test` 为 624/624。复制重试期限修改后的 `npm run build:local`、`npm run build:public`、`npm run build:public:no-context` 均成功。

`ywuse` Deep 完成 Usage Truth：新增 Learn-X Chat Pack 使用说明，readback 为 revision 3；系统使用知识库导航更新 readback 为 revision 17；仓库 README 已加入入口。验收总判定仍为部分达成，详情见 [Acceptance](acceptance.md)。

## 续验：回归与运行缓存（2026-10-20 04:54 UTC）

- 协调者新鲜复跑 Chat Pack 定向用例 `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/server.test.mjs app/code/scripts/chatpack.test.mjs`：36/36 通过；`npm test`：633/633 通过。上一轮生产代码修改后的三种构建均已成功，本次续验没有改动生产代码。
- 同源缓存状态接口于 04:52:23–24 UTC 返回 HTTP 200：16/16 项可用；最近全量刷新 0 成功、16 失败，Prompt 失败为 `open.feishu.cn` DNS，Core《道／法》失败为读取错误。所有缓存项的最后成功读取仍在 04:49:23–27，过期时间在 2026-11-03 04:49:23–27；刷新失败未延长旧缓存。页面状态同时显示“缓存可用 16/16 项 · 14 天有效”和后台冷却倒计时。
- 最近一次本地完整读取 `/api/chatpack/cache/read` 返回 HTTP 200、来源 `learn-x-chatpack-cache`，截图组合所需 Prompt revision 65/12 与 Core《道》revision 7 均有有效 hash 和成功时间；正文只在本地接口处理，报告未记录正文。
- 对抗性审计的一项陈述与当前源码不符：当前前端在必需资源单项 `refresh_status === "failed"` 时立即结束生成；页面测试 `required-failure-running` 验证无关刷新仍运行时也会结束。延迟剪贴板期间选择控件被锁定，写入结算后仍校验 generation token；当前页面测试覆盖所有实际渲染的选择控件。未据该陈述改生产代码。
- 对同一独立测试员发起的本轮只读复测因平台返回 usage limit 未能执行；因此本次续验没有新增独立审计证据。此前已完成的独立复核仍见上文。本轮外部飞书读取仍为 **未验证 / BLOCKED**，不以本地缓存命中替代。

## 运行状态续查（2026-10-20 07:27 UTC）

原 Ego Lite TaskSpace 已不在空间列表中，因此本次没有创建替代页面。通过本机 Chat Pack 同源 API 只读复核：`GET /api/chatpack/cache/status` 返回 HTTP 200、16/16 可用；最近刷新 07:26:23–24 UTC 为 0 成功、16 失败，Prompt 为 DNS、Core《道／法》读取失败。所有成功时间仍为 04:49:23–27 UTC，到期时间仍为 2026-11-03 04:49:23–27。随后 `POST /api/chatpack/cache/read` 返回 HTTP 200，来源 `learn-x-chatpack-cache`，截图组合所需两条 Prompt 与 Core《道》revision/hash 校验通过。该续查验证本地接口与旧缓存保留，不是页面 UI 或真实飞书成功 E2E；本地服务仍处在刷新冷却期，未再请求刷新。

## 续验：刷新完成竞态修复（2026-10-20 07:33 UTC）

- 独立只读复核新发现一个可复现的 P2 竞态：`cache/read` 首次返回 409 后，如果必需资源在状态请求前刚刚刷新成功，状态已显示该资源可用、全量刷新成功，但旧实现仍按 409 的 `missing` 列表报错。复现记录为首次缓存读取 1 次、刷新状态 `succeeded`、资源可用 16/16，但无复制且生成失败。
- 已在 `app/code/public/app.js` 修复：409 后将缺失项与最新资源状态合并；若必需项现已可用，则重新读取完整缓存包；只有当前仍缺失时才按当前资源/刷新状态失败。若状态连续显示可用而完整读取仍 409，只重试一次后明确报状态不一致，避免无界循环。新增 `core-truth-context.test.mjs` 时序用例覆盖刷新刚完成后的重读成功，以及状态不一致时有界失败。
- 修复后协调者定向 Chat Pack 测试 36/36 通过、`node --check app/code/public/app.js` 与 `git diff --check` 通过；独立测试员再次运行 `rtk node --test app/code/scripts/core-truth-context.test.mjs`，1/1 通过，并确认原有必需资源失败快速终止测试仍通过。
- 修复后隔离重跑 local、public、public + context off 三种静态构建，均成功；最终代码的输出写入新建的 `dist/.chatpack-verify-20261020b/` 后已删除该目录，没有覆盖既有 `dist` 内容。
- 全仓回归边界更新：协调者此前一轮 `npm test` 633/633 通过；独立测试员之后一次 `npm test` 退出码 1，失败涉及并行变化的 weekly 脚本/测试（包括 `originalRunId is not defined`、预期 `succeeded` 实际 `needs_review`），以及 `build-static-data.test.mjs:11` 的构建子进程失败（子进程输出被测试忽略，原因未确定）。该命令会写 `dist`；未再运行全仓回归，以免扩大对并行工作区和构建产物的影响。因此 633/633 是较早时点结果，不代表这次竞态修复后的全仓最新通过。
- 本轮再次请求 `127.0.0.1:4173/api/chatpack/cache/status` 时连接被拒绝；没有触发刷新。此前 07:27 API 状态仍是 16/16 旧缓存可用、全量刷新 16 项失败，缓存成功时间未改变。当前端口离线不能推断缓存为空，服务恢复后仍需重查真实刷新与页面状态。

## 运行态复验：成功刷新与进程状态分歧（2026-10-20 07:41 UTC）

- 提权只读状态查询确认 `ywdev-learn-x` PM2 服务 PID 17476 在 4173 online；同一仓库另有 Node PID 34204 监听 4181，二者都使用 `app/code/.local/chatpack-cache/cache.json`，但各自持有独立内存刷新状态。
- 07:39:54 UTC 对比时，4181 最近一轮刷新于 07:39:23.559–07:39:28.875 UTC 完成，16/16 成功；4173 仍报告 07:35 的全量失败、资源时间 07:34。磁盘元数据稍后又被 4181 更新，确认两个进程的内存状态没有随共享文件同步。
- 07:40:23.562–07:40:28.777 UTC，4181 再次观测到 16/16 刷新成功。16 项均可用，最后成功读取时间为 07:40:24–28，14 天到期时间为 2026-11-03 07:40:24–28；Prompts 与两个 Core 均通过来源/hash 校验，正文未输出。
- 为让截图指定的 4173 服务读入这份成功磁盘快照，执行 `rtk pm2 restart ywdev-learn-x --update-env`。PM2 返回 online；随后 4173 `/api/chatpack/cache/status` 为 16/16 可用、冷却到 07:41:23.562，截图组合 `cache/read` 为 HTTP 200、来源 `learn-x-chatpack-cache`，Prompt revision 65/12、Core《道》revision 7，年龄约 15 秒。未读取正文；4181 未终止。
- 当前快照对齐，但两个服务进程仍各自维护刷新 job/status。若任一进程后续单独更新缓存文件，另一个进程的页面可能继续显示旧年龄或刷新结果。当前验收只覆盖单进程跨标签页；跨进程锁与状态同步未实现，也未按本轮计划额外扩展。

## 续验：受信任点击事件起点的 ACC6 复测（2026-10-20 16:30 Asia/Shanghai）

- 续作时 `listTaskSpaces()` 初次返回空列表，没有可接管的既有空间；因此没有取得或更改此前用户空间 TaskSpace 8。本次在两个新建的 Agent 所有隔离空间中打开同一 `127.0.0.1:4173/#learning` 页面。组合为 `learn-x 相关 / 周输出 / 多思考一步 / 2026 年第 42 周 / Core《道》`，题目为“周输出”。测试前状态 API 报告缓存 16/16 可用、刷新冷却中。
- 第一轮辅助复测以调用自动化点击器之前的时间为起点，包含工具派发延迟，不用于首反馈判定。随后在按钮 capture 阶段记录 `event.isTrusted === true` 的 click 时间戳，从该事件开始计时。
- 事件到首个按钮/状态 DOM 变化为 1.8、0.5、0.7、0.4、0.7、0.5、1.2、0.5、0.7、0.6 ms；事件到页面确认“Chat Pack 已生成并复制”为 91.9、84.8、83.5、61.6、83.7、87.3、84.7、79.8、78.6、76.4 ms。10/10 复制成功，10/10 低于 2 秒，按钮每次恢复可用。未读取剪贴板正文。
- 两个新建测试空间 ID 1、2 均为 Agent 所有；`completeTaskSpace(..., { keep: false })` 两次均返回 `done=true`，释放租约后 `listTaskSpaces()` 返回空列表。

## 续验：本地服务构建与缓存读取（2026-10-20 08:43 UTC）

- 发现本地 4173 页面当时加载 `runtime.target=public`，因 public 构建与 local 构建共用默认 `dist/` 目录；public 页面隐藏本地缓存区且不含截图目标子类型。执行 `npm run build:local` 后，隔离页 4173 加载 `runtime.target=local`，缓存面板和截图组合恢复。构建输出只有 Git 忽略的生成文件。
- 恢复后状态接口显示 16/16 缓存可用、上次成功年龄约 63 分钟；同时全量更新失败分别呈现。当前 PM2 4173 与同仓 4181 两进程各自启动全量刷新（约差 1.5 秒），4181 已成功 13/16，4173 的 10 项失败来自 `open.feishu.cn` DNS。两进程共享磁盘缓存文件，但节流、刷新进度和内存条目独立；跨进程互斥及状态同步仍未实现。
- 通过 4173 `POST /api/chatpack/cache/read` 顺序执行十次目标组合读取，10/10 HTTP 200、source=`learn-x-chatpack-cache`、返回两条必需 Prompt 与 Core《道》；测量为 1.1–37.2 ms，冷首请求 37.2 ms，后续请求 1.1–2.7 ms。只记录元数据，不记录正文。
- Chat Pack 定向回归：`node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/server.test.mjs app/code/scripts/chatpack.test.mjs`，36/36 通过；`git diff --check` 通过。
- Ego Lite 在本轮先导真实点击前报告 Agent 隔离空间 3 已由用户控制。没有调用 `takeOverTaskSpace`、没有点击、没有重试；继续与否已交给用户选择。已有上一轮十次真实点击证据继续保留，但本轮恢复 `runtime.target=local` 后的再次确认尚未完成。

## 锁恢复修复与最终回归（2026-10-20 09:25 UTC）

- 独立复测重放空主锁、坏 JSON 主锁、孤立 recovery marker、死 owner 及并发竞争。过期锁现在可回收并发起读取；新鲜且无法确认 owner 的坏 recovery marker 明确返回失败，不再无期限假报 `running`。临时隔离压力测试覆盖 30 对真实独立 Node 进程及 120 组独立缓存实例竞争，每对只有一次全量读取，最终缓存均可用；这些压力循环未写入仓库。
- 为防止未来回归，`chatpack-cache.test.mjs` 新增三类真实子进程互斥测试：无旧锁、过期主锁、过期 recovery 锁。恢复等待状态现在单独返回 `recovering` 与 `retry_at`；前端显示“正在确认刷新锁”，页面测试核验此状态不冒充活跃下载进度。旧测试名“live marker”已改成事实相符的“fresh malformed marker”。
- Chat Pack 定向命令 `rtk node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/server.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/chatpack.test.mjs`：**44/44** 通过。
- 默认并行 `rtk npm test`：**646/647** 通过；唯一失败在 `build-static-data.test.mjs` 通过 `execFileSync` 调用的本地构建子进程，测试收集到的 stdout/stderr 均为 null，不能确认其根因。相同全仓测试清单使用 `rtk node --test --test-concurrency=1 ...` 串行复跑：**647/647** 通过，未改动周链相关源码或测试。
- `rtk npm run build:local`、`rtk npm run build:public`、`rtk npm run build:public:no-context` 依次成功，随后再次执行 `build:local` 恢复本地服务静态产物。`git diff --check` 与 `node --check` 对缓存、服务端、页面脚本均通过。
- 用户再次授权恢复隔离页面并测量。目标组合仍为 `learn-x 相关 / 周输出 / 多思考一步 / 2026-W42 / Core《道》`。10 次受信任 click 首个 UI 状态变化为 11.9、1.5、2.0、1.5、2.0、2.3、3.2、1.4、2.4、6.2 ms；页面复制确认用时为 215.8、146.3、140.1、141.1、131.0、128.6、150.3、135.2、123.7、147.6 ms。10/10 成功、低于 2 秒，按钮均恢复。没有读取剪贴板正文。
- 同一时点只读查询 4173/4181：两个状态接口都返回 200、缓存资源 16/16 可用且 `next_allowed_at` 相同；4173 刷新项仍报 16 项失败，4181 报 16 项成功。`lsof` 确认两个进程 cwd 都是本仓库；进程启动时间为 4181 PID 34204 的 11:28:09、4173 PID 55494 的 17:15:54（Asia/Shanghai）。当前 `server.mjs` 与 `chatpack-cache.mjs` 修改时间分别为 17:05:48 与 17:11:54，证明 4181 启动时早于新服务代码，当前两端状态差异来自旧服务进程；没有重启 4181，因此未验证重启后的新版本状态。历史 07:40 UTC 真实刷新成功仍有效但属于历史时点。
- 当前仍未验证：服务每 24 小时的实际触发；浏览器原生剪贴板 API 挂起和迟到结果；用户原始无响应 JS 堆栈；默认并行全仓测试的子进程失败原因。整体判定维持 **PARTIAL**。

## 第四轮：挂起状态请求、完整回归与本地页面性能（2026-10-20 09:58 UTC）

- 独立复核上一轮发现的 P2：缓存状态轮询与手动刷新没有请求期限，服务长时间不返回时会持续堆积状态查询、并使手动刷新按钮一直禁用。协调者在 `app/code/public/app.js` 增加 8 秒状态请求期限（覆盖 fetch 和 JSON 解析）与 single-flight 合并；手动刷新增加 10 秒期限并在 `finally` 恢复按钮，超时明确显示结果未知；生成取消后不再由 `finally` 启动新的状态请求。
- 正式页面回归新增挂起状态 fetch、挂起 `response.json()`、连续两次轮询只发一个请求、手动刷新挂起后恢复按钮与错误可见性检查。定向命令 `rtk node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/server.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/chatpack.test.mjs` 为 **48/48**。同一独立测试员重读变更并重跑定向套件，结果 **48/48**，无确认的 P1/P2。全仓串行测试为 **648/648**。
- 对正确的 `app/code/server.mjs`、页面脚本、缓存模块和页面测试运行 `node --check`，并执行 `git diff --check`，全部通过。`npm run build:local`、`npm run build:public`、`npm run build:public:no-context` 成功，最后恢复 local 构建。
- 用户授权接管并测量 Ego Lite TaskSpace 3 的现有 4173 页面。测试前组合为 `learn-x 相关 / 周输出 / 多思考一步 / 2026-W42 / Core《道》`，问题“周输出”，Core《道》处于选中状态，缓存 16/16 可用。10 次受信任 click 的首反馈为 6.0、0.7、0.6、0.9、0.7、1.1、0.6、1.2、0.7、0.8 ms；复制确认耗时为 195.0、117.9、150.4、135.7、143.4、148.1、164.5、151.5、145.9、149.0 ms。10/10 成功，按钮恢复；未读取剪贴板正文。结束时释放原有用户标签页并关闭 Agent TaskSpace，保留两个未托管用户标签页。
- 页面之后同源状态接口仍显示 16/16 可用；目标资源为周输出 Prompt revision 65、一步深入 Prompt revision 12、Core《道》revision 7，成功时间 09:27 UTC、到期时间 2026-11-03 09:27 UTC。09:56 UTC 的全量刷新 0/16 成功，Prompt 报 `open.feishu.cn` DNS `no such host`，Core 读取失败；有效缓存和 `fetched_at` 未变。
- Deep `ywuse` 将现有使用页局部更新并读回 revision **5**：新增 8 秒状态查询和 10 秒手动刷新超时语义；README 已有链接保持不变，未创建重复页面。Acceptance 报告已按最新运行态、48/48 定向与 648/648 全仓结果更新。
- 未验证边界：没有等待真实 24 小时墙钟周期，没有取得用户最初页面 JavaScript 堆栈，也未直接挂起浏览器系统剪贴板 API。最新 Feishu 网络错误阻止本轮刷新成功，当前缓存仍有效。

## 第五轮：失败刷新立即重试（2026-10-20）

- 修复前新增回归断言并确认红灯：全量刷新失败后状态仍返回 `cooldown`，不是 `failed`，立即重试仍会被拒绝。独立只读审计用临时目录复现同一因果链：刷新启动时持久化 `lastRefreshStartedAt`，而状态和请求入口都无条件用它作为 60 秒冷却基准；UI 只显示后端结果。
- 代码改为按最终刷新状态处理：成功全量刷新后保留 60 秒节流；`failed` 或 `partial` 立即允许下一次请求。共享活动锁和并发合并不变；失败时不自动循环启动新一轮；每日计时仍以最近刷新开始时间为基准。
- 新增并通过全失败后同进程立即重试、跨重启恢复失败状态后立即重试、部分失败立即重试、运行中跨实例合并且失败后不自动重试等用例。成功刷新冷却持久化、进程锁、并行上限与每日调度原有用例同时通过。
- 修复前红灯：`node --test --test-name-pattern='failed refresh preserves a usable old entry' app/code/scripts/chatpack-cache.test.mjs`，断言得到 `actual: cooldown` / `expected: failed`。修复后：`node --test app/code/scripts/chatpack-cache.test.mjs`，24/24 通过。
- 本轮命令行对 `127.0.0.1:4173` 的 HTTP 状态请求被沙箱网络策略拒绝。由于 PM2 watch 起初未自动切换进程，按项目既有配置定向执行 `pm2 restart ywdev-learn-x --update-env`；PM2 返回 online PID 98334。随后 `app/code/` 测试变更触发已配置的 watch，最终 `lsof` 确认 PID 98983 监听 `127.0.0.1:4173`。缓存状态与浏览器终态未能通过命令行复核；未对缓存接口发起额外 Feishu 全量读取。

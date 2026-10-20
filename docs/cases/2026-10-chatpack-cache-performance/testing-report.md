# yw-testing｜Learn-X Chat Pack 提速与缓存状态改造

- 日期：2026-10-20
- 阶段：第一轮协调者自测与独立 subagent 复核已完成
- 结论：**PARTIAL**。离线测试、构建和本地缓存生成链路通过；完整真实飞书刷新未验证，Core 正式读取因当前网络传输失败而阻塞。
- 需求与执行方案：[Requirement](../../requirements/2026-10-chatpack-cache-performance.md) / [Execution Plan](execution-plan.md)

## 验证范围

依据原始需求 R1–R6 及 ACC1–ACC12，核查持久缓存、缓存状态、刷新并发与节流、完整读取、按钮生成/复制、异常恢复、其他 Prompt/Core 实时读取语义及公开构建边界。只用状态、revision、正文 hash 和成功/失败结果记录远端链路，不记录 Prompt 或 Core 正文。

## 第一轮协调者自测

| 检查 | 命令或动作 | 结果 |
|---|---|---|
| Chat Pack 定向单测 | `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs app/code/scripts/server.test.mjs app/code/scripts/chatpack.test.mjs` | 修复前 34/34；增加父级符号链接反例后 35/35 通过。覆盖 14 天期限与重启、来源/hash 损坏、写盘失败、缓存刷新合并和双并发、必需资源快速失败、无效 JSON、服务断开、挂起状态请求、90 秒期限、选择变化、延迟/拒绝剪贴板及重试、缓存根目录符号链接拒绝 |
| 全仓回归 | `npm test` | 修复前 618/618；父级缓存符号链接修复后 619/619；本次最终回归 624/624 通过 |
| 构建兼容 | `npm run build:local`；`npm run build:public`；`npm run build:public:no-context` | 本次修复后均成功；构建测试确认公开产物无本地缓存/受治理正文 |
| 实际缓存权限 | `stat -f '%Sp %N' app/code/.local app/code/.local/chatpack-cache app/code/.local/chatpack-cache/cache.json` | 缓存目录 `0700`、文件 `0600`；`.local` 已被 Git 忽略 |
| 实际服务状态 | 同源 `GET /api/chatpack/cache/status` 与缓存状态区 | 最近一轮于 2026-10-20 04:41:58–59 UTC 完成：HTTP 200，16/16 缓存可用、14 天有效，刷新 16/16 失败。Prompt 因 `open.feishu.cn` DNS `no such host` 失败，Core 道/法为 `Lark document read failed`；旧 `fetched_at` 为 04:31:23–27 且未改变。冷却期内点击显示倒计时；请求合并到 60 秒边界后启动一轮，没有在间隔内并行读取。04:42:26 页面显示剩余 34 秒。 |
| 真实页面生成 | 截图组合 `learn-x 相关 / 周输出 / 多思考一步 / Core《道》` | 旧页面曾留有未决剪贴板写入，重新生成被明确拦截；页面没有当前恢复按钮。载入当前页面后恢复题目与全部选择。此后连续 10 次生成均由页面确认复制；click 事件到首个状态 DOM 变化为 1–4 ms，完成时间 61–171 ms，10/10 低于 2 秒。此前另有两次样本（3.3 ms、20.7 ms 反馈，各约 0.1 秒，第二次宿主观测 775 ms）。用户原始 JS 堆栈仍未取得。 |

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

协调者把迟到 reject 与重试加入正式页面回归，并新增“新 Prompt revision 与正文刷新后写入磁盘、重启后读回”的缓存用例。最新定向 `node --test app/code/scripts/chatpack-cache.test.mjs app/code/scripts/core-truth-context.test.mjs` 为 13/13；最终全仓 `npm test` 为 624/624。复制重试期限修改后的 `npm run build:local`、`npm run build:public`、`npm run build:public:no-context` 均成功。

`ywuse` Deep 完成 Usage Truth：新增 Learn-X Chat Pack 使用说明，readback 为 revision 3；系统使用知识库导航更新 readback 为 revision 17；仓库 README 已加入入口。验收总判定仍为部分达成，详情见 [Acceptance](acceptance.md)。

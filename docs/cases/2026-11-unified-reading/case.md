# CASE: LearnX 统一阅读沉淀与 ChatGPT 精读

- 状态：部分达成（飞书 UI → Bridge → WeRead → 本地幂等、飞书交付及 GitHub main → ChatGPT 远端阅读已实走；例行同步分支、治理 Prompt 更新及真实修改/撤销写回仍未完成）
- 最后核对日期：2026-11-03
- 上下游链接：[Requirement](../../requirements/2026-11-unified-reading.md) → [Plan](execution-plan.md) → [Acceptance](acceptance.md)
- Type: Major
- Status: In Progress
- Requirement: `docs/requirements/2026-11-unified-reading.md`
- Architecture / Planning: `docs/architecture.md` / `execution-plan.md`
- ADR: [0003-unified-reading-context](../../adr/0003-unified-reading-context.md)
- Implementation: 当前 Learn-X 工作树改动，尚未提交
- Acceptance: [acceptance.md](acceptance.md)
- Version: `85cc48a364c306244d12b97afce0cde1ee67477d`（实施前读取的 Learn-X HEAD；当前工作树有用户并行改动）

## 执行状态

- 用户于 2026-11-03 明确要求加速实施，并把实体书照片、OCR 与圈注/划线视觉识别整块暂缓，之后由用户重新思考和优化。该指示调整实现顺序，不改写冻结 Requirement；本次不接图片入口、不上传照片，也不支持 physical 数据写入。
- M0 已完成：Requirement Truth、完整方案原文和本 Case 均落盘并读回；Requirement 原文 SHA-256 `8501d0e5b06db7fa6f3c227f67402b6f94441d387d73f06b1c8ff891b63ed684`，用户实施方案 SHA-256 `2e232db04548ccb47dead4e8bfd04a80786f60604e623d4b3273bbfc21b2a742`。来源为会话 `01a1a045-4b47-7e41-a478-95ab5e251844` 的原始消息，不以摘要重建。
- 已实现 WeRead 最近三天/明确时间范围采集器，保留来源 ID、分页停滞检测、局部错误与完整性，并写私有快照。对抗审查发现并修复：历史范围不能因书籍最新笔记晚于范围结束时间而漏书；缺失标题不再触发作用域错误；无效 notebook 排序时间和条目时间会标为部分采集，不再静默报告完整。
- 已实现仅 WeRead 的按书 Markdown 落盘、稳定去重、私有/待复核隔离、pending 恢复、读回校验、版本化修改和本地撤销；同批重复来源只折叠内容一致的记录，冲突时停止。运行区和公开目录拒绝符号链接与仓库外路径；临时文件独占创建。写入不执行 Git 操作，伴读包可写私有运行区，batch 回执包含 record ID/version。
- 新增 WeRead 私有来源证据指纹：公开记录不包含原始 `sourceEvidence`，只在私有状态保存稳定哈希；来源正文不变时，重采不会覆盖用户改过的记录，来源正文变化则 fail closed。pending 重试必须匹配已保存条目和伴读包。
- 修复公开 fail-open：未知 `status`、`visibility`、非布尔 `publicEligible` 或相互矛盾的公开标记都会拒绝整批。有效 ID/时间但没有可读正文的划线/想法会留下局部结果并令采集 `complete:false`，准确报告不可用条目数。
- 修改/撤销必须携带更新后的伴读包；保存器将其写入私有版本化路径并读回，修改回执包含路径。纯 WeRead 想法可独立修改，作者内容为空时不虚构“作者内容提炼”。
- 修复已完成批次的重放：同一 `batchId` 重采时核对书籍与来源 ID，保留首次已交付伴读包；同批不同来源、来源指纹不符或私有回执状态冲突时 fail closed。增加同批伴读包变化和“完成回执与残留 pending 并存”回归。
- 已新增 `learn-x-reading` Skill、WeRead 数据契约、ChatGPT 每周精读 Prompt 和使用说明；Learn-X `AGENTS.md` 增加经验证用户单条文本消息的 WeRead 路由规则。修改入口仍是 `修改 <recordId>` / `撤销 <recordId>` 文字命令。
- Skill 已补全修改/撤销的飞书局部回写：从私有交付状态解析文档，按 `recordId` 精确定位，使用当前 revision 修改单条区块并读回；未唯一定位、版本变化或写入状态不明时保留本地状态且不盲目重试。真实区块只读核对确认当前 Docx 可按 recordId 唯一检索，尚未执行真实修改。
- **第一次真实触发（历史记录）：** 以当前已验证用户身份在 Learn-X 群发送并读回“整理最近 3 天微信读书划线和想法”。群内没有自动返回阅读结果，出现 MoonBridge 本地模型预检失败提示；该次由 Codex 按 Skill 手动接续真实采集与保存。
- 真实 WeRead 结果：Asia/Shanghai 范围 `2026-11-01 00:00:00` 至 `2026-11-03 17:30:53`；采集完整，1 本书、10 条划线、0 条个人想法、无错误；从中精选 5 条。5 条精炼文本写入 `05_library/reading/` 并读回一致；第二次用同一批次重跑新增 0 条、识别重复 5 条。原始划线没有进入公开 Markdown。
- 飞书阅读记录和伴读包文档由 Bot 创建，系统授予当前用户 full_access，并以当前用户身份读回；第一次结果卡由群内 Bot 发送后读回，书目、数量、状态、修改入口和文档链接一致。该次为 Codex 手动接续的真实数据交付。
- **第二次真实触发（自动路由通过）：** 同一已验证用户再次发送“整理最近 3 天微信读书划线和想法”，用户消息 ID `om_x100b61aeb00d14a8df8ff8552c0fbc4`，飞书读回的正文与发送者一致。Bridge 自动运行 `learn-x-reading`，最终结果卡 ID `om_x100b61af575f58a8df7a6a10fc3b91b`，标题“WeRead 整理完成”，报告 2026-11-01 至 2026-11-03 17:57、采集完整、10 条划线、0 条想法、5 条新增、5 条去重；本批截至 17:57:55。该次不需 Codex 手动接续。首次预检失败的根因仍未知。
- 第二次自动运行将同书飞书文档更新至 revision 4；当前用户身份读回确认两批累计 10 个唯一记录 ID、伴读包及修改说明。公开按书 Markdown 与索引读回 10 个唯一 WeRead 来源 ID、无重复记录；本地保存通过，GitHub 仍未验证。
- 为响应用户对 `*.qq.com` 的要求，Codex 配置中存在 `**.qq.com` 域规则并已读回。但第二次 Bridge 运行状态显示 `danger-full-access`，不是受此域规则约束的 `workspace-write` 沙箱；所以本次成功不能证明该白名单的网络策略效果。MoonBridge endpoint 的既有只读健康检查通过，首次容器退出原因仍未知。
- 已在“系统使用知识库”创建飞书 Usage Truth 页面 [Learn-X 阅读沉淀与 ChatGPT 精读使用说明](https://ywhome.feishu.cn/docx/HQL8dxOGuoacHUxAhvPcQ770nfh)，由 Bot 创建；导航首页更新至 revision 23 并读回确认入口。2026-11-03 自动 WeRead 实走后，说明页由 Bot 更新至 revision 5，并由当前用户读回确认自动触发成功、手机界面和 GitHub 同步仍未验证。README 核心资产区同步添加入口。
- 修改/撤销文字命令现已进入 Learn-X `AGENTS.md` 路由。由于当前工作树没有证明 Learn-X 群存在已签名回调的实际路由，Skill 结果卡默认提供 `修改 <recordId>` / `撤销 <recordId>` 文字入口，不展示未接通的按钮。
- 旧精读 CLI 写入/生产命令已 fail-closed；`jingdu` 从活跃周来源配置退出，周/月 Process 排除历史文件和状态，旧文件/侧车仍可读；新状态 CLI 拒绝 `jingdu` 登记。周日自动化 `learn-x-3` 已暂停并读回 `PAUSED`。
- 月记受治理 Prompt 的两次正式 publisher 写入尝试均未取得结构化成功响应；最近一次以 base revision 3 尝试后，publisher 的只读读回确认远端仍为 revision 3 / SHA-256 `6549cf26d0bda5be9b663eaa64365b52508a6108c4fbad1bdf7e59e44842b045`。用户充分授权后，本轮复核候选并再次尝试，仍为 `unstructured_cli_error`；不再重试。使用假文档 ID 的隔离 dry-run 确认 CLI 接受 `--format json`，不验证目标权限。`auth status --json --verify` 显示 bot 与 user 身份均 ready，user token 有效；scope 仅在 user 身份返回，不能证明 bot 文档写权限。精确根因未知。候选正文只移除旧 `jingdu.md` 消费规则，SHA-256 `3e91b14dbeb344ffb1ee538302483580040e5617cb792bc9158ece92b8c063f1`，暂存在 `/private/tmp/learnx-journal-prompt-2026-11-03-r4/candidate.md`，未改写本地受治理备份。`learn-x-monthly-journal` 本地流程仍 fail closed，不消费旧 `jingdu.md`。
- 本次真实阅读记录尚未通过 Git 同步；没有 Commit/Push，也没有验证 ChatGPT 从 GitHub 读取新增上下文。周三提醒仍由用户自行配置。

## 验证证据

- 新增持续运行的离线合成贯通测试：模拟范围 API 返回 1 条划线和 1 条个人想法，经采集、私有来源指纹、按书保存后得到 2 条记录；公开文件读回成功、伴读包可用，且原始来源证据不进入记录状态或公开文本。该 mock 不代表真实 WeRead/飞书端到端已验收。
- 范围采集与本地 store（含模拟贯通、来源变化/重采、纯个人想法修改、无效公开标记、空正文不完整及伴读包故障恢复）测试 **23/23** 通过；原始周采集兼容 **7/7** 通过。
- WeRead 周采集、来源状态、周/月 Process 与旧精读编排合并回归 **60/60** 通过。
- 来源状态与历史 ready `jingdu.md` 排除测试：25/25 通过；月度 Process 测试：19/19 通过；旧 Jingdu CLI/编排定向测试：9/9 通过。
- `learn-x-input` 与 `learn-x-reading` 的 `quick_validate.py`：均通过。
- `git diff --check`：通过，无输出。
- 周度 Process Pack 改动相关反例：聚焦 3/3 通过。扩大测试文件共 19 项，17 项通过、2 项失败；失败断言针对并行工作树中现有周自动化 / Weekly Output Prompt 文本契约，未由本 Case 改动引起，实施前基线也已观察到对应问题。本轮没有弱化这些测试。
- 自动化测试使用隔离临时目录；本次真实验收累计将 10 条去重后的精炼文本写入 `05_library/reading/`，读回一致，未 Commit/Push。原始划线、伴读包、来源收据和交付状态留在 Git 忽略的 `.runtime/reading/`，权限为 0600；公开内容未含原始划线。

## 仍未完成 / 恢复条件

1. **入口与交互验收：** 先前第二次用户消息由 Bridge 自动运行 Skill，并完成本地保存、飞书文档和结果卡交付；第一次请求的 MoonBridge 预检失败根因仍未知。本轮用户明确授权 UI 操作后，在 Ego Lite 任务空间 7 的 Feishu Web 消息页向 Learn-X 群发送一次请求，观察到 Bridge command_execution 和“已整理过”回复；最新范围快照完整，10 条来源全部已保存，新增 0。该无变化分支没有新建结果卡或更新阅读文档，既有卡片和伴读包仍可访问。真实修改/撤销写回仍未验收。Bridge 是独立仓库且有并行未提交改动，本轮未修改其源码。
2. **受治理 Prompt 真源：** 用户充分授权后复核候选与线上 rev3，再用官方 publisher 尝试一次；结果为 `unstructured_cli_error`，只读读回确认 revision 3 / 原 SHA 未变。候选仅移除月记 Prompt 对旧 `jingdu.md` 的消费规则。`auth status --json --verify` 显示 user token 有效、bot ready，但不返回 bot scopes；不切换到 user 写入，也不绕过发布器。精确失败原因和 bot 所需 scope 仍未知，本轮不再重试。
3. **远端与 ChatGPT 验收：** 2026-11-03 通过 GitHub connector 只读查询，README 可读取且仓库分支清单含 `main`、`master`；但固定索引 `05_library/reading/_index.md` 与当前书目文件在 `main` 和默认 `master` 均返回 API 404。新阅读内容尚未进入可读的 GitHub 路径，须由既有同步机制处理；当前本地/飞书状态不能报告为 GitHub 已同步。
4. **实体书图片：** 用户要求暂缓，后续由用户自行研究优化。当前实现与验收都不覆盖该功能。

## 来源与执行边界

- 完整 R1～R8、Prompt A/B/C、原型、关键未知与用户原始需求 → [Requirement Truth](../../requirements/2026-11-unified-reading.md)。
- 完整用户实施计划及执行更新 → [Execution Plan](execution-plan.md)。
- 架构现状 → [Architecture Truth](../../architecture.md)；关键职责决策 → [ADR 0003](../../adr/0003-unified-reading-context.md)。
- 保留用户其他并行改动；不上传照片；本次按书公开 10 条去重后的精炼转述，原始划线留在 Git 忽略的私有运行目录；不 Commit、Push 或部署。

## 最新用户路径实走（2026-11-03，Asia/Shanghai）

- 用户授权模拟操作后，在 Ego Lite 任务空间 7 打开已登录的飞书消息页，确认目标会话为 Learn-X 群；将“整理最近 3 天微信读书划线和想法”作为单条消息发送一次，并在界面读回。没有重试发送。
- 群内 Bridge 自动启动 command_execution，随后回复“已整理过：这 3 天没有新增内容”。这是本次新回复，不是前一批结果卡；前一批结果卡仍留在历史会话中。
- `.runtime/reading/weread-range-latest.json` 最后修改时间为 `2026-11-03T11:55:21.891Z`。读回字段为 Asia/Shanghai `2026-11-01 00:00:00` 至 `2026-11-03 19:55:21`、`complete=true`、1 本书、10 条划线、0 条想法、0 条不可用条目、0 个错误。
- 将本次快照的 10 个来源 ID 与本地保存状态比较，10/10 已存在，新增 0；本地仍有 10 个唯一记录 ID 和 10 个唯一来源 ID。公开按书文件保持 10 条，不产生重复或误删。原有伴读包与飞书阅读文档可读取；因为无新增内容，本次没有新建批次收据、改写阅读条目或另发结果卡。
- 用户明确要求开放 `*.qq.com` 并继续直跑链路后，使用授权网络执行环境运行官方 `collect-weread-range.mjs`。采集器将正文留在 `.runtime/reading/weread-range-latest.json`（0600），终端只输出摘要。完整范围为 Asia/Shanghai `2026-11-01 00:00:00` 至 `2026-11-03 20:23:45`，1 本书、10 条划线、0 条想法、0 错误；本地来源核对为 10/10 已保存、0 新增。此前 workspace-write HEAD 的代理 403 不代表本次授权网络执行结果。
- 随后使用 Bot 身份读取阅读 Docx 当前 revision 4，仅替换保存状态段，更新成功至 revision 5；再次按关键词 fetch 读回内容完全一致。状态准确写明 GitHub 固定索引与书目文件在 `main`、`master` 均返回 404。此次验证的是 Docx 的 Bot 局部写回，不是阅读记录修改/撤销。
- 对月记受治理 Prompt publisher 的补充取证修正前述“Bot 文档写权限未证实”的概括：开发者控制台显示应用已开通 `docx:document:write_only`，且该应用在治理 Wiki 节点有编辑权限；本轮 Bot 已对普通阅读 Docx 成功执行局部更新并读回。失败的官方 publisher 使用 `/open-apis/docs_ai/v1/documents/...` 路径，和普通 Docx 更新路径不同；因此目前更准确的结论是 publisher 端点或该受治理资源的权限/写入路径待查。线上 Prompt 仍保持 revision 3，候选未发布；没有绕过 publisher 或重试。
- Reading Skill 与 WeRead range 定向测试 23/23 通过；旧 WeRead 周采集、来源状态、周/月输入和旧 Jingdu 编排回归 60/60 通过；两个 Skill quick_validate 均通过。`git diff --check` 通过。
- 没有 Commit、Push、部署、Flomo 写入、提醒创建或照片上传；用户仍明确暂缓实体书照片/标记识别。

## 端到端增补｜GitHub 远端读回与 ChatGPT 精读（2026-11-03）

- 按用户明确授权，仅将 05_library/reading/_index.md 和本书 Markdown 发布到公开仓库的 main 分支；使用隔离暂存目录审查两份文件，仓库 security-scan.mjs 对 2 个暂存文件通过，git diff --cached --check 通过。没有改动主工作树的 Git index、分支或其他文件。
- GitHub Contents API 先创建书目文件，提交 2ec4d3cd25f45d9e2601d159472b0c49fd436081；读回后再创建索引，提交 dba6d1e31e71031d7ef4e995d287949f9c879b28。最新 main 头为 dba6d1e31e71031d7ef4e995d287949f9c879b28。文件 Blob SHA 分别为书目 f2ada0587c1a1242642d397b892d33a44355d582、索引 2341ed4c225d5c9cd69d1adcdb462b201ed1812b；与本地 git hash-object 结果一致。索引与书目均从 GitHub main 再次读取成功。
- 通过 ChatGPT 当前对话入口按固定索引读取真实远端材料：书籍《智人之上 ——从石器时代到 AI 时代的信息网络简史》，第一章“信息是什么？”，日期 2026-11-01 至 2026-11-03，10 条精选、0 条个人想法。没有把未推送的本机状态说成远端内容。
- **与原计划的执行差异：** git ls-remote 被当前 shell 的本地代理 127.0.0.1:8118 拒绝连接，因此使用已连接 GitHub 工具逐文件创建并读回；这是本次两条目标路径的一次性授权发布，不构成新的自动发布机制，也没有运行 neatall。
- **例行同步仍未验证：** 本地 master 跟踪 origin/master，而 ChatGPT 固定索引指向远端 main；neatall 按已核实 upstream/ref 推送，当前仓库又因未跟踪的 parse-session.mjs 命中整仓敏感路径门禁，且工作树含大量其他未提交变更。没有运行整仓发布。后续新阅读内容如何进入 main 尚需处理，不能把这两条文件当前可读等同于例行同步已打通。
- docs/CHATGPT_READING.md 的固定 main 索引现在可用。ChatGPT 本轮实际给出四个 Flomo 思考方向：真实性与动员力分开评估；真实叙述中的框架与遗漏；适应性不等于真理；信息既描述也塑造现实。未写入 Flomo。
- 未完成项：真实阅读记录修改/撤销写回；月记治理 Prompt 的官方发布器错误仍未定位且没有重试；用户自行配置周三提醒；实体书视觉标记识别按用户要求暂缓。Bridge 仓库未改。

## 下一停止点

当前单本阅读记录已从真实 WeRead 与飞书入口进入本地、可见于 GitHub main，并由 ChatGPT 实际读取和分析。继续完成前需处理例行发布分支与当前整仓 neatall 门禁的兼容方案，并实测单条阅读记录的真实修改/撤销回写；月记 Prompt publisher 根因另行追踪。不得把本次一次性 GitHub 发布描述为定时同步成功。整体保持部分达成。

# CASE: 周记与 Core 一体化复盘及可靠同步

- 状态：已确认
- 最后核对日期：2026-10-31
- 上下游链接：[Requirement](../../requirements/2026-10-weekly-core-review.md) → [Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Requirement: [Requirement](../../requirements/2026-10-weekly-core-review.md)
- Architecture / Planning: None / [Plan](execution-plan.md)
- ADR: None
- Implementation: Core 提前建档/补齐、确认批次和逐目标恢复；Learn-X 周记入口、bot 链接、统一确认与回流采集；真实 Core 建档与隔离周记链接已读回验证，真实个人周记入口及最终同步链路仍未验收。详见 [Acceptance](acceptance.md)。
- Acceptance: [acceptance.md](acceptance.md)（2026-10-31：部分达成 PARTIAL）
- Version: None

## 执行状态
- 当前有效方案：本会话用户提交的 [Plan](execution-plan.md)，用户要求实施。
- 完整授权范围与阶段顺序：按 Plan M0–M4；用户追加授权 bot 身份创建或复用同周 Core 文档并在周记安全位置写链接。
- 最后已验证里程碑：M0 来源文件和 Core 回链齐全；跨仓 mock 端到端贯通 Core 骨架创建/复用、Learn-X 安全链接、五项 Core 本人内容的统一确认、Memory 写回读回、逐目标同步/未知恢复及 Learn-X 收尾。官方 Codex `read_thread` 实测宿主适配器；真实 bot 新建 W43 Core 文档并读回 revision 3，在无个人内容隔离周记中写入同周链接并读回 revision 4；最新全量回归 Learn-X 795/795、Core 213/213，跨仓集成 3/3，Memory/确认/收尾/恢复定向测试 48/48，链接专项 11/11。
- 剩余事项：真实个人周记草稿和入口端到端、真实用户确认、年度周报/总览的目标同步与恢复，以及既有自动化触发机会的实跑验收均未完成。授权隔离周记的 GUI 点击与目标正文呈现已验证。
- 下一步：待完整周记输入可用时，沿原入口验证周记草稿 → Core 链接 → 完整 Core 思考 → 单卡确认 → 回流/逐目标同步；其间维持既有自动化配置，不把隔离或 mock 结果升级为生产链路完成。
- 阻塞 / 待核实副作用：2026-W43 的 daily 输入缺失，Flomo 状态为 failed（网络暂时错误）；因此没有执行真实个人周记草稿或向个人周记写链接。授权隔离周记的链接现已在 GUI 中打开并显示完整 W43 Core 页面。bot `docs +fetch` 本轮在 OAuth token 请求处返回 `Forbidden`，未切换为 user 写入 Usage Truth。真实确认、正式同步和恢复触发仍未执行；自动化调度保持不变（只读配置显示 Learn-X 05:00/07:00 ACTIVE，未发现独立 Core 周复盘任务）。
- 证据：本会话原始消息；Core 隔离测试 `node --test scripts/weekly-review.test.mjs`：53/53 通过；只读权限检查 `lark-cli drive permission.members auth --as bot --action edit --type docx --token <总览底层文档>` 返回 `auth_result: false`。隔离飞书文档 [测试文档](https://ywhome.feishu.cn/docx/BuCzdR91ooLkwSxFTVCcNoFQnQe) 由 bot 创建并以 user 读回：revision 4 验证单元格 `block_insert_after`，revision 5 验证链接 href，revision 7 验证空表 `block_replace` 及邻接块读回；未验证 GUI 点击。
- 2026-10-30 隔离集成：对 [Core 补齐测试文档](https://ywhome.feishu.cn/docx/J223dnToCoD9lgxXgGScVKmanvh)，使用 `/private/tmp/core-m1-e2e2/resume.mjs` 从原有 pending 恢复，生产 `cmdPrepare` 先核查再以 bot 补齐三表（`selected=[0,1,2]`）；user 身份独立读回 revision 6，三表各一行。Pack、总览与 AI 输入为合成桩，飞书写入和读回真实；该证据不证明真实周记到 Core 的完整链路、真实 Pack/AI 或 GUI 点击。M1 仍未验收。
- 2026-10-30 模拟进展：确认批次、v2 回流、逐目标恢复、Learn-X 条目修改/排除与确认指纹绑定已有代码和隔离测试；使用模拟的宿主消息与飞书目标覆盖部分完成、未知写入、人工冲突及多批次回流。Core 执行 `node --test scripts/confirmation.test.mjs scripts/confirmation-session.test.mjs scripts/sync-confirmed.test.mjs scripts/confirmed-row.test.mjs scripts/sync-feishu.test.mjs scripts/weekly-review.test.mjs scripts/weekly-unified-integration.test.mjs`：101/101；Learn-X 执行 `node --test .agents/skills/learn-x-weekly-automation/scripts/confirmation-input.test.mjs .agents/skills/learn-x-weekly-automation/scripts/unified-confirmation.test.mjs`：5/5。测试均为隔离数据，不能证明真实用户确认、正式飞书同步或完整生产流程已完成。
- 2026-10-30 验证限制：创建新的飞书隔离测试文档被自动审批拒绝，理由为此操作会真实创建文档并可能自动授予用户 `full_access`；未重试或绕过。年度表新增行真实传输和返回形态未验证，相关真实入口保持关闭；可信 Codex 宿主适配器也尚未接入，联合确认生产入口保持关闭。M1–M4 的真实用户链路和最终验收均未完成。
- 工作区核对时间：2026-10-31；Learn-X 存在本任务修改和既有未跟踪 `draft_5b4b062a_folder/`，后者未触碰；Core 存在本任务未提交改动。

## 2026-10-31 本轮实施与实走

- 权限决策：用户明确统一周记 Docx/Wiki 写入为 bot，并授权本方案范围内创建或复用同周 Core 文档、在周记安全位置写链接。Learn-X Skill 已明确该范围统一 `--as bot`、失败关闭且不切换 user；Base 写入身份规则不变。
- 宿主接线：修复 weekly-memory / weekly-input 模块在导入时无条件访问全局 `process` 的问题，使 `unified-confirmation.mjs` 能在 Codex Node REPL 安全加载。官方 `read_thread` 当前线程响应经 `createCodexHostAdapter` 解析成功，校验线程 ID、页序和消息页；未把该读取误认作最终确认。
- 隔离文档实走：经 bot 读取无个人内容文档 [Core W40 测试文档](https://ywhome.feishu.cn/docx/J223dnToCoD9lgxXgGScVKmanvh)，其 revision 为 7。Core `skeleton --week 2026-W40` 首次和重复执行均返回 `result=reused`、`stage=adopted-readonly`、同一 docId；未新建第二份或改写远端文档。因为原候选基线未知，确认与同步被正确阻止。该证据只覆盖同周唯一性核查和只读复用，不覆盖新建骨架、链接写入或可点击验收。
- 测试：Learn-X 全仓 `npm test` 781/781；Core 全仓 `node --test scripts/*.test.mjs` 210/210。两次首轮曾暴露既有测试问题：jingdu CLI mock 缺共享库标准模块别名，Core Workbench 测试写死过期周号；分别补齐 fixture 别名、将断言改为与本测试首次快照比较后，定向及完整回归均通过。周记链接模块另有定向 mock 测试，结果见 Acceptance。
- 保持未完成：没有对个人周记做真实写入，没有实际展示/确认分项卡，也没有真实年度周报或总览同步。未修改既有 05:00 / 07:00 自动化配置；其引用的 Learn-X Skill 已包含恢复盘点逻辑，但本轮未实跑自动化恢复触发。真实 W43 输入门禁仍不满足，当前整体结论为部分达成。

## 2026-10-31 加速验收补充

- 真实 Core 建档：以 bot 执行 `weekly-review.mjs skeleton --week 2026-W43 --json`，新建文档 [Core 周审阅｜2026-W43](https://ywhome.feishu.cn/docx/VN1CdDQZ6o62UDxzx2qcIIqZnAf)。Core status 与独立 bot 读回均指向相同 docId；revision 3 包含五项 Core 快照和完整复盘结构，随后 user 身份也成功读回同一 revision，证明目标对用户可读。
- 真实链接写入：按用户授权新建无个人内容隔离文档 [隔离验收｜周记 Core 链接｜2026-W43](https://ywhome.feishu.cn/docx/YNpndVrhaomvsQxkIB6cfbljn8d)，将唯一安全占位替换为上述 Core 链接。`linkCore` 报告 `written`；独立 bot 与 user 读回 revision 4 确认 href、标题邻接、占位移除和旁边说明保留。创建响应显示已向当前 CLI 用户授予该隔离文档 `full_access`。
- 全量复测：Learn-X `rtk npm test` 781/781；Core `rtk proxy node --test scripts/*.test.mjs` 210/210；周记链接专项 10/10。mock 集成覆盖确认冻结、候选隔离、多批次回流、目标部分成功/未知结果与安全恢复。
- 仍未实走：真实个人周记入口自动触发、真实 Core 思考与用户确认，以及年度周报/总览正式写入和恢复。W43 daily 缺失且 Flomo 状态 failed（network-transient）；不向个人周记写入合成材料。05:00/07:00 自动化配置未切换。

## 2026-10-31 最新回归与限制

- 本轮修改 Core 跨年目标解析与历史批次目标绑定，Learn-X 后续确认只包含新增 Core 候选，并修复 Core 同步异常不阻塞 Learn-X 收尾、周记链接未知写入后的安全接续。相应定向回归通过：Learn-X 8/8、Core 69/69；Learn-X 全仓 784/784、Core 全仓 212/212、周记链接专项 11/11；三项修改过的 Skill `quick_validate.py` 均通过。
- 跨仓 mock 集成覆盖一次卡片的明确取舍、认可批次、年度周报成功/总览结果未知、只读核查恢复，以及 Learn-X 对同一确认周内多批次的回流；未知内容不进入回流。Core skeleton、链接安全占位、并发/未知写入和人工稿保护由对应独立测试覆盖。
- 线上 Usage Truth 页面本轮仍为 revision 3。尝试按统一 bot 身份读取时 OAuth token API 返回 `Forbidden`；本轮没有用 user 身份改写页面，避免违反身份规则。应在 bot 凭证恢复后补充“试运行，真实端到端未验收”提示并读回。
- 仍需真实条件：完整 W43 输入、真实本人确认及正式年度周报/总览同步恢复；隔离链路的用户侧页面呈现已通过，但不替代个人周流程验收。

## 来源与落点核对
- 本会话用户原始需求 → Requirement 来源原文；实施方案 → Plan 方案原文；bot 裁决 → Requirement 用户追加确认。

## 来源核验
- 状态：通过（本次直接从唯一匹配的原始消息提取并逐字读回；未生成交接机器收据）
- 机器收据：None
- 缺口报告：None

## 执行入口
已接入 Learn-X 周度入口：[weekly automation Skill](../../../.agents/skills/learn-x-weekly-automation/SKILL.md) 在阶段 1 调用 Core `skeleton` 并按需补链；[weekly journal Skill](../../../.agents/skills/learn-x-weekly-journal/SKILL.md) 负责安全占位及 bot 链接回读；阶段 3 调用统一确认和批次恢复模块。隔离文档的点击与页面呈现已通过；真实个人入口触发、用户确认和目标同步仍按 [Acceptance](acceptance.md) 的条件待完成。

## 2026-10-31 最新实现与模拟验收
- 确认恢复端现在复用 Core 回执校验，必须匹配原确认批次、目标条目、绑定、值和版本 proof；伪造的非空字符串不会被视为已完成。
- Learn-X 收尾模块已接入联合确认后的 Skill 调用路径；未验证 Memory 读回时不启动收尾，动作只有返回明确完成证据才标为完成，`unknown`、`partial` 和空证据保持待处理。
- Core `scripts/weekly-unified-integration.test.mjs` 的跨仓模拟链路覆盖骨架创建及同周复用、周记安全链接写入及复用、联合确认、年度成功/总览未知、恢复后读回与 Learn-X 回流；未认可 AI 候选未进入批次或导出。Core 全仓 212/212、Learn-X 全仓 788/788；新增与相关目标测试 23/23，链接专项 11/11 均通过。
- 真实 bot OAuth 读取仍返回 `Forbidden`；daily/Flomo 周输入门禁未满足；真实本人确认、正式年度周报/总览同步及自动化恢复触发仍未通过真实验收。隔离周记链接已在 GUI 中显示完整 Core 正文。工作区更改未提交；既有 `draft_5b4b062a_folder/` 保留未动。

## 2026-10-31 Memory 写回后的中断恢复补充

- Learn-X Memory 审批指纹使用 `YYYY-WW`，Core 批次保留 `YYYY-Www`。恢复入口现将两种格式规范到相同 ISO 周，再验证批次绑定，避免已认可写入后的正常续接误拒绝。
- 新增只读恢复核验：即使 Memory 目标哈希已因获准写入而变化，仍重验原周报、候选和拟写内容指纹，并检查该批次确认的 Memory 条目是否唯一存在于对应覆盖周的 `Memory` 区域；缺失、重复、源提案变化或内容冲突都保持待处理，不重写。
- 验收覆盖真实形状的合成批次：Memory 已写入、审批前置哈希因此变更、进程随后中断；恢复读回条目后继续已认可的 Learn-X 收尾，并保留原覆盖周与 `confirmedAt`。Memory/确认/收尾/恢复定向测试 48/48、Learn-X 全量 795/795 通过。

## 2026-10-31 Learn-X 收尾恢复闭环补充

- 增加按不可变确认批次保存的收尾账本：`runtime/weekly-review/<覆盖周>/closeout/<batchId>.json`，每个已确认动作执行前落 `running`，执行后落读回结果；另用批次锁避免同一动作并发执行。
- 恢复扫描不再跳过 Learn-X-only 批次；已完成动作读回状态并跳过。`running`、`unknown`、`partial` 项先调用对应 resolver，只在其证明未落地且原基线未变时重试；冲突和无法判断保持待处理。覆盖周与 `confirmedAt` 绑定并在恢复中保留。
- Core 返回部分失败时 Learn-X 接口统一标记 `pending`，保留原同步细节；Core 与 Learn-X 收尾继续分别恢复。
- Learn-X 新增的确认/收尾/恢复定向测试最终 48/48、全量测试 795/795 通过；Core 全量测试 212/212 通过。weekly automation Skill 结构校验与两仓 `git diff --check` 通过。
- 真实个人周记、本人最终确认、正式年度周报/总览同步和自动化恢复触发仍未完成；授权隔离周记点击后的目标页面呈现已通过，整体仍为 PARTIAL。
- 最终本地验收补充：Learn-X 全量回归再次通过 795/795；Core 全量回归通过 213/213；完整跨仓合成旅程 3/3，覆盖五项 Core 一次确认、五项回流到 Learn-X、AI 候选排除，以及一次 overview 响应丢失后的同文档串行恢复。首轮旅程暴露的 Memory 基线时序问题由测试夹具按生产审批顺序修正；确认卡可将未认可 AI 明确列入“排除”，但该项不进入认可批次。多目标模拟中一次写入结果未知时，同文档后续条目先暂停，核实后安全续接；生产校验未放宽。

## 2026-11-03 门禁增补实施

- 用户要求实施本文件所链接 Execution Plan 的 2026-11-03 增补方案；它替代旧的 Core best-effort 门禁，保留原统一确认、回流和恢复能力。
- M0 已追加 Requirement 用户裁决和完整执行方案增补；旧方案、原 Case 历史及现有脏工作区均保留。
- 当前调查：05:00 / 07:30 自动化配置 ACTIVE，均路由至 Learn-X 周自动化 Skill；Core W43、W44 有骨架绑定，但 W43–W44 范围锚点未记录 Core 链接，范围清单未发现 Core 导出。线上个人周记正文尚未读取。
- 当前里程碑：M0 完成；M1–M3 未完成。
- 下一步：接通范围链接与 Core 本人思考门禁；跨仓 Core 代码路径需要在其仓库写权限可用后实施。
- 工作区：Learn-X 与 Core 均有大量既存 staged/unstaged 改动，本任务只追加或局部修改目标周链路，禁止清理、重置或覆盖无关差异。

## 2026-11-03 实施回执（M1 / M2）

- M1 已完成：复用 W43、W44 已绑定 Core 文档，bot 只读确认周记标题后原来紧接表格且无 Core 链接；在标题后添加 `进入 2026-W43 Core 复盘` 与 `进入 2026-W44 Core 复盘` 两个入口。线上读回 revision 5391，两个 URL 和顺序正确，原表格仍在。第二次运行返回 `reused`，未重复写入。
- 两份 Core 文档原来只有空复盘表。bot 将已核验、未修改的表替换为五行本人填写表单，每行保留四个空字段；W43、W44 均读回成功，Core revision 4。没有替用户写任何思考或判断。
- M2 已接线：Core 新增 `form` 与只读 `gate`；Learn-X 周记链接器支持 `--period` 并将逐周读回收据写入范围锚点和清单；单周与范围 Process Pack 入口先核对 Core 链接，再逐周检查五项 Core 的 20 个本人字段。字段空白或占位内容会阻断；`无`、`不适用`、`未观察到`可明确标记。Core `prepare` 命令也先运行门禁。05:00 / 07:30 调度配置未改。
- 真实验收：W43、W44 当前均为 0/20 已填。范围 Process Pack 命令在生成前返回两个周各自缺失字段，没有覆写已有 `2026-W43-W44` Process Pack。后续放行需用户先填完两份 Core 表单。
- 定向验证：Core 周审阅测试 57/57；Learn-X 链接与门禁测试 17/17；三个修改过的 Skill 均通过 quick validation；两仓目标差异均通过 `git diff --check`。
- M3 状态：链接、重复运行、字段门禁阻断及范围聚合缺项均已覆盖；用户填完后的真实放行、AI 挑战和最终确认尚未发生。该缺口不是自动化已完成证据。

## 2026-11-03 M3 前置采集门禁补充

- 根因修正：此前只在 Process Pack 入口检查 Core，`input:weekly` 仍可能先采回 `weekly.md`。现单周与范围周记采集器都在远端周记读取前逐周调用 Core 实时 `gate`；任一周未填完即退出，不读取周记正文、不写 `weekly.md`、锚点或范围清单，也不发布共享周计划。Process Pack 仍保留第二次实时门禁。
- 真实阻断验收：W43、W44 均读回 0/20。`npm run input:weekly:range -- --period=2026-W43-W44` 在周记读取前以退出码 3 返回 `weekly-process-blocked-core`；`npm run process:weekly:range -- --period=2026-W43-W44` 同样在生成前阻断，原有范围 Pack 未被覆盖。
- 用户入口验收：周记范围文档底部已读回 W43、W44 两个直达 Core 链接，线上 revision 5391；第二次运行复用已有链接，没有重复插入。GUI 分别打开两份 Core 表单并看到四个字段列；没有代填任何本人内容。
- 使用真值：[Learn-X 周记与 Core 使用说明](https://ywhome.feishu.cn/wiki/KPAQwbCsZihYurknpEacujQUnKf) 已由 bot 局部更新并读回 revision 7，明确填写 5×4 个字段、缺项阻断周记输入采集和 Process Pack、显式空值及后续 AI 候选顺序。
- 当前状态：链接、表单、采集前门禁和 Pack 前门禁已接通；流程保持 PARTIAL，须本人完成 W43/W44 两份表单后，才能验收 `weekly.md` 放行、AI 挑战与统一确认。05:00/07:30 配置未改，调度器实际唤醒未验证。
- 一次性模拟验收：仅在 W43 的 5×4 表单写入明确标注的合成内容，Core `gate` 读回 `ok=true`、20/20；随后清除模拟值并再次读回，表单恢复空白、门禁恢复 0/20。W44 未修改；没有运行周记采集、Process Pack、AI 挑战或确认流程。
- ywuse 用户入口复验：Ego Lite 从「2026 周记 & 月记 & 年记」入口进入 W43–W44 周记区，读到 W43/W44 两个 Core 链接；点击 W43 后打开对应 Core Wiki 页面，界面 DOM 可见「本周行动」。之后 bot 读取 W43/W44 实时门禁均为 0/20。直接打开周记 Docx token 在该浏览器会话中落回总目录，所以按总目录内的周记区链接继续，路径实走成功。Ego Lite 只用于浏览和点击；没有用用户浏览器身份代填，模拟数据通过已授权的 bot 写入口填入并已清理。

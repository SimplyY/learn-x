---
name: learn-x-weekly-automation
description: Learn-X 每周输入自动采集、Weekly Output 报告准备、已审核 Memory 迁移，以及明确请求的历史日记补全周记与 Flomo 存量同步中文工作流。Use when the user asks for "Learn-X 每周输入自动采集 & 报告 & 记忆", weekly report automation, W27/Wxx weekly processing, historical weekly backfill, generating weekly `_dist` / Process Pack / Output shell, or preparing weekly memory candidates from reviewed Weekly Output.
---

# Learn-X 每周自动化

## 可选多周范围模式（默认单周）

正常触发仍处理一个 ISO 周。用户明确给出连续周期范围或明确要求跨周时，可把范围设为 1–4 个完整、连续的 ISO 周；未指定范围时保持单周默认。周期 ID 在同一 ISO 年内使用 `YYYY-Www-Www`（如 `2026-W43-W44`）；跨 ISO 年使用完整端点（如 `2026-W52-2027-W01`）。范围覆盖从首周周一至末周周日，写作日为末周结束日的次日。超过 4 周、范围不连续或起止周无法唯一解析时，先询问再运行。下文凡写“目标周”，范围模式均指整个周期；不得只拿首周或末周代表整个范围。

- 一个范围是一条完整流程：只产出一个周记段落、一个 Process Pack、一个 Weekly Output 和一笔 Memory 审批事务。用户只经历一次本流程；单周采集器在流程内部按 ISO 周顺序各处理一次，复用已验证快照，不重采 `ready/empty` 来源，不并行启动同一来源采集器。保留各周的目录、状态和来源路径，范围清单写入 `03_input/weekly/<period-id>/_range-manifest.json`。
- 范围周记草稿链接到每个组成周自己的 Core 文档。每个 Core 文档先放五个 Core 行和四个本人填写项（本周行动、现实反馈、本周思考和预判、下周行动）；每格须有内容或明确写 `无`、`不适用`、`未观察到`。范围内任一周未填完时，Process Pack 主流程停在 Core 门禁前，不生成或覆盖范围 Pack。
- 任意周记或报告字段中的事实范围必须覆盖整个周期。汇总来源状态时保留逐周明细；所有组成周都成功（`ready` 或有效 `empty`）后，范围状态才可标为完整。某来源仅部分周可用时，可纳入已验证部分，但须标记部分覆盖；不得把单周 `ready` 扩大成范围 `ready`。Flomo 合并全部组成周的有效笔记并按时间排序，分别保留各周扫描完整性，不能把多次全库计数伪装为一次连续扫描。
- ChatGPT Bridge 由用户手动操作。自动化不得提交、观察、恢复或重发 Bridge 请求；需要 ChatGPT 内容时提供可粘贴提示词。用户提供的范围总结保存在 `03_input/weekly/<period-id>/ai.md` 或明确命名的范围文件中，并按人工输入记录来源，不伪造 Bridge 状态。
- 周记只创建一个末周结束次日的段落，并显式列出周期 ID 和完整日期。周记未确认前不得采回 `weekly.md` 或生成 Process Pack。确认后将唯一 `weekly.md` 写到范围目录，并生成一份范围版 `input.json` / `process-pack.md` 到 `04_output/_dist/weekly/<period-id>/`；唯一 Weekly Output 为 `04_output/weekly/<period-id>.md`。不得为组成周分别生成 Process Pack 或 Weekly Output。现有只接受 `--week` 的 Process Pack 命令不得用首周或末周冒充范围；范围版必须汇集所有组成周的已验证输入、状态和预处理结果，并核验每个事实覆盖日期。没有可比的等长历史 Output 时明确标注，不拿单周 Output 冒充范围基线。
- Chat Pack 人工内容、用户周记确认及阶段 3 最终审批门槛保持不变。阶段 3 只为该范围准备一个 Memory 候选包、一份拟写内容和一张固定范围审批卡；季度目标按末周计算，候选来源和写入记录标明完整 `period-id`。凡只接受单周参数的 Memory、备份或索引命令，不得用首周或末周伪装范围；只有明确保留范围标识、完整载荷和范围哈希的适配步骤才可执行，否则停止受影响的写入并报告。范围适配步骤尚未准备好时，保留已完成草稿，不以单周收尾命令代替。

范围运行实现约束：采集器仍按组成周顺序逐一运行；`process:weekly` 和 `memory:weekly` 的单周入口不得用首周或末周冒充范围，范围分别走专用 Process Pack 与 Memory 适配器。`backup:weekly -- --period <period-id>` 原生保留范围 ID。其他写入仅在对应适配器完整校验范围、载荷哈希并完成读回后执行；适配缺失时停在该写入前，不生成伪范围产物。

当前执行的双周示例为 `2026-W43-W44`（2026-10-19 至 2026-11-01，周记写作日 2026-11-02），对应清单为 `03_input/weekly/2026-W43-W44/_range-manifest.json`。这只是本次已解析范围，不改变单周默认或每周 05:00 / 07:30 触发。

## 总览

把本 Skill 作为每周固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用已有采集器和 `learn-x-process` 命令。此工作流中的 ChatGPT Bridge 一律由用户手动操作；自动化只交付可粘贴提示词并接收用户带回的结果，不提交、观察、恢复或重发 Bridge 任务。

## ChatGPT 人工交接

需要 ChatGPT 内容时，给用户完整、可粘贴的提示词，并写明目标范围、用途和应保存的路径。不得调用 Bridge CLI、观察会话、导出附件或代用户提交；不得将本地周输入材料放入提示词。只把用户带回的文件或正文记为人工提供，保留其原始来源和确认状态。无人工结果时，按各阶段现有的可选来源和阻塞规则处理。

如果显式运行 `ai:weekly` 人工回顾适配器且该 handoff 返回多个不同候选，先向用户展示候选 ID、哈希和来源等级；用户明确选择后用 `npm run ai:weekly -- --week YYYY-Www --candidate-id <ID>` 恢复。未选择时保持待处理，不消费任一候选、不继续定稿。如果状态为 `needs_review/input-changed-after-manual-handoff`，旧候选不得用于更新后的 Prompt；输入补正后显式运行 `npm run ai:weekly -- --week YYYY-Www --retry` 生成新版本交接，旧结果仅留作证据。

## 快速命令

```bash
npm run input:weread -- --week 2026-W27
npm run input:calendar -- --week 2026-W27
npm run input:health -- --week 2026-W27
npm run input:voice -- --week 2026-W27
npm run voice:insight -- --week 2026-W27
npm run input:daily -- --week 2026-W27
npm run input:coach -- --week 2026-W27
npm run weekly:retry -- --week 2026-W27 --mode initial
npm run weekly:retry -- --week 2026-W27 --mode rescue
npm run weekly:retry -- --week 2026-W27 --mode recovery --source weread --action-code upgrade-official-skill --expected-source-version 2.4.1 --confirm
npm run weekly:recovery -- --source weread --symptom SOURCE-CONTRACT-MISMATCH
npm run weekly:stage -- --week 2026-W27 --record-stage <stage> --duration-ms <measured-ms> --outcome <success|failed>
npm run input:wisdom -- --week 2026-W27
npm run input:core -- --week 2026-W27
npm run sync:life-core
npm run process:weekly -- --week 2026-W27
npm run process:weekly -- --week 2026-W27 --prepare
npm run input:weekly-anchor -- --week 2026-W27 --write-date YYYY-MM-DD --target-title "M.D" --target-block-id <block-id> --document-id <document-id>
npm run memory:weekly -- --week 2026-W27
```

明确请求“存量周记补全”“用日记补缺周记”或“历史周记同步 Flomo”时，读取 [references/historical-backfill.md](references/historical-backfill.md)，进入独立的历史回填模式；它不改变下面的正常周流程。

先按“目标周选择”解析出唯一目标周，再只运行当前阶段需要的命令。飞书 CLI 默认读取使用应用身份（`--as bot`）；本方案中的周记及 Core Docx/Wiki 写入统一使用 bot，并在写入前核验身份、写后读回；任何失败都停止受影响写入，不切换到 user。涉及多维表格 Base 的新增、更新、修改、删除等写操作仍使用用户身份（`--as user`）；Base 写入失败不得回退到 bot。读取失败时不自动切换身份。Flomo 只通过 Ego Lite；每周一 00:10 的 Flomo 专项自动化对上一个完整 ISO 周执行全库扫描，失败时在独立进程间最多重试两次，校验通过后激活活动快照，并从同一扫描提取目标周 `flomo.md`。每次尝试都通过本执行器持有同周状态锁和浏览器队列锁，使用新 invocation UUID 与专属 TaskSpace；自动化不会在重试等待期间持有锁。周一 05:00 主流程复用已成功的同周状态，不重复扫描 Flomo；若专项运行未成功，主流程仍按现有来源恢复规则处理。周一 07:00 补救流程继续负责恢复尚未成功且可自动重试的来源。周输入仍按笔记创建时间筛选；旧笔记编辑只更新活动全量快照，不进入本周 `flomo.md`。完整性校验失败时不激活新快照，文件头须记录活动快照 ID 与采集时间。手动运行 `npm run input:flomo -- --week YYYY-Www` 也进入同一个重试执行器和浏览器队列。不得复用来源不明的 TaskSpace，也不得改用 Chrome、CDP 或旧导出。

00:10 自动化 `learn-x-flomo-00-10` 每次只运行一条 Flomo 来源尝试：调用 `npm run weekly:retry -- --week YYYY-Www --mode manual --source flomo --automation-id learn-x-flomo-00-10 --single-attempt --skip-prepare --skip-flomo-review-import --max-duration-ms 1920000`。尝试最多 32 分钟；失败后只对状态中分类为可重试的错误，至少等待 20 分钟，并遵守更长的 `nextRetryAt`；未知或不可重试的失败停止并报告。若执行器返回 `supervisor-already-running`，这不是失败或一次尝试；只读检查同周状态，等待当前执行结束并重新读取状态，不得并行启动同来源采集。整个自动化最多运行 160 分钟且最多启动三次。成功立即停止；登录、权限、验证码、人工接管或明确需人工复核时停止并报告。第三次前只检查脱敏状态和错误信号；仅在 Flomo 专属采集文件干净、根因明确且补丁只需修改一个采集文件时才可自动修复，并运行对应 Flomo 回归测试。不得修改凭据、通用调度器、治理规则或已有未提交文件；修复不清楚、文件不干净或测试失败时，安全撤销本次补丁（仅当文件哈希仍与本次补丁一致），然后在新 TaskSpace 用原代码进行最后一次重试。达到 160 分钟仍未完成时停止，交由 05:00/07:00 现有流程继续处理。

### 飞书 CLI 身份路由

- 读取 Base、表结构、字段、记录及其他飞书资料：默认 `--as bot`。
- 新增、更新、修改、删除 Base 的表、字段、记录、权限或其他资源：使用 `--as user`。
- 不因应用缺少 Base 写权限而反复申请应用权限；应用身份只用于默认读取。

### 周记草稿的持续授权边界

用户已明确授予持续授权：本自动化在阶段 1 可使用 bot 身份，将目标周输入生成的草稿写入固定文档 `https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac` 的 `周记` 区域，仅限目标周结束日次日对应的新周记段落和模板安全空位。允许复制缺失模板、填写空白字段并保留 `【待优化】AI 基础草稿` 标题标记；`回顾最近笔记 & flomo 洞察` 字段也纳入自动草稿，但只可在新复制模板的空位中原样填入运行日期所在 ISO 周之前最近一个已结束周（Asia/Shanghai，周一至周日）的全部有效 Flomo 笔记。此定义不随手动指定的目标周改变，并在汇报中同时列出目标周和笔记来源周。若来源周就是目标周，复用已验证的目标周 `flomo.md`；否则只读核验来源周目录。仅当来源状态为 `ready`、范围和记录数匹配，且完整扫描或最多 10 条容差缺口都有文件头与侧车证据时才填入全部可见笔记；存在缺口时在笔记前明确说明观察数、预期数和遗漏数，不省略或改写笔记。状态为 `empty`、数量为 0 且扫描无缺口时保留模板提示并报告“0 条笔记”；若 0 条观察结果伴随容差缺口，也保留模板提示并说明“可见 0 条，覆盖不确定”；`failed`、`unavailable`、缺少完整性证据或范围不符时保留模板空位并报告原因。`flomo.md` 沿用现有过滤边界，排除 Learn-X 生成内容。不得按运行时刻滚动取最近 7×24 小时、使用不完整周或旧文件替代。保留模板提示和笔记边界，不总结、筛选、改写或截断。若目标字段已有实质人工内容或草稿，停止并报告，不覆盖。不得修改其他周或其他文档；用户于 2026-10-29 明确授权同周 Core 文档创建或复用及目标周安全位置中的直达链接，按下方常规流程执行。

周记中的 Flomo 笔记分块排版与逐项回读，按 `.agents/skills/learn-x-weekly-journal/SKILL.md` 执行。`calendar.md` 只用于独立采集状态与阶段 2 Process Pack 的计划上下文；不得读取、传入、引用或交叉核验它来生成周记，日历状态也不影响周记门禁。

除上述明确授权的同周 Core 建档与链接外，该持续授权不涵盖 `weekly.md`、Weekly Output、Memory、备份、已停用的 Flomo 反向同步、AI/ChatGPT 外发或任何其他外部写入。目标文档、目标段落、bot 身份、写入范围或删除动作发生变化时必须停止并重新确认；在授权范围内无需每周重复询问，但每次写入后仍必须定位核验并回读确认。

### 默认采集范围

阶段 1 默认执行本 Skill 所列的全部自动来源：Flomo（含 Flomo 需回顾增量导入）、微信读书、Time-X 日历、Voice-X、飞书日记与 AI Coach、智慧之门。同时检查独立产物 `build.md`、`build-bot.md`、`health.md`。不得因为历史自动化 prompt、旧运行记忆或上一次的临时选择，缩减本轮来源，也不要逐项询问是否采集。用户明确说“本轮只采集……”时才临时缩小范围，该选择仅对当前目标周、当前运行有效；下一次自动恢复全量。

Action Feedback 已于 2026-10 退役：周度行动 / 反馈复盘由独立仓库 Core V1（`/Users/yuwei/code/core`）接管，Learn-X 不再创建 `action-feedback.md`，`action:feedback` 命令（draft / sync / collect / migrate）已被退役守卫拒绝，不再写入 Action Feedback Base。历史 `action-feedback.md`、Base「Learn-X Action Feedback」与旧 Process Pack 保留可读，但不再回读。阶段 1 同步最新核心议题镜像、采集本周输入并生成周记草稿；`周记已确认` 只确认周记草稿。

日记与 AI Coach 使用独立入口 `input:daily`、`input:coach`，分别记录状态；Coach 0 条只代表成功空结果，不影响 Daily。

同周自动采集统一由 `npm run weekly:retry -- --week YYYY-Www --mode initial` 编排：独立 CLI 最多 3 路并行，浏览器任务单队列，来源侧车通过锁和原子合并写入。不要再从自动化外另起相同周采集器。

### Code X 周日 Voice-X 自动化

Deep Code X 另有一个独立的周日调度（`learn-x-voice-insight`，20:00，Asia/Shanghai），不改写周一 `learn-x-3` 的阶段边界。它按当前 ISO 周执行 `npm run voice:insight -- --week YYYY-Www`：默认只生成预览上下文、状态和新版洞察采集结果，不添加 `--send`，不自动调用 ChatGPT，不覆盖旧 `voice.md`。需要正式批量生成时，必须在人工确认后显式执行 `--send --confirm`；旧格式迁移使用 `--migrate-legacy --confirm`。

## 启动规则

1. 目标周选择：
   - 用户明确给出连续多周范围时，优先解析为整个范围；默认仍为单周，不因“每周”自动扩大。范围规则见本 Skill 顶部。
   - 用户明确指定 `YYYY-Www`、`本周`、`这周`、`上周` 时，按用户指定。
   - 未指定时，按 `Asia/Shanghai` 当前日期自动判断：周一至周五默认上一 ISO 周；周六、周日默认当前 ISO 周。
   - 周三至周五自动选上一周时，必须在汇报中提示：现在仍是周中，默认处理上一周；如果要提前写本周，需要明确说“本周”或指定 `YYYY-Www`。
   - 周六、周日自动选当前周时，视为提前写当周；允许输入只覆盖截至运行时，但必须报告未来日期或缺失日期，不得声称整周已完整结束。
   - 格式统一使用 `YYYY-Www`。
   - 周记日期映射：线上周记标题日期是写作日，不是内容覆盖日。目标 ISO 周的覆盖范围为周一至周日；对应周记标题通常是目标周结束日的下一天（下一周周一），其正文回顾写作日前完整的 7 天。例如 `2026-W31` 覆盖 `2026-07-27`—`2026-08-02`，必须定位 `## 8.3`，不能定位 `## 7.27`。匹配时先由目标周计算“下一日”的 `M.D` 标题，再验证正文覆盖范围；不得用标题所在周、相邻旧条目或本地旧文件替代。
2. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-input/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
   - 如果当前阶段会采集 `weekly.md`，先一次性核对并提示缺失授权，避免逐项打断用户；本 Skill 默认把相关授权合并为一轮确认。
3. 保持当前扁平周目录：`03_input/weekly/YYYY-Www/*.md`。不要恢复旧版 `00_log/`、`01_inbox/`、`02_action/` 嵌套结构。
4. Flomo 的桌面恢复路径只使用 `ego-browser`（Ego Lite）。每次 `learn-x-v2` 自动化执行都已获授权创建一个新的 Agent-owned TaskSpace，不需要逐次确认；用自动化 ID 加本次 invocation UUID 命名，不能只用目标周、固定名称或可复用的进程 PID。仅在这次执行的 Flomo 预检与 memo 检查点间复用本次返回的 TaskSpace ID；下一次执行即使目标周相同也创建新空间。不得扫描、认领、续用或关闭此前执行留下的空间；旧空间失效、被移除或不可恢复不阻塞新执行，也不作为同一周必须先清理的条件。若本次新空间被用户接管或变为 inactive，则停止本轮 Flomo，不在同一轮创建替代空间；后续独立执行可创建新空间。Flomo 需回顾导入等有副作用步骤仍须先查幂等状态。每次执行只在 `finally` 中关闭本次新建的空间，读回确认关闭后再汇报；清理只能针对该 ID。页面未登录、任务空间被用户接管或读取失败时，不自动切换到 Chrome 插件、CDP 或旧导出。
   - 快速路径：直接新建标签页、写入 Flomo URL 并回车；不要做普通 HTTPS 预检、截图或重复读取完整页面树。
   - 全量扫描由 `weekly:retry` 执行；等待初始加载完成后持续分页至采集器确认的稳定终态，不得因已覆盖目标周下界而提前停止。只有完整性校验通过后才激活快照，并从同一扫描结果提取目标 ISO 周。
   - `memo_id` 是笔记身份：置顶与普通列表中的同 ID 记录合并，不同 ID 的同文笔记保留独立身份；不得按 `(创建时间, 正文)` 合并。采集器必须逐条校验 ID、时间和正文，并核验最长笔记详情；缺 ID、冲突正文、未稳定到底或超出允许缺口时拒绝替换当前快照。
   - 若 Ego Lite 任务空间、自动导航或页面读取失败，停止 Flomo 来源并报告 Ego Lite 异常；不得降级到 Chrome 远程调试、CDP Proxy、其他浏览器插件、读取浏览器凭据或旧本地导出。
   - Flomo 置顶镜像和目标周 `flomo.md` 均从已校验的同一全量快照生成。只有扫描无计数缺口、完整正文校验通过且恰好有一条有效置顶时，才更新 `03_input/_mirrors/flomo-top.md`；否则保留旧镜像。置顶笔记不进入周输入的目标周正文列表。
   - 稳定到底、逐条正文校验通过且全库计数缺口不超过 10 条时，发布目标周 `flomo.md` 并标记 `ready` / `empty`；文件头和侧车摘要必须同时写明预期数、观察数、遗漏数及“容差内，最多 10 条”，不得把有缺口的扫描描述为无缺口。缺口超过 10 条或身份、正文、到底证据无效时，拒绝替换快照并保留旧周输入。观察到目标周 0 条但全库存在缺口时，不声称确认无匹配；保持 `empty`，摘要说明可见 0 条及覆盖不确定。没有缺口且确认目标周 0 条时不生成新文件，标记 `empty`，报告“0 条笔记”。
5. AI Coach 由 `input:coach` 采集。按各表真实字段区分新增与回顾；若四张表筛选后合计 0 条新增记录，成功采集但不生成 `coach.md`，并记录 `empty`；这不是失败，阶段 1 必须报告“AI Coach：0 条记录，文件未生成”。
7. 不读取、打印或保存凭据。除用户明确授权的 `03_input/_mirrors/flomo-top.md` Flomo 镜像和 `03_input/_mirrors/人生核心议题.md` 每周同步镜像外，不修改 `README.md`、`Core/道`、`Core/法`、`02_prompts/` 或无关长期资产。
8. 人生核心议题镜像：阶段 1 固定执行 `npm run sync:life-core`。脚本用 `lark-cli docs +fetch --as user` 读取 `https://ywhome.feishu.cn/wiki/QIaQwXf07iMvqokKQf3cp3XmnMC` 最新 Markdown，以首个 `# 附录` 一级标题为防御性截断边界，校验三个核心一级标题、实质正文、无附录、无未展开 Sheet/资源块后，原子覆盖 `03_input/_mirrors/人生核心议题.md` 并在 HTML 注释头记录来源 URL、revision、正文哈希、成功同步时间、最近尝试时间和 `fresh/stale` 状态。同步失败保留最后有效正文、只更新为 `stale` 并在汇报和材料清单中警告；首次同步失败不伪造文件。该文件只是 Learn-X 私有输入镜像，不属于 Core 正式道法。

## 阶段判断

- 定时触发，或用户没有明确继续指令：执行阶段 1；自动化执行器负责自动来源，随后生成飞书周记草稿。AI 周回顾为用户手动提供的可选输入，不启动 Bridge。
- `继续` 按当前流程位置解释：阶段 1 草稿标题仍有 `【待优化】` 标记时，不视为确认；用户已移除该标记并明确说“继续”时，视为本轮周记已确认，直接进入阶段 2，不要求重复口令。阶段 2 后，以当前流程收到并定稿的 Chat Pack Weekly Output 内容作为交接；保存、读回并验证通过后，直接进入阶段 3，在同一轮回复展示完整确认卡，不要求另发“已完成”或“继续”。不要把同一短指令按固定全局含义解释。
- 阶段 1 不自动生成或正式化 AI 周回顾。若用户提供完整回顾，将其作为人工输入按范围校验并保留；若缺失或不完整，不调用 Bridge，继续无 AI 补充的草稿路径，并在需要时展示完整手动提示词。AI 回顾不构成阶段 1 周记草稿的额外硬门槛。不采集 `weekly.md`，不生成正式 `input.json`、`process-pack.md` 或 Weekly Output 壳，也不生成 `action-feedback.md`（已退役）。
- 用户说 `周记已确认`、`继续生成周报材料` 或同义表达：表示飞书周记草稿已审核通过；对同一目标周进入阶段 2，采集已确认的 `weekly.md`，仅发布其中唯一的“新周计划”表格行，再生成 `_dist`。
- 阶段 2 后，Chat Pack 最终内容在当前流程中定稿并保存后，以这份真实内容作为阶段交接：立即读回 Weekly Output，验证目标周、必需正文和占位项；通过后在同一轮进入阶段 3并直接交付完整确认卡，不等额外“已完成”“继续”或“给我确认卡”消息。若 Chat Pack 在另一界面完成人工操作，只有最终内容被带回当前线程且保存/读回校验通过后才续跑；不监控其他会话或文件变化。问题与回答保留在 Weekly Output，默认不进入 Memory 候选。
- 阶段 1 的 `继续` 不得跳到阶段 3；阶段 3 只按当前流程位置解析别名。
- 不猜测人工项已经完成：必须有当前流程中的 Chat Pack 定稿内容，并通过保存、读回和正文校验；文件存在或修改时间变化本身不算审核证据。门槛满足后直接自动进入下一阶段，不再等待状态确认消息。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标周；不要在后续阶段重新按当天日期推断。

### 最少交互约定

正常流程只在三处等待用户：审核周记、完成并定稿 Chat Pack 人工内容、确认展示了真实拟写内容的最终卡。Chat Pack 定稿内容本身是交接依据；同一流程一旦保存并读回校验通过，就在该轮自动完成阶段 3 候选准备并展示最终确认卡，不再等待单独的完成/继续消息。每条用户推进指令或定稿内容都应在同一轮完成该阶段全部可做工作，并直接停在下一个真实门槛；禁止只回复“已进入下一阶段 / 正在准备”，再要求用户重复“继续”。

- `周记已确认` 后，一轮内完成阶段 2 的采回、校验、Process Pack、范围预览和汇报；随后用户完成 Chat Pack 人工工作，并将定稿内容交付当前流程。定稿内容就是交接材料，不另发状态消息。
- 当前流程拿到 Chat Pack 定稿后，读回并通过目标周、完整性与占位文本校验，即在同一轮完成 Memory 候选准备、拟写内容和指纹绑定，并展示完整确认卡；不要求用户再说“继续”“已完成”或“给确认卡”。
- 用户确认最终卡后，一轮内完成卡内所有已授权动作及读回，最后集中汇报；不得在备份、YW Next 或 Flomo 等子步骤之间再要“继续”。遇到硬门槛缺证或远端写入结果不明时，只暂停受影响路径，明确列出证据和恢复动作。

报告仍列全局位置与后续动作，但“再下一步”应说明由当前这条用户指令自动触发的工作，不得暗示用户还要再发一条指令。真实的周记审核、Chat Pack 人工工作和最终内容确认不得合并或代替；固定范围预览也不能替代真实内容确认。

### 阶段 1 有界自动重试

周一 05:00 启动一次 `weekly:retry --mode initial`。瞬态错误冷却后对原命令最多做一次简单重试；默认网络冷却至少 20 分钟，Flomo 至少 10 分钟，并遵守服务端更长冷却。CLI 并发最多 3 路、浏览器单队列。每次执行最长 100 分钟，锁等待、冷却、检查、修复与验证都计入同一截止时间；重启进程不重置该目标周的尝试数。周一 07:00 的补查按第二层恢复处理，不能把 05:00 已用的首次重试次数清零。成功空结果不重试。

第一层仅验证瞬态故障并重跑同一来源一次。进入任一恢复层前先读本周 `_weekly-retry-state.json`、最新来源状态、实际文件和最多三条适用的已验证经验。查询必须按来源、具体错误、恢复层、当前版本和已核实前提过滤；例如：

```bash
npm run weekly:recovery -- --source <来源> --symptom <错误码> --source-version <当前版本> --layer <1|2|3> --satisfied-preconditions <已核实前提逗号分隔>
```

只读重查、找已有产物、核对 ISO 周/版本、观察原任务优先。对非网络问题可以直接进入第二层。最多采取两种不同的低风险恢复动作，失败和成功都记录；不得把 `unknown-failure` 自动并为同一个根因。进程重启后，已持久标记 `running` 的恢复动作改记为 `inconclusive`，绝不重放同一动作；预算允许时只能选择新的、不同的恢复动作。

第三层只在同一来源的两种第二层动作都已结束且仍未解决时开放；状态必须为 `failed`、`inconclusive`、`needs_review` 或 `unavailable`。第二层预算只统计第二层动作，不把第三层补丁误计为第二层额度；来源已成功或动作仍在执行时不得进入第三层。

来源修复动作完成或已有产物核验后，只对单一失败来源调用 `weekly:retry --mode recovery`。当前允许 `verify-only`、`manual-repair`；WeRead 升级还允许 `upgrade-official-skill`。先核实动作前提，再传 `--confirm`；该标记只确认执行这一次已审查的恢复采集，不代替来源身份、权限或版本校验。WeRead 必须先从官方来源完成升级，再传实际安装版本给 `--expected-source-version`；采集器回报版本不一致时按失败处理。恢复器会先核对目标周现有产物，已有有效结果时不重复采集；否则只运行指定来源，并持久记录动作状态。每来源每周最多两种不同的第二层动作；已有 `running` 状态、重复动作或额度用尽时停止，不盲目重跑。AI 不接受这个通用入口，继续按原会话观察与一次性重发规则处理。缺少 Bridge 原 run 标识时，只保留 `needs_review`，不猜测原任务归属、不观察不明会话、不重发。

第三层只在前两层未解决、根因有一手证据时考虑小补丁。先用 `npm run weekly:recovery -- --show-problem --week YYYY-Www --source <来源> --symptom <错误码> --run-id <problemRunId>` 查询稳定问题 ID；再将已核实根因与证据路径写成已验证事件。由未参与实现的独立审查者检查精确补丁，并提供收据 JSON：`{"problemId":"P-0123456789abcdef","patchSha256":"<64位哈希>","authorId":"<作者>","reviewerId":"<不同审查者>","verdict":"approved","findings":[]}`。收据必须对应本次补丁哈希；作者不得自审。护栏只能核对收据字段与补丁哈希、确认填报的审查者 ID 不同，不能自行认证审查者身份；执行者必须核实确有独立审查结果，否则不得应用补丁。

补丁和收据只放在本 Skill 被忽略的 `state/recovery-temp/` 下，使用权限 `0600`，不得把正文写入恢复记忆或诊断日志。运行 `npm run weekly:recovery-patch` 护栏：CLI 输入必须在仓库内且路径无软链接；补丁只允许修改已跟踪的实现/规则文件，不接受测试文件、新建或删除文件；最多 3 个文件和 100 行有效增删。原失败用例必须在补丁前实际失败，反例必须在补丁前后实际通过，补丁后原失败用例也必须通过。记录基线、补丁、审查收据和结果摘要哈希，不保存补丁正文。护栏会先在隔离副本计算补丁的精确预期字节；只有当前文件仍匹配基线时才应用，失败回滚只恢复精确匹配预期补丁结果的文件，其他字节差异保留现场并标为冲突。结束后删除 `state/recovery-temp/` 下的补丁与审查收据临时文件。

```bash
npm run weekly:recovery-patch -- --week YYYY-Www --problem-id <问题ID> --source <来源> --symptom <已确认错误码> --root-cause-evidence <相对证据路径> --patch-file .agents/skills/learn-x-weekly-automation/state/recovery-temp/patch.diff --review-receipt .agents/skills/learn-x-weekly-automation/state/recovery-temp/review.json --author-id <作者> --failure-test <复现测试路径> --failure-title <测试标题> --counterexample-test <反例测试路径> --counterexample-title <测试标题> --deadline-at <共同截止Unix毫秒>
npm run weekly:retry -- --week YYYY-Www --mode recovery --source <来源> --action-code small-patch --problem-id <问题ID> --confirm
```

第二条命令只有在同周、同来源、同问题 ID 的护栏验证事件完整且成功时才重采；损坏或缺失的记忆记录关闭该路径。不得自动改身份、授权、来源契约或人工确认门槛，不得让历史经验扩大授权。不能证明安全或本轮剩余时间不足时停在缺口状态，让用户决定是否重跑。

日记草稿门槛：日记状态 `ready`、至少一条有效记录且目标周匹配时，立即调用 `learn-x-weekly-journal` 生成并回读草稿，不等待其他来源、语义候选、Core 建档或冷却结束。启用同周 Core 入口后，按下方规则并行启动建档；若草稿写入时尚无已验证结果，先交付草稿，再尝试安全补链。启动执行器后，用同一进程会话运行；并行只读轮询目标周状态文件。执行器按来源原子保存状态，所以日记就绪后可在执行器仍运行时写草稿；不要启动第二份相同采集器。07:00 补查只为仍缺失的产物恢复或补生成，不重复已有草稿。日记无效或缺失时不写周记，07:00 恢复结束后再核验一次。其他来源缺口在周记草稿和汇报中醒目列出。

Health-X 本地报告独立于 Base 同步。智慧之门 Base 采集独立于 Flomo，Flomo 仅作为可选的回顾导入增强。Build 与 Build-Bot 只对账其实际目标周文件，不启动它们的生产流程；飞书机器人 Build 不调用 `build-bot-log`。

Codex Build 原线程恢复：Build 自动化启动时，用当前自动化线程的真实 `threadId`、`hostId`、自动化 ID 和目标周调用 `npm run weekly:build-recovery -- --week YYYY-Www --record-start --thread-id <id> --host-id <id> --automation-id learn-x-codex-build`，先保存一次性绑定收据。无法取得真实线程或宿主身份时，只生成本线程结果，不尝试续跑其他任务。仅观测到明确额度耗尽时调用 `--mark-quota-limited --reason quota-exhausted`（或已核实的 `rate-limit-window`），不把网络、登录或普通失败标成额度问题。

确认额度耗尽后最多观察 12 分钟：用 Codex 用量工具核验额度，用任务工具查询收据所绑定的同一线程。线程仍在运行时只等待；线程已停止但仍限流时不发消息。额度恢复且同一线程处于 `idle`、`failed` 或 `needs_attention` 时，先运行 `--claim-resume --task-status <状态> --quota-available` 原子预占唯一机会，再把命令返回的 `followUpPrompt` 发给该收据指定的原线程；不得创建新线程或替换目标。发送已接受后运行 `--mark-resume-submitted --claim-id <claimId>`。发送结果不明时保留已预占状态，绝不再次发送。最后运行 `--verify-artifact`；只有 `build.md` 的覆盖周与目标 ISO 周匹配才记为完成。错周、缺失、不可读或身份不匹配都保持待核验，不改标签、不认领为目标周。

- 飞书身份闸门：周记草稿写入前用 `lark-cli auth status --json --verify` 核验登录态。任何身份核验失败、写入身份不符或目标段落无法回读时，周记写入失败关闭，不猜测、不回退 user。
   - ChatGPT Bridge 一律交由用户手动操作。自动化及其 supervisor 不得提交、观察、恢复或重发任何 Bridge 请求；需要 ChatGPT 内容时输出完整可复制提示词并停在人工作业点，接收用户带回的结果后继续本流程。提交状态侧车和旧 Bridge run 不构成本流程恢复依据。
- Flomo 与智慧之门：智慧之门 Base 采集进入首次 CLI 并行批次，不等 Flomo 扫描、AI 观察或浏览器冷却。Flomo 失败时仍采集 `wisdom.md`。两项来源状态都成功后，再把需回顾导入作为独立浏览器队列增强步骤；按 `来源标识=flomo:<memo_id>` 去重，导入失败只记录脱敏诊断，不改变 Base 采集状态。部分成功后重跑由来源键和读回去重。权限、登录、字段契约、人工接管和需人工判断的问题不循环重试。

问题修复记忆保存在本 Skill 的本地 `state/recovery-incidents.jsonl` 和可重建的 `state/recovery-playbook.json`；这两个文件被 Git 忽略，不进入 Input、Memory 或学习上下文。仅追加错误码、层级、阶段、动作编号、前提代码、结果、来源状态/版本/哈希/计数与侧车路径；不保存私人正文、健康数值、Prompt、凭据、原始响应、任意命令或补丁正文。三层共用同一问题 ID；未知错误各自隔离。同一执行中的不同恢复层只计一次复发。人工修复先记为候选：`npm run weekly:recovery -- --record-repair --week YYYY-Www --source <来源> --symptom <错误码> --action-code <动作编号> --note "不含私人正文的短说明" --evidence <相对证据路径> --verification candidate`；可附 `--run-id`、`--problem-id`、`--source-version`、`--layer`、`--preconditions`、`--target-week`、`--source-status` 和计数/哈希证据。只有读回或复现证据通过后才将 `--verification` 设为 `verified`，根因仍未证明时保持 `--root-cause unconfirmed`。达到复发阈值后，只有根因修复与回归都通过才用 `--event-type prevention --verification verified --root-cause confirmed` 关闭预防候选。历史经验版本不匹配或前提未核实时只作诊断参考，不自动执行。索引损坏时从事件重建；事件损坏时停止经验推荐，不猜测修复事实。诊断记忆写入失败只标记待补写，不阻塞可安全生成的内容。

同一问题独立发生 3 次或连续 2 个 ISO 周复发时，索引生成去重的永久修复候选，并列回归场景。日志写入步骤、来源、耗时、层级、错误分类、尝试数、冷却时间、安全状态和可核查侧车路径；自动分类为“待验证假设”，只有一手证据支持时才标“已确认”。

阶段耗时按实际开始与结束时间计算，不用示例常数。每阶段完成后追加一条技术元数据：

```bash
npm run weekly:stage -- --week YYYY-Www --record-stage <preprocess|weekly_journal_fetch|process_pack|authorization_card|memory_card|closeout> --duration-ms <实际毫秒数> --outcome <success|failed>
```

`preprocess` 覆盖阶段 1 的确定性准备与所需语义候选校验；`weekly_journal_fetch` 只覆盖确认版周记窄范围采回；`process_pack` 覆盖缓存核验与 Pack 组装；`authorization_card` 覆盖第二步固定执行范围预览的准备；`memory_card` 覆盖第三步实际 Memory 提取、校验和最终卡准备；`closeout` 覆盖第三步一次确认后的收尾。失败同样记录耗时和 `failed`，不得用固定估值填补未测量步骤。

## 阶段 1：输入采集与周记草稿

目标：采集自动来源后，直接用已落盘周信息生成飞书周记草稿，停在人工确认门槛前。

1. 确保 `03_input/weekly/YYYY-Www/` 存在。保留目录中已有的人工内容；AI 生成阶段先写入 `ai.generated.md` 和状态侧车，通过结构与完整性校验后自动移动为正式 `ai.md`，并在 `_dist` 保留审计副本；不得预建 `weekly.md`。
2. 按“默认采集范围”执行 `npm run weekly:retry -- --week YYYY-Www --mode initial`；该执行器恢复已有状态、跳过已成功来源，并管理并行度与重试。随后核对 `build.md`、`build-bot.md` 等外部拥有的产物状态，不替它们启动生产流程。来源明细规则如下：
   - Flomo：执行器为每次尝试创建独立令牌和 Ego Lite TaskSpace，执行线上全量扫描；结束状态稳定且逐条身份、正文、链接与详情校验通过后，先切换私有快照，再由同一快照提取目标 ISO 周。每日回顾从最近成功快照读取，不访问浏览器。ID 计数缺口 0–10 条按用户接受的容差继续发布周输入，并在文件及状态摘要展示预期、观察和遗漏数；超过 10 条或完整性错误拒绝替换成功快照。原有置顶镜像如有更新，也只能从这次全量结果生成。
   - Flomo 每日回顾 catalog：线上同步成功后由每日 `archive` 从 active snapshot 更新；不再扫描本地历史 Markdown 来重建候选库。历史 ID-less 内容保留在备份用于审计，不能造 Flomo 链接。周流程不做语义质量判断或每日推荐发送。
   - Flomo 需回顾导入与智慧之门：Flomo 成功后，执行器使用唯一 invocation UUID 调用幂等导入（`来源标识=flomo:<memo_id>`），随后采集 `wisdom.md`；Flomo 失败或导入失败都不得跳过独立的 Wisdom Base 采集。导入按原始 `Flomo创建时间`归周，Base 写入后读回；权限、时间、正文或读回校验失败均停止导入。汇报新增、已存在、跳过和失败数量，不把私人正文或原始响应写入诊断日志。
   - 微信读书：按 `learn-x-input` 执行 `npm run input:weread -- --week YYYY-Www`。版本从已安装 Skill 元数据读取。若返回 `upgrade_info`，第二层按官方安装指引核对来源和新版本，升级并回读版本后对目标周重采一次；升级无法核验时只标记 WeRead 失败，不重试旧版本，也不阻塞其他来源。验证输出保留目标周、Asia/Shanghai 范围、生成时间、阅读统计、进度快照、个人划线和想法，并包含完整 7 天，包括 0 分钟日期。
   - Time-X 日历：按 `learn-x-input` 执行一次 `npm run input:calendar -- --week YYYY-Www`，读取固定 `Time-X｜随时记` 共享日历与用户可读的主日历/自有共享日历，按同时存在的定时日程数分摊重叠时间，将有效时间汇总及每个日历块的日期、起止、原始区间、标题、描述和有效投入写入 `calendar.md`。只做导入阶段的只读计算，不修改日历；不保存日历人员、地点、ID、链接或系统元数据。
   - Voice-X：按 `learn-x-input` 执行 `npm run input:voice -- --week YYYY-Www`，只读取目标 ISO 周已归档的新版 AI 洞察文档，将完整结构化洞察写入 `voice.md`。缺失/占位计入 `pending`，旧格式计入 `legacy`，不回退到处理后原文；30,000 字符只是强提示线，不是采集门槛。`pending` 记录必须在阶段 1 汇报中逐条列出可点击的 Voice-X core 文档链接与录制时间。预处理阶段只对 `voice.md` 压缩一次，目标保留 10%–15%（预算中心 12.5%），记录逐文件字符链路。周日 `npm run voice:insight -- --week YYYY-Www` 是独立阶段，不由周一流程隐式触发；0 条、查询或文档失败均按来源状态处理并保留旧文件。
   - 飞书日记与 AI Coach：分别由 `input:daily` 和 `input:coach` 采集。采集器用 `--as bot` 现场核验 Base、表和字段，再按各表边界筛选并遍历全部分页；日记每次从实时字段表选择当前非计算、非同步元数据字段，唯一 `日期` datetime 字段负责筛选和排序，不依赖硬编码的旧内容字段。状态独立写入 `_source-status.json`。Coach 0 条只记录 `empty`，不影响日记；旧文件可保留但标记过期，失败时不计入本轮。
   - 智慧之门：执行 `npm run input:wisdom -- --week YYYY-Www`。通过 `collect-base-weekly.mjs` 遍历 Base 创建时间与 Flomo 原始时间对应的目标周分页；普通记录按 Base `创建时间`、Flomo 导入记录按 `Flomo创建时间`筛选。0 条时报告“0 条记录，文件未生成”，失败不得伪装成空结果。
   - 核心议题镜像：先执行 `npm run sync:life-core` 同步核心议题镜像；Action Feedback 已退役，不读取 Base 的 `continue` 行动，不生成 `open-actions.md`。
   - Core V1 确认复盘：执行 `npm run input:core -- --week YYYY-Www`。在目标周窗口内选择 frozenAt 最新的确认导出写入 `core.md`；无导出时报告缺失（`unavailable`，可选来源不阻断），不等待同覆盖周 Core，不回退更早版本。Core 回流是历史认知背景，与底层经历同源，不构成第二份独立现实证据；行动归属按覆盖周理解。
   - 飞书机器人 Build 复盘：本流程不执行 `build-bot-log`，不生成或追加 `build-bot.md`。必须提示用户：`build-bot-log 需要在飞书机器人上完成，请自查`。
     - 如果目标周是提前写当周，提示用户去飞书上手动执行，并输出自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX
     - 如果不是提前执行，提示用户周日飞书自动化理论上已提前执行，只需自查 `build-bot.md` 是否已由飞书侧写入。
   - Codex / Code X Build 复盘：由独立 Build 自动化确认 `build.md` 是否有本周有效证据；有则写 `ready`，无则写 `empty`，执行或授权失败写 `failed/unavailable`。本地周自动化不以旧 `build.md` 冒充本轮结果。
   - Health-X：`input:health` 按目标 ISO 周日（Asia/Shanghai）定位 `health-x/input/YYYY-MM-DD.json`，调用 Health-X 现有 `src/cli.ts report` 生成报告；命令工作目录使用临时目录，验证报告标题、周范围和结构后才以不覆盖方式写入 Learn-X `health.md` 并标记 `ready`。它只读取 Health-X 输入及 Health-X 报告所需的飞书日记汇总，不调用 `sync`，不写 Health-X Base。缺少输入记为 `unavailable`；日期/结构不匹配、权限或读取错误记为 `failed`；已有目标文件只核验，不覆盖人工或旧内容。Health-X 输入已上传但缺少 Learn-X 报告时，应由本采集器补生成，不要求用户重复上传或手工补状态。

   - 所有自动来源统一遵守：`ready` 才进入下游；成功 0 条写 `empty` 并报告“0 条记录，文件未生成”；`failed/unavailable` 单独报告，旧文件只保留在磁盘不计入本轮。状态文件为 `03_input/weekly/YYYY-Www/_source-status.json`，外部拥有者可调用 `npm run input:source-status -- --week YYYY-Www --source <source> --status <status> --file <file> --count <n> --summary "..."`。
   - 如果目标周是周六、周日自动判定的当前周提前稿，`daily.md` / `flomo.md` / `weread.md` / `wisdom.md` / `calendar.md` 可以只覆盖截至运行时；文件和汇报必须标出缺失日期 / 未来日期。
3. 读取用户提供的 AI 回顾（如有），校验其目标范围、日期边界和正文结构后，按人工输入记录来源并保存至本周期目录。需要 ChatGPT 回顾时只输出完整可复制提示词，用户手动提交并带回结果；不得查看 Bridge run 或将其提交状态写成自动化成功。AI 回顾是可选来源，不阻塞周记草稿。Flomo 笔记回顾字段由 `learn-x-weekly-journal` 按持续授权自动填入，不交给 ChatGPT 总结或代写。
4. 每个来源成功后由重试执行器立即触发 `npm run process:weekly -- --week YYYY-Www --prepare`，逐来源复用确定性预处理并更新私有缓存；不等待其他来源或周记确认。对缓存提出的语义压缩请求由 Codex 完成后再运行准备命令确认版本；不压缩周记，不生成正式 `input.json`、`process-pack.md`、Weekly Output 或 Memory。阶段 1 不采集线上确认版 `weekly.md`。
5. ChatGPT 内容交接只读取 `03_input/weekly/00_template/ai.md` 作为提示词来源，并附加目标 `period-id` 与完整日期；不得附加或发送本地周输入材料。需要该内容时，在汇报中提供完整人工提示词、目标范围及建议保存路径；只有用户带回的正文或文件才可纳入，并记录为人工提供。用户给出的材料若已满足结构和范围要求，直接核验、归档，不再触发 ChatGPT。

阶段 1 汇报先给出“本轮状态”和“本轮需关注”，随后按 `weekly-source-config.mjs` 的组内顺序展示「重要来源」和「可选来源」两张表；两张表共用顶部关注摘要，不要求用户自行拼接失败项。已确认的 `weekly.md` 单独列为阶段前提，不混入自动来源排序。Action Feedback 已退役，输入表中不再有独立产物行。状态列靠前，表列固定为：优先级、状态、输入类型、来源、文件（可点击核查）、记录/材料数、字符链路（原始 → 本阶段最终纳入）、结果；状态使用中文；成功为 `✅ 成功`，空结果为 `⚪ 成功（0 条）`，失败必须显示为 `🔴 **失败**`，不可用为 `🟠 不可用`，待人工确认用 `🟠 待人工确认`。只有实际发生语义压缩时才在字符链路后标注压缩信息。对本轮 `ready` 且实际纳入的输入，必须使用项目统一的 `countInputChars`（Unicode 码点数）报告文件字符数；若采集器没有记录来源端原始字符数，链路写 `— → N`，不得把整格写成 `—`，也不得猜测原始数。阶段 2 直接复用 `process-pack.md` 第 2 节的两张分组表，并保留处理链路的各阶段计数。`weekly.md` 是人工确认的阶段前提；`ai.md` 是可选补充，必须严格验证目标周和结构后才可纳入。
来源状态在机器侧继续使用 `ready`、`empty`、`failed`、`unavailable`；展示时翻译成中文并明确旧文件是否保留但不计入本轮。成功空结果单独报告“0 条记录，文件未生成”，失败/不可用不得写成 0 条。只有 `ready` 且本轮实际纳入的文件才报告字符数；失败、不可用、空结果和过期旧文件的字符列填 `—`，处理结果列必须直接写出原因。人生核心议题镜像必须在汇报中单独给出 `fresh/stale` 状态、revision 与同步时间；`stale` 时列为“本轮需关注”。
每个非空来源还必须给出可点击核查文件链接；不可用但保留旧文件的来源也要给链接并标注“过期、不计入”。
飞书周记草稿链接必须是周记 Skill 在写入后回读确认的目标段落锚点链接。先从同一次 `lark-cli docs +fetch --detail with-ids` 结果取得底层 `document_id`，并用写入后回读确认的最新目标标题 block ID 构造 `https://ywhome.feishu.cn/docx/<document_id>#<target-block-id>`；若 CLI 返回目标标题对应的实际 `#share-...` fragment，则保留该 fragment，但链接底路径仍使用 `/docx/<document_id>`。不得把 Wiki 节点 token (`/wiki/<node-token>`) 与 block ID 拼接：Ego Lite 实测该路径不跳转，而 `/docx/<document_id>#<block-id>` 会跳到目标段落。不得汇报固定文档首页、旧周锚点或未带 fragment 的 URL。

## 同周 Core 文档入口

每次正常周流程在确定唯一目标周后，与 Learn-X 来源采集并行启动且只启动一次 Core 骨架准备：

```bash
node /Users/yuwei/code/core/.agents/skills/core-weekly/scripts/weekly-review.mjs skeleton --week YYYY-Www --json
```

该命令不依赖 Process Pack；它按目标周绑定复用既有文档，或在同周锁内查重后创建文档并读回核验。观察同一次进程结果，不另启并行建档。只接受 `week` 匹配、`result` 为 `created` 或 `reused`，且含已核验 `docId` 和 `docUrl` 的结果。失败、超时或未知时先查同周绑定和创建意图，不盲目重建；周记采集与草稿仍继续，不因 Core 阻塞。

骨架读回后运行 `node /Users/yuwei/code/core/.agents/skills/core-weekly/scripts/weekly-review.mjs form --week YYYY-Www --json`。它从同周 Core 快照安全创建五个空白复盘行，不写 AI 候选、不覆盖已有人填写的内容。必须看到 `result: written|reused` 和五行回执后才把 Core 标为可填写。

`learn-x-weekly-journal` 只在本次新建的周记模板段落中，以 bot 在安全占位符写入同周直达链接并读回核对。已有周记、人工内容、无唯一安全位置或无本次新建证据时不补写、不覆盖。链接失败时保留占位或原稿，报告原因；不得为了补链重跑建档或影响周记交付。草稿先完成而 Core 进程稍后返回时，只尝试补入仍能证明未修改的安全占位。周记已有同一链接时只核验并复用。跨系统建立链接仍使用显式 bot 身份；不扩大其他文档、Memory 或 Core 总览的写入授权。

范围模式复用同一周记段落，在其范围标题后为每个组成周建立一个直达 Core 链接：

```bash
node .agents/skills/learn-x-weekly-journal/scripts/link-core.mjs --period YYYY-Www-Www
```

该入口逐周核对 `binding.json` 和 Core 文档 bot 读回；只有范围内所有链接都在目标标题后按顺序读回成功，才在范围锚点和清单记录 `links-verified`。部分链接或写入结果未知时停止，不重发。

## 阶段 1 内：周记草稿生成与人工确认

目标：从已落盘周输入生成飞书周记草稿，停在人工确认门槛前。

1. 验证 `daily.md` 与目标周 Flomo 状态；`daily` 必须为 `ready`、目标周匹配且文件有效。Flomo 可为 `ready` 且文件、计数及实际覆盖范围与采集状态一致，允许全库最多 10 条已明确标注的缺口；或为 `empty` 且计数为 0、成功扫描范围与目标周允许范围一致。存在缺口且目标周可见 0 条时，保留模板提示并说明覆盖不确定。不得读取状态为 `empty/failed/unavailable` 时仍留在磁盘上的旧 `flomo.md`。`daily` 未通过，或目标周 Flomo 为 `failed/unavailable`、完整性无法确认时，停止周记草稿生成，遵循线上 `learn-x.weekly-journal` Prompt 的门禁。若只有运行日期前最近完整周的 Flomo 回顾来源不可用且它不同于目标周，才按 Prompt 保留该周记字段空位并继续生成其他字段。优先读取已确认的 `ai.md`，否则仅在生成侧车为 `generated` 时读取 `ai.generated.md` 作为未确认草稿；AI 文件无效、空壳或缺失不阻塞周记草稿。
   - 不读取或提供 `calendar.md` 给周记生成步骤；日历来源状态不影响周记生成。其余字段继续按 `learn-x-weekly-journal` 的来源门禁处理。
2. 对“回顾最近笔记 & flomo 洞察”，计算运行日期所在 ISO 周的上一周。先读取该周 `_source-status.json`；只有状态为 `ready` 时才打开并校验 `flomo.md`。若来源周等于目标周，复用步骤 1 已验证的状态；若不同，只读来源周目录。`ready` 且文件头含完整目标范围、采集时间、记录数、早于周一下界的最早读取时间和 `下界已覆盖：是`，并与侧车周/计数一致时填入全部笔记；`empty` 且侧车计数为 0、`summary` 含完整扫描起止时间、`下界已覆盖：是` 及“0 条、确认无匹配”时只保留模板提示并报告“0 条笔记”，绝不打开可能残留的 `flomo.md`；其他状态或完整性无法确认时同样不打开该文件，保留模板空位并报告原因。随后调用 `learn-x-weekly-journal`：它按目标周结束日的下一天定位周记标题，复制模板并填新模板的安全空位；其他字段仍只使用本次目标周输入。已有实质内容或草稿时跳过，不覆盖、不刷新。
   - Flomo 全部笔记按 `.agents/skills/learn-x-weekly-journal/SKILL.md` 独立分块呈现，不合并成段或省略。周记各字段只使用该 Skill 允许的非日历来源；不读取或交叉核验日历。
3. 周记草稿生成并回读后停止，让用户审核 / 修改；同一周记段落已带有可点击的同周 Core 入口时，用户完成周记后直接点击继续。Core 骨架或链接暂未就绪不阻止周记审核和确认。`周记已确认` 仅表示周记草稿已审核通过。
4. 周记确认后，回复 `周记已确认`、`继续生成周报材料`，或在已移除草稿标记后明确回复 `继续`，即可进入阶段 2。

本阶段汇报必须包含上述两张分组表和周记阶段前提、目标周、使用的本地来源、飞书草稿链接、跳过字段、阻塞项、当前位置、下一步（审核 / 修改周记草稿）和再下一步（阶段 2 采集已确认的 `weekly.md`，一次生成 Process Pack）。

## 阶段 2：周记采集与报告准备

目标：先验证周记与覆盖周 Core 的本人思考均已确认，再采集 `weekly.md`、核验必要输入并生成 `_dist` 和 Output 最小壳；Process Pack 就绪后继续同周 Core 挑战。

1. 按“周记日期映射”计算写作日。阶段 1 生成并回读周记草稿后，已保存该目标周的标题、底层 `document_id` 和目标 block 锚点。用户回复 `周记已确认`、`继续生成周报材料`，或在已移除草稿标记后明确回复 `继续`，才进入阶段 2。`npm run input:weekly -- --week YYYY-Www` 会先校验周记锚点中的 Core 链接读回回执，并在线核对五项 Core 的 20 个本人填写项；任一项未完成时提示从周记链接填写并停止，不读取线上周记、不写 `weekly.md` 或共享周计划。通过后才窄范围采回锚定段落，不搜索或读取相邻周兜底。仍含 `【待优化】AI 基础草稿` 时停止。周记生成时排除 Calendar 是生成规则；不得追溯拦截已由用户确认的既有周记，也不得仅因旧草稿含 Calendar 内容要求重写。成功采回后，该命令校验本地 `weekly.md` 并仅发布唯一“新周计划”表格行到 `04_output/_dist/shared-context/weekly/`；不发布其他周记内容或 AI 输出。`weekly.md` 保留来源 URL、revision（缺失时为 unknown）、写作日标题、覆盖范围、定位依据和采集时间，原文不压缩。共享版本不记录猜测的确认时间；采集时间不能替代确认时间。记录 `weekly_journal_fetch` 阶段耗时。
   - 采集前如果发现缺少飞书周记所需授权，先一次性列出并请求全部缺失 scopes，再继续，不要一项一项分开打断用户。
   - 多周范围使用 `npm run input:weekly:range -- --period=YYYY-Www-Www`；它在读取周记前逐周执行同一 Core 链接和填写门禁，任一周未完成时不采回范围 `weekly.md`，也不更新范围锚点或清单。
2. Process Pack 组装时按目标周计算上一 ISO 周，只读取上一周完整的 `04_output/weekly/YYYY-WW.md`，并将它作为“仅作对照”材料完整嵌入第 9 节；不读取旧周记替代旧 Output。旧 Output 不能作为本周事实，本周事实以当前 Process Pack 的本周材料为准。基线缺失、为空或只是自动 Output 空壳时，保留第 9 节并标注 `missing`、`empty` 或 `shell`，明确不可比较；不得回退到更早周。
   - 阶段 2 汇报只报告上一周 Output 的周期、状态和绝对可点击文件链接，不复述旧 Output 正文或旧问答。
3. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `jingdu.md` 已退役；无论历史侧车状态如何均不作为本周输入读取。历史材料保留在原位置，供人工回溯。
   - `voice.md`（仅在状态为 `ready` 时读取；含目标周新版 AI 洞察的完整结构化内容，不含原始文字稿；30,000 字符为提示线，阶段 1 预处理缓存完成压缩）
   - `calendar.md`（仅在状态为 `ready` 时读取；只作计划上下文，`empty/unavailable` 时报告但不将其当作行动证据）
   - `coach.md`（本次采集有新增记录时才存在；包含新增记录并标注采集器排除的回顾更新；0 条时按来源状态记录，不阻塞）
   - `wisdom.md`（本次采集有新增记录时才存在；普通记录按 Base 创建时间、Flomo 导入记录按原始 Flomo 创建时间归周；0 条时按来源状态记录，不阻塞）
   - `health.md`（可选；缺失不阻断，但汇报必须先用一级大标题显著提示，并附 Health-X 生成命令）
   - `build-bot.md`（只验证是否已由飞书侧完成；不存在时报告缺口，但本流程不生成）
   - `weekly.md`
   - `ai.md`（可选补充；只有目标周标记、结构和运行状态均通过校验时才纳入，不得把空壳、模板或提示词当作内容）
   - 单周中，用户手动补入 AI 回顾后可按单周流程校验并确认。多周范围中，回顾必须显式覆盖完整 `period-id` 与日期；不得用 `ai:weekly --week` 将单周状态扩展为范围状态。保留原文、人工来源、范围和 SHA-256；若无法核实覆盖范围，将其标为部分覆盖并排除出范围正文。
   对周六、周日提前写当周的场景，允许自动来源是截至运行时的部分覆盖，但 `weekly.md` 必须是目标周真实回顾内容。AI 回顾缺失不阻塞阶段 1 草稿，也不阻断阶段 2 Process Pack；缺失或无效时在状态表醒目标记并排除。
6. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。`build-bot.md` 属于飞书机器人侧流程；本流程只提示自查，不调用 `build-bot-log`。
7. 在采回后核验必需来源状态和预处理清单，再运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

   正常路径只读取预处理缓存并做轻量组装，不重新采集或调用语义压缩。命令先核对周记锚点中的 Core 直达链接已有读回回执，再对目标周 Core 文档运行 `weekly-review.mjs gate --week YYYY-Www --json`；五项 Core 的四个本人填写项都完成或明确标为 `无 / 不适用 / 未观察到` 后，才继续采集并生成 Process Pack。门禁失败时提示用户从周记链接进入 Core 填写，停在 Pack 生成前；范围模式逐周检查所有组成周及链接。日记和确认周记仍是硬门槛；其他来源验证失败或缓存缺失时排除对应材料、生成有缺口 Pack 并醒目标注，不等待不相关来源。周记始终完整保留，不受 15,000 字符阈值影响。记录 `process_pack` 阶段耗时。

   多周范围使用 `node .agents/skills/learn-x-process/scripts/generate-weekly-range-process-pack.mjs --period=YYYY-Www-Www`。命令在读取或写入范围 Pack 前，对清单中的每个 ISO 周执行 Core gate；任一周未完成即停止，保留已有 Pack，不用首周或末周代替范围。

   单周 Process Pack 校验通过后，对同一目标周运行一次 `weekly-review.mjs prepare --week YYYY-Www --json`，复用阶段 1 已绑定的 Core 文档，只补齐五项当前快照、完整五项复盘结构及有来源的候选。不得新建文档或覆盖本人填写内容。范围模式不得把范围 Pack 传给单周 `prepare`；改用范围 `input.json` 中 `sourceWeek` 精确匹配的材料，为每个 Core 周分别形成挑战上下文，不把无周归属的范围周记或 AI 总结强行拆给单周。缺少周归属或事实覆盖无法核实的材料不进入该周挑战。Pack / Core 总览不可读或 prepare 失败时保留现有 Core 内容并报告待处理状态。

   Core 深度复盘在同一周流程中继续：门禁通过后再补充来源材料并进入 AI 挑战；AI 建议标为候选，由用户逐项取舍。Core 可以在填写阶段暂停；在本人思考完成前，主流程不得生成 Process Pack。人工填写内容由 Core 原文保留并进入后续统一确认。

8. 回读 Process Pack 第 9 节，确认上一周 Output 基线状态、完整正文（若 ready）和“仅作对照”边界正确。标准流程不得在 Pack 生成后再补填输入。

9. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 对自动空壳 Weekly Output，除可点击文件链接外，还要在阶段 2 回复中用代码块原样展示文件全文，让用户直接拿到空壳；若文件已有实质正文，只报告链接与状态，不把它称为空壳或重复全文。
   - `04_output/_dist/shared-context/weekly/current.json` 与对应不可变版本；说明 planWeek、sourceWeek、coverage，以及来源 URL/revision 缺失时的标记
   - 已完成来源、缺口、验证结果
   - Process Pack 成功生成后，在同一条阶段 2 消息中同时交付 Pack 与“执行授权范围预览”，让用户第三步可直接复制复核：列出 Memory 写入目标、备份范围与目的地、YW Next 刷新、留存清理和读回校验。它只展示固定执行范围与目标，不展示尚未生成的记忆内容，也不构成授权；阶段 2 不执行任何收尾写入。记录 `authorization_card` 阶段耗时。
10. 等待 Chat Pack 的真实人工定稿内容，不要求用户另发完成/继续状态消息：在 Chat Pack 中选择 Weekly Output，由生成入口实时读取飞书最新 `chatpack.weekly-output` 并注入本次内容；基于已共同审核的 `process-pack.md` 生成并审核周度记忆（保留具体经历、重要输入、思考、状态与变化；增加不超过 600 字的本周与上周对照）。在同一次操作中启用 `芒格之魂` 生成独立洞察，补充 `芒格之魂的洞察 & 全文核心重点纪要`，并由 AI 提出恰好 3 个问题供用户回答；未回答问题不迁移。审核 0–3 个“值得长期保留”候选，0 个合法。必要时读取 `layer-rules.md`。若从 Chat Pack 外生成，先运行 `node /Users/yuwei/code/skills/prompt-governance/scripts/fetch-prompt.mjs chatpack.weekly-output` 并遵循返回的 `content`；读取失败即停止，不用本地副本，除非用户明确授权本次降级。公众号发布仍由用户人工完成。Chat Pack 在当前流程内定稿后，立即保存并读回 `04_output/weekly/YYYY-WW.md`，验证文件目标周、必需内容（「全文核心重点纪要」「芒格之魂的洞察」）及完整性，不得包含未替换占位文本。若内容由用户在另一界面制作，需把定稿内容带回当前流程；内容交付本身作为交接，不追问状态或口令。有效内容通过后，当前回复立即继续阶段 3 并展示最终确认卡。当前流程无法读取到最终内容、目标周不符、必需内容缺失或占位文本未清理时，报告具体问题并停在阶段 2；不生成确认卡，不以文件存在或 mtime 变化推断人工审核完成。不得把文件监听或独立会话视为本阶段的触发器。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 在 Chat Pack 生成并审核最终 Weekly Output、芒格之魂、核心纪要、问题与回答和 Memory 候选；再下一步 = Chat Pack 定稿内容保存并读回有效后，当前流程自动生成并校验 `memory-candidates.md`，展示真实拟迁移内容并与第二步已预览的执行范围合并为一张最终确认卡；无需额外完成/继续消息。若用户在另一界面制作，需把真实定稿内容交付当前流程，不能以文件监听替代内容交接。第二步预览必须一次列明本周期 Memory 写入目标、备份载荷（`01_core/`、`03_input/`、`04_output/`、`05_library/`，不含图像文件）及 Learn-X 专用飞书云盘 / `Snapshots` 目的地、YW Next 刷新范围、留存清理和读回校验；不得包含尚未生成的记忆内容，也不构成授权。最终卡再列出实际拟迁移条目、排除项、目的地和同一组收尾动作，用户一次确认后执行。不得把备份或 YW Next 再拆成多个确认点。多周范围不得把仅接受单周参数的收尾命令用于单个组成周；范围适配未就绪时停在受影响写入前并明确说明。
阶段 2 的人工复核仍包含 Weekly Output 中的问题与回答；它们只保留在 Weekly Output，不生成 Memory 候选。

阶段 2 汇报直接复用 `process-pack.md` 第 2 节的「重要来源」和「可选来源」两张表：按来源配置顺序，已确认周记作为阶段前提单列。其余输入逐行保留 Process Pack 中的状态、文件原始 → 解析清洗后有效（去重前）→ Process Pack 最终纳入字符链路和结果；链路最后一个数字必须是本阶段最终纳入数。只有 Voice-X 等实际发生语义压缩的来源才显示压缩比例，文件名本身就是可点击核查入口。不能只报告来源数量和产物路径。失败或不可用行必须在相应分组表内可见，不得只藏在末尾缺口列表。
若 `health.md` 缺失，阶段 1 / 阶段 2 汇报的第一段必须是一级大标题 `# ⚠️ 缺失输入：health.md`，并同时给出目标周、报告结束日和 Health-X 的 `validate` / `sync` 命令；不能把缺失藏在普通缺口列表中。

## 阶段 3：已审核记忆

目标：先准备已确认的 Memory 候选和最终确认卡；用户确认后，按依赖顺序写入 Memory、备份并刷新下一周“找事”离线索引。

1. 当前流程收到 Chat Pack 定稿内容后，立即读回 `04_output/weekly/YYYY-WW.md`；验证文件目标周与本轮一致、Weekly Output 是实质性周报而非空壳/模板、必需章节完整且实质正文有效、必需段落无占位文本。任一检查失败都报告具体缺项并停在阶段 2，不生成确认卡。文件存在或 mtime 变化不算人工审核证据。
3. 上述读回和内容校验成功后，自动进入阶段 3；Chat Pack 定稿内容本身是交接依据，无需用户另发 `Chat Pack 已完成`、`继续` 或 `给我完整确认卡`。这只表示当前 Weekly Output 已完成并经过人工审核，不等于授权执行批量写入。先运行 `npm run memory:weekly -- --week YYYY-Www` 生成或刷新候选，再读取候选和规则，逐条展示真实拟迁移内容、排除项和目的地。问题、背景与回答保留在 Weekly Output，默认整体排除，不进入候选或 Memory。将准确的拟写入条目及目的地写入该周 `_dist/weekly/YYYY-Www/memory-proposed.md`，然后运行 `npm run memory:weekly -- --week YYYY-Www --bind-approval`；把实际条目与第二步的范围预览合成“最后确认卡”。此时不写正式 Memory、备份、YW Next 或 Flomo。最终卡与第二步预览的固定执行范围一致时，用户一次确认后，先运行 `npm run memory:weekly -- --week YYYY-Www --verify-approval --fingerprint <本卡对应的指纹>`，通过后才执行卡内写入；若周报、候选、拟写条目或季度 Memory 目标在卡片确认前发生变化，旧指纹立即失效；重新读回并生成卡片、取得新确认。确认词只需指向这张最终确认卡及其指纹，例如：`确认执行 YYYY-Www 最终确认卡（指纹：<卡片指纹>）`；该确认覆盖卡片列出的全部实际条目、固定范围和目的地。此后不得按备份、Full Access、YW Next、Flomo 分别再次请求确认；同一目标周、同一事务范围内因网络、Ego Lite、读回或工具环境失败而进行的安全重试沿用这次授权。只有新增目标、扩大数据范围、改变写入对象或新增删除动作时才重新确认。公众号发布始终由用户人工完成。若当前并非阶段 2 完成状态，`继续`按前序阶段规则解释，不得直接进入这里。

   **联合确认与执行：** 调用 `scripts/unified-confirmation.mjs` 的 `prepareUnifiedPreview`，按 Learn-X / Core、具体条目、内容和目标展示一张分项卡；修改或排除后重建并重新展示。若返回 `status=no-new-items`，说明本周 Core 无新增待确认项，不展示空卡或重复认可，并继续盘点已保存批次的恢复状态。卡片正文含唯一指纹，下一轮用户对该指纹的明确确认才是执行依据。收到确认后，通过 Codex 官方 `mcp__codex_app__read_thread` 读取当前线程消息；把官方响应交给 `createCodexHostAdapter`，然后调用 `confirmAndSyncCodexBatch`。它先核验实际展示卡、本人确认、Core 来源及远端目标基线，再不可变保存认可批次并读回，最后逐目标同步。批次保存失败不得执行任何目标；Core 同步返回失败或抛出异常时，结果为 `pending`，保留已保存认可并继续 Learn-X 收尾，不重复询问认可。Core 总览目标逐项写后读回为 `verified` 后，会调用 YW-Context 单一发布入口同步 `core-personal-docs`，回传来源版本、记录数与目标提交；若 ACC07 尚未放行，镜像状态为 `awaiting_acc07`，不影响已确认的 Core 写入或独立 Learn-X 收尾。

   `confirmAndSyncCodexBatch` 返回后，先运行 `verifyWeeklyMemoryApproval` 并保留其返回值为 `approvalEvidence`；只写入确认批次中的 Memory 项，写后读回形成 `memoryWriteEvidence: { ok: true, status: 'verified', evidence: { batchId, itemIds, targetPath, sha256 } }`。证据只包含目标、条目 ID 与内容哈希，不保存记忆正文。随后调用 `executeConfirmedLearnXCloseout({ batch: confirmed.batch, learnXRoot, stateRoot: <Core 仓库根目录>, approvalEvidence, memoryWriteEvidence, executors })`。执行器映射到本 Skill 已有的备份、YW Next、Flomo 操作，每项使用 `{ execute, resolve }`：`execute(item, batch)` 只运行该条已确认的现有步骤并返回读回证据；`resolve(item, batch, priorState)` 先读目标，已落地则返回 `{ ok: true, status: 'verified', evidence }`，能证明未落地且基线未变才返回 `{ status: 'not-applied', baselineUnchanged: true, evidence }`，冲突返回 `{ status: 'conflict' }`，否则返回 `unknown`。证据只保留目标标识和哈希，不保留内容；不能用命令退出码代替读回。运行器在动作前后把每项结果写入权限为 `0600` 的 `runtime/weekly-review/<覆盖周>/closeout/<batchId>.json`；未知、部分或冲突结果不得盲目重试。缺少 Memory 写入读回证据时不得执行后续收尾。备份与 YW Next 可并行；Flomo 仅在本批次明确认可且备份与 YW Next 均已验证完成后运行。Core 认可回流独立于年度周报和总览写入；Core 暂缓时先完成 Learn-X，之后新增 Core 内容只确认新增部分并形成新批次。

   代码模块不接受 CLI JSON、命令参数或模型推断作为确认凭据。仅 Codex 宿主可接入：在 `functions.exec` 中先用 `mcp__node_repl__js` 读取 `nodeRepl.requestMeta.threadId`，随后调用 `mcp__codex_app__read_thread`（本地宿主使用 `hostId: "local"`），最后把未经改写的工具响应通过 `JSON.stringify` 安全嵌入 `mcp__node_repl__js`，动态导入模块并调用宿主函数。遇到 `page.hasMore` 且尚未包含目标消息 ID 时，按返回的 `page.nextCursor` 继续读旧页；将同一线程页面按新到旧传给 `createCodexHostAdapter`。不得把本机线程 JSONL 当作用户消息凭证。模拟数据只用于测试，不证明真实确认或飞书写入。

   **恢复接入现有触发机会：** Learn-X 05:00、07:00 自动化和用户继续流程开始时，先调用 `recoverCodexConfirmedBatches()` 盘点所有历史批次，包含没有 Core 条目的 Learn-X-only 批次。对 `awaiting-host` 项按 `threadId`、`displayMessageId`、`confirmationMessageId` 从官方 `read_thread` 读取对应消息并支持分页；将页面组成宿主适配器后再次调用 `recoverCodexConfirmedBatches({ host, closeoutExecutors, verifyMemoryApproval })`。`closeoutExecutors` 使用前述同一组 `{ execute, resolve }`；恢复默认只读核验本地 Memory：先验证周报、候选和拟写内容仍匹配不可变审批，再确认已认可条目在对应周 `Memory` 区域唯一存在，最后记录目标文件哈希。目标文件缺失、条目不唯一、源提案变化或存在冲突时保持待处理，不补写。恢复先核对官方确认和已有读回；已完成动作不重复执行，未知动作只有在 `resolve` 证明未落地且基线未变时重试。Core 同步与 Learn-X 收尾独立报告和续接；任一边失败不撤销另一边已验证结果。恢复保留批次原覆盖周和 `confirmedAt`，不可用当前时间重建认可记录。宿主读取、执行器或读回能力缺失时保留待恢复状态，本轮继续可独立完成的 Learn-X 步骤，不伪造成功。

   - 标题 11「全文核心重点纪要」写入当周 Memory；标题 12「芒格之魂的洞察」写入季度芒格洞察候选池，均不要求 checkbox。标题 13 问题、背景和回答只保留在 Weekly Output，不自动迁移。
4. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`，核对 0–3 个“值得长期保留”候选及实际迁移目标后再展示最终确认卡；长期候选为 0 个仍展示完整确认卡，并明确“本轮无 Memory 写入”。最终拟写内容保存为 `memory-proposed.md`，供用户审阅和批准哈希校验；未答问题不额外询问。
5. 只迁移：
   - `memory-candidates.md` 中两个「系统确认」章节；
   - `memory-candidates.md` 中“值得长期保留”章节里已勾选的 checkbox 条目（最多 3 条，0 条合法）；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
6. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
7. 将获准条目写入正确的季度 Memory 目标。「全文核心重点纪要」进入对应周的 `Memory`；「芒格之魂的洞察」进入顶部芒格洞察候选池。问题、背景与回答默认不进入 Memory。新格式 Weekly 不产出道 / 法 / 术批量候选；旧格式候选不得从普通正文或新格式章节推导。
8. 保持幂等。重复运行不得追加完全重复条目。
9. 如果没有任何获准条目，记录“本轮无 Memory 写入”；不要求用户为凑数补充或勾选。问题、背景与回答整体排除，不因回答完整或用户已审核而自动迁移；只有用户在本次流程中明确指定具体问答内容时才可例外。其他合格章节和候选仍按既有确认与写入边界处理。
10. 执行 Learn-X 数据备份。图像文件不进入备份。阶段 3 事务卡已覆盖该目标周的备份写入和留存清理，不再单独请求确认：
   ```bash
   npm run backup:weekly -- --period <period-id>
   ```
   - 备份完整扫描 `01_core/`、`03_input/`、`04_output/`、`05_library/`，不使用 Git 或 `.gitignore` 过滤；排除常见图像文件、`.DS_Store` 和凭据类文件名，并在 manifest 中记录排除路径及原因。
   - 生成 `tar.gz`、`manifest.json`、文件清单 SHA-256 和压缩包 SHA-256，上传到专用飞书云盘文件夹，并将元数据写入专用 Base 的 `Snapshots` 表。
   - 上传后必须用同一 Drive file token 下载到私有临时目录，核对压缩包字节数和 SHA-256，并验证安全归档路径、manifest 哈希、文件数、总字节数及每个文件的 SHA-256；Snapshots 行的已写字段也必须逐字段读回一致。两侧读回都通过后才可将快照视为成功并执行留存清理。
   - 备份只上传不超过 10 MB（10,000,000 字节）的实际压缩包；必须先本地生成并检查大小，再进行任何飞书云盘或 Base 写入。超限即清理临时文件并停止，报告压缩体积和最大文件，不拆包绕过上限。
   - 图片文件始终排除。Flomo 在线全量存储只保留 `storage-mode.json` 指向的活动快照、目录、ledger 及其当前回滚包；旧快照、未激活暂存快照和已替代的迁移备份仅从云端备份排除，保留本地原件，并在 manifest 留下排除记录。在线全量目录存在但状态文件缺失、指针越界、必要目录为符号链接、活动文件未进入清单或回滚包为空时停止备份。拷贝到临时暂存目录后，逐文件重核大小和 SHA-256 与 manifest 一致，再创建压缩包；扫描到暂存期间源文件改变时拒绝上传。
   - Base 写操作使用 `--as user`；写入后必须读回；同一周期按 `Snapshot ID` 幂等更新。
   - 成功后执行留存清理：保留最近 31 天内所有成功快照，并永久保留每个自然年度最后一次成功快照；同一文件同时满足两个条件时只保留一个物理文件。
   - 删除只针对 Base 已登记、窗口外且非年度快照的文件；云盘删除和 Base 清理失败都必须记录告警。
   - 新快照上传和 Base 读回成功后，即使留存清理失败，也保持该快照 `success`；命令以非零状态暴露清理失败，不能把已成功上传的快照改成 `failed`。
   - 备份失败不回滚已写入的 Memory，继续 YW Next 和 Flomo，但最终汇报必须标记 `Overall: partial`，明确列出 `Backup: failed`。
11. Memory 写入成功后，在同一阶段执行 `$ywnext 更新索引 YYYY-Www`；Flomo 必须等待本项全部校验成功：
   - 读取 `01_core/memory/*.memory.md`；Memory 已承接最近四周及长期校准，因此 Weekly Output、Process Pack、`input.json`、周记、日记、阅读、智慧之门、AI Coach 和其他原始周输入不进入 YW Next 语义上下文。
   - 找事配置、常做清单和最近计划只作为运行控制输入，不写入个人核心上下文；不得用它们补充 Memory 缺口。
   - 读取“找事配置” Base 的启用记录，运行 `$ywnext` 的配置校验脚本，将原始快照写入 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.config.json`；脚本不归一化权重、不提炼证据、不生成建议。
   - 由 AI 严格依据 `$ywnext` 的 Markdown 规则阅读 Memory，生成 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.md`（Memory 来源路径、范围、全文阅读状态与缺口）及 `runtime/core-context/full.md`、`weighted.md`、`core.md`（三档独立静态核心上下文）。不生成或读取 `current.md`。
   - 继续生成仅供 YW Next 使用的 `runtime/core-context/full-full.md`：只全文保留 `01_core/memory/*.memory.md`，再由 AI 仅基于该文件生成 `/Users/yuwei/code/skills/ywnext/runtime/candidate-list.md`，做、学、玩、思考各 20 条，含详情、适用条件与候选权重。候选不另存周度快照。
   - 运行 Memory 证据、三档核心上下文、full-full Memory-only 与候选清单校验。YW Next 不生成六仓库切片；其他仓库只按相关性读取通过校验的 `runtime/core-context/full.md`、`weighted.md` 或 `core.md`，不得读取 `full-full.md` 或历史遗留切片目录。配置读取失败时，在证据索引中标注缺口且不生成新的核心上下文或候选清单；不得用旧外部数据伪装为本次更新，也不得阻塞已成功写入的 Memory。
12. Flomo 反向同步已停用。周自动化不得把 `sync:flomo` 作为阶段收尾触发，也不得在 YW Next 后自动写回 `weekly.md` 或季度 Memory；汇报固定写「Flomo 反向同步状态：已停用，未执行」。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、找事索引路径和状态、Flomo 反向同步状态：已停用，未执行、验证结果、当前位置、下一步和下次运行。

## 边界

- 不把本地周输入材料发送到 ChatGPT。ChatGPT Bridge 仅由用户手动操作；自动化不得提交、观察、恢复或重发请求，只提供完整可复制提示词并接收用户带回的结果。用户提供的 AI 文本按人工输入验证范围与结构，不伪造 Bridge 状态。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不自动发布微信公众号。
- 不读取 `coach.md` 中 URL 指向的页面正文，不下载 AI Coach 附件，不把联系方式或访谈原文写入仓库。
- 不自动生成或升级正式 Core `道`、`法` 内容；Flomo 置顶镜像位于 `03_input/_mirrors/flomo-top.md`，只作为输入材料单向同步，不属于 Core Truth。
- 不按关键词迁移未勾选 Memory 候选。
- Action Feedback 已退役（Core V1 接管周度行动复盘）：不读取、不生成、不写入任何 `action-feedback.md` 或 Action Feedback Base 记录；历史文件与 Base 记录保留可读。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标周以外的数据。
- 线上采集阻塞时，不降级使用过期本地文件。
- Flomo 反向同步已停用：周自动化不执行 `sync:flomo`，历史脚本仅作留档；重复或无标签旧 memo 只报告，等待用户单独授权处理。

## 进化收据（方案三 M4）

仅定时触发的阶段 1 运行执行本节；用户交互续跑（阶段 2/3）不写收据。在阶段 1 汇报输出前追加执行；本节任何失败都不阻塞、不改变周链本身的结果，只在汇报末尾标注「进化收据：<状态>」。

1. 写收据（幂等：event_id 固定格式，同日重复触发自动去重；summary 与各字段避免半角单引号 `'`，保证 shell 单引号安全）：

   ```bash
   echo '<TaskStarted JSON>' | /opt/homebrew/bin/node /Users/yuwei/code/group-index/evolution/cli.mjs append
   echo '<ResultRecorded JSON>' | /opt/homebrew/bin/node /Users/yuwei/code/group-index/evolution/cli.mjs append
   ```

   - event_id：`weekly-chain-<YYYYMMDD>-start` 与 `weekly-chain-<YYYYMMDD>-result`（YYYYMMDD＝本次运行日期，Asia/Shanghai）；task_id 统一 `weekly-chain-<YYYYMMDD>`；与周一 05:00 并行运行的 group-index 每日链使用不同 task_id/event_id，追加写入互不干扰。
   - 结果五分：`execution`/`delivery` 按阶段 1 实际结果（全部自动来源完成且草稿生成＝`ok`；部分失败＝`partial`；中断＝`failed`）；`business_result`/`user_judgment`/`later_reality` 固定 `unknown`——真正的业务结果是经人工确认的 Weekly Output，属后续阶段，未知不折算成功。
   - `source_ref.id` 填本轮可读回核查的产物仓库相对路径（如目标周 `ai.generated.md`）；已读回该产物则 `evidence_tier`＝`read-back-verified`，否则 `source-claimed`。
   - summary 一句话概括本轮状态与缺口；不写入周记正文、日记原文或任何个人隐私内容（账本在 group-index 私有仓，但仍按最小化原则）。
2. 对账（只读）：`/opt/homebrew/bin/node /Users/yuwei/code/group-index/evolution/cli.mjs reconcile`；`unendedTasks`/`tornCount`/`duplicates` 非零时列入汇报「本轮需关注」，不自动修复、不虚构收据、不补写历史成功。
3. 边界：账本只追加不改历史；CLI 不可达或失败时如实标注，不在本仓重建账本；本节不读取、不写入 learn-x 之外的任何学习数据。

## 汇报格式

每次运行必须包含：

- 目标周。
- 全局流程，并标记当前阶段。
- 进化收据状态（见「进化收据」节；仅定时运行；交互续跑填「不适用」）。
- 已完成来源或产物。
- 阻塞项和缺口。
- 当前位置。
- 下一步。
- 再下一步。

汇报保持简洁，但不能省略阶段门槛。

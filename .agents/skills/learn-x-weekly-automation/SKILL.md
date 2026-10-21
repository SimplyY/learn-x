---
name: learn-x-weekly-automation
description: Learn-X 每周输入自动采集、Weekly Output 报告准备、已审核 Memory 迁移，以及明确请求的历史日记补全周记与 Flomo 存量同步中文工作流。Use when the user asks for "Learn-X 每周输入自动采集 & 报告 & 记忆", weekly report automation, W27/Wxx weekly processing, historical weekly backfill, generating weekly `_dist` / Process Pack / Output shell, or preparing weekly memory candidates from reviewed Weekly Output.
---

# Learn-X 每周自动化

## 总览

把本 Skill 作为每周固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用已有采集器和 `learn-x-process` 命令。ChatGPT AI 周回顾只通过全局 `chatgpt-web-bridge` 和本 Skill 的窄适配器完成，不使用 API、私有接口或其它浏览器通道。

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
npm run ai:weekly -- --week 2026-W27
npm run ai:weekly -- --week 2026-W27 --confirm-manual --confirm
npm run sync:life-core
npm run process:weekly -- --week 2026-W27
npm run process:weekly -- --week 2026-W27 --prepare
npm run input:weekly-anchor -- --week 2026-W27 --write-date YYYY-MM-DD --target-title "M.D" --target-block-id <block-id> --document-id <document-id>
npm run memory:weekly -- --week 2026-W27
```

明确请求“存量周记补全”“用日记补缺周记”或“历史周记同步 Flomo”时，读取 [references/historical-backfill.md](references/historical-backfill.md)，进入独立的历史回填模式；它不改变下面的正常周流程。

先按“目标周选择”解析出唯一目标周，再只运行当前阶段需要的命令。飞书 CLI 默认读取使用应用身份（`--as bot`）；涉及多维表格 Base 的新增、更新、修改、删除等写操作使用用户身份（`--as user`）。读取失败时不要自动切换身份，写入失败时报告用户授权问题，不把写操作改回 bot。Flomo 只通过 Ego Lite；每周一 00:10 的 Flomo 专项自动化对上一个完整 ISO 周执行全库扫描，失败时在独立进程间最多重试两次，校验通过后激活活动快照，并从同一扫描提取目标周 `flomo.md`。每次尝试都通过本执行器持有同周状态锁和浏览器队列锁，使用新 invocation UUID 与专属 TaskSpace；自动化不会在重试等待期间持有锁。周一 05:00 主流程复用已成功的同周状态，不重复扫描 Flomo；若专项运行未成功，主流程仍按现有来源恢复规则处理。周一 07:00 补救流程继续负责恢复尚未成功且可自动重试的来源。周输入仍按笔记创建时间筛选；旧笔记编辑只更新活动全量快照，不进入本周 `flomo.md`。完整性校验失败时不激活新快照，文件头须记录活动快照 ID 与采集时间。手动运行 `npm run input:flomo -- --week YYYY-Www` 也进入同一个重试执行器和浏览器队列。不得复用来源不明的 TaskSpace，也不得改用 Chrome、CDP 或旧导出。

00:10 自动化 `learn-x-flomo-00-10` 每次只运行一条 Flomo 来源尝试：调用 `npm run weekly:retry -- --week YYYY-Www --mode manual --source flomo --automation-id learn-x-flomo-00-10 --single-attempt --skip-prepare --skip-flomo-review-import --max-duration-ms 1920000`。尝试最多 32 分钟；失败后只对状态中分类为可重试的错误，至少等待 20 分钟，并遵守更长的 `nextRetryAt`；未知或不可重试的失败停止并报告。若执行器返回 `supervisor-already-running`，这不是失败或一次尝试；只读检查同周状态，等待当前执行结束并重新读取状态，不得并行启动同来源采集。整个自动化最多运行 160 分钟且最多启动三次。成功立即停止；登录、权限、验证码、人工接管或明确需人工复核时停止并报告。第三次前只检查脱敏状态和错误信号；仅在 Flomo 专属采集文件干净、根因明确且补丁只需修改一个采集文件时才可自动修复，并运行对应 Flomo 回归测试。不得修改凭据、通用调度器、治理规则或已有未提交文件；修复不清楚、文件不干净或测试失败时，安全撤销本次补丁（仅当文件哈希仍与本次补丁一致），然后在新 TaskSpace 用原代码进行最后一次重试。达到 160 分钟仍未完成时停止，交由 05:00/07:00 现有流程继续处理。

### 飞书 CLI 身份路由

- 读取 Base、表结构、字段、记录及其他飞书资料：默认 `--as bot`。
- 新增、更新、修改、删除 Base 的表、字段、记录、权限或其他资源：使用 `--as user`。
- 不因应用缺少 Base 写权限而反复申请应用权限；应用身份只用于默认读取。

### 周记草稿的持续授权边界

用户已明确授予持续授权：本自动化在阶段 1 可使用用户身份，将目标周输入生成的草稿写入固定文档 `https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac` 的 `周记` 区域，仅限目标周结束日次日对应的新周记段落和模板安全空位。允许复制缺失模板、填写空白字段并保留 `【待优化】AI 基础草稿` 标题标记；`回顾最近笔记 & flomo 洞察` 字段也纳入自动草稿，但只可在新复制模板的空位中原样填入运行日期所在 ISO 周之前最近一个已结束周（Asia/Shanghai，周一至周日）的全部有效 Flomo 笔记。此定义不随手动指定的目标周改变，并在汇报中同时列出目标周和笔记来源周。若来源周就是目标周，复用已验证的目标周 `flomo.md`；否则只读核验来源周目录。仅当来源状态为 `ready`、范围和记录数匹配，且完整扫描或最多 10 条容差缺口都有文件头与侧车证据时才填入全部可见笔记；存在缺口时在笔记前明确说明观察数、预期数和遗漏数，不省略或改写笔记。状态为 `empty`、数量为 0 且扫描无缺口时保留模板提示并报告“0 条笔记”；若 0 条观察结果伴随容差缺口，也保留模板提示并说明“可见 0 条，覆盖不确定”；`failed`、`unavailable`、缺少完整性证据或范围不符时保留模板空位并报告原因。`flomo.md` 沿用现有过滤边界，排除 Learn-X 生成内容。不得按运行时刻滚动取最近 7×24 小时、使用不完整周或旧文件替代。保留模板提示和笔记边界，不总结、筛选、改写或截断。若目标字段已有实质人工内容或草稿，停止并报告，不覆盖。不得修改其他周或其他文档。

周记中的 Flomo 笔记分块排版与逐项回读，按 `.agents/skills/learn-x-weekly-journal/SKILL.md` 执行。`calendar.md` 只用于独立采集状态与阶段 2 Process Pack 的计划上下文；不得读取、传入、引用或交叉核验它来生成周记，日历状态也不影响周记门禁。

该持续授权不涵盖 `weekly.md`、Weekly Output、Memory、备份、Flomo 同步、AI/ChatGPT 外发或任何其他外部写入。目标文档、目标段落、用户身份、写入范围或删除动作发生变化时必须停止并重新确认；在授权范围内无需每周重复询问，但每次写入后仍必须定位核验并回读确认。

### 默认采集范围

阶段 1 默认执行本 Skill 所列的全部自动来源：Flomo（含 Flomo 需回顾增量导入）、微信读书、Time-X 日历、Voice-X、飞书日记与 AI Coach、智慧之门。同时检查独立产物 `build.md`、`build-bot.md`、`health.md`。不得因为历史自动化 prompt、旧运行记忆或上一次的临时选择，缩减本轮来源，也不要逐项询问是否采集。用户明确说“本轮只采集……”时才临时缩小范围，该选择仅对当前目标周、当前运行有效；下一次自动恢复全量。

Action Feedback 已于 2026-10 退役：周度行动 / 反馈复盘由独立仓库 Core V1（`/Users/yuwei/code/core`）接管，Learn-X 不再创建 `action-feedback.md`，`action:feedback` 命令（draft / sync / collect / migrate）已被退役守卫拒绝，不再写入 Action Feedback Base。历史 `action-feedback.md`、Base「Learn-X Action Feedback」与旧 Process Pack 保留可读，但不再回读。阶段 1 同步最新核心议题镜像、采集本周输入并生成周记草稿；`周记已确认` 只确认周记草稿。

日记与 AI Coach 使用独立入口 `input:daily`、`input:coach`，分别记录状态；Coach 0 条只代表成功空结果，不影响 Daily。

同周自动采集统一由 `npm run weekly:retry -- --week YYYY-Www --mode initial` 编排：独立 CLI 最多 3 路并行，浏览器任务单队列，来源侧车通过锁和原子合并写入。不要再从自动化外另起相同周采集器。

### Code X 周日 Voice-X 自动化

Deep Code X 另有一个独立的周日调度（`learn-x-voice-insight`，20:00，Asia/Shanghai），不改写周一 `learn-x-3` 的阶段边界。它按当前 ISO 周执行 `npm run voice:insight -- --week YYYY-Www`：默认只生成预览上下文、状态和新版洞察采集结果，不添加 `--send`，不自动调用 ChatGPT，不覆盖旧 `voice.md`。需要正式批量生成时，必须在人工确认后显式执行 `--send --confirm`；旧格式迁移使用 `--migrate-legacy --confirm`。

## 启动规则

1. 目标周选择：
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

- 定时触发，或用户没有明确继续指令：执行阶段 1；自动化执行器负责自动来源与 AI 周回顾，随后生成飞书周记草稿，不等待用户确认才启动 AI 生成。
- `继续` 按当前流程位置解释：阶段 1 草稿标题仍有 `【待优化】` 标记时，不视为确认；用户已移除该标记并明确说“继续”时，视为本轮周记已确认，直接进入阶段 2，不要求重复口令。阶段 2 后，以当前流程收到并定稿的 Chat Pack Weekly Output 内容作为交接；保存、读回并验证通过后，直接进入阶段 3，在同一轮回复展示完整确认卡，不要求另发“已完成”或“继续”。不要把同一短指令按固定全局含义解释。
- 阶段 1 的 `ai:weekly` 由重试执行器按 AI 不确定提交规则运行；完成后调用 `learn-x-weekly-journal`，不能再单独启动第二次。AI 生成通过结构校验后默认自动从 `ai.generated.md` 正式化为 `ai.md`，汇报中提示用户复核，但不把 AI 确认设为额外硬门槛。不采集 `weekly.md`，不生成正式 `input.json`、`process-pack.md` 或 Weekly Output 壳，也不生成 `action-feedback.md`（已退役）。如果 AI 生成失败，仍继续生成不含 AI 补充的飞书草稿；当没有可恢复的稳定 Bridge runId 时，可安全创建可粘贴的手动空壳；存在可恢复 runId 时保留 `ai.md` 路径为空，避免后续结果晋升覆盖人工编辑。任何手动壳都不能作为 AI 成功证据。此时汇报必须把侧车中的完整 `manualPrompt` 原样、无省略地显示在用户回复的可复制代码块中；只给路径、链接或摘要不算提供。侧车缺少提示词时，按当前模板和目标周确定性重建后显示；无法重建或校验时，明确报告阻塞，不得编造或省略提示词。
- 每次新提交前，`_ai-generated.json` 先持久化 UUID `runId`，并通过 Bridge CLI `--run-id` 贯穿到真实 Bridge run 和回执；调用进程超时或中断后先观察这个预分配 ID。已存在 `ai.generated.md` 时不得重复发送。旧记录没有稳定 runId 时保持 `needs_review`，不得猜测归属。观察只核验原 run、调用者、会话地址和回复标记，不提交新 Prompt。周记 AI 首次实际派发满 20 分钟后，只有原 run 仍不可恢复、目标周和提示词指纹一致、没有可用结果或实质 `ai.md`、没有历史重开且共享锁与原子额度预留成功时，supervisor 才能自动开一次新任务；replacement 再观察 20 分钟，仍无可用结果就交付完整人工提示词，永不第三次派发。登录、验证码、限流、权限或身份未知时停止。其他业务保持提交不确定时不自动重发。原 run 与新 run 的关联写入 `resubmissionOf`，不改写旧 run 证据。
- 若返回 `ego-bootstrap-permission`，说明当前沙箱不能让 Node 子进程连接 Ego Lite；请求 Full Access 后，仅使用 `npm run ai:weekly -- --week YYYY-Www --retry` 重试这次未提交调用，禁止切换到 Chrome、CDP 或其它浏览器。已提交后的超时、归属不确定或输出不完整不得用 `--retry` 重发。
- AI 生成通过校验后自动执行等价于 `npm run ai:weekly -- --week YYYY-Www --promote --confirm` 的正式化；仅当正式 `ai.md` 路径不存在时，才用不覆盖式原子创建晋升。若该路径在检查后被人工创建，AI 草稿保留为 `ai.generated.md` 并转 `needs_review`；已有内容不会被重命名、覆盖或清理。存在稳定可恢复 runId 的失败不预先创建正式空壳，以免阻挡安全恢复。`AI 周回顾已确认` 仍可作为人工复核口令，但不再阻塞流程；`--promote --confirm` 主要保留给旧的待处理草稿或恢复场景。
- 用户说 `周记已确认`、`继续生成周报材料` 或同义表达：表示飞书周记草稿已审核通过；对同一目标周进入阶段 2，采集已确认的 `weekly.md`，仅发布其中唯一的“新周计划”表格行，再生成 `_dist`。
- 阶段 2 后，Chat Pack 最终内容在当前流程中定稿并保存后，以这份真实内容作为阶段交接：立即读回 Weekly Output，验证目标周、必需正文和占位项；通过后在同一轮进入阶段 3并直接交付完整确认卡，不等额外“已完成”“继续”或“给我确认卡”消息。若 Chat Pack 在另一界面完成人工操作，只有最终内容被带回当前线程且保存/读回校验通过后才续跑；不监控其他会话或文件变化。问题与回答保留在 Weekly Output，默认不进入 Memory 候选。
- 阶段 1 的 `继续` 不得跳到阶段 3；阶段 3 只按当前流程位置解析别名。
- 不猜测人工项已经完成：必须有当前流程中的 Chat Pack 定稿内容，并通过保存、读回和正文校验；文件存在或修改时间变化本身不算审核证据。门槛满足后直接自动进入下一阶段，不再等待状态确认消息。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标周；不要在后续阶段重新按当天日期推断。

### 最少交互约定

正常流程只在三处等待用户：审核周记、完成并定稿 Chat Pack 人工内容、确认展示了真实拟写内容的最终卡。Chat Pack 定稿内容本身是交接依据；同一流程一旦保存并读回校验通过，就在该轮自动完成阶段 3 候选准备并展示最终确认卡，不再等待单独的完成/继续消息。每条用户推进指令或定稿内容都应在同一轮完成该阶段全部可做工作，并直接停在下一个真实门槛；禁止只回复“已进入下一阶段 / 正在准备”，再要求用户重复“继续”。

- `周记已确认` 后，一轮内完成阶段 2 的采回、校验、Process Pack、范围预览和汇报；随后用户完成 Chat Pack 人工工作，并将定稿内容交付当前流程。定稿内容就是交接材料，不另发状态消息。
- 当前流程拿到 Chat Pack 定稿后，读回并通过目标周、完整性与占位文本校验，即在同一轮完成 Memory 候选准备、拟写内容和指纹绑定，并展示完整确认卡；不要求用户再说“继续”“已完成”或“给确认卡”。
- 用户确认最终卡后，一轮内完成卡内所有已授权动作及读回，最后集中汇报；不得在备份、图片、YW Next 或 Flomo 等子步骤之间再要“继续”。遇到硬门槛缺证或远端写入结果不明时，只暂停受影响路径，明确列出证据和恢复动作。

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

日记草稿门槛：日记状态 `ready`、至少一条有效记录且目标周匹配时，立即调用 `learn-x-weekly-journal` 生成并回读草稿，不等待其他来源、语义候选或冷却结束。启动执行器后，用同一进程会话运行；并行只读轮询目标周状态文件。执行器按来源原子保存状态，所以日记就绪后可在执行器仍运行时写草稿；不要启动第二份相同采集器。07:00 补查只为仍缺失的产物恢复或补生成，不重复已有草稿。日记无效或缺失时不写周记，07:00 恢复结束后再核验一次。其他来源缺口在周记草稿和汇报中醒目列出。

Health-X 本地报告独立于 Base 同步。智慧之门 Base 采集独立于 Flomo，Flomo 仅作为可选的回顾导入增强。Build 与 Build-Bot 只对账其实际目标周文件，不启动它们的生产流程；飞书机器人 Build 不调用 `build-bot-log`。

Codex Build 原线程恢复：Build 自动化启动时，用当前自动化线程的真实 `threadId`、`hostId`、自动化 ID 和目标周调用 `npm run weekly:build-recovery -- --week YYYY-Www --record-start --thread-id <id> --host-id <id> --automation-id learn-x-codex-build`，先保存一次性绑定收据。无法取得真实线程或宿主身份时，只生成本线程结果，不尝试续跑其他任务。仅观测到明确额度耗尽时调用 `--mark-quota-limited --reason quota-exhausted`（或已核实的 `rate-limit-window`），不把网络、登录或普通失败标成额度问题。

确认额度耗尽后最多观察 12 分钟：用 Codex 用量工具核验额度，用任务工具查询收据所绑定的同一线程。线程仍在运行时只等待；线程已停止但仍限流时不发消息。额度恢复且同一线程处于 `idle`、`failed` 或 `needs_attention` 时，先运行 `--claim-resume --task-status <状态> --quota-available` 原子预占唯一机会，再把命令返回的 `followUpPrompt` 发给该收据指定的原线程；不得创建新线程或替换目标。发送已接受后运行 `--mark-resume-submitted --claim-id <claimId>`。发送结果不明时保留已预占状态，绝不再次发送。最后运行 `--verify-artifact`；只有 `build.md` 的覆盖周与目标 ISO 周匹配才记为完成。错周、缺失、不可读或身份不匹配都保持待核验，不改标签、不认领为目标周。

- 飞书身份闸门：周记草稿写入前用 `lark-cli auth status --json --verify` 核验登录态。任何身份核验失败、写入身份不符或目标段落无法回读时，周记写入失败关闭，不猜测、不回退 user。
   - ChatGPT Bridge 提交状态不明时先观察绑定的原 run；单次观察最长 12 分钟，受当前 100 分钟共同截止时间约束。仅周记 AI 可在原始派发后满 20 分钟仍无可用结果时自动重开一次：原子预留前必须确认提交状态、run/session 身份、目标周、prompt 指纹和允许的未决原因，且没有生成/无效草稿或实质人工 `ai.md`。若首次 Bridge 在 20 分钟前返回，本次 supervisor 仅在剩余预算覆盖等待至门限、边界复看原 run、第二次 Bridge 4 分钟预算、replacement 自己派发后 20 分钟的边界观察及收尾余量时等待一次；两个窗口都只做一次定时等待，不轮询。等待期间释放共享周记状态锁与 Browser 队列锁，保留周记 AI 锁；结束后有界重取状态锁并读取并发入口的最新周状态。replacement 等待被进程中断后按持久侧车恢复同一 run，不能再次提交。到门限后重新观察原 run，并重读侧车、正式文件和可用结果，再由既有原子额度门禁最多派发一个 replacement。登录、验证码、限流、权限、身份不明、人工内容、提示词变化、结果已存在、预算不足或额度已用时停止重开并返回完整手动提示词；提交预留后的普通重跑不能发第三次。其他业务的提交不确定仍只观察，不自动重发。用户显式确认的人工恢复入口继续执行独立的身份、范围和一次性校验。
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
3. 读取执行器写入的 AI 结果与状态。`ai.generated.md` 经完整性校验后可正式化为 `ai.md`，供周记和 Process 使用；失败、超时或提交状态不明时保留 `needs_review`，先观察原 run。周记 AI 可按上方规则在 20 分钟后自动重开一次，replacement 仍无结果时交付人工兜底；其他业务提交状态不明时不自动再次发送。未提交的明确运行环境错误仍可按本 Skill 的单次安全恢复规则重跑。Flomo 笔记回顾字段由 `learn-x-weekly-journal` 按持续授权自动填入，不交给 ChatGPT 总结或代写。
4. 每个来源成功后由重试执行器立即触发 `npm run process:weekly -- --week YYYY-Www --prepare`，逐来源复用确定性预处理并更新私有缓存；不等待其他来源或周记确认。对缓存提出的语义压缩请求由 Codex 完成后再运行准备命令确认版本；不压缩周记，不生成正式 `input.json`、`process-pack.md`、Weekly Output 或 Memory。阶段 1 不采集线上确认版 `weekly.md`。
5. 执行器的 ChatGPT 输入只读取 `03_input/weekly/00_template/ai.md` 提示词并附加目标周范围；不发送本地周材料。失败时汇报原因、`ai.md` 手动空壳路径和完整人工 fallback prompt；成功结果先落为 `ai.generated.md`，完整性校验通过后正式化为 `ai.md` 并保留审计副本；标记为 `confirmed` 后还要读回正式文件并校验结构与哈希，才能计为业务成功。回复未通过结构验收时写入 `_ai-invalid.generated.md` 和验证原因；代码可确定性恢复时优先本地恢复，不重复外发；显式 `--retry` 不得绕过周记 AI 的一次重开额度。

阶段 1 汇报先给出“本轮状态”和“本轮需关注”，随后按 `weekly-source-config.mjs` 的组内顺序展示「重要来源」和「可选来源」两张表；两张表共用顶部关注摘要，不要求用户自行拼接失败项。已确认的 `weekly.md` 单独列为阶段前提，不混入自动来源排序。Action Feedback 已退役，输入表中不再有独立产物行。状态列靠前，表列固定为：优先级、状态、输入类型、来源、文件（可点击核查）、记录/材料数、字符链路（原始 → 本阶段最终纳入）、结果；状态使用中文；成功为 `✅ 成功`，空结果为 `⚪ 成功（0 条）`，失败必须显示为 `🔴 **失败**`，不可用为 `🟠 不可用`，待人工确认用 `🟠 待人工确认`。只有实际发生语义压缩时才在字符链路后标注压缩信息。对本轮 `ready` 且实际纳入的输入，必须使用项目统一的 `countInputChars`（Unicode 码点数）报告文件字符数；若采集器没有记录来源端原始字符数，链路写 `— → N`，不得把整格写成 `—`，也不得猜测原始数。阶段 2 直接复用 `process-pack.md` 第 2 节的两张分组表，并保留处理链路的各阶段计数。`weekly.md` 是人工确认的阶段前提；`ai.md` 是可选补充，必须严格验证目标周和结构后才可纳入。
来源状态在机器侧继续使用 `ready`、`empty`、`failed`、`unavailable`；展示时翻译成中文并明确旧文件是否保留但不计入本轮。成功空结果单独报告“0 条记录，文件未生成”，失败/不可用不得写成 0 条。只有 `ready` 且本轮实际纳入的文件才报告字符数；失败、不可用、空结果和过期旧文件的字符列填 `—`，处理结果列必须直接写出原因。人生核心议题镜像必须在汇报中单独给出 `fresh/stale` 状态、revision 与同步时间；`stale` 时列为“本轮需关注”。
每个非空来源还必须给出可点击核查文件链接；不可用但保留旧文件的来源也要给链接并标注“过期、不计入”。
飞书周记草稿链接必须是周记 Skill 在写入后回读确认的目标段落锚点链接。先从同一次 `lark-cli docs +fetch --detail with-ids` 结果取得底层 `document_id`，并用写入后回读确认的最新目标标题 block ID 构造 `https://ywhome.feishu.cn/docx/<document_id>#<target-block-id>`；若 CLI 返回目标标题对应的实际 `#share-...` fragment，则保留该 fragment，但链接底路径仍使用 `/docx/<document_id>`。不得把 Wiki 节点 token (`/wiki/<node-token>`) 与 block ID 拼接：Ego Lite 实测该路径不跳转，而 `/docx/<document_id>#<block-id>` 会跳到目标段落。不得汇报固定文档首页、旧周锚点或未带 fragment 的 URL。

## 阶段 1 内：周记草稿生成与人工确认

目标：从已落盘周输入生成飞书周记草稿，停在人工确认门槛前。

1. 验证 `daily.md` 与 Flomo 状态；`daily` 必须为 `ready`、目标周匹配且文件有效。Flomo 可为 `ready` 且文件、计数及实际覆盖范围与采集状态一致，允许全库最多 10 条已明确标注的缺口；或为 `empty` 且计数为 0、成功扫描范围与目标周允许范围一致。存在缺口且目标周可见 0 条时，保留模板提示并说明覆盖不确定。不得读取状态为 `empty/failed/unavailable` 时仍留在磁盘上的旧 `flomo.md`。`daily` 未通过时停止周记写入；Flomo 缺失、失败或范围证据不足时，只保留该字段空位并醒目标记。优先读取已确认的 `ai.md`，否则仅在生成侧车为 `generated` 时读取 `ai.generated.md` 作为未确认草稿；AI 文件无效、空壳或缺失不阻塞周记草稿。
   - 不读取或提供 `calendar.md` 给周记生成步骤；日历来源状态不影响周记生成。其余字段继续按 `learn-x-weekly-journal` 的来源门禁处理。
2. 对“回顾最近笔记 & flomo 洞察”，计算运行日期所在 ISO 周的上一周。先读取该周 `_source-status.json`；只有状态为 `ready` 时才打开并校验 `flomo.md`。若来源周等于目标周，复用步骤 1 已验证的状态；若不同，只读来源周目录。`ready` 且文件头含完整目标范围、采集时间、记录数、早于周一下界的最早读取时间和 `下界已覆盖：是`，并与侧车周/计数一致时填入全部笔记；`empty` 且侧车计数为 0、`summary` 含完整扫描起止时间、`下界已覆盖：是` 及“0 条、确认无匹配”时只保留模板提示并报告“0 条笔记”，绝不打开可能残留的 `flomo.md`；其他状态或完整性无法确认时同样不打开该文件，保留模板空位并报告原因。随后调用 `learn-x-weekly-journal`：它按目标周结束日的下一天定位周记标题，复制模板并填新模板的安全空位；其他字段仍只使用本次目标周输入。已有实质内容或草稿时跳过，不覆盖、不刷新。
   - Flomo 全部笔记按 `.agents/skills/learn-x-weekly-journal/SKILL.md` 独立分块呈现，不合并成段或省略。周记各字段只使用该 Skill 允许的非日历来源；不读取或交叉核验日历。
3. 周记草稿生成后停止并让用户审核 / 修改。`周记已确认` 表示周记草稿已审核通过（Action Feedback 已退役，不再有配套草稿需要共同确认）。
4. 用户确认后，回复 `周记已确认`、`继续生成周报材料`，或在已移除草稿标记后明确回复 `继续`，即可进入阶段 2。

本阶段汇报必须包含上述两张分组表和周记阶段前提、目标周、使用的本地来源、飞书草稿链接、跳过字段、阻塞项、当前位置、下一步（审核 / 修改周记草稿）和再下一步（阶段 2 采集已确认的 `weekly.md`，一次生成 Process Pack）。

## 阶段 2：周记采集与报告准备

目标：采集已人工确认的周记，验证必要输入，然后生成 `_dist` 和 Output 最小壳。

1. 按“周记日期映射”计算写作日。阶段 1 生成并回读周记草稿后，已保存该目标周的标题、底层 `document_id` 和目标 block 锚点。用户回复 `周记已确认`、`继续生成周报材料`，或在已移除草稿标记后明确回复 `继续`，即可执行 `npm run input:weekly -- --week YYYY-Www`，窄范围采回锚定段落，不搜索或读取相邻周兜底。采回只验证线上标题与草稿标记；仍含 `【待优化】AI 基础草稿` 时停止。周记生成时排除 Calendar 是生成规则；不得追溯拦截已由用户确认的既有周记，也不得仅因旧草稿含 Calendar 内容要求重写。成功采回后，该命令校验本地 `weekly.md` 并仅发布唯一“新周计划”表格行到 `04_output/_dist/shared-context/weekly/`；不发布其他周记内容或 AI 输出。`weekly.md` 保留来源 URL、revision（缺失时为 unknown）、写作日标题、覆盖范围、定位依据和采集时间，原文不压缩。共享版本不记录猜测的确认时间；采集时间不能替代确认时间。记录 `weekly_journal_fetch` 阶段耗时。
   - 采集前如果发现缺少飞书周记所需授权，先一次性列出并请求全部缺失 scopes，再继续，不要一项一项分开打断用户。
2. Process Pack 组装时按目标周计算上一 ISO 周，只读取上一周完整的 `04_output/weekly/YYYY-WW.md`，并将它作为“仅作对照”材料完整嵌入第 9 节；不读取旧周记替代旧 Output。旧 Output 不能作为本周事实，本周事实以当前 Process Pack 的本周材料为准。基线缺失、为空或只是自动 Output 空壳时，保留第 9 节并标注 `missing`、`empty` 或 `shell`，明确不可比较；不得回退到更早周。
   - 阶段 2 汇报只报告上一周 Output 的周期、状态和绝对可点击文件链接，不复述旧 Output 正文或旧问答。
3. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `jingdu.md`（仅状态 ready 时读取；内容为用户对本周重要划线的精读加工——原始划线来源 + 本人理解/判断/可选行动；本周未做精读时文件缺失或 empty 不阻塞，汇报提示缺口；超过 15,000 字符时由准备缓存生成语义候选，否则明确排除并说明原因）
   - `voice.md`（仅在状态为 `ready` 时读取；含目标周新版 AI 洞察的完整结构化内容，不含原始文字稿；30,000 字符为提示线，阶段 1 预处理缓存完成压缩）
   - `calendar.md`（仅在状态为 `ready` 时读取；只作计划上下文，`empty/unavailable` 时报告但不将其当作行动证据）
   - `coach.md`（本次采集有新增记录时才存在；包含新增记录并标注采集器排除的回顾更新；0 条时按来源状态记录，不阻塞）
   - `wisdom.md`（本次采集有新增记录时才存在；普通记录按 Base 创建时间、Flomo 导入记录按原始 Flomo 创建时间归周；0 条时按来源状态记录，不阻塞）
   - `health.md`（可选；缺失不阻断，但汇报必须先用一级大标题显著提示，并附 Health-X 生成命令）
   - `build-bot.md`（只验证是否已由飞书侧完成；不存在时报告缺口，但本流程不生成）
   - `weekly.md`
   - `ai.md`（可选补充；只有目标周标记、结构和运行状态均通过校验时才纳入，不得把空壳、模板或提示词当作内容）
   - 若 AI 失败后用户把完整回顾手动粘贴到目标周 `ai.md`，且用户明确表示已完成或确认，执行 `npm run ai:weekly -- --week YYYY-Www --confirm-manual --confirm`。该命令校验目标周、正文结构和当前失败侧车，并以 SHA-256 记录人工完成，不改写 `ai.md`。随后先运行 `npm run process:weekly -- --week YYYY-Www --prepare` 刷新快照，再生成 Process Pack；文件存在本身不代表已确认，正文哈希变化时必须重新确认。
   对周六、周日提前写当周的场景，允许自动来源是截至运行时的部分覆盖，但 `weekly.md` 必须是目标周真实回顾内容。AI 回顾缺失不阻塞阶段 1 草稿，也不阻断阶段 2 Process Pack；缺失或无效时在状态表醒目标记并排除。
6. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。`build-bot.md` 属于飞书机器人侧流程；本流程只提示自查，不调用 `build-bot-log`。
7. 在采回后核验必需来源状态和预处理清单，再运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

   正常路径只读取预处理缓存并做轻量组装，不重新采集或调用语义压缩。日记和确认周记仍是硬门槛；其他来源验证失败或缓存缺失时排除对应材料、生成有缺口 Pack 并醒目标注，不等待不相关来源。周记始终完整保留，不受 15,000 字符阈值影响。记录 `process_pack` 阶段耗时。

8. 回读 Process Pack 第 9 节，确认上一周 Output 基线状态、完整正文（若 ready）和“仅作对照”边界正确。标准流程不得在 Pack 生成后再补填输入。

9. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 对自动空壳 Weekly Output，除可点击文件链接外，还要在阶段 2 回复中用代码块原样展示文件全文，让用户直接拿到空壳；若文件已有实质正文，只报告链接与状态，不把它称为空壳或重复全文。
   - `04_output/_dist/shared-context/weekly/current.json` 与对应不可变版本；说明 planWeek、sourceWeek、coverage，以及来源 URL/revision 缺失时的标记
   - 已完成来源、缺口、验证结果
   - Process Pack 成功生成后，在同一条阶段 2 消息中同时交付 Pack 与“执行授权范围预览”，让用户第三步可直接复制复核：列出 Memory 写入目标、核心图片路径、备份范围与目的地、YW Next 刷新、Flomo 同步对象与目的地、留存清理和读回校验。它只展示固定执行范围与目标，不展示尚未生成的记忆内容，也不构成授权；阶段 2 不执行任何收尾写入。记录 `authorization_card` 阶段耗时。
10. 等待 Chat Pack 的真实人工定稿内容，不要求用户另发完成/继续状态消息：在 Chat Pack 中选择 Weekly Output，由生成入口实时读取飞书最新 `chatpack.weekly-output` 并注入本次内容；基于已共同审核的 `process-pack.md` 生成并审核周度记忆（保留具体经历、重要输入、思考、状态与变化；增加不超过 600 字的本周与上周对照）。在同一次操作中启用 `芒格之魂` 生成独立洞察，补充 `芒格之魂的洞察 & 全文核心重点纪要`，并由 AI 提出恰好 3 个问题供用户回答；未回答问题不迁移。审核 0–3 个“值得长期保留”候选，0 个合法。必要时读取 `layer-rules.md`。若从 Chat Pack 外生成，先运行 `node /Users/yuwei/code/skills/prompt-governance/scripts/fetch-prompt.mjs chatpack.weekly-output` 并遵循返回的 `content`；读取失败即停止，不用本地副本，除非用户明确授权本次降级。图片不再是阶段 3 的人工前置步骤；不要在此阶段自动生成图片或发布公众号。Chat Pack 在当前流程内定稿后，立即保存并读回 `04_output/weekly/YYYY-WW.md`，验证文件目标周、必需内容（「全文核心重点纪要」「芒格之魂的洞察」）及完整性，不得包含未替换占位文本。若内容由用户在另一界面制作，需把定稿内容带回当前流程；内容交付本身作为交接，不追问状态或口令。有效内容通过后，当前回复立即继续阶段 3 并展示最终确认卡。当前流程无法读取到最终内容、目标周不符、必需内容缺失或占位文本未清理时，报告具体问题并停在阶段 2；不生成确认卡，不以文件存在或 mtime 变化推断人工审核完成。不得把文件监听或独立会话视为本阶段的触发器。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 在 Chat Pack 生成并审核最终 Weekly Output、芒格之魂、核心纪要、问题与回答和 Memory 候选；再下一步 = Chat Pack 定稿内容保存并读回有效后，当前流程自动生成并校验 `memory-candidates.md`，展示真实拟迁移内容并与第二步已预览的执行范围合并为一张最终确认卡；无需额外完成/继续消息。若用户在另一界面制作，需把真实定稿内容交付当前流程，不能以文件监听替代内容交接。第二步预览必须一次列明本周 Memory 写入目标、自动生成图片路径（`04_output/_dist/weekly/YYYY-Www/weekly-core.png`）、备份载荷（`01_core/`、`03_input/`、`04_output/`、`05_library/`，不含图像文件）及 Learn-X 专用飞书云盘 / `Snapshots` 目的地、YW Next 刷新范围、Flomo 载荷（`weekly.md` 与季度 Memory）及目的地、留存清理和读回校验；不得包含尚未生成的记忆内容，也不构成授权。最终卡再列出实际拟迁移条目、排除项、目的地和同一组收尾动作，用户一次确认后执行。不得把图片、备份、YW Next 或 Flomo 再拆成多个确认点；图片生成和其他写入都必须等阶段 3 这一次确认。确认卡缺少图片路径、备份目的地或 Flomo 目的地时，不得请求确认或执行任何写入。
阶段 2 的人工复核仍包含 Weekly Output 中的问题与回答；它们只保留在 Weekly Output，不生成 Memory 候选。

阶段 2 汇报直接复用 `process-pack.md` 第 2 节的「重要来源」和「可选来源」两张表：按来源配置顺序，已确认周记作为阶段前提单列。其余输入逐行保留 Process Pack 中的状态、文件原始 → 解析清洗后有效（去重前）→ Process Pack 最终纳入字符链路和结果；链路最后一个数字必须是本阶段最终纳入数。只有 Voice-X 等实际发生语义压缩的来源才显示压缩比例，文件名本身就是可点击核查入口。不能只报告来源数量和产物路径。失败或不可用行必须在相应分组表内可见，不得只藏在末尾缺口列表。
若 `health.md` 缺失，阶段 1 / 阶段 2 汇报的第一段必须是一级大标题 `# ⚠️ 缺失输入：health.md`，并同时给出目标周、报告结束日和 Health-X 的 `validate` / `sync` 命令；不能把缺失藏在普通缺口列表中。

## 阶段 3：已审核记忆

目标：先准备已确认的 Memory 候选和最终确认卡；用户确认后，按依赖顺序写入 Memory、生成周度核心图片、备份并刷新下一周“找事”离线索引。

1. 当前流程收到 Chat Pack 定稿内容后，立即读回 `04_output/weekly/YYYY-WW.md`；验证文件目标周与本轮一致、Weekly Output 是实质性周报而非空壳/模板、必需章节完整且实质正文有效、必需段落无占位文本。任一检查失败都报告具体缺项并停在阶段 2，不生成确认卡。文件存在或 mtime 变化不算人工审核证据。
3. 上述读回和内容校验成功后，自动进入阶段 3；Chat Pack 定稿内容本身是交接依据，无需用户另发 `Chat Pack 已完成`、`继续` 或 `给我完整确认卡`。这只表示当前 Weekly Output 已完成并经过人工审核，不等于授权执行批量写入。先运行 `npm run memory:weekly -- --week YYYY-Www` 生成或刷新候选，再读取候选和规则，逐条展示真实拟迁移内容、排除项和目的地。问题、背景与回答保留在 Weekly Output，默认整体排除，不进入候选或 Memory。将准确的拟写入条目及目的地写入该周 `_dist/weekly/YYYY-Www/memory-proposed.md`，然后运行 `npm run memory:weekly -- --week YYYY-Www --bind-approval`；把实际条目与第二步的范围预览合成“最后确认卡”。此时不写正式 Memory、备份、YW Next 或 Flomo，也不生成图片。最终卡与第二步预览的固定执行范围一致时，用户一次确认后，先运行 `npm run memory:weekly -- --week YYYY-Www --verify-approval --fingerprint <本卡对应的指纹>`，通过后才执行卡内写入；若周报、候选、拟写条目或季度 Memory 目标在卡片确认前发生变化，旧指纹立即失效；重新读回并生成卡片、取得新确认。确认词只需指向这张最终确认卡及其指纹，例如：`确认执行 YYYY-Www 最终确认卡（指纹：<卡片指纹>）`；该确认覆盖卡片列出的全部实际条目、固定范围和目的地。 此后不得按图片、备份、Full Access、YW Next、Flomo 分别再次请求确认；同一目标周、同一事务范围内因网络、Ego Lite、读回或工具环境失败而进行的安全重试沿用这次授权。只有新增目标、扩大数据范围、改变写入对象或新增删除动作时才重新确认。确认前不访问、验证或发布公众号；公众号发布始终由用户人工完成。若当前并非阶段 2 完成状态，`继续`按前序阶段规则解释，不得直接进入这里。
   - 标题 11「全文核心重点纪要」写入当周 Memory；标题 12「芒格之魂的洞察」写入季度芒格洞察候选池，均不要求 checkbox。标题 13 问题、背景和回答只保留在 Weekly Output，不自动迁移。
4. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`，核对 0–3 个“值得长期保留”候选、实际迁移目标和图片目标路径后再展示最终确认卡；长期候选为 0 个仍展示完整确认卡，并明确“本轮无 Memory 写入”。最终拟写内容保存为 `memory-proposed.md`，供用户审阅和批准哈希校验；未答问题不额外询问。
5. 只迁移：
   - `memory-candidates.md` 中两个「系统确认」章节；
   - `memory-candidates.md` 中“值得长期保留”章节里已勾选的 checkbox 条目（最多 3 条，0 条合法）；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
6. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
7. 将获准条目写入正确的季度 Memory 目标。「全文核心重点纪要」进入对应周的 `Memory`；「芒格之魂的洞察」进入顶部芒格洞察候选池。问题、背景与回答默认不进入 Memory。新格式 Weekly 不产出道 / 法 / 术批量候选；旧格式候选不得从普通正文或新格式章节推导。
8. 保持幂等。重复运行不得追加完全重复条目。
9. Memory 迁移完成后，立即启动图片生成和 YW Next 刷新；二者可以并行。图片运行命令为：

   ```bash
   npm run image:weekly -- --week YYYY-Www
   ```

   参考 Read-X / Voice-X 的核心内容图流程，通过 ChatGPT Bridge 的 image 模式，把当前周报底部的“全文核心重点纪要”和“芒格之魂的洞察”原文生成为一张竖屏 PNG，写入 `04_output/_dist/weekly/YYYY-Www/weekly-core.png`。脚本只暂存 Bridge 返回的图片字节，不本机绘制，不使用 `imagegen` 另造视觉流程，不得改写核心内容，不得上传或发布公众号。
   - 目标文件已存在且大小大于 0 时视为 `already-success`，脚本直接跳过，不得覆盖；用户明确要求重新生成时先移走旧文件或使用同周版本化文件名。
   - 脚本校验 Bridge 的 `succeeded` 状态和 base64 图片载荷后原子落盘，并把结果 JSON 原样纳入汇报。失败不回滚已写入的 Memory，继续执行其他已获确认的独立动作，但最终汇报必须标记 `Overall: partial` 和 `Image: failed`；`needs_review` 表示可能已提交但未确认，不得自动重发。
10. 如果没有任何获准条目，记录“本轮无 Memory 写入”；不要求用户为凑数补充或勾选。问题、背景与回答整体排除，不因回答完整或用户已审核而自动迁移；只有用户在本次流程中明确指定具体问答内容时才可例外。其他合格章节和候选仍按既有确认与写入边界处理。
11. 执行 Learn-X 数据备份。图像文件不进入备份，因此备份不等待图片生成，可与图片生成及 YW Next 刷新并行启动。阶段 3 事务卡已覆盖该目标周的备份写入和留存清理，不再单独请求确认：
   ```bash
   npm run backup:weekly -- --week YYYY-Www
   ```
   - 备份完整扫描 `01_core/`、`03_input/`、`04_output/`、`05_library/`，不使用 Git 或 `.gitignore` 过滤；排除常见图像文件、`.DS_Store` 和凭据类文件名，并在 manifest 中记录排除路径及原因。
   - 生成 `tar.gz`、`manifest.json`、文件清单 SHA-256 和压缩包 SHA-256，上传到专用飞书云盘文件夹，并将元数据写入专用 Base 的 `Snapshots` 表。
   - Base 写操作使用 `--as user`；写入后必须读回；同一周按 `Snapshot ID` 幂等更新。
   - 成功后执行留存清理：保留最近 31 天内所有成功快照，并永久保留每个自然年度最后一次成功快照；同一文件同时满足两个条件时只保留一个物理文件。
   - 删除只针对 Base 已登记、窗口外且非年度快照的文件；云盘删除和 Base 清理失败都必须记录告警。
   - 新快照上传和 Base 读回成功后，即使留存清理失败，也保持该快照 `success`；命令以非零状态暴露清理失败，不能把已成功上传的快照改成 `failed`。
   - 备份失败不回滚已写入的 Memory，继续 YW Next 和 Flomo，但最终汇报必须标记 `Overall: partial`，明确列出 `Backup: failed`。
12. Memory 写入成功后，在同一阶段执行 `$ywnext 更新索引 YYYY-Www`；它与图片步骤并行，Flomo 必须等待本项全部校验成功：
   - 读取 `01_core/memory/*.memory.md`；Memory 已承接最近四周及长期校准，因此 Weekly Output、Process Pack、`input.json`、周记、日记、阅读、智慧之门、AI Coach 和其他原始周输入不进入 YW Next 语义上下文。
   - 找事配置、常做清单和最近计划只作为运行控制输入，不写入个人核心上下文；不得用它们补充 Memory 缺口。
   - 读取“找事配置” Base 的启用记录，运行 `$ywnext` 的配置校验脚本，将原始快照写入 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.config.json`；脚本不归一化权重、不提炼证据、不生成建议。
   - 由 AI 严格依据 `$ywnext` 的 Markdown 规则阅读 Memory，生成 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.md`（Memory 来源路径、范围、全文阅读状态与缺口）及 `runtime/core-context/full.md`、`weighted.md`、`core.md`（三档独立静态核心上下文）。不生成或读取 `current.md`。
   - 继续生成仅供 YW Next 使用的 `runtime/core-context/full-full.md`：只全文保留 `01_core/memory/*.memory.md`，再由 AI 仅基于该文件生成 `/Users/yuwei/code/skills/ywnext/runtime/candidate-list.md`，做、学、玩、思考各 20 条，含详情、适用条件与候选权重。候选不另存周度快照。
   - 运行 Memory 证据、三档核心上下文、full-full Memory-only 与候选清单校验。YW Next 不生成六仓库切片；其他仓库只按相关性读取通过校验的 `runtime/core-context/full.md`、`weighted.md` 或 `core.md`，不得读取 `full-full.md` 或历史遗留切片目录。配置读取失败时，在证据索引中标注缺口且不生成新的核心上下文或候选清单；不得用旧外部数据伪装为本次更新，也不得阻塞已成功写入的 Memory。
13. 仅在 YW Next 全部校验成功后，执行最后一步 Flomo 同步；先完成备份再执行本步骤，避免 Flomo 允许的小改动与快照并发。阶段 3 事务卡已覆盖该目标周的两条 Flomo 写入和读回校验，不再单独请求确认；若默认沙箱无法连接 Ego Lite，允许在同一目标周授权范围内申请 Full Access 重试，不得把运行环境切换再变成一次用户确认：

   ```bash
   npm run sync:flomo -- --week YYYY-Www
   ```

   - 同步已确认的 `weekly.md` 为一条 `Learn-X 周记｜YYYY-Www` memo，并同步季度 Memory 为一条 `Learn-X 记忆｜YYYY-QN` memo；不得同步原始输入、未确认候选或 AI Chat 内容。
   - 只能使用 Ego Lite 任务空间；不得读取浏览器凭据、使用 Token、CDP 或其他浏览器通道。页面未登录、任务空间被接管、编辑探针或读回校验失败时停止。
   - 同步标签和首次旧 memo 的处理由脚本决定：多条命中、无标签的同标题旧 memo、远端删除完整段落、远端改动超过 200 字或无法合并时停止，不新建、不覆盖。
   - 同步成功后才记录 `_dist/flomo-sync/state.json`；Flomo 的小改动按脚本规则回写 `weekly.md` 或季度 Memory。同步失败不回滚已完成的 Memory 与 YW Next。
   - 若 Flomo 读回后的小改动回写了本地季度 Memory，重新运行并校验 YW Next；若回写了 `weekly.md` 或季度 Memory，则重新运行备份，使最终索引与快照覆盖最终落盘版本。备份通过载荷哈希判定 unchanged 时无需重复上传。
   - 每个新进程首次写入前，先在同一 Ego Lite 任务空间完成只读预检：打开 `https://v.flomoapp.com/mine` 并输出结构化 JSON。受限沙箱出现 `ego_cli bootstrap` 连接错误时，判定为本机授权环境不足；在用户确认后仅以 Full Access 重试该预检或同一已确认同步，绝不改用 CDP、Token 或其他浏览器。
   - 将 Ego Lite 的 `cliLog` 视为结构化结果，不假定它固定写到 stdout；适配器必须从 stdout 和 stderr 中提取最后一条完整 JSON。空结果、非 JSON 或缺少预期字段均是“传输/适配器失败”，不能据此推断 Flomo 未读、未写或允许直接重试写入。
   - Flomo 不是 Markdown 原文存储：页面读回后必须先使用与本地正文相同的确定性规范化器，再计算哈希和变更量，禁止直接比较原始 `innerText`。规范化至少覆盖 CRLF、引用块空行、相邻列表项之间的自动空行，以及校验标记与 `#learn-x/*` 标签之间的自动空行；这些格式差异只能产生 `unchanged`，不得触发远端大改动保护或回写本地。
   - 每次新增一种 Flomo 富文本渲染差异，必须先补一个最小回归样例（本地正文、页面读回正文、规范化后哈希/变更量），测试通过后才能继续真实同步；不得用提高 200 字阈值、关闭保护或盲目重试来掩盖读回适配器问题。
   - 首次真实同步按一条 memo 一次完成“搜索 → 创建/更新 → 页面读回 → 状态落盘”；只有读回正文、标签和 `memo_id` 全部一致后，才可继续下一条。失败时报告已完成的 memo 与尚未执行的 memo，不做批量重试或推测性补写。
   - Linux 定时任务不得调用 Ego Lite。只在 Flomo 官方非 GUI 通道同时支持“按同步键检索、读回、创建和更新”且认证方式获准用于无人值守时，才启用定时同步；仅能创建的 incoming webhook/API 不满足季度 memo 更新与去重要求，保持不同步并报告缺口。
   - 定时同步以 `目标键 + 源内容哈希` 为幂等键，固定执行“远端检索 → 写入 → 读回核验 → 原子落盘状态”。任何网络或进程异常后，下一次仅先检索和读回同一幂等键；状态不能证明写入未发生时停止人工裁决，绝不盲目重发写请求。

阶段 3 汇报必须包含候选数量、实际迁移数量、图片状态（生成 / already-success / failed、目标路径）、目标文件、去重结果、找事索引路径和状态、Flomo 同步状态（创建 / 更新 / 跳过 / 失败）、验证结果、当前位置、下一步和下次运行。

## 边界

- 不把本地周输入材料发送到 ChatGPT；只通过全局 `chatgpt-web-bridge` 发送模板提示词和目标周范围。只有未通过完整性校验、状态为 `needs_review` 的 `ai.generated.md` 不进入 Process；校验通过后自动转为正式 `ai.md`。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不自动发布微信公众号；图片只生成到确认卡列出的本地目标路径。
- 不读取 `coach.md` 中 URL 指向的页面正文，不下载 AI Coach 附件，不把联系方式或访谈原文写入仓库。
- 不自动生成或升级正式 Core `道`、`法` 内容；Flomo 置顶镜像位于 `03_input/_mirrors/flomo-top.md`，只作为输入材料单向同步，不属于 Core Truth。
- 不按关键词迁移未勾选 Memory 候选。
- Action Feedback 已退役（Core V1 接管周度行动复盘）：不读取、不生成、不写入任何 `action-feedback.md` 或 Action Feedback Base 记录；历史文件与 Base 记录保留可读。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标周以外的数据。
- 线上采集阻塞时，不降级使用过期本地文件。
- Flomo 同步不删除 memo；重复或无标签旧 memo 只报告，等待用户单独授权处理。

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

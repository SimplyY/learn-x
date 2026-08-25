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
npm run input:voice -- --week 2026-W27
npm run voice:insight -- --week 2026-W27
npm run input:daily-coach -- --week 2026-W27
npm run input:wisdom -- --week 2026-W27
npm run ai:weekly -- --week 2026-W27
npm run process:weekly -- --week 2026-W27
npm run memory:weekly -- --week 2026-W27
```

明确请求“存量周记补全”“用日记补缺周记”或“历史周记同步 Flomo”时，读取 [references/historical-backfill.md](references/historical-backfill.md)，进入独立的历史回填模式；它不改变下面的正常周流程。

先按“目标周选择”解析出唯一目标周，再只运行当前阶段需要的命令。飞书 CLI 默认读取使用应用身份（`--as bot`）；涉及多维表格 Base 的新增、更新、修改、删除等写操作使用用户身份（`--as user`）。读取失败时不要自动切换身份，写入失败时报告用户授权问题，不把写操作改回 bot。Flomo 的 Ego Lite 路径仅用于用户在场的桌面恢复，不能作为 Linux 定时任务的执行通道。

### 飞书 CLI 身份路由

- 读取 Base、表结构、字段、记录及其他飞书资料：默认 `--as bot`。
- 新增、更新、修改、删除 Base 的表、字段、记录、权限或其他资源：使用 `--as user`。
- 不因应用缺少 Base 写权限而反复申请应用权限；应用身份只用于默认读取。

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
4. Flomo 的桌面恢复路径只使用 `ego-browser`（Ego Lite）：一个目标周只创建一个任务空间，所有搜索、读回和写入都复用它；无论成功、失败或抛异常，均在 `finally` 中调用独立的 `completeTaskSpace(..., { keep: false })`，并在汇报给出关闭证据。不得按 memo、动作或重试创建任务空间。页面未登录、任务空间被接管或页面读取失败时停止，不自动切换到 Chrome 插件、CDP 或旧导出。
   - 快速路径：直接新建标签页、写入 Flomo URL 并回车；不要做普通 HTTPS 预检、截图或重复读取完整页面树。
   - 首次读取完整无障碍树后，在内存中扫描时间链接；若最早笔记已早于目标周下界，立即停止。仅当未覆盖下界时滚动加载，并读取增量树后复查。
   - 以 `(创建时间, 正文)` 去重；采集完成后只关闭本次新建标签页，不影响用户原有标签页。
   - 若 Ego Lite 任务空间、自动导航或页面读取失败，停止 Flomo 来源并报告 Ego Lite 异常；不得降级到 Chrome 远程调试、CDP Proxy、其他浏览器插件、读取浏览器凭据或旧本地导出。
   - 当前置顶镜像使用同一次页面读取：以页面明确的“置顶・<原始创建时间>”标记和对应 Flomo memo 链接识别置顶 memo，不按目标周创建时间过滤。只在页面加载完整且恰好识别到 1 条置顶笔记时覆盖 `01_core/道/flomo-top.md`；正文读取 memo 的 `.richText`/正文区域，排除 `.showBtn` 等“展开”控件，不做 AI 总结或改写。识别到 0 条或多条、页面未加载完整或正文提取失败时保留旧文件、继续其他来源，并在阶段 1 汇报中提示，不阻断本周流程。
   - Flomo 目标周 memo 数大于 0 时写入 `flomo.md` 并记录 `ready`；成功读回但为 0 条时不生成新文件，调用 `input:source-status` 记录 `empty` 并报告“0 条记录，文件未生成”；页面、授权或分页失败时记录 `failed/unavailable`，旧文件只保留不计入本轮。
5. AI Coach 由 `input:daily-coach` 采集。按各表真实字段区分新增与回顾；若四张表筛选后合计 0 条新增记录，成功采集但不生成 `coach.md`，并记录 `empty`；这不是失败，阶段 1 必须报告“AI Coach：0 条记录，文件未生成”。
7. 不读取、打印或保存凭据。除用户明确授权的 `01_core/道/flomo-top.md` Flomo 镜像外，不修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或无关长期资产。

## 阶段判断

- 定时触发，或用户没有明确继续指令：执行阶段 1；阶段 1 在自动来源采集完成后先自动生成 AI 周回顾草稿，再生成飞书周记草稿，不等待用户确认才启动 AI 生成。
- `继续` 按当前流程位置解释：阶段 1 已自动生成草稿时不重复生成，仍停在周记人工确认门槛；阶段 2 完成后进入阶段 3。不要把同一短指令按固定全局含义解释。
- 阶段 1 的自动来源采集完成后，先运行 `npm run ai:weekly -- --week YYYY-Www`，再调用 `learn-x-weekly-journal`；AI 生成通过结构校验后默认自动从 `ai.generated.md` 正式化为 `ai.md`，汇报中提示用户复核，但不再把 AI 确认作为额外硬门槛。不采集 `weekly.md`，不生成 `_dist`。如果 AI 生成失败，仍继续生成不含 AI 补充的飞书草稿，并在汇报中提供人工 fallback prompt。
- 已存在 `ai.generated.md` 时不得重复发送；已提交但结果不确定的运行必须停在 `needs_review`，不得自动重发。
- 若返回 `ego-bootstrap-permission`，说明当前沙箱不能让 Node 子进程连接 Ego Lite；请求 Full Access 后，仅使用 `npm run ai:weekly -- --week YYYY-Www --retry` 重试这次未提交调用，禁止切换到 Chrome、CDP 或其它浏览器。已提交后的超时、归属不确定或输出不完整不得用 `--retry` 重发。
- AI 生成通过校验后自动执行等价于 `npm run ai:weekly -- --week YYYY-Www --promote --confirm` 的正式化；已有实质 `ai.md` 时先备份到对应 `_dist` 目录再覆盖。`AI 周回顾已确认` 仍可作为人工复核口令，但不再阻塞流程；`--promote --confirm` 主要保留给旧的待处理草稿或恢复场景。
- 用户说 `周记已确认`、`继续生成周报材料` 或同义表达：对同一目标周进入阶段 2，采集已确认的 `weekly.md` 并生成 `_dist`。
- 阶段 2 完成后，用户说 `继续`、`继续下一步`、`继续记忆`、`报告已完成，写入记忆`、`Memorize`，或确认完整人工步骤已完成：对同一目标周进入阶段 3。此处的 `继续` 视为用户确认已完成阶段 2 汇报中列出的 Chat Pack 人工步骤；阶段 3 仍必须先验证 Weekly Output、芒格之魂洞察和全文核心重点纪要，不能绕过本地门槛硬写 Memory。
- 阶段 1 的 `继续` 不得跳到阶段 3；阶段 3 只按当前流程位置解析别名。
- 不猜测人工项已经完成。到阶段门槛就停。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标周；不要在后续阶段重新按当天日期推断。

## 阶段 1：输入采集与周记草稿

目标：采集自动来源后，直接用已落盘周信息生成飞书周记草稿，停在人工确认门槛前。

1. 确保 `03_input/weekly/YYYY-Www/` 存在。保留目录中已有的人工内容；AI 生成阶段先写入 `ai.generated.md` 和状态侧车，通过结构与完整性校验后自动移动为正式 `ai.md`，并在 `_dist` 保留审计副本；不得预建 `weekly.md`。
2. 采集本地自动来源，并提示飞书机器人侧自查：
   - Flomo：按“启动规则 4”通过 Ego Lite 任务空间打开或复用 `https://v.flomoapp.com/mine`，按 Asia/Shanghai 的目标周起止时间检索；仅在尚未覆盖下界时加载下一批，只把当前页面实际读到、属于目标周的笔记去重后按创建时间正序写入 `flomo.md`。同一次页面读取中，另外同步当前唯一置顶笔记到 `01_core/道/flomo-top.md`：文件包含来源链接、原始创建时间、同步周和正文；每周覆盖更新，不保留旧版本。若置顶数量为 0 或多于 1，保留旧镜像并提示，不阻断其他来源。`flomo.md` 仍只包含目标周数据；旧 `flomo.md` 只作为差异报告依据，不得用来补全当前 Flomo，也不得只取首屏或使用旧本地导出替代。
   - 微信读书：按 `learn-x-input` 执行 `npm run input:weread -- --week YYYY-Www`。验证输出保留目标周、Asia/Shanghai 范围、生成时间、阅读统计、进度快照、个人划线和想法，并包含完整 7 天，包括 0 分钟日期。
   - Time-X 日历：按 `learn-x-input` 执行一次 `npm run input:calendar -- --week YYYY-Www`，只读取固定 `Time-X｜随时记` 共享日历，将日历汇总及每个日历块的日期、起止、标题、描述写入 `calendar.md`。不得读取用户主日历，不保存日历人员、地点、ID、链接或系统元数据。
   - Voice-X：按 `learn-x-input` 执行 `npm run input:voice -- --week YYYY-Www`，只读取目标 ISO 周已归档的新版 AI 洞察文档写入 `voice.md`。每条保留标题、录制时间、处理后原文字符数、AI 洞察字符数、核心总结和芒格之魂洞察；缺失/占位计入 `pending`，旧格式计入 `legacy`，不回退到处理后原文。周日 `npm run voice:insight -- --week YYYY-Www` 是独立阶段，不由周一流程隐式触发；0 条、查询/文档/长度失败均按来源状态处理并保留旧文件。
   - 飞书日记与 AI Coach：执行 `npm run input:daily-coach -- --week YYYY-Www`。采集器先用 `--as bot` 现场核验 Base、表和字段，再按各表边界筛选并遍历全部分页；各来源状态写入 `_source-status.json`。0 条时不生成新文件，旧文件可保留但标记过期；失败时保留旧文件但标记失败。
   - 智慧之门：执行 `npm run input:wisdom -- --week YYYY-Www`。通过 `collect-base-weekly.mjs` 按创建时间筛目标周并遍历全部分页；0 条时报告“0 条记录，文件未生成”，失败不得伪装成空结果。
   - 飞书机器人 Build 复盘：本流程不执行 `build-bot-log`，不生成或追加 `build-bot.md`。必须提示用户：`build-bot-log 需要在飞书机器人上完成，请自查`。
     - 如果目标周是提前写当周，提示用户去飞书上手动执行，并输出自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX
     - 如果不是提前执行，提示用户周日飞书自动化理论上已提前执行，只需自查 `build-bot.md` 是否已由飞书侧写入。
   - Codex / Code X Build 复盘：由独立 Build 自动化确认 `build.md` 是否有本周有效证据；有则写 `ready`，无则写 `empty`，执行或授权失败写 `failed/unavailable`。本地周自动化不以旧 `build.md` 冒充本轮结果。
   - Health-X：检查 `health.md` 及其状态侧车；不存在、空文件或模板/占位内容都视为 `unavailable/empty`，不得用旧文件补齐。本流程不替 Health-X 编造记录；Health-X 同步完成后应调用 `input:source-status` 写入 `health` 的 `ready/empty/failed/unavailable`。

   - 所有自动来源统一遵守：`ready` 才进入下游；成功 0 条写 `empty` 并报告“0 条记录，文件未生成”；`failed/unavailable` 单独报告，旧文件只保留在磁盘不计入本轮。状态文件为 `03_input/weekly/YYYY-Www/_source-status.json`，外部拥有者可调用 `npm run input:source-status -- --week YYYY-Www --source <source> --status <status> --file <file> --count <n> --summary "..."`。
   - 如果目标周是周六、周日自动判定的当前周提前稿，`daily.md` / `flomo.md` / `weread.md` / `wisdom.md` / `calendar.md` 可以只覆盖截至运行时；文件和汇报必须标出缺失日期 / 未来日期。
3. 自动来源完成后，在同一阶段先调用 ChatGPT Web Bridge 生成 `ai.generated.md`。桥接父进程需要能启动 Ego Lite 子进程；`ego-bootstrap-permission` 是运行环境能力错误，必须切换父进程到 Full Access 后只重试一次，不得循环换参数。结构和完整性校验通过后自动正式化为 `ai.md`，供 `learn-x-weekly-journal` 和 Process 使用；汇报中提示用户复核。失败、超时、结果不稳定或校验失败时不写入正式 `ai.md`，继续生成不含 AI 补充的飞书草稿。`回顾最近笔记 & flomo 洞察` 整块必须留给用户手写，自动化不得精选、改写或填入 Flomo 内容。
4. 阶段 1 不采集飞书周记，不生成 `weekly.md`、`_dist` 或 Weekly Output。
5. ChatGPT 输入只读取 `03_input/weekly/00_template/ai.md` 提示词，并附加目标周范围；不主动发送 `daily.md`、`flomo.md` 或其它本地周材料。桥接失败时报告原因和完整人工 fallback prompt；成功结果先落为 `ai.generated.md`，完整性校验通过后自动成为正式 `ai.md`，并保留审计副本。回复未通过结构验收时写入 `_ai-invalid.generated.md` 和验证原因；后续代码修复能确定性恢复时优先本地恢复，不重复外发，否则只有用户显式 `--retry` 才能重新提交。

阶段 1 汇报必须包含：目标周、完整来源状态表、AI 草稿状态（`generated` / `needs_review` / `failed` / `confirmed`）、生成结果路径或 fallback prompt、飞书周记草稿链接、跳过字段（明确列出 `回顾最近笔记 & flomo 洞察` 由用户填写）、阻塞项、当前位置、下一步和再下一步。来源状态表必须区分 `ready`、`empty`、`failed`、`unavailable`，并明确旧文件是否保留但不计入本轮；成功空结果单独报告“0 条记录，文件未生成”，失败/不可用不得写成 0 条。输入文件字数表只统计 `ready` 文件，`ai.md`、`ai.generated.md`、`weekly.md` 和人工周记不纳入。
每个来源还必须给出原始字符数、纳入下游的有效字符数和可点击核查文件链接；不可用但保留旧文件的来源也要给链接并标注“过期、不计入”。

## 阶段 1 内：周记草稿生成与人工确认

目标：只从已落盘周输入生成飞书周记草稿，停在人工确认门槛前。

1. 验证 `daily.md`、`flomo.md`；优先读取已确认的 `ai.md`，否则仅在生成侧车为 `generated` 时读取 `ai.generated.md` 作为未确认草稿。AI 文件无效、空壳或缺失都不阻塞草稿。不满足 `daily.md` 或 `flomo.md` 的最低条件时停止，不写飞书、不采集 `weekly.md`、不生成 `_dist`。
2. 调用 `learn-x-weekly-journal`。它按目标周结束日的下一天定位周记标题，复制模板并只填新模板的安全空位；已有实质内容或草稿时跳过，不覆盖、不刷新。
3. 成功后停止，提示用户在飞书周记中自行填写 `回顾最近笔记 & flomo 洞察`，再编辑并确认草稿，移除主标题中的 `【待优化】AI 基础草稿` 标记；正文细项不应出现该标记。
4. 用户确认后必须回复 `周记已确认` 或 `继续生成周报材料`；只有该指令才能进入阶段 2。

本阶段汇报必须包含目标周、使用的本地来源、飞书草稿链接、跳过字段、阻塞项、当前位置、下一步（人工确认周记）和再下一步（阶段 2 采集 `weekly.md` 并生成 `_dist`）。

## 阶段 2：周记采集与报告准备

目标：采集已人工确认的周记，验证必要输入，然后生成 `_dist` 和 Output 最小壳。

1. 按“周记日期映射”计算写作日，通过飞书 CLI 从已登录的线上飞书周记文档采集该写作日对应的目标周周记。不能把写作日当天所在的 ISO 周当作覆盖周。只截取目标覆盖范围的段落；`weekly.md` 必须同时保留来源 URL、写作日标题、目标覆盖范围、定位依据和采集时间。目标段落主标题仍含 `【待优化】AI 基础草稿` 时视为未确认，停止，不得用旧本地内容替代。
   - 采集前如果发现缺少飞书周记所需授权，先一次性列出并请求全部缺失 scopes，再继续，不要一项一项分开打断用户。
3. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `voice.md`（仅在状态为 `ready` 时读取；只含目标周新版 AI 洞察的核心总结与芒格之魂洞察，不含粗加工原文、建议段落或原始文字稿，且不超过 15,000 字符）
   - `calendar.md`（仅在状态为 `ready` 时读取；只作计划上下文，`empty/unavailable` 时报告但不将其当作行动证据）
   - `coach.md`（本次采集有新增记录时才存在；包含新增记录并标注采集器排除的回顾更新；0 条时按来源状态记录，不阻塞）
   - `wisdom.md`（本次采集有新增记录时才存在；采集器按创建时间生成；0 条时按来源状态记录，不阻塞）
   - `health.md`（可选；缺失不阻断，但汇报必须先用一级大标题显著提示，并附 Health-X 生成命令）
   - `build-bot.md`（只验证是否已由飞书侧完成；不存在时报告缺口，但本流程不生成）
   - `weekly.md`
   - `ai.md`（可选；存在时必须是目标周真实回顾，不得把空壳、模板或提示词当作内容）
   对周六、周日提前写当周的场景，允许 `daily.md` / `flomo.md` / `weread.md` 是截至运行时的部分覆盖，但 `weekly.md` 必须是目标周真实回顾内容；`ai.md` 如存在也必须对应目标周，缺失不阻塞。
6. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。`build-bot.md` 属于飞书机器人侧流程；本流程只提示自查，不调用 `build-bot-log`。
7. 运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

   若因单文件超过 15,000 字符失败，先运行 `npm run input:compress -- --week YYYY-Www` 生成审核包；它不会覆盖输入。只有用户确认诊断无误后，才允许显式应用候选，再重新运行本阶段。

9. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 已完成来源、缺口、验证结果
10. 停止，等待用户完成一个人工 / Chat Pack 步骤：结合 `process-pack.md` 生成并审核 Weekly Output；在同一次操作中启用 `芒格之魂` 生成独立洞察，补全 `芒格之魂的洞察 & 全文核心重点纪要`，并审核 Memory 候选。按需读取 `.agents/skills/learn-x-process/resources/weekly-output-rules.md` 和 `layer-rules.md`。全部完成后回复 `继续`、`继续下一步` 或 `继续记忆`，进入阶段 3。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 在 Chat Pack 一次完成并审核 Weekly Output、芒格之魂、核心纪要和 Memory 候选；再下一步 = 展示一张仅针对当前目标周的阶段 3 最后确认卡。确认卡必须在执行前一次性写清本周 Memory 写入目标、备份载荷（`01_core/`、`03_input/`、`04_output/`）及飞书云盘 / `Snapshots` 目的地、YW Next 刷新范围、Flomo 载荷（`weekly.md` 与季度 Memory）及目的地、留存清理和读回校验；用户只需确认一次。不得把备份、Full Access、YW Next 或 Flomo 再拆成多个确认点。
阶段 2 的来源表必须逐来源列出状态、原始字符数、纳入字符数和可点击核查文件链接；不能只报告来源数量和产物路径。
若 `health.md` 缺失，阶段 1 / 阶段 2 汇报的第一段必须是一级大标题 `# ⚠️ 缺失输入：health.md`，并同时给出目标周、报告结束日和 Health-X 的 `validate` / `sync` 命令；不能把缺失藏在普通缺口列表中。

## 阶段 3：已审核记忆

目标：生成和迁移已确认的 Memory 候选，并刷新下一周“找事”离线索引。

1. 验证 `04_output/weekly/YYYY-WW.md` 是目标周的实质性周报，不是空壳或模板。
2. 验证同一周报包含非空、实质性的 `芒格之魂的洞察 & 全文核心重点纪要` 区域。缺失时停止，不生成或迁移 Memory。
3. 用户从阶段 2 完成状态回复 `继续`、`继续下一步` 或 `继续记忆`，视为确认本周 Weekly Output、芒格之魂、核心纪要和 Memory 候选已人工审核；先展示“最后确认卡”，不执行写入。用户对卡片确认后，一次性执行卡内列出的本地写入、私有备份、YW Next 刷新和 Flomo 同步。确认词必须覆盖卡片列出的载荷与目的地，例如：`确认执行 W34 阶段 3：写入已确认 Memory；将 01_core、03_input、04_output 备份到 Learn-X 专用飞书云盘并维护 Snapshots；刷新 YW Next；将 W34 周记与 2026-Q3 Memory 同步到 Flomo。` 此后不得按备份、Full Access、YW Next、Flomo 分别再次请求确认；同一目标周、同一事务范围内因网络、Ego Lite、读回或工具环境失败而进行的安全重试沿用这次授权。只有新增目标、扩大数据范围、改变写入对象或新增删除动作时才重新确认。除本阶段末尾的 Flomo 同步外，不得访问、验证或发布任何外部内容。若当前并非阶段 2 完成状态，`继续`按前序阶段规则解释，不得直接进入这里。
   - 标题 10「全文核心重点纪要」和标题 11「芒格之魂的洞察」是系统确认内容，不要求 checkbox。前者写入当周 Memory；后者写入季度 Memory 顶部芒格洞察候选池。允许轻度去重压缩，但不得丢失独立判断、限定、反转、隐喻或行动边界。
4. 生成或刷新候选：

   ```bash
   npm run memory:weekly -- --week YYYY-Www
   ```

5. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`。
6. 只迁移：
   - `memory-candidates.md` 中两个「系统确认」章节；
   - `memory-candidates.md` 中已勾选的 checkbox 条目；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
7. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
8. 将获准条目写入正确的季度 Memory 目标。「全文核心重点纪要」进入对应周的 `Memory`；「芒格之魂的洞察」进入顶部芒格洞察候选池。已勾选的 `法候选` / `术候选` 进入对应候选池；任何内容都不自动升级为正式 `道 / 法 / 术`。
9. 保持幂等。重复运行不得追加完全重复条目。
10. 如果标题 10/11 均无实质内容，且没有其他获准条目，停止并要求用户补充、勾选或明确确认候选，不要编造 Memory。
11. Memory 写入成功后，立即执行 Learn-X 数据备份。阶段 3 事务卡已覆盖该目标周的备份写入和留存清理，不再单独请求确认：
   ```bash
   npm run backup:weekly -- --week YYYY-Www
   ```
   - 备份完整扫描 `01_core/`、`03_input/`、`04_output/`，不使用 Git 或 `.gitignore` 过滤；仅排除 `.DS_Store` 和凭据类文件名。
   - 生成 `tar.gz`、`manifest.json`、文件清单 SHA-256 和压缩包 SHA-256，上传到专用飞书云盘文件夹，并将元数据写入专用 Base 的 `Snapshots` 表。
   - Base 写操作使用 `--as user`；写入后必须读回；同一周按 `Snapshot ID` 幂等更新。
   - 成功后执行留存清理：保留最近 31 天内所有成功快照，并永久保留每个自然年度最后一次成功快照；同一文件同时满足两个条件时只保留一个物理文件。
   - 删除只针对 Base 已登记、窗口外且非年度快照的文件；云盘删除和 Base 清理失败都必须记录告警。
   - 新快照上传和 Base 读回成功后，即使留存清理失败，也保持该快照 `success`；命令以非零状态暴露清理失败，不能把已成功上传的快照改成 `failed`。
   - 备份失败不回滚已写入的 Memory，继续 YW Next 和 Flomo，但最终汇报必须标记 `Overall: partial`，明确列出 `Backup: failed`。
12. Memory 写入成功后，在同一阶段执行 `$ywnext 更新索引 YYYY-Www`：
   - 读取 `01_core/memory/*.memory.md`；Memory 已承接最近四周及长期校准，因此 Weekly Output、Process Pack、`input.json`、周记、日记、阅读、智慧之门、AI Coach 和其他原始周输入不进入 YW Next 语义上下文。
   - 找事配置、常做清单和最近计划只作为运行控制输入，不写入个人核心上下文；不得用它们补充 Memory 缺口。
   - 读取“找事配置” Base 的启用记录，运行 `$ywnext` 的配置校验脚本，将原始快照写入 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.config.json`；脚本不归一化权重、不提炼证据、不生成建议。
   - 由 AI 严格依据 `$ywnext` 的 Markdown 规则阅读 Memory，生成 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.md`（Memory 来源路径、范围、全文阅读状态与缺口）及 `runtime/core-context/full.md`、`weighted.md`、`core.md`（三档独立静态核心上下文）。不生成或读取 `current.md`。
   - 继续生成仅供 YW Next 使用的 `runtime/core-context/full-full.md`：只全文保留 `01_core/memory/*.memory.md`，再由 AI 仅基于该文件生成 `/Users/yuwei/code/skills/ywnext/runtime/candidate-list.md`，做、学、玩、思考各 20 条，含详情、适用条件与候选权重。候选不另存周度快照。
   - 运行 Memory 证据、三档核心上下文、full-full Memory-only 与候选清单校验。配置读取失败时，在证据索引中标注缺口且不生成新的核心上下文或候选清单；不得用旧外部数据伪装为本次更新，也不得阻塞已成功写入的 Memory。
13. 仅在 YW Next 全部校验成功后，执行最后一步 Flomo 同步。阶段 3 事务卡已覆盖该目标周的两条 Flomo 写入和读回校验，不再单独请求确认；若默认沙箱无法连接 Ego Lite，允许在同一目标周授权范围内申请 Full Access 重试，不得把运行环境切换再变成一次用户确认：

   ```bash
   npm run sync:flomo -- --week YYYY-Www
   ```

   - 同步已确认的 `weekly.md` 为一条 `Learn-X 周记｜YYYY-Www` memo，并同步季度 Memory 为一条 `Learn-X 记忆｜YYYY-QN` memo；不得同步原始输入、未确认候选或 AI Chat 内容。
   - 只能使用 Ego Lite 任务空间；不得读取浏览器凭据、使用 Token、CDP 或其他浏览器通道。页面未登录、任务空间被接管、编辑探针或读回校验失败时停止。
   - 同步标签和首次旧 memo 的处理由脚本决定：多条命中、无标签的同标题旧 memo、远端删除完整段落、远端改动超过 200 字或无法合并时停止，不新建、不覆盖。
   - 同步成功后才记录 `_dist/flomo-sync/state.json`；Flomo 的小改动按脚本规则回写 `weekly.md` 或季度 Memory。同步失败不回滚已完成的 Memory 与 YW Next。
   - 每个新进程首次写入前，先在同一 Ego Lite 任务空间完成只读预检：打开 `https://v.flomoapp.com/mine` 并输出结构化 JSON。受限沙箱出现 `ego_cli bootstrap` 连接错误时，判定为本机授权环境不足；在用户确认后仅以 Full Access 重试该预检或同一已确认同步，绝不改用 CDP、Token 或其他浏览器。
   - 将 Ego Lite 的 `cliLog` 视为结构化结果，不假定它固定写到 stdout；适配器必须从 stdout 和 stderr 中提取最后一条完整 JSON。空结果、非 JSON 或缺少预期字段均是“传输/适配器失败”，不能据此推断 Flomo 未读、未写或允许直接重试写入。
   - Flomo 不是 Markdown 原文存储：页面读回后必须先使用与本地正文相同的确定性规范化器，再计算哈希和变更量，禁止直接比较原始 `innerText`。规范化至少覆盖 CRLF、引用块空行、相邻列表项之间的自动空行，以及校验标记与 `#learn-x/*` 标签之间的自动空行；这些格式差异只能产生 `unchanged`，不得触发远端大改动保护或回写本地。
   - 每次新增一种 Flomo 富文本渲染差异，必须先补一个最小回归样例（本地正文、页面读回正文、规范化后哈希/变更量），测试通过后才能继续真实同步；不得用提高 200 字阈值、关闭保护或盲目重试来掩盖读回适配器问题。
   - 首次真实同步按一条 memo 一次完成“搜索 → 创建/更新 → 页面读回 → 状态落盘”；只有读回正文、标签和 `memo_id` 全部一致后，才可继续下一条。失败时报告已完成的 memo 与尚未执行的 memo，不做批量重试或推测性补写。
   - Linux 定时任务不得调用 Ego Lite。只在 Flomo 官方非 GUI 通道同时支持“按同步键检索、读回、创建和更新”且认证方式获准用于无人值守时，才启用定时同步；仅能创建的 incoming webhook/API 不满足季度 memo 更新与去重要求，保持不同步并报告缺口。
   - 定时同步以 `目标键 + 源内容哈希` 为幂等键，固定执行“远端检索 → 写入 → 读回核验 → 原子落盘状态”。任何网络或进程异常后，下一次仅先检索和读回同一幂等键；状态不能证明写入未发生时停止人工裁决，绝不盲目重发写请求。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、找事索引路径和状态、Flomo 同步状态（创建 / 更新 / 跳过 / 失败）、验证结果、当前位置、下一步和下次运行。

## 边界

- 不把本地周输入材料发送到 ChatGPT；只通过全局 `chatgpt-web-bridge` 发送模板提示词和目标周范围。只有未通过完整性校验、状态为 `needs_review` 的 `ai.generated.md` 不进入 Process；校验通过后自动转为正式 `ai.md`。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不读取 `coach.md` 中 URL 指向的页面正文，不下载 AI Coach 附件，不把联系方式或访谈原文写入仓库。
- 不自动生成或升级正式 `道/`、`法/`、`术` 内容；用户明确授权的 `01_core/道/flomo-top.md` 仅作为 Flomo 单向镜像例外，成功采集时允许覆盖更新。
- 不按关键词迁移未勾选 Memory 候选。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标周以外的数据。
- 线上采集阻塞时，不降级使用过期本地文件。
- Flomo 同步不删除 memo；重复或无标签旧 memo 只报告，等待用户单独授权处理。

## 汇报格式

每次运行必须包含：

- 目标周。
- 全局流程，并标记当前阶段。
- 已完成来源或产物。
- 阻塞项和缺口。
- 当前位置。
- 下一步。
- 再下一步。

汇报保持简洁，但不能省略阶段门槛。

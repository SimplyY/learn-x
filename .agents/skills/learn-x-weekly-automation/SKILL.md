---
name: learn-x-weekly-automation
description: Learn-X 每周输入自动采集、Weekly Output 报告准备、已审核 Memory 迁移的中文自然语言工作流。Use when the user asks for "Learn-X 每周输入自动采集 & 报告 & 记忆", weekly report automation, W27/Wxx weekly processing, generating weekly `_dist` / Process Pack / Output shell, or preparing weekly memory candidates from reviewed Weekly Output.
---

# Learn-X 每周自动化

## 总览

把本 Skill 作为每周固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用已有采集器和 `learn-x-process` 命令。除非 Markdown 流程反复执行失败，否则不要新增编排脚本。

## 快速命令

```bash
npm run input:weread -- --week 2026-W27
npm run input:time -- --week 2026-W27
npm run process:weekly -- --week 2026-W27
npm run memory:weekly -- --week 2026-W27
```

先按“目标周选择”解析出唯一目标周，再只运行当前阶段需要的命令。飞书 CLI 默认读取使用应用身份（`--as bot`）；涉及多维表格 Base 的新增、更新、修改、删除等写操作使用用户身份（`--as user`）。读取失败时不要自动切换身份，写入失败时报告用户授权问题，不把写操作改回 bot。Flomo 使用官方 `computer-use:computer-use` Skill 在日常 Chrome 中自动新开标签页并复用登录态。

### 飞书 CLI 身份路由

- 读取 Base、表结构、字段、记录及其他飞书资料：默认 `--as bot`。
- 新增、更新、修改、删除 Base 的表、字段、记录、权限或其他资源：使用 `--as user`。
- 不因应用缺少 Base 写权限而反复申请应用权限；应用身份只用于默认读取。

## 启动规则

1. 目标周选择：
   - 用户明确指定 `YYYY-Www`、`本周`、`这周`、`上周` 时，按用户指定。
   - 未指定时，按 `Asia/Shanghai` 当前日期自动判断：周一至周五默认上一 ISO 周；周六、周日默认当前 ISO 周。
   - 周三至周五自动选上一周时，必须在汇报中提示：现在仍是周中，默认处理上一周；如果要提前写本周，需要明确说“本周”或指定 `YYYY-Www`。
   - 周六、周日自动选当前周时，视为提前写当周；允许输入只覆盖截至运行时，但必须报告未来日期或缺失日期，不得声称整周已完整结束。
   - 格式统一使用 `YYYY-Www`。
2. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-input/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
   - 如果当前阶段会采集 `weekly.md`，先一次性核对并提示缺失授权，避免逐项打断用户；本 Skill 默认把相关授权合并为一轮确认。
3. 保持当前扁平周目录：`03_input/weekly/YYYY-Www/*.md`。不要恢复旧版 `00_log/`、`01_inbox/`、`02_action/` 嵌套结构。
4. Flomo 只使用官方 `computer-use:computer-use` Skill，在日常 Chrome 自动新开独立标签页并打开 `https://v.flomoapp.com/mine`，复用已有登录态。通过页面无障碍树读取笔记创建时间和正文，持续加载直到最早笔记早于目标周下界，遍历全部分页或加载结果；按 Asia/Shanghai 筛选、去重并按创建时间正序输出。
   - 快速路径：直接新建标签页、写入 Flomo URL 并回车；不要做普通 HTTPS 预检、截图或重复读取完整页面树。
   - 首次读取完整无障碍树后，在内存中扫描时间链接；若最早笔记已早于目标周下界，立即停止。仅当未覆盖下界时滚动加载，并读取增量树后复查。
   - 以 `(创建时间, 正文)` 去重；采集完成后只关闭本次新建标签页，不影响用户原有标签页。
   - 若自动导航或页面读取失败，停止 Flomo 来源并报告官方 Computer Use 异常；不得降级到 `playwright-extension`、Chrome 远程调试、CDP Proxy、读取浏览器凭据或旧本地导出。
5. AI Coach 使用 `https://ywhome.feishu.cn/wiki/UeHNwP3ebihXPJkU2Lfc2mIsncb`；每次先用 `lark-cli base +url-resolve --as bot` 取得真实 `base_token`，再核对这四张表：`服务对象`、`服务记录`、`ai coach thinking`、`项目`。表或字段变化时停止该来源，不猜旧结构。
7. 不读取、打印或保存凭据。不修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或无关长期资产。

## 阶段判断

- 定时触发，或用户没有明确继续指令：只执行阶段 1。
- 用户说 `继续`、`周记和 AI 摘要已完成`、`继续采集周记` 或同义表达：对同一目标周进入阶段 2，先验证 `ai.md` 并采集 `weekly.md`；三图屏幕时间可与这些人工项并行提交。三图是否合格按图片证据判断；在生成 `_dist` 前另行确认 Stage 1.5 的非 dry-run 写入脚本是否成功返回 Android、Mac 两条 `outcomes`，不得把缺少回执说成截图不合格。
- 用户说 `继续记忆`、`报告已完成，写入记忆`、`Memorize`，或确认 Output / 芒格洞察 / 图片 / 公众号发布已完成：对同一目标周执行阶段 3。
- 不猜测人工项已经完成。到阶段门槛就停。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标周；不要在后续阶段重新按当天日期推断。

## 阶段 1：输入采集

目标：采集自动来源后，同时开放屏幕时间、周记和 AI 摘要三项准备；三项汇合后才生成 Weekly Output 输入包。

1. 确保 `03_input/weekly/YYYY-Www/` 存在。保留目录中已有的人工内容。若 `weekly.md` 或 `ai.md` 不存在，创建空文件作为人工/阶段 2 写入位置；不得写入模板正文、提示词或缺口说明。
2. 采集本地自动来源，并提示飞书机器人侧自查：
   - 飞书日记：通过飞书 CLI 读取多维表格，不通过网页抓取。必须先取得真实完整字段表头和 field id 映射，再获取目标周日记多维表格 records。无法验证表头时停止该来源；不得猜字段名，不得用旧文件补齐。写入 `daily.md`，保留来源、日期范围、采集时间、CLI 命令来源和字段 provenance。
   - 飞书周记：通过飞书 CLI 读取线上周记文档，优先从知识库/文档节点树定位目标周文档，再读取正文。只截取目标周段落。`weekly.md` 必须保留来源 URL、标题或日期定位依据、采集时间。无法通过 CLI 取得线上正文时停止，不得用旧本地内容替代。
   - Flomo：按“启动规则 4”的快速路径自动新开 Chrome 标签页、打开 `https://v.flomoapp.com/mine` 并复用日常登录态，按 Asia/Shanghai 的目标周起止时间检索；仅在尚未覆盖下界时加载下一批，只把目标周笔记去重后按创建时间正序写入 `flomo.md`。文件保留来源、时间范围、采集时间、数量和分页完成状态；不得只取首屏，不得用旧本地导出替代。
   - 微信读书：按 `learn-x-input` 执行 `npm run input:weread -- --week YYYY-Www`。验证输出保留目标周、Asia/Shanghai 范围、生成时间、阅读统计、进度快照、个人划线和想法，并包含完整 7 天，包括 0 分钟日期。
   - Time-X 时间：按 `learn-x-input` 执行 `npm run input:time -- --week YYYY-Www`，只读取固定 Time-X 私有共享日历与屏幕时间 Base，写入 `time.md`；只保留六类标签聚合、日期/时长和两端最新总时长。
   - AI Coach：通过飞书 CLI 分别读取四张表中“更新时间”落在目标周内的全部记录，写入独立的 `coach.md`。
     - 目标周筛选使用 `更新时间 > 上一周日 23:59` 且 `更新时间 < 下一周一 00:00`；`updated_at` 不支持 `>=`，不要改写为不受支持的操作符。
     - 每张表先 `+field-list`，再用 `+record-list --filter-json` 在服务端筛选并遍历全部分页；`has_more=true` 时不得以当前页冒充全量。
     - 保留普通字段、选项、日期、公式结果和 URL。`服务资料`、`超链接`、`产出链接` 只保留原链接，不读取链接页面正文；附件只记录文件名和数量，不下载。
     - 不把 `联系方式`、`访谈文字`原文或技术性的关联 record id 写入仓库。需要展示关联对象时，用真实关联记录回查用户可读名称。
     - `coach.md` 必须写明 Base URL、目标周时间范围、采集时间、四张表各自记录数和分页完成状态；零记录也保留“已检查，本周无更新”，不得沿用旧文件。
   - 飞书机器人 Build 复盘：本流程不执行 `build-bot-log`，不生成或追加 `build-bot.md`。必须提示用户：`build-bot-log 需要在飞书机器人上完成，请自查`。
     - 如果目标周是提前写当周，提示用户去飞书上手动执行，并输出自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX
     - 如果不是提前执行，提示用户周日飞书自动化理论上已提前执行，只需自查 `build-bot.md` 是否已由飞书侧写入。
   - 如果目标周是周六、周日自动判定的当前周提前稿，`daily.md` / `flomo.md` / `weread.md` / `coach.md` / `calendar.md` 可以只覆盖截至运行时；文件和汇报必须标出缺失日期 / 未来日期。
3. 自动来源完成后，在同一电脑端 CodeX 对话同时请求三图屏幕时间，并提示用户可并行完成飞书周记和 AI 摘要；不得把任一项设为另一项的前置门槛。
4. 阶段 1 不采集飞书周记。用户回复 `继续` 后，阶段 2 自动读取线上飞书周记并写入 `weekly.md`；无论三图是否已提交，均不得阻止该采集。
5. 阶段 1 不生成 `_dist`，不创建或改写最终 Weekly Output。
6. 不访问 AI Chat 或 ChatGPT 历史。不写入、改写或补全 `ai.md` 正文；如果用户直接把 AI 摘要贴到当前对话，先原样落盘到 `ai.md` 再继续验证。
7. 读取并在汇报中用 Markdown 代码块完整输出 `02_prompts/meta/_ai-chat-extract-prompt.md` 的当前正文，明确提示用户可直接用它生成 `03_input/weekly/YYYY-Www/ai.md`。
8. 提示用户可并行完成两件事：发送 `时间` 与三张截图；使用 AI 摘要提示词生成并保存 `03_input/weekly/YYYY-Www/ai.md`，然后回复 `继续`。不要要求用户手工创建 `weekly.md`；该文件由阶段 2 自动采集写入。
9. 提示用户填写线上周记时，固定附上周记入口：https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac

## 阶段 1.5：电脑端屏幕时间

阶段 1 自动来源完成后，在当前电脑端 CodeX 对话请求用户发送 `时间` 和三张原生截图：Android 近 7 日柱状图、Android 应用列表、Mac 最近 7 日使用时间。它与 AI 摘要、飞书周记准备并行；使用 `/Users/yuwei/code/time-x/.agents/skills/time-x-screen-time/SKILL.md` 的流程直接目视读取图片并写入 `每周屏幕时间` Base。

- Android 总时长只按整小时估算，且截图“今天”必须等于提交日期；Mac 截图只要明确显示“今天”，即以截图当天为结束日，按屏幕显示的最近 7 日统计处理，不再要求额外显示 ISO 日期范围或手动切换到上一完整自然周。
- 截图不复制到 Learn-X、`03_input` 或 Base 附件；屏幕时间数据只存在于 Time-X Base。
- 三张截图通过图片证据检查后，视为屏幕时间证据已收到；截图不复制到 Learn-X。生成 `_dist` 前仍需确认非 dry-run 写入脚本已返回 Android、Mac 两条 `outcomes`，因为这只是“Time-X Base 写入回执”门槛，不是截图有效性门槛。若脚本、secure 校验或 Base 写入链路未运行，报告为执行链路阻塞，不否定截图，也不重复索取三图。

阶段 1 汇报必须包含：目标周、已完成来源、缺失或部分完成来源、`daily.md` / `flomo.md` / `weread.md` / `coach.md` / `calendar.md` 路径、当前位置、下一步、再下一步。

## 阶段 2：周记采集与报告准备

目标：采集周记，验证必要输入，然后生成 `_dist` 和 Output 最小壳。

1. 先验证 `ai.md`。它必须非空、不是模板、不是提取提示词本身、不是自动缺口说明，并且包含目标周真实回顾内容。无效时立即停止，不采集 weekly，不生成 `_dist`，并再次展示 AI 摘要提示词。用户若已在当前对话贴出 AI 摘要，直接写入 `ai.md` 后再验证。
2. `ai.md` 通过后，通过飞书 CLI 从已登录的线上飞书周记文档采集目标周周记。只截取目标周段落。`weekly.md` 必须保留来源 URL、标题或日期定位依据、采集时间。无法取得线上正文时停止，不得用旧本地内容替代。
   - 采集前如果发现缺少飞书周记所需授权，先一次性列出并请求全部缺失 scopes，再继续，不要一项一项分开打断用户。
3. 在生成 `_dist` 前，确认同一目标周的 Stage 1.5 写入链路已成功返回 Android、Mac 两条 `outcomes`。未满足时，保留已采集的 `weekly.md`，报告为 Time-X 写入/secure/回执缺口；如果三图已通过图片检查，不得再次索取三图；不得生成 `_dist`。
4. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `calendar.md`（只作计划上下文，缺失或不可用时报告但不将其当作行动证据）
   - `coach.md`
   - `build-bot.md`（只验证是否已由飞书侧完成；不存在时报告缺口，但本流程不生成）
   - `weekly.md`
   - `ai.md`
   对周六、周日提前写当周的场景，允许 `daily.md` / `flomo.md` / `weread.md` 是截至运行时的部分覆盖，但 `weekly.md` 和 `ai.md` 仍必须是目标周真实回顾内容。
6. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。`build-bot.md` 属于飞书机器人侧流程；本流程只提示自查，不调用 `build-bot-log`。
7. 运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

8. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 已完成来源、缺口、验证结果
8. 停止，等待用户进入人工 / Chat Pack 阶段。提醒用户按顺序完成：
   - 下一步先去 Learn-X Chat Pack，使用 Weekly Output 功能，结合 `process-pack.md` 生成并审核周报正文；按需读取 `.agents/skills/learn-x-process/resources/weekly-output-rules.md` 和 `layer-rules.md`。
   - 第二步继续在 Chat Pack 中启用 `芒格之魂`，基于同一份 Weekly Output 生成独立洞察，不重写 Weekly Output。
   - 把 `芒格之魂的洞察 & 全文核心重点纪要` 补进最终周报；这一区域可直接作为候选来源，不要求先勾选。
   - 审核并勾选 Memory 候选。
   - 第三步再回复 `继续记忆`，进入 Memory 阶段。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 去 Chat Pack 生成 Weekly Output；再下一步 = 芒格之魂；第三步 = Memory。

## 阶段 3：已审核记忆

目标：生成和迁移已确认的 Memory 候选，并刷新下一周“找事”离线索引。

1. 验证 `04_output/weekly/YYYY-WW.md` 是目标周的实质性周报，不是空壳或模板。
2. 验证同一周报包含非空、实质性的 `芒格之魂的洞察 & 全文核心重点纪要` 区域。缺失时停止，不生成或迁移 Memory。
3. 用户回复 `继续记忆` 视为确认本周图片和公众号发布已人工处理。不得访问、验证、上传或发布微信公众号。
   - `芒格之魂的洞察 & 全文核心重点纪要` 区域本身可直接进入候选抽取，不要求先勾选；阶段 3 直接读取该区域并无损整理。
4. 生成或刷新候选：

   ```bash
   npm run memory:weekly -- --week YYYY-Www
   ```

5. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`。
6. 只迁移：
   - `memory-candidates.md` 中已勾选的 checkbox 条目；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
7. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
8. 将获准条目写入正确的季度 Memory 目标。已勾选的 `法候选` / `术候选` 进入对应候选池。`芒格之魂的洞察 & 全文核心重点纪要` 区域中的内容作为候选观察池的独立候选，不自动升级为正式 `道 / 法 / 术`。
9. 保持幂等。重复运行不得追加完全重复条目。
10. 如果没有获准条目，停止并要求用户勾选或明确确认候选，不要编造 Memory。
11. Memory 写入成功后，在同一阶段执行 `$find-next 更新索引 YYYY-Www`：
   - 先运行 `node /Users/yuwei/code/skills/find-next/scripts/collect-ticktick-ics.mjs /Users/yuwei/code/learn-x`。它只从 macOS Keychain 的 `learn-x-ticktick-ics-url` 读取收集箱 ICS URL，输出 Git 忽略的 `04_output/_dist/find-next/ticktick.md`；不得打印、复制、提交 URL 或写入飞书。
   - TickTick 采集失败时标注缺口，但不阻塞已成功的 Memory 或其他找事索引；本轮找事不得显示旧 To Do。
   - 读取最近四周已完成的 Weekly Output、Process Pack、`input.json`、周记、日记、阅读和既有 `coach.md`；本周与上周按高时效处理。
   - 用 `lark-cli` 离线读取智慧之门近四周记录，只提取主题、一句话精华、创建时间和复看状态；AI Coach 只复用每周已采集的脱敏普通字段。二者都不读取联系方式、访谈原文、附件或链接正文。
   - 读取“找事配置” Base 的启用记录，运行 `$find-next` 的配置校验脚本，将原始快照写入 `04_output/_dist/find-next/evidence/YYYY-Www.config.json`；脚本不归一化权重、不提炼证据、不生成建议。
   - 由 AI 严格依据 `$find-next` 的 Markdown 规则回看最近四周的全部实际来源，生成每周 `evidence/YYYY-Www.md`（来源路径、范围、权重判断、全文阅读/允许压缩状态与缺口）及 `core-context/full.md`、`weighted.md`、`core.md`（三档独立静态核心上下文）。不生成或读取 `current.md`，不得写做 / 学 / 玩 / 思考候选、第一步、优先级或时长。
   - 运行四周证据索引与核心上下文校验。任何外部来源或配置读取失败时，在证据索引中标注缺口且不生成新的核心上下文；不得用旧外部数据伪装为本周更新，也不得阻塞已成功写入的 Memory。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、找事索引路径和状态、验证结果、当前位置、下一步和下次运行。

## 边界

- 不自动访问 AI Chat；但允许把用户在当前对话直接提供的 AI 摘要原样写入 `ai.md`。不主动去拉取、覆盖或改写 AI Chat 历史正文。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不上传图片，不发布微信公众号。
- 屏幕时间例外：仅用户主动上传到当前电脑端 CodeX 对话的三张截图可供 CodeX 目视解析；不向其他服务转发，也不落盘到 Learn-X。
- 不读取 `coach.md` 中 URL 指向的页面正文，不下载 AI Coach 附件，不把联系方式或访谈原文写入仓库。
- 不写入正式 `道/`、`法/` 或 `术` 资产。
- 不按关键词迁移未勾选 Memory 候选。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标周以外的数据。
- 线上采集阻塞时，不降级使用过期本地文件。

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

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
npm run input:voice -- --week 2026-W27
npm run input:daily-coach -- --week 2026-W27
npm run input:wisdom -- --week 2026-W27
npm run process:weekly -- --week 2026-W27
npm run memory:weekly -- --week 2026-W27
```

先按“目标周选择”解析出唯一目标周，再只运行当前阶段需要的命令。飞书 CLI 默认读取使用应用身份（`--as bot`）；涉及多维表格 Base 的新增、更新、修改、删除等写操作使用用户身份（`--as user`）。读取失败时不要自动切换身份，写入失败时报告用户授权问题，不把写操作改回 bot。Flomo 默认使用 `ego-browser`（Ego Lite）独立任务空间，并复用用户登录态。

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
   - 周记日期映射：线上周记标题日期是写作日，不是内容覆盖日。目标 ISO 周的覆盖范围为周一至周日；对应周记标题通常是目标周结束日的下一天（下一周周一），其正文回顾写作日前完整的 7 天。例如 `2026-W31` 覆盖 `2026-07-27`—`2026-08-02`，必须定位 `## 8.3`，不能定位 `## 7.27`。匹配时先由目标周计算“下一日”的 `M.D` 标题，再验证正文覆盖范围；不得用标题所在周、相邻旧条目或本地旧文件替代。
2. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-input/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
   - 如果当前阶段会采集 `weekly.md`，先一次性核对并提示缺失授权，避免逐项打断用户；本 Skill 默认把相关授权合并为一轮确认。
3. 保持当前扁平周目录：`03_input/weekly/YYYY-Www/*.md`。不要恢复旧版 `00_log/`、`01_inbox/`、`02_action/` 嵌套结构。
4. Flomo 默认只使用 `ego-browser`（Ego Lite）：复用同一目标周任务空间，打开或复用 `https://v.flomoapp.com/mine`，复用已有登录态。优先通过 `snapshotText()` 读取笔记创建时间和正文，持续加载直到最早笔记早于目标周下界，遍历全部分页或加载结果；按 Asia/Shanghai 筛选、去重并按创建时间正序输出。任务空间被用户接管、页面需要登录或页面读取失败时停止并报告，不自动切换到 Chrome 插件、CDP 或旧导出。
   - 快速路径：直接新建标签页、写入 Flomo URL 并回车；不要做普通 HTTPS 预检、截图或重复读取完整页面树。
   - 首次读取完整无障碍树后，在内存中扫描时间链接；若最早笔记已早于目标周下界，立即停止。仅当未覆盖下界时滚动加载，并读取增量树后复查。
   - 以 `(创建时间, 正文)` 去重；采集完成后只关闭本次新建标签页，不影响用户原有标签页。
   - 若 Ego Lite 任务空间、自动导航或页面读取失败，停止 Flomo 来源并报告 Ego Lite 异常；不得降级到 Chrome 远程调试、CDP Proxy、其他浏览器插件、读取浏览器凭据或旧本地导出。
   - 当前置顶镜像使用同一次页面读取：以页面明确的“置顶・<原始创建时间>”标记和对应 Flomo memo 链接识别置顶 memo，不按目标周创建时间过滤。只在页面加载完整且恰好识别到 1 条置顶笔记时覆盖 `01_core/道/flomo-top.md`；正文读取 memo 的 `.richText`/正文区域，排除 `.showBtn` 等“展开”控件，不做 AI 总结或改写。识别到 0 条或多条、页面未加载完整或正文提取失败时保留旧文件、继续其他来源，并在阶段 1 汇报中提示，不阻断本周流程。
5. AI Coach 由 `input:daily-coach` 采集并覆盖 `coach.md`。按各表真实字段区分新增与回顾：有创建时间的表按创建时间，服务记录按服务日期，`ai coach thinking` 只排除具备推送轮次、回顾状态和上次推送时间的回顾更新；不得把整个 Coach 文件排除，也不得把更新时间直接当作所有表的新增时间。
7. 不读取、打印或保存凭据。除用户明确授权的 `01_core/道/flomo-top.md` Flomo 镜像外，不修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或无关长期资产。

## 阶段判断

- 定时触发，或用户没有明确继续指令：只执行阶段 1。
- `继续` 按当前流程位置解释：阶段 1 时进入“周记草稿”子阶段；阶段 2 完成后进入阶段 3。不要把同一短指令按固定全局含义解释。
- 阶段 1 或等待周记草稿确认时，用户说 `继续`、`生成周记草稿` 或同义表达：对同一目标周进入“周记草稿”子阶段，先验证 `ai.md`，再调用 `learn-x-weekly-journal`；只生成飞书草稿，不采集 `weekly.md`，不生成 `_dist`。
- 用户说 `周记已确认`、`继续生成周报材料` 或同义表达：对同一目标周进入阶段 2，采集已确认的 `weekly.md` 并生成 `_dist`。
- 阶段 2 完成后，用户说 `继续`、`继续下一步`、`继续记忆`、`报告已完成，写入记忆`、`Memorize`，或确认完整人工步骤已完成：对同一目标周进入阶段 3。此处的 `继续` 视为用户确认已完成阶段 2 汇报中列出的 Chat Pack 人工步骤；阶段 3 仍必须先验证 Weekly Output、芒格之魂洞察和全文核心重点纪要，不能绕过本地门槛硬写 Memory。
- 阶段 1 / 周记草稿阶段的 `继续` 不得跳到阶段 3；阶段 3 只按当前流程位置解析别名。
- 不猜测人工项已经完成。到阶段门槛就停。
- 同一轮自动化中，阶段 1 / 周记草稿 / 2 / 3 必须使用同一个已解析目标周；不要在后续阶段重新按当天日期推断。

## 阶段 1：输入采集

目标：采集自动来源，等待用户完成 `ai.md`，然后才生成飞书周记草稿。

1. 确保 `03_input/weekly/YYYY-Www/` 存在。保留目录中已有的人工内容；不得创建、改写或覆盖 `ai.md`，也不预建 `weekly.md`。缺失时只在对应阶段报告。
2. 采集本地自动来源，并提示飞书机器人侧自查：
   - Flomo：按“启动规则 4”通过 Ego Lite 任务空间打开或复用 `https://v.flomoapp.com/mine`，按 Asia/Shanghai 的目标周起止时间检索；仅在尚未覆盖下界时加载下一批，只把当前页面实际读到、属于目标周的笔记去重后按创建时间正序写入 `flomo.md`。同一次页面读取中，另外同步当前唯一置顶笔记到 `01_core/道/flomo-top.md`：文件包含来源链接、原始创建时间、同步周和正文；每周覆盖更新，不保留旧版本。若置顶数量为 0 或多于 1，保留旧镜像并提示，不阻断其他来源。`flomo.md` 仍只包含目标周数据；旧 `flomo.md` 只作为差异报告依据，不得用来补全当前 Flomo，也不得只取首屏或使用旧本地导出替代。
   - 微信读书：按 `learn-x-input` 执行 `npm run input:weread -- --week YYYY-Www`。验证输出保留目标周、Asia/Shanghai 范围、生成时间、阅读统计、进度快照、个人划线和想法，并包含完整 7 天，包括 0 分钟日期。
   - Time-X 时间：按 `learn-x-input` 执行一次 `npm run input:time -- --week YYYY-Www`，只读取固定 `Time-X｜随时记` 共享日历与屏幕时间 Base。将日历汇总及每个日历块的日期、起止、标题、描述写入 `calendar.md`；将屏幕时间写入 `time.md`。不得读取用户主日历，不保存日历人员、地点、ID、链接或系统元数据。
   - Voice-X：按 `learn-x-input` 执行 `npm run input:voice -- --week YYYY-Www`，按录制时间读取目标 ISO 周且核心重点非空的全部记录，写入 `voice.md`。必须验证分页完成、时间正序和完整核心 Markdown；不得读取或写入原始文字稿。成功查询为 0 条时保留明确的零记录文件，查询或文档失败时保留旧文件并报告。
   - 飞书日记与 AI Coach：执行 `npm run input:daily-coach -- --week YYYY-Www`。采集器先用 `--as bot` 现场核验 Base、表和字段，再按各表边界筛选并遍历全部分页，写入 `daily.md` 与 `coach.md`；只在采集器内排除 Coach 回顾更新，保留同一批次中的新增记录。
   - 智慧之门：执行 `npm run input:wisdom -- --week YYYY-Www`。通过 `collect-base-weekly.mjs`（配置驱动，复用通用核心 `lib/base-collector.mjs`）按创建时间服务端筛目标周并遍历全部分页，写入 `wisdom.md`。既有记录因回顾、复看或状态变化而更新时不采集；只保留脱敏普通字段和 URL，不写联系方式、技术 record id 或链接页面正文。
   - 飞书机器人 Build 复盘：本流程不执行 `build-bot-log`，不生成或追加 `build-bot.md`。必须提示用户：`build-bot-log 需要在飞书机器人上完成，请自查`。
     - 如果目标周是提前写当周，提示用户去飞书上手动执行，并输出自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX
     - 如果不是提前执行，提示用户周日飞书自动化理论上已提前执行，只需自查 `build-bot.md` 是否已由飞书侧写入。
   - Health-X：检查 `03_input/weekly/YYYY-Www/health.md` 是否存在且有实质内容；不存在、空文件或模板/占位内容都视为缺失。它不是本流程生成的自动来源；缺失不阻断 `_dist`，但汇报必须以一级大标题开头提示：`# ⚠️ 缺失输入：health.md`，写明目标周和报告结束日，并给出生成方法：在 `/Users/yuwei/code/health-x` 运行 `npm run validate -- input/YYYY-MM-DD.json`，通过后运行 `npm run sync -- input/YYYY-MM-DD.json`。其中 `YYYY-MM-DD` 是目标 ISO 周的周日，例如 `2026-W31` 使用 `input/2026-08-02.json`。不得用旧文件或手工占位内容补齐；`sync` 成功后应重新检查 Learn-X 的 `health.md`。
   - 如果目标周是周六、周日自动判定的当前周提前稿，`daily.md` / `flomo.md` / `weread.md` / `wisdom.md` / `calendar.md` 可以只覆盖截至运行时；文件和汇报必须标出缺失日期 / 未来日期。
3. 自动来源完成后，提示用户只需手动完成 `ai.md`；飞书周记由下一子阶段先生成草稿，再由用户编辑确认。
4. 阶段 1 不采集飞书周记，不生成飞书周记草稿，不生成 `_dist`。
5. 不访问 AI Chat 或 ChatGPT 历史，也不创建、写入、改写或补全 `ai.md` 正文。
6. 读取 `02_prompts/meta/_ai-chat-extract-prompt.md` 的当前正文，并把它原样放进本轮最终用户可见回复的 Markdown 代码块中。不能只放在工具输出、内部思考、折叠评论或文件链接里；不能摘要、改写、截断或用省略号替代。该代码块是阶段 1 汇报的硬性交付物。
7. 在同一最终回复中明确提示用户：复制上方完整提示词到 AI Chat，手动生成并保存 `03_input/weekly/YYYY-Www/ai.md`，然后回复 `继续`。下一子阶段会自动生成飞书周记草稿；用户不应在此时手工创建 `weekly.md`。若最终回复未包含完整提示词，不得声称阶段 1 汇报完成。

阶段 1 汇报必须包含：目标周、已完成来源、缺失或部分完成来源、`daily.md` / `flomo.md` / `01_core/道/flomo-top.md` / `weread.md` / `voice.md` / `coach.md` / `calendar.md` / `wisdom.md` / `health.md` 状态、完整 AI 摘要提示词代码块、当前位置、下一步（手动完成 `ai.md` 后回复“继续”）、再下一步（自动生成周记草稿）。提示词必须出现在最终用户可见回复中；这是阶段 1 的最后一道汇报门槛。

## 周记草稿：生成与人工确认

目标：只从已落盘周输入生成飞书周记草稿，停在人工确认门槛前。

1. 验证 `daily.md`、`flomo.md` 与用户手动完成的 `ai.md`；无效时停止，不写飞书、不采集 `weekly.md`、不生成 `_dist`。
2. 调用 `learn-x-weekly-journal`。它按目标周结束日的下一天定位周记标题，复制模板并只填新模板的安全空位；已有实质内容或草稿时跳过，不覆盖、不刷新。
3. 成功后停止，提示用户在飞书周记中编辑并确认草稿，移除主标题中的 `【待优化】AI 基础草稿` 标记；正文细项不应出现该标记。
4. 用户确认后必须回复 `周记已确认` 或 `继续生成周报材料`；只有该指令才能进入阶段 2。

本子阶段汇报必须包含目标周、使用的本地来源、飞书草稿链接、跳过字段、阻塞项、当前位置、下一步（人工确认周记）和再下一步（阶段 2 采集 `weekly.md` 并生成 `_dist`）。

## 阶段 2：周记采集与报告准备

目标：采集已人工确认的周记，验证必要输入，然后生成 `_dist` 和 Output 最小壳。

1. 先验证 `ai.md`。它必须非空、不是模板、不是提取提示词本身、不是自动缺口说明，并且包含目标周真实回顾内容。无效时立即停止，不采集 weekly，不生成 `_dist`，并再次展示 AI 摘要提示词。不得由自动化代写 `ai.md`。
2. `ai.md` 通过后，按“周记日期映射”计算写作日，通过飞书 CLI 从已登录的线上飞书周记文档采集该写作日对应的目标周周记。不能把写作日当天所在的 ISO 周当作覆盖周。只截取目标覆盖范围的段落；`weekly.md` 必须同时保留来源 URL、写作日标题、目标覆盖范围、定位依据和采集时间。目标段落主标题仍含 `【待优化】AI 基础草稿` 时视为未确认，停止，不得用旧本地内容替代。
   - 采集前如果发现缺少飞书周记所需授权，先一次性列出并请求全部缺失 scopes，再继续，不要一项一项分开打断用户。
3. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `voice.md`（必须来自本次成功查询；只含目标周核心重点全文，不含原始文字稿）
   - `calendar.md`（只作计划上下文，缺失或不可用时报告但不将其当作行动证据）
   - `coach.md`（应为本次采集生成；包含新增记录并标注采集器排除的回顾更新）
   - `wisdom.md`（采集器按创建时间生成；不由 Input 再做内容排除）
   - `health.md`（可选；缺失不阻断，但汇报必须先用一级大标题显著提示，并附 Health-X 生成命令）
   - `build-bot.md`（只验证是否已由飞书侧完成；不存在时报告缺口，但本流程不生成）
   - `weekly.md`
   - `ai.md`
   对周六、周日提前写当周的场景，允许 `daily.md` / `flomo.md` / `weread.md` 是截至运行时的部分覆盖，但 `weekly.md` 和 `ai.md` 仍必须是目标周真实回顾内容。
6. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。`build-bot.md` 属于飞书机器人侧流程；本流程只提示自查，不调用 `build-bot-log`。
7. 运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

9. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 已完成来源、缺口、验证结果
10. 停止，等待用户完成一个人工 / Chat Pack 步骤：结合 `process-pack.md` 生成并审核 Weekly Output；在同一次操作中启用 `芒格之魂` 生成独立洞察，补全 `芒格之魂的洞察 & 全文核心重点纪要`，并审核 Memory 候选。按需读取 `.agents/skills/learn-x-process/resources/weekly-output-rules.md` 和 `layer-rules.md`。全部完成后回复 `继续`、`继续下一步` 或 `继续记忆`，进入阶段 3。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 在 Chat Pack 一次完成并审核 Weekly Output、芒格之魂、核心纪要和 Memory 候选；再下一步 = 阶段 3 Memory。不得把这些人工审核项拆成多个阶段。
若 `health.md` 缺失，阶段 1 / 阶段 2 汇报的第一段必须是一级大标题 `# ⚠️ 缺失输入：health.md`，并同时给出目标周、报告结束日和 Health-X 的 `validate` / `sync` 命令；不能把缺失藏在普通缺口列表中。

## 阶段 3：已审核记忆

目标：生成和迁移已确认的 Memory 候选，并刷新下一周“找事”离线索引。

1. 验证 `04_output/weekly/YYYY-WW.md` 是目标周的实质性周报，不是空壳或模板。
2. 验证同一周报包含非空、实质性的 `芒格之魂的洞察 & 全文核心重点纪要` 区域。缺失时停止，不生成或迁移 Memory。
3. 用户从阶段 2 完成状态回复 `继续`、`继续下一步` 或 `继续记忆`，视为确认本周 Weekly Output、芒格之魂、核心纪要和 Memory 候选已人工审核。不得访问、验证或发布任何外部内容。若当前并非阶段 2 完成状态，`继续`按前序阶段规则解释，不得直接进入这里。
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
11. Memory 写入成功后，在同一阶段执行 `$ywnext 更新索引 YYYY-Www`：
   - 读取 `01_core/memory/*.memory.md`；Memory 已承接最近四周及长期校准，因此 Weekly Output、Process Pack、`input.json`、周记、日记、阅读、智慧之门、AI Coach 和其他原始周输入不进入 YW Next 语义上下文。
   - 找事配置、常做清单和最近计划只作为运行控制输入，不写入个人核心上下文；不得用它们补充 Memory 缺口。
   - 读取“找事配置” Base 的启用记录，运行 `$ywnext` 的配置校验脚本，将原始快照写入 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.config.json`；脚本不归一化权重、不提炼证据、不生成建议。
   - 由 AI 严格依据 `$ywnext` 的 Markdown 规则阅读 Memory，生成 `/Users/yuwei/code/skills/ywnext/runtime/evidence/YYYY-Www.md`（Memory 来源路径、范围、全文阅读状态与缺口）及 `runtime/core-context/full.md`、`weighted.md`、`core.md`（三档独立静态核心上下文）。不生成或读取 `current.md`。
   - 继续生成仅供 YW Next 使用的 `runtime/core-context/full-full.md`：只全文保留 `01_core/memory/*.memory.md`，再由 AI 仅基于该文件生成 `/Users/yuwei/code/skills/ywnext/runtime/candidate-list.md`，做、学、玩、思考各 20 条，含详情、适用条件与候选权重。候选不另存周度快照。
   - 运行 Memory 证据、三档核心上下文、full-full Memory-only 与候选清单校验。配置读取失败时，在证据索引中标注缺口且不生成新的核心上下文或候选清单；不得用旧外部数据伪装为本次更新，也不得阻塞已成功写入的 Memory。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、找事索引路径和状态、验证结果、当前位置、下一步和下次运行。

## 边界

- 不自动访问 AI Chat，也不把用户在当前对话直接提供的摘要写入 `ai.md`；用户必须手动保存并维护该文件。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不读取 `coach.md` 中 URL 指向的页面正文，不下载 AI Coach 附件，不把联系方式或访谈原文写入仓库。
- 不自动生成或升级正式 `道/`、`法/`、`术` 内容；用户明确授权的 `01_core/道/flomo-top.md` 仅作为 Flomo 单向镜像例外，成功采集时允许覆盖更新。
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

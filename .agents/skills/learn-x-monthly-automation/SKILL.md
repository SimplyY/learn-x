---
name: learn-x-monthly-automation
description: Learn-X 月度自动化中文工作流。Use when the user asks to generate a monthly journal draft from local weekly input, prepare monthly input, generate Monthly Output `_dist` / Process Pack / Output shell, or migrate reviewed monthly Memory candidates.
---

# Learn-X 月度自动化

## 总览

把本 Skill 作为月度固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用 `learn-x-monthly-journal`、`learn-x-process` 和现有 npm 命令。除非 Markdown 流程反复执行失败，否则不要新增编排脚本。

## 快速命令

```bash
npm run chatgpt:monthly-understanding -- --month 2026-06
npm run process:monthly -- --month 2026-06
npm run memory:monthly -- 2026-06
npm run memory:compress -- --as-of 2026-08-30
```

先解析唯一目标月，再只执行当前阶段需要的步骤。默认目标月是 `Asia/Shanghai` 的上个月；用户明确指定 `YYYY-MM`、`本月`、`这个月`、`上月` 时，按用户指定。

## 启动规则

1. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-monthly-journal/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
2. 月度输入目录使用 `03_input/monthly/YYYY-M/`，例如 `03_input/monthly/2026-6/`。不要按文件 mtime 推断范围。
3. 月度报告流程只生成 `_dist` 和 `04_output/monthly/YYYY-MM.md` 最小壳；不要在自动化中代写 Monthly Output 正文。
4. 不读取、打印或保存凭据。不修改 `README.md`、`01_core/道/`、`01_core/法/` 或无关长期资产；本流程专用的两个 ChatGPT 导出提示词和两个本地私有导出文件除外。
5. 月度原始输入同时来自 `03_input/weekly/YYYY-Www/` 和 `03_input/monthly/YYYY-M/`；后者保存月记及其他月度独有来源。读取周目录时复用 `_source-status.json`：只有 `ready` 自动来源进入月度输入，`empty/failed/unavailable` 的旧文件保留但排除；缺失侧车兼容历史周，非法侧车失败关闭。另读取各周 `04_output/weekly/YYYY-WW.md` 中系统确认的标题 10「全文核心重点纪要」和标题 11「芒格之魂的洞察」，空项或 `todo` 跳过；不得读取其它周报正文代替原始输入。
6. 原始文件完整留在 `03_input/`，不要复制成月度全文合集。`input.json` 只保存路径、哈希、处理状态和压缩统计；`process-pack.md` 才是给 AI Chat 的自包含上下文。
7. 月度只保留目标月事件。边界周按正文日期、声明覆盖期和周记标题过滤；无法确认归属时省略并报告，不猜测。
8. 月度 Process Pack 使用固定层级：完整性与缺口、月度核心判断、自我反馈与生命状态、行动与现实反馈、支撑性输入、来源与处理审计。来源内部标题必须降为四级标题，不能破坏目录树。

## 输出链接规则

- 每次运行的最终汇报必须提供可点击 Markdown 链接，不只输出裸路径。
- 阶段 1 若写回飞书月记：提供目标月份 section 的飞书链接，格式为 `https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac#<target-month-block-id>`；写回后重新 fetch outline/section，使用最新 block id。
- 阶段 1 同时提供月度输入目录的本地绝对路径链接；目录为空也要明确说明。
- 阶段 2 提供 `monthly-journal.md`、`input.json`、`process-pack.md` 和 Output 壳的本地绝对路径链接。
- 阶段 2 的“下一步”必须提供 [Learn-X Chat Pack](http://127.0.0.1:4173/#learning) 链接；不要只写“去 Chat Pack”。
- 阶段 3 提供候选文件和实际写入的 Memory 文件链接。
- 链接必须放在“已完成来源或产物”附近；如果产物不存在，不生成假链接，直接写明缺口。

## 阶段判断

- 定时触发，或用户没有明确继续指令：只执行阶段 1。
- 用户说 `继续`、`月记已完成`、`继续生成月报材料` 或同义表达：对同一目标月执行阶段 2。`继续` 不得绕过阶段 1 的“全部相交周记已确认”门槛。
- 用户说 `继续记忆`、`月报已完成，写入记忆`、`Memorize`，或确认 Monthly Output / 芒格洞察 / 候选审核已完成：对同一目标月执行阶段 3。
- 不猜测人工项已经完成。到阶段门槛就停。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标月；不要在后续阶段重新按当天日期推断。

## 阶段 1：月度输入准备

目标：先以非阻塞方式导出 ChatGPT 对用户的理解，再从可安全使用的已落盘周输入生成可编辑的飞书月记草稿；缺失/未确认周只作为醒目的人工补齐提示，不阻塞阶段 1。然后停止，等待用户人工完成月记。

1. 先执行 `npm run chatgpt:monthly-understanding -- --month YYYY-MM`。它通过 `chatgpt-web-bridge` 分两次独立的新聊天发送两个全量提示词；两次都不附本地基线或 Learn-X 内容，且两次请求默认间隔至少 5 分钟。两次都成功通过脱敏、字数校验后，才写入两个本地私有文件。当前文件之间的统一 diff 仅在本地生成，用于审计，不作为 ChatGPT 输入。
2. ChatGPT 导出是 best-effort：Bridge 不可用、本地保护冷却、服务端限流、登录失效、输出不合格或脱敏校验失败时，记录 `needs_review`，在汇报中以 `⚠️ ChatGPT 理解导出失败（不阻塞月度流程）` 明显说明，然后继续本阶段其余步骤；不得自动重发不确定的已提交请求，也不得绕过 Bridge 的共享冷却。
3. 确保 `03_input/monthly/YYYY-M/` 存在。保留目录中已有人工内容，不覆盖已有非空文件。
4. 检查所有与目标月相交的周目录；实质性、已确认的 `weekly.md` 才进入“已确认周”范围。文件缺失、为空、模板化或仍含 `【待优化】AI 基础草稿` 时，不再阻塞阶段 1：列出缺周/未确认周，并将该周标为“待人工补齐”；自动草稿不得把该周内容写成已确认事实。`_source-status.json` 非法、来源哈希或文件完整性无法判断时仍停止，避免把损坏数据当成普通缺口。
5. 检查完成后调用 `learn-x-monthly-journal`。它只从可安全使用的相交周与月度目录本地文件读取事实，按现有月度聚合的日期过滤、去重与边界规则生成“可编辑的部分草稿”；不得重新读取 Daily Base 或线上周记作为事实源。缺周/未确认周在汇报中醒目标记，并保留给用户手动补写，不得猜测或伪造。
6. `learn-x-monthly-journal` 只在目标月不存在或有明确安全空位时写入主标题带 `【待优化】AI 基础草稿` 的部分草稿；若目标月已存在实质性正文、草稿或不存在安全空位，则跳过写回，只报告链接与原因。草稿生成不等于周记门槛确认。
7. 只报告本地来源范围、已确认周范围、月记状态和缺口，不提前生成 Monthly Output。
8. 月度输入准备完成后旁路运行一次 Memory 压缩预览：先执行 `npm run memory:compress -- --as-of YYYY-MM-DD`，再由 Codex 按 `learn-x-process/resources/memory-compression-rules.md` 在 `_dist/memory-compression/YYYY-MM/` 生成候选并执行 `--validate`。压缩预览失败只记录 `needs_review`，不阻断月记、月报或既有阶段门禁。
9. 停止并提示用户在飞书月记中编辑确认、补齐缺失/未确认周的内容、移除所有草稿标记，然后回复 `继续`。阶段 2 仍会再次检查所有相交周是否确认；压缩候选另行等待人工修改；定时任务不执行晋级。

阶段 1 汇报必须包含：目标月、ChatGPT 导出状态、成功时的自我阅读版全文、完整 `diff` 代码块和两个本地文件链接；以及月记草稿状态（含可点击飞书草稿链接）、已确认周范围、使用的本地来源、可点击的 `03_input/monthly/YYYY-M/` 路径、缺口、当前位置、下一步、再下一步。

## 阶段 2：月记采集与月报准备

目标：用飞书 CLI 采集已完成月记，生成 Monthly Output `_dist` 和 Output 最小壳。

1. 通过飞书 CLI 从月记文档采集目标月月记：

   ```text
   https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac
   ```

   只采集目标月 section。`monthly-journal.md` 必须保留来源 URL、标题或日期定位依据、采集时间。无法取得目标月正文时停止，不得用旧本地内容替代。
2. 验证 `03_input/monthly/YYYY-M/monthly-journal.md` 是已确认定稿，不含 `【待优化】AI 基础草稿`；并再次验证所有相交周的 `weekly.md` 均已确认。旧 `weekly-inputs.md` 不参与处理。任一周或月记未确认时停止，不生成 `_dist`。
3. 首次运行：

   ```bash
   npm run process:monthly -- --month YYYY-MM
   ```

4. 如果命令生成 `compression-requests.json` 并停止：
   - 完整读取 [`references/monthly-compression.md`](references/monthly-compression.md)。
   - 逐份读取请求指向的原始文件，由 Codex 按事件和重要性生成 `compressed-events.json`。
   - 再次运行同一个 `process:monthly` 命令；不得用脚本截断、关键词摘要或外部 AI API 代替 Codex 判断。
5. 汇报：
   - `04_output/_dist/monthly/YYYY-MM/input.json`
   - `04_output/_dist/monthly/YYYY-MM/process-pack.md`
   - `04_output/monthly/YYYY-MM.md`
   - 已完成来源、缺口、验证结果
   - 原始、过滤后、压缩后和最终体积；各来源压缩率、事件数量、省略原因、越界与无效来源
   - 明确说明：语义压缩由 Codex 完成，脚本只检测、校验和组装
6. 停止，等待用户进入人工 / Chat Pack 阶段。提醒用户按顺序完成：
   - 在 Learn-X Chat Pack 中使用 Monthly Output，并选择 `process-pack.md`。
   - 在 Chat Pack 中启用 `芒格之魂`，只生成独立洞察，不重写 Monthly Output。
   - 在最终月报中补充非空的 `芒格之魂的洞察` 或同义区域。
   - 审核并勾选 Memory 候选。
   - 回复 `继续记忆`。

阶段 2 汇报必须包含完整全局流程，并使用醒目的大标题：

## 下一步：打开 Learn-X Chat Pack，手动生成并审核月报

提供 [Learn-X Chat Pack](http://127.0.0.1:4173/#learning) 链接，并说明用户需要选择 Monthly Output、载入 `process-pack.md`、生成并审核月报，再生成独立“芒格之魂”洞察。

## 再下一步：补充洞察并回复“继续记忆”

说明用户需要把洞察补入月报、审核 Memory 候选，完成后再回复“继续记忆”。阶段 2 的结束语必须明确宣布：`阶段 2 已完成，等待用户手动完成；用户完成后再通知 Codex。`

## 阶段 3：已审核记忆

目标：生成 Memory 候选，只迁移已审核、已确认内容。

1. 验证 `04_output/monthly/YYYY-MM.md` 是目标月的实质性月报，不是空壳或模板。
2. 验证同一月报包含非空、实质性的 `芒格之魂` 洞察区域。缺失时停止，不生成或迁移 Memory。
3. 生成或刷新候选：

   ```bash
   npm run memory:monthly -- YYYY-MM
   ```

4. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/monthly/YYYY-MM/memory-candidates.md`。
5. 只迁移：
   - `memory-candidates.md` 中候选区内已勾选的 checkbox 条目；
   - 精确标题为「全文核心重点纪要」和「芒格之魂的洞察」的非空最终章节；
   - 用户在当前线程明确确认写入的条目。
6. 不迁移未勾选条目。普通正文、主题标题、行动计划、评分，以及 `重要`、`保留`、`确认`、`继续追踪` 等关键词都不构成确认；道 / 法 / 术 / 器候选即使勾选，也只进入季度候选观察池，不进入普通 Memory。
7. 将获准条目写入正确的季度或年度 Memory 目标。保持幂等，重复运行不得追加完全重复条目。
8. 如果没有获准条目，停止并要求用户勾选或明确确认候选，不要编造 Memory。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、验证结果、当前位置、下一步和下次运行。

## Memory 月度压缩旁路

每月目标月解析后最多生成一次压缩预览。当前月、跨越当前月的周块和无法识别来源的条目保护；当前季度较早月份可压缩。已有候选且源哈希未变时只报告“待人工审核”并保留用户修改，源变化时标记 `stale`，不覆盖候选。

候选和 comparison 报告必须先展示 Codex 通读本文件原文与候选后生成的 `changeSummary`：具体说明 2—4 个最主要的实质变化，并只指出本次最核心的一项语义风险；至少包含两个当前文件特有的主题或具象锚点，禁止由脚本套用固定句式。详细提示词见 `learn-x-process/resources/memory-compression-rules.md`。随后以精简表格给出 5—10 条可读的“核心变化”，逐项说明字数变化（风险写在括号内）、之前/现在的内容，并按风险从高到低、同风险按净减少字数排序；实际改动量按字符级删除加新增计算，净减少不超过 10 字但替换超过 10 字的改写仍需展示。实际改动量不超过 10 字的变化按类型归类，超过 10 字但未入选核心的变化只做汇总，不逐条铺开。非删除类变化表把原文和压缩后拆成两列，风险并入改动说明；保护范围和量化校验后置。核心摘要不能代替整体压缩量。语义合并必须保留重要、反复出现且承载证据或行动的具象锚点，例如 `出门`、`读书会`、`写诗`、`运动`、人物、地点、项目和方法名，不能把它们全部改写成抽象标签。`changeSummary`、`coreDifferences` 和 `otherChanges` 位于候选旁的 `.memory-compression.json`，缺失时标记 `needs_review`。人工修改后先运行：

```bash
npm run memory:compress -- --validate 04_output/_dist/memory-compression/YYYY-MM
```

验证通过并完成单独确认后，才可运行 `--promote <候选目录> --confirm`。晋级会归档旧季度文件并原子替换；不会自动新增 Flomo、刷新外部系统或把“继续记忆”当作压缩确认。

## 边界

- 只允许阶段 1 通过 `chatgpt-web-bridge` 导出两份 ChatGPT 理解；不发送 Learn-X 输入、Output、道、法或凭据，不在自动化中生成 Monthly Output 正文。
- 允许 Codex 为 Process Pack 生成 `_dist` 压缩事件；这不是 Monthly Output，也不得写回原始 Input。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不写入正式 `道/`、`法/` 或 `术` 资产。
- 不按关键词迁移未勾选 Memory 候选。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标月以外的数据。
- 线上或飞书采集阻塞时，不降级使用过期本地文件。

## 汇报格式

每次运行必须包含：

- 目标月。
- 全局流程，并标记当前阶段。
- 已完成来源或产物。
- 阻塞项和缺口。
- 当前位置。
- 下一步。
- 再下一步。

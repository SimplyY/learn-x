# 03_input Usage

> 本文件描述 Weekly Input 在 `_dist` 生成前的输入管理。

Feishu Docs 每周输入采集已暂时停用。历史 `feishu-docs.md` 报告保留，但不会进入 Process。

月度 Process 直接读取相交周的原文件，并叠加 `monthly/YYYY-M/` 下的月记及其他月度独有输入。旧 `weekly-inputs.md` 不再使用。原始文件保持完整；给 AI 的月度 Process Pack 另行执行日期过滤、元数据合并、去重和受约束的事件压缩。周记、月记草稿也只以这些已落盘文件为事实源；飞书只承载模板、草稿和人工定稿。

`03_input/weekly/YYYY-Www/` 采用扁平 Markdown 结构。只保留本周确实有内容的输入文件，不预建分类目录或大量空占位。自动来源的空结果写入 `_source-status.json`，不生成新来源文件；旧文件可保留但会被状态过滤。

## 输入来源

| 来源 | 文件 | 方式 |
| --- | --- | --- |
| 飞书日记 | `daily.md` | `npm run input:daily-coach -- --week YYYY-Www` |
| 飞书周记 / 周复盘 | `weekly.md` | 自动生成草稿、用户确认后由阶段 2 采集定稿 |
| Flomo | `flomo.md` | `npm run input:flomo`；从线上完整扫描快照提取目标周，稳定到底且身份、时间、正文校验通过、全库漏项不超过10条时可发布，并标明预期数、观察数、遗漏数与覆盖率 |
| 微信读书 | `weread.md` | `npm run input:weread -- --week YYYY-Www` |
| Voice-X 核心重点 | `voice.md` | `npm run input:voice -- --week YYYY-Www` |
| Time-X 随时记日历 | `calendar.md` | `npm run input:calendar -- --week YYYY-Www` |
| Health-X 健康周报 | `health.md` | Learn-X `weekly:retry` 调用 `input:health` 从 Health-X 已上传输入执行 report-only 生成 |
| AI Coach | `coach.md`（有记录时） | 保留新增记录；0 条时不生成文件并写入状态侧车 |
| 智慧之门新增记录 | `wisdom.md`（有记录时） | `npm run input:wisdom -- --week YYYY-Www`；普通记录按 Base 创建时间、Flomo 导入记录按原始 Flomo 创建时间归周，0 条时不生成文件并写入状态侧车 |
| AI 对话摘要 | `ai.generated.md` → `ai.md` | 阶段 1 自动生成并经结构校验后转正，用户复核；失败时使用 fallback prompt 手动生成 |
| Codex / Code X 构建复盘 | `build.md` | 专项自动化或人工补充 |
| 飞书机器人 Build 复盘 | `build-bot.md` | 飞书机器人侧生成；本地周自动化只提示自查 |
| 历史行动回捞（已退役） | `open-actions.md`（历史遗留） | `action:feedback` 命令已随 Action Feedback 退役被守卫拒绝，不再可执行 |
| 调研等其他重要输入 | `research.md` 或语义清楚的 `<source>.md` | 按需补充 |

`learn-x-process` 不联网采集，也不判断材料价值；它只读取指定周目录，生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。

### Flomo 线上快照

`npm run input:flomo` 通过周流程执行器完成线上全量扫描，并从同一次已验证结果生成目标周 `flomo.md`。每周一 00:10 的 Flomo 专项自动化先同步上一个完整 ISO 周；周一 05:00 主流程消费同周状态，成功时不重复扫描，07:00 补救流程仍可恢复未成功来源。全量扫描刷新活动快照中的全库状态；周输入仍只按笔记创建时间收录目标周新建笔记，旧笔记编辑只更新快照。`flomo.md` 文件头记录与本轮内容同源的快照 ID 和采集时间。完整性校验失败时不会激活新快照，失败状态也不会替代最后一次成功快照。每日 Flomo 回顾读取最近一次成功的本地快照，不访问浏览器；预览与消息会显示该快照的采集时间和覆盖率。旧历史 Markdown 只作迁移审计，不用于补建每日候选库。

全量扫描必须稳定到底，且每张已观察卡片都有有效 memo ID、创建时间和完整正文。同 ID 正文冲突、缺 ID/时间/正文、分页不稳定或全库遗漏超过10条时，本次失败并保留最近成功快照与旧周文件。完整性校验通过且遗漏不超过10条时，目标周文件可以标记 `ready`；文件头和 `_source-status.json` 必须同时说明预期数、观察数、遗漏数和覆盖率。若本周扫描失败，每日流程仍可显示并使用旧成功快照，但本周来源侧车必须如实失败，不能据此生成 `ready` 周输入。此同步不是实时更新；编辑和删除会在下次成功全量同步后反映。

## 每周流程

### 1. 建本周目录

```bash
mkdir -p 03_input/weekly/YYYY-Www
cp 03_input/weekly/00_template/*.md 03_input/weekly/YYYY-Www/
rm 03_input/weekly/YYYY-Www/README.md
```

采集结束后删除仍为空的模板文件；自动来源旧文件即使保留，也已由状态侧车标记并不会进入本轮处理。

### 2. 采集与补充

每周流程分为“输入与草稿 → Process Pack → Weekly Output 与 Memory”三个阶段：

0. 自动判断目标周：未指定时，周一至周五默认处理上一 ISO 周；周六、周日默认处理当前 ISO 周。周三至周五运行时需要提示“现在仍是周中，默认处理上一周”；周六、周日处理当前周时视为提前写当周，只能声明覆盖截至运行时。
1. 采集所有自动来源并更新 `_source-status.json`；成功空结果统一报告“0 条记录，文件未生成”，失败/不可用单独报告。此阶段不采集周记，不生成 `input.json`、`process-pack.md` 或 Weekly Output 壳。
2. 自动化读取 `03_input/weekly/00_template/ai.md`，通过全局 ChatGPT Web Bridge 在已登录 ChatGPT 新聊天中生成 `ai.generated.md`；不发送本地周输入材料。失败时报告可手动复制的 fallback prompt。
3. 自动化生成飞书周记草稿（Action Feedback 已退役，不再有配套草稿）。用户审核、修改；只有用户回复“周记已确认”后才进入阶段 2。阶段 2 采集确认后的 `weekly.md`，随后仅发布唯一“新周计划”表格行到 `04_output/_dist/shared-context/current.json`（版本放在同目录 `weekly/` 下），再生成 `input.json`、Process Pack 和 Weekly Output 壳。
4. 用户基于最新 Process Pack 完成 `04_output/weekly/YYYY-WW.md`、核心内容和 Memory 候选审核后，回复继续进入阶段 3。阶段 3 先生成并校验 `memory-candidates.md`，再展示包含正式 Memory、图片、备份、YW Next 和 Flomo 目标的唯一确认卡（Action Feedback Base 已退役）；用户确认后按“正式 Memory → ChatGPT Bridge 核心图（写入 `04_output/_dist/weekly/YYYY-Www/weekly-core.png`）→ 备份 / YW Next / Flomo”执行。公众号发布仍由用户人工完成。

要求：

- `daily.md` 的飞书多维表格材料必须保留字段表头和 field id 映射。
- `flomo.md` 必须覆盖完整目标周；若只能部分获取，在文件中说明缺口。
- `weread.md` 保留采集范围、时区、生成时间、统计、进度快照、个人划线和想法；不保存 ID、位置链接或额外 `_raw.json`。
- `voice.md` 只保留目标录制周内非空的完整结构化洞察，按录制时间正序；保留核心总结、压缩原文、建议和芒格之魂洞察，不读取或复制原始文字稿。30,000 个 Unicode 字符是提示线，不是采集门槛；Voice-X 只在统一生成 Process Pack 时按约 20% 保留比例做确定性高信号压缩，查询或文档读取失败不得覆盖旧文件。
- 若历史返回同一 `revision_id` 的多个 `history_version_id`，属历史接口正常返回（同一账号短时间多次保存）；只要该 revision 的编辑者归属唯一，就按一个本人版本处理，不整单失败。编辑者归属冲突时保持 `needs_review`。
- 2026-09-22 writer 盘点：已把 Learn-X 深度研究、月度议题工作台、季度议题总览、周期洞察、长文入库，Voice-X Docx，Read-X long-read 示例，Invest-X 基金校准、委员会写回、文档迁移，以及 Skills 全局治理、Prompt 治理、ywask、thinking-group 报告写入口固定为 `--as bot`；Base 写入继续使用用户身份。仍需单独核实的路径是 Invest-X asset-report 实际发布调用、Invest-X 事件目录创建，以及 Skills 中没有脚本写入口的交互式命令。在线 Bot 写后读回已用专用 canary 验证；这些未核实路径完成前继续保持影子状态。
- `calendar.md` 来自 `Time-X｜随时记` 共享日历与用户个人日历（主日历及自有共享日历，覆盖用户手动建日程）的合并，按同时存在的定时日程数分摊重叠时间，保留目标周有效时间汇总及每个日历块的日期、起止、原始区间、标题、描述和有效投入分钟；不保存人员、地点、ID、链接或系统元数据，且不单独作为实际完成证据。读取失败时必须写明不可用，不能沿用旧统计。详见 `docs/calendar-time-allocation.md`。
- `health.md` 只保存周度评分、核心数据和健康提示，不复制截图或原始医疗材料。
- `coach.md` 采集器按表字段保留新增记录，并排除回顾或状态更新；0 条新增记录时不生成文件并记录 `empty`，旧文件若存在也不进入本轮。
- `wisdom.md` 只收录目标周内的新来源事件：普通记录按 Base “创建时间”筛选，`来源标识` 以 `flomo:` 开头的记录按“Flomo创建时间”筛选，以支持目标周结束后导入的周内 Flomo 笔记。既有记录因回顾、复看或状态变化而更新时不采集；本地文件不保留 Flomo 技术 ID；0 条时记录 `empty`，失败与不可用不得伪装成 0 条。
- 所有自动来源都遵循同一状态侧车规则：`ready` 才能被 Process / 月度流程读取，`empty/failed/unavailable/needs_review` 的旧文件只保留不计入本轮；缺失侧车兼容历史周，非法侧车失败关闭。
- `ai.md` 是确认后的 AI 对话摘要。阶段 1 默认生成暂存的 `ai.generated.md`；确认前不进入 Process，确认后才转为 `ai.md`。AI 输入只使用原有提示词和目标周范围，不发送本地周输入材料。
- `build.md` 由 Codex Build 专项自动化或人工补充，每周输入自动采集不处理。
- `build-bot.md` 由飞书机器人侧的 `build-bot-log` 生成或追加。提前写当周时，用户需在飞书上手动执行并自查自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX；非提前执行时，周日飞书自动化理论上已执行，本地周自动化只提示自查。
- 已经通过阶段 2 确认门禁的历史 `weekly.md` 可用 `npm run publish:weekly-context -- --week YYYY-Www` 迁移发布；该命令只读本地文件，不回读飞书。不得对草稿、未确认或无法证明已确认的周记运行。
- 阶段 3 只处理已确认的行动反馈变更、Output、Memory candidates 和季度 Memory，不重新采集输入，也不修改正式 `道/`、`法/`、`术/`。
- 其他材料只有足够重要时才新增为 Markdown，不为空分类预建文件。

### 周输入超限与批量压缩

- `npm run process:weekly` 对普通输入保留字数校验；Voice-X 的 `voice.md` 允许完整落盘，30,000 字符只触发 Process Pack 强提示，随后在该环节统一压缩一次。
- `npm run input:compress -- --week YYYY-Www` 只处理普通周输入的审核候选；Voice-X 不在采集阶段单独压缩。
- 普通输入候选必须人工检查，确认没有坏数据且核心判断仍完整后，才可执行 `npm run input:compress -- --week YYYY-Www --apply --confirm`；Voice-X 不走该候选流程，也不允许机械截断。

### 3. 生成 Weekly Output Dist

```bash
npm run process:weekly -- --week YYYY-Www
```

脚本生成：

- `04_output/_dist/weekly/YYYY-Www/input.json`
- `04_output/_dist/weekly/YYYY-Www/process-pack.md`
- `04_output/weekly/YYYY-WW.md` 最小壳（仅在不存在或为空时）

## 每周检查

- [ ] 本周目录存在，根部没有来源分类子目录。
- [ ] 目录中只有本周重要的 Markdown 输入。
- [ ] 自动采集项按实际情况生成：`daily.md`、`flomo.md`、`weread.md`、`voice.md`、`calendar.md`、`wisdom.md`、`coach.md`；`coach.md` 必须是本次采集覆盖后的筛选结果。
- [ ] 阶段 1 已生成 `ai.generated.md` 或记录 fallback；用户确认后才转正为 `ai.md`；飞书周记草稿已人工确认并移除草稿标记，随后采回为 `weekly.md`。
- [ ] `build.md` 已写入或明确报告缺口。
- [ ] `build-bot.md` 已写入或明确报告缺口。
- [ ] 空模板文件已经删除；自动来源旧文件即使保留，也已由状态侧车标记并不会进入本轮处理。
- [ ] `_dist` 已生成并核对来源路径。
- [ ] 后续输出按 `04_output/usage.md` 进行。

## 边界

- 不按文件修改时间推断本周范围，不跨周扫描。
- 不把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进输入区。
- 不让采集自动化或 `learn-x-process` 直接做长期价值判断。
- 不让目录分类反过来要求用户保留低价值输入。

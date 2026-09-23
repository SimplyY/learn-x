# 03_input Usage

> 本文件描述 Weekly Input 在 `_dist` 生成前的输入管理。

月度 Process 直接读取相交周的原文件，并叠加 `monthly/YYYY-M/` 下的月记及其他月度独有输入。旧 `weekly-inputs.md` 不再使用。原始文件保持完整；给 AI 的月度 Process Pack 另行执行日期过滤、元数据合并、去重和受约束的事件压缩。周记、月记草稿也只以这些已落盘文件为事实源；飞书只承载模板、草稿和人工定稿。

`03_input/weekly/YYYY-Www/` 采用扁平 Markdown 结构。只保留本周确实有内容的输入文件，不预建分类目录或大量空占位。自动来源的空结果写入 `_source-status.json`，不生成新来源文件；旧文件可保留但会被状态过滤。

## 输入来源

| 来源 | 文件 | 方式 |
| --- | --- | --- |
| 飞书日记 | `daily.md` | `npm run input:daily-coach -- --week YYYY-Www` |
| 飞书周记 / 周复盘 | `weekly.md` | 自动生成草稿、用户确认后由阶段 2 采集定稿 |
| Flomo | `flomo.md` | 每周输入自动采集 |
| 微信读书 | `weread.md` | `npm run input:weread -- --week YYYY-Www` |
| Voice-X 核心重点 | `voice.md` | `npm run input:voice -- --week YYYY-Www` |
| 本人飞书文档 | `feishu-docs.md` | 写入身份切换后先影子运行；人工核对通过后 `npm run input:feishu-docs -- --week YYYY-Www --activate` |
| Time-X 随时记日历 | `calendar.md` | `npm run input:calendar -- --week YYYY-Www` |
| Health-X 健康周报 | `health.md` | Health-X 完成飞书周报同步后自动生成 |
| AI Coach | `coach.md`（有记录时） | 保留新增记录；0 条时不生成文件并写入状态侧车 |
| 智慧之门新增记录 | `wisdom.md`（有记录时） | `npm run input:wisdom -- --week YYYY-Www`；只按创建时间采集新增记录，0 条时不生成文件并写入状态侧车 |
| AI 对话摘要 | `ai.generated.md` → `ai.md` | 阶段 1 自动生成并经结构校验后转正，用户复核；失败时使用 fallback prompt 手动生成 |
| Codex / Code X 构建复盘 | `build.md` | 专项自动化或人工补充 |
| 飞书机器人 Build 复盘 | `build-bot.md` | 飞书机器人侧生成；本地周自动化只提示自查 |
| 历史行动回捞（兼容） | `open-actions.md`（有未闭环行动时） | `npm run action:feedback -- collect --week YYYY-Www`；从 Action Feedback Base 读取 continue 状态核心行动；不属于默认周流程 |
| 调研等其他重要输入 | `research.md` 或语义清楚的 `<source>.md` | 按需补充 |

`learn-x-process` 不联网采集，也不判断材料价值；它只读取指定周目录，生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。

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
3. 自动化生成飞书周记草稿，并根据本周 `ready` 输入同时生成 `04_output/_dist/weekly/YYYY-Www/action-feedback.md`。用户一起审核、修改两份草稿；回复“周记已确认”后，自动采集确认后的 `weekly.md`，一次生成 `input.json`、Process Pack 和 Weekly Output 壳。
4. 用户基于最新 Process Pack 完成 `04_output/weekly/YYYY-WW.md`、核心内容和 Memory 候选审核后，回复继续进入阶段 3。阶段 3 先生成并校验 `memory-candidates.md`，再展示包含正式 Memory、图片、Action Feedback Base、备份、YW Next 和 Flomo 目标的唯一确认卡；用户确认后按“正式 Memory → ChatGPT Bridge 核心图（写入 `04_output/_dist/weekly/YYYY-Www/weekly-core.png`）→ Action Feedback Base / 备份 / YW Next / Flomo”执行。公众号发布仍由用户人工完成。

要求：

- `daily.md` 的飞书多维表格材料必须保留字段表头和 field id 映射。
- `flomo.md` 必须覆盖完整目标周；若只能部分获取，在文件中说明缺口。
- `weread.md` 保留采集范围、时区、生成时间、统计、进度快照、个人划线和想法；不保存 ID、位置链接或额外 `_raw.json`。
- `voice.md` 只保留目标录制周内非空的完整结构化洞察，按录制时间正序；保留核心总结、压缩原文、建议和芒格之魂洞察，不读取或复制原始文字稿。30,000 个 Unicode 字符是提示线，不是采集门槛；Voice-X 只在统一生成 Process Pack 时按约 20% 保留比例做确定性高信号压缩，查询或文档读取失败不得覆盖旧文件。
- `feishu-docs.md` 只纳入目标 ISO 周内由本人创建或本人编辑的 Docx/Wiki 文档，不限制 owner。采集器合并“本人创建”与“本人编辑”候选，Wiki 按底层 Docx token 去重；每篇保留本周最新本人版本全文及本周每个本人 revision 相对前一 revision 的 unified diff。`LEARNX_FEISHU_HUMAN_EDITOR_ID` 保存 canary 确认的历史 `editor_ids`，`LEARNX_FEISHU_HUMAN_OPEN_ID` 保存同一账号的 `open_id`；每轮先用 `lark-cli auth status --json --verify` 精确核对 `open_id`，再匹配历史 `editor_ids`，不跨 ID 空间直接比较。手动粘贴 AI 内容按飞书记录的账号归属。Learn-X、Voice-X、Read-X、Invest-X 和 Skills 中已确认的 AI Docx/Wiki 写入口固定用 `--as bot`，Base 写入仍按各自用户身份契约执行；身份迁移、历史列表/分页/revision 读取、用户 `full_access` 和首个完整 ISO 周影子核对全部通过前，不得用 `--activate`。
- 若历史返回同一 `revision_id` 的多个 `history_version_id`，当前接口无法唯一读取对应正文，采集器保持 `needs_review`，不把该文档写入 `ready`。
- 同一用户账号下的人工操作和 AI 自动化写入不能单靠 editor ID 区分；只要仍有 AI Docx/Wiki 写入者使用用户身份，就保持影子状态。`feishu-docs.md` 存在但本周来源状态缺失时，Process 失败关闭，不按历史周兼容规则纳入。
- 2026-09-22 writer 盘点：已把 Learn-X 深度研究、月度议题工作台、季度议题总览、周期洞察、长文入库，Voice-X Docx，Read-X long-read 示例，Invest-X 基金校准、委员会写回、文档迁移，以及 Skills 全局治理、Prompt 治理、ywask、thinking-group 报告写入口固定为 `--as bot`；Base 写入继续使用用户身份。仍需单独核实的路径是 Invest-X asset-report 实际发布调用、Invest-X 事件目录创建，以及 Skills 中没有脚本写入口的交互式命令。在线 Bot 写后读回已用专用 canary 验证；这些未核实路径完成前继续保持影子状态。
- `calendar.md` 来自 `Time-X｜随时记` 共享日历与用户个人日历（主日历及自有共享日历，覆盖用户手动建日程）的合并，按同时存在的定时日程数分摊重叠时间，保留目标周有效时间汇总及每个日历块的日期、起止、原始区间、标题、描述和有效投入分钟；不保存人员、地点、ID、链接或系统元数据，且不单独作为实际完成证据。读取失败时必须写明不可用，不能沿用旧统计。详见 `docs/calendar-time-allocation.md`。
- `health.md` 只保存周度评分、核心数据和健康提示，不复制截图或原始医疗材料。
- `coach.md` 采集器按表字段保留新增记录，并排除回顾或状态更新；0 条新增记录时不生成文件并记录 `empty`，旧文件若存在也不进入本轮。
- `wisdom.md` 只收录 Base 中“创建时间”落在目标周内的新记录；既有记录因回顾、复看或状态变化而更新时不采集；0 条时记录 `empty`，失败与不可用不得伪装成 0 条。
- 所有自动来源都遵循同一状态侧车规则：`ready` 才能被 Process / 月度流程读取，`empty/failed/unavailable/needs_review` 的旧文件只保留不计入本轮；缺失侧车兼容历史周，非法侧车失败关闭。
- 飞书文档采集默认影子状态 `needs_review`；同一目标周必须先有成功影子结果，采集器才接受 `--activate`。运行者需先人工比对发现列表与差异，再用 `--activate` 重采并写入 `ready/empty`；这个参数代表运行者确认影子比对、writer 身份迁移和在线 canary 均已通过，脚本无法独立验证这些外部门禁。编辑者身份冲突、分页不完整、版本快照不匹配或 CLI 失败时标记 `needs_review/failed`；`needs_review/failed/unavailable` 会阻止 `process:weekly`，不能拿旧文件继续。历史 API 没有已核实的公开稳定契约和完整性保证，只能使用本次实际返回且校验通过的版本。只写一份 Markdown，非文本资源保留原链接/占位；超过 15,000 字符时保留全文，由现有人工压缩审核门槛阻止 Process，不自动截断或拆分。
- `ai.md` 是确认后的 AI 对话摘要。阶段 1 默认生成暂存的 `ai.generated.md`；确认前不进入 Process，确认后才转为 `ai.md`。AI 输入只使用原有提示词和目标周范围，不发送本地周输入材料。
- `build.md` 由 Codex Build 专项自动化或人工补充，每周输入自动采集不处理。
- `build-bot.md` 由飞书机器人侧的 `build-bot-log` 生成或追加。提前写当周时，用户需在飞书上手动执行并自查自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX；非提前执行时，周日飞书自动化理论上已执行，本地周自动化只提示自查。
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

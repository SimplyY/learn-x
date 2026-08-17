# 03_input Usage

> 本文件描述 Weekly Input 在 `_dist` 生成前的输入管理。

月度 Process 直接读取相交周的原文件，并叠加 `monthly/YYYY-M/` 下的月记及其他月度独有输入。旧 `weekly-inputs.md` 不再使用。原始文件保持完整；给 AI 的月度 Process Pack 另行执行日期过滤、元数据合并、去重和受约束的事件压缩。周记、月记草稿也只以这些已落盘文件为事实源；飞书只承载模板、草稿和人工定稿。

`03_input/weekly/YYYY-Www/` 采用扁平 Markdown 结构。只保留本周确实有内容的输入文件，不预建分类目录或大量空占位。

## 输入来源

| 来源 | 文件 | 方式 |
| --- | --- | --- |
| 飞书日记 | `daily.md` | `npm run input:daily-coach -- --week YYYY-Www` |
| 飞书周记 / 周复盘 | `weekly.md` | 自动生成草稿、用户确认后由阶段 2 采集定稿 |
| Flomo | `flomo.md` | 每周输入自动采集 |
| 微信读书 | `weread.md` | `npm run input:weread -- --week YYYY-Www` |
| Voice-X 核心重点 | `voice.md` | `npm run input:voice -- --week YYYY-Www` |
| Time-X 随时记日历 | `calendar.md` | `npm run input:calendar -- --week YYYY-Www` |
| Health-X 健康周报 | `health.md` | Health-X 完成飞书周报同步后自动生成 |
| AI Coach | `coach.md` | 每次采集覆盖；保留新增记录，采集器内排除回顾、复看和推送状态更新 |
| 智慧之门新增记录 | `wisdom.md` | `npm run input:wisdom -- --week YYYY-Www`；只按创建时间采集新增记录 |
| AI 对话摘要 | `ai.md` | 用户使用指定提示词手动生成 |
| Codex / Code X 构建复盘 | `build.md` | 专项自动化或人工补充 |
| 飞书机器人 Build 复盘 | `build-bot.md` | 飞书机器人侧生成；本地周自动化只提示自查 |
| 调研等其他重要输入 | `research.md` 或语义清楚的 `<source>.md` | 按需补充 |

`learn-x-process` 不联网采集，也不判断材料价值；它只读取指定周目录，生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。

## 每周流程

### 1. 建本周目录

```bash
mkdir -p 03_input/weekly/YYYY-Www
cp 03_input/weekly/00_template/*.md 03_input/weekly/YYYY-Www/
rm 03_input/weekly/YYYY-Www/README.md
```

采集结束后删除仍为空的模板文件，让周目录只保留重要输入。

### 2. 采集与补充

每周流程分为“输入 → 周记草稿 → Process → Memory”四个停点：

0. 自动判断目标周：未指定时，周一至周五默认处理上一 ISO 周；周六、周日默认处理当前 ISO 周。周三至周五运行时需要提示“现在仍是周中，默认处理上一周”；周六、周日处理当前周时视为提前写当周，只能声明覆盖截至运行时。
1. 采集 `daily.md`、`flomo.md`、`weread.md`、`voice.md`、`calendar.md`、`coach.md` 和 `wisdom.md`；Coach 与 Wisdom 的回顾边界由各自采集器处理；不采集周记，不生成 `_dist`。
2. 用户手动生成并保存 `ai.md`。
3. 用户回复“继续”后，自动验证 `daily.md`、`flomo.md`、`ai.md`，并从本地输入生成飞书周记草稿；不采集 `weekly.md`，不生成 `_dist`。
4. 用户在飞书编辑确认周记、移除主标题中的 `【待优化】AI 基础草稿` 标记后，回复“周记已确认”或“继续生成周报材料”。自动化采集 `weekly.md` 定稿，并生成 `_dist`。
5. 用户完成 `04_output/weekly/YYYY-WW.md`、审核行动反馈变更并勾选 Memory 候选后再次回复继续。自动化先把已确认变更写入行动反馈 Base，再生成 `memory-candidates.md`，只把已勾选或用户明确确认的内容无损迁移到 `01_core/memory/YYYY-QN.memory.md`；未勾选内容不写入。

要求：

- `daily.md` 的飞书多维表格材料必须保留字段表头和 field id 映射。
- `flomo.md` 必须覆盖完整目标周；若只能部分获取，在文件中说明缺口。
- `weread.md` 保留采集范围、时区、生成时间、统计、进度快照、个人划线和想法；不保存 ID、位置链接或额外 `_raw.json`。
- `voice.md` 只保留目标录制周内非空的核心重点完整 Markdown，按录制时间正序；绝不读取或复制原始文字稿。查询或文档读取失败不得覆盖旧文件。
- `calendar.md` 来自固定 `Time-X｜随时记` 共享日历，保留目标周汇总及每个日历块的日期、起止、标题和描述；不保存人员、地点、ID、链接或系统元数据，且不单独作为实际完成证据。读取失败时必须写明不可用，不能沿用旧统计。
- `health.md` 只保存周度评分、核心数据和健康提示，不复制截图或原始医疗材料。
- `coach.md` 每次采集覆盖为当前快照。采集器按表字段保留新增记录，并排除回顾或状态更新；通用 Input 不再做来源内容判断。
- `wisdom.md` 只收录 Base 中“创建时间”落在目标周内的新记录；既有记录因回顾、复看或状态变化而更新时不采集。
- `ai.md` 由用户维护，自动化不得访问 AI Chat、创建、改写或覆盖。它与有效的 `daily.md`、`flomo.md` 是生成周记草稿的必要前置条件。
- `build.md` 由 Codex Build 专项自动化或人工补充，每周输入自动采集不处理。
- `build-bot.md` 由飞书机器人侧的 `build-bot-log` 生成或追加。提前写当周时，用户需在飞书上手动执行并自查自动化链接：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe?table=wkfVC125gMp3snTX；非提前执行时，周日飞书自动化理论上已执行，本地周自动化只提示自查。
- 阶段 3 只处理已确认的行动反馈变更、Output、Memory candidates 和季度 Memory，不重新采集输入，也不修改正式 `道/`、`法/`、`术/`。
- 其他材料只有足够重要时才新增为 Markdown，不为空分类预建文件。

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
- [ ] `ai.md` 已由用户手动完成；飞书周记草稿已人工确认并移除草稿标记，随后采回为 `weekly.md`。
- [ ] `build.md` 已写入或明确报告缺口。
- [ ] `build-bot.md` 已写入或明确报告缺口。
- [ ] 空模板文件已经删除。
- [ ] `_dist` 已生成并核对来源路径。
- [ ] 后续输出按 `04_output/usage.md` 进行。

## 边界

- 不按文件修改时间推断本周范围，不跨周扫描。
- 不把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进输入区。
- 不让采集自动化或 `learn-x-process` 直接做长期价值判断。
- 不让目录分类反过来要求用户保留低价值输入。

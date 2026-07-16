# 03_input Usage

> 本文件描述 Weekly Input 在 `_dist` 生成前的输入管理。

月度 Process 直接读取相交周的原文件，并叠加 `monthly/YYYY-M/` 下的月记及其他月度独有输入。旧 `weekly-inputs.md` 不再使用。原始文件保持完整；给 AI 的月度 Process Pack 另行执行日期过滤、元数据合并、去重和受约束的事件压缩。

`03_input/weekly/YYYY-Www/` 采用扁平 Markdown 结构。只保留本周确实有内容的输入文件，不预建分类目录或大量空占位。

## 输入来源

| 来源 | 文件 | 方式 |
| --- | --- | --- |
| 飞书日记 | `daily.md` | 每周输入自动采集 |
| 飞书周记 / 周复盘 | `weekly.md` | 用户完成后由阶段 2 采集 |
| Flomo | `flomo.md` | 每周输入自动采集 |
| 微信读书 | `weread.md` | `npm run input:weread -- --week YYYY-Www` |
| Health-X 健康周报 | `health.md` | Health-X 完成飞书周报同步后自动生成 |
| AI Coach | `coach.md` | 阶段 1 通过飞书 CLI 采集 Base 中本周更新的记录 |
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

每周流程分三阶段：

0. 自动判断目标周：未指定时，周一至周五默认处理上一 ISO 周；周六、周日默认处理当前 ISO 周。周三至周五运行时需要提示“现在仍是周中，默认处理上一周”；周六、周日处理当前周时视为提前写当周，只能声明覆盖截至运行时。
1. 采集 `daily.md`、`flomo.md`、`weread.md` 和 `coach.md`，不采集周记，不生成 `_dist`。随后展示 `02_prompts/meta/_ai-chat-extract-prompt.md`，提醒用户完成 `weekly.md` 和 `ai.md`。
2. 用户回复继续后，先检查 `ai.md`，再采集 `weekly.md`。必要输入通过后生成 `_dist`。
3. 用户完成 `04_output/weekly/YYYY-WW.md`、审核行动反馈变更并勾选 Memory 候选后再次回复继续。自动化先把已确认变更写入行动反馈 Base，再生成 `memory-candidates.md`，只把已勾选或用户明确确认的内容无损迁移到 `01_core/memory/YYYY-QN.memory.md`；未勾选内容不写入。

要求：

- `daily.md` 的飞书多维表格材料必须保留字段表头和 field id 映射。
- `flomo.md` 必须覆盖完整目标周；若只能部分获取，在文件中说明缺口。
- `weread.md` 保留采集范围、时区、生成时间、统计、进度快照、个人划线和想法；不保存 ID、位置链接或额外 `_raw.json`。
- `health.md` 只保存周度评分、核心数据和健康提示，不复制截图或原始医疗材料。
- `coach.md` 只收录 Base 中“更新时间”落在目标周内的记录。保留 Base 字段内容和 URL，但不读取链接页面正文、不下载附件、不保存联系方式或访谈原文；必须记录查询范围、表名、记录数和分页完成状态。
- `ai.md` 由用户维护，自动化不得访问 AI Chat、创建、改写或覆盖。
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
- [ ] 自动采集项按实际情况生成：`daily.md`、`flomo.md`、`weread.md`、`coach.md`。
- [ ] 人工项按实际情况完成：`weekly.md`、`ai.md`。
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

# 03_input Usage
> 本文件描述 Weekly Input 在 `_dist` 生成前的输入管理：哪些来源由自动化采集，哪些由其他自动化写入，哪些仍由人手动补充。

`03_input/` 按处理周期分为 `weekly/`、`monthly/`、`yearly/`。当前已自动化的是 Weekly Process。

**注意： `_dist` 生成后的报告写作、人工审核和 Memory 流程见 `04_output/usage.md`。**

## 输入来源分层

Weekly Input 的周目录由三类来源共同填充：

| 来源层 | 负责内容 | 写入位置 | 说明 |
| --- | --- | --- | --- |
| 每周输入自动采集 | 飞书日记、飞书周记 / 周复盘、Flomo、AI 对话摘要 | `00_log/daily.md`、`00_log/weekly.md`、`01_inbox/flomo/`、`01_inbox/ai.md` | 由 Codex 自动化 `Learn-X 每周「输入自动采集 & 报告」` 每周一采集刚结束的上一 ISO 周；AI 对话摘要是半自动项，失败时由人补。 |
| 其他专项自动化 | Codex / Code X 构建复盘 | `02_action/build.md` | 由 Codex 自动化 `Learn-X 每周「 Codex Build 复盘」` 写入；每周输入自动采集不再处理 build。 |
| 手动补充 | 会议、聊天、反馈、研究、读书、播客、外部资料等 | `01_inbox/`、`02_action/` 下对应文件 | 没有稳定线上来源或需要人工判断的材料，由人补充。 |

`learn-x-process` 不负责联网采集，也不判断材料价值；它只读取周目录，生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。

## 每周流程

### 1. 建本周目录
> 通常由自动化创建；手动处理时可执行：

```bash
cp -R 03_input/weekly/00_template 03_input/weekly/YYYY-Www
```

### 2. 采集与补充输入

自动化能覆盖的来源先由自动化写入；自动化没有覆盖或需要人工判断的材料，再由人补充。

#### 2.1 自我反馈：`00_log/`

- `00_log/daily.md`：飞书日记多维表格，由每周输入自动采集写入。采集时必须使用全量字段表头和 field id 映射，不允许输出无表头的评分字段。来源参考：https://ywhome.feishu.cn/wiki/FGQgwU2aciOzNVk1uxKcI6OknYg?table=tblgc6xySQgsUuam&view=vewJ5FBHo1
- `00_log/weekly.md`：飞书周记、周复盘，由每周输入自动采集写入。飞书周记标题通常是周一，但内容对应刚结束的上一周。来源参考：https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac
- 月记、月复盘不放入 Weekly，后续进入 `03_input/monthly/`。

#### 2.2 信息输入：`01_inbox/`

- `01_inbox/flomo/`：Flomo 线上采集，由每周输入自动采集写入。必须加载到覆盖完整目标周范围；如果只能部分获取，要在文件中说明缺口。来源参考：https://v.flomoapp.com/mine
- `01_inbox/ai.md`：AI 对话摘要，是半自动项。每周输入自动采集会限时尝试；如果超时、失败、空回复、仍在生成、线上历史不可完整访问或结果低置信，自动化只报告缺口，不继续纠缠，由人使用 `02_prompts/meta/_ai-chat-extract-prompt.md` 手动补充。来源参考：https://chatgpt.com/
- `01_inbox/reading/`：读书、文章、资料笔记，通常手动补充。
- `01_inbox/podcast/`：播客记录，通常手动补充。
- `01_inbox/docs/`：文档、材料、外部资料，通常手动补充。
- `01_inbox/theme-read/`：围绕某个主题的持续阅读材料，通常手动补充。

#### 2.3 行动证据：`02_action/`

- `02_action/build.md`：Codex / Code X 构建、调试、上线记录，由 `Learn-X 每周「 Codex Build 复盘」` 专项自动化写入；每周输入自动采集不处理这个文件。
- `02_action/meeting.md`：会议记录，通常手动补充。
- `02_action/chat.md`：微信聊天、访谈记录，通常手动补充。
- `02_action/research.md`：调研过程和结果，通常手动补充。
- `02_action/feedback.md`：他人反馈、用户反馈、市场反馈，通常手动补充。

### 3. 生成 Weekly Output Dist

自动化采集和人工补充完成后，调用 `learn-x-process` 处理周目录。手动触发时复制这段给 Codex：

```text
todo： 明确是第几周

请调用 learn-x-process，处理 03_input/weekly/YYYY-Www，生成本周 Weekly Output Dist。要求：
1. 运行确定性脚本，生成 04_output/_dist/weekly/YYYY-Www/input.json 和 process-pack.md；
2. 如果 04_output/weekly/YYYY-WW.md 不存在或为空，则创建最小壳；如果已有内容，不要覆盖；
3. 最后告诉我 _dist 路径、空壳文件路径，以及缺了哪些输入。
```

## 每周检查

你只检查这几件事：

- [ ] 本周目录存在：`03_input/weekly/YYYY-Www/`
- [ ] 每周输入自动采集已写入或报告缺口：`00_log/daily.md`、`00_log/weekly.md`、`01_inbox/flomo/`、`01_inbox/ai.md`。
- [ ] 如果自动化报告 AI 对话摘要失败或超时，已手动补充 `01_inbox/ai.md`，或明确接受本周缺口。
- [ ] Codex Build 专项自动化已写入或报告缺口：`02_action/build.md`。
- [ ] 手动补充项已按需放入：meeting、chat、research、feedback、reading、podcast、docs 等。
- [ ] `00_log/daily.md` 中飞书多维表格材料包含字段表头；评分类数字必须有真实表头，例如 `今日心情`、`今日运动`、`今日饮食`。
- [ ] 已生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。
- [ ] 已进入 `04_output/usage.md` 的输出阶段。

## 边界

- 不按文件修改时间推断本周范围。
- 不跨周扫描其它 `03_input/weekly/YYYY-Www/` 目录。
- 不把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进输入区。
- 不让采集自动化或 `learn-x-process` 直接做长期价值判断。
- 不把 `00_log/` 当成 Memory；`00_log/` 是输入，Memory 是人工确认后的输出。
- 不让每周输入自动采集处理 Codex build；`02_action/build.md` 由 Codex Build 专项自动化或人工补充负责。

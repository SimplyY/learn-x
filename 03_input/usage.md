# 03_input Usage

`03_input/` 按处理周期分为 `weekly/`、`monthly/`、`yearly/`。当前已自动化的是 Weekly Process。

本文件只说明 `_dist` 生成前的输入管理：如何建目录、放材料、让 Codex 调用 `learn-x-process` 生成 `04_output/_dist/weekly/`。`_dist` 生成后的报告写作、人工审核和 Memory 流程见 `04_output/usage.md`。



## 每周命令
> 把本周材料放进对应目录后

复制这段给 Codex：

```text
请调用 learn-x-process，处理 03_input/weekly/YYYY-Www，生成本周 Weekly Output Dist。要求：
1. 运行确定性脚本，生成 04_output/_dist/weekly/YYYY-Www/input.json 和 process-pack.md；
2. 如果 04_output/weekly/YYYY-WW.md 不存在或为空，则创建最小壳；如果已有内容，不要覆盖；
3. 不要生成 Weekly Output 正文；
4. 不自动写入 01_core/道、01_core/法 或 memory；
5. 最后告诉我 _dist 路径、空壳文件路径，以及缺了哪些输入。
```


## 每周流程

### 1. 建本周目录
> 可自动化
你要做：

```bash
cp -R 03_input/weekly/00_template 03_input/weekly/YYYY-Www
```


### 2. 填本周输入

你只需要把材料放进去。

#### 2.1 自我反馈：`00_log/`

- `00_log/daily.md`：每天的日记。来源参考：https://ywhome.feishu.cn/wiki/FGQgwU2aciOzNVk1uxKcI6OknYg?table=tblgc6xySQgsUuam&view=vewJ5FBHo1
- `00_log/weekly.md`：周记、周复盘。来源参考：https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac
- 月记、月复盘不放入 Weekly，后续进入 `03_input/monthly/`。

#### 2.2 信息输入：`01_inbox/`

- `01_inbox/ai.md`：AI 对话摘要；提示词参考 `03_input/_ai-chat-extract-prompt.md`。
- `01_inbox/flomo/`：flomo 导出或摘录。
- `01_inbox/reading/`：读书、文章、资料笔记。
- `01_inbox/podcast/`：播客记录。
- `01_inbox/docs/`：文档、材料、外部资料。
- `01_inbox/theme-read/`：围绕某个主题的持续阅读材料。

#### 2.3 行动证据：`02_action/`

- `02_action/meeting.md`：会议记录。
- `02_action/chat.md`：微信聊天、访谈记录。
- `02_action/research.md`：调研过程和结果。
- `02_action/build.md`：构建、调试、上线、Codex 工作记录。
- `02_action/feedback.md`：他人反馈、用户反馈、市场反馈。

### 3. 让 Codex 处理

你要做的不是手动运行 `npm run process:weekly`，而是把“每周命令”复制给 Codex。

Codex 应该做：

1. 调用 `learn-x-process`。
2. 运行确定性脚本生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。
3. 创建 `04_output/weekly/YYYY-WW.md` 最小壳；如果文件已有内容，不操作。
4. 报告 `_dist` 路径、空壳路径和输入缺口。

Codex 不应该在本阶段生成 Weekly Output 正文。正文生成属于 `04_output/usage.md` 描述的输出阶段。

## 每周检查

你只检查这几件事：

- [ ] 本周目录存在：`03_input/weekly/YYYY-Www/`
- [ ] `00_log/daily.md` 或 `00_log/weekly.md` 至少有一个有内容。
- [ ] `01_inbox/` 有本周接收的信息。
- [ ] `02_action/` 有本周真实行动或反馈。
- [ ] 已把“每周命令”发给 Codex。
- [ ] 已生成 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `process-pack.md`。
- [ ] 已进入 `04_output/usage.md` 的输出阶段。

## 边界

- 不按文件修改时间推断本周范围。
- 不跨周扫描其它 `03_input/weekly/YYYY-Www/` 目录。
- 不把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进输入区。
- 不让脚本直接做长期价值判断。
- 不把 `00_log/` 当成 Memory；`00_log/` 是输入，Memory 是人工确认后的输出。

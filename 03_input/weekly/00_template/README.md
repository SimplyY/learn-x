# Weekly Input Template

复制本目录结构创建新周目录，例如：

```text
03_input/weekly/2026-W22/
  00_log/
    daily.md
    weekly.md
  01_inbox/
    ai.md
    flomo/
    reading/
    podcast/
    docs/
    theme-read/
  02_action/
    meeting.md
    chat.md
    research.md
    build.md
    feedback.md
```

- `00_log/daily.md`：每天的日记，可批量导入。
- `00_log/weekly.md`：周记、周复盘。
- 月记、月复盘不放入 Weekly 目录，后续进入 `03_input/monthly/`。
- `01_inbox/ai.md`：本周 AI 对话摘要。
- `02_action/build.md`：构建、调试、上线、Codex 工作记录。
- `02_action/feedback.md`：他人反馈、用户反馈、市场反馈。
- `02_action/chat.md`：微信聊天、访谈记录。
- `02_action/meeting.md`：会议记录。
- `02_action/research.md`：调研过程和结果。
- `01_inbox/flomo/`、`01_inbox/podcast/`、`01_inbox/docs/`、`01_inbox/reading/`、`01_inbox/theme-read/` 保留为文件夹，用于外部导出、多份材料或持续主题输入。

以下划线开头的文件会被 Weekly Process 脚本忽略，可用作提示词或模板。

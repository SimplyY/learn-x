# 03_input 使用说明

`03_input/` 是 Learn-X 的原始输入区，只保存进入处理流程的证据和反馈，不保存长期结论。

输入先按处理周期分成三个维度：

- `weekly/`：周度输入，进入 Weekly Process。
- `monthly/`：月度输入，进入 Monthly Process。
- `yearly/`：年度输入，预留给 Yearly Process。

Weekly 输入由周目录决定，不再依赖 weekly index 或文件修改时间。

Weekly 周目录内部保留三类输入边界：

- `00_log/`：自我反馈，记录我如何理解自己的状态和变化。包括日记、真正的周记或阶段复盘。月度反馈进入 `monthly/` 维度。
- `01_inbox/`：信息输入，记录我接收了什么。包括 AI 对话、flomo、阅读、播客、文档等。
- `02_action/`：行动证据，记录我做了什么以及世界如何反馈。包括会议、访谈、调研、构建、Demo、他人反馈、用户反馈、市场反馈等。

## 推荐目录

```text
03_input/
  weekly/
    00_template/
      00_log/
        daily.md
        weekly.md
      01_inbox/
      02_action/
    2026-W22/
      00_log/
        daily.md
        weekly.md
      01_inbox/
        ai.md
        flomo/
        weread/
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
  monthly/
  yearly/
```

## 周目录规则

- 周目录命名统一使用 `YYYY-Www`，例如 `2026-W22`。
- `npm run process:weekly -- --week 2026-22` 会读取 `03_input/weekly/2026-W22/`。
- `npm run process:monthly -- --month 2026-05` 会读取 `03_input/monthly/2026-5/`。
- 脚本只读取 `03_input/weekly/` 下的对应周目录，不扫描其它周，不按 mtime 猜测范围。
- `weekly/00_template/` 只放模板和导入提示，不进入 Weekly Process。

## 操作方式

Weekly 输入管理是半自动流程：人负责放入材料和最终判断，脚本负责确定性整理，Codex 负责生成 `_dist` 材料包和 Output 最小壳。周报正文由用户在 `_dist` 生成后按 `04_output/usage.md` 使用 AI Chat 生成和写入。

具体 SOP 见 [`usage.md`](./usage.md)。

## Log

`00_log/` 是真正的周记 / 周复盘位置，记录状态、判断变化、行动质量和自我反馈。

## action 输入原则

- transcript 保留证据，例如会议录音转文字、访谈全文、Codex 构建过程摘要。
- digest 提供给 Weekly Output 优先读取，例如会议纪要、访谈摘要、Demo 反馈摘要。
- 重要判断要能回溯到原始 transcript 或外部反馈。
- `02_action/` 不塞回 `01_inbox/`，因为它不是“我接收了什么”，而是“我做了什么、世界如何回应”。

## Log 输入原则

- daily 可以每周或每月批量导入，不要求每天都导入。
- `00_log/daily.md` 放每天的日记。
- `00_log/weekly.md` 放周记、周复盘。
- `00_log/` 是自我反馈输入，Memory 仍然是人工确认后的输出。

## 支持格式

- `.md`
- `.txt`
- `.json`
- `.html` / `.htm`

以下划线开头的模板和说明文件会被脚本忽略。

## 输入原则

- 可以粗糙，但要保留来源。
- 可以重复，脚本会做轻量去重。
- 微信读书的本周阅读时长、读过的书、最近阅读到的章节、个人划线和想法进入 `01_inbox/weread/`，由 `learn-x-input` 按周采集；它们仍是阅读输入，不直接视为 Log 或 Memory。
- AI 对话摘要由用户使用 `02_prompts/meta/_ai-chat-extract-prompt.md` 手动生成到 `01_inbox/ai.md`；自动化只提示和检查，不访问 AI Chat 或覆盖内容。
- 不要在这里精修长期结论。
- 不要把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进来。
- Weekly Output 负责综合 `inbox + action + log`；人负责决定什么进入 Memory 或长期核心资产。

# 03_input 使用说明

`03_input/` 是 Learn-X 的原始输入区，只保存值得进入处理流程的证据和反馈，不保存长期结论。

输入按处理周期分为：

- `weekly/`：周度输入，进入 Weekly Process。
- `monthly/`：月度输入，进入 Monthly Process。
- `yearly/`：年度输入，预留给 Yearly Process。

Weekly 输入由周目录决定，不依赖 weekly index 或文件修改时间。每个周目录采用扁平结构，只放重要的 Markdown 输入；文件名表达来源，不再使用 `log / inbox / action` 子目录预分类。

## 推荐目录

```text
03_input/
  weekly/
    00_template/
      daily.md
      weekly.md
      ai.md
      flomo.md
      weread.md
      health.md
      build.md
      build-bot.md
      research.md
      README.md
    2026-W24/
      daily.md
      weekly.md
      ai.md
      flomo.md
      weread.md
      health.md
      build.md
      build-bot.md
      research.md
  monthly/
  yearly/
```

模板文件只是常用来源，不要求每周全部保留。创建周目录后，可删除没有有效内容的空文件；未来出现稳定的新来源时，再新增语义清楚的 `<source>.md`。

## 周目录规则

- 周目录命名统一使用 `YYYY-Www`，例如 `2026-W24`。
- `npm run process:weekly -- --week 2026-W24` 只读取对应周目录。
- `weekly/00_template/` 只放 Markdown 模板，不进入 Weekly Process。
- 周目录根部只放输入 Markdown；不要重新建立来源子目录。
- 文件可以粗糙，但要保留来源、时间范围和必要上下文。

## 常用文件

- `daily.md`：日记、自我状态与每日反馈。
- `weekly.md`：周记、周复盘。
- `ai.md`：AI 对话摘要，由用户使用 `02_prompts/meta/_ai-chat-extract-prompt.md` 手动生成。
- `flomo.md`：目标周 Flomo 内容。
- `weread.md`：微信读书周度阅读活动、进度快照、个人划线和想法，由 `learn-x-input` 采集。
- `health.md`：Health-X 周报摘要，由 Health-X 在飞书周报同步成功后生成。
- `build.md`：Codex / Code X 构建、调试、上线记录。
- `build-bot.md`：飞书机器人 / Code X Bot 周度执行复盘，由飞书机器人侧 `build-bot-log` 生成；本地周自动化只提示自查。
- `research.md`：调研过程和结果。

会议、聊天、反馈、阅读或文档等材料只有在确实重要时才新增对应 Markdown，不为完整分类预建空文件。

## 处理边界

Weekly Process 会根据已知文件名在 `_dist` 中标记来源类型，但目录本身不承担分类职责：

- `daily.md`、`weekly.md`、`health.md` 标记为自我反馈。
- `ai.md`、`flomo.md`、`weread.md` 等标记为信息输入。
- `build.md`、`build-bot.md`、`research.md`、`meeting.md`、`chat.md`、`feedback.md` 标记为行动证据。
- 未知文件名仍会作为普通 input 处理，不阻断未来扩展。

支持 `.md`、`.txt`、`.json`、`.html` / `.htm` 的历史输入解析，但新周目录默认只使用 Markdown。以下划线开头的文件和 `README.md` 会被处理器忽略。

具体 SOP 见 [`usage.md`](./usage.md)。

## 月度原始输入规则

月度自动化使用 `npm run input:monthly -- --month YYYY-MM`，把所有与目标月相交的 ISO 周输入逐文件封装到 `monthly/YYYY-M/weekly-inputs.md`。该文件保留原路径、类别、字节数、SHA-256 和完整原文；不得替换成摘要或周报 Output。边界周完整保留并明确披露可能包含相邻月份内容。

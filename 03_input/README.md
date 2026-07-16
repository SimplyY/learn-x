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
      calendar.md
      health.md
      coach.md
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
      calendar.md
      health.md
      coach.md
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
- `calendar.md`：飞书主日历的每日与全周计划时间统计；不保存日程正文，且只作计划上下文，不代表实际发生。
- `health.md`：Health-X 周报摘要，由 Health-X 在飞书周报同步成功后生成。
- `coach.md`：AI Coach Base 中更新时间落在目标周内的服务对象、服务记录、思考与项目数据；链接只保留 URL，不读取链接页面正文。
- `build.md`：Codex / Code X 构建、调试、上线记录。
- `build-bot.md`：飞书机器人 / Code X Bot 周度执行复盘，由飞书机器人侧 `build-bot-log` 生成；本地周自动化只提示自查。
- `research.md`：调研过程和结果。

会议、聊天、反馈、阅读或文档等材料只有在确实重要时才新增对应 Markdown，不为完整分类预建空文件。

## 处理边界

Weekly Process 会根据已知文件名在 `_dist` 中标记来源类型，但目录本身不承担分类职责：

- `daily.md`、`weekly.md`、`health.md` 标记为自我反馈。
- `ai.md`、`flomo.md`、`weread.md` 等标记为信息输入。
- `calendar.md` 保持普通 input 类型，避免把计划日程误认为行动证据。
- `build.md`、`build-bot.md`、`research.md`、`meeting.md`、`chat.md`、`feedback.md`、`coach.md` 标记为行动证据。
- 未知文件名仍会作为普通 input 处理，不阻断未来扩展。

支持 `.md`、`.txt`、`.json`、`.html` / `.htm` 的历史输入解析，但新周目录默认只使用 Markdown。以下划线开头的文件和 `README.md` 会被处理器忽略。

具体 SOP 见 [`usage.md`](./usage.md)。

## 月度原始输入规则

月度 Process 直接读取所有与目标月相交的 `weekly/YYYY-Www/` 原文件，并同时读取 `monthly/YYYY-M/` 下的月记及其他月度独有输入。不要复制生成 `weekly-inputs.md`；原文只在各自输入目录保留一份。边界周按正文日期和声明覆盖期过滤，月外内容不进入月度 Process Pack。

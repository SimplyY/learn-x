# 03_input 使用说明

`03_input/` 是 Learn-X 的原始输入区，只保存进入每周处理的证据和反馈，不保存长期结论。

四类输入边界：

- `inbox/`：信息输入，记录我接收了什么。包括 AI 对话、flomo、阅读、播客、文档等。
- `action/`：行动证据，记录我做了什么以及世界如何反馈。包括会议、访谈、调研、构建、Demo、他人反馈、用户反馈、市场反馈等。
- `log/`：自我反馈，记录我如何理解自己的状态和变化。包括日记、真正的周记、月记或阶段复盘。
- `index/`：处理索引，记录本次 Weekly / Monthly Process 要处理哪些材料。

## 推荐目录

```text
03_input/
  inbox/
    ai/
    flomo/
    reading/
    podcast/
    docs/
    theme-read/
  action/
    meeting/
    interview/
    research/
    build/
    feedback/
  log/
    daily/
    weekly/
    monthly/
  index/
    weekly/
    monthly/
```

## Index 与 Review 的区别

`index/weekly/YYYY-WW.index.md` 是显式处理清单和排除修正，不再是唯一入口；脚本还会把本周 mtime 命中的文件作为自动候选读入。

`log/weekly/YYYY-WW.review.md` 是真正的周记 / 周复盘，记录状态、判断变化、行动质量和自我反馈。

二者不能混用：index 服务脚本读取，review 服务 Weekly Output 判断。

## Action 输入原则

- transcript 保留证据，例如会议录音转文字、访谈全文、Codex 构建过程摘要。
- digest 提供给 Weekly Output 优先读取，例如会议纪要、访谈摘要、Demo 反馈摘要。
- 重要判断要能回溯到原始 transcript 或外部反馈。
- `action/` 不塞回 `inbox/`，因为它不是“我接收了什么”，而是“我做了什么、世界如何回应”。

## Log 输入原则

- daily 可以每周或每月批量导入，不要求每天都导入。
- weekly 是真正的周记，不是本周处理清单。
- monthly 是阶段性复盘，不替代 `01_core/memory/`。
- `log/` 是自我反馈输入，Memory 仍然是人工确认后的输出。

## 每周使用方式

1. 把信息输入放入 `03_input/inbox/`。
2. 把行动证据放入 `03_input/action/`。
3. 把日记、周记、月记放入 `03_input/log/`。
4. 在 `03_input/index/weekly/YYYY-WW.index.md` 中列出明确要处理的路径；如需排除自动候选，在 `## 排除` / `## 不进入本周` / `## 忽略` 下列出路径。
5. 运行 `npm run process:weekly` 生成 `04_output/_dist/YYYY-WW/` 中间材料；脚本会合并 index 显式路径和本周 mtime 自动候选。
6. Codex 读取中间材料和 Skill 规则，生成 `04_output/weekly/YYYY-WW.md`。

兼容说明：旧清单里引用的 `input/...` 路径会被脚本映射到 `03_input/inbox/...`；新清单请直接使用 `03_input/...`。mtime 只是候选信号，尤其 reading / podcast / theme-read 这类持续维护内容需要在 Weekly Output 中谨慎判断。

## 支持格式

- `.md`
- `.txt`
- `.json`
- `.html` / `.htm`

以下划线开头的模板和说明文件会被脚本忽略。

## 输入原则

- 可以粗糙，但要保留来源。
- 可以重复，脚本会做轻量去重。
- 不要在这里精修长期结论。
- 不要把 `AGENTS.md`、`app/code/`、构建产物或正式道法文件复制进来。
- Weekly Output 负责综合 `inbox + action + log`；人负责决定什么进入 Memory 或长期核心资产。

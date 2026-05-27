# input 使用说明

`input/` 是 Learn-X 的原始输入区。

这里放本周新增的材料。Skill `learn-x-process` 会读取这些输入，先生成可审计的 Process Pack，再由 Codex 生成每周 Output 报告。这里不是长期上下文资产，不应该被当作 `道/`、`法/`、`术/` 的正式内容。

## 推荐来源目录

- `ai/`：AI 对话、Codex 讨论、OpenAI / ChatGPT / Gemini / Claude 等相关输出。
- `flomo/`：flomo 笔记（含灵感、诗等偏手机端输入）。
- `reading/`：读书笔记、文章摘录，以及 AI 协助生成的阅读材料。
- `podcast/`：播客笔记，以及 AI 协助生成的播客整理材料。
- `docs/`：飞书文档，包含真实项目记录、行动复盘、实验记录等更正式输入。
- `theme-read/`：主题阅读和跨材料研究的工作台。
- `weekly/`：每周输入清单，声明本周进入 Process 的材料范围。

可以新增来源目录。脚本会把 `input/<来源>/` 的第一层目录名识别为来源。

## 时间切片

`input/` 的内容目录按来源或对象组织，Weekly Output 按周组织。二者通过 `input/weekly/YYYY-WW.md` 连接。

如果存在 `input/weekly/YYYY-WW.md`，Skill 会优先读取其中引用的 `input/...` 路径；如果不存在，才回退到按文件修改时间筛选本周材料。

推荐：

- 外部输入：按日期导出到 `ai/`、`flomo/`、`docs/`。
- 内部输入：按书、播客、主题持续维护在 `reading/`、`podcast/`、`theme-read/`。
- 每周处理：在 `weekly/YYYY-WW.md` 中声明本周读了什么、听了什么、关注什么。

`weekly/_template.md` 是清单模板。`weekly/_capture-prompt.md` 可用于把截图、文件列表或口头描述整理成每周清单。

## 支持格式

- `.md`
- `.txt`
- `.json`
- `.html` / `.htm`

JSON 会做基础递归提取，优先读取 `title`、`content`、`text`、`note`、`summary`、`question`、`answer` 等字段。
HTML 会做轻量文本提取，适合 flomo 导出和普通网页笔记。复杂页面如果噪声较多，建议先手动清理成 `.md` 或 `.txt`。

## 每周使用方式

1. 手动把本周材料放进对应来源目录。
2. 保留原始来源信息，例如文件名里写日期、平台、主题。
3. 生成或补充 `input/weekly/YYYY-WW.md`，声明本周处理范围。
4. 在 Codex 中说「调用 learn-x-process 跑本周 Output」。
5. Skill 会调用下面的确定性脚本：

   ```bash
   npm run process:weekly
   ```

6. Codex 会读取 `output/candidates/YYYY-WW.input.json` 和 `output/candidates/YYYY-WW.process-pack.md`，再按 Skill 规则写入 `output/weekly/YYYY-WW.md`。
7. 到 `output/weekly/` 阅读本周报告。

## AI 输入建议

- 先聚焦 `input/ai/`。
- 可以把完整 AI 对话、关键回答、Codex 过程记录放进去。
- 如果想让 AI 帮你整理对话，使用 `input/ai/_ai-chat-extract-prompt.md`。
- 以下划线开头的文件是模板或说明，脚本会忽略，不会进入每周处理。

## 输入原则

- 可以粗糙，但要保留来源。
- 可以重复，脚本会做轻量去重。
- 不要在这里精修长期结论。
- 不要期待脚本替你判断价值；它只把混乱材料整理成可信输入。
- 不要把 `AGENTS.md`、`code/`、构建产物或正式道法术文件复制进来。
- 不确定是否有用的内容，可以先放进来；是否入库由每周 Output 和人工审核决定。

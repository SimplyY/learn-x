# learn-x-process

Learn-X 的每周 `Input -> Process -> Output` 工作流。

本 Skill 每周从 `input/` 读取手动导入材料，先生成可追溯的 Input Pack，再由 Codex 按 Markdown 规则生成人读版 Weekly Output。人工审核后，它也可以生成极薄 Weekly Memory，供跨周复用和月度沉积。它只生成候选报告和记忆，不自动修改任何正式长期资产。

## Skill 本质

本 Skill 的入口是当前 `SKILL.md`。Codex / Agents 通过它理解工作流、触发时机、输入输出、判断标准，以及何时调用 `resources/` 和 `scripts/`。

组件分工：

| 组件 | 作用 |
| --- | --- |
| `input/` | 原始输入：AI 对话、flomo、阅读、播客、飞书文档 |
| `SKILL.md` | Process 工作流大脑 |
| `resources/` | 判断规则、输出要求、参考材料 |
| `scripts/` | 确定性处理：读取、清洗、合并、去重、编号、来源覆盖、生成 Process Pack |
| `output/` | 每周输出报告、中间材料和极薄 Memory |

## 使用时机

当用户要求「每周处理」「每周输出」「从 input 生成报告」「发现道法术候选」「Prompt 候选」「Skill 候选」「行动 / Demo / 写作候选」「第一性原理候选」「做中学候选」「图谱候选」「生成 weekly memory」「生成每周记忆」「压缩本周确认内容」时使用本 Skill。

## 工作边界

- 可以读取 `input/` 下的手动导入材料，支持 `.md`、`.txt`、`.json`、`.html`、`.htm`。
- 如果存在 `input/weekly/YYYY-WW.md`，以该清单引用的 `input/...` 路径作为本周范围；如果不存在，才按文件修改时间筛选本周材料。
- 可以生成或覆盖 `output/weekly/YYYY-WW.md`，但确定性脚本不得直接覆盖最终人读版报告。
- 可以生成中间材料 `output/candidates/YYYY-WW.input.json` 和 `output/candidates/YYYY-WW.process-pack.md`。
- 可以读取 `output/weekly/YYYY-WW.md`，抽取已勾选或明确标记的内容，生成 `output/candidates/YYYY-WW.memory-candidates.md`，再由 Codex 压缩写入季度文件 `output/memory/YYYY-QN.memory.md`。
- Weekly Output 可以识别第一性原理、做中学和图谱候选，但只作为学习增强候选，不自动生成正式资产或复杂图。
- 可以维护 `input/README.md`、`output/README.md`、`input/ai/_ai-chat-extract-prompt.md` 和 `input/weekly/` 下划线模板。
- 不要自动修改 `README.md`、`道/`、`法/`、`术/`、`01_meta-prompts/` 或 `.agents/skills/` 的正式资产。
- 不要引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。
- 不要把 `AGENTS.md`、`code/`、生成物或工具目录混入学习上下文。

## 标准流程

1. 先理解 `resources/output-requirements.md` 的输出要求和 `resources/layer-rules.md` 的判断规则。
2. 用户把本周材料放入 `input/ai/`、`input/flomo/`、`input/reading/`、`input/podcast/`、`input/docs/`、`input/theme-read/`。
3. 先生成或补充 `input/weekly/YYYY-WW.md`：外部导出列具体文件，内部维护材料列对象路径和本周关注点。可用 `input/weekly/_capture-prompt.md` 让 Codex 根据截图、文件列表或口头描述半自动生成。
4. 用户日常可以直接要求 Codex「调用 learn-x-process 跑本周 Output」。
5. Skill 内部先调用确定性脚本，生成 Input Pack 和 Process Pack：

   ```bash
   npm run process:weekly
   ```

   如需指定周：

   ```bash
   node .agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs --week 2026-22
   ```

   该脚本只写入 `output/candidates/YYYY-WW.input.json` 和 `output/candidates/YYYY-WW.process-pack.md`。
6. Codex 读取以下文件，按规则生成人读版 Weekly Output，并写入 `output/weekly/YYYY-WW.md`：
   - `resources/output-requirements.md`
   - `resources/layer-rules.md`
   - `output/candidates/YYYY-WW.input.json`
   - `output/candidates/YYYY-WW.process-pack.md`
7. 阅读生成的 `output/weekly/YYYY-WW.md`。
8. 按 `resources/layer-rules.md` 人工审核候选，不要直接写入正式 core 文件。
9. 如果用户要求生成 Memory，先调用确定性脚本抽取人工确认线索：

   ```bash
   npm run memory:weekly
   ```

   如需指定周：

   ```bash
   node .agents/skills/learn-x-process/scripts/prepare-weekly-memory.mjs --week 2026-22
   ```

   然后读取 `resources/memory-requirements.md` 和 `output/candidates/YYYY-WW.memory-candidates.md`，压缩写入 `output/memory/YYYY-QN.memory.md` 的对应周小节。
10. 输出给用户时说明：
   - 报告路径
   - 本周读取了多少条材料
   - 生成了哪些候选类别
   - 哪些候选需要人工补证

## 输出要求

报告必须遵守 `resources/output-requirements.md`。

最终 Output 是给人读的，不是脚本自动分类结果。脚本只能协助生成 Input Pack、Process Pack 和来源覆盖；Codex 需要按输出要求进行智能判断、压缩、重排和改写。

Weekly Output 需要额外识别三类学习增强候选：第一性原理候选、做中学候选、图谱候选。它们必须精简，只服务下周学习和人工审核。

Weekly Memory 必须遵守 `resources/memory-requirements.md`，每周 4-5 条以内，每条 20-30 字左右、最多不超过 40 字。它只保存人工确认后值得跨周复用的内容，不保存过程和完整候选。

## 三层架构

1. Deterministic Collector：代码只收集、清洗、去重、编号、保留来源。
2. Process Pack：代码生成给 AI 读的材料包，不做道 / 法 / 术 / Prompt / Skill 判断。
3. AI Weekly Review：Codex 根据 `SKILL.md`、`resources/*.md` 和 Process Pack 生成真正的 `output/weekly/YYYY-WW.md`。
4. Weekly Memory：人工审核后，脚本抽取确认线索，Codex 压缩为极薄跨周上下文。

一句话：代码负责把混乱材料变成可信输入；AI 负责把可信输入变成判断草稿；人负责决定什么值得进入长期生命系统。

## 判断提醒

- 一次性问题是 Chat。
- 重复提问方式、分析框架、角色设定、输出格式是 Prompt。
- 重复完整工作流，通常有多输入、多步骤、稳定产物和清晰边界，是 Skill。
- 长期价值判断进入道 / 法候选。
- 具体操作方法进入术候选。
- 暂时有用但不稳定进入素材候选。
- 噪声、过期内容、低密度摘录或短期情绪峰值进入删除候选。
- 没有行动验证的洞察，默认不直接建议入库「道」。
- 第一性原理候选看变量、约束和因果链，不写长篇哲学分析。
- 做中学候选必须能在一周内产生现实反馈。
- 图谱候选只输出适合画什么图和核心结构，不必生成复杂图。

## 长期维护说明

- `input/README.md` 是人和 Codex 共同使用的输入说明，新增来源目录或导入规则时要同步更新。
- `output/README.md` 是报告阅读和人工审核说明，报告结构或审核流程改变时要同步更新。
- `input/ai/_ai-chat-extract-prompt.md` 是 AI 对话提取模板，以下划线开头，脚本会忽略它，不会当成本周输入。
- `input/weekly/_template.md` 是每周输入清单模板；`input/weekly/_capture-prompt.md` 是根据截图、文件列表或口头描述生成清单的提示词。以下划线开头，脚本会忽略。
- `resources/output-requirements.md` 是 Weekly Output 质量标准；`resources/layer-rules.md` 是判断标准。
- `resources/memory-requirements.md` 是 Weekly Memory 的质量标准。
- 脚本只能做确定性整理、来源覆盖和 Process Pack 生成，不要把最终判断写死进代码。

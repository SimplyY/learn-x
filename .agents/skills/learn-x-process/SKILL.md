# learn-x-process

Learn-X 的每周 `Input -> Process -> Output` 工作流。

本 Skill 每周从 `03_input/` 读取手动导入材料，先生成可追溯的 Input Pack，再由 Codex 生成人读版 Weekly Output。人工审核后，它也可以生成极薄 Weekly Memory。它只生成候选报告和记忆，不自动修改正式长期资产。

## Skill 本质

组件分工：

| 组件 | 作用 |
| --- | --- |
| `03_input/inbox/` | 信息输入：我接收了什么 |
| `03_input/action/` | 行动证据：我做了什么、世界如何反馈 |
| `03_input/log/` | 自我反馈：我如何理解自己的状态和变化 |
| `03_input/index/` | 处理索引：本次要处理哪些材料 |
| `resources/` | 判断规则、输出要求、参考材料 |
| `scripts/` | 确定性处理：读取、清洗、合并、去重、编号、来源覆盖、生成 Process Pack |
| `04_output/` | 每周输出报告与中间材料 |

一句话：

```text
inbox 记录我接收了什么；
action 记录我做了什么；
log 记录我如何理解自己；
index 记录本次处理什么。
```

## 使用时机

当用户要求「每周处理」「每周输出」「从 input 生成报告」「发现道法术候选」「做中学复盘」「生成 weekly memory」「生成每周记忆」「压缩本周确认内容」时使用本 Skill。

## 工作边界

- 可以读取 `03_input/` 下的手动导入材料，支持 `.md`、`.txt`、`.json`、`.html`、`.htm`。
- 如果存在 `03_input/index/weekly/YYYY-WW.index.md`，以该索引引用的 `03_input/...` 路径作为本周范围；如果不存在，才按文件修改时间筛选本周材料。
- 兼容旧清单里的 `input/...` 引用：脚本会映射到 `03_input/inbox/...`。
- 可以生成或覆盖 `04_output/weekly/YYYY-WW.md`，但确定性脚本不得直接覆盖最终人读版报告。
- 可以生成中间材料 `04_output/_dist/YYYY-WW/input.json` 和 `04_output/_dist/YYYY-WW/process-pack.md`。
- 可以读取 `04_output/weekly/YYYY-WW.md`，抽取已勾选或明确标记的内容，生成 `04_output/_dist/YYYY-WW/memory-candidates.md`，再由 Codex 压缩写入 `01_core/memory/YYYY-QN.memory.md`。
- Weekly Output 默认不固定输出图谱、第一性原理、Prompt、Skill、写作或 Demo 候选；必要时才可在做中学复盘或下周行动中简短提及。
- 可以维护 `03_input/README.md`、`04_output/README.md`、`03_input/inbox/ai/_ai-chat-extract-prompt.md` 和 `03_input/index/weekly/` 下划线模板。
- 不要自动修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或 `.agents/skills/` 的正式资产。
- 不要引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。
- 不要把 `AGENTS.md`、`app/code/`、生成物或工具目录混入学习上下文。

## 标准流程

1. 先理解 `resources/output-requirements.md` 的输出要求和 `resources/layer-rules.md` 的判断规则。
2. 用户把本周材料放入：
   - `03_input/inbox/`：AI、flomo、reading、podcast、docs 等信息输入。
   - `03_input/action/`：meeting、interview、research、build、feedback 等行动证据。
   - `03_input/log/`：daily、weekly、monthly 等自我反馈。
3. 先生成或补充 `03_input/index/weekly/YYYY-WW.index.md`。可用 `03_input/index/weekly/_capture-prompt.md` 半自动生成。
4. 用户日常可以直接要求 Codex「调用 learn-x-process 跑本周 Output」。
5. Skill 内部先调用确定性脚本：

   ```bash
   npm run process:weekly
   ```

   如需指定周：

   ```bash
   node .agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs --week 2026-22
   ```

   该脚本只写入 `04_output/_dist/YYYY-WW/input.json` 和 `04_output/_dist/YYYY-WW/process-pack.md`。
6. Codex 读取以下文件，按规则生成人读版 Weekly Output，并写入 `04_output/weekly/YYYY-WW.md`：
   - `resources/output-requirements.md`
   - `resources/layer-rules.md`
   - `04_output/_dist/YYYY-WW/input.json`
   - `04_output/_dist/YYYY-WW/process-pack.md`
7. 阅读生成的 `04_output/weekly/YYYY-WW.md`。
8. 人工审核候选，不要直接写入正式 core 文件。
9. 如果用户要求生成 Memory，先调用：

   ```bash
   npm run memory:weekly
   ```

   然后读取 `resources/memory-requirements.md` 和 `04_output/_dist/YYYY-WW/memory-candidates.md`，压缩写入 `01_core/memory/YYYY-QN.memory.md` 的对应周小节。

## 输出要求

报告必须遵守 `resources/output-requirements.md`。

Weekly Output 要综合三类输入：

- 本周有哪些信息输入；
- 本周有哪些真实行动；
- 本周有哪些自我反馈；
- 哪些行动产生了现实反馈；
- 哪些判断被验证、修正或暴露问题。

Weekly Output 默认围绕核心问题、做中学复盘、下周 3 件事、道 / 法 / 术和处理信息；行动闭环检查并入做中学复盘，不单独成节。

Weekly Memory 必须遵守 `resources/memory-requirements.md`，每周 4-5 条以内，每条 20-30 字左右、最多不超过 40 字。它只保存人工确认后值得跨周复用的内容，不保存过程和完整候选。

## 三层架构

1. Deterministic Collector：代码只收集、清洗、去重、编号、保留来源。
2. Process Pack：代码生成给 AI 读的材料包，不做道 / 法 / 术 / Prompt / Skill 判断。
3. AI Weekly Review：Codex 根据 Skill 规则和 Process Pack 生成 `04_output/weekly/YYYY-WW.md`。
4. Weekly Memory：人工审核后，脚本抽取确认线索，Codex 压缩为极薄跨周上下文。

代码负责把混乱材料变成可信输入；AI 负责把可信输入变成判断草稿；人负责决定什么值得进入长期生命系统。

## 判断提醒

- 一次性问题是 Chat。
- 重复提问方式、分析框架、角色设定、输出格式是 Prompt。
- 重复完整工作流，通常有多输入、多步骤、稳定产物和清晰边界，是 Skill。
- 长期价值判断进入道 / 法候选。
- 具体操作方法进入术候选。
- 暂时有用但不稳定进入素材候选。
- 噪声、过期内容、低密度摘录或短期情绪峰值进入删除候选。
- 没有行动验证的洞察，默认不直接建议入库「道」。
- 图谱、Prompt、Skill、写作、Demo、第一性原理不是固定输出模块；只有强信号且服务行动闭环时才简短提及。
- 做中学复盘必须优先评估已经发生的行动和现实反馈，并承接行动闭环检查。

## 长期维护说明

- `03_input/README.md` 是人和 Codex 共同使用的输入说明，新增来源目录或导入规则时要同步更新。
- `04_output/README.md` 是报告阅读和人工审核说明，报告结构或审核流程改变时要同步更新。
- `03_input/inbox/ai/_ai-chat-extract-prompt.md` 是 AI 对话提取模板，以下划线开头，脚本会忽略。
- `03_input/index/weekly/_template.md` 是每周输入索引模板；`03_input/index/weekly/_capture-prompt.md` 是根据截图、文件列表或口头描述生成索引的提示词。
- `resources/output-requirements.md` 是 Weekly Output 质量标准；`resources/layer-rules.md` 是判断标准。
- `resources/memory-requirements.md` 是 Weekly Memory 的质量标准。
- 脚本只能做确定性整理、来源覆盖和 Process Pack 生成，不要把最终判断写死进代码。

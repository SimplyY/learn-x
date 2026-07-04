# learn-x-process

Learn-X 的 `Input -> Process Pack -> Output Shell` 工作流。

面向人的功能概览见 `docs/LEARN_X_PROCESS.md`；本文只维护 Agent 的调用和执行规则。

本 Skill 从 `03_input/weekly/` 或 `03_input/monthly/` 读取手动导入材料，生成可追溯的 Input Pack 和 Process Pack，并创建 Output 最小壳。Output 正文由用户自己基于 AI Chat 生成和写入。人工审核后，Codex 可以调用内部脚本生成 Memory 候选，再由 Codex 按规则无损整理并写入 Memory。它不自动修改正式长期资产。

## Skill 本质

组件分工：

| 组件 | 作用 |
| --- | --- |
| `03_input/weekly/YYYY-Www/*.md` | 扁平周输入；文件名表达来源，不用目录预分类 |
| `03_input/weekly/00_template/*.md` | 每周输入文件模板 |
| `resources/` | 判断规则、输出要求、参考材料 |
| `scripts/` | 确定性处理：读取、清洗、合并、去重、编号、来源覆盖、生成 Process Pack、抽取 Memory 候选 |
| `04_output/` | `_dist` 中间材料、Output 最小壳和人工写入报告 |

一句话：

```text
每个周目录用少量 Markdown 文件记录本周重要输入。
```

## 使用时机

当用户要求「每周处理」「每周输出」「从 input 生成报告」「发现道法术候选」「做中学复盘」「生成 weekly memory」「生成每周记忆」「压缩本周确认内容」时使用本 Skill。

## 工作边界

- 可以读取 `03_input/weekly/YYYY-Www/` 和 `03_input/monthly/YYYY-M/` 下的手动导入材料，支持 `.md`、`.txt`、`.json`、`.html`、`.htm`。
- Weekly Process 只读取指定周目录，不读取其它周目录，不按 mtime 推断范围。
- Monthly Process 只读取指定月目录，不读取其它月目录，不按 mtime 推断范围。
- 可以在 `04_output/weekly/YYYY-WW.md` 不存在或为空时创建最小壳；如果已有内容，不覆盖、不改写。
- 可以生成中间材料 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `04_output/_dist/weekly/YYYY-Www/process-pack.md`。
- 可以生成中间材料 `04_output/_dist/monthly/YYYY-MM/input.json` 和 `04_output/_dist/monthly/YYYY-MM/process-pack.md`。
- 可以读取 `04_output/weekly/YYYY-WW.md`，抽取已勾选或明确标记的内容，生成 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`，再由 Codex 无损整理写入 `01_core/memory/YYYY-QN.memory.md`。
- 可以读取 `04_output/monthly/YYYY-MM.md` 或 `04_output/yearly/YYYY.md`，抽取 Memory 候选包，供 Codex 无损整理写入季度或年度 Memory。
- Weekly Output 默认不固定输出图谱、第一性原理、Prompt、Skill、写作或 Demo 候选；必要时才可在做中学复盘或下周行动中简短提及。
- 可以维护 `03_input/README.md`、`04_output/README.md` 和 `03_input/weekly/00_template/` 下划线模板。
- 不要自动修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或 `.agents/skills/` 的正式资产。
- 不要引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。
- 不要把 `AGENTS.md`、`app/code/`、生成物或工具目录混入学习上下文。

## 标准流程

1. 先理解 `03_input/usage.md` 和 `04_output/usage.md` 的阶段边界：本 Skill 只负责生成 `_dist` 和 Output 最小壳，不代写正文。
2. 用户把本周重要材料直接放入 `03_input/weekly/YYYY-Www/*.md`。常用文件为 `daily.md`、`weekly.md`、`ai.md`、`flomo.md`、`weread.md`、`build.md`、`build-bot.md`、`research.md`。
3. 如需新建周目录，复制 `03_input/weekly/00_template/` 的 Markdown 文件。
4. 用户日常可以直接要求 Codex「调用 learn-x-process，处理本周输入，生成 Weekly Output Dist」。
5. Skill 内部先调用确定性脚本：

   ```bash
   npm run process:weekly
   ```

   未传 `--week` 时，脚本按 `Asia/Shanghai` 自动选择周报目标：周一至周五默认上一 ISO 周，周六、周日默认当前 ISO 周。用户或自动化已经解析出目标周时，必须显式传 `--week YYYY-Www`，确保阶段 1 / 2 / 3 使用同一周。

   如需指定周：

   ```bash
   node .agents/skills/learn-x-process/scripts/generate-weekly-process-pack.mjs --week 2026-22
   ```

   该脚本写入 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `04_output/_dist/weekly/YYYY-Www/process-pack.md`，并在 `04_output/weekly/YYYY-WW.md` 不存在或为空时创建最小壳。
   如需指定月：

   ```bash
   node .agents/skills/learn-x-process/scripts/generate-monthly-process-pack.mjs --month 2026-01
   ```

   该脚本写入 `04_output/_dist/monthly/YYYY-MM/input.json` 和 `04_output/_dist/monthly/YYYY-MM/process-pack.md`，并在 `04_output/monthly/YYYY-MM.md` 不存在或为空时创建最小壳。
6. Codex 报告 `_dist` 路径、Output 最小壳路径和输入缺口，不生成 Weekly Output 正文。
7. 用户按 `04_output/usage.md`，把 `process-pack.md` 与需要的规则文件交给 AI Chat，自行生成并写入 Weekly Output 正文。
8. Weekly Output 与“芒格之魂”洞察完成后，提示用户在 Chat Pack「判断创造」中选择“公众号贴图”。界面默认选中该 Prompt、当前周 `04_output/weekly/YYYY-WW.md`、`01_core/道/` 和 `01_core/memory/`，其它上下文不选；不要代替用户上传或发布公众号。
9. 人工审核候选，不要直接写入正式 core 文件。
10. 如果用户要求 Memorize，由 Codex 判断周期并内部调用候选抽取脚本；用户不需要手动执行命令。Weekly 可调用：

   ```bash
   npm run memory:weekly
   ```

   未传 `--week` 时使用同一套周报目标选择规则；自动化阶段 3 应优先传入前序阶段保存的目标周。

   Monthly / Yearly 可调用：

   ```bash
   npm run memory:monthly -- YYYY-MM
   npm run memory:yearly -- YYYY
   ```

   然后读取 `resources/memory-rules.md` 和对应 `memory-candidates.md`，把已确认内容无损迁移到 Memory，并按来源周期排序；候选不足时报告不建议写入。
   Weekly 自动化将此作为阶段 3：只接受已勾选 checkbox 或行首结构化明确标记；未勾选条目即使包含‘继续追踪’‘重要’‘保留’等关键词也不得迁移。重复执行时不得重复追加同一条目。

## 输出要求

用户用 AI Chat 生成 Weekly Output 时，可参考 `resources/weekly-output-rules.md`。

Weekly Output 要综合三类输入：

- 本周有哪些信息输入；
- 本周有哪些真实行动；
- 本周有哪些自我反馈；
- 哪些行动产生了现实反馈；
- 哪些判断被验证、修正或暴露问题。

Weekly Output 默认围绕核心问题、做中学复盘、下周 3 件事、道 / 法 / 术和处理信息；行动闭环检查并入做中学复盘，不单独成节。

Memory 必须遵守 `resources/memory-rules.md`。已勾选内容全部进入，不设数量上限；只做无损整理，不做有损压缩。已勾选道 / 法 / 术候选观察与用户确认的“芒格之魂手动洞察”统一进入季度 Memory 文件顶部对应的候选观察池，并保留来源；未勾选内容默认不写入，只作为候选池。具体用法见 `04_output/usage.md`。

## 三层架构

1. Deterministic Collector：代码只收集、清洗、去重、编号、保留来源，并写入 `input.json` 中间态。
2. Process Pack：代码生成给 AI 读的材料包，按来源聚合正文，不做道 / 法 / 术 / Prompt / Skill 判断。
3. Output Shell：脚本只创建 `04_output/weekly/YYYY-WW.md` 最小壳；已有内容不改。
4. AI Chat Review：用户基于 Process Pack 和规则文件，在 AI Chat 中生成 Output 正文。
5. Memory：人工审核后，脚本抽取确认线索，Codex 再按规则无损整理为跨期上下文。

代码负责把混乱材料变成可信输入；AI Chat 负责辅助生成判断草稿；人负责决定什么值得写入 Output 和进入长期生命系统。

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
- `03_input/weekly/00_template/` 是每周输入文件模板，只保留 Markdown 文件。
- `resources/weekly-output-rules.md` 是用户生成 Weekly Output 正文时的质量规则；`resources/layer-rules.md` 是判断规则。
- `02_prompts/chatpack/reflective-decision/weekly-wechat-image.md` 是 Weekly Output 完成后生成两张公众号贴图的可编辑 Prompt。
- `resources/memory-rules.md` 是 Memory 的质量规则。
- 脚本只能做确定性整理、来源覆盖、Process Pack 生成和 Output 最小壳创建，不要把最终判断写死进代码。

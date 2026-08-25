---
name: learn-x-process
description_zh: 处理每周月度输入并生成输出壳与记忆候选
description: Process Learn-X 03_input into Process Pack and Output shell, then generate Memory candidates from reviewed Output. Use when the user asks for running weekly/monthly process, generating _dist, or preparing memory candidates.
---

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
- Monthly Process 读取目标月相交的周目录和指定月目录；前者提供周度原始证据，后者提供月记等月度独有输入。两者都不按 mtime 推断范围。
- 可以在 `04_output/weekly/YYYY-WW.md` 不存在或为空时创建最小壳；如果已有内容，不覆盖、不改写。
- 可以生成中间材料 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `04_output/_dist/weekly/YYYY-Www/process-pack.md`。
- 可以生成 metadata-only 的 `04_output/_dist/monthly/YYYY-MM/input.json`、压缩请求和自包含的 `process-pack.md`。
- 可以读取 `04_output/weekly/YYYY-WW.md`，抽取候选区内已勾选内容及两个精确系统确认章节，生成 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`，再由 Codex 无损整理写入 `01_core/memory/YYYY-QN.memory.md`。
- 可以读取 `04_output/monthly/YYYY-MM.md` 或 `04_output/yearly/YYYY.md`，抽取 Memory 候选包，供 Codex 无损整理写入季度或年度 Memory。
- Weekly Output 默认不固定输出图谱、第一性原理、Prompt、Skill、写作或 Demo 候选；必要时才可在做中学复盘或下周行动中简短提及。
- 可以维护 `03_input/README.md`、`04_output/README.md` 和 `03_input/weekly/00_template/` 下划线模板。
- 不要自动修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或 `.agents/skills/` 的正式资产。
- 不要引入数据库、RAG、自动抓取、多 Agent 或全自动价值判断。
- 不要把 `AGENTS.md`、`app/code/`、生成物或工具目录混入学习上下文。

## 标准流程

1. 先理解 `03_input/usage.md` 和 `04_output/usage.md` 的阶段边界：本 Skill 只在飞书周记/月记已人工确认并采回后生成 `_dist` 和 Output 最小壳，不生成日记草稿，也不代写 Output 正文。
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

   Weekly Process 在读取周目录时先执行单文件 15,000 Unicode 字符门禁。超限时汇总所有文件、保留原文件并停止，不生成或更新 `input.json`、`process-pack.md` 或 Output 壳。用户确认数据无误后，可运行 `npm run input:compress -- --week YYYY-Www` 生成批量压缩审核包；只有显式 `--apply --confirm` 才能把已审核候选写回原输入。

   `智慧之门` 的增值源是飞书 Base；采集入口读取结构化字段，并把 `长篇内容、原始内容` 做自适应高信号抽取：以每条约 300 Unicode 字符为中心，通常保留 200-500 字，预算根据独立核心判断、因果/模型结构、结论、边界、风险和与参考字段的关联度有限调整；短内容不硬扩，长内容不超过 500。只把压缩内容写入本地，原文不落盘。因此 `wisdom.md`、`input.json` 和 Process Pack 保持同一内容口径；需要核查长篇原文时回到 Base 链接。各来源仍记录原始字符数与纳入字符数，避免把材料体量和实际纳入上下文混为一谈。

   该脚本写入 `04_output/_dist/weekly/YYYY-Www/input.json` 和 `04_output/_dist/weekly/YYYY-Www/process-pack.md`，并在 `04_output/weekly/YYYY-WW.md` 不存在或为空时创建最小壳。
   如需指定月：

   ```bash
   node .agents/skills/learn-x-process/scripts/generate-monthly-process-pack.mjs --month 2026-01
   ```

   该脚本先读取相交周、月度独有输入，以及各周 Weekly Output 中系统确认的标题 10「全文核心重点纪要」和标题 11「芒格之魂的洞察」，执行日期过滤、空值过滤、Daily 元数据合并和去重；不读取 Weekly Output 的其它正文代替原始 Input。周目录存在 `_source-status.json` 时，只有 `ready` 文件进入 `input.json`、Process Pack 和月度输入；`empty/failed/unavailable` 的旧文件保留但被排除，状态表仍展示 0 条或失败原因。侧车缺失保持历史周兼容，格式非法则失败关闭。`ai`、`research`、`weread`、`build`、`build-bot` 必须按价值策略语义整理；AI 必须先排除提示词/模板，再逐周保留核心事件，不能跨周压成一个段落。月记、周记、Daily、Flomo、Health、Voice、Calendar 和 Time 默认只做确定性清洗。脚本写出 `compression-requests.json` 并停止；Codex 按 `learn-x-monthly-automation/references/monthly-compression.md` 生成结构化 `compressed-events.json` 后重跑。最终写入 metadata-only `input.json` 和不超过 100 KB 的固定分层 `process-pack.md`。
6. Codex 报告 `_dist` 路径、Output 最小壳路径和输入缺口，不生成 Weekly Output 正文。
7. 用户按 `04_output/usage.md`，把 `process-pack.md` 与需要的规则文件交给 AI Chat，自行生成并写入 Weekly Output 正文。
8. 人工审核候选，不要直接写入正式 core 文件。
9. 如果用户要求 Memorize，由 Codex 判断周期并内部调用候选抽取脚本；用户不需要手动执行命令。Weekly 可调用：

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
   Weekly 自动化将此作为阶段 3：精确标题「全文核心重点纪要」和「芒格之魂的洞察」是系统确认内容，无需 checkbox；前者进入当周 Memory，后者进入季度芒格洞察候选池。其余内容只接受候选区内已勾选 checkbox 或用户当场明确确认；禁止扫描普通正文，禁止把“继续追踪”“重要”“保留”“确认”等词语当作确认。道 / 法 / 术候选即使已勾选，也只进入季度顶部对应候选观察池，不进入普通 Memory。重复执行时不得重复追加同一条目。

## 输出要求

用户用 AI Chat 生成 Weekly Output 时，可参考 `resources/weekly-output-rules.md`。

Weekly Output 要综合三类输入：

- 本周有哪些信息输入；
- 本周有哪些真实行动；
- 本周有哪些自我反馈；
- 哪些行动产生了现实反馈；
- 哪些判断被验证、修正或暴露问题。

Weekly Output 默认围绕核心问题、做中学复盘、下周 3 件事、道 / 法 / 术和处理信息；行动闭环检查并入做中学复盘，不单独成节。

Memory 必须遵守 `resources/memory-rules.md`。只有精确标题「全文核心重点纪要」和「芒格之魂的洞察」可作为系统确认章节；允许轻度去重压缩，但不得丢失独立判断。其余只处理候选区内已勾选内容或用户当场明确确认内容。已勾选道 / 法 / 术候选观察进入季度 Memory 文件顶部对应候选池，并保留来源，不进入普通 Memory；普通正文和未勾选内容默认不写入。具体用法见 `04_output/usage.md`。

## 六阶段架构

1. Deterministic Collector：代码收集周度与月度来源，过滤月份、空值和重复元数据，并生成压缩请求与 metadata-only `input.json`。
2. Compression：Codex 按信息价值把长来源拆成结构化事件；脚本校验哈希、日期、来源覆盖、AI 逐周核心事件、正文结构和总体积，不在代码中调用 AI。
3. Process Pack：代码按「核心判断 / 自我反馈 / 行动反馈 / 支撑输入 / 审计」固定层级组装自包含材料包，并把来源内部标题统一降级；不做道 / 法 / 术 / Prompt / Skill 判断。
4. Output Shell：脚本只创建对应周期 Output 最小壳；已有内容不改。
5. AI Chat Review：用户基于 Process Pack 和规则文件，在 AI Chat 中生成 Output 正文。
6. Memory：人工审核后，脚本抽取确认线索，Codex 再按规则无损整理为跨期上下文。

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
- `resources/memory-rules.md` 是 Memory 的质量规则。
- 脚本只能做确定性整理、来源覆盖、Process Pack 生成和 Output 最小壳创建，不要把最终判断写死进代码。

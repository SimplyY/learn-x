# 本周 Codex Build 复盘

> 周期：2026-06-01 至 2026-06-07  
> 目的：为 `03_input/weekly/2026-W23/02_action/build.md` 积累本周 Codex / Code X 构建证据，供后续 Weekly Input / Output 流程使用。  
> 边界：这是行动复盘，不是 Memory，不是正式 `道/`、`法/`、`术` 入库结论。

## 来源与覆盖范围

本次可用来源：

- 项目文档：`AGENTS.md`、`README.md`、`TECH.md`、`03_input/README.md`、`03_input/usage.md`、`04_output/README.md`、`04_output/usage.md`、`.agents/skills/learn-x-process/SKILL.md`。
- Git 证据：主仓库 2026-06-01 至 2026-06-05 的提交与当前工作区 diff；`app/code` 嵌套仓库当前 diff。
- 本地 Codex 记录：`~/.codex/archived_sessions/` 中 2026-06-03 至 2026-06-05 与 Learn-X 命中的会话片段。
- 自动化记忆：`~/.codex/automations/learn-x-codex-build/memory.md`。
- 当前产物：`04_output/monthly/2026-05.md`、`01_core/memory/2026-Q2.memory.md`、`04_output/_dist/monthly/`、`04_output/_dist/weekly/2026-W22/`。

不可用或不完整来源：

- 未发现仓库内 `.codex` 会话文件；只能读取 `~/.codex/archived_sessions/` 中可访问的归档记录。
- 要求中的 `app/code/docs/FEAT.md` 与 `app/code/docs/TECH.md` 当前不存在；项目实际技术索引在根 `TECH.md`，`app/code` 内旧 `docs/feat.md`、`docs/tech.md` 处于删除状态。
- 本地聊天记录只能作为辅助线索；本报告只把能被文件、提交、diff 或最终会话摘要佐证的内容纳入结论。

## 本周最核心事项

1. Learn-X 从“周度流程”扩展为“周 / 月 / 年周期输出系统”。  
   `learn-x-process` 新增月度 Process Pack、月度 / 年度输出规则、周期 Memory 候选抽取入口，并把 `03_input/monthly/`、`04_output/monthly/`、`04_output/_dist/monthly/` 纳入工作流。

2. Chat Pack 的 Output 边界进一步收敛。  
   周 / 月 / 年 Output 子类型明确属于 `reflective-decision`，在界面归入「判断」大类；周期快捷选择默认选 Markdown 材料，`input.json` 只用于来源审计；`01_core/memory` 被纳入默认推荐上下文。

3. Memory 规则从“压缩少量摘要”转向“已确认内容无损迁移”。  
   `memory-rules.md` 明确：勾选内容必须进入 Memory，不设数量上限；候选观察池统一承接道 / 法 / 术候选；Codex 不自动升级正式长期资产。

4. Learn-X 的文档边界被重新收紧。  
   根 README 继续保持系统总览、核心原则和入口地图；功能细节下沉到 `03_input/`、`04_output/`、`TECH.md` 和 Skill 文档。

5. 工程迁移风险仍然存在。  
   主仓库把旧 `public/`、`scripts/`、`server.mjs` 删除并指向 `app/code`；但 `app/code` 自身还有大量未提交改动，且旧 `app/code/docs/*`、`package.json`、`package-lock.json` 等处于删除状态。

## 核心功能与系统变化

### Input / Output

- `03_input/` 从旧的 inbox / action / log 结构，迁移到 `weekly/YYYY-Www/{00_log,01_inbox,02_action}`、`monthly/`、`yearly/` 的周期结构。
- Weekly Process 不再按 mtime 或旧 weekly index 推断范围，而是读取指定周目录。
- Monthly Process 新增 `generate-monthly-process-pack.mjs`，按月目录生成 `04_output/_dist/monthly/YYYY-MM/input.json` 与 `process-pack.md`。
- `04_output/usage.md` 明确：脚本生成 `_dist` 和 Output 最小壳，正文由用户在 AI Chat / Chat Pack 中生成并人工写入。

### Chat Pack

- `00_config/chatpack.config.json` 增加 `weekly-output`、`monthly-output`、`yearly-output` 三个子类型。
- 增强器体系扩展，包括字数控制、挑战观点、芒格之魂等；字数控制通过同组互斥降低提示冲突。
- 前端新增周期快捷选择逻辑：周输出选 weekly process pack；月输出选 monthly process pack；年输出优先选 yearly process pack，否则选当年 Monthly Output。
- `Current Question` 不再持久化到 localStorage，避免旧问题污染新会话。

### Memory

- 新增 `prepare-period-memory.mjs`，支持 `npm run memory:monthly -- YYYY-MM` 与 `npm run memory:yearly -- YYYY`。
- Weekly Memory 脚本支持 `YYYY-Www` 与 `YYYY-WW` 两种输入，并把输出小节统一为 `YYYY-Www`。
- `01_core/memory/2026-Q2.memory.md` 已包含 `Monthly｜2026-05` 小节和候选观察池，说明月度输出已经进入 Memory 处理闭环。

### 本地应用 / app/code

- 根 `TECH.md` 现在是项目级技术索引，说明 Code / Skill / Prompt / Core 边界。
- 静态图谱脚本 `app/code/scripts/static-graph.mjs` 被加入，用 `markdown-it`、`jsdom`、`dompurify` 生成可清理的静态数据。
- `app/code/public/app.js` 大幅扩展，承担 Chat Pack 组装、上下文预算、周期选择、增强器选择、自定义上下文等前端逻辑。
- `app/code` 仍是嵌套 Git 仓库，当前工作区未提交：旧 docs 和 package 文件删除，前端、服务端、构建脚本修改，新增 `scripts/static-graph.mjs`。

## 关键任务与项目推进

- 2026-06-01：提交 `1.0`，强化 Chat Pack Prompt、Codex Build prompt、增强器、读书 / 领域研究 / 系统审计等子类型。
- 2026-06-05：提交 `v1.0`，完成输入结构大迁移、月度流程、输出规则拆分、项目级 `TECH.md`、`TODO.md`、月度输入与月度输出初始化。
- 2026-06-05：提交“修改细节”，继续调整周 / 月 / 年输出规则、Chat Pack 配置、`04_output` 文档和 2026-05 月报。
- 2026-06-05：提交 `.gitignore` 更新。
- Codex 会话中完成过一次文档同步审查：确认根 README 变短，旧路径引用清理，`collectWeeklyInput` 能读取 `2026-W22` 和 `2026-W23`。
- Codex 会话中完成过 Chat Pack / Output 边界同步：补齐 `TECH.md`、`04_output/README.md`、`04_output/usage.md`，明确 `input.json` 不进入周期默认上下文。
- 另有技能安装和横纵分析报告等 Codex 活动，但与 Learn-X 建设只有间接关系，本报告不展开。

## 对 Learn-X 的意义

本周最大的意义不是“功能更多”，而是 Learn-X 的边界更像一个可运行的个人认知操作系统：

- `03_input` 负责证据进入；
- `_dist/process-pack.md` 负责可信材料包；
- Chat Pack 负责智能生成草稿；
- Output 负责人工审稿；
- Memory 负责跨期上下文；
- `道/`、`法/` 仍由人确认，不被脚本自动写入。

这条链路让 AI Builder 工作流更接近“知行合一”：Codex 不再只是写代码，而是在帮助建立可追溯的学习、行动、复盘和记忆系统。

但本周也暴露一个反向风险：工具层变化很快，文档、脚本、生成物、嵌套仓库和 Chat Pack 配置同时变动。如果不控制边界，Learn-X 容易从“降低认知成本”变成“制造维护成本”。

## 后续建议

### 必须做

- 先收敛 `app/code` 的仓库状态。明确它到底是子模块、嵌套仓库，还是普通目录；否则主仓库的可审计性会长期受损。
- 清理或明确 `.DS_Store`、图片、大量 `_dist` 生成物的版本控制策略；不要让生成物和系统真值混在一起。
- 为周 / 月 / 年 Output 跑一次最小端到端验收：输入目录 -> `_dist/process-pack.md` -> Chat Pack 默认勾选 -> Output -> Memory candidates。
- 将 Codex Build 复盘统一归入 `03_input/weekly/YYYY-Www/02_action/build.md`；旧的 `03_input/action/build/` 不再作为新自动化落点。

### 值得做

- 给 Chat Pack 的周期快捷选择补一份轻量验收清单，重点检查：不默认选 `input.json`、月度不回捞 `03_input/`、年度优先使用年度 process pack 或月报。
- 给 Memory 流程加 2-3 个小样本测试，验证 checkbox、明确标记、候选观察池、周 / 月 / 年目标文件。
- 在 `TECH.md` 中补一句当前真实文档位置，避免未来 agent 继续寻找不存在的 `app/code/docs/FEAT.md`。
- 把 2026-05 月报中已确认的候选继续用于 6 月行动闭环，而不是继续扩系统结构。

### 暂时不该做

- 不要新增数据库、RAG、多 Agent 或自动抓取系统。
- 不要把 Chat Pack 扩成复杂产品；先证明它能稳定减少每周 / 每月输出摩擦。
- 不要自动改写 `01_core/道/`、`01_core/法/`，即使月报里出现很漂亮的候选表达。
- 不要继续把根 README 写厚；根 README 只做入口地图。

## 当前最缺的东西

1. 一个干净、可提交、可回滚的工程边界。  
   当前 `app/code` 和主仓库之间的关系最不清楚。

2. 一个真实端到端验收记录。  
   现在有脚本、规则、文档和产物，但缺一份“我从输入到 Memory 完整跑通”的验收证据。

3. 一个减负指标。  
   Learn-X 本周功能增长很快，但还需要回答：它是否让你更快判断、更快行动、更少维护。

## 下周优先级

1. **工程收口**：整理主仓库与 `app/code` 的 Git 状态，决定提交边界，避免迁移长期悬空。
2. **端到端验收**：选一个小周期，完整跑通 Weekly 或 Monthly Output + Memory，不追求内容漂亮，只验证流程可信。
3. **输入秩序**：后续 Codex Build 复盘统一追加到对应周目录的 `02_action/build.md`。
4. **减法审计**：删除或隔离不该进入学习上下文的生成物、临时文件和系统噪声。
5. **行动优先**：把 6 月 Learn-X 的使用目标压缩成一个现实问题，例如“本周是否帮助完成一个教育 / AI 读书 / 自我复盘的小闭环”。

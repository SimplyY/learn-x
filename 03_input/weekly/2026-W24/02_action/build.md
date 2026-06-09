# build

## 2026-06-08 Codex Build 复盘

### 来源与覆盖范围

本次运行日期是 2026-06-08，按 ISO 周属于 `2026-W24`，因此本记录写入本周目录 `03_input/weekly/2026-W24/02_action/build.md`。因为本周目录原本不存在，已按规则从 `03_input/weekly/00_template/` 复制目录结构。

可用来源包括：项目 `AGENTS.md`、根 `README.md`、根 `TECH.md`、`03_input/usage.md`、`04_output/README.md`、`04_output/usage.md`、`.agents/skills/learn-x-process/SKILL.md`、自动化记忆、主仓库 git 状态与 diff、本地 `.codex/sessions` / `.codex/archived_sessions` 中可检索到的 Learn-X 相关记录。

不可用或不完整来源：无法访问完整聊天平台历史；只能读取本机可访问的 Codex 会话文件和项目证据。旧路径 `app/code/docs/FEAT.md` 与 `app/code/docs/TECH.md` 当前不存在，实际技术索引是根 `TECH.md`。因此以下结论只基于可验证的本地文件、diff、自动化记录和可访问会话片段，不虚构完整聊天内容。

### 总览

最近一周最核心的变化不是新增某个单点功能，而是 Learn-X 的“输入、输出、记忆、自动化”边界被进一步校正：Codex Build 复盘从旧的独立文件路径迁入 Weekly Input 的行动证据区；Memory 从“压缩少量摘要”转为“人工勾选内容无损迁移”；周 / 月 / 年 Output 继续保持 `_dist -> AI Chat / Chat Pack -> Output -> Memory` 的审稿链路；同时，新的每周输入自动采集自动化被设计出来，用来处理刚结束的上一 ISO 周输入。

这说明 Learn-X 正在从“能生成材料”进入“能形成稳定证据流”的阶段。真正重要的是：工具开始服从行动证据，而不是反过来要求人维护工具。

### 本周最核心事项

1. **Codex Build 复盘落点修正。**  
   用户明确指出旧路径 `03_input/action/build/YYYY-MM-DD_weekly-codex-build.md` 不再适用；自动化应按运行日期所属 ISO 周写入 `03_input/weekly/YYYY-Www/02_action/build.md`。2026-06-07 的 canonical 复盘已迁入 `2026-W23`，本次则按 2026-06-08 所属 `2026-W24` 新建目录并写入当前记录。

2. **Memory 规则从压缩转为无损迁移。**  
   `memory-rules.md`、`04_output/README.md`、`04_output/usage.md`、`learn-x-process/SKILL.md` 都围绕同一原则收敛：已勾选内容必须进入 Memory，不设数量上限；Codex 只做无损整理，不把漂亮候选直接升级为正式 `道/`、`法/`、`术`。

3. **月度 Output 已进入 Memory 闭环。**  
   `01_core/memory/2026-Q2.memory.md` 已出现 `Monthly｜2026-05` 小节和候选观察池；`04_output/monthly/2026-05.md` 被重写为更清晰的月度审稿材料。它说明 Learn-X 已从周度试运行推进到月度沉淀。

4. **Weekly Input 自动采集自动化被设计并创建。**  
   本地 Codex 会话显示，新的 `Learn-X 每周输入自动采集报告` 自动化被创建，用于每周一 08:00 按 Asia/Shanghai 处理刚结束的上一 ISO 周，尝试采集飞书、Flomo、AI 对话摘要与 Codex build 记录，再调用 `learn-x-process` 生成 `_dist` 和 Output 最小壳。

5. **工程风险仍集中在版本边界。**  
   当前工作区仍有多处未提交改动，包含 `.DS_Store`、Memory / Output 规则、月报、自动化落点迁移、`package.json` 脚本，以及大量 `_dist` 生成物和 `app/code` 相关变化。对 Learn-X 来说，这不是功能风险，而是可审计性风险。

### 核心功能与系统变化

正文层面需要关注三条线。

第一，**行动证据正在归位**。Codex Build 不再被放在跨周的旧 action/build 目录里，而是进入每个 Weekly Input 的 `02_action/build.md`。这让每周 Output 可以直接把 Codex / Code X 工作当成本周行动证据读取。

第二，**Memory 不再追求“极薄摘要”的漂亮压缩**。新的规则更尊重人工确认：勾选多少迁移多少，候选观察池只负责承接道 / 法 / 术候选，正式升级仍由人决定。这更符合 Learn-X 的价值边界：AI 负责整理，人负责判断。

第三，**自动化被分成采集层和确定性处理层**。新自动化的口径是先采集上一周输入，再调用现有 `learn-x-process`。这比把浏览器抓取、AI 判断和 Output 正文生成塞进一个脚本更稳，也更容易审计失败项。

### 关键任务与项目推进

- 已修正 Codex Build 自动化的长期落点：从旧路径迁入 `03_input/weekly/YYYY-Www/02_action/build.md`。
- 已创建本次 `2026-W24` 周目录，说明周目录模板机制可以支撑新周启动。
- 已把 Memory 规则、Output 文档和 Skill 文档同步到“无损迁移 + 候选观察池 + 人工确认”的口径。
- 已形成新的每周输入自动采集自动化思路，并在本地自动化系统中创建 `Learn-X 每周输入自动采集报告`。
- 已继续推进 2026-05 月度 Output 和 Q2 Memory，让月度复盘不只停留在报告，而能进入跨期上下文。

### 对 Learn-X 的意义

这次最有价值的不是“又多一个自动化”，而是 Learn-X 的证据链更顺了：

`Codex / Code X 行动 -> Weekly Input build.md -> Weekly Output -> Memory -> 候选观察池 -> 人工决定是否升级道法术`

这条链路让 AI Builder 的工作不再散落在聊天、脚本和临时文件里，而能进入个人认知系统的正常消化流程。它也提醒一个关键原则：Codex 的产出不是长期真理，只是行动证据和审稿材料。

### 后续建议

**必须做**

- 继续坚持新的 Codex Build 落点，不再创建 `03_input/action/build/` 下的独立周报文件。
- 给 `2026-W24` 补充真实输入后，跑一次 `learn-x-process`，验证 `build.md` 是否能被 Weekly Process 正确纳入行动证据。
- 清理或明确 `.DS_Store`、`_dist`、图片、`app/code` 相关变更的追踪策略，避免生成物和正式知识资产混在一起。

**值得做**

- 给新建的每周输入自动采集自动化做一次小样本试运行，只验证范围、路径和失败报告，不追求一次采集齐所有来源。
- 给 Memory 流程补一个最小验收：选一个已勾选样本，确认候选抽取、无损迁移、候选观察池写入都符合规则。
- 在下一次 Weekly Output 中专门观察：Codex Build 行动证据是否真的帮助判断“本周做了什么”，而不是制造更多记录负担。

**暂时不该做**

- 不要把输入自动采集扩成全自动生活抓取系统；飞书、Flomo、AI 对话能跑通就够，播客、微信、会议仍应保留人工补充。
- 不要让 Codex 自动改写 `01_core/道/`、`01_core/法/`。
- 不要为了自动化完整性引入数据库、RAG、多 Agent 或复杂调度。

### 当前最缺的东西

最缺的是一次真实的 W24 端到端验收：把本文件和其它本周输入一起进入 `process-pack.md`，再进入 Weekly Output，最后把人工确认内容写入 Memory。只有这一步跑通，Codex Build 复盘才从“记录”变成“行动反馈”。

### 下周优先级

1. 以 `2026-W24` 为样本跑通 Weekly Input -> `_dist` -> Output -> Memory 的最小闭环。
2. 对新输入采集自动化做一次范围验证，重点检查“上一 ISO 周”与“当前运行周”的边界是否混淆。
3. 收敛 git 工作区：把文档口径、Memory 规则、自动化落点、生成物策略分批提交或明确暂存。
4. 把 Learn-X 的成功标准压回一句话：是否帮助更快判断、更少维护、更靠近真实行动。

### 附录：细节证据

- 本次运行日期：2026-06-08，ISO 周：2026-W24。
- 本次写入路径：`03_input/weekly/2026-W24/02_action/build.md`。
- 已确认不可用旧索引：`app/code/docs/FEAT.md`、`app/code/docs/TECH.md`。
- 当前实际技术索引：根 `TECH.md`。
- 可访问 Codex 记录：`/Users/yuwei/.codex/sessions/2026/06/07/`、`/Users/yuwei/.codex/sessions/2026/06/08/`、`/Users/yuwei/.codex/archived_sessions/` 中的相关 jsonl。
- 主要变更文件：`.agents/skills/learn-x-process/`、`01_core/memory/2026-Q2.memory.md`、`03_input/usage.md`、`03_input/weekly/2026-W23/02_action/build.md`、`04_output/README.md`、`04_output/usage.md`、`04_output/monthly/2026-05.md`、`package.json`。

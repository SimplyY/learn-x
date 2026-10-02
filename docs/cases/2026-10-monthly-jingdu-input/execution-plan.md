# Execution Plan：月记草稿接入周度精读

需求：[`docs/requirements/2026-10-monthly-jingdu-input.md`](../../requirements/2026-10-monthly-jingdu-input.md)

## 方案原文

# 月记草稿接入周度精读

## 背景与目标

这次只改**月记草稿**的输入范围，周记仅作来源参考，不改周记流程。

现状是：周度流程已采集 `jingdu.md`，内容是微信读书划线、本人理解或判断，以及可选行动；月度读取也会收集状态为 `ready` 的周输入。缺口在月记草稿的来源清单：它没有规定如何使用精读材料。[周度精读规则](</Users/yuwei/code/learn-x/.agents/skills/learn-x-weekly-automation/SKILL.md:175>) [月度周输入读取](</Users/yuwei/code/learn-x/.agents/skills/learn-x-process/scripts/monthly-process-input.mjs:43>) [月记草稿来源清单](</Users/yuwei/code/learn-x/.agents/skills/learn-x-monthly-journal/SKILL.md:18>)

本次已对齐：**只把精读接入月记**；跨月周只纳入日期明确且属于目标月的精读条目。

## 具体方案

- 从与目标月相交的周目录读取 `jingdu.md`，仅使用来源状态为 `ready` 的内容。`empty` 不阻塞；失败、不可用、待审核或状态不明的旧文件不作为本轮事实。
- 将精读中的本人理解、判断和行动线索，作为月记现有“学习”分类的证据。保留书名或原划线等必要上下文；只基于本人参与加工的内容总结，不把原始划线单独写成用户观点。
- 对完整落在目标月内的周，按现有规则读取；对跨月周，逐条核对日期，只纳入目标月内且日期明确的条目。月外或日期不明的条目不写入，并在运行汇报中说明缺口。
- 沿用月记模板，不新增“精读”章节，也不改周记、采集器或 Monthly Process Pack。Coach、智慧之门、微信、飞书文档等来源本次都不接入。

杠杆点是复用已有周输入和状态门禁，只补上月记草稿的来源规则与字段映射；不另建月度精读汇总文件。本次没有其他架构或接口取舍。

## 流程图与复杂度

需求复杂度：低；系统复杂度：低；改造影响面：低。总分 0，定档“特别简单”。

```mermaid
flowchart LR
  A[周目录 jingdu.md] --> B{来源 ready？}
  B -- 否 --> C[跳过并报告状态]
  B -- 是 --> D[筛选目标月精读条目]
  D --> E[月记现有“学习”分类]
```

## 里程碑与验收

| 里程碑 | 工作 | 验收证据 |
|---|---|---|
| M0 文档落盘 | 获准实施后，保存并读回 Requirement、Execution Plan、Case；本计划阶段不写文件 | 原始需求、已确认裁决、完整方案与路径映射一致 |
| M1 月记接入 | 只更新月记草稿 Skill 中的来源清单、精读使用规则、边界处理和缺口汇报 | `jingdu.md` 仅进入月记“学习”分类；周记规则不变 |
| M2 场景验收 | 按完整月内周、跨月周、缺失日期和来源状态走查 | 月内明确日期被纳入；月外与日期不明条目被排除并报告；非 `ready` 旧文件不被读取 |
| M3 回退检查 | 检查模板和其他来源规则未变 | 改动可通过回退月记 Skill 单文件撤销；没有输入文件或飞书内容被改写 |

这是 Skill 规则调整。本计划阶段没有修改文件、运行测试或写入飞书；实施时按上述场景验收，不预设测试已通过。当前仓库没有真实 `jingdu.md` 样本，只有空模板；因此记录日期格式仍未知，日期无法确认时按已确认规则跳过。

## 决策与落盘映射

已确认范围：月记新增精读来源；周记不改；跨月条目仅纳入目标月内且日期明确的内容。Core 及其他候选来源排除在本方案外。无需 ADR；实施完成前不更新 `docs/architecture.md`。

获准实施后拟使用以下路径，当前均未创建：

- Requirement：`docs/requirements/2026-10-monthly-jingdu-input.md`。保留本会话原始请求和后续裁决，注明后续裁决如何收窄原先提及 Core 的范围。
- Execution Plan：`docs/cases/2026-10-monthly-jingdu-input/execution-plan.md`。保存本方案全文，并附来源现状、无真实精读样本这一未知项及验收证据要求。
- Case：`docs/cases/2026-10-monthly-jingdu-input/case.md`。建议类型 Minor；记录当前尚未实施、后续 M0–M2 的真实进度。现有仓库搜索未发现对应的月记精读 Case。

会话标题：月记草稿接入周度精读（本轮未改名；Plan Mode 下未执行界面修改）

## Execution Handoff

### 执行范围

- 核心行为改动：`.agents/skills/learn-x-monthly-journal/SKILL.md`。
- 调用方衔接：`.agents/skills/learn-x-monthly-automation/SKILL.md` 只增加显式 `ready` 精读条目的跨月边界例外。
- 不修改 `.agents/skills/learn-x-weekly-automation/`、采集器、Monthly Process Pack、模板、03_input 或飞书内容。
- 不纳入 Core、Coach、智慧之门、微信、飞书文档等来源。

### 实施调整说明

复核运行时调用方后发现，`learn-x-monthly-automation/SKILL.md` 原有规则禁止所有边界周内容写入月记，与本需求“跨月周内目标月且日期明确的精读条目可以纳入”直接冲突。为使月记规则在真实调用链中生效，只为状态明确为 `ready` 的 `jingdu.md` 增加窄例外；其他边界周来源及缺口规则不变。通用月度输入采集器与 Monthly Process Pack 仍不修改。

月度采集器为兼容历史周，在 `_source-status.json` 缺失时仍可能收集旧文件。本次范围只要求月记事实选择中的 `jingdu.md` 必须显式 `ready`，因此月记 Skill 对该文件施加独立门禁；没有侧车或没有对应精读状态时不把文件内容作为月记事实。此规则不改变 Monthly Process Pack 的通用历史周兼容行为。

### 实施映射

1. 在月记草稿来源清单加入周目录的 `jingdu.md`，读取前要求来源状态为 `ready`；`empty` 不阻塞。失败、不可用、待审核、未知状态或旧文件内容均跳过并报告。
2. 精读只作为现有“学习”分类的证据。保留必要的书名/划线上下文；总结必须基于用户自己的理解、判断或行动线索，不能把纯原始划线写成用户观点。
3. 完全位于目标月的相交周沿用既有周输入读取规则。跨月周逐条核对日期，只使用目标月且日期明确的条目；目标月外和日期不明的条目排除并报告。不能沿用通用边界过滤对“无日期分段”返回全文的 fallback 来处理 `jingdu.md`。
4. 月记模板保持不变。运行汇报说明精读来源状态、覆盖的周目录/条目，以及跨月日期缺失或被排除的情况。

### 现状与证据

- `.agents/skills/learn-x-monthly-journal/SKILL.md` 的当前来源清单遗漏 `jingdu.md`。
- `.agents/skills/learn-x-weekly-automation/SKILL.md` 已定义精读内容与 `ready` 门禁，作为上游来源契约。
- `.agents/skills/learn-x-process/scripts/monthly-process-input.mjs` 已遍历与目标月相交的周目录；若侧车为某文件提供状态，非 `ready` 文件会被排除，但侧车缺失时保留历史周兼容。月记 Skill 因而对 `jingdu.md` 要求显式 `ready`，不依赖历史兼容默认值。
- 通用跨月文本过滤器遇到没有日期分段的全文会保留原文。月记 Skill 必须为 `jingdu.md` 定义更严格的逐条显式日期要求。
- 当前只有 `03_input/weekly/00_template/jingdu.md` 空模板，缺少真实样本，真实条目的日期格式未知。

### 验收要求

- 逐场景核对完整月内周、跨月周、日期缺失、来源 `ready`/`empty`/失败或未知状态。
- `git diff --check` 与 Skill 自带快速校验通过；如运行相关现有测试，记录准确命令和真实输出。
- 最终 diff 仅涉及新建的 Requirement/Execution Plan/Case、月记草稿 Skill 与月度自动化 Skill 的窄边界例外；确认周记规则、其他来源、采集器和模板未变。
- 真实月记生成尚无 `jingdu.md` 样本进行端到端验证时，报告该限制，不声称已实测内容纳入。

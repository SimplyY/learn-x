# Case：月记草稿接入周度精读

- 类型：Minor
- 状态：规则实施完成，样本级验收受限
- Requirement：[`docs/requirements/2026-10-monthly-jingdu-input.md`](../../requirements/2026-10-monthly-jingdu-input.md)
- Execution Plan：[`execution-plan.md`](execution-plan.md)
- 影响文件：`.agents/skills/learn-x-monthly-journal/SKILL.md`、`.agents/skills/learn-x-monthly-automation/SKILL.md`（仅调用方衔接）

## 当前进度

### M0 文档落盘

- 状态：完成。
- 已创建并读回 Requirement、Execution Plan 与本 Case。
- 验收证据：Requirement 保留原始 Core 相关请求与后续范围收窄；Execution Plan 保留方案全文并补充实施交接；三份文档的路径、范围、未知项一致。

### M1 月记接入

- 状态：完成。
- 改动：月记草稿 Skill 加入 `jingdu.md` 显式 `ready` 门禁、跨月显式日期筛选、现有“学习”分类映射和缺口汇报；月度自动化 Skill 增加对应的窄边界周例外。
- 调整原因：上层自动化 Skill 原先禁止所有边界周材料写入，与已确认的跨月精读规则冲突。

### M2 场景验收

- 状态：规则走查通过，真实样本验收受限。
- 已走查：月内完整周且 `ready` 按周使用；跨月周仅纳入有明确目标月日期的条目；月外和无日期条目排除并报告；`empty` 跳过但不阻塞；`needs_review/failed/unavailable`、无显式来源状态或保留旧文件跳过并报告；损坏侧车沿用原有失败关闭规则。
- 限制：当前无真实 `jingdu.md` 输入样本，只有空模板；实际记录日期格式及内容纳入效果不能端到端确认。

### M3 回退检查

- 状态：通过。
- 证据：行为改动仅涉及月记草稿 Skill 的来源规则和月度自动化 Skill 的窄调用方衔接；Requirement、Execution Plan 与 Case 是任务记录。周记规则、采集器、Monthly Process Pack、模板、`03_input` 和飞书内容未改。回退两处 Skill 规则改动即可撤销行为变化。

## 验证记录

- `rtk python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-monthly-journal`：通过，输出 `Skill is valid!`。
- `rtk python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-monthly-automation`：通过，输出 `Skill is valid!`。
- `git diff --check`：通过，无空白错误。
- 未运行月度生成流程或写入飞书；无真实精读样本，因此没有端到端确认内容筛选效果。

## 决策

- 精读只接入月记草稿，周记流程不改。
- 跨月周只纳入日期明确且属于目标月的精读条目。
- Core、Coach、智慧之门、微信、飞书文档等本轮不接入。
- 无需 ADR；实施完成前不更新 `docs/architecture.md`。

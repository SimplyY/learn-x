# CASE: Learn-X 季度长期 Memory 审查与压缩

- 状态：已确认（需求已冻结；用户已授权 ywdev 实施）
- 最后核对日期：2026-11-23
- 上下游链接：[Requirement Truth](../../requirements/2026-11-quarterly-memory-compression.md) → [Execution Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Requirement: docs/requirements/2026-11-quarterly-memory-compression.md
- Architecture / Planning: docs/architecture.md（未更新，实施完成后增量维护）/ [Execution Plan](execution-plan.md)
- ADR: None
- Implementation: None（实施进行中，见执行状态）
- Acceptance: None
- Version: None

## 执行状态
- 当前有效方案：[Execution Plan](execution-plan.md)（用户 2026-11-23 明确指令"使用ywdev 完整执行前面的方案"确认）
- 完整授权范围与阶段顺序：用户指令授权 ywdev 执行方案 M0（规划资产落盘）→ M1（季度规划与上下文包 + 单测）→ M2（quarterly mode 校验与导入 + 单测）→ M3（晋级适配 + 回滚单测）→ M4（月度自动化解耦与文档同步 + 回归）→ 收口（全量测试、对抗性审查、Q3 真实上下文包演练检查）；M5 真实 ChatGPT 端到端演练需用户本人参与，实施完成时交接。
- 最后已验证里程碑：M4 完成（2026-11-23）。M0 落盘读回（三文档 SHA-256 记录于会话证据）；M1–M3 实施并单测通过；M1 验证门槛：真实仓库生成 2026-Q3 上下文包（04_output/_dist/memory-compression/quarterly-2026-Q3/quarterly-compression-pack.md，A–E 五段齐全，11 个真实缺口如实标记）；M4 月度 SKILL/文档解耦完成。
- 剩余事项：M5 真实端到端演练（用户载入 Q3 上下文包 → ChatGPT 审查 → 交付导入 → 确认晋级），需用户参与。
- 下一步：用户执行 M5；演练中发现交付契约问题时按 Case 记录并修订。
- 阻塞 / 待核实副作用：None（10 个在途未提交文件属其他任务，实测与本方案改动集不相交、未被触碰）。
- 证据：① 单测：memory-compression.test.mjs 14 项 + quarterly-memory.test.mjs 14 项（覆盖 RT 验收 2/3/4/5/6/7/9 场景）；② 回归：learn-x-process 全量 node --test 174 项通过（含在途周度工作测试）、monthly-automation 17 项通过；③ 真实 Q3 包生成输出（status pack_ready，gapCount 11）；④ 引擎改动 diff +103 行、新脚本 quarterly-memory.mjs（语法 node --check 通过）。
- 工作区核对时间：2026-11-23 14:1x Asia/Shanghai

## 来源与落点核对
- 原始输入（Requirement Truth v1.0 全文）→ docs/requirements/2026-11-quarterly-memory-compression.md §来源原文（逐字）。
- 完整方案（ywplan 技术方案全文）→ docs/cases/2026-11-quarterly-memory-compression/execution-plan.md §方案原文（逐字）+ §Execution Handoff。
- 用户追加裁决（ywdev 授权、Code X 自动化澄清）→ Requirement Truth §用户追加确认。

## 来源核验
- 状态：通过（M0 三文档写入后逐字节读回，章节结构核验：Requirement 全 10 节 + Prompt 四部分；Plan 含方案原文 + 六类 Handoff 附录）
- 机器收据：None（直接 ywdev 自读回核验，未走 ywexec handoff-check 收据流程；哈希见会话证据）
- 缺口报告：None

## 执行入口
目标仓库 /Users/yuwei/code/learn-x。先读 docs/requirements/2026-11-quarterly-memory-compression.md、docs/cases/2026-11-quarterly-memory-compression/execution-plan.md（含 Execution Handoff）与本 case.md；复核 Git 状态与 10 个在途未提交文件的隔离边界；M1–M4 已完成（证据见执行状态），下一里程碑为 M5 真实端到端演练：用户用 ChatGPT 载入 04_output/_dist/memory-compression/quarterly-2026-Q3/quarterly-compression-pack.md 完成审查并交付，随后按 learn-x-quarterly-memory SKILL 阶段 3/4 执行 import、校验、用户确认与逐候选 --promote --confirm。接手者须重读材料、复核 Git 状态、逐一阅读 quarterly-memory.mjs 与 memory-compression.mjs 改动并自行推导实现，不把本 Case 结论当新鲜事实。

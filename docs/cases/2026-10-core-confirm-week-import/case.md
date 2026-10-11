# CASE｜Core 复盘按确认周进入 Learn-X

- 状态：本地实现、隔离端到端验收与独立 yw-testing 完成；真实导出待首次出现后只读核验
- 最后核对日期：2026-10-11
- 上下游链接：[Requirement Truth](../../requirements/2026-10-core-confirm-week-import.md) → [Execution Plan](execution-plan.md)
- Type: Patch
- Status: Complete
- Requirement: [2026-10-core-confirm-week-import](../../requirements/2026-10-core-confirm-week-import.md)
- Architecture / Planning: None / [Execution Plan](execution-plan.md)
- ADR: None
- Implementation: 本地未提交改动，见采集器与其定向测试。
- Acceptance: 临时 Core 导出 → Learn-X 周文件 → Process 输入的隔离端到端测试与独立对抗测试通过；真实 Core 导出仍待首次出现后只读核验。
- Version: None

## 执行状态

- 当前有效方案：本 Case 的 [Execution Plan](execution-plan.md)，由用户在本次对话直接提供并授权。
- 完整授权范围与阶段顺序：ywdev 完成 M0/M1 与隔离验收后，继续执行 yw-testing；仅限 Learn-X 导入行为、本地测试和必要回修，不含生产采集或外部发布。
- 最后已验证里程碑：M1 按目标确认周读取导出并保留原始复盘周；M2 W39→W40 从临时 Core 导出写入临时 Learn-X W40，并由 `collectWeeklyInput` 读入 Process 输入；另修复 null 元数据根值异常退出后遗留 ready 状态、导致旧正文继续入流的问题。
- 已完成：ywdev 与独立 yw-testing；独立测试者确认损坏 JSON、缺正文、非对象根值、周窗端点及重复采集等边界，未发现其他授权范围内缺陷。
- 剩余事项：Core 首次真实导出出现后，只读核验实际落点及原始周/确认时间元数据。
- 下一步：等待真实 Core 导出自然出现后读回核验；不主动触发生产采集。
- 阻塞 / 待核实副作用：本地目标无阻塞；真实 Core 导出当前无验收证据。
- 证据：`rtk node --test .agents/skills/learn-x-input/scripts/collect-core-weekly.test.mjs`（10/10）；`rtk node --test .agents/skills/learn-x-process/scripts/collect-weekly-input.test.mjs`（10/10）；独立测试者在临时目录复现 ready → 损坏 null 元数据 → unavailable，确认旧文件标 stale 且下游排除；2026-10-11 Asia/Shanghai。
- 工作区核对时间：2026-10-11 Asia/Shanghai；保留 Learn-X 内其他既有未提交改动。

## 来源与落点核对

- 用户原始需求与 W39→W40 产品规则 → [Requirement Truth](../../requirements/2026-10-core-confirm-week-import.md)「来源原文」「需求基线」。
- 用户直接提供并授权的完整方案 → [Execution Plan](execution-plan.md)「方案原文」。
- Core 数据路径与契约 → `core/docs/cases/2026-10-core-v1/execution-plan.md`；真实导出状态 → `core/docs/cases/2026-10-core-v1/acceptance.md`。

## 来源核验

- 状态：方案及需求来源已核对；本地与隔离运行验收通过，真实 Core 导出仍待核实。
- 机器收据：None；本地测试命令和结果记录于本 Case。
- 缺口报告：Core 生产导出尚无真实运行验收，无法确认真实产物落点；首次真实导出后执行只读核验。

## 执行入口

如后续需要继续验收，请在 `/Users/yuwei/code/learn-x` 读取本 Requirement、Execution Plan（含 Execution Handoff）与本 Case。当前本地实现及独立 yw-testing 已完成；只在 Core 首次产生真实周导出后，仅读回核实目标确认周落点、原始复盘周和确认时间。不得主动运行生产采集、读取凭据或执行外部发布。

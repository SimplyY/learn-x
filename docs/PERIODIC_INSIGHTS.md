# Learn-X 周期洞察

周期洞察把本地已确认材料按目标周期和历史范围装配成 Context，调用 ChatGPT 产生候选判断，再由人工阅读、内化。它是阅读和归档层，不是 Memory、道、法、核心议题或 Flomo 的自动写入器。

## Context 装配（schemaVersion 2）

配置在 `00_config/periodic-insights.json`，`contextPolicies` 声明 `defaultRange`、`maxContextChars`（100,000）、`maxPromptChars`（120,000）、`timezone` 和 `defaultMaterialTypes`。材料分五类，`target-output` 恒参与且不可关闭，其余四类可按任务或界面勾选关闭：

| 类型 | 来源 | 说明 |
| --- | --- | --- |
| `target-output` | `04_output/monthly/YYYY-MM.md` 或 `04_output/weekly/YYYY-Www.md`（兼容 `2026-Ww`） | 唯一洞察对象，人工确认后的 Output；`isSubstantive`（≥120 字且非占位）才合格 |
| `life-core` | `01_core/道/人生核心议题.md` | 飞书《人生核心议题》的本地镜像，长期背景，不受历史范围约束；带同步状态 |
| `target-journal` | `03_input/weekly/<id>/weekly.md` | 周目标取对应周记；月目标优先 `_dist/monthly/<id>/input.json` 的 `selection.weeklyPaths`，缺失时按日期相交回退 |
| `history-backbone` | `01_core/memory/YYYY-QN.memory.md`、`03_input/monthly/*/monthly-journal.md`、周记 | 历史骨架，按周期逐月补位，只取日期标题切片 |
| `flomo` | `03_input/{weekly,weekly-history,monthly}/*/flomo.md` | memo 级精选，见下节过滤规则 |

### 历史骨架优先级

每个历史周期只取一层，不重复加入：

1. 月级 Memory 段（`## Monthly｜YYYY-MM`）存在 → 该月只用它；与其相交的周 Memory 段（`## 2026-Www`）标记 `superseded-by-month-memory` 排除，对应周记也不再兜底。
2. 无月级 → 用该月的周级 Memory 段。
3. 无 Memory → 用 `03_input/monthly/YYYY-M/monthly-journal.md`（目录月份不补零）。
4. 无月记 → 用该月相交且已结束的周记（跨月去重，同一周只加入一次）。
5. 全缺 → 记 `history-gap` 排除项。

只按日期标题切片，不读无关章节；未注明日期的 `候选观察池` 段落记 `undated-candidate-pool` 排除；`## 2026-21` 简写周段自动补零；与目标周期重叠或晚于目标的内容一律 `overlaps-target` / `after-target` 排除，杜绝未来泄漏。非 `YYYY-QN.memory.md` 命名的 Memory 文件记 `invalid-period`。

### Flomo 过滤

- 标题格式：`## YYYY-MM-DD HH:MM(:SS)`、`# Flomo` 容器下的同格式标题，以及 `## YYYY-MM-DD` + 连续 `### HH:MM:SS`（月度导入）。
- 清洗来源 URL、附件、图片行；按 memo 创建时间（`policy.timezone`）判定归属。
- 排除：`#learn-x/` 反向同步标签、`#ai洞察`（含前缀）、`#不洞察`、`#不回顾`，以及 `Learn-X 周记｜` 等生成标题开头的 memo；正文仅提到 Learn-X 不受影响。
- 去重：全局按（创建时间 + 规范化正文）去重，后见者记 `duplicate-of:<文件>`。
- 取材：近 6 个自然月（以目标周期起始月为锚）全量；更早仅保留高信号标签（`回顾`、`需回顾`、`常用`、`自我认知`、`重大决策`、`规划`、`第一性原理`、`语音日记`、`旅行` 等前缀，`写作/文章`、`记录/思考` 精确，或标签含「问题」），其余 `older-low-signal` 排除。
- 诗歌：`#写诗` 且清洗后 ≤300 字，进入第一优先级。

### 预算与组装

预算顺序：目标 Output（强制，保留）→ 人生核心议题 → 目标周记 → 有效诗歌 → 历史骨架（近→远）→ 近 6 个月 Flomo（新→旧）→ 更早高信号 Flomo（手动标签优先）。所有材料按完整 memo、Memory 段或文件加入，不从中间截断；放不下的整项记 `context-budget` 排除。`target-output` 自身超过 100,000 字符时整个构建失败关闭（`Context 超过 N 字符上限`）。

组装顺序固定：人生核心议题 → 目标输出 → 目标周记 → 历史骨架 → Flomo（同文件 memo 聚合为一个块）。

## Manifest

`buildInsightContext` 返回 `manifest`（schemaVersion 2）：`taskId`、`target`、`range`、`budget`、`availableTypes`、`selectedTypes`、`chars`、`included`（路径、类型、tier、项数、字符、日期区间、`life-core` 的同步状态）、`excluded`（逐项原因聚合）和 `internal.flomo`（memo 级决策证据）。预览、生成和归档产物都带同一 Manifest；`04_output/_dist/periodic-insights/` 本地状态被 Git 忽略。

## 目标与状态机

目标周期（例如 `2026-08`）只决定洞察对象；历史范围只提供背景。最终 Bridge Prompt 不超过 120,000 字符，超限失败关闭。同一目标由本地运行锁串行。`preview → submitted → generated → archive_pending → completed` 的状态保存哈希、Bridge runId、会话 URL、飞书节点和失败原因；提交不确定时不得自动重发。

执行前 `snapshot_preflight` 校验受治理 Prompt 快照：远端有新版本自动拉取，offline 或拉取被拒时显式告警、继续用本地副本，不静默。

## 飞书归档与恢复

飞书知识库固定为独立私有空间 `Learn-X 周期洞察`，按年份和单篇文档归档，幂等键为 `taskId + targetKind + targetId`。写入后必须读回标题、运行键、实质正文和规范化哈希。失败时保留节点并续跑，不删除、不新建副本。

自动化可用 CLI 退出码识别未完成状态：只有 `preview`、`skipped`、`completed` 返回成功；`needs_review`、`archive_pending` 返回非零。

真实模型对照评测仍未运行；后续可用相同 Context 比较五种 Prompt 的证据保留、视角区分和过度推断情况。本期不建设 Prompt 版本平台、自动评测平台或通用低代码系统。

# Learn-X 周期洞察

周期洞察把本地已确认材料按目标周期和历史范围装配成 Context，调用 ChatGPT 产生候选判断，再由人工阅读、内化。它是阅读和归档层，不是 Memory、道、法、核心议题或 Flomo 的自动写入器。

## v2（2026-09 起生效）

- `00_config/periodic-insights.json` 升级到 schemaVersion 2：默认材料类型收敛为 `life-core`、`target-journal`、`history-backbone`、`flomo` 四类，替代旧 `materialTypes` 全量列表；`historicalBudgetChars` 移除，历史预算由各任务按目标类型自行声明。
- 任务可声明 `includeTypes` 过滤参与装配的材料类型；`target-output` 恒参与，不随过滤移除。
- 执行前新增 `snapshot_preflight`：远端快照有新版本时自动拉取，拉取失败或快照过期时显式告警，不阻塞运行；`run-periodic-insight.mjs` 已接入。
- 新增 `sync-life-core.mjs`：每周经 `lark-cli docs +fetch` 把飞书 Wiki 的「人生核心议题」同步为本地镜像 `01_core/道/人生核心议题.md`，并保持其作为 `life-core` 材料参与周期洞察。

## v1 历史基线（schemaVersion 1）

- 本地 Chat Pack 新增私有「洞察」一级大类：芒格之魂与其余五个子类型均可运行。
- 五个独立子类型 Prompt 已纳入 Prompt Governance，飞书文档是人工正文真源，本地 Markdown 是经哈希校验的运行副本。
- 手动和自动入口共用 `00_config/periodic-insights.json` 与 Context Builder。
- 默认历史范围为最近一年；芒格之魂目标月优先、缺失时回退最近完整周，其他任务按配置声明的目标类型选择，无合格对象则跳过。
- Context 固定白名单为目标 Output、同周期 Process Pack、范围内已确认 Output 的关键章节和相交季度 Memory；不重复读取 `03_input/`。
- 本地状态和 Manifest 位于被 Git 忽略的 `04_output/_dist/periodic-insights/`。

## 边界与恢复

目标周期（例如 `2026-08`）只决定洞察对象；历史范围只提供背景。Context 不超过 100,000 字符，最终 Bridge Prompt 不超过 120,000 字符，超限失败关闭。Manifest 逐项记录纳入和排除原因；同一目标由本地运行锁串行。`preview → submitted → generated → archive_pending → completed` 的状态保存哈希、Bridge runId、会话 URL、飞书节点和失败原因；提交不确定时不得自动重发。

飞书知识库固定为独立私有空间 `Learn-X 周期洞察`，按年份和单篇文档归档，幂等键为 `taskId + targetKind + targetId`。写入后必须读回标题、运行键、实质正文和规范化哈希。失败时保留节点并续跑，不删除、不新建副本。

自动化可用 CLI 退出码识别未完成状态：只有 `preview`、`skipped`、`completed` 返回成功；`needs_review`、`archive_pending` 返回非零。

真实模型对照评测仍未运行；后续可用相同 Context 比较五种 Prompt 的证据保留、视角区分和过度推断情况。本期不建设 Prompt 版本平台、自动评测平台或通用低代码系统。

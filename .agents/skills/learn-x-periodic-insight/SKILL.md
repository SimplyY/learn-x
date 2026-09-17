---
name: learn-x-periodic-insight
description: Learn-X 周期洞察 v2。按目标周期与历史范围装配本地 Context，预览或经明确授权调用 ChatGPT，并以可恢复状态归档到独立私有飞书知识库。使用周期洞察、芒格之魂 canary 或 insight:periodic 时触发。
---

# Learn-X 周期洞察

这是独立于既有周度自动化的周期洞察主链。Chat Pack 与自动任务共用 `00_config/periodic-insights.json` 和 `periodic-insight-core.mjs`，不修改既有周/月 Output 门禁。

默认只预览：

```bash
npm run insight:periodic -- preview --task munger-soul
npm run insight:periodic -- run --task munger-soul --send --archive --confirm
npm run insight:periodic -- setup-wiki --confirm
```

自动化只有在其调度定义明确授予真实运行权限时，才可代表用户使用 `--send --archive --confirm`；未明确授权的调度只生成预览，不调用 ChatGPT 或写入飞书。

Context 默认最近一年，目标对象与历史范围分开；芒格之魂目标月没有实质 Monthly Output 时使用最近完整周，其他任务按配置声明的目标类型选择，仍没有则 `skipped`。默认材料类型为 `life-core`、`target-journal`、`history-backbone`、`flomo`，任务可用 `includeTypes` 过滤，`target-output` 恒参与。Context 上限 100,000 字符，Bridge Prompt 上限 120,000 字符。清单写入 `04_output/_dist/periodic-insights/` 并列出排除原因。

同一目标由本地运行锁串行，锁异常时失败关闭；`submitted`、`needs_review` 或结果归属不确定时只读状态，不重发。Bridge 只走已登录 Ego Lite；飞书只使用用户身份，写入后必须读回；洞察是候选阅读材料，不自动修改 Memory、道、法、核心议题或 Flomo。

CLI 仅将 `preview`、`skipped`、`completed` 作为成功退出；`needs_review` 和 `archive_pending` 返回非零，便于自动化发现未完成状态。

```bash
python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-periodic-insight
```

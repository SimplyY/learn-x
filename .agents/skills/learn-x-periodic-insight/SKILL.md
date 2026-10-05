---
name: learn-x-periodic-insight
description: Learn-X 周期洞察 v2。按目标周期与历史范围装配 Context，每次运行前读取飞书最新受治理 Prompt，预览或经明确授权调用 ChatGPT，并以可恢复状态归档到独立私有飞书知识库。使用周期洞察、芒格之魂 canary 或 insight:periodic 时触发。
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

每次实际预览或调用前，运行时通过共享 `fetch-prompt` 读取本任务涉及的受治理 Prompt latest，并把正文直接组装进本次 Bridge 输入。读取失败、身份/版本/hash 校验失败或正文不完整时，保存 `needs_review` 原因并停止，不启动 Bridge、不使用本地旧版。已登记的非治理适配文件仍按本地配置读取。运行状态只保存受治理资产的 `prompt_id`、revision、hash 和读取时间，不保存 Prompt 正文。

Context 默认最近一年，目标对象与历史范围分开；芒格之魂目标月没有实质 Monthly Output 时使用最近完整周，其他任务按配置声明的目标类型选择，仍没有则 `skipped`。默认材料类型为 `life-core`、`target-journal`、`history-backbone`、`flomo`，任务可用 `includeTypes` 过滤，`target-output` 恒参与。Context 上限 100,000 字符，Bridge Prompt 上限 120,000 字符。清单写入 `04_output/_dist/periodic-insights/` 并列出排除原因。

装配规则（来源优先级、历史骨架去重、Flomo 过滤、预算顺序、Manifest 结构、失败恢复）以 `docs/PERIODIC_INSIGHTS.md` 为准；`life-core` 依赖每周 `npm run sync:life-core` 维护 `03_input/_mirrors/人生核心议题.md` 镜像，镜像缺失或 stale 时 Context 仍可运行，但 Manifest 会显式标记。该镜像是输入背景，不属于 Core 正式道法。

同一目标由本地运行锁串行，锁异常时失败关闭；`submitted`、`needs_review` 或结果归属不确定时只读状态，不重发。Bridge 只走已登录 Ego Lite；飞书只使用用户身份，写入后必须读回；洞察是候选阅读材料，不自动修改 Memory、Core 正式道法、核心议题或 Flomo。

CLI 仅将 `preview`、`skipped`、`completed` 作为成功退出；`needs_review` 和 `archive_pending` 返回非零，便于自动化发现未完成状态。

```bash
python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-periodic-insight
```

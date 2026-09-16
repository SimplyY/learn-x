---
name: learn-x-question-review
description: "围绕 Learn-X Base 中的长期认知议题执行周/月复盘，比较增量证据、触发关键思考，并按需组装 ChatGPT 上下文；不用于议题 CRUD。"
---

# Learn-X 认知议题复盘

## 核心边界

议题和认知事件以「研究&学习」Base 为唯一真值源。用户直接在 Base 新增、编辑、删除业务内容；本 Skill 不做议题 CRUD，不自动改写问题、判断、证据、决策或结果。

Skill 只负责：读取真实 Base 结构，找出到期议题，比较上次复盘之后的增量，生成一张简洁思考卡，或按需生成可复制的 ChatGPT 上下文包。只有消息已发送并读回确认后，才可以更新 `上次复盘推送时间` 和 `下次复盘日期` 两个系统调度字段。

所有 Base 操作使用 `lark-cli base ... --as user`，不直接调用 API。字段缺失、选项漂移、分页不完整、截止时间频率缺少决策截止时间、快照变化或来源不可访问时失败关闭，不猜测、不使用旧缓存冒充新证据。

## 触发与模式

- `执行议题周复盘`：选择复盘频率为每周的年度重点、每周和按截止时间议题，以及截止前 14 天的重大决策；截止时间已过的按截止时间议题不再自动提醒。
- `执行议题月复盘`：选择每月、每季度到期的活跃议题，并做组合级审计。
- `复盘 IQ-0001`：立即复盘一个议题，不受自动频率限制。
- `为 IQ-0001 生成 Chat Pack`：生成完整上下文包，不写入文件。

先运行：

```bash
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs --mode weekly
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs --mode monthly
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs --mode single --id IQ-0001
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs --mode chat-pack --id IQ-0001
# Chat Pack 的事实段使用确定性渲染，直接发送脚本输出，不要重新改写：
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs --mode chat-pack --id IQ-0001 --format markdown
```

脚本输出的是已核验的 JSON 上下文，不是最终 AI 结论。基于它生成思考卡时必须：

1. 明确当前问题、类型、阶段、判断和 0–10 置信度。
2. 若 `annualFocusOverLimit=true`，只提示年度重点超过 3 个，不阻止复盘或用户在 Base 中操作。
3. 月复盘可使用 `portfolio` 查看活跃议题总数、类型和阶段分布，只做结构性提示，不替用户调整议题。
4. 只总结上次复盘后的新增、推翻或修改，不重写全部历史。
5. 最多提出 3 个“问题背后的问题”，每个都要对应未知、冲突或现实约束。
6. 给出最强反证；没有反证时明确写“尚未获得反证”。
7. 指出下一项最有价值的证据或最小现实实验；可逆、低成本且反馈快时优先行动。
8. 不替用户作出人生选择，不把建议写回 Base。
9. 若输出包含 `consistencyWarnings`，只提示可能漏记或不一致，不自动补写事件。

对 `类型=重大决策` 的议题，思考卡必须额外显示决策截止时间、距截止剩余天数和可逆性；若已进入截止前 14 天窗口，明确指出“继续研究”与“进入最小行动/实验”的分叉，不用抽象建议掩盖时间约束。

默认读取事件表中已记录的内容摘要、详细内容和认知增量；未填写的结构化字段保持为空，不从上下文推断。生成 Chat Pack 或证据不足时，才最多打开 3 个关键来源链接，并保留来源系统、稳定标识和链接，不复制原文。

Chat Pack 的事实段必须直接采用脚本 `--format markdown` 输出，不得由模型重写。脚本输出包含：问题背景与重要性、当前判断/置信度、关键转折事件、支持证据与反证、最大未知与改变判断的条件、期限/可逆性/现实约束、已有行动/结果/校准，以及请 ChatGPT 解决的具体任务；只在当前会话输出。每一项必须区分“Base 已核验”“事件/来源已核验”和“未知”。Base 字段为空时脚本会原样标为“未填写”，不得用 Bridge 的环境上下文、记忆或模型常识补全个人事实；事件信息不足时不得推断行动、结果、价值观或现实约束。只有脚本返回的事件来源或按规则打开的最多 3 个关键链接，才可写入跨系统事实，并在对应条目保留来源系统、稳定标识和链接。模型只能在脚本末尾任务段补充推理方法，不得新增个人事实。

## 送达后的调度回写

思考卡已经在 learn-x 群发送并通过消息读回确认后，使用同一模式和快照回写：

```bash
node .agents/skills/learn-x-question-review/scripts/review-questions.mjs \
  --mode weekly --mark-delivered --snapshot <sha256>
```

回写前脚本会重新读取并校验快照；只更新 `上次复盘推送时间` 与 `下次复盘日期`。快照变化时不写入，重新生成复盘。发送失败或未读回时不要回写，也不要自动重发。

用户修改 `当前判断`、`类型` 或 `状态` 后，应在 Base 手工追加对应的「认知事件」。Skill 只能提示可能漏记，不能代写事件。

认知事件的人工录入入口保持最小：用户填写「内容摘要」「详细内容」，并关联对应议题即可；「事件类型」「证据方向」「变更前/变更后」等字段是可选的结构化补充，不作为日常录入门槛。Skill 读取并展示这两列，不替用户推断或补写类型、证据方向和认知增量；历史结构化字段继续保留用于已有数据和深度事件。

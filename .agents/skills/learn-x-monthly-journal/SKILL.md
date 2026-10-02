---
name: learn-x-monthly-journal
description: 从 Learn-X 本地周输入和已确认周记生成安全的飞书月记草稿。Use when the user asks to generate, initialize, or fill a monthly journal draft; never use online daily or weekly entries as evidence and never overwrite substantive content.
---
# Learn-X 月记草稿

执行前运行命令：node /Users/yuwei/.codex/skills/prompt-governance/scripts/manage-prompts.mjs status --project /Users/yuwei/code/learn-x --live，校验资产 learn-x.monthly-journal。若该资产远端更新且本地一致，先预览同步计划，再以 sync --confirm 同步；本地漂移、飞书读取失败或无法确认版本时停止。

完整读取受治理提示词 ../../../02_prompts/journal/monthly-journal.md，并遵循其中全部流程、来源门禁、输出、写入、回读与汇报要求。该提示词是本 Skill 正文规则的唯一来源。

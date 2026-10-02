---
name: learn-x-weekly-journal
description: 从 Learn-X 已落盘的周输入生成飞书周记草稿，并将上一个完整 ISO 周的全部 Flomo 笔记自动填入“回顾最近笔记 & flomo 洞察”。Use when the user asks to generate or fill a weekly journal draft; never overwrite substantive human content.
---
# Learn-X 周记草稿

执行前运行命令：node /Users/yuwei/.codex/skills/prompt-governance/scripts/manage-prompts.mjs status --project /Users/yuwei/code/learn-x --live，校验资产 learn-x.weekly-journal。若该资产远端更新且本地一致，先预览同步计划，再以 sync --confirm 同步；本地漂移、飞书读取失败或无法确认版本时停止。

完整读取受治理提示词 ../../../02_prompts/journal/weekly-journal.md，并遵循其中全部流程、来源门禁、输出、写入、回读与汇报要求。该提示词是本 Skill 正文规则的唯一来源。

---
name: learn-x-weekly-journal
description: 从 Learn-X 已落盘的周输入生成飞书周记草稿，并将上一个完整 ISO 周的全部 Flomo 笔记自动填入“回顾最近笔记 & flomo 洞察”。Use when the user asks to generate or fill a weekly journal draft; never overwrite substantive human content.
---
# Learn-X 周记草稿

每次生成前，运行共享读取器：

```bash
node /Users/yuwei/code/skills/prompt-governance/scripts/fetch-prompt.mjs learn-x.weekly-journal
```

以本次返回的 `content` 作为周记生成规则，完整遵循其中的来源门禁、输出、写入、回读与汇报要求。不要读取或使用 `02_prompts/journal/weekly-journal.md` 的本地副本。

读取失败、响应身份或正文校验失败时，说明飞书最新 Prompt 无法取得并停止；不要生成草稿或写入飞书。只有用户在失败后明确授权本次使用本地副本，且副本存在并通过校验时，才可临时降级；说明使用的 revision/hash 不是飞书最新值。读取成功后，本次以 `prompt_revision`、`prompt_sha256`、`prompt_fetched_at` 作为运行证据，不把这些元数据插入 Prompt 正文。

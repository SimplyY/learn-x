---
name: learn-x-monthly-journal
description: 从 Learn-X 本地周输入和已确认周记生成安全的飞书月记草稿。Use when the user asks to generate, initialize, or fill a monthly journal draft; never use online daily or weekly entries as evidence and never overwrite substantive content.
---
# Learn-X 月记草稿

每次生成前，运行共享读取器：

```bash
node /Users/yuwei/code/skills/prompt-governance/scripts/fetch-prompt.mjs learn-x.monthly-journal
```

以本次返回的 `content` 作为月记生成规则，完整遵循其中的来源门禁、输出、写入、回读与汇报要求。不要读取或使用 `02_prompts/journal/monthly-journal.md` 的本地副本。

读取失败、响应身份或正文校验失败时，说明飞书最新 Prompt 无法取得并停止；不要生成草稿或写入飞书。只有用户在失败后明确授权本次使用本地副本，且副本存在并通过校验时，才可临时降级；说明使用的 revision/hash 不是飞书最新值。读取成功后，本次以 `prompt_revision`、`prompt_sha256`、`prompt_fetched_at` 作为运行证据，不把这些元数据插入 Prompt 正文。

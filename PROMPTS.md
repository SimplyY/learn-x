# Prompt 仓库备份

飞书是正文维护真源；本仓是公开 GitHub 仓库，用户已明确决定在此保留 Prompt 备份，推送后内容公开可见。备份供云环境读取，不作为运行时回退或缓存。备份由中央 `prompt-governance` 统一同步；`prompt-backups.json` 与现有 Chat Pack 缓存清单分离，不改变 14 天缓存规则。

飞书人工编辑并保存后，运行中央命令；机器经发布入口写入并读回成功后会自动同步：

```bash
node /Users/yuwei/code/skills/prompt-governance/scripts/sync-backups.mjs --prompt-id <prompt_id> --confirm
```

全局位置索引：`skills/prompt-governance/references/prompt-backups.md`。

| Prompt ID | 本仓路径 |
| --- | --- |
| `chatpack.one-step-deeper` | `02_prompts/chatpack/enhancers/one-step-deeper.md` |
| `chatpack.book-decode` | `02_prompts/chatpack/learning-insight/book-decode.md` |
| `chatpack.weekly-output` | `02_prompts/chatpack/reflective-decision/weekly-output.md` |
| `chatpack.monthly-output` | `02_prompts/chatpack/reflective-decision/monthly-output.md` |
| `chatpack.yearly-output` | `02_prompts/chatpack/reflective-decision/yearly-output.md` |
| `chatpack.insight-weekly-review` | `02_prompts/chatpack/insight/weekly-review.md` |
| `chatpack.insight-inner-question` | `02_prompts/chatpack/insight/inner-question.md` |
| `chatpack.insight-director-view` | `02_prompts/chatpack/insight/director-view.md` |
| `chatpack.insight-friend-view` | `02_prompts/chatpack/insight/friend-view.md` |
| `chatpack.insight-blind-spot` | `02_prompts/chatpack/insight/blind-spot.md` |
| `chatpack.munger-soul` | `02_prompts/chatpack/enhancers/munger-soul.md` |
| `chatpack.first-principles` | `02_prompts/chatpack/learning-insight/first-principles.md` |
| `learn-x.weekly-journal` | `02_prompts/journal/weekly-journal.md` |
| `learn-x.reading-weekly` | `02_prompts/meta/chatgpt-reading-weekly.md` |
| `learn-x.reading-daily` | `02_prompts/meta/chatgpt-reading-daily.md` |
| `learn-x.monthly-journal` | `02_prompts/journal/monthly-journal.md` |
| `chatpack.weekly-output-rules` | `02_prompts/chatpack/reflective-decision/weekly-output-rules.md` |
| `chatpack.monthly-output-rules` | `02_prompts/chatpack/reflective-decision/monthly-output-rules.md` |

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

## 本地执行补充与验收

以下规则是周记 Skill 的来源和质量补充要求，与本次读取的受治理 Prompt 一并执行。若两者对同一行为有直接冲突，停止受影响的字段并报告冲突，不静默舍弃任一规则。

### 目标段落链接

- 写入并回读确认目标段落后，使用同一次 `lark-cli docs +fetch --detail with-ids` 返回的底层 `document_id` 作为导航链接路径：`https://ywhome.feishu.cn/docx/<document_id>#<target-block-id>`。目标 fragment 必须来自本次回读确认的目标周标题；若 CLI 提供该标题实际 `#share-...` fragment，可替换 block ID fragment。
- 固定周记文档的 Wiki 节点 URL 可用于读写定位，但不能把其 `/wiki/<node-token>` 路径与 block ID 拼成导航链接。Ego Lite 受控验证表明 Wiki 路径带 fragment 不滚到目标，`/docx/<document_id>#<block-id>` 会滚到目标段落。
- 每次新建草稿后，用写入后回读确认的目标标题 block ID 和底层 document ID 固化周记采回锚点；不要复用旧锚点。执行：

  ```bash
  npm run input:weekly-anchor -- --week YYYY-Www --write-date YYYY-MM-DD --target-title "M.D" --target-block-id <block-id> --document-id <document-id>
  ```

  锚点冲突或读回目标不唯一时停止并报告，不覆盖既有锚点。

### Flomo 最近笔记

- 使用运行日期之前最近一个完整 ISO 周（Asia/Shanghai，周一至周日）的 `flomo.md`；遵守状态侧车、完整范围和计数校验。来源不完整时不读旧文件、不填充该字段。
- 把有效笔记全部按创建时间顺序逐条写入，不摘要、不筛选、不改写、不截断。每条笔记单独成块，日期和时间可见，正文保留原文和换行，标签完整可见；块之间留一空行。
- 若采用飞书原生列表，每个列表项只能放一条完整笔记，编号交给飞书列表生成，不在原文中手写编号。若使用普通段落，则用独立的日期时间行分隔笔记。不得把多条笔记挤成同一段，也不得将以 `#` 开头的标签误排成标题。来源缺少日期或时间时不推断、不补造。
- 写入方式无法承载全部笔记时保留模板空位并报告，不得为适配单元格而省略内容。回读后逐项核对记录数、顺序、日期时间、正文、标签和分块边界。

### 日历与周记来源边界

- `calendar.md` 只用于独立采集状态与阶段 2 Process Pack 的计划上下文，不属于周记内容源。
- 生成周记时不得读取、传入、引用或交叉核验 `calendar.md`；日历状态、范围和明细完整性均不构成周记门禁。
- 周记字段只使用本 Skill 允许的非日历来源。证据不足时保留对应模板空位并说明缺口，不用日历补齐或验证。

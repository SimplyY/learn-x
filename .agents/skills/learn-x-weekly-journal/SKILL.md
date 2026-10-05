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

### Flomo 最近笔记

- 使用运行日期之前最近一个完整 ISO 周（Asia/Shanghai，周一至周日）的 `flomo.md`；遵守状态侧车、完整范围和计数校验。来源不完整时不读旧文件、不填充该字段。
- 把有效笔记全部按创建时间顺序逐条写入，不摘要、不筛选、不改写、不截断。每条笔记单独成块，日期和时间可见，正文保留原文和换行，标签完整可见；块之间留一空行。
- 若采用飞书原生列表，每个列表项只能放一条完整笔记，编号交给飞书列表生成，不在原文中手写编号。若使用普通段落，则用独立的日期时间行分隔笔记。不得把多条笔记挤成同一段，也不得将以 `#` 开头的标签误排成标题。来源缺少日期或时间时不推断、不补造。
- 写入方式无法承载全部笔记时保留模板空位并报告，不得为适配单元格而省略内容。回读后逐项核对记录数、顺序、日期时间、正文、标签和分块边界。

### 一周核心总结与日历

- 写“一周核心总结”前，先验证目标周 `_source-status.json` 中 `calendar` 为 `ready`，并确认 `calendar.md` 的目标周和实际覆盖范围有效。完整周读取逐日汇总及全部事项明细；不能只扫总时长或标签汇总。
- 当前 Learn-X 周流程登记的日历输入是 `npm run input:calendar -- --week YYYY-Www` 生成的目标周 `calendar.md`（Time-X｜随时记与当前可读日历记录）。若用户明确指向另一张未接入的飞书多维表格，不能声称 `calendar.md` 已覆盖它；应将核心总结留空并报告来源接入缺口。
- 深读日历事项的日期、时间、标题、描述、有效投入和标签，识别本周时间分配、反复主题、投入变化及安排与反馈之间的关系。每个总结项带至少一个可回查锚点（具体日期及事项/主题），并使用目标周 `daily.md`、Flomo 和存在时的 AI 回顾交叉核验。
- 日历记录本身只说明相应事项被记录或安排，不能单独证明事项已完成、产生结果或形成稳定习惯。没有其他来源佐证时，明确写成“日历记录/安排显示”，或删去完成/结果断言。有效投入采用明细中的分摊后数值；标签时长可能交叉，不得相加成总时长。
- 周末提前写当周时，只分析 `calendar.md` 明确覆盖的日期，说明覆盖范围，不外推整周趋势。日历缺失、非 `ready`、周范围不符或明细不完整时，只保留“一周核心总结”模板空位并报告原因；其他可安全生成的字段照常处理。不得以 AI 总结、旧日历、旧周记或其他周数据代替。
- 写入并回读后，逐项确认总结所用的日历锚点可在目标周 `calendar.md` 中找到，且跨来源校验与“记录不等于完成”的边界得到遵守。

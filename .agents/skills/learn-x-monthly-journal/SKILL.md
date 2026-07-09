---
name: learn-x-monthly-journal
description: "Fill empty or placeholder fields in a Learn-X monthly journal from daily Base records plus weekly journal entries. Use when the user asks to generate/init/fill a monthly journal, but only as a fill-empty-fields operation; never overwrite substantive existing content."
description_zh: 从每日 Base 记录和周刊条目填充月度日志的空字段
---

# Learn-X Monthly Journal

Generate a Feishu monthly journal draft from daily Base records and the same document's weekly journals. Keep the result explicitly unfinished and only fill empty or placeholder fields: every generated block that is written must contain `【待优化】AI 基础草稿`.

## Defaults

- Document: `https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac`
- Daily Base: `https://ywhome.feishu.cn/wiki/FGQgwU2aciOzNVk1uxKcI6OknYg?table=tblgc6xySQgsUuam&view=vewJ5FBHo1`
- Daily Base coordinates after resolving: base `WPZRbLRrGarf8bsfYoJcZ8Kwnqc`, table `tblgc6xySQgsUuam` (`日记`).
- Identity: use `lark-cli docs` as user identity.
- Target month: previous month in `Asia/Shanghai` unless the user specifies a month.
- Week selection: include weekly journal headings whose title date is inside the target month and day number is greater than `1`.
  - Example: for June, use `6.8`, `6.15`, `6.22`, `6.29`; exclude `6.1`.
- Delivery: write back to Feishu by default.
- Evidence priority: daily Base records first, weekly journals second. Use weekly journals to compress themes and catch weekly summaries, but do not rely on weekly journals alone.
- Photos: do not read photo files automatically; use daily `最喜悦的事` / `核心事项（语音输入）` and weekly photo-review text as proxies, and mark gaps as `【待优化】`.

## Required Boundaries

- Do not use `docs +update --command overwrite`.
- Do not edit `周记模版`, `月记模版`, `年记`, or any weekly journal section.
- Preserve existing monthly content. Only replace empty blocks or obvious placeholders such as `x`, `xx`, `x 分`, `xx 万步`, `待补充`, or blank paragraphs. Never append a new full draft into a month that already has substantive content.
- If the target month section already contains most of the monthly fields or safe placeholders cannot be identified, stop before writing and report the draft only as a suggestion.
- If the target month section is missing, insert a new month section under the `月记` heading using the `月记模版` table structure.
- If the month, weekly source range, or safe writable placeholder blocks cannot be identified, stop before writing and output the draft plus the reason.

## Workflow

1. Resolve/read the Daily Base when needed:

   ```bash
   lark-cli base +url-resolve --url "$DAILY_BASE_URL" --as user
   lark-cli base +field-list --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" --as user --format json
   ```

2. Read target-month daily records with server-side filtering. Project only needed fields:

   ```bash
   lark-cli base +record-list \
     --base-token "$BASE_TOKEN" \
     --table-id "$TABLE_ID" \
     --field-id 日期 \
     --field-id '今日心情（允许万物穿过自己）' \
     --field-id 最喜悦的事 \
     --field-id 今日运动 \
     --field-id 今日饮食 \
     --field-id '核心事项（语音输入）' \
     --field-id '心底之问：今天是否更像苏轼、孟岩、孔子？他们会如何思考、选择、行动、生活。今天这样过，是否让我更自由，还是更紧绷？' \
     --field-id '思考&收获&洞察&幽默' \
     --field-id 明日规划 \
     --field-id 月 \
     --field-id 年 \
     --filter-json '{"logic":"and","conditions":[["月","==","06月"],["年","==","2026 年"]]}' \
     --sort-json '[{"field":"日期","desc":false}]' \
     --limit 100 \
     --as user \
     --format json
   ```

   Replace `06月` and `2026 年` with the target month/year. If `has_more=true`, continue pagination before drawing monthly conclusions.

3. Read the journal document outline:

   ```bash
   lark-cli docs +fetch --doc "$DOC" --scope outline --max-depth 3
   ```

4. Locate these sections from the outline:
   - `月记模版`
   - `月记`
   - target month under `月记`, such as `6 月`
   - `周记`
   - weekly entries matching the default week selection rule

5. Fetch only the needed document sections:

   ```bash
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$MONTH_TEMPLATE_ID" --detail with-ids
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$TARGET_MONTH_ID" --detail with-ids
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$WEEK_ID" --detail simple
   ```

6. Extract daily evidence first:
   - ratings: average or range for `今日心情`, `今日运动`, `今日饮食`; mention missing days if obvious.
   - places/actions: from `最喜悦的事` and `核心事项（语音输入）`.
   - learning/work: AI/Codex/Skill, reading, research, education/coaching, project work.
   - health/body: exercise, sleep, injury, illness, chronic issues, energy.
   - insight: from `心底之问...` and `思考&收获&洞察&幽默`.
   - next-month signals: repeated `明日规划` items near month end and high-frequency unfinished plans.

7. Extract weekly evidence by table row labels. Prefer source wording over polished rewriting:
   - `照片回顾&清理`
   - `一周总结`
   - `修身 & 修心`
   - `回顾最近笔记 & flomo 洞察 & chatgpt`
   - `核心收获&思考`
   - `新周计划`
   - `投资`, `支出`, or related finance text if present

8. Generate only a compact draft for the monthly table fields that are still empty or clearly placeholder:
   - `核心总结（from 周记、from 照片）`
     - 一句话总结
     - 投资
     - 出门
     - 教育
     - 学习
     - 娱乐&消费
     - 社交
   - `修身 & 修心`
     - 健康第一：运动 / 饮食 / 疾病
     - 幸福第二：时间 / 出门 / 心情
     - 修心
   - `月度核心思考 & ai 洞察`
   - `新月计划-核心事项`
   - `投资&支出月记`

9. Prefix each generated section, cell, or list group with `【待优化】AI 基础草稿：`.

10. Write safely:
   - Use `block_replace` only for a specific empty/placeholder paragraph or list item.
   - Never overwrite a non-empty field or cell.
   - Use `block_insert_after` only when adding a missing month section or inserting into an empty cell that is clearly blank.
   - If no safe placeholder exists, do not write anything.
   - After each update, fetch the changed target month section again before another block-level update.

11. Verify after writing:

   ```bash
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$TARGET_MONTH_ID" --detail simple
   ```

   Confirm that:
   - only the target month changed;
   - generated content contains `【待优化】`;
   - pre-existing non-placeholder content remains intact.

## Output To User

Report briefly:

- target month;
- daily Base records used and whether `has_more` was false;
- weekly entries used;
- which monthly fields were filled or skipped;
  - whether anything was not written because it was not safely empty or because the section was already substantially complete;
- any `lark-cli` update notice seen during execution.

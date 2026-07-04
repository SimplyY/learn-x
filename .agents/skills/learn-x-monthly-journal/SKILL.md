---
name: learn-x-monthly-journal
description: "Generate and write a basic Learn-X monthly journal draft in Feishu from weekly journal entries. Use when the user asks to generate/init/fill a monthly journal, create a 月记基础版, 从周记初始化月记, 补全上个月月记, or work on the Learn-X 飞书月记 document."
---

# Learn-X Monthly Journal

Generate a Feishu monthly journal draft from the same document's weekly journals. Keep the result explicitly unfinished: every generated block must contain `【待优化】AI 基础草稿`.

## Defaults

- Document: `https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac`
- Identity: use `lark-cli docs` as user identity.
- Target month: previous month in `Asia/Shanghai` unless the user specifies a month.
- Week selection: include weekly journal headings whose title date is inside the target month and day number is greater than `1`.
  - Example: for June, use `6.8`, `6.15`, `6.22`, `6.29`; exclude `6.1`.
- Delivery: write back to Feishu by default.
- Photos: do not read photos automatically; summarize only from weekly journal text and mark gaps as `【待优化】`.

## Required Boundaries

- Do not use `docs +update --command overwrite`.
- Do not edit `周记模版`, `月记模版`, `年记`, or any weekly journal section.
- Preserve existing monthly content. Only replace empty blocks or obvious placeholders such as `x`, `xx`, `x 分`, `xx 万步`, `待补充`, or blank paragraphs.
- If the target month section is missing, insert a new month section under the `月记` heading using the `月记模版` table structure.
- If the month, weekly source range, or safe writable placeholder blocks cannot be identified, stop before writing and output the draft plus the reason.

## Workflow

1. Read the document outline:

   ```bash
   lark-cli docs +fetch --doc "$DOC" --scope outline --max-depth 3
   ```

2. Locate these sections from the outline:
   - `月记模版`
   - `月记`
   - target month under `月记`, such as `6 月`
   - `周记`
   - weekly entries matching the default week selection rule

3. Fetch only the needed sections:

   ```bash
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$MONTH_TEMPLATE_ID" --detail with-ids
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$TARGET_MONTH_ID" --detail with-ids
   lark-cli docs +fetch --doc "$DOC" --scope section --start-block-id "$WEEK_ID" --detail simple
   ```

4. Extract weekly evidence by table row labels. Prefer source wording over polished rewriting:
   - `照片回顾&清理`
   - `一周总结`
   - `修身 & 修心`
   - `回顾最近笔记 & flomo 洞察 & chatgpt`
   - `核心收获&思考`
   - `新周计划`
   - `投资`, `支出`, or related finance text if present

5. Generate a compact draft for the monthly table:
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

6. Prefix each generated cell or list group with `【待优化】AI 基础草稿：`.

7. Write only safe placeholders or blank blocks:
   - Use `block_replace` for a specific empty/placeholder paragraph or list item.
   - Use `block_insert_after` only when adding a missing month section or inserting into an empty cell.
   - After each update, fetch the changed target month section again before another block-level update.

8. Verify after writing:

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
- weekly entries used;
- which monthly fields were filled or skipped;
- whether anything was not written because it was not safely empty;
- any `lark-cli` update notice seen during execution.

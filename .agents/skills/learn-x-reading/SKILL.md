---
name: learn-x-reading
description: "把微信读书指定范围内的划线与用户想法整理为按书归档的 LearnX 阅读上下文，生成 ChatGPT 伴读包并准确报告本地保存状态。用户要求整理微信读书阅读、查看本次阅读记录或伴读包时使用。"
---

# Learn-X｜统一阅读沉淀与伴读

## 当前支持范围

本 Skill 当前只处理微信读书内容。**实体书照片、圈注/划线识别及视觉标记覆盖按用户指示暂缓**；收到照片时不声称已采集，也不把 OCR 文本当作视觉标记验收。真实书页入口须等用户后续明确恢复该工作后再设计。

目标是低成本保存可追溯的阅读上下文，供 ChatGPT 即时伴读或每周精读。默认输出不是长篇报告，不代写 Flomo。

## 触发与安全边界

- 仅处理 Learn-X 群中已验证用户发出的单条原始消息；机器人消息、引用消息、身份不明或非目标群内容不触发。
- 用户提出整理微信读书划线/想法时直接运行，不逐条确认。
- 用户只要求查看既有阅读记录或本批伴读包时，读取 `_index.md`、对应公开书籍 Markdown 或 receipt 指向的私有伴读包，不重新采集。
- 用户明确要求修改或撤销某条记录时，使用结果收据给出的 `recordId` 定位；重新读取当前记录和版本后再写，不用过期卡片中的版本覆盖新修改。
- 未说明范围时采集最近 3 天：Asia/Shanghai 当天和前两天，截止实际采集时刻。
- 支持 `--from`、`--to` 和可选 `--book`。日期使用 `YYYY-MM-DD`，起止日期均包含；精确时间须使用含时区的 ISO 时间戳。只在书名确有歧义时询问，优先让用户提供书名或书籍 ID。
- 只处理返回数据中实际取得的书籍和条目。分页、notebook 最近笔记时间或条目时间缺失/非法、单书请求或来源 ID 不完整时标记部分采集并列出实际缺口；不得报告完整成功。
- 不输出或记录 API Key、Cookie、token、认证响应或完整凭据错误。
- 本 Skill 不执行 Git add/commit/push，不保存原始书页图片，不写入 Flomo。

## 采集与沉淀步骤

1. 执行范围 collector：

   ```bash
   node .agents/skills/learn-x-input/scripts/collect-weread-range.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [--book <书名或书籍ID>]
   ```

   默认的最近 3 天范围按上海时区计算。输出写在 `.runtime/reading/weread-range-latest.json`，权限 0600；采集器报告的 `complete` 和 `errors` 必须原样纳入判断。

2. 按书归组。每本书单独形成一个 batch，稳定 `batchId` 基于该书本次实际来源 ID。分别标注作者内容与用户本人想法。电子书划线可以精选，不得将精选数说成取得总数；用户自己的想法不压缩成 AI 观点。

3. 对每条拟保留记录生成：来源 ID、采集器给出的 `sourceEvidence`、章节/定位、日期、标记类型，以及作者内容的简洁转述和/或用户明确表达的原始想法。`sourceEvidence` 只来自实际取得的 WeRead 条目，保留在私有 inbox；store 仅将其规范化哈希写入私有状态，不会复制到公开 Markdown。按需补充思想基石、确有价值的问题与 AI 推断。未确认的 AI 推断不得写入“用户想法”。只有用户想法的记录不得编造作者内容。公开 Markdown 避免保存长段原文，只保留足以追溯的短定位信息。

4. 明确要求不公开的条目写为 `visibility: "private"`。公开是默认值；只写适合公开的精炼文本。含敏感信息、不适宜公开内容、无法可靠归属或来源 ID 缺失的条目设为 `needs_review` 或私有，不进入公开文件。

5. 将整理好的 JSON 写入 `.runtime/reading/inbox/<稳定批次ID>.json`，目录 0700、文件 0600；JSON 不得含图片路径、原始图像或密钥；采集器 `sourceEvidence` 中的原文可保留在私有 inbox，但不进入公开 Markdown。`batchId` 基于本批实际来源 ID 稳定生成，并带入伴读包正文。相同来源 ID 只有在内容一致时才折叠；同 ID 内容冲突时停止该批，不能任意选一条。保存器会把 pending 正文与伴读包一并保留，重试必须复用同一批次内容，不重新调用模型。每本书分别运行：

   ```bash
   node .agents/skills/learn-x-reading/scripts/store-reading.mjs .runtime/reading/inbox/<稳定批次ID>.json
   ```

   WeRead 条目的 `sourceId` 必须采用采集器提供的稳定 ID。store 写入 `05_library/reading/<书籍>.md` 和 `_index.md`，通过本地私有状态去重；私有/待复核文本只留在 `.runtime/reading/`。写入后由 store 原子替换并读回校验。失败时保留 pending 批次；以同一批次 ID 重试，不重新生成条目身份。私有 batch 收据包含稳定 `recordId` 与当前 `recordVersion`，用于后续修改。

6. 先用 `node /Users/yuwei/code/skills/prompt-governance/scripts/fetch-prompt.mjs learn-x.reading-daily` 读取最新生成 Prompt；读取失败时停止，不用本地旧版生成。再读取刚保存的书籍 Markdown、私有 `sourceEvidence` 和本批次信息，按该 Prompt 生成可直接复制的伴读上下文包并作为 `companionPack` 随 batch 一并保存。伴读包正文目标为 3000～6000 字。所有划线原文合计不超过 3000 字时，必须逐字保留全部原文，不转述、不删句、不改标点；用户想法同样逐字保留。合计超过 3000 字时才允许压缩：优先整条筛除低价值内容，已保留内容必须使用逐字摘录，整体压缩比例不超过 30%，最终不超过 6000 字；仍超限时继续按条筛除，并如实列出未纳入条目数。压缩时不得改写原意、合并造成歧义或把 AI 概括冒充原文。即使 GitHub 尚未推送，也在当前飞书回复中给出伴读包正文，不要求用户再次整理资料。
   伴读包的重复元数据必须折叠：同一书籍内的原文按「章节 + 日期」分组；组内每条只保留位置和必要类型标记。位置不同的条目不合并正文；划线与个人想法分组展示，不得因排版压缩而丢失条目身份。

7. 维护每本书的飞书阅读记录视图：使用 bot 身份。首次创建时按 `lark-doc` Skill 的创建工作流写入；已有文档先 fetch，再按本批次追加，禁止重复创建或覆盖此前记录。正文只含公开且可靠的精炼文本。写后 fetch 读回，确认书名、本批次、记录数量与正文哈希后，再把 `document_id`、URL、读回哈希和批次 ID 写入私有 `.runtime/reading/delivery-state.json`（目录 0700、文件 0600）。认证、身份或 scope 错误时停止该交付，不切换到 user；本地保存和伴读包仍可成功。

8. 发送简洁结果卡至当前 `bridge_context.chatId`，不可猜测或改用其它群。先读取 `lark-im` 与卡片创建参考，遵守 Card 2.0 校验；不得手写、复用或伪造 `bridge_token`。在 Learn-X 群存在经验证的回调路由前，修改入口使用明确文字命令 `修改 <recordId>` / `撤销 <recordId>`，不显示看似可用的修改按钮。卡片显示书名、来源、取得数/精选数、一句话核心、本地状态，并提供阅读记录链接、伴读包入口和修改命令。将来只有在当前 Bridge 的签名生成、群/用户/版本校验及回调路由均有证据时，才可改用签名入口。

9. `本地已保存`、`飞书记录已读回`、`结果卡已送达`、`GitHub 已同步` 分开记录。发送结果不明时先检索并核对目标群最新消息的发送身份、消息类型和卡片正文；未确认前不得重发。任何一项飞书交付失败都不能回滚已验证的本地记录，也不能阻塞其他可靠书籍。

## 修改与撤销

- 用户回复 `修改 <recordId>` 并描述具体改动，或回复 `撤销 <recordId>`。仅接受已验证用户在指定 Learn-X 入口发出的原始消息。
- 从 `.runtime/reading/state.json` 读取当前记录并计算当前版本；不要依赖过期收据中的版本号。把用户明确要求改动写入私有 JSON，传入 `recordId`、`expectedVersion`、`action`、字段白名单内的 `patch`，以及按更新后内容重新生成的 `companionPack`，再调用同一个 store CLI。
- Store 对版本做 compare-and-swap。冲突时展示当前记录并停止，不覆盖；成功后读取公开文件、索引、修改回执指向的伴读包与飞书阅读记录视图验证。修改后重新生成并交付本次伴读包。
- 修改或撤销本地成功后，使用 `.runtime/reading/delivery-state.json` 中该书的现有文档 URL，以 bot 身份读取最新文档；按 `recordId` 做精确关键词定位，连同上下文读取 block ID 与当前 revision。必须恰好定位到一处记录并确认它仍属于该书与对应批次，否则保留本地成功状态、报告飞书视图未更新并停止。
- 仅替换该记录对应的连续 block 范围；撤销或改为私有/待复核时只删除该记录范围。使用刚读取的 revision 作为 `--revision-id`，禁止 `overwrite`，不修改相邻记录。若本次修改影响书籍级摘要或问题区，也从当前公开记录重新整理并一并局部更新；无法可靠定位需更新的区块时先保留本地结果，不猜测或整篇重写。
- 每次飞书写入后重新读取该记录及受影响区块，核对内容、唯一记录数、相邻记录未变及 revision；结构写入后废弃旧 block ID。只有读回成功才更新该书的 `revisionId`、`readbackSha256` 与 `docReadbackVerified`。提交结果不明时只做一次只读查证；仍不明则不重发，保留本地成功并报告飞书状态待查。
- 撤销仅从当前本地公开文件和索引移除记录；如果历史 Git 提交可能公开过该内容，必须说明本地撤销不能保证清除远端历史。
- 飞书记录或卡片交付不可用时，准确报告各自状态，不以本地文件路径冒充手机可访问链接。

## 伴读包格式

```markdown
# 《书名》｜本次阅读伴读包
- 作者：书籍作者
- 来源与范围：微信读书；实际起止时间（Asia/Shanghai）；取得 X 条划线、Y 条个人想法，摘录 Z 条
- 阅读记录：LearnX 本地公开文本 05_library/reading/；GitHub 远端同步尚未验证
- 本批次：稳定批次 ID

## 划线原文

章节名 · 日期

1. WeRead 位置 起点-终点

> 原文逐字内容

## ChatGPT 伴读 Prompt

请基于这份阅读上下文，与我深入理解作者的核心论证、思想基石、隐藏前提。参考原书中的完整核心内容尤其是对应章节和核心书评。

适当联系现实生活与其他思想，但不要重复普通摘要。区分作者原意、我的判断和 AI 推断，不替我作出最终判断。

值得继续探索的问题，给出 2-3 个。

以及引导我思考“这次阅读，有值得亲手写进 Flomo 的思想”
```

伴读包不生成核心观点、思想基石、本人理解或问题等 AI 板块；理解与提炼由包尾 ChatGPT Prompt 引导用户在 ChatGPT 中完成。原文合计不超过 3000 字时逐字保留全部划线和想法；超过后才允许整条筛除低价值内容，已保留内容逐字摘录，整体压缩比例不超过 30%，最终不超过 6000 字。不得代写或自动写入 Flomo。

## 旧精读边界

- 不运行旧 `learn-x-jingdu-review` 生产、飞书审阅或登记流程。
- 不把旧 `jingdu.md` 当作本次阅读记录或新结果。
- 原始微信读书采集、历史文件、Flomo 既有流程和其他周度功能保持独立。

## 相关文件

- 数据契约与落盘格式：[`references/reading-data-contract.md`](references/reading-data-contract.md)
- 每周 ChatGPT 精读 Prompt：[`../../../02_prompts/meta/chatgpt-reading-weekly.md`](../../../02_prompts/meta/chatgpt-reading-weekly.md)
- ChatGPT 读取说明：[`../../../docs/CHATGPT_READING.md`](../../../docs/CHATGPT_READING.md)

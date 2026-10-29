# Skill：learn-x-jingdu-review（微信读书精读审阅适配器）

把每周微信读书划线/想法组织成一份飞书精读审阅文档，等待用户手机编辑后，把**明确的本人判断**同步进 `03_input/weekly/<week>/jingdu.md` 与来源状态。

- 方案基准：`docs/cases/weread-highlights/codex-weekly-automation-prompt.md`（XML+colgroup 建档 §4、jingdu.md 格式 §6、六参数登记 §7、边界 §8；其中 117 行 `--as user` 为旧文残留，以本文件与第 5 行 `--as bot` 为准）
- 周口径：周日 20:00 运行写当周（本次实施对照 2026-W42）；`--week` 未指定时：周六/日 = 当前 ISO 周，周一至五 = 上一 ISO 周（Asia/Shanghai）
- 硬边界：AI 只出候选；「我的思考」= 用户本人判断；认可 = AI 分析候选下写「认可」；只转录用户原话，不补造理解；飞书写入固定 `--as bot`；不自动更新 Output、Memory、道/法

## 命令

```
node .agents/skills/learn-x-jingdu-review/scripts/adapter.mjs <command> [--week YYYY-Www] [--json] [--dry-run]
```

| 命令 | 作用 | 退出码（非 0 时） |
| --- | --- | --- |
| `prepare` | 读 weread.md（ready 校验）+ ai.md → 生成候选 → `docs +create --as bot` 标题 `精读｜<week>` → fetch 回读逐字校验（失败重建一次，再失败 blocked）→ binding + baseline | 2 无可精读划线（登记 empty）；3 weread 非 ready / 回读两次失败 |
| `notify` | 幂等键 `stableKey('jingdu','notify',week)`；发 Learn 群：**本周微信读书精读已准备** + 文档链接 + 修改完成后 @机器人 继续 | 3 无 binding |
| `snapshot` | 审阅文档回读（xml with-ids + markdown）+ baseline + weread.md + ai.md + jingdu.md（absent 如实标注）+ _source-status.json → `runtime/<week>/snapshot/` | 3 无 binding |
| `explain` | buildParsePrompt(domainRules) → parse-session → changeset 校验 → `runtime/<week>/proposal.json` | 3 parse 失败 / changeset 非法 |
| `validate` | 原值匹配、查重、歧义 exit 3；噪声 dropped | 3 任一阻断 |
| `apply` | 目标 = jingdu.md + 来源状态；两阶段提交（pendingCommit → 原子写 → sha 复算 → ready+contentSha256 → commit journal）；失败保留 pendingCommit 现场与失败 receipt | 3 两阶段失败 / 校验不过 |
| `verify-recover` | 对 failed/unknown：正文已完整 → 补 ready 登记；正文已写、状态未提交 → 幂等重放状态登记，绝不删正文 | 3 jingdu.md 不存在 / 周标识不匹配 |
| `status` | 三态定位：`--doc-url` / `--message-id` / `--reply-to` / `--week`；state ∈ absent / prepared / edited / applied | 3 按定位未找到 |
| `run` | 编排：业务锁 `runtime/locks/jingdu-<week>.lock` → prepare → notify → 等「继续」 → explain → validate → apply → 结果反馈（回复「继续」那条消息）；blocked 异常反馈 | 2 等待/空；3 blocked；4 锁忙 |

`--json` 输出机器可读结果；`--dry-run` 只渲染文案不发送。

## 配置

`config.json`（本目录，无密钥）：`chatId`（Learn 群 `oc_846411e4168e681d7f7b491c837163fd`）、`parseTimeoutMs`、`lockStaleMs`、`lockTouchMs`、可选 `docFolderToken`（精读文档落点文件夹；缺省 = `docs +create` 默认落点——仓库内未查到历史精读文档落点记录，`docs +create --as bot` 每周独立新建）。

## 共享库契约（Slice A）

`deps.mjs` 动态装载 `/Users/yuwei/code/skills/mobile-async-review/lib/`（可用 `JINGDU_SHARED_LIB_DIR` 覆盖）：fsafe（atomicWriteFile/readJsonFile/writeJsonFile/ensureDir/sha256）、lock（withLock，忙抛 `LOCK_BUSY`）、records（appendRecord 补 seq/ts；readRecords 返回 `{records, corrupt}`）、idempotency（**异步** stableKey / findApplied 按 `dedupKey` + `status ∈ applied|skipped-identical` 命中）、lark（createRunner → fetchDoc{doc,docFormat,as}/createDoc{title,contentPath,docFormat}/sendChatMessage{chatId,markdown,idempotencyKey}/replyChatMessage/listChatMessages 等）、parse-session（runParseSession{repoPath,promptFile,timeoutMs}）、changeset（CHANGESET_SCHEMA/validateChangeset/buildParsePrompt）。缺库 fail-closed（`SHARED_LIB_UNAVAILABLE`，exit 4），不静默降级。

changeset 契约（与 Slice A 同源）：解析器输出 `{version:1, business, week, docUrl, reviewContentSha256, items[], ambiguous[], notes}`；items kind ∈ modified/added/endorsed/untouched/noise。本 skill 的 validate 层：untouched/noise → dropped（不写入）；`targetHint` 带 `already-official` 前缀 → skipped-identical（幂等跳过）；ambiguous[] → exit 3 阻断；明确「撤销」请求不生成删除类变更（schema 无 removed），进 ambiguous 需人工确认后才处理。receipt 记录统一带 `dedupKey` + `status:'applied'|'failed'`。

并发与身份：除只读 `status` 外，所有会写 records.jsonl 或来源状态的命令都在业务锁 `runtime/locks/jingdu-<week>.lock` 内执行（records.appendRecord 契约要求持锁）；飞书写入（docs +create、im 发送/回复）固定 `--as bot`，文档读取（docs +fetch）按 case 基准 §6 用 `--as user`。

测试用 `scripts/fixtures/fake-lib/` 提供同形 fake（lark 状态与 parse 结果经 `JINGDU_FAKE_LARK_STATE`、`JINGDU_FAKE_PARSE` 注入）。

## 候选内容生成口径

- 每本书 `<h1>《书名》｜作者</h1>`，每章 `<h2>章节</h2>`，章节表五列 colgroup 160/390/150/290/290（概括/原始划线/洞察问题/我的思考/可选行动）
- 划线原文一字不改；回读校验要求每条原始划线逐行在回读 Markdown 逐字命中（`\|` 等转义先还原再比对）
- 「AI 分析候选」：确定性从 ai.md 按书名/章节与段落的 CJK 二元组重叠挑选 1-2 段，标注【AI 分析候选】；无相关段落不输出，不造句
- 概括与洞察问题：脚本不生成（不调 AI、不截断冒充概括）；缺省「概括」列写 `N. 划线`（N 为跨章节连续序号）。主持 AI 会话可预写 `runtime/<week>/insights.json`（`{"insights":[{"text":"<划线原文>","summary":"5-20字完整概念","questions":["①问题","②问题"]}]}`）提升候选质量
- weread ready 但 0 划线 → prepare 登记 `jingdu empty`，不建文档（case 基准 §2 empty 分支）

## jingdu.md 两阶段提交

1. `_source-status.json` 先登记 pendingCommit：entry.commitJournal 追加 `{action:'pending', at, expectSha256}`
2. 原子写 jingdu.md → 重读 sha256 复算 == expectSha256
3. 来源状态登记 ready + contentSha256，commitJournal 追加 `{action:'commit', at, sha256}`
4. 任何一步失败：保留 pendingCommit 状态与失败 receipt，不把半成品标 ready；`verify-recover` 收口（正文已完整 → 补登记；正文已写、状态未提交 → 幂等重放，绝不删正文）

jingdu 条目格式（case 基准 §6）：出处（书/章节/概括）、原始划线引用、我的思考原话照录（认可/改写带来源标注行）、可选行动（「行动：」前缀拆分）。

## 本地开发

```bash
npm test                                                  # 已把本 skill 测试加入 npm test glob
node --test .agents/skills/learn-x-jingdu-review/scripts/*.test.mjs
```

M2 待接：`weekly-source-config.mjs` 中 jingdu 仍为 `queue: manual, collector: null`（本次不改），consumer gate 后续再接。

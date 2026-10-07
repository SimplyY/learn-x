# CASE｜Flomo 每日回顾推荐

- 状态：已确认
- 最后核对日期：2026-10-07
- 上下游链接：[Requirement](../../requirements/2026-10-flomo-daily-review.md) → [Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Implementation: Implemented；ywdev完成
- Acceptance: PARTIAL（[验收报告](acceptance.md)；Usage Truth 页面尚未更新，5–8条真实投递与首个完整自然周仍待观察）

## 执行状态

- 当前有效方案：execution-plan.md及其2026-10-07用户最新裁定；当前用户明确要求实施。
- 最后已验证里程碑：M1真实3条推荐、post＋附件字节读回与只读反馈；M2累计库、质量覆盖、5–8条规则及7/28日模拟；M3每日自动化已启用并通过实时发送前置检查。
- 当前阶段：ywdev完成，ywtest报告PARTIAL，ywuse已完成独立验收并判PARTIAL。遵守用户明确顺序 ywdev → ywtest → ywuse。
- 下一步：恢复 `--as bot` 的飞书文档访问后，创建 Learn-X Flomo Usage Truth 页面、读回全文与revision并链接到README；观察2026-10-08首次定时唤醒及2026-W42完整周。首投、首周和本人反馈未验证前不改判通过。
- 阻塞：系统使用知识库没有现存Learn-X/Flomo页面；`--as bot`读取在飞书token端点返回Forbidden。项目身份契约要求AI的Docx/Wiki写入使用bot，因此未切换user身份，也未创建未读回的页面。10月7日20:00已过，不补发。

## 来源与落点核对

稳定消息ID原始请求→Requirement来源原文；完整proposed_plan→Plan方案原文；本轮实施请求→Requirement追加确认。

## 证据

04_output/_dist/flomo-review/m0-capture/m0-readback.json。共享捕获器保存Requirement后因Case父目录不存在中断；缺失文档已从原始消息按既有捕获hash恢复，未重写来源。


## 用户暂停与恢复安排｜2026-10-06 09:23 Asia/Shanghai

用户要求先暂停，今天10:20恢复，依次执行 ywdev → ywtest → ywuse。单次恢复heartbeat：flomo-10-20，当前ACTIVE。三个子任务已中断；真实采集session83282已Ctrl-C返回130，未得到成功结果，不得视为采集完成。未发送推荐，未创建每日20:00推荐自动化。

恢复从现有实施继续：私有catalog646候选、quality-packets001–012；assessment-a已保存001–003共143条判断（100条>=3，尚未入账），assessment-b正在007/008，需核查实际落盘边界。delivery27+review7测试由子任务报告，主agent尚未复跑；先前catalog/context/delivery/policy合计59项主agent复跑通过。主agent已修上下文部分周期缺失和画像成功导出哈希匹配，但尚需新边界测试。真实群成员/profile/发送频率只读预检成功，尚无发送验收。catalogHash已纳入身份别名；prepare反馈排除superseded。

下一步：完成M1真实路径、质量库存与容量、周增量接线、每日20:00配置，再按明确顺序深测及验收。禁止把部分评估、未完成真实采集或尚无消息ID的发送宣称完成。

## 恢复后的执行证据｜2026-10-06

恢复 heartbeat 实际于 10:20 UTC（18:20 Asia/Shanghai）触发，晚于用户指定的10:20本地时间。未来每日20:00配置须先核实调度时区，不沿用未验证小时设置。本次仅一次恢复，不创建重复恢复任务。

- 私有累计库：646条候选，全正文语义质量判断646条已接纳，504条达到3/4门槛。来源34文件、732段，86段因标签或完整性问题排除；这是历史快照与可信增量，不能称远端全量实时同步。
- 2026-10-06历史容量模拟按旧“每天3条”口径通过。2026-10-07新“每天5–10条、平均7–8条”口径下，以2026-10-05为起点重跑28天最小容量模拟：合格504条，最低需求130条，`possible=true`；该模拟仅证明最低容量，不代表语义平均目标已验收。
- 完整上下文：4个已结束周、2个已结束月、实时Core正式道、活跃季度Memory及现有两份画像。画像仅标已核验旧成功导出，不冒称最新。
- 首条真实推荐于18:27送达：3条原文、当下关联与完整Markdown附件。消息ID `om_x100b63789c38e0a0c3e0f3e9daba0d1`；实际上传key与消息附件key不同，初次读回标needs_review并保留占用，没有重发。
- 修复附件读回契约后，重新从真实消息下载附件，与本地原件字节SHA一致；只读recover返回delivered，保存实际消息附件key。真实反馈读取1个批次、0条明确回复，不生成负反馈。
- 本日手动发送已经占用2026-10-06；今日日常重跑应拒绝发送，不能晚间再次推同批次。
- `npm run test:flomo:review` 主agent复跑82/82通过（反馈撤回及过滤审查缺陷修复前的基线）；Skill quick_validate通过。此处是开发即时验证，不替代 ywtest 独立测试。
- 2026-10-07数量规则更新后，`policy`、`review`、`delivery`、`catalog`四组Node测试合计100/100通过；真实catalog的28天最小容量模拟通过。

真实采集运行 `learn-x-v2-flomo-122c8a3a-a2d5-4367-a6f6-d9b1d50fb8a9` 失败：父调用退出1，本次结果文件不存在，SDK列表未出现该UUID空间。标准库导入、多行CLI求值与taskSpace文档签名正常；无法进一步确认阻塞发生于readySignal还是空间创建本体。未操作其他space33，未创建第二个替代空间，未将失败产物并入正式归档。

私有证据：`04_output/_dist/flomo-review/quality-assessment-a.json`、`quality-assessment-b.json`、`capacity-7.json`、`capacity-28.json`、`2026-10-06/live-readback.json`、`live-download-readback.json`、`review.md`与`ledger.json`。不得将私有原文或上下文提交Git。

## 需求—实现—证据矩阵（开发阶段）

| 验收 | 实现落点 | 本轮证据与缺口 |
|---|---|---|
| ACC1/2/5 入库、过滤、身份 | catalog.mjs；共享flomo-filter.mjs；私有catalog；周更新hook | 历史全量解析、哈希质量缓存、ID别名及冲突测试；手写误判修复，真实库存646条不变；真实新collector仍受阻 |
| ACC3 数量、质量 | quality-packets/quality-accept；Codex全文判断 | 646条逐条判断、504合格；真实3条，低质量不补足 |
| ACC4 去重 | policy.mjs；持久ledger；send互斥锁 | 同周、两周≤5、四周≤10及34/35、129/130容量反例；新口径28天最小容量模拟通过，真实同日重发禁止 |
| ACC6 上下文 | context.mjs；Core共享读取器 | 真实完整11份材料；失败无旧道回退、缺项清单及旧画像标注 |
| ACC7 年龄 | policy.mjs；decision.ageDeviationReason | 30/365边界、整周已送统计；首日偏差有理由，近期供给缺口如实记录 |
| ACC8 发送恢复 | delivery.mjs/review.mjs | 真实post＋附件字节读回；不确定仅只读recover，重定key回归通过 |
| ACC9 反馈 | delivery.mjs/review.mjs | 真实0回复读取成功；普通文字/空文字/明确删除撤回及审计修复；无真实本人编辑删除样本，不冒称真人闭环通过 |
| M3 定时上线 | 原生Codex自动化待配置 | 真实collector门禁未通过，尚未启用每日20:00；首个完整自然周及真人反馈未观察 |

## 本轮交出状态｜2026-10-06 18:47 Asia/Shanghai

开发范围内可执行修复已收口：反馈命令改成普通文字/空文字或明确删除后撤回旧反馈；原文编号与小数严格保留；分钟展示时间不再使服务端60秒窗口内bot消息漏计；共享过滤规则不再误排手写Learn-X讨论；重复占位清单不算实质性Output。

最终主agent执行 `node --test .agents/skills/learn-x-flomo-review/scripts/*.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs`：112/112通过、0跳过。Skill quick_validate通过；diff --check通过；私有catalog/ledger/原文附件均被Git忽略。真实preflight再次确认1本人＋2bot、既有profile及完整近期范围；真实只读recover将首条回执升级normalizationVersion2，正文/附件双读回通过；反馈重采仍0，无负面推断。私有汇总 `04_output/_dist/flomo-review/development-evidence.json`。

原生工具已将一次性恢复 `flomo-10-20` 置PAUSED，避免重复恢复。没有创建新的恢复任务或启用每日推送。Architecture Truth尚未改写为“已上线”：M1失败停止条件仍成立。

恢复条件：确认Ego Lite可创建Agent任务空间；在后续新的运行中重新验证真实目标周采集与范围边界。当前这次自动化不创建替代空间、不接管无关空间。依据已读取的ego-browser Skill："Within one automation invocation, never use a second TaskSpace to recover from a stuck, blocked, timed-out, or unexpected Page."；不可继续时停止本次运行。用户已获授权的总体范围保持，后续从本Case继续，先完成ywdev，再ywtest、ywuse，不以本轮112项即时验证冒充后两阶段。

## 恢复后核验｜2026-10-07 13:26 Asia/Shanghai

以下新证据修正上一节的采集阻塞状态；旧记录保留为当时快照：

- 真实 Flomo 采集现已完成：私有扫描记录 `live-W40-scan-2100.json` 显示目标周 `2026-W40`、完整扫描、21 条扫描记录、1 页且覆盖下界；正式周历史目录的 `_source-status.json` 为 `ready`、计入10条。私有累计库仍为646条，504条有通过门槛的质量判断；覆盖仍标为历史快照，`remoteFullCoverage=false`。
- 周自动化已接入成功归档后执行 `npm run flomo:review -- archive`，并保留原有完整性门禁。每周一05:00主自动化和07:00补查仍存在；每日Flomo推荐自动化尚未创建，一次性恢复项 `flomo-10-20` 已暂停。
- 首条真实推荐为2026-10-06的3条原文和Markdown附件。发送消息、群、机器人身份及附件均有读回；附件字节SHA与本地审计原件相同。持久账本为 `delivered`，3条，`readback=true`、`attachmentReadback=true`。反馈完整读取1个批次、0条明确回复；未据此生成负面反馈。
- 本次开发即时回归命令 `node --test .agents/skills/learn-x-flomo-review/scripts/*.test.mjs .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs` 输出110/110通过、0失败、0跳过。它覆盖当前工作区的Card发送实现及历史Markdown附件只读恢复；仍不替代后续 `ywtest`。
- 已确认的原始请求与Git中原始方案基线写的是每天3–6条、附完整Markdown。当前工作区后来出现每天5–10条、Card 2.0及理由≤12字的改动，当前会话历史未找到对应的人类确认；数量口径与消息格式均待用户裁定。依赖这些选择的实时发送路径和每日自动化保持未启用。
- 现存7/28日真实库存容量文件按每天3条口径生成（21/74最低笔记数）。本次另从真实646条catalog只读运行当前分支的容量模拟，2026-10-12起连续7/28天均可行，504条合格库存下最低供给为35/130条，每天模拟5条。该结果是当前5条最低量实现的证据，不授权数量变更，也不证明平均7–8条语义质量；最终口径确认后仍需按其规则保存正式7/28日证据。

因此真实采集不再是阻塞项，M1的原方案真实样例路径已有证据；ywdev仍未收口，待完成规则裁定、真实库存对应的7/28日容量模拟、发送格式对齐和每日20:00自动化核验。首个完整自然周及真人反馈观察仍是未来验收门槛。随后才进入ywtest，再进入ywuse。

本轮不含原文的私有机器摘要：`04_output/_dist/flomo-review/development-evidence-2026-10-07.json`。

## 恢复开发收口｜2026-10-07 22:02 Asia/Shanghai

- 按原始用户请求及其批准的完整方案恢复唯一范围：每天3–6条；同周不重复；任意两周最多重叠5条；当前与前三周总重复最多10次；交付为一条post并附完整Markdown。将工作区后来添加但没有人类确认来源的5–10条、Card 2.0、理由≤12字要求移除；`execution-plan.md`恢复为Git中原始批准版，未改写冻结计划。Requirement现记载3–6条及随帖附件。
- 已修正 `.agents/skills/learn-x-flomo-review` 的规则、容量命令和发送链路。新增发送先上传Markdown、把上传key持久化为`uploadKey`，再发一条post；读回验证正文、本人群、bot、日期及下载附件SHA-256。上传key和消息附件key不混用。保留历史Card只读恢复、失败状态和不确定发送只读恢复；不自动重发。移除未确认的理由字符数门槛。
- 质量包核验：`quality-assessment-a.json`覆盖包001–006的290条，`quality-assessment-b.json`覆盖007–012的356条；合计646个唯一判断，与catalog按noteKey/bodyHash/score/quote/reason/summary逐条匹配646条，12/12包全覆盖。504条当前质量≥3；分数分布0/1/2/3/4为4/22/116/348/156。原任务暂停时“仍有未评包”的判断已被这次文件级核验更新。
- 从真实catalog以2026-10-08起点重跑，7日与28日最小供给分别为21和74；两组模拟均`possible=true`、每日3条、504条合格库存，模拟排程未超四周重复预算。元数据报告位于忽略目录 `04_output/_dist/flomo-review/capacity-7-verified-2026-W41.json`、`capacity-28-verified-2026-W41.json`，不含私人正文或笔记ID。
- 开发自测：`npm run test:flomo:review` 125/125通过；Flomo周采集相关单测8/8通过；Skill Creator `quick_validate.py`通过；`git diff --check`通过。此为ywdev即时检查，还未运行ywtest或ywuse。
- 今日未创建真实推荐或自动化。10月6日已有用户确认的3条真实批次且读回完整；不重发。自动化创建被原生审批器拒绝两次，要求用户具体确认接收群及动态附件内容范围；随后只读飞书预检被沙箱网络allowlist拦截。没有用其他自动化或身份绕过。
- 实际周采集仍是`2026-W40`完整1页、计入10条、下界已覆盖；catalog的`remoteFullCoverage=false`，不称为Flomo全量实时库。周自动化Skill已有完整状态后执行`flomo:review -- archive`的接线；下一次自然周运行尚未观察。

私有阶段摘要：`04_output/_dist/flomo-review/development-evidence-2026-10-07-resume.json`。

## 用户最新指令｜2026-10-07 22:37 Asia/Shanghai

- 用户明确授权按原方案配置每日Learn-X本人群推送，并说明当前数量方案应为5–8条；原方案中的质量、去重、上下文、隐私与单条Markdown附件边界继续有效。当前目标口径和不凑数时的处理已记录于Requirement及Plan附录。
- 本次继续遵守 ywdev → ywtest → ywuse；当前仅处于ywdev。首先按5条/日重算7/28日容量，再完成每日20:00自动化的实时发送前置检查与配置。只有开发收口后进入独立测试和使用验收。
- 尚未在本次运行创建新自动化或发送新消息；此前10月6日送达批次仍占用当日，不重发。首个完整自然周和实际用户反馈尚未发生，不能提前算作验收通过。

## ywdev收口证据｜2026-10-07 22:45 Asia/Shanghai

- 已将每日规则实现为常规目标5–8条；Node接受3–8条的硬边界。只有3–4条满足质量与上下文要求时，必须提供并显示短缺原因；少于3条拒绝推送。第4–8条必须强匹配。决策原因同时写入本地私有批次账本。
- `npm run test:flomo:review`：127/127通过；`node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-flomo-review/scripts/collector.test.mjs`：8/8通过；Skill Creator `quick_validate.py`：通过；`git diff --check`：通过。这里是开发即时验证，不冒充ywtest。
- 私有累计库读取结果为646条、其中504条当前质量分≥3。以2026-10-12为起点的7日模拟通过，最低35条，排程每日5条；28日模拟通过，最低130条，排程每日5条。两组均未触及重复预算。报告：`04_output/_dist/flomo-review/capacity-7-verified-2026-W42.json`、`capacity-28-verified-2026-W42.json`。
- 实时只读发送前置检查通过：完整成员数3（当前用户1、机器人2），配置bot与profile匹配，滚动60秒发送数0。当前没有发送新消息。
- 原生自动化 `learn-x-flomo-20-00` 已创建且读回状态为`ACTIVE`，项目为`learn-x`，本地执行。保存的RRULE为`FREQ=DAILY;BYHOUR=12;BYMINUTE=0;BYSECOND=0`；结合本机此前实测的UTC触发语义，对应Asia/Shanghai每天20:00，下一次预计2026-10-08 20:00。配置文件：`/Users/yuwei/.codex/automations/learn-x-flomo-20-00/automation.toml`。下一次实际唤醒及真实5–8条发送仍未发生。
- 10月6日既有3条真实批次保持已送达且不重发；10月7日已过20:00，不补发。仍待独立ywtest、ywuse、真实5–8条运行、明确本人反馈及首个完整自然周验收。

## 对抗审查后的开发补正｜2026-10-07 22:52 Asia/Shanghai

- 独立审查发现反馈解析只识别序号1–6。现已扩展为阿拉伯数字及中文数字1–8，并新增7/8条明确反馈回归；没有真实7/8条反馈样本，行为由模拟线程验证。
- `prepare`返回给模型的指令曾漏列年龄偏离字段；现在要求输出`ageDeviationReason`并说明偏离时不得降质，新增准备契约测试。
- 明确未发送的失败批次此前会在当日重试后被覆盖。现在将失败时间、错误码、选中项与理由、质量/年龄统计、上下文和原文哈希保留在私有`ledger.failures`，同日重试成功后历史尝试仍保留；新增上传明确失败→成功重试集成回归。
- 修复Architecture Truth中“自动化已启用”与“尚未配置”的当前状态冲突。现状为已启用，首次运行与首个完整自然周仍待实测。
- 补正后 `npm run test:flomo:review`：130/130通过；Flomo周采集/归档测试：8/8通过；Skill Creator `quick_validate.py`：通过；`git diff --check`：通过。均为ywdev即时检查，不替代独立ywtest。
- 自动化文件读回检查7项全部为真：ACTIVE、daily、Learn-X项目、5–8目标、敏感笔记过滤、完整入选Markdown随帖附件、不确定结果不重发。今日20:00已过，因此没有补发；下次定时唤醒和真实5–8条投递尚未观察。
- 已确认之前中断的collector任务曾以Ctrl-C返回130且没有成功结果。本机`ps`被权限拒绝，`pgrep`报告sysmon不可用，无法再做实时残留进程核验；没有重启或创建替代采集，避免重复操作。

开发阶段现收口，按用户顺序进入独立`ywtest`；通过后再做`ywuse`。真人持续反馈与首个完整自然周只能在未来真实运行后验收。

## ywtest 独立测试记录｜2026-10-07 23:02 Asia/Shanghai

- 独立测试结论：`PARTIAL`；没有发现新增可复现的P0/P1。主agent复跑`rtk npm run test:flomo:review`为130/130；`rtk npm test`全仓421/421；周Flomo采集与归档8/8；独立测试者合并采集、归档与Flomo同步18/18。Skill Creator quick_validate与`git diff --check`通过，11个回顾脚本`node --check`通过。
- 独立约束检查115项通过，覆盖2/3/4/5/8/9条边界、背景推荐序号、跨年/非周一起点的7/28日重复预算及34/35、129/130供给反例；真实646条目录、504条达标候选的28日结构模拟约112ms通过。
- 只读真实Feishu路径已核验历史2026-10-06的3条post正文及Markdown附件下载字节SHA；当前成员/profile/bot和最近一分钟0条也通过。读回前后私有catalog/ledger哈希不变；本轮没有发送、改账本或改自动化。
- 当前5–8条数量更新后的真实推荐投递、自动化首个唤醒、首个完整自然周与本人反馈均未验证；10月7日20:00已过且不补发。真实Feishu历史E2E不等于新数量端到端验收，故测试只评PARTIAL。
- 语义质量、动态Output匹配及个人敏感内容排除仍依赖逐次完整阅读；结构容量模拟不保证每一天都有足够强匹配候选。目录保留历史归档与可信周增量，远端历史编辑/删除同步范围未证实。

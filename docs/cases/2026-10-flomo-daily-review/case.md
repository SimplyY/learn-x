# CASE｜Flomo 每日回顾推荐

- 状态：已确认
- 最后核对日期：2026-10-12
- 上下游链接：[Requirement](../../requirements/2026-10-flomo-daily-review.md) → [Plan](execution-plan.md)
- Type: Major
- Status: In Progress
- Implementation: M0、M1完成；M2 已备份并激活线上快照，771条候选完成评分、495条达到推荐门槛；M3 全量同步、同快照周输入、重试与每日缓存已接线。W41 周一自然运行经10分钟重试后更新每日快照；按当时临时3条阈值首次发布失败。用户随后确认最多10条漏项，从同一已验证950/951快照生成W41 `flomo.md`，9条且sidecar为`ready`。yw-testing和独立ywtest通过本地回归；ywuse Usage Truth 页面、导航和README链接已写入并读回。整体Acceptance仍为PARTIAL。
- Acceptance: PARTIAL（[当前验收报告](acceptance.md)；[2026-10-08旧方案验收留档](acceptance-2026-10-08.md)）

## 执行状态

- 当前有效方案：Requirement 中 2026-10-09 用户确认的 Flomo 线上全量快照与每周同步方案，明确替代旧“历史归档＋周新增”日常来源；已授权实施。
- 最后已验证里程碑：M0/M1通过；M2旧 catalog/ledger 备份、线上快照激活、质量重评与日发送占用保留均有本机读回证据；M3手动及周一自然同步路径真实运行。自然运行经一次10分钟网络重试后激活每日缓存；当时临时3条阈值使W41首次发布失败。用户将容差明确提高至最多10条后，从已验证快照发布出9条W41 `flomo.md`，sidecar读回为`ready`。
- 当前阶段：active snapshot `fdfb5303-6ea6-4916-ad3c-17533f7bcc7e` 含950条记录（预期951，缺1，覆盖率99.89485%）；当前接受阈值最多10条。catalog 771条候选均有真实ID与链接，771条评分有效、495条达到分数门槛；ledger保留5个 delivered 批次，代际一致。W41 sidecar `ready`、count 9，文件生成于阈值更新后，使用同一已验证快照。新鲜协调者验证：全仓535/535、Review148/148；独立Flomo相关套件243/243，Process Pack 17/17；相关脚本语法、Review Skill校验和`git diff --check`通过。Usage Truth正文revision 3，导航revision 16，README链接已读回。
- 下一步：实现与文档目标已完成，验收仍为PARTIAL。真实消息发送、真实线上笔记编辑/删除后的同步、失败后使用旧缓存生成每日卡片，以及活跃私有store实际回滚仍未观察；Architecture Truth暂不更新。没有发送消息或修改线上Flomo笔记。
- 历史停止点：2026-10-10 的两次扫描曾因951/950不一致失败；用户后续已允许有界漏项，当前数量门禁不再要求精确相等。历史证据保留在下方各次执行记录。

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
- 2026-10-08数量口径进一步收敛为硬下限5条、目标6–7条、整体平均6条；诗类卡片标题改为摘要前两字加“诗”。`npm run test:flomo:review` 136/136通过。

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

## ywtest 多角度复测与 ywuse 更新｜2026-10-08 10:08 Asia/Shanghai

- 按当前确认的5–8条规则复核了需求、实现、调用链、当前工作树diff和既有真实回执。上一轮发现的两类缺陷已在工作树修复：目录解析只识别完整Flomo身份URL，保留来源样式正文并继续应用Learn-X标签过滤；年龄统计对入选项使用准确noteKey，历史只有分组身份且成员年龄跨档时失败关闭。新增相应回归测试。Ego子进程探针曾在繁忙测试中撞到2秒超时；将测试夹具超时提高到10秒后，独立测试者复测目标套件通过。
- 同一独立测试者：`rtk npm run test:flomo:review` 132/132；周采集与Flomo归档联测11/11；采集器隔离3次，每次3/3；合成对抗边界7/7。协调者复跑目标套件132/132、联测11/11，以及全仓 `rtk npm test` 453/453。最终全仓运行期间相关其他工作区文件mtime未变化；测试期间更早出现的周流程短暂断言失败，后来在独立重跑中通过，根因未进一步归属到本功能。`git diff --check`和Flomo相关脚本语法检查通过。
- 新鲜只读目录统计：646条笔记、504条合格候选；从2026-10-12起的7天与28天结构供给模拟分别需要35/130条，均可行。容量模拟只验证库存与重复预算，不代表语义匹配或真实每日供给。账本仍只有2026-10-06已送达3条的历史批次；本轮没有改catalog、ledger或发送消息。
- 本机每日自动化配置文件仍写明ACTIVE、Learn-X项目、每天20:00 Asia/Shanghai和5–8规则；当前运行窗口尚未到20:00。最新 `lark-cli auth status --json --verify` 显示bot `verify_failed`/token Forbidden，因而新数量投递以及系统使用知识库写入不能验收。本轮不切换身份、不发送、不创建外部文档。
- ywtest维持PARTIAL：本地策略、采集和全仓回归通过，但新规则真实飞书E2E被当前bot身份失败阻断。Deep ywuse同为PARTIAL；[Acceptance](acceptance.md)已更新到本轮证据，Usage Truth页面及README功能链接仍待bot恢复后创建/读回，2026-W42首个完整自然周与本人反馈仍待未来观察。

## ywtest 多角度补正复测｜2026-10-08 10:28 Asia/Shanghai

- 复测范围按三个角度展开：①推荐数量、质量与Output强匹配；②每周Flomo采集、归档和重试错误分类；③身份、重复预算、年龄归因、发送/附件读回、反馈及隐私边界。独立测试者与协调者复核了当前实现、变更diff和针对性反例。
- 复测触发并修复两处可复现边界：不同笔记共享同组历史alias时，旧统计可能把记录归到最后一个候选；现在发现跨笔记alias歧义即失败关闭。Flomo浏览器脚本中的DNS、超时和HTTP429曾被清理成普通`scan-failed`，导致周流程丢失可重试类别；现在保留安全的错误类别，429标记`service-rate-limit`并进入20分钟冷却，冷却结束前不可重试、之后可恢复；未知错误仍按不可重试失败关闭。对应策略与采集器回归已加入。
- 最新测试结果：`rtk npm run test:flomo:review` 133/133；周采集、归档及相邻工作流选择56/56；`collect-flomo-weekly.test.mjs` 11/11；全仓`rtk npm test` 460/460。修改脚本`node --check`、`rtk git diff --check`通过。独立测试者复核修复后的alias和浏览器DNS/超时/429/未知错误路径；未发现可复现P0/P1。
- 本轮没有重新运行真实Flomo浏览器扫描、没有发送真实推荐、没有改动私有catalog/ledger或外部页面。10:27的只读auth复核仍为bot `verify_failed`/Forbidden，user身份虽ready但不得替代项目要求的bot。新5–8条真实投递仍未验证；当天20:00定时窗口、2026-W42完整自然周及本人反馈均未到或未取得。
- ywtest与Deep ywuse维持`PARTIAL`。[Acceptance](acceptance.md)已更新本轮结论和证据；Usage Truth页面及README功能页链接尚未完成，须等bot身份恢复后按原方案读回验证。

## ywuse 外部状态复核｜2026-10-08 10:34 Asia/Shanghai

- 按 `lark-wiki` 只读流程使用 `--as user` 对目标「系统使用知识库」做全分页读取：精确命中空间，根节点4个，导航首页下1个子节点；完整树中没有 Learn-X/Flomo 功能页。README 当前只在系统分类中提到 Flomo，没有该使用页链接。这里是目录读回证据，不代表本轮读取了导航文档正文或 revision。
- 重新读取自动化配置：`/Users/yuwei/.codex/automations/learn-x-flomo-20-00/automation.toml` 为 `ACTIVE`、`FREQ=DAILY;BYHOUR=12;BYMINUTE=0;BYSECOND=0`、本地执行；其中 project_id 与 Codex `list_projects` 返回的 Learn-X 本地项目匹配。配置状态不证明已唤醒或送达。当前上海时间10:34，今天20:00尚未到达。
- 10:31只读身份复核仍为 bot `verify_failed`，token endpoint 返回`Forbidden`；user身份ready。按Learn-X AGENTS身份契约，不用user代写Wiki/Docx，也不执行bot `auth login`。因此未创建/编辑外部页面或更新README。
- 私有账本聚合只显示2026-10-06既有批次：`delivered`、3条、消息读回与附件读回均为真；当前没有新5–8条推荐批次，本轮没有发送或启动Flomo浏览器扫描。
- 当前新鲜验证：`rtk npm test` 460/460；`rtk npm run test:flomo:review` 133/133；同轮全仓测试包含周采集器11项且通过。工作树其余周流程变更继续保留，未清理或重置。
- ywdev与多角度ywtest的本地工作已收口；ywuse报告保持`PARTIAL`。真实5–8条飞书E2E、Usage Truth页面及README链接、首个完整自然周和本人反馈仍未验证。bot credential/provider恢复后先读回并完成使用页；每日首跑与自然周证据须待真实运行产生后再更新判定。


## M0 文档落盘与读回｜2026-10-09

- 当前有效方案：`execution-plan.md` 中 2026-10-09「Flomo 线上全量库与每周同步」版本；由当前用户明确要求实施，替代旧日常数据路线。
- 授权范围：完成该方案 M0–M4；不得修改线上 Flomo 笔记；不另建自动化；保护现有六个相关未提交文件。
- 来源定位：Requirement 与 Plan 均逐字保存当前用户完整纯文本消息；稳定消息 ID：msg_01a120a5-c8f5-7363-a7a3-2d2aba80077d；原始会话路径：/Users/yuwei/.codex/sessions/2026/10/09/rollout-2026-10-09T20-15-28-01a12096-fe99-7c60-8c52-d51d0ad7b241.jsonl。
- 当前里程碑：M0 通过后进入 M1；M1 的首条真实全量路径及用户可观察预览是后续扩展功能的门禁。
- 证据收据：[M0 捕获收据](../../../04_output/_dist/flomo-review/m0-capture/2026-10-09-online-full-plan-receipt.json)。私有单消息 JSONL 来源副本：`/Users/yuwei/code/learn-x/04_output/_dist/flomo-review/m0-capture/2026-10-09-user-plan-message.jsonl`。
- 原始六个脏文件：`.agents/skills/learn-x-flomo-review/{SKILL.md,scripts/catalog.mjs,scripts/policy.mjs,scripts/policy.test.mjs,scripts/review.mjs,scripts/review.test.mjs}`；捕获前未修改。


## 执行入口

目标仓库：`/Users/yuwei/code/learn-x`。从已核验的 M0 继续执行 `docs/cases/2026-10-flomo-daily-review/execution-plan.md` 中 2026-10-09「Flomo 线上全量库与每周同步」完整方案（包括 Execution Handoff），Requirement 与 Case 分别见 `docs/requirements/2026-10-flomo-daily-review.md` 和 `docs/cases/2026-10-flomo-daily-review/case.md`。先复核 M0 收据、`git status` 与相关 diff，逐一阅读已有六个脏文件及其测试并原样保护。下一步只推进 M1：穿通真实全量采集→暂存快照→本地卡片预览→打开真实原文链接，验证分页终态、普通/置顶身份、长文完整性及失败不替换；证据通过前不扩展依赖该路径的功能。全程不修改线上 Flomo 笔记、不新建自动化，按方案保留今日发送占用并执行备份/原子切换门禁；如真实路径、授权边界或来源无法核实，停止并在 Case 记录证据。每完成里程碑更新真实状态，按方案运行针对性测试和验收；不得把计划、模拟或离线测试写成真实线上成功。

## M1 执行结果｜2026-10-09

- 新增全量扫描暂存器与 Card 2.0 预览生成；当前仍只写入私有 `04_output/_dist/flomo-review/staged/`，不替换日常 catalog。已实现页面初始加载门禁、全页 ID/时间/正文检查、置顶 ID 合并、扫描中冲突拒收、UI 总数与稳定 ID 集终态检查、长文展开稳定等待及原文详情正文比对。
- 离线定向回归 17/17 通过：含延迟分页、折叠长文异步稳定、置顶重复 ID、相同正文不同 ID、缺 ID 拒收、同 ID 正文冲突、直接详情正文核对、暂存 Card 2.0 元数据和 Ego bootstrap 失败分类。既有周采集器测试一并通过。
- 真实只读尝试未通过：Ego Lite 执行返回 `network-timeout`，采集器回报 TaskSpace 已完成清理；没有产出全量扫描结果、暂存快照、预览或卡片文件。尚不能确认失败发生于导航、初始加载还是详情验证。
- 第二次真实尝试使用新的 Agent-owned TaskSpace，得到更精确证据：失败阶段为 `wait-initial-library`，预期笔记总数尚未读到、已采集 ID 为 0、扫描步数为 -1；导航与 `DOMContentLoaded` 阶段已返回，初始库就绪条件在 60 秒内未满足，TaskSpace 清理完成。仍未知是登录/挑战页、页面数据请求未完成，还是页面结构/选择器变化。
- 为下一次受控尝试增加结构性失败诊断：只记录 host/path、标题是否为 Flomo、列表/计数节点/卡片数量、加载/空库状态及登录/验证码控件布尔值，不记录正文、ID、Cookie 或凭据；对应离线回归纳入 20/20 测试。第二次真实尝试发生在诊断字段加入之前，因此这些页面指标尚无线上实值。
- 按 M1 门禁停止：真实分页终态、最长笔记详情一致、原文链接打开和用户可见预览均未验证；没有激活新 catalog、修改 ledger 或执行 M2–M4。当前实现只达到可测试的暂存路径，不能视为线上全量库已建立。

## M1 入口修复与当前阻塞｜2026-10-10 08:37 Asia/Shanghai

- 本轮排查发现 collector 没有 `--help` 分支；误用 `--help` 会运行默认周采集。该次调用返回 `flomo-weekly-ego-login-or-control-required`，并在 `03_input/weekly/2026-W41/_source-status.json` 写入 unavailable。该文件由本次调用新建，且目录中没有其他文件，已撤销；没有生成 `flomo.md`、快照或卡片，也没有写线上 Flomo。
- 旧周采集结果没有输出 TaskSpace ID，且返回 control-required；无法核验该空间当前状态。因此不枚举、接管或关闭任何空间，也不在本轮再开浏览器空间。该周采集调用不构成 M1 全量扫描证据。
- collector 现在支持显式 `--full-snapshot`、`--verify-detail`、`--keep-taskspace`、`--timeout-ms`；`--help` 只打印用法，未知参数和互斥选项拒绝运行。保留空间时返回 TaskSpace ID，便于后续在同一空间打开已验证的原文链接。快照仍只写私有 staged 路径，不切换 catalog。
- 新增参数边界和 CLI help 不启动浏览器的回归；定向测试 22/22 通过，脚本语法检查与 `git diff --check` 通过。上次真实扫描仍停在 `wait-initial-library`，本轮未取得新增页面结构诊断、真实全量结果、原文链接打开或用户可见预览。
- 当前门禁不变：M1 尚未通过，不推进 M2–M4。恢复后用新的执行轮次运行显式全量入口，保存实际结构诊断；若失败仍不激活快照。

## M1 显式全量尝试与失败恢复修正｜2026-10-10 08:41 Asia/Shanghai

- 新鲜基线复核后运行 `rtk node .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs --full-snapshot --verify-detail --keep-taskspace`。真实执行以 `ego-network-timeout` 退出；私有 `staged/` 目录不存在，没有写入快照或预览，也没有切换 catalog。
- 这次失败的页面阶段和结构诊断没有到达终端：CLI 原先只打印错误名，丢弃扫描器已保存的安全字段。旧失败分支会 finish Agent-owned TaskSpace，而父进程未透传其 ID，故无法在后续轮次复用。没有读取或接管其他空间。
- 已修正失败路径：错误时保留 Agent-owned TaskSpace，不调用 `finish()`；结构化结果标记扫描执行已结束并回传 TaskSpace ID、阶段、计数及 allowlist 页面诊断；CLI 仅打印这些安全字段。新增 `--task-space-id` 用于显式恢复同一空间，避免失败后另起并行空间。
- 定向回归 23/23 通过，脚本语法与 diff 检查通过；CLI 失败路径测试确认会输出阶段和登录指示，同时丢弃正文等未列入 allowlist 的字段。
- 当前仍停在 M1。该线上尝试发生在恢复改动之前，未得到页面诊断；需遵守失败后 10 分钟冷却，再从真实 Ego Lite 路径验证，并确认成功结果是否生成快照、预览和可复用空间。M2–M4 未开始。

## M1 第二轮线上失败与诊断透传修复｜2026-10-10 08:42 Asia/Shanghai

- 本轮新鲜基线后运行显式 full-snapshot 命令；父进程以 `ego-network-timeout` 退出。核查 `04_output/_dist/flomo-review/staged/` 不存在，因此没有全量结果、Card 2.0 预览或卡片文件。
- 该真实尝试使用上一版错误处理；错误结果的阶段与结构诊断被 CLI 丢弃。错误映射保留为 `network-timeout`，但无法从本轮终端确定页面阶段或页面指标。该版本在 Agent-owned 错误时执行了 `finish()`，因此空间已结束；没有 ID 可供跨轮恢复。
- 已修正扫描器错误处理为保留 Agent-owned TaskSpace、不调用 `finish()`，并在错误结果中输出 `executionFinished`、TaskSpace ID、ownership 和安全诊断；CLI 过滤后只呈现 host/path、布尔页面状态及数量字段。新增 `--task-space-id` 恢复参数。
- 定向回归 23/23 通过；`node --check` 和 `git diff --check` 通过。合成 CLI 错误样例验证了诊断透传和敏感正文剔除；这是离线测试，不是线上页面诊断。
- 等待 10 分钟失败冷却后再做下一次真实尝试。M1 尚未通过；暂存目录未激活，M2–M4 未开始。

## M1 首屏分页死锁根因与修复｜2026-10-10 08:56 Asia/Shanghai

- 修复诊断透传后，真实扫描再次停在 `wait-initial-library`：host `v.flomoapp.com`、path `/mine`、Flomo 标题存在，笔记总数 951，首屏 21 卡片；唯一 loading 指示器可见，登录与验证码指示器均为 false。ID 数为 0、扫描步数 -1，错误时 Agent-owned TaskSpace 101 被保留。
- 在同一 TaskSpace 做只读结构检查：loader 是 `.memos-list` 内最后一项、位于最后一张卡片之后；滚动容器 `scrollTop=0`、`clientHeight=742`、`scrollHeight=4503`，因此当时尚未到底。21 张卡片均有 ID 链接、时间和正文节点，其中 12 张折叠。
- 根因已确认：Flomo 用列表尾部 loading 行提示尚有下一页；旧初始门禁必须等所有 loading 消失，却不先滚到底触发分页，形成死锁。扫描循环也会在滚动前等待同一 loading 行。
- 修复为只在列表尾部 loader 后仍有未读内容时先滚动；列表外 loading 仍阻止开始，空库仍须出现明确空状态且无 loading。分页循环遇到尾部 loader 且尚未到底时先滚动触发加载，再等待内容或加载状态变化。
- 回归增加列表尾 loader 场景：24/24 定向测试通过，语法检查与 diff 检查通过。真实尝试仍未完成；等待本次失败的 10 分钟冷却后，必须复用 TaskSpace 101 继续验证，不另建空间。尚无快照或预览，M1 未通过，M2–M4 未开始。

## M1 真实全量扫描完整性冲突｜2026-10-10 09:17 Asia/Shanghai

- 复用 Agent-owned TaskSpace 101 后，真实全量扫描加载至第 49 步；Flomo 侧栏总数为 951，DOM 卡片 951 张，采集到 950 个唯一 ID、0 张缺 ID 卡片。页面没有 loading，滚动位置已到底；扫描以 `library-count-mismatch` 失败关闭，没有暂存或激活快照。
- 在同一页面只读复核发现唯一重复组位于相邻普通卡片（索引 919、920）：两张卡的 ID、时间及正文哈希一致；没有 ID 对应不同正文/时间，也不是置顶与普通卡片的重复。等待 1.5 秒后仍为 951 张卡、950 个唯一 ID、0 个 loading。未输出笔记 ID 或正文。
- Flomo 官方说明侧栏显示累计笔记数（[记录统计](https://help.flomoapp.com/advance/notes-graph.html)），但未说明累计数与重复列表节点的异常关系。事实是侧栏计数与 DOM 卡片数均为 951、唯一身份数为 950；推断可能存在重复展示并缺少一个身份，也可能是计数口径/页面数据异常；缺少证据判断哪一种成立。
- 因此不能证明扫描覆盖全部线上身份。当前失败属于身份/数量数据契约冲突，不自动重试；没有全量快照、卡片预览或已验证原文链接，本轮不进入 M2–M4、不替换 catalog、不写 ledger，也未修改线上笔记。TaskSpace 101 保留为 Agent-owned，供后续只在同一空间继续调查。

## M1 自测证据｜2026-10-10 09:20 Asia/Shanghai

- 新增针对普通列表重复 ID 与 UI 总数冲突的失败关闭回归：相同 ID 的两张普通卡片不能通过完整扫描，也不能结束 TaskSpace 或提交快照。
- `rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs`：25/25 通过。
- `node --check` 检查 collector、full-snapshot 模块与测试文件通过；`rtk git diff --check` 通过。
- 以上只验证本地逻辑与失败关闭，不替代真实 Flomo 完整性证明；M1 仍因线上 951/950 身份冲突未通过。

## M1 ywtest 独立复测与当前验收｜2026-10-10

- 独立测试者发现并促成修复两项边界：非空快照必须有可核验的最长笔记详情证据；恢复 TaskSpace 必须同时匹配此前保存的 Agent-owned ID 与随机名称，否则在取 page/导航前拒绝。定向复测分别覆盖详情证据和错绑空间不导航/不清理。
- 独立测试者复测目标套件 26/26；协调者本轮重跑 `rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs`，26/26 通过；四个相关脚本 `node --check` 与 `rtk git diff --check` 退出码均为 0。
- `node .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs --help` 退出码 0；帮助明确 `--full-snapshot` 必验最长笔记详情，且只写私有暂存快照与本地预览、不切换日常 catalog。
- Deep ywuse 独立对照 Requirement/Plan/Case 后判定 `PARTIAL`：ACC1 未通过；ACC4 只对失败关闭有部分证据；ACC2–ACC3、ACC5–ACC8 未验证。真实扫描 951/950 冲突不能证明库完整，故 M1 不能激活；M2–M4 保持未开始。具体见 [验收报告](acceptance.md)。
- 没有在独立测试或验收时重试真实浏览器扫描；未更新线上笔记、catalog、ledger、自动化或 Architecture Truth。工作树原有六个 Flomo 回顾文件未清理或重建；其中 `review.test.mjs` 为适配新增来源 URL、质量夹具及原文标题契约作局部测试改动，其余五个现有 diff 未重置。

## M1 长文全文核验修正与重复身份复查｜2026-10-10 09:50 Asia/Shanghai

- 独立代码复核证明此前长文门禁存在同源误判：列表和“原文详情”都读取 `.richText.innerText`，两处同时隐藏相同尾段时仍会相等。本地对抗反例复现了扫描与快照校验误通过。
- 现已改为打开最长笔记的真实 `memo_id` 原文页，通过 Ego Lite 双击展示区进入该卡片内的 `div.tiptap.ProseMirror`，读取完整编辑器文本并与列表内容归一化比较。核验后点击取消；若编辑器或取消控件不可用，则失败关闭，缺少取消控件时回到原始笔记页。快照契约只接受此独立编辑器方法的详情证据。
- 新回归覆盖列表和详情卡片共同隐藏尾段、TipTap 无法打开、取消控件缺失及旧同源详情方法；定向采集与快照测试为 29/29。该证据只证明本地实现会拒绝已构造的尾段截断，不代表真实最长笔记通过。
- 同一 Agent-owned TaskSpace 101 只读复核：侧栏 `951`；全局及 `.memos` 内卡片均为 `951`；列表外卡片 `0`；有 ID 的唯一集合 `950`；缺 ID `0`。唯一重复组仍位于索引 `919/920`，均为普通笔记、创建时间 `2025-09-24 08:32`、可见、正文长度 `19` 且正文哈希相同。两节点相邻但占据不同纵向位置，等待 2 秒后仍在；一个节点有 `list-enter-to` class，但计算样式无动画且 duration 为 `0s`。这些是页面结构事实，不能判断重复由分页、Flomo 列表数据或其他机制造成，也不能证明缺少的身份。
- 未重跑全量扫描、未生成暂存快照、未打开链接或激活新库；当前仍按 `library-count-mismatch` 停在 M1。实现补修后先进入 yw-testing；真实 951/950 差异解释前不自动重试、不推进 M2–M4。

## M1 预览绑定补修与验收收口｜2026-10-10

- 独立测试者指出预览原先默认选第一条普通笔记，而采集器在 Flomo 原文页核验最长笔记；两者可能不是同一 memo，故未来预览卡片链接与已核验正文之间存在证据断口。已修为依据 `detailVerification.memoId` 选择预览记录，并将同一记录绑定 Card 2.0 正文、Flomo 链接及 Markdown 预览。
- 新用例以较短普通笔记和较长置顶笔记构造反例，核对快照正文、卡片正文和链接、Markdown 链接都绑定已用 TipTap 核验的 `memo-long`；输入侧定向测试 29/29 通过。独立测试者复跑输入侧 29/29、Flomo 回顾测试 136/136，未发现回归。
- 协调者复跑 `rtk npm test`：481/481；Flomo 回顾套件由独立测试者以 136/136 复跑；4 个采集器/模块/测试文件语法检查及 `rtk git diff --check` 均退出 0。
- ywuse 对照 Requirement、方案与实现后结论为 PARTIAL：M0 达成；真实 M1 未达成；ACC1 未达成、ACC4 部分达成、ACC2–ACC3 与 ACC5–ACC8 未验证。完整证据和最短人工解除门禁事项见 [验收报告](acceptance.md)。
- 以上仍是本地代码与合成测试证据。没有重试线上扫描、没有真实打开预览链接、没有激活快照、修改 catalog/ledger/线上笔记、自动化或 Architecture Truth；M2–M4 未开始。唯一待澄清项仍是侧栏 951 与唯一 ID 950 的关系及重复普通卡片的线上语义。

## M1 侧栏计数与回收站口径查证｜2026-10-10

- 重新查阅 Flomo 官方帮助：[统计说明](https://help.flomoapp.com/advance/notes-graph.html)只说明侧栏显示“累计笔记数”；[多级标签说明](https://help.flomoapp.com/basic/tag.html)说明删除标签和笔记会把相关笔记移入回收站；[历史版本说明](https://help.flomoapp.com/basic/history.html)说明从回收站删除后历史版本也删除。
- 官方资料没有说明侧栏累计数是否包括回收站内容，也没有定义当前列表重复展示同一 `memo_id` 时总数如何计算。回收站口径是一个未验证假设，不能据此认定 950 个唯一 ID 已覆盖全部有效笔记，也不能修改 M1 数量门禁。
- 状态未变：没有重新访问浏览器或运行扫描，未生成快照，未激活新库。继续条件仍是厘清 951/950 身份与计数关系，再回到保留的 TaskSpace 101 做完整 M1 验证。

## M1 用户确认计数与新鲜全量复测｜2026-10-10

- 用户直接确认：“951 是当前独立 memo 总数”。因此 M1 必须得到 951 个不同 memo ID；该答复没有放宽完整性门禁。
- 在同一 Agent-owned TaskSpace 101 运行 `rtk node .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs --full-snapshot --keep-taskspace --task-space-id 101 --task-space-name learn-x-v2-flomo-5b70fc4b-454b-4145-ba7e-ae285521adac`。命令以退出码 1 失败：`ego-library-count-mismatch`，阶段 `read-after-scroll`，第 49 步，预期 951、唯一 ID 950；错误诊断为 host `v.flomoapp.com`、path `/mine`、951 张卡片、无 loading、无登录或验证码指示器。
- 随后在同一页面执行只读 DOM 计数核查：951 个 `div.memo`、951 个带 memo_id 的时间链接，唯一 ID 950；链接均位于 memo 卡片和列表内，0 张卡片缺时间链接。唯一重复组在索引 919/920，均为普通卡片、时间 `2025-09-24 08:32`。滚动容器已到底且无 loading。检查不输出 memo ID 或正文。
- 事实：侧栏数和 DOM 卡片数均为 951，唯一身份数为 950，用户确认 951 为独立 memo 总数。推断：当前 `/mine` 页面列表呈现一条重复身份，并缺少一个不同身份；具体缺失 memo 与列表异常机制尚未查明。
- 失败时没有创建暂存目录或快照/预览，也没有打开原文链接、切换 catalog、写 ledger、修改 Flomo、发送消息或更新自动化。M1 未通过，M2–M4 不开始；不对同一列表路径自动重试。恢复条件是发现受支持的 UI 路径能呈现缺失身份，或 Flomo 列表恢复为 951 个不同 ID 后，再从 TaskSpace 101 复验完整路径。

## M1 漏项搜索、原文核验与第二次全量复测｜2026-10-10

- 在保留的同一 Agent-owned TaskSpace 101 内生成 Flomo 官方“导出全部笔记”HTML，仅作漏项诊断，不作为快照正文或 ID 来源。导出含 951 个 `.memo` 节点，但没有 memo_id 链接或可映射的 memo ID 属性。
- 时间分布对比发现导出有一条 `/mine` 列表没有的记录（`2026-09-28 07:17`）；列表则多出一张与另一张相邻卡片相同的记录（`2025-09-24 08:32`）。从导出该记录的正文派生短查询词，在 Flomo 全文搜索 UI 中只返回一条结果；结果时间为 `2026-09-28 07:17`，真实链接带有 memo_id（仅留存 ID 哈希 `4876ff09`，不在文档展示原始 ID）。
- 在同一 Ego Lite 页面打开该 Flomo 真实链接后，详情面板可见；详情 `richText.textContent` 与导出对应记录的规范化正文逐字相等，长度 46、哈希 `d3ce3fa9`。这证明该漏项身份及其原文链接可由搜索 UI 找到，但不能证明其余 950 个身份已完整枚举。
- 以时间和 `textContent` 对照完整导出与当前列表时，列表中的折叠长文在 DOM 里只有短文本：按 ID 去重后 898 行精确匹配，53 条导出行未匹配、52 条列表行未匹配；多数差异同一时间戳下列表正文更短，故不能把这些计数解释成额外漏项或完整覆盖。该比较不是快照来源，也未用于放宽扫描门禁。
- 找到具体漏项后，在原 TaskSpace 101 重新运行同一全量采集器。第二次仍于 `read-after-scroll` 第 49 步退出码 1：`library-count-mismatch`，预期 951、唯一 ID 950、页面卡片 951。说明单条搜索补回不修复当前完整列表的数据契约。
- 全程只读；没有因扫描失败创建暂存快照或预览，没有激活 catalog、写 ledger、修改 Flomo、清质量/发送审计、发送消息或修改 Flomo 每日自动化。为遵守单次续办要求，本次触发的 heartbeat 已执行后删除，未重复安排。M1 保持未通过，停止同一路径自动重试；后续须证明可重复的全量 UI 枚举路径，或待列表恢复为 951 个不同 ID 后再继续。

## M1 用户放宽少量漏项与有界覆盖记录｜2026-10-11

- 用户直接裁决：“漏几个没啥问题，继续推进。”据此放宽的是列表卡片数与去重 ID 数必须完全相等这一项；没有放宽逐条 ID、时间、正文、原文链接、长文详情及稳定终态校验。
- 为使“几个”保持有界，本轮实现默认最多接受 3 条未枚举缺口；这是实施默认值，不是用户指定的精确数字。超过 3 条仍拒绝暂存。快照和预览记录 UI 预期数、唯一 ID 数、遗漏数、覆盖率及策略版本；同文但不同 ID 仍保留为独立笔记。
- 已按新契约更新全量扫描与快照校验器，并补上 0 缺口、1 条缺口、超过上限、重复卡片、逐条数据无效和长文核验测试。命令 `rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs`：30/30 通过。
- 首次按新口径运行 `rtk node .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs --full-snapshot --keep-taskspace --task-space-id 101 --task-space-name learn-x-v2-flomo-5b70fc4b-454b-4145-ba7e-ae285521adac --timeout-ms 1200000`。它读到 950 个有效唯一 ID、预期 951，推进至最长笔记详情核验；`wait-longest-note` 超时退出码 1。故未写入暂存快照/预览。
- 失败现场的只读结构检查显示 TaskSpace 仍为 Agent-owned、URL 带目标 `memo_id`，但页面只有首屏 21 张卡、21 个 ID，仍有一个可见 loading，目标 memo 不在 DOM。根因是 `page.goto(longest.url)` 触发 Flomo 整页导航后重置为首屏分页，目标旧笔记未加载，详情门禁一直等待。
- 对抗测试先将“最长笔记核验应点击已枚举列表中的原文链接、不做整页导航”作为断言，旧实现真实失败（`gotoCount` 实际 2、预期 1）；实现现改为在已枚举列表 DOM 中定位同 ID 的 `a.time` 并点击，再等待 URL 与详情卡片均绑定该 ID。该定向回归随后 1/1 通过。下一步必须复跑全量目标套件，再在同一 TaskSpace 101 复验真实长文路径。
- M1 仍未达成：尚无新鲜暂存快照/本地预览读回或本地卡片原文链接验收。M2 尚未开始；不发送回顾或修改线上笔记。

## M1 真实详情点击修复与续验状态｜2026-10-11

- 按用户允许少量漏项后的新鲜全量扫描得到 expected `951`、observed `950`、omitted `1`；扫描越过稳定到底与有界缺口门禁，进入 `wait-longest-note` 后超时退出码 1。没有写出暂存快照或预览，也没有切换 catalog、修改 ledger 或 Flomo 笔记。
- 同一 Agent-owned TaskSpace 101 的只读点击复现：点击笔记正文文本没有打开详情面板；点击一条可见 Flomo `a.time` 原文时间链接后出现可见 `.memo-detail-sheet`。这确认旧采集器的正文点击假设不符合当前页面交互。本次仅验证一条首屏笔记详情面板打开，未核验其 memo ID、全文或最长笔记。
- 将合成页面夹具改为只响应原文时间链接后，旧扫描器在 `wait-longest-note` 失败，复现了同一故障阶段。随后扫描器改为点击最长笔记的 `a.time`，等待面板中的目标 ID 链接和非空正文；全文一致性继续由独立 TipTap/ProseMirror 读取与精确比对验证。
- 修复后验证：采集器与快照测试 `31/31`，Flomo Review 测试 `141/141`；相关 `node --check`、`git diff --check` 以及 learn-x-input、learn-x-flomo-review、learn-x-weekly-automation 三个 Skill 的 `quick_validate.py` 均退出 0。
- M1 仍未达成：修复后的真实扫描、最长笔记 TipTap 全文对照、预览落盘和打开预览中的原文链接均尚未复验。M2–M4保持未开始。后续继续复用 TaskSpace 101，不能把本地测试或单条详情打开记录写成真实全量成功。

## M1 详情面板身份绑定修正与新鲜复验｜2026-10-11

- 在默认沙箱中尝试复跑时，Ego Lite 在连接本地 bootstrap 前返回 `ego-bootstrap-unavailable`，未访问 Flomo。依据 Ego Lite Skill 的运行约束，随后使用 Full Access 在同一 Agent-owned TaskSpace 101 启动原只读全量扫描。
- 新鲜扫描确认预期数951、唯一ID数950、漏项1，越过稳定到底和最多3条漏项门禁；但在 `wait-longest-note` 阶段超时并退出1。它没有生成快照或预览，没有切换 catalog、修改 ledger、发送消息或写线上笔记。任务空间仍按错误恢复策略保留。
- 本地对抗夹具复现了编辑器选择错误：列表与详情面板各含同一 memo ID 时，全页首个匹配可能指向列表卡片。现在 TipTap 读取、取消和退出确认都限定到已打开的详情面板；身份由面板中的精确 `memo_id` 链接或页面 URL 中精确 `memo_id` 证明，两者都缺失时失败关闭。
- 为使下一次失败也能给出可行动证据，错误诊断新增面板可见、URL 是否匹配、目标链接数、正文/编辑器是否存在及目标列表链接可见状态；CLI 只输出这些结构布尔值和计数，不输出 memo ID 或正文。合成反例证明无关 URL 不会通过，且错误输出会过滤原始 ID 和正文。
- 本轮命令证据：`rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs` 为34/34；`rtk npm run test:flomo:review` 为141/141；`rtk npm test` 为495/495；采集器 `node --check` 与 `rtk git diff --check` 退出0。
- 这些测试是本地证据，不代表详情面板真实 DOM 已满足新契约。M1仍未通过；当前真实页面是否通过 URL 或链接提供目标身份仍未知。下一步待10分钟冷却结束后，在同一 TaskSpace 101 重新扫描；只有真实快照、预览读回和原文链接打开通过才结束 M1。M2–M4仍未开始。

## M1 独立滚动容器点击修复与再次续验｜2026-10-11 14:10 Asia/Shanghai

- 再次复跑真实只读全量扫描：预期951、唯一ID 950、漏项1；稳定到底与有界缺口门禁通过，失败阶段为 `click-longest-note`，退出码1。没有生成暂存快照或预览，也没有切换 catalog、写 ledger、发送消息或修改 Flomo。
- 在保留的同一 Agent-owned TaskSpace 101 执行只读 DOM 诊断：列表 `.memos` 是独立 `overflow-y:auto` 容器；共951张卡，最长笔记位于卡片序号788。扫描结束时列表 `scrollTop=391198`、`clientHeight=742`、`scrollHeight=391940`；唯一目标链接仍在 DOM，但视口坐标约为 top `-65922`，详情面板未出现。这解释了 Ego `page.click` 没能自动滚动嵌套容器。
- 为修复该具体交互，扫描器在已校验 memo ID 的链接上调用 `scrollIntoView({block:"center",inline:"nearest"})`，再次核对可见性，然后用精确 href 选择器和 `>> nth=0` 点击。相同 ID 的重复列表卡片仍按 ID 去重，选择其中任一相同原文链接；详情面板/URL仍须再次核对 ID。
- 新增“长列表内目标链接位于视口外”的合成对抗用例；旧代码先失败，修复后采集器与快照测试 `35/35`。`node --check` 与 `rtk git diff --check` 均退出0；Flomo Review 套件本轮已执行 `141/141`。
- 真实复验仍待本次失败后的10分钟冷却结束，再复用 TaskSpace 101。M1尚未达成；普通/置顶样本抽查、真实长文TipTap对照、暂存快照/卡片读回及预览原文链接打开仍待验证。M2–M4未开始。

## M1 相对 href 选择器修正与真实 DOM 复核｜2026-10-11 14:22 Asia/Shanghai

- 冷却结束后复跑真实全量扫描：预期951、唯一ID950、漏项1；目标长笔记已进入视口，但阶段 `click-longest-note` 仍超时，退出码1。详情面板未打开；未生成暂存快照或预览，没有切换 catalog、改 ledger、发消息或写线上笔记。
- 同一 TaskSpace 101 的只读 DOM 复核显示：列表卡片总数951，目标长笔记卡片序号788；链接可见且中心点实际命中目标 `<a>`。相对 `getAttribute("href")` 构造的精确 CSS 选择器命中1个节点；按绝对 `link.href` 构造的选择器命中0个节点。直接对照证明 Flomo DOM 的原始 href 属性为相对路径，而浏览器属性 `link.href` 已解析为绝对 URL。
- 扫描器现用 `link.getAttribute("href")` 构造选择器；真实目标链接滚入容器视口、唯一 ID 预检与打开后面板身份复核继续保留。新增相对 href 的合成夹具，旧实现先失败；修复后采集器/快照测试 `35/35`，`node --check` 与 `rtk git diff --check` 退出0。
- 该修正尚未真实复验。等待本次失败后的10分钟冷却后，再用 TaskSpace 101 全量扫描；M1仍未达成，后续长文正文、普通/置顶样本、预览读回和原文链接核验均未完成。M2–M4未开始。

## M1 详情卡片绑定与完整编辑器续验｜2026-10-11 14:34–14:41 Asia/Shanghai

- 冷却结束后，同一 TaskSpace 101 的真实全量扫描通过列表终态、计数缺口和目标链接可见性检查，继续到 `open-longest-editor`，随后因详情链接无法绑定编辑根而退出1。该扫描仍未写暂存快照或预览；catalog、ledger、每日发送和线上笔记均未变。
- 失败后的只读 DOM 证据显示 `.memo-detail-sheet` 内有两个带目标 memo ID 的链接：正文详情卡的 `a.time.copy-allowed` 位于 `.normal` 根下，归一化全文与列表目标一致；另一个链接属于短小的相关笔记卡。旧实现仅找 `closest('div.memo')`，因此真实详情卡被误判为不存在。
- 扫描器现优先按详情面板内精确 ID 的原文时间链接 `a.time` 定位候选根；若多个根存在，要求唯一全文匹配；若只有一个原文根但显示层折叠，则继续由独立 TipTap/ProseMirror 全文与列表采集正文比较。取消编辑与确认退出也绑定同一根；错误诊断继续只输出结构布尔值和计数。
- 合成反例复现非 `div.memo` 的详情根、同 ID 相关笔记链接及折叠长文。采集器和快照测试 `36/36`、Flomo Review 测试 `141/141`、`node --check`、`git diff --check` 与 Learn-X 输入 Skill `quick_validate.py` 均通过。前述测试仅证明本地逻辑，不是线上扫描成功证据。
- M1仍未达成。最近一次失败后10分钟冷却预计于14:44 Asia/Shanghai结束；届时复用 TaskSpace 101 重新全量扫描。成功门槛仍包括真实快照读回、Card 2.0 与 Markdown 预览绑定、打开真实原文链接，以及普通/置顶/最长笔记抽查。M2–M4未开始。

## M1 链接正文还原与暂存入口复验｜2026-10-11

- 真实 DOM 的此前只读证据显示：列表正文内的 `<a>` 用标题显示原文 URL；在副本中将链接替换为 `link.href` 后，文本内容 SHA-256 与最长笔记 TipTap 的 `textContent` 一致。采集器现从克隆节点恢复链接目标，原节点保持只读；正文与详情绑定使用归一化文本内容，完整性同时比较展示文本剔除排版空白后的字符序列，避免将折叠尾段误判为完整。
- 新增反例覆盖链接标题恢复、编辑器布局换行差异和隐藏尾段拒绝。修复暂存入口之前执行真实全量命令，Ego 扫描返回后 CLI 以 `flomo-full-scan-body-incomplete` 退出，未写暂存文件。沿调用链定位为入口先校验并规范化记录、快照写入器再次校验；第一次校验删除运行态字段 `bodyComplete`，第二次校验因此误报。现由快照写入器单次执行权威校验，并新增完整入口回归测试。
- 新鲜验证：`rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs` 为42/42；`rtk npm test` 为509/509；`rtk npm run test:flomo:review` 为142/142；`node --check .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs` 与 `rtk git diff --check` 退出0。
- 本轮真实命令没有生成暂存快照、Card 或 Markdown 预览；没有切换 catalog、修改 ledger、发送消息或写线上笔记。M1仍未通过。下一步待本次 CLI 失败后的10分钟冷却结束，在相同 TaskSpace 101 重跑；成功后核对快照与预览，再实际打开原文链接并抽查普通、置顶和最长笔记。M2–M4未开始。

## M1 真实全量路径通过｜2026-10-11

- 在同一 Agent-owned TaskSpace 101 完成真实全量扫描，采集区间 `2026-10-11T14:03:31.231Z`–`2026-10-11T14:05:56.141Z`。侧栏独立 memo 总数951，枚举950个唯一ID，漏项1条；覆盖率99.89485%，在用户允许的最多3条缺口内。扫描经过48页，稳定滚动2次、已到底、无后续页且无加载状态，结束原因 `stable-bottom-with-accepted-count-gap`。
- 950条记录逐条通过有效身份、时间、非空完整正文与原文URL校验；没有ID冲突。时间范围为 `2023-11-09T01:40:00Z`–`2026-10-08T01:01:00Z`，包含1条置顶笔记。最长笔记正文10191字符；原文详情 TipTap/ProseMirror 完整正文校验通过。
- 私有暂存快照、Card 2.0 与 Markdown 预览构成同一哈希 bundle；读回再次执行全量契约验证，950个唯一身份通过。由同一快照重渲染的卡片和预览与落盘字节完全一致，二者原文链接均绑定最长笔记的真实 Flomo URL。目录权限700、快照权限600。
- 真实打开最长笔记链接并在 TipTap 全文对照；普通笔记链接核对通过；置顶笔记链接通过唯一路由与详情根校验。置顶正文原先处于折叠态，定位到页面使用的 `span.showBtn` 后仅展开显示，正文186字符的 SHA-256 与快照完全相同，且未进入编辑器。所有页面操作只读，未修改 Flomo 笔记。
- 本轮本地验证：`rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs` 为42/42；`rtk npm run test:flomo:review` 为142/142；`rtk npm test` 为509/509；采集器语法检查及 `rtk git diff --check` 退出0。
- M1通过后允许开始M2。此快照仍仅处于私有暂存区，尚未激活为每日catalog；ledger、质量评定、发送审计、当天占用、线上笔记、自动化和Architecture Truth均未改动。

## M2 首次线上快照切换与 M3 周同步接线｜2026-10-11

- **切换前只读基线：**私有 active root 不存在；旧 catalog 646条、均有当前有效质量判断；旧 ledger 有5个 `delivered` 批次（2026-10-06、08、09、10、11），10月11日已占用7条。旧 catalog 与 ledger 均为600权限。
- **暂存包核验：**从 `/private/tmp/learn-x-flomo-m1-5DqR8k/staged/online-snapshot-2b154462-4e85-4373-8509-3a705bad9e81.json` 重新运行 `readVerifiedStagedOnlineFlomoSnapshot`，核对 snapshot、bundle、preview、card哈希。950条记录、预期951、缺口1、覆盖率99.89485%，终态 `stable-bottom-with-accepted-count-gap`，真实采集结束时间 `2026-10-11T14:05:56.141Z`。无写入的 `scanOnlineSnapshot` 演算得到781条未排除候选，全部使用真实memo ID与URL；首代质量清空。
- **M2 激活：**运行 `rtk node .agents/skills/learn-x-flomo-review/scripts/review.mjs activate-snapshot --file <已核验的snapshot.json>`，返回 `activated`，快照 `2b154462-4e85-4373-8509-3a705bad9e81`，去重代际 `online-2b154462-4e85-4373-8509-3a705bad9e81`，目录下5个历史批次保留。随后 `rtk node .../review.mjs archive` 返回781条 active catalog 记录、0条合格评分候选、缺口1。
- **私有落盘读回：**`storage-mode.json` 指向 versioned snapshot/catalog/ledger；catalog、ledger、storage state 代际一致；当天 `delivered` 与7个条目仍在，全部5批存在。旧 catalog/ledger 备份SHA-256分别与迁移前原文件完全相同。private root、snapshots、backups与备份目录为700；快照、catalog、ledger、备份文件和storage state为600。
- **质量复评状态：**`quality-packets` 已生成10份私有packet、共781条待评；本轮未写入任何新评分，避免把测试或旧评分冒充语义复评。日常推荐在不足5条有效高分候选时停止发送。M2的数据迁移和当天防重复已完成，语义重评仍待执行。
- **M3 实现：**Flomo `input:flomo` 改为同一 `weekly:retry --mode manual --source flomo` 执行入口；周一全量扫描以 attempt token 启动，验证后先版本化切换快照，再从同一结果抽取目标ISO周。允许的缺口可以刷新每日库，但周侧车失败并保留旧文件。Flomo冷却10分钟，服务端要求更长时遵守；身份/契约错误不自动重试；重试仍限单浏览器队列与首次尝试加4次重试及07:00补查。成功/失败状态带快照元数据，旧快照供每日缓存读取。
- **每日自动化：**更新现有 `learn-x-flomo-20-00`，保留ACTIVE与20:00 Asia/Shanghai；改为快照缓存、展示采集时间/覆盖率、只发送Card 2.0且不附Markdown。自动化文件读回核对更新后的prompt与调度。本轮未发送。
- **本地新鲜回归：**Review 146/146；Flomo collector/snapshot/同快照周提取 46/46；weekly retry/source adapter 37/37；Skill Creator 两项quick_validate通过；相关脚本语法检查和 `rtk git diff --check` 退出0。新增了短于4字符笔记可使用完整原文作为评分quote的边界修复，避免无法落评分。
- **尚未验证：**未由新 retry supervisor 触发另一轮真实Flomo扫描；下一次周一05:00/07:00自然任务及周输入落盘尚未观测；未做真实线上编辑/删除；未运行第一轮 yw-testing、独立ywtest或ywuse；Architecture Truth 尚待实现与独立验收达到更新门槛。原始历史库与备份均保留；没有修改Flomo笔记或发送消息。

## 续接检查与最新进度｜2026-10-11 23:17 Asia/Shanghai

- 执行续接前确认没有仍在运行的子任务。最新 `review.mjs status` 只输出聚合状态：线上快照 catalog 781条、当前合格评分0条、排除742条；账本保留5个历史 `delivered` 批次。本轮没有发送消息或访问浏览器。
- 10个待评私有 packet 共781条，与当前 catalog 的身份和正文哈希逐条匹配，无缺项、重复或旧正文；已将首包前12条判断暂存到 Git 忽略目录 `04_output/_dist/flomo-review/quality-assessments/<snapshotId>/`，尚未写入 active catalog。尝试直接保存到私有 runtime 时系统返回 `EPERM`；临时评分不会冒充已入账，待确认可用的受控写入方式后再批量提交。
- 已纠正周自动化 Skill 中“覆盖目标周下界即停止”和按创建时间/正文合并的过时步骤；更新既有每日自动化，让数量与位置规则读取当前 Skill，保持 ACTIVE、20:00、本地项目和 Card 2.0。配置读回验证通过。
- 新鲜验证：`rtk npm test` 517/517；`rtk npm run test:flomo:review` 146/146；采集/快照/同次周提取 46/46；retry/source adapter 38/38；`git diff --check` 通过。旧数量规则仍在代码和 Skill 中，因 Requirement 与 Plan 对 2026-10-08 数量裁决互相冲突，已向用户提出唯一待裁决问题；该答复前不改日推数量策略。
- 下一步：依用户答复统一数量策略和容量模拟，进行测试先行修改及独立复测；随后完成剩余质量复评。周一自然执行、真实失败后的墙钟重试、线上编辑/删除及外部 Usage Truth 读回仍待观察或验收。

## 数量规则修复、线上缓存更新与开发收口｜2026-10-12 00:10 Asia/Shanghai

- 用户已确认每日数量裁决：每次5–10条，日常及整体平均目标7–8条；本轮将策略、提示词、短缺理由、容量模拟和每日 Skill 对齐该规则。8条不再被旧上限拒绝，11条仍拒绝。
- 发现手动 `input:flomo` 入口未走周同步监督器的完整重试策略，已改为共享入口，并覆盖10分钟冷却、服务端更长等待、最多4次重试、每次新令牌和有界退出。重复接受同一质量结果现为无写入的幂等操作；同 ID 正文不变时跨快照保留评分，正文变化使旧评分失效。
- 真实手动全量同步运行时间为 `2026-10-11T15:58:16.419Z`–`2026-10-11T16:01:09.854Z`。950/951、缺口1及覆盖率99.89485%满足用户允许的有界缺口；新快照被激活。catalog读回771条候选均有ID和原文URL，771条评分与当前正文哈希匹配，495条合格；catalog、ledger与storage mode去重代际一致，5个历史已送达批次保留。
- 同次运行的 `2026-W40` 周输入 sidecar 标记为失败，未将有缺口的扫描冒充完整周输入；旧周文件保留。该数据契约失败不触发自动重试，符合身份/完整性错误停止重试规则。上次成功每日快照仍可用。
- 新鲜验证：`rtk npm run test:flomo:review` 147/147；全仓 `rtk npm test` 520/520；采集、快照、同源周提取、发布与重试核心套件95/95；9个相关运行脚本 `node --check` 退出0；`rtk git diff --check` 退出0。独立只读代码审查未发现阻断缺陷；指出平均7–8是提示软目标，不是账本强保证，与当前 Requirement 的“目标”表述一致。
- 未触发真实发送，未修改线上 Flomo 笔记或自动化配置；未更新 Architecture Truth。首轮 yw-testing、独立 ywtest、ywuse 和周一05:00自然执行观测待完成。

## 自然周运行与首轮 yw-testing｜2026-10-12 08:45 Asia/Shanghai

- **自然周执行：**现有周一05:00自动化于本地05:02启动Flomo首次尝试（UTC `2026-10-11T21:02:53.269Z`）；`2026-10-11T21:03:04.948Z` 记录 `network-transient` 并安排10分钟后重试，预定时间 `21:13:04.947Z`，实际第二次开始于 `21:13:04.955Z`。第二次扫描于 `21:15:55.943Z` 结束并报告 `source-contract-mismatch`，该错误不再重试。重试状态记录尝试2/最多4次重试、无活动令牌、无待重试时间；两次扫描串行。
- **实际快照：**新active snapshot为 `fdfb5303-6ea6-4916-ad3c-17533f7bcc7e`，捕获于 `2026-10-11T21:15:55.757Z`；预期951、观察950、遗漏1、覆盖率99.89485%，结束依据 `stable-bottom-with-accepted-count-gap`，稳定滚动2次、已到底、无更多页且无加载。当前catalog 771条，771条质量哈希有效、495条达到分数门槛；ledger保留5个已送达批次，catalog/ledger代际一致。
- **周输入：**`2026-W41/_source-status.json` 将Flomo标记 `failed`、count 0，原因是缺1条时无法证明周输入完整；当周此前没有 `flomo.md`，所以 `preservedStaleFile=false`。这验证了周输入门禁与失败分类，但没有验证已有W41旧文件的真实保留。更早W40手动执行的旧文件保留证据仍见前文。
- **首轮测试：**协调者执行 `rtk npm test`，520/520通过；`rtk npm run test:flomo:review`，147/147通过；9个相关运行模块 `node --check` 全部通过，`rtk git diff --check` 退出0。既有独立测试代理曾因账号用量限制未运行；本轮未进行真实Feishu消息发送，因此Feishu发送E2E为未验证 / BLOCKED。完整报告仍待第二个新独立测试者与ywuse。
- 本轮只读检查自动化产物和聚合存储元数据；未发送消息，未修改Flomo线上笔记、自动化或Architecture Truth。

## 漏项阈值更新与 W41 周输入读回｜2026-10-12

- 用户在周自动化线程针对951预期、950观测而未生成周输入直接确认：“缺10个以内都没啥问题呀，为什么不生成呢？”来源为线程 `01a12cc5-2a5e-76a3-a89f-987d759199af` 的用户消息 `01a12d8e-643c-73e1-b3c6-77ba096bc4a9`。将临时3条容差上调为最多10条；每张观察卡片和分页稳定终态门禁不变。
- 读回 `03_input/weekly/2026-W41/_source-status.json`：Flomo状态 `ready`、count 9、`preservedStaleFile=false`，summary记载全库950/951、漏1、最多10条容差、分页48页；`flomo.md` 存在且非空。该周输入是在用户放宽阈值后从最近成功的完整扫描快照生成；周一自然扫描本身并未重跑。
- 活跃日快照仍为 `fdfb5303-6ea6-4916-ad3c-17533f7bcc7e`，采集时间与历史运行记录一致。不得把后续周输入发布读回描述为一次新的 Flomo 扫描。
- 同一续接期间发现并修复两处并发/消息契约缺口：Card 读回增加 `msg_type=interactive` 强校验；attempt guard 的写入、回收、失效与快照激活共用 review store lock，使 recovery 无法在 token 重核与快照指针提交之间撤销该令牌；跨周 Flomo 尝试先取得全局浏览器队列，再写入令牌，并在令牌回收完成后释放队列。新增用例均在修复前失败、修复后通过。该阶段新鲜全仓`npm test`为524/524，Review套件148/148；当时独立回归与ywuse待执行，后续结果见下节。
- 当时的下一步：完成新鲜本地回归和独立测试者复测，再执行 `ywuse`。后续完成情况记录在下方“独立复测、容差说明修正与 ywuse 收口”；真实 Feishu 发送、线上笔记编辑/删除、旧快照卡片回退与 active store 回滚仍未验证。

## 独立复测、容差说明修正与 ywuse 收口｜2026-10-12 10:34 Asia/Shanghai

- 清除日常使用 Skill 中一处与用户最新裁决冲突的旧规则：以前允许计数缺口更新每日快照，却仍要求周输入失败；现明确稳定到底、身份/时间/正文校验通过且缺口不超过10条时可以发布 `ready` / `empty` 周输入，并必须披露预期、观察、遗漏和覆盖率。同步修订 `03_input/README.md` 与 `03_input/usage.md`；保留并发周流程已经写入的 Health-X 文案。
- Skill Creator `quick_validate.py` 对 `learn-x-flomo-review` 报告 `Skill is valid!`；`git diff --check` 通过。全仓与Review新鲜自测分别为535/535、148/148；独立只读测试分别为Flomo相关243/243、Process Pack 17/17，未发现新的P0/P1或高价值缺陷。同一独立测试者随后窄复核本轮Skill/输入说明与命令定义，无阈值或来源矛盾，Review复跑148/148通过。独立复核只读规则/代码并用合成数据，没有访问私有笔记正文、真实扫描或外部发送。
- `ywuse` 文档按 `lark-doc-create-workflow` 初始化并解析 DocxXML 草稿（`assessment.status=passed`），由bot在 Wiki 导航节点下创建：[Learn-X Flomo 使用说明](https://ywhome.feishu.cn/wiki/JzzLwuVGZiJSIBkUhLbc2Mbwnwg)。正文创建 revision `3` 完整读回；导航首页追加入口后 revision `16` 读回，子节点全量列表确认同一链接位于“系统使用知识库 / 导航首页”。仓库 `README.md` 核心资产新增入口；用法也写入 `03_input/usage.md`。草稿工作区 `draft_5b4b062a_folder/` 按文档工作流要求保留。
- Acceptance 更新为部分达成：本地实现、周输入发布、独立回归及 Usage Truth 写后读回已完成；真实日常消息E2E、真实线上编辑/删除同步、旧快照回退后生成每日卡片、对活跃私有store实际回滚仍未验证。没有发送飞书消息、修改Flomo线上笔记或更新 Architecture Truth。

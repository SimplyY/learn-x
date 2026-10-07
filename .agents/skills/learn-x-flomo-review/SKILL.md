---
name: learn-x-flomo-review
description: 从Learn-X私有Flomo累计库结合最近周月Output、实时正式道、Memory与个人理解，生成每日5–8条高质量回顾推荐，校验四周去重，推送到本人飞书群并采集明确回复反馈。用于每日20点推荐、补充历史入库、预览、恢复不确定发送或查看回顾记录。
---

# Flomo 每日回顾

在 `/Users/yuwei/code/learn-x` 运行。需求与完整规则见 `docs/requirements/2026-10-flomo-daily-review.md`，实现入口是 `scripts/review.mjs`（下文简称入口）。脚本只处理确定性逻辑，语义判断由当前Codex完成，不调用其他AI或浏览器。不得自动写Memory、道法、人物画像或Flomo。

## 正常每日运行

1. 使用Asia/Shanghai今日日期。运行入口 `status`；今日已送达则只收反馈，不再准备或推送。`reserved/sending/needs_review`先执行 `recover --date YYYY-MM-DD`；无法只读确认则停止、不重发。锁异常先核实拥有进程，不自行删锁。
2. 运行 `archive`，复用本地归档和周采集。运行 `quality-packets`；读取新增/改动的每份完整packet，逐条判断后写私有JSON并 `quality-accept --file ...`。不凭标题、标签或长度评分，不机械批量给相同分数；未读原文不得标已评估。
3. 运行 `feedback`。反馈失败只说明本次未取得新反馈，不解释为没有反馈。明确本人回复是个体偏好证据；没有回复不推断。`跳过`不等于永久屏蔽或删除。
4. 运行 `prepare --date YYYY-MM-DD`，读取返回的完整request和全部上下文，按分块阅读全部合格候选的质量索引；不截断名单忽略旧笔记。最近周/月Output优先，正式道为价值边界，Memory为已沉淀背景，画像保留其事实/推断/未知与更新时间。较旧画像不能覆盖新的Output。部分周/月缺失说明缺口；周和月全部缺失或道失败时停止。
5. 常规目标选择5–8条并复读catalog里的入选原文。先选与近期周/月Output强匹配的高质量笔记；前三条可用高质量长期背景关联，须说明关联；第4–8条只选强匹配。若只有3–4条同时满足质量与对应序号上下文要求，可少于目标数量并填写`countDeviationReason`；不足3条则阻止推送。支持反证、旧观点再判断、生活与审美价值，不能只强化旧叙事。在合格候选中按整周年龄统计改善近30天20–30%、近365天合计80–90%的配比，质量和硬去重优先。每条给真实上下文逐字引用，不编造出处。
6. 写私有decision JSON（契约见下），运行 `preview --file ...`。读回message.md、review.md及validation.json，检查编号、原文、链接、数量不足原因和年龄偏离原因。命中个人敏感原文时不要外发，换选普通非敏感笔记；完整入选原文随帖作为Markdown附件，不把个人Core全文写入附件。
7. 运行 `send --file ...`，沿用配置bot和已核验的本人群。不得通过修改身份、降低门槛或重复发送恢复失败。只有返回 `delivered`和消息ID才报告成功。正常20点后才定时发送；用户明确要求的真实验收可提前发送并占用今日批次，不在20点再次推送。

低于3条时写明候选不足、来源或规则缺口，并向当前任务报告未达标；不能发送低质量内容或突破重复预算。首次上线运行 `simulate --date 本周周一 --days 28` 验证至少130条合格独立供给，并以`--days 7`检查至少35条供给；模拟不证明语义质量或实际送达。

## 质量判断契约

对每条完整原文给0–4分：0=无可回顾内容/残缺，1=空泛搬运或上下文缺失，2=有记录意义但缺少独立判断或目前回顾价值，3=清晰具体且有思想、经验或审美价值，4=值得长期反复对照的重要判断/经验/作品。只>=3进入推荐资格。不要为了供给达标降低标准；引用只是来源证据，不代替判断。

写JSON：`{policyVersion:"1",items:[{noteKey,bodyHash,score,summary,reason,quote}]}`。`quote`必须是该笔记原文逐字摘录，`summary`是简短可读标题，`reason`说明分数依据。packet、判断和状态都保存在Git忽略目录 `04_output/_dist/flomo-review/`。不要把正文打印到公开日志或提交Git。

## 推荐契约与恢复

decision：`{date,contextHash,catalogHash,countDeviationReason,ageDeviationReason,items:[{noteKey,bodyHash,relevance:"strong"|"background",reason,contextEvidence:[{path,quote}]}]}`。实际推荐不足5条时必须给出countDeviationReason；年龄预测偏离软比例时必须给出ageDeviationReason。偏离原因应说明质量、匹配、供给或小样本情况，不得为配额凑低质量。strong至少引用一处周/月Output；背景关联可引用正式道、Memory或画像。所有quote必须是完整request中的原文。

脚本校验同周不重复；当前及前三ISO周两周交集≤5、额外重复次数≤10。`reserved/sending/needs_review`仍占预算。未知身份停止；同ID编辑或补ID不重置曝光。历史年龄按原创建时间；四周预算与30/365天年龄口径分开。

`recover --date`只读核验同chat、同bot、日期、post正文和完整Markdown附件的规范化哈希及下载字节，确认唯一已发送消息后落账，不重新发送；兼容只读恢复历史Card回执。反馈编辑成普通文字、空文字或明确删除时撤回旧版本，仅记录明确可核验的版本；没有返回不推断删除。`feedback --target-date`补采旧日明确反馈。原始笔记在 `03_input/_archives/flomo/catalog.json`，推荐与反馈在 `04_output/_dist/flomo-review/ledger.json`，当日完整原文在对应日期的 `review.md` 和随帖附件。

每周Flomo采集成功后运行 `archive`；ready缺完整证据、failed/unavailable/empty残留和所有learn-x生成内容不得进入。缺ID使用本地原文路径，不造Flomo链接。该库是归档加周新增，不保证远端历史编辑/删除已同步。

# Acceptance｜Flomo 线上全量快照与每周同步

- **结论：**部分达成（PARTIAL）
- **总结：**M1 真实全量路径通过，950/951且缺口1已按用户裁决记录。M2 已备份并激活线上快照；771条候选完成有效评分，495条达到评分门槛。M3 手动全量同步已更新每日缓存，但因同次扫描有1条缺口，W40周输入保持失败并保留旧文件。数量规则修复后，Flomo Review 147/147、核心同步与重试95/95、全仓520/520通过；代码审查未发现阻断缺陷。yw-testing、独立ywtest、ywuse及自然周运行仍待验收。
- **一句话依据：**真实快照、质量迁移与手动同步路径有读回证据；自然周执行与最终使用验收尚缺。
- **日期：**2026-10-12（Asia/Shanghai）
- **判据：**[Requirement](../../requirements/2026-10-flomo-daily-review.md) · [Execution Plan](execution-plan.md) · [Architecture Truth](../../architecture.md) · [Case](case.md) · [旧方案验收留档](acceptance-2026-10-08.md)

## 实际用法与最短验收动作

每日 catalog 已切换到私有线上快照；`archive` 从该缓存刷新 catalog，平日不访问浏览器。当前快照于 `2026-10-11T16:01:09.854Z` 完成，覆盖950/951；catalog有771条候选，495条达到质量门槛。Card/预览显示快照时间及覆盖率；本次目标周输入标记失败并保留旧文件。每日自动化仍为 ACTIVE、20:00、本地 Learn-X 项目，读取当前 Skill 的5–10条范围和7–8条平均目标，发送 Card 2.0 单卡，不附 Markdown 文件。本轮没有发送消息或修改线上 Flomo 笔记。[当前每日 Skill](../../../.agents/skills/learn-x-flomo-review/SKILL.md) · [全量 CLI 帮助](../../../.agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs)

最短后续验收动作：按组合目标依次完成首轮 yw-testing、独立 ywtest 和 ywuse；随后核对周一05:00自然运行是否从同一扫描产生快照与 `flomo.md`，再更新 Architecture Truth。自然运行结果尚未观测。

## Usage Truth

本地用法已随 M2 切换到线上全量快照与每日缓存入口，需按既定 `ywuse` 阶段核对使用说明。当前还没有更新飞书 Usage Truth 页面或 README；此前 2026-10-08 的只读目录结果没有找到 Flomo 专页，本轮未重查外部目录，也不声称当前页面/revision。外部页面读回与本地 README 是否需要链接尚待 `ywuse` 核验；没有执行外部写入。

## 逐条需求结论与证据

判定以新方案的 M0–M4 和 ACC1–ACC8 为准；旧版「历史归档＋周新增」验收保存在[旧报告](acceptance-2026-10-08.md)。

| 验收项 | 结论 | 证据与边界 |
|---|---|---|
| M0 文档保存 | 达成 | Requirement、Execution Plan 与 Case 已保存并互相链接；原始方案说明附件仅作背景。原有 6 个 Flomo 回顾工作文件未被清理、reset 或覆盖重建；其中 `review.test.mjs` 为新来源 URL 与标题契约做了局部 fixture/断言适配（详见 Case），其余 5 个现有 diff 保留。见 Requirement「2026-10-09｜线上全量快照方案与实施授权」及 Case。 |
| M1 真实全量路径 | 达成 | 951个独立 memo，枚举950个、缺1个；分页稳定终态、逐条ID/正文/链接、最长TipTap及普通/置顶样本通过，暂存哈希包读回一致。见 [Case M1 记录](case.md)。 |
| ACC1 完整同步、预览并打开真实链接 | 达成 | 线上快照950条已激活；M1 中同一暂存包的快照、Card 2.0、Markdown 预览一致，实际打开最长、普通和置顶原文链接并核对正文。 |
| ACC2 编辑后的内容与质量失效 | 部分验证 | 合成测试覆盖同ID正文变化使评分失效；尚未等待自然周同步后的真实编辑反映。 |
| ACC3 删除/排除后的候选退出且历史可解释 | 部分验证 | 合成测试覆盖删除退出、排除身份保留和同文去重；真实线上删除/标签变化未执行。历史账本保留5批。 |
| ACC4 完整性异常拒绝替换快照 | 部分验证 | M1 实际接受950/951并记录缺口；本地对抗测试覆盖缺ID、缺口超限、分页/尾部loader、正文冲突和快照拒绝替换。尚未用真实故障破坏已激活快照。 |
| ACC5 10分钟重试、单扫描及迟到提交保护 | 本地验证通过 | 定向测试覆盖 Flomo 10分钟冷却、服务端更长等待、单浏览器队列、令牌重核与迟到提交拒绝；本次失败属于数据契约错误，按方案停止重试。暂时网络错误后的墙钟重试尚未观察。 |
| ACC6 失败后旧快照回退并标时间、周输入仍失败 | 部分验证 | 本次950/951扫描更新日快照；同次 W40 sidecar 标记 `failed`，摘要说明缺口导致周输入未发布，旧 `flomo.md` 保留。合成测试覆盖每日缓存时间展示。新快照后的每日卡片真实生成与旧文件字节级前后比较尚未执行。 |
| ACC7 首次切换保留今日发送占用与历史发送审计 | 达成 | 激活时保留全部5批；2026-10-11 的 `delivered` 7条仍占用；旧 catalog/ledger 备份与原文件 SHA-256 相同；激活幂等测试通过。 |
| ACC8 恢复 catalog、质量与账本一致 | 本地验证通过 | 回滚单测验证恢复旧 catalog、质量和账本代际一致，并保留新发送审计；未对正在使用的真实 active store 执行回滚。 |

M1初始验证参考命令（2026-10-11）：

```text
rtk node --test .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs
# 31/31 passed, 0 failed（2026-10-11；含真实原文链接点击行为夹具与覆盖信息展示）

rtk node --check .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs
rtk node --check .agents/skills/learn-x-input/scripts/lib/flomo-full-snapshot.mjs
rtk node --check .agents/skills/learn-x-input/scripts/collect-flomo-weekly.test.mjs
rtk node --check .agents/skills/learn-x-input/scripts/flomo-full-snapshot.test.mjs
# all exited 0

rtk node --test --test-reporter=dot .agents/skills/learn-x-flomo-review/scripts/*.test.mjs
# 141/141 passed, 0 failed（2026-10-11）

rtk npm test
# 481/481 passed, 0 failed

rtk git diff --check
# exited 0

rtk node .agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs --help
# exited 0; full mode verifies the longest note and only stages a snapshot/preview
```

这些是当时的本地验证记录。独立测试者发现“预览默认记录”与“最长笔记核验记录”可能不一致后，协调者将预览改为绑定 `detailVerification.memoId`；独立只读复测确认卡片正文、卡片链接与 Markdown 预览链接均指向同一条已核验记录。测试通过不替代真实完整快照与链接证据。

## 最新进度｜2026-10-12（Asia/Shanghai）

本轮新鲜验证：`rtk npm run test:flomo:review` 147/147；Flomo采集、快照、同源周提取、发布及重试核心套件95/95；`rtk npm test` 520/520；9个运行脚本 `node --check` 退出0；`rtk git diff --check` 退出0。独立代码审查未发现阻断缺陷。第一轮 yw-testing、独立 ywtest 与 ywuse 尚未运行；周一05:00自然执行尚待观察。

## 关键架构约束与重大回归状态

- **符合：**Flomo 线上笔记未被修改；M2 只更换本机私有快照源。真实扫描有界缺口1/951并明确记录，覆盖率99.89485%，不宣称无缺口。
- **符合：**新全量快照以真实 memo ID 绑定原文 URL；M1 真实采集已在原文页面打开最长笔记，并通过 TipTap/ProseMirror 完整正文校验；普通与置顶原文链接也通过。合成测试另覆盖相同类型的失败关闭边界。
- **已接线：**私有线上快照、按版本激活、周重试与每日缓存读取均已接入；手动同步新鲜运行后，日快照和W40失败 sidecar均可读回。Architecture Truth 待后续验收达到门槛后更新。
- **数据状态：**active snapshot含950条记录、预期951、缺口1。catalog 771条候选均有 memo ID 与真实 URL、均有当前正文哈希有效的评分，495条达到评分门槛。历史 Markdown 缺ID记录留在原库和备份，不作为候选；ledger保留5个已送达批次。
- **回归：**数量策略已统一为5–10条、目标与整体平均7–8条；独立审计覆盖8条准入、11条拒绝及重复评分幂等。全仓520/520，定向95/95，Review147/147；所有原有脏文件保留。

## 待验收事项与必要人工项

计数语义已由用户确认：侧栏951是当前独立 memo 总数；用户允许少量漏项，实施默认上限3条。M1真实扫描950/951通过且缺口1条。M2质量评分已写入，495条达到候选门槛；未手动发送。M3手动全量运行更新日快照，周输入因缺口保持失败。首轮 yw-testing、其后的独立 ywtest 与 ywuse，以及周一自然运行仍待验证；真实线上编辑/删除、暂时性失败后的墙钟重试和真实库回滚未执行。

## 最终三态与时间

**部分达成（PARTIAL）｜更新至 2026-10-12（Asia/Shanghai）。**M0/M1达成；M2旧库备份、线上快照激活、771条评分及495条合格有读回证据，5个历史送达批次保留。M3实现、手动全量路径与本地测试通过；由于1条有界缺口，周输入保持失败。数量规则已按用户裁决对齐。yw-testing、独立 ywtest、ywuse和周一自然执行尚未完成。本轮没有发送消息或修改线上 Flomo。

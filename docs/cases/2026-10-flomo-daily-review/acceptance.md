# Acceptance｜Flomo 线上全量快照与每周同步

- **结论：**部分达成（PARTIAL）
- **总结：**M1真实全量路径通过，950/951、遗漏1条和覆盖率已记录；M2线上快照、771条评分、495条合格候选及5批历史送达账本有读回。W41自然扫描经10分钟网络重试后更新日快照；用户将容差确认至最多10条后，同一已验证快照发布9条周输入并读回`ready`。本轮协调者全仓测试535/535、Review148/148通过，独立Flomo相关测试243/243、Process Pack 17/17通过；Usage Truth页面与导航已写入并读回。
- **需求：**每日回顾和周输入都以Flomo线上全量快照为身份与正文来源，最多容忍10条全库计数遗漏且明确展示覆盖率。
- **实现：**全量采集、周输入、每日缓存、质量与去重代际、失败重试以及对抗测试已接线，操作说明已发布到使用知识库并链接回仓库。
- **未验证：**真实每日消息发送、线上笔记编辑/删除后的下一周反映、旧快照回退后生成每日卡片，以及活跃私有store的实际回滚仍无证据。
- **一句话依据：**本地实现、独立测试、W41周输入及使用文档写后读回均有证据；剩余真实外发和需线上变化/回滚的验收场景保持部分验证。
- **日期：**2026-10-12（Asia/Shanghai）
- **判据：**[Requirement](../../requirements/2026-10-flomo-daily-review.md) · [Execution Plan](execution-plan.md) · [Architecture Truth](../../architecture.md) · [Case](case.md) · [旧方案验收留档](acceptance-2026-10-08.md)

## 实际用法与最短验收动作

每日 catalog 已切换到私有线上快照；`archive` 从该缓存刷新 catalog，平日不访问浏览器。当前快照 `fdfb5303-6ea6-4916-ad3c-17533f7bcc7e` 于 `2026-10-11T21:15:55.757Z` 完成，覆盖950/951；catalog有771条候选，495条达到质量门槛。Card/预览显示快照时间及覆盖率。W41 `flomo.md` 在用户把漏项容差从临时3条提高到最多10条后，从该已验证快照生成9条，sidecar为`ready`；周一自然扫描本身没有重跑。每日自动化仍为ACTIVE、20:00、本地Learn-X项目，读取当前Skill的5–10条范围和7–8条平均目标，发送Card 2.0单卡，不附Markdown文件。本轮没有发送消息或修改线上Flomo笔记。[当前每日 Skill](../../../.agents/skills/learn-x-flomo-review/SKILL.md) · [全量 CLI 帮助](../../../.agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs)

最短使用校验：运行 `npm run input:flomo`，检查目标周 `_source-status.json` 和 `flomo.md` 中的预期数、观察数、遗漏数与覆盖率；每日按 Flomo 回顾 Skill 执行 `status`、`archive`、`prepare` 和 `preview`，确认预览展示实际快照时间及覆盖率。真实外发还须按当天授权和既有发送门禁执行，本轮没有发送。

## Usage Truth

**已发布并读回：**[Learn-X Flomo 使用说明](https://ywhome.feishu.cn/wiki/JzzLwuVGZiJSIBkUhLbc2Mbwnwg) 由bot创建，正文revision `3`；[系统使用知识库导航首页](https://ywhome.feishu.cn/docx/MTsddNDzlohg8qx0cgYcnvunnad) 已插入入口并读回revision `16`。新说明覆盖同步命令、最多10条容差与完整性门禁、失败回退、每日缓存及可观察校验。仓库 [README](../../../README.md) 核心资产索引也已添加该Wiki链接。外部写后读回确认新文档位于“系统使用知识库 / 导航首页”下；本次外部写入身份为bot。

## 逐条需求结论与证据

判定以新方案的 M0–M4 和 ACC1–ACC8 为准；旧版「历史归档＋周新增」验收保存在[旧报告](acceptance-2026-10-08.md)。

| 验收项 | 结论 | 证据与边界 |
|---|---|---|
| M0 文档保存 | 达成 | Requirement、Execution Plan 与 Case 已保存并互相链接；原始方案说明附件仅作背景。原有 6 个 Flomo 回顾工作文件未被清理、reset 或覆盖重建；其中 `review.test.mjs` 为新来源 URL 与标题契约做了局部 fixture/断言适配（详见 Case），其余 5 个现有 diff 保留。见 Requirement「2026-10-09｜线上全量快照方案与实施授权」及 Case。 |
| M1 真实全量路径 | 达成 | 951个独立 memo，枚举950个、缺1个；分页稳定终态、逐条ID/正文/链接、最长TipTap及普通/置顶样本通过，暂存哈希包读回一致。见 [Case M1 记录](case.md)。 |
| ACC1 完整同步、预览并打开真实链接 | 达成 | 线上快照950条已激活；M1 中同一暂存包的快照、Card 2.0、Markdown 预览一致，实际打开最长、普通和置顶原文链接并核对正文。 |
| ACC2 编辑后的内容与质量失效 | 部分验证 | 合成测试覆盖同ID正文变化使评分失效；尚未等待自然周同步后的真实编辑反映。 |
| ACC3 删除/排除后的候选退出且历史可解释 | 部分验证 | 合成测试覆盖删除退出、排除身份保留和同文去重；真实线上删除/标签变化未执行。历史账本保留5批。 |
| ACC4 完整性异常拒绝替换快照 | 部分验证 | M1 实际接受950/951并记录缺口；当前阈值最多10条。对抗测试覆盖缺ID、遗漏超过10条、分页/尾部loader、正文冲突和快照拒绝替换。尚未用真实故障破坏已激活快照。 |
| ACC5 10分钟重试、单扫描及迟到提交保护 | 部分验证 | 单测覆盖10分钟冷却、服务端更长等待、单浏览器队列和令牌重核；本轮新增 review store lock 与 attempt guard 共用锁的 recovery 反例用例，修复前失败、修复后通过。W41自然运行实测一次 `network-transient` 后等待到预定时间并串行发起第二次扫描；随后 `source-contract-mismatch` 停止重试。真实日常卡片仍未发送。 |
| ACC6 失败后旧快照回退并标时间、周输入门禁 | 部分验证 | W40手动运行曾保留旧周文件；W41自然运行在旧阈值下记录`failed`，当周此前没有旧文件。用户将漏项阈值提高至最多10条后，W41由已验证950/951快照发布9条并读回`ready`。每日缓存时间和旧快照回退仍缺一次真实生成卡片读回。 |
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

截至08:45的既有基线为 `rtk npm run test:flomo:review` 147/147、`rtk npm test` 520/520；当时的W41周输入状态为`failed`。本轮后的准确状态见下方“本轮新鲜测试与并发复核”。

## 本轮新鲜测试与并发复核｜2026-10-12（Asia/Shanghai）

- `rtk npm test -- --test-reporter=dot`：535/535通过。
- `rtk npm run test:flomo:review`：148/148通过，包含Card读回拒绝非`interactive`类型。
- 独立只读测试：Flomo采集、快照、周同步、Review、重试和AI回顾243/243；Process Pack 17/17。
- 同一独立测试者对本轮用法文档做窄范围复核，未发现阈值、快照缓存或命令定义冲突；Review复跑148/148通过。
- 新增 attempt-token 恢复反例：第一次在旧实现上未拦截 recovery，修复后锁内反例通过；与既有跨周全局浏览器队列测试合并复跑为2/2通过。
- 6个相关运行模块 `node --check` 全部退出0；Review Skill `quick_validate.py` 与 `rtk git diff --check` 均通过。
- 测试只使用本地合成数据；未重新扫描Flomo、发送消息、修改线上笔记或更新自动化。独立审查未发现新的P0/P1或高价值缺陷。

## 关键架构约束与重大回归状态

- **符合：**Flomo 线上笔记未被修改；M2 只更换本机私有快照源。真实扫描有界缺口1/951并明确记录，覆盖率99.89485%，不宣称无缺口。
- **符合：**新全量快照以真实 memo ID 绑定原文 URL；M1 真实采集已在原文页面打开最长笔记，并通过 TipTap/ProseMirror 完整正文校验；普通与置顶原文链接也通过。合成测试另覆盖相同类型的失败关闭边界。
- **已接线：**私有线上快照、按版本激活、周重试与每日缓存读取均已接入；手动运行与周一自然运行的日快照可读回。自然W41扫描当时按旧阈值失败且没有旧文件；阈值改为最多10条后，由同一快照发布9条并读回`ready`。真实旧缓存生成卡片尚未验证。Architecture Truth 待剩余实际验收达到门槛后再决定是否更新。
- **数据状态：**active snapshot含950条记录、预期951、缺口1。catalog 771条候选均有 memo ID 与真实 URL、均有当前正文哈希有效的评分，495条达到评分门槛。历史 Markdown 缺ID记录留在原库和备份，不作为候选；ledger保留5个已送达批次。
- **回归：**数量策略已统一为5–10条、目标与整体平均7–8条；独立审计覆盖8条准入、11条拒绝及重复评分幂等。当前协调者全仓535/535、Review148/148；独立Flomo相关套件243/243、Process Pack 17/17。所有原有脏文件保留。

## 待验收事项与必要人工项

计数语义已由用户确认：侧栏951是当前独立memo总数，遗漏最多10条可接受；当前快照950/951、缺口1。M2有771条候选、495条达到候选门槛；未手动发送。M3手动及周一自然运行更新日快照；周一自然运行曾在旧3条阈值下失败，随后W41从已验证快照发布9条并读回`ready`。协调者全仓测试535/535、Review148/148，独立Flomo测试243/243、Process Pack 17/17通过；ywuse页面和导航读回已完成。真实线上编辑/删除、失败后真实使用旧快照生成卡片、消息发送和active store回滚未执行。

## 最终三态与时间

**部分达成（PARTIAL）｜更新至 2026-10-12（Asia/Shanghai）。**M0/M1达成；M2旧库备份、线上快照激活、771条评分及495条合格有读回证据，5个历史送达批次保留。M3实现、手动及周一自然全量路径已运行；用户裁定遗漏最多10条后，W41从950/951快照发布9条并读回`ready`。协调者全仓535/535、Review148/148，独立Flomo相关测试243/243及Process Pack 17/17通过；Usage Truth页面、导航与README入口完成读回。真实消息E2E、线上编辑/删除、旧缓存卡片回退及active store回滚仍未验证。本轮没有发送消息或修改线上Flomo。

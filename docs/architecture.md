# Architecture Truth｜Learn-X

> 回答「系统现在真实是什么样」。由技术架构与规划节点在架构变化时增量维护。首次建立：2026-09-24（Case：[wechat-evidence-source](cases/wechat-evidence-source/case.md)）。最后核对：2026-09-26（Case：[weread-highlights](cases/weread-highlights/case.md)）。

## 定位

Learn-X 是个人 AI native 知行进化系统：输入（证据与反馈）→ 处理（Process Pack / AI Chat）→ 输出（周/月/年 Output）→ 人工判断 → Memory / 道 / 法 / 术 → 行动反馈。人负责最终价值判断，脚本做确定性整理；只有人工确认后的内容才进入长期认知资产。

## 分层与数据流（当前真实状态）

```text
03_input/weekly/YYYY-Www/          每周扁平输入目录：各来源单文件（daily/flomo/weread/jingdu/…/wechat.md）+ _source-status.json 侧车
        ↓ collect-weekly-input.mjs 按来源状态过滤，聚合成 input.json
04_output/_dist/weekly/YYYY-Www/   中间材料：input.json / Process Pack
        ↓ AI Chat（人工触发）
04_output/weekly|monthly|yearly/   人读 Output
        ↓ 人工确认
01_core/memory/ · 01_core/道/ · 01_core/法/   长期认知资产（Memory 需人工确认）

05_library/weread/                 WeRead 存量划线全量归档（ADR 0002）：fiction/ 与 nonfiction/ 按年一文件（书整本归入划线最多年份，不劈开）
                                   + _index.md（按年列书目索引）+ _manifest.json
        ↳ collect-weread-archive.mjs 每周全量重建幂等覆盖；Chat Pack 上下文树按年勾选，公开构建排除，随周备份
```

- 来源状态契约（`learn-x-input/scripts/lib/source-status.mjs`）：每来源一个状态（`ready/empty/needs_review/failed/unavailable`）＋规范文件名（`SOURCE_FILES`，wechat → `wechat.md`、jingdu → `jingdu.md`）。消费方按状态过滤输入文件。
- 周自动化（`learn-x-weekly-automation`）：阶段 1 采集自动来源并生成草稿 → 用户口令「周记已确认」进阶段 2 生成 `_dist` → 「继续」进阶段 3 验证后写 Memory。`jingdu.md` 由外部 Code X 精读自动化在飞书交互后按外部拥有者模式写回（写文件 + `npm run input:source-status`），阶段 1/2 清单已纳入，缺失或 empty 不阻塞但提示缺口。
- 备份（`learn-x-process/scripts/backup-weekly.mjs`）：`BACKUP_ROOTS = ["01_core", "03_input", "04_output", "05_library"]` 整目录上传飞书云空间并存快照索引；restore 按 manifest.roots 子集校验（兼容旧 3 根归档）。
- 现有微信入口（`wechat-weekly-input`）：仅人工截图转临时 JSON，追加为 `WeChat.md`（大写），不读取微信本体。

## 关键资产（本仓库入口）

- `docs/requirements/`、`docs/adr/`、`docs/cases/`：长期真值与 Case 链（见 AGENTS.md「长期真值文档地图」）。
- `.agents/skills/`：可复用工作流（input / process / weekly·monthly·automation / journal 等），脚本即流程真值。
- `02_prompts/`、`00_config/`：Prompt 与 Chat Pack 资产。
- `app/code/`：Chat Pack 与本地应用代码（边界见 `docs/TECH.md`）。

## 外部依赖

飞书（文档 / Base / 云空间备份 / 日历，统一走 `lark-cli`）、Flomo（Ego Lite 只读页面）、微信读书（Agent Gateway `i.weread.qq.com/api/agent/gateway`，skill_version 1.0.4，Key 从 Keychain `learn-x-weread-api-key` 读取；周度 `weread.md` 采集与存量归档 `collect-weread-archive.mjs` 均走此通道，实测 198 书全量拉取约 3 分钟、零限流）、Time-X 日历、Voice-X、AI Coach Base。**新增（PoC 评审中，未接入）**：TraceMemo 2.4.0 本机微信证据查询——经共享 `wechat-evidence` 只读适配器供各 Agent 查询；Learn-X 仅消费其派生的 `WeChat.md`。

## 已知边界

1. **文件名大小写冲突**：`wechat-weekly-input` 写 `WeChat.md`，来源状态契约为 `wechat.md`；失败状态过滤按 basename 匹配，旧截图文件可绕过按文件名执行的失败状态排除。
2. **未登记文件直接进入 Process Pack**：`filterFilesBySourceStatus` 只排除「已登记且非 ready」的文件；无状态条目的新文件（如新生成器写的 `WeChat.md`）会全量进入周输入。
3. **备份整目录上传**：周备份把整个 `03_input` 上传云端；待审（`needs_review`）微信内容若不做校验会随备份外发，需在消费与备份两侧同时校验状态与哈希。
4. **单文件输入上限**：周输入单文件超过上限（当前 15,000 字符）即停止生成 Process Pack，需人工压缩——微信派生材料必须报告省略量而非静默截断。
5. 微信 Evidence Source 的覆盖与新鲜度边界见 [ADR 0001](adr/0001-wechat-evidence-freshness-coverage.md)：绝对覆盖保持「未证实」。

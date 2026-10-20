# Architecture Truth｜Learn-X

> 回答「系统现在真实是什么样」。由技术架构与规划节点在架构变化时增量维护。首次建立：2026-09-24（Case：[wechat-evidence-source](cases/wechat-evidence-source/case.md)）。最后核对：2026-10-20（Case：[Chat Pack 提速与缓存状态改造](cases/2026-10-chatpack-cache-performance/case.md)）。

## 定位

Learn-X 是个人 AI native 知行进化系统：输入（证据与反馈）→ 处理（Process Pack / AI Chat）→ 输出（周/月/年 Output）→ 人工判断 → 周期 Memory 与候选 → 行动反馈。正式道法唯一真源为飞书 Core《道》《法》；候选须由用户明确确认后才可进入正文。

## 分层与数据流（当前真实状态）

```text
03_input/weekly/YYYY-Www/          每周扁平输入目录：各来源单文件（daily/flomo/weread/jingdu/…/wechat.md）+ _source-status.json 侧车
        ↓ collect-weekly-input.mjs 按来源状态过滤，聚合成 input.json
04_output/_dist/weekly/YYYY-Www/   中间材料：input.json / Process Pack
        ↓ AI Chat（人工触发）
04_output/weekly|monthly|yearly/   人读 Output
        ↓ 人工确认
01_core/memory/                      Learn-X 周期记忆（需人工确认）
飞书 Core《道》《法》                 正式道法唯一真源（Learn-X 只读实时消费）

05_library/weread/                 WeRead 存量划线全量归档（ADR 0002）：fiction/ 与 nonfiction/ 按年一文件（书整本归入划线最多年份，不劈开）
                                   + _index.md（按年列书目索引）+ _manifest.json
        ↳ collect-weread-archive.mjs 每周全量重建幂等覆盖；Chat Pack 上下文树按年勾选，公开构建排除，随周备份
```

- 来源状态契约（`learn-x-input/scripts/lib/source-status.mjs`）：每来源一个状态（`ready/empty/needs_review/failed/unavailable`）＋规范文件名（`SOURCE_FILES`，wechat → `wechat.md`、jingdu → `jingdu.md`）。消费方按状态过滤输入文件。
- 周自动化（`learn-x-weekly-automation`）：05:00运行有界重试与预处理；第一层针对瞬态错误每来源最多一次简单重试，第二层核对既有产物、日期、版本与任务回执并执行安全的已知恢复，第三层只在一手根因、独立审查、共同截止时间和原失败/反例回归均通过时应用受控小补丁。`recovery-patch-guard.mjs` 限制补丁范围并在并发改动时保留现场。07:00补查不清零05:00次数；执行预算统一为100分钟，CLI最多3路并行、浏览器单队列。周诊断写状态侧车；Skill 本地 `state/recovery-incidents.jsonl` 是问题事件真源，`recovery-playbook.json` 可重建，记录失败、恢复和人工修复证据，不保存私人正文、Prompt、凭据或任意命令。每个新 AI run 预先持久化 UUID 并透传到共享 Bridge；中断后只观察绑定的原 run，旧记录缺少稳定 ID 时不猜测归属。Codex Build 续跑收据绑定自动化线程、宿主和目标 ISO 周，续跑机会原子限制为一次；收据目录逐级拒绝符号链接并校验真实路径仍位于仓库内。共享 Bridge 的 Learn-X 短时结果收据只有在 task space 清理确认后才标记可恢复；清理失败保留未确认结果和有界租约，`observe` 重试清理成功后才返回成功，收据写入失败会单独暴露状态。该 Bridge 行为已实现并通过隔离定向测试，部署与真实运行尚未验证。Process Pack 中确认周记与有效日记是硬门槛；补充来源缺失或未验证时排除正文并可生成带缺口状态的 Pack。采集快照记录原始文件哈希，预处理缓存绑定来源哈希、generation、采集器和规则版本；过期采集候选不能覆盖更新输入。确认周记后，`input:weekly`按已保存飞书段落锚点窄范围采回，`process:weekly`复用有效缓存快速组装，不压缩周记；明确的采集子进程失败优先于 sidecar 成功状态。交付时同条消息附不含记忆内容、也不构成授权的收尾范围预览；Chat Pack完成后阶段3生成真实Memory候选并与完整执行范围合成一次确认卡。`jingdu.md` 由外部 Code X 精读自动化在飞书交互后按外部拥有者模式写回（写文件 + `npm run input:source-status`），缺失或 empty 不阻断但提示缺口。
- 本地 Chat Pack 将登记 Prompt 与正式 Core《道》《法》逐项缓存到 Git 忽略的 `app/code/.local/chatpack-cache/cache.json`，每项按真实成功读取时间计算 14 天有效期。服务启动、每日、生成和手动刷新通过原子文件锁合并跨进程请求、优先级与最多两个并行读取；成功全量刷新后适用 60 秒节流，全失败或部分失败后允许下一请求立即重试，失败后不自动循环重试。未确认 owner 的新鲜遗留锁会显示为恢复等待，无法安全恢复时明确失败。状态分别呈现缓存有效性和后台刷新结果，前端状态查询有 8 秒期限并合并在途请求，手动刷新有 10 秒期限并恢复超时按钮。生成只读取完整有效的必需资源集合，缺失、过期或校验失败时等待更新，失败后停止交付。缓存目录及 `.local` 缓存根拒绝符号链接，避免缓存写出预期运行目录。公开静态构建不读取或打包本地缓存；共享 Prompt/Core 读取器与其他自动化仍按原实时规则运行。
- Health-X 周报导出有独立 `report --export-learn-x --week YYYY-Www` 路径：从目标周日输入生成本地报告、校验目标周与结构后不覆盖写入 Learn-X；该路径不调用 Health Base 同步。Learn-X 采集入口和 Health-X 导出器逐级核验周目录、拒绝符号链接及越界真实路径；采集器回读并校验目标文件后更新来源状态。Health Base 的读取与同步不在这条路径中。
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
4. **单文件输入上限**：普通输入的 15,000 字符限制由预处理候选控制；超限候选不能进入 Pack，合格的可选来源可明确排除。确认版 `weekly.md` 完整纳入且不压缩；Voice-X按独立压缩规则处理。
5. 微信 Evidence Source 的覆盖与新鲜度边界见 [ADR 0001](adr/0001-wechat-evidence-freshness-coverage.md)：绝对覆盖保持「未证实」。

周记自动端到端模拟连续3次通过（虚拟时钟模拟20分钟冷却）；修复后的全仓 `npm test` 460/460、两个相关 Skill 校验及独立定向对抗回归102/102已通过。模拟周流程的测试体约86–189毫秒，不代表真实外部服务等待或周记交付时间。真实飞书锚点读回、Ego Lite全量Flomo扫描、05/07本机任务实际唤醒、一分钟正常交付、收尾外部读回和连续三周用户参与时间仍需运行证据。

## Flomo 每日回顾

- Flomo 历史来源仍由周度 Ego Lite 采集写入 `03_input/weekly/YYYY-Www/flomo.md`；每周来源状态通过完整性门禁后，周自动化 Skill 调用 `npm run flomo:review -- archive` 更新私有累计目录 `03_input/_archives/flomo/catalog.json`。线上全量快照路径可用同一分钟加去空白正文唯一匹配从 legacy catalog 回填换行，歧义或正文变化不回填；它代表已知历史归档加可信增量，仍不代表远端全量或历史编辑同步。
- `.agents/skills/learn-x-flomo-review` 从最近周/月 Output、实时正式《道》、活跃 Memory 与个人理解材料构建上下文；模型以7–8条为常规目标选择高质量回顾候选，单次允许5–10条，质量不足时按缺口说明原因。Node 校验原文哈希、身份、质量分≥3、同周零重复、滚动四周重叠与重复预算；卡片标题保留原文标点，正文按实际换行和列表渲染。入选原文与反馈只写私有 `_dist`，不自动改写 Core、Memory、道或 Flomo。
- 新交付使用单条 Feishu post 并附当日完整 Markdown。发送前核验 bot、接收成员、profile 与频率；上传key与消息附件key分开保存；发送后读回正文及下载附件字节SHA。`needs_review`只读恢复，不自动重发。2026-10-06 有一批真实3条回顾完成消息和附件读回。
- 当前本地目录646条，其中504条质量分≥3且正文哈希仍有效；远端全量覆盖未证实。以2026-10-12为起点的7日与28日容量模拟均可行，分别要求至少35与130条合格独立笔记。
- 原生本地自动化`learn-x-flomo-20-00`已启用，按UTC 12:00调度（Asia/Shanghai 20:00），指向Learn-X项目；创建时实时成员与发送频率预检通过。首次定时唤醒和实际5–8条发送尚未观察。
- 首个完整自然周的连续送达、5–8条推荐质量和真人反馈仍待未来真实运行观察；已启用自动化的首次唤醒尚未发生，因此不得将配置成功等同于端到端验收完成。

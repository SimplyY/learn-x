# Deep Acceptance｜LearnX 统一阅读沉淀与 ChatGPT 精读

- 日期：2026-11-03
- 工程结论：**部分达成**
- 核心链路实走：**飞书 Web UI → Bridge 自动路由 → 官方 WeRead 最近三天采集 → 本地去重读回 → 飞书阅读文档 → GitHub main 索引/书目读回 → ChatGPT 实际精读。远端读取已验证；例行同步仍未验证。**
- 范围：真实 WeRead、伴读包和飞书交付已完成；本轮补做 GitHub 两文件的授权发布及读回，并用 ChatGPT 当前对话按固定索引读取、分析。实体书视觉识别按用户最新指示暂缓。真实阅读记录修改/撤销写回及月记受治理 Prompt 更新仍未完成。
- 环境：Learn-X 本地工作树有并行未提交变更；仅两份公开阅读文件通过隔离暂存审查后写入 GitHub main。书目提交 2ec4d3cd25f45d9e2601d159472b0c49fd436081，索引提交/main 头 dba6d1e31e71031d7ef4e995d287949f9c879b28；远端 Blob 与本地 git hash-object 一致。未运行整仓 neatall、未更新本地 Git 分支、未写 Flomo。

## 这次开发了什么

- 新增 WeRead 最近三天和指定范围采集，保留稳定来源 ID、实际范围、分页完整性与部分失败状态。
- 新增按书保存器，支持本地去重、可靠内容公开、私有/待复核隔离、写后读回、修改、撤销和失败恢复；不操作 Git。
- 修复历史范围遗漏：书籍最近笔记时间晚于所查结束日时仍检查该书的具体记录；缺失书名、无效笔记时间和无效 notebook 排序时间不再静默成功。
- 修复保存边界：拒绝阅读输出路径中的符号链接和仓库外路径；同批同来源重复内容折叠，来源身份冲突则停止。
- 已跑通离线合成贯通：模拟 WeRead API 给出 1 条划线和 1 条个人想法，经采集映射和本地保存后得到 2 条记录，公开文件读回成功、伴读包可用。纯个人想法不会伪造作者内容；已保存来源 ID 回放或 pending 重试更换条目/伴读包内容都会停止。
- 原始 WeRead 来源正文现在以稳定私有指纹参与重采判断。相同来源的重采保留用户修改，原始来源变化则停止；空正文记录令范围采集 `complete:false` 并报告不可用数。修改/撤销回执包含新伴读包私有路径并通过读回。
- Skill 路由已支持 `修改 <recordId>` / `撤销 <recordId>` 文本命令。当前没有已验证的签名回调路由证据，因此不显示修改按钮。
- 完成批次重放回归覆盖：重新生成的伴读包不会覆盖首次已交付版本；完成收据与残留 pending 并存时仍复用已读回包；复用同一批次 ID 但换来源会拒绝。
- 修改/撤销 Skill 增加飞书记录的按 ID 定位、当前 revision 门禁、局部区块更新及读回规则；真实 Docx 只读查询证明 recordId 能唯一定位，但没有实际修改真实书籍文档。
- 已配置 Learn-X WeRead 文本路由，新增 ChatGPT 每周精读 Prompt、GitHub 读取说明和周三提醒文案。
- 本地旧 `jingdu` 消费路径受保护，周日 `learn-x-3` 自动化已暂停并读回。历史文件保留。
- 真实运行：最近三天采集器两次取得完整结果，累计取得 1 本书、10 条划线、0 条个人想法；两批各精选 5 条，第二批对前批 5 条去重后新增另外 5 条。最终按书文件含 10 个唯一来源 ID，本地读回通过。
- 飞书阅读文档由 Bot 创建、当前用户获 full_access，并以用户身份读回；自动触发后 revision 4 包含两批共 10 条记录、范围、伴读 Prompt 和修改说明。之后 Bot 以 revision 4 为基准，仅替换 GitHub 状态段，更新到 revision 5；再次按关键词读回，内容与写入一致。结果卡自动发送并读回核对成功。
- 第一次真实触发遇到 MoonBridge 本地模型预检失败，曾由 Codex 手动接续；随后第二次真实触发经 Bridge 自动运行阅读 Skill 并完成交付。故自动路由现有一次成功实走，但首次失败的具体根因仍未定位。

## 最小真实验收指南

**本轮飞书 UI 实走状态：已通过（无新增分支）。** 用户授权后，在 Ego Lite 任务空间 7 打开已登录的飞书消息页，进入 Learn-X 群并发送一次“整理最近 3 天微信读书划线和想法”。界面读回了用户消息、Bridge command_execution 和完成回复。Mac 原生应用仍处于锁屏状态，但不影响本次已验证的 Ego Lite Web UI 操作。

### 飞书 UI 路径（本轮已完成：无新增分支）

1. 目标：从 Learn-X 群的真实用户入口触发 WeRead 整理，并观察本次真实处理结果。
2. 实际操作：在任务空间 7 的飞书 Web 消息页确认目标会话为 Learn-X 群；发送“整理最近 3 天微信读书划线和想法”一次；界面读回已发送消息与 Bridge 自动响应。
3. 当前结果：Bridge 启动 command_execution 后回复“已整理过：这 3 天没有新增内容”。最新范围快照读回为 Asia/Shanghai 2026-11-01 00:00:00 至 2026-11-03 19:55:21，完整取得 1 本书、10 条划线、0 条个人想法、0 个错误。
4. 去重核对：最新快照的 10 个来源 ID 与本地状态 10 个来源 ID 全部重合，新增 0；本地仍是 10 个唯一记录。没有创建新批次收据、改写阅读条目或产生第二张结果卡。旧结果卡与同书阅读文档/伴读包仍可查看。
5. 另行局部写回：根据远端检查结果，使用 `lark-cli docs +update --command block_replace --as bot` 替换阅读文档的单个保存状态段；基准 revision 4，返回成功并前进至 revision 5。随后以 Bot 身份按关键词 fetch，读回文本完全匹配，revision 为 5。
6. 结果边界：真实 UI 路径验证了自动触发、Bridge 运行、官方 WeRead 范围采集、范围快照读回和幂等分支；单独的状态区块写入验证了 Bot 在此 Docx 上的局部写回与读回。这不等于真实阅读记录修改/撤销链路已验收。

### WeRead 路径（两次真实触发；第二次自动 Bridge 路由通过）

1. 目标：验证真实采集、沉淀、伴读包和飞书交付。
2. 实际入口：Learn-X 飞书群；当前已验证用户发送单条原始文本消息，并通过消息列表读回确认。
3. 实际操作：发送“整理最近 3 天微信读书划线和想法”。
4. 第一次请求范围为 Asia/Shanghai 2026-11-01 00:00:00 至 2026-11-03 17:30:53；完整取得 1 本书、10 条划线、0 条个人想法，精选并保存 5 条。该次群触发遇到 MoonBridge 预检失败，由 Codex 手动接续；手动重跑新增 0、重复 5。
5. 第二次请求在 17:57 由同一已验证用户发送（消息 ID `om_x100b61aeb00d14a8df8ff8552c0fbc4`），Bridge 自动启动 Skill。自动结果卡（消息 ID `om_x100b61af575f58a8df7a6a10fc3b91b`）报告采集完整、取得 10 条划线和 0 条想法、精选新增 5 条并去重 5 条；本批截至 17:57:55。自动流程无需 Codex 手动接续。
6. 两批合并后的飞书阅读文档 revision 4 由当前用户身份读回，含 10 个唯一记录 ID、两批范围及伴读 Prompt；本地按书文件和索引读回一致。手机 UI 未实测。
7. GitHub 未有实际远端提交及读取证据，因此没有显示“GitHub 已同步”。

### ChatGPT 精读路径（GitHub 远端读取未验收）

本批伴读包已包含在[本次飞书阅读文档](https://ywhome.feishu.cn/docx/WMzwdSLIVoYfLrx04Qwcv3Bancf)中，可直接复制给 ChatGPT。2026-11-03 的只读 GitHub connector 检查确认仓库可访问（README 可读，返回默认分支 `master`；分支清单含 `main`、`master`），但固定 `main` 路径 `05_library/reading/_index.md` 和本书 Markdown 均返回 API 404；默认分支上的同两路径也返回 404。因此本地/飞书伴读包可用，GitHub 上当前尚无可读的新阅读上下文；本次没有验证 ChatGPT 从 GitHub 读取。Flomo 建议由用户自行判断和记录。

## 关键异常

- **受治理月记 Prompt 未更新：** 用户充分授权后，本轮确认线上仍为 revision 3 / SHA-256 `6549cf26d0bda5be9b663eaa64365b52508a6108c4fbad1bdf7e59e44842b045`，官方 publisher 以 base revision 3 尝试一次仍返回 `unstructured_cli_error`，publisher 只读读回确认 unchanged，未再重试。候选仅移除旧 `jingdu.md` 消费规则（3 行新增、6 行删除）。开发者控制台确认应用已开通 `docx:document:write_only`，Bot 对阅读 Docx 的局部 `block_replace` 成功并读回；publisher 的 dry-run 指向 `/open-apis/docs_ai/v1/documents/...`，与普通 Docx 更新链路不同。当前证据排除“Bot 完全没有 Docx 写权限”，但不能证明治理 Wiki 的发布接口所需 scope；精确失败点仍未知。候选未发布，月记流程继续 fail closed。
- **飞书修改链路仍有缺口：** 本轮没有新增 WeRead 记录；真实阅读记录修改/撤销仍需单独验收。独立状态区块已成功通过 Bot 局部写回和 revision 5 读回。
- **WeRead 网络验证：** 用户要求开放 `*.qq.com` 后，本轮在授权的网络执行环境直接运行官方范围采集器，取得 Asia/Shanghai 2026-11-01 00:00:00 至 2026-11-03 20:23:45 的完整数据：1 本书、10 条划线、0 条想法、0 错误；本地核对 10/10 来源已存在，新增 0。该次读到的正文只写入 `.runtime/reading/weread-range-latest.json`，权限 0600。较早 workspace-write HEAD 的 403 不再代表这次授权执行结果。
- **远端读取仍有缺口：** 只读 GitHub 查询确认固定索引及本书文件在 `main` 和默认 `master` 路径均返回 404；真实 WeRead 和本地/飞书读回已完成。ChatGPT 本轮按飞书界面读回的伴读包与本地公开记录完成材料分析；这不是 GitHub 远端读取验收。
- **实体书部分：** 用户要求本轮跳过照片和视觉标记识别；不影响 WeRead 本地工作的验证，但相关产品需求仍未实现。
- **较大 Process Pack 基线：** 扩大测试 17/19；两项既有文本契约失败在本 Case 实施前已存在，本轮未修改或跳过。

## 以后怎么用（Usage Truth）

- 飞书使用说明：[Learn-X 阅读沉淀与 ChatGPT 精读使用说明](https://ywhome.feishu.cn/docx/HQL8dxOGuoacHUxAhvPcQ770nfh)。Bot 创建后由当前用户读回 revision 3；本次实走后 Bot 更新至 revision 5，再由当前用户读回核实自动触发成功及剩余边界。系统使用知识库导航页更新至 revision 23 并确认入口存在；README 核心资产区也已添加链接。
- WeRead 当前配置入口：Learn-X 群中由已验证用户发送单条文本请求；2026-11-03 已由 Bridge 自动触发并完成一次真实采集交付。首次 MoonBridge 预检失败原因仍未知；手机 UI 与真实修改/撤销交互未验收。
- ChatGPT Prompt、GitHub 阅读索引读取方式、伴读包回退规则及周三 08:30 提醒文案见 [docs/CHATGPT_READING.md](../../CHATGPT_READING.md)。提醒由用户自行配置；本轮没有创建自动化。
- 每次精读后用户自行选择是否手写或语音记录 Flomo，系统不自动发布。

## 工程追溯

| 验收 | 需求 | 结论与本轮证据 |
|---|---|---|
| ACC1 | R1、R2 实体书 | 按用户指示暂缓，未验收。 |
| ACC2 | R1、R2 WeRead 范围与提炼 | 两批真实 API 结果各完整取得 1 本书、10 条划线、0 条个人想法；每批精选 5 条并保留章节/日期/来源，报告取得与新增/去重数量，没有把精选冒充全量。 |
| ACC3 | R3 去重与读回 | 两批最终保存 10 个唯一来源 ID；第二批识别 5 条重复并新增 5 条，文件与索引读回一致，没有原始划线。 |
| ACC4 | R3 非公开隔离 | 私有与待复核条目不进入公开 Markdown/索引的隔离测试通过；真实内容未写入。 |
| ACC5 | R4、R5 伴读包与结果卡 | 飞书 Docx 的两批伴读包由 Bot 创建并授予当前用户 full_access；用户读回 revision 4。此后 Bot 对保存状态区块进行局部写回并读回 revision 5。此前自动结果卡已发送并读回；手机 UI 未实测。 |
| ACC6 | R5 修改 | 本地版本比较、过期修改拒绝、撤销、修改后伴读包读回及用户想法修改测试通过；结果卡提供文字命令。真实阅读记录可按 recordId 唯一定位，Bot 局部写回能力已用状态区块验证；真实记录修改/撤销仍未实测。 |
| ACC7 | R6、R7 ChatGPT / Flomo | 本轮从 GitHub main 固定索引实际读取一书第一章 10 条精选（2026-11-01 至 2026-11-03），完成精读并给出 4 个有依据的 Flomo 方向；没有 Flomo 自动写入。用户质量反馈未收集，例行同步到 main 仍未验证。 |
| ACC8 | R8 旧流程退役 | 周/月本地输入过滤及旧编排回归通过；`learn-x-3` 暂停并读回；最新受治理月记 Prompt 仍未更新。 |

本轮定向命令与结果：

| 验证 | 命令 | 结果 |
|---|---|---:|
| 范围采集与本地保存 | `rtk node --test .agents/skills/learn-x-reading/scripts/*.test.mjs .agents/skills/learn-x-input/scripts/collect-weread-range.test.mjs` | 23/23 通过 |
| 离线采集到保存贯通 | `rtk node --test .agents/skills/learn-x-reading/scripts/reading-flow.integration.test.mjs` | 1/1 通过（合成数据） |
| 原 WeRead 周采集兼容 | `rtk node --test .agents/skills/learn-x-input/scripts/collect-weread-weekly.test.mjs` | 7/7 通过 |
| 来源状态与周输入 | `rtk node --test .agents/skills/learn-x-input/scripts/source-status.test.mjs .agents/skills/learn-x-process/scripts/collect-weekly-input.test.mjs` | 25/25 通过 |
| 月度 Process | `rtk node --test .agents/skills/learn-x-process/scripts/monthly-process-input.test.mjs` | 19/19 通过 |
| 旧精读编排 | `rtk node --test .agents/skills/learn-x-jingdu-review/scripts/orchestration.test.mjs` | 9/9 通过 |
| WeRead、来源状态、周/月 Process 与旧精读合并回归 | `rtk node --test .agents/skills/learn-x-input/scripts/collect-weread-weekly.test.mjs .agents/skills/learn-x-input/scripts/source-status.test.mjs .agents/skills/learn-x-process/scripts/collect-weekly-input.test.mjs .agents/skills/learn-x-process/scripts/monthly-process-input.test.mjs .agents/skills/learn-x-jingdu-review/scripts/orchestration.test.mjs` | 60/60 通过 |
| 完成批次重放（新增伴读包重算、残留 pending 与错用 batchId） | 覆盖于 `store-reading.test.mjs` 的 source replay 用例 | 通过 |
| Skill 格式 | `rtk python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-input` 和 `... .agents/skills/learn-x-reading` | 均显示 `Skill is valid!` |
| Diff 空白检查 | `git diff --check` | 通过，无输出 |

代码测试使用隔离临时目录；既有真实批次沉淀 10 条去重后的精炼公开文本及私有收据，飞书文档/结果卡有读回证据。本轮 GitHub 两个目标文件通过隔离安全扫描并完成远端读回；ChatGPT 读取 main 上的实际内容，范围为第一章、2026-11-01 至 2026-11-03、10 条精选、0 条个人想法。整体仍部分达成：真实修改/撤销和月记 Prompt publisher 未完成；例行同步存在 main/master 分支错位与 neatall 整仓敏感路径阻塞。用户暂缓实体书图片识别。

## 后续验收｜GitHub 远端阅读与 ChatGPT 精读（2026-11-03）

### 实走状态：成功（单本 ChatGPT 精读）

1. **目标：** 验证 ChatGPT 可以从真实公开 LearnX 入口取回新阅读材料，并按 Prompt B 的边界说明实际范围、开展分析及提出 Flomo 方向。
2. **入口与动作：** 在本 ChatGPT 对话中从固定索引 https://github.com/SimplyY/learn-x/blob/main/05_library/reading/_index.md 开始；读取索引链接的书目文件，再基于其正文回答。
3. **远端证据：** main 当前头提交为 dba6d1e31e71031d7ef4e995d287949f9c879b28；书目文件 Blob SHA 为 f2ada0587c1a1242642d397b892d33a44355d582，索引 Blob SHA 为 2341ed4c225d5c9cd69d1adcdb462b201ed1812b；两者与本地文件 hash-object 一致。书目先于索引落地并分别读回。
4. **实际范围：** 《智人之上 ——从石器时代到 AI 时代的信息网络简史》第一章“信息是什么？”，2026-11-01 至 2026-11-03，10 条微信读书精选，0 条用户想法。分析区分了作者内容、材料支持的归纳和 AI 推断，没有声称读取本地未推送内容。
5. **本次输出的四个 Flomo 思考方向：** 真实性与动员力分开评估；真实叙述如何被框架和遗漏塑形；适应性是否被误当作真理；信息如何在描述世界时也塑造世界。没有自动写入 Flomo。

### 关键异常与未完成项

- 这是用户明确授权后针对两个文件的 GitHub Contents API 一次性发布，完成远端读回；不代表既有 05:00 neatall 链已成功。
- 本地 master 跟踪 origin/master，但固定 ChatGPT 索引位于 main。当前 neatall 对未跟踪路径 parse-session.mjs 命中敏感文件名规则会跳过整仓；工作树还有用户并行未提交内容，故没有运行整仓提交。例行同步和未来新记录进入 ChatGPT 固定分支仍未验。
- ACC6 的真实记录修改/撤销写回、月记受治理 Prompt publisher 修复与发布仍未完成。实体书照片识别暂缓；周三提醒由用户配置；Flomo 不自动写入。

### 最小真实验收指南

当前远端单本读取已通过。用户可在 ChatGPT 对话中要求：“基于 LearnX 阅读索引精读《智人之上》第一章”，并核对回复是否说明读取文件、提交版本、章节和日期；若新材料尚未同步，使用飞书本次伴读包。Flomo 方向仅供用户自行选择、思考与记录。

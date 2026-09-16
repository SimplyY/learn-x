# 技术边界与验证 (TECH)

本文档是 Learn-X 的项目级技术索引，覆盖本地应用代码、静态构建和验证边界。功能说明见 `CHAT_PACK.md` 和 `LEARN_X_PROCESS.md`；项目级认知原则留在根 README。

## 代码 vs Skill

| 类型 | 位置 | 职责 |
| --- | --- | --- |
| Code | `app/code/` | Chat Pack、本地页面、静态图谱和应用构建。 |
| Skill | `.agents/skills/` | 可复用工作流，例如 `learn-x-process` 的输入清洗、Process Pack 和 Memory 候选脚本。 |
| Prompt | `02_prompts/` | 单次任务或可复用对话方式，不承载完整工作流。 |
| Core | `01_core/` | 人工确认后的长期认知资产，不由脚本自动写入。 |

周期 Process 的确定性读取、日期过滤、去重、压缩校验和材料包生成统一放在 `.agents/skills/learn-x-process/scripts/`。月度语义压缩规则由 `learn-x-monthly-automation` 的 Markdown 维护；不要在代码中调用外部 AI，也不要在 `app/code/scripts/` 复制工作流。

## 项目内 Skills

| Skill | 职责 |
| --- | --- |
| `learn-x-input` | 把外部周度证据确定性写入 `03_input/`，保留来源，不做长期判断。 |
| `learn-x-process` | 从指定周期 Input 生成可追溯的 Process Pack、Output 最小壳和 Memory 候选。 |
| `learn-x-monthly-automation` | 编排月记、周度与月度原始输入、Codex 事件压缩、Monthly Process 与审核后 Memory。 |
| `learn-x-prompt-review` | 评审和优化 `02_prompts/` 与 Chat Pack Prompt，要求先定义契约和代表性评测案例。 |
| `learn-x-question-review` | 已停用的旧周/月复盘 Skill；保留代码与未提交改动，未来周机制会独立重做。 |
| `learn-x-monthly-question-workbench` | 月度核心议题工作台：确定性推荐、选择、Base 内 Docx 研究现场、提案校验、可审计回写与撤回。 |

第三方 Skill 的筛选来源、固定版本和许可证归属见 `THIRD_PARTY_NOTICES.md`。项目内适配只保留与 Learn-X 边界一致的原则，不引入原仓库的 Python、LangChain、多 Agent 或外部服务依赖。

## 技术栈

- 后端：Node.js 原生 HTTP 服务，动态读取文件系统。
- Markdown：使用成熟解析和清理工具，浏览器不直接信任未清理 HTML。
- 前端：轻量浏览器端页面，优先保持可读和可维护。
- 依赖引入必须能明显降低解析、渲染、安全或搜索等高风险能力的复杂度；简单逻辑不要引入沉重框架。

## 当前代码入口

| 文件 | 作用 |
| --- | --- |
| `app/code/server.mjs` | 本地服务入口；启动后监听 `.md` 变化并重建静态数据。 |
| `app/code/public/` | 浏览器端 Chat Pack 页面。 |
| `app/code/scripts/build-static-data.mjs` | 构建静态数据。 |
| `app/code/scripts/static-graph.mjs` | 生成静态图谱数据。 |
| `app/code/scripts/release.mjs` | 发布前检查：语法检查并构建静态站点。 |

`npm run build` 会生成 `dist/`，并把 `app.js`、`styles.css`、`data/graph.js`、`data/graph.json` 写成内容哈希文件名，例如 `app.<hash>.js`。`dist/index.html` 在每次构建时自动引用新的哈希路径，避免 GitHub Pages / CDN / 浏览器继续命中旧静态资源缓存。不要手动维护 `dist/index.html` 中的资源路径。

构建分为两个明确目标：

- `npm run build:local`：供 `npm run dev` 使用，保留本地 Input、Process Skill 和 `_dist` 上下文，并启用桌面端 Chat Pack 编辑器。
- `npm run build:public`：供 GitHub Pages 和 release 使用，在生成图数据时排除 `03_input/`、`.agents/skills/learn-x-process/`、`04_output/_dist/` 及周期 Output 入口；构建产物出现这些路径时直接失败。
- `npm run build:public:no-context`：同一 Pages 构建中的轻量公开版，输出到 `dist/no-context/`；通过 `LEARN_X_CHATPACK_CONTEXT=off` 在构建时移除 Chat Pack 的上下文选择与上下文装配，保留提示词、当前问题和生成能力。

GitHub Pages 一次上传整个 `dist/`：标准公开版位于站点根路径，轻量版位于 `/no-context/`。无上下文版本不生成 `contextFiles` 或 `customContextFiles`，生成的 Chat Pack 也不包含 Context 段落；知识库浏览仍沿用公开版的已过滤 Markdown 数据。

Chat Pack 编辑器只在本地桌面端显示。排序、大类增删改、子类型增删移动、名称、说明、默认当前问题、Prompt 正文和推荐上下文通过 localhost 同源写入接口保存回 `00_config/chatpack.config.json` 与 `02_prompts/chatpack/`；ID、Prompt 路径、增强器分组和功能标志不允许手动编辑，新增或移动时由系统按 slug 规则生成，删除只移除配置项并保留已有 Prompt 文件。公开站点和手机端只读取发布后的结果。

`app/code/` 按普通目录纳入 Learn-X 主仓库，不作为独立子模块或嵌套仓库维护。Git 提交、推送和远端配置只在主仓库边界处理；`app/code/scripts/` 不执行 `git add`、`git commit` 或 `git push`。

## Chat Pack 技术边界

- 配置统一维护在 `00_config/chatpack.config.json`；Prompt 分别放在 `02_prompts/chatpack/<type>/` 和 `02_prompts/chatpack/enhancers/`。
- 前端负责组装 Prompt、Context 和增强器；Context 统一通过 `/api/context` 获取。
- 周、月、年快捷选择、芒格之魂模式和人工确认边界见 `docs/CHAT_PACK.md`，不要在 TECH 重复维护产品规则。
- Process Pack 的生成与 Memory 候选不属于应用代码，见 `docs/LEARN_X_PROCESS.md` 和 `.agents/skills/learn-x-process/`。

## API 边界

- `/api/graph`：返回文件列表、文件树、可选上下文来源、自动发现的领域列表和 Prompt 映射。
- `/api/file?path=README.md`：返回单文件 Markdown 原文和已清理 HTML。
- `/api/context?scene=<场景>&include=<路径>`：按文件或目录切片生成上下文包。
- `PUT /api/chatpack/editor`：仅本地回环地址和同源页面可用，校验并保存 Chat Pack 排序、文案、推荐上下文及单个 Prompt，然后重建本地静态数据。
- `GET/POST /api/chatpack/usage`：仅本地回环地址和同源页面可用；读取本机统计视图或以幂等事件记录当前月份的使用次数。公开 Pages 不提供该接口。
- Chat Pack 在前端组装，Context 来源统一来自 `/api/context`。

提示词使用基线位于 `00_config/chatpack-usage.json`，缺失时本地构建和合并均失败关闭。本地端的未合并月度记录写入被 Git 忽略的 `app/code/.local/chatpack-usage.json`；公开版只在浏览器保存自己的月度记录。`learn-x-prompt-usage` Skill 接收公开版复制的 JSON，拒绝未知 ID、非法月份、异常次数或已有基线改动，正常时只提交统计基线。
- 静态部署读取构建产物；本地服务优先请求 API。

## 长期认知议题

- 业务真值源是飞书「研究&学习」Base：`议题`=`tbllcm6oBbdMKnkN`，`认知事件`=`tblIE9FK9mWGv7GE`；议题实例和事件不得落盘为 Markdown。
- 月度 Workflow=`wkfrXZKX31rlwAAy`，每月 1 日 10:00，名称为「月度核心议题研究工作台」，向 learn-x 群发送「启动月度核心议题研究工作台」。周 Workflow=`wkfHoGP5FHaFHE32` 当前停用；发送身份保持既有用户身份，修改后必须重新读回验收。
- `.agents/skills/learn-x-monthly-question-workbench/scripts/workbench.mjs` 是唯一运行入口：`recommend`、`select`、`create`、`snapshot`、`apply`、`rollback`、`status`。`setup` 仅用于一次性建字段、账本表与审计视图。
- Base 真实主表：`核心议题=tbllcm6oBbdMKnkN`，`认知事件=tblIE9FK9mWGv7GE`。新增字段的名字与选项由脚本 Schema 校验；月度账本表 ID 在运行时按名称解析，避免将不稳定的 Base 资源 ID 硬编码。
- 排序：先下次月度运行前到期的重大决策（截止日、优先级），再按议题周期的短期/中期/长期/未分类分层，层内依 P0/P1/P2、最久未获得有效月度提交或有效事件注意力、议题编号排序。空优先级和研究状态分别按 P1、继续研究解释；议题周期空值保留为未分类。
- `apply` 只接收已经从同一文档 revision 读出的 proposal。它只可更新议题周期、优先级、研究状态、阶段、当前判断、判断置信度、最大未知、改变判断的条件、下一步；事件必须有同版本原文证据和 block ID。相同文档 hash 不重复写；新版本先预检、撤回旧事件、恢复旧字段，再完整应用。
- 账本状态是 `待选择/研究中/需处理/已提交/已撤回`。事件以确定性来源标识去重，先 `待生效` 后 `有效`；撤回只改有效性，不删除历史。写入后必须读回，冲突或不一致失败关闭。
- 字段契约：`核心议题`保存问题身份、生命周期/阶段、议题周期/优先级/研究状态和当前判断；议题周期是短期/中期/长期注意力窗口，优先级是整体重要性，研究状态是当前是否继续研究。`认知事件`保存真正的认知增量，并以有效性与来源月度研究保留可撤回的追加历史。账本仅保存流程和版本审计，不保存研究原文。
- 新触发词是「启动月度核心议题研究工作台」「重新推荐」「提交这份月度研究文档」「重新解析这份文档」「撤回上次解析」。旧触发词、旧 JSON、旧 Chat Pack 复盘路径均不再是运行契约。
- Voice-X、Research-X、Read-X 与现实经历继续保留原始材料；只有文档明确引用的内容才能被写入事件来源。周机制待独立重做，P0 不从旧调度字段推导月度工作台行为。
- 任何字段、选项或表 ID 不一致都失败关闭；快照变化拒绝回写。Research-X 的 `wisdom-review` 仅把活跃议题作为第五个温故来源，共享既有配额，不进入删除候选。

## 维护边界

- 不要把 `03_input/`、`04_output/` 或 Weekly Process 规则写进应用代码。
- 不要把 `AGENTS.md`、`app/code/` 或生成物混入学习上下文。
- 不要把领域写死为教育、投资或 AI；领域应从 `01_core/法/` 自动发现并支持扩展。
- 不要让工具反过来塑造或异化「道」和「法」。
- 长期议题系统只保存系统边界、字段契约和工程规则；问题、判断、事件与 Chat Pack 数据留在 Base 或当前会话。

## 开发验证

修改后至少运行相关语法检查：

```bash
node --check app/code/server.mjs
node --check app/code/public/app.js
node --check app/code/scripts/static-graph.mjs
npm run test:app
node --test .agents/skills/learn-x-monthly-question-workbench/scripts/*.test.mjs
npm run build:public
npm run build:local
```

本地启动地址：`http://127.0.0.1:4173`。

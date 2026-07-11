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
- Chat Pack 在前端组装，Context 来源统一来自 `/api/context`。
- 静态部署读取构建产物；本地服务优先请求 API。

## 维护边界

- 不要把 `03_input/`、`04_output/` 或 Weekly Process 规则写进应用代码。
- 不要把 `AGENTS.md`、`app/code/` 或生成物混入学习上下文。
- 不要把领域写死为教育、投资或 AI；领域应从 `01_core/法/` 自动发现并支持扩展。
- 不要让工具反过来塑造或异化「道」和「法」。

## 开发验证

修改后至少运行相关语法检查：

```bash
node --check app/code/server.mjs
node --check app/code/public/app.js
node --check app/code/scripts/static-graph.mjs
npm run test:app
npm run build:public
npm run build:local
```

本地启动地址：`http://127.0.0.1:4173`。

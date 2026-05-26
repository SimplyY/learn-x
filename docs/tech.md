# 技术边界与验证 (TECH)

## 1. 技术栈
- **后端**：Node.js 原生 HTTP 服务，动态读取文件系统。
- **渲染**：`markdown-it` + `DOMPurify` (HTML 清理)。
- **前端**：极简 Vanilla JS 或 Vite 驱动的轻量模式。
- 允许引入外部依赖，但必须满足至少一项：
  - 官方或事实标准；
  - 社区长期稳定、维护活跃；
  - 能明显减少手写复杂逻辑；
  - 对安全、解析、渲染、搜索等高风险能力有成熟实现。
- 不要为十几行简单可读逻辑引入沉重框架，从全局最优的角度高性价比的使用 token。

## 2. 目录结构
- `/`：README、道 (元规律)、法 (领域地图)、meta-prompts (Prompt 正文)。
- `code/server.mjs`：本地 API 服务。
- `code/public/`：前端静态资源。
- `code/public/config.js`：前端配置中心。菜单、学习场景和 Prompt 目录等高频结构配置都应优先放在这里。

## 3. 配置原则
- 可被用户频繁修改的内容必须配置化，不要散落在业务逻辑里。
- 先放少量全局配置，再放长文本配置，例如 `brand`、`menu` 在前，Prompt 模板在后。
- 顶级菜单从 `APP_CONFIG.menu` 渲染。改名、增删、排序应尽量只改配置。
- 学习场景从 `APP_CONFIG.learningScenarios` 读取；Prompt 正文从 `APP_CONFIG.promptDirectory` 指向的目录按 `<id>.md` 读取。
- 业务代码只消费配置和 Prompt 文件，不承载 Prompt 正文。

## 4. API 规范
- `/api/graph`：返回文件列表、文件树、可选上下文来源、自动发现的领域列表、Prompt 映射。
- `/api/file?path=README.md`：返回单文件 Markdown 原文和已清理 HTML。
- `/api/context?scene=<场景>&include=<路径>`：按文件或目录切片生成 `CONTEXT_MASTER.md`。
- `/api/context` 支持多个 `include` 参数；不传时默认全量核心 Markdown。
- `CONTEXT_MASTER.md` 格式要求：唯一 H2 层级必须为文件相对路径，原文标题需自动降级。
- Chat Pack 在前端组装，不新增后端 API；其 Context 来源仍统一来自 `/api/context`。
- 静态部署通过 `npm run snapshot` 生成 `code/public/data/graph.json`；GitHub Pages 部署 `code/public`。
- 浏览器在本地服务中优先请求 API；静态托管无 API 时自动回退到 `data/graph.json`。

## 5. 发布流程
- 首次发布前，需要创建 GitHub 仓库并执行：`git remote add origin <github-repo-url>`。
- 日常一键发布：在 `code/` 目录执行 `npm run release -- "提交说明"`。
- `release` 会依次执行语法检查、静态快照生成、`git add -A`、提交、push。
- GitHub Pages 由 `.github/workflows/pages.yml` 自动部署。

## 6. 开发验证
- 修改后运行：
  - `node --check code/server.mjs`
  - `node --check code/public/app.js`
  - `node --check code/public/config.js`
- 启动地址：`http://127.0.0.1:4173`。

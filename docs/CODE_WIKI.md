# Learn-X Code Wiki

> 本文档是 Learn-X 仓库的结构化代码百科，覆盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系以及项目运行方式。

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 项目架构](#2-项目架构)
- [3. 目录结构](#3-目录结构)
- [4. 核心模块详解](#4-核心模块详解)
  - [4.1 应用层 app/code/](#41-应用层-appcode)
  - [4.2 技能层 .agents/skills/](#42-技能层-agentsskills)
  - [4.3 工具脚本 scripts/](#43-工具脚本-scripts)
  - [4.4 配置层 00_config/](#44-配置层-00_config)
  - [4.5 认知资产层 01_core/](#45-认知资产层-01_core)
  - [4.6 提示词层 02_prompts/](#46-提示词层-02_prompts)
  - [4.7 输入层 03_input/](#47-输入层-03_input)
- [5. 关键类与函数说明](#5-关键类与函数说明)
- [6. 依赖关系](#6-依赖关系)
- [7. 数据流与工作流](#7-数据流与工作流)
- [8. 构建与部署](#8-构建与部署)
- [9. 项目运行方式](#9-项目运行方式)
- [10. 安全机制](#10-安全机制)
- [11. CI/CD 与自动化](#11-cicd-与自动化)

---

## 1. 项目概览

Learn-X 是一个**个人 AI native 的知行进化系统**，核心理念是以「道」校准方向、以「法」形成判断、以「术」推动行动、以「器」降低成本，让 AI 成为认知工具而非认知茧茧。

### 核心公式

```
AI 效果 = Prompt × Context × Model × Feedback × Action
```

### 道法术器四层模型

| 层级 | 含义 | 作用 |
|------|------|------|
| 道 | why，价值层 | 方向、本质、人生母题 |
| 法 | what，认知框架层 | 教育观、投资观、AI 观、创业观 |
| 术 | how，方法执行层 | 方案、流程、Prompt、复盘模板 |
| 器 | tool，工具实现层 | flomo、飞书、Codex、脚本、书籍 |

### 完整认知闭环

```
收集输入 (03_input/)
  ↓
生成中间材料 (04_output/_dist/)
  ↓
AI Chat 生成人读 Output (04_output/weekly|monthly|yearly/)
  ↓
人工确认值得保留的判断
  ↓
生成周期 Memory (01_core/memory/)
  ↓
月度/年度再审计 Memory 与 Output → 道/法/术候选
  ↓
人工确认后更新 01_core/道/、01_core/法/
```

### 技术栈

- **运行时**：Node.js（ESM 模块）
- **后端**：Node.js 原生 HTTP 服务（无框架）
- **前端**：原生 JavaScript 浏览器端页面（无框架）
- **Markdown 处理**：markdown-it + DOMPurify + JSDOM
- **外部集成**：飞书 CLI（lark-cli）、微信读书 API
- **部署**：GitHub Pages（静态站点）+ PM2（本地常驻）

### 依赖清单

| 依赖 | 版本 | 用途 |
|------|------|------|
| `markdown-it` | ^14.1.1 | Markdown 解析为 HTML |
| `dompurify` | ^3.4.2 | HTML 安全清理（XSS 防护） |
| `jsdom` | ^29.1.1 | 为 DOMPurify 提供浏览器 DOM 环境 |

---

## 2. 项目架构

Learn-X 采用**内容与工具分离**的架构，仓库本身既是认知内容的存储介质，也是应用代码的运行载体。

```
┌─────────────────────────────────────────────────────────────┐
│                      Learn-X 仓库                            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  认知资产    │  │  提示词资产  │  │  原始输入            │ │
│  │  01_core/    │  │  02_prompts/ │  │  03_input/           │ │
│  │  道/法/memory│  │  chatpack/   │  │  weekly/monthly/     │ │
│  └──────┬───────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                 │                     │            │
│         └────────┬────────┘                     │            │
│                  ▼                               │            │
│  ┌─────────────────────────────┐                │            │
│  │     应用层 app/code/         │                │            │
│  │  ┌─────────┐ ┌───────────┐  │                │            │
│  │  │ server  │ │  build    │  │                │            │
│  │  │ .mjs    │ │ scripts/  │  │                │            │
│  │  └────┬────┘ └─────┬─────┘  │                │            │
│  │       │            │         │                │            │
│  │  ┌────▼────────────▼──────┐ │                │            │
│  │  │   public/ (前端页面)    │ │                │            │
│  │  │  app.js, context.js,   │ │                │            │
│  │  │  chatpack.js, editor.js│ │                │            │
│  │  └────────────────────────┘ │                │            │
│  └─────────────────────────────┘                │            │
│                                                  │            │
│  ┌──────────────────────────────────────────────▼──────────┐│
│  │              技能层 .agents/skills/                      ││
│  │  learn-x-input    → 采集外部证据到 03_input/             ││
│  │  learn-x-process  → 生成 Process Pack / Memory 候选      ││
│  │  build-bot-log    → 飞书机器人构建复盘                    ││
│  │  long-article-research → 长文研究入库                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  scripts/        │  │  00_config/      │                   │
│  │  security-scan   │  │  learn-x.config  │                   │
│  │  sync-ljg-prompts│  │  chatpack.config │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### 架构分层

| 层级 | 目录 | 职责 | 代码类型 |
|------|------|------|----------|
| 认知资产 | `01_core/` | 人工确认后的长期认知真值源 | 内容（不可自动写入） |
| 提示词 | `02_prompts/` | 可复用 Prompt，Chat Pack Prompt | 内容 |
| 输入 | `03_input/` | 原始输入证据区 | 内容 |
| 输出 | `04_output/` | 周期处理结果和中间材料 | 内容（生成物） |
| 应用 | `app/code/` | Chat Pack 与本地应用 | 代码 |
| 技能 | `.agents/skills/` | 可复用工作流脚本 | 代码 |
| 配置 | `00_config/` | 应用与 Chat Pack 配置 | 配置 |
| 工具 | `scripts/` | 安全扫描、Prompt 同步 | 代码 |

---

## 3. 目录结构

```
learn-x/
├── 00_config/                    # 配置层
│   ├── chatpack.config.json      # Chat Pack 对话类型、子类型、增强器配置
│   └── learn-x.config.json       # 应用配置（品牌、菜单、上下文权重）
│
├── 01_core/                      # 认知资产层（真值源）
│   ├── 道/                        # 价值层：自我认知、人生导师、世界之道、死亡
│   ├── 法/                        # 认知框架层：AI、创业、投资、教育领域地图
│   └── memory/                    # 周期 Memory（季度/年度）
│
├── 02_prompts/                   # 提示词资产
│   ├── ai-chat-ljg-skills/       # 李继刚 Skill 的 AI Chat 适配版
│   ├── chatpack/                 # Chat Pack Prompt（按类型分目录）
│   │   ├── learning-insight/     # 高频使用类 Prompt
│   │   ├── reflective-decision/  # Learn-X 相关类 Prompt
│   │   ├── ljg-skills/           # 李继刚提示词类 Prompt
│   │   ├── other-prompts/        # 其他类 Prompt
│   │   ├── enhancers/            # 增强器 Prompt
│   │   ├── create-execute/       # 创建执行类 Prompt
│   │   └── diagram-generate/     # 图表生成类 Prompt
│   └── meta/                     # 元提示词
│
├── 03_input/                     # 原始输入区
│   ├── weekly/                   # 周度输入（YYYY-Www/）
│   ├── monthly/                  # 月度输入（YYYY-M/）
│   └── yearly/                   # 年度输入（YYYY/）
│
├── app/code/                     # 应用代码
│   ├── server.mjs                # 本地 HTTP 服务入口
│   ├── public/                   # 浏览器端静态文件
│   │   ├── index.html            # 单页应用入口
│   │   ├── app.js                # 主应用逻辑（Chat Pack 组装引擎）
│   │   ├── context.js            # 上下文构建工具
│   │   ├── chatpack.js           # Chat Pack 锚点渲染
│   │   ├── editor.js             # Chat Pack 编辑器（本地桌面端）
│   │   ├── runtime.js            # 全局状态与 DOM 元素绑定
│   │   ├── custom-context-search.js # 自定义上下文搜索
│   │   └── styles.css            # 样式
│   └── scripts/                  # 构建脚本
│       ├── build-static-data.mjs # 静态数据构建（核心构建器）
│       ├── static-graph.mjs      # 图谱数据生成（Markdown 收集/渲染/上下文权重）
│       ├── chatpack-editor.mjs   # Chat Pack 编辑保存逻辑
│       ├── documents-context.mjs # 外部文档上下文读取
│       ├── release.mjs           # 发布前检查
│       └── *.test.mjs            # 单元测试
│
├── .agents/skills/               # 可复用工作流技能
│   ├── learn-x-input/            # 输入采集技能
│   ├── learn-x-process/          # 周期处理技能
│   ├── learn-x-monthly-automation/ # 月度自动化技能
│   ├── learn-x-monthly-journal/  # 月记填充技能
│   ├── learn-x-weekly-automation/ # 周度自动化技能
│   ├── build-bot-log/            # 构建复盘技能
│   └── long-article-research/    # 长文研究技能
│
├── scripts/                      # 项目级工具脚本
│   ├── security-scan.mjs         # 敏感信息扫描（pre-commit）
│   └── sync-ljg-chat-prompts.mjs # 李继刚 Prompt 同步工具
│
├── docs/                         # 技术文档
│   ├── TECH.md                   # 技术边界与验证
│   ├── CHAT_PACK.md              # Chat Pack 功能说明
│   ├── LEARN_X_PROCESS.md        # Process 功能说明
│   ├── SECURITY.md               # 安全护栏
│   └── TODO.md                   # 任务清单
│
├── .githooks/pre-commit          # Git pre-commit 钩子
├── .github/workflows/pages.yml   # GitHub Pages 部署
├── ecosystem.config.cjs          # PM2 配置
├── package.json                  # 项目依赖与脚本
├── AGENTS.md                     # Agent 指南入口
├── RTK.md                        # 命令策略
└── README.md                     # 项目总览
```

---

## 4. 核心模块详解

### 4.1 应用层 app/code/

应用层是 Learn-X 的可视化与交互核心，提供知识库浏览、Chat Pack 组装和本地编辑能力。

#### 4.1.1 后端服务 — [server.mjs](file:///Users/yuwei/code/learn-x/app/code/server.mjs)

**职责**：本地开发服务器，提供静态文件服务、API 接口和 Markdown 文件监听热重建。

**核心功能**：

| 功能 | 实现函数 | 说明 |
|------|----------|------|
| 静态文件服务 | `serveStatic()` | 从 `dist/` 目录提供静态文件，含路径遍历防护 |
| Markdown 热重建 | `startMarkdownBuildWatcher()` | 监听 `.md` 文件变化，防抖 300ms 后触发 `build:local` |
| Chat Pack 保存 | `handleChatPackSave()` | 仅允许本机回环地址调用的编辑器保存接口 |
| 文档上下文 | `handleDocumentsContext()` | 读取 `/Users/yuwei/code` 下的外部 Markdown 文件 |
| 本地请求校验 | `isLocalRequest()` | 校验 remoteAddress + Host header + Origin 三重同源 |

**API 路由**：

| 方法 | 路径 | 功能 |
|------|------|------|
| `PUT` | `/api/chatpack/editor` | 保存 Chat Pack 配置编辑（仅本地） |
| `GET` | `/api/context-files` | 获取外部文档上下文文件列表（仅本地） |
| `GET` | `/api/file?path=` | 读取外部文档内容（仅本地） |
| `GET` | `/*` | 静态文件服务 |

**安全边界**：
- 编辑器保存接口仅接受 `127.0.0.1`/`::1` 的请求
- Host header 必须匹配 `127.0.0.1` 或 `localhost`
- Origin 必须为空或与 Host 同源
- 请求体上限 1MB
- 保存时使用临时文件 + rename 原子写入

#### 4.1.2 静态数据构建 — [build-static-data.mjs](file:///Users/yuwei/code/learn-x/app/code/scripts/build-static-data.mjs)

**职责**：将仓库 Markdown 内容、Chat Pack 配置和 Prompt 构建为静态 JSON 数据，生成可部署的 `dist/` 目录。

**构建流程**：

```
读取配置 → 构建图谱数据 → 构建内容数据 → 构建 Prompt 数据
→ 清空 dist/ → 复制 public/ → 写入哈希命名的数据文件
→ 重写 index.html 引用 → 公开构建校验
```

**构建目标**：

| 命令 | target | 用途 | 特征 |
|------|--------|------|------|
| `npm run build:local` | `local` | 本地开发 | 包含私有路径、启用编辑器、包含 Documents 上下文 |
| `npm run build:public` | `public` | GitHub Pages | 排除私有路径、禁用编辑器 |
| `npm run build:public:no-context` | `public` | 轻量公开版 | 移除上下文选择与装配 |

**关键函数**：

| 函数 | 作用 |
|------|------|
| `writeHashedFile()` | 按内容 SHA-256 哈希前 12 位命名文件，实现缓存失效 |
| `renameWithHash()` | 对已有文件（app.js/styles.css）重命名为哈希版本 |
| `rewriteIndexReferences()` | 重写 index.html 中的资源引用为哈希路径 |
| `assertPublicArtifact()` | 公开构建安全断言：检查是否有私有路径泄露 |
| `resolveDistRoot()` | 校验 `--out-dir` 必须在 `dist/` 内 |

#### 4.1.3 图谱数据生成 — [static-graph.mjs](file:///Users/yuwei/code/learn-x/app/code/scripts/static-graph.mjs)

**职责**：扫描仓库 Markdown 文件，解析双链、渲染 HTML、计算上下文权重，生成完整的图谱 payload。这是应用层的核心数据引擎。

**核心导出函数**：

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `buildGraphPayload()` | `{ includeContent, target, contextEnabled }` | 图谱对象 | 文件列表、文件树、上下文来源、领域列表、Chat Pack 配置 |
| `buildContentPayload()` | `{ target, contextEnabled }` | 内容对象 | 文件全文内容与 HTML 渲染（用于按需加载） |
| `buildChatPackPromptPayload()` | `{ target }` | Prompt 对象 | 所有子类型和增强器的 Prompt 原文 |
| `collectMarkdownFiles()` | 目录路径 | 文件数组 | 递归收集 Markdown（排除 .git/.agents/dist/03_input/04_output/app/code） |
| `collectCustomContextFiles()` | 目录路径 | 文件数组 | 收集自定义上下文文件（含 .json） |
| `renderMarkdown()` | Markdown 字符串 | HTML 字符串 | 解析双链 + DOMPurify 清理 |
| `buildContext()` | 文件数组 | CONTEXT_MASTER | 生成上下文 Markdown |
| `filterFilesByIncludes()` | 文件数组 + 路径列表 | 过滤后数组 | 按路径前缀过滤 |
| `isPublicPrivatePath()` | 文件路径 | boolean | 判断是否为私有路径 |
| `validateChatPackConfig()` | 配置对象 | void/抛错 | 校验 ID 唯一性与命名规范 |

**上下文权重系统**：

权重由三层配置叠加决定：

```
最终权重 = baseWeight × modeMultiplier × userMultiplier
```

| 层级 | 来源 | 默认权重 | 说明 |
|------|------|----------|------|
| memory | `01_core/memory/` | 95 | 跨周记忆，最高优先 |
| prompt | `02_prompts/` | 90 | Prompt 资产 |
| dao | `01_core/道/` | 70-85 | 道层 |
| fa | `01_core/法/` | 65-80 | 法层 |
| shu | 其他 | 55 | 术层 |
| read | `01_core/法/read/` | 45 | 阅读素材 |
| qi | 工具 | 45 | 器层 |

**双链解析**：

- `[[目标名]]` → 转为 `learnx://` 协议链接，前端拦截为 wiki-link
- `[文本](路径.md)` → 转为内部导航链接
- `https://` 外部链接 → 新窗口打开 + `rel="noreferrer"`

#### 4.1.4 Chat Pack 编辑器 — [chatpack-editor.mjs](file:///Users/yuwei/code/learn-x/app/code/scripts/chatpack-editor.mjs)

**职责**：处理本地编辑器的 Chat Pack 配置保存逻辑，包括排序、增删改、Prompt 写入。

**核心导出函数**：

| 函数 | 作用 |
|------|------|
| `prepareChatPackEdits()` | 校验并准备所有写入操作（配置 JSON + Prompt Markdown） |
| `writePreparedEdits()` | 原子执行所有写入（临时文件 → rename） |
| `mergeEditableConfig()` | 合并编辑 payload 与源配置 |

**可编辑字段白名单**：

| 对象 | 可编辑字段 |
|------|-----------|
| 大类 (type) | name, useCases, outputGoal, behaviorDirections, avoid |
| 子类型 (subtype) | name, summary, currentQuestion, recommendedSources, includeBaseRecommendedSources |
| 增强器 (enhancer) | name, summary, applicationNote |

**不可编辑字段**：ID、Prompt 路径、增强器分组、功能标志。

#### 4.1.5 外部文档上下文 — [documents-context.mjs](file:///Users/yuwei/code/learn-x/app/code/scripts/documents-context.mjs)

**职责**：读取仓库外部（`/Users/yuwei/code` 目录下）的 Markdown 文件，作为本地 Chat Pack 的额外上下文来源。

**安全约束**：
- 跳过含 `token|secret|credential|password|cookie|session|wallet` 的文件名
- 使用 `realpath` 防止符号链接逃逸
- 跳过 `.agents`、`.git`、`node_modules`、`dist` 等目录
- 跳过 `app/code` 子目录（避免读取自身代码）

#### 4.1.6 前端主应用 — [app.js](file:///Users/yuwei/code/learn-x/app/code/public/app.js)

**职责**：前端单页应用核心，负责知识库浏览、Chat Pack 组装、上下文管理和 Prompt 装配。

**主要功能模块**：

| 模块 | 关键函数 | 说明 |
|------|----------|------|
| 启动初始化 | `boot()` | 加载图谱数据 → 初始化状态 → 渲染 UI → 绑定事件 |
| 模式切换 | `setMode()` / `navigateMode()` | 知（浏览）/ 学（Chat Pack）/ 行（预留） |
| 对话类型 | `renderDialogueTypes()` / `renderDialogueSubtypes()` | 渲染大类与子类型选择器 |
| 增强器 | `renderEnhancers()` | 渲染增强器按钮（含字数选择器） |
| 上下文选择 | `renderSourceChecklist()` / `applyRecommendedSources()` | 渲染文件树、策略切换、推荐恢复 |
| 周期选择 | `renderPeriodPicker()` / `periodOptions()` | 周/月/年 Process Pack 选择 |
| Chat Pack 生成 | `generateChatPack()` / `buildChatPack()` | 组装完整 Chat Pack 并复制到剪贴板 |
| 上下文生成 | `generateContext()` / `buildWeightedContext()` | 按权重排序生成上下文文本 |
| Token 预算 | `renderContextBudget()` / `estimateTextStats()` | 估算 Token 数并显示预算警告 |
| 双链预览 | `attachPreviewHandlers()` / `showPreview()` | Wiki 链接悬浮预览 |

**Chat Pack 结构**：

```
# Chat Pack
## Current Question          ← 用户当前问题
## Type System               ← 类型体系说明
## Assembled Prompt          ← 装配后的 Prompt
## Output Requirements       ← 输出要求
## Context Priority Map      ← 上下文优先级说明
## High Priority Context     ← 高优先级上下文
## Normal Context            ← 普通上下文
## Final Task Anchor         ← 末尾任务锚定
```

**上下文策略**：

| 策略 | 符号 | 权重倍数 | 说明 |
|------|------|----------|------|
| none | (空) | 0 | 不包含 |
| normal | ✓ | 1 | 背景参考 |
| high | ↑ | 2 | 优先依据 |

#### 4.1.7 前端辅助模块

| 文件 | 职责 | 关键导出 |
|------|------|----------|
| [runtime.js](file:///Users/yuwei/code/learn-x/app/code/public/runtime.js) | 全局状态与 DOM 元素映射 | `state`（28 个状态字段）、`els`（75 个 DOM 元素引用） |
| [context.js](file:///Users/yuwei/code/learn-x/app/code/public/context.js) | 上下文构建工具（前端版） | `filterFilesByIncludes()`、`buildContext()`、`demoteMarkdownHeadings()` |
| [chatpack.js](file:///Users/yuwei/code/learn-x/app/code/public/chatpack.js) | Chat Pack 末尾锚点 | `renderFinalTaskAnchor()` |
| [editor.js](file:///Users/yuwei/code/learn-x/app/code/public/editor.js) | Chat Pack 编辑器 UI | 排序编辑、大类编辑、内容编辑三种模式 |
| [custom-context-search.js](file:///Users/yuwei/code/learn-x/app/code/public/custom-context-search.js) | 自定义上下文搜索 | `searchCustomContext()`（按名称/路径模糊匹配） |

---

### 4.2 技能层 .agents/skills/

技能层包含可复用的自动化工作流，每个 Skill 由 `SKILL.md`（调用规则）+ `scripts/`（确定性脚本）+ `resources/`（规则文件）组成。

#### 4.2.1 learn-x-input — 输入采集技能

**职责**：将外部每周证据确定性写入 `03_input/weekly/YYYY-Www/`，保留来源，不做长期判断。

**脚本清单**：

| 脚本 | npm 命令 | 输出文件 | 数据源 |
|------|----------|----------|--------|
| `collect-weread-weekly.mjs` | `npm run input:weread` | `weread.md` | 微信读书 Agent API |
| `collect-time-weekly.mjs` | `npm run input:time` | `time.md` + `calendar.md` | 飞书日历 + Base（lark-cli） |
| `collect-voice-weekly.mjs` | `npm run input:voice` | `voice.md` | Voice-X Base（lark-cli） |

**周计算规则**：周一至周五选上一 ISO 周，周六周日选当前 ISO 周（Asia/Shanghai 时区）。

**关键函数（collect-weread-weekly.mjs）**：

| 函数 | 作用 |
|------|------|
| `collectWereadWeekly(options)` | 并行拉取书架/阅读详情/笔记本，逐书拉取划线和想法 |
| `writeWereadWeekly(options)` | 原子写入（临时文件 + rename） |
| `isoWeekRangeShanghai(week)` | 计算 Asia/Shanghai 时区下 ISO 周的起止 epoch 秒 |
| `defaultWeeklyReviewWeek(date)` | 周报默认目标周选择逻辑 |

**关键函数（collect-time-weekly.mjs）**：

| 函数 | 作用 |
|------|------|
| `collectTimeWeekly(options)` | 并行采集日历议程和屏幕时间 |
| `summarizeCalendar(range, events)` | 按天聚合时间投入，6 类标签分类（健康/生活/关系/学习/创造/投资） |
| `parseScreenTimeApps(device, details)` | 解析屏幕时间应用明细（Mac 上 ChatGPT → Code X） |

#### 4.2.2 learn-x-process — 周期处理技能

**职责**：从指定周期 Input 生成可追溯的 Process Pack、Output 最小壳和 Memory 候选。

**三阶段流程**：

```
阶段 1：采集 Input → 阶段 2：生成 input.json + process-pack.md + Output 壳 → AI Chat 生成 Output → 阶段 3：提取 Memory 候选
```

**脚本清单**：

| 脚本 | npm 命令 | 输入 | 输出 |
|------|----------|------|------|
| `collect-weekly-input.mjs` | — | `03_input/weekly/YYYY-Www/` | `_dist/weekly/YYYY-Www/input.json` |
| `generate-weekly-process-pack.mjs` | `npm run process:weekly -- --week` | 周输入目录 | `_dist/.../process-pack.md` + Output 壳 |
| `monthly-process-input.mjs` | — | 相交周 + 月度目录 | 结构化 payload（含压缩请求） |
| `generate-monthly-process-pack.mjs` | `npm run process:monthly -- --month` | 月度 payload + Codex 压缩结果 | `_dist/monthly/.../process-pack.md` + Output 壳 |
| `prepare-weekly-memory.mjs` | `npm run memory:weekly -- --week` | 已审核 Weekly Output | `_dist/.../memory-candidates.md` |
| `prepare-period-memory.mjs` | `npm run memory:monthly -- --month` | 已审核 Monthly/Yearly Output | `_dist/.../memory-candidates.md` |

**关键函数（collect-weekly-input.mjs）**：

| 函数 | 作用 |
|------|------|
| `collectWeeklyInput(options)` | 遍历周目录，解析 .md/.txt/.json/.html 为结构化条目 |
| `inputKindFromRelativePath(path)` | 推断输入类型（daily/weekly → 自我反馈，ai/flomo/weread → 信息输入，build/coach → 行动证据） |
| `dedupeItems(items)` | 按文本 SHA-1 哈希去重，保留首次出现 |

**关键函数（generate-weekly-process-pack.mjs）**：

| 函数 | 作用 |
|------|------|
| `generateWeeklyProcessPack(options)` | 主入口：生成 input.json → 组装 Process Pack → 创建 Output 壳 |
| `renderProcessPack(payload, sourceSummaries, fileSummaries)` | 渲染自包含 Markdown（来源索引 F001 编号 + 代码块包裹正文） |
| `ensureWeeklyOutputShell(weekId)` | 条件创建 Output 壳（已有内容不覆盖） |
| `renderTextBlock(text)` | 自动检测最长反引号围栏并加长，防止代码块破坏 |

**关键函数（monthly-process-input.mjs）**：

| 函数 | 作用 |
|------|------|
| `collectMonthlyProcessInput(monthId)` | 遍历相交周 + 月度目录，分类处理 |
| `weeksIntersectingMonth(monthId)` | 计算与目标月相交的所有 ISO 周 |
| `filterBoundaryContent(content, month, week)` | 跨周/跨月文件按日期章节过滤 |
| `reviewMonthlyTypes(items)` | 超 10KB 的非高信号类型标记为 compression-required |

**关键函数（generate-monthly-process-pack.mjs）**：

| 函数 | 作用 |
|------|------|
| `generateMonthlyProcessPack(options)` | 主入口，支持 `--month` 或 `--months`（多月） |
| `validateCompressionDocument(doc, payload)` | 严格校验 Codex 压缩结果（schema/月份/字节限制/哈希/日期范围） |

**资源规则文件**：

| 文件 | 职责 |
|------|------|
| `layer-rules.md` | 道法术器判定规则（先判断行动验证，再判断归属层级） |
| `memory-rules.md` | Memory 输出规则（标题10/11 系统确认、无损整理口径） |
| `weekly-output-rules.md` | Weekly Output 输出结构（0-11 节）与质量标准 |
| `monthly-output-rules.md` | Monthly Output 输出结构（0-9 节 + 确认章节） |
| `yearly-output-rules.md` | Yearly Output 输出结构与年度战略审计定位 |

#### 4.2.3 build-bot-log — 构建复盘技能

**职责**：收集飞书机器人/Code X Bot 的每周构建复盘证据。

**5 个证据收集器**：

| 收集器 | 数据源 | 输出 |
|--------|--------|------|
| `collectBridgeLogs()` | Lark Channel bridge 日志（JSONL） | 时间/发送者/预览/chatId |
| `collectCodexMemories()` | Codex 记忆文件（`~/.codex/memories/`） | 截取前 10000/5000/2000 字符 |
| `collectFeishuMessages()` | 飞书群消息（lark-cli） | 按时间范围搜索 |
| `collectGitChanges()` | Git log/diff/status | 变更摘要 |
| `collectBaseWorkflows()` | 飞书 Base workflow | 工作流列表 |

**门控逻辑**：前 3 个主要源至少 1 个可用才通过（`gatePassed`）。

#### 4.2.4 long-article-research — 长文研究技能

**职责**：将长文研究内容入库到飞书文档 + 研究 Base 表。

**流程**：创建飞书文档 → upsert Base 记录 → 更新本地运行记忆。

---

### 4.3 工具脚本 scripts/

#### 4.3.1 安全扫描 — [security-scan.mjs](file:///Users/yuwei/code/learn-x/scripts/security-scan.mjs)

**职责**：Pre-commit 钩子，扫描暂存文件中的敏感信息。

**检测规则**：

| 类别 | 检测内容 |
|------|----------|
| 敏感文件名 | `.env*`、私钥文件、证书文件、含 token/secret/credential 的文件名 |
| 私钥块 | `-----BEGIN PRIVATE KEY-----` |
| API Key | `api_key=...`、`sk-...`（OpenAI）、`ghp_...`（GitHub） |
| JWT Token | `eyJ...` 格式 |
| 中国隐私 | 身份证号、手机号、银行卡号、家庭住址 |

**使用方式**：

```bash
npm run security:scan          # 扫描全仓库
npm run security:scan:staged   # 仅扫描暂存文件（pre-commit 使用）
```

#### 4.3.2 Prompt 同步 — [sync-ljg-chat-prompts.mjs](file:///Users/yuwei/code/learn-x/scripts/sync-ljg-chat-prompts.mjs)

**职责**：从外部 `ljg-skills-yw-version` 仓库同步李继刚 Skill 原文，包装为 AI Chat 可用的 Prompt。

**输出目录**：`02_prompts/ai-chat-ljg-skills/` 和 `02_prompts/chatpack/ljg-skills/`。

**包装规则**：保留原 Skill 原文，添加 Chat 适配规则（静默忽略文件操作、保留角色与流程、优先使用 Context）。

---

### 4.4 配置层 00_config/

#### 4.4.1 应用配置 — [learn-x.config.json](file:///Users/yuwei/code/learn-x/00_config/learn-x.config.json)

```json
{
  "brand": { "title": "Learn-X", "subtitle": "AI native 的知行进化系统", "mark": "LX" },
  "promptDirectory": "02_prompts/meta",
  "menu": [ /* 知/学/行 三个模块 */ ],
  "contextWeights": { /* 上下文权重配置 */ }
}
```

**上下文权重配置结构**：

```
contextWeights
├── defaults          # 全局默认（baseWeight: 50）
├── layers            # 按层级配置（dao/fa/shu/qi/read/prompt/memory）
│   └── <layer>
│       ├── baseWeight
│       ├── tags
│       ├── modeMultipliers  # 按模式（global-audit/domain-research/...）调整
│       └── defaultStrategy  # normal/high
└── paths             # 按路径精确匹配（支持 * 和 ** 通配符）
```

#### 4.4.2 Chat Pack 配置 — [chatpack.config.json](file:///Users/yuwei/code/learn-x/00_config/chatpack.config.json)

**结构**：

```
chatpack.config.json
├── contextBudget     # Token 预算配置
│   ├── recommendedRatio: 0.667     # 推荐使用模型上下文的 2/3
│   ├── recommendedChineseChars: 30000
│   ├── tokensPerChineseChar: 1.8
│   └── models: [{ contextTokens: 1000000 }]
├── dialogueTypes     # 对话大类（4 个）
│   ├── learning-insight     # 高频使用（8 个子类型）
│   ├── reflective-decision  # Learn-X 相关（6 个子类型，含周期 Output）
│   ├── ljg-skills           # 李继刚提示词（14 个子类型）
│   └── other-prompts        # 其他（1 个空提示词）
└── enhancers         # 增强器（10 个）
    ├── 芒格之魂/语言锋芒/问清问题/多思考一步/现实验证/挑战观点
    └── length-500/1000/2000/200（字数控制组，互斥）
```

---

### 4.5 认知资产层 01_core/

| 目录 | 内容 | 写入规则 |
|------|------|----------|
| `道/` | 自我认知、人生导师、世界之道、死亡 | 仅人工确认后写入 |
| `法/` | AI/创业/投资/教育领域地图 + common.md | 仅人工确认后写入 |
| `memory/` | `YYYY-QN.memory.md`（季度）、`YYYY.memory.md`（年度） | Codex 无损整理 + 人工确认 |

---

### 4.6 提示词层 02_prompts/

| 目录 | 内容 |
|------|------|
| `chatpack/<type>/` | Chat Pack 子类型 Prompt（如 `learning-insight/ljg-learn.md`） |
| `chatpack/enhancers/` | 增强器 Prompt（如 `munger-soul.md`） |
| `ai-chat-ljg-skills/` | 李继刚 Skill 的 AI Chat 适配版 |
| `meta/` | 元提示词（AI 对话提取、领域研究、全局审计） |

---

### 4.7 输入层 03_input/

**结构**：

```
03_input/
├── weekly/
│   ├── 00_template/          # 模板文件（不进入处理流程）
│   └── 2026-W30/             # 周目录（扁平结构）
│       ├── daily.md          # 日记、自我状态
│       ├── weekly.md         # 周记、周复盘
│       ├── ai.md             # AI 对话摘要
│       ├── flomo.md          # Flomo 内容
│       ├── weread.md         # 微信读书（自动采集）
│       ├── voice.md          # 语音记录（自动采集）
│       ├── calendar.md       # 日历（自动采集）
│       ├── time.md           # 屏幕时间（自动采集）
│       ├── health.md         # 健康周报
│       ├── coach.md          # AI Coach 数据
│       ├── build.md          # 构建记录
│       ├── build-bot.md      # 机器人复盘
│       └── research.md       # 调研过程
├── monthly/                  # 月度独有输入
└── yearly/                   # 年度输入
```

**输入类型标记**：

| 文件 | 类型标记 |
|------|----------|
| daily.md, weekly.md, health.md | 自我反馈 |
| ai.md, flomo.md, weread.md | 信息输入 |
| build.md, build-bot.md, coach.md, research.md | 行动证据 |
| calendar.md | 普通 input（不作为行动证据） |

---

## 5. 关键类与函数说明

### 5.1 后端关键函数

#### static-graph.mjs

```javascript
// 构建完整图谱 payload（核心入口）
buildGraphPayload({ includeContent, target, contextEnabled })
→ { runtime, appConfig, chatPackConfig, files, tree, sources,
     contextFiles, customContextFiles, contextWeights, domains, promptDirectory }

// 构建 Chat Pack Prompt payload
buildChatPackPromptPayload({ target })
→ { subtypes: { [id]: promptText }, enhancers: { [id]: promptText } }

// 渲染 Markdown 为安全 HTML
renderMarkdown(content) → HTML string
// 1. [[双链]] → learnx:// 协议链接
// 2. markdown-it 渲染
// 3. DOMPurify 清理（ALLOWED_URI_REGEXP 限制协议）

// 上下文权重解析
resolveContextWeight(filePath, weightConfig, appConfig)
→ { layer, baseWeight, tags, modeMultipliers, defaultStrategy }
// 优先级：精确路径规则 > 层级推断 > 全局默认

// 路径规则匹配（支持 * 和 **）
matchPathRule(filePath, pattern) → boolean
// ** → .*（跨目录），* → [^/]*（单层）
```

#### server.mjs

```javascript
// 本地请求校验（三重同源）
isLocalRequest(req) → boolean
// 1. remoteAddress ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}
// 2. Host header 匹配 127.0.0.1|localhost
// 3. Origin 为空或与 Host 同源

// Markdown 变化监听（防抖 + 队列）
shouldRebuild(changedPath) → boolean
// 排除 .git/.test-tmp/node_modules/dist
// 仅 .md 文件触发重建
```

### 5.2 前端关键函数

#### app.js

```javascript
// 启动入口
async boot()
// 加载图谱 → 设置状态 → 渲染 UI → 绑定事件 → 预热

// Chat Pack 组装（核心）
buildChatPack() → string
// Current Question + Type System + Assembled Prompt
// + Output Requirements + Context Priority Map + Final Task Anchor

// 上下文权重排序
buildWeightedContext(files) → { high: [], normal: [] }
// finalWeight = baseWeight × modeMultiplier × userMultiplier
// high 策略 userMultiplier = 2，normal = 1

// Token 预算估算
estimateTextStats(text) → { visibleChars, estimatedTokens }
// CJK: tokens = chars × 1.8
// Other: tokens = chars / 4

// 周期 Output 上下文选择
periodContextStrategy(mode, value, filePath) → "" | "normal" | "high"
// weekly: 匹配 process-pack.md
// monthly: 匹配 process-pack.md（high）
// yearly: 优先 process-pack.md，回退月度 Output
```

### 5.3 技能脚本关键函数

#### learn-x-process

```javascript
// 周输入收集
collectWeeklyInput(options) → { files, items, stats, range, selection }
// 遍历目录 → 解析文件 → SHA-1 去重 → 过滤 < 12 字符

// 月度边界过滤
filterBoundaryContent(content, month, week) → string
// 按 ## YYYY-MM-DD 标题切分 → 保留目标月内容

// Memory 候选抽取
extractMemoryCandidates(content) → { coreSummary, mungerInsights, checked, ... }
// 标题10"全文核心重点纪要" + 标题11"芒格之魂的洞察" → 系统确认（无需 checkbox）
// 已勾选 checkbox → 必须进入 Memory
// 明确标记行（进入记忆/继续追踪/重要/保留/确认）→ 候选

// Codex 压缩结果校验
validateCompressionDocument(doc, payload) → void/throw
// 校验：schemaVersion、月份、事件字节限制（core 3-5KB/supporting 0.8-1.5KB/minor 0.3-0.5KB）
//       sourceHashes 哈希匹配、dateRange 在月内、所有压缩请求被覆盖
```

---

## 6. 依赖关系

### 6.1 代码依赖图

```
package.json
├── markdown-it (Markdown → HTML)
├── dompurify (HTML 安全清理)
└── jsdom (DOMPurify 的 DOM 环境)

app/code/
├── server.mjs
│   ├── scripts/documents-context.mjs
│   └── scripts/chatpack-editor.mjs
│       └── scripts/static-graph.mjs (validateChatPackConfig)
├── scripts/build-static-data.mjs
│   └── scripts/static-graph.mjs
│       ├── markdown-it, dompurify, jsdom
│       └── 00_config/learn-x.config.json
│       └── 00_config/chatpack.config.json
│       └── 02_prompts/chatpack/**/*.md
└── public/
    ├── app.js → context.js, chatpack.js, runtime.js, editor.js, custom-context-search.js
    └── editor.js → app.js (导入)

.agents/skills/
├── learn-x-input/scripts/
│   ├── collect-weread-weekly.mjs (基础模块，提供周计算函数)
│   ├── collect-time-weekly.mjs → 复用 weread 的周计算函数
│   └── collect-voice-weekly.mjs → 复用 weread 的周计算函数
├── learn-x-process/scripts/
│   ├── collect-weekly-input.mjs (基础模块)
│   ├── generate-weekly-process-pack.mjs → collect-weekly-input.mjs
│   ├── monthly-process-input.mjs → collect-weekly-input.mjs (inputKindFromRelativePath, isoWeekRange)
│   ├── generate-monthly-process-pack.mjs → monthly-process-input.mjs
│   ├── prepare-weekly-memory.mjs → collect-weekly-input.mjs (defaultWeeklyReviewWeek)
│   └── prepare-period-memory.mjs (独立)
└── build-bot-log/scripts/generate-build-bot.mjs (独立)
└── long-article-research/scripts/research-ingest.mjs (独立)
```

### 6.2 外部依赖

| 依赖 | 使用方 | 用途 |
|------|--------|------|
| `lark-cli` | learn-x-input、learn-x-process、build-bot-log、long-article-research | 飞书 API 操作 |
| `git` | build-bot-log、security-scan | 变更记录查询 |
| 微信读书 API | collect-weread-weekly.mjs | 阅读数据采集 |
| `~/.codex/memories/` | generate-build-bot.mjs | Codex 记忆读取 |

### 6.3 数据依赖

```
03_input/weekly/YYYY-Www/
  ↓ (learn-x-input 采集)
  ↓ (learn-x-process 处理)
04_output/_dist/weekly/YYYY-Www/
  ├── input.json          ← 审计清单
  ├── process-pack.md     ← AI Chat 材料包
  └── memory-candidates.md ← Memory 候选
  ↓ (AI Chat 生成 + 人工审核)
04_output/weekly/YYYY-WW.md
  ↓ (prepare-weekly-memory 提取)
01_core/memory/YYYY-QN.memory.md
  ↓ (月度/年度审计)
01_core/道/、01_core/法/
```

---

## 7. 数据流与工作流

### 7.1 周度工作流

```
┌──────────────────────────────────────────────────────────┐
│ 1. 输入采集                                               │
│    npm run input:weread -- --week 2026-W30               │
│    npm run input:time   -- --week 2026-W30               │
│    npm run input:voice  -- --week 2026-W30               │
│    ↓                                                      │
│    03_input/weekly/2026-W30/{weread,time,calendar,voice}.md │
├──────────────────────────────────────────────────────────┤
│ 2. 生成 Process Pack                                      │
│    npm run process:weekly -- --week 2026-W30             │
│    ↓                                                      │
│    04_output/_dist/weekly/2026-W30/input.json            │
│    04_output/_dist/weekly/2026-W30/process-pack.md       │
│    04_output/weekly/2026-30.md (Output 壳)               │
├──────────────────────────────────────────────────────────┤
│ 3. AI Chat 生成 Output                                    │
│    Chat Pack 组装 process-pack.md + 规则 + 道 + Memory    │
│    ↓                                                      │
│    人工审核 04_output/weekly/2026-30.md                   │
├──────────────────────────────────────────────────────────┤
│ 4. 提取 Memory 候选                                       │
│    npm run memory:weekly -- --week 2026-W30              │
│    ↓                                                      │
│    04_output/_dist/weekly/2026-W30/memory-candidates.md  │
│    ↓                                                      │
│    Codex 无损整理 → 01_core/memory/2026-Q3.memory.md     │
└──────────────────────────────────────────────────────────┘
```

### 7.2 月度工作流

```
相交周输入 + 月度独有输入
  ↓
collectMonthlyProcessInput(monthId)
  ↓ 按日期过滤、去重、类型审查
  ↓ 超 10KB 的 ai/research/weread → compression-required
compression-requests.json
  ↓ Codex 按规则压缩
compressed-events.json
  ↓ validateCompressionDocument 严格校验
input.json (metadata-only) + process-pack.md (≤100KB)
  ↓ AI Chat + 人工审核
04_output/monthly/YYYY-MM.md
  ↓ prepare-period-memory --month
memory-candidates.md → 01_core/memory/YYYY-QN.memory.md
```

### 7.3 Chat Pack 组装流

```
用户选择大类 + 子类型
  ↓ applyRecommendedSources()
  ↓ 自动勾选推荐上下文
用户调整上下文策略 (none/normal/high)
  ↓ generateContext()
  ↓ buildWeightedContext() 按权重排序
用户输入当前问题
  ↓ generateChatPack()
  ↓ buildChatPack() 组装完整文本
  ↓ 复制到剪贴板 → 粘贴到 AI Chat
```

---

## 8. 构建与部署

### 8.1 构建目标

| 命令 | 产物 | 用途 |
|------|------|------|
| `npm run build:local` | `dist/` | 本地开发（含私有路径、编辑器、Documents 上下文） |
| `npm run build:public` | `dist/` | GitHub Pages 标准公开版 |
| `npm run build:public:no-context` | `dist/no-context/` | 轻量公开版（移除上下文功能） |

### 8.2 构建产物结构

```
dist/
├── index.html              # 重写资源引用的入口
├── app.<hash>.js           # 哈希命名的前端主脚本
├── styles.<hash>.css       # 哈希命名的样式
├── editor.js               # 编辑器模块（重写 import 路径）
├── .nojekyll               # 禁用 GitHub Pages Jekyll 处理
├── data/
│   ├── graph.<hash>.js     # 图谱数据加载器（URL 映射）
│   ├── graph.<hash>.json   # 图谱数据
│   ├── content.<hash>.json # 文件内容数据
│   └── prompts.<hash>.json # Prompt 数据
└── no-context/             # 轻量版（仅 public:no-context 构建）
```

### 8.3 缓存策略

- 静态资源（JS/CSS/JSON）使用内容哈希命名，永久缓存
- `index.html` 设置 `cache-control: no-store`，确保始终引用最新哈希
- 构建时自动重写 `index.html` 中的资源引用路径

### 8.4 公开构建安全断言

`assertPublicArtifact()` 在公开构建后检查所有暴露路径：

```
检查范围：
  - files[].path
  - contextFiles[].path
  - customContextFiles[].path
  - chatPackConfig.dialogueTypes[].subtypes[].recommendedSources

禁止路径：
  - 03_input/
  - .agents/skills/learn-x-process/
  - 04_output/_dist/
  - 02_prompts/chatpack/reflective-decision/{weekly,monthly,yearly}-output.md
```

---

## 9. 项目运行方式

### 9.1 环境要求

- Node.js >= 22（GitHub Actions 使用 node-version: 22）
- npm
- 飞书 CLI（lark-cli）—— 输入采集和飞书操作需要
- 微信读书 API Key —— `npm run input:weread` 需要

### 9.2 安装

```bash
git clone <repo-url> learn-x
cd learn-x
npm ci
```

### 9.3 本地开发

```bash
# 方式 1：直接启动（构建 + 服务）
npm run dev
# 等价于 npm run build:local && node app/code/server.mjs
# 访问 http://127.0.0.1:4173

# 方式 2：PM2 常驻（自动重启 + 文件监听）
pm2 start ecosystem.config.cjs
```

**PM2 配置**（[ecosystem.config.cjs](file:///Users/yuwei/code/learn-x/ecosystem.config.cjs)）：

- 进程名：`ywdev-learn-x`
- 监听目录：`app/code`、`00_config/chatpack.config.json`、`02_prompts/chatpack`
- 自动重启 + 指数退避
- 端口：4173，Host：127.0.0.1

### 9.4 测试

```bash
# 全部测试
npm test
# 覆盖：app/code/scripts/*.test.mjs、learn-x-input、learn-x-process

# 仅应用测试
npm run test:app

# 微信读书采集测试
npm run test:input:weread
```

### 9.5 发布

```bash
# 发布前检查（语法 + 测试 + 公开构建）
npm run release
# 等价于：
# node --check server.mjs
# node --check app.js
# node --check static-graph.mjs
# npm test
# npm run build:public
```

### 9.6 输入采集命令

```bash
npm run input:weread -- --week 2026-W30    # 微信读书
npm run input:time   -- --week 2026-W30    # 日历 + 屏幕时间
npm run input:voice  -- --week 2026-W30    # 语音记录
npm run input:build-bot -- --week 2026-W30 # 构建复盘
```

### 9.7 周期处理命令

```bash
npm run process:weekly  -- --week 2026-W30   # 生成周 Process Pack
npm run process:monthly -- --month 2026-07   # 生成月 Process Pack
npm run memory:weekly   -- --week 2026-W30   # 提取周 Memory 候选
npm run memory:monthly  -- --month 2026-07   # 提取月 Memory 候选
npm run memory:yearly   -- --year 2026       # 提取年 Memory 候选
```

### 9.8 常用 npm scripts 速查

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发（构建 + 启动服务） |
| `npm run build` | 公开构建（GitHub Pages） |
| `npm run build:local` | 本地构建 |
| `npm test` | 全部测试 |
| `npm run test:app` | 应用测试 |
| `npm run security:scan` | 全仓库安全扫描 |
| `npm run security:scan:staged` | 暂存文件安全扫描 |
| `npm run release` | 发布前检查 |
| `npm run snapshot` | 快照构建（等价 build:public） |
| `npm run research:ingest` | 长文研究入库 |

---

## 10. 安全机制

### 10.1 提交前安全扫描

- **Pre-commit 钩子**：`.githooks/pre-commit` 执行 `npm run security:scan:staged`
- **安装方式**：`npm run prepare` 设置 `git config core.hooksPath .githooks`
- **检测内容**：敏感文件名、私钥、API Key、JWT、中国隐私数据（身份证/手机/银行卡/住址）

### 10.2 HTML 安全

- Markdown 渲染后经 DOMPurify 清理（`html: false` 禁止原始 HTML）
- URI 协议白名单：`https?`、`mailto`、`learnx`（自定义协议）
- 外部链接添加 `target="_blank"` + `rel="noreferrer"`

### 10.3 路径安全

- 静态文件服务含路径遍历防护（`absolutePath.startsWith(distRoot)`）
- 外部文档读取使用 `realpath` 防止符号链接逃逸
- 推荐上下文路径校验（禁止 `..`、绝对路径、null 字节）
- `--out-dir` 必须在 `dist/` 内

### 10.4 接口安全

- 编辑器保存接口仅接受本机回环地址（三重同源校验）
- 请求体上限 1MB
- 保存操作使用原子写入（临时文件 + rename）
- 并发保存保护（`editorSaveInProgress` 锁）

### 10.5 公开构建断言

- 公开构建后检查所有暴露路径，私有路径泄露时构建失败
- 排除：`03_input/`、`.agents/skills/learn-x-process/`、`04_output/_dist/`、周期 Output Prompt

---

## 11. CI/CD 与自动化

### 11.1 GitHub Pages 部署

**触发条件**：push 到 `master` 或 `main` 分支

**流程**（[.github/workflows/pages.yml](file:///Users/yuwei/code/learn-x/.github/workflows/pages.yml)）：

```
checkout → setup-node@22 → npm ci
→ npm test
→ npm run build:public          # 标准公开版 → dist/
→ npm run build:public:no-context  # 轻量版 → dist/no-context/
→ upload-pages-artifact (dist/)
→ deploy-pages
```

**部署结果**：
- 标准版：站点根路径
- 轻量版：`/no-context/` 路径

### 11.2 Git Hooks

| Hook | 位置 | 作用 |
|------|------|------|
| pre-commit | `.githooks/pre-commit` | 执行 `npm run security:scan:staged` |

### 11.3 PM2 常驻服务

- 进程名：`ywdev-learn-x`
- 自动重启 + 指数退避（最小 5 秒运行，最多 10 次重启）
- 文件监听：`app/code`、`chatpack.config.json`、`02_prompts/chatpack`
- 监听延迟：1 秒

---

> 本文档基于仓库代码静态分析生成，如代码有更新请同步维护。技术细节以 [docs/TECH.md](file:///Users/yuwei/code/learn-x/docs/TECH.md)、[docs/CHAT_PACK.md](file:///Users/yuwei/code/learn-x/docs/CHAT_PACK.md)、[docs/LEARN_X_PROCESS.md](file:///Users/yuwei/code/learn-x/docs/LEARN_X_PROCESS.md) 为准。

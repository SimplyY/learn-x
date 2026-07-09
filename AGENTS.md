# Agent 指南：Learn-X

> 本文件是入口路由，只保留始终生效的规则；任务细节按需读取对应文档。

## 核心原则

- Learn-X 是个人认知系统；改动必须保持简洁、可审计、可追溯、可进化。
- `README.md`、`01_core/道/`、`01_core/法/` 是认知真值源；除非用户明确要求，不替用户改写思想内容。
- 自动化负责搬运、清洗、索引、追踪；智能化负责判断、取舍、压缩、改写。
- 新增抽象必须减少真实复杂度；不要为了炫技加入复杂交互。
- 飞书文档、Base、云空间、日历、任务等操作必须走 `feishu-cli`。
- 从第一性原理出发思考问题：回到问题最底层的基本元素和约束条件重新推导，而非依赖既有模板、惯例或类比。

## 按需读取

| 任务类型 | 先读 | 触发条件 |
| --- | --- | --- |
| 本地应用、静态构建、API、验证 | `docs/TECH.md` | 修改 `app/code/`、构建脚本、前端或接口 |
| Chat Pack | `docs/CHAT_PACK.md` | 修改对话类型、Prompt 组合、Context、编辑器或发布边界 |
| Process / Output / Memory | `docs/LEARN_X_PROCESS.md`、`.agents/skills/learn-x-process/` | 处理周/月/年 Output、Process Pack、Memory 候选 |
| Input 流程 | `03_input/README.md`、`03_input/usage.md`、`.agents/skills/learn-x-input/` | 采集、校验或生成 `03_input/` |
| 安全与提交 | `docs/SECURITY.md` | 提交、扫描、处理隐私材料或敏感文件 |
| 命令策略 | `RTK.md` | 运行 git、diff、搜索、测试等可能高噪声命令 |

## 始终遵守

- 先查现有文件和官方文档，不凭空假设接口、依赖或项目意图。
- 只修改与任务直接相关的文件，不顺手重构知识内容或移动目录。
- 能在当前回合完成的任务，要完成到可运行、可验证。
- 不要把 `node_modules/`、密钥、token、cookie、session、`.env*`、证书、钱包文件或真实凭据加入版本控制。
- 不要提交身份证号、手机号、银行卡号、家庭住址、聊天记录原文、医疗报告原文等可识别个人隐私数据。
- 提交前运行 `npm run security:scan:staged` 或等价 pre-commit hook；不要用绕过 hook 的方式提交敏感命中。
- 新命令若会读取、复制、上传、总结或提交隐私材料、密钥材料、项目外文件，先确认范围和风险。
- 不要在浏览器直接信任未清理的 Markdown HTML。
- 不要把 `AGENTS.md`、`app/code/` 或生成物混入学习上下文。
- 不要把领域写死为教育、投资或 AI；从 `01_core/法/` 自动发现。

## 优先级

1. 用户当前明确指令。
2. 本文件的始终生效规则。
3. 按需读取文档中的任务细节。
4. 更通用的全局规则。

@RTK.md

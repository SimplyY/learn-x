# Learn-X


## 核心资产

- [研究&学习](https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe)
- [learn-x](https://simplyy.github.io/learn-x/index.html#learning)

> Learn-X 是我的个人认知进化系统：以「道」校准方向，以「法」形成判断，以「术」推动行动，以「器」降低成本，让 AI 成为我的剑，而不是我的茧。

## 核心目标

Learn-X 不是单纯的知识库、日记库或 AI 摘要系统，而是把输入、判断、沉淀、行动和反馈串起来的长期成长系统。

Learn-X 服务三件事：

1. 维护「道」与「法」。
2. 把可复用的 Prompt、Context 和工作流组织成可调用资产。
3. 用 AI 辅助学习、复盘、自我认知、真实行动和反馈校准。

核心公式：

```text
AI 效果 = Prompt × Context × Model × Feedback × Action
```

当前系统重点：

```text
Prompt + Context → Chat Pack

信息输入 + 行动证据 + 自我反馈
↓
Weekly / Monthly / Yearly Output
↓
人工判断
↓
Memory / 道 / 法 / 术
↓
行动反馈
```

## 道法术器

| 层级 | 含义 | 作用 |
| --- | --- | --- |
| 道 | why，价值层 | 方向、本质、人生母题 |
| 法 | what，认知框架层 | 教育观、投资观、AI 观、创业观 |
| 术 | how，方法执行层 | 方案、流程、Prompt、复盘模板 |
| 器 | tool，工具实现层 | flomo、飞书、Codex、脚本、书籍 |

原则：

```text
道要少，法要精。

道：我为何而活。
法：我如何判断。
术：我如何行动。
器：我用什么实现。
```

## Learn-X 完整闭环

Learn-X 不以 Output 为终点。

标准流程是：

1. 收集输入：`03_input/`
2. 生成中间材料：`04_output/_dist/`
3. AI Chat 生成人读 Output：`04_output/weekly|monthly|yearly/`
4. 人工确认值得保留的判断
5. 生成周期 Memory：`01_core/memory/YYYY-QN.memory.md`
6. 月度 / 年度再审计 Memory 与 Output，形成少量道 / 法 / 术候选
7. 人工确认后，才允许更新 `01_core/道/`、`01_core/法/`

原则：Learn-X 是个人认知进化系统；Weekly / Monthly / Yearly Output 是其中的认知审稿环节，Memory 是跨周上下文，Core 是长期真值源。

## 入口地图

| 位置 | 职责 |
| --- | --- |
| `01_core/` | 人工确认后的长期认知资产，包括道、法和 Memory。 |
| `02_prompts/` | 可复用提示词资产，Chat Pack Prompt 也在这里维护。 |
| `03_input/` | 原始输入区，只保存进入处理流程的证据和反馈。详见 `03_input/README.md`。 |
| `04_output/` | 周度处理结果和中间材料区。详见 `04_output/README.md`。 |
| `.agents/skills/` | 可复用工作流，例如 Weekly Process。 |
| `app/code/` | Chat Pack 与本地应用代码。技术边界详见 `docs/TECH.md`。 |
| `docs/CHAT_PACK.md` | Chat Pack 的目标、组成、使用流程和功能边界。 |
| `docs/LEARN_X_PROCESS.md` | `learn-x-process` 的阶段、产物、职责和功能边界。 |
| `docs/SECURITY.md` | 开源与提交前的敏感信息护栏。 |
| `docs/THIRD_PARTY_NOTICES.md` | 第三方 Skill 的来源、许可证与归属说明。 |
| `docs/TODO.md` | 当前任务清单。 |

## 维护原则

- 根 README 只保留系统总览、核心原则和入口地图。
- 功能细节写在功能自己的 README 或技术文档里，不堆在根 README。
- Input、Output、Chat Pack、Skill、脚本等细节分别由对应目录维护。
- `README.md`、`01_core/道/`、`01_core/法/` 是认知真值源；除非明确要求，不自动改写。
- 人负责最终价值判断，脚本只做确定性整理和可追溯输出。

## 护栏

警惕：

1. 过度系统化。
2. AI 迎合。
3. 记录成瘾。
4. 伪深度。
5. 认知闭环。

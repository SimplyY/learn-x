# Chat Pack 功能说明

Chat Pack 是 Learn-X 的对话启动器。它把一个具体场景所需的 Prompt、推荐 Context 和可选增强器组合起来，让 AI Chat 从明确目标和可信材料开始工作。

## 解决什么问题

- 避免每次重新解释任务、输出要求和约束。
- 从 Learn-X 中选择与当前问题有关的材料，而不是把整个仓库塞给 AI。
- 让学习、判断、创造和周期复盘使用稳定、可维护的 Prompt。
- 保留人工选择与确认，不让系统自动改写长期认知资产。

## 使用流程

1. 选择对话类型和子类型。
2. 确认系统推荐的 Context，按需增减。
3. 可选增强器，例如思考方式或字数。
4. 输入当前问题，在 AI Chat 中使用生成的组合包。
5. 人工确认结果；需要沉淀时，再进入 Output、Memory 或正式资产流程。

组合关系：

```text
当前问题 + 子类型 Prompt + Context + 可选增强器 -> AI Chat 输出 -> 人工确认
```

## 功能组成

| 组成 | 作用 | 维护位置 |
| --- | --- | --- |
| 对话类型 / 子类型 | 表达用户要完成的任务 | `00_config/chatpack.config.json` |
| Prompt | 定义方法、约束和输出方式 | `02_prompts/chatpack/` |
| 推荐 Context | 提供与场景相关的可信材料 | `00_config/chatpack.config.json` |
| 增强器 | 追加思考方式、输出长度等可选要求 | `02_prompts/chatpack/enhancers/` |
| 本地编辑器 | 编辑排序、文案、推荐 Context 和 Prompt 正文 | `app/code/` |

领域 Context 不写死为教育、投资或 AI；需要领域时，从 `01_core/法/` 自动发现。

## 周期 Output

周、月、年 Output 是 Chat Pack 的特殊子类型：

- 默认使用对应周期的 `process-pack.md`，不默认选择 `input.json` 或回捞原始 Input。
- 推荐 `01_core/道/`、`01_core/memory/` 和对应周期规则。
- 启用“芒格之魂”时切换为独立洞察，不生成 Output 正文；关闭后恢复普通 Output 上下文。
- AI 只生成审稿草稿，是否写入 Output、Memory、道或法由人确认。

周期材料的生成与 Memorize 见 [Learn-X Process 功能说明](LEARN_X_PROCESS.md)。

## 编辑与发布边界

- 本地桌面端可保存排序、名称、说明、推荐 Context 和 Prompt 正文。
- ID、Prompt 路径、增强器分组和功能标志不通过界面修改。
- 保存接口只允许本机回环地址和同源页面调用。
- 公开构建只提供已发布结果，不提供编辑能力，也不包含私有 Input、Process Skill 或 `_dist`。

## 不负责什么

- 不替用户决定什么值得进入长期资产。
- 不自动执行 `learn-x-process` 等多阶段工作流。
- 不把 Prompt、Context、Skill 和确定性脚本混成一个文件。
- 不把整个仓库或生成物无差别加入 Context。

实现入口、API 和构建验证见 [TECH.md](TECH.md)。

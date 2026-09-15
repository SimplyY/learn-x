---
generated_by: group-info
schema: group-info/v2
chat_id: "oc_846411e4168e681d7f7b491c837163fd"
group_name: "learn-x"
repo_path: "/Users/yuwei/code/learn-x"
repo_url: null
group_info_path: "/Users/yuwei/code/learn-x/GROUP_INFO.md"
registry_source: "live"
registry_fetched_at: "2026-09-15T00:07:39.814Z"
registry_age_seconds: 0
registry_degraded: false
updated_at: "2026-09-15T00:07:44.395Z"
icon: "🧠"
name_zh: "learn-x"
summary: "认知进化系统。核心功能 chat pack（chat 上下文提示词） + 定期（周、月、年）复盘 IPO (输入、处理、输出)"
detail: "认知系统：学习输入、复盘、知识沉淀的全流程自动化。飞书机器人 / Code X Bot 每周 Build 复盘报告生成；采集外部每周证据（微信读书等）写入 Learn-X 输入目录"
tags: "build-bot-log，learn-x-input，learn-x-monthly-automation，learn-x-monthly-journal，learn-x-process，learn-x-weekly-automation，wisdom-gate"
entry_url: "https://ywhome.feishu.cn/base/W6NLbDh1YahvZ9sbjIccEirBnae"
priority: 1
---

# Group Info: learn-x

## 群定位
认知进化系统。核心功能 chat pack（chat 上下文提示词） + 定期（周、月、年）复盘 IPO (输入、处理、输出)

## 绑定信息
- 飞书群：learn-x
- 工作目录：/Users/yuwei/code/learn-x
- 链接：研究&学习 → https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe
- 链接：learn-x → https://simplyy.github.io/learn-x/index.html#learning
- 默认机器人：Codex / Code X bot
- 注册表来源：live，约 0 秒前读取

## 可用 Skill
1. build-bot-log：生成每周飞书机器人 Build 复盘报告
2. learn-x-input：采集外部每周证据（微信读书阅读、划线和想法等）写入
3. learn-x-monthly-automation：月度自动化中文工作流
4. learn-x-monthly-journal：从 Learn-X 本地周输入和已确认周记生成安全
5. learn-x-process：处理每周月度输入并生成输出壳与记忆候选
6. learn-x-prompt-usage：合并 Learn-X 两端 Chat Pack 提
7. learn-x-question-review：围绕 Learn-X Base 中的长期认知议题执
8. learn-x-voice-insight
9. learn-x-weekly-automation：每周输入自动采集、Weekly Output 报告
10. learn-x-weekly-journal：从 Learn-X 已落盘的周输入生成安全的飞书周
11. long-article-research：长文系统性深度研究 Skill。接收长文本输入，通
12. wechat-weekly-input：通过用户手动提供的微信聊天截图生成重点聊天周度

## 可用 Workflow
1. learn-x-monthly-automation：月度自动化中文工作流
2. learn-x-weekly-automation：每周输入自动采集、Weekly Output 报告

## 数据源
- 研究&学习：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe
- learn-x：https://simplyy.github.io/learn-x/index.html#learning
- README.md：[研究&学习](https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe)
- README.md：| 器 | tool，工具实现层 | flomo、飞书、Codex、脚本、书籍 |
- docs/TECH.md：| `learn-x-question-review` | 从「议题」与「认知事件」Base 表生成周/月思考卡和按需 Chat Pack，只在送达读回后更新复盘调度字段。 |
- docs/TECH.md：业务真值源是飞书「研究&学习」Base：`议题`=`tbllcm6oBbdMKnkN`，`认知事件`=`tblIE9FK9mWGv7GE`；议题实例和事件不得落盘为 Markdown。
- docs/TECH.md：复盘 Workflow 已启用：周复盘=`wkfHoGP5FHaFHE32`（每周一 09:30），月复盘=`wkfrXZKX31rlwAAy`（每月 1 日 10:00）。发送身份已在 Base UI 配置为 bridge 已订阅用户，并通过 `sender_type=user` 的真实消息验收；修改发送身份后必须重新做一次真实读回验收。
- docs/TECH.md：Chat Pack 的事实段由 `review-questions.mjs --mode chat-pack --format markdown` 确定性渲染，必须原样发送；Base 字段为空就保持“未填写”，不得用 Bridge 环境上下文、记忆或模型常识补全个人事实；跨系统事实仅来自认知事件的来源标识/链接或按规则打开的最多 3 个关键来源。
- docs/TECH.md：复盘 JSON 的 `consistencyWarnings` 只报告当前判断/类型/状态与最近事件的潜在不一致，人工在 Base 追加事件；脚本不自动补写认知内容。
- docs/TECH.md：长期议题系统只保存系统边界、字段契约和工程规则；问题、判断、事件与 Chat Pack 数据留在 Base 或当前会话。

## 状态
- 工作目录：可访问
- 链接数：2
- Skill 扫描：正常
- 注册表新鲜度：可用
- 最近更新时间：2026-09-15T00:07:44.395Z

---
generated_by: group-info
schema: group-info/v2
chat_id: "oc_846411e4168e681d7f7b491c837163fd"
group_name: "learn-x"
repo_path: "/Users/yuwei/code/learn-x"
repo_url: null
group_info_path: "/Users/yuwei/code/learn-x/GROUP_INFO.md"
registry_source: "live"
registry_fetched_at: "2026-09-17T21:07:26.520Z"
registry_age_seconds: 0
registry_degraded: false
updated_at: "2026-09-17T21:07:30.950Z"
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
- 链接：人生核心议题 → https://ywhome.feishu.cn/wiki/QIaQwXf07iMvqokKQf3cp3XmnMC
- 链接：learn-x → https://simplyy.github.io/learn-x/index.html#learning
- 默认机器人：Codex / Code X bot
- 注册表来源：live，约 0 秒前读取

## 可用 Skill
1. build-bot-log：生成每周飞书机器人 Build 复盘报告
2. learn-x-deep-research：创建「人生核心议题/深度研究」Wiki 文档、注入
3. learn-x-input：采集外部每周证据（微信读书阅读、划线和想法等）写入
4. learn-x-monthly-automation：月度自动化中文工作流
5. learn-x-monthly-journal：从 Learn-X 本地周输入和已确认周记生成安全
6. learn-x-monthly-question-workbench：推荐、用户选择、创建飞书研究文档、解析明确变化、可
7. learn-x-periodic-insight
8. learn-x-process：处理每周月度输入并生成输出壳与记忆候选
9. learn-x-prompt-usage：合并 Learn-X 两端 Chat Pack 提
10. learn-x-quarterly-question-overview：生成、审计和提交 Learn-X 人生核心议题季度
11. learn-x-voice-insight
12. learn-x-weekly-automation：每周输入自动采集、Weekly Output 报告
13. learn-x-weekly-journal：从 Learn-X 已落盘的周输入生成安全的飞书周
14. long-article-research：长文系统性深度研究 Skill。接收长文本输入，通
15. wechat-weekly-input：通过用户手动提供的微信聊天截图生成重点聊天周度

## 可用 Workflow
1. learn-x-monthly-automation：月度自动化中文工作流
2. learn-x-weekly-automation：每周输入自动采集、Weekly Output 报告

## 数据源
- 研究&学习：https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe
- 人生核心议题：https://ywhome.feishu.cn/wiki/QIaQwXf07iMvqokKQf3cp3XmnMC
- learn-x：https://simplyy.github.io/learn-x/index.html#learning
- README.md：[研究&学习](https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe)
- README.md：[人生核心议题](https://ywhome.feishu.cn/wiki/QIaQwXf07iMvqokKQf3cp3XmnMC)
- README.md：| 器 | tool，工具实现层 | flomo、飞书、Codex、脚本、书籍 |
- docs/TECH.md：| `learn-x-deep-research` | 一键深度研究：创建「深度研究」Wiki 文档、注入议题上下文、维护倒序目录、组装 ChatGPT 上下文包；对 Base 只读。 |
- docs/TECH.md：受治理 Prompt 的飞书正文由全局 `prompt-governance` Skill 管理，本地构建在使用副本前校验清单中的 SHA-256；静态载荷只暴露 `prompt_id/revision/hash`，不暴露飞书 URL、文档 ID 或绝对路径。详见 `docs/PROMPT_GOVERNANCE.md`。
- docs/TECH.md：业务真值源是飞书「研究&学习」Base：`议题`=`tbllcm6oBbdMKnkN`，`认知事件`=`tblIE9FK9mWGv7GE`；议题实例和事件不得落盘为 Markdown。
- docs/TECH.md：Base 真实主表：`议题=tbllcm6oBbdMKnkN`，`认知事件=tblIE9FK9mWGv7GE`。`议题`是唯一原子对象，可以是问题或目标；新增字段的名字与选项由脚本 Schema 校验；`议题周期`的规范值为短期/中期/长期，历史含“核心问题”的旧选项只在迁移期间兼容；月度账本表 ID 在运行时按名称解析，避免将不稳定的 Base 资源 ID 硬编码。
- docs/TECH.md：长期议题系统只保存系统边界、字段契约和工程规则；问题、判断、事件与 Chat Pack 数据留在 Base 或当前会话。

## 状态
- 工作目录：可访问
- 链接数：3
- Skill 扫描：正常
- 注册表新鲜度：可用
- 最近更新时间：2026-09-17T21:07:30.950Z

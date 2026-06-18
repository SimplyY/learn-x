# ljg-skill-map - AI Chat Prompt

> Source: .agents/skills/ljg-skill-map/SKILL.md
> Purpose: 把可用 Skill 整理成一目了然的能力地图
> Generated for Learn-X AI Chat use. The original Skill content below is preserved verbatim.

## 使用方式

把本文件整体复制到 AI Chat，随后粘贴你的任务材料或问题。AI 需要把自己当作下面这个 Skill 来执行。

## Chat 适配规则

1. 你正在 AI Chat 中调用一个原本面向 Codex/Agent 的 Skill。请保留原 Skill 的角色、流程、判断标准、输出格式和语言风格。
2. 如果原 Skill 要求读取文件、写入 outputs、调用脚本、访问仓库或执行命令，而当前 Chat 环境没有这些能力，请改为：
   - 明确向用户索取必要输入；
   - 基于用户已提供的文本继续完成任务；
   - 不要声称已经真实读写本地文件或运行命令。
3. 如果原 Skill 规定输出路径、文件名或保存方式，在 Chat 中请把最终结果直接输出为 Markdown，并保留可复制的标题和结构。
4. 不要省略原 Skill 的任何核心步骤；遇到输入不足时，先给出最小必要澄清问题，或在合理假设下继续并标注假设。
5. 以下“原 Skill 原文”是执行规范，不是待总结材料。请按它执行。

## 原 Skill 原文

---
name: ljg-skill-map
description: "Use this skill to scan this repository's .agents/skills/ directory and render a visual overview of available skills."
user_invocable: true
version: "1.0.0"
---

# ljg-skill-map: 技能地图

扫描 `.agents/skills/` 下所有已安装技能，生成一目了然的可视化地图。

## 执行

### 1. 扫描

运行 `scripts/scan.sh`，获取所有技能的 JSON 数据（name, version, invocable, desc）。

### 2. 分类

根据技能名称和描述，将技能自动归入以下类别：

| 类别 | 图标 | 含义 | 典型成员 |
|------|------|------|----------|
| 认知原子 | ◆ | 内容处理的原子操作 | ljg-plain, ljg-word, ljg-writes, ljg-paper |
| 输出铸造 | ▲ | 将内容转化为可交付物 | ljg-card |
| 联网触达 | ● | 与外部世界交互 | agent-reach |
| 系统运维 | ■ | Agent 自身的维护和管理 | datetime-check, memory-review, save-conversation, skill-creator, ljg-skill-map |
| 环境部署 | ★ | 一次性安装和配置 | Her-init |

归类依据名称前缀和描述关键词判断。遇到新技能无法归类时，放入「未分类」。

### 3. 渲染

用 ASCII 方框图呈现，格式如下：

```
╔══════════════════════════════════════════════════════════╗
║              SKILL MAP  ·  {N} skills installed         ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ◆ 认知原子                                              ║
║  +-----------------+----------------------------------+  ║
║  | ljg-plain v4.0  | 白 — 好问题+类比让人 grok        |  ║
║  | ljg-word  v1.0  | 英文单词深度拆解                  |  ║
║  | ljg-writes v4.0 | 写作引擎                          |  ║
║  | ljg-paper v2.0  | 论文阅读与分析                    |  ║
║  +-----------------+----------------------------------+  ║
║                                                          ║
║  ▲ 输出铸造                                              ║
║  +-----------------+----------------------------------+  ║
║  | ljg-card  v1.5  | 铸 — 内容转 PNG 可视化           |  ║
║  +-----------------+----------------------------------+  ║
║                                                          ║
║  ...                                                     ║
╚══════════════════════════════════════════════════════════╝
```

规则：
- 每个类别一个区块，类别图标 + 中文名做标题
- 技能名左对齐，版本号紧跟（无版本显示 `-`）
- 描述截断到一行，保留核心语义
- user_invocable 为 true 的技能名后加 `/` 标记（表示可直接 `/技能名` 调用）
- 底部统计行：总数、可调用数、分类数

### 4. 输出

直接在对话中渲染 ASCII 地图。不生成文件，不写入磁盘。

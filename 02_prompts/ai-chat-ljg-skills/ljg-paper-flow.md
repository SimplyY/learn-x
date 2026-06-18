# ljg-paper-flow - AI Chat Prompt

> Source: .agents/skills/ljg-paper-flow/SKILL.md
> Purpose: 读论文并把解读铸成视觉卡片
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
name: ljg-paper-flow
description: "Use this skill to analyze one or more papers and then create visual paper cards from the analysis."
user_invocable: true
version: "1.0.2"
---

# ljg-paper-flow: 论文流

一条命令完成：读论文 → 生成解读 → 铸成卡片。支持多篇并行。

## 模式

本 workflow 是项目内显式管道：先按 `ljg-paper` 读论文，再按 `ljg-card` 铸卡片。直接执行下方步骤，不依赖外部编排框架。

## 参数

| 参数 | 说明 |
|------|------|
| 无参数 | 对话中已提供的论文链接/文件 |
| `-l` | 卡片模具改用长图模式（默认 `-v` 视觉笔记） |
| `-i` | 卡片模具改用信息图模式 |
| `-c` | 卡片模具改用漫画模式 |

## 执行

### 1. 收集论文列表

从用户消息中提取所有论文来源（arxiv URL、PDF 路径、论文名称等）。

### 2. 并行处理每篇论文

对每篇论文，按顺序执行两步。多篇论文可以并行处理，但每篇论文内部必须先读论文、再铸卡片。

**步骤 A — 读论文（ljg-paper）：**

按当前 agent 的可用方式执行 `ljg-paper`，传入该论文的来源。若不能直接调用 skill，就读取 `.agents/skills/ljg-paper/SKILL.md` 并按其中步骤执行。等待完成，获得生成的分析文件路径。

**步骤 B — 铸卡片（ljg-card）：**

读取步骤 A 生成的分析文件，按当前 agent 的可用方式执行 `ljg-card`（默认 `-v`，或按用户指定的模具参数）。若不能直接调用 skill，就读取 `.agents/skills/ljg-card/SKILL.md` 并按其中步骤执行。等待完成，获得 PNG 文件路径。

### 3. 汇总报告

所有论文处理完成后，汇总输出：

```
════ 论文流完成 ═══════════════════════
📄 {论文标题1}
   📝 解读: {分析文件路径}
   🖼️ 卡片: {PNG 文件路径}

📄 {论文标题2}
   📝 解读: {分析文件路径}
   🖼️ 卡片: {PNG 文件路径}
...
```

## 关键约束

- 每篇论文的两步必须串行（先 paper 后 card），但多篇论文之间并行
- ljg-paper 和 ljg-card 各自的质量标准、红线、品味准则不变
- 卡片内容来自生成的分析文件，不是原始论文

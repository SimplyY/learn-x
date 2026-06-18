# ljg-word-flow - AI Chat Prompt

> Source: .agents/skills/ljg-word-flow/SKILL.md
> Purpose: 解读英文词并生成词语信息卡
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
name: ljg-word-flow
description: "Use this skill to analyze one or more English words and create infograph cards from the analysis."
user_invocable: true
version: "1.0.1"
---

# ljg-word-flow: 词卡

一条命令完成：解词 → 铸信息图。支持多词并行。

## 模式

本 workflow 是项目内显式管道：先按 `ljg-word` 解词，再按 `ljg-card -i` 铸信息图。直接执行下方步骤，不依赖外部编排框架。

## 参数

直接传入一个或多个英文单词，空格分隔。

```
/ljg-word-flow Obstacle
/ljg-word-flow Serendipity Resilience Entropy
```

## 执行

### 1. 收集单词列表

从用户消息中提取所有英文单词。

### 2. 处理每个单词

对每个单词，串行执行两步：

**步骤 A — 解词（ljg-word）：**

按当前 agent 的可用方式执行 `ljg-word`，传入单词。若不能直接调用 skill，就读取 `.agents/skills/ljg-word/SKILL.md` 并按其中步骤执行。在对话中输出 Markdown 解析结果。

**步骤 B — 铸信息图（ljg-card -i）：**

以步骤 A 的解析内容为输入，按当前 agent 的可用方式执行 `ljg-card -i`。若不能直接调用 skill，就读取 `.agents/skills/ljg-card/SKILL.md` 并按其中步骤执行。生成 PNG 文件到 `outputs/ljg-word-flow/`。

### 3. 多词并行

多个单词时可以并行处理；每个单词内部 A→B 串行。

### 4. 汇总报告

```
════ 词卡完成 ═══════════════════════
📖 {Word1}
   🖼️ outputs/ljg-word-flow/{Word1}.png

📖 {Word2}
   🖼️ outputs/ljg-word-flow/{Word2}.png
...
```

## 关键约束

- 先解词后铸卡，顺序不可逆
- ljg-word 和 ljg-card -i 各自的质量标准不变
- 信息图内容来自解词结果，不是字典释义

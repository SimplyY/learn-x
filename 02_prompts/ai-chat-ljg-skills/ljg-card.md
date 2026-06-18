# ljg-card - AI Chat Prompt

> Source: .agents/skills/ljg-card/SKILL.md
> Purpose: 把内容铸造成视觉卡片、信息图、海报或漫画
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
name: ljg-card
description: "Use this skill to turn content into PNG visual cards, infographics, posters, comics, whiteboards, or big-font attachment cards saved under outputs/ljg-card/."
user_invocable: true
version: "2.3.0"
---

# ljg-card: 铸

将内容铸成可见的形态。内容进去，PNG 出来。模具决定形状。

## 参数

| 参数 | 模具 | 尺寸 | 说明 |
|------|------|------|------|
| `-l`（默认） | 长图 | 1080 x auto | 单张阅读卡，内容自动撑高 |
| `-i` | 信息图 | 1080 x auto | 内容驱动的自适应视觉布局 |
| `-m` | 多卡 | 1080 x 1440 | 自动切分为多张阅读卡片 |
| `-v` | 视觉笔记 | 1080 x auto | 编辑式杂志专题：问题→失败→转折→顿悟→命名（6 layout 模具 / 4 字族对比 / 探案档案细节）|
| `-c` | 漫画 | 1080 x auto | 日式黑白漫画风格，动态选择漫画家视觉语言 |
| `-w` | 白板 | 1080 x auto | 白板马克笔风格，结构化框图+箭头+彩色标记 |
| `-b` | 大字 | 1080 x 1440 | 碑刻大字 + 和紙 + 外阴影，小红书附件风格（单句/短段） |

## 约束

本 skill 输出为视觉文件（PNG），不适用 L0 中的 Markdown、Denote 和 ASCII-only 规范。

## 共享基础

### 获取内容

- URL --> 使用当前 agent 可用的网页读取能力 获取
- 粘贴文本 --> 直接使用
- 文件路径 --> 使用当前 agent 可用的文件读取能力获取

### 文件命名

从内容提取标题或核心思想作为 `{name}`（中文直接用，去标点，≤ 20 字符）。

### 截图工具

```bash
node assets/capture.js <html> <png> <width> <height> [fullpage]
```

从 skill 根目录运行。依赖 skill 根目录下的 `node_modules/` 中的 playwright。如报错：

```bash
npm install playwright && npx playwright install chromium
```

### Footer

- 左侧：logo + 李继刚（已硬编码在模板中）
- 右侧：内容来源（可选）——有明确来源时显示（如作者名、arxiv ID、网站名等），无来源时留空。使用 `{{SOURCE_LINE}}` 变量：有来源时填 `<span class="info-source">来源文字</span>`，否则空字符串。适用于 `-l`、`-i`、`-v`、`-c`、`-w` 模具（`-m` 多卡无 footer，不适用）。

### 交付

1. 报告文件路径

## 品味准则

**所有模具共享**。执行任何模具前，先读取 `references/taste.md`，作为视觉质量底线贯穿全流程。

核心：反 AI 生成痕迹——禁 Inter 字体、禁纯黑、禁三等分卡片、禁居中 Hero、禁 AI 文案腔、禁假数据。

## 执行

根据参数选择模具，读取 `references/taste.md` + 对应的 mode 文件，按步骤执行：

### -l（默认）：长图

读取 `references/mode-long.md`，按其步骤执行。

模板：`assets/long_template.html`

### -i：信息图

读取 `references/mode-infograph.md`，按其步骤执行。

模板：`assets/infograph_template.html`

### -m：多卡

读取 `references/mode-poster.md`，按其步骤执行。

模板：`assets/poster_template.html`

### -v：视觉笔记

读取 `references/mode-sketchnote.md`，按其步骤执行。

模板：`assets/sketchnote_template.html`

### -c：漫画

读取 `references/mode-comic.md`，按其步骤执行。

模板：`assets/comic_template.html`

### -w：白板

读取 `references/mode-whiteboard.md`，按其步骤执行。

模板：`assets/whiteboard_template.html`

### -b：大字

读取 `references/mode-big.md`，按其步骤执行。

模板：`assets/big_template.html`

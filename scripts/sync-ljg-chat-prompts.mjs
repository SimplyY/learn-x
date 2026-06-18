import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot =
  process.env.LJG_SKILLS_ROOT ??
  "/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills";

const purposes = {
  "ljg-book": "以问题为轴拆书",
  "ljg-card": "把内容铸造成视觉卡片、信息图、海报或漫画",
  "ljg-invest": "判断一个项目是否在创造新秩序",
  "ljg-learn": "多角度拆解一个概念",
  "ljg-paper": "把研究论文讲成聪明的非专业读者能复述的故事",
  "ljg-paper-flow": "读论文并把解读铸成视觉卡片",
  "ljg-paper-river": "追溯论文的思想源流与后续发展",
  "ljg-plain": "把复杂内容讲给普通人听",
  "ljg-present": "做分享稿、演讲稿、课件结构",
  "ljg-qa": "把文章、书、材料转成问题链",
  "ljg-rank": "给领域降秩，找最小生成器",
  "ljg-read": "通过翻译、注释、提问与洞见进行伴读",
  "ljg-relationship": "通过结构诊断与精神分析看见关系模式",
  "ljg-roundtable": "多角色圆桌讨论推进复杂议题",
  "ljg-skill-map": "把可用 Skill 整理成一目了然的能力地图",
  "ljg-think": "追问问题本质，把观点或现象钻到底",
  "ljg-travel": "城市文化研究、旅行卡片、深度漫游",
  "ljg-word": "从语义、用法与洞见层面掌握一个英文词",
  "ljg-word-flow": "解读英文词并生成词语信息卡",
  "ljg-writes": "把一个观点展开成文章",
};

const targets = [
  path.join(projectRoot, "02_prompts/ai-chat-ljg-skills"),
  path.join(projectRoot, "02_prompts/chatpack/ljg-skills"),
];

const wrapper = (name, purpose, source) => `# ${name} - AI Chat Prompt

> Source: .agents/skills/${name}/SKILL.md
> Purpose: ${purpose}
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

${source}`;

for (const target of targets) {
  await mkdir(target, { recursive: true });
}

for (const [name, purpose] of Object.entries(purposes)) {
  const sourcePath = path.join(sourceRoot, name, "SKILL.md");
  const source = await readFile(sourcePath, "utf8");
  const output = wrapper(name, purpose, source);

  for (const target of targets) {
    await writeFile(path.join(target, `${name}.md`), output, "utf8");
  }
}

console.log(`Synced ${Object.keys(purposes).length} Li Jigang prompts to ${targets.length} directories.`);

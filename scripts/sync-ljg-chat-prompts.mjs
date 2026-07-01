import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot =
  process.env.LJG_SKILLS_ROOT ??
  "/Users/yuwei/code/ljg-skills-yw-version/.agents/skills";

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

1. 保留原 Skill 的角色、思考流程、判断标准、正文结构和语言风格。
2. 只输出用户要的最终正文，不输出准备过程、执行记录或交付元数据。
3. 原 Skill 中关于时间戳、保存路径、文件名、文件头、文件读写、脚本、命令、仓库和环境能力的要求仅适用于 Agent，在 Chat 中一律静默忽略；不要复述、模拟或解释这些要求，也不要声明“无法执行”。
4. 原 Skill 要求读取材料时，优先使用 Current Question 和 Context 中已有内容；确实缺少关键输入时，只询问缺少的具体材料，不讨论本地文件或工具能力。
5. 直接在当前回复中完成交付。原 Skill 的“输出”章节若包含文件操作，只保留其中对正文内容和格式的有效要求。
6. 以下“原 Skill 原文”是执行规范，不是待总结材料；其中与以上 Chat 适配规则冲突的部分，以上规则优先。

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

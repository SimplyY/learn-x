# AI Chat 版李继刚 Skills

这个目录把李继刚 Skill 仓库中的全部 `ljg-*` Skill 转成可直接复制到 AI Chat 使用的提示词。

转换原则：

- 每个文件先给出 Chat 调用适配规则；
- 随后完整保留对应 `SKILL.md` 原文；
- 不把原 Skill 的文件读写、脚本执行能力伪装成 Chat 已经完成；
- 在 Chat 中无法访问本地环境时，转为向用户索取输入或直接基于已给材料完成。

## 文件索引

| Prompt | 用途 | 原 Skill |
| --- | --- | --- |
| [ljg-think.md](./ljg-think.md) | 追问问题本质，把观点或现象钻到底 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-think/SKILL.md` |
| [ljg-learn.md](./ljg-learn.md) | 多角度拆解一个概念 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-learn/SKILL.md` |
| [ljg-qa.md](./ljg-qa.md) | 把文章、书、材料转成问题链 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-qa/SKILL.md` |
| [ljg-book.md](./ljg-book.md) | 以问题为轴拆书 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-book/SKILL.md` |
| [ljg-rank.md](./ljg-rank.md) | 给领域降秩，找最小生成器 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-rank/SKILL.md` |
| [ljg-roundtable.md](./ljg-roundtable.md) | 多角色圆桌讨论推进复杂议题 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-roundtable/SKILL.md` |
| [ljg-writes.md](./ljg-writes.md) | 把一个观点展开成文章 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-writes/SKILL.md` |
| [ljg-plain.md](./ljg-plain.md) | 把复杂内容讲给普通人听 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-plain/SKILL.md` |
| [ljg-travel.md](./ljg-travel.md) | 城市文化研究、旅行卡片、深度漫游 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-travel/SKILL.md` |
| [ljg-present.md](./ljg-present.md) | 做分享稿、演讲稿、课件结构 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-present/SKILL.md` |
| [ljg-card.md](./ljg-card.md) | 把内容铸造成视觉卡片、信息图、海报或漫画 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-card/SKILL.md` |
| [ljg-invest.md](./ljg-invest.md) | 判断一个项目是否在创造新秩序 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-invest/SKILL.md` |
| [ljg-paper.md](./ljg-paper.md) | 把研究论文讲成聪明的非专业读者能复述的故事 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-paper/SKILL.md` |
| [ljg-paper-flow.md](./ljg-paper-flow.md) | 读论文并把解读铸成视觉卡片 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-paper-flow/SKILL.md` |
| [ljg-paper-river.md](./ljg-paper-river.md) | 追溯论文的思想源流与后续发展 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-paper-river/SKILL.md` |
| [ljg-read.md](./ljg-read.md) | 通过翻译、注释、提问与洞见进行伴读 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-read/SKILL.md` |
| [ljg-relationship.md](./ljg-relationship.md) | 通过结构诊断与精神分析看见关系模式 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-relationship/SKILL.md` |
| [ljg-skill-map.md](./ljg-skill-map.md) | 把可用 Skill 整理成一目了然的能力地图 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-skill-map/SKILL.md` |
| [ljg-word.md](./ljg-word.md) | 从语义、用法与洞见层面掌握一个英文词 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-word/SKILL.md` |
| [ljg-word-flow.md](./ljg-word-flow.md) | 解读英文词并生成词语信息卡 | `/Users/yuwei/Documents/ljg-skills-yw-version/.agents/skills/ljg-word-flow/SKILL.md` |

运行 `node scripts/sync-ljg-chat-prompts.mjs` 可从源仓库重新同步全部提示词。源仓库路径可通过 `LJG_SKILLS_ROOT` 覆盖。

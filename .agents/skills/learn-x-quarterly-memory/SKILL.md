---
name: learn-x-quarterly-memory
description: Learn-X 季度长期 Memory 审查与压缩。Use when the user asks to run the quarterly memory review, generate the quarterly compression pack, import ChatGPT-delivered memory candidates, or validate and promote quarterly memory compression.
---

# Learn-X 季度长期记忆审查与压缩

## 总览

把本 Skill 作为季度固定操作规程：每季度一次高质量长期记忆整理——ChatGPT 负责语义审查与最终文件，Codex 负责确定性上下文包、导入、校验、归档与安全晋级。核心目标是未来 AI 理解用户的准确性、上下文效率与可追溯性，不是压缩率。

## 触发

- 用户手动触发（如"季度记忆整理""季度 Memory 审查"）。
- 默认目标季度是最后一个在今天之前完整结束的自然季度；用户明确指定 `YYYY-QN`（或 `上季度`、`2026-Q3` 等表达）时按用户指定，但不接受尚未结束的季度。

## 快速命令

```bash
npm run memory:quarterly -- pack [--as-of YYYY-MM-DD] [--quarter YYYY-QN]
npm run memory:quarterly -- import <交付目录> [--quarter YYYY-QN] [--as-of YYYY-MM-DD] [--pack-ref <pack路径>]
npm run memory:compress -- --validate 04_output/_dist/memory-compression/quarterly-YYYY-QN/<目标>
npm run memory:compress -- --promote <候选目录> --confirm
```

## 阶段 1：生成季度上下文包（Codex · 确定性）

1. 执行前读取 `docs/LEARN_X_PROCESS.md`、`learn-x-process/resources/memory-compression-rules.md`（季度审查模式节）和本 Skill。
2. 运行 `npm run memory:quarterly -- pack`。脚本只读正式 Memory 与输入材料，生成 `04_output/_dist/memory-compression/quarterly-YYYY-QN/quarterly-compression-pack.md`（A 过去 / B 现在 / C 目标 / D 约束 / E 执行与交付五段，含冻结 Prompt 与交付契约）和 `quarterly-sources-manifest.json`。生成过程不得修改任何原始文件。
3. 向用户报告：目标季度与解析方式、目标文件状态、预算、缺口清单（不可得来源显式标记，不编造）、上下文包可点击路径。
4. 历史 monthly-era 候选（`_dist/memory-compression/YYYY-MM/`）与本流程解耦：仍可按原规则校验晋级，但不再新增。

## 阶段 2：ChatGPT 多轮认知审查（用户 · 语义）

1. 请用户把上下文包载入 ChatGPT（长期对话账号），按包内冻结 Prompt 执行；Codex 不得替 ChatGPT 做语义压缩判断，也不得改写 Prompt 语义。
2. ChatGPT 先独立审查并给出关键发现与推荐；有重要未知时每轮追问 1–3 个高信息增益问题；用户回答后更新判断。
3. 重大跨期修正（修改目标季度之外的文件）必须由 ChatGPT 逐项列出旧内容、新证据、建议改法与影响，并取得用户具体确认；未确认内容保持原样。
4. ChatGPT 直接交付：每个实际修改的目标文件一个完整 Markdown 正文 + `changes.json`（结构见上下文包交付契约；无需修改时 `noChange=true`）。中途可以停止；未晋级候选不影响正式 Memory。

## 阶段 3：导入与校验（Codex · 确定性）

1. 用户提供交付目录（ZIP 解包后同构）。运行 `npm run memory:quarterly -- import <交付目录>`：程序按真实仓库填充技术元数据（源哈希、预算、保护单元、`confirmedCorrections` 解析），ChatGPT 提供的哈希/字数一律忽略；随后逐候选自动校验。
2. `unitText` 必须在目标文件中唯一匹配，解析失败即拒绝导入——请用户修订交付后重试，不得手工猜测单元。
3. 已存在且内容不同的候选不会被覆盖；重复导入同一交付是幂等的。
4. 只报告 `ready`、`needs_review`、`stale` 或 `no_change`，不把校验通过描述为语义无损证明。

## 阶段 4：确认晋级（用户确认 → Codex 执行）

1. 逐候选目录执行 `npm run memory:compress -- --promote <候选目录> --confirm`；只有用户明确确认后才可运行。
2. 晋级会归档旧版到 `01_core/memory-archive/compression/<as-of>/<时间戳>/` 并逐文件回读哈希，原子替换正式文件并读回验证；失败自动回滚。
3. 跨年（目标季度为 Q4）：先晋级季度候选，再基于晋级后的真实仓库状态导入年度合并候选（年度候选使用 annualize 模式）；两阶段在同一次评审会话中顺序执行，避免重复压缩。
4. 晋级成功后按仓库 AGENTS.md Harness 接入规则尝试并记录 YWContext P1 同步状态；同步未验证时保持 `pending` / `unknown`。
5. 交付汇报：关键变化记录（保留/合并/删除/纠偏/风险，按真实变化）、归档路径、校验结果、剩余语义风险与预算冲突（如有）。

## 边界

- ChatGPT 对最终内容负责；Codex 只做导入、确定性校验、归档与安全晋级，不二次语义压缩。
- 预算冲突（超硬上限）停止晋级并报告，不静默删减、不绕过校验。
- 未确认的历史修改不得进入候选文件；确认纠偏必须逐单元可追溯。
- 不修改月记、周记、Monthly Output 正文机制；不动 Core 正式《道》《法》；定时任务永不自动晋级。
- 历史旧格式候选的兼容路径见 `learn-x-process/resources/memory-compression-rules.md`。

---
name: learn-x-weekly-automation
description: Learn-X 每周输入自动采集、Weekly Output 报告准备、已审核 Memory 迁移的中文自然语言工作流。Use when the user asks for "Learn-X 每周输入自动采集 & 报告 & 记忆", weekly report automation, W27/Wxx weekly processing, generating weekly `_dist` / Process Pack / Output shell, or preparing weekly memory candidates from reviewed Weekly Output.
---

# Learn-X 每周自动化

## 总览

把本 Skill 作为每周固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用已有采集器和 `learn-x-process` 命令。除非 Markdown 流程反复执行失败，否则不要新增编排脚本。

## 快速命令

```bash
npm run input:weread -- --week 2026-W27
npm run process:weekly -- --week 2026-W27
npm run memory:weekly -- --week 2026-W27
```

只运行当前阶段需要的命令。线上采集 daily / Flomo / weekly 时，必须加载 `web-access`，并在通过下方 Chrome CDP 前置检查后再操作。

## 启动规则

1. 除非用户指定周，目标周为 `Asia/Shanghai` 下刚结束的上一 ISO 周，格式使用 `YYYY-Www`。
2. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-input/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
3. 保持当前扁平周目录：`03_input/weekly/YYYY-Www/*.md`。不要恢复旧版 `00_log/`、`01_inbox/`、`02_action/` 嵌套结构。
4. 任何线上采集前，先加载 `web-access` 并运行：

   ```bash
   CLAUDE_SKILL_DIR=/Users/yuwei/.codex/skills/web-access node /Users/yuwei/.codex/skills/web-access/scripts/check-deps.mjs --browser chrome
   ```

   只有命令 exit 0，且输出包含 `browser: ok` 和 `proxy: ready` 时才继续。失败时立即停止，不写周输入、不生成 `_dist`、不生成报告、不写 Memory。
5. 不读取、打印或保存凭据。不修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或无关长期资产。

## 阶段判断

- 定时触发，或用户没有明确继续指令：只执行阶段 1。
- 用户说 `继续`、`周记和 AI 摘要已完成`、`继续采集周记` 或同义表达：对同一目标周执行阶段 2。
- 用户说 `继续记忆`、`报告已完成，写入记忆`、`Memorize`，或确认 Output / 芒格洞察 / 图片 / 公众号发布已完成：对同一目标周执行阶段 3。
- 不猜测人工项已经完成。到阶段门槛就停。

## 阶段 1：输入采集

目标：只采集自动来源，然后停止，等待用户完成人工周记和 AI 摘要。

1. 确保 `03_input/weekly/YYYY-Www/` 存在。保留目录中已有的人工内容。
2. 采集自动来源：
   - 飞书日记：通过 Chrome CDP 使用已登录状态。必须先取得真实完整字段表头和 field id 映射，再获取目标周日记多维表格 records。无法验证表头时停止该来源；不得猜字段名，不得用旧文件补齐。写入 `daily.md`，保留来源、日期范围、采集时间和字段 provenance。
   - Flomo：通过 Chrome CDP 使用已登录线上页面或 API。持续加载到覆盖目标周下界。只把目标周笔记按时间正序写入 `flomo.md`。不得只取首屏，不得用旧本地导出替代。
   - 微信读书：按 `learn-x-input` 执行 `npm run input:weread -- --week YYYY-Www`。验证输出保留目标周、Asia/Shanghai 范围、生成时间、阅读统计、进度快照、个人划线和想法，并包含完整 7 天，包括 0 分钟日期。
3. 阶段 1 不采集飞书周记。
4. 阶段 1 不生成 `_dist`，不创建或改写最终 Weekly Output。
5. 不访问 AI Chat 或 ChatGPT 历史。不创建、覆盖或编辑 `ai.md`。
6. 展示 `02_prompts/meta/_ai-chat-extract-prompt.md` 的当前完整正文。
7. 提醒用户完成飞书周记，并把 AI 摘要保存到 `03_input/weekly/YYYY-Www/ai.md`，然后回复 `继续`。

阶段 1 汇报必须包含：目标周、已完成来源、缺失或部分完成来源、`daily.md` / `flomo.md` / `weread.md` 路径、当前位置、下一步、再下一步。

## 阶段 2：周记采集与报告准备

目标：采集周记，验证必要输入，然后生成 `_dist` 和 Output 最小壳。

1. 先验证 `ai.md`。它必须非空、不是模板、不是提取提示词本身、不是自动缺口说明，并且包含目标周真实回顾内容。无效时立即停止，不采集 weekly，不生成 `_dist`，并再次展示 AI 摘要提示词。
2. `ai.md` 通过后，通过 Chrome CDP 从已登录的线上飞书周记文档采集目标周周记。只截取目标周段落。`weekly.md` 必须保留来源 URL、标题或日期定位依据、采集时间。无法取得线上正文时停止，不得用旧本地内容替代。
3. 生成 `_dist` 前，验证这些当前周输入：
   - `daily.md`
   - `flomo.md`
   - `weread.md`
   - `weekly.md`
   - `ai.md`
4. `build.md` 属于单独的 `Learn-X 每周「 Codex Build 复盘」` 自动化。本流程不得创建、改写或追加 `build.md`。如果已有有效 `build.md`，`learn-x-process` 可以纳入处理。
5. 运行：

   ```bash
   npm run process:weekly -- --week YYYY-Www
   ```

6. 汇报：
   - `04_output/_dist/weekly/YYYY-Www/input.json`
   - `04_output/_dist/weekly/YYYY-Www/process-pack.md`
   - `04_output/weekly/YYYY-WW.md`
   - 已完成来源、缺口、验证结果
7. 停止，等待用户进入人工 / Chat Pack 阶段。提醒用户按顺序完成：
   - 在 Learn-X Chat Pack 中使用 Weekly Output，并选择 `process-pack.md`。
   - 在 Chat Pack 中启用 `芒格之魂`，只生成独立洞察，不重写 Weekly Output。
   - 在最终周报中补充非空的 `芒格之魂的洞察 & 全文核心重点纪要`。
   - 使用周报底部核心内容生成本周图片，由用户人工发布。
   - 审核并勾选 Memory 候选。
   - 回复 `继续记忆`。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 人工 Weekly Output / 芒格洞察 / 图片 / 公众号发布 / 候选审核；再下一步 = 阶段 3 Memory。

## 阶段 3：已审核记忆

目标：生成 Memory 候选，只迁移已审核、已确认内容。

1. 验证 `04_output/weekly/YYYY-WW.md` 是目标周的实质性周报，不是空壳或模板。
2. 验证同一周报包含非空、实质性的 `芒格之魂的洞察 & 全文核心重点纪要` 区域。缺失时停止，不生成或迁移 Memory。
3. 用户回复 `继续记忆` 视为确认本周图片和公众号发布已人工处理。不得访问、验证、上传或发布微信公众号。
4. 生成或刷新候选：

   ```bash
   npm run memory:weekly -- --week YYYY-Www
   ```

5. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/weekly/YYYY-Www/memory-candidates.md`。
6. 只迁移：
   - `memory-candidates.md` 中已勾选的 checkbox 条目；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
7. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
8. 将获准条目写入正确的季度 Memory 目标。已勾选的 `法候选` / `术候选` 进入对应候选池。用户确认的 `芒格之魂` 洞察作为 Memory 候选观察池的独立候选，不自动升级为正式 `道 / 法 / 术`。
9. 保持幂等。重复运行不得追加完全重复条目。
10. 如果没有获准条目，停止并要求用户勾选或明确确认候选，不要编造 Memory。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、验证结果、当前位置、下一步和下次运行。

## 边界

- 不自动访问 AI Chat，不创建、覆盖或编辑 `ai.md`。
- 不在脚本中生成最终 Weekly Output 正文。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不上传图片，不发布微信公众号。
- 不写入正式 `道/`、`法/` 或 `术` 资产。
- 不按关键词迁移未勾选 Memory 候选。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标周以外的数据。
- 线上采集阻塞时，不降级使用过期本地文件。

## 汇报格式

每次运行必须包含：

- 目标周。
- 全局流程，并标记当前阶段。
- 已完成来源或产物。
- 阻塞项和缺口。
- 当前位置。
- 下一步。
- 再下一步。

汇报保持简洁，但不能省略阶段门槛。

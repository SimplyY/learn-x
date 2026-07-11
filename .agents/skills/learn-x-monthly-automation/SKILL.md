---
name: learn-x-monthly-automation
description: Learn-X 月度自动化中文工作流。Use when the user asks to prepare monthly input, collect original monthly Markdown only, generate Monthly Output `_dist` / Process Pack / Output shell, run month journal fill-empty-fields only, or migrate reviewed monthly Memory candidates.
---

# Learn-X 月度自动化

## 总览

把本 Skill 作为月度固定操作规程。流程逻辑维护在 Markdown 中；确定性工作复用 `learn-x-monthly-journal`、`learn-x-process` 和现有 npm 命令。除非 Markdown 流程反复执行失败，否则不要新增编排脚本。

## 快速命令

```bash
npm run process:monthly -- --month 2026-06
npm run memory:monthly -- 2026-06
```

先解析唯一目标月，再只执行当前阶段需要的步骤。默认目标月是 `Asia/Shanghai` 的上个月；用户明确指定 `YYYY-MM`、`本月`、`这个月`、`上月` 时，按用户指定。

## 启动规则

1. 执行前读取仓库当前说明：
   - `03_input/usage.md`
   - `03_input/README.md`
   - `04_output/usage.md`
   - `.agents/skills/learn-x-monthly-journal/SKILL.md`
   - `.agents/skills/learn-x-process/SKILL.md`
2. 月度输入目录使用 `03_input/monthly/YYYY-M/`，例如 `03_input/monthly/2026-6/`。不要按文件 mtime 推断范围。
3. 月度报告流程只生成 `_dist` 和 `04_output/monthly/YYYY-MM.md` 最小壳；不要在自动化中代写 Monthly Output 正文。
4. 不读取、打印或保存凭据。不修改 `README.md`、`01_core/道/`、`01_core/法/`、`02_prompts/` 或无关长期资产。
5. 月度原始输入同时来自 `03_input/weekly/YYYY-Www/` 和 `03_input/monthly/YYYY-M/`；后者保存月记及其他月度独有来源。不要读取 `04_output/weekly/` 代替原始输入。
6. 原始文件完整留在 `03_input/`，不要复制成月度全文合集。`input.json` 只保存路径、哈希、处理状态和压缩统计；`process-pack.md` 才是给 AI Chat 的自包含上下文。
7. 月度只保留目标月事件。边界周按正文日期、声明覆盖期和周记标题过滤；无法确认归属时省略并报告，不猜测。

## 阶段判断

- 定时触发，或用户没有明确继续指令：只执行阶段 1。
- 用户说 `继续`、`月记已完成`、`继续生成月报材料` 或同义表达：对同一目标月执行阶段 2。
- 用户说 `继续记忆`、`月报已完成，写入记忆`、`Memorize`，或确认 Monthly Output / 芒格洞察 / 候选审核已完成：对同一目标月执行阶段 3。
- 不猜测人工项已经完成。到阶段门槛就停。
- 同一轮自动化中，阶段 1 / 2 / 3 必须使用同一个已解析目标月；不要在后续阶段重新按当天日期推断。

## 阶段 1：月度输入准备

目标：只在月记存在明确空白或占位符时补全可安全写入的字段，汇总本月周输入到月度输入目录，然后停止，等待用户人工完成月记。

1. 调用 `learn-x-monthly-journal` 仅检查并补全目标月飞书月记中的空白或占位字段。它只在存在安全空位时写入带 `【待优化】AI 基础草稿` 的内容；若目标月已存在实质性正文或不存在安全空位，则跳过写回，只报告缺口。
2. 确保 `03_input/monthly/YYYY-M/` 存在。保留目录中已有人工内容，不覆盖已有非空文件。
3. 检查所有与目标月相交的周目录和 `03_input/monthly/YYYY-M/`。不要生成 `weekly-inputs.md`；保留已有月度人工文件，不覆盖。
4. 只报告来源范围、月记状态和缺口，不提前生成 Monthly Output。
5. 停止并提示用户在飞书月记中完成目标月月记，然后回复 `继续`。

阶段 1 汇报必须包含：目标月、月记草稿状态、已汇总周范围、`03_input/monthly/YYYY-M/` 路径、缺口、当前位置、下一步、再下一步。

## 阶段 2：月记采集与月报准备

目标：用飞书 CLI 采集已完成月记，生成 Monthly Output `_dist` 和 Output 最小壳。

1. 通过飞书 CLI 从月记文档采集目标月月记：

   ```text
   https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac
   ```

   只采集目标月 section。`monthly-journal.md` 必须保留来源 URL、标题或日期定位依据、采集时间。无法取得目标月正文时停止，不得用旧本地内容替代。
2. 验证 `03_input/monthly/YYYY-M/monthly-journal.md` 和所有相交周原始目录。旧 `weekly-inputs.md` 不参与处理。
3. 首次运行：

   ```bash
   npm run process:monthly -- --month YYYY-MM
   ```

4. 如果命令生成 `compression-requests.json` 并停止：
   - 完整读取 [`references/monthly-compression.md`](references/monthly-compression.md)。
   - 逐份读取请求指向的原始文件，由 Codex 按事件和重要性生成 `compressed-events.json`。
   - 再次运行同一个 `process:monthly` 命令；不得用脚本截断、关键词摘要或外部 AI API 代替 Codex 判断。
5. 汇报：
   - `04_output/_dist/monthly/YYYY-MM/input.json`
   - `04_output/_dist/monthly/YYYY-MM/process-pack.md`
   - `04_output/monthly/YYYY-MM.md`
   - 已完成来源、缺口、验证结果
   - 原始、过滤后、压缩后和最终体积；各来源压缩率、事件数量、省略原因、越界与无效来源
   - 明确说明：语义压缩由 Codex 完成，脚本只检测、校验和组装
6. 停止，等待用户进入人工 / Chat Pack 阶段。提醒用户按顺序完成：
   - 在 Learn-X Chat Pack 中使用 Monthly Output，并选择 `process-pack.md`。
   - 在 Chat Pack 中启用 `芒格之魂`，只生成独立洞察，不重写 Monthly Output。
   - 在最终月报中补充非空的 `芒格之魂的洞察` 或同义区域。
   - 审核并勾选 Memory 候选。
   - 回复 `继续记忆`。

阶段 2 汇报必须包含完整全局流程，并标记：当前位置 = 阶段 2 完成；下一步 = 人工 Monthly Output / 芒格洞察 / 候选审核；再下一步 = 阶段 3 Memory。

## 阶段 3：已审核记忆

目标：生成 Memory 候选，只迁移已审核、已确认内容。

1. 验证 `04_output/monthly/YYYY-MM.md` 是目标月的实质性月报，不是空壳或模板。
2. 验证同一月报包含非空、实质性的 `芒格之魂` 洞察区域。缺失时停止，不生成或迁移 Memory。
3. 生成或刷新候选：

   ```bash
   npm run memory:monthly -- YYYY-MM
   ```

4. 读取 `.agents/skills/learn-x-process/resources/memory-rules.md` 和 `04_output/_dist/monthly/YYYY-MM/memory-candidates.md`。
5. 只迁移：
   - `memory-candidates.md` 中已勾选的 checkbox 条目；
   - 用户在当前线程明确确认写入的条目；
   - 当前 `learn-x-process` Skill 定义的结构化显式确认标记。
6. 不迁移未勾选条目。普通未勾选正文中的 `重要`、`保留`、`确认`、`继续追踪` 等关键词不构成确认。
7. 将获准条目写入正确的季度或年度 Memory 目标。保持幂等，重复运行不得追加完全重复条目。
8. 如果没有获准条目，停止并要求用户勾选或明确确认候选，不要编造 Memory。

阶段 3 汇报必须包含候选数量、实际迁移数量、目标文件、去重结果、验证结果、当前位置、下一步和下次运行。

## 边界

- 不自动访问 AI Chat；不在自动化中生成 Monthly Output 正文。
- 允许 Codex 为 Process Pack 生成 `_dist` 压缩事件；这不是 Monthly Output，也不得写回原始 Input。
- 不在自动化中生成 `芒格之魂` 洞察。
- 不上传图片，不发布微信公众号。
- 不写入正式 `道/`、`法/` 或 `术` 资产。
- 不按关键词迁移未勾选 Memory 候选。
- 未经用户明确给出路径并确认范围，不读取项目外私人导出。
- 不混入目标月以外的数据。
- 线上或飞书采集阻塞时，不降级使用过期本地文件。

## 汇报格式

每次运行必须包含：

- 目标月。
- 全局流程，并标记当前阶段。
- 已完成来源或产物。
- 阻塞项和缺口。
- 当前位置。
- 下一步。
- 再下一步。

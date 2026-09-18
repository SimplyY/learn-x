# Requirement Evaluator v7｜方案设计（最小修改面）

需求基线：能力圈决策 + IN/OUT/TOO HARD + 自适应评审深度（快速/标准），只改两个行为源；飞书实时 Prompt 继续是唯一评审行为真源。

## 评审材料

| 文件 | 用途 |
| --- | --- |
| `prompt-drafts/requirement-evaluator.review-v7.md` | v7 全量正文（发布的内容） |
| `prompt-drafts/v6-to-v7.diff` | 与线上 revision 30 的精确差异（23 增 8 删） |
| `prompt-drafts/requirement-evaluator.review-v6.current.md` | 当前线上正文快照（对照用） |

`prompt-drafts/` 是仓库根的临时未跟踪目录，发布并提交后整体删除。

## 现状核实（2026-09-18）

| 事实 | 值 |
| --- | --- |
| 真源 Prompt | `requirement-evaluator.review`，飞书文档 `KbcVdYnDjoqW9KxZkmDcH1Kxntf`（wiki `O4HUw1rcgiGvCAkgqJGcKa4cnbc`） |
| 当前版本 | revision 30，正文标记 `requirement-evaluator.review/v6`，sha256 `ca05e4…73ad` |
| 机器写口 | `publish-prompt.mjs`（写前复核 base revision + 写后读回，fail closed），禁止直接 `docs +update` |
| `/v6` 门禁消费方 | 仅 `skills/requirement-evaluator/SKILL.md`（工作流第 6 步）和 `references/context-pack.md`（第 5 节），全库 grep 确认无其他 |
| Skill 落盘 | `~/.codex/skills/requirement-evaluator` → 符号链接到 `/Users/yuwei/code/skills/requirement-evaluator`（git 仓库，工作区干净） |
| 本地 Prompt 副本 | 无。该 Prompt 不在 learn-x `00_config/prompt-assets.json`，消费时实时 fetch，失败即停 |

## 改动面 A｜飞书真源 Prompt：v6 → v7

净增约 900 字（+25%），七处改动，diff 已核对，其余段落逐字保留：

1. **版本标记**：`prompt-contract: requirement-evaluator.review/v6` → `/v7`。
2. **角色定义**（+2 句）：先判断能否可靠判断，再判断值不值得做；深度由错误判断的潜在代价决定，不由名义大小决定。
3. **新增「能力圈与最终决策」**（置于核心判断之后）：
   - 评分解释"为什么"，最终裁决收口为 IN / OUT / TOO HARD 三选一，不输出第二套平行结论；行动建议与三分类对齐（IN→继续/先验证，OUT→延后/放弃，TOO HARD→停止并等重审条件）。
   - IN / OUT / TOO HARD 定义照需求基线第 4 节；TOO HARD 必须按 `TOO HARD｜越界原因｜重新评审条件` 输出，给格式锚点示例。
   - 能力圈七类成本（认知/证据、Token、维护、系统复杂度、业界成熟度、用户能力与时间、风险）+ 单一核心检验；明确"不是永久墓地、不能当逃避分析的出口"。
4. **「提问与轮次」→「评审深度与轮次」**：
   - 新增路由段：先定深度，只设两档；深度 = 重要性 × 不确定性 × 影响面 × 不可逆性 × 长期复杂度 + 异常风险检查；用户说"小需求/优化/快速"只是输入事实。
   - 快速评审：一轮收口，闭环 = 需求穿透 → 最强反证 → 复用检查 → 能力圈判断 → 优化后需求 → IN/OUT/TOO HARD → 验证与停止条件；无实质变化直接收口；重大重定义停在"新的需求基线建议"等用户确认。附成本护栏：复用检查优先核对现有能力，不为局部改动展开完整业界调查。
   - 标准评审：十条升级信号（升级须说明原因）；高重要性 + 哪怕一定复杂性优先标准评审。
   - 第一轮开头加"先判定评审深度并说明理由"；删除原"简单需求 500–800 字内可一轮终评"（已被快速评审取代，减少重叠数字规则）；第三轮输出项插入"最终裁决 IN / OUT / TOO HARD"。
5. **结束评审｜完整需求方案**：从"合并总结"升级为"重新从第一性原理检查 + 全对话上下文整合"，14 项内容清单，新增"不无依据推翻已确认决定、重大冲突显式标记"。

未动：双评分、五维评分、核心需求对齐（需求冻结）、第二轮、业界对照与复用、证据与边界。

成本账：固定输入成本约 +25%（每轮）。快速模式把原本 2–3 轮压成 1 轮，低风险需求单次评审总 Token 预计显著下降；标准需求成本基本不变。是否符合预期由回放验证，不预写数字。

## 改动面 B｜Requirement Evaluator Skill（2 个文件，4 处）

**SKILL.md**（`/Users/yuwei/code/skills/requirement-evaluator/SKILL.md`）：

```diff
-description: "触发词：「requirement-evaluator」「需求上下文包」「需求评估」「评估需求」「给需求打分」「评价需求质量」「评价需求价值」。…"
+description: "触发词：「requirement-evaluator」「需求上下文包」「需求评估」「评估需求」「给需求打分」「评价需求质量」「评价需求价值」「需求评审」「需求优化」「小需求」。…"
       - 评价需求价值
+      - 需求评审
+      - 需求优化
+      - 小需求
-   必须确认 `prompt_id`、user 身份、完整正文和 `requirement-evaluator.review/v6`。读取失败时停止，不使用旧正文。
+   必须确认 `prompt_id`、user 身份、完整正文和 `requirement-evaluator.review/v7`。读取失败时停止，不使用旧正文。
```

**references/context-pack.md**（第 5 节门禁，1 行）：

```diff
-- 正文包含 `requirement-evaluator.review/v6`。
+- 正文包含 `requirement-evaluator.review/v7`。
```

版本门禁升级（2 行）超出"只加触发词"的最小授权，已获方向确认；理由：评审行为契约实质变更，版本标记应如实升级，不同步则 fetch 门禁对 v7 正文 fail closed，整条链路断。Skill 不复制三分法、模式判断算法或评审流程（红线未触碰）。

## 明确不做

不新增 Skill、脚本、数据库、持久化评分、自动审批器、Agent 路由、Prompt 副本；不建本地缓存（该 Prompt 本就实时 fetch）。

## 实施步骤（你确认草稿后执行）

```bash
# 1) 重新读取真源，确认发布基准 revision（当前 30；若远端已推进则重读重判）
node ~/.codex/skills/prompt-governance/scripts/fetch-prompt.mjs requirement-evaluator.review
# 2) 经统一写口发布（写前复核 + 写后读回，输出 prompt-publish/v1 收据）
node ~/.codex/skills/prompt-governance/scripts/publish-prompt.mjs requirement-evaluator.review \
  --content-file /Users/yuwei/code/learn-x/prompt-drafts/requirement-evaluator.review-v7.md \
  --base-revision 30
# 3) 读回验证：新 revision + 正文含 /v7 标记
node ~/.codex/skills/prompt-governance/scripts/fetch-prompt.mjs requirement-evaluator.review | grep -c "requirement-evaluator.review/v7"
# 4) 修改 Skill 两文件（路径在 session workspace 之外，需一次写权限批准）
# 5) 冒烟：真实消费者门禁通过（fetch 校验 /v7）＋ skills 仓库提交（遵循其 AGENTS.md）
# 6) 删除 prompt-drafts/ 临时目录
```

读回比对失败（如标题行往返改写）时发布脚本自身 fail closed，停止排查，不强行重发。该 Prompt 无本地 Snapshot，governance 要求的"发布后 pull"不适用；冒烟以真实消费者 fetch 门禁代替。

## 验证方案（需求基线第 13 节，发布后由用户在 ChatGPT 侧执行）

| 回放案例 | 预期 |
| --- | --- |
| 明显局部小优化 | 快速模式一轮收口，含完整闭环与 IN/OUT/TOO HARD |
| 普通但有一定影响面 | 标准模式（默认两轮） |
| 重要、复杂或长期影响 | 深度标准评审（两至三轮） |
| 高价值但超出资源/认知 | `TOO HARD｜原因｜重审条件`，而非 OUT |

只观测三件事：分流是否正确；快速模式是否实际减少 Token 与交互；是否漏掉足以改变方向的重要问题。任一失败模式重复出现，才触发下一轮 Prompt 修改（停止条件）。

## Pre-mortem 防线对照

| 预警信号 | 本设计的防线 |
| --- | --- |
| 路由规则膨胀 | 只两档；十条升级信号收敛进一条清单；删除旧"500–800 字"重叠规则 |
| TOO HARD 变垃圾桶 | 定义句 + "不是永久墓地/不能逃避分析" + 必须带重审条件 |
| TOO HARD 与 OUT 混淆 | OUT 定义强调"看清后的否定、必须给依据、不得混用" |
| 两套平行结论 | "不输出第二套结论"+ 行动建议与三分类对齐条款 |
| "小需求"浅评高影响改动 | 路由段明说用户措辞只是输入事实；十条升级信号含"影响多个模块/难回滚/安全隐私" |
| Prompt 越改越长 | 净增约 25% 已是上限；快速模式本身省往返；回放验证不达标则回收规则 |
| 双真源 | 评审规则只在飞书正文；Skill 仅触发词 + 版本门禁 |

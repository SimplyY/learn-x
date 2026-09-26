# Execution Plan｜WeRead 存量划线归档与周度精读

- 状态：In Progress（2026-09-26）
- Requirement：[weread-highlights](../../requirements/weread-highlights.md)（已冻结）· ADR：[0002](../../adr/0002-weread-archive-and-jingdu.md) · Case：[case.md](case.md)
- 实施授权：用户已通过持续开发 goal（2026-09-26）授权本计划全部里程碑；精读飞书文档创建/写入授权为独立 Gate。

## 0. 实测事实基线（Spike，2026-09-26，只读全量，487 次调用零错误）

- 198 本有笔记的书、8,458 条划线、883,940 码点（UTF-8 2,609,281 字节）；想法 121 条仅 3,080 字符（周度候选池无压力）。
- 闭合校验：逐书实测 = noteCount（198/198）；8,458 + 121 想法 + 4 书签 = 8,583 = 服务端 totalNoteCount。
- 分类：小说类 23 本 / 66,603 码点；其余 175 本 / 817,337 码点（含「文学-*」17 本与无分类 24 本，默认非小说，manifest 可复核）。
- 体积：聚合单文件不可行（非小说 ≈3.1MB）；最大单书 56,713 码点（单书整体均可入上下文）→ **按书一文件定稿**。
- API：串行 250ms 间隔全量拉取 2.9 分钟，0 限流 0 重试 → 无需并发。
- 账号阅读跨度 ≥6 年；划线级 createTime 可从 bookmarklist 获取（首跑回填年度分布）。

## 1. 不变量（实施与验收的共同前提）

1. 全量唯一真源：`05_library/weread/` 目录整体为唯一全量归档，不生成聚合副本；每次全量重建幂等覆盖。
2. 存量不蒸馏、不删减；保留书名/作者/章节来源语义；划线原文引用块呈现，不表达为用户观点。
3. Chat Pack：显眼（05_library 顶层分组）、默认不勾选（非推荐源默认 none）、用户主动勾选、按年粒度（年 × 分类文件，书整本归主划线年）。
4. 隐私：`05_library/` 排除公开构建；API Key 只从 Keychain 读，不入日志/仓库/测试。
5. 精读：AI 候选 → 用户在飞书加工 → 口令确认 → 读回生成 `jingdu.md`；未经用户参与的 AI 总结不得进入。
6. jingdu 与 Flomo 同级：阶段 1 固定总表 + 阶段 2 验证清单；缺失/empty 不阻塞但提示缺口。

## 2. 目标数据流

```mermaid
flowchart LR
  subgraph 每周（Code X 精读自动化，周日晚）
    A[npm run input:weread-archive<br/>全量重建 05_library/weread/] --> B[读当周 weread.md<br/>生成精读候选]
    B --> C[飞书精读文档<br/>候选→用户加工]
    C -->|口令：精读已完成| D[读回飞书文档]
    D --> E[写 03_input/weekly/W/jingdu.md<br/>+ input:source-status ready]
  end
  subgraph 周一（Learn-X 周自动化）
    E --> F[process:weekly<br/>总表纳入 jingdu 行]
  end
  A --> G[Chat Pack 上下文树<br/>小说/非小说两入口·按书勾选]
  A --> H[每周备份<br/>BACKUP_ROOTS 含 05_library]
```

## 3. 里程碑

### M1 存量归档脚本与集成开关（已实施，按书结构改造中）

- 改动：新增 `.agents/skills/learn-x-input/scripts/collect-weread-archive.mjs`（+test）；根 `package.json` 加 `input:weread-archive` / `test:input:weread-archive`；`static-graph.mjs:64` 加 `"05_library/"` 私有前缀；`backup-weekly.mjs:13` BACKUP_ROOTS 加 `"05_library"`（含测试 fixture 同步与旧 manifest 子集校验兼容）；`docs/TECH.md` 补一句。
- 输出结构：`fiction/<书名清洗>-<bookId>.md` ×23、`nonfiction/…` ×175、`_index.md`（年份→书目索引）、`_manifest.json`（分类分布/逐书明细/闭合校验）。
- 验证：注入 callApi 的单测（分类映射、分页、文件名清洗、幂等、失败不落盘、旧书清理）+ 备份测试 + test:app。
- 证据：测试输出；首次真实运行统计（回填本节下方）。
- 回滚：删除新增文件 + git revert 三处一行改动；`05_library/` 删除无任何下游依赖。

**M1/M3 首跑实测（2026-09-26 回填）**：198 书 / 8,458 划线 / 883,823 码点（归一化后落盘口径，与 Spike 原始口径差 117 码点 = 0.013%）；小说 6 个年文件 23 本 / 686 条 / 66,603 码点；非小说 9 个年文件（2018–2026）175 本 / 7,772 条 / 817,220 码点；无有效日期书 0；耗时约 3 分钟、零限流。char 口径说明：manifest 统计 = cleanText 空白规整后实际落盘文本码点，即文件真实体积。

### M2 jingdu 周输入源注册（已完成 2026-09-26）

- 改动：`source-status.mjs` L8/L12 注册；`collect-weekly-input.mjs:309` inbox 归类；`generate-weekly-process-pack.mjs:18` FIXED_WEEKLY_INPUTS 紧跟 weread；`learn-x-weekly-automation/SKILL.md` L134 总表 + L163 阶段 2 验证清单；模板 `00_template/jingdu.md`；`03_input/README.md` L72。
- 裁决记录：SKILL.md L174 周六日提前稿豁免名单**不加** jingdu（用户产物只有完成/未完成两态，无部分覆盖语义）。
- 验证：input 测试 9/9、process 测试 101/101（含新增 fail-closed、empty、固定顺序断言）。
- 回滚：git revert 上述 8 处；无数据迁移。

### M3 首次真实运行与端到端核验（已完成 2026-09-26）

- 实施中发现并修复：分类用 8 词精确匹配导致 fiction=0（真实 category 形如「精品小说-玄幻小说」）——改为一级分类（"-"前）含「小说」或命中词表判 fiction，补 10 用例单测；SKILL_VERSION 曾被误改为 1.1.0，已恢复 Gateway 协议值 "1.0.4"。
- char 口径（M4 审查修正）：manifest chars = cleanText 空白规整后**划线正文**码点（totals/perBook/yearDistribution 自洽）；年文件落盘体积另含 Markdown 脚手架约 +9.4%（首跑实测 967,266 码点），两口径不同、各自用途明确。
- 结果：首跑两轮成功；全量 `npm test` 367/368（唯一失败为 learn-x-monthly-question-workbench 既有失败，与本 case 零 import 交集、目录无未提交改动）；`test:app` 38/38；local 构建 151 文件/38 prompts 且图含 05_library 分组，public 构建 118 文件/28 prompts 且图数据 0 命中 05_library。
- 安全扫描：pre-commit 内容扫描在提交时会覆盖 staged 的 05_library 文件（仅内容 pattern，无私有路径强制拦截）；是否提交归档、是否为 05_library 增加路径级规则 = 用户决策点（Gate）。
- 证据：05_library/weread/ 产物 + 上述命令输出；M4 对抗性审查报告。

### M4 对抗性审查与修复

- 反向验证：两包/单书超限行为、jingdu 未经确认不可进 Process（fail-closed）、未注册来源绕过状态契约的回归、公开构建泄漏、备份/刷新幂等、文件名清洗边界（特殊字符/重名/超长）。
- 修复后回测全部相关测试。

### M5 观察期（数个真实周，独立 Gate）

- 验证 Requirement §7 两个现实结果：精读是否真实发生认知加工；存量是否被实际勾选且有用。
- 停止条件与调整优先级见 Requirement §7（调交互/候选数/粒度，不加自动化复杂度）。

## 4. 验收矩阵（需求 → 实现 → 验证 → 证据）

| 需求 | 实现 | 验证 | 证据 |
|---|---|---|---|
| R1 全量、不蒸馏、来源语义 | collect-weread-archive 全量拉取按书落盘 | 闭合校验 8,583；抽查文件 | manifest + 首跑输出 |
| R1 两入口/默认关/按书 | 目录分组 + 非推荐源默认 none | local 图含 05_library 分组；树断言/人工核验 | 构建产物 |
| R1 降级（按年） | 年 × 分类文件、书整本归主划线年（2026-09-26 用户裁决，替代按书文件） | 单年文件体积与勾选行为；_index 按年列书 | manifest yearDistribution + 首跑产物 |
| R2 精读保留人的加工 | 飞书候选→用户加工→读回 | 读回校验含用户判断；状态 ready 语义 | M5 观察期 |
| R3 独立输入源与同级权重 | SOURCE_FILES 注册 + 总表/验证清单 | 单测 9/9、101/101 | 测试输出 |
| R4 不建第二资产 | jingdu 止于 03_input | 代码审查：无新长期资产目录/晋级机制 | git diff 审查 |
| 隐私 | 私有前缀 + Key 不落盘 | public 构建断言 + 全产物 wrk- 扫描 | 构建与扫描输出 |

## 5. 残余风险与未知

- 年度分布需首跑回填（Spike 未存 createTime）。
- 「文学-*」与 24 本无分类书默认非小说，可能含个别小说误入；manifest 可见，映射一行可改。
- 精读飞书授权与文档形态（固定文档+按周段落，推荐沿用周记模式）为独立 Gate。
- 198 文件进树的 UI 噪声：折叠分组可接受；若观察期反馈差，再考虑目录内排序优化，不预先加复杂度。

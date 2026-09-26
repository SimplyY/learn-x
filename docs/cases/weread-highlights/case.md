# CASE: WeRead 存量划线调用与周度精读

- Type: Minor（单仓库、无破坏性迁移、回滚简单）
- Status: In Progress（2026-09-26 节点②文档完成，节点③实施中——用户已通过持续开发 goal 授权）
- 开始于：2026-09-26
- Requirement: [weread-highlights](../../requirements/weread-highlights.md)（已冻结）
- Architecture / Planning: [architecture.md](../../architecture.md) · [execution-plan.md](execution-plan.md)
- ADR: [0002 存量划线全量归档与周度精读输入源](../../adr/0002-weread-archive-and-jingdu.md)
- Acceptance: 按 [Requirement §5 验收矩阵](../../requirements/weread-highlights.md) 执行；观察期见其 §7 停止条件
- Version: WeRead 输入 v1（周度 weread.md）→ v2（+ 存量全量包 `05_library/weread/` + 周度精读 `jingdu.md`）

## 关键产物

- 冻结需求：`docs/requirements/weread-highlights.md`（R1–R4、验收矩阵、停止条件）
- ADR 0002：单一全量包不蒸馏、Chat Pack 上下文树承载、jingdu 独立输入源、不建第二资产体系
- 执行计划：`execution-plan.md`（里程碑、验收、回滚、降级预案）
- 实施产物：`05_library/weread/`（fiction/ 与 nonfiction/ 按书一文件 + `_index.md` + `_manifest.json`）、`collect-weread-archive.mjs`、jingdu 来源注册与模板
- 实测基线（Spike 2026-09-26）：198 书 / 8,458 划线 / 883,940 码点 / 全量拉取 2.9 分钟零限流；聚合包不可行，按书结构定稿（ADR 0002）

## 授权边界（Gate）

用户已通过持续开发 goal（2026-09-26）授权实施本 Case 全部里程碑，包括：

1. 用 Keychain 中的 WeRead API Key 做只读数据核验与存量全量拉取（不外发、不写入远端）。
2. 新增 `05_library/weread/` 目录、归档采集脚本与 npm 命令。
3. 修改 Chat Pack 私有前缀、备份根、来源契约、周自动化文档与相关测试。

仍须用户单独确认的事项：

1. ~~精读飞书文档的创建与持续写入授权~~ → **已授权（2026-09-26 用户确认「提交和都授权」）**：Code X 精读自动化可按周以用户身份（`--as user`）新建精读文档并写入候选，无需每次再确认。
2. ~~归档是否纳入版本控制~~ → **已授权提交**：`05_library/` 随本 Case 交付提交，git 成为周备份之外的第二留存层。
3. 任何对既有 `03_input/weekly/` 历史周目录的写入（仍须逐次确认）。

## 工作区保护（实施时必须遵守）

- 仓库存在与本 Case 无关的未提交改动（long-article-research 退役、`.gitignore`、`AGENTS.md`、`GROUP_INFO.md`、`package.json`、`scripts/security-scan.mjs`、`retired/` 等）：实施叠加其上，不清理、不还原、不覆盖。
- 不执行 `git clean`、`reset --hard` 或任何不可逆操作；未经用户确认不删除未提交内容。
- API Key 只从 Keychain 读取，不得出现在命令输出、日志、测试或仓库文件中。

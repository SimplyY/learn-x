 

# 最近两周 Codex Build 核心记录

## 覆盖范围

2026-05-21 至 2026-06-04。主要证据来自 Learn-X 仓库提交、W22 build 复盘、当前未提交改动，以及本地 Codex 会话中能和文件变更互相印证的内容。

## 核心构建事项

1. 将 Learn-X 的定位从“知识库 / Prompt 仓库”进一步收敛为“个人认知进化系统”。核心边界变成：审稿只是 Weekly / Monthly / Yearly Output 的周期环节，人做最终价值判断，AI 做判断草稿和压缩，脚本只做确定性搬运、清洗、索引、追踪。

2. 完成一次大目录重构：把长期认知资产、Prompt、输入、输出、应用代码拆成 `01_core/`、`02_prompts/`、`03_input/`、`04_output/`、`app/`。同时把旧的 `道/法/input/output/code/assets` 迁入新结构。

3. 推进 Chat Pack 体系：从普通 Prompt 入口升级为“对话类型 + 子类型 + 增强器 + 上下文编排”的对话启动器。沉淀了学习、判断、创造、画图、其他等入口；更完整的语义放入各大类描述中。

4. 系统性整理 Prompt 资产：重写或新增 `book-decode`、`ai-tutor`、`domain-research`、`system-audit`、`daofashuqi-audit`、`broad-investment-decision`、`codex-build`、`meta-prompt`、`munger-soul`，并补充长度增强器和挑战观点、现实验证等思考增强器。

5. 构建 `learn-x-process` Skill：明确 Weekly Process 的边界，脚本只生成 `input.json` 和 `process-pack.md`，Codex 根据规则生成 Weekly Output，人再决定是否进入 Memory 或长期资产。

6. 跑通 W22 周流程：生成 `04_output/_dist/2026-W22/input.json`、`process-pack.md`、`04_output/weekly/2026-22.md`，并沉淀极薄 Memory 到 `01_core/memory/2026-Q2.memory.md`。

7. 建立 Codex Build 复盘机制：新增并使用 `2026-05-27_weekly-codex-build.md`、`2026-05-31_weekly-codex-build.md`，让 Codex 构建过程本身成为 action/build 输入，而不是只留在聊天记录里。

8. 重构 `03_input`：从扁平的 `inbox/action/log/index` 调整为 `weekly/monthly/yearly` 三个周期维度。Weekly Process 现在读取 `03_input/weekly/YYYY-Www/`，不再依赖 weekly index 或文件修改时间猜测范围。

9. 优化每周输入模板：把 `03_input/weekly/00_template/` 和 `2026-W23/` 中每周只维护一份文字的入口改成 `.md` 文件，例如 `action/build.md`、`action/meeting.md`、`log/weekly.md`；多文件或外部导入来源继续保留文件夹。

10. 新增 `03_input/usage.md`，把每周输入管理 SOP 从 README 中抽出，明确人工、自动化、半自动三类职责，降低每周忘记流程的概率。

## 对 Learn-X 的意义

这两周的主线不是“多做功能”，而是把系统边界调清楚：长期资产不被自动改写，输入证据可追溯，Weekly Output 可审核，Codex 构建过程也能进入行动证据。Learn-X 开始从资料整理系统，变成能持续记录行动、反馈和判断变化的认知工作台。

## 当前仍需跟进

- 当前工作区还有大量未提交变更，尤其是 `03_input` 目录腾挪、`learn-x-process` 脚本、README/usage 文档和生成

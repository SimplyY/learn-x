---
name: learn-x-monthly-question-workbench
description: 为 Learn-X 运行月度议题研究工作台：推荐、用户选择、创建飞书研究文档、解析明确变化、可审计回写与撤回。用于“启动工作台”“重新推荐”“提交月度研究文档”等请求，不用于旧周/月复盘。
---

# 月度议题研究工作台

这是长期注意力配置与研究闭环，不是提醒、待办或月报。议题是唯一原子对象，可以是问题，也可以是目标；目标通常更接近中期和短期，长期问题可以不设目标。先读 [产品宪法](../../../docs/MONTHLY_CORE_QUESTION_WORKBENCH.md)；提交、重解析或撤回前读 [提交契约](references/submission-contract.md)。

运行 `npm run inquiry:monthly-workbench -- <command>`，脚本只处理确定性读写，不调用外部 AI。

- 启动或重新推荐：运行 `recommend --month YYYY-MM`；只有用户明确要求重新推荐且尚未创建文档时才加 `--refresh`。
- 用户选择可以是候选序号（`123`、`1、3、5`、`前三个`、`都研究`、`按默认`）或议题标题。用 `select --month YYYY-MM --input '123'` 解析并先向用户回显映射；用户未回复不得创建文档。
- 创建：将最终稳定 record ID 数组传给 `create --month YYYY-MM --selection-json -`。新文档创建为「人生核心议题/细项研究」Wiki 子节点并返回 Wiki 链接；历史 Base Docx 账本仍可读，文档已存在时只返回原链接，绝不覆盖用户内容。
- 提交：先 `snapshot`，使用同一 revision 的所有选题小节形成 proposal；需要外部推理时按[提交契约](references/submission-contract.md)的 Bridge 调用规则取得完整正文。脚本 `apply --proposal-json -` 会拒绝没有原文证据、block ID、Schema 一致性或状态快照的写入。
- 只提取明确变化。议题周期、优先级、研究状态、阶段、未知和下一步本身不是事件；无进展时事件数组必须为空。判断更新必须有与字段前后值一致的对应事件。
- 纠错只能是用户编辑文档后重解析，或运行 `rollback` 撤回上一版。不要从聊天口述直接修改 Base。
- Base 写入使用用户身份，读后校验；任何结构漂移、并发修改、分页异常或证据不一致都停止，不降级到旧 Skill 或缓存。

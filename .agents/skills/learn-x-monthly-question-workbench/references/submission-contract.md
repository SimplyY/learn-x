# 月度工作台提交契约

提交表示解析当前飞书文档版本，不表示研究完成，也不表示必须产生认知事件。读取流程是：先取得 outline 和 revision，再以同一 revision、带 block ID 的 section 逐题读取。

提案必须是 JSON：

```json
{
  "month": "2026-09",
  "documentToken": "docx...",
  "revisionId": 12,
  "changes": [{
    "issueId": "IQ-0001",
    "fields": {"当前判断": "...", "研究状态": "继续研究"},
    "clear": []
  }],
  "events": [{
    "issueId": "IQ-0001",
    "type": "判断更新",
    "summary": "...",
    "detail": "...",
    "increment": "...",
    "evidence": "文档原文中的短片段",
    "blockId": "blk...",
    "before": "旧判断",
    "after": "新判断"
  }],
  "unprocessed": [{"issueId": "IQ-0002", "reason": "只有议题和材料，未见明确变化"}]
}
```

只允许更新：`议题周期`、`优先级`、`研究状态`、`阶段`、`当前判断`、`判断置信度`、`最大未知`、`改变判断的条件`、`下一步`。议题周期规范值是“短期 / 中期 / 长期”；历史“短期核心问题 / 中期核心问题 / 长期核心问题”只在迁移期间兼容。填写固定值“清空”或列入 `clear` 才清除字段；删除文档文字不代表清除。

事件只限：证据、判断更新、问题重构、决策、行动或实验、现实结果、校准。每条事件必须有可定位的同版本原文证据和 block ID；来源系统/链接只能来自文档明确文本。当前判断改变时，判断更新事件的前后值必须与实际字段变更完全一致。不能确定时列入 `unprocessed`，不猜测。

重新解析会完整替换上一版：先检查人工并发改动，撤回上一版事件、恢复保存的字段前值，再应用新版本。任何冲突都保持 `需处理`，不覆盖。

## 生成入口状态

本 Skill 当前只有确定性 `snapshot` 与 `apply`，没有正式冻结的 ChatGPT Prompt，也没有把同一 revision 的完整正文、block ID、附件和文档身份保存为 `handoff/v1` 的适配器。上面的 JSON 与校验规则只定义业务结果契约；它们不是可直接提交给 ChatGPT 的 Prompt。

因此，在完整人工交接适配器实现前，proposal 生成为 `manual-prompt-unavailable`：不得调用网页 Bridge，不得把 Schema 示例或本 reference 拼成新分析 Prompt，不得压缩文档内容或从聊天历史补正文。任务保持待补证，`apply` 不得作为该生成步骤的替代入口；不得创建、更新或回写飞书/Base，也不得报告 proposal 已完成。

未来接入时，必须先将原样有效 Prompt、同 revision 的全部选题正文及 block ID、必要来源、预期 JSON 格式、任务身份和版本冻结在私有交接包中。人工回填只进入候选；仍由现有 `validateProposal`、`snapshot` / `assertCurrentRevision`、并发保护、幂等账本、撤回与写后读回门禁决定能否接续。候选或用户提供的会话 URL 不能自授验证状态。

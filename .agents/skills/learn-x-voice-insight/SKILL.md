---
name: learn-x-voice-insight
description: Learn-X 周日 Voice-X 批量洞察自动化。读取目标周已完成粗加工的语音，生成私有 ChatGPT 批处理上下文，校验核心总结与芒格之魂洞察，幂等归档并刷新 voice.md。用户要求周日生成 Voice-X 洞察、批量处理语音或运行 voice:insight 时使用。
---

# Learn-X Voice-X 周日洞察

这个 Skill 是周一 `learn-x-weekly-automation` 的独立前置阶段，不修改系统级调度，也不进入 `process:weekly`。

## ChatGPT 请求上下文包

新批次默认使用共享 [ChatGPT Bridge 人工交接](</Users/yuwei/code/browser-runtime-governance/skills/chatgpt-web-bridge/SKILL.md>)，不调用 Ego Lite、浏览器或 Runner 提交。显式运行 `--send --confirm` 后，适配器冻结整周批次 Prompt、记录集合和输入版本，并以 `awaiting_manual` 结束本轮。用户在原 Codex 任务把完整包交给 ChatGPT，再于原任务回传完整 Markdown 结果和 `handoffId`；回传只形成候选，须由同一批次适配器读取并逐条校验记录标识、区块数量、结构与来源。

候选导入后再次运行同周的 `--send --confirm` 命令以恢复；通过校验后才逐条归档到对应 Voice-X 记录、读回并刷新 Learn-X Voice 输入。同一交接包有多个不同候选时会列出候选 ID、哈希与来源等级并停在 `awaiting_manual`；核对后运行 `npm run voice:insight -- --week YYYY-Www --send --confirm --candidate-id <ID>` 明确选择，未选择时不会归档任一候选。等待期间保留原输入、handoff ID 和阶段；输入变化、错版本或不完整结果不能写入，也不能用 `--force` 或重发 ChatGPT 绕过。交接材料受共享层 30 天期限约束，到期后须重新核验并准备完整输入。旧网页 Run 只按下方明确的旧任务观察/恢复边界处理。

## 目标与边界

- 只读取 Voice-X Base 的目标周记录和「处理后原文」；不读取原始文字稿。
- 洞察链接优先读取当前「AI 文档」字段，旧记录回退「AI 洞察文档」；新版正文允许省略重复的一级标题。
- 只处理有处理后原文的记录：缺少洞察链接为 `pending`；占位洞察进入本轮；旧格式为 `legacy`；新版洞察跳过。历史处理后原文若仍含核心总结/压缩原文，也标为 `pending`，必须先重新粗加工，不能把旧深加工文档送入新 Prompt。
- `--send --confirm` 准备人工批次，不自动提交网页；普通运行只生成预览。
- 人工候选未通过区块、记录归属或正文结构校验时不写入任何洞察；状态保留 handoff/candidate 身份、哈希与待处理原因，不自动重发。
- 只在所有区块完整、唯一且顺序正确时逐条归档。新版内容替换占位；旧格式迁移使用 `--migrate-legacy --confirm` 创建版本化文档并保留旧文档，历史识别兼容 v2 及更高版本。

## 命令

```bash
npm run voice:insight -- --week YYYY-Www
npm run voice:insight -- --week YYYY-Www --send --confirm
npm run voice:insight -- --week YYYY-Www --migrate-legacy --confirm
```

状态和上下文只写入目标周目录下的下划线文件：

- `_voice-insight-context.md`：可在本地 Chat Pack 的 `reflective-decision.voice-insight` 中一键选中并复制。
- `_voice-insight.generated.md`：已完整校验但尚未完全归档的批量结果，续跑不重新发送。
- `_voice-insight-status.json`：记录 `preview`、`submitted`、`awaiting_manual`、`needs_review`、`generated`、`archive_pending`、`completed`、`legacy`、`pending`、`failed` 等状态及恢复身份。

归档完成后调用 `input:voice`；该采集器只把新版 AI 洞察写入 `voice.md`，不回退到粗加工原文。

## 验证

```bash
node --test .agents/skills/learn-x-voice-insight/scripts/*.test.mjs
python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-voice-insight
```

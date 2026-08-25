---
name: learn-x-voice-insight
description: Learn-X 周日 Voice-X 批量洞察自动化。读取目标周已完成粗加工的语音，生成私有 ChatGPT 批处理上下文，校验核心总结与芒格之魂洞察，幂等归档并刷新 voice.md。用户要求周日生成 Voice-X 洞察、批量处理语音或运行 voice:insight 时使用。
---

# Learn-X Voice-X 周日洞察

这个 Skill 是周一 `learn-x-weekly-automation` 的独立前置阶段，不修改系统级调度，也不进入 `process:weekly`。

## 目标与边界

- 只读取 Voice-X Base 的目标周记录和「处理后原文」；不读取原始文字稿。
- 只处理有处理后原文的记录：缺少洞察链接为 `pending`；占位洞察进入本轮；旧格式为 `legacy`；新版洞察跳过。历史处理后原文若仍含核心总结/压缩原文，也标为 `pending`，必须先重新粗加工，不能把旧深加工文档送入新 Prompt。
- ChatGPT 通过 Ego Lite Bridge 一次批量提交。默认只生成预览；真实发送必须显式 `--send --confirm`。
- Bridge 失败、登录失效、限流、输出不确定或结构校验失败时不写入任何洞察，不自动重发；状态保存 runId、conversationUrl、输出 hash 和原因。
- 只在所有区块完整、唯一且顺序正确时逐条归档。新版内容替换占位；旧格式迁移使用 `--migrate-legacy --confirm` 创建 v2 文档并保留旧文档。

## 命令

```bash
npm run voice:insight -- --week YYYY-Www
npm run voice:insight -- --week YYYY-Www --send --confirm
npm run voice:insight -- --week YYYY-Www --migrate-legacy --confirm
```

状态和上下文只写入目标周目录下的下划线文件：

- `_voice-insight-context.md`：可在本地 Chat Pack 的 `reflective-decision.voice-insight` 中一键选中并复制。
- `_voice-insight.generated.md`：已完整校验但尚未完全归档的批量结果，续跑不重新发送。
- `_voice-insight-status.json`：记录 `preview`、`submitted`、`needs_review`、`generated`、`archive_pending`、`completed`、`legacy`、`pending`、`failed` 等状态。

归档完成后调用 `input:voice`；该采集器只把新版 AI 洞察写入 `voice.md`，不回退到粗加工原文。

## 验证

```bash
node --test .agents/skills/learn-x-voice-insight/scripts/*.test.mjs
python3 /Users/yuwei/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/learn-x-voice-insight
```

---
name: wisdom-gate
description: 智慧之门认知资产入库 Skill。当用户发送高质量认知内容（图片或文字）并需要存入智慧之门 Base 时使用。自动提取结构化字段、写入 Base、上传附件。
---

# 智慧之门 — 认知资产入库 Skill

将高质量认知内容（来自对话、阅读、思考的图片或文字）结构化存入「研究&学习」Base 的智慧之门表，供后续复看、检索、复用。

## 快速命令

```bash
npm run wisdom-gate:ingest -- --text "..." --image /path/to/img.png --topic "所属主题"
```

## 前置门禁

- **不擅自判断** — 用户主动发送内容才处理，不主动拦截对话
- **不修改用户原文** — 原文必须保留在「长篇内容、原始内容」字段，结构化摘要是二次加工
- **可追溯** — 每条入库记录必须能回溯到原始消息
- **去重** — 写入前按关键词模糊匹配，已有记录跳过

## 字段映射（智慧之门 Base — tblMGGWdVH4Iq9Og）

| 字段 | 类型 | 来源 |
|------|------|------|
| 所属主题 | text | LLM 提取 |
| 一句话精华 | text | LLM 提取 |
| 层级 | select | 道/法/术/器 |
| 核心问题和使用场景 | text | LLM 提取 |
| 长篇内容、原始内容 | text | 用户原始输入 |
| 图 | attachment | 用户图片 |
| 智慧时效性 | select | 短期/中期/长期/永恒 |

## 触发流程

### Path A：Agent 处理（飞书入口）

1. 用户发图片或文字 @codex 小助手
2. Agent 匹配此 SKILL.md
3. **有图片**：下载到本地临时路径，用 `view_image` 视觉确认内容
4. **文字**：直接使用用户原文
5. 调用 MoonBridge（`POST /v1/responses`）用 `ark-code-latest` 模型做结构化提取
6. `lark-cli base +record-upsert` 创建记录
7. 有图片则 `+record-upload-attachment` 上传
8. 回复用户结果

### Path B：脚本自动化

```bash
npm run wisdom-gate:ingest -- --text "..." [--image /path] [--topic "..."]
```

## MoonBridge Prompt

调用 `POST http://127.0.0.1:38441/v1/responses`，模型 `ark-code-latest`，temperature 0.3。

System prompt:
```
你是一个认知资产结构化专家。需要将一段高质量认知内容提炼成以下字段，输出纯 JSON。

- topic: 所属主题（一句话定主题）
- essence: 一句话精华（10-25 字）
- level: 层级（"道"|"法"|"术"|"器"）
- core_question: 核心问题和使用场景（50-150 字）
- original_text: 完整的长篇内容、原始文本
- timeliness: 智慧时效性（"短期"|"中期"|"长期"|"永恒"）
```

## 去重

`lark-cli base +record-search` 按关键词搜索，已有相似记录则跳过。

## 运行后

- 回复入库结果（成功/跳过/失败）
- 更新 `scripts/wisdom-gate-memory.json`
- 不自动改写 Memory、道、法

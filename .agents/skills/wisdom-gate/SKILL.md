---
name: wisdom-gate
description: 智慧之门认知资产入库 Skill。当用户发送高质量认知内容（图片或文字）并需要存入智慧之门 Base 时使用。自动提取结构化字段、写入 Base、上传附件。
description_zh: 高质量认知内容结构化存入智慧之门 Base
---

# 智慧之门 — 认知资产入库 Skill

将高质量认知内容（来自对话、阅读、思考的图片或文字）结构化存入「研究&学习」Base 的智慧之门表，供后续复看、检索、复用。

## 快速命令

```bash
npm run wisdom-gate:ingest -- --text "..." --image /path/to/img1.png --image /path/to/img2.png --title "原标题" --level "术"
```

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--text "..."` | 图片可选/文字必填 | 用户原始文字内容，或图片的补充描述 |
| `--image /path` | 否，可重复 | 图片路径，支持多张（重复 `--image`）|
| `--title "..."` | 强烈推荐 | 图片/内容本身的原标题。**topic（所属主题）默认使用此标题**，不要自己造主题 |
| `--level "道/法/术/器"` | 用户指定时传 | 用户明确说"属于术"等层级时传入，LLM 不会覆盖 |
| `--topic "..."` | 可选 | 主题提示（供 LLM 参考，不强制覆盖）|

## 核心规则

- **标题即主题**：图片/内容本身的标题就是最好的「所属主题」，不要自己概括、改写、编造。除非内容确实无标题才由 LLM 提炼。
- **不修改用户原文** — 原文必须保留在「长篇内容、原始内容」字段，结构化摘要是二次加工
- **可追溯** — 每条入库记录必须能回溯到原始消息
- **去重** — 写入前按关键词模糊匹配，已有记录则**追加图片**而非重复创建
- **层级尊重用户**：用户说"属于术"就用术，不要自动改成法/道

## 字段映射（智慧之门 Base — tblMGGWdVH4Iq9Og）

| 字段 | field_id | 类型 | 来源 |
|------|----------|------|------|
| 所属主题 | fldBv8Jmf4 | text | 优先用 `--title`，否则 LLM 从内容提取 |
| 一句话精华 | fldKCeGdrV | text | LLM 提取（10-25 字）|
| 层级 | fldRvBGG3O | select | 道/法/术/器；用户指定优先 |
| 核心问题和使用场景 | fldU6pPl2L | text | LLM 提取（50-150 字）|
| 长篇内容、原始内容 | flduK8TQZO | text | 用户原始输入/图片核心内容 |
| 图 | fld9P7V5uC | attachment | 用户图片（支持多图）|
| 智慧时效性 | fld9gr8hGh | select | 短期/中期/长期/永恒 |

## 触发流程（飞书入口，Agent 手动版）

1. 用户发图片或文字 @codex 小助手，说"新增智慧之门，属于X"
2. **有图片**：bridge 自动下载到 `~/.lark-channel/profiles/deep/media/<hash>.<ext>`，用 `view_image` 看图片确认标题和内容
3. **标题提取**：图片顶部的大标题就是 `--title`；用户明确说"属于术"就传 `--level "术"`
4. **调用脚本**：`npm run wisdom-gate:ingest -- --text "..." --image <path> --title "原标题" [--level "术"]`
5. 脚本自动：MoonBridge 提取 → 去重 → 创建/追加记录 → 上传图片
6. 回复用户结果（record_id + 成功状态）
6. 回复用户结果（主题 + 层级 + 精华 + 飞书链接，链接格式：`https://bytedance.feishu.cn/base/<base_token>?table=<table_id>&record=<record_id>`）

### 图片处理注意事项

- **图片 OCR 提取**：参见 [image-ocr](../image-ocr/SKILL.md) Skill。bridge 场景下 image_ocr 块已含 OCR 结果，直接使用；非 bridge 场景手动调用 describe-image

- bridge 下载的图片在 `~/.lark-channel/profiles/deep/media/` 下
- 脚本会自动处理绝对路径（复制到临时目录后用相对路径上传）
- 支持多图：重复 `--image` 参数
- 上传附件使用 field_id `fld9P7V5uC`（不用中文名"图"）

## MoonBridge System Prompt

调用 `POST http://127.0.0.1:38441/v1/responses`，模型 `ark-code-latest`，temperature 0.3。

核心规则：**topic（所属主题）必须使用内容/图片本身的原标题**，不要自己编造或改写。

## 去重与追加

- 脚本自动按「所属主题」关键词搜索已有记录
- 找到已有记录时，不重复创建，而是追加图片到同一记录的「图」字段
- memory 文件记录每次运行结果：`scripts/wisdom-gate-memory.json`

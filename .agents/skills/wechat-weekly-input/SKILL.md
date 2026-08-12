---
name: wechat-weekly-input
description: 通过用户手动提供的微信聊天截图生成重点聊天周度 WeChat.md，并维护每日截图缺口。Use when the user asks to process WeChat screenshots, exclude folded chats, keep group context around the user's own messages, or add manual WeChat input to Learn-X weekly input.
---

# 微信手动截图周度输入

## 边界

- 这是用户选择的重点聊天人工采样，不承诺覆盖全部微信会话。
- 只处理用户主动提供的截图；不打开、点击、遍历或控制微信，不使用 UI 自动化、Computer Use、OCR 自动遍历、数据库读取或模拟操作。
- 原始截图只用于当前视觉解析，不复制到仓库、不上传、不写入 `03_input/weekly/`；结构化临时 JSON 放在 `/private/tmp` 等临时目录，处理后由用户删除。
- 每天至少提交 2 张不同聊天截图。折叠群不计入数量。

## 视觉解析门禁

每张截图原则上只对应一个聊天，并先转成下面的临时 JSON，再交给脚本追加。必须能够确认聊天名称、消息时间和发送者；无法确认就写入受控 `issues`，不要猜测文字、时间、发送者或聊天类型。

```json
{
  "capture_date": "YYYY-MM-DD",
  "captures": [
    {
      "chat_name": "聊天名称",
      "chat_type": "private|group|folded",
      "messages": [
        {
          "time": "YYYY-MM-DDTHH:mm:ss+08:00",
          "sender": "我或对方名称",
          "is_from_me": true,
          "kind": "text",
          "text": "截图中可确认的正文"
        }
      ]
    }
  ],
  "issues": [{"code": "incomplete_context"}]
}
```

规则：

1. `capture_date` 必须是截图当天的 Asia/Shanghai 日期，并属于目标 ISO 周；消息时间必须带 `Z` 或明确时区偏移。
2. `chat_type` 只能是 `private`、`group`、`folded`。`folded` 直接排除，不写聊天名称，也不计入每日 2 张。
3. 私聊只保留截图中目标周内可见的消息，并标注为“人工局部采样，非完整历史”。
4. 群聊直接保留截图中目标周可见消息；若出现“我”消息，每个锚点前后最多保留 5 条可见消息，重叠窗口合并；没有“我”消息也不跳过，并标记 `no_anchor`。手动截图即使上下文不完整也可以写入，脚本会保留当前可见窗口并标记 `incomplete_context`，绝不补全或猜测缺失消息。
5. 缺少标题、时间、发送者或正文时，不写入猜测内容；没有群锚点只是采样缺口，不是拒绝条件。可用的 `issues.code`：`missing_chat_name`、`missing_time`、`unknown_sender`、`uncertain_text`、`incomplete_context`、`cropped_chat_title`、`folded_excluded`、`no_anchor`、`no_target_week_messages`。

## 确定性追加

执行顺序固定为：

1. 直接用当前模型的视觉能力读取用户上传的截图，逐张确认标题、日期/消息时间、发送者、消息类型和可见正文；不要调用 OCR、Computer Use 或任何微信自动化。
2. 只把确认结果写成上面的临时 JSON，保存到 `/private/tmp`；不复制原始图片。无法确认的内容从 `captures` 中排除，并加入受控 `issues`。
3. 调用下面的追加器，读取脚本返回的 `acceptedCount`、`duplicateCount`、`skipped` 和 `remaining`。
4. 确认 `WeChat.md` 写入成功后删除临时 JSON；失败时保留旧文件并报告缺口，不重试猜测内容。

在仓库根目录执行：

```bash
node .agents/skills/wechat-weekly-input/scripts/append-wechat-captures.mjs \
  --week YYYY-Www \
  --input /private/tmp/wechat-capture.json
```

脚本负责校验日期、类型、时间、发送者和正文；按 Asia/Shanghai 周边界筛选；按“聊天名 + 时间 + 发送者 + 正文 + 消息类型”去重；排除 `folded`；生成每日机器可检查的截图计数；并使用临时文件原子替换 `03_input/weekly/YYYY-Www/WeChat.md`。输入错误或写入失败时保留旧文件，不保存临时 JSON 或图片。

输出必须包含目标周、Asia/Shanghai、采集方式“手动截图 + 模型视觉”、人工采样声明、每日截图数量、已采集聊天、群锚点（若有）与上下文、无锚点缺口、私聊局部采样声明，以及缺失日期、截图不足和受控识别缺口。重复提交同一结构化截图不得增加记录。

## 每日提醒

使用已注册的 Codex heartbeat，每天 21:00（Asia/Shanghai）检查当前周 `WeChat.md` 中当天唯一截图标记的数量：少于 2 张才提醒用户打开微信并提交重点聊天截图，达到 2 张不重复提醒。提醒不得包含聊天正文，不操作微信；没有有效截图时不创建空的 `WeChat.md`。周度处理继续报告缺失日期和截图不足。

## 验证

运行：

```bash
node --test .agents/skills/wechat-weekly-input/scripts/append-wechat-captures.test.mjs
```

必须覆盖：1 张、2 张、重复截图、`folded`、有/无“我”消息、群上下文不足、私聊局部采样、未知识别项、原子失败、跨周上下文和周边界。真实路径验收只接受用户提供的至少 2 张非敏感测试截图，且不得保存原图。

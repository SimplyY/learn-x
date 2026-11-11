# Acceptance｜Flomo 回顾图片展示

- 结论：达成（PASS）
- 日期：2026-11-11（Asia/Shanghai）
- 依据：Requirement R1–R10；真实入口实走，未发送生产回顾卡。

## 实走结果

- 真实 CLI：`lark-cli whoami --as bot` 确认 bot 身份可用。
- 真实图片链路：在隔离临时仓库中启用 `images`，从真实 HTTPS 源下载 PNG，并用 `lark-cli im images create` 上传成功。
- 真实上传凭证：`img_v3_0217b_ed7c545b-bf8b-47af-bda5-120f08da6eeg`；审计只保留 `sourceUrlHash`、`sha256`、`size=1848`、`mime=image/png` 和 `imgKey`。
- Preview 实走：`previewReview` 成功写入 `images.json`；`inspectDecision` 读回确认卡片新增 `{tag:"img", img_key, alt, preview:true}`，无来源 URL。
- 对抗复测：三轮修复后本地与 mock 可验证范围 PASS。安全覆盖 `64:ff9b::/96`、IPv4-compatible IPv6、magic bytes、MIME、10MB 流式上限、图片源哈希、尝试序列与 `img_v3_*` 凭证格式；`send` 开启图片时拒绝无 preview。
- 真实卡片回读：向 learn-x 群发送非生产测试卡（`om_x100b6074183da8acc0c5bb4c52e99f4`），复用真实上传凭证，覆盖一个 `img` 和一个 2 图 `img_combination`；`+messages-mget` 实际返回 emoji/keys 形式回读。据此修正 `delivery.mjs` 的 `renderCardReadback`，并新增回归测试。

## 最小验收指南

1. 在测试数据中给推荐笔记添加图片引用。
2. 运行 Flomo 回顾 `preview`，确认对应笔记后出现图片、无 Flomo 来源 URL。
3. 需要生产启用时，再明确授权将 `00_config/flomo-review.json` 的 `images.enabled` 置为 `true`。

## 结论边界

- 已验证：真实上传、preview 固定图片凭证、卡片结构、隐私边界和配置开关。
- 已验证：真实飞书消息发送后的 `img` / `img_combination` readback。
- 未验证：生产数据端到端发送链路。
- 判定：实现、本地回归与真实低风险卡片回读通过；生产开关保持 `images.enabled=false`，是否启用需用户单独决策。

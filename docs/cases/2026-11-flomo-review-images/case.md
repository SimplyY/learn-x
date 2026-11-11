# Case｜Flomo 回顾图片展示

- 状态：开发与测试完成；真实上传、preview 与真实卡片回读验收通过
- 最后核对日期：2026-11-11
- 上下游链接：docs/requirements/2026-11-flomo-review-images.md → docs/cases/2026-11-flomo-review-images/execution-plan.md
- 任务目标：在 Flomo 每日回顾卡中展示被推荐笔记的图片，单条 6 张、单次 20 张，并复用智慧之门排版。

## 当前状态与进度

- 2026-11-11：用户确认方案并调整上限与排版，随后授权 `ywdev` → `ywuse` → `ywtesting`。
- 2026-11-11：完成 M0 调查与三份任务真源落盘；开始按快照 → catalog → 图片上传 → 卡片渲染 → preview/send/recover 的小切片实施。
- 2026-11-11：完成 `ywdev` 全量实现：快照图片引用、HTTPS/去重/位置/6 图上限、catalog 兼容、推荐笔记图片下载与上传、SSRF 与 MIME/大小防护、审计哈希化、智慧之门排版、preview/send 图片凭证复用、recover 不重传，以及 `images.enabled=false` 回滚开关。
- 2026-11-11：运行 `rtk npm test`，结果 `858 tests, 858 pass, 0 fail`。当前仅完成 mock CLI 单测与全量回归，未做真实飞书图片上传/卡片发送。
- 2026-11-11：完成 `ywuse` 真实上传与 preview 实走；随后完成 `ywtesting` 三轮对抗修复。安全路径覆盖 SSRF、NAT64/IPv4-compatible IPv6、图片 magic/MIME/大小、preview 凭证绑定与真实尝试序列；`send` 在开启图片时强制复用 preview，避免占用检查前上传。
- 2026-11-11：最终本地验收 PASS：`rtk npm run test:flomo:review` 189/189，`rtk npm test` 858/858。显式边界是尚未发送真实飞书消息并验证 `img` / `img_combination` readback。
- 2026-11-11：真实低风险卡片回读暴露 `img` / `img_combination` 的飞书 markup 差异；已修正 readback 渲染，新增回归测试，并通过真实 `+messages-mget` 验证。生产开关保持关闭。
- 2026-11-11：最终验收 PASS：`rtk npm run test:flomo:review` 190/190，`rtk npm test` 858/858；`images.enabled=false`。
- 2026-11-11：用户确认存量笔记图片缺失；真实 DOM 实检发现 Flomo 图片位于 `div.memo > .files img`，不在 `.richText` 内。采集器已改为读取卡片附件层，并优先使用 `data-source` 原图；新增真实 DOM 形态回归测试。
- 2026-11-11：修复后全量重扫得到快照 `baf55090-85b9-4fa7-98b0-24602b8ef0b9`：1036/1038 条、134 条带图、362 张图片（可见 316 张）。该快照已激活并更新 catalog。已发送一条非生产真实图片样例卡；生产开关仍为 `false`。

## 来源与落点核对

| 来源 | 落点 |
|---|---|
| 单条 6 图、单次 20 图、智慧之门排版 | Requirement R2–R4；Plan 数据流与分阶段表 |
| 只跳过 Feishu bot 调用场景的 ywplan Plan Mode 限制 | 本地 `/Users/yuwei/.agents/skills/yw-architecture/SKILL.md`，当前仅作本机适配，不作为飞书长期真值 |
| `ywdev` → `ywuse` → `ywtesting` 顺序 | Requirement R10；Case 当前状态 |

## 来源核验

- 状态：有关键缺口
- 机器收据：None
- 缺口报告：最早的功能原始需求文本未在本轮上下文逐字出现；本 Case 不伪造该原文。当前方案中的功能方向由确认过的上下文保存，最新用户调整已逐字保存。

## 执行入口

```text
在 /Users/yuwei/code/learn-x 执行 docs/cases/2026-11-flomo-review-images/execution-plan.md。
先重读 Requirement Truth、Execution Plan 和本 Case；核对 git 状态、相关 diff、相关代码与测试；自行推导最小实现并审查既有改动。
按快照图片引用 → catalog 兼容 → 图片下载上传审计 → 智慧之门图排版 → preview/send/recover 复用的顺序实现；不提交 Git，不改无关文件，保持隐私边界与 images.enabled=false 回滚开关。
```

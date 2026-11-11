# Execution Plan｜Flomo 回顾图片展示

- 状态：已确认
- 最后核对日期：2026-11-11
- 上下游链接：docs/requirements/2026-11-flomo-review-images.md → docs/cases/2026-11-flomo-review-images/case.md
- 来源：用户确认的既有图片展示方案；2026-11-11 上限与排版裁决由 Requirement Truth 保存。

## 方案原文

### 设计原则

从第一性原理看，Flomo 图片已经是用户笔记的正文证据；若它对每日回顾有价值，就必须能随同一条笔记回看，但不应因此扩大采集、存储或公开面。遵循奥卡姆剃刀，复用现有完整快照、catalog、review、delivery 和 `lark-cli im images create` 能力；只增最小数据字段、上限、上传函数和卡片图元素，不新建服务、面板、外链系统或独立图片索引。

### 数据流

1. **快照采集**
   - 扩展 Flomo 快照记录：`images: [{ url, position }]`。
   - `bodyHash` 仍只由正文文本决定。
   - 只提取笔记正文中的 `<img>`。
   - 仅接受 HTTPS URL；同一条笔记内按 URL 去重。
   - 每条最多保留 6 个图片引用，并记录 `imageCount` 与 `truncatedImageCount`。
2. **Catalog**
   - 保留笔记的 `images`。
   - 无 `images` 的旧快照视为空图，继续有效。
   - 不改 `noteKey`、`groupKey`、评分、配额和去重语义。
3. **图片解析与上传**
   - 只处理推荐笔记的图片。
   - 单条限 6 张，单次回顾限 20 张。
   - 下载到私有 runtime 临时目录，不在日志或公开目录保留。
   - 校验 HTTPS、MIME、大小和 SSRF 安全的重定向。
   - 用 `lark-cli im images create --data '{"image_type":"message"}' --file ...` 上传。
   - 审计只保存 hash、size、MIME、来源 URL hash 和 `img_key`。
   - 上传后立即删除原始图片文件。
   - 不把 Flomo 图片来源 URL 写入飞书卡。
4. **卡片渲染**
   - 图片插入在对应笔记文本之后。
   - 复用智慧之门现有 `img` / `img_combination` 布局；找不到直接实现时按其规则实现 fallback。
   - 失败图片跳过；若该笔记全部失败，该笔记回退纯文本。
   - 若使用 `img_combination`，同步更新 `renderCardReadback`。
5. **preview / send / recover**
   - `preview` 持久化 `images.json`，并把 `img_key` 固定下来。
   - `send` 复用同一批 `img_key`，不重传。
   - `recover` 继续按原卡哈希和消息 ID 回读，不重新下载或重传。
6. **配置与回滚**
   - `00_config/flomo-review.json` 增加：

```json
{
  "images": {
    "enabled": false,
    "maxPerNote": 6,
    "maxTotal": 20
  }
}
```

   - 测试和验收通过前保持 `enabled=false`；回滚时改回 `false`。

### 分阶段实施

| # | 内容 | 关键文件 | 验证 |
|---|---|---|---|
| 1 | 快照采集图片引用并做 HTTPS、去重、位置与上限校验 | `.agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs`, `.agents/skills/learn-x-input/scripts/lib/flomo-full-snapshot.mjs` | 单元测试：无图旧记录、1–6 图、重复图、非 HTTPS、第 7 图截断 |
| 2 | Catalog 保留 `images`，兼容旧快照 | `.agents/skills/learn-x-flomo-review/scripts/catalog.mjs` | 单元测试：旧快照无 `images`、新快照图字段保留、`bodyHash` 不变 |
| 3 | 图片下载/上传/审计/临时文件清理 | `.agents/skills/learn-x-flomo-review/scripts/review.mjs` | fake CLI 验证 MIME/大小/重定向/失败跳过/审计字段 |
| 4 | 卡片复用智慧之门排版，扩展 readback | `.agents/skills/learn-x-flomo-review/scripts/review.mjs`, `.agents/skills/learn-x-flomo-review/scripts/delivery.mjs` | 单元测试：1 图、2 图、3 图、4–6 图、单次 20 图、全失败回退 |
| 5 | preview 固定 `img_key`，send/recover 复用 | `.agents/skills/learn-x-flomo-review/scripts/review.mjs`, `.agents/skills/learn-x-flomo-review/scripts/delivery.mjs` | 单元测试：preview→send 不重复上传、recover 只读原卡 |
| 6 | 配置开关与回归 | `00_config/flomo-review.json` | `enabled=false` 输出与现状等价；开关开启时进入新逻辑 |

### 对抗性自测

- 非笔记正文的页面头像或装饰图不得进入快照。
- 非 HTTPS、私有 IP、非白名单重定向、超大图、坏 MIME、空文件必须拒绝或跳过。
- 同 URL 在同一笔记只留一次；跨笔记不合并。
- 第 7 张图和第 21 张图不得展示，但必须留下计数证据。
- 图片上传失败不能中断其他文本和可成功图片。
- 全图失败必须回退纯文本卡，而不是发坏卡。
- `send` 不得重复上传；重试不得造成重复消息。
- `recover` 只认原卡，不把新卡误认为恢复结果。
- 旧快照无 `images` 仍可生成回顾；旧 catalog 不因新字段回滚失败。
- 不在卡、日志或审计明文里出现 Flomo 图片 URL。

## Execution Handoff

### 用户已确认的关键决定

- 单条 6 图、单次 20 图。
- 图片排版参考 research-x `wisdom-review` 现有实现。
- 其他已确认方案继续执行。
- 顺序：`ywdev` → `ywuse` → `ywtesting`。

### 重要背景与限制

- 现有 Flomo 回顾已有完整快照、catalog、review、delivery、ledger 和隐私审计。
- 智慧之门参考实现位于 `/Users/yuwei/code/research-x/.agents/skills/wisdom-review/scripts/run-review.mjs`；其 `buildImageElements` 和 `combinationMode` 是目标布局。
- 只能走 `lark-cli`，不得引入直连 API 或第三方存储。

### 关键假设与尚存未知

- 假设 Flomo 图片 URL 是页面可访问的 HTTPS 资源，登录上下文由浏览器采集阶段完成，下载阶段不需要复用用户 session。
- 尚存未知：真实 Flomo 图片 MIME、尺寸与重定向行为需在真实验收时确认。

### 已完成调查或 Spike 的结果及证据

- 已实读 `wisdom-review/scripts/run-review.mjs`，确认 `combinationMode` 与 `buildImageElements` 的布局规则。
- 已实读 Learn-X Flomo review 关键文件，确认当前卡只含 markdown / hr，不含图元素；`renderCardReadback` 目前遇非 markdown/hr 返回 null。

### 相关文件、模块、接口和外部资料

- `.agents/skills/learn-x-input/scripts/collect-flomo-weekly.mjs`
- `.agents/skills/learn-x-input/scripts/lib/flomo-full-snapshot.mjs`
- `.agents/skills/learn-x-flomo-review/scripts/catalog.mjs`
- `.agents/skills/learn-x-flomo-review/scripts/review.mjs`
- `.agents/skills/learn-x-flomo-review/scripts/delivery.mjs`
- `00_config/flomo-review.json`
- `/Users/yuwei/code/research-x/.agents/skills/wisdom-review/scripts/run-review.mjs`

### 执行中容易误解的重要信息

- 图片必须来自笔记正文，不是 Flomo 页面任意 `<img>`。
- 图片上限是展示上限，快照可以记录截断计数。
- `bodyHash` 不因图片字段变化而变化。

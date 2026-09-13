---
name: learn-x-prompt-usage
description: 合并 Learn-X 两端 Chat Pack 提示词使用记录；当用户粘贴“复制使用记录”载荷或要求合并提示词统计时使用。
---

# Learn-X 提示词使用记录

处理用户从外网有上下文 Chat Pack 复制的 JSON，不读取问题正文、Context 或浏览器凭据。

## 流程

1. 从用户消息中提取唯一的 `json` 代码块，先执行脚本的校验/预览模式；不要凭感觉修改次数。
2. 脚本会同时读取本机 `.local/chatpack-usage.json` 和已提交的 `00_config/chatpack-usage.json`。只处理 `mergedThrough` 之后、当前月份之前的完整月份。
3. 任一校验失败、异常值、基线文件已有未提交改动、测试失败或远端状态异常时，停止且不写入、不提交，报告具体原因。
4. 校验通过后才执行 `--apply`，只允许改变 `00_config/chatpack-usage.json` 和本机已合并月份；运行 `npm test`、`npm run build:public`、`npm run build:public:no-context`、`git diff --check`。
5. 只暂存统计基线文件，再运行 `npm run security:scan:staged`；确认暂存区没有其他文件后提交并推送，保留工作区其他改动。推送冲突、失败或 Pages 发布失败都必须停止并通知，不自动重试提交。
6. 推送后用 `gh run list --workflow pages.yml --limit 1 --json databaseId,headSha,status,conclusion` 找到当前提交对应的 Pages workflow；必要时用 `gh run watch <databaseId> --exit-status` 等待结束，并确认 `headSha` 等于刚推送的提交且 `conclusion` 为 `success`。无法查询或结果不成功时，停止并报告未完成。

## 硬边界

- 只接受当前仓库配置中的子类型和非字数增强器 ID；拒绝负数、非整数、未知 ID、非法月份和未来月份。
- 单月总量大于 500、单个提示词月增量大于 200，或手机/电脑单月总量相差超过 20 倍且较大端至少 100 次，均为异常并停止。
- 同一月份已经合并时必须幂等返回，不得重复累加。
- 用户只粘贴载荷不等于授权修改其他文件；不得改写 Prompt、道、法、Memory 或业务文档。

确定性校验和合并逻辑位于 [`scripts/merge-prompt-usage.mjs`](scripts/merge-prompt-usage.mjs)。

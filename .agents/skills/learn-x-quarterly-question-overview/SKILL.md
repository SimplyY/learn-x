---
name: learn-x-quarterly-question-overview
description: 生成、审计和提交 Learn-X 人生核心议题季度总览；每季度读取全部议题并将唯一原文保存到私有飞书 Wiki。
---

# 季度核心议题总览

运行 `npm run inquiry:quarterly-overview -- <command>`。脚本只做确定性读取、渲染、校验和经显式 `apply` 授权的 Base 回写，不调用外部 AI。

触发词：`启动季度核心议题总览`、`提交这份季度总览`、`重新解析这份季度总览`、`撤回上次季度总览`。

## 入口

- `setup`：创建季度审计表、字段和事件来源关联。
- `create --quarter YYYY-QN`：读取全部议题并创建或恢复 Wiki 总览。
- `sync-tab --quarter YYYY-QN`：按季度账本中的 Wiki URL 重试 `learn-x` 群「人生核心议题」标签同步。
- `snapshot --quarter YYYY-QN`：读取当前 revision/hash，作为提交快照。
- `apply --proposal-json -`：只提交「回填清单」中的显式结论。
- `rollback --quarter YYYY-QN`：撤回上一提交；新建议题只关闭研究，不删除。
- `status --quarter YYYY-QN`：读回季度账本。

同季度存在已有文档时，只有标题和稳定模板锚点同时匹配才恢复；任何用户正文都不会被覆盖。普通笔记、表格草稿和自由整理区不直接触发 Base 写入。

季度 `create` 在写入/恢复总览并读回账本后，会非阻塞地同步 `chat_tab` 配置的群快捷入口；成功记录 `chatTabSync.status=已同步`，失败记录 `需重试`，不撤销已创建的 Wiki 文档或账本。标签只属于 `learn-x`，名称固定为「人生核心议题」，排序时保留飞书固定首位的“消息”并放在第一个自定义位置；不得把它加入 README、GROUP_INFO 或 Base 链接资产。

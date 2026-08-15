# 历史周记回填与 Flomo 存量同步

只在用户明确请求历史存量补全或同步时使用。历史回填不是正常周流程的阶段 1/2/3，也不代表人工确认了 Weekly Output 或 Memory。

## 固定流程

1. 运行 `npm run history:scan`，读取 `04_output/_dist/historical-weekly/manifest.json` 和对应 `packs/YYYY-Www.md`。
2. 只为 manifest 中 `status: generated` 且 `needsGeneration: true` 的周生成文件：
   `03_input/weekly-history/YYYY-Www/weekly.md`。
3. 生成内容必须只依据对应日记输入包，保留周期、覆盖日期、缺失日期、输入 hash 和相对来源；不得读取其他周、Output、Memory 或外部内容补写事实。
4. 运行 `npm run history:scan` 刷新来源，随后运行 `npm run history:validate`。校验失败时停止，不同步 Flomo。
5. 使用 `npm run sync:flomo -- --manifest 04_output/_dist/historical-weekly/manifest.json`。该命令先完成所有目标的 Flomo 查重、旧标签、读回和变更保护预检，全部通过后才按顺序写入并逐条读回。
   预检明确报告的阻塞目标只能用同一 key 传入 `--skip-key` 后继续；不得用它绕过未调查的重复、旧 memo、远端大改动或读回失败。

## 硬边界

- `03_input/weekly-history/` 是历史回填源，不进入正常 Process、Weekly Output 或 Memory。
- 不覆盖 `03_input/weekly/` 中已有实质周记；输入 hash 变化时停止对应周。
- 没有日记的周不生成周记；旧周记周期无法唯一证明时不猜测。
- 月记只同步已有且周期明确的源；Memory 只同步已有季度文件，不由 AI 周记生成。
- 只使用 Ego Lite (`ego-browser`) 做 Flomo 页面操作；不得切换 Chrome、CDP、旧导出或凭据路径。
- 任何重复 memo、未标记旧 memo、远端大改动、读回失败或写入异常都停止当前批次，不删除远端 memo，不盲目重试。

## 汇报

报告日记日期数、ISO 周数、已有周记、生成周记、无日记周、冲突/阻塞周、月记、Memory，以及 Flomo 的创建/更新/不变/失败和逐条读回证据。明确说明生成周记没有进入 Memory。

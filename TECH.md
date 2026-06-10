# 技术边界与验证 (TECH)

本文档是 Learn-X 的项目级技术索引，覆盖本地应用代码、静态构建和验证边界。项目级认知原则留在根 README；输入、输出和 Weekly Process 的细节留在各自目录或 Skill 文档。

## 代码 vs Skill

| 类型 | 位置 | 职责 |
| --- | --- | --- |
| Code | `app/code/` | Chat Pack、本地页面、静态图谱和应用构建。 |
| Skill | `.agents/skills/` | 可复用工作流，例如 `learn-x-process` 的输入清洗、Process Pack 和 Memory 候选脚本。 |
| Prompt | `02_prompts/` | 单次任务或可复用对话方式，不承载完整工作流。 |
| Core | `01_core/` | 人工确认后的长期认知资产，不由脚本自动写入。 |

Weekly Process 相关脚本统一放在 `.agents/skills/learn-x-process/scripts/`。不要在 `app/code/scripts/` 里复制一份相同工作流。

## 技术栈

- 后端：Node.js 原生 HTTP 服务，动态读取文件系统。
- Markdown：使用成熟解析和清理工具，浏览器不直接信任未清理 HTML。
- 前端：轻量浏览器端页面，优先保持可读和可维护。
- 依赖引入必须能明显降低解析、渲染、安全或搜索等高风险能力的复杂度；简单逻辑不要引入沉重框架。

## 当前代码入口

| 文件 | 作用 |
| --- | --- |
| `app/code/server.mjs` | 本地服务入口；启动后监听 `.md` 变化并重建静态数据。 |
| `app/code/public/` | 浏览器端 Chat Pack 页面。 |
| `app/code/scripts/build-static-data.mjs` | 构建静态数据。 |
| `app/code/scripts/static-graph.mjs` | 生成静态图谱数据。 |
| `app/code/scripts/release.mjs` | 发布前检查：语法检查并构建静态站点。 |

`app/code/` 按普通目录纳入 Learn-X 主仓库，不作为独立子模块或嵌套仓库维护。Git 提交、推送和远端配置只在主仓库边界处理；`app/code/scripts/` 不执行 `git add`、`git commit` 或 `git push`。

## Chat Pack 配置边界

- 类型、子类型、推荐上下文和增强器统一维护在 `00_config/chatpack.config.json`。
- 大类界面名保持短标签：学习、判断、创造、画图、其他；较完整的用途说明放在配置的 `useCases`、`behaviorDirections` 和 `outputGoal` 中。
- 子类型 Prompt 放在 `02_prompts/chatpack/<type>/<slug>.md`；增强器 Prompt 放在 `02_prompts/chatpack/enhancers/<id>.md`。
- 周、月、年 Output 子类型属于 `reflective-decision`；默认推荐 `01_core/道`、`01_core/memory` 和对应的 `*-output-rules.md` 模板。周输出保持现有推荐源；月 / 年输出不默认勾选 `04_output/README.md` 或 `04_output/usage.md`。
- 周、月、年 Output 启用“芒格之魂”增强器时，只做周期材料洞察，不生成 Output；默认问题会明确“仅洞察”，字数自动选择 `1000字`，并从推荐上下文中移除对应的 `*-output-rules.md`、`04_output/README.md` 和 `04_output/usage.md`。关闭增强器后恢复该 Output 子类型的普通推荐上下文。
- 前端只在周、月、年 Output 子类型下显示周期快捷选择；周输出保持只勾选对应 `04_output/_dist/weekly/<period>/process-pack.md`，月输出自动勾选对应 `04_output/_dist/monthly/<period>/process-pack.md`，年输出优先勾选未来 `04_output/_dist/yearly/<year>/process-pack.md`，没有年度过程包时再勾选本年度已生成的 `04_output/monthly/<year>-*.md`；不自动勾选 `input.json`，也不回捞 `03_input/` 原始材料。
- 字数控制是 `group: "length"` 增强器，在前端显示为“字数”下拉框；同组只能选一个。
- `04_output/_dist/` 下的 `.md` 和 `.json` 仍可以通过自定义上下文手动选择；`input.json` 主要用于来源审计，不作为周期快捷选择的默认材料。

## API 边界

- `/api/graph`：返回文件列表、文件树、可选上下文来源、自动发现的领域列表和 Prompt 映射。
- `/api/file?path=README.md`：返回单文件 Markdown 原文和已清理 HTML。
- `/api/context?scene=<场景>&include=<路径>`：按文件或目录切片生成上下文包。
- Chat Pack 在前端组装，Context 来源统一来自 `/api/context`。
- 静态部署读取构建产物；本地服务优先请求 API。

## 维护边界

- 不要把 `03_input/`、`04_output/` 或 Weekly Process 规则写进应用代码。
- 不要把 `AGENTS.md`、`app/code/` 或生成物混入学习上下文。
- 不要把领域写死为教育、投资或 AI；领域应从 `01_core/法/` 自动发现并支持扩展。
- 不要让工具反过来塑造或异化「道」和「法」。

## 开发验证

修改后至少运行相关语法检查：

```bash
node --check app/code/server.mjs
node --check app/code/public/app.js
node --check app/code/scripts/static-graph.mjs
npm run build
```

本地启动地址：`http://127.0.0.1:4173`。

#!/usr/bin/env node
// 配置驱动的通用飞书 Base 周采集器。
// 新增数据源只需在 COLLECTORS 里追加一项配置，无需写新脚本。
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  weekRange, resolveBase, listTables, findTable, verifyFields,
  listRecords, filterByRange, atomicWrite, TZ,
} from "./lib/base-collector.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

// 采集器配置注册表。新增数据源在此追加一项。
const COLLECTORS = [
  {
    name: "智慧之门",
    sourceUrl: "https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe",
    tableId: "tblMGGWdVH4Iq9Og",
    fields: [
      "所属主题", "核心问题和使用场景", "一句话精华", "长篇内容、原始内容",
      "层级", "智慧时效性", "创建时间",
    ],
    filterField: "创建时间",
    outputFile: "wisdom.md",
    title: "智慧之门",
  },
];

export async function collectOne(config, week, dependencies = {}) {
  const outputRoot = dependencies.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const resolve = dependencies.resolveBase || resolveBase;
  const list = dependencies.listTables || listTables;
  const verify = dependencies.verifyFields || verifyFields;
  const recordsFor = dependencies.listRecords || listRecords;
  const filter = dependencies.filterByRange || filterByRange;
  const out = path.join(outputRoot, config.outputFile);
  try {
    const range = weekRange(week);
    const base = await resolve(config.sourceUrl);
    const tables = await list(base);
    const table = findTable(tables, { tableId: config.tableId });
    if (!table) throw new Error(`${config.name}：未找到表 ${config.tableId}`);
    const tableId = table.table_id || table.id;
    await verify(base, tableId, config.fields);
    const { records, pages, complete } = await recordsFor(base, tableId, {
      fields: config.fields,
      conditions: [
        [config.filterField, ">", `ExactDate(${range.startExclusive})`],
        [config.filterField, "<", `ExactDate(${range.end})`],
      ],
    });
    const inRange = filter(records, config.filterField, range);
    const content = render(config, week, range, { records: inRange, pages, complete });
    const written = inRange.length > 0;
    if (written) await atomicWrite(out, content);
    await updateWeeklySourceStatus({ weekRoot: path.dirname(out), week, source: "wisdom", status: written ? "ready" : "empty", file: config.outputFile, count: inRange.length, summary: written ? "本周有新增记录" : "本周 0 条记录，文件未生成", preservedStaleFile: !written && await fileExists(out) });
    return { file: written ? config.outputFile : null, count: inRange.length, pages, complete, written };
  } catch (error) {
    await updateWeeklySourceStatus({ weekRoot: path.dirname(out), week, source: "wisdom", status: "failed", file: config.outputFile, count: 0, summary: `采集失败：${error.message}`, preservedStaleFile: await fileExists(out) });
    throw error;
  }
}

function render(config, week, range, data) {
  const lines = [
    `# ${config.title}｜${week}`, "",
    `- 来源：${config.name}（飞书 Base）`,
    `- Base：${config.sourceUrl}`,
    `- 目标范围：${range.start} 至 ${range.end}（${TZ}）`,
    `- 采集时间：${new Date().toISOString()}`,
    `- 筛选字段：${config.filterField}`,
    "- 输入性质：本周新增记录（创建时间筛选）；既有记录的回顾状态更新不采集",
    `- CLI 来源：\`lark-cli base +url-resolve/+base-block-list/+field-list/+record-list --as bot\``,
    `- 字段核验：已核验「${config.fields.join("、")}」`,
    `- 记录数：${data.records.length}`,
    `- 分页：${data.complete ? `已完成（${data.pages} 页）` : "未完成"}`,
    "", "## 记录", "",
  ];
  for (const r of data.records) {
    lines.push(`### ${r.values[config.filterField] || "(无时间)"}`);
    for (const [k, v] of Object.entries(r.values)) {
      if (k === config.filterField) continue;
      if (v) lines.push(`- ${k}：${v}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const weekIndex = process.argv.indexOf("--week");
  const week = weekIndex >= 0 ? process.argv[weekIndex + 1] : undefined;
  if (!week) throw new Error("用法：npm run input:wisdom -- --week YYYY-Www");
  const cIndex = process.argv.indexOf("--collector");
  const target = cIndex >= 0 ? process.argv[cIndex + 1] : "智慧之门";
  const config = COLLECTORS.find((c) => c.name === target || c.outputFile === target);
  if (!config) throw new Error(`未知采集器：${target}（可用：${COLLECTORS.map((c) => c.name).join("、")}）`);
  const result = await collectOne(config, week);
  const output = result.written ? `-> ${result.file}` : "未生成文件（0 条实质记录）";
  console.log(`${config.name} 周度采集完成（${week}）：${result.count} 条 ${output}（${result.pages} 页，${result.complete ? "已完成" : "未完成"}）`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

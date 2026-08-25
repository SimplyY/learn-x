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
const WISDOM_RAW_FIELD = "长篇内容、原始内容";
const WISDOM_COMPRESSION_LABEL = "核心压缩内容";

// 采集器配置注册表。新增数据源在此追加一项。
const COLLECTORS = [
  {
    name: "智慧之门",
    sourceUrl: "https://ywhome.feishu.cn/wiki/KcTcwG90OiZh3rksu0ucvwx5nFe",
    tableId: "tblMGGWdVH4Iq9Og",
    fields: [
      "所属主题", "核心问题和使用场景", "一句话精华",
      WISDOM_RAW_FIELD, "层级", "智慧时效性", "创建时间",
    ],
    compression: { sourceField: WISDOM_RAW_FIELD, minChars: 200, maxChars: 500 },
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
    for (const k of config.fields) {
      const v = r.values[k];
      if (k === config.filterField) continue;
      if (config.compression?.sourceField === k) continue;
      if (v) lines.push(`- ${k}：${v}`);
    }
    if (config.compression) {
      const raw = String(r.values[config.compression.sourceField] || "").trim();
      const profile = wisdomCompressionProfile(raw, {
        anchor: r.values["一句话精华"],
        context: r.values["核心问题和使用场景"],
        level: r.values["层级"],
        timeliness: r.values["智慧时效性"],
        minChars: config.compression.minChars,
        maxChars: config.compression.maxChars,
      });
      const compressed = compressWisdomContent(raw, profile);
      if (compressed) {
        const rawChars = [...raw].length;
        const compressedChars = [...compressed].length;
        lines.push(`- ${WISDOM_COMPRESSION_LABEL}：${compressed}`);
        lines.push(`- 原文压缩：${rawChars} → ${compressedChars} 字符；自适应预算 ${profile.targetChars} 字符（范围 ${profile.minChars}-${profile.maxChars}）`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ponytail: 这是确定性抽取式压缩，不伪装成完整语义重写；若 Base 内容改为叙事长文，再升级为人工/AI 审核步骤。
export function wisdomCompressionProfile(raw, options = {}) {
  const source = String(raw || "").replace(/\r\n/g, "\n").trim();
  const minChars = Number(options.minChars || 200);
  const maxChars = Number(options.maxChars || 500);
  const units = wisdomUnits(source);
  const rawChars = [...source].length;
  if (!source || rawChars <= maxChars) return { minChars, maxChars, targetChars: rawChars, units, signalCount: 0 };
  const reference = `${options.anchor || ""} ${options.context || ""}`;
  const referenceTerms = String(reference).split(/[，。；、：\s]+/u).filter((term) => term.length >= 2);
  const signalCount = units.filter((line) => /本质|核心|关键|因此|结论|真正|最重要|最终|价值|风险|边界|迁移|不是|而是|适合|适用于|最强|最弱|瓶颈|护城河|长期竞争力|最稀缺/u.test(line)).length;
  const modelCount = units.filter((line) => /→|=|×|\+|从.+到/u.test(line)).length;
  const referenceCount = units.filter((line) => referenceTerms.some((term) => line.includes(term))).length;
  const sectionCount = units.filter((line) => /^\d+[）.)]|^[一二三四五六七八九十]+[、.]|^模块/u.test(line)).length;
  const signalDensity = Math.min(1, signalCount / Math.max(1, units.length));
  const structureDensity = Math.min(1, (modelCount + sectionCount) / Math.max(4, units.length / 2));
  const referenceDensity = Math.min(1, referenceCount / Math.max(1, units.length));
  const complexity = Math.min(1, Math.log2(units.length + 1) / 6);
  const importance = (/道|法/u.test(String(options.level || "")) ? 0.5 : 0)
    + (/长期/u.test(String(options.timeliness || "")) ? 0.5 : 0);
  // 预算以 300 左右为中心；密度和复杂度只做有限调整，避免“信号越多就无限加长”。
  const adaptive = 55 * signalDensity + 35 * structureDensity + 20 * referenceDensity
    + 35 * complexity + 20 * importance;
  return {
    minChars,
    maxChars,
    targetChars: Math.min(maxChars, Math.max(minChars, Math.round(240 + adaptive))),
    units,
    signalCount,
  };
}

export function compressWisdomContent(raw, options = {}) {
  const source = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!source) return "";
  const profile = options.targetChars == null ? wisdomCompressionProfile(source, options) : options;
  if ([...source].length <= profile.targetChars) return source.replace(/\n+/g, "；");
  const units = profile.units?.length ? profile.units : wisdomUnits(source);
  const target = profile.targetChars;
  const reference = `${options.anchor || ""} ${options.context || ""}`;
  const anchorTerms = reference.split(/[，。；、：\s]+/u).filter((term) => term.length >= 2);
  const unique = [...new Map(units.map((line) => [line.replace(/\s+/g, ""), line])).values()];
  const scored = unique.map((line, index) => {
    let score = index === 0 ? 2 : 0;
    if (/本质|核心|关键|因此|结论|真正|最重要|最终|价值|风险|边界|迁移|不是|而是|适合|适用于|最强|最弱|瓶颈|护城河|长期竞争力|最稀缺/u.test(line)) score += 8;
    if (/→|=|×|\+|从.+到/u.test(line)) score += 4;
    if (/^\d+[）.)]|^[一二三四五六七八九十]+[、.]/u.test(line)) score += 3;
    if (anchorTerms.some((term) => line.includes(term))) score += 2;
    if (line.length > target * 0.6) score -= 2;
    return { line, index, score };
  });
  const selected = [];
  let used = 0;
  for (const item of scored.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const length = [...item.line].length;
    const separator = selected.length ? 1 : 0;
    if (used + separator + length > target && selected.length) continue;
    selected.push(item);
    used += separator + length;
    if (used >= target) break;
  }
  return selected
    .sort((a, b) => a.index - b.index)
    .map(({ line }) => line.replace(/[；。！？]+$/u, "").trim())
    .filter(Boolean)
    .join("；");
}

function wisdomUnits(source) {
  if (!source) return [];
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const mergedLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(一句话结论|最终结论|结论|第一层|第二层|第三层|第四层|模块[一二三四])(?:\s|$)/u.test(line)
      && !/[：:。！？；]$/u.test(line) && lines[index + 1]) {
      mergedLines.push(`${line}：${lines[++index]}`);
    } else {
      mergedLines.push(line);
    }
  }
  return mergedLines
    .flatMap((line) => line.split(/(?<=[。！？；])/u))
    .map((line) => line.replace(/^[·•*-]\s*/, "").replace(/^【|】$/g, "").trim())
    .filter((line) => line.length >= 4);
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

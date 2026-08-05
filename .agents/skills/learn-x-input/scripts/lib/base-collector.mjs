// 飞书 Base 周采集共享核心。
// 封装定位 Base/表、核验字段、按周分页拉取、二次过滤、脱敏、原子写。
// 从 collect-daily-coach-weekly.mjs 提取，供配置驱动的通用采集器复用。

import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const TZ = "Asia/Shanghai";

/** ISO 周字符串 -> { start, startExclusive, end }（Asia/Shanghai）。 */
export function weekRange(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new Error(`无效周：${week}`);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (Number(match[2]) - 1) * 7);
  const date = (value) => value.toISOString().slice(0, 10);
  const start = date(monday);
  const endDate = new Date(monday);
  endDate.setUTCDate(monday.getUTCDate() + 7);
  const startExclusive = new Date(monday);
  startExclusive.setUTCSeconds(-1);
  return {
    start: `${start}T00:00:00+08:00`,
    startExclusive: `${date(startExclusive)}T23:59:59+08:00`,
    end: `${date(endDate)}T00:00:00+08:00`,
  };
}

/** 调 lark-cli，解析 JSON，ok != true 抛错。 */
export async function runLarkCli(args) {
  const { stdout } = await execFileAsync("lark-cli", args, {
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败");
  return result;
}

/** wiki/base URL -> base_token。 */
export async function resolveBase(url) {
  const result = await runLarkCli(["base", "+url-resolve", "--url", url, "--as", "bot", "--format", "json"]);
  return result.data?.base_token;
}

/** 列出 Base 下所有 block（表/视图等）。 */
export async function listTables(base) {
  const result = await runLarkCli(["base", "+base-block-list", "--base-token", base, "--as", "bot", "--format", "json"]);
  return result.data?.blocks || [];
}

/** 按名字或 tableId 找表。 */
export function findTable(blocks, { name, tableId } = {}) {
  if (tableId) return blocks.find((b) => (b.table_id || b.id) === tableId);
  if (name) return blocks.find((b) => b.name === name);
  return undefined;
}

/** 核验字段存在，防表结构漂移。 */
export async function verifyFields(base, tableId, required) {
  const result = await runLarkCli(["base", "+field-list", "--base-token", base, "--table-id", tableId, "--limit", "100", "--as", "bot", "--format", "json"]);
  const names = new Set((result.data?.fields || []).map((f) => f.name));
  const missing = required.filter((f) => !names.has(f));
  if (missing.length) throw new Error(`飞书表字段核验失败：${missing.join("、")}`);
}

/** 按 conditions 服务端筛 + 分页遍历，返回 { records, pages, complete }。 */
export async function listRecords(base, tableId, { fields, conditions, limit = 200 } = {}) {
  const pages = [];
  let offset = 0;
  let pageCount = 0;
  while (true) {
    const args = ["base", "+record-list", "--base-token", base, "--table-id", tableId, ...fields.flatMap((f) => ["--field-id", f])];
    if (conditions?.length) args.push("--filter-json", JSON.stringify({ logic: "and", conditions }));
    args.push("--offset", String(offset), "--limit", String(limit), "--as", "bot", "--format", "json");
    const result = await runLarkCli(args);
    const data = result.data || {};
    const names = data.fields || fields;
    const rows = data.data || [];
    pages.push(...rows.map((row, i) => ({
      id: data.record_id_list?.[i],
      values: Object.fromEntries(names.map((name, j) => [name, safeValue(row[j])])),
    })));
    pageCount += 1;
    if (!data.has_more) return { records: pages, pages: pageCount, complete: true };
    if (!rows.length) throw new Error("飞书 Base 分页 has_more=true 但没有新增记录。");
    offset += rows.length;
  }
}

/** 客户端二次时区过滤（服务端筛的兜底）。 */
export function filterByRange(records, field, range) {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  return records.filter((r) => {
    const value = r.values[field];
    if (!value) return false;
    const ts = Date.parse(String(value).replace(" ", "T") + (String(value).includes("+") ? "" : "+08:00"));
    return Number.isFinite(ts) && ts >= start && ts < end;
  });
}

/** 脱敏：对象过滤 id/contact/interview/token/secret，保留 name/text/url/file_name。 */
export function safeValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(safeValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    if (value.url) return String(value.url);
    if (value.file_name) return String(value.file_name);
    return Object.entries(value)
      .filter(([k]) => !/id|contact|interview|token|secret/i.test(k))
      .map(([k, v]) => `${k}:${safeValue(v)}`)
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

/** 原子写文件（先写 tmp 再 rename）。 */
export async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allowedUsageIds,
  mergeMonthCounts,
  monthTotal,
  readLocalUsageStore,
  readUsageBaseline,
  usagePaths,
  withUsageStoreLock,
  writeLocalUsageStore
} from "../../../../app/code/scripts/chatpack-usage.mjs";
import { compareMonths, currentShanghaiMonth, isValidUsageMonth, USAGE_SCHEMA_VERSION } from "../../../../app/code/public/chatpack-usage.js";
import { readChatPackConfig } from "../../../../app/code/scripts/static-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
const baselinePath = usagePaths(repoRoot).baseline;

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath && import.meta.url === invokedPath) await main();

export async function main() {
  const apply = process.argv.includes("--apply");
  let payload;
  try {
    payload = parsePayload(await readStdin());
  } catch (error) {
    console.error(JSON.stringify({ ok: false, errors: [error.message] }, null, 2));
    process.exitCode = 1;
    return;
  }
  const run = async () => {
    const config = await readChatPackConfig();
    const ids = allowedUsageIds(config);
    const baseline = await readUsageBaseline(repoRoot);
    const localStore = await readLocalUsageStore(repoRoot);
    const result = planMerge({ baseline, localStore, remote: payload, ids });

    if (result.errors.length) {
      console.error(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
      process.exitCode = 1;
    } else if (!apply) {
      console.log(JSON.stringify({ ok: true, dryRun: true, ...result.summary }, null, 2));
    } else {
      await assertBaselineClean();
      const { local: localPath } = usagePaths(repoRoot);
      const previousBaseline = await readFile(baselinePath, "utf8");
      let previousLocal = null;
      try {
        previousLocal = await readFile(localPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await writeFileAtomically(baselinePath, `${JSON.stringify(result.baseline, null, 2)}\n`);
        await writeLocalUsageStore(repoRoot, result.localStore);
      } catch (error) {
        // ponytail: two-file commit with rollback; move to a journal only if this ever proves insufficient.
        await writeFileAtomically(baselinePath, previousBaseline);
        if (previousLocal === null) await unlink(localPath).catch(() => {});
        else await writeFile(localPath, previousLocal, "utf8");
        throw error;
      }
      console.log(JSON.stringify({ ok: true, applied: true, ...result.summary }, null, 2));
    }
  };
  try {
    if (apply) await withUsageStoreLock(repoRoot, run);
    else await run();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, errors: [error.message || "合并失败"] }, null, 2));
    process.exitCode = 1;
  }
}

async function writeFileAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function assertBaselineClean() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const result = await run("git", ["status", "--porcelain", "--untracked-files=all", "--", "00_config/chatpack-usage.json"], { cwd: repoRoot });
  if (result.stdout.trim()) throw new Error("统计基线存在未提交改动，停止合并");
}

export function parsePayload(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)\s*```/gi)];
  if (blocks.length > 1) throw new Error("使用记录只能包含一个 JSON 代码块");
  const match = blocks[0] || String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("未找到 JSON 使用记录");
  try {
    return JSON.parse(match[1] || match[0]);
  } catch {
    throw new Error("使用记录 JSON 无法解析");
  }
}

export function planMerge({ baseline, localStore, remote, ids }) {
  const errors = [];
  const extraKeys = remote && typeof remote === "object" ? Object.keys(remote).filter((key) => !["schemaVersion", "months"].includes(key)) : [];
  if (extraKeys.length) errors.push(`使用记录包含不支持的字段: ${extraKeys.join(", ")}`);
  if (remote?.schemaVersion !== USAGE_SCHEMA_VERSION || !remote?.months || typeof remote.months !== "object" || Array.isArray(remote.months)) {
    errors.push("使用记录 schemaVersion 或 months 无效");
    return { errors, summary: {} };
  }
  const remoteMonths = new Map(Object.entries(remote.months));
  const localMonths = new Map(Object.entries(localStore.months || {}));
  const months = [...new Set([...remoteMonths.keys(), ...localMonths.keys()])]
    .filter((month) => compareMonths(month, baseline.mergedThrough) > 0)
    .sort(compareMonths);
  const current = currentShanghaiMonth();
  const nextBaseline = { ...baseline, subtypes: { ...baseline.subtypes }, enhancers: { ...baseline.enhancers } };
  const nextLocal = { ...localStore, months: { ...(localStore.months || {}) }, events: { ...(localStore.events || {}) } };
  const merged = [];

  for (const month of months) {
    const errorsBeforeMonth = errors.length;
    if (!isValidUsageMonth(month)) {
      errors.push(`非法月份: ${month}`);
      continue;
    }
    if (compareMonths(month, current) >= 0) {
      errors.push(`不能合并当前或未来月份: ${month}`);
      continue;
    }
    const remoteCounts = validateMonth(remoteMonths.get(month), ids, `外网 ${month}`, errors);
    const localCounts = validateMonth(localMonths.get(month), ids, `本地 ${month}`, errors);
    const total = monthTotal(remoteCounts) + monthTotal(localCounts);
    if (total > 500) errors.push(`${month} 单月总量 ${total} 超过 500`);
    for (const kind of ["subtypes", "enhancers"]) {
      for (const [id, count] of Object.entries(remoteCounts[kind])) {
        if (count > 200) errors.push(`${month} ${id} 月增量 ${count} 超过 200`);
      }
      for (const [id, count] of Object.entries(localCounts[kind])) {
        if (count > 200) errors.push(`${month} ${id} 月增量 ${count} 超过 200`);
      }
    }
    const remoteTotal = monthTotal(remoteCounts);
    const localTotal = monthTotal(localCounts);
    const larger = Math.max(remoteTotal, localTotal);
    const smaller = Math.min(remoteTotal, localTotal);
    if (larger >= 100 && (smaller === 0 || larger / smaller > 20)) {
      errors.push(`${month} 手机/电脑总量差异超过 20 倍（${remoteTotal} vs ${localTotal}）`);
    }
    if (errors.length === errorsBeforeMonth) {
      mergeMonthCounts(nextBaseline, { ...remoteCounts, month });
      mergeMonthCounts(nextBaseline, { ...localCounts, month });
      nextBaseline.mergedThrough = month;
      delete nextLocal.months[month];
      for (const [eventId, event] of Object.entries(nextLocal.events)) {
        if (event.month === month) delete nextLocal.events[eventId];
      }
      merged.push({ month, remoteTotal, localTotal, total });
    }
  }

  return {
    errors,
    baseline: nextBaseline,
    localStore: nextLocal,
    summary: { merged, mergedThrough: nextBaseline.mergedThrough }
  };
}

export function validateMonth(value, ids, label, errors) {
  const counts = { subtypes: {}, enhancers: {} };
  if (value === undefined) return counts;
  if (!value || typeof value !== "object") {
    errors.push(`${label} 数据无效`);
    return counts;
  }
  for (const [kind, allowed] of [["subtypes", ids.subtypes], ["enhancers", ids.enhancers]]) {
    if (value[kind] !== undefined && (typeof value[kind] !== "object" || Array.isArray(value[kind]))) {
      errors.push(`${label}.${kind} 数据无效`);
      continue;
    }
    for (const [id, count] of Object.entries(value[kind] || {})) {
      if (!allowed.has(id)) errors.push(`${label} 出现未知 ID: ${id}`);
      else if (!Number.isSafeInteger(count) || count < 0) errors.push(`${label} 出现非法次数: ${id}`);
      else counts[kind][id] = count;
    }
  }
  if (value.managedVersions !== undefined) {
    if (!value.managedVersions || typeof value.managedVersions !== "object" || Array.isArray(value.managedVersions)) errors.push(`${label}.managedVersions 数据无效`);
    else {
      const versions = {};
      for (const [id, version] of Object.entries(value.managedVersions)) {
        if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id) || !version || (version.month !== undefined && !isValidUsageMonth(version.month)) || !Number.isInteger(version.revision) || version.revision < 0 || !/^[a-f0-9]{64}$/.test(version.sha256)) {
          errors.push(`${label} 出现非法 Prompt 版本: ${id}`);
        } else versions[id] = { month: version.month || label.match(/(\d{4}-\d{2})/)?.[1], revision: version.revision, sha256: version.sha256, ...(version.synced_at ? { synced_at: version.synced_at } : {}) };
      }
      counts.managedVersions = versions;
    }
  }
  return counts;
}

export function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > 1_000_000) reject(new Error("使用记录过大"));
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

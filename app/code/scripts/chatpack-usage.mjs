import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  USAGE_SCHEMA_VERSION,
  addUsageCount,
  cloneUsage,
  compareMonths,
  currentShanghaiMonth,
  emptyMonthCounts,
  emptyUsageStore,
  isValidUsageMonth
} from "../public/chatpack-usage.js";

export const USAGE_BASELINE_RELATIVE_PATH = "00_config/chatpack-usage.json";
export const LOCAL_USAGE_RELATIVE_PATH = "app/code/.local/chatpack-usage.json";
const USAGE_ID_MIGRATIONS = { "learning-insight.munger-soul": "insight.munger-soul" };

export function usagePaths(repoRoot) {
  return {
    baseline: path.join(repoRoot, USAGE_BASELINE_RELATIVE_PATH),
    local: path.join(repoRoot, LOCAL_USAGE_RELATIVE_PATH)
  };
}

export function allowedUsageIds(config) {
  return {
    subtypes: new Set((config.dialogueTypes || []).flatMap((type) => (type.subtypes || []).map((item) => item.id))),
    enhancers: new Set((config.enhancers || []).filter((item) => item.group !== "length").map((item) => item.id))
  };
}

export async function readUsageBaseline(repoRoot) {
  const { baseline } = usagePaths(repoRoot);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(baseline, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Chat Pack usage baseline is missing");
    throw error;
  }
  if (parsed.schemaVersion !== USAGE_SCHEMA_VERSION || !isValidUsageMonth(parsed.mergedThrough)) {
    throw new Error("Invalid Chat Pack usage baseline");
  }
  for (const kind of ["subtypes", "enhancers"]) {
    if (parsed[kind] !== undefined && (!parsed[kind] || typeof parsed[kind] !== "object" || Array.isArray(parsed[kind]))) {
      throw new Error(`Invalid usage counts: ${kind}`);
    }
    for (const [id, count] of Object.entries(parsed[kind] || {})) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid usage count: ${kind}.${id}`);
    }
  }
  const result = {
    schemaVersion: USAGE_SCHEMA_VERSION,
    mergedThrough: parsed.mergedThrough,
    subtypes: { ...(parsed.subtypes || {}) },
    enhancers: { ...(parsed.enhancers || {}) }
  };
  if (parsed.lastUsedMonth !== undefined) { validateLastUsedMonth(parsed.lastUsedMonth); result.lastUsedMonth = parsed.lastUsedMonth; }
  if (parsed.managedVersions !== undefined) { validateManagedVersions(parsed.managedVersions); result.managedVersions = parsed.managedVersions; }
  return result;
}

export async function readLocalUsageStore(repoRoot) {
  const { local } = usagePaths(repoRoot);
  try {
    const parsed = JSON.parse(await readFile(local, "utf8"));
    if (parsed.schemaVersion !== USAGE_SCHEMA_VERSION || !parsed.device || !parsed.months || typeof parsed.months !== "object" || Array.isArray(parsed.months)) {
      throw new Error("Invalid local Chat Pack usage store");
    }
    for (const [month, counts] of Object.entries(parsed.months)) {
      if (!isValidUsageMonth(month) || !counts || typeof counts !== "object" || Array.isArray(counts)) throw new Error("Invalid local Chat Pack usage month");
      for (const kind of ["subtypes", "enhancers"]) {
        if (counts[kind] !== undefined && (!counts[kind] || typeof counts[kind] !== "object" || Array.isArray(counts[kind]))) throw new Error("Invalid local Chat Pack usage counts");
        for (const count of Object.values(counts[kind] || {})) {
          if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid local Chat Pack usage count");
        }
      }
      if (counts.managedVersions !== undefined) validateManagedVersions(counts.managedVersions);
    }
    return {
      schemaVersion: USAGE_SCHEMA_VERSION,
      device: parsed.device,
      events: { ...(parsed.events || {}) },
      months: parsed.months
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyUsageStore("desktop");
    throw error;
  }
}

export function validateUsageEvent(payload, config, now = new Date()) {
  const ids = allowedUsageIds(config);
  if (!payload || typeof payload !== "object") throw new Error("Usage event must be an object");
  if (typeof payload.eventId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.eventId)) {
    throw new Error("Invalid usage event id");
  }
  if (payload.month !== currentShanghaiMonth(now)) throw new Error("Usage event must target the current month");
  if (!ids.subtypes.has(payload.subtypeId)) throw new Error(`Unknown subtype usage id: ${payload.subtypeId}`);
  if (!Array.isArray(payload.enhancerIds)) throw new Error("enhancerIds must be an array");
  const enhancerIds = [...new Set(payload.enhancerIds)];
  if (enhancerIds.some((id) => !ids.enhancers.has(id))) throw new Error("Unknown enhancer usage id");
  if (payload.managedVersions !== undefined) validateManagedVersions(payload.managedVersions);
  const managedVersions = normalizeManagedVersions(payload.managedVersions, payload.month);
  return { eventId: payload.eventId, month: payload.month, subtypeId: payload.subtypeId, enhancerIds, ...(Object.keys(managedVersions).length ? { managedVersions } : {}) };
}

export async function recordLocalUsage({ repoRoot, payload, config, now = new Date() }) {
  return withUsageStoreLock(repoRoot, async () => {
    const event = validateUsageEvent(payload, config, now);
    const store = await readLocalUsageStore(repoRoot);
    if (store.events[event.eventId]) return { ok: true, duplicate: true, month: event.month };
    const month = store.months[event.month] || emptyMonthCounts();
    addUsageCount(month, "subtypes", event.subtypeId);
    for (const enhancerId of event.enhancerIds) addUsageCount(month, "enhancers", enhancerId);
    if (event.managedVersions) month.managedVersions = { ...(month.managedVersions || {}), ...event.managedVersions };
    store.months[event.month] = month;
    store.events[event.eventId] = event;
    await writeLocalUsageStore(repoRoot, store);
    return { ok: true, duplicate: false, month: event.month };
  });
}

export async function withUsageStoreLock(repoRoot, callback) {
  const lockPath = `${usagePaths(repoRoot).local}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await callback();
      } finally {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 60_000) await unlink(lockPath);
      } catch (staleError) {
        if (staleError.code !== "ENOENT") throw staleError;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Chat Pack usage store is busy");
}

export async function writeLocalUsageStore(repoRoot, store) {
  const { local } = usagePaths(repoRoot);
  await mkdir(path.dirname(local), { recursive: true });
  const temp = `${local}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, local);
}

export function buildUsageView(baseline, localStore = null) {
  const usage = cloneUsage(baseline);
  if (!localStore) return usage;
  for (const [month, counts] of Object.entries(localStore.months || {})) {
    if (!isValidUsageMonth(month) || compareMonths(month, usage.mergedThrough) <= 0) continue;
    for (const [id, count] of Object.entries(counts.subtypes || {})) addUsageCount(usage, "subtypes", USAGE_ID_MIGRATIONS[id] || id, count);
    for (const [id, count] of Object.entries(counts.enhancers || {})) addUsageCount(usage, "enhancers", id, count);
    updateUsageMonth(usage, month, counts);
  }
  return usage;
}

export function mergeMonthCounts(target, counts) {
  for (const kind of ["subtypes", "enhancers"]) {
    for (const [id, count] of Object.entries(counts?.[kind] || {})) addUsageCount(target, kind, id, count);
  }
  updateUsageMonth(target, counts?.month, counts);
}

function normalizeManagedVersions(values, month) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values).filter(([id, value]) =>
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id) && value && Number.isInteger(value.revision) && value.revision >= 0 && /^[a-f0-9]{64}$/.test(value.sha256)
  ).map(([id, value]) => [id, { month: value.month || month, revision: value.revision, sha256: value.sha256, ...(value.synced_at ? { synced_at: value.synced_at } : {}) }]));
}

function validateManagedVersions(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid managed prompt versions");
  for (const [id, value] of Object.entries(values)) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id) || !value || !isValidUsageMonth(value.month) || !Number.isInteger(value.revision) || value.revision < 0 || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(`Invalid managed prompt version: ${id}`);
  }
}

function validateLastUsedMonth(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid last-used month metadata");
  for (const kind of ["subtypes", "enhancers"]) {
    if (values[kind] === undefined) continue;
    if (!values[kind] || typeof values[kind] !== "object" || Array.isArray(values[kind])) throw new Error(`Invalid last-used month metadata: ${kind}`);
    for (const month of Object.values(values[kind])) if (!isValidUsageMonth(month)) throw new Error("Invalid last-used month value");
  }
}

function updateUsageMonth(usage, month, counts) {
  if (!isValidUsageMonth(month)) return;
  usage.lastUsedMonth ||= { subtypes: {}, enhancers: {} };
  for (const kind of ["subtypes", "enhancers"]) {
    for (const id of Object.keys(counts?.[kind] || {})) {
      usage.lastUsedMonth[kind] ||= {};
      if (!usage.lastUsedMonth[kind][id] || compareMonths(month, usage.lastUsedMonth[kind][id]) > 0) usage.lastUsedMonth[kind][id] = month;
    }
  }
  for (const [id, value] of Object.entries(counts?.managedVersions || {})) {
    if (!isValidUsageMonth(value?.month) || !Number.isInteger(value.revision) || !/^[a-f0-9]{64}$/.test(value.sha256)) continue;
    usage.managedVersions ||= {};
    if (!usage.managedVersions[id] || compareMonths(value.month, usage.managedVersions[id].month) >= 0) usage.managedVersions[id] = { ...value };
  }
}

export function monthTotal(counts) {
  // ponytail: subtype uses are the generation denominator; enhancers are per-generation annotations.
  return Object.values(counts?.subtypes || {}).reduce((sum, count) => sum + Number(count || 0), 0);
}

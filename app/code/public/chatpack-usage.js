export const USAGE_SCHEMA_VERSION = 1;
export const USAGE_STORAGE_KEY = "learn-x:chatpack-usage";

export function currentShanghaiMonth(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit"
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}`;
}

export function previousShanghaiMonth(date = new Date()) {
  const [year, month] = currentShanghaiMonth(date).split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function compareMonths(left, right) {
  return String(left).localeCompare(String(right));
}

export function isValidUsageMonth(month) {
  return typeof month === "string" && /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month);
}

export function normalizeUsageCounts(counts = {}, allowedIds = []) {
  const allowed = new Set(allowedIds);
  return Object.fromEntries(
    Object.entries(counts || {})
      .filter(([id]) => allowed.has(id))
      .map(([id, count]) => [id, Number.isSafeInteger(count) && count >= 0 ? count : 0])
  );
}

export function usageCount(usage, kind, id) {
  return Number(usage?.[kind]?.[id] || 0);
}

export function sortUsageItems(items, usage, kind = "subtypes") {
  return [...items]
    .map((item, index) => ({ item, index, count: usageCount(usage, kind, item.id) }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ item, count }) => ({ ...item, usageCount: count }));
}

export function isLowFrequencyUsage(count, index, total) {
  return count < 10 || index >= Math.ceil(total / 2);
}

export function addUsageCount(usage, kind, id, amount = 1) {
  if (!usage[kind]) usage[kind] = {};
  usage[kind][id] = usageCount(usage, kind, id) + amount;
}

export function emptyUsageStore(device = "browser") {
  return { schemaVersion: USAGE_SCHEMA_VERSION, device, events: {}, months: {} };
}

export function emptyMonthCounts() {
  return { subtypes: {}, enhancers: {} };
}

export function normalizeUsageStore(store, device = "browser") {
  if (!store || store.schemaVersion !== USAGE_SCHEMA_VERSION || !store.months || typeof store.months !== "object" || Array.isArray(store.months)) {
    return emptyUsageStore(device);
  }
  const months = {};
  for (const [month, counts] of Object.entries(store.months)) {
    if (!isValidUsageMonth(month) || !counts || typeof counts !== "object" || Array.isArray(counts)) continue;
    const normalized = emptyMonthCounts();
    for (const kind of ["subtypes", "enhancers"]) {
      if (!counts[kind] || typeof counts[kind] !== "object" || Array.isArray(counts[kind])) continue;
      for (const [id, count] of Object.entries(counts[kind])) {
        if (Number.isSafeInteger(count) && count >= 0) normalized[kind][id] = count;
      }
    }
    months[month] = normalized;
  }
  return { ...emptyUsageStore(store.device || device), months };
}

export function usageMonthEntries(store, mergedThrough, now = new Date()) {
  const currentMonth = currentShanghaiMonth(now);
  return Object.entries(store?.months || {})
    .filter(([month]) => isValidUsageMonth(month) && compareMonths(month, mergedThrough || "0000-00") > 0)
    .filter(([month]) => compareMonths(month, currentMonth) < 0)
    .sort(([left], [right]) => compareMonths(left, right));
}

export function buildUsageExport(store, mergedThrough, now = new Date()) {
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    months: Object.fromEntries(usageMonthEntries(store, mergedThrough, now))
  };
}

export function cloneUsage(usage = {}) {
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    mergedThrough: usage.mergedThrough || "0000-00",
    subtypes: { ...(usage.subtypes || {}) },
    enhancers: { ...(usage.enhancers || {}) }
  };
}

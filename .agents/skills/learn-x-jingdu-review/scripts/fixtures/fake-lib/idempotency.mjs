// fake-lib/idempotency：与实装契约同形 —— stableKey 异步 sha256 前 32 位；findApplied 按 dedupKey + APPLIED_STATUSES。
import { createHash } from "node:crypto";

export const APPLIED_STATUSES = ["applied", "skipped-identical"];

export async function stableKey(...parts) {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 32);
}

export function findApplied(records, key) {
  if (!Array.isArray(records)) return undefined;
  return records.find((record) => record?.dedupKey === key && APPLIED_STATUSES.includes(record.status));
}

// fake-lib/changeset：与实装契约同形 —— CHANGE_ITEM_KINDS、items[]/ambiguous[]、buildParsePrompt。
const KINDS = ["modified", "added", "endorsed", "untouched", "noise"];

export const CHANGE_ITEM_KINDS = [...KINDS];
export const USER_EVIDENCE_TYPES = ["edited-text", "endorsement-mark", "new-text"];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"];

export const CHANGESET_SCHEMA = {
  type: "object",
  required: ["version", "business", "week", "items"],
  properties: {
    version: { const: 1 },
    business: { type: "string" },
    week: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["itemId", "kind", "targetHint"],
        properties: { kind: { enum: KINDS } }
      }
    },
    ambiguous: { type: "array" }
  }
};

export function validateChangeset(json) {
  if (!json || typeof json !== "object") throw new Error("changeset 必须是对象");
  const items = json.items;
  if (!Array.isArray(items)) throw new Error("items 必须是数组");
  for (const item of items) {
    if (!item || !KINDS.includes(item.kind)) throw new Error(`非法变更类型：${item?.kind}`);
    if (!item.targetHint && item.kind !== "noise" && item.kind !== "untouched") throw new Error(`变更缺 targetHint：${item.itemId ?? "?"}`);
  }
  if (json.ambiguous !== undefined && !Array.isArray(json.ambiguous)) throw new Error("ambiguous 必须是数组");
  return json;
}

export function buildParsePrompt({ business, week, domainRules, snapshotFiles }) {
  const rules = Array.isArray(domainRules) ? domainRules.join("\n") : domainRules;
  const manifest = (snapshotFiles ?? [])
    .map((file) => (typeof file === "string" ? `- ${file}` : `- ${file.path}${file.note ? `（${file.note}）` : ""}`))
    .join("\n");
  return [
    `你是「${business} ${week}」手机审阅周变更解析器。你只读文件、只输出 JSON，不执行任何写操作。`,
    "",
    "## 业务判定规则",
    rules ?? "（本业务未提供额外规则）",
    "",
    "## 快照文件清单",
    manifest ?? "（无）",
    ""
  ].join("\n");
}

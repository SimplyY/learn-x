import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePayload, planMerge } from "./merge-prompt-usage.mjs";

const ids = {
  subtypes: new Set(["prompt-a"]),
  enhancers: new Set(["enhancer-a"])
};

function baseline() {
  return { schemaVersion: 1, mergedThrough: "2026-07", subtypes: { "prompt-a": 10 }, enhancers: { "enhancer-a": 2 } };
}

test("合并两端完整月份并清理本地月份", () => {
  const result = planMerge({
    baseline: baseline(),
    localStore: {
      schemaVersion: 1,
      device: "desktop",
      events: { event1: { month: "2026-08" } },
      months: { "2026-08": { subtypes: { "prompt-a": 2 }, enhancers: {} } }
    },
    remote: { schemaVersion: 1, months: { "2026-08": { subtypes: { "prompt-a": 3 }, enhancers: { "enhancer-a": 1 } } } },
    ids
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.baseline.mergedThrough, "2026-08");
  assert.equal(result.baseline.subtypes["prompt-a"], 15);
  assert.equal(result.baseline.enhancers["enhancer-a"], 3);
  assert.deepEqual(result.localStore.months, {});
  assert.deepEqual(result.summary.merged, [{ month: "2026-08", remoteTotal: 3, localTotal: 2, total: 5 }]);
});

test("缺少某端月份按零计数处理", () => {
  const result = planMerge({
    baseline: baseline(),
    localStore: { schemaVersion: 1, device: "desktop", months: { "2026-08": { subtypes: { "prompt-a": 2 }, enhancers: {} } } },
    remote: { schemaVersion: 1, months: {} },
    ids
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.baseline.subtypes["prompt-a"], 12);
});

test("异常值只返回错误，不生成可应用结果", () => {
  const result = planMerge({
    baseline: baseline(),
    localStore: { schemaVersion: 1, device: "desktop", months: {} },
    remote: { schemaVersion: 1, months: { "2026-08": { subtypes: { "unknown": 1 }, enhancers: {} } } },
    ids
  });
  assert.match(result.errors.join("\n"), /未知 ID/);
  assert.match(planMerge({ baseline: baseline(), localStore: { months: {} }, remote: { schemaVersion: 1, source: "phone", months: {} }, ids }).errors.join("\n"), /不支持的字段/);
});

test("单月总量过大或双端差异过大时停止", () => {
  const tooMany = planMerge({
    baseline: baseline(),
    localStore: { schemaVersion: 1, device: "desktop", months: {} },
    remote: { schemaVersion: 1, months: { "2026-08": { subtypes: { "prompt-a": 201 }, enhancers: { "enhancer-a": 300 } } } },
    ids
  });
  assert.match(tooMany.errors.join("\n"), /超过 500|超过 200/);

  const ratio = planMerge({
    baseline: baseline(),
    localStore: { schemaVersion: 1, device: "desktop", months: { "2026-08": { subtypes: { "prompt-a": 1 }, enhancers: {} } } },
    remote: { schemaVersion: 1, months: { "2026-08": { subtypes: { "prompt-a": 100 }, enhancers: {} } } },
    ids
  });
  assert.match(ratio.errors.join("\n"), /差异超过 20 倍/);
});

test("重复月份以 mergedThrough 幂等跳过", () => {
  const result = planMerge({
    baseline: { ...baseline(), mergedThrough: "2026-09" },
    localStore: { schemaVersion: 1, device: "desktop", months: {} },
    remote: { schemaVersion: 1, months: { "2026-09": { subtypes: { "prompt-a": 3 }, enhancers: {} } } },
    ids
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.summary.merged, []);
  assert.equal(result.baseline.subtypes["prompt-a"], 10);
});

test("只解析带说明的 JSON 代码块", () => {
  assert.deepEqual(parsePayload("说明\n```json\n{\"schemaVersion\":1}\n```"), { schemaVersion: 1 });
  assert.throws(() => parsePayload("没有 JSON"), /未找到 JSON/);
  assert.throws(() => parsePayload("```json\n{}\n```\n```json\n{}\n```"), /只能包含一个/);
});

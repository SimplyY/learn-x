import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildUsageExport,
  emptyUsageStore,
  isLowFrequencyUsage,
  normalizeUsageStore,
  sortUsageItems
} from "../public/chatpack-usage.js";
import { readLocalUsageStore, readUsageBaseline, recordLocalUsage } from "./chatpack-usage.mjs";

test("使用次数排序保持同次数的配置顺序", () => {
  const items = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  const usage = { subtypes: { a: 10, b: 20, c: 20 }, enhancers: {} };
  assert.deepEqual(sortUsageItems(items, usage).map((item) => item.id), ["b", "c", "a"]);
});

test("低频规则是低于 10 或排序后 50% 的并集", () => {
  assert.equal(isLowFrequencyUsage(9, 0, 10), true);
  assert.equal(isLowFrequencyUsage(10, 4, 10), false);
  assert.equal(isLowFrequencyUsage(10, 5, 10), true);
  assert.equal(isLowFrequencyUsage(10, 2, 7), false);
  assert.equal(isLowFrequencyUsage(8, 2, 7), true);
});

test("复制载荷排除当前月份和已合并月份", () => {
  const store = emptyUsageStore("browser");
  store.months = {
    "2026-08": { subtypes: { a: 1 }, enhancers: {} },
    "2026-09": { subtypes: { a: 2 }, enhancers: {} }
  };
  const payload = buildUsageExport(store, "2026-07", new Date("2026-09-12T00:00:00Z"));
  assert.deepEqual(payload, {
    schemaVersion: 1,
    months: {
    "2026-08": { subtypes: { a: 1 }, enhancers: {} }
    }
  });
});

test("本地记录按事件幂等，拒绝未知提示词", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-usage-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    dialogueTypes: [{ subtypes: [{ id: "prompt-a" }] }],
    enhancers: [{ id: "enhancer-a" }]
  };
  const month = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" })
    .formatToParts(new Date())
    .filter((part) => part.type !== "literal")
    .reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
  const currentMonth = `${month.year}-${month.month}`;
  const event = { eventId: "event-1234", month: currentMonth, subtypeId: "prompt-a", enhancerIds: ["enhancer-a"] };
  assert.equal((await recordLocalUsage({ repoRoot: root, payload: event, config })).duplicate, false);
  assert.equal((await recordLocalUsage({ repoRoot: root, payload: event, config })).duplicate, true);
  const store = await readLocalUsageStore(root);
  assert.equal(store.months[currentMonth].subtypes["prompt-a"], 1);
  await assert.rejects(
    () => recordLocalUsage({ repoRoot: root, payload: { ...event, eventId: "event-5678", subtypeId: "unknown" }, config }),
    /Unknown subtype/
  );
});

test("浏览器统计只保留合法月份和非负整数次数", () => {
  const store = normalizeUsageStore({
    schemaVersion: 1,
    months: {
      "2026-08": { subtypes: { a: 2, bad: -1, decimal: 1.5 }, enhancers: null },
      "2026-13": { subtypes: { a: 9 } },
      "2026-09": null
    }
  });
  assert.deepEqual(store.months, { "2026-08": { subtypes: { a: 2 }, enhancers: {} } });
});

test("统计基线缺失时失败关闭", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-usage-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => readUsageBaseline(root), /baseline is missing/);
});

test("并发本地记录不会丢失增量", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-usage-lock-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const config = { dialogueTypes: [{ subtypes: [{ id: "prompt-a" }] }], enhancers: [] };
  const month = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" })
    .formatToParts(new Date()).filter((part) => part.type !== "literal")
    .reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
  const currentMonth = `${month.year}-${month.month}`;
  await Promise.all(["event-aaaa", "event-bbbb"].map((eventId) => recordLocalUsage({
    repoRoot: root,
    payload: { eventId, month: currentMonth, subtypeId: "prompt-a", enhancerIds: [] },
    config
  })));
  const store = await readLocalUsageStore(root);
  assert.equal(store.months[currentMonth].subtypes["prompt-a"], 2);
});

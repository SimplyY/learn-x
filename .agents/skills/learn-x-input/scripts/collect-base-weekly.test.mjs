import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectOne } from "./collect-base-weekly.mjs";
import { filterByRange } from "./lib/base-collector.mjs";

const config = {
  name: "智慧之门",
  sourceUrl: "https://example.test/base",
  tableId: "target-table",
  fields: ["创建时间", "一句话精华"],
  filterField: "创建时间",
  outputFile: "wisdom.md",
  title: "智慧之门"
};

test("Wisdom collector preserves an old empty result and writes ready records", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-wisdom-status-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const output = path.join(outputRoot, "wisdom.md");
  await writeFile(output, "old wisdom\n", "utf8");
  const empty = await collectOne(config, "2026-W24", dependencies([] , outputRoot));
  assert.equal(empty.written, false);
  assert.equal(await readFile(output, "utf8"), "old wisdom\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "empty"/);

  const ready = await collectOne(config, "2026-W24", dependencies([
    { values: { "创建时间": "2026-06-08 10:00:00", "一句话精华": "真实智慧记录" } }
  ], outputRoot));
  assert.equal(ready.written, true);
  assert.match(await readFile(output, "utf8"), /真实智慧记录/);
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "ready"/);
});

test("Wisdom collector marks a query failure without replacing the old file", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-wisdom-fail-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const output = path.join(outputRoot, "wisdom.md");
  await writeFile(output, "old wisdom\n", "utf8");
  await assert.rejects(
    collectOne(config, "2026-W24", { ...dependencies([], outputRoot), resolveBase: async () => { throw new Error("query failed"); } }),
    /query failed/
  );
  assert.equal(await readFile(output, "utf8"), "old wisdom\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "failed"/);
});

function dependencies(records, outputRoot) {
  return {
    outputRoot,
    resolveBase: async () => "base",
    listTables: async () => [{ id: "target-table", name: "智慧之门" }],
    verifyFields: async () => {},
    listRecords: async () => ({ records, pages: 1, complete: true }),
    filterByRange
  };
}

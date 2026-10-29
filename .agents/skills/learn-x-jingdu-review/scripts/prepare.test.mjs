// prepare：幂等 / 划线逐字回读失败 → blocked / weread 非 ready / 0 划线 → empty。
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCommand } from "./lib/commands.mjs";
import { HIGHLIGHT_1, HIGHLIGHT_3, createTestRepo, makeContextOptions, makeDeps, WEEK } from "./helpers/harness.mjs";
import { readWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";

test("prepare creates the review doc, verifies readback verbatim, binds and writes baseline", async (t) => {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const outcome = await runCommand(["prepare", "--week", WEEK, "--json"], makeContextOptions({ repo, deps: makeDeps({ larkState }) }));
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
  assert.equal(outcome.result.status, "created");
  assert.equal(outcome.result.highlightCount, 5);
  assert.match(outcome.result.docUrl, /docFAKE001/);
  assert.equal(outcome.result.location.mode, "default");

  const baseline = JSON.parse(await readFile(repo.runtime("baseline.json"), "utf8"));
  assert.equal(baseline.week, WEEK);
  assert.equal(baseline.books.length, 2);
  assert.equal(baseline.books[0].chapters[0].entries[0].text, HIGHLIGHT_1);
  // AI 分析候选：确定性来自 ai.md（波动/复利段落与第二章相关）。
  assert.ok(Object.keys(baseline.aiCandidates).length >= 1, `aiCandidates: ${JSON.stringify(baseline.aiCandidates)}`);

  const records = (await readFile(repo.runtime("records.jsonl"), "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  const binding = records.find((record) => record.kind === "binding/v1");
  assert.ok(binding, "binding/v1 已落 records");
  assert.equal(binding.contentSha256.length, 64);
  assert.equal(binding.xml.includes(HIGHLIGHT_1), true);

  const docXml = larkState.docs.docFAKE001.xml;
  assert.match(docXml, /<colgroup><col width="160"\/><col width="390"\/><col width="150"\/><col width="290"\/><col width="290"\/><\/colgroup>/);
  assert.ok(docXml.includes(HIGHLIGHT_1) && docXml.includes(HIGHLIGHT_3));
  assert.match(docXml, /【AI 分析候选】/);
});

test("prepare is idempotent: second run reuses the binding and does not create another doc", async (t) => {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const options = makeContextOptions({ repo, deps: makeDeps({ larkState }) });
  const first = await runCommand(["prepare", "--week", WEEK], options);
  assert.equal(first.exitCode, 0);
  const second = await runCommand(["prepare", "--week", WEEK], options);
  assert.equal(second.exitCode, 0);
  assert.equal(second.result.status, "reused");
  assert.equal(larkState.counters.doc, 1, "不重复建档");
});

test("prepare rebuilds once when readback misses a highlight, then blocks without binding", async (t) => {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [HIGHLIGHT_1] };
  const outcome = await runCommand(["prepare", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps({ larkState }) }));
  assert.equal(outcome.exitCode, 3, JSON.stringify(outcome.result));
  assert.equal(outcome.result.status, "blocked");
  assert.match(outcome.result.reason, /回读校验两次失败/);
  assert.equal(larkState.counters.doc, 2, "重建一次");
  await assert.rejects(() => readFile(repo.runtime("baseline.json"), "utf8"), /ENOENT/, "失败不写 baseline");
  const records = await readFile(repo.runtime("records.jsonl"), "utf8");
  assert.match(records, /"command":\s*"prepare"/);
  assert.match(records, /"ok":\s*false/);
  const sidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(sidecar.sources.jingdu, undefined, "失败不登记 jingdu");
});

test("prepare blocks honestly when weread is not ready", async (t) => {
  const repo = await createTestRepo(t, { wereadFixture: "weread-empty.md" });
  const sidecarRaw = JSON.parse(await readFile(path.join(repo.weekRoot, "_source-status.json"), "utf8"));
  sidecarRaw.sources.weread.status = "failed";
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(repo.weekRoot, "_source-status.json"), JSON.stringify(sidecarRaw, null, 2));
  const outcome = await runCommand(["prepare", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps() }));
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.result.reason, /weread 状态为 failed/);
});

test("prepare registers jingdu empty and skips doc creation when there are no highlights", async (t) => {
  const repo = await createTestRepo(t, { wereadFixture: "weread-empty.md" });
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const outcome = await runCommand(["prepare", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps({ larkState }) }));
  assert.equal(outcome.exitCode, 2, JSON.stringify(outcome.result));
  assert.equal(outcome.result.status, "empty");
  assert.equal(larkState.counters.doc, 0, "0 划线不建文档");
  const sidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(sidecar.sources.jingdu.status, "empty");
  assert.equal(sidecar.sources.jingdu.count, 0);
});

test("invalid week is rejected", async (t) => {
  const repo = await createTestRepo(t);
  const outcome = await runCommand(["prepare", "--week", "2026-W99"], makeContextOptions({ repo, deps: makeDeps() }));
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.result.error.message, /无效周/);
});

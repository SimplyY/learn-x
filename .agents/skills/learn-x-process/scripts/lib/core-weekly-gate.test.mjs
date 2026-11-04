import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertWeeklyCoreLinks, requireCoreWeeklyGate } from "./core-weekly-gate.mjs";

test("范围门禁按周逐一执行且全部通过才返回", async () => {
  const calls = [];
  const result = await requireCoreWeeklyGate(["2026-W43", "2026-W44"], {
    validateJournalLinks: false,
    runGate: async week => { calls.push(week); return { week, ok: true, docId: `doc-${week}` }; }
  });
  assert.deepEqual(calls, ["2026-W43", "2026-W44"]);
  assert.deepEqual(result.map(item => item.week), calls);
});

test("范围流程汇总每周所有缺项后阻止 Process Pack", async () => {
  const calls = [];
  await assert.rejects(requireCoreWeeklyGate(["2026-W43", "2026-W44"], {
    validateJournalLinks: false,
    runGate: async week => {
      calls.push(week);
      return { week, ok: false, reason: "first-thought-incomplete", docId: `doc-${week}`, missingFields: [{ row: week.endsWith("43") ? 2 : 3, fields: ["现实反馈"] }] };
    }
  }), /2026-W43: 第 2 行 现实反馈（first-thought-incomplete）；2026-W44: 第 3 行 现实反馈（first-thought-incomplete）/);
  assert.deepEqual(calls, ["2026-W43", "2026-W44"]);
});

test("范围 Process Pack 门禁要求清单与锚点的每周链接回执一致", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-core-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "03_input/weekly/2026-W43-W44");
  await mkdir(directory, { recursive: true });
  const links = ["2026-W43", "2026-W44"].map((week, index) => ({
    week, documentId: `doc-${index + 1}`, url: `https://ywhome.feishu.cn/docx/doc-${index + 1}`, status: "verified"
  }));
  await writeFile(path.join(directory, "_weekly-journal-anchor.json"), JSON.stringify({
    periodId: "2026-W43-W44", weeks: ["2026-W43", "2026-W44"], coreLinks: links
  }));
  const manifestPath = path.join(directory, "_range-manifest.json");
  await writeFile(manifestPath, JSON.stringify({ period: { id: "2026-W43-W44" }, core: { status: "links-verified", links } }));
  assert.deepEqual((await assertWeeklyCoreLinks(["2026-W43", "2026-W44"], { repoRoot: root })).map(item => item.week), ["2026-W43", "2026-W44"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.core.links[1].status = "pending";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(assertWeeklyCoreLinks(["2026-W43", "2026-W44"], { repoRoot: root }), /组成周 Core 链接未全部核验/);
});

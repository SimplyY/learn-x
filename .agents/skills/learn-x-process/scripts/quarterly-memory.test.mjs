import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { lastCompleteQuarter, promoteMemoryCompression, quarterEndDate, validateMemoryCompression, weekLabelsInQuarter } from "./memory-compression.mjs";
import { importQuarterlyDelivery, planQuarterlyPack } from "./quarterly-memory.mjs";

var Q3_BODY = [
"# Learn-X Memory｜2026-Q3",
"",
"## 候选观察池",
"",
"- [2026-W28] 观察项：读书会现场恢复创作能量。",
"",
"## 2026-W28",
"",
"### Memory",
"",
"- [2026-W28] 七月判断 A：出门、运动维持稳定节奏。",
"",
"## 2026-W30",
"",
"### Memory",
"",
"- [2026-W30] 七月底判断 B：写诗恢复表达。",
"",
"## Monthly｜2026-08",
"",
"### Memory",
"",
"- [Monthly｜2026-08] 八月判断 C：真实聊天提供反馈。"
].join("\n");
var Q2_BODY = [
"# Learn-X Memory｜2026-Q2",
"",
"## 2026-W18",
"",
"### Memory",
"",
"- [2026-W18] 四月判断 D：旧约束仍然成立。",
"",
"## Monthly｜2026-05",
"",
"### Memory",
"",
"- [Monthly｜2026-05] 五月判断 E：预算边界确认。"
].join("\n");
var Q4_BODY = "# Learn-X Memory｜2026-Q4\n\n## 2026-W41\n\n### Memory\n\n- [2026-W41] 十月进行中判断。\n";
var UNATTRIBUTED = "\n\n## 未识别来源\n\n- 未识别来源判断，默认保护。\n";
var Q3_FULL = Q3_BODY + UNATTRIBUTED;

async function quarterlyFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "learn-x-quarterly-"));
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await mkdir(path.join(root, "03_input/weekly/2026-W31"), { recursive: true });
  await mkdir(path.join(root, "03_input/monthly/2026-8"), { recursive: true });
  await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  await mkdir(path.join(root, "04_output/monthly"), { recursive: true });
  await mkdir(path.join(root, "02_prompts/meta"), { recursive: true });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), Q3_FULL);
  await writeFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), Q2_BODY);
  await writeFile(path.join(root, "01_core/memory/2026-Q4.memory.md"), Q4_BODY);
  await writeFile(path.join(root, "02_prompts/meta/chatgpt-quarterly-memory-review.md"), "冻结 Prompt：一、角色与使命");
  await writeFile(path.join(root, "03_input/weekly/2026-W31/weekly.md"), "周输入材料。");
  await writeFile(path.join(root, "03_input/weekly/2026-W31/weread.md"), "微信读书材料。");
  await writeFile(path.join(root, "03_input/weekly/2026-W31/_source-status.json"), JSON.stringify({ version: 1, week: "2026-W31", sources: { weread: { status: "ready", file: "weread.md" }, wisdom: { status: "empty" } } }));
  await writeFile(path.join(root, "03_input/monthly/2026-8/monthly-journal.md"), "月记材料。");
  await writeFile(path.join(root, "04_output/weekly/2026-31.md"), "周报正文。");
  await writeFile(path.join(root, "04_output/monthly/2026-08.md"), "月报正文。");
  return root;
}

var SUMMARY = {
  whatChanged: "把 2026-W28、W30 与 Monthly｜2026-08 的重复判断合并为一条核心判断，保留出门、运动、写诗、真实聊天等具象锚点。\n\n候选观察池与未识别来源保护单元原样保留。",
  primaryRisk: "风险来自合并七月与八月判断。\n\n不同时间点的真实变化可能被压缩成单一结论，需要人工核对时间演化是否保留。"
};

function q3Changes() {
  return [{
    topic: "七月至八月判断合并",
    original: "七月判断 A、七月底判断 B、八月判断 C 各自独立记录。",
    candidate: "合并为一条带三个来源标签的核心判断。",
    kind: "压缩/合并",
    action: "合并重复判断，保留来源标签。",
    review: "确认时间演化未被抹去。",
    risk: "中",
    riskReason: "独立限定可能被合并。"
  }];
}

async function writeDelivery(root, files) {
  const delivery = path.join(root, "delivery");
  await mkdir(delivery, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(delivery, name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return delivery;
}


test("resolves quarter boundaries and the last complete quarter", () => {
  assert.equal(quarterEndDate("2026-Q3"), "2026-09-30");
  assert.deepEqual([weekLabelsInQuarter("2026-Q3")[0], weekLabelsInQuarter("2026-Q3").at(-1)], ["2026-W27", "2026-W40"]);
  assert.equal(lastCompleteQuarter("2026-11-23"), "2026-Q3");
  assert.equal(lastCompleteQuarter("2027-01-05"), "2026-Q4");
  assert.equal(lastCompleteQuarter("2026-12-31"), "2026-Q3");
});

var CANDIDATE_Q3 = ["# Learn-X Memory｜2026-Q3", "", "## 候选观察池", "", "- [2026-W28] 观察项：读书会现场恢复创作能量。", "", "## 压缩合并", "", "- [2026-W28][2026-W30][Monthly｜2026-08] 七月至八月判断：出门、运动维持稳定节奏；写诗恢复表达；真实聊天提供反馈。", "", "## 未识别来源", "", "- 未识别来源判断，默认保护。"].join("\n");

test("generates a quarterly pack without modifying originals and marks gaps", async () => {
  const root = await quarterlyFixture();
  const before = await readFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "utf8");
  const result = await planQuarterlyPack({ repoRoot: root, asOf: "2026-10-15" });
  assert.equal(result.quarter, "2026-Q3");
  assert.equal(result.status, "pack_ready");
  assert.equal(result.targetFile.path, "01_core/memory/2026-Q3.memory.md");
  const pack = await readFile(path.join(root, result.packPath), "utf8");
  for (const section of ["## A｜过去是什么", "## B｜现在是什么", "## C｜目标是什么", "## D｜约束是什么", "## E｜如何执行与交付", "quarterly-sources-manifest.json", "冻结 Prompt：一、角色与使命", "硬上限 = max(200, floor(8000 × 0.6^年龄))"]) {
    assert.ok(pack.includes(section), "pack missing: " + section);
  }
  assert.ok(pack.includes("七月判断 A"), "pack must contain the verbatim target memory");
  const manifest = JSON.parse(await readFile(path.join(root, result.manifestPath), "utf8"));
  assert.equal(manifest.quarter, "2026-Q3");
  assert.ok(manifest.sources.weeks.some((week) => week.label === "2026-W31" && week.statuses.weread === "ready"));
  const after = await readFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "utf8");
  assert.equal(before, after);
  assert.ok(result.gapCount > 0, "fixture intentionally provides only W31, so missing weeks must be reported");
  assert.ok(pack.includes("周输入目录缺失"), "gaps must be visible in the pack");
});

test("pack generation fails closed when the frozen prompt resource is missing", async () => {
  const root = await quarterlyFixture();
  await import("node:fs/promises").then((fs) => fs.unlink(path.join(root, "02_prompts/meta/chatgpt-quarterly-memory-review.md")));
  await assert.rejects(() => planQuarterlyPack({ repoRoot: root, asOf: "2026-10-15" }), /Missing prompt resource/);
});

test("rejects an incomplete quarter override", async () => {
  const root = await quarterlyFixture();
  await assert.rejects(() => planQuarterlyPack({ repoRoot: root, asOf: "2026-11-23", quarter: "2026-Q4" }), /not complete/);
});

test("imports a chatgpt delivery into a validated quarterly candidate", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": CANDIDATE_Q3,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes(), otherChanges: [] }] }
  });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.status, "ready");
  assert.equal(result.imported.length, 1);
  assert.ok(result.imported[0].includes("quarterly-2026-Q3/2026-Q3.memory/2026-Q3.memory.compressed.md"));
  const metadata = JSON.parse(await readFile(path.join(path.dirname(path.join(root, result.imported[0])), ".memory-compression.json"), "utf8"));
  assert.equal(metadata.mode, "quarterly");
  assert.equal(metadata.hardLimit, 8000);
  assert.ok(metadata.protectedUnitIds.every((id) => id.includes("未识别来源") || id.startsWith("01_core/memory/2026-Q3.memory.md")));
  assert.equal(metadata.protectedUnitIds.length, 1);
  const validation = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q3.memory") });
  assert.equal(validation.status, "ready");
});

test("blocks an unconfirmed historical correction and keeps the formal file untouched", async () => {
  const root = await quarterlyFixture();
  const before = await readFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), "utf8");
  const edited = Q2_BODY.replace("四月判断 D：旧约束仍然成立。", "四月判断 D：未经确认的新表述。");
  const delivery = await writeDelivery(root, {
    "2026-Q2.memory.md": edited,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q2.memory.md", changeSummary: SUMMARY, changes: [{ topic: "跨期纠偏", original: "旧约束仍然成立", candidate: "未经确认的新表述", kind: "改动", action: "改写历史判断", review: "需用户确认" }] }] }
  });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.status, "needs_review");
  assert.equal(result.validationResults[0].protectedOk, false);
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q2.memory"), confirm: true }), /protected/);
  const after = await readFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), "utf8");
  assert.equal(before, after);
});

test("a user-confirmed historical correction passes protection and promotes safely", async () => {
  const root = await quarterlyFixture();
  const edited = Q2_BODY.replace("四月判断 D：旧约束仍然成立。", "四月判断 D：依据新证据修正为 E 场景成立。");
  const delivery = await writeDelivery(root, {
    "2026-Q2.memory.md": edited,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q2.memory.md", changeSummary: SUMMARY, changes: [{ topic: "跨期纠偏", original: "四月判断 D：旧约束仍然成立。", candidate: "四月判断 D：依据新证据修正为 E 场景成立。", kind: "改动", action: "依据用户确认的证据修正", review: "用户已在评审会话中逐项确认" }] }], confirmedCorrections: [{ targetFile: "2026-Q2.memory.md", unitText: "四月判断 D：旧约束仍然成立。", evidence: "新证据来自季度材料 W31 周输入。", summary: "用户在多轮评审中确认修正旧约束判断。" }] }
  });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.status, "ready");
  const candidateDir = path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q2.memory");
  const promote = await promoteMemoryCompression({ repoRoot: root, candidatePath: candidateDir, confirm: true });
  assert.equal(promote.status, "promoted");
  const formal = await readFile(path.join(root, "01_core/memory/2026-Q2.memory.md"), "utf8");
  assert.equal(formal, edited);
  const archiveFiles = await readdir(path.join(root, "01_core/memory-archive/compression/2026-10-15"), { recursive: true });
  const archived = archiveFiles.find((name) => name.endsWith("2026-Q2.memory.md"));
  assert.ok(archived, "archive must contain the original source");
  const archivedContent = await readFile(path.join(root, "01_core/memory-archive/compression/2026-10-15", archived), "utf8");
  assert.equal(archivedContent, Q2_BODY);
});

test("a no-change delivery produces a receipt and no candidate", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, { "changes.json": { quarter: "2026-Q3", noChange: true, targets: [], notes: "本季度无需修改" } });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.status, "no_change");
  const receipt = JSON.parse(await readFile(path.join(root, result.receiptPath), "utf8"));
  assert.equal(receipt.quarter, "2026-Q3");
  const reviewRoot = path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3");
  const entries = await readdir(reviewRoot);
  assert.deepEqual(entries.filter((name) => name.endsWith(".compressed.md")), []);
});

test("resolves ambiguous confirmed-correction unitText by refusing the import", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": CANDIDATE_Q3,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: [] }], confirmedCorrections: [{ targetFile: "2026-Q3.memory.md", unitText: "判断", evidence: "x", summary: "y" }] }
  });
  await assert.rejects(() => importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" }), /matched 0 units|matched [2-9] units/);
});

test("never silently overwrites an already-imported reviewed candidate", async () => {
  const root = await quarterlyFixture();
  const changes = { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes(), otherChanges: [] }] };
  const delivery1 = await writeDelivery(root, { "2026-Q3.memory.md": CANDIDATE_Q3, "changes.json": changes });
  await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery1, asOf: "2026-10-15" });
  const delivery2 = path.join(root, "delivery2");
  await mkdir(delivery2, { recursive: true });
  await writeFile(path.join(delivery2, "2026-Q3.memory.md"), CANDIDATE_Q3 + "\n<!-- 不同内容 -->\n");
  await writeFile(path.join(delivery2, "changes.json"), JSON.stringify(changes));
  await assert.rejects(() => importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery2, asOf: "2026-10-15" }), /never silently overwritten/);
});

test("multi-file delivery imports each target and validates per candidate", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": CANDIDATE_Q3,
    "2026-Q2.memory.md": Q2_BODY.replace("五月判断 E：预算边界确认。", "五月判断 E：预算边界确认，补充适用条件。"),
    "changes.json": { quarter: "2026-Q3", targets: [
      { targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes() },
      { targetFile: "2026-Q2.memory.md", changeSummary: SUMMARY, changes: [{ topic: "五月补充", original: "五月判断 E：预算边界确认。", candidate: "五月判断 E：预算边界确认，补充适用条件。", kind: "改动", action: "补充适用条件", review: "用户确认补充" }] }
    ], confirmedCorrections: [{ targetFile: "2026-Q2.memory.md", unitText: "五月判断 E：预算边界确认。", evidence: "季度材料补充证据。", summary: "用户确认补充适用条件。" }] }
  });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.imported.length, 2);
  assert.equal(result.status, "ready");
  assert.ok(result.validationResults.every((entry) => entry.status === "ready"));
});

test("stops promotion on hard-limit conflicts instead of silently trimming", async () => {
  const root = await quarterlyFixture();
  const bloated = CANDIDATE_Q3 + "\n" + " filler 字符 ".repeat(2000);
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": bloated,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes() }] }
  });
  const result = await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  assert.equal(result.status, "needs_review");
  assert.equal(result.validationResults[0].hardLimitOk, false);
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q3.memory"), confirm: true }), /hard-limit/);
});

test("marks a candidate stale after the source memory changed and refuses promotion", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": CANDIDATE_Q3,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes() }] }
  });
  await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), Q3_FULL + "\n- [2026-W30] 新增一行，源文件已变化。");
  const validation = await validateMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q3.memory") });
  assert.equal(validation.status, "stale");
  await assert.rejects(() => promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q3.memory"), confirm: true }), /stale/);
});

test("promotes a quarterly candidate with archive, atomic replacement, and readback", async () => {
  const root = await quarterlyFixture();
  const delivery = await writeDelivery(root, {
    "2026-Q3.memory.md": CANDIDATE_Q3,
    "changes.json": { quarter: "2026-Q3", targets: [{ targetFile: "2026-Q3.memory.md", changeSummary: SUMMARY, changes: q3Changes() }] }
  });
  await importQuarterlyDelivery({ repoRoot: root, deliveryPath: delivery, asOf: "2026-10-15" });
  const promote = await promoteMemoryCompression({ repoRoot: root, candidatePath: path.join(root, "04_output/_dist/memory-compression/quarterly-2026-Q3/2026-Q3.memory"), confirm: true });
  assert.equal(promote.status, "promoted");
  const formal = await readFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "utf8");
  assert.equal(formal, CANDIDATE_Q3);
  const archiveRoot = path.join(root, "01_core/memory-archive/compression/2026-10-15");
  const archived = await readdir(archiveRoot, { recursive: true });
  const archivedFile = archived.find((name) => name.endsWith("2026-Q3.memory.md"));
  assert.ok(archivedFile);
  assert.equal(await readFile(path.join(archiveRoot, archivedFile), "utf8"), Q3_FULL);
});

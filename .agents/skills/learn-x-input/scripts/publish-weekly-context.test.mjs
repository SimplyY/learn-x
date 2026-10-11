import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishConfirmedWeeklyContext } from "./publish-weekly-context.mjs";

const URL = "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac";
const PLAN_HTML = `<table>
<tbody><tr><td>新周计划</td><td>
  <ol start="3">
    <li>先完成方案拆解 <a href="https://example.com/plan" onclick="alert(1)">方案链接</a>
      <ul><li>核对边界</li><li>列出依赖</li></ul>
      <table><tbody><tr><th>阶段</th><th>交付</th></tr><tr><td>验证</td><td>结果记录</td></tr></tbody></table>
    </li>
    <li>复盘执行情况</li>
  </ol>
  <script>window.shouldNotRun = true</script>
</td></tr></tbody></table>`;

test("publishes only the complete 新周计划 row and preserves nested structure and safe links", async (t) => {
  const root = await makeRoot(t);
  const source = await writeWeekly(root, "2026-W40", PLAN_HTML);
  const result = await publishConfirmedWeeklyContext({
    week: "2026-W40",
    repoRoot: root,
    now: () => new Date("2026-10-05T01:02:03.000Z")
  });

  assert.equal(result.planWeek, "2026-W41");
  assert.equal(result.sourceWeek, "2026-W40");
  const version = JSON.parse(await readFile(result.versionPath, "utf8"));
  assert.equal(version.schemaVersion, "shared-context/v1");
  assert.equal(version.producer, "learn-x");
  assert.deepEqual(version.coverage, { start: "2026-09-28", end: "2026-10-04" });
  assert.equal(version.publishedAt, "2026-10-05T01:02:03.000Z");
  assert.equal(version.confirmationEvidence.confirmedAt, null);
  assert.equal(version.confirmationEvidence.confirmedAtStatus, "unknown");
  assert.equal(version.source.url, URL);
  assert.equal(version.source.revision, "71");
  assert.equal(version.source.sha256, createHash("sha256").update(source).digest("hex"));
  assert.deepEqual(version.source.missing, []);
  assert.match(version.payload.planTableRow.html, /<ol start="3">/);
  assert.match(version.payload.planTableRow.html, /<ul>/);
  assert.match(version.payload.planTableRow.html, /<table>/);
  assert.match(version.payload.planTableRow.html, /href="https:\/\/example.com\/plan"/);
  assert.match(version.payload.planTableRow.html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(version.payload.planTableRow.html, /onclick|<script/);
  assert.match(version.payload.planTableRow.markdown, /^### 新周计划/);
  assert.match(version.payload.planTableRow.markdown, /3\. 先完成方案拆解 \[方案链接\]\(<https:\/\/example\.com\/plan>\)/);
  assert.match(version.payload.planTableRow.markdown, /\n   - 核对边界\n   - 列出依赖/);
  assert.match(version.payload.planTableRow.markdown, /\| 阶段 \| 交付 \|[\s\S]*\| 验证 \| 结果记录 \|/);
  assert.match(version.payload.planTableRow.markdown, /\n4\. 复盘执行情况/);
  assert.doesNotMatch(JSON.stringify(version), /PRIVATE_JOURNAL_TEXT/);
  const versionBytes = await readFile(result.versionPath);
  assert.deepEqual(JSON.parse(await readFile(result.currentPath, "utf8")), {
    schemaVersion: "shared-context-pointer/v1",
    producer: "learn-x",
    planWeek: "2026-W41",
    sourceWeek: "2026-W40",
    versionPath: `weekly/2026-W41/${version.source.sha256}.json`,
    sha256: version.source.sha256,
    artifactSha256: createHash("sha256").update(versionBytes).digest("hex"),
    publishedAt: version.publishedAt
  });
  assert.equal(result.currentPath, path.join(root, "04_output/_dist/shared-context/current.json"));
  assert.equal(result.versionPath, path.join(root, "04_output/_dist/shared-context/weekly/2026-W41", `${version.source.sha256}.json`));
});

test("parses the existing YAML weekly.md header shape without reading or printing other journal text", async (t) => {
  const root = await makeRoot(t);
  await writeWeeklyYaml(root, "2026-W40", PLAN_HTML);
  const result = await publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root });
  const version = JSON.parse(await readFile(result.versionPath, "utf8"));
  assert.equal(version.source.url, URL);
  assert.equal(version.source.revision, "72");
  assert.equal(version.coverage.start, "2026-09-28");
  assert.equal(version.coverage.end, "2026-10-04");
  assert.match(version.payload.planTableRow.markdown, /\[方案链接\]\(<https:\/\/example\.com\/plan>\)/);
  assert.doesNotMatch(JSON.stringify(version), /PRIVATE_JOURNAL_TEXT/);
});

test("fails closed for a missing or duplicate plan row and damaged metadata", async (t) => {
  const cases = [
    { week: "2026-W40", body: "<table><tr><td>其他</td><td>内容</td></tr></table>", expected: /expected one 新周计划 table row, found 0/ },
    { week: "2026-W40", body: `${PLAN_HTML}\n${PLAN_HTML}`, expected: /expected one 新周计划 table row, found 2/ },
    { week: "2026-W40", body: PLAN_HTML, metadata: { "目标覆盖范围": "2026-09-29 至 2026-10-04" }, expected: /sourceWeek and coverage do not match/ },
    { week: "2026-W40", body: PLAN_HTML, metadata: { "定位依据": "unknown" }, expected: /confirmed block evidence/ },
    { week: "2026-W40", body: PLAN_HTML, metadata: { "来源 revision": "not-a-revision" }, expected: /source revision is malformed/ }
  ];

  for (const [index, item] of cases.entries()) {
    const root = await makeRoot(t);
    await writeWeekly(root, item.week, item.body, item.metadata);
    await assert.rejects(publishConfirmedWeeklyContext({ week: item.week, repoRoot: root }), item.expected, `case ${index}`);
    await assert.rejects(readFile(path.join(root, "04_output/_dist/shared-context/current.json")), { code: "ENOENT" });
  }
});

test("a failed atomic current pointer replacement leaves the previous pointer intact", async (t) => {
  const root = await makeRoot(t);
  await writeWeekly(root, "2026-W40", PLAN_HTML);
  const first = await publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root });
  const before = await readFile(first.currentPath, "utf8");
  await writeWeekly(root, "2026-W41", PLAN_HTML.replace("复盘执行情况", "下周复盘执行情况"));

  await assert.rejects(publishConfirmedWeeklyContext({
    week: "2026-W41",
    repoRoot: root,
    renameFile: async (from, to) => {
      if (to === first.currentPath) throw new Error("injected current pointer rename failure");
      const { rename } = await import("node:fs/promises");
      return rename(from, to);
    }
  }), /injected current pointer rename failure/);
  assert.equal(await readFile(first.currentPath, "utf8"), before);
});

test("republishing an older source week never rolls current.json back", async (t) => {
  const root = await makeRoot(t);
  await writeWeekly(root, "2026-W40", PLAN_HTML);
  const current = await publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root });
  const before = await readFile(current.currentPath, "utf8");
  await writeWeekly(root, "2026-W39", PLAN_HTML.replace("复盘执行情况", "旧周复盘"));

  await assert.rejects(publishConfirmedWeeklyContext({ week: "2026-W39", repoRoot: root }), /older than current 2026-W41/);
  assert.equal(await readFile(current.currentPath, "utf8"), before);
});

test("an older concurrent publisher cannot replace a newer current pointer", async (t) => {
  const root = await makeRoot(t);
  await writeWeekly(root, "2026-W38", PLAN_HTML);
  await publishConfirmedWeeklyContext({ week: "2026-W38", repoRoot: root });
  await writeWeekly(root, "2026-W41", PLAN_HTML.replace("复盘执行情况", "下一周复盘"));
  await writeWeekly(root, "2026-W39", PLAN_HTML.replace("复盘执行情况", "较旧周复盘"));

  let enteredRename;
  let releaseRename;
  const waitingForRename = new Promise((resolve) => { enteredRename = resolve; });
  const renameGate = new Promise((resolve) => { releaseRename = resolve; });
  const newer = publishConfirmedWeeklyContext({
    week: "2026-W41",
    repoRoot: root,
    renameFile: async (from, to) => {
      enteredRename();
      await renameGate;
      return rename(from, to);
    }
  });
  await waitingForRename;
  const olderAttempt = publishConfirmedWeeklyContext({ week: "2026-W39", repoRoot: root });
  await assert.rejects(olderAttempt, /another publisher holds the current pointer lock/);
  releaseRename();
  const published = await newer;
  const current = JSON.parse(await readFile(published.currentPath, "utf8"));
  assert.equal(current.planWeek, "2026-W42");
});

test("missing legacy source URL and revision stay null and are marked missing", async (t) => {
  const root = await makeRoot(t);
  await writeWeekly(root, "2026-W40", PLAN_HTML, { "来源 URL": "unknown" }, { revision: null });
  const result = await publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root });
  const version = JSON.parse(await readFile(result.versionPath, "utf8"));
  assert.equal(version.source.url, null);
  assert.equal(version.source.revision, null);
  assert.deepEqual(version.source.missing, ["url", "revision"]);
});

test("detects a tampered immutable version through the current pointer artifact hash", async (t) => {
  const root = await makeRoot(t);
  await writeWeekly(root, "2026-W40", PLAN_HTML);
  const result = await publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root });
  const pointerBefore = await readFile(result.currentPath, "utf8");
  await writeFile(result.versionPath, "{}\n", "utf8");
  await assert.rejects(publishConfirmedWeeklyContext({ week: "2026-W40", repoRoot: root }), /pointed version artifact hash does not match/);
  assert.equal(await readFile(result.currentPath, "utf8"), pointerBefore);
});

async function makeRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeWeekly(root, week, body, overrides = {}, { revision = "71" } = {}) {
  const weekDir = path.join(root, "03_input/weekly", week);
  await mkdir(weekDir, { recursive: true });
  const coverage = coverageForTestWeek(week);
  const nextDate = new Date(`${coverage.end}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const base = {
    "来源 URL": URL,
    "周记写作日标题": `${nextDate.getUTCMonth() + 1}.${nextDate.getUTCDate()}`,
    "目标周": week,
    "目标覆盖范围": `${coverage.start} 至 ${coverage.end}`,
    "定位依据": "已确认标题 block blkTargetWeekly00",
    "来源 revision": revision ?? "unknown",
    "采集时间": "2026-10-05T00:00:00.000Z"
  };
  Object.assign(base, overrides);
  const metadata = Object.entries(base).map(([key, value]) => `- ${key}：${value}`).join("\n");
  const source = `# Confirmed weekly journal input｜${week}\n${metadata}\n\n## 日记正文\n\nPRIVATE_JOURNAL_TEXT\n\n${body}\n`;
  await writeFile(path.join(weekDir, "weekly.md"), source, "utf8");
  return source;
}

async function writeWeeklyYaml(root, week, body) {
  const weekDir = path.join(root, "03_input/weekly", week);
  await mkdir(weekDir, { recursive: true });
  const coverage = coverageForTestWeek(week);
  const source = [
    "---",
    `source_url: \"${URL}\"`,
    'writing_title: "周记 > 10.5"',
    `target_coverage: "${coverage.start} to ${coverage.end} (Asia/Shanghai)"`,
    'locator: "周记 > 10.5; blkTarget2026W40 docWeeklyJournal01"',
    'captured_at: "2026-10-05T00:00:00.000Z"',
    "source_revision_id: 72",
    "---",
    "",
    "## 10.5",
    "",
    "PRIVATE_JOURNAL_TEXT",
    "",
    body,
    ""
  ].join("\n");
  await writeFile(path.join(weekDir, "weekly.md"), source, "utf8");
  return source;
}

function coverageForTestWeek(week) {
  const [year, weekNumber] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (weekday - 1) * 86_400_000 + (weekNumber - 1) * 7 * 86_400_000);
  return {
    start: monday.toISOString().slice(0, 10),
    end: new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
  };
}

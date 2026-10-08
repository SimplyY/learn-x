import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WEEKLY_SOURCE_CONFIG, weeklySourceForId } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { createWeeklyRetryState, runConfiguredSource, runWeeklyRetrySupervisor } from "./weekly-retry-supervisor.mjs";

const week = "2026-W40";
const fixtureCollector = `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const config = JSON.parse(await readFile("fixture.json", "utf8"));
const targetWeek = process.argv[process.argv.indexOf("--week") + 1];
await writeFile("execution.json", JSON.stringify({ week: targetWeek, cwd: process.cwd(), pid: process.pid }));
const root = path.join("03_input/weekly", targetWeek);
await mkdir(root, { recursive: true });
const timestamp = config.timestamp === "stale" ? "2000-01-01T00:00:00.000Z"
  : config.timestamp === "invalid" ? "invalid-date" : new Date().toISOString();
if (config.writeStatus !== false) {
  const reportedWeek = config.reportedWeek || targetWeek;
  if (config.id === "ai") {
    const status = { targetWeek: reportedWeek, status: config.status, reason: config.reason || "" };
    if (config.timestamp !== "missing") status.completedAt = timestamp;
    await writeFile(path.join(root, "_ai-generated.json"), JSON.stringify(status));
  } else {
    const entry = { status: config.status, file: "daily.md", count: config.status === "empty" ? 0 : 1,
      summary: "synthetic collector", updatedAt: timestamp, preservedStaleFile: false };
    await writeFile(path.join(root, "daily.md"), "# Synthetic daily input\\n");
    await writeFile(path.join(root, "_source-status.json"), JSON.stringify({
      version: 1, week: reportedWeek, updatedAt: timestamp, sources: { daily: entry }
    }));
  }
}
if (config.exitCode) process.stderr.write("HTTP 503 synthetic collector failure\\n");
process.exitCode = config.exitCode || 0;
`;

async function createFixture(t, config) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-source-adapter-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, "scripts"));
  const source = weeklySourceForId(config.id || "daily");
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    type: "module", scripts: { [source.collector]: "node scripts/fixture-collector.mjs" }
  }));
  await writeFile(path.join(repoRoot, "scripts/fixture-collector.mjs"), fixtureCollector);
  await writeFile(path.join(repoRoot, "fixture.json"), JSON.stringify({ id: source.id, ...config }));
  return { repoRoot, source };
}

async function runFixture(t, config) {
  const { repoRoot, source } = await createFixture(t, config);
  const result = await runConfiguredSource(source, { week, repoRoot });
  const execution = JSON.parse(await readFile(path.join(repoRoot, "execution.json"), "utf8"));
  assert.equal(execution.week, week);
  assert.equal(await realpath(execution.cwd), await realpath(repoRoot));
  assert.notEqual(execution.pid, process.pid);
  return result;
}

for (const status of ["ready", "empty"]) {
  test(`real collector CLI accepts fresh target-week ${status} status`, async (t) => {
    const result = await runFixture(t, { status });
    assert.equal(result.status, status);
    assert.equal(result.count, status === "empty" ? 0 : 1);
    assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
  });
  test(`real collector CLI rejects stale ${status} despite exit zero`, async (t) => {
    const result = await runFixture(t, { status, timestamp: "stale" });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "collector-exit-without-fresh-valid-status");
  });
}

for (const [label, config] of [
  ["missing sidecar", { writeStatus: false }],
  ["wrong target week", { status: "ready", reportedWeek: "2026-W39" }],
  ["failed source status", { status: "failed" }],
  ["malformed source timestamp", { status: "ready", timestamp: "invalid" }]
]) {
  test(`real collector CLI rejects ${label} despite exit zero`, async (t) => {
    const result = await runFixture(t, config);
    assert.equal(result.status, "failed");
    assert.equal(result.error, "collector-exit-without-fresh-valid-status");
  });
}

test("real collector CLI nonzero exit is not rescued by a fresh success sidecar", async (t) => {
  const result = await runFixture(t, { status: "ready", exitCode: 7 });
  assert.equal(result.status, "failed");
  assert.equal(result.code, 7);
  assert.match(result.error, /HTTP 503 synthetic collector failure/);
});

test("supervisor preserves a real child collector's nonzero exit despite its success sidecar", async (t) => {
  const { repoRoot, source } = await createFixture(t, { status: "ready", exitCode: 7 });
  const weekRoot = path.join(repoRoot, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  const state = createWeeklyRetryState(week);
  for (const configured of WEEKLY_SOURCE_CONFIG) {
    state.sources[configured.id].status = configured.collector ? "succeeded" : "manual-input";
    state.sources[configured.id].attempts = configured.collector ? 1 : 0;
  }
  state.sources[source.id].status = "failed";
  state.sources[source.id].attempts = 1;
  state.sources[source.id].lastErrorClass = "network-transient";
  state.sources[source.id].nextRetryAt = "2000-01-01T00:00:00.000Z";
  await writeFile(path.join(weekRoot, "_weekly-retry-state.json"), `${JSON.stringify(state)}\n`);

  let virtualNow = Date.now();
  const result = await runWeeklyRetrySupervisor({
    week, repoRoot, maxDurationMs: 1_000,
    now: () => virtualNow,
    sleep: async (ms) => { virtualNow += ms; },
    runSource: (configured, context) => runConfiguredSource(configured, context)
  });
  const saved = JSON.parse(await readFile(path.join(weekRoot, "_weekly-retry-state.json"), "utf8"));
  assert.equal(result.sources[source.id].status, "failed");
  assert.equal(saved.sources[source.id].status, "failed");
  assert.equal(saved.sources[source.id].attempts, 2);
  assert.equal(saved.sources[source.id].lastErrorClass, "network-transient");
});

for (const status of ["confirmed", "needs_review"]) {
  test(`real AI collector CLI preserves fresh target-week ${status}`, async (t) => {
    const result = await runFixture(t, { id: "ai", status, reason: "synthetic-observation" });
    assert.equal(result.status, status);
    assert.equal(result.error, "synthetic-observation");
  });
}

for (const [label, config] of [
  ["wrong week", { reportedWeek: "2026-W39" }],
  ["stale timestamp", { timestamp: "stale" }],
  ["missing timestamp", { timestamp: "missing" }],
  ["invalid timestamp", { timestamp: "invalid" }]
]) {
  test(`real AI collector CLI rejects ${label} despite confirmed status and exit zero`, async (t) => {
    const result = await runFixture(t, { id: "ai", status: "confirmed", ...config });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "collector-exit-without-fresh-valid-status");
  });
}

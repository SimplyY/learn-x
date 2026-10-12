import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectHealthWeekly } from "./collect-health-weekly.mjs";

const syntheticReport = "# Health-X 健康周报：2026-10-05 至 2026-10-11\n\n数据状态：ready  \n来源：合成报告\n\n## 本周评分\n\n**暂无**\n\n## 核心数据\n\n- 步数概览：合成\n- 睡眠概览：合成\n- 消耗概览：合成\n- 站立概览：合成\n\n## 健康提示\n\n- 合成提示\n";

async function writeSyntheticExport(root) {
  const target = path.join(root, "03_input/weekly/2026-W41/health.md");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, syntheticReport);
}

test("refuses a symlinked Learn-X weekly directory before reading or writing source state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-week-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "03_input"), { recursive: true });
  await symlink(outside, path.join(root, "03_input/weekly"));

  await assert.rejects(collectHealthWeekly({ week: "2026-W41", repoRoot: root, healthXRoot: path.join(root, "health-x") }), /weekly-path-symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test("runs Health-X report only for the matching Shanghai week and writes Learn-X health.md", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const healthXRoot = path.join(root, "health-x");
  await mkdir(path.join(healthXRoot, "input"), { recursive: true });
  await writeFile(path.join(healthXRoot, "input/2026-10-11.json"), "{}\n");

  let invoked = false;
  const result = await collectHealthWeekly({
    week: "2026-W41", repoRoot: root, healthXRoot,
    executeCommand: async (executable, args, options) => {
      invoked = true;
      assert.equal(executable, process.execPath);
      assert.deepEqual(args.slice(args.indexOf("report") + 1), [path.join(healthXRoot, "input/2026-10-11.json"), "--export-learn-x", "--week", "2026-W41"]);
      assert.ok(!args.includes("sync"), "must not write the Health-X Base");
      assert.equal(options.env.LEARN_X_ROOT, root);
      assert.deepEqual(Object.keys(options.env).sort(), ["LEARN_X_ROOT", "PATH"]);
      await writeSyntheticExport(root);
      return { stdout: "已生成 2026-10-11.md\n" };
    }
  });

  assert.equal(invoked, true);
  assert.equal(result.status, "ready");
  assert.equal(result.periodStart, "2026-10-05");
  assert.equal(result.periodEnd, "2026-10-11");
  assert.match(await readFile(path.join(root, "03_input/weekly/2026-W41/health.md"), "utf8"), /^# Health-X 健康周报：2026-10-05 至 2026-10-11/m);
  const status = JSON.parse(await readFile(path.join(root, "03_input/weekly/2026-W41/_source-status.json"), "utf8"));
  assert.equal(status.sources.health.status, "ready");
  assert.equal(status.sources.health.count, 1);
  assert.doesNotMatch(JSON.stringify(status), /健康数据|步数|睡眠/);
});

test("uses Health-X official local export without passing Base credentials", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-no-diary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const healthXRoot = path.join(root, "health-x");
  const inputFile = path.join(healthXRoot, "input/2026-10-11.json");
  await mkdir(path.dirname(inputFile), { recursive: true });
  await writeFile(inputFile, "{}\n");

  let calls = 0;
  const result = await collectHealthWeekly({
    week: "2026-W41", repoRoot: root, healthXRoot,
    executeCommand: async (_executable, args, options) => {
      calls += 1;
      assert.ok(args.includes("report"));
      assert.ok(args.includes("--export-learn-x"));
      assert.equal(options.env.LEARN_X_ROOT, root);
      assert.deepEqual(Object.keys(options.env).sort(), ["LEARN_X_ROOT", "PATH"]);
      await writeSyntheticExport(root);
      return { stdout: "" };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  const markdown = await readFile(path.join(root, "03_input/weekly/2026-W41/health.md"), "utf8");
  assert.match(markdown, /\*\*暂无\*\*/);
});

test("keeps unrelated Health-X report failures as source failures", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const healthXRoot = path.join(root, "health-x");
  await mkdir(path.join(healthXRoot, "input"), { recursive: true });
  await writeFile(path.join(healthXRoot, "input/2026-10-11.json"), "{}\n");

  let calls = 0;
  const result = await collectHealthWeekly({
    week: "2026-W41", repoRoot: root, healthXRoot,
    executeCommand: async () => {
      calls += 1;
      const error = new Error("invalid health source");
      error.stderr = "健康数据格式无效";
      throw error;
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "health-report-command-failed");
});

test("preserves a conflicting health.md and marks missing Health-X input unavailable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const weekRoot = path.join(root, "03_input/weekly/2026-W41");
  await mkdir(weekRoot, { recursive: true });
  const existing = "# 人工内容\n\n不要覆盖这份文件。\n";
  await writeFile(path.join(weekRoot, "health.md"), existing);
  const healthXRoot = path.join(root, "health-x");
  await mkdir(path.join(healthXRoot, "input"), { recursive: true });

  const result = await collectHealthWeekly({ week: "2026-W41", repoRoot: root, healthXRoot });
  assert.equal(result.status, "unavailable");
  assert.equal(await readFile(path.join(weekRoot, "health.md"), "utf8"), existing);
  const status = JSON.parse(await readFile(path.join(weekRoot, "_source-status.json"), "utf8"));
  assert.equal(status.sources.health.status, "unavailable");
  assert.equal(status.sources.health.preservedStaleFile, true);
});

test("rejects a title-only Health-X file with empty required sections", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-weak-existing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W41";
  const weekRoot = path.join(root, "03_input/weekly", week);
  const healthXRoot = path.join(root, "health-x");
  await mkdir(weekRoot, { recursive: true });
  await mkdir(path.join(healthXRoot, "input"), { recursive: true });
  await writeFile(path.join(healthXRoot, "input/2026-10-11.json"), "{}\n", "utf8");
  const weak = "# Health-X 健康周报：2026-10-05 至 2026-10-11\n\n## 核心数据\n";
  await writeFile(path.join(weekRoot, "health.md"), weak, "utf8");
  let rendererRuns = 0;
  const result = await collectHealthWeekly({ week, repoRoot: root, healthXRoot, executeCommand: async () => { rendererRuns += 1; } });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "health-existing-file-conflict");
  assert.equal(rendererRuns, 0);
  assert.equal(await readFile(path.join(weekRoot, "health.md"), "utf8"), weak);
  const status = JSON.parse(await readFile(path.join(weekRoot, "_source-status.json"), "utf8"));
  assert.equal(status.sources.health.status, "failed");
  assert.equal(status.sources.health.preservedStaleFile, true);
});

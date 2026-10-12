import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoWeekRangeShanghai, normalizeWeek } from "./collect-weread-weekly.mjs";
import { ensureWeeklyDirectory } from "./lib/weekly-path.mjs";
import { readWeeklySourceStatus, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../../");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function dateInShanghai(epochSeconds) {
  return new Date(epochSeconds * 1000 + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function reportHeader(start, end) {
  return `# Health-X 健康周报：${start} 至 ${end}`;
}

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function hasSubstantiveReport(markdown, expectedHeader) {
  const text = String(markdown || "").trim();
  if (!text.startsWith(`${expectedHeader}\n`)) return false;
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => /^数据状态：\S/.test(line)) || !lines.some((line) => /^来源：\S/.test(line))) return false;
  const required = ["本周评分", "核心数据", "健康提示"];
  const sections = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!heading) continue;
    let end = index + 1;
    while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1;
    sections.set(heading[1], lines.slice(index + 1, end).join("\n").trim());
  }
  if (required.some((heading) => !sections.get(heading))) return false;
  if (!/^\*\*[^*]+\*\*/m.test(sections.get("本周评分"))) return false;
  if ((sections.get("核心数据").match(/^-\s+\S/gm) || []).length < 4) return false;
  return (sections.get("健康提示").match(/^-\s+\S/gm) || []).length > 0;
}

export async function collectHealthWeekly({
  week: weekInput,
  repoRoot = defaultRepoRoot,
  healthXRoot = process.env.HEALTH_X_ROOT || path.resolve(repoRoot, "../health-x"),
  executeCommand = execFileAsync
} = {}) {
  const week = normalizeWeek(weekInput);
  const safePaths = await ensureWeeklyDirectory(repoRoot, week);
  const range = isoWeekRangeShanghai(week);
  const start = dateInShanghai(range.startEpoch);
  const end = dateInShanghai(range.endEpoch - 1);
  const weekRoot = safePaths.weekRoot;
  const target = path.join(weekRoot, "health.md");
  const inputFile = path.join(healthXRoot, "input", `${end}.json`);
  const expectedHeader = reportHeader(start, end);

  if (!await exists(inputFile)) {
    const preservedStaleFile = await exists(target);
    await updateWeeklySourceStatus({
      weekRoot, week, source: "health", status: "unavailable", file: "health.md", count: 0,
      summary: `Health-X 未找到 ${end} 的结构化报告输入；未生成目标周报告`, preservedStaleFile
    });
    return { status: "unavailable", targetWeek: week, periodStart: start, periodEnd: end };
  }

  const currentStatus = await readWeeklySourceStatus(weekRoot, week);
  if (await exists(target)) {
    const existing = await readFile(target, "utf8");
    if (!hasSubstantiveReport(existing, expectedHeader)) {
      await updateWeeklySourceStatus({
        weekRoot, week, source: "health", status: "failed", file: "health.md", count: 0,
        summary: `目标 health.md 已存在但报告日期/结构不匹配，保留原文件`, preservedStaleFile: true
      });
      return { status: "failed", targetWeek: week, error: "health-existing-file-conflict" };
    }
    await updateWeeklySourceStatus({
      weekRoot, week, source: "health", status: "ready", file: "health.md", count: 1,
      summary: currentStatus.sources.health?.status === "ready"
        ? currentStatus.sources.health.summary
        : `已核验现存 Health-X 报告，覆盖 ${start} 至 ${end}；未覆盖原文件`,
      preservedStaleFile: false
    });
    return { status: "ready", targetWeek: week, count: 1, file: target, preservedExisting: true };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-health-weekly-"));
  try {
    const cli = path.join(healthXRoot, "src/cli.ts");
    try {
      await executeCommand(process.execPath, ["--experimental-strip-types", cli, "report", inputFile, "--export-learn-x", "--week", week], {
        cwd: tempRoot,
        env: { PATH: process.env.PATH || "", LEARN_X_ROOT: repoRoot },
        timeout: 4 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true
      });
    } catch (error) {
      if (!await exists(target)) throw error;
      const racedReport = await readFile(target, "utf8");
      if (!hasSubstantiveReport(racedReport, expectedHeader)) {
        await updateWeeklySourceStatus({
          weekRoot, week, source: "health", status: "failed", file: "health.md", count: 0,
          summary: `报告生成期间 health.md 被其他内容占用，保留原文件`, preservedStaleFile: true
        });
        return { status: "failed", targetWeek: week, error: "health-existing-file-conflict" };
      }
      await updateWeeklySourceStatus({
        weekRoot, week, source: "health", status: "ready", file: "health.md", count: 1,
        summary: `报告生成期间出现有效目标周报告；复用并读回 ${start} 至 ${end}`, preservedStaleFile: false
      });
      return { status: "ready", targetWeek: week, periodStart: start, periodEnd: end, count: 1, file: target, preservedExisting: true };
    }
    const markdown = await readFile(target, "utf8");
    if (!hasSubstantiveReport(markdown, expectedHeader)) {
      await updateWeeklySourceStatus({
        weekRoot, week, source: "health", status: "failed", file: "health.md", count: 0,
        summary: `Health-X report 未通过目标日期与结构校验（${start} 至 ${end}）`, preservedStaleFile: false
      });
      return { status: "failed", targetWeek: week, error: "health-report-integrity-check-failed" };
    }
    await updateWeeklySourceStatus({
      weekRoot, week, source: "health", status: "ready", file: "health.md", count: 1,
      summary: `Health-X 官方 report --export-learn-x 已生成并读回，覆盖 ${start} 至 ${end}；未读取或写入 Base`, preservedStaleFile: false
    });
    return { status: "ready", targetWeek: week, periodStart: start, periodEnd: end, count: 1, file: target };
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "health-report-output-missing" : error?.killed ? "health-report-timeout" : "health-report-command-failed";
    await updateWeeklySourceStatus({
      weekRoot, week, source: "health", status: "failed", file: "health.md", count: 0,
      summary: `Health-X report 生成失败：${reason}；覆盖 ${start} 至 ${end}`, preservedStaleFile: await exists(target)
    });
    return { status: "failed", targetWeek: week, error: reason };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const week = args[args.indexOf("--week") + 1];
  const result = await collectHealthWeekly({ week });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["ready", "empty", "unavailable"].includes(result.status) ? 0 : 2;
}

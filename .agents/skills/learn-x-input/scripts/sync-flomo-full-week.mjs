import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFlomoFullSnapshot, classifyFlomoError, formatCliError, preflightFlomoSnapshotWeekPublication, publishFlomoSnapshotWeek } from "./collect-flomo-weekly.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";
import { readVerifiedStagedOnlineFlomoSnapshot, resolveFlomoPrivateDataRoot } from "./lib/flomo-full-snapshot.mjs";
import { normalizeWeek } from "./collect-weread-weekly.mjs";
import { activateOnlineSnapshot, paths as flomoReviewPaths, repoRoot as defaultRepoRoot } from "../../learn-x-flomo-review/scripts/review.mjs";

async function readOptionalFile(filePath) {
  try { return await readFile(filePath); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function readActiveSnapshotId(repoRoot) {
  try {
    const state = JSON.parse(await readFile(flomoReviewPaths(repoRoot).storageModePath, "utf8"));
    return typeof state?.activeSnapshotId === "string" ? state.activeSnapshotId : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicReplaceFile(filePath, content) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(tempPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function restoreWeeklyFileAfterFailedActivation({ repoRoot, notesPath, snapshotId, previousContent, publishedContent }) {
  if (!publishedContent || previousContent?.equals(publishedContent)) return;
  if (await readActiveSnapshotId(repoRoot) === snapshotId) return;
  const currentContent = await readOptionalFile(notesPath);
  if (!currentContent?.equals(publishedContent)) return;
  if (previousContent === null) {
    await unlink(notesPath);
    return;
  }
  await atomicReplaceFile(notesPath, previousContent);
}

export async function readFlomoAttemptToken(weekRoot, expectedToken) {
  if (!/^[0-9a-f-]{36}$/i.test(String(expectedToken || ""))) throw new Error("flomo-attempt-token-required");
  let guard;
  try { guard = JSON.parse(await readFile(path.join(weekRoot, "_flomo-attempt.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) throw new Error("flomo-attempt-token-stale"); throw error; }
  if (guard?.active !== true || guard.token !== expectedToken) throw new Error("flomo-attempt-token-stale");
  return true;
}

export async function syncFlomoFullWeek({ week, attemptToken, invocationId = randomUUID(), repoRoot = defaultRepoRoot, storageRoot,
  collect = collectFlomoFullSnapshot, activate = activateOnlineSnapshot, publish = publishFlomoSnapshotWeek } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(invocationId || ""))) {
    throw new Error("flomo-invocation-id-required");
  }
  const targetWeek = normalizeWeek(week);
  const resolvedStorageRoot = await resolveFlomoPrivateDataRoot(repoRoot, storageRoot);
  const weekRoot = path.join(repoRoot, "03_input/weekly", targetWeek);
  const notesPath = path.join(weekRoot, "flomo.md");
  const checkAttempt = () => readFlomoAttemptToken(weekRoot, attemptToken);
  await checkAttempt();
  await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status: "failed", file: "flomo.md", count: 0,
    summary: "Flomo 全量快照同步进行中；此状态不会被周输入门禁视为成功", preservedStaleFile: await fileExists(notesPath) });
  let snapshot;
  let previousWeeklyContent;
  let publishedWeeklyContent;
  try {
    const stagedResult = await collect({ repoRoot, storageRoot: resolvedStorageRoot, timeout: 30 * 60_000, invocationId });
    ({ snapshot } = await readVerifiedStagedOnlineFlomoSnapshot(stagedResult.snapshotPath, { storageRoot: resolvedStorageRoot }));
    await checkAttempt();
    const preflight = () => preflightFlomoSnapshotWeekPublication(snapshot, { week: targetWeek, repoRoot });
    await preflight();
    let weekly;
    let statusDeferred = false;
    const activation = await activate(repoRoot, stagedResult.snapshotPath, { beforeCommit: async () => {
      await checkAttempt();
      await preflight();
      previousWeeklyContent = await readOptionalFile(notesPath);
      try {
        weekly = await publish(snapshot, { week: targetWeek, repoRoot, deferStatusUpdate: true });
      } finally {
        publishedWeeklyContent = await readOptionalFile(notesPath);
      }
      statusDeferred = true;
    } });
    await checkAttempt();
    if (!weekly) weekly = await publish(snapshot, { week: targetWeek, repoRoot });
    else if (statusDeferred) {
      await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status: weekly.status,
        file: "flomo.md", count: weekly.count, summary: weekly.summary,
        preservedStaleFile: !weekly.count && await fileExists(notesPath) });
    }
    return { ...weekly, activation: activation.status, snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt,
      coverage: snapshot.coverage, termination: snapshot.termination };
  } catch (error) {
    let reportedError = error;
    if (snapshot && publishedWeeklyContent !== undefined) {
      try {
        await restoreWeeklyFileAfterFailedActivation({ repoRoot, notesPath, snapshotId: snapshot.snapshotId,
          previousContent: previousWeeklyContent, publishedContent: publishedWeeklyContent });
      } catch {
        reportedError = new Error("flomo-week-file-rollback-failed");
      }
    }
    if (reportedError?.message !== "flomo-attempt-token-stale") {
      const reason = classifyFlomoError(reportedError);
      const status = reason === "ego-login-or-control-required" ? "unavailable" : "failed";
      const errorCode = /^[a-z0-9-]{1,96}$/.test(String(reportedError?.message || "")) ? reportedError.message : "unknown";
      const stage = /^[a-z0-9-]{1,64}$/.test(String(reportedError?.stage || "")) ? ` stage=${reportedError.stage}` : "";
      await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status, file: "flomo.md", count: 0,
        summary: reason === "timestamp-density-review-required"
          ? "失败：同一小时超过 5 条笔记，时间需核验；旧快照和旧 flomo.md 已保留"
          : `Flomo 全量快照同步失败（${errorCode}${stage}）：${reason}；保留最近成功快照和已有周输入`, preservedStaleFile: await fileExists(notesPath) });
    }
    throw reportedError;
  }
}

export function parseSyncArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--attempt-token") options.attemptToken = argv[++index];
    else if (argv[index] === "--invocation-id") options.invocationId = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") options.help = true;
    else throw new Error(`unknown-argument:${argv[index]}`);
  }
  if (options.help) return options;
  options.week = normalizeWeek(options.week);
  if (!/^[0-9a-f-]{36}$/i.test(String(options.attemptToken || ""))) throw new Error("flomo-attempt-token-required");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(options.invocationId || ""))) {
    throw new Error("flomo-invocation-id-required");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseSyncArgs(argv);
  if (options.help) {
    console.log("Usage: node sync-flomo-full-week.mjs --week YYYY-Www --attempt-token UUID --invocation-id UUID (run through weekly:retry)");
    return { help: true };
  }
  const result = await syncFlomoFullWeek(options);
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}

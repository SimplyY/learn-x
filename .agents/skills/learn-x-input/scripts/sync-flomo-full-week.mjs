import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFlomoFullSnapshot, classifyFlomoError, publishFlomoSnapshotWeek, validateFlomoSnapshotWeekTimestampDensity } from "./collect-flomo-weekly.mjs";
import { fileExists, updateWeeklySourceStatus } from "./lib/source-status.mjs";
import { defaultFlomoPrivateDataRoot, readVerifiedStagedOnlineFlomoSnapshot } from "./lib/flomo-full-snapshot.mjs";
import { normalizeWeek } from "./collect-weread-weekly.mjs";
import { activateOnlineSnapshot, repoRoot as defaultRepoRoot } from "../../learn-x-flomo-review/scripts/review.mjs";

export async function readFlomoAttemptToken(weekRoot, expectedToken) {
  if (!/^[0-9a-f-]{36}$/i.test(String(expectedToken || ""))) throw new Error("flomo-attempt-token-required");
  let guard;
  try { guard = JSON.parse(await readFile(path.join(weekRoot, "_flomo-attempt.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) throw new Error("flomo-attempt-token-stale"); throw error; }
  if (guard?.active !== true || guard.token !== expectedToken) throw new Error("flomo-attempt-token-stale");
  return true;
}

export async function syncFlomoFullWeek({ week, attemptToken, invocationId = randomUUID(), repoRoot = defaultRepoRoot, storageRoot = defaultFlomoPrivateDataRoot(),
  collect = collectFlomoFullSnapshot, activate = activateOnlineSnapshot, publish = publishFlomoSnapshotWeek } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(invocationId || ""))) {
    throw new Error("flomo-invocation-id-required");
  }
  const targetWeek = normalizeWeek(week);
  const weekRoot = path.join(repoRoot, "03_input/weekly", targetWeek);
  const notesPath = path.join(weekRoot, "flomo.md");
  const checkAttempt = () => readFlomoAttemptToken(weekRoot, attemptToken);
  await checkAttempt();
  await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status: "failed", file: "flomo.md", count: 0,
    summary: "Flomo 全量快照同步进行中；此状态不会被周输入门禁视为成功", preservedStaleFile: await fileExists(notesPath) });
  try {
    const stagedResult = await collect({ repoRoot, storageRoot, timeout: 30 * 60_000, invocationId });
    const { snapshot } = await readVerifiedStagedOnlineFlomoSnapshot(stagedResult.snapshotPath);
    await checkAttempt();
    validateFlomoSnapshotWeekTimestampDensity(snapshot, targetWeek);
    const activation = await activate(repoRoot, stagedResult.snapshotPath, { beforeCommit: checkAttempt });
    await checkAttempt();
    const weekly = await publish(snapshot, { week: targetWeek, repoRoot });
    return { ...weekly, activation: activation.status, snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt,
      coverage: snapshot.coverage, termination: snapshot.termination };
  } catch (error) {
    if (error?.message !== "flomo-attempt-token-stale") {
      const reason = classifyFlomoError(error);
      const status = reason === "ego-login-or-control-required" ? "unavailable" : "failed";
      const errorCode = /^[a-z0-9-]{1,96}$/.test(String(error?.message || "")) ? error.message : "unknown";
      const stage = /^[a-z0-9-]{1,64}$/.test(String(error?.stage || "")) ? ` stage=${error.stage}` : "";
      await updateWeeklySourceStatus({ weekRoot, week: targetWeek, source: "flomo", status, file: "flomo.md", count: 0,
        summary: reason === "timestamp-density-review-required"
          ? "失败：同一小时超过 5 条笔记，时间需核验；旧快照和旧 flomo.md 已保留"
          : `Flomo 全量快照同步失败（${errorCode}${stage}）：${reason}；保留最近成功快照和已有周输入`, preservedStaleFile: await fileExists(notesPath) });
    }
    throw error;
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
    console.error(error?.message || "flomo-full-week-sync-failed");
    process.exitCode = 1;
  });
}

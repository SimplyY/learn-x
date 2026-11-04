import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, flomoComparableText, loadManifestSpecs, loadSpecs, normalizeMemoText, reconcile } from "./flomo-sync-core.mjs";
import { runEgoBatch } from "./flomo-sync-ego-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const statePath = path.join(repoRoot, "04_output/_dist/flomo-sync/state.json");

export async function syncFlomoWeekly(options = {}) {
  let batchTaskSpaceAttempted = false;
  let operationError;
  let operationFailed = false;
  let operationSucceeded = false;
  let syncResult;
  const taskSpaceIds = new Set();
  const closedTaskSpaceIds = [];
  const taskSpaceName = options.taskName || `learn-x-v2-flomo-sync-${randomUUID()}`;
  // Keep one Ego Lite task space across preflight and per-memo read/write checkpoints.
  const runBatch = async (...args) => {
    batchTaskSpaceAttempted = true;
    let result;
    try {
      result = await runEgoBatch(...args, { taskName: taskSpaceName });
    } catch (error) {
      if (error.taskId) taskSpaceIds.add(error.taskId);
      throw error;
    }
    if (result.taskId) {
      taskSpaceIds.add(result.taskId);
      if (taskSpaceIds.size > 1) throw new Error("Ego Lite changed task spaces during one Flomo sync.");
    }
    return result;
  };
  try {
    syncResult = await syncFlomoWeeklyImpl(options, runBatch);
    operationSucceeded = true;
    return syncResult;
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    if (batchTaskSpaceAttempted && operationSucceeded) {
      const taskIdsToClose = taskSpaceIds.size ? [...taskSpaceIds] : [null];
      const closeErrors = [];
      for (const taskId of taskIdsToClose) {
        try {
          const closed = await runEgoBatch("close", taskId ? { taskId } : {}, { taskName: taskSpaceName });
          if (closed.closedTaskId) closedTaskSpaceIds.push(closed.closedTaskId);
        } catch (closeError) {
          closeErrors.push(closeError);
        }
      }
      if (syncResult) {
        syncResult.taskSpace = {
          ids: [...taskSpaceIds],
          closedIds: closedTaskSpaceIds,
          closed: closeErrors.length === 0 && taskIdsToClose.length === closedTaskSpaceIds.length
        };
      }
      if (closeErrors.length) {
        const closeError = new AggregateError(closeErrors, "One or more Ego Lite task spaces could not be closed.");
        if (operationFailed && operationError instanceof Error) {
          operationError.message += `\nEgo Lite task-space cleanup also failed: ${closeError.message}`;
        } else if (operationFailed) {
          throw new AggregateError([new Error(String(operationError)), closeError], "Flomo sync and Ego Lite task-space cleanup failed.");
        } else {
          throw closeError;
        }
      }
    }
  }
}

async function syncFlomoWeeklyImpl({ week, period, manifestPath, dryRun = false, only, skipKeys = [], overwriteConflicts = false, overwriteKeys = [], browser } = {}, runBatch = runEgoBatch) {
  if ([week, period, manifestPath].filter(Boolean).length !== 1) throw new Error("Choose exactly one of --week, --period, or --manifest.");
  if (only && !["weekly", "monthly", "memory"].includes(only)) throw new Error("Use --only weekly|monthly|memory.");
  if (overwriteConflicts && (!manifestPath || !overwriteKeys.length)) throw new Error("Conflict overwrite requires --manifest and --overwrite-key.");
  const input = manifestPath ? await loadManifestSpecs(repoRoot, path.resolve(manifestPath)) : await loadSpecs(repoRoot, period || week);
  const skipSet = new Set(skipKeys);
  const selectedInput = only ? input.specs.filter((spec) => spec.kind === only) : input.specs;
  const missingOverwriteKeys = overwriteConflicts ? overwriteKeys.filter((key) => !selectedInput.some((spec) => spec.key === key)) : [];
  if (missingOverwriteKeys.length) throw new Error(`Conflict overwrite targets are not in the manifest: ${missingOverwriteKeys.join(", ")}`);
  const overwriteSet = new Set(overwriteKeys);
  const specs = selectedInput.filter((spec) => !skipSet.has(spec.key) && (!overwriteConflicts || overwriteSet.has(spec.key)));
  const skipped = [
    ...(only ? input.skipped.filter((item) => item.kind === only) : input.skipped),
    ...input.specs.filter((spec) => skipSet.has(spec.key)).map((spec) => ({ kind: spec.kind, id: spec.id, key: spec.key, reason: "batch-skipped", filePath: spec.filePath }))
  ];
  const state = await readState();
  const client = browser || dryRunClient;
  const results = [];
  const plans = [];
  const preflightErrors = [];
  // ponytail: one Ego Lite batch owns the real browser path; injected clients are test-only.
  const useBatch = Boolean(!dryRun && !browser);
  const batchPreflight = useBatch
    ? new Map((await runBatch("preflight", { allowLegacy: overwriteConflicts, compactResult: overwriteConflicts, specs: specs.map(({ key, title, tag }) => ({ key, title, tag })) })).completed.map((item) => [item.key, item]))
    : null;

  for (const spec of specs) {
    const previous = state.memos[spec.key];
    const preflight = batchPreflight?.get(spec.key);
    const found = preflight?.found ?? await client.find(spec);
    if (found.matches.length > 1) throw new Error(`${spec.key}: found multiple matching Flomo memos.`);
    if (found.legacy && !overwriteConflicts) throw new Error(`${spec.key}: found an unmarked legacy memo; adopt it manually before syncing.`);

    let content = spec.content;
    let remoteReadBack;
    let needsRemoteWrite = false;
    if (found.matches.length === 1) {
      const remote = preflight?.remote ?? await client.read(found.matches[0], spec.title);
      remoteReadBack = remote;
      const local = normalizeMemoText(spec.content);
      const remoteContent = typeof remote.content === "string" ? normalizeMemoText(remote.content) : null;
      if (overwriteConflicts) {
        const remoteMatches = remoteContent !== null
          ? flomoComparableText(local) === flomoComparableText(remoteContent)
          : digest(local) === remote.hash;
        plans.push({ spec, previous, found, content, remoteReadBack, needsRemoteWrite: !remoteMatches, overwrite: true });
        continue;
      }
      if (previous && previous.memoId !== found.matches[0].memoId) {
        preflightErrors.push(`${spec.key}: tagged Flomo memo identity differs from local sync state.`);
        continue;
      }
      if (useBatch && !previous && (!remoteContent || !remoteContent.includes(spec.verification))) {
        preflightErrors.push(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
        continue;
      }
      if (!previous) {
        if (!remoteContent || !remoteContent.includes(spec.verification)) {
          if (useBatch) {
            preflightErrors.push(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
            continue;
          }
          throw new Error(`${spec.key}: tagged Flomo memo has no matching verification marker or local sync state.`);
        }
        if (flomoComparableText(remoteContent) !== flomoComparableText(local)) {
          preflightErrors.push(`${spec.key}: memo exists without local state but its full body differs from the prepared source.`);
          continue;
        }
      } else {
        if (remoteContent === null) {
          preflightErrors.push(`${spec.key}: Flomo returned no full memo body for reconciliation.`);
          continue;
        }
        const remoteForReconcile = flomoComparableText(remoteContent) === flomoComparableText(previous.baseContent)
          ? previous.baseContent
          : remoteContent;
        const merged = reconcile({ base: previous.baseContent, local, remote: remoteForReconcile });
        if (merged.stop) {
          if (useBatch) {
            preflightErrors.push(`${spec.key}: ${merged.stop} (${merged.magnitude ?? 0}).`);
            continue;
          }
          throw new Error(`${spec.key}: ${merged.stop} (${merged.magnitude ?? 0}).`);
        }
        content = merged.content;
        needsRemoteWrite = flomoComparableText(content) !== flomoComparableText(remoteContent);
        if (merged.writeBack && merged.writeBack !== spec.content && !dryRun) await writeFile(spec.filePath, merged.writeBack, "utf8");
      }
    }

    if (overwriteConflicts && found.matches.length !== 1) {
      preflightErrors.push(`${spec.key}: conflict overwrite requires exactly one existing memo.`);
      continue;
    }

    plans.push({ spec, previous, found, content, remoteReadBack, needsRemoteWrite });
  }

  if (preflightErrors.length) throw new Error(`Flomo preflight blocked:\n${preflightErrors.map((item) => `- ${item}`).join("\n")}`);

  if (overwriteConflicts && !dryRun) await writeOverwriteAudit(plans);

  if (dryRun) {
    for (const plan of plans) results.push({ key: plan.spec.key, action: plan.found.matches.length ? "would-update" : "would-create" });
  } else if (useBatch) {
    const batchPlans = plans
      .filter((plan) => plan.overwrite ? plan.needsRemoteWrite : (!plan.found.matches.length || (plan.previous && plan.needsRemoteWrite)))
      .map((plan) => ({
        key: plan.spec.key,
        action: plan.found.matches.length ? "update" : "create",
        memoId: plan.found.matches[0]?.memoId,
        title: plan.spec.title,
        content: plan.content
      }));
    const planByKey = new Map(plans.map((plan) => [plan.spec.key, plan]));
    const checkpoint = async (item, plan = planByKey.get(item.key)) => {
      if (!plan) throw new Error(`${item.key}: batch result has no local plan.`);
      const readBack = item.readBack ?? item.remote ?? item;
      const canonicalContent = normalizeMemoText(plan.content);
      const readBackContent = typeof readBack.content === "string" ? normalizeMemoText(readBack.content) : null;
      const readBackMatches = plan.overwrite
        ? (readBackContent !== null
          ? flomoComparableText(readBackContent) === flomoComparableText(canonicalContent)
          : readBack.hash === digest(canonicalContent))
        : (readBackContent !== null && flomoComparableText(readBackContent) === flomoComparableText(canonicalContent));
      if (!readBackMatches) {
        throw new Error(`${item.key}: Flomo readback does not match the prepared local source.`);
      }
      state.memos[item.key] = { memoId: item.memoId, baseContent: canonicalContent, hash: digest(canonicalContent), syncedAt: new Date().toISOString() };
      await writeState(state);
      const action = item.action === "update" ? "updated" : item.action === "create" ? "created" : item.action;
      results.push({ key: item.key, action, memoId: item.memoId });
    };
    try {
      for (const batchPlan of batchPlans) {
        const applied = await runBatch("apply", { plans: [batchPlan] });
        for (const item of applied.completed) await checkpoint(item);
      }
    } catch (error) {
      for (const item of error.completed ?? []) await checkpoint(item);
      throw error;
    }
    for (const plan of plans.filter((item) => !batchPlans.some((batchPlan) => batchPlan.key === item.spec.key))) {
      await checkpoint({
        key: plan.spec.key,
        memoId: plan.found.matches[0].memoId,
        readBack: plan.remoteReadBack,
        action: plan.found.matches.length ? (plan.overwrite ? "unchanged" : (plan.previous ? (plan.needsRemoteWrite ? "updated" : "unchanged") : "adopted")) : "created"
      }, plan);
    }
  } else {
    for (const plan of plans) {
      const { spec, previous, found, content, remoteReadBack, needsRemoteWrite } = plan;
      let memo;
      try {
        if (overwriteConflicts && !found.matches.length) throw new Error("Conflict overwrite target is missing.");
        memo = found.matches.length ? ((overwriteConflicts || previous) && needsRemoteWrite ? await client.update(found.matches[0], content, spec.title) : found.matches[0]) : await client.create(content);
      } catch (error) {
        throw new Error(`${spec.key}: ${error.message}`, { cause: error });
      }
      const readBack = remoteReadBack && !previous && !overwriteConflicts ? remoteReadBack : await client.read(memo, spec.title);
      const canonicalContent = normalizeMemoText(content);
      const readBackContent = normalizeMemoText(readBack.content);
      if (flomoComparableText(readBackContent) !== flomoComparableText(canonicalContent)) throw new Error(`${spec.key}: Flomo readback does not match the prepared local source.`);
      state.memos[spec.key] = { memoId: memo.memoId, baseContent: canonicalContent, hash: digest(canonicalContent), syncedAt: new Date().toISOString() };
      await writeState(state);
      results.push({ key: spec.key, action: found.matches.length ? (overwriteConflicts ? (needsRemoteWrite ? "updated" : "unchanged") : (previous ? (needsRemoteWrite ? "updated" : "unchanged") : "adopted")) : "created", memoId: memo.memoId });
    }
  }
  if (!dryRun) await writeState(state);
  return { ...input, specs, skipped, results };
}

async function writeOverwriteAudit(plans) {
  const auditPath = path.join(repoRoot, "04_output/_dist/flomo-sync/overwrite-audit.json");
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "local-source-overwrite",
    items: plans.map(({ spec, previous, found, remoteReadBack, needsRemoteWrite }) => {
      const local = normalizeMemoText(spec.content);
      const remote = typeof remoteReadBack?.content === "string" ? normalizeMemoText(remoteReadBack.content) : "";
      const remoteHash = remoteReadBack?.hash ?? digest(remote);
      const remoteLength = remoteReadBack?.length ?? remote.length;
      return {
        key: spec.key,
        memoId: found.matches[0]?.memoId,
        action: needsRemoteWrite ? "update" : "unchanged",
        localHash: digest(local),
        remoteHash,
        previousHash: previous?.hash ?? null,
        localLength: local.length,
        remoteLength,
        hasVerificationMarker: remoteReadBack?.hasVerificationMarker ?? remote.includes(spec.verification)
      };
    })
  }, null, 2)}\n`, "utf8");
}

const dryRunClient = { find: async () => ({ matches: [], legacy: false }) };

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { version: 1, memos: {} }; throw error; }
}

async function writeState(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    if (argv[index] === "--period") options.period = argv[++index];
    if (argv[index] === "--manifest") options.manifestPath = argv[++index];
    if (argv[index] === "--skip-key") options.skipKeys = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    if (argv[index] === "--overwrite-conflicts") options.overwriteConflicts = true;
    if (argv[index] === "--overwrite-key") options.overwriteKeys = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    if (argv[index] === "--dry-run") options.dryRun = true;
    if (argv[index] === "--only") options.only = argv[++index];
    if (argv[index] === "--task-name") options.taskName = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncFlomoWeekly(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ period: result.period || result.week, manifestPath: result.manifestPath, skipped: result.skipped, results: result.results, taskSpace: result.taskSpace }, null, 2));
}

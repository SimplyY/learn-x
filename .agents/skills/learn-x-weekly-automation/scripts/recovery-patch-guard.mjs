import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { recordRecoveryIncident, recoveryStatePaths } from "./recovery-memory.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const MAX_PATCH_BYTES = 128 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DURATION_MS = 100 * 60_000;
const SAFE_SOURCE = /^[a-z][a-z0-9-]{0,31}$/;

export async function applyControlledRecoveryPatch({
  week, problemId, sourceId, errorSignal, rootCauseEvidenceRef, patchText, reviewReceipt, authorId,
  failureTest, counterexampleTest, deadlineAtEpochMs, repoRoot = defaultRepoRoot,
  stateRoot = recoveryStatePaths().root, applyPatch = applyWithGit, runNamedTest = runNodeTest,
  isTrackedFile = trackedFile, now = () => Date.now()
} = {}) {
  const targetWeek = normalizeWeek(week);
  if (!/^P-[a-f0-9]{16}$/.test(String(problemId || ""))) throw new Error("small-patch-problem-id-invalid");
  if (!SAFE_SOURCE.test(String(sourceId || ""))) throw new Error("small-patch-source-invalid");
  if (!/^[A-Z][A-Z0-9-]{1,63}$/.test(String(errorSignal || "")) || errorSignal === "UNKNOWN-FAILURE") {
    throw new Error("small-patch-root-cause-signal-required");
  }
  const rootEvidence = cleanRelativePath(rootCauseEvidenceRef);
  const patch = String(patchText || "");
  if (!patch || Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) throw new Error("small-patch-size-invalid");
  const patchSha256 = sha256(patch);
  const patchFiles = parsePatchFiles(patch);
  if (patchFiles.length < 1 || patchFiles.length > 3) throw new Error("small-patch-file-budget-exceeded");
  for (const file of patchFiles) validateCodePath(file);
  const author = cleanActorId(authorId);
  const review = validateReviewReceipt(reviewReceipt, { problemId, patchSha256, authorId: author });
  const failureCase = validateTestCase(failureTest);
  const counterexampleCase = validateTestCase(counterexampleTest);
  if (failureCase.path === counterexampleCase.path && failureCase.title === counterexampleCase.title) {
    throw new Error("small-patch-tests-must-be-distinct");
  }
  const deadline = validateDeadline(deadlineAtEpochMs, now());
  const rootPath = path.resolve(repoRoot);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("small-patch-repository-root-invalid");
  const evidencePath = path.resolve(rootPath, rootEvidence);
  if (!isInside(rootPath, evidencePath)) throw new Error("small-patch-evidence-path-invalid");
  await assertSafeRegularFile(rootPath, rootEvidence);
  await assertSafeRegularFile(rootPath, failureCase.path);
  await assertSafeRegularFile(rootPath, counterexampleCase.path);

  const stateRootPath = path.resolve(stateRoot);
  if (!isInside(rootPath, stateRootPath)) throw new Error("small-patch-state-path-invalid");
  await ensureSafeDirectory(rootPath, path.relative(rootPath, stateRootPath));
  const statePaths = recoveryStatePaths(stateRootPath);
  const lockPath = path.join(statePaths.root, ".recovery-patch-" + targetWeek + ".lock");
  const lock = await acquirePatchLock(lockPath);
  let tempRoot;
  let begun = false;
  let applyStarted = false;
  let postHashes = null;
  let snapshots = [];
  const runId = randomUUID();
  let rollback = { status: "not-needed", restored: [], conflicts: [] };
  try {
    const events = await readIncidentEvents(statePaths.eventsPath);
    const rootCause = events.find((event) => event.problemId === problemId && event.rootCauseStatus === "confirmed"
      && event.verification === "verified" && event.evidenceRef === rootEvidence && event.sourceId === sourceId
      && event.errorSignal === errorSignal);
    if (!rootCause) {
      throw new Error("small-patch-root-cause-not-verified");
    }
    if (events.some((event) => event.week === targetWeek && event.problemId === problemId
      && event.layer === 3 && event.actionCode === "small-patch")) {
      throw new Error("small-patch-week-problem-limit");
    }
    const reviewDigest = sha256(JSON.stringify([review.reviewerId, review.authorId, review.patchSha256, review.verdict, review.findings]));
    assertBeforeDeadline(deadline, now());
    for (const file of patchFiles) {
      await assertNoSymlinkComponents(rootPath, file);
      if (!await isTrackedFile(file, rootPath, deadline, now)) throw new Error("small-patch-file-not-tracked");
    }
    snapshots = await snapshotFiles(rootPath, patchFiles);
    const baselineDigest = digestFileSet(snapshots);
    const failureBefore = await runCheck(runNamedTest, failureCase, rootPath, deadline, now);
    if (!failureBefore.observed || failureBefore.passed || !failureBefore.failed) {
      throw new Error(`small-patch-original-failure-not-reproduced-${failureBefore.runnerOutcome || "unknown"}`);
    }
    const counterexampleBefore = await runCheck(runNamedTest, counterexampleCase, rootPath, deadline, now);
    if (!counterexampleBefore.observed || !counterexampleBefore.passed) throw new Error("small-patch-counterexample-baseline-failed");
    await assertHashesUnchanged(rootPath, snapshots);

    await recordRecoveryIncident({
      eventId: "small-patch-start-" + targetWeek + "-" + problemId,
      runId, week: targetWeek, sourceId, problemId, errorClass: errorSignal, errorSignal, layer: 3,
      eventType: "recovery", attemptKind: "small-patch", actionCode: "small-patch",
      actionNote: "受控补丁准备通过原失败与反例验证",
      actionPreconditions: ["same-target-week", "status-readback-valid", "user-confirmed-scope", "remaining-budget-sufficient"],
      outcome: "candidate", rootCauseStatus: "unconfirmed", verification: "pending",
      evidenceRef: rootEvidence,
      evidence: { phase: "repair", targetWeek, patchSha256, baselineDigest, reviewerReceiptSha256: reviewDigest,
        changedFiles: patchFiles, patchFileCount: patchFiles.length, originalFailureObserved: true, counterexampleBaselinePassed: true }
    }, { stateRoot });
    begun = true;

    tempRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-patch-"));
    assertBeforeDeadline(deadline, now());
    await assertHashesUnchanged(rootPath, snapshots);
    const expectedFiles = await calculateExpectedPatchResult({ patch, snapshots, tempRoot, deadlineAtEpochMs: deadline, now });
    postHashes = new Map(expectedFiles.map((file) => [file.path, file.sha256]));
    await assertHashesUnchanged(rootPath, snapshots);
    applyStarted = true;
    const applyResult = await applyPatch({ patch, patchFiles, repoRoot: rootPath, tempRoot, deadlineAtEpochMs: deadline, now });
    if (applyResult?.applied !== true) throw new Error("small-patch-apply-not-confirmed");
    const afterApply = await snapshotFiles(rootPath, patchFiles);
    if (!sameHashes(expectedFiles, afterApply)) throw new Error("small-patch-concurrent-edit-detected-during-apply");
    const lineCounts = countChanges(snapshots, afterApply);
    const changed = lineCounts.added + lineCounts.deleted;
    if (!changed || changed > 100) throw new Error("small-patch-line-budget-exceeded");
    const failureAfter = await runCheck(runNamedTest, failureCase, rootPath, deadline, now);
    if (!failureAfter.observed || !failureAfter.passed) throw new Error("small-patch-original-failure-not-fixed");
    const counterexampleAfter = await runCheck(runNamedTest, counterexampleCase, rootPath, deadline, now);
    if (!counterexampleAfter.observed || !counterexampleAfter.passed) throw new Error("small-patch-counterexample-regressed");
    const finalFiles = await snapshotFiles(rootPath, patchFiles);
    if (digestFileSet(finalFiles) === baselineDigest) throw new Error("small-patch-no-effective-change");
    if (!sameHashes(expectedFiles, finalFiles)) throw new Error("small-patch-concurrent-edit-detected");

    const resultDigest = digestFileSet(finalFiles);
    await recordRecoveryIncident({
      eventId: "small-patch-verified-" + targetWeek + "-" + problemId,
      runId, week: targetWeek, sourceId, problemId, errorClass: errorSignal, errorSignal, layer: 3,
      eventType: "recovery", attemptKind: "small-patch", actionCode: "small-patch",
      actionNote: "受控补丁通过原失败与反例验证",
      actionPreconditions: ["same-target-week", "status-readback-valid", "user-confirmed-scope", "remaining-budget-sufficient"],
      outcome: "verified", rootCauseStatus: "confirmed", verification: "verified",
      evidenceRef: rootEvidence,
      evidence: { phase: "validation", targetWeek, patchSha256, baselineDigest, resultDigest,
        reviewerReceiptSha256: reviewDigest, changedFiles: patchFiles, patchFileCount: patchFiles.length,
        addedLines: lineCounts.added, deletedLines: lineCounts.deleted,
        originalFailureObserved: true, originalFailureFixed: true,
        counterexampleBaselinePassed: true, counterexampleAfterPassed: true }
    }, { stateRoot });
    return { status: "verified", week: targetWeek, problemId, runId, patchSha256, patchFiles,
      addedLines: lineCounts.added, deletedLines: lineCounts.deleted,
      originalFailureObserved: true, originalFailureFixed: true, counterexampleBaselinePassed: true,
      counterexampleAfterPassed: true, baselineDigest, resultDigest, reviewReceiptSha256: reviewDigest };
  } catch (error) {
    if (applyStarted && !postHashes && snapshots.length) {
      try {
        const current = await snapshotFiles(rootPath, snapshots.map((file) => file.path));
        const changed = current.filter((file, index) => file.sha256 !== snapshots[index].sha256);
        if (changed.length) rollback = { status: "unknown", restored: [], conflicts: changed.map((file) => file.path) };
      } catch { rollback = { status: "unknown", restored: [], conflicts: snapshots.map((file) => file.path) }; }
    }
    if (postHashes && snapshots.length) rollback = await rollbackOwnChanges(rootPath, snapshots, postHashes);
    if (begun) {
      await recordRecoveryIncident({
        eventId: "small-patch-result-" + targetWeek + "-" + problemId,
        runId, week: targetWeek, sourceId, problemId, errorClass: errorSignal, errorSignal, layer: 3,
        eventType: "recovery", attemptKind: "small-patch", actionCode: "small-patch",
        actionNote: "受控补丁未通过验证",
        actionPreconditions: ["same-target-week", "status-readback-valid", "user-confirmed-scope"],
        outcome: rollback.conflicts.length || rollback.status === "unknown" ? "inconclusive" : "failed",
        rootCauseStatus: "unconfirmed", verification: "failed", evidenceRef: rootEvidence,
        evidence: { phase: "validation", targetWeek, patchSha256, changedFiles: patchFiles,
          patchFileCount: patchFiles.length, rollbackStatus: rollback.status,
          rollbackRestoredCount: rollback.restored.length, rollbackConflictCount: rollback.conflicts.length }
      }, { stateRoot });
    }
    throw new Error(error.message + "; rollback=" + rollback.status);
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    await releasePatchLock(lockPath, lock);
  }
}

async function applyWithGit({ patch, repoRoot, tempRoot, deadlineAtEpochMs, now }) {
  const patchPath = path.join(tempRoot, "patch.diff");
  await writeFile(patchPath, patch, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checked = await runProxy(["git", "apply", "--check", "--", patchPath], repoRoot, deadlineAtEpochMs, now);
  if (checked.code !== 0) throw new Error("small-patch-apply-check-failed");
  const result = await runProxy(["git", "apply", "--", patchPath], repoRoot, deadlineAtEpochMs, now);
  if (result.code !== 0) throw new Error("small-patch-apply-rejected");
  return { applied: true };
}

async function calculateExpectedPatchResult({ patch, snapshots, tempRoot, deadlineAtEpochMs, now }) {
  const shadowRoot = path.join(tempRoot, "expected");
  await mkdir(shadowRoot, { recursive: true, mode: 0o700 });
  for (const snapshot of snapshots) {
    const absolute = path.resolve(shadowRoot, snapshot.path);
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, snapshot.contents, { mode: snapshot.mode, flag: "wx" });
  }
  const patchPath = path.join(tempRoot, "expected.patch");
  await writeFile(patchPath, patch, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const checked = await runProxy(["git", "apply", "--check", "--", patchPath], shadowRoot, deadlineAtEpochMs, now);
  if (checked.code !== 0) throw new Error("small-patch-expected-result-check-failed");
  const applied = await runProxy(["git", "apply", "--", patchPath], shadowRoot, deadlineAtEpochMs, now);
  if (applied.code !== 0) throw new Error("small-patch-expected-result-apply-failed");
  return snapshotFiles(shadowRoot, snapshots.map((file) => file.path));
}

async function runNodeTest({ testCase, repoRoot, deadlineAtEpochMs, now }) {
  const absoluteTestPath = path.resolve(repoRoot, testCase.path);
  const remaining = deadlineAtEpochMs - now();
  if (remaining <= 0) throw new Error("small-patch-deadline-exceeded");
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  let result;
  try {
    const output = await execFileAsync(process.execPath, ["--test", "--test-reporter=tap", absoluteTestPath], {
      cwd: repoRoot, env: childEnv, timeout: remaining, maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    result = { code: 0, stdout: output.stdout || "", stderr: output.stderr || "" };
  } catch (error) {
    if (error.killed || error.signal === "SIGTERM") throw new Error("small-patch-deadline-exceeded");
    result = { code: Number.isInteger(error.code) ? error.code : 1, stdout: String(error.stdout || ""), stderr: String(error.stderr || "") };
  }
  const output = result.stdout + "\n" + result.stderr;
  const expectedTitle = escapeRegExp(testCase.title);
  const lines = output.split(/\r?\n/);
  const observed = lines.some((line) => new RegExp(`^\\s*# Subtest: ${expectedTitle}\\s*$`).test(line)
    || new RegExp(`^\\s*(?:ok|not ok)\\s+\\d+\\s+-\\s+${expectedTitle}(?:\\s+# SKIP.*)?\\s*$`).test(line));
  const passLine = lines.some((line) => new RegExp(`^\\s*ok\\s+\\d+\\s+-\\s+${expectedTitle}\\s*$`).test(line));
  const failLine = lines.some((line) => new RegExp(`^\\s*not ok\\s+\\d+\\s+-\\s+${expectedTitle}\\s*$`).test(line));
  const skipped = lines.some((line) => new RegExp(`^\\s*ok\\s+\\d+\\s+-\\s+${expectedTitle}\\s+# SKIP`).test(line));
  const failed = observed && failLine && result.code !== 0;
  const passed = observed && passLine && !skipped && result.code === 0;
  const runnerOutcome = passed ? "passed" : failed ? "failed" : output.includes("SyntaxError") ? "load-error"
    : output.includes("Could not find") ? "test-file-missing" : `target-line-missing-exit-${result.code}`;
  return { observed, passed, failed, runnerOutcome, exitCode: result.code };
}

async function runCheck(runNamedTest, testCase, repoRoot, deadlineAtEpochMs, now) {
  assertBeforeDeadline(deadlineAtEpochMs, now());
  const result = await runNamedTest({ testCase, repoRoot, deadlineAtEpochMs, now });
  if (!result || typeof result.observed !== "boolean" || typeof result.passed !== "boolean" || typeof result.failed !== "boolean") {
    throw new Error("small-patch-test-result-invalid");
  }
  return result;
}

async function runProxy(args, cwd, deadlineAtEpochMs, now) {
  const remaining = deadlineAtEpochMs - now();
  if (remaining <= 0) throw new Error("small-patch-deadline-exceeded");
  try {
    const result = await execFileAsync("rtk", ["proxy", ...args], {
      cwd, timeout: Math.max(1, remaining), maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    return { code: 0, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    if (error.killed || error.signal === "SIGTERM") throw new Error("small-patch-deadline-exceeded");
    return { code: Number.isInteger(error.code) ? error.code : 1, stdout: String(error.stdout || ""), stderr: String(error.stderr || "") };
  }
}

async function trackedFile(relativePath, repoRoot, deadlineAtEpochMs, now) {
  const result = await runProxy(["git", "ls-files", "--error-unmatch", "--", relativePath], repoRoot, deadlineAtEpochMs, now);
  return result.code === 0;
}

async function snapshotFiles(root, files) {
  const result = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (!isInside(root, absolute)) throw new Error("small-patch-file-path-invalid");
    await assertNoSymlinkComponents(root, file);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("small-patch-file-not-regular");
    if (info.size > MAX_FILE_BYTES) throw new Error("small-patch-file-too-large");
    const contents = await readFile(absolute);
    result.push({ path: file, contents, mode: info.mode & 0o777, sha256: sha256(contents) });
  }
  return result;
}

async function assertHashesUnchanged(root, snapshots) {
  const current = await snapshotFiles(root, snapshots.map((file) => file.path));
  if (!sameHashes(snapshots, current)) throw new Error("small-patch-concurrent-edit-before-apply");
}

async function rollbackOwnChanges(root, snapshots, postHashes) {
  const restored = [];
  const conflicts = [];
  for (const original of snapshots) {
    const absolute = path.resolve(root, original.path);
    try {
      await assertNoSymlinkComponents(root, original.path);
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink()) { conflicts.push(original.path); continue; }
      const current = await readFile(absolute);
      const currentHash = sha256(current);
      if (currentHash === original.sha256) continue;
      if (currentHash !== postHashes.get(original.path)) { conflicts.push(original.path); continue; }
      const temp = absolute + "." + process.pid + "-" + randomUUID() + ".rollback";
      await writeFile(temp, original.contents, { mode: original.mode, flag: "wx" });
      await rename(temp, absolute);
      restored.push(original.path);
    } catch { conflicts.push(original.path); }
  }
  return { status: conflicts.length ? (restored.length ? "partial-conflict" : "conflict") : (restored.length ? "restored" : "not-needed"), restored, conflicts };
}

function countChanges(before, after) {
  let added = 0;
  let deleted = 0;
  for (const original of before) {
    const changed = after.find((item) => item.path === original.path);
    if (!changed) throw new Error("small-patch-file-set-changed");
    const left = original.contents.toString("utf8").split(/\r?\n/);
    const right = changed.contents.toString("utf8").split(/\r?\n/);
    if (left.length > 4_000 || right.length > 4_000) throw new Error("small-patch-line-count-too-large");
    let previous = new Uint32Array(right.length + 1);
    for (let i = 1; i <= left.length; i += 1) {
      const current = new Uint32Array(right.length + 1);
      for (let j = 1; j <= right.length; j += 1) {
        current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
      }
      previous = current;
    }
    const common = previous[right.length];
    deleted += left.length - common;
    added += right.length - common;
  }
  return { added, deleted };
}

function parsePatchFiles(patch) {
  if (/^(?:GIT binary patch|new file mode|deleted file mode|rename from|rename to)/m.test(patch)) {
    throw new Error("small-patch-non-text-change-rejected");
  }
  const oldPaths = [];
  const newPaths = [];
  const gitPaths = [];
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --")) {
      const match = line.match(/^diff --git a\/([^ ]+) b\/([^ ]+)$/);
      if (!match) throw new Error("small-patch-unified-diff-invalid");
      const oldPath = cleanRelativePath(match[1]);
      const newPath = cleanRelativePath(match[2]);
      if (oldPath !== newPath) throw new Error("small-patch-rename-or-create-rejected");
      gitPaths.push(oldPath);
    }
    if (line.startsWith("--- ")) oldPaths.push(parseDiffPath(line.slice(4), "a/"));
    if (line.startsWith("+++ ")) newPaths.push(parseDiffPath(line.slice(4), "b/"));
  }
  if (!oldPaths.length || oldPaths.length !== newPaths.length || gitPaths.length !== oldPaths.length) throw new Error("small-patch-unified-diff-invalid");
  const files = [];
  for (let index = 0; index < oldPaths.length; index += 1) {
    if (oldPaths[index] !== newPaths[index]) throw new Error("small-patch-rename-or-create-rejected");
    if (gitPaths[index] !== oldPaths[index]) throw new Error("small-patch-file-header-mismatch");
    files.push(oldPaths[index]);
  }
  if (new Set(files).size !== files.length) throw new Error("small-patch-duplicate-file-rejected");
  return files;
}

function parseDiffPath(value, prefix) {
  const candidate = value.split("\t", 1)[0];
  if (!candidate.startsWith(prefix)) throw new Error("small-patch-path-prefix-invalid");
  return cleanRelativePath(candidate.slice(prefix.length));
}

function validateCodePath(value, { allowTests = false } = {}) {
  const codeSurface = (value.startsWith(".agents/skills/") && (value.includes("/scripts/") || value.endsWith("/SKILL.md")))
    || value.startsWith("app/code/");
  if (!codeSurface || !/\.(?:mjs|cjs|js|ts|tsx|jsx|json|md)$/.test(value)
    || (!allowTests && /\.test\.(?:mjs|cjs|js|ts|tsx)$/.test(value))) throw new Error("small-patch-code-path-not-allowed");
}

function validateTestCase(value) {
  if (!value || typeof value !== "object") throw new Error("small-patch-test-case-required");
  const relative = cleanRelativePath(value.path);
  validateCodePath(relative, { allowTests: true });
  if (!/\.test\.(?:mjs|cjs|js|ts|tsx)$/.test(relative)) throw new Error("small-patch-test-path-required");
  const title = String(value.title || "").trim();
  if (!title || title.length > 160 || /[\r\n\u0000-\u001f]/.test(title)) throw new Error("small-patch-test-title-invalid");
  return { path: relative, title };
}

function validateReviewReceipt(receipt, { problemId, patchSha256, authorId }) {
  // This validates declared provenance and patch binding; the caller must verify the independent review actually occurred.
  if (!receipt || typeof receipt !== "object" || receipt.problemId !== problemId || receipt.patchSha256 !== patchSha256
    || receipt.verdict !== "approved" || !Array.isArray(receipt.findings) || receipt.findings.length
    || cleanActorId(receipt.authorId) !== authorId) throw new Error("small-patch-review-receipt-invalid");
  const reviewerId = cleanActorId(receipt.reviewerId);
  if (reviewerId === authorId) throw new Error("small-patch-independent-review-required");
  return { reviewerId, authorId, patchSha256, verdict: "approved", findings: [] };
}

async function readIncidentEvents(file) {
  try {
    return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(error instanceof SyntaxError ? "small-patch-recovery-events-corrupt" : "small-patch-recovery-events-unavailable");
  }
}

async function assertSafeRegularFile(root, relative) {
  await assertNoSymlinkComponents(root, relative);
  const info = await lstat(path.resolve(root, relative));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("small-patch-file-not-regular");
}

async function ensureSafeDirectory(root, relative) {
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("small-patch-symlink-state-rejected");
  }
}

async function assertNoSymlinkComponents(root, relative) {
  const parts = relative.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("small-patch-symlink-path-rejected");
  }
}

async function acquirePatchLock(file) {
  let handle;
  try { handle = await open(file, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST" && await reapPatchLock(file)) handle = await open(file, "wx", 0o600);
    else if (error.code === "EEXIST") throw new Error("small-patch-lock-busy");
    else throw error;
  }
  const token = randomUUID();
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8"); }
  finally { await handle.close(); }
  return token;
}

async function reapPatchLock(file) {
  let current;
  try { current = JSON.parse(await readFile(file, "utf8")); } catch { return false; }
  if (!Number.isInteger(current.pid) || current.pid < 1) return false;
  try { process.kill(current.pid, 0); return false; }
  catch (error) {
    if (error.code !== "ESRCH") return false;
    try {
      const latest = JSON.parse(await readFile(file, "utf8"));
      if (latest.pid !== current.pid || latest.token !== current.token) return false;
      await rm(file);
      return true;
    } catch (removeError) { return removeError.code === "ENOENT"; }
  }
}

async function releasePatchLock(file, token) {
  try {
    const current = JSON.parse(await readFile(file, "utf8"));
    if (current.token === token) await rm(file, { force: true });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function cleanRelativePath(value) {
  const relative = String(value || "").replaceAll("\\", "/");
  if (!relative || relative.startsWith("/") || relative.includes("..") || !/^[A-Za-z0-9_./-]{1,180}$/.test(relative)
    || relative.split("/").some((part) => !part || part === ".")) {
    throw new Error("small-patch-path-invalid");
  }
  return relative;
}

function cleanActorId(value) {
  const actor = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(actor)) throw new Error("small-patch-reviewer-identity-invalid");
  return actor;
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) throw new Error("small-patch-week-invalid");
  return match[1] + "-W" + match[2];
}

function validateDeadline(value, currentTime) {
  const deadline = Number(value);
  if (!Number.isSafeInteger(deadline) || deadline <= currentTime || deadline - currentTime > MAX_DURATION_MS) {
    throw new Error("small-patch-deadline-invalid");
  }
  return deadline;
}

function assertBeforeDeadline(deadline, currentTime) {
  if (deadline - currentTime <= 0) throw new Error("small-patch-deadline-exceeded");
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function digestFileSet(files) {
  return sha256(JSON.stringify(files.map((file) => [file.path, file.sha256]).sort(([a], [b]) => a.localeCompare(b))));
}

function sameHashes(left, right) {
  return left.length === right.length && left.every((item, index) => item.path === right[index].path && item.sha256 === right[index].sha256);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

async function parseCli() {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? "" : args[index + 1] || ""; };
  const repoRoot = defaultRepoRoot;
  const receiptText = await readSafeCliInput(value("--review-receipt"), repoRoot, 16 * 1024);
  const patchText = await readSafeCliInput(value("--patch-file"), repoRoot, MAX_PATCH_BYTES);
  const receipt = JSON.parse(receiptText);
  return applyControlledRecoveryPatch({
    week: value("--week"), problemId: value("--problem-id"), sourceId: value("--source"),
    errorSignal: value("--symptom"), rootCauseEvidenceRef: value("--root-cause-evidence"),
    patchText, reviewReceipt: receipt, authorId: value("--author-id"),
    failureTest: { path: value("--failure-test"), title: value("--failure-title") },
    counterexampleTest: { path: value("--counterexample-test"), title: value("--counterexample-title") },
    deadlineAtEpochMs: Number(value("--deadline-at")), repoRoot
  });
}

async function readSafeCliInput(value, repoRoot, maximumBytes) {
  if (!value) throw new Error("small-patch-cli-input-required");
  const absolute = path.resolve(value);
  const libraryRoot = path.resolve(os.homedir(), "Library");
  if (isInside(libraryRoot, absolute) || absolute === libraryRoot) throw new Error("small-patch-private-library-input-rejected");
  if (!isInside(repoRoot, absolute)) {
    throw new Error("small-patch-cli-input-path-not-allowed");
  }
  const relative = path.relative(repoRoot, absolute).split(path.sep).join("/");
  await assertNoSymlinkComponents(repoRoot, relative);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("small-patch-cli-input-not-regular");
  if (info.size > maximumBytes) throw new Error("small-patch-cli-input-too-large");
  return readFile(absolute, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  parseCli().then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 2; });
}

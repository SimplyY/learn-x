import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {
  claimBuildRunContinuation,
  markBuildRunContinuationSubmitted,
  markBuildRunQuotaLimited,
  readBuildRunReceipt,
  recordBuildRunStart,
  verifyBuildRunArtifact
} from "./build-thread-recovery.mjs";

const identity = { week: "2026-W41", threadId: "thread-41", hostId: "local", automationId: "learn-x-codex-build" };

test("Build continuation is bound to the original task and atomically claimable once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const start = await recordBuildRunStart({ ...identity, repoRoot: root });
  assert.equal(start.status, "recorded");
  assert.equal(start.receipt.artifactPath, "03_input/weekly/2026-W41/build.md");
  assert.equal((await recordBuildRunStart({ ...identity, repoRoot: root })).status, "already-recorded");
  await assert.rejects(recordBuildRunStart({ ...identity, threadId: "other-thread", repoRoot: root }), /build-run-receipt-already-exists/);

  await markBuildRunQuotaLimited({ ...identity, reason: "quota-exhausted", repoRoot: root });
  await assert.rejects(claimBuildRunContinuation({ ...identity, taskStatus: "running", quotaAvailable: true, repoRoot: root }), /build-run-still-active/);
  await assert.rejects(claimBuildRunContinuation({ ...identity, taskStatus: "idle", quotaAvailable: false, repoRoot: root }), /build-quota-not-restored/);
  await assert.rejects(claimBuildRunContinuation({ ...identity, threadId: "wrong-thread", taskStatus: "idle", quotaAvailable: true, repoRoot: root }), /build-run-identity-mismatch/);
  await assert.rejects(claimBuildRunContinuation({ ...identity, automationId: "another-automation", taskStatus: "idle", quotaAvailable: true, repoRoot: root }), /build-run-identity-mismatch/);

  const claim = await claimBuildRunContinuation({ ...identity, taskStatus: "idle", quotaAvailable: true, repoRoot: root });
  assert.equal(claim.status, "claimed");
  assert.equal(claim.receipt.resumeCount, 1);
  assert.match(claim.followUpPrompt, /existing Codex Build/);
  assert.match(claim.followUpPrompt, /2026-W41/);
  await assert.rejects(claimBuildRunContinuation({ ...identity, taskStatus: "idle", quotaAvailable: true, repoRoot: root }), /build-run-resume-already-used/);

  await markBuildRunContinuationSubmitted({ ...identity, claimId: claim.claimId, repoRoot: root });
  const artifactPath = path.join(root, "03_input/weekly/2026-W41/build.md");
  await writeFile(artifactPath, "# Codex Build W41\n\n仅用于合成验证的私有正文。\n", "utf8");
  const verified = await verifyBuildRunArtifact({ ...identity, repoRoot: root });
  assert.equal(verified.status, "completed");
  assert.equal(verified.coverageWeek, "2026-W41");
  assert.match(verified.artifactSha256, /^[a-f0-9]{64}$/);
  const receipt = await readBuildRunReceipt({ week: identity.week, repoRoot: root });
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.threadId, identity.threadId);
  assert.doesNotMatch(await readFile(path.join(root, "03_input/weekly/2026-W41/_codex-build-run.json"), "utf8"), /仅用于合成验证的私有正文/);
});

test("concurrent first Build receipt setup tolerates a directory creation race", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-first-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = await Promise.allSettled([
    recordBuildRunStart({ ...identity, repoRoot: root }),
    recordBuildRunStart({ ...identity, repoRoot: root })
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  assert.ok(failures.length <= 1);
  assert.deepEqual(failures.map((result) => result.reason.message), failures.length ? ["build-run-lock-busy"] : []);
  const successes = results.filter((result) => result.status === "fulfilled").map((result) => result.value.status).sort();
  assert.ok(successes.includes("recorded"));
  if (successes.length === 2) assert.deepEqual(successes, ["already-recorded", "recorded"]);
});

test("Build continuation rejects unproven quota failures and wrong-week artifacts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-gates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordBuildRunStart({ ...identity, repoRoot: root });
  await assert.rejects(claimBuildRunContinuation({ ...identity, taskStatus: "idle", quotaAvailable: true, repoRoot: root }), /build-run-resume-already-used|build-run-not-quota-limited/);
  await assert.rejects(markBuildRunQuotaLimited({ ...identity, reason: "network-timeout", repoRoot: root }), /build-quota-reason-invalid/);
  await markBuildRunQuotaLimited({ ...identity, reason: "rate-limit-window", repoRoot: root });
  const claim = await claimBuildRunContinuation({ ...identity, taskStatus: "failed", quotaAvailable: true, repoRoot: root });
  await markBuildRunContinuationSubmitted({ ...identity, claimId: claim.claimId, repoRoot: root });
  const artifactPath = path.join(root, "03_input/weekly/2026-W41/build.md");
  await writeFile(artifactPath, "# Codex Build W40\n", "utf8");
  const mismatch = await verifyBuildRunArtifact({ ...identity, repoRoot: root });
  assert.equal(mismatch.status, "needs_review");
  assert.equal(mismatch.resultCode, "coverage-week-mismatch");
  assert.equal((await readBuildRunReceipt({ week: identity.week, repoRoot: root })).resumeCount, 1);
});

test("Build receipt cannot redirect continuation or verification outside the weekly input directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-path-"));
  const outsideFile = path.join(path.dirname(root), `${path.basename(root)}-outside.md`);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });
  await recordBuildRunStart({ ...identity, repoRoot: root });
  await markBuildRunQuotaLimited({ ...identity, reason: "quota-exhausted", repoRoot: root });
  await writeFile(outsideFile, "# Codex Build W41\n\n合成周报。\n", "utf8");
  const receiptPath = path.join(root, "03_input/weekly/2026-W41/_codex-build-run.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.artifactPath = path.relative(root, outsideFile);
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");

  await assert.rejects(claimBuildRunContinuation({ ...identity, taskStatus: "idle", quotaAvailable: true, repoRoot: root }), /build-run-artifact-path-invalid/);
  await assert.rejects(verifyBuildRunArtifact({ ...identity, repoRoot: root }), /build-run-artifact-path-invalid/);
});

test("Build verification rejects a symlink in the canonical artifact path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-symlink-"));
  const outsideFile = path.join(path.dirname(root), `${path.basename(root)}-outside.md`);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });
  const start = await recordBuildRunStart({ ...identity, repoRoot: root });
  const artifactPath = path.join(root, start.receipt.artifactPath);
  await writeFile(outsideFile, "# Codex Build W41\n\n合成周报。\n", "utf8");
  await symlink(outsideFile, artifactPath);
  const result = await verifyBuildRunArtifact({ ...identity, repoRoot: root });
  assert.equal(result.status, "needs_review");
  assert.equal(result.resultCode, "artifact-not-regular-file");
});

test("Build receipts reject symlinked weekly directories before writing outside the repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-week-dir-symlink-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });
  const weeklyPath = path.join(root, "03_input/weekly");
  await mkdir(path.dirname(weeklyPath), { recursive: true });
  await symlink(outsideDir, weeklyPath);

  await assert.rejects(recordBuildRunStart({ ...identity, repoRoot: root }), /build-run-path-symlink|build-run-path-outside-repository/);
  assert.deepEqual(await readdir(outsideDir), []);
});

test("Build verification rejects an external receipt reached through a symlinked weekly directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-week-verify-link-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-outside-receipt-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });
  const start = await recordBuildRunStart({ ...identity, repoRoot: root });
  const weeklyPath = path.join(root, "03_input/weekly");
  const weekPath = path.join(weeklyPath, identity.week);
  await copyFile(path.join(weekPath, "_codex-build-run.json"), path.join(outsideDir, "_codex-build-run.json"));
  await writeFile(path.join(outsideDir, "build.md"), "# Codex Build W41\n\nSynthetic receipt target.\n", "utf8");
  await rm(weekPath, { recursive: true, force: true });
  await symlink(outsideDir, weekPath);

  await assert.rejects(verifyBuildRunArtifact({ ...identity, repoRoot: root }), /build-run-path-symlink/);
  assert.equal(start.receipt.status, "running");
});

test("Build receipts accept ISO week 53 only in years that contain it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-build-thread-iso-week-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(recordBuildRunStart({ ...identity, week: "2025-W53", repoRoot: root }), /build-week-invalid/);
  const valid = await recordBuildRunStart({ ...identity, week: "2020-W53", repoRoot: root });
  assert.equal(valid.status, "recorded");
  assert.equal(valid.receipt.week, "2020-W53");
  const valid2026 = await recordBuildRunStart({ ...identity, week: "2026-W53", repoRoot: root });
  assert.equal(valid2026.status, "recorded");
  assert.equal(valid2026.receipt.week, "2026-W53");
});

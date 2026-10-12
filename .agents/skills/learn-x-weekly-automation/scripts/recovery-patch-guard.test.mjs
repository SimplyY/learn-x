import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hasVerifiedSmallPatch, recordManualRepair } from "./recovery-memory.mjs";
import { applyControlledRecoveryPatch } from "./recovery-patch-guard.mjs";

const week = "2026-W41";
const codePath = ".agents/skills/test/scripts/implementation.mjs";
const failureTest = { path: ".agents/skills/test/scripts/recovery.test.mjs", title: "reproduces original failure" };
const counterexampleTest = { path: ".agents/skills/test/scripts/counterexample.test.mjs", title: "preserves counterexample behavior" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-recovery-patch-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [codePath, failureTest.path, counterexampleTest.path, "docs/cases/root-cause.md"];
  for (const file of files) await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, codePath), "export const enabled = false; export const constant = 1;\n", "utf8");
  await writeFile(path.join(root, failureTest.path), 'import assert from "node:assert/strict"; import test from "node:test"; import { enabled } from "./implementation.mjs"; test("reproduces original failure", () => assert.equal(enabled, true));\n', "utf8");
  await writeFile(path.join(root, counterexampleTest.path), 'import assert from "node:assert/strict"; import test from "node:test"; import { constant } from "./implementation.mjs"; test("preserves counterexample behavior", () => assert.equal(constant, 1));\n', "utf8");
  await writeFile(path.join(root, "docs/cases/root-cause.md"), "Synthetic root-cause evidence reference.\n", "utf8");
  execFileSync("rtk", ["proxy", "git", "init", "--quiet"], { cwd: root, stdio: "ignore" });
  execFileSync("rtk", ["proxy", "git", "add", "--", codePath], { cwd: root, stdio: "ignore" });
  const stateRoot = path.join(root, "state");
  const rootCause = await recordManualRepair({
    week, sourceId: "health", symptom: "SOURCE-CONTRACT-MISMATCH", actionCode: "verify-only",
    actionNote: "核验目标周和来源状态", evidenceRef: "docs/cases/root-cause.md",
    verification: "verified", rootCauseStatus: "confirmed"
  }, { stateRoot });
  const patchText = [
    "diff --git a/" + codePath + " b/" + codePath,
    "--- a/" + codePath,
    "+++ b/" + codePath,
    "@@ -1 +1 @@",
    "-export const enabled = false; export const constant = 1;",
    "+export const enabled = true; export const constant = 1;",
    ""
  ].join("\n");
  const patchSha256 = createHash("sha256").update(patchText).digest("hex");
  const reviewReceipt = {
    problemId: rootCause.event.problemId, patchSha256, authorId: "author-1",
    reviewerId: "reviewer-2", verdict: "approved", findings: []
  };
  return { root, stateRoot, problemId: rootCause.event.problemId, patchText, patchSha256, reviewReceipt };
}

function options(f, overrides = {}) {
  return {
    week, problemId: f.problemId, sourceId: "health", errorSignal: "SOURCE-CONTRACT-MISMATCH",
    rootCauseEvidenceRef: "docs/cases/root-cause.md", patchText: f.patchText, reviewReceipt: f.reviewReceipt,
    authorId: "author-1", failureTest, counterexampleTest,
    deadlineAtEpochMs: Date.now() + 60_000, repoRoot: f.root, stateRoot: f.stateRoot,
    isTrackedFile: async () => true,
    ...overrides
  };
}

test("controlled patch applies only after a real failing test, matching reviewer receipt fields, and verified counterexample", async (t) => {
  const f = await fixture(t);
  const result = await applyControlledRecoveryPatch(options(f));
  assert.equal(result.status, "verified");
  assert.equal(result.originalFailureObserved, true);
  assert.equal(result.originalFailureFixed, true);
  assert.equal(result.counterexampleBaselinePassed, true);
  assert.equal(result.counterexampleAfterPassed, true);
  assert.equal(result.addedLines + result.deletedLines, 2);
  assert.equal(await readFile(path.join(f.root, codePath), "utf8"), "export const enabled = true; export const constant = 1;\n");
  const ledger = await readFile(path.join(f.stateRoot, "recovery-incidents.jsonl"), "utf8");
  assert.equal(ledger.includes(f.patchText), false);
  const events = ledger.trim().split("\n").map((line) => JSON.parse(line));
  const patchEvent = events.find((event) => event.eventId.startsWith("small-patch-verified-"));
  assert.equal(patchEvent.evidence.patchSha256, f.patchSha256);
  assert.deepEqual(patchEvent.evidence.changedFiles, [codePath]);
  assert.equal(await hasVerifiedSmallPatch({ week, sourceId: "health", problemId: f.problemId,
    errorSignal: "SOURCE-CONTRACT-MISMATCH" }, { stateRoot: f.stateRoot }), true);
  assert.equal(await hasVerifiedSmallPatch({ week: "2026-W40", sourceId: "health", problemId: f.problemId,
    errorSignal: "SOURCE-CONTRACT-MISMATCH" }, { stateRoot: f.stateRoot }), false);
  await assert.rejects(applyControlledRecoveryPatch(options(f)), /small-patch-week-problem-limit/);
});

test("a failed regression rolls back only the patch and leaves baseline bytes intact", async (t) => {
  const f = await fixture(t);
  await assert.rejects(applyControlledRecoveryPatch(options(f, {
    applyPatch: async ({ repoRoot }) => {
      await writeFile(path.join(repoRoot, codePath), "export const enabled = true; export const constant = 1;\n", "utf8");
      return { applied: true };
    },
    runNamedTest: async ({ testCase }) => ({
      observed: true,
      passed: testCase.title !== failureTest.title,
      failed: testCase.title === failureTest.title
    })
  })), /small-patch-original-failure-not-fixed; rollback=restored/);
  assert.equal(await readFile(path.join(f.root, codePath), "utf8"), "export const enabled = false; export const constant = 1;\n");
});

test("concurrent edits are preserved when a human changes bytes during patch application", async (t) => {
  const f = await fixture(t);
  await assert.rejects(applyControlledRecoveryPatch(options(f, {
    applyPatch: async ({ repoRoot }) => {
      await writeFile(path.join(repoRoot, codePath), "export const enabled = true; export const constant = 1;\n", "utf8");
      await writeFile(path.join(repoRoot, codePath), "export const enabled = 'human-edit';\n", "utf8");
      return { applied: true };
    }
  })), /small-patch-concurrent-edit-detected-during-apply; rollback=conflict/);
  assert.equal(await readFile(path.join(f.root, codePath), "utf8"), "export const enabled = 'human-edit';\n");
  const events = (await readFile(path.join(f.stateRoot, "recovery-incidents.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.find((event) => event.eventId.startsWith("small-patch-result-")).outcome, "inconclusive");
});

test("a patch over 100 effective lines is rejected and rolled back", async (t) => {
  const f = await fixture(t);
  const replacement = Array.from({ length: 102 }, (_, index) => `export const extra${index} = ${index};`);
  const patchText = ["diff --git a/" + codePath + " b/" + codePath, "--- a/" + codePath, "+++ b/" + codePath,
    `@@ -1 +1,${replacement.length} @@`, "-export const enabled = false; export const constant = 1;", ...replacement.map((line) => "+" + line), ""].join("\n");
  const reviewReceipt = { ...f.reviewReceipt, patchSha256: createHash("sha256").update(patchText).digest("hex") };
  await assert.rejects(applyControlledRecoveryPatch(options(f, { patchText, reviewReceipt,
    runNamedTest: async ({ testCase }) => ({ observed: true, passed: testCase.title !== failureTest.title,
      failed: testCase.title === failureTest.title }) })), /small-patch-line-budget-exceeded; rollback=restored/);
  assert.equal(await readFile(path.join(f.root, codePath), "utf8"), "export const enabled = false; export const constant = 1;\n");
});

test("patch guard rejects an over-budget file list and self-review before changing files", async (t) => {
  const f = await fixture(t);
  const oversizedPatch = [codePath, ...[1, 2, 3].map((number) => `.agents/skills/test/scripts/extra-${number}.mjs`)]
    .flatMap((file) => ["diff --git a/" + file + " b/" + file, "--- a/" + file, "+++ b/" + file,
      "@@ -1 +1 @@", "-a", "+b"])
    .concat("").join("\n");
  const oversizedReview = { ...f.reviewReceipt, patchSha256: createHash("sha256").update(oversizedPatch).digest("hex") };
  await assert.rejects(applyControlledRecoveryPatch(options(f, { patchText: oversizedPatch, reviewReceipt: oversizedReview })), /small-patch-file-budget-exceeded/);
  await assert.rejects(applyControlledRecoveryPatch(options(f, {
    reviewReceipt: { ...f.reviewReceipt, reviewerId: "author-1" }
  })), /small-patch-independent-review-required/);
  await assert.rejects(applyControlledRecoveryPatch(options(f, { isTrackedFile: async () => false })), /small-patch-file-not-tracked/);
  const testPath = failureTest.path;
  const testPatch = ["diff --git a/" + testPath + " b/" + testPath, "--- a/" + testPath, "+++ b/" + testPath,
    "@@ -1 +1 @@", "-before", "+after", ""].join("\n");
  await assert.rejects(applyControlledRecoveryPatch(options(f, { patchText: testPatch })), /small-patch-code-path-not-allowed/);
  assert.equal(await readFile(path.join(f.root, codePath), "utf8"), "export const enabled = false; export const constant = 1;\n");
});

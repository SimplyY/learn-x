import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBuildCoverageHeader } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const RECEIPT_NAME = "_codex-build-run.json";
const LOCK_NAME = "_codex-build-run.lock";
const QUOTA_REASONS = new Set(["quota-exhausted", "rate-limit-window"]);

export function buildRunReceiptPath(week, repoRoot = defaultRepoRoot) {
  const targetWeek = normalizeWeek(week);
  return path.join(repoRoot, "03_input", "weekly", targetWeek, RECEIPT_NAME);
}

export async function recordBuildRunStart({ week, threadId, hostId, automationId, repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
  const targetWeek = normalizeWeek(week);
  const receiptPath = buildRunReceiptPath(targetWeek, repoRoot);
  return withReceiptLock(receiptPath, async () => {
    let current = await readReceipt(receiptPath);
    if (current) {
      if (current.week === targetWeek && current.threadId === cleanId(threadId) && current.hostId === cleanId(hostId)
        && current.automationId === cleanAutomationId(automationId)) return { status: "already-recorded", receipt: summary(current) };
      throw new Error("build-run-receipt-already-exists");
    }
    const receipt = {
      schemaVersion: 1,
      week: targetWeek,
      threadId: cleanId(threadId),
      hostId: cleanId(hostId),
      automationId: cleanAutomationId(automationId),
      artifactPath: `03_input/weekly/${targetWeek}/build.md`,
      runId: randomUUID(),
      status: "running",
      startedAt: now().toISOString(),
      quotaReason: null,
      resumeCount: 0,
      resumeClaimId: null,
      resumeClaimedAt: null,
      resumeSubmittedAt: null,
      completedAt: null,
      artifactSha256: null,
      coverageWeek: null,
      resultCode: null
    };
    const saved = await writeReceipt(receiptPath, receipt);
    return { status: "recorded", receipt: summary(saved) };
  });
}

export async function markBuildRunQuotaLimited({ week, threadId, hostId, automationId, reason, repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
  const targetWeek = normalizeWeek(week);
  if (!QUOTA_REASONS.has(reason)) throw new Error("build-quota-reason-invalid");
  const receiptPath = buildRunReceiptPath(targetWeek, repoRoot);
  return withReceiptLock(receiptPath, async () => {
    const receipt = await requireReceipt(receiptPath, targetWeek, threadId, hostId, automationId);
    if (receipt.status === "quota-limited") return { status: "already-recorded", receipt: summary(receipt) };
    if (receipt.status !== "running" || receipt.resumeCount !== 0) throw new Error("build-run-not-interruptible");
    receipt.status = "quota-limited";
    receipt.quotaReason = reason;
    receipt.quotaObservedAt = now().toISOString();
    const saved = await writeReceipt(receiptPath, receipt);
    return { status: saved.status, receipt: summary(saved) };
  });
}

export async function claimBuildRunContinuation({ week, threadId, hostId, automationId, taskStatus, quotaAvailable, repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
  const targetWeek = normalizeWeek(week);
  const receiptPath = buildRunReceiptPath(targetWeek, repoRoot);
  return withReceiptLock(receiptPath, async () => {
    const receipt = await requireReceipt(receiptPath, targetWeek, threadId, hostId, automationId);
    if (receipt.resumeCount !== 0) throw new Error("build-run-resume-already-used");
    if (receipt.status !== "quota-limited" || receipt.quotaReason == null) throw new Error("build-run-not-quota-limited");
    if (taskStatus === "running") throw new Error("build-run-still-active");
    if (!["idle", "failed", "needs_attention"].includes(taskStatus)) throw new Error("build-run-status-unverified");
    if (quotaAvailable !== true) throw new Error("build-quota-not-restored");
    receipt.resumeCount = 1;
    receipt.resumeClaimId = randomUUID();
    receipt.resumeClaimedAt = now().toISOString();
    receipt.status = "resume-claimed";
    const saved = await writeReceipt(receiptPath, receipt);
    return {
      status: "claimed",
      claimId: saved.resumeClaimId,
      followUpPrompt: `Continue the existing Codex Build for ${targetWeek} in this thread. Resume unfinished work only; do not create another task or duplicate completed work. Validate that the report covers ${targetWeek} and write it to ${saved.artifactPath}.`,
      receipt: summary(saved)
    };
  });
}

export async function markBuildRunContinuationSubmitted({ week, threadId, hostId, automationId, claimId, repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
  const targetWeek = normalizeWeek(week);
  const receiptPath = buildRunReceiptPath(targetWeek, repoRoot);
  return withReceiptLock(receiptPath, async () => {
    const receipt = await requireReceipt(receiptPath, targetWeek, threadId, hostId, automationId);
    if (receipt.status === "resume-submitted" && receipt.resumeClaimId === claimId) return { status: "already-recorded", receipt: summary(receipt) };
    if (receipt.status !== "resume-claimed" || receipt.resumeClaimId !== claimId || receipt.resumeCount !== 1) throw new Error("build-resume-claim-mismatch");
    receipt.status = "resume-submitted";
    receipt.resumeSubmittedAt = now().toISOString();
    const saved = await writeReceipt(receiptPath, receipt);
    return { status: saved.status, receipt: summary(saved) };
  });
}

export async function verifyBuildRunArtifact({ week, threadId, hostId, automationId, repoRoot = defaultRepoRoot, now = () => new Date() } = {}) {
  const targetWeek = normalizeWeek(week);
  const receiptPath = buildRunReceiptPath(targetWeek, repoRoot);
  return withReceiptLock(receiptPath, async () => {
    const receipt = await requireReceipt(receiptPath, targetWeek, threadId, hostId, automationId);
    if (!["running", "quota-limited", "resume-submitted", "resume-claimed"].includes(receipt.status)) throw new Error("build-run-not-verifiable");
    const artifactPath = path.join(repoRoot, receipt.artifactPath);
    let coverage;
    try {
      const artifactStat = await lstat(artifactPath);
      if (!artifactStat.isFile()) throw Object.assign(new Error("build-artifact-not-regular-file"), { code: "ARTIFACT_NOT_REGULAR_FILE" });
      coverage = await readBuildCoverageHeader(artifactPath, targetWeek);
    }
    catch (error) {
      receipt.status = "needs_review";
      receipt.resultCode = error.code === "ENOENT" ? "artifact-missing" : error.code === "ARTIFACT_NOT_REGULAR_FILE" ? "artifact-not-regular-file" : "artifact-unreadable";
      receipt.completedAt = now().toISOString();
      const saved = await writeReceipt(receiptPath, receipt);
      return { status: saved.status, resultCode: saved.resultCode, receipt: summary(saved) };
    }
    if (coverage.status !== "matched") {
      receipt.status = "needs_review";
      receipt.resultCode = coverage.status === "mismatch" ? "coverage-week-mismatch" : "coverage-week-unverified";
      receipt.coverageWeek = coverage.coverageWeek || null;
      receipt.completedAt = now().toISOString();
      const saved = await writeReceipt(receiptPath, receipt);
      return { status: saved.status, resultCode: saved.resultCode, coverageWeek: saved.coverageWeek, receipt: summary(saved) };
    }
    receipt.status = "completed";
    receipt.resultCode = "coverage-verified";
    receipt.coverageWeek = targetWeek;
    receipt.artifactSha256 = await hashFile(artifactPath);
    receipt.completedAt = now().toISOString();
    const saved = await writeReceipt(receiptPath, receipt);
    return { status: saved.status, resultCode: saved.resultCode, coverageWeek: saved.coverageWeek, artifactSha256: saved.artifactSha256, receipt: summary(saved) };
  });
}

export async function readBuildRunReceipt({ week, repoRoot = defaultRepoRoot } = {}) {
  const targetWeek = normalizeWeek(week);
  const receiptPath = await prepareReceiptPath(buildRunReceiptPath(targetWeek, repoRoot), { create: false });
  if (!receiptPath) return null;
  const receipt = await readReceipt(receiptPath);
  return receipt ? summary(receipt) : null;
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error("build-week-invalid");
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan1 = new Date(0);
  jan1.setUTCFullYear(year, 0, 1);
  jan1.setUTCHours(0, 0, 0, 0);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxWeek = jan1.getUTCDay() === 4 || (jan1.getUTCDay() === 3 && isLeapYear) ? 53 : 52;
  if (week < 1 || week > maxWeek) throw new Error("build-week-invalid");
  return `${match[1]}-W${match[2]}`;
}
function cleanId(value) {
  const result = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(result)) throw new Error("build-thread-identity-invalid");
  return result;
}
function cleanAutomationId(value) {
  const result = String(value || "");
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(result)) throw new Error("build-automation-identity-invalid");
  return result;
}
async function requireReceipt(file, week, threadId, hostId, automationId) {
  const receipt = await readReceipt(file);
  if (!receipt) throw new Error("build-run-receipt-missing");
  if (receipt.week !== week || receipt.threadId !== cleanId(threadId) || receipt.hostId !== cleanId(hostId)
    || receipt.automationId !== cleanAutomationId(automationId)) throw new Error("build-run-identity-mismatch");
  return receipt;
}
async function readReceipt(file) {
  try {
    const fileStat = await lstat(file);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error("build-run-receipt-not-regular-file");
    const receipt = JSON.parse(await readFile(file, "utf8"));
    if (receipt.schemaVersion !== 1 || !receipt.week || !receipt.threadId || !receipt.hostId || !receipt.artifactPath) throw new Error("build-run-receipt-invalid");
    const normalizedWeek = normalizeWeek(receipt.week);
    if (receipt.week !== normalizedWeek || receipt.artifactPath !== `03_input/weekly/${normalizedWeek}/build.md`) throw new Error("build-run-artifact-path-invalid");
    return receipt;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function summary(receipt) {
  return Object.fromEntries(["schemaVersion", "week", "threadId", "hostId", "automationId", "artifactPath", "runId", "status", "startedAt",
    "quotaReason", "quotaObservedAt", "resumeCount", "resumeClaimId", "resumeClaimedAt", "resumeSubmittedAt", "completedAt", "artifactSha256", "coverageWeek", "resultCode"]
    .filter((key) => receipt[key] !== undefined).map((key) => [key, receipt[key]]));
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function withReceiptLock(receiptPath, action) {
  const safeReceiptPath = await prepareReceiptPath(receiptPath, { create: true });
  const directory = path.dirname(safeReceiptPath);
  receiptPath = safeReceiptPath;
  const lockPath = path.join(directory, LOCK_NAME);
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST" && await removeDeadLock(lockPath)) handle = await open(lockPath, "wx", 0o600);
    else if (error.code === "EEXIST") throw new Error("build-run-lock-busy");
    else throw error;
  }
  const token = randomUUID();
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8"); }
  finally { await handle.close(); }
  try { return await action(); }
  finally {
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current.token === token) await rm(lockPath, { force: true });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
async function removeDeadLock(lockPath) {
  let owner;
  try {
    const lockStat = await lstat(lockPath);
    if (lockStat.isSymbolicLink() || !lockStat.isFile()) return false;
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch { return false; }
  if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) {
    if (error.code !== "ESRCH") return false;
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current.pid !== owner.pid || current.token !== owner.token) return false;
      await rm(lockPath);
      return true;
    } catch (removeError) { return removeError.code === "ENOENT"; }
  }
}
async function prepareReceiptPath(receiptPath, { create }) {
  const absolute = path.resolve(receiptPath);
  const week = path.basename(path.dirname(absolute));
  const normalizedWeek = normalizeWeek(week);
  const repoRoot = path.resolve(path.dirname(absolute), "../../..");
  if (path.basename(absolute) !== RECEIPT_NAME
    || path.relative(repoRoot, absolute) !== path.join("03_input", "weekly", normalizedWeek, RECEIPT_NAME)) {
    throw new Error("build-run-path-invalid");
  }

  let canonicalRoot;
  try { canonicalRoot = await realpath(repoRoot); }
  catch (error) {
    if (error.code === "ENOENT" && !create) return null;
    throw error;
  }
  let directory = canonicalRoot;
  for (const segment of ["03_input", "weekly", normalizedWeek]) {
    directory = path.join(directory, segment);
    let entry;
    try { entry = await lstat(directory); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return null;
      try { await mkdir(directory); }
      catch (mkdirError) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
      entry = await lstat(directory);
    }
    if (entry.isSymbolicLink()) throw new Error("build-run-path-symlink");
    if (!entry.isDirectory()) throw new Error("build-run-path-not-directory");
    const actualDirectory = await realpath(directory);
    const relative = path.relative(canonicalRoot, actualDirectory);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("build-run-path-outside-repository");
    }
  }
  return path.join(directory, RECEIPT_NAME);
}
async function writeReceipt(file, receipt) {
  const temp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await open(temp, "wx", 0o600).then(async (handle) => { try { await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); } });
  try { await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
  return receipt;
}

function parseArgs(argv) {
  const value = (flag, fallback = "") => { const index = argv.indexOf(flag); return index < 0 ? fallback : argv[index + 1]; };
  return { week: value("--week"), repoRoot: value("--repo-root", defaultRepoRoot), threadId: value("--thread-id"), hostId: value("--host-id"),
    automationId: value("--automation-id"), reason: value("--reason"), taskStatus: value("--task-status"),
    quotaAvailable: argv.includes("--quota-available"), claimId: value("--claim-id"),
    mode: argv.includes("--record-start") ? "start" : argv.includes("--mark-quota-limited") ? "quota-limited"
      : argv.includes("--claim-resume") ? "claim" : argv.includes("--mark-resume-submitted") ? "submitted"
        : argv.includes("--verify-artifact") ? "verify" : "read" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const run = options.mode === "start" ? recordBuildRunStart(options)
    : options.mode === "quota-limited" ? markBuildRunQuotaLimited(options)
      : options.mode === "claim" ? claimBuildRunContinuation(options)
        : options.mode === "submitted" ? markBuildRunContinuationSubmitted(options)
          : options.mode === "verify" ? verifyBuildRunArtifact(options)
            : readBuildRunReceipt(options);
  run.then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

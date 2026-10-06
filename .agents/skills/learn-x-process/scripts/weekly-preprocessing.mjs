import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { compressVoiceForProcessPack } from "../../learn-x-input/scripts/collect-voice-weekly.mjs";
import { inputSize, MAX_WEEKLY_INPUT_CHARS } from "../../learn-x-input/scripts/lib/input-limits.mjs";
import { WEEKLY_SOURCE_CONFIG, weeklySourceForFile } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";

export const WEEKLY_PREPROCESS_RULE_VERSION = "weekly-preprocess/2026-10-05.1";

export function weeklyPreparationPath(repoRoot, week) {
  return path.join(repoRoot, "04_output/_dist/weekly", normalizeWeek(week), ".preprocessing", "manifest.json");
}

export async function prepareWeeklyProcessInputs({ week, repoRoot, payload }) {
  const manifestPath = weeklyPreparationPath(repoRoot, week);
  const prepDir = path.dirname(manifestPath);
  await mkdir(path.join(prepDir, "candidates"), { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const sourceSnapshots = [];
  const preparedItems = [];
  const requests = [];
  const exclusions = [];

  for (const file of payload.files) {
    const fileName = path.basename(file.path);
    if (fileName === "weekly.md") continue;
    const source = weeklySourceForFile(fileName);
    const inputPath = path.join(repoRoot, file.path);
    const raw = await readFile(inputPath, "utf8");
    const sourceHash = sha256(raw);
    const status = source ? payload.sourceStatuses?.[source.id] : undefined;
    const collector = source?.collector || "manual";
    const collectorHash = await collectorVersionHash(repoRoot, pkg.scripts?.[collector]);
    const snapshot = {
      sourceId: source?.id || `extra:${fileName}`,
      sourcePath: file.path,
      sourceHash,
      collector,
      collectorHash,
      generation: status?.updatedAt || null,
      status: status?.status || (fileName === "ai.md" ? "validated-manual" : "ready"),
      rawChars: file.rawChars,
      effectiveChars: file.effectiveChars
    };
    sourceSnapshots.push(snapshot);

    const isVoice = fileName === "voice.md";
    const isWeread = fileName === "weread.md" && file.effectiveChars > 0;
    const isOversized = fileName !== "weekly.md" && !isVoice && file.rawChars > MAX_WEEKLY_INPUT_CHARS;
    if (isVoice) {
      const voiceItems = payload.items.filter((item) => item.path === file.path);
      for (const item of voiceItems) preparedItems.push({ path: file.path, sourceHash, kind: "voice", itemId: item.id, text: compressVoiceForProcessPack(item.text) });
      continue;
    }
    if (!isWeread && !isOversized) continue;

    const candidateFile = path.join(prepDir, "candidates", `${safeId(snapshot.sourceId)}.json`);
    const required = Boolean(source?.blocksPack);
    let candidate = null;
    try {
      const value = JSON.parse(await readFile(candidateFile, "utf8"));
      if (value.schemaVersion !== 1 || value.week !== week || value.sourceId !== snapshot.sourceId
        || value.sourcePath !== file.path || value.sourceHash !== sourceHash
        || value.collectorHash !== collectorHash || value.ruleVersion !== WEEKLY_PREPROCESS_RULE_VERSION
        || typeof value.text !== "string" || !value.text.trim()) {
        throw new Error("candidate-version-mismatch");
      }
      const candidateChars = inputSize(value.text).chars;
      const reduction = file.effectiveChars ? 1 - candidateChars / file.effectiveChars : 0;
      const minimumReduction = isWeread && file.effectiveChars <= MAX_WEEKLY_INPUT_CHARS ? 0.01 : 0.05;
      if (reduction < minimumReduction) throw new Error("candidate-not-shorter-enough");
      candidate = { sourceHash, text: value.text, candidateChars, reductionRatio: Number(reduction.toFixed(3)) };
    } catch (error) {
      const missing = error.code === "ENOENT";
      requests.push({
        sourceId: snapshot.sourceId,
        sourcePath: file.path,
        sourceHash,
        collectorHash,
        ruleVersion: WEEKLY_PREPROCESS_RULE_VERSION,
        candidatePath: path.relative(repoRoot, candidateFile).split(path.sep).join("/"),
        required,
        reason: missing
          ? (isWeread ? "semantic-compression-required" : "over-limit-candidate-required")
          : "candidate-invalid-or-stale"
      });
      if (!required) exclusions.push({ sourceId: snapshot.sourceId, sourcePath: file.path, reason: missing ? "preprocessing-not-ready" : "candidate-invalid" });
      continue;
    }
    preparedItems.push({ path: file.path, sourceHash, kind: isWeread ? "weread" : "over-limit", text: candidate.text, candidateChars: candidate.candidateChars, reductionRatio: candidate.reductionRatio });
  }

  const mandatoryPending = requests.some((request) => request.required);
  const manifest = {
    schemaVersion: 1,
    week,
    ruleVersion: WEEKLY_PREPROCESS_RULE_VERSION,
    createdAt: new Date().toISOString(),
    completeForPack: !mandatoryPending,
    sourceSnapshots,
    preparedItems,
    requests,
    exclusions
  };
  const temp = `${manifestPath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  try { await rename(temp, manifestPath); }
  finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  return { manifest, manifestPath, requests, exclusions };
}

export async function loadWeeklyPreparation({ week, repoRoot, payload }) {
  const manifestPath = weeklyPreparationPath(repoRoot, week);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`weekly-preprocessing-required: run process:weekly -- --week ${week} --prepare`);
    throw error;
  }
  if (manifest.schemaVersion !== 1 || manifest.week !== week || manifest.ruleVersion !== WEEKLY_PREPROCESS_RULE_VERSION) {
    throw new Error(`weekly-preprocessing-stale: rule or manifest version changed; run --prepare for ${week}`);
  }
  const current = new Map();
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  for (const file of payload.files) {
    if (path.basename(file.path) === "weekly.md") continue;
    const source = weeklySourceForFile(path.basename(file.path));
    const raw = await readFile(path.join(repoRoot, file.path), "utf8");
    current.set(file.path, {
      sourceId: source?.id || `extra:${path.basename(file.path)}`,
      sourceHash: sha256(raw),
      collectorHash: await collectorVersionHash(repoRoot, pkg.scripts?.[source?.collector || "manual"]),
      generation: source ? payload.sourceStatuses?.[source.id]?.updatedAt || null : null
    });
  }
  const changed = [];
  const captured = new Map(manifest.sourceSnapshots.map((snapshot) => [snapshot.sourcePath, snapshot]));
  for (const [file, snapshot] of current) {
    const old = captured.get(file);
    if (!old || old.sourceHash !== snapshot.sourceHash || old.collectorHash !== snapshot.collectorHash || old.generation !== snapshot.generation) changed.push(file);
  }
  if (changed.length) {
    const requiredChanged = changed.filter((file) => weeklySourceForFile(path.basename(file))?.blocksPack);
    if (requiredChanged.length) throw new Error(`weekly-preprocessing-stale: required sources changed (${requiredChanged.join(", ")}); rerun --prepare`);
    manifest.exclusions = [...(manifest.exclusions || []), ...changed.map((file) => ({ sourcePath: file, reason: "source-changed-after-prepare" }))];
    manifest.preparedItems = (manifest.preparedItems || []).filter((item) => !changed.includes(item.path));
  }
  if (!manifest.completeForPack) {
    const required = (manifest.requests || []).filter((request) => request.required).map((request) => request.sourcePath);
    if (required.length) throw new Error(`weekly-preprocessing-required: ${required.join(", ")}; prepare candidates and rerun --prepare`);
  }
  const preparedVoiceIds = new Set((manifest.preparedItems || []).filter((item) => item.kind === "voice").map((item) => item.itemId));
  const missingVoice = payload.items.filter((item) => item.path.endsWith("/voice.md") && !preparedVoiceIds.has(item.id));
  if (missingVoice.length) {
    throw new Error(`weekly-preprocessing-required: voice cache missing for ${missingVoice.map((item) => item.id).join(", ")}; rerun --prepare`);
  }
  return { manifest, manifestPath };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function safeId(value) { return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-"); }
function normalizeWeek(value) { return String(value).replace(/^(\d{4})-(\d{1,2})$/, (_m, year, week) => `${year}-W${String(week).padStart(2, "0")}`); }

async function collectorVersionHash(repoRoot, command) {
  if (!command) return "manual";
  const match = String(command).match(/(\.agents\/skills\/[^\s;]+\.mjs)/);
  if (!match) return sha256(String(command));
  try { return sha256(await readFile(path.join(repoRoot, match[1]))); }
  catch { return `unavailable:${sha256(String(command))}`; }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareWeeklyProcessInputs, WEEKLY_PREPROCESS_RULE_VERSION } from "./weekly-preprocessing.mjs";

test("does not accept an oversized preprocessing candidate even when it meets the reduction ratio", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-preprocessing-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const relativePath = `03_input/weekly/${week}/weread.md`;
  const input = "x".repeat(16_000);
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(weekRoot, "weread.md"), input);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  const payload = {
    week,
    files: [{ path: relativePath, rawChars: 16_000, effectiveChars: 16_000 }],
    items: [{ id: `${relativePath}#1`, path: relativePath, text: input }],
    sourceStatuses: { weread: { status: "ready", updatedAt: "2026-09-28T00:00:00.000Z" } }
  };

  const first = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload });
  assert.equal(first.requests.length, 1);
  const request = first.requests[0];
  const candidatePath = path.join(root, request.candidatePath);
  await mkdir(path.dirname(candidatePath), { recursive: true });
  await writeFile(candidatePath, JSON.stringify({
    schemaVersion: 1,
    week,
    sourceId: request.sourceId,
    sourcePath: request.sourcePath,
    sourceHash: request.sourceHash,
    collectorHash: request.collectorHash,
    generation: request.generation,
    ruleVersion: WEEKLY_PREPROCESS_RULE_VERSION,
    text: "y".repeat(15_200)
  }));

  const second = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload });
  assert.equal(second.manifest.completeForPack, true, "an optional source may be excluded when no valid fitting candidate exists");
  assert.equal(second.manifest.preparedItems.length, 0);
  assert.equal(second.requests[0].reason, "candidate-not-within-limit");
  assert.equal(second.manifest.exclusions[0].reason, "candidate-not-within-limit");
});

test("invalidates semantic candidates on source generation changes and preserves a newer manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-preprocessing-generation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const relativePath = `03_input/weekly/${week}/weread.md`;
  const input = "x".repeat(16_000);
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(weekRoot, "weread.md"), input);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  const makePayload = (updatedAt) => ({
    week,
    files: [{ path: relativePath, rawChars: 16_000, effectiveChars: 16_000 }],
    items: [{ id: `${relativePath}#1`, path: relativePath, text: input }],
    sourceStatuses: { weread: { status: "ready", updatedAt } }
  });
  const older = makePayload("2026-09-28T00:00:00.000Z");
  const newer = makePayload("2026-09-28T00:30:00.000Z");
  const initial = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: older });
  assert.equal(initial.requests[0].generation, older.sourceStatuses.weread.updatedAt);

  const candidatePath = path.join(root, initial.requests[0].candidatePath);
  await writeFile(candidatePath, JSON.stringify({
    schemaVersion: 1,
    week,
    sourceId: initial.requests[0].sourceId,
    sourcePath: initial.requests[0].sourcePath,
    sourceHash: initial.requests[0].sourceHash,
    collectorHash: initial.requests[0].collectorHash,
    generation: initial.requests[0].generation,
    ruleVersion: WEEKLY_PREPROCESS_RULE_VERSION,
    text: "y".repeat(1_000)
  }));

  const newGeneration = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: newer });
  assert.equal(newGeneration.requests[0].reason, "candidate-invalid-or-stale");
  assert.equal(newGeneration.manifest.sourceSnapshots[0].generation, newer.sourceStatuses.weread.updatedAt);

  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  candidate.generation = newer.sourceStatuses.weread.updatedAt;
  await writeFile(candidatePath, JSON.stringify(candidate));
  const completed = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: newer });
  assert.equal(completed.manifest.completeForPack, true);

  const lateOlder = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: older });
  assert.equal(lateOlder.superseded, true);
  assert.equal(lateOlder.manifest.sourceSnapshots[0].generation, newer.sourceStatuses.weread.updatedAt);
});

test("allows refreshed manual AI input with a null generation and rejects a late stale snapshot", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-weekly-preprocessing-manual-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const week = "2026-W40";
  const relativePath = `03_input/weekly/${week}/ai.md`;
  const weekRoot = path.join(root, "03_input/weekly", week);
  await mkdir(weekRoot, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  const makePayload = (text) => ({
    week,
    files: [{ path: relativePath, rawChars: text.length, effectiveChars: text.length, rawHash: createHash("sha256").update(text).digest("hex") }],
    items: [{ id: `${relativePath}#1`, path: relativePath, text }],
    sourceStatuses: { ai: { status: "confirmed" } }
  });

  const originalText = "本周 AI 回顾初稿。";
  await writeFile(path.join(weekRoot, "ai.md"), originalText);
  const originalPayload = makePayload(originalText);
  const original = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: originalPayload });
  assert.equal(original.manifest.sourceSnapshots[0].generation, null);

  const refreshedText = "本周 AI 回顾已补全证据与结论。";
  await writeFile(path.join(weekRoot, "ai.md"), refreshedText);
  const refreshed = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload: makePayload(refreshedText) });
  assert.notEqual(refreshed.superseded, true);
  assert.equal(refreshed.manifest.sourceSnapshots[0].sourceHash, createHash("sha256").update(refreshedText).digest("hex"));

  await assert.rejects(
    prepareWeeklyProcessInputs({ week, repoRoot: root, payload: originalPayload }),
    /weekly-preprocessing-input-snapshot-stale/
  );
  const preserved = JSON.parse(await readFile(refreshed.manifestPath, "utf8"));
  assert.equal(preserved.sourceSnapshots[0].sourceHash, refreshed.manifest.sourceSnapshots[0].sourceHash);
});

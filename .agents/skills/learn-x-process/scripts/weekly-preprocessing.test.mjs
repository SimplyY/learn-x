import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    sourceStatuses: {}
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
    ruleVersion: WEEKLY_PREPROCESS_RULE_VERSION,
    text: "y".repeat(15_200)
  }));

  const second = await prepareWeeklyProcessInputs({ week, repoRoot: root, payload });
  assert.equal(second.manifest.completeForPack, true, "an optional source may be excluded when no valid fitting candidate exists");
  assert.equal(second.manifest.preparedItems.length, 0);
  assert.equal(second.requests[0].reason, "candidate-not-within-limit");
  assert.equal(second.manifest.exclusions[0].reason, "candidate-not-within-limit");
});

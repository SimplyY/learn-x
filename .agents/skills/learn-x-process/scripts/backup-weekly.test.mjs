import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { collectBackupFiles, createArchive, createManifest, retentionClassFor, selectAnnualRecordIds, validateArchiveEntries, validateManifest } from "./backup-weekly.mjs";

test("scans all backup roots, ignores .DS_Store and credential-like files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-test-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output"]) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, "01_core", "kept.md"), "core");
    await writeFile(path.join(root, "03_input", ".DS_Store"), "noise");
    await writeFile(path.join(root, "03_input", "secret-token.txt"), "do not upload");
    await writeFile(path.join(root, "04_output", "中文 文件.md"), "output");
    const result = await collectBackupFiles(root);
    assert.deepEqual(result.files.map((file) => file.path), ["01_core/kept.md", "04_output/中文 文件.md"]);
    assert.deepEqual(result.excluded.map((file) => file.path), ["03_input/.DS_Store", "03_input/secret-token.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest digest is stable when only creation time changes", () => {
  const files = [{ path: "01_core/a.md", bytes: 1, sha256: "a" }];
  const first = createManifest("2026-W34", files, [], "2026-08-17T00:00:00.000Z");
  const second = createManifest("2026-W34", files, [], "2026-08-18T00:00:00.000Z");
  assert.equal(first.manifestSha256, second.manifestSha256);
});

test("creates a tar.gz archive that restores and validates against the manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-archive-test-"));
  const extracted = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-extract-test-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output"]) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, "01_core", "a.md"), "archive me");
    const scanned = await collectBackupFiles(root);
    const manifest = createManifest("2026-W34", scanned.files, scanned.excluded);
    const archive = await createArchive(root, "2026-W34", manifest, scanned.files);
    await new Promise((resolve, reject) => execFile("tar", ["-xzf", archive.archivePath, "-C", extracted], (error) => error ? reject(error) : resolve()));
    const restored = await validateManifest(extracted, manifest.manifestSha256);
    assert.equal(restored.fileCount, 1);
    assert.equal(await readFile(path.join(extracted, "01_core", "a.md"), "utf8"), "archive me");
    await rm(archive.tempRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(extracted, { recursive: true, force: true });
  }
});

test("rejects unsafe or unexpected archive entries before extraction", () => {
  validateArchiveEntries("01_core/\n01_core/a.md\n03_input/\n04_output/\nmanifest.json\n");
  assert.throws(() => validateArchiveEntries("01_core/a.md\n../../outside.txt\n"), /不安全或未授权路径/);
  assert.throws(() => validateArchiveEntries("01_core/a.md\nprivate.txt\n"), /不安全或未授权路径/);
});

test("annual retention selects the latest successful snapshot per year", () => {
  const records = [
    { id: "rec-old", values: { "Snapshot ID": "2025-W51", "Snapshot Year": "2025", "Created At": "2025-12-22 10:00:00", Status: "success" } },
    { id: "rec-latest", values: { "Snapshot ID": "2025-W52", "Snapshot Year": "2025", "Created At": "2025-12-29 10:00:00", Status: "success" } },
    { id: "rec-failed", values: { "Snapshot ID": "2026-W01", "Snapshot Year": "2026", "Created At": "2026-01-05 10:00:00", Status: "failed" } },
  ];
  assert.deepEqual([...selectAnnualRecordIds(records)].sort(), ["rec-latest"]);
});

test("retention class keeps recent and annual snapshots without duplication", () => {
  const now = Date.parse("2026-08-17T00:00:00+08:00");
  const annual = new Set(["rec-1"]);
  assert.equal(retentionClassFor({ id: "rec-1", values: { Status: "success", "Created At": "2026-08-01 10:00:00" } }, annual, now), "recent+annual");
  assert.equal(retentionClassFor({ id: "rec-2", values: { Status: "success", "Created At": "2026-07-01 10:00:00" } }, annual, now), "");
  assert.equal(retentionClassFor({ id: "rec-3", values: { Status: "failed", "Created At": "2026-08-01 10:00:00" } }, annual, now), "");
});

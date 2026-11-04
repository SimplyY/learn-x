import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { BACKUP_ROOTS, MAX_ARCHIVE_BYTES, assertArchiveSizeWithinLimit, canSkipSuccessfulSnapshot, collectBackupFiles, createArchive, createManifest, retentionClassFor, selectAnnualRecordIds, snapshotReadbackMismatches, validateArchiveEntries, validateArchiveFile, validateManifest } from "./backup-weekly.mjs";

test("scans all backup roots, ignores .DS_Store and credential-like files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-test-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
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

test("backup keeps the active Flomo snapshot and rollback bundle, excludes stale copies and images, and restores cleanly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-flomo-policy-"));
  const extracted = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-flomo-restore-"));
  let archive;
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
    const online = path.join(root, "04_output/_dist/flomo-review/online-full");
    const rollback = path.join(online, "backups", "active-rollback");
    await mkdir(path.join(online, "snapshots"), { recursive: true });
    await mkdir(path.join(online, "staged"), { recursive: true });
    await mkdir(rollback, { recursive: true });
    await mkdir(path.join(online, "backups", "obsolete-migration"), { recursive: true });
    await writeFile(path.join(root, "01_core", "kept.md"), "core");
    await writeFile(path.join(online, "storage-mode.json"), JSON.stringify({
      schemaVersion: 1,
      sourceMode: "flomo-online-full",
      activeSnapshotId: "active-1",
      activeSnapshotPath: "snapshots/active-1.json",
      activeCatalogPath: "snapshots/active-1.catalog.json",
      activeLedgerPath: "snapshots/active-1.ledger.json",
      backupPath: rollback,
    }));
    for (const file of ["active-1.json", "active-1.catalog.json", "active-1.ledger.json", "old-1.json", "old-1.catalog.json"]) {
      await writeFile(path.join(online, "snapshots", file), file);
    }
    await writeFile(path.join(online, "staged", "unactivated.json"), "staged");
    await writeFile(path.join(rollback, "legacy-catalog.json"), "rollback");
    await writeFile(path.join(online, "backups", "obsolete-migration", "old-catalog.json"), "old backup");
    await mkdir(path.join(online, "2026-11-01"), { recursive: true });
    await writeFile(path.join(online, "2026-11-01", "decision.json"), "review evidence");
    const imageExtensions = ["apng", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "avif", "heic", "heif", "ico", "svg"];
    for (const extension of imageExtensions) await writeFile(path.join(root, "04_output", `image.${extension}`), "image");

    const scanned = await collectBackupFiles(root);
    const paths = scanned.files.map((file) => file.path);
    assert.ok(paths.includes("04_output/_dist/flomo-review/online-full/snapshots/active-1.json"));
    assert.ok(paths.includes("04_output/_dist/flomo-review/online-full/snapshots/active-1.catalog.json"));
    assert.ok(paths.includes("04_output/_dist/flomo-review/online-full/snapshots/active-1.ledger.json"));
    assert.ok(paths.includes("04_output/_dist/flomo-review/online-full/backups/active-rollback/legacy-catalog.json"));
    assert.ok(paths.includes("04_output/_dist/flomo-review/online-full/2026-11-01/decision.json"));
    assert.ok(!paths.some((file) => file.includes("old-1") || file.includes("staged/") || file.includes("obsolete-migration")));
    assert.ok(!paths.some((file) => file.startsWith("04_output/image.")));
    assert.equal(scanned.excluded.filter((entry) => entry.reason === "image file (not backed up)").length, imageExtensions.length);

    const manifest = createManifest("2026-W44", scanned.files, scanned.excluded);
    archive = await createArchive(root, "2026-W44", manifest, scanned.files);
    await new Promise((resolve, reject) => execFile("tar", ["-xzf", archive.archivePath, "-C", extracted], (error) => error ? reject(error) : resolve()));
    const restored = await validateManifest(extracted, manifest.manifestSha256);
    assert.equal(restored.fileCount, scanned.files.length);
    assert.equal(await readFile(path.join(extracted, "04_output/_dist/flomo-review/online-full/snapshots/active-1.json"), "utf8"), "active-1.json");
  } finally {
    if (archive) await rm(archive.tempRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(extracted, { recursive: true, force: true });
  }
});

test("fails closed when Flomo active or rollback pointers escape or are missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-flomo-invalid-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
    const online = path.join(root, "04_output/_dist/flomo-review/online-full");
    const rollback = path.join(online, "backups", "rollback");
    await mkdir(rollback, { recursive: true });
    const statePath = path.join(online, "storage-mode.json");
    const baseState = {
      schemaVersion: 1,
      sourceMode: "flomo-online-full",
      activeSnapshotId: "active-2",
      activeSnapshotPath: "snapshots/active-2.json",
      activeCatalogPath: "snapshots/active-2.catalog.json",
      activeLedgerPath: "snapshots/active-2.ledger.json",
      backupPath: path.join(root, "outside-rollback"),
    };
    await writeFile(statePath, JSON.stringify(baseState));
    await assert.rejects(collectBackupFiles(root), /回滚快照路径越界/);

    await writeFile(statePath, JSON.stringify({ ...baseState, backupPath: rollback }));
    await assert.rejects(collectBackupFiles(root), /活动快照文件缺失/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when the online-full tree has no storage-mode pointer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-flomo-state-missing-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output/_dist/flomo-review/online-full", "05_library"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    await assert.rejects(collectBackupFiles(root), /Flomo 在线全量目录存在但 storage-mode\.json 缺失/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when active snapshot or rollback directory is reached through a symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-flomo-symlink-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
    const online = path.join(root, "04_output/_dist/flomo-review/online-full");
    const externalSnapshots = path.join(root, "external-snapshots");
    const rollback = path.join(online, "backups", "active-rollback");
    await mkdir(externalSnapshots, { recursive: true });
    await mkdir(rollback, { recursive: true });
    await writeFile(path.join(externalSnapshots, "active-3.json"), "snapshot");
    await writeFile(path.join(externalSnapshots, "active-3.catalog.json"), "catalog");
    await writeFile(path.join(externalSnapshots, "active-3.ledger.json"), "ledger");
    await writeFile(path.join(rollback, "rollback.json"), "rollback");
    const state = {
      schemaVersion: 1,
      sourceMode: "flomo-online-full",
      activeSnapshotId: "active-3",
      activeSnapshotPath: "snapshots/active-3.json",
      activeCatalogPath: "snapshots/active-3.catalog.json",
      activeLedgerPath: "snapshots/active-3.ledger.json",
      backupPath: rollback,
    };
    await writeFile(path.join(online, "storage-mode.json"), JSON.stringify(state));
    await symlink(externalSnapshots, path.join(online, "snapshots"), "dir");
    await assert.rejects(collectBackupFiles(root), /包含符号链接.*snapshots/);

    await rm(path.join(online, "snapshots"), { force: true });
    await mkdir(path.join(online, "snapshots"), { recursive: true });
    for (const [name, content] of [["active-3.json", "snapshot"], ["active-3.catalog.json", "catalog"], ["active-3.ledger.json", "ledger"]]) {
      await writeFile(path.join(online, "snapshots", name), content);
    }
    const externalBackups = path.join(root, "external-backups");
    await mkdir(path.join(externalBackups, "active-rollback"), { recursive: true });
    await writeFile(path.join(externalBackups, "active-rollback", "rollback.json"), "rollback");
    await rm(path.join(online, "backups"), { recursive: true, force: true });
    await symlink(externalBackups, path.join(online, "backups"), "dir");
    await writeFile(path.join(online, "storage-mode.json"), JSON.stringify({
      ...state,
      backupPath: path.join(online, "backups", "active-rollback"),
    }));
    await assert.rejects(collectBackupFiles(root), /包含符号链接.*backups/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces the 10 MB compressed archive boundary exactly", () => {
  assert.equal(assertArchiveSizeWithinLimit(MAX_ARCHIVE_BYTES).archiveBytes, MAX_ARCHIVE_BYTES);
  assert.throws(() => assertArchiveSizeWithinLimit(MAX_ARCHIVE_BYTES + 1, [{ path: "04_output/large.json", bytes: 99 }]), /backup-archive-over-10MB.*04_output\/large\.json=99B/);
  assert.throws(() => assertArchiveSizeWithinLimit(Number.NaN), /大小无效/);
});

test("manifest digest is stable when only creation time changes", () => {
  const files = [{ path: "01_core/a.md", bytes: 1, sha256: "a" }];
  const first = createManifest("2026-W34", files, [], "2026-08-17T00:00:00.000Z");
  const second = createManifest("2026-W34", files, [], "2026-08-18T00:00:00.000Z");
  assert.equal(first.manifestSha256, second.manifestSha256);
});

test("same-week successful backup skips only when current payload hashes match", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-fingerprint-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
    const target = path.join(root, "01_core/a.md");
    await writeFile(target, "a");
    const firstScan = await collectBackupFiles(root);
    const firstManifest = createManifest("2026-W34", firstScan.files, firstScan.excluded);
    const existing = { values: {
      Status: "success", "Snapshot ID": "2026-W34", "Drive File Token": "file-token",
      "Archive SHA-256": "archive-sha", "Archive Name": `learn-x-backup-2026-W34-${firstManifest.manifestSha256.slice(0, 8)}.tar.gz`,
      "File Count": firstManifest.fileCount, "Total Bytes": firstManifest.totalBytes,
      "Manifest SHA-256": firstManifest.manifestSha256,
    } };
    const unchangedScan = await collectBackupFiles(root);
    const unchangedManifest = createManifest("2026-W34", unchangedScan.files, unchangedScan.excluded);

    assert.equal(canSkipSuccessfulSnapshot(existing, unchangedManifest), true);
    assert.equal(canSkipSuccessfulSnapshot({ values: { ...existing.values, "Drive File Token": "" } }, unchangedManifest), false);
    assert.equal(canSkipSuccessfulSnapshot({ values: { ...existing.values, "File Count": 999 } }, unchangedManifest), false);

    await writeFile(target, "b");
    const changedScan = await collectBackupFiles(root);
    const changedManifest = createManifest("2026-W34", changedScan.files, changedScan.excluded);
    assert.equal(firstManifest.totalBytes, changedManifest.totalBytes, "same-size edits still change the payload fingerprint");
    assert.notEqual(firstManifest.manifestSha256, changedManifest.manifestSha256);
    assert.equal(canSkipSuccessfulSnapshot(existing, changedManifest), false);
    assert.equal(canSkipSuccessfulSnapshot({ values: { Status: "failed", "Manifest SHA-256": firstManifest.manifestSha256 } }, unchangedManifest), false);
    assert.equal(canSkipSuccessfulSnapshot(existing, unchangedManifest, true), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validates downloaded archive bytes, safe entries, and every manifest file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-archive-test-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output", "05_library"]) await mkdir(path.join(root, directory), { recursive: true });
    await mkdir(path.join(root, "05_library", "weread", "nonfiction"), { recursive: true });
    await writeFile(path.join(root, "01_core", "a.md"), "archive me");
    await writeFile(path.join(root, "05_library", "weread", "nonfiction", "2025.md"), "weread archive");
    const scanned = await collectBackupFiles(root);
    const manifest = createManifest("2026-W34", scanned.files, scanned.excluded);
    const archive = await createArchive(root, "2026-W34", manifest, scanned.files);
    const restored = await validateArchiveFile(archive.archivePath, archive.archiveBytes, archive.archiveSha256, manifest.manifestSha256);
    assert.equal(restored.fileCount, 2);
    assert.equal(restored.totalBytes, 24);
    await assert.rejects(validateArchiveFile(archive.archivePath, archive.archiveBytes + 1, archive.archiveSha256, manifest.manifestSha256), /字节数与上传结果不一致/);
    await assert.rejects(validateArchiveFile(archive.archivePath, archive.archiveBytes, "0".repeat(64), manifest.manifestSha256), /SHA-256 与上传结果不一致/);
    await rm(archive.tempRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compares every written Snapshot field with the Base readback", () => {
  const expected = {
    "Snapshot ID": "2026-W43-W44", Week: "2026-W43-W44", "Created At": "2026-11-02 17:43:49",
    "Archive Name": "learn-x-backup-2026-W43-W44-f463559f.tar.gz", "Drive File Token": "file-token",
    "Manifest SHA-256": "manifest-sha", "Archive SHA-256": "archive-sha", "File Count": 1131,
    "Total Bytes": 32591469, "Retention Class": "recent+annual", "Snapshot Year": 2026, Status: "success", Error: "",
  };
  const record = { values: {
    "Snapshot ID": "2026-W43-W44", Week: "2026-W43-W44", "Created At": "2026-11-02T17:43:49.000+08:00",
    "Archive Name": "learn-x-backup-2026-W43-W44-f463559f.tar.gz", "Drive File Token": "file-token",
    "Manifest SHA-256": "manifest-sha", "Archive SHA-256": "archive-sha", "File Count": "1131",
    "Total Bytes": "32591469", "Retention Class": "recent+annual", "Snapshot Year": "2026", Status: "success", Error: "",
  } };
  assert.deepEqual(snapshotReadbackMismatches(expected, record), []);
  assert.deepEqual(snapshotReadbackMismatches(expected, { values: { ...record.values, "Archive SHA-256": "wrong" } }), ["Archive SHA-256"]);
});

test("rejects a source changed after scan before creating an archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-race-"));
  try {
    for (const directory of BACKUP_ROOTS) await mkdir(path.join(root, directory), { recursive: true });
    const target = path.join(root, "01_core", "changed.md");
    await writeFile(target, "scanned version");
    const scanned = await collectBackupFiles(root);
    const manifest = createManifest("2026-W44", scanned.files, scanned.excluded);
    await writeFile(target, "changed after scan");
    await assert.rejects(createArchive(root, "2026-W44", manifest, scanned.files), /扫描后发生变化.*01_core\/changed\.md/);
    assert.equal((await readdir(root)).some((entry) => entry.startsWith(".learn-x-backup-")), false, "failed archive staging is cleaned up");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe or unexpected archive entries before extraction", () => {
  validateArchiveEntries("01_core/\n01_core/a.md\n03_input/\n04_output/\nmanifest.json\n");
  assert.throws(() => validateArchiveEntries("01_core/a.md\n../../outside.txt\n"), /不安全或未授权路径/);
  assert.throws(() => validateArchiveEntries("01_core/a.md\nprivate.txt\n"), /不安全或未授权路径/);
});

test("validates a legacy three-root manifest (BACKUP_ROOTS superset keeps old archives recoverable)", async () => {
  const extracted = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-legacy-"));
  try {
    for (const directory of ["01_core", "03_input", "04_output"]) await mkdir(path.join(extracted, directory), { recursive: true });
    await writeFile(path.join(extracted, "01_core", "legacy.md"), "legacy");
    const files = [{ path: "01_core/legacy.md", bytes: 6, sha256: createHash("sha256").update("legacy").digest("hex") }];
    const core = { snapshotId: "2026-W34", roots: ["01_core", "03_input", "04_output"], fileCount: 1, totalBytes: 6, files, excludedFiles: [] };
    const manifest = { ...core, createdAt: "2026-08-17T00:00:00.000Z", manifestSha256: createHash("sha256").update(JSON.stringify(core), "utf8").digest("hex") };
    await writeFile(path.join(extracted, "manifest.json"), JSON.stringify(manifest), "utf8");
    const validated = await validateManifest(extracted, manifest.manifestSha256);
    assert.equal(validated.fileCount, 1);
    assert.equal(await readFile(path.join(extracted, "01_core", "legacy.md"), "utf8"), "legacy");

    const unknownRoot = { ...core, roots: ["01_core", "99_unknown"] };
    await writeFile(path.join(extracted, "manifest.json"), JSON.stringify({ ...unknownRoot, createdAt: manifest.createdAt, manifestSha256: createHash("sha256").update(JSON.stringify(unknownRoot), "utf8").digest("hex") }), "utf8");
    await assert.rejects(validateManifest(extracted, ""), /manifest 备份根目录不匹配/);
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
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

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../../../..");
export const BACKUP_ROOTS = ["01_core", "03_input", "04_output"];
export const DRIVE_FOLDER_NAME = "Learn-X Backups";
export const BASE_NAME = "Learn-X Backup Index";
export const TABLE_NAME = "Snapshots";
export const EXCLUDED_FILE_REASONS = [
  { reason: "macOS metadata", test: (name) => name === ".DS_Store" },
  { reason: "credential-like filename", test: (name) => /(^|\.)env($|\.)|token|secret|credential|password|cookie|session|wallet/i.test(name) },
  { reason: "key or certificate filename", test: (name) => /\.(pem|p12|pfx|key|crt|cer)$/i.test(name) },
];
const REQUIRED_FIELDS = [
  "Snapshot ID", "Week", "Created At", "Archive Name", "Drive File Token",
  "Manifest SHA-256", "Archive SHA-256", "File Count", "Total Bytes",
  "Retention Class", "Snapshot Year", "Status", "Error", "Restored At",
];
const BASE_FIELD_SCHEMA = [
  { name: "Snapshot ID", type: "text" },
  { name: "Week", type: "text" },
  { name: "Created At", type: "datetime" },
  { name: "Archive Name", type: "text" },
  { name: "Drive File Token", type: "text" },
  { name: "Manifest SHA-256", type: "text" },
  { name: "Archive SHA-256", type: "text" },
  { name: "File Count", type: "number" },
  { name: "Total Bytes", type: "number" },
  { name: "Retention Class", type: "select", multiple: false, options: [{ name: "recent" }, { name: "annual" }, { name: "recent+annual" }] },
  { name: "Snapshot Year", type: "number" },
  { name: "Status", type: "select", multiple: false, options: [{ name: "success" }, { name: "failed" }, { name: "expired" }, { name: "delete_failed" }] },
  { name: "Error", type: "text" },
  { name: "Restored At", type: "datetime" },
];
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeWeek(value) {
  const match = /^(\d{4})-W?(\d{1,2})$/.exec(String(value || ""));
  if (!match) throw new Error(`无效周格式：${value}，应为 YYYY-Www。`);
  const week = Number(match[2]);
  if (week < 1 || week > 53) throw new Error(`无效 ISO 周：${value}。`);
  return `${match[1]}-W${String(week).padStart(2, "0")}`;
}

export function snapshotYear(snapshotId) {
  return Number(normalizeWeek(snapshotId).slice(0, 4));
}

export function formatFeishuDatetime(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date).replace("T", " ");
}

function shouldExclude(name) {
  return EXCLUDED_FILE_REASONS.find((entry) => entry.test(name));
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function walk(root, current = root, entries = [], excluded = []) {
  for (const child of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, child.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const exclusion = shouldExclude(child.name);
    if (exclusion) {
      excluded.push({ path: relative, reason: exclusion.reason });
      continue;
    }
    if (child.isDirectory()) {
      await walk(root, absolute, entries, excluded);
      continue;
    }
    if (!child.isFile()) {
      excluded.push({ path: relative, reason: "unsupported filesystem entry" });
      continue;
    }
    const fileStat = await stat(absolute);
    entries.push({ absolute, relative, bytes: fileStat.size, sha256: await hashFile(absolute) });
  }
  return { entries, excluded };
}

export async function collectBackupFiles(rootDirectory = repoRoot, roots = BACKUP_ROOTS) {
  const files = [];
  const excluded = [];
  for (const rootName of roots) {
    const root = path.join(rootDirectory, rootName);
    const rootStat = await lstat(root).catch(() => null);
    if (!rootStat?.isDirectory()) throw new Error(`备份目录不存在：${rootName}`);
    const result = await walk(root);
    files.push(...result.entries.map((entry) => ({ ...entry, path: `${rootName}/${entry.relative}` })));
    excluded.push(...result.excluded.map((entry) => ({ ...entry, path: `${rootName}/${entry.path}` })));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excluded };
}

export function createManifest(snapshotId, files, excluded, createdAt = new Date().toISOString()) {
  const core = {
    snapshotId: normalizeWeek(snapshotId), roots: [...BACKUP_ROOTS], fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files: files.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })),
    excludedFiles: excluded,
  };
  return { ...core, createdAt, manifestSha256: sha256Text(JSON.stringify(core)) };
}

export function parseDateValue(value) {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (!value) return Number.NaN;
  const text = String(value);
  const normalized = /Z$|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(" ", "T") + "+08:00";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function selectAnnualRecordIds(records) {
  const latestByYear = new Map();
  for (const record of records) {
    const values = record.values || {};
    if (String(values.Status || "") !== "success") continue;
    const year = Number(values["Snapshot Year"] || String(values["Snapshot ID"] || "").slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const candidate = { id: record.id, createdAt: parseDateValue(values["Created At"]), snapshotId: String(values["Snapshot ID"] || "") };
    const current = latestByYear.get(year);
    if (!current || candidate.createdAt > current.createdAt || (candidate.createdAt === current.createdAt && candidate.snapshotId > current.snapshotId)) latestByYear.set(year, candidate);
  }
  return new Set([...latestByYear.values()].map((entry) => entry.id));
}

export function retentionClassFor(record, annualIds, now = Date.now()) {
  const values = record.values || {};
  if (String(values.Status || "") !== "success") return "";
  const recent = Number.isFinite(parseDateValue(values["Created At"])) && parseDateValue(values["Created At"]) >= now - 31 * DAY_MS;
  const annual = annualIds.has(record.id);
  if (recent && annual) return "recent+annual";
  if (recent) return "recent";
  if (annual) return "annual";
  return "";
}

async function copySelectedFiles(rootDirectory, stageDirectory, files) {
  for (const file of files) {
    const source = path.join(rootDirectory, file.path.split("/").join(path.sep));
    const target = path.join(stageDirectory, file.path.split("/").join(path.sep));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

export async function createArchive(rootDirectory, week, manifest, files) {
  const tempRoot = await mkdtemp(path.join(rootDirectory, ".learn-x-backup-"));
  const stage = path.join(tempRoot, "stage");
  await mkdir(stage, { recursive: true });
  for (const root of BACKUP_ROOTS) await mkdir(path.join(stage, root), { recursive: true });
  await copySelectedFiles(rootDirectory, stage, files);
  await writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const archiveName = `learn-x-backup-${week}-${manifest.manifestSha256.slice(0, 8)}.tar.gz`;
  const archivePath = path.join(tempRoot, archiveName);
  await execFileAsync("tar", ["-czf", archivePath, "-C", stage, ...BACKUP_ROOTS, "manifest.json"], { cwd: repoRoot });
  return { tempRoot, archivePath, archiveName, archiveSha256: await hashFile(archivePath) };
}

function envOrArg(value, name) {
  return value || process.env[name] || "";
}

function parseArgs(argv) {
  const result = { command: argv[0] === "restore" ? "restore" : "backup" };
  const args = argv[0] === "restore" || argv[0] === "backup" ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`无法识别参数：${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === "help") result.help = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`参数缺少值：${arg}`);
      result[key] = value;
    }
  }
  return result;
}

function configFromArgs(args, { requireFolder = false } = {}) {
  const config = {
    folderToken: envOrArg(args.folderToken, "LEARN_X_BACKUP_DRIVE_FOLDER_TOKEN"),
    baseToken: envOrArg(args.baseToken, "LEARN_X_BACKUP_BASE_TOKEN"),
    tableId: envOrArg(args.tableId, "LEARN_X_BACKUP_TABLE_ID"),
  };
  config.requireFolder = requireFolder;
  return config;
}

async function runLarkCli(args) {
  const fullArgs = [...args, "--as", "user", "--format", "json"];
  try {
    const { stdout } = await execFileAsync("lark-cli", fullArgs, {
      cwd: repoRoot,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.ok !== true) throw new Error(result.error?.message || "lark-cli 返回失败");
    return result;
  } catch (error) {
    const output = `${error.stderr || ""}\n${error.stdout || ""}`.trim();
    const jsonLine = output.split("\n").find((line) => line.trim().startsWith("{"));
    if (jsonLine) {
      try {
        const parsed = JSON.parse(jsonLine);
        throw new Error(parsed.error?.message || parsed.message || error.message);
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) throw parseError;
      }
    }
    throw error;
  }
}

function cellText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(",");
  if (typeof value === "object") {
    if (value.text != null) return String(value.text);
    if (value.name != null) return String(value.name);
    if (value.value != null) return cellText(value.value);
    if (value.timestamp != null) return String(value.timestamp);
    const values = Object.values(value);
    if (values.length) return values.map(cellText).filter(Boolean).join(",");
  }
  return String(value);
}

function recordsFromData(data, requestedFields) {
  const rows = data.data || data.records || data.items || [];
  const ids = data.record_id_list || [];
  return rows.map((row, index) => {
    if (Array.isArray(row)) {
      const fields = data.fields || requestedFields;
      return { id: ids[index], values: Object.fromEntries(fields.map((field, fieldIndex) => [field, cellText(row[fieldIndex])])) };
    }
    const values = row.fields || row.values || row;
    return { id: row.record_id || row.id || ids[index], values: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, cellText(value)])) };
  }).filter((record) => record.id);
}

async function listSnapshotRecords(config) {
  const records = [];
  const fields = REQUIRED_FIELDS;
  let offset = 0;
  while (true) {
    const result = await runLarkCli(["base", "+record-list", "--base-token", config.baseToken, "--table-id", config.tableId, ...fields.flatMap((field) => ["--field-id", field]), "--offset", String(offset), "--limit", "200"]);
    const data = result.data || {};
    const page = recordsFromData(data, fields);
    records.push(...page);
    if (!data.has_more) return records;
    if (!page.length) throw new Error("Base 分页声明 has_more，但没有返回新记录。");
    offset += page.length;
  }
}

async function loadBaseFields(config) {
  const result = await runLarkCli(["base", "+field-list", "--base-token", config.baseToken, "--table-id", config.tableId, "--limit", "200"]);
  const names = new Set((result.data?.fields || []).map((field) => field.name));
  const missing = REQUIRED_FIELDS.filter((field) => !names.has(field));
  if (missing.length) throw new Error(`备份 Base 字段缺失：${missing.join("、")}`);
}

function exactSnapshot(records, snapshotId) {
  return records.find((record) => String(record.values?.["Snapshot ID"] || "") === snapshotId);
}

async function upsertSnapshot(config, fields, recordId) {
  const args = ["base", "+record-upsert", "--base-token", config.baseToken, "--table-id", config.tableId, "--json", JSON.stringify(fields)];
  if (recordId) args.push("--record-id", recordId);
  await runLarkCli(args);
  const snapshotId = String(fields["Snapshot ID"] || "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = exactSnapshot(await listSnapshotRecords(config), snapshotId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`Base 写入后未读回 Snapshot ID：${snapshotId}`);
}

function extractToken(data) {
  return [data?.folder_token, data?.file_token, data?.token, data?.obj_token, data?.file?.token, data?.file?.file_token, data?.data?.folder_token, data?.data?.file_token, data?.data?.token, data?.data?.obj_token].find((value) => typeof value === "string" && value) || "";
}

function driveItems(result) {
  const data = result.data || {};
  if (Array.isArray(data.results)) {
    return data.results.map((item) => ({
      ...item,
      name: stripSearchHighlight(item.title_highlighted || ""),
      title: stripSearchHighlight(item.title_highlighted || ""),
      token: item.result_meta?.token || "",
      type: item.result_meta?.doc_types || item.entity_type || "",
    }));
  }
  return data.items || data.files || data.data || [];
}

function stripSearchHighlight(value) {
  return String(value).replace(/<h>/g, "").replace(/<\/h>/g, "");
}

async function findDriveFileByName(folderToken, name) {
  const result = await runLarkCli(["drive", "+search", "--query", name.slice(0, 30), "--doc-types", "file", "--folder-tokens", folderToken, "--page-size", "20"]);
  const item = driveItems(result).find((candidate) => (candidate.name || candidate.title) === name);
  return item?.token || item?.file_token || item?.obj_token || "";
}

function exactDriveItem(result, name) {
  const matches = driveItems(result).filter((candidate) => (candidate.name || candidate.title) === name);
  if (matches.length > 1) throw new Error(`飞书云盘存在多个同名资源，拒绝猜选：${name}`);
  return matches[0];
}

async function resolveOrCreateFolder(config) {
  if (config.folderToken) return config.folderToken;
  const found = exactDriveItem(await runLarkCli(["drive", "+search", "--query", DRIVE_FOLDER_NAME, "--doc-types", "folder", "--only-title"]), DRIVE_FOLDER_NAME);
  if (found) {
    const token = extractToken(found);
    if (!token) throw new Error(`找到备份文件夹但缺少 token：${DRIVE_FOLDER_NAME}`);
    return token;
  }
  const created = await runLarkCli(["drive", "+create-folder", "--name", DRIVE_FOLDER_NAME]);
  const token = extractToken(created);
  if (!token) throw new Error("飞书云盘创建备份文件夹后未返回 token。");
  return token;
}

function baseItems(result) {
  const data = result.data || {};
  return data.items || data.bases || data.data || [];
}

function baseTokenFromItem(item) {
  return item?.base_token || item?.token || item?.obj_token || item?.file_token || "";
}

async function resolveOrCreateBase(config, folderToken) {
  if (config.baseToken) return config.baseToken;
  const found = exactDriveItem(await runLarkCli(["drive", "+search", "--query", BASE_NAME, "--doc-types", "bitable", "--only-title"]), BASE_NAME);
  if (found) {
    const token = baseTokenFromItem(found);
    if (!token) throw new Error(`找到备份 Base 但缺少 token：${BASE_NAME}`);
    return token;
  }
  const created = await runLarkCli([
    "base", "+base-create", "--name", BASE_NAME, "--folder-token", folderToken,
    "--table-name", TABLE_NAME, "--time-zone", "Asia/Shanghai", "--fields", JSON.stringify(BASE_FIELD_SCHEMA),
  ]);
  const token = baseTokenFromItem(created.data || created);
  if (!token) throw new Error("飞书 Base 创建成功响应中未找到 base token。");
  return token;
}

function tableItems(result) {
  const data = result.data || {};
  return data.tables || data.items || data.data || [];
}

function tableIdFromItem(item) {
  return item?.table_id || item?.tableId || item?.id || "";
}

async function resolveOrCreateTable(config) {
  if (config.tableId) return config.tableId;
  const listed = await runLarkCli(["base", "+table-list", "--base-token", config.baseToken, "--limit", "100"]);
  const matches = tableItems(listed).filter((table) => table.name === TABLE_NAME);
  if (matches.length > 1) throw new Error(`备份 Base 存在多个同名表，拒绝猜选：${TABLE_NAME}`);
  if (matches.length === 1) return tableIdFromItem(matches[0]);
  const created = await runLarkCli(["base", "+table-create", "--base-token", config.baseToken, "--name", TABLE_NAME, "--fields", JSON.stringify(BASE_FIELD_SCHEMA)]);
  const table = tableItems(created)[0] || created.data?.table || created.data;
  const tableId = tableIdFromItem(table) || created.data?.table_id || created.data?.tableId;
  if (!tableId) throw new Error("Snapshots 表创建成功响应中未找到 table id。");
  return tableId;
}

async function ensureResources(config) {
  config.folderToken = await resolveOrCreateFolder(config);
  config.baseToken = await resolveOrCreateBase(config, config.folderToken);
  config.tableId = await resolveOrCreateTable(config);
  return config;
}

async function uploadArchive(config, archivePath, archiveName, existingToken = "") {
  const args = ["drive", "+upload", "--file", path.relative(repoRoot, archivePath), "--name", archiveName];
  if (existingToken) args.push("--file-token", existingToken);
  else args.push("--folder-token", config.folderToken);
  const token = extractToken(await runLarkCli(args));
  if (!token) throw new Error("飞书云盘上传响应中缺少 file token。");
  return token;
}

async function deleteDriveFile(fileToken) {
  await runLarkCli(["drive", "+delete", "--file-token", fileToken, "--type", "file", "--yes"]);
}

async function deleteBaseRecord(config, recordId) {
  await runLarkCli(["base", "+record-delete", "--base-token", config.baseToken, "--table-id", config.tableId, "--record-id", recordId, "--yes"]);
}

async function updateRecordStatus(config, record, status, errorMessage) {
  await upsertSnapshot(config, { "Snapshot ID": record.values["Snapshot ID"], Status: status, Error: errorMessage || "" }, record.id);
}

async function pruneRetention(config, now = Date.now()) {
  let records = await listSnapshotRecords(config);
  const annualIds = selectAnnualRecordIds(records);
  const deletable = [];
  for (const record of records) {
    const values = record.values || {};
    if (String(values.Status || "") !== "success") continue;
    const nextClass = retentionClassFor(record, annualIds, now);
    if (nextClass !== String(values["Retention Class"] || "")) await upsertSnapshot(config, { "Snapshot ID": values["Snapshot ID"], "Retention Class": nextClass }, record.id);
    const createdAt = parseDateValue(values["Created At"]);
    if (!(Number.isFinite(createdAt) && createdAt >= now - 31 * DAY_MS) && !annualIds.has(record.id)) deletable.push(record);
  }
  const deleted = [];
  const failed = [];
  for (const record of deletable) {
    const snapshotId = String(record.values?.["Snapshot ID"] || "");
    try {
      const fileToken = String(record.values?.["Drive File Token"] || "");
      if (!fileToken) throw new Error("缺少 Drive File Token");
      await deleteDriveFile(fileToken);
      await deleteBaseRecord(config, record.id);
      deleted.push(snapshotId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ snapshotId, error: message });
      try { await updateRecordStatus(config, record, "delete_failed", message); } catch { /* preserve original failure */ }
    }
  }
  records = await listSnapshotRecords(config);
  return { deleted, failed, retained: records.filter((record) => String(record.values?.Status || "") === "success").map((record) => String(record.values?.["Snapshot ID"] || "")) };
}

async function runRetention(config) {
  try {
    const result = await pruneRetention(config);
    return { status: result.failed.length ? "failed" : "success", ...result };
  } catch (error) {
    return { status: "failed", deleted: [], failed: [{ error: error instanceof Error ? error.message : String(error) }], retained: [] };
  }
}

async function backup(args) {
  const week = normalizeWeek(args.week);
  const config = await ensureResources(configFromArgs(args, { requireFolder: true }));
  await loadBaseFields(config);
  const existing = exactSnapshot(await listSnapshotRecords(config), week);
  if (existing && String(existing.values?.Status || "") === "success") {
    return { snapshotId: week, status: "already-success", fileCount: Number(existing.values?.["File Count"] || 0), totalBytes: Number(existing.values?.["Total Bytes"] || 0), retention: await runRetention(config) };
  }
  const { files, excluded } = await collectBackupFiles(repoRoot);
  const manifest = createManifest(week, files, excluded);
  const archive = await createArchive(repoRoot, week, manifest, files);
  try {
    const existingToken = String(existing?.values?.["Drive File Token"] || "") || await findDriveFileByName(config.folderToken, archive.archiveName);
    const driveFileToken = await uploadArchive(config, archive.archivePath, archive.archiveName, existingToken);
    const values = {
      "Snapshot ID": week, Week: week, "Created At": formatFeishuDatetime(), "Archive Name": archive.archiveName,
      "Drive File Token": driveFileToken, "Manifest SHA-256": manifest.manifestSha256, "Archive SHA-256": archive.archiveSha256,
      "File Count": manifest.fileCount, "Total Bytes": manifest.totalBytes, "Retention Class": "recent+annual",
      "Snapshot Year": snapshotYear(week), Status: "success", Error: "",
    };
    await upsertSnapshot(config, values, existing?.id);
    return { snapshotId: week, status: "success", fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, manifestSha256: manifest.manifestSha256, archiveSha256: archive.archiveSha256, excludedCount: excluded.length, retention: await runRetention(config) };
  } catch (error) {
    if (existing) {
      try { await updateRecordStatus(config, existing, "failed", error instanceof Error ? error.message : String(error)); } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    await rm(archive.tempRoot, { recursive: true, force: true });
  }
}

export async function validateManifest(extractedRoot, expectedManifestSha256) {
  const manifest = JSON.parse(await readFile(path.join(extractedRoot, "manifest.json"), "utf8"));
  const { createdAt, manifestSha256, ...core } = manifest;
  if (JSON.stringify(manifest.roots) !== JSON.stringify(BACKUP_ROOTS)) throw new Error("manifest 备份根目录不匹配。");
  if (manifestSha256 !== sha256Text(JSON.stringify(core)) || (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256)) throw new Error("manifest SHA-256 校验失败。");
  const files = await collectBackupFiles(extractedRoot, BACKUP_ROOTS);
  if (files.excluded.length) throw new Error(`恢复目录包含不允许的文件系统项：${files.excluded[0].path}`);
  if (files.files.length !== manifest.fileCount || files.files.reduce((sum, file) => sum + file.bytes, 0) !== manifest.totalBytes) throw new Error("恢复文件数量或总大小与 manifest 不一致。");
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of files.files) {
    const entry = expected.get(file.path);
    if (!entry || entry.bytes !== file.bytes || entry.sha256 !== file.sha256) throw new Error(`恢复文件校验失败：${file.path}`);
  }
  return manifest;
}

export function validateArchiveEntries(listing) {
  const allowedRoots = new Set([...BACKUP_ROOTS, "manifest.json"]);
  for (const rawEntry of String(listing).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const entry = rawEntry.replace(/\/$/, "");
    const parts = entry.split("/");
    if (path.posix.isAbsolute(entry) || parts.includes("..") || !allowedRoots.has(parts[0])) throw new Error(`压缩包包含不安全或未授权路径：${rawEntry}`);
  }
}

async function restore(args) {
  const week = normalizeWeek(args.week);
  if (!args.target) throw new Error("恢复必须提供 --target，默认不覆盖现有工作区。");
  const config = configFromArgs(args);
  if (!config.folderToken && !config.baseToken && !config.tableId) {
    config.baseToken = await resolveOrCreateBase(config, await resolveOrCreateFolder(config));
  }
  config.tableId = await resolveOrCreateTable(config);
  await loadBaseFields(config);
  const records = await listSnapshotRecords(config);
  const candidates = records.filter((record) => String(record.values?.["Snapshot ID"] || "") === week && String(record.values?.Status || "") === "success");
  candidates.sort((a, b) => parseDateValue(b.values["Created At"]) - parseDateValue(a.values["Created At"]));
  const record = candidates[0];
  if (!record) throw new Error(`Base 中找不到可恢复的成功快照：${week}`);
  const target = path.resolve(repoRoot, args.target);
  const targetInfo = await lstat(target).catch(() => null);
  if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isDirectory())) throw new Error(`恢复目标不是普通目录，拒绝写入：${target}`);
  if (targetInfo && (await readdir(target)).length) throw new Error(`恢复目标目录非空，拒绝覆盖：${target}`);
  const tempRoot = await mkdtemp(path.join(repoRoot, ".learn-x-restore-"));
  const archivePath = path.join(tempRoot, String(record.values["Archive Name"] || "backup.tar.gz"));
  const extractedRoot = path.join(tempRoot, "extracted");
  await mkdir(extractedRoot, { recursive: true });
  try {
    await runLarkCli(["drive", "+download", "--file-token", String(record.values["Drive File Token"]), "--output", path.relative(repoRoot, archivePath), "--overwrite"]);
    if (await hashFile(archivePath) !== String(record.values["Archive SHA-256"] || "")) throw new Error("压缩包 SHA-256 校验失败，拒绝恢复。");
    const listing = await execFileAsync("tar", ["-tzf", archivePath], { cwd: repoRoot });
    validateArchiveEntries(listing.stdout);
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractedRoot], { cwd: repoRoot });
    const manifest = await validateManifest(extractedRoot, String(record.values["Manifest SHA-256"] || ""));
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(extractedRoot)) await rename(path.join(extractedRoot, entry), path.join(target, entry));
    await upsertSnapshot(config, { "Snapshot ID": week, "Restored At": formatFeishuDatetime() }, record.id);
    return { snapshotId: week, status: "restored", target, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`用法：\n  npm run backup:weekly -- --week YYYY-Www\n  npm run restore:weekly -- --week YYYY-Www --target /path/to/new-directory\n\n默认行为：\n  自动查找或创建 Learn-X Backups、Learn-X Backup Index 和 Snapshots。\n\n可选 token 覆盖：\n  LEARN_X_BACKUP_DRIVE_FOLDER_TOKEN\n  LEARN_X_BACKUP_BASE_TOKEN\n  LEARN_X_BACKUP_TABLE_ID`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) printHelp();
  else (args.command === "restore" ? restore(args) : backup(args))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.retention?.status === "failed") process.exitCode = 2;
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    });
}

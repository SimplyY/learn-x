import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../../../..");
export const BACKUP_ROOTS = ["01_core", "03_input", "04_output", "05_library"];
export const DRIVE_FOLDER_NAME = "Learn-X Backups";
export const BASE_NAME = "Learn-X Backup Index";
export const TABLE_NAME = "Snapshots";
export const MAX_ARCHIVE_BYTES = 10_000_000;
const FLOMO_ONLINE_ROOT = "04_output/_dist/flomo-review/online-full";
export const EXCLUDED_FILE_REASONS = [
  { reason: "macOS metadata", test: (name) => name === ".DS_Store" },
  { reason: "credential-like filename", test: (name) => /(^|\.)env($|\.)|token|secret|credential|password|cookie|session|wallet/i.test(name) },
  { reason: "key or certificate filename", test: (name) => /\.(pem|p12|pfx|key|crt|cer)$/i.test(name) },
  { reason: "image file (not backed up)", test: (name) => /\.(apng|png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif|ico|svg)$/i.test(name) },
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

export function normalizePeriod(value) {
  const input = String(value || "");
  const range = /^(\d{4})-W(\d{2})-(?:(\d{4})-)?W(\d{2})$/.exec(input);
  const weeks = range
    ? [`${range[1]}-W${range[2]}`, `${range[3] || range[1]}-W${range[4]}`]
    : [normalizeWeek(input)];
  const periodId = range ? input : weeks[0];
  const parsed = weeks.map(parseIsoWeek);
  const start = parsed[0];
  const end = parsed.at(-1);
  const count = weekDistance(start, end) + 1;
  if (count < 1 || count > 4) throw new Error(`周期范围必须包含 1–4 个连续 ISO 周：${input}`);
  const expanded = Array.from({ length: count }, (_, index) => isoWeekId(addDays(start.monday, index * 7)));
  if (expanded.at(-1) !== weeks.at(-1) || periodId !== formatPeriod(expanded)) {
    throw new Error(`无效或不连续的 ISO 周范围：${input}`);
  }
  return periodId;
}

function parseIsoWeek(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) throw new Error(`无效 ISO 周：${value}。`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - weekday + 1 + (week - 1) * 7);
  if (isoWeekId(monday) !== value) throw new Error(`无效 ISO 周：${value}。`);
  return { year, week, monday };
}

function isoWeekId(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil((((thursday - Date.UTC(year, 0, 1)) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function weekDistance(start, end) {
  return Math.round((end.monday - start.monday) / 604_800_000);
}

function formatPeriod(weeks) {
  if (weeks.length === 1) return weeks[0];
  const first = weeks[0];
  const last = weeks.at(-1);
  return first.slice(0, 4) === last.slice(0, 4) ? `${first}-${last.slice(5)}` : `${first}-${last}`;
}

export function snapshotYear(snapshotId) {
  const periodId = normalizePeriod(snapshotId);
  const range = /^(\d{4})-W\d{2}-(?:(\d{4})-)?W(\d{2})$/.exec(periodId);
  const endWeek = range ? `${range[2] || range[1]}-W${range[3]}` : periodId;
  return parseIsoWeek(endWeek).year;
}

export function formatFeishuDatetime(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date).replace("T", " ");
}

function shouldExclude(name, { excludeImages = true } = {}) {
  return EXCLUDED_FILE_REASONS.find((entry) =>
    (excludeImages || entry.reason !== "image file (not backed up)") && entry.test(name));
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function lstatWithinRoot(rootDirectory, relativePath) {
  const parts = String(relativePath).split(/[\\/]+/).filter(Boolean);
  if (!parts.length || path.isAbsolute(relativePath) || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`备份路径无效：${relativePath}`);
  }
  let current = rootDirectory;
  const rootInfo = await lstat(rootDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("备份工作区根目录不是普通目录。");
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return null;
    if (info.isSymbolicLink()) throw new Error(`Flomo 备份必要路径包含符号链接：${path.relative(rootDirectory, current)}`);
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw new Error(`Flomo 备份必要路径不是普通目录：${path.relative(rootDirectory, current)}`);
    }
  }
  return await lstat(current);
}

async function flomoBackupPolicy(rootDirectory) {
  const onlineRoot = path.join(rootDirectory, FLOMO_ONLINE_ROOT);
  const onlineRootStat = await lstatWithinRoot(rootDirectory, FLOMO_ONLINE_ROOT);
  if (!onlineRootStat) return null;
  if (!onlineRootStat.isDirectory()) throw new Error("Flomo 在线全量目录不是普通目录，拒绝生成不完整备份。");
  const statePath = path.join(onlineRoot, "storage-mode.json");
  const stateStat = await lstatWithinRoot(rootDirectory, `${FLOMO_ONLINE_ROOT}/storage-mode.json`);
  if (!stateStat) throw new Error("Flomo 在线全量目录存在但 storage-mode.json 缺失，拒绝生成不完整备份。");
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) throw new Error("Flomo storage-mode.json 不是普通文件，拒绝生成不完整备份。");

  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch { throw new Error("Flomo storage-mode.json 无法解析，拒绝生成不完整备份。"); }
  const snapshotId = String(state.activeSnapshotId || "");
  if (state.schemaVersion !== 1 || state.sourceMode !== "flomo-online-full" || !/^[A-Za-z0-9_-]+$/.test(snapshotId)) {
    throw new Error("Flomo 活动快照状态无效，拒绝生成不完整备份。");
  }

  const activeSnapshotPath = state.activeSnapshotPath;
  const activeCatalogPath = state.activeCatalogPath || "catalog.json";
  const activeLedgerPath = state.activeLedgerPath || "ledger.json";
  if (activeSnapshotPath !== `snapshots/${snapshotId}.json` ||
      !["catalog.json", `snapshots/${snapshotId}.catalog.json`].includes(activeCatalogPath) ||
      !["ledger.json", `snapshots/${snapshotId}.ledger.json`].includes(activeLedgerPath)) {
    throw new Error("Flomo 活动快照路径无效，拒绝生成不完整备份。");
  }

  const backupPath = state.backupPath;
  if (typeof backupPath !== "string" || !path.isAbsolute(backupPath)) throw new Error("Flomo 回滚快照路径无效，拒绝生成不完整备份。");
  const backupsRoot = path.resolve(onlineRoot, "backups");
  const backupAbsolutePath = path.resolve(backupPath);
  const backupRelativePath = path.relative(backupsRoot, backupAbsolutePath);
  if (!backupRelativePath || backupRelativePath === ".." || backupRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(backupRelativePath)) {
    throw new Error("Flomo 回滚快照路径越界，拒绝生成不完整备份。");
  }
  const backupRelativeFromRoot = path.relative(rootDirectory, backupAbsolutePath);
  const backupStat = await lstatWithinRoot(rootDirectory, backupRelativeFromRoot);
  if (!backupStat?.isDirectory() || backupStat.isSymbolicLink()) throw new Error("Flomo 当前回滚快照目录缺失或不是普通目录，拒绝生成不完整备份。");

  const keep = new Set(["storage-mode.json", activeSnapshotPath, activeCatalogPath, activeLedgerPath]);
  for (const relative of keep) {
    const info = await lstatWithinRoot(rootDirectory, `${FLOMO_ONLINE_ROOT}/${relative}`);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Flomo 活动快照文件缺失或不是普通文件：${relative}`);
  }
  return { keep, rollbackPrefix: path.relative(onlineRoot, backupAbsolutePath).split(path.sep).join("/") };
}

function flomoPathExclusion(filePath, policy) {
  const prefix = `${FLOMO_ONLINE_ROOT}/`;
  if (!policy || !filePath.startsWith(prefix)) return null;
  const relative = filePath.slice(prefix.length);
  if (policy.keep.has(relative) || relative.startsWith(`${policy.rollbackPrefix}/`)) return null;
  if (relative.startsWith("snapshots/")) return "historical Flomo snapshots (active snapshot retained)";
  if (relative.startsWith("staged/")) return "unactivated Flomo staging snapshot";
  if (relative.startsWith("backups/")) return "superseded Flomo migration backup (active rollback retained)";
  return null;
}

export function assertArchiveSizeWithinLimit(archiveBytes, files = []) {
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes < 0) throw new Error("备份压缩包大小无效，拒绝上传。");
  if (archiveBytes <= MAX_ARCHIVE_BYTES) return { archiveBytes, limitBytes: MAX_ARCHIVE_BYTES };
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
    .map((file) => `${file.path}=${file.bytes}B`).join(", ");
  throw new Error(`backup-archive-over-10MB: ${archiveBytes}B > ${MAX_ARCHIVE_BYTES}B; largest files: ${largest || "none"}`);
}

async function walk(root, current = root, entries = [], excluded = [], options = {}) {
  for (const child of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, child.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const exclusion = shouldExclude(child.name, options);
    if (exclusion) {
      excluded.push({ path: relative, reason: exclusion.reason });
      continue;
    }
    if (child.isDirectory()) {
      await walk(root, absolute, entries, excluded, options);
      continue;
    }
    if (!child.isFile()) {
      excluded.push({ path: relative, reason: "unsupported filesystem entry" });
      continue;
    }
    const pathExclusion = options.pathExclusion?.(relative);
    if (pathExclusion) {
      excluded.push({ path: relative, reason: pathExclusion });
      continue;
    }
    const fileStat = await stat(absolute);
    entries.push({ absolute, relative, bytes: fileStat.size, sha256: await hashFile(absolute) });
  }
  return { entries, excluded };
}

export async function collectBackupFiles(rootDirectory = repoRoot, roots = BACKUP_ROOTS, options = {}) {
  const files = [];
  const excluded = [];
  const flomoPolicy = options.excludeHistoricalFlomo === false || !roots.includes("04_output")
    ? null
    : await flomoBackupPolicy(rootDirectory);
  for (const rootName of roots) {
    const root = path.join(rootDirectory, rootName);
    const rootStat = await lstat(root).catch(() => null);
    if (!rootStat?.isDirectory()) throw new Error(`备份目录不存在：${rootName}`);
    const result = await walk(root, root, [], [], {
      ...options,
      pathExclusion: (relative) => options.pathExclusion?.(`${rootName}/${relative}`) || flomoPathExclusion(`${rootName}/${relative}`, flomoPolicy),
    });
    files.push(...result.entries.map((entry) => ({ ...entry, path: `${rootName}/${entry.relative}` })));
    excluded.push(...result.excluded.map((entry) => ({ ...entry, path: `${rootName}/${entry.path}` })));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  if (flomoPolicy) {
    const included = new Set(files.map((file) => file.path));
    for (const relative of flomoPolicy.keep) {
      const requiredPath = `${FLOMO_ONLINE_ROOT}/${relative}`;
      if (!included.has(requiredPath)) throw new Error(`Flomo 活动文件未进入备份清单：${requiredPath}`);
    }
    const rollbackPath = `${FLOMO_ONLINE_ROOT}/${flomoPolicy.rollbackPrefix}/`;
    if (!files.some((file) => file.path.startsWith(rollbackPath))) throw new Error("Flomo 当前回滚包没有可备份文件，拒绝生成不完整备份。");
  }
  return { files, excluded };
}

export function createManifest(snapshotId, files, excluded, createdAt = new Date().toISOString()) {
  const core = {
    snapshotId: normalizePeriod(snapshotId), roots: [...BACKUP_ROOTS], fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files: files.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })),
    excludedFiles: excluded,
  };
  return { ...core, createdAt, manifestSha256: sha256Text(JSON.stringify(core)) };
}

export function canSkipSuccessfulSnapshot(existing, currentManifest, refresh = false) {
  const values = existing?.values || {};
  const archiveName = currentManifest?.snapshotId && currentManifest?.manifestSha256
    ? `learn-x-backup-${currentManifest.snapshotId}-${currentManifest.manifestSha256.slice(0, 8)}.tar.gz`
    : "";
  return !refresh
    && String(values.Status || "") === "success"
    && Boolean(values["Drive File Token"])
    && Boolean(values["Archive SHA-256"])
    && values["Archive Name"] === archiveName
    && Number(values["File Count"]) === Number(currentManifest?.fileCount)
    && Number(values["Total Bytes"]) === Number(currentManifest?.totalBytes)
    && values["Manifest SHA-256"] === currentManifest?.manifestSha256;
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

async function assertStagedFilesMatchManifest(stageDirectory, expectedFiles) {
  const actual = await collectBackupFiles(stageDirectory, BACKUP_ROOTS, { excludeImages: false, excludeHistoricalFlomo: false });
  if (actual.excluded.length) throw new Error(`备份暂存目录包含意外文件系统项：${actual.excluded[0].path}`);
  const expectedByPath = new Map(expectedFiles.map((file) => [file.path, file]));
  if (actual.files.length !== expectedByPath.size) throw new Error("备份暂存文件数量与 manifest 不一致，拒绝上传。");
  for (const file of actual.files) {
    const expected = expectedByPath.get(file.path);
    if (!expected || expected.bytes !== file.bytes || expected.sha256 !== file.sha256) {
      throw new Error(`备份源在扫描后发生变化，暂存文件与 manifest 不一致：${file.path}`);
    }
  }
}

export async function createArchive(rootDirectory, periodId, manifest, files) {
  const tempRoot = await mkdtemp(path.join(rootDirectory, ".learn-x-backup-"));
  try {
    const stage = path.join(tempRoot, "stage");
    await mkdir(stage, { recursive: true });
    for (const root of BACKUP_ROOTS) await mkdir(path.join(stage, root), { recursive: true });
    await copySelectedFiles(rootDirectory, stage, files);
    await assertStagedFilesMatchManifest(stage, files);
    await writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const archiveName = `learn-x-backup-${periodId}-${manifest.manifestSha256.slice(0, 8)}.tar.gz`;
    const archivePath = path.join(tempRoot, archiveName);
    await execFileAsync("tar", ["-czf", archivePath, "-C", stage, ...BACKUP_ROOTS, "manifest.json"], { cwd: repoRoot });
    const archiveBytes = (await stat(archivePath)).size;
    return { tempRoot, archivePath, archiveName, archiveBytes, archiveSha256: await hashFile(archivePath) };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
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
    if (key === "help" || key === "refresh") result[key] = true;
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
  let lastMismatches = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = exactSnapshot(await listSnapshotRecords(config), snapshotId);
    if (found) {
      lastMismatches = snapshotReadbackMismatches(fields, found);
      if (!lastMismatches.length) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (lastMismatches.length) throw new Error(`Base 写入后 Snapshot 字段读回不一致：${lastMismatches.join("、")}`);
  throw new Error(`Base 写入后未读回 Snapshot ID：${snapshotId}`);
}

export function snapshotReadbackMismatches(expectedFields, record) {
  const actual = record?.values || {};
  return Object.entries(expectedFields).filter(([field, expected]) => {
    if (field === "Created At") {
      const expectedTime = parseDateValue(expected);
      const actualTime = parseDateValue(actual[field]);
      return !Number.isFinite(expectedTime) || !Number.isFinite(actualTime) || Math.abs(expectedTime - actualTime) > 1000;
    }
    return cellText(actual[field]) !== cellText(expected);
  }).map(([field]) => field);
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

async function downloadAndVerifyDriveArchive(config, tempRoot, fileToken, expectedArchiveBytes, expectedArchiveSha256, expectedManifestSha256) {
  const archivePath = path.join(tempRoot, "remote-readback.tar.gz");
  await runLarkCli(["drive", "+download", "--file-token", fileToken, "--output", path.relative(repoRoot, archivePath)]);
  await chmod(archivePath, 0o600);
  return validateArchiveFile(archivePath, expectedArchiveBytes, expectedArchiveSha256, expectedManifestSha256);
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
  const periodId = normalizePeriod(args.period || args.week);
  const { files, excluded } = await collectBackupFiles(repoRoot);
  const manifest = createManifest(periodId, files, excluded);
  const archive = await createArchive(repoRoot, periodId, manifest, files);
  let existing = null;
  let uploadCompleted = false;
  try {
    assertArchiveSizeWithinLimit(archive.archiveBytes, files);
    const config = await ensureResources(configFromArgs(args, { requireFolder: true }));
    await loadBaseFields(config);
    existing = exactSnapshot(await listSnapshotRecords(config), periodId);
    if (canSkipSuccessfulSnapshot(existing, manifest, args.refresh)) {
      const remoteReadback = await downloadAndVerifyDriveArchive(config, archive.tempRoot,
        String(existing.values["Drive File Token"]), null,
        String(existing.values["Archive SHA-256"]), manifest.manifestSha256);
      if (remoteReadback.fileCount !== manifest.fileCount || remoteReadback.totalBytes !== manifest.totalBytes) {
        throw new Error("现存云端快照与当前 manifest 的文件数或总字节数不一致。");
      }
      return { snapshotId: periodId, status: "already-success", fileCount: manifest.fileCount, totalBytes: manifest.totalBytes,
        archiveBytes: remoteReadback.archiveBytes, archiveLimitBytes: MAX_ARCHIVE_BYTES, excludedCount: excluded.length, remoteReadback,
        retention: await runRetention(config) };
    }
    const existingToken = String(existing?.values?.["Drive File Token"] || "") || await findDriveFileByName(config.folderToken, archive.archiveName);
    const driveFileToken = await uploadArchive(config, archive.archivePath, archive.archiveName, existingToken);
    uploadCompleted = true;
    const remoteReadback = await downloadAndVerifyDriveArchive(config, archive.tempRoot, driveFileToken,
      archive.archiveBytes, archive.archiveSha256, manifest.manifestSha256);
    const values = {
      "Snapshot ID": periodId, Week: periodId, "Created At": formatFeishuDatetime(), "Archive Name": archive.archiveName,
      "Drive File Token": driveFileToken, "Manifest SHA-256": manifest.manifestSha256, "Archive SHA-256": archive.archiveSha256,
      "File Count": manifest.fileCount, "Total Bytes": manifest.totalBytes, "Retention Class": "recent+annual",
      "Snapshot Year": snapshotYear(periodId), Status: "success", Error: "",
    };
    await upsertSnapshot(config, values, existing?.id);
    return { snapshotId: periodId, status: "success", fileCount: manifest.fileCount, totalBytes: manifest.totalBytes,
      archiveBytes: archive.archiveBytes, archiveLimitBytes: MAX_ARCHIVE_BYTES, manifestSha256: manifest.manifestSha256,
      archiveSha256: archive.archiveSha256, excludedCount: excluded.length, remoteReadback, retention: await runRetention(config) };
  } catch (error) {
    if (uploadCompleted) {
      try {
        const snapshot = existing || exactSnapshot(await listSnapshotRecords(config), periodId);
        if (snapshot) await updateRecordStatus(config, snapshot, "failed", error instanceof Error ? error.message : String(error));
      } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    await rm(archive.tempRoot, { recursive: true, force: true });
  }
}

export async function validateManifest(extractedRoot, expectedManifestSha256) {
  const manifest = JSON.parse(await readFile(path.join(extractedRoot, "manifest.json"), "utf8"));
  const { createdAt, manifestSha256, ...core } = manifest;
  // 子集校验：manifest.roots 每一项都必须属于 BACKUP_ROOTS（新根是旧根的超集，旧式归档仍可恢复），仅拒绝未知根。
  if (!Array.isArray(manifest.roots) || manifest.roots.some((root) => !BACKUP_ROOTS.includes(root))) throw new Error("manifest 备份根目录不匹配。");
  if (manifestSha256 !== sha256Text(JSON.stringify(core)) || (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256)) throw new Error("manifest SHA-256 校验失败。");
  // 老快照可能包含图片；校验按快照实际清单进行，保持旧归档可恢复。
  const files = await collectBackupFiles(extractedRoot, manifest.roots, { excludeImages: false, excludeHistoricalFlomo: false });
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

export async function validateArchiveFile(archivePath, expectedArchiveBytes, expectedArchiveSha256, expectedManifestSha256) {
  const archiveBytes = (await stat(archivePath)).size;
  if (archiveBytes > MAX_ARCHIVE_BYTES) throw new Error(`远端压缩包超出 10 MB 上限：${archiveBytes}B`);
  if (expectedArchiveBytes != null && archiveBytes !== Number(expectedArchiveBytes)) throw new Error("远端压缩包字节数与上传结果不一致。");
  const archiveSha256 = await hashFile(archivePath);
  if (expectedArchiveSha256 && archiveSha256 !== expectedArchiveSha256) throw new Error("远端压缩包 SHA-256 与上传结果不一致。");
  const listing = await execFileAsync("tar", ["-tzf", archivePath], { cwd: repoRoot });
  validateArchiveEntries(listing.stdout);
  const verifyRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-backup-readback-"));
  try {
    await chmod(verifyRoot, 0o700);
    const extractedRoot = path.join(verifyRoot, "extracted");
    await mkdir(extractedRoot, { recursive: true, mode: 0o700 });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractedRoot], { cwd: repoRoot });
    const manifest = await validateManifest(extractedRoot, expectedManifestSha256);
    return {
      archiveBytes, archiveSha256, manifestSha256: manifest.manifestSha256,
      fileCount: manifest.fileCount, totalBytes: manifest.totalBytes,
      tarEntries: listing.stdout.split(/\r?\n/).filter(Boolean).length,
    };
  } finally {
    await rm(verifyRoot, { recursive: true, force: true });
  }
}

async function restore(args) {
  const periodId = normalizePeriod(args.period || args.week);
  if (!args.target) throw new Error("恢复必须提供 --target，默认不覆盖现有工作区。");
  const config = configFromArgs(args);
  if (!config.folderToken && !config.baseToken && !config.tableId) {
    config.baseToken = await resolveOrCreateBase(config, await resolveOrCreateFolder(config));
  }
  config.tableId = await resolveOrCreateTable(config);
  await loadBaseFields(config);
  const records = await listSnapshotRecords(config);
  const candidates = records.filter((record) => String(record.values?.["Snapshot ID"] || "") === periodId && String(record.values?.Status || "") === "success");
  candidates.sort((a, b) => parseDateValue(b.values["Created At"]) - parseDateValue(a.values["Created At"]));
  const record = candidates[0];
  if (!record) throw new Error(`Base 中找不到可恢复的成功快照：${periodId}`);
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
    await upsertSnapshot(config, { "Snapshot ID": periodId, "Restored At": formatFeishuDatetime() }, record.id);
    return { snapshotId: periodId, status: "restored", target, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`用法：\n  npm run backup:weekly -- --week YYYY-Www [--refresh]\n  npm run backup:weekly -- --period YYYY-Www[-Www] [--refresh]\n  npm run restore:weekly -- --period YYYY-Www[-Www] --target /path/to/new-directory\n\n范围须为 1–4 个连续 ISO 周；Snapshot ID 和 Week 字段保留完整周期标识。\n默认行为：自动查找或创建 Learn-X Backups、Learn-X Backup Index 和 Snapshots。\n--refresh：替换并读回同一 Snapshot ID 的已有快照。\n\n可选 token 覆盖：\n  LEARN_X_BACKUP_DRIVE_FOLDER_TOKEN\n  LEARN_X_BACKUP_BASE_TOKEN\n  LEARN_X_BACKUP_TABLE_ID`);
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

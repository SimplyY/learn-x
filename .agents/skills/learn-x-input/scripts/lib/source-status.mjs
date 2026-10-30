import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const SOURCE_STATUS_FILE = "_source-status.json";
export const SOURCE_STATUSES = new Set(["ready", "empty", "needs_review", "failed", "unavailable"]);
export const SOURCE_NAMES = new Set([
  "daily", "flomo", "weread", "jingdu", "calendar", "voice", "coach", "wisdom",
  "wechat", "build", "build-bot", "health", "open-actions", "core"
]);
export const SOURCE_FILES = {
  daily: "daily.md", flomo: "flomo.md", weread: "weread.md", jingdu: "jingdu.md", calendar: "calendar.md",
  voice: "voice.md", coach: "coach.md", wisdom: "wisdom.md", wechat: "wechat.md",
  build: "build.md", "build-bot": "build-bot.md", health: "health.md",
  "open-actions": "open-actions.md", core: "core.md"
};

function assertWeek(week) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week)) throw new Error(`无效周：${week}`);
}

function assertSource(source) {
  if (!SOURCE_NAMES.has(source)) throw new Error(`未知输入源：${source}`);
}

function assertFile(file) {
  if (!file || file === "." || file === ".." || path.basename(file) !== file || file.startsWith("_")) {
    throw new Error(`非法来源文件名：${file}`);
  }
}

function cleanSummary(summary) {
  const value = String(summary ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll("|", "／")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:token|secret|password|credential|cookie|session|api[_-]?key)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b(?:record[_-]?id|technical[_-]?id|document[_-]?id)\s*[:=]\s*\S+/gi, "[id]")
    .replace(/\b(?:rec|tbl|fld|app|base|view|doc|wiki)[A-Za-z0-9_-]{6,}\b/gi, "[id]")
    .trim();
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

// Optional per-source commit journal (two-phase commits, e.g. jingdu.md).
// Write side is strict: callers get errors for malformed entries. Read side is
// tolerant: a corrupted journal never makes an otherwise valid sidecar unreadable.
export const COMMIT_ACTIONS = new Set(["pending", "commit", "rollback"]);

function normalizeCommitJournal(value, { strict = false } = {}) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    if (strict) throw new Error(`非法提交日志：必须是数组`);
    return null;
  }
  const entries = [];
  const malformed = (item) => {
    if (!strict) return;
    let preview;
    try { preview = JSON.stringify(item); } catch { preview = String(item); }
    throw new Error(`非法提交日志条目：${(preview ?? "undefined").slice(0, 120)}`);
  };
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { malformed(item); continue; }
    if (!COMMIT_ACTIONS.has(item.action)) { malformed(item); continue; }
    if (typeof item.at !== "string" || !Number.isFinite(Date.parse(item.at))) { malformed(item); continue; }
    const entry = { action: item.action, at: item.at };
    let ok = true;
    for (const field of ["sha256", "expectSha256"]) {
      if (item[field] == null) continue;
      if (typeof item[field] !== "string" || !item[field].trim()) { ok = false; break; }
      entry[field] = item[field].trim();
    }
    if (!ok) { malformed(item); continue; }
    if (item.note != null) {
      if (typeof item.note !== "string") { malformed(item); continue; }
      const note = cleanSummary(item.note);
      if (note) entry.note = note;
    }
    entries.push(entry);
  }
  return entries;
}

function validateEntry(source, entry) {
  assertSource(source);
  if (!entry || typeof entry !== "object") throw new Error(`来源状态非法：${source}`);
  if (!SOURCE_STATUSES.has(entry.status)) throw new Error(`非法来源状态：${entry.status}`);
  assertFile(entry.file);
  if (entry.file !== SOURCE_FILES[source]) throw new Error(`来源文件名与来源不匹配：${source}`);
  if (!Number.isInteger(entry.count) || entry.count < 0) throw new Error(`非法来源计数：${source}`);
  if (typeof entry.summary !== "string") throw new Error(`来源说明必须是字符串：${source}`);
  const summary = cleanSummary(entry.summary);
  if (typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
    throw new Error(`来源更新时间非法：${source}`);
  }
  if (typeof entry.preservedStaleFile !== "boolean") throw new Error(`来源旧文件标记非法：${source}`);
  const normalized = {
    status: entry.status,
    file: entry.file,
    count: entry.count,
    summary,
    updatedAt: entry.updatedAt,
    preservedStaleFile: entry.preservedStaleFile
  };
  // Optional two-phase-commit extensions. Absent fields stay absent; unknown
  // fields are ignored so older/newer writers never break this reader.
  if (typeof entry.contentSha256 === "string" && entry.contentSha256.trim()) {
    normalized.contentSha256 = entry.contentSha256.trim();
  }
  const commitJournal = normalizeCommitJournal(entry.commitJournal);
  if (commitJournal?.length) normalized.commitJournal = commitJournal;
  return normalized;
}

export function validateSourceStatusDocument(document, week) {
  assertWeek(week);
  if (!document || typeof document !== "object" || document.version !== 1 || document.week !== week) {
    throw new Error("来源状态侧车格式非法。");
  }
  if (!document.sources || typeof document.sources !== "object" || Array.isArray(document.sources)) {
    throw new Error("来源状态侧车缺少 sources。");
  }
  const sources = {};
  for (const [source, entry] of Object.entries(document.sources)) {
    // Ignore retired or newer source metadata while keeping known entries strict.
    if (!SOURCE_NAMES.has(source)) continue;
    sources[source] = validateEntry(source, entry);
  }
  if (typeof document.updatedAt !== "string" || !Number.isFinite(Date.parse(document.updatedAt))) {
    throw new Error("来源状态侧车更新时间非法。");
  }
  return { version: 1, week, updatedAt: document.updatedAt, sources };
}

export async function readWeeklySourceStatus(weekRoot, week) {
  assertWeek(week);
  const file = path.join(weekRoot, SOURCE_STATUS_FILE);
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, document: null, sources: {} };
    throw error;
  }
  let document;
  try {
    document = JSON.parse(content);
  } catch (error) {
    throw new Error(`来源状态侧车 JSON 无法解析：${error.message}`);
  }
  try {
    const validated = validateSourceStatusDocument(document, week);
    return { present: true, document: validated, sources: validated.sources };
  } catch (error) {
    throw new Error(`来源状态侧车格式非法：${error.message}`);
  }
}

export async function updateWeeklySourceStatus({
  weekRoot, week, source, status, file, count = 0, summary = "", preservedStaleFile = false,
  contentSha256 = null, commitJournal = null, appendJournal = null
}) {
  assertWeek(week);
  if (contentSha256 != null && (typeof contentSha256 !== "string" || !contentSha256.trim())) {
    throw new Error(`非法来源内容哈希：${source}`);
  }
  const entry = validateEntry(source, {
    status,
    file,
    count,
    summary: cleanSummary(summary),
    updatedAt: new Date().toISOString(),
    preservedStaleFile,
    ...(contentSha256 != null ? { contentSha256: contentSha256.trim() } : {}),
    ...(commitJournal != null ? { commitJournal: normalizeCommitJournal(commitJournal, { strict: true }) } : {})
  });
  const appendedJournal = appendJournal == null ? null : normalizeCommitJournal(appendJournal, { strict: true });
  if (entry.status === "ready" && !(await fileExists(path.join(weekRoot, entry.file)))) {
    throw new Error(`ready 来源文件不存在：${entry.file}`);
  }
  await mkdir(weekRoot, { recursive: true });
  const target = path.join(weekRoot, SOURCE_STATUS_FILE);
  const release = await acquireStatusLock(weekRoot);
  try {
    // Read only after acquiring the lock so concurrent collectors merge against
    // the latest sidecar rather than overwriting one another's source entries.
    const current = await readWeeklySourceStatus(weekRoot, week);
    const now = new Date().toISOString();
    const merged = { ...entry, updatedAt: now };
    // Commit journals survive unrelated updates: inherit the existing journal
    // unless the caller replaces it (commitJournal) or appends (appendJournal).
    const currentJournal = Array.isArray(current.sources[source]?.commitJournal) ? current.sources[source].commitJournal : [];
    if (appendedJournal?.length) {
      merged.commitJournal = [...currentJournal, ...appendedJournal];
    } else if (entry.commitJournal) {
      merged.commitJournal = entry.commitJournal;
    } else if (currentJournal.length) {
      merged.commitJournal = currentJournal;
    }
    const document = {
      version: 1,
      week,
      updatedAt: now,
      sources: { ...current.sources, [source]: merged }
    };
    const temp = `${target}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temp, target);
    } finally {
      await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
    return document;
  } finally {
    await release();
  }
}

async function acquireStatusLock(weekRoot) {
  return acquireWeeklyFileLock(weekRoot, `${SOURCE_STATUS_FILE}.lock`);
}

// Independent names allow a consumer to hold its own transaction lock while
// the nested source-status update acquires the separate status lock.
export async function acquireWeeklyFileLock(weekRoot, lockName) {
  if (!/^[A-Za-z0-9_.-]+\.lock$/.test(lockName)) throw new Error("非法周文件锁名称");
  await mkdir(weekRoot, { recursive: true });
  const lockPath = path.join(weekRoot, lockName);
  const reapPath = `${lockPath}.reap`;
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try { await handle.writeFile(owner, "utf8"); } finally { await handle.close(); }
      return async () => {
        try {
          const current = await readFile(lockPath, "utf8");
          if (current === owner) await unlink(lockPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await reapAbandonedStatusLock(lockPath, reapPath);
      if (Date.now() >= deadline) throw new Error("来源状态锁等待超时；未覆盖现有状态。");
      await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 25)));
    }
  }
}

async function reapAbandonedStatusLock(lockPath, reapPath) {
  let reaper;
  try {
    reaper = await open(reapPath, "wx", 0o600);
    await reaper.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await lockOwnerIsDead(reapPath)) await unlink(reapPath).catch((unlinkError) => { if (unlinkError.code !== "ENOENT") throw unlinkError; });
    return;
  } finally {
    await reaper?.close();
  }
  try {
    if (await lockOwnerIsDead(lockPath)) await unlink(lockPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  } finally {
    await unlink(reapPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function lockOwnerIsDead(file) {
  try {
    const raw = await readFile(file, "utf8");
    const { pid } = JSON.parse(raw);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { return error.code === "ESRCH"; }
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

export function sourceStatusForFile(sources, fileName) {
  return Object.values(sources).find((entry) => entry.file === path.basename(fileName));
}

export async function fileExists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

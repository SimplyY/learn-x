import { lstat, readFile, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseShanghaiDateRange } from "./collect-weread-range.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function shanghaiDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Number(timestamp) * 1000));
}

export function shanghaiTime(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Number(timestamp) * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export async function readActiveFlomoSnapshot(options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const storageRoot = path.resolve(options.storageRoot || path.join(root, "04_output/_dist/flomo-review/online-full"));
  await assertPrivatePath(root, storageRoot, { directoryMode: 0o700 });
  const state = await readJson(path.join(storageRoot, "storage-mode.json"));
  if (state?.schemaVersion !== 1 || state?.sourceMode !== "flomo-online-full" ||
      typeof state.activeSnapshotPath !== "string" || !state.activeSnapshotPath.startsWith("snapshots/")) {
    throw new Error("flomo-reading-active-snapshot-invalid");
  }
  const snapshotPath = path.join(storageRoot, state.activeSnapshotPath);
  await assertPrivatePath(root, snapshotPath, { fileMode: 0o600 });
  const snapshot = await readJson(snapshotPath);
  if (snapshot?.sourceMode !== state.sourceMode || snapshot?.snapshotId !== state.activeSnapshotId ||
      !Array.isArray(snapshot.records)) {
    throw new Error("flomo-reading-snapshot-mismatch");
  }
  return { snapshot, storageRoot, snapshotPath, activatedAt: state.activatedAt || null };
}

export async function collectFlomoReadingRange(options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const now = options.now || new Date();
  const range = parseShanghaiDateRange({ from: options.from, to: options.to, now });
  range.endEpoch = Math.min(range.endEpoch, Math.floor(now.getTime() / 1000));
  if (range.endEpoch <= range.startEpoch) throw new Error("range-empty: requested range is in the future or has no elapsed time.");
  const tagFilter = String(options.tag || "读书笔记").trim();
  if (!tagFilter) throw new Error("flomo-reading-tag-invalid");
  const { snapshot, storageRoot, snapshotPath, activatedAt } = await readActiveFlomoSnapshot({ root, storageRoot: options.storageRoot });
  const capturedAtMs = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error("flomo-reading-snapshot-captured-at-invalid");

  const errors = [];
  const matched = [];
  const seenIds = new Set();
  for (const record of snapshot.records) {
    const createdAt = Date.parse(record.createdAt);
    const createTimeSeconds = createdAt / 1000;
    const memoId = typeof record.memoId === "string" ? record.memoId.trim() : "";
    const tags = Array.isArray(record.tags) ? record.tags : [];
    const body = normalizeBodyText(record.body);
    if (!memoId || !Number.isFinite(createdAt) || !body) {
      errors.push({ reason: "flomo-record-invalid: memoId, createdAt or body is incomplete." });
      continue;
    }
    if (seenIds.has(memoId)) {
      errors.push({ reason: `flomo-record-duplicate: ${memoId}.` });
      continue;
    }
    seenIds.add(memoId);
    if (createTimeSeconds < range.startEpoch || createTimeSeconds >= range.endEpoch) continue;
    if (!tags.some((tag) => String(tag).toLowerCase().includes(tagFilter.toLowerCase()))) continue;
    const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
    if (record.bodyHash && record.bodyHash !== bodyHash) {
      errors.push({ memoId, reason: "flomo-body-hash-mismatch." });
      continue;
    }
    matched.push({
      sourceId: `flomo:${memoId}`,
      bookId: null,
      createTime: createTimeSeconds,
      date: shanghaiDate(createTimeSeconds),
      timeText: record.timeText,
      tags,
      content: body,
      sourceEvidence: {
        memoId,
        url: record.url || null,
        createdAt: record.createdAt,
        timeText: record.timeText,
        bodyHash,
        tags,
      },
    });
  }

  const books = [];
  const byBookKey = new Map();
  for (const thought of matched) {
    const book = inferBook(thought.tags);
    let bookRecord = byBookKey.get(book.key);
    if (!bookRecord) {
      bookRecord = { bookId: book.key, title: book.title, author: "", thoughts: [] };
      byBookKey.set(book.key, bookRecord);
      books.push(bookRecord);
    }
    bookRecord.thoughts.push(thought);
  }
  books.sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN") || left.bookId.localeCompare(right.bookId));
  const coverage = snapshot.coverage || null;
  const omittedCount = Number.isInteger(coverage?.omittedCount) ? coverage.omittedCount : 1;
  if (omittedCount > 0) {
    errors.unshift({ reason: `flomo-coverage-incomplete: ${omittedCount} online records were omitted when the active snapshot was captured.` });
  }
  if (range.endEpoch * 1000 > capturedAtMs) {
    errors.unshift({ reason: `flomo-snapshot-stale: snapshot captured at ${snapshot.capturedAt}, before requested endExclusive.` });
  }
  return {
    source: "flomo",
    timezone: "Asia/Shanghai",
    range: { start: shanghaiTime(range.startEpoch), endExclusive: shanghaiTime(range.endEpoch) },
    complete: omittedCount === 0 && errors.length === 0,
    requestedTag: tagFilter,
    snapshot: {
      sourceMode: snapshot.sourceMode,
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      activatedAt,
      totalCount: snapshot.totalCount,
      coverage,
      path: path.relative(root, snapshotPath),
      storageRoot: path.relative(root, storageRoot),
    },
    counts: { candidateRecords: snapshot.records.length, matchedRecords: matched.length, books: books.length },
    errors,
    books,
  };
}

function normalizeBodyText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function inferBook(tags) {
  const titles = tags
    .filter((tag) => String(tag).includes("读书笔记"))
    .flatMap((tag) => String(tag).split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "读书笔记" && segment !== "记录");
  const title = titles.at(-1) || "未命名书籍";
  return { key: `flomo:${title}`, title };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`flomo-reading-snapshot-missing: ${path.basename(filePath)}.`);
    throw new Error(`flomo-reading-json-invalid: ${path.basename(filePath)}.`);
  }
}

async function assertPrivatePath(root, target, { directoryMode, fileMode }) {
  await assertWithinRoot(root, target);
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`flomo-reading-snapshot-missing: ${path.basename(target)}.`);
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`flomo-reading-path-symlink: ${path.basename(target)}.`);
  const expected = metadata.isDirectory() ? directoryMode : fileMode;
  if (expected && (metadata.mode & 0o777) !== expected) {
    throw new Error(`flomo-reading-path-not-private: ${path.basename(target)}.`);
  }
}

async function assertWithinRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("flomo-reading-path-outside-root");
  }
}

async function writeFlomoReadingRange(options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const outputPath = path.resolve(options.outputPath || path.join(root, ".runtime/reading/flomo-range-latest.json"));
  await assertWithinRoot(root, outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(outputPath), 0o700);
  const payload = await collectFlomoReadingRange(options);
  const temporaryPath = `${outputPath}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);
  const readback = JSON.parse(await readFile(outputPath, "utf8"));
  if (JSON.stringify(readback) !== JSON.stringify(payload)) throw new Error("flomo-reading-readback-mismatch");
  return { payload, outputPath };
}

function parseArgs(argv) {
  const options = {};
  const aliases = {
    "--from": "from", "--to": "to", "--tag": "tag", "--output-path": "outputPath",
    "--root": "root", "--storage-root": "storageRoot",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = aliases[argv[index]];
    if (key) {
      options[key] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeFlomoReadingRange(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({
    output: path.relative(repoRoot, result.outputPath),
    range: result.payload.range,
    complete: result.payload.complete,
    recordCount: result.payload.counts.matchedRecords,
    bookCount: result.payload.counts.books,
    errors: result.payload.errors,
  }, null, 2));
}

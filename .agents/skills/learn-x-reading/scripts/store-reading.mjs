import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile, open, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_ROOT = "05_library/reading";
const PRIVATE_ROOT = ".runtime/reading";

export async function storeReadingBatch(input, options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const book = normalizeBook(input?.book || {});
  const source = normalizeSource(input?.source);
  if (!Array.isArray(input?.entries) || input.entries.length === 0) throw new Error("reading-batch-empty: at least one source entry is required.");

  const bookKey = sha256(bookIdentity(book)).slice(0, 20);
  const slug = `${slugify(book.title)}-${bookKey}`;
  const publicPath = path.join(root, PUBLIC_ROOT, `${slug}.md`);
  const indexPath = path.join(root, PUBLIC_ROOT, "_index.md");
  const privateRoot = path.join(root, PRIVATE_ROOT);
  const statePath = path.join(privateRoot, "state.json");
  const lockPath = path.join(privateRoot, "state.lock");
  await ensureSafeDirectory(root, privateRoot, 0o700);
  const lock = await acquireLock(lockPath, root);

  try {
    const state = await readState(statePath, root);
    const normalizedInputEntries = input.entries.map((entry, index) => normalizeEntry(entry, { source, book, index }));
    const uniqueEntriesById = new Map();
    let inputDuplicateCount = 0;
    for (const entry of normalizedInputEntries) {
      const prior = uniqueEntriesById.get(entry.recordId);
      if (!prior) {
        uniqueEntriesById.set(entry.recordId, entry);
        continue;
      }
      if (recordPayload(prior) !== recordPayload(entry)) throw new Error("reading-source-duplicate-conflict: duplicate source identity has conflicting content.");
      inputDuplicateCount += 1;
    }
    const uniqueNormalizedEntries = [...uniqueEntriesById.values()];
    const derivedBatchId = input.batchId || sha256(uniqueNormalizedEntries.map((entry) => entry.recordId).sort().join("\n")).slice(0, 24);
    const safeBatchId = String(derivedBatchId).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 96) || sha256(derivedBatchId).slice(0, 24);
    const pendingPath = path.join(privateRoot, "pending", `${safeBatchId}.json`);
    const receiptPath = path.join(privateRoot, "batches", `${safeBatchId}.json`);
    const priorPending = await readPrivateJson(pendingPath, root);
    const priorReceipt = await readPrivateJson(receiptPath, root);
    if (priorPending && priorPending.batchId !== safeBatchId) throw new Error("reading-pending-batch-conflict: pending batch ID does not match this retry.");
    if (priorReceipt) {
      const completedRecordIds = Array.isArray(priorReceipt.records)
        ? priorReceipt.records.map((entry) => entry?.recordId).filter(Boolean).sort()
        : [];
      const requestedRecordIds = uniqueNormalizedEntries.map((entry) => entry.recordId).sort();
      const storedBook = state.books[bookKey];
      if (priorReceipt.batchId !== safeBatchId || priorReceipt.source !== source || priorReceipt.book !== book.title
        || completedRecordIds.length !== requestedRecordIds.length
        || completedRecordIds.some((recordId, index) => recordId !== requestedRecordIds[index])
        || !storedBook || stableSerialize(storedBook.book) !== stableSerialize(book)) {
        throw new Error("reading-completed-batch-conflict: a completed batch ID cannot be reused for different sources or book metadata.");
      }
      for (const entry of uniqueNormalizedEntries) {
        const stored = state.records[entry.recordId];
        if (!stored || stored.bookKey !== bookKey || stored.sourceFingerprint !== entry.sourceFingerprint) {
          throw new Error("reading-completed-source-conflict: completed batch source no longer matches the saved record.");
        }
      }
    }
    const requestedCompanionPack = typeof input.companionPack === "string" ? input.companionPack.trim() : "";
    const completedCompanionPath = path.join(privateRoot, "companion-packs", `${safeBatchId}.md`);
    const completedCompanionPack = priorReceipt?.companionPackAvailable
      ? await readPrivateText(completedCompanionPath, root)
      : "";
    if (priorReceipt && completedCompanionPack && priorPending?.companionPack
      && priorPending.companionPack.trim() !== completedCompanionPack.trim()) {
      throw new Error("reading-completed-pending-conflict: completed receipt and pending batch disagree about the companion pack.");
    }
    const companionPack = priorReceipt
      ? completedCompanionPack || priorPending?.companionPack || requestedCompanionPack
      : priorPending?.companionPack || requestedCompanionPack;
    if (!priorReceipt && priorPending?.companionPack && requestedCompanionPack && priorPending.companionPack !== requestedCompanionPack) {
      throw new Error("reading-pending-companion-conflict: retry companion pack differs from the preserved pending batch.");
    }
    const normalizedEntries = priorPending?.entries || uniqueNormalizedEntries;
    if (priorPending && uniqueNormalizedEntries.map((entry) => entry.recordId).sort().join("\n") !== normalizedEntries.map((entry) => entry.recordId).sort().join("\n")) {
      throw new Error("reading-pending-source-conflict: retry does not match the preserved pending source identities.");
    }
    if (priorPending) {
      const preservedEntries = new Map(normalizedEntries.map((entry) => [entry.recordId, entry]));
      if (uniqueNormalizedEntries.some((entry) => recordPayload(preservedEntries.get(entry.recordId)) !== recordPayload(entry))) {
        throw new Error("reading-pending-source-conflict: retry content differs from the preserved pending batch.");
      }
    }
    const pending = [];
    let duplicateCount = inputDuplicateCount;
    for (const entry of normalizedEntries) {
      const prior = state.records[entry.recordId];
      if (prior) {
        const sameSource = prior.sourceFingerprint && entry.sourceFingerprint
          ? prior.sourceFingerprint === entry.sourceFingerprint
          : recordPayload(prior) === recordPayload(entry);
        if (!sameSource) {
          throw new Error("reading-source-replay-conflict: an existing source identity has a different private source fingerprint; refusing to overwrite or silently discard it.");
        }
        duplicateCount += 1;
        continue;
      }
      pending.push(entry);
    }

    const newRecords = { ...state.records };
    for (const entry of pending) newRecords[entry.recordId] = entry;
    const publicEntries = Object.values(newRecords)
      .filter((entry) => entry.bookKey === bookKey && entry.status === "ready" && entry.visibility === "public")
      .sort(compareEntries);
    const privateEntries = Object.values(newRecords)
      .filter((entry) => entry.bookKey === bookKey && (entry.visibility === "private" || entry.status !== "ready"))
      .sort(compareEntries);
    const bookRecord = state.books[bookKey] || { bookKey, book, slug, publicPath: null, publicHash: null };
    const oldIndexHash = state.indexHash || null;
    const stableCollectedAt = clean(input.collectedAt) || clean(priorReceipt?.collectedAt || priorReceipt?.createdAt) || new Date().toISOString();
    const publicContent = publicEntries.length
      ? renderBookMarkdown({ book, entries: publicEntries, collectedAt: stableCollectedAt })
      : null;
    const publicHash = publicContent ? sha256(publicContent) : bookRecord.publicHash;
    const nextBooks = { ...state.books, [bookKey]: { ...bookRecord, book, slug, publicPath: publicEntries.length ? path.relative(root, publicPath) : null, publicHash } };
    const indexContent = publicEntries.length ? renderIndex(Object.values(nextBooks).filter((item) => item.publicPath && item.publicHash)) : null;
    const indexHash = indexContent ? sha256(indexContent) : oldIndexHash;
    const intent = priorPending?.intent || {
      publicPath: publicEntries.length ? publicPath : null,
      previousPublicHash: bookRecord.publicHash,
      publicHash,
      publicContent,
      indexPath: publicEntries.length ? indexPath : null,
      previousIndexHash: oldIndexHash,
      indexHash,
      indexContent
    };
    await writePrivateJson(pendingPath, { version: 1, batchId: safeBatchId, source, book, entries: normalizedEntries, companionPack: companionPack || null, intent, status: "pending", updatedAt: new Date().toISOString() }, root);

    let publicSaved = false;
    try {
      if (intent.publicPath) {
        await writeIntendedFile(intent.publicPath, intent.previousPublicHash, intent.publicHash, intent.publicContent, "reading-public-readback-mismatch", root);
        await writeIntendedFile(intent.indexPath, intent.previousIndexHash, intent.indexHash, intent.indexContent, "reading-index-readback-mismatch", root);
        publicSaved = true;
      }

      const nextState = {
        version: 1,
        updatedAt: new Date().toISOString(),
        records: newRecords,
        books: nextBooks,
        indexHash,
        privatePendingCount: Object.values(newRecords).filter((entry) => entry.visibility === "private" || entry.status !== "ready").length
      };
      await writePrivateJson(statePath, nextState, root);
      const companionPackPath = companionPack
        ? path.join(privateRoot, "companion-packs", `${safeBatchId}.md`)
        : null;
      if (companionPackPath) await writePrivateText(companionPackPath, companionPack, root);
      const receipt = {
        version: 1,
        batchId: safeBatchId,
        source,
        book: book.title,
        inputCount: input.entries.length,
        addedCount: pending.length,
        duplicateCount,
        records: normalizedEntries.map((entry) => ({ recordId: entry.recordId, recordVersion: recordVersion(newRecords[entry.recordId]) })),
        privateOrPendingCount: privateEntries.length,
        publicSaved,
        publicPath: publicEntries.length ? path.relative(root, publicPath) : null,
        indexPath: publicEntries.length ? path.relative(root, indexPath) : null,
        companionPackPath: companionPackPath ? path.relative(root, companionPackPath) : null,
        companionPackAvailable: Boolean(companionPackPath),
        publicReadbackVerified: publicSaved,
        localSaved: true,
        collectedAt: stableCollectedAt,
        createdAt: new Date().toISOString()
      };
      await writePrivateJson(receiptPath, receipt, root);
      await rm(pendingPath, { force: true });
      return receipt;
    } catch (error) {
      await writePrivateJson(pendingPath, { version: 1, batchId: safeBatchId, source, book, entries: normalizedEntries, companionPack: companionPack || null, intent, status: "failed", lastError: error.message, updatedAt: new Date().toISOString() }, root);
      throw error;
    }
  } finally {
    await rm(lockPath, { force: true });
    await lock.close();
  }
}

export async function updateReadingRecord(input, options = {}) {
  const root = path.resolve(options.root || repoRoot);
  const recordId = clean(input?.recordId);
  const expectedVersion = clean(input?.expectedVersion);
  if (!recordId || !expectedVersion) throw new Error("reading-version-required: recordId and expectedVersion are required for a modification.");
  if (!["modify", "revoke"].includes(input.action)) throw new Error("reading-action-invalid: action must be modify or revoke.");
  const action = input.action;
  const patch = input.patch || {};
  if (action === "modify" && (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).length === 0)) {
    throw new Error("reading-modification-empty: provide at least one supported field change.");
  }
  if (action === "revoke" && patch && typeof patch === "object" && Object.keys(patch).length) {
    throw new Error("reading-revoke-patch-invalid: revoke does not accept a field patch.");
  }
  const requestedCompanionPack = typeof input.companionPack === "string" ? input.companionPack.trim() : "";
  const privateRoot = path.join(root, PRIVATE_ROOT);
  const statePath = path.join(privateRoot, "state.json");
  const lockPath = path.join(privateRoot, "state.lock");
  await ensureSafeDirectory(root, privateRoot, 0o700);
  const lock = await acquireLock(lockPath, root);
  try {
    const state = await readState(statePath, root);
    const current = state.records[recordId];
    if (!current) throw new Error("reading-record-not-found: no local record matches this ID.");
    const pendingName = `modify-${sha256(recordId).slice(0, 24)}.json`;
    const pendingPath = path.join(privateRoot, "pending", pendingName);
    const priorPending = await readPrivateJson(pendingPath, root);
    const companionPack = priorPending?.companionPack || requestedCompanionPack;
    if (!companionPack) throw new Error("reading-companion-required: a refreshed companion pack is required with a modification or revoke.");
    if (priorPending?.companionPack && requestedCompanionPack && priorPending.companionPack !== requestedCompanionPack) {
      throw new Error("reading-modification-companion-conflict: retry companion pack differs from the preserved modification.");
    }
    const requestHash = sha256(JSON.stringify({ action, patch, companionPack }));
    const currentVersion = recordVersion(current);
    let nextRecord;

    if (priorPending) {
      if (priorPending.recordId !== recordId || priorPending.expectedVersion !== expectedVersion) throw new Error("reading-modification-pending-conflict: a different modification is pending for this record.");
      if (priorPending.requestHash !== requestHash) throw new Error("reading-modification-pending-conflict: retry must match the preserved modification request.");
      if (currentVersion !== priorPending.expectedVersion && currentVersion !== priorPending.nextVersion) throw new Error("reading-version-conflict: the record changed after the pending modification was prepared.");
      nextRecord = priorPending.nextRecord;
    } else {
      if (currentVersion !== expectedVersion) throw new Error("reading-version-conflict: the record changed since the requested version was read.");
      nextRecord = applyRecordPatch(current, action, patch);
    }

    const bookKey = current.bookKey;
    const bookRecord = state.books[bookKey];
    if (!bookRecord) throw new Error("reading-book-state-missing: cannot resolve the book file for this record.");
    const publicEntries = Object.values({ ...state.records, [recordId]: nextRecord })
      .filter((entry) => entry.bookKey === bookKey && entry.status === "ready" && entry.visibility === "public")
      .sort(compareEntries);
    const candidatePublicPath = path.join(root, PUBLIC_ROOT, `${bookRecord.slug}.md`);
    const publicContent = publicEntries.length
      ? renderBookMarkdown({ book: bookRecord.book, entries: publicEntries, collectedAt: clean(input.collectedAt) || new Date().toISOString() })
      : null;
    const publicHash = publicContent ? sha256(publicContent) : null;
    const nextBooks = {
      ...state.books,
      [bookKey]: {
        ...bookRecord,
        publicPath: publicEntries.length ? path.relative(root, candidatePublicPath) : null,
        publicHash
      }
    };
    const indexPath = path.join(root, PUBLIC_ROOT, "_index.md");
    const indexContent = renderIndex(Object.values(nextBooks).filter((item) => item.publicPath && item.publicHash));
    const intent = priorPending?.intent || {
      publicPath: bookRecord.publicPath ? candidatePublicPath : (publicEntries.length ? candidatePublicPath : null),
      previousPublicHash: bookRecord.publicHash,
      publicHash,
      publicContent,
      indexPath,
      previousIndexHash: state.indexHash || null,
      indexHash: sha256(indexContent),
      indexContent,
      removePublic: !publicEntries.length && Boolean(bookRecord.publicPath)
    };
    const pendingState = {
      version: 1,
      type: "modify",
      recordId,
      expectedVersion,
      requestHash,
      companionPack,
      nextVersion: recordVersion(nextRecord),
      nextRecord,
      intent,
      status: "pending",
      updatedAt: new Date().toISOString()
    };
    await writePrivateJson(pendingPath, priorPending || pendingState, root);

    try {
      if (intent.removePublic) await removeIntendedFile(intent.publicPath, intent.previousPublicHash, root);
      else if (intent.publicPath) await writeIntendedFile(intent.publicPath, intent.previousPublicHash, intent.publicHash, intent.publicContent, "reading-public-readback-mismatch", root);
      await writeIntendedFile(intent.indexPath, intent.previousIndexHash, intent.indexHash, intent.indexContent, "reading-index-readback-mismatch", root);
      const nextState = {
        ...state,
        updatedAt: new Date().toISOString(),
        records: { ...state.records, [recordId]: nextRecord },
        books: nextBooks,
        indexHash: intent.indexHash,
        privatePendingCount: Object.values({ ...state.records, [recordId]: nextRecord }).filter((entry) => entry.visibility === "private" || entry.status === "needs_review" || entry.status === "withdrawn").length
      };
      await writePrivateJson(statePath, nextState, root);
      const companionPackPath = path.join(privateRoot, "companion-packs", "updates", `${sha256(recordId).slice(0, 24)}-${recordVersion(nextRecord).slice(0, 24)}.md`);
      await writePrivateText(companionPackPath, companionPack, root);
      const receipt = {
        type: "modify",
        recordId,
        previousVersion: expectedVersion,
        recordVersion: recordVersion(nextRecord),
        action,
        companionPackPath: path.relative(root, companionPackPath),
        companionPackAvailable: true,
        publicPath: nextBooks[bookKey].publicPath,
        localReadbackVerified: true,
        remoteHistoryMayRemain: action === "revoke",
        localSaved: true,
        createdAt: new Date().toISOString()
      };
      const receiptPath = path.join(privateRoot, "modifications", `${sha256(`${recordId}:${receipt.recordVersion}`).slice(0, 32)}.json`);
      await writePrivateJson(receiptPath, receipt, root);
      await rm(pendingPath, { force: true });
      return receipt;
    } catch (error) {
      await writePrivateJson(pendingPath, { ...pendingState, status: "failed", lastError: error.message }, root);
      throw error;
    }
  } finally {
    await rm(lockPath, { force: true });
    await lock.close();
  }
}

function applyRecordPatch(current, action, patch) {
  if (action === "revoke") {
    return { ...current, visibility: "private", status: "withdrawn", updatedAt: new Date().toISOString(), revision: (current.revision || 1) + 1 };
  }
  const allowed = new Set(["location", "date", "kind", "authorContent", "foundations", "questions", "aiInference", "userThought", "visibility", "status"]);
  if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) => !allowed.has(key))) throw new Error("reading-modification-fields-invalid: patch contains an unsupported field.");
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (["foundations", "questions"].includes(key)) next[key] = cleanLines(value);
    else if (["location", "date", "kind", "authorContent", "aiInference", "userThought"].includes(key)) next[key] = clean(value);
    else if (key === "visibility" && ["public", "private"].includes(value)) next[key] = value;
    else if (key === "status" && ["ready", "needs_review", "withdrawn"].includes(value)) next[key] = value;
    else throw new Error(`reading-modification-value-invalid: ${key} has an unsupported value.`);
  }
  if (next.status === "ready" && !next.authorContent && !next.userThought) throw new Error("reading-content-missing: ready entries require source-grounded author content or an explicitly attributed user thought.");
  next.updatedAt = new Date().toISOString();
  next.revision = (current.revision || 1) + 1;
  return next;
}

function recordVersion(entry) {
  return sha256(JSON.stringify(entry));
}

function recordPayload(entry) {
  const { createdAt, ...payload } = entry;
  return JSON.stringify(payload);
}

export function normalizeEntry(entry, { source, book, index }) {
  if (!entry || typeof entry !== "object") throw new Error(`reading-entry-invalid: entry ${index + 1} is not an object.`);
  const location = clean(entry.location || [entry.chapter, entry.page ? `p.${entry.page}` : ""].filter(Boolean).join(" / "));
  const sourceId = clean(entry.sourceId);
  if (!sourceId) throw new Error(`reading-source-id-missing: WeRead entry ${index + 1} has no stable source ID.`);
  if (entry.status !== undefined && !["ready", "needs_review"].includes(entry.status)) throw new Error(`reading-status-invalid: entry ${index + 1} must be ready or needs_review.`);
  if (entry.visibility !== undefined && !["public", "private"].includes(entry.visibility)) throw new Error(`reading-visibility-invalid: entry ${index + 1} must be public or private.`);
  if (entry.publicEligible !== undefined && typeof entry.publicEligible !== "boolean") throw new Error(`reading-public-eligibility-invalid: entry ${index + 1} must use a boolean publicEligible value.`);
  if (entry.visibility === "public" && entry.publicEligible === false || entry.visibility === "private" && entry.publicEligible === true) {
    throw new Error(`reading-visibility-conflict: entry ${index + 1} has contradictory visibility fields.`);
  }
  if (!entry.sourceEvidence || typeof entry.sourceEvidence !== "object" || Array.isArray(entry.sourceEvidence) || Object.keys(entry.sourceEvidence).length === 0) {
    throw new Error(`reading-source-evidence-missing: entry ${index + 1} must include private WeRead source evidence for replay checks.`);
  }
  const status = entry.status ?? "ready";
  const visibility = entry.visibility === "private" || entry.publicEligible === false ? "private" : "public";
  const recordId = `${source}-${sha256(sourceId).slice(0, 24)}`;
  const result = {
    recordId,
    bookKey: sha256(bookIdentity(book)).slice(0, 20),
    source,
    sourceId: source === "weread" ? sourceId : null,
    sourceFingerprint: sha256(stableSerialize(entry.sourceEvidence)),
    location: location || "定位未提供",
    date: normalizeDate(entry.date),
    kind: clean(entry.kind || "划线"),
    authorContent: clean(entry.authorContent || entry.coreClaim),
    foundations: cleanLines(entry.foundations || entry.thoughtFoundations),
    questions: cleanLines(entry.questions),
    aiInference: clean(entry.aiInference || entry.aiInterpretation),
    userThought: clean(entry.userThought),
    status,
    visibility,
    confidence: normalizeConfidence(entry.confidence),
    createdAt: new Date().toISOString()
  };
  if (status === "ready" && !result.authorContent && !result.userThought) throw new Error(`reading-content-missing: ready entry ${index + 1} requires source-grounded author content or an explicitly attributed user thought.`);
  return result;
}

function normalizeBook(book) {
  const title = clean(book.title).replace(/\s+/g, " ");
  if (!title) throw new Error("reading-book-title-missing: book title is required.");
  return { title, author: clean(book.author).replace(/\s+/g, " "), bookId: clean(book.bookId), edition: clean(book.edition).replace(/\s+/g, " ") };
}

function normalizeSource(value) {
  if (value === "weread") return value;
  throw new Error("reading-source-invalid: only WeRead is currently supported; physical-book collection is deferred.");
}

function normalizeDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "日期未提供";
}

function normalizeConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function clean(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function cleanLines(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(clean).filter(Boolean);
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareEntries(left, right) {
  return left.date.localeCompare(right.date) || left.location.localeCompare(right.location, "zh-Hans-CN") || left.recordId.localeCompare(right.recordId);
}

function renderBookMarkdown({ book, entries, collectedAt }) {
  const sources = ["微信读书精选"];
  const lines = [
    `# 《${escapeMarkdown(book.title)}》`,
    "",
    `- 作者：${escapeMarkdown(book.author || "未提供")}`,
    `- 版本：${escapeMarkdown(book.edition || "未提供")}`,
    `- 阅读来源：${sources.join("、")}`,
    `- 最近整理：${String(collectedAt).slice(0, 10)}`,
    `- 精炼记录：${entries.length} 条`,
    "",
    "> 本文件只保存可公开的精炼阅读上下文；实体书图片和大段原文不在此保存。",
    ""
  ];
  for (const entry of entries) {
    lines.push(`## ${escapeMarkdown(entry.location)} · ${entry.date}`, "");
    lines.push(`- 来源记录：\`${entry.recordId}\``, `- 标记类型：${escapeMarkdown(entry.kind)}`);
    if (entry.authorContent) lines.push(`- 作者内容提炼：${escapeMarkdown(entry.authorContent)}`);
    if (entry.foundations.length) lines.push(`- 思想基石：${entry.foundations.map(escapeMarkdown).join("；")}`);
    if (entry.questions.length) lines.push(`- 待检验问题：${entry.questions.map(escapeMarkdown).join("；")}`);
    if (entry.aiInference) lines.push(`- AI 分析（未代表用户认可）：${escapeMarkdown(entry.aiInference)}`);
    if (entry.userThought) lines.push(`- 用户明确表达：${escapeMarkdown(entry.userThought)}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderIndex(books) {
  const lines = ["# LearnX 阅读索引", "", "按书整理的公开阅读上下文，供 ChatGPT 精读读取。", ""];
  for (const item of books.sort((a, b) => a.book.title.localeCompare(b.book.title, "zh-Hans-CN"))) {
    lines.push(`- [《${escapeMarkdown(item.book.title)}》](./${path.basename(item.publicPath)}) · ${escapeMarkdown(item.book.author || "作者未提供")}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function readState(filePath, root) {
  await assertNoSymlinkPath(root, filePath);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed.version !== 1 || typeof parsed.records !== "object" || typeof parsed.books !== "object") throw new Error("state-invalid");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, records: {}, books: {}, indexHash: null };
    throw new Error(`reading-private-state-invalid: ${error.message}`);
  }
}

async function writeIntendedFile(filePath, previousHash, intendedHash, intendedContent, mismatchError, root) {
  await ensureSafeDirectory(root, path.dirname(filePath), 0o755);
  await assertNoSymlinkPath(root, filePath);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    content = null;
  }
  if (content != null && sha256(content) === intendedHash) return;
  if (previousHash == null && content != null) {
    throw new Error(`reading-unmanaged-file-exists: refusing to replace ${path.basename(filePath)} without a private ownership record.`);
  }
  if (previousHash != null && (content == null || sha256(content) !== previousHash)) {
    throw new Error(`reading-managed-file-conflict: ${path.basename(filePath)} changed since last verified write.`);
  }
  await writeAtomic(filePath, intendedContent, 0o644, root);
  if (await readFile(filePath, "utf8") !== intendedContent) throw new Error(`${mismatchError}: saved file differs after readback.`);
}

async function removeIntendedFile(filePath, previousHash, root) {
  if (!filePath) throw new Error("reading-remove-path-missing: cannot remove a public file without its recorded path.");
  await ensureSafeDirectory(root, path.dirname(filePath), 0o755);
  await assertNoSymlinkPath(root, filePath);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (previousHash == null || sha256(content) !== previousHash) {
    throw new Error(`reading-managed-file-conflict: ${path.basename(filePath)} changed since last verified write.`);
  }
  await rm(filePath);
  try {
    await readFile(filePath, "utf8");
    throw new Error(`reading-remove-readback-mismatch: ${path.basename(filePath)} still exists after removal.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readPrivateJson(filePath, root) {
  await assertNoSymlinkPath(root, filePath);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`reading-private-json-invalid: ${path.basename(filePath)}: ${error.message}`);
  }
}

async function readPrivateText(filePath, root) {
  await assertNoSymlinkPath(root, filePath);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("reading-completed-companion-missing: completed batch receipt points to a missing companion pack.");
    throw error;
  }
}

async function acquireLock(lockPath, root) {
  await assertNoSymlinkPath(root, lockPath);
  try {
    const lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    return lock;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const info = await stat(lockPath);
      if (Date.now() - info.mtimeMs > 15 * 60 * 1000) {
        await rm(lockPath, { force: true });
        const retry = await open(lockPath, "wx", 0o600);
        await retry.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
        return retry;
      }
    } catch (statError) {
      if (statError.code !== "ENOENT") throw statError;
      return acquireLock(lockPath, root);
    }
    throw new Error("reading-write-busy: another reading write is active; retry the same batch later.");
  }
}

async function writeAtomic(filePath, content, mode, root) {
  await ensureSafeDirectory(root, path.dirname(filePath), mode === 0o600 ? 0o700 : 0o755);
  await assertNoSymlinkPath(root, filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode, flag: "wx" });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writePrivateJson(filePath, value, root) {
  await ensureSafeDirectory(root, path.dirname(filePath), 0o700);
  await assertNoSymlinkPath(root, filePath);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeAtomic(filePath, content, 0o600, root);
  if (await readFile(filePath, "utf8") !== content) throw new Error(`reading-private-readback-mismatch: ${path.basename(filePath)} differs after readback.`);
}

async function writePrivateText(filePath, content, root) {
  await ensureSafeDirectory(root, path.dirname(filePath), 0o700);
  await assertNoSymlinkPath(root, filePath);
  const normalized = `${content.trim()}\n`;
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === normalized) return;
    throw new Error(`reading-companion-conflict: ${path.basename(filePath)} already exists with different content.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeAtomic(filePath, normalized, 0o600, root);
  if (await readFile(filePath, "utf8") !== normalized) throw new Error(`reading-private-readback-mismatch: ${path.basename(filePath)} differs after readback.`);
}

async function ensureSafeDirectory(root, directoryPath, mode) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(directoryPath);
  const relative = path.relative(absoluteRoot, absoluteDirectory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("reading-path-outside-root: refusing to write outside the Learn-X root.");
  }
  const rootInfo = await lstat(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("reading-path-symlink: Learn-X root must be a real directory.");
  const segments = relative.split(path.sep).filter(Boolean);
  let current = absoluteRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: index === segments.length - 1 ? mode : 0o755 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("reading-path-symlink: refusing to follow a symlink in the reading output path.");
    if (!info.isDirectory()) throw new Error("reading-path-not-directory: reading output parent must be a directory.");
  }
  if (segments.length) await chmod(absoluteDirectory, mode);
}

async function assertNoSymlinkPath(root, targetPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("reading-path-outside-root: refusing to write outside the Learn-X root.");
  }
  const rootInfo = await lstat(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("reading-path-symlink: Learn-X root must be a real directory.");
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("reading-path-symlink: refusing to follow a symlink in the reading output path.");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

function slugify(value) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hans-CN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "book";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function bookIdentity(book) {
  return `${book.title.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("zh-Hans-CN")}\n${book.author.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("zh-Hans-CN")}\n${book.bookId.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("zh-Hans-CN")}\n${book.edition.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("zh-Hans-CN")}`;
}

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replace(/\r?\n/g, " ");
}

function parseArgs(argv) {
  const inputPath = argv[0];
  if (!inputPath) throw new Error("usage: node store-reading.mjs <reading-batch.json>");
  return { inputPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { inputPath } = parseArgs(process.argv.slice(2));
  const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  const result = input?.recordId
    ? await updateReadingRecord(input)
    : await storeReadingBatch(input);
  console.log(JSON.stringify(result, null, 2));
}

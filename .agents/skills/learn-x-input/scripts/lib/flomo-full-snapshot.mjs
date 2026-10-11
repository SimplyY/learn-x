import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MAX_RECORDS = 20_000;
export const MAX_ACCEPTED_MISSING_RECORDS = 3;

export function defaultFlomoPrivateDataRoot() {
  return path.join(homedir(), "Library", "Application Support", "Learn-X", "flomo-review");
}

export function normalizeFlomoBody(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function flomoBodyHash(text) {
  return createHash("sha256").update(normalizeFlomoBody(text), "utf8").digest("hex");
}

export function flomoMemoUrl(memoId) {
  return `https://v.flomoapp.com/mine/?memo_id=${encodeURIComponent(memoId)}`;
}

export function validateFullFlomoScan(scan) {
  if (!scan || scan.mode !== "full" || scan.complete !== true || !Array.isArray(scan.records)) {
    throw new Error("flomo-full-scan-incomplete");
  }
  const count = scan.libraryCount;
  const termination = scan.termination;
  if (!Number.isInteger(count) || count < 0 || count > MAX_RECORDS || scan.records.length > MAX_RECORDS) {
    throw new Error("flomo-full-scan-capacity-exceeded");
  }
  const observedUniqueIds = scan.records.length;
  const missingCount = count - observedUniqueIds;
  const expectedReason = missingCount === 0 ? "library-count-and-stable-ids" : "stable-bottom-with-accepted-count-gap";
  if (scan.scanned !== observedUniqueIds || missingCount < 0 || missingCount > MAX_ACCEPTED_MISSING_RECORDS ||
      !termination || termination.expectedCount !== count || termination.observedUniqueIds !== observedUniqueIds ||
      termination.missingCount !== missingCount || termination.reason !== expectedReason ||
      !Number.isInteger(termination.stableScrollPasses) || termination.stableScrollPasses < 2 || termination.atBottom !== true ||
      termination.hasMore !== false || termination.loading !== false ||
      termination.enumerationComplete !== true) {
    throw new Error("flomo-full-scan-termination-unproven");
  }
  if (!Number.isInteger(scan.pageCount) || scan.pageCount < 1 ||
      !Number.isFinite(Date.parse(scan.scanStartedAt)) || !Number.isFinite(Date.parse(scan.scanFinishedAt)) ||
      Date.parse(scan.scanFinishedAt) < Date.parse(scan.scanStartedAt)) {
    throw new Error("flomo-full-scan-metadata-invalid");
  }
  const ids = new Set();
  const records = scan.records.map((record) => {
    if (!record || typeof record.memoId !== "string" || !record.memoId.trim() || ids.has(record.memoId)) {
      throw new Error("flomo-full-scan-identity-invalid");
    }
    ids.add(record.memoId);
    if (record.bodyComplete !== true || typeof record.bodyText !== "string" || !normalizeFlomoBody(record.bodyText)) {
      throw new Error("flomo-full-scan-body-incomplete");
    }
    const time = Date.parse(record.createdAt);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== record.createdAt ||
        typeof record.timeText !== "string" || !record.timeText.trim()) {
      throw new Error("flomo-full-scan-timestamp-invalid");
    }
    const expectedUrl = flomoMemoUrl(record.memoId);
    if (record.url !== expectedUrl) throw new Error("flomo-full-scan-link-invalid");
    if (record.tags !== undefined && (!Array.isArray(record.tags) ||
        record.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) {
      throw new Error("flomo-full-scan-tags-invalid");
    }
    const tags = record.tags === undefined ? undefined : [...new Set(record.tags
      .map((tag) => tag.trim().replace(/^#+/u, "").toLowerCase()).filter(Boolean))];
    return {
      memoId: record.memoId,
      url: record.url,
      createdAt: record.createdAt,
      timeText: record.timeText,
      bodyText: normalizeFlomoBody(record.bodyText),
      bodyHash: flomoBodyHash(record.bodyText),
      ...(tags ? { tags } : {}),
      isPinned: record.isPinned === true,
    };
  });
  if (records.length) {
    const detail = scan.detailVerification;
    if (!detail || detail.verified !== true || typeof detail.memoId !== "string" || !detail.memoId) {
      throw new Error("flomo-full-scan-detail-verification-missing");
    }
    const verifiedRecord = records.find((record) => record.memoId === detail.memoId);
    const longestRecord = [...records].sort((a, b) =>
      normalizeFlomoBody(b.bodyText).length - normalizeFlomoBody(a.bodyText).length || a.memoId.localeCompare(b.memoId))[0];
    if (!verifiedRecord || detail.method !== "original-link-detail-sheet-tiptap-prosemirror" ||
        detail.memoId !== longestRecord.memoId ||
        detail.bodyLength !== normalizeFlomoBody(verifiedRecord.bodyText).length ||
        detail.bodyHash !== flomoBodyHash(verifiedRecord.bodyText)) {
      throw new Error("flomo-full-scan-detail-verification-invalid");
    }
  }
  records.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.memoId.localeCompare(b.memoId));
  const coverage = {
    status: missingCount === 0 ? "complete" : "accepted-with-gaps",
    expectedCount: count,
    observedCount: observedUniqueIds,
    omittedCount: missingCount,
    ratio: count === 0 ? 1 : observedUniqueIds / count,
    policy: "up-to-three-unresolved-records-v1",
  };
  return { ...scan, records, coverage };
}

export function createOnlineFlomoSnapshot(scan) {
  const validated = validateFullFlomoScan(scan);
  return {
    schemaVersion: 1,
    sourceMode: "flomo-online-full",
    snapshotId: randomUUID(),
    capturedAt: validated.scanFinishedAt,
    scanStartedAt: validated.scanStartedAt,
    scanFinishedAt: validated.scanFinishedAt,
    pageCount: validated.pageCount,
    totalCount: validated.records.length,
    coverage: structuredClone(validated.coverage),
    pinnedCount: validated.records.filter((record) => record.isPinned).length,
    termination: structuredClone(validated.termination),
    detailVerification: validated.detailVerification || null,
    records: validated.records.map(({ bodyText, ...record }) => ({ ...record, body: bodyText })),
  };
}

export function renderOnlineFlomoCard(snapshot, record = getDetailVerifiedRecord(snapshot)) {
  if (!record) throw new Error("flomo-full-snapshot-empty-preview");
  const excerpt = [...record.body].slice(0, 180).join("").trim();
  const snapshotAt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(snapshot.capturedAt));
  return {
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: "Flomo 回顾｜本地预览" },
      subtitle: { tag: "plain_text", content: `笔记快照：${snapshotAt} · 覆盖 ${snapshot.coverage.observedCount}/${snapshot.coverage.expectedCount} · 漏项 ${snapshot.coverage.omittedCount} 条 · ${(snapshot.coverage.ratio * 100).toFixed(2)}% · 策略 ${snapshot.coverage.policy}` },
      template: "indigo",
    },
    body: { elements: [
      { tag: "markdown", content: `**${excerpt.slice(0, 8) || "回顾样例"}**\n\n${excerpt}` },
      { tag: "markdown", text_size: "notation", content: `${record.createdAt.slice(0, 10)} · [Flomo 原文](${record.url})` },
      { tag: "markdown", text_size: "notation", content: "本地验收预览，不会发送。" },
    ] },
  };
}

function getDetailVerifiedRecord(snapshot) {
  const memoId = snapshot?.detailVerification?.memoId;
  const record = snapshot?.records?.find((item) => item.memoId === memoId);
  if (!record) throw new Error("flomo-full-snapshot-preview-link-missing");
  return record;
}

export function renderOnlineFlomoPreview(snapshot, card, record) {
  if (!record || !snapshot.records.some((item) => item.memoId === record.memoId && item.url === record.url)) {
    throw new Error("flomo-full-snapshot-preview-link-missing");
  }
  const terminationReason = snapshot.coverage.omittedCount === 0
    ? "UI 笔记总数与稳定 ID 集一致"
    : `稳定到底并在策略上限内接受 ${snapshot.coverage.omittedCount} 条未枚举缺口（${snapshot.coverage.observedCount}/${snapshot.coverage.expectedCount}）`;
  return [
    "# Flomo 线上全量快照｜本地 Card 2.0 预览（不发送）",
    "",
    `- 快照时间：${snapshot.capturedAt}`,
    `- 快照 ID：${snapshot.snapshotId}`,
    `- 记录：${snapshot.coverage.observedCount}/${snapshot.coverage.expectedCount}（覆盖率 ${(snapshot.coverage.ratio * 100).toFixed(2)}%，漏项约 ${snapshot.coverage.omittedCount} 条；策略 ${snapshot.coverage.policy}）`,
    `- 结束依据：${terminationReason}；稳定滚动 ${snapshot.termination.stableScrollPasses} 次；无后续页、无加载状态。`,
    "",
    "```json",
    JSON.stringify(card, null, 2),
    "```",
    "",
    `原文链接：[在 Flomo 打开](${record.url})`,
    "",
  ].join("\n");
}

export async function writeStagedOnlineFlomoSnapshot(repoRoot, scan, {
  storageRoot,
  snapshotPath,
  previewPath,
} = {}) {
  const snapshot = createOnlineFlomoSnapshot(scan);
  const runtime = storageRoot || path.join(repoRoot, "04_output/_dist/flomo-review");
  const stagePath = snapshotPath || path.join(runtime, "staged", `online-snapshot-${snapshot.snapshotId}.json`);
  const previewRecord = getDetailVerifiedRecord(snapshot);
  const card = renderOnlineFlomoCard(snapshot, previewRecord);
  const renderedPreview = renderOnlineFlomoPreview(snapshot, card, previewRecord);
  const renderedCard = `${JSON.stringify(card, null, 2)}\n`;
  const previewFile = previewPath || path.join(runtime, "staged", `online-snapshot-${snapshot.snapshotId}-preview.md`);
  const cardFile = `${previewFile}.card.json`;
  const stageDirectory = path.resolve(path.dirname(stagePath));
  if ([stagePath, previewFile, cardFile].some((file) => path.dirname(path.resolve(file)) !== stageDirectory)) {
    throw new Error("flomo-full-snapshot-bundle-paths-must-share-directory");
  }
  await ensurePrivateDirectory(runtime);
  if (stageDirectory !== path.resolve(runtime)) await ensurePrivateDirectory(stageDirectory);
  const renderedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
  const bundlePath = `${stagePath}.bundle.json`;
  await atomicWrite(stagePath, renderedSnapshot);
  await atomicWrite(previewFile, renderedPreview);
  await atomicWrite(cardFile, renderedCard);
  const bundle = {
    schemaVersion: 1,
    sourceMode: snapshot.sourceMode,
    snapshotId: snapshot.snapshotId,
    files: {
      snapshot: { path: path.basename(stagePath), sha256: sha256(renderedSnapshot) },
      preview: { path: path.basename(previewFile), sha256: sha256(renderedPreview) },
      card: { path: path.basename(cardFile), sha256: sha256(renderedCard) },
    },
  };
  // This marker is the bundle commit point. Activation rejects artifacts without it.
  await atomicWrite(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return { snapshot, snapshotPath: stagePath, previewPath: previewFile, cardPath: cardFile, bundlePath };
}

export async function readVerifiedStagedOnlineFlomoSnapshot(snapshotPath) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const stageDirectory = path.dirname(resolvedSnapshotPath);
  const bundlePath = `${resolvedSnapshotPath}.bundle.json`;
  let snapshot;
  let bundle;
  let snapshotContent;
  try {
    snapshotContent = await readFile(resolvedSnapshotPath, "utf8");
    snapshot = JSON.parse(snapshotContent);
    bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  } catch {
    throw new Error("online-snapshot-bundle-invalid");
  }
  if (snapshot?.sourceMode !== "flomo-online-full" || typeof snapshot.snapshotId !== "string" ||
      bundle?.schemaVersion !== 1 || bundle.sourceMode !== snapshot.sourceMode || bundle.snapshotId !== snapshot.snapshotId) {
    throw new Error("online-snapshot-bundle-invalid");
  }
  const expectedSnapshotName = path.basename(resolvedSnapshotPath);
  const artifactEntries = [
    [bundle.files?.snapshot, expectedSnapshotName, snapshotContent],
    [bundle.files?.preview, null, null],
    [bundle.files?.card, null, null],
  ];
  for (const [entry, expectedName, knownContent] of artifactEntries) {
    const name = entry?.path;
    if (typeof name !== "string" || !name || name === "." || name === ".." || path.basename(name) !== name ||
        (expectedName && name !== expectedName) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("online-snapshot-bundle-invalid");
    }
    let content = knownContent;
    try { content ??= await readFile(path.join(stageDirectory, name), "utf8"); }
    catch { throw new Error("online-snapshot-bundle-invalid"); }
    if (sha256(content) !== entry.sha256) throw new Error("online-snapshot-bundle-invalid");
  }
  return {
    snapshot,
    bundlePath,
    previewPath: path.join(stageDirectory, bundle.files.preview.path),
    cardPath: path.join(stageDirectory, bundle.files.card.path),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  const fd = await open(temp, "wx", 0o600);
  try { await fd.writeFile(content, "utf8"); await fd.sync(); } finally { await fd.close(); }
  try { await rename(temp, filePath); }
  finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("flomo-full-snapshot-storage-directory-not-private");
  }
}

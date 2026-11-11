import { readFile, writeFile, mkdir, rename, unlink, readdir, open, copyFile, lstat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns';
import https from 'node:https';
import os from 'node:os';
import { mkdtemp, rm, writeFile as writeFileRaw, unlink as unlinkRaw } from 'node:fs/promises';
import { scanArchive, scanOnlineSnapshot, hashBody } from './catalog.mjs';
import { assertFlomoPathWithinRoot, defaultFlomoPrivateDataRoot, readVerifiedStagedOnlineFlomoSnapshot,
  resolveFlomoPathAllowed, resolveFlomoPathAllowedSync } from '../../learn-x-input/scripts/lib/flomo-full-snapshot.mjs';
import { flomoTags } from '../../learn-x-input/scripts/lib/flomo-filter.mjs';
import { validateSelection, eligibleNotes, simulateSupply, isoWeek, activeWeeks, MIN_REVIEW_ITEMS, TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS, MAX_REVIEW_REASON_CHARS } from './policy.mjs';
import { runLarkCli, preflightDelivery, auditRecentReviewHistory, sendRecommendation, recoverRecommendation, collectFeedback, cardContentSha256 } from './delivery.mjs';
import { buildReviewContext, validateEvidence, sha256, shanghaiDate, validDate } from './context.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
function safeProjectPath(projectRoot, candidate) {
  return assertFlomoPathWithinRoot(projectRoot, resolveFlomoPathAllowedSync(candidate));
}
function safePrivatePath(p, candidate) {
  return safeProjectPath(p.privateRoot, candidate);
}
function safeBackupPath(p, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw Error('online-storage-backup-invalid');
  const safe = safePrivatePath(p, candidate);
  const relative = path.relative(p.backupsRoot, safe);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Error('online-storage-backup-invalid');
  }
  return safe;
}
async function resolveProjectPath(projectRoot, candidate) {
  const safeRoot = await resolveFlomoPathAllowed(projectRoot);
  return assertFlomoPathWithinRoot(safeRoot, await resolveFlomoPathAllowed(candidate));
}
async function writeProjectFile(projectRoot, file, content, options) {
  await writeFile(await resolveProjectPath(projectRoot, file), content, options);
}
async function makeProjectDirectory(projectRoot, directory) {
  const safeDirectory = await resolveProjectPath(projectRoot, directory);
  await mkdir(safeDirectory, { recursive: true });
  return safeDirectory;
}
async function copyProjectFile(projectRoot, source, destination) {
  await copyFile(await resolveProjectPath(projectRoot, source), await resolveProjectPath(projectRoot, destination));
}
async function unlinkProjectFile(projectRoot, file) {
  await unlink(await resolveProjectPath(projectRoot, file));
}
export function paths(root = repoRoot) {
  const projectRoot = resolveFlomoPathAllowedSync(root);
  const insideProject = (candidate) => assertFlomoPathWithinRoot(projectRoot, resolveFlomoPathAllowedSync(candidate));
  const legacyRuntime = insideProject(path.join(projectRoot, '04_output/_dist/flomo-review'));
  const legacyCatalog = insideProject(path.join(projectRoot, '03_input/_archives/flomo/catalog.json'));
  const privateRoot = insideProject(defaultFlomoPrivateDataRoot(projectRoot));
  const storageModePath = insideProject(path.join(privateRoot, 'storage-mode.json'));
  const onlineStorageActive = existsSync(storageModePath);
  let storageState = null;
  if (onlineStorageActive) {
    try { storageState = JSON.parse(readFileSync(storageModePath, 'utf8')); }
    catch { throw Error('online-storage-state-invalid'); }
  }
  const runtime = onlineStorageActive ? privateRoot : legacyRuntime;
  const versionedPath = (field, fallback, suffix) => {
    const value = storageState?.[field];
    if (value == null) return insideProject(path.join(privateRoot, fallback));
    if (typeof value !== 'string' || !new RegExp(`^snapshots/[A-Za-z0-9_-]+\\.${suffix}\\.json$`).test(value)) throw Error('online-storage-state-invalid');
    return insideProject(path.join(privateRoot, value));
  };
  let activeSnapshotRelativePath = null;
  let activeSnapshotPath = null;
  let backupPath = null;
  const backupsRoot = insideProject(path.join(privateRoot, 'backups'));
  if (onlineStorageActive) {
    activeSnapshotRelativePath = storageState?.activeSnapshotPath;
    if (typeof activeSnapshotRelativePath !== 'string' || !/^snapshots\/[A-Za-z0-9_-]+\.json$/.test(activeSnapshotRelativePath)) {
      throw Error('online-storage-state-invalid');
    }
    activeSnapshotPath = insideProject(path.join(privateRoot, activeSnapshotRelativePath));
    if (typeof storageState?.backupPath !== 'string' || !path.isAbsolute(storageState.backupPath)) throw Error('online-storage-state-invalid');
    backupPath = insideProject(storageState.backupPath);
    const backupRelative = path.relative(backupsRoot, backupPath);
    if (!backupRelative || backupRelative === '..' || backupRelative.startsWith(`..${path.sep}`) || path.isAbsolute(backupRelative)) {
      throw Error('online-storage-state-invalid');
    }
  }
  const catalog = onlineStorageActive ? versionedPath('activeCatalogPath', 'catalog.json', 'catalog') : legacyCatalog;
  const ledger = onlineStorageActive ? versionedPath('activeLedgerPath', 'ledger.json', 'ledger') : insideProject(path.join(runtime, 'ledger.json'));
  return { root: projectRoot, runtime, catalog, ledger, config: insideProject(path.join(projectRoot, '00_config/flomo-review.json')),
    privateRoot, lockPath: insideProject(path.join(privateRoot, 'write.lock')), storageModePath,
    onlineStorageActive, legacyRuntime, legacyCatalog, activeSnapshotRelativePath, activeSnapshotPath, backupsRoot, backupPath };
}
export async function readJson(file, fallback) {
  const safeFile = await resolveFlomoPathAllowed(file);
  try { return JSON.parse(await readFile(safeFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e; }
}
export async function atomicJson(file, value, projectRoot) {
  const safeFile = projectRoot ? await resolveProjectPath(projectRoot, file) : await resolveFlomoPathAllowed(file);
  await mkdir(path.dirname(safeFile), { recursive: true });
  const tmp = `${safeFile}.${randomUUID()}.tmp`, fd = await open(tmp, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`); await fd.sync(); } finally { await fd.close(); }
  try { await rename(tmp, safeFile); } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function checkPrivateDirectory(directory, { create = false, projectRoot } = {}) {
  const safeDirectory = projectRoot ? await resolveProjectPath(projectRoot, directory) : await resolveFlomoPathAllowed(directory);
  if (create) await mkdir(safeDirectory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw Error('review-private-directory-insecure');
  }
}
async function ensurePrivateDirectory(directory, projectRoot) {
  await checkPrivateDirectory(directory, { create: true, projectRoot });
}
export async function withLock(root, action) {
  const p = paths(root), { privateRoot, lockPath } = p;
  await ensurePrivateDirectory(privateRoot, p.root);
  const safeRoot = await resolveFlomoPathAllowed(privateRoot);
  const lock = assertFlomoPathWithinRoot(safeRoot, await resolveFlomoPathAllowed(lockPath)); let fd;
  try { fd = await open(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw Error('review-locked-inspect-owner-before-recovery'); throw e; }
  try { await fd.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await action(); }
  finally { await fd.close(); await unlink(lock); }
}
export const emptyLedger = () => ({ schemaVersion: 1, batches: {}, feedback: {}, failures: [] });
function assertLedger(value) {
  if (value.schemaVersion !== 1 || !value.batches || typeof value.batches !== 'object' || !value.feedback) throw Error('ledger-invalid');
  return value;
}
export function catalogHash(catalog) {
  return sha256(JSON.stringify({ sourceMode: catalog.sourceMode || 'legacy-archive', snapshot: catalog.snapshot || null,
    dedupeGeneration: catalog.dedupeGeneration || 'legacy',
    notes: catalog.notes.map(n => ({ noteKey: n.noteKey, aliases: n.aliases, groupKey: n.groupKey, groupAliases: n.groupAliases, bodyHash: n.bodyHash, quality: n.quality, sources: n.sources })) }));
}
function normalizeImageConfig(config) {
  const images = config?.images ?? {};
  if (!images || images.enabled === false) return { enabled: false, maxPerNote: 0, maxTotal: 0 };
  if (images.enabled !== true) return { enabled: false, maxPerNote: 0, maxTotal: 0 };
  const maxPerNote = images.maxPerNote ?? 6, maxTotal = images.maxTotal ?? 20;
  if (!Number.isInteger(maxPerNote) || maxPerNote < 1 || maxPerNote > 6 ||
      !Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 20) throw Error('review-images-config-invalid');
  return { enabled: true, maxPerNote, maxTotal };
}
function unsafeImageHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || ['localhost', 'ip6-localhost', 'ip6-loopback'].includes(host)) return true;
  return isIP(host) ? unsafeImageIP(host) : false;
}
function unsafeImageIP(address) {
  const type = isIP(address);
  if (type === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      a >= 224;
  }
  if (type === 6) {
    const value = address.toLowerCase();
    if (value === '::' || value === '::1' || value.startsWith('::ffff:')) return true;
    const [head, tail = ''] = value.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0 || headGroups.length + tailGroups.length > 8) return true;
    const groups = [...headGroups, ...Array(fill).fill(0), ...tailGroups].map(group => Number.parseInt(group, 16));
    if (groups.length !== 8 || groups.some(Number.isNaN)) return true;
    if (groups[0] === 0x64 && groups[1] === 0xff9b) return true;
    if (groups.slice(0, 5).every(group => group === 0)) return true;
    if (groups[0] === 0x2001 && (groups[1] === 0x0000 || groups[1] === 0x0db8)) return true;
    if (groups[0] === 0x2002 || (groups[0] & 0xfe00) === 0xfc00 ||
        (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) return true;
    if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) return true;
    return false;
  }
  return true;
}
function safeImageLookup(hostname, options, callback) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const safeAddresses = (Array.isArray(addresses) ? addresses : [addresses])
      .filter(address => address && !unsafeImageIP(address.address));
    if (!safeAddresses.length) return callback(Error('review-image-url-invalid'));
    callback(null, safeAddresses[0].address, safeAddresses[0].family);
  });
}
function assertImageUrl(candidate) {
  let parsed;
  try { parsed = new URL(candidate); } catch { throw Error('review-image-url-invalid'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
      unsafeImageHost(parsed.hostname)) throw Error('review-image-url-invalid');
  return parsed;
}
function httpsImageRequest(parsed, maxBytes) {
  return new Promise((resolve, reject) => {
    const request = https.request(parsed, { method: 'GET', lookup: safeImageLookup, timeout: 15_000 }, response => {
      const headers = { get(name) { return response.headers[String(name).toLowerCase()] ?? null; } };
      if (response.statusCode < 200 || response.statusCode >= 400) {
        reject(Error(response.statusCode >= 400 ? 'review-image-download-failed' : 'review-image-redirect-invalid'));
        return;
      }
      const declaredSize = Number(response.headers['content-length'] ?? NaN);
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        reject(Error('review-image-format-invalid'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy();
          reject(Error('review-image-format-invalid'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode,
        headers,
        bytes: Buffer.concat(chunks),
      }));
    });
    request.on('timeout', () => request.destroy(Error('review-image-download-failed')));
    request.on('error', reject);
    request.end();
  });
}
async function httpsDownloadImage(candidate, maxBytes = 10 * 1024 * 1024) {
  let parsed = assertImageUrl(candidate);
  for (let redirects = 0;; redirects++) {
    if (redirects > 3) throw Error('review-image-redirect-too-many');
    const response = await httpsImageRequest(parsed, maxBytes);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      let next;
      try { next = new URL(location, parsed); } catch { throw Error('review-image-redirect-invalid'); }
      if (next.protocol !== 'https:' || next.origin !== parsed.origin || next.username || next.password ||
          unsafeImageHost(next.hostname)) throw Error('review-image-redirect-unsafe');
      parsed = next;
      continue;
    }
    return response;
  }
}
function validateImageMagic(bytes, mime) {
  const data = bytes.subarray(0, 12);
  const isPng = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isGif = data.subarray(0, 3).toString('latin1') === 'GIF';
  const isWebp = data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  if ((mime === 'image/png' && !isPng) || (mime === 'image/jpeg' && !isJpeg) ||
      (mime === 'image/gif' && !isGif) || (mime === 'image/webp' && !isWebp)) {
    throw Error('review-image-format-invalid');
  }
}
async function downloadImage(candidate, { fetchFn = fetch, maxBytes = 10 * 1024 * 1024 } = {}) {
  let response;
  if (fetchFn === fetch) {
    response = await httpsDownloadImage(candidate, maxBytes);
  } else {
    let parsed = assertImageUrl(candidate);
    response = await fetchFn(parsed, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    let redirects = 0;
    while (response.status >= 300 && response.status < 400) {
      if (++redirects > 3) throw Error('review-image-redirect-too-many');
      const location = response.headers.get('location');
      let next;
      try { next = new URL(location, parsed); } catch { throw Error('review-image-redirect-invalid'); }
      if (next.protocol !== 'https:' || next.origin !== parsed.origin || next.username || next.password ||
          unsafeImageHost(next.hostname)) throw Error('review-image-redirect-unsafe');
      parsed = next;
      response = await fetchFn(parsed, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    }
    response.bytes = await response.arrayBuffer();
  }
  if (!response.status || response.status < 200 || response.status >= 300) throw Error('review-image-download-failed');
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const bytes = Buffer.from(response.bytes);
  if (!IMAGE_MIME_EXTENSIONS.has(mime) || !bytes.byteLength || bytes.byteLength > maxBytes) {
    throw Error('review-image-format-invalid');
  }
  validateImageMagic(bytes, mime);
  return { bytes, mime, size: bytes.byteLength };
}
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'], ['image/webp', '.webp'],
]);
function bytesSha256(bytes) {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_KEY_PATTERN = /^img_v3_[A-Za-z0-9_-]{8,128}$/;
function imageSourceHash(items, notes) {
  const noteMap = new Map(notes.map(note => [note.noteKey, note]));
  const source = items.map(item => {
    const note = noteMap.get(item.noteKey);
    const images = Array.isArray(note?.images) ? note.images : [];
    const imageCount = Number.isSafeInteger(note?.imageCount) ? note.imageCount : images.length;
    return [item.noteKey, images, imageCount];
  });
  return sha256(JSON.stringify(source));
}
function imageUploadPlan(items, notes, settings) {
  const noteMap = new Map(notes.map(note => [note.noteKey, note]));
  let remaining = settings.maxTotal;
  return items.map(item => {
    const note = noteMap.get(item.noteKey);
    const images = Array.isArray(note?.images) ? note.images : [];
    const imageCount = Number.isSafeInteger(note?.imageCount) ? note.imageCount : images.length;
    const eligible = Math.min(imageCount, settings.maxPerNote);
    const attempts = Math.min(eligible, remaining);
    remaining -= attempts;
    return { noteKey: item.noteKey, note, images, imageCount, eligible, attempts };
  });
}
export async function resolveReviewImages({ items, notes, config, date, catalogHash: currentCatalogHash,
  preResolvedImages, runCli = runLarkCli, fetchFn = fetch } = {}) {
  const settings = normalizeImageConfig(config);
  if (!settings.enabled) {
    return { schemaVersion: 1, date, catalogHash: currentCatalogHash, enabled: false,
      maxPerNote: settings.maxPerNote, maxTotal: settings.maxTotal, images: [],
      imageKeysByNote: new Map(),
      stats: { candidateImageCount: 0, selectedImageCount: 0, skippedImageCount: 0, truncatedPerNoteCount: 0, truncatedTotalCount: 0 } };
  }
  if (preResolvedImages) {
    const receipt = preResolvedImages;
    const plan = imageUploadPlan(items, notes, settings);
    if (receipt?.schemaVersion !== 1 || receipt.date !== date || receipt.catalogHash !== currentCatalogHash ||
        receipt.enabled !== true || receipt.maxPerNote !== settings.maxPerNote || receipt.maxTotal !== settings.maxTotal ||
        receipt.sourceHash !== imageSourceHash(items, notes) ||
        !Array.isArray(receipt.images) || !Array.isArray(receipt.attemptedImages) ||
        typeof receipt.stats !== 'object' || receipt.stats === null) {
      throw Error('review-images-preview-invalid');
    }
    const selectedNotes = new Map(notes.map(note => [note.noteKey, note]));
    const keysByNote = new Map();
    const selectedByNote = new Map();
    const attemptedBySource = new Set();
    const uploadedBySource = new Set();
    let uploadedAttemptCount = 0, failedAttemptCount = 0;
    for (const attempt of receipt.attemptedImages) {
      const entry = plan.find(entry => entry.noteKey === attempt?.noteKey);
      if (typeof attempt?.noteKey !== 'string' || !entry ||
          !Number.isSafeInteger(attempt.position) || attempt.position < 0 || attempt.position >= entry.eligible ||
          !/^[a-f0-9]{64}$/.test(attempt.sourceUrlHash ?? '') ||
          attempt.sourceUrlHash !== sha256(entry.images[attempt.position]?.url ?? '') ||
          !['uploaded', 'failed'].includes(attempt.outcome)) {
        throw Error('review-images-preview-invalid');
      }
      const attemptKey = `${attempt.noteKey}:${attempt.position}`;
      if (attemptedBySource.has(attemptKey)) throw Error('review-images-preview-invalid');
      attemptedBySource.add(attemptKey);
      if (attempt.outcome === 'uploaded') uploadedBySource.add(attemptKey);
      attempt.outcome === 'uploaded' ? uploadedAttemptCount += 1 : failedAttemptCount += 1;
    }
    for (const image of receipt.images) {
      if (typeof image?.noteKey !== 'string' || !selectedNotes.has(image.noteKey) ||
          !/^[a-f0-9]{64}$/.test(image.sourceUrlHash ?? '') || !/^[a-f0-9]{64}$/.test(image.sha256 ?? '') ||
          !Number.isSafeInteger(image.size) || image.size < 1 || typeof image.mime !== 'string' ||
          !IMAGE_MIME_EXTENSIONS.has(image.mime) || image.size > MAX_IMAGE_BYTES ||
          typeof image.imgKey !== 'string' || !IMAGE_KEY_PATTERN.test(image.imgKey)) {
        throw Error('review-images-preview-invalid');
      }
      const entry = plan.find(entry => entry.noteKey === image.noteKey);
      if (!entry || !Number.isSafeInteger(image.position) || image.position < 0 ||
          image.position >= entry.eligible || image.sourceUrlHash !== sha256(entry.images[image.position]?.url ?? '')) {
        throw Error('review-images-preview-invalid');
      }
      const selected = selectedByNote.get(image.noteKey) ?? new Map();
      if (selected.has(image.position)) throw Error('review-images-preview-invalid');
      selected.set(image.position, image.imgKey);
      selectedByNote.set(image.noteKey, selected);
    }
    const seenKeys = new Set();
    let totalImages = 0;
    for (const [noteKey, selected] of selectedByNote) {
      if (selected.size > settings.maxPerNote) throw Error('review-images-preview-invalid');
      for (const [position, key] of [...selected].sort(([left], [right]) => left - right)) {
        if (seenKeys.has(key)) throw Error('review-images-preview-invalid');
        seenKeys.add(key);
        totalImages += 1;
        const keys = keysByNote.get(noteKey) ?? [];
        keys.push(key);
        keysByNote.set(noteKey, keys);
      }
    }
    const candidateImageCount = plan.reduce((sum, entry) => sum + entry.imageCount, 0);
    const truncatedPerNoteCount = plan.reduce((sum, entry) =>
      sum + Math.max(0, entry.imageCount - settings.maxPerNote), 0);
    const stats = receipt.stats;
    const numericStats = ['candidateImageCount', 'selectedImageCount', 'skippedImageCount',
      'truncatedPerNoteCount', 'truncatedTotalCount'].every(name =>
      Number.isSafeInteger(stats[name]) && stats[name] >= 0);
    if (totalImages > settings.maxTotal || !numericStats ||
        stats.candidateImageCount !== candidateImageCount ||
        stats.selectedImageCount !== receipt.images.length || stats.selectedImageCount !== totalImages ||
        stats.skippedImageCount !== failedAttemptCount ||
        receipt.attemptedImages.length !== stats.skippedImageCount + totalImages ||
        uploadedAttemptCount !== totalImages ||
        [...selectedByNote].some(([noteKey, selected]) =>
          [...selected.keys()].some(position => !uploadedBySource.has(`${noteKey}:${position}`))) ||
        stats.truncatedTotalCount !== candidateImageCount - totalImages -
          failedAttemptCount - truncatedPerNoteCount ||
        stats.truncatedTotalCount < 0 ||
        stats.truncatedPerNoteCount !== truncatedPerNoteCount) {
      throw Error('review-images-preview-invalid');
    }
    return { ...receipt, imageKeysByNote: keysByNote };
  }
  const noteMap = new Map(notes.map(note => [note.noteKey, note]));
  let candidateImageCount = 0, selectedImageCount = 0, skippedImageCount = 0, truncatedPerNoteCount = 0, truncatedTotalCount = 0;
  const metadata = [];
  const attemptedImages = [];
  const imageKeysByNote = new Map();
  let uploadCount = 0;
  for (const item of items) {
    const note = noteMap.get(item.noteKey);
    if (!note) throw Error('review-image-note-missing');
    const images = Array.isArray(note.images) ? note.images : [];
    const imageCount = Number.isSafeInteger(note.imageCount) ? note.imageCount : images.length;
    candidateImageCount += imageCount;
    const eligible = images.slice(0, settings.maxPerNote);
    truncatedPerNoteCount += Math.max(0, imageCount - eligible.length);
    const uploads = eligible.slice(0, Math.max(0, settings.maxTotal - uploadCount));
    truncatedTotalCount += eligible.length - uploads.length;
    const keys = [];
    if (uploads.length) {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'flomo-review-'));
      try {
        for (const [index, image] of uploads.entries()) {
          let target;
          const sourceUrlHash = sha256(image.url);
          try {
            const downloaded = await downloadImage(image.url, { fetchFn });
            const extension = IMAGE_MIME_EXTENSIONS.get(downloaded.mime);
            target = path.join(tmpDir, `img-${index}${extension}`);
            await writeFileRaw(target, new Uint8Array(downloaded.bytes), { mode: 0o600 });
            const payload = await runCli(['im', 'images', 'create', '--data', JSON.stringify({ image_type: 'message' }),
              '--file', `image=./${path.basename(target)}`, '--as', 'bot', '--format', 'json'], { cwd: tmpDir });
            const imgKey = payload?.data?.image_key ?? payload?.image_key;
            if (typeof imgKey !== 'string' || !imgKey) throw Error('review-image-upload-key-missing');
            metadata.push({ noteKey: note.noteKey, position: image.position, sourceUrlHash,
              sha256: bytesSha256(downloaded.bytes), size: downloaded.size, mime: downloaded.mime, imgKey });
            attemptedImages.push({ noteKey: note.noteKey, position: image.position,
              sourceUrlHash, outcome: 'uploaded' });
            keys.push(imgKey);
            uploadCount += 1;
            selectedImageCount += 1;
          } catch {
            if (!attemptedImages.some(attempt => attempt.noteKey === note.noteKey && attempt.position === image.position)) {
              attemptedImages.push({ noteKey: note.noteKey, position: image.position, sourceUrlHash, outcome: 'failed' });
            }
            skippedImageCount += 1;
            if (target) await unlinkRaw(target).catch(() => {});
          }
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
    if (keys.length) imageKeysByNote.set(note.noteKey, keys);
  }
  return { schemaVersion: 1, date, catalogHash: currentCatalogHash, sourceHash: imageSourceHash(items, notes), enabled: true,
    maxPerNote: settings.maxPerNote, maxTotal: settings.maxTotal, images: metadata, attemptedImages,
    stats: { candidateImageCount, selectedImageCount, skippedImageCount, truncatedPerNoteCount, truncatedTotalCount },
    imageKeysByNote };
}
function assertMatchingDedupeGeneration(catalog, ledger) {
  if ((catalog.dedupeGeneration || 'legacy') !== (ledger.dedupeGeneration || 'legacy')) throw Error('dedupe-generation-mismatch');
}
export async function refreshArchive(root = repoRoot) {
  return withLock(root, async () => {
    const p = paths(root), previous = await readJson(p.catalog, { schemaVersion: 1, notes: [] });
    let catalog;
    if (p.onlineStorageActive) {
      const state = await readJson(p.storageModePath);
      if (state.schemaVersion !== 1 || state.sourceMode !== 'flomo-online-full' ||
          typeof state.activeSnapshotPath !== 'string' || !/^snapshots\/[A-Za-z0-9_-]+\.json$/.test(state.activeSnapshotPath) ||
          state.activeSnapshotPath !== p.activeSnapshotRelativePath) {
        throw Error('online-storage-state-invalid');
      }
      const snapshotPath = safePrivatePath(p, path.join(p.privateRoot, state.activeSnapshotPath));
      const snapshot = await readJson(snapshotPath);
      catalog = scanOnlineSnapshot(snapshot, { previous, sourcePath: snapshotPath });
    } else catalog = await scanArchive(root, { previous });
    catalog.updatedAt = new Date().toISOString(); catalog.catalogHash = catalogHash(catalog);
    await atomicJson(p.catalog, catalog, p.root);
    return { notes: catalog.notes.length, eligibleQuality: catalog.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: catalog.excluded.length, coverage: catalog.coverage };
  });
}

export async function activateOnlineSnapshot(root = repoRoot, stagedSnapshotPath, { beforeCommit } = {}) {
  if (typeof stagedSnapshotPath !== 'string' || !stagedSnapshotPath) throw Error('online-snapshot-path-required');
  const before = paths(root);
  const { snapshot: staged } = await readVerifiedStagedOnlineFlomoSnapshot(path.resolve(stagedSnapshotPath), { storageRoot: before.privateRoot });
  if (staged.sourceMode !== 'flomo-online-full' || typeof staged.snapshotId !== 'string' || !staged.snapshotId) throw Error('online-snapshot-invalid');
  if (before.onlineStorageActive) {
    const state = await readJson(before.storageModePath);
    if (state.activeSnapshotId === staged.snapshotId) return { status: 'already-active', snapshotId: staged.snapshotId, coverage: state.coverage };
  }
  return withLock(root, async () => {
    const p = paths(root);
    const activeState = p.onlineStorageActive ? await readJson(p.storageModePath) : null;
    if (activeState?.activeSnapshotId === staged.snapshotId) {
      return { status: 'already-active', snapshotId: staged.snapshotId, coverage: activeState.coverage };
    }
    if (activeState && (activeState.schemaVersion !== 1 || activeState.sourceMode !== 'flomo-online-full' ||
        !activeState.dedupeGeneration || !activeState.activeSnapshotPath || !activeState.backupPath)) throw Error('online-storage-state-invalid');
    if (activeState) {
      if (activeState.activeSnapshotPath !== p.activeSnapshotRelativePath) throw Error('online-storage-state-invalid');
      const activeSnapshot = await readJson(safePrivatePath(p, path.join(p.privateRoot, activeState.activeSnapshotPath)));
      const activeCapturedAt = Date.parse(activeSnapshot.capturedAt || activeSnapshot.scanFinishedAt || '');
      const stagedCapturedAt = Date.parse(staged.capturedAt || staged.scanFinishedAt || '');
      if (!Number.isFinite(activeCapturedAt) || !Number.isFinite(stagedCapturedAt)) throw Error('online-snapshot-timestamp-invalid');
      if (stagedCapturedAt <= activeCapturedAt) throw Error('online-snapshot-not-newer-than-active');
    }
    const previousCatalog = p.onlineStorageActive ? await readJson(p.catalog) : await readJson(p.legacyCatalog, { schemaVersion: 1, notes: [], excluded: [] });
    const previousLedger = p.onlineStorageActive
      ? assertLedger(await readJson(p.ledger))
      : assertLedger(await readJson(path.join(p.legacyRuntime, 'ledger.json'), emptyLedger()));
    const generation = activeState?.dedupeGeneration || `online-${staged.snapshotId}`;
    const snapshotRelativePath = `snapshots/${staged.snapshotId}.json`;
    const catalogRelativePath = `snapshots/${staged.snapshotId}.catalog.json`;
    const ledgerRelativePath = `snapshots/${staged.snapshotId}.ledger.json`;
    const snapshotAbsolutePath = path.join(p.privateRoot, snapshotRelativePath);
    const snapshotsRoot = path.join(p.privateRoot, 'snapshots');
    const backupsRoot = path.join(p.privateRoot, 'backups');
    await ensurePrivateDirectory(snapshotsRoot, p.root);
    await ensurePrivateDirectory(backupsRoot, p.root);
    let backupPath = activeState ? safeBackupPath(p, activeState.backupPath) : null;
    if (!activeState) {
      backupPath = path.join(backupsRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
      await ensurePrivateDirectory(backupPath, p.root);
      for (const [source, name] of [[p.legacyCatalog, 'legacy-catalog.json'], [path.join(p.legacyRuntime, 'ledger.json'), 'legacy-ledger.json']]) {
        try { await copyProjectFile(p.root, source, path.join(backupPath, name)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } else {
      await checkPrivateDirectory(backupsRoot, { projectRoot: p.root });
      await checkPrivateDirectory(backupPath, { projectRoot: p.root });
    }
    await atomicJson(snapshotAbsolutePath, staged, p.root);
    const catalog = scanOnlineSnapshot(staged, { previous: previousCatalog, sourcePath: snapshotAbsolutePath });
    catalog.dedupeGeneration = generation;
    catalog.updatedAt = new Date().toISOString();
    catalog.catalogHash = catalogHash(catalog);
    const ledger = structuredClone(previousLedger);
    ledger.dedupeGeneration = generation;
    if (!activeState) ledger.dedupeGenerationCreatedAt = new Date().toISOString();
    for (const batch of Object.values(ledger.batches)) if (!batch.dedupeGeneration) batch.dedupeGeneration = 'legacy';
    await atomicJson(path.join(p.privateRoot, catalogRelativePath), catalog, p.root);
    await atomicJson(path.join(p.privateRoot, ledgerRelativePath), ledger, p.root);
    const storageState = {
      schemaVersion: 1, sourceMode: 'flomo-online-full', dedupeGeneration: generation,
      activeSnapshotId: staged.snapshotId, activeSnapshotPath: snapshotRelativePath,
      activeCatalogPath: catalogRelativePath, activeLedgerPath: ledgerRelativePath,
      activatedAt: new Date().toISOString(), coverage: structuredClone(staged.coverage),
      backupPath,
    };
    await beforeCommit?.();
    await atomicJson(p.storageModePath, storageState, p.root);
    return { status: activeState ? 'updated' : 'activated', snapshotId: staged.snapshotId, dedupeGeneration: generation,
      notes: catalog.notes.length, eligibleQuality: 0, excluded: catalog.excluded.length,
      coverage: catalog.coverage, backupPath, ledgerBatchesPreserved: Object.keys(ledger.batches).length };
  });
}

export async function restoreOnlineSnapshotBackup(root = repoRoot) {
  const before = paths(root);
  if (!before.onlineStorageActive) throw Error('online-storage-not-active');
  return withLock(root, async () => {
    const p = paths(root);
    if (!p.onlineStorageActive) throw Error('online-storage-not-active');
    const state = await readJson(p.storageModePath);
    const backupPath = safeBackupPath(p, state.backupPath);
    const backupsRoot = p.backupsRoot;
    if (state.schemaVersion !== 1 || state.sourceMode !== 'flomo-online-full') throw Error('online-storage-backup-invalid');
    await checkPrivateDirectory(backupsRoot, { projectRoot: p.root });
    await checkPrivateDirectory(backupPath, { projectRoot: p.root });
    const restoredCatalog = await readJson(path.join(backupPath, 'legacy-catalog.json'));
    assertLedger(await readJson(path.join(backupPath, 'legacy-ledger.json')));
    if (restoredCatalog.schemaVersion !== 1 || !Array.isArray(restoredCatalog.notes)) throw Error('online-storage-backup-invalid');
    // Keep the live ledger so messages and feedback recorded since migration
    // survive rollback. The source change starts a fresh exposure generation;
    // the same-day occupancy check still sees every batch across generations.
    const ledger = assertLedger(await readJson(p.ledger));
    const generation = `rollback-${randomUUID()}`;
    restoredCatalog.sourceMode = 'legacy-archive';
    restoredCatalog.dedupeGeneration = generation;
    restoredCatalog.updatedAt = new Date().toISOString();
    restoredCatalog.catalogHash = catalogHash(restoredCatalog);
    ledger.dedupeGeneration = generation;
    ledger.dedupeGenerationCreatedAt = new Date().toISOString();
    for (const batch of Object.values(ledger.batches)) if (!batch.dedupeGeneration) batch.dedupeGeneration = 'legacy';
    const safetyPath = path.join(backupsRoot, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
    await ensurePrivateDirectory(safetyPath, p.root);
    for (const [source, name] of [[p.catalog, 'online-catalog.json'], [p.ledger, 'online-ledger.json']]) {
      await copyProjectFile(p.root, source, path.join(safetyPath, name));
    }
    await atomicJson(p.legacyCatalog, restoredCatalog, p.root);
    await atomicJson(path.join(p.legacyRuntime, 'ledger.json'), ledger, p.root);
    await unlinkProjectFile(p.root, p.storageModePath);
    return { status: 'restored', sourceMode: restoredCatalog.sourceMode, dedupeGeneration: generation,
      notes: restoredCatalog.notes.length, ledgerBatchesPreserved: Object.keys(ledger.batches).length,
      originalBackupPath: backupPath, safetyBackupPath: safetyPath };
  });
}
export function qualityPackets(catalog, maxChars = 24000) {
  const packets = []; let notes = [], chars = 0;
  for (const note of catalog.notes.filter(n => !n.quality || n.quality.bodyHash !== n.bodyHash || n.quality.policyVersion !== '1')) {
    const record = { noteKey: note.noteKey, bodyHash: note.bodyHash, createdAt: note.createdAt, body: note.body };
    const size = JSON.stringify(record).length;
    if (notes.length && chars + size > maxChars) { packets.push({ schemaVersion: 1, policyVersion: '1', notes }); notes = []; chars = 0; }
    notes.push(record); chars += size;
  }
  if (notes.length) packets.push({ schemaVersion: 1, policyVersion: '1', notes });
  return packets;
}
export async function acceptQuality(root, decisions) {
  return withLock(root, async () => {
    const p = paths(root), catalog = await readJson(p.catalog);
    if (decisions.policyVersion !== '1' || !Array.isArray(decisions.items) || !decisions.items.length) throw Error('quality-contract-invalid');
    const seen = new Set();
    for (const d of decisions.items) {
      const note = catalog.notes.find(n => n.noteKey === d.noteKey);
      const shortFullBodyQuote = typeof note?.body === 'string' && Array.from(note.body.trim()).length > 0 &&
        Array.from(note.body.trim()).length < 4 && d.quote === note.body.trim();
      const quoteValid = typeof d.quote === 'string' && note?.body?.includes(d.quote) &&
        (Array.from(d.quote.trim()).length >= 4 || shortFullBodyQuote);
      if (!note || seen.has(d.noteKey) || d.bodyHash !== note.bodyHash || hashBody(note.body) !== note.bodyHash || !Number.isInteger(d.score) || d.score < 0 || d.score > 4 || !d.reason?.trim() || !quoteValid) throw Error('quality-decision-untraceable');
      seen.add(d.noteKey);
    }
    let updated = 0, unchanged = 0;
    const assessedAt = new Date().toISOString();
    for (const d of decisions.items) {
      const note = catalog.notes.find(n => n.noteKey === d.noteKey);
      const current = note.quality;
      if (current?.policyVersion === '1' && current.bodyHash === d.bodyHash && current.score === d.score &&
          current.reason === d.reason && current.quote === d.quote) {
        unchanged += 1;
        continue;
      }
      note.quality = { ...d, policyVersion: '1', assessedAt };
      updated += 1;
    }
    if (updated) { catalog.catalogHash = catalogHash(catalog); await atomicJson(p.catalog, catalog, p.root); }
    return { assessed: decisions.items.length, updated, unchanged, qualified: catalog.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, total: catalog.notes.length };
  });
}
export async function prepareReview(root = repoRoot, date = shanghaiDate(), options = {}) {
  validDate(date); await refreshArchive(root);
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  assertMatchingDedupeGeneration(catalog, ledger);
  const context = await buildReviewContext(root, { date, ...options });
  const eligible = eligibleNotes({ date, notes: catalog.notes, ledger });
  const packet = { schemaVersion: 1, date, contextHash: context.contextHash, catalogHash: catalogHash(catalog), context,
    sourceMode: catalog.sourceMode || 'legacy-archive', snapshot: catalog.snapshot || null,
    notes: eligible.map(({ noteKey, groupKey, createdAt, bodyHash, quality, source }) => ({ noteKey, groupKey, createdAt, bodyHash, quality, source })),
    feedback: Object.values(ledger.feedback).filter(e => !e.superseded && eligible.some(n => n.noteKey === e.noteKey)),
    instruction: `完整读取上下文；单次推荐${MIN_REVIEW_ITEMS}–${MAX_REVIEW_ITEMS}条，常规数量与整体平均目标均为6条。先选与近期周/月Output强匹配的高质量笔记；前三条可使用高质量长期背景关联并说明关联，第4–${MAX_REVIEW_ITEMS}条必须强匹配。若只有${MIN_REVIEW_ITEMS}–${TARGET_MIN_REVIEW_ITEMS - 1}条同时满足质量与对应序号上下文要求，可少于常规目标发送，必须填写countDeviationReason说明质量或匹配原因；不得为了达到数量或平均目标降低质量。按整周年龄统计优化近30天与近365天软比例；比例偏离时必须填ageDeviationReason解释，不得为配比降低质量。少于${MIN_REVIEW_ITEMS}条则报告blocked，不凑数。每条reason不超过${MAX_REVIEW_REASON_CHARS}字，只写一条可执行的回看问题或判断，不写解释段落。复读每条原文，引用真实上下文。输出{date,contextHash,catalogHash,countDeviationReason,ageDeviationReason,items:[{noteKey,bodyHash,relevance:strong|background,reason,contextEvidence:[{path,quote}]}]}。` };
  const directory = path.join(p.runtime, date); await atomicJson(path.join(directory, 'request.json'), packet, p.root);
  return { date, qualifiedEligible: eligible.length, contextHash: packet.contextHash, catalogHash: packet.catalogHash,
    sourceMode: packet.sourceMode, snapshot: packet.snapshot, requestPath: path.join(directory, 'request.json'), missing: context.manifest.missing };
}

function displayTitle(note) {
  const poem = flomoTags(note.body).includes('写诗');
  const firstLine = String(note.body || '').split('\n').find(line => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('>'));
  if (!firstLine) return poem ? '诗：一首' : '回顾';
  const rawTitle = firstLine.trim().replace(/<br\s*\/?>/giu, ' ').replace(/ {2,}/gu, ' ');
  const punctuation = rawTitle.search(/[，。：；！？、,.:;!?]/u);
  const baseTitle = (punctuation === -1 ? rawTitle : rawTitle.slice(0, punctuation)).trim();
  const title = [...baseTitle].slice(0, 10).join('').trim() ||
    [...rawTitle].slice(0, 10).join('').trim();
  return poem ? `诗：${title}` : title;
}

function cardBody(note) {
  const source = String(note.body || '').trim()
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const parts = [];
  const generatedBreakOffsets = [];
  const generatedSpacerOffsets = [];
  let contentLength = 0;
  let inList = false;
  let pendingBreaks = 0;
  const appendParagraphBreaks = () => {
    for (let index = 0; index <= pendingBreaks; index += 1) append('&nbsp;<br>', false, true);
  };
  const append = (value, generatedBreak = false, generatedSpacer = false) => {
    if (generatedBreak) generatedBreakOffsets.push(contentLength, contentLength + 4);
    if (generatedSpacer) generatedSpacerOffsets.push(contentLength, contentLength + value.length);
    parts.push(value);
    contentLength += value.length;
  };
  for (const rawLine of source) {
    const list = rawLine.match(/^\s*([-*+]|\d+[.)、])(?:\s*)(.*)$/);
    const text = rawLine.trim();
    if (!text) {
      pendingBreaks += 1;
      continue;
    }
    if (list) {
      if (parts.length) {
        if (pendingBreaks) appendParagraphBreaks();
        else append('\n');
      }
      const indent = rawLine.slice(0, rawLine.length - rawLine.trimStart().length);
      const marker = /^\d/.test(list[1]) ? `${list[1].replace(/[、)]$/, '.')} ` : '- ';
      append(`${indent}${marker}${list[2].trim()}`);
      inList = true;
      pendingBreaks = 0;
    } else {
      if (parts.length) {
        if (pendingBreaks) appendParagraphBreaks();
        else append(inList ? '\n' : '<br>', true);
      }
      append(text);
      inList = false;
      pendingBreaks = 0;
    }
  }
  const untrimmed = parts.join('');
  const leadingTrim = untrimmed.length - untrimmed.trimStart().length;
  return { content: untrimmed.trim(), generatedBreakOffsets: generatedBreakOffsets.map(offset => offset - leadingTrim),
    generatedSpacerOffsets: generatedSpacerOffsets.map(offset => offset - leadingTrim) };
}

function reviewSnapshotSubtitle(date, snapshot) {
  if (!snapshot || snapshot.sourceMode !== 'flomo-online-full' || !snapshot.coverage) return `回顾日期：${date}`;
  const at = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot.capturedAt));
  const coverage = snapshot.coverage;
  return `回顾日期：${date} · 笔记快照：${at} · 覆盖 ${coverage.observedCount}/${coverage.expectedCount}`;
}

function combinationMode(count) {
  if (count <= 2) return 'double';
  if (count <= 3) return 'triple';
  if (count <= 6) return 'bisect';
  return 'trisect';
}

function buildImageElements(keys) {
  if (!keys?.length) return [];
  if (keys.length === 1) {
    return [{ tag: 'img', img_key: keys[0], alt: { tag: 'plain_text', content: '' }, preview: true }];
  }
  return [{ tag: 'img_combination', combination_mode: combinationMode(keys.length), img_list: keys.map(img_key => ({ img_key })) }];
}

export function renderReview(decision, notes, snapshot = null, imageKeysByNote = new Map()) {
  const title = `# Flomo 回顾｜${decision.date}`;
  const provenance = snapshot?.sourceMode === 'flomo-online-full' && snapshot.coverage
    ? `笔记快照：${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(snapshot.capturedAt))} · 覆盖 ${snapshot.coverage.observedCount}/${snapshot.coverage.expectedCount}`
    : null;
  const message = [title, '', ...(provenance ? [provenance, ''] : [])], full = [title, '', ...(provenance ? [provenance, ''] : [])];
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS) {
    const note = `本日符合质量与上下文要求的笔记不足${TARGET_MIN_REVIEW_ITEMS}条，实际推荐${decision.items.length}条。原因：${decision.countDeviationReason.trim()}`;
    message.push(note, '');
    full.push(note, '');
  }
  for (const [index, item] of decision.items.entries()) {
    const note = notes.find(n => n.noteKey === item.noteKey);
    const heading = `## ${index + 1}. ${displayTitle(note)}`;
    const date = shanghaiDate(new Date(note.createdAt));
    const quote = [...note.body].slice(0, 220).join('');
    message.push(heading, '', ...quote.split('\n').map(x => `> ${x}`), '', `回顾理由：${reviewReason(item)}`, '', `[Flomo原文](${note.source.url})`, '');
    full.push(heading, '', `创建日期：${date}`, `来源：${note.source.url || `${note.source.path}:${note.source.line}`}`, '', note.body, '', `回顾理由：${item.reason}`, '', '---', '');
  }
  const lastItemNumber = decision.items.length;
  message.push(`可以回复本条消息：“第2条有帮助”“第1条跳过”或“第${lastItemNumber}条已回顾”。`);
  const cardElements = [
    ...(decision.items.length < TARGET_MIN_REVIEW_ITEMS ? [{ tag: 'markdown', content: `本日符合质量与上下文要求的笔记不足${TARGET_MIN_REVIEW_ITEMS}条，实际推荐${decision.items.length}条。原因：${decision.countDeviationReason.trim()}` }] : []),
  ];
  const cardReadbackBreaks = [];
  const cardReadbackSpacers = [];
  for (const [index, item] of decision.items.entries()) {
    const note = notes.find(n => n.noteKey === item.noteKey);
    const metadata = `${shanghaiDate(new Date(note.createdAt))}${item.relevance === 'background' ? ' · 背景' : ''}${note.source.url ? ` · [Flomo原文](${note.source.url})` : ''}`;
    const prefix = `**${index + 1}. ${displayTitle(note)}**<br>${metadata}<br><br>`;
    const titlePrefixLength = `**${index + 1}. ${displayTitle(note)}**`.length;
    const prefixBreakOffsets = [
      titlePrefixLength, titlePrefixLength + 4,
      titlePrefixLength + 4 + metadata.length, titlePrefixLength + 4 + metadata.length + 8,
    ];
    const renderedBody = cardBody(note);
    const elementIndex = cardElements.length;
    cardElements.push({ tag: 'markdown', content: `${prefix}${renderedBody.content}` });
    const imageKeys = imageKeysByNote.get(note.noteKey) ?? [];
    cardElements.push(...buildImageElements(imageKeys));
    const breakOffsets = [...prefixBreakOffsets, ...renderedBody.generatedBreakOffsets.map(offset => prefix.length + offset)];
    if (breakOffsets.length) {
      cardReadbackBreaks.push({ elementIndex, offsets: breakOffsets });
    }
    if (renderedBody.generatedSpacerOffsets.length) {
      cardReadbackSpacers.push({ elementIndex, offsets: renderedBody.generatedSpacerOffsets.map(offset => prefix.length + offset) });
    }
    cardElements.push(
      { tag: 'markdown', content: `> 回顾理由：${reviewReason(item)}` },
    );
    if (index < decision.items.length - 1) cardElements.push({ tag: 'hr' });
  }
  const card = { schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `Flomo 回顾｜${decision.date}` },
      subtitle: { tag: 'plain_text', content: reviewSnapshotSubtitle(decision.date, snapshot) },
      template: 'indigo',
    },
    body: { elements: [...cardElements, { tag: 'markdown', content: `可以回复本条消息：“第2条有帮助”“第1条跳过”或“第${lastItemNumber}条已回顾”。` }] } };
  return { markdown: `${message.join('\n')}\n`, fullMarkdown: `${full.join('\n')}\n`, card, cardReadbackBreaks, cardReadbackSpacers };
}
export async function inspectDecision(root, decision, { freshContext = false, contextOptions = {}, imageOptions = {} } = {}) {
  const p = paths(root), catalog = await readJson(p.catalog), ledger = assertLedger(await readJson(p.ledger, emptyLedger()));
  assertMatchingDedupeGeneration(catalog, ledger);
  const request = await readJson(path.join(p.runtime, validDate(decision.date), 'request.json'));
  if (decision.contextHash !== request.contextHash || decision.catalogHash !== catalogHash(catalog)) throw Error('decision-input-changed');
  const context = freshContext ? await buildReviewContext(root, { date: decision.date, ...contextOptions }) : request.context;
  if (context.contextHash !== decision.contextHash) throw Error('live-context-changed-reselect');
  validateEvidence(decision.items, context);
  for (const item of decision.items) {
    const note = catalog.notes.find(n => n.noteKey === item.noteKey);
    if (!note || hashBody(note.body) !== note.bodyHash) throw Error('note-body-hash-invalid');
    if (typeof item.reason !== 'string' || ![...item.reason.trim()].length || [...item.reason.trim()].length > MAX_REVIEW_REASON_CHARS) throw Error('review-reason-length-invalid');
  }
  const stats = validateSelection({ date: decision.date, items: decision.items, notes: catalog.notes, ledger });
  if (decision.items.length < TARGET_MIN_REVIEW_ITEMS && (typeof decision.countDeviationReason !== 'string' || !decision.countDeviationReason.trim())) throw Error('count-shortfall-needs-reason');
  if (stats.age.deviations.length && !decision.ageDeviationReason?.trim()) throw Error('age-deviation-needs-reason');
  stats.age.deviationReason = stats.age.deviations.length ? decision.ageDeviationReason.trim() : null;
  const config = await readJson(p.config, {});
  const images = await resolveReviewImages({ items: decision.items, notes: catalog.notes, config, date: decision.date,
    catalogHash: decision.catalogHash, ...imageOptions });
  return { catalog, ledger, context, stats, images, ...renderReview(decision, catalog.notes, catalog.snapshot, images.imageKeysByNote) };
}
export async function previewReview(root, decision) {
  const result = await inspectDecision(root, decision), p = paths(root), dir = path.join(p.runtime, decision.date);
  await makeProjectDirectory(p.root, dir);
  await atomicJson(path.join(dir, 'decision.json'), decision, p.root);
  await writeProjectFile(p.root, path.join(dir, 'review.md'), result.fullMarkdown, { mode: 0o600 });
  await writeProjectFile(p.root, path.join(dir, 'message.md'), result.markdown, { mode: 0o600 });
  await atomicJson(path.join(dir, 'validation.json'), result.stats, p.root);
  await atomicJson(path.join(dir, 'images.json'), result.images, p.root);
  return { date: decision.date, count: decision.items.length, stats: result.stats, snapshot: result.catalog.snapshot || null, previewPath: path.join(dir, 'review.md') };
}
export async function sendReview(root, decision, { now = new Date(), deliveryOptions = {}, contextOptions = {} } = {}) {
  if (decision.date !== shanghaiDate(now)) throw Error('stale-date-no-backfill-send');
  // Refresh current source tags/status before reserving; an edited or filtered note invalidates the decision.
  await refreshArchive(root);
  return withLock(root, async () => {
    const p = paths(root), config = await readJson(p.config);
    const imageSettings = normalizeImageConfig(config);
    const preResolvedImages = await readJson(path.join(p.runtime, decision.date, 'images.json'), null);
    if (imageSettings.enabled && preResolvedImages?.enabled !== true) throw Error('review-images-preview-required');
    const check = await inspectDecision(root, decision, { freshContext: true, contextOptions,
      imageOptions: { ...(deliveryOptions.runCli ? { runCli: deliveryOptions.runCli } : {}),
        ...(preResolvedImages ? { preResolvedImages } : {}) } });
    const previous = check.ledger.batches[decision.date];
    if (previous && ['delivered', 'sending', 'needs_review', 'reserved'].includes(previous.status)) throw Error('date-already-reserved-or-delivered');
    const preflight = await preflightDelivery({ ...config.delivery, now, runCli: deliveryOptions.runCli });
    const dateTime = Date.parse(`${decision.date}T00:00:00Z`);
    const mondayOffset = (new Date(dateTime).getUTCDay() + 6) % 7;
    const historyStartDate = new Date(dateTime - (mondayOffset + 21) * 86400000).toISOString().slice(0, 10);
    await auditRecentReviewHistory({ chatId: config.delivery.chatId, startDate: historyStartDate, end: now,
      weeks: activeWeeks(decision.date), batches: check.ledger.batches, botSenderIds: preflight.botSenderIds,
      profile: preflight.profile, runCli: deliveryOptions.runCli });
    const dir = path.join(p.runtime, decision.date); await makeProjectDirectory(p.root, dir);
    const auditPath = path.join(dir, 'review.md'); await writeProjectFile(p.root, auditPath, check.fullMarkdown, { mode: 0o600 });
    const batch = { date: decision.date, status: 'reserved', dedupeGeneration: check.catalog.dedupeGeneration || 'legacy',
      snapshot: check.catalog.snapshot || null, contextHash: decision.contextHash, catalogHash: decision.catalogHash,
      items: decision.items.map(i => {
        const note = check.catalog.notes.find(n => n.noteKey === i.noteKey);
        return { ...i, groupKey: note.groupKey, historyIdentity: { memoId: note.memoId || null, noteKey: note.noteKey,
          groupKey: note.groupKey, createdAt: note.createdAt, bodyHash: note.bodyHash } };
      }),
      ...(decision.items.length < TARGET_MIN_REVIEW_ITEMS ? { countDeviationReason: decision.countDeviationReason.trim() } : {}),
      stats: check.stats, images: check.images, chatId: config.delivery.chatId, profile: preflight.profile, botSenderId: preflight.botSenderId, botSenderIds: preflight.botSenderIds, idempotencyKey: `learn-x-flomo-review:${decision.date}`,
      card: check.card, cardReadbackBreaks: check.cardReadbackBreaks, cardReadbackSpacers: check.cardReadbackSpacers, cardContentSha256: cardContentSha256(check.card), auditPath, auditSha256: sha256(check.fullMarkdown), createdAt: now.toISOString() };
    check.ledger.batches[decision.date] = batch; await atomicJson(p.ledger, check.ledger, p.root);
    batch.status = 'sending'; batch.sendStartedAt = new Date().toISOString(); await atomicJson(p.ledger, check.ledger, p.root);
    try {
      const sent = await sendRecommendation({ chatId: batch.chatId, card: batch.card,
        dateMarker: `回顾日期：${batch.date}`, idempotencyKey: batch.idempotencyKey, profile: batch.profile, botSenderId: batch.botSenderId, botSenderIds: batch.botSenderIds,
        onUploaded: async receipt => { Object.assign(batch, receipt); await atomicJson(p.ledger, check.ledger, p.root); },
        runCli: deliveryOptions.runCli, cardReadbackBreaks: batch.cardReadbackBreaks, cardReadbackSpacers: batch.cardReadbackSpacers });
      Object.assign(batch, sent, { status: 'delivered', deliveredAt: new Date().toISOString() });
      await atomicJson(p.ledger, check.ledger, p.root);
      return { date: batch.date, status: batch.status, count: batch.items.length, messageId: batch.messageId };
    } catch (error) {
      batch.status = error.uncertain === false ? 'failed' : 'needs_review';
      batch.error = error.message; if (error.messageId) batch.messageId = error.messageId;
      if (batch.status === 'failed') {
        batch.failedAt = new Date().toISOString();
        check.ledger.failures ??= [];
        if (!Array.isArray(check.ledger.failures)) throw Error('ledger-failures-invalid');
        check.ledger.failures.push({ date: batch.date, createdAt: batch.createdAt, failedAt: batch.failedAt, error: batch.error,
          countDeviationReason: batch.countDeviationReason ?? null, ageDeviationReason: batch.stats?.age?.deviationReason ?? null,
          items: batch.items.map(item => ({ ...item })), stats: batch.stats, contextHash: batch.contextHash, catalogHash: batch.catalogHash,
          cardContentSha256: batch.cardContentSha256, auditSha256: batch.auditSha256 });
      }
      await atomicJson(p.ledger, check.ledger, p.root); throw error;
    }
  });
}

function reviewReason(item) {
  return item.reason.trim();
}

export async function recoverReview(root, date, deliveryOptions = {}) {
  return withLock(root, async () => {
    const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), batch = ledger.batches[validDate(date)];
    if (!batch || !['sending', 'needs_review', 'reserved', 'delivered'].includes(batch.status)) throw Error('batch-not-recoverable');
    const result = await recoverRecommendation({ ...batch, dateMarker: `回顾日期：${date}`, expectedCard: batch.card,
      expectedMarkdown: batch.markdown, runCli: deliveryOptions.runCli });
    if (!result?.messageId) throw Error('send-recovery-unresolved-no-resend');
    Object.assign(batch, result, { status: 'delivered', recoveredAt: new Date().toISOString() }); await atomicJson(p.ledger, ledger, p.root);
    return { date, status: batch.status, messageId: batch.messageId };
  });
}
export async function feedbackReview(root, { date = shanghaiDate(), targetDate, ...options } = {}) {
  const p = paths(root), ledger = assertLedger(await readJson(p.ledger, emptyLedger())), config = await readJson(p.config), weeks = activeWeeks(date);
  const batches = Object.values(ledger.batches).filter(b => b.status === 'delivered' && (targetDate ? b.date === targetDate : weeks.includes(b.stats?.week)));
  const result = await collectFeedback({ batches, ownerId: config.delivery.ownerId, profile: config.delivery.profile, ...options });
  if (result.complete !== true || result.errors?.length || result.truncated || !Array.isArray(result.replyObservations)) throw Error('feedback-incomplete-do-not-advance');
  return withLock(root, async () => {
    const current = assertLedger(await readJson(p.ledger, emptyLedger()));
    let newEvents = 0, newObservations = 0;
    current.feedbackReplyVersions ??= {};
    const versionTime = event => /^\d+$/.test(event.updateTime) ? Number(event.updateTime) * (Number(event.updateTime) < 1e12 ? 1000 : 1) : new Date(event.updateTime).getTime();
    const sameVersion = (a, b) => a.replyId === b.replyId && versionTime(a) === versionTime(b);
    for (const observation of result.replyObservations ?? []) {
      if (!observation.observationKey || !observation.replyId || !Number.isFinite(versionTime(observation)) || !['present', 'deleted'].includes(observation.state) || !Array.isArray(observation.eventKeys)) throw Error('feedback-observation-invalid');
      const previous = Object.values(current.feedbackReplyVersions).find(value => sameVersion(value, observation));
      if (previous && (previous.rootMessageId !== observation.rootMessageId || previous.state !== observation.state || previous.contentSha256 !== observation.contentSha256 || JSON.stringify(previous.eventKeys) !== JSON.stringify(observation.eventKeys))) throw Error('feedback-version-conflict');
      if (!previous) { current.feedbackReplyVersions[observation.observationKey] = observation; newObservations += 1; }
    }
    for (const event of result.events) {
      if (!event.eventKey || !event.replyId || !event.updateTime) throw Error('feedback-event-identity-invalid');
      if (current.feedback[event.eventKey]) continue;
      current.feedback[event.eventKey] = event; newEvents += 1;
    }
    const latestByReply = new Map();
    for (const event of Object.values(current.feedback)) {
      const version = versionTime(event);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(event.replyId);
      if (!previous || version > versionTime(previous)) latestByReply.set(event.replyId, event);
    }
    for (const observation of Object.values(current.feedbackReplyVersions)) {
      const version = versionTime(observation);
      if (!Number.isFinite(version)) throw Error('feedback-version-invalid');
      const previous = latestByReply.get(observation.replyId);
      if (!previous || version >= versionTime(previous)) latestByReply.set(observation.replyId, observation);
    }
    for (const event of Object.values(current.feedback)) {
      const latest = latestByReply.get(event.replyId);
      event.superseded = versionTime(event) < versionTime(latest) || latest.state === 'deleted' || (Array.isArray(latest.eventKeys) && !latest.eventKeys.includes(event.eventKey));
    }
    current.feedbackCheckedAt = new Date().toISOString(); await atomicJson(p.ledger, current, p.root);
    return { checkedBatches: batches.length, events: result.events.length, newEvents, newObservations, totalFeedback: Object.keys(current.feedback).length };
  });
}
export async function simulateCapacity(root = repoRoot, startDate = shanghaiDate(), days = 28) {
  const catalog = await readJson(paths(root).catalog);
  const simulation = simulateSupply({ notes: catalog.notes, startDate, days });
  const counts = simulation.schedule.map(day => day.items.length);
  const overlaps = simulation.schedule.flatMap(day => day.pairOverlaps.map(pair => pair.overlap));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startDate,
    days,
    possible: simulation.possible,
    targetDailyCountRange: [TARGET_MIN_REVIEW_ITEMS, MAX_REVIEW_ITEMS],
    averageDailyCountTargetRange: [6, 6],
    ...(simulation.reason ? { reason: simulation.reason } : {}),
    ...(simulation.date ? { failedDate: simulation.date } : {}),
    uniqueQualified: simulation.uniqueQualified,
    minimum: simulation.minimum,
    scheduledDays: simulation.schedule.length,
    dailyCountRange: counts.length ? [Math.min(...counts), Math.max(...counts)] : [],
    maximumRepeatCount: Math.max(0, ...simulation.schedule.map(day => day.repeats)),
    maximumPairOverlap: Math.max(0, ...overlaps),
  };
  const p = paths(root), reportPath = path.join(p.runtime, `capacity-${days}-verified-${isoWeek(startDate)}.json`);
  await atomicJson(reportPath, report, p.root);
  return { ...report, reportPath };
}
async function main(argv) {
  const [command] = argv, arg = key => argv[argv.indexOf(key) + 1], date = argv.includes('--date') ? validDate(arg('--date')) : shanghaiDate();
  const p = paths();
  if (command === 'archive') return refreshArchive();
  if (command === 'activate-snapshot') return activateOnlineSnapshot(repoRoot, arg('--file'));
  if (command === 'restore-snapshot-backup') return restoreOnlineSnapshotBackup();
  if (command === 'quality-packets') {
    const catalog = await readJson(p.catalog), packets = qualityPackets(catalog); const dir = await makeProjectDirectory(p.root, path.join(p.runtime, 'quality-packets'));
    for (const [i, packet] of packets.entries()) await atomicJson(path.join(dir, `${String(i + 1).padStart(3, '0')}.json`), packet, p.root);
    return { packets: packets.length, notes: packets.reduce((s, x) => s + x.notes.length, 0), directory: dir };
  }
  if (command === 'quality-accept') return acceptQuality(repoRoot, await readJson(path.resolve(arg('--file'))));
  if (command === 'prepare') return prepareReview(repoRoot, date);
  if (command === 'preview' || command === 'send') {
    const decision = await readJson(path.resolve(arg('--file')));
    return command === 'preview' ? previewReview(repoRoot, decision) : sendReview(repoRoot, decision);
  }
  if (command === 'recover') return recoverReview(repoRoot, date);
  if (command === 'feedback') return feedbackReview(repoRoot, { date, targetDate: argv.includes('--target-date') ? arg('--target-date') : undefined });
  if (command === 'simulate') return simulateCapacity(repoRoot, date, argv.includes('--days') ? Number(arg('--days')) : 28);
  if (command === 'status') {
    const c = await readJson(p.catalog, { notes: [], excluded: [] }), l = assertLedger(await readJson(p.ledger, emptyLedger()));
    return { notes: c.notes.length, qualified: c.notes.filter(n => n.quality?.score >= 3 && n.quality.bodyHash === n.bodyHash).length, excluded: c.excluded.length, batches: Object.values(l.batches).map(({ date, status, messageId }) => ({ date, status, messageId })), feedback: Object.keys(l.feedback).length };
  }
  throw Error('usage: archive|activate-snapshot --file|restore-snapshot-backup|quality-packets|quality-accept --file|prepare|preview --file|send --file|feedback|recover|simulate|status');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(async e => {
    const p = paths(); await makeProjectDirectory(p.root, p.runtime);
    await atomicJson(path.join(p.runtime, 'last-failure.json'), { at: new Date().toISOString(), command: process.argv[2], error: e.message }, p.root).catch(() => {});
    console.error(JSON.stringify({ status: 'blocked', error: e.message })); process.exitCode = 1;
  });
}

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyHash } from "../../learn-x-flomo-review/scripts/catalog.mjs";
import { scanFlomoWithEgo } from "./collect-flomo-weekly.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const MAX_MEMOS = 20_000;
const START_EPOCH = Date.parse("2020-01-01T00:00:00+08:00") / 1000;

function normalizeMemoText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temporary, filePath); }
  finally { await rm(temporary, { force: true }); }
}

export function validateIdentityScan(scan, { endEpoch } = {}) {
  if (!scan || scan.complete !== true || scan.lowerBoundCovered !== true || scan.week !== "backfill") {
    throw new Error("flomo-backfill-scan-incomplete");
  }
  if (!Array.isArray(scan.memos) || !Number.isInteger(scan.pageCount) || scan.pageCount < 1) {
    throw new Error("flomo-backfill-scan-invalid-shape");
  }
  if (scan.memos.length > MAX_MEMOS || scan.scanned > MAX_MEMOS) throw new Error("flomo-backfill-capacity-exceeded");
  const byId = new Map();
  for (const memo of scan.memos) {
    const timeMs = Number(memo.timeMs ?? Date.parse(`${memo.timeText}+08:00`));
    if (!memo.memoId || !memo.bodyComplete || typeof memo.bodyText !== "string" || !Number.isInteger(timeMs) || timeMs < START_EPOCH * 1000 || (endEpoch && timeMs >= endEpoch * 1000)) {
      throw new Error("flomo-backfill-record-incomplete");
    }
    const previous = byId.get(memo.memoId);
    if (!previous) byId.set(memo.memoId, { memoId: memo.memoId, timeMs, bodyHash: bodyHash(normalizeMemoText(memo.bodyText)) });
    else if (previous.timeMs !== timeMs || previous.bodyHash !== bodyHash(normalizeMemoText(memo.bodyText))) {
      throw new Error("flomo-backfill-identity-conflict");
    }
  }
  return { identities: [...byId.values()] };
}

export async function collectFlomoIdentityBackfill({ output, scan = scanFlomoWithEgo, root = repoRoot } = {}) {
  const endEpoch = Math.ceil(Date.now() / 1000) + 86_400;
  const raw = await scan({ week: "backfill", range: { startEpoch: START_EPOCH, endEpoch } });
  const { identities } = validateIdentityScan(raw, { endEpoch });
  const filePath = output || path.join(root, "03_input/_archives/flomo/identity-backfill.json");
  const document = {
    schemaVersion: 1,
    complete: true,
    lowerBoundCovered: true,
    coverage: { start: "2020-01-01 00:00 +08:00", endExclusiveEpochSeconds: endEpoch },
    scanned: raw.scanned,
    pageCount: raw.pageCount,
    scanStartedAt: raw.scanStartedAt,
    scanFinishedAt: raw.scanFinishedAt,
    identities,
  };
  await atomicJson(filePath, document);
  return { path: filePath, scanned: raw.scanned, pageCount: raw.pageCount, identities: identities.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectFlomoIdentityBackfill()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

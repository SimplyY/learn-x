#!/usr/bin/env node
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { importLearnXCandidate } from "./manual-handoff-adapter.mjs";

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const extensionMime = new Map([[".md", "text/markdown"], [".txt", "text/plain"], [".json", "application/json"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".pdf", "application/pdf"]]);

async function readUserFile(filePath) {
  const absolute = path.resolve(filePath);
  const before = await lstat(absolute);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("result-file-must-be-regular-file");
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || after.size > 30 * 1024 * 1024) throw new Error("result-file-invalid");
    const bytes = await handle.readFile();
    if (bytes.length !== after.size) throw new Error("result-file-changed");
    return { name: path.basename(absolute), mimeType: extensionMime.get(path.extname(absolute).toLowerCase()) || "application/octet-stream", bytes };
  } finally { await handle.close(); }
}

try {
  const handoffId = value("--handoff-id"), sourceClaim = value("--source-claim");
  const repoRoot = path.resolve(value("--repo-root") || defaultRepoRoot);
  const resultPath = value("--result-file"), filePaths = args.flatMap((arg, index) => arg === "--file" && args[index + 1] ? [args[index + 1]] : []);
  if (!handoffId || !sourceClaim || (!resultPath && filePaths.length === 0)) {
    throw new Error("usage: import-manual-handoff-result.mjs --handoff-id ID --source-claim 'user statement' (--result-file PATH | --file PATH [...])");
  }
  const resultFile = resultPath ? await readUserFile(resultPath) : null;
  const files = filePaths.length ? await Promise.all(filePaths.map(readUserFile))
    : resultFile && /^image\//.test(resultFile.mimeType) ? [resultFile] : [];
  const resultBytes = resultFile && files[0] !== resultFile ? resultFile.bytes : Buffer.alloc(0);
  const result = await importLearnXCandidate({ repoRoot, handoffId,
    eventId: value("--event-id") || `codex-import:${randomUUID()}`,
    sourceClaim, resultBytes, files });
  const output = { ...result, businessCompleted: false, executionStatus: "awaiting_manual" };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = result.status === "received" || result.status === "duplicate" ? 75 : 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "needs_review", reason: error?.message || "manual-handoff-import-failed", businessCompleted: false })}\n`);
  process.exitCode = 2;
}

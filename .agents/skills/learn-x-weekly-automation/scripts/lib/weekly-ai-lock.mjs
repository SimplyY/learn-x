import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const LOCK_NAME = ".weekly-ai.lock";

export async function tryAcquireWeeklyAiLock(weekDir) {
  await mkdir(weekDir, { recursive: true });
  const directory = await lstat(weekDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("weekly-ai-directory-invalid");
  const lockPath = path.join(weekDir, LOCK_NAME);
  const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  try {
    const handle = await open(lockPath, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(owner), "utf8"); }
    finally { await handle.close(); }
    return {
      path: lockPath,
      token: owner.token,
      release: async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current.token === owner.token) await rm(lockPath, { force: true });
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      },
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await reapDeadOwner(lockPath)) return tryAcquireWeeklyAiLock(weekDir);
    return null;
  }
}

export async function validateWeeklyAiLockToken(weekDir, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return false;
  const lockPath = path.join(weekDir, LOCK_NAME);
  let details;
  try { details = await lstat(lockPath); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o077) !== 0) return false;
  let owner;
  try { owner = JSON.parse(await readFile(lockPath, "utf8")); }
  catch { return false; }
  if (owner?.token !== token || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

async function reapDeadOwner(lockPath) {
  const reapPath = `${lockPath}.reap`;
  const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  let handle;
  try {
    handle = await open(reapPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(owner), "utf8");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await ownerIsDead(reapPath)) await rm(reapPath, { force: true });
    return false;
  } finally { await handle?.close(); }
  try {
    if (!await ownerIsDead(lockPath)) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    try {
      const current = JSON.parse(await readFile(reapPath, "utf8"));
      if (current.token === owner.token) await rm(reapPath, { force: true });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function ownerIsDead(file) {
  let fileStat;
  try { fileStat = await lstat(file); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;
  let current;
  try { current = JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    if (!(error instanceof SyntaxError)) throw error;
    const details = await stat(file).catch((statError) => statError.code === "ENOENT" ? null : Promise.reject(statError));
    return Boolean(details && Date.now() - details.mtimeMs > 60_000);
  }
  const pid = Number(current?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

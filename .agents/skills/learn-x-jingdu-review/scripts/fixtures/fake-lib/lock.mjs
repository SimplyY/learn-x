// fake-lib/lock：忙即抛 LOCK_BUSY（与契约一致），不等待。
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

export async function withLock(lockPath, fn, _options = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      const busy = new Error(`锁忙：${lockPath}`);
      busy.code = "LOCK_BUSY";
      throw busy;
    }
    throw error;
  }
  try {
    await handle.writeFile(String(process.pid), "utf8");
    return await fn();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}

import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function ensureWeeklyDirectory(repoRoot, week) {
  const canonicalRoot = await realpath(path.resolve(repoRoot));
  let current = canonicalRoot;
  for (const segment of ["03_input", "weekly", week]) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error("weekly-path-symlink");
    if (!details.isDirectory()) throw new Error("weekly-path-not-directory");
    const resolved = await realpath(current);
    const relative = path.relative(canonicalRoot, resolved);
    if (resolved !== current || !relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new Error("weekly-path-outside-repo");
    }
    current = resolved;
  }
  return { repoRoot: canonicalRoot, weekRoot: current };
}

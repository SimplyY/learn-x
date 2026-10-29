// fake-lib：与 Slice A 共享库同形的最小实现，仅供测试（单元注入 + CLI 级 JINGDU_SHARED_LIB_DIR）。
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function atomicWriteFile(file, content) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temp, String(content ?? ""), "utf8");
    await rename(temp, file);
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function readJsonFile(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJsonFile(file, value) {
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256(content) {
  return createHash("sha256").update(String(content ?? ""), "utf8").digest("hex");
}

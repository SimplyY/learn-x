// fake-lib/records：与实装契约同形 —— appendRecord 补 {seq, ts}；readRecords 返回 {records, corrupt}。
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

async function maxSeq(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let max = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    try { max = Math.max(max, Number(JSON.parse(line)?.seq) || 0); } catch { /* corrupt lines ignored */ }
  }
  return max;
}

export async function appendRecord(file, record) {
  if (!record || typeof record !== "object") throw new Error("appendRecord: record must be an object");
  await mkdir(path.dirname(file), { recursive: true });
  const full = { ...record, seq: (await maxSeq(file)) + 1, ts: new Date().toISOString() };
  await appendFile(file, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

export async function readRecords(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], corrupt: [] };
    throw error;
  }
  const records = [];
  const corrupt = [];
  raw.split("\n").filter(Boolean).forEach((line, index) => {
    try {
      records.push(JSON.parse(line));
    } catch {
      corrupt.push({ line: index + 1, raw: line });
    }
  });
  return { records, corrupt };
}

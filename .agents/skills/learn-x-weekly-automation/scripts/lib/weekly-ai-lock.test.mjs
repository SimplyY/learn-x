import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { tryAcquireWeeklyAiLock, validateWeeklyAiLockToken } from "./weekly-ai-lock.mjs";

test("weekly AI lock serializes concurrent entrypoints and releases by owner token", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "weekly-ai-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await tryAcquireWeeklyAiLock(root);
  assert.ok(first);
  assert.equal((await tryAcquireWeeklyAiLock(root)), null);
  const owner = JSON.parse(await readFile(first.path, "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(await validateWeeklyAiLockToken(root, first.token), true);
  assert.equal(await validateWeeklyAiLockToken(root, "forged"), false);
  await first.release();
  assert.equal(await validateWeeklyAiLockToken(root, first.token), false);
  const second = await tryAcquireWeeklyAiLock(root);
  assert.ok(second);
  await second.release();
});

test("weekly AI lock safely reclaims only a dead process owner", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "weekly-ai-dead-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, ".weekly-ai.lock");
  await writeFile(lockPath, JSON.stringify({ pid: 2_147_000_000, token: "dead-owner" }), { mode: 0o600 });
  const lock = await tryAcquireWeeklyAiLock(root);
  assert.ok(lock);
  assert.notEqual(JSON.parse(await readFile(lock.path, "utf8")).token, "dead-owner");
  await lock.release();
});

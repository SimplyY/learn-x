import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CHATPACK_CACHE_TTL_MS, ChatPackCache } from "./chatpack-cache.mjs";

const source = "https://example.test/wiki/prompt";
const documentId = "doc-prompt";
const promptDescriptor = { id: "chatpack.sample", source, document_id: documentId };
const coreDescriptor = { id: "dao", source: "https://example.test/wiki/dao", document_id: "doc-dao" };
const digest = (content) => createHash("sha256").update(content, "utf8").digest("hex");
const promptAsset = (content, fetchedAt, revision = 1) => ({
  contract_version: "prompt-asset/v1",
  prompt_id: "chatpack.sample",
  prompt_source: source,
  prompt_document_id: documentId,
  prompt_revision: revision,
  prompt_sha256: digest(content),
  prompt_fetched_at: new Date(fetchedAt).toISOString(),
  content
});

async function tempCache(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "learn-x-chatpack-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = options.now ?? Date.parse("2026-10-20T00:00:00.000Z");
  const cache = new ChatPackCache({
    filePath: path.join(directory, "cache", "state.json"),
    promptDescriptors: options.promptDescriptors || (async () => [promptDescriptor]),
    coreDescriptors: options.coreDescriptors || (async () => []),
    fetchPrompt: options.fetchPrompt || (async () => promptAsset("Prompt body", now)),
    fetchCore: options.fetchCore || (async () => { throw new Error("unexpected Core read"); }),
    now: () => now,
    setTimeoutFn: options.setTimeoutFn
  });
  await cache.initialize({ refresh: false });
  return { cache, directory, setNow(value) { now = value; }, getNow() { return now; } };
}

test("cache survives restart with the original 14-day age and fails closed after expiry", async (t) => {
  const fetchedAt = Date.parse("2026-10-20T00:00:00.000Z");
  const first = await tempCache(t, { now: fetchedAt, fetchPrompt: async () => promptAsset("Prompt body", fetchedAt) });
  first.cache.requestRefresh();
  await first.cache.inFlight;

  const saved = JSON.parse(await readFile(path.join(first.directory, "cache", "state.json"), "utf8"));
  assert.equal(saved.items["prompt:chatpack.sample"].expires_at, new Date(fetchedAt + CHATPACK_CACHE_TTL_MS).toISOString());
  assert.equal((await stat(path.join(first.directory, "cache"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(first.directory, "cache", "state.json"))).mode & 0o777, 0o600);

  const restarted = new ChatPackCache({
    filePath: path.join(first.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [],
    fetchPrompt: async () => { throw new Error("must not be needed for restored cache"); },
    fetchCore: async () => {},
    now: () => fetchedAt + CHATPACK_CACHE_TTL_MS - 1
  });
  await restarted.initialize({ refresh: false });
  assert.equal((await restarted.read({ promptIds: [promptDescriptor.id] })).status, 200);
  assert.equal((await restarted.status()).resources[0].cache_status, "available");

  const expired = new ChatPackCache({
    filePath: path.join(first.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [],
    fetchPrompt: async () => {},
    fetchCore: async () => {},
    now: () => fetchedAt + CHATPACK_CACHE_TTL_MS
  });
  await expired.initialize({ refresh: false });
  assert.equal((await expired.status()).resources[0].cache_status, "expired");
  const miss = await expired.read({ promptIds: [promptDescriptor.id] });
  assert.equal(miss.status, 409);
  assert.equal("prompts" in miss.body, false);
});

test("failed refresh preserves a usable old entry and reports the failure separately", async (t) => {
  const initial = Date.parse("2026-10-20T00:00:00.000Z");
  let shouldFail = false;
  const fixture = await tempCache(t, {
    now: initial,
    fetchPrompt: async () => {
      if (shouldFail) throw new Error("Feishu timeout");
      return promptAsset("Original body", initial, 3);
    }
  });
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  shouldFail = true;
  fixture.setNow(initial + 60_000);
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  const status = await fixture.cache.status();
  assert.equal(status.resources[0].cache_status, "available");
  assert.equal(status.resources[0].revision, 3);
  assert.match(status.resources[0].refresh_error, /Feishu timeout/);
  const read = await fixture.cache.read({ promptIds: [promptDescriptor.id] });
  assert.equal(read.status, 200);
  assert.equal(read.body.prompts[promptDescriptor.id].content, "Original body");
});

test("a newer Prompt revision replaces the cached body and survives a restart", async (t) => {
  const initial = Date.parse("2026-10-20T00:00:00.000Z");
  let content = "Prompt revision one";
  let revision = 1;
  const fixture = await tempCache(t, {
    now: initial,
    fetchPrompt: async () => promptAsset(content, fixture.getNow(), revision)
  });
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  content = "Prompt revision two";
  revision = 2;
  fixture.setNow(initial + 60_000);
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  const updated = await fixture.cache.read({ promptIds: [promptDescriptor.id] });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.prompts[promptDescriptor.id].prompt_revision, 2);
  assert.equal(updated.body.prompts[promptDescriptor.id].content, "Prompt revision two");
  assert.equal(updated.body.prompts[promptDescriptor.id].prompt_fetched_at, new Date(initial + 60_000).toISOString());

  const restarted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => { throw new Error("restored revision should be sufficient"); }, fetchCore: async () => {},
    now: () => initial + 60_001
  });
  await restarted.initialize({ refresh: false });
  const restored = await restarted.read({ promptIds: [promptDescriptor.id] });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.prompts[promptDescriptor.id].prompt_revision, 2);
  assert.equal(restored.body.prompts[promptDescriptor.id].content, "Prompt revision two");
});

test("a required resource failure is visible before an unrelated refresh worker finishes", async (t) => {
  const unrelated = { id: "chatpack.unrelated", source: "https://example.test/unrelated", document_id: "doc-unrelated" };
  let rejectRequired;
  const requiredFailure = new Promise((resolve) => { rejectRequired = resolve; });
  let finishUnrelated;
  const unrelatedRead = new Promise((resolve) => { finishUnrelated = resolve; });
  const fixture = await tempCache(t, {
    promptDescriptors: async () => [promptDescriptor, unrelated],
    fetchPrompt: async (descriptor) => {
      if (descriptor.id === promptDescriptor.id) {
        rejectRequired();
        throw new Error("required source unavailable");
      }
      await unrelatedRead;
      const content = "Unrelated body";
      return {
        ...promptAsset(content, fixture.getNow()),
        prompt_id: descriptor.id,
        prompt_source: descriptor.source,
        prompt_document_id: descriptor.document_id
      };
    }
  });
  fixture.cache.requestRefresh({ priority: [`prompt:${promptDescriptor.id}`] });
  await requiredFailure;
  await new Promise((resolve) => setImmediate(resolve));

  const missing = await fixture.cache.read({ promptIds: [promptDescriptor.id] });
  assert.equal(missing.status, 409);
  assert.equal(missing.body.missing[0].refresh_status, "failed");
  assert.match(missing.body.missing[0].refresh_error, /required source unavailable/);
  assert.ok(fixture.cache.inFlight, "the unrelated full-refresh work continues in the background");

  finishUnrelated();
  await fixture.cache.inFlight;
});

test("Core cache validates and returns the selected source with provenance", async (t) => {
  const fixture = await tempCache(t, {
    promptDescriptors: async () => [],
    coreDescriptors: async () => [coreDescriptor],
    fetchCore: async () => {
      const content = "# 道\n\nCore body";
      return {
        kind: "dao", sourceUrl: coreDescriptor.source, documentId: coreDescriptor.document_id,
        revision: 7, sha256: digest(content), readAt: new Date(fixture.getNow()).toISOString(), content
      };
    }
  });
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  assert.equal((await fixture.cache.status()).resources[0].cache_status, "available");
  const result = await fixture.cache.read({ coreKinds: ["dao"] });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "learn-x-chatpack-cache");
  assert.equal(result.body.cores.dao.revision, 7);
  assert.equal(result.body.cores.dao.content, "# 道\n\nCore body");
});

test("mapping changes and body hash damage invalidate cache entries", async (t) => {
  const fixture = await tempCache(t);
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  const remapped = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [{ ...promptDescriptor, document_id: "new-document" }],
    coreDescriptors: async () => [], fetchPrompt: async () => {}, fetchCore: async () => {}
  });
  await remapped.initialize({ refresh: false });
  assert.equal((await remapped.status()).resources[0].cache_status, "source_changed");

  const corrupted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [], fetchPrompt: async () => {}, fetchCore: async () => {}
  });
  await corrupted.initialize({ refresh: false });
  corrupted.entries.get("prompt:chatpack.sample").content = "tampered body";
  assert.equal((await corrupted.status()).resources[0].cache_status, "integrity_invalid");
  assert.equal((await corrupted.read({ promptIds: [promptDescriptor.id] })).status, 409);
});

test("one in-flight full refresh merges callers, prioritizes required items, and stays at two readers", async (t) => {
  const ids = ["chatpack.first", "chatpack.second", "chatpack.other"];
  const active = new Set();
  const started = [];
  const releases = [];
  let maxActive = 0;
  const fixture = await tempCache(t, {
    promptDescriptors: async () => ids.map((id) => ({ id, source: `https://example.test/${id}`, document_id: `doc-${id}` })),
    fetchPrompt: async (descriptor) => {
      active.add(descriptor.id);
      started.push(descriptor.id);
      maxActive = Math.max(maxActive, active.size);
      await new Promise((resolve) => releases.push(resolve));
      active.delete(descriptor.id);
      const content = `Body for ${descriptor.id}`;
      return {
        contract_version: "prompt-asset/v1", prompt_id: descriptor.id, prompt_source: descriptor.source,
        prompt_document_id: descriptor.document_id, prompt_revision: 1, prompt_sha256: digest(content),
        prompt_fetched_at: new Date(fixture.getNow()).toISOString(), content
      };
    }
  });
  const first = fixture.cache.requestRefresh();
  const merged = fixture.cache.requestRefresh({ priority: ["prompt:chatpack.other"] });
  assert.equal(first.state, "running");
  assert.equal(merged.merged, true);
  while (started.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(started.includes("chatpack.other"), "a queued required resource is promoted ahead of unrelated work");
  while (releases.length) releases.shift()();
  while (started.length < ids.length) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (releases.length) releases.shift()();
  }
  await fixture.cache.inFlight;
  assert.equal(maxActive, 2);
  assert.equal(started.length, ids.length, "coalesced callers do not start a second full refresh");
  assert.equal(fixture.cache.cooldownTimer, null);
});

test("refresh cooldown survives process restart and starts one full refresh when it expires", async (t) => {
  const timers = [];
  const setTimeoutFn = (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  const start = Date.parse("2026-10-20T00:00:00.000Z");
  let now = start;
  let reads = 0;
  const fixture = await tempCache(t, {
    now,
    setTimeoutFn,
    fetchPrompt: async () => { reads += 1; return promptAsset("Prompt body", now, reads); }
  });
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  now += 30_000;
  const restarted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => { reads += 1; return promptAsset("Prompt body", now, reads); }, fetchCore: async () => {},
    now: () => now, setTimeoutFn
  });
  await restarted.initialize({ refresh: false });
  assert.equal(restarted.requestRefresh().state, "cooldown");
  assert.equal(reads, 1, "restart does not clear the one-minute request throttle");
  const cooldown = timers.find((timer) => timer.delay === 30_000);
  assert.ok(cooldown);
  now += cooldown.delay;
  cooldown.callback();
  for (let attempt = 0; attempt < 20 && !restarted.inFlight; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(restarted.inFlight, "the shared cooldown timer starts the deferred refresh");
  await restarted.inFlight;
  assert.equal(reads, 2);
});

test("partial refresh makes cache.read return no partial pack", async (t) => {
  const second = { id: "chatpack.second", source: "https://example.test/second", document_id: "doc-second" };
  const fixture = await tempCache(t, {
    promptDescriptors: async () => [promptDescriptor, second],
    fetchPrompt: async (descriptor) => {
      if (descriptor.id === second.id) throw new Error("permission denied");
      const content = "First body";
      return { ...promptAsset(content, fixture.getNow()), prompt_source: descriptor.source, prompt_document_id: descriptor.document_id, prompt_id: descriptor.id };
    }
  });
  fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  const result = await fixture.cache.read({ promptIds: [promptDescriptor.id, second.id] });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.missing.map((item) => item.key), ["prompt:chatpack.second"]);
  assert.equal("prompts" in result.body, false);
});

test("disk persistence failure stays visible while freshly fetched memory content remains usable", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "learn-x-chatpack-cache-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "real-cache-dir");
  const link = path.join(directory, "cache-link");
  const { mkdir, symlink } = await import("node:fs/promises");
  await mkdir(target);
  await symlink(target, link);
  const cache = new ChatPackCache({
    filePath: path.join(link, "state.json"), promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => promptAsset("Fresh body", Date.now()), fetchCore: async () => {}
  });
  await cache.initialize({ refresh: false });
  cache.requestRefresh();
  await cache.inFlight;
  const status = await cache.status();
  assert.match(status.refresh.storage_error, /符号链接/);
  assert.equal(status.resources[0].cache_status, "available");
  assert.equal((await cache.read({ promptIds: [promptDescriptor.id] })).status, 200);
});

test("rejects a symlinked cache root before creating its child directory", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "learn-x-chatpack-cache-root-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "outside-cache-root");
  const localRoot = path.join(directory, ".local");
  const { mkdir, symlink } = await import("node:fs/promises");
  await mkdir(target);
  await symlink(target, localRoot);
  const cache = new ChatPackCache({
    filePath: path.join(localRoot, "chatpack-cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => promptAsset("Fresh body", Date.now()), fetchCore: async () => {}
  });
  await cache.initialize({ refresh: false });
  cache.requestRefresh();
  await cache.inFlight;
  const status = await cache.status();
  assert.match(status.refresh.storage_error, /缓存根目录.*符号链接/);
  assert.equal(status.resources[0].cache_status, "available");
  await assert.rejects(readFile(path.join(target, "chatpack-cache", "state.json")), { code: "ENOENT" });
});

test("corrupt cache file remains visible until a resource is successfully repaired", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "learn-x-chatpack-cache-corrupt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "cache", "state.json");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "{broken json", "utf8");
  const cache = new ChatPackCache({
    filePath, promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => { throw new Error("Feishu unavailable"); }, fetchCore: async () => {}
  });
  await cache.initialize({ refresh: false });
  assert.equal((await cache.status()).refresh.file_corrupt, true);
  cache.requestRefresh();
  await cache.inFlight;
  const status = await cache.status();
  assert.equal(status.refresh.file_corrupt, true);
  assert.match(status.refresh.file_error, /JSON|Unexpected|position/i);
  assert.equal(status.resources[0].cache_status, "not_fetched");
});

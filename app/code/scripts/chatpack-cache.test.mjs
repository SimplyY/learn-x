import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CHATPACK_CACHE_DAILY_MS, CHATPACK_CACHE_TTL_MS, ChatPackCache } from "./chatpack-cache.mjs";

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
  await first.cache.requestRefresh();
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
    now: () => fetchedAt + CHATPACK_CACHE_TTL_MS - 1,
    setTimeoutFn: () => ({ unref() {} })
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
    now: () => fetchedAt + CHATPACK_CACHE_TTL_MS,
    setTimeoutFn: () => ({ unref() {} })
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
  let fetchCalls = 0;
  const fixture = await tempCache(t, {
    now: initial,
    fetchPrompt: async () => {
      fetchCalls += 1;
      if (shouldFail) throw new Error("Feishu timeout");
      return promptAsset("Original body", initial, 3);
    }
  });
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  shouldFail = true;
  fixture.setNow(initial + 60_000);
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  const failedStatus = await fixture.cache.status();
  assert.equal(failedStatus.refresh.state, "failed");
  assert.equal(failedStatus.refresh.next_allowed_at, null, "a failed refresh must not expose a success cooldown");
  const callsBeforeRetry = fetchCalls;
  const retry = await fixture.cache.requestRefresh();
  assert.equal(retry.state, "running", "a failed refresh can be retried immediately");
  await fixture.cache.inFlight;
  assert.equal(fetchCalls, callsBeforeRetry + 1, "the immediate retry actually reads the resource again");

  const status = await fixture.cache.status();
  assert.equal(status.resources[0].cache_status, "available");
  assert.equal(status.resources[0].revision, 3);
  assert.match(status.resources[0].refresh_error, /Feishu timeout/);
  const read = await fixture.cache.read({ promptIds: [promptDescriptor.id] });
  assert.equal(read.status, 200);
  assert.equal(read.body.prompts[promptDescriptor.id].content, "Original body");

  const restarted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [],
    fetchPrompt: async () => {
      fetchCalls += 1;
      throw new Error("Feishu timeout");
    },
    fetchCore: async () => {},
    now: fixture.getNow
  });
  await restarted.initialize({ refresh: false });
  assert.equal((await restarted.status()).refresh.state, "failed", "restart restores the failed outcome");
  const callsBeforeRestartRetry = fetchCalls;
  assert.equal((await restarted.requestRefresh()).state, "running", "a restart does not restore cooldown after failure");
  await restarted.inFlight;
  assert.equal(fetchCalls, callsBeforeRestartRetry + 1);
});

test("a newer Prompt revision replaces the cached body and survives a restart", async (t) => {
  const initial = Date.parse("2026-10-20T00:00:00.000Z");
  let content = "Prompt revision one";
  let revision = 1;
  const fixture = await tempCache(t, {
    now: initial,
    fetchPrompt: async () => promptAsset(content, fixture.getNow(), revision)
  });
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  content = "Prompt revision two";
  revision = 2;
  fixture.setNow(initial + 60_000);
  await fixture.cache.requestRefresh();
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
  await fixture.cache.requestRefresh({ priority: [`prompt:${promptDescriptor.id}`] });
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
  await fixture.cache.requestRefresh();
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
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  const remapped = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [{ ...promptDescriptor, document_id: "new-document" }],
    coreDescriptors: async () => [], fetchPrompt: async () => {}, fetchCore: async () => {}, now: fixture.getNow
  });
  await remapped.initialize({ refresh: false });
  assert.equal((await remapped.status()).resources[0].cache_status, "source_changed");

  const corrupted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [], fetchPrompt: async () => {}, fetchCore: async () => {}, now: fixture.getNow
  });
  await corrupted.initialize({ refresh: false });
  const cachePath = path.join(fixture.directory, "cache", "state.json");
  const saved = JSON.parse(await readFile(cachePath, "utf8"));
  saved.items["prompt:chatpack.sample"].content = "tampered body";
  await writeFile(cachePath, JSON.stringify(saved), "utf8");
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
  const first = await fixture.cache.requestRefresh();
  const merged = await fixture.cache.requestRefresh({ priority: ["prompt:chatpack.other"] });
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

test("separate service instances share refresh lock, live progress, priority, cache reads, and cooldown", async (t) => {
  const ids = ["chatpack.first", "chatpack.second", "chatpack.other", "chatpack.required"];
  const descriptors = ids.map((id) => ({ id, source: `https://example.test/${id}`, document_id: `doc-${id}` }));
  const started = [];
  const releases = [];
  let followerReads = 0;
  const fixture = await tempCache(t, {
    promptDescriptors: async () => descriptors,
    fetchPrompt: async (descriptor) => {
      started.push(descriptor.id);
      await new Promise((resolve) => releases.push(resolve));
      const content = `Body for ${descriptor.id}`;
      return {
        contract_version: "prompt-asset/v1", prompt_id: descriptor.id,
        prompt_source: descriptor.source, prompt_document_id: descriptor.document_id,
        prompt_revision: 1, prompt_sha256: digest(content),
        prompt_fetched_at: new Date(fixture.getNow()).toISOString(), content
      };
    }
  });
  const follower = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => descriptors, coreDescriptors: async () => [],
    fetchPrompt: async () => { followerReads += 1; throw new Error("follower must not start another refresh"); },
    fetchCore: async () => {}, now: fixture.getNow
  });
  await follower.initialize({ refresh: false });

  await fixture.cache.requestRefresh();
  while (started.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  const observed = await follower.status();
  assert.equal(observed.refresh.state, "running");
  assert.equal(observed.refresh.completed, 0);
  const merged = await follower.requestRefresh({ priority: ["prompt:chatpack.required"] });
  assert.deepEqual(merged, { state: "running", merged: true });
  assert.equal(followerReads, 0);

  const releasePending = async () => {
    const pending = releases.splice(0);
    for (const release of pending) release();
  };
  await releasePending();
  while (started.length < 3) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(started[2], "chatpack.required", "a request from another service instance promotes its required resource");
  while (started.length < ids.length) {
    await releasePending();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await releasePending();
  const refresh = fixture.cache.inFlight;
  await refresh;

  const read = await follower.read({ promptIds: ["chatpack.required"] });
  assert.equal(read.status, 200, "the other instance reads the latest atomically persisted entry");
  assert.equal(followerReads, 0);
  assert.equal((await follower.requestRefresh()).state, "cooldown", "the one-minute throttle is shared across instances");
});

test("a failed refresh does not auto-loop for queued priority work", async (t) => {
  const timers = [];
  const setTimeoutFn = (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  let announceStarted;
  const started = new Promise((resolve) => { announceStarted = resolve; });
  let releaseFetch;
  let fetchCalls = 0;
  let fixture;
  fixture = await tempCache(t, {
    setTimeoutFn,
    fetchPrompt: async () => {
      fetchCalls += 1;
      announceStarted();
      await new Promise((resolve) => { releaseFetch = resolve; });
      fixture.cache.cooldownPriorities.add("prompt:chatpack.sample");
      throw new Error("Feishu DNS failure");
    }
  });
  assert.equal((await fixture.cache.requestRefresh()).state, "running");
  await started;

  const follower = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor],
    coreDescriptors: async () => [],
    fetchPrompt: async () => { throw new Error("follower must not start a competing refresh"); },
    fetchCore: async () => {}
  });
  await follower.initialize({ refresh: false });
  assert.deepEqual(await follower.requestRefresh({ priority: ["prompt:chatpack.sample"] }), { state: "running", merged: true });

  releaseFetch();
  await fixture.cache.inFlight;
  assert.equal((await fixture.cache.status()).refresh.state, "failed");
  assert.equal(fixture.cache.cooldownPriorities.has("prompt:chatpack.sample"), true);
  assert.equal(fixture.cache.cooldownTimer, null, "failure does not schedule an automatic retry loop");
  assert.equal(fetchCalls, 1);
  assert.equal(timers.some((timer) => timer.delay < 60_000), false, "only the daily timer remains scheduled");
});

test("refresh lock coalesces independent Node processes and safely recovers stale locks", { timeout: 30_000 }, async (t) => {
  const workerUrl = new URL("./chatpack-cache.mjs", import.meta.url).href;
  const workerSource = `
    import { createHash } from "node:crypto";
    import { access, writeFile } from "node:fs/promises";
    import { ChatPackCache } from ${JSON.stringify(workerUrl)};
    const [cachePath, gatePath, readyPath, resultPath, role] = process.argv.slice(2);
    const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
    const descriptor = { id: "chatpack.sample", source: "${source}", document_id: "${documentId}" };
    let reads = 0;
    const cache = new ChatPackCache({
      filePath: cachePath,
      promptDescriptors: async () => [descriptor],
      coreDescriptors: async () => [],
      fetchPrompt: async () => {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        const content = "One cross-process refresh";
        return {
          contract_version: "prompt-asset/v1", prompt_id: descriptor.id,
          prompt_source: descriptor.source, prompt_document_id: descriptor.document_id,
          prompt_revision: 1, prompt_sha256: digest(content),
          prompt_fetched_at: "2026-10-20T00:00:00.000Z", content
        };
      },
      fetchCore: async () => { throw new Error("unexpected Core read"); }
    });
    await cache.initialize({ refresh: false });
    await writeFile(readyPath, role, "utf8");
    while (true) {
      try { await access(gatePath); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
    const request = await cache.requestRefresh();
    if (cache.inFlight) await cache.inFlight;
    await writeFile(resultPath, JSON.stringify({ request, reads }), "utf8");
  `;
  for (const staleKind of ["none", "main", "recovery"]) {
    await t.test(staleKind, async (t) => {
      const fixture = await tempCache(t);
      const cachePath = path.join(fixture.directory, "cache", "state.json");
      const lockPath = `${cachePath}.refresh.lock`;
      const recoveryPath = `${lockPath}.refresh.recovery`;
      const gatePath = path.join(fixture.directory, "start-refresh");
      const workerPath = path.join(fixture.directory, "refresh-worker.mjs");
      if (staleKind === "main") {
        await writeFile(lockPath, "", "utf8");
        const staleAt = new Date(fixture.getNow() - 6_000);
        await utimes(lockPath, staleAt, staleAt);
      } else if (staleKind === "recovery") {
        await writeFile(recoveryPath, JSON.stringify({ pid: 99_999_999, token: "dead-owner" }), "utf8");
        const staleAt = new Date(fixture.getNow() - 6_000);
        await utimes(recoveryPath, staleAt, staleAt);
      }
      await writeFile(workerPath, workerSource, "utf8");

      const children = ["one", "two"].map((role) => {
        const readyPath = path.join(fixture.directory, `${role}.ready`);
        const resultPath = path.join(fixture.directory, `${role}.result`);
        const child = spawn(process.execPath, [workerPath, cachePath, gatePath, readyPath, resultPath, role], { stdio: "ignore" });
        t.after(() => child.kill("SIGKILL"));
        return { child, readyPath, resultPath };
      });
      const childExits = Promise.all(children.map(({ child }) => once(child, "exit")));
      const readyDeadline = Date.now() + 10_000;
      while (Date.now() < readyDeadline) {
        const ready = await Promise.all(children.map(({ readyPath }) => access(readyPath).then(() => true, () => false)));
        if (ready.every(Boolean)) break;
        if (children.some(({ child }) => child.exitCode !== null)) throw new Error("a cache worker exited before the refresh barrier opened");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const ready = await Promise.all(children.map(({ readyPath }) => access(readyPath).then(() => true, () => false)));
      assert.deepEqual(ready, [true, true], "both operating-system processes reach the shared barrier");
      await writeFile(gatePath, "go", "utf8");

      for (const [code, signal] of await childExits) {
        assert.equal(code, 0, `cache worker exited with signal ${signal || "none"}`);
      }
      const outcomes = await Promise.all(children.map(async ({ resultPath }) => JSON.parse(await readFile(resultPath, "utf8"))));
      assert.equal(outcomes.reduce((sum, item) => sum + item.reads, 0), 1, "the two processes start one remote resource read");
      const read = await fixture.cache.read({ promptIds: [promptDescriptor.id] });
      assert.equal(read.status, 200, "the completed worker refresh is visible from a separate process context");
    });
  }
});

test("refresh reclaims stale empty and malformed lock files", async (t) => {
  for (const [label, contents] of [["empty", ""], ["malformed", "{broken json"]]) {
    await t.test(label, async (t) => {
      const fixture = await tempCache(t);
      const lockPath = `${path.join(fixture.directory, "cache", "state.json")}.refresh.lock`;
      await writeFile(lockPath, contents, "utf8");
      const staleAt = new Date(fixture.getNow() - 6_000);
      await utimes(lockPath, staleAt, staleAt);
      let reads = 0;
      fixture.cache.fetchPrompt = async () => {
        reads += 1;
        return promptAsset("Recovered after stale lock", fixture.getNow());
      };

      const request = await fixture.cache.requestRefresh();
      assert.deepEqual(request, { state: "running", merged: false });
      await fixture.cache.inFlight;
      assert.equal(reads, 1);
      assert.equal((await fixture.cache.status()).resources[0].cache_status, "available");
    });
  }
});

test("a recent incomplete lock schedules recovery instead of waiting forever", async (t) => {
  const fixture = await tempCache(t, { setTimeoutFn: (callback, delay) => ({ callback, delay, unref() {} }) });
  const lockPath = `${path.join(fixture.directory, "cache", "state.json")}.refresh.lock`;
  await writeFile(lockPath, "", "utf8");
  const createdAt = new Date(fixture.getNow());
  await utimes(lockPath, createdAt, createdAt);
  let reads = 0;
  fixture.cache.fetchPrompt = async () => {
    reads += 1;
    return promptAsset("Recovered after initialization grace", fixture.getNow());
  };
  const request = await fixture.cache.requestRefresh();
  assert.equal(request.state, "recovering");
  assert.equal(request.merged, true);
  assert.ok(request.retry_at);
  assert.equal((await fixture.cache.status()).refresh.state, "recovering", "the recovery grace is distinct from an active refresh");
  const recoveryTimer = fixture.cache.cooldownTimer;
  assert.ok(recoveryTimer);
  assert.equal(recoveryTimer.delay, 5_000);

  fixture.setNow(fixture.getNow() + recoveryTimer.delay + 1);
  recoveryTimer.callback();
  for (let attempt = 0; attempt < 100 && !fixture.cache.inFlight; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(fixture.cache.inFlight, "the bounded initialization grace ends in a real refresh");
  await fixture.cache.inFlight;
  assert.equal(reads, 1);
  assert.equal((await fixture.cache.status()).resources[0].cache_status, "available");
});

test("refresh reclaims an orphaned recovery marker and reports a fresh malformed marker as failed", async (t) => {
  const orphaned = await tempCache(t);
  const lockPath = `${path.join(orphaned.directory, "cache", "state.json")}.refresh.lock`;
  const recoveryPath = `${lockPath}.refresh.recovery`;
  await writeFile(recoveryPath, JSON.stringify({ pid: 99_999_999, token: "dead-owner" }), "utf8");
  const staleAt = new Date(orphaned.getNow() - 6_000);
  await utimes(recoveryPath, staleAt, staleAt);
  const recovered = await orphaned.cache.requestRefresh();
  assert.deepEqual(recovered, { state: "running", merged: false });
  await orphaned.cache.inFlight;
  assert.equal((await orphaned.cache.status()).resources[0].cache_status, "available");

  const blocked = await tempCache(t);
  const blockedLockPath = `${path.join(blocked.directory, "cache", "state.json")}.refresh.lock`;
  await writeFile(`${blockedLockPath}.refresh.recovery`, "", "utf8");
  let reads = 0;
  blocked.cache.fetchPrompt = async () => { reads += 1; return promptAsset("Should not run", blocked.getNow()); };
  const failed = await blocked.cache.requestRefresh();
  assert.equal(failed.state, "failed");
  assert.equal(failed.merged, false);
  assert.match(failed.error, /无法安全恢复/);
  assert.equal((await blocked.cache.status()).refresh.state, "failed");
  assert.equal(reads, 0, "an orphaned fresh marker is never reported as a real running refresh");
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
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;

  now += 30_000;
  const restarted = new ChatPackCache({
    filePath: path.join(fixture.directory, "cache", "state.json"),
    promptDescriptors: async () => [promptDescriptor], coreDescriptors: async () => [],
    fetchPrompt: async () => { reads += 1; return promptAsset("Prompt body", now, reads); }, fetchCore: async () => {},
    now: () => now, setTimeoutFn
  });
  await restarted.initialize({ refresh: false });
  assert.equal((await restarted.requestRefresh()).state, "cooldown");
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

test("daily refresh starts a full update 24 hours after the last refresh", async (t) => {
  const timers = [];
  const setTimeoutFn = (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  const start = Date.parse("2026-10-20T00:00:00.000Z");
  let reads = 0;
  let fixture;
  fixture = await tempCache(t, {
    now: start,
    setTimeoutFn,
    fetchPrompt: async () => {
      reads += 1;
      return promptAsset(`Prompt revision ${reads}`, fixture.getNow(), reads);
    }
  });
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  assert.equal(reads, 1);

  const dailyTimer = timers.filter((timer) => timer.delay === CHATPACK_CACHE_DAILY_MS).at(-1);
  assert.ok(dailyTimer, "the cache schedules a 24-hour refresh after a successful full refresh");
  fixture.setNow(fixture.getNow() + CHATPACK_CACHE_DAILY_MS);
  dailyTimer.callback();
  for (let attempt = 0; attempt < 20 && !fixture.cache.inFlight; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(fixture.cache.inFlight, "the daily timer starts the deferred full refresh");
  await fixture.cache.inFlight;
  assert.equal(reads, 2);
  const refresh = (await fixture.cache.status()).refresh;
  assert.equal(refresh.completed, 1);
  assert.equal(refresh.succeeded, 1);
  assert.equal(refresh.failed, 0);
  assert.ok(refresh.finished_at);
});

test("partial refresh makes cache.read return no partial pack", async (t) => {
  const second = { id: "chatpack.second", source: "https://example.test/second", document_id: "doc-second" };
  let fetchCalls = 0;
  const fixture = await tempCache(t, {
    promptDescriptors: async () => [promptDescriptor, second],
    fetchPrompt: async (descriptor) => {
      fetchCalls += 1;
      if (descriptor.id === second.id) throw new Error("permission denied");
      const content = "First body";
      return { ...promptAsset(content, fixture.getNow()), prompt_source: descriptor.source, prompt_document_id: descriptor.document_id, prompt_id: descriptor.id };
    }
  });
  await fixture.cache.requestRefresh();
  await fixture.cache.inFlight;
  const result = await fixture.cache.read({ promptIds: [promptDescriptor.id, second.id] });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.missing.map((item) => item.key), ["prompt:chatpack.second"]);
  assert.equal("prompts" in result.body, false);
  const failedStatus = await fixture.cache.status();
  assert.equal(failedStatus.refresh.state, "partial");
  assert.equal(failedStatus.refresh.next_allowed_at, null);
  const callsBeforeRetry = fetchCalls;
  assert.equal((await fixture.cache.requestRefresh()).state, "running", "a partially failed refresh can be retried immediately");
  await fixture.cache.inFlight;
  assert.equal(fetchCalls, callsBeforeRetry + 2, "an immediate retry refreshes the full resource set");
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
  await cache.requestRefresh();
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
  await cache.requestRefresh();
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
  await cache.requestRefresh();
  await cache.inFlight;
  const status = await cache.status();
  assert.equal(status.refresh.file_corrupt, true);
  assert.match(status.refresh.file_error, /JSON|Unexpected|position/i);
  assert.equal(status.resources[0].cache_status, "not_fetched");
});

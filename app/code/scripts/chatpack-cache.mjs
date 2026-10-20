import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export const CHATPACK_CACHE_SCHEMA = "learn-x-chatpack-cache/v1";
export const CHATPACK_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CHATPACK_CACHE_REFRESH_INTERVAL_MS = 60 * 1000;
export const CHATPACK_CACHE_DAILY_MS = 24 * 60 * 60 * 1000;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

export class ChatPackCache {
  constructor({
    filePath,
    promptDescriptors,
    coreDescriptors,
    fetchPrompt,
    fetchCore,
    now = () => Date.now(),
    setTimeoutFn = setTimeout
  }) {
    this.filePath = filePath;
    this.promptDescriptors = promptDescriptors;
    this.coreDescriptors = coreDescriptors;
    this.fetchPrompt = fetchPrompt;
    this.fetchCore = fetchCore;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.entries = new Map();
    this.fetchErrors = new Map();
    this.lastRefreshStartedAt = null;
    this.job = null;
    this.inFlight = null;
    this.cooldownTimer = null;
    this.dailyTimer = null;
    this.cooldownPriorities = new Set();
    this.storageError = "";
    this.fileCorrupt = false;
    this.fileError = "";
    this.persistTail = Promise.resolve();
  }

  async initialize({ refresh = true } = {}) {
    try {
      await this.#prepareDirectory();
    } catch (error) {
      this.storageError = error.message || "缓存目录不可用";
    }
    try {
      if (this.storageError) throw Object.assign(new Error(this.storageError), { code: "CACHE_STORAGE_UNAVAILABLE" });
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.schema !== CHATPACK_CACHE_SCHEMA || !parsed.items || typeof parsed.items !== "object") {
        throw new Error("缓存文件结构无效");
      }
      this.lastRefreshStartedAt = Number.isFinite(Date.parse(parsed.lastRefreshStartedAt)) ? Date.parse(parsed.lastRefreshStartedAt) : null;
      for (const [key, entry] of Object.entries(parsed.items)) this.entries.set(key, entry);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "CACHE_STORAGE_UNAVAILABLE") {
        this.fileCorrupt = true;
        this.fileError = error.message || "缓存文件读取失败";
      }
    }
    if (refresh) this.requestRefresh();
    return this;
  }

  async #prepareDirectory() {
    const directory = path.dirname(this.filePath);
    const cacheRoot = path.dirname(directory);
    try {
      const rootInfo = await lstat(cacheRoot);
      if (rootInfo.isSymbolicLink()) throw new Error("缓存根目录不能是符号链接");
      if (!rootInfo.isDirectory()) throw new Error("缓存根目录不可用");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
      const rootInfo = await lstat(cacheRoot);
      if (rootInfo.isSymbolicLink()) throw new Error("缓存根目录不能是符号链接");
      if (!rootInfo.isDirectory()) throw new Error("缓存根目录不可用");
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const dirInfo = await lstat(directory);
    if (dirInfo.isSymbolicLink()) throw new Error("缓存目录不能是符号链接");
    if (!dirInfo.isDirectory()) throw new Error("缓存目录不可用");
    await chmod(directory, 0o700);
    try {
      const fileInfo = await lstat(this.filePath);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("缓存文件类型无效");
      await chmod(this.filePath, 0o600);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async #persist({ repairCorrupt = false } = {}) {
    const write = async () => {
      let temporary = "";
      try {
        await this.#prepareDirectory();
        const bytes = JSON.stringify({
          schema: CHATPACK_CACHE_SCHEMA,
          lastRefreshStartedAt: this.lastRefreshStartedAt === null ? null : new Date(this.lastRefreshStartedAt).toISOString(),
          items: Object.fromEntries(this.entries)
        });
        temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.filePath);
        temporary = "";
        await chmod(this.filePath, 0o600);
        this.storageError = "";
        if (repairCorrupt) {
          this.fileCorrupt = false;
          this.fileError = "";
        }
        return true;
      } catch (error) {
        this.storageError = error.message || "缓存无法持久保存";
        return false;
      } finally {
        if (temporary) await rm(temporary, { force: true }).catch(() => {});
      }
    };
    const result = this.persistTail.catch(() => {}).then(write);
    this.persistTail = result;
    return result;
  }

  #key(kind, id) { return `${kind}:${id}`; }

  #entryStatus(entry, descriptor) {
    if (!entry) return "not_fetched";
    if (!descriptor || entry.source !== descriptor.source || entry.document_id !== descriptor.document_id) return "source_changed";
    if (typeof entry.content !== "string" || !entry.content.trim() || !/^[a-f0-9]{64}$/.test(entry.sha256) || sha256(entry.content) !== entry.sha256) return "integrity_invalid";
    if (!Number.isFinite(Date.parse(entry.fetched_at)) || Date.parse(entry.fetched_at) > this.now() + 60_000 ||
        Date.parse(entry.expires_at) !== Date.parse(entry.fetched_at) + CHATPACK_CACHE_TTL_MS) return "integrity_invalid";
    if (entry.kind === "prompt" && (entry.contract_version !== "prompt-asset/v1" || entry.prompt_id !== descriptor.id ||
        !Number.isInteger(entry.revision) || entry.revision < 0)) return "integrity_invalid";
    if (entry.kind === "core" && (entry.core_kind !== descriptor.id || !Number.isInteger(entry.revision) || entry.revision < 1)) return "integrity_invalid";
    if (Date.parse(entry.expires_at) <= this.now()) return "expired";
    return "available";
  }

  async #descriptors() {
    const [prompts, cores] = await Promise.all([this.promptDescriptors(), this.coreDescriptors()]);
    return [
      ...prompts.map((item) => ({ ...item, kind: "prompt", key: this.#key("prompt", item.id) })),
      ...cores.map((item) => ({ ...item, kind: "core", key: this.#key("core", item.id) }))
    ];
  }

  status() {
    return this.#descriptors().then((descriptors) => {
      const resources = descriptors.map((descriptor) => {
        const entry = this.entries.get(descriptor.key);
        const cacheStatus = this.#entryStatus(entry, descriptor);
        const refreshItem = this.job?.items?.[descriptor.key];
        const ageMs = entry && Number.isFinite(Date.parse(entry.fetched_at)) ? Math.max(0, this.now() - Date.parse(entry.fetched_at)) : null;
        return {
          key: descriptor.key,
          kind: descriptor.kind,
          id: descriptor.id,
          cache_status: cacheStatus,
          revision: entry?.revision ?? null,
          fetched_at: entry?.fetched_at ?? null,
          age_ms: ageMs,
          expires_at: entry?.expires_at ?? null,
          refresh_status: refreshItem?.state || "idle",
          refresh_error: refreshItem?.state === "failed" ? refreshItem.error : this.fetchErrors.get(descriptor.key) || ""
        };
      });
      const missing = resources.filter((item) => item.cache_status !== "available").length;
      const success = resources.length - missing;
      const now = this.now();
      const nextAllowedAt = this.lastRefreshStartedAt === null ? null : this.lastRefreshStartedAt + CHATPACK_CACHE_REFRESH_INTERVAL_MS;
      const cooling = !this.inFlight && nextAllowedAt !== null && nextAllowedAt > now;
      return {
        resources,
        summary: { total: resources.length, available: success, unavailable: missing },
        refresh: {
          state: this.inFlight ? "running" : cooling ? "cooldown" : this.job?.state || "idle",
          started_at: this.job?.startedAt ? new Date(this.job.startedAt).toISOString() : null,
          finished_at: this.job?.finishedAt ? new Date(this.job.finishedAt).toISOString() : null,
          completed: this.job?.completed || 0,
          total: this.job?.total || resources.length,
          succeeded: this.job?.succeeded || 0,
          failed: this.job?.failed || 0,
          current: this.job?.current || "",
          next_allowed_at: cooling ? new Date(nextAllowedAt).toISOString() : null,
          storage_error: this.storageError,
          file_corrupt: this.fileCorrupt,
          file_error: this.fileError,
          error: this.job?.error || ""
        }
      };
    });
  }

  requestRefresh({ priority = [] } = {}) {
    for (const key of priority) this.cooldownPriorities.add(key);
    if (this.inFlight) {
      for (const key of priority) this.inFlight.priorities.add(key);
      this.cooldownPriorities.clear();
      return { state: "running", merged: true };
    }
    const now = this.now();
    const nextAllowedAt = this.lastRefreshStartedAt === null ? now : this.lastRefreshStartedAt + CHATPACK_CACHE_REFRESH_INTERVAL_MS;
    if (nextAllowedAt > now) {
      this.#scheduleCooldown(nextAllowedAt - now);
      this.job = { ...(this.job || {}), state: "cooldown" };
      return { state: "cooldown", merged: Boolean(this.cooldownTimer), next_allowed_at: new Date(nextAllowedAt).toISOString() };
    }
    const priorities = new Set([...this.cooldownPriorities, ...priority]);
    const run = this.#runRefresh(priorities);
    run.priorities = priorities;
    this.inFlight = run;
    run.finally(() => {
      if (this.inFlight === run) this.inFlight = null;
      if (this.cooldownPriorities.size && this.cooldownTimer === null) this.#scheduleCooldown(0);
      this.#scheduleDaily();
    });
    return { state: "running", merged: false };
  }

  #scheduleCooldown(delay) {
    if (this.cooldownTimer !== null) return;
    this.cooldownTimer = this.setTimeoutFn(() => {
      this.cooldownTimer = null;
      const priorities = [...this.cooldownPriorities];
      this.cooldownPriorities.clear();
      this.requestRefresh({ priority: priorities });
    }, Math.max(0, delay));
    this.cooldownTimer?.unref?.();
  }

  #scheduleDaily() {
    if (this.dailyTimer !== null) clearTimeout(this.dailyTimer);
    const nextAt = (this.lastRefreshStartedAt ?? this.now()) + CHATPACK_CACHE_DAILY_MS;
    this.dailyTimer = this.setTimeoutFn(() => {
      this.dailyTimer = null;
      this.requestRefresh();
    }, Math.max(0, nextAt - this.now()));
    this.dailyTimer?.unref?.();
  }

  async #runRefresh(priorities) {
    const startedAt = this.now();
    this.lastRefreshStartedAt = startedAt;
    this.job = { state: "running", startedAt, finishedAt: null, completed: 0, succeeded: 0, failed: 0, current: "", total: 0, error: "", priorities, items: {} };
    await this.#persist();
    let descriptors;
    try {
      descriptors = await this.#descriptors();
    } catch (error) {
      this.job = { ...this.job, state: "failed", finishedAt: this.now(), error: error.message || "资源清单读取失败" };
      await this.#persist();
      return;
    }
    const queue = descriptors.slice();
    this.job.total = queue.length;
    for (const descriptor of descriptors) this.job.items[descriptor.key] = { state: "queued", error: "" };
    const worker = async () => {
      while (queue.length) {
        queue.sort((left, right) => Number(priorities.has(right.key)) - Number(priorities.has(left.key)));
        const descriptor = queue.shift();
        this.job.current = descriptor.key;
        this.job.items[descriptor.key] = { state: "running", error: "" };
        try {
          const asset = descriptor.kind === "prompt" ? await this.fetchPrompt(descriptor) : await this.fetchCore(descriptor);
          const normalized = this.#normalize(descriptor, asset);
          const current = (await this.#descriptors()).find((item) => item.kind === descriptor.kind && item.id === descriptor.id);
          if (!current || current.source !== descriptor.source || current.document_id !== descriptor.document_id) {
            throw new Error("来源映射已变化，丢弃本次读取");
          }
          this.entries.set(descriptor.key, normalized);
          this.fetchErrors.delete(descriptor.key);
          this.job.items[descriptor.key] = { state: "succeeded", error: "" };
          this.job.succeeded += 1;
          await this.#persist({ repairCorrupt: true });
        } catch (error) {
          const message = error.message || "资源读取失败";
          this.fetchErrors.set(descriptor.key, message);
          this.job.items[descriptor.key] = { state: "failed", error: message };
          this.job.failed += 1;
        } finally {
          this.job.completed += 1;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    this.job = { ...this.job, state: this.job.failed ? this.job.succeeded ? "partial" : "failed" : "succeeded", finishedAt: this.now(), current: "" };
    await this.#persist({ repairCorrupt: this.job.succeeded > 0 });
  }

  #normalize(descriptor, asset) {
    const content = asset?.content;
    const hash = descriptor.kind === "prompt" ? asset?.prompt_sha256 : asset?.sha256;
    const fetched = descriptor.kind === "prompt" ? asset?.prompt_fetched_at : asset?.readAt;
    if (typeof content !== "string" || !content.trim() || !/^[a-f0-9]{64}$/.test(hash || "") || sha256(content) !== hash) throw new Error("资源正文校验失败");
    const fetchedAt = Date.parse(fetched);
    if (!Number.isFinite(fetchedAt) || fetchedAt > this.now() + 60_000) throw new Error("资源读取时间无效");
    if (descriptor.kind === "prompt" && (asset.contract_version !== "prompt-asset/v1" || asset.prompt_id !== descriptor.id ||
        asset.prompt_source !== descriptor.source || asset.prompt_document_id !== descriptor.document_id ||
        !Number.isInteger(asset.prompt_revision) || asset.prompt_revision < 0)) throw new Error("Prompt 身份或版本校验失败");
    if (descriptor.kind === "core" && (asset.kind !== descriptor.id || asset.sourceUrl !== descriptor.source ||
        asset.documentId !== descriptor.document_id || !Number.isInteger(asset.revision) || asset.revision < 1)) throw new Error("Core 身份或版本校验失败");
    return {
      kind: descriptor.kind,
      id: descriptor.id,
      prompt_id: descriptor.kind === "prompt" ? descriptor.id : undefined,
      core_kind: descriptor.kind === "core" ? descriptor.id : undefined,
      source: descriptor.source,
      document_id: descriptor.document_id,
      contract_version: descriptor.kind === "prompt" ? asset.contract_version : undefined,
      revision: descriptor.kind === "prompt" ? asset.prompt_revision : asset.revision,
      sha256: hash,
      fetched_at: new Date(fetchedAt).toISOString(),
      expires_at: new Date(fetchedAt + CHATPACK_CACHE_TTL_MS).toISOString(),
      content
    };
  }

  async read({ promptIds = [], coreKinds = [] } = {}) {
    const descriptors = await this.#descriptors();
    const selected = [];
    for (const id of promptIds) {
      const descriptor = descriptors.find((item) => item.kind === "prompt" && item.id === id);
      if (!descriptor) return { status: 400, body: { error: `未登记的 Prompt：${id}` } };
      selected.push(descriptor);
    }
    for (const id of coreKinds) {
      const descriptor = descriptors.find((item) => item.kind === "core" && item.id === id);
      if (!descriptor) return { status: 400, body: { error: `未知 Core 来源：${id}` } };
      selected.push(descriptor);
    }
    const missing = selected.filter((descriptor) => this.#entryStatus(this.entries.get(descriptor.key), descriptor) !== "available");
    if (missing.length) {
      const status = await this.status();
      return { status: 409, body: {
        error: "必需缓存尚不可用",
        missing: missing.map((descriptor) => {
          const resourceStatus = status.resources.find((item) => item.key === descriptor.key);
          return {
            key: descriptor.key,
            cache_status: resourceStatus?.cache_status,
            refresh_status: resourceStatus?.refresh_status || "idle",
            refresh_error: resourceStatus?.refresh_error || this.fetchErrors.get(descriptor.key) || ""
          };
        })
      } };
    }
    const prompts = {};
    const cores = {};
    for (const descriptor of selected) {
      const entry = this.entries.get(descriptor.key);
      if (descriptor.kind === "prompt") {
        prompts[descriptor.id] = {
          contract_version: entry.contract_version,
          prompt_id: descriptor.id,
          prompt_revision: entry.revision,
          prompt_sha256: entry.sha256,
          prompt_fetched_at: entry.fetched_at,
          content: entry.content,
          cache_age_ms: Math.max(0, this.now() - Date.parse(entry.fetched_at))
        };
      } else {
        cores[descriptor.id] = {
          kind: descriptor.id,
          sourceUrl: descriptor.source,
          documentId: descriptor.document_id,
          revision: entry.revision,
          sha256: entry.sha256,
          readAt: entry.fetched_at,
          content: entry.content,
          cache_age_ms: Math.max(0, this.now() - Date.parse(entry.fetched_at))
        };
      }
    }
    return { status: 200, body: { source: "learn-x-chatpack-cache", prompts, cores } };
  }
}

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, link, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const CHATPACK_CACHE_SCHEMA = "learn-x-chatpack-cache/v1";
export const CHATPACK_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CHATPACK_CACHE_REFRESH_INTERVAL_MS = 60 * 1000;
export const CHATPACK_CACHE_DAILY_MS = 24 * 60 * 60 * 1000;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const LOCK_INITIALIZATION_GRACE_MS = 5_000;
const REFRESH_LOCK_SUFFIX = ".refresh.lock";
const REFRESH_RECOVERY_SUFFIX = ".refresh.recovery";
const PRIORITY_MARKER_PREFIX = ".refresh-priority-";

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
    this.lockPath = `${filePath}${REFRESH_LOCK_SUFFIX}`;
    this.recoveryPath = `${this.lockPath}${REFRESH_RECOVERY_SUFFIX}`;
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
    this.refreshLockStatus = null;
  }

  async initialize({ refresh = true } = {}) {
    try {
      await this.#prepareDirectory();
    } catch (error) {
      this.storageError = error.message || "缓存目录不可用";
    }
    try {
      if (this.storageError) throw Object.assign(new Error(this.storageError), { code: "CACHE_STORAGE_UNAVAILABLE" });
      await this.#syncDisk();
    } catch (error) {
      this.fileCorrupt = true;
      this.fileError = error.message || "缓存文件读取失败";
    }
    if (refresh) await this.requestRefresh();
    this.#scheduleDaily();
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

  #serializeJob() {
    if (!this.job) return null;
    return {
      state: this.job.state,
      started_at: this.job.startedAt ? new Date(this.job.startedAt).toISOString() : null,
      finished_at: this.job.finishedAt ? new Date(this.job.finishedAt).toISOString() : null,
      completed: this.job.completed || 0,
      succeeded: this.job.succeeded || 0,
      failed: this.job.failed || 0,
      current: this.job.current || "",
      total: this.job.total || 0,
      error: this.job.error || "",
      items: this.job.items || {}
    };
  }

  #deserializeJob(value) {
    if (!value || typeof value !== "object") return null;
    return {
      state: value.state || "idle",
      startedAt: Number.isFinite(Date.parse(value.started_at)) ? Date.parse(value.started_at) : null,
      finishedAt: Number.isFinite(Date.parse(value.finished_at)) ? Date.parse(value.finished_at) : null,
      completed: Number.isFinite(value.completed) ? value.completed : 0,
      succeeded: Number.isFinite(value.succeeded) ? value.succeeded : 0,
      failed: Number.isFinite(value.failed) ? value.failed : 0,
      current: typeof value.current === "string" ? value.current : "",
      total: Number.isFinite(value.total) ? value.total : 0,
      error: typeof value.error === "string" ? value.error : "",
      items: value.items && typeof value.items === "object" ? value.items : {}
    };
  }

  async #syncDisk() {
    if (this.storageError) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.schema !== CHATPACK_CACHE_SCHEMA || !parsed.items || typeof parsed.items !== "object") {
        throw new Error("缓存文件结构无效");
      }
      const diskStartedAt = Number.isFinite(Date.parse(parsed.lastRefreshStartedAt)) ? Date.parse(parsed.lastRefreshStartedAt) : null;
      if (diskStartedAt !== null && (this.lastRefreshStartedAt === null || diskStartedAt > this.lastRefreshStartedAt)) {
        this.lastRefreshStartedAt = diskStartedAt;
      }
      for (const [key, entry] of Object.entries(parsed.items)) {
        const localFetchedAt = Date.parse(this.entries.get(key)?.fetched_at);
        const diskFetchedAt = Date.parse(entry?.fetched_at);
        if (!this.entries.has(key) || (Number.isFinite(diskFetchedAt) && (!Number.isFinite(localFetchedAt) || diskFetchedAt >= localFetchedAt))) {
          this.entries.set(key, entry);
        }
      }
      const diskJob = this.#deserializeJob(parsed.refresh);
      if (!this.inFlight && diskJob && (!this.job || diskJob.startedAt >= (this.job.startedAt || 0))) this.job = diskJob;
      this.fileCorrupt = false;
      this.fileError = "";
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.fileCorrupt = true;
        this.fileError = error.message || "缓存文件读取失败";
      }
    }
    this.refreshLockStatus = await this.#readRefreshLock();
    if (!this.inFlight && this.job?.state === "running" && !this.refreshLockStatus?.active) {
      const message = "缓存更新进程已退出，尚未完成的资源需要重新刷新";
      this.job = {
        ...this.job,
        state: "failed",
        finishedAt: this.now(),
        current: "",
        error: this.job.error || message,
        items: Object.fromEntries(Object.entries(this.job.items || {}).map(([key, item]) => [
          key,
          ["queued", "running"].includes(item?.state) ? { state: "failed", error: message } : item
        ]))
      };
    }
  }

  async #persist({ repairCorrupt = false, lockToken = "" } = {}) {
    if (this.fileCorrupt && !repairCorrupt) return false;
    const write = async () => {
      let temporary = "";
      try {
        await this.#prepareDirectory();
        if (lockToken) {
          const lock = await this.#readRefreshLock();
          if (!lock || lock.token !== lockToken) throw new Error("缓存刷新锁已失效，停止写入共享状态");
        }
        const bytes = JSON.stringify({
          schema: CHATPACK_CACHE_SCHEMA,
          lastRefreshStartedAt: this.lastRefreshStartedAt === null ? null : new Date(this.lastRefreshStartedAt).toISOString(),
          items: Object.fromEntries(this.entries),
          refresh: this.#serializeJob()
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

  async #readLock(filePath) {
    try {
      const info = await lstat(filePath);
      if (info.isSymbolicLink() || !info.isFile()) return { active: false, blocked: true, token: "", pid: null, info };
      let value;
      try {
        value = JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        const initializing = this.now() - info.mtimeMs < LOCK_INITIALIZATION_GRACE_MS;
        return {
          active: initializing,
          initializing,
          blocked: false,
          token: "",
          pid: null,
          info
        };
      }
      const pid = Number.isInteger(value?.pid) ? value.pid : null;
      let processAlive = false;
      if (pid) {
        try {
          process.kill(pid, 0);
          processAlive = true;
        } catch (error) {
          processAlive = error.code === "EPERM";
        }
      }
      const token = typeof value?.token === "string" ? value.token : "";
      const initializing = !(pid && token) && this.now() - info.mtimeMs < LOCK_INITIALIZATION_GRACE_MS;
      return {
        active: (Boolean(pid && token) && processAlive) || initializing,
        initializing,
        blocked: false,
        token,
        pid,
        info
      };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      return { active: false, blocked: true, token: "", pid: null };
    }
  }

  async #readRefreshLock() {
    return this.#readLock(this.lockPath);
  }

  #sameLockFile(left, right) {
    return left?.info && right?.info && left.info.dev === right.info.dev && left.info.ino === right.info.ino &&
      left.info.size === right.info.size && left.info.mtimeMs === right.info.mtimeMs;
  }

  #isStaleLock(lock) {
    if (!lock || lock.active || lock.blocked) return false;
    return Boolean(lock.pid) || this.now() - (lock.info?.mtimeMs || 0) >= LOCK_INITIALIZATION_GRACE_MS;
  }

  async #claimLock(filePath) {
    const token = randomUUID();
    const temporary = `${filePath}.${process.pid}.${token}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, started_at: new Date(this.now()).toISOString() }), "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await link(temporary, filePath);
      } catch (error) {
        if (error.code === "EEXIST") return null;
        throw error;
      }
      return { token };
    } finally {
      await handle?.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async #removeStaleLock(filePath, observed) {
    if (!this.#isStaleLock(observed)) return false;
    const current = await this.#readLock(filePath);
    if (!this.#sameLockFile(observed, current) || !this.#isStaleLock(current)) return false;
    const stalePath = `${filePath}.${randomUUID()}.stale`;
    try {
      await rename(filePath, stalePath);
      await rm(stalePath, { force: true });
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }
  }

  async #recoverStaleRecoveryLock() {
    const observed = await this.#readLock(this.recoveryPath);
    if (!observed || observed.active || observed.blocked) return false;
    return this.#removeStaleLock(this.recoveryPath, observed);
  }

  async #recoverStaleRefreshLock() {
    let recoveryLock = await this.#claimLock(this.recoveryPath);
    if (!recoveryLock) {
      if (await this.#recoverStaleRecoveryLock()) recoveryLock = await this.#claimLock(this.recoveryPath);
      if (!recoveryLock) return false;
    }
    try {
      const observed = await this.#readRefreshLock();
      if (!this.#isStaleLock(observed)) return false;
      const current = await this.#readRefreshLock();
      if (!this.#sameLockFile(observed, current) || !this.#isStaleLock(current)) return false;
      const stalePath = `${this.lockPath}.${randomUUID()}.stale`;
      try {
        await rename(this.lockPath, stalePath);
        await rm(stalePath, { force: true });
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
    } finally {
      await this.#releaseLock(this.recoveryPath, recoveryLock.token);
    }
  }

  async #acquireRefreshLock() {
    await this.#prepareDirectory();
    const recovery = await this.#readLock(this.recoveryPath);
    if (recovery?.active || recovery?.blocked) return null;
    if (recovery && this.#isStaleLock(recovery)) {
      await this.#removeStaleLock(this.recoveryPath, recovery);
    }
    try {
      const lock = await this.#claimLock(this.lockPath);
      if (lock) return lock;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await this.#recoverStaleRefreshLock();
    return this.#claimLock(this.lockPath);
  }

  async #releaseLock(filePath, token) {
    const lock = await this.#readLock(filePath);
    if (lock?.token === token) await rm(filePath, { force: true });
  }

  async #releaseRefreshLock(token) {
    await this.#releaseLock(this.lockPath, token);
  }

  #priorityMarkerPath(key) {
    return path.join(path.dirname(this.filePath), `${path.basename(this.filePath)}${PRIORITY_MARKER_PREFIX}${sha256(key).slice(0, 20)}`);
  }

  async #writePriorityMarkers(keys) {
    if (!keys.length) return;
    await this.#prepareDirectory();
    for (const key of keys) {
      const markerPath = this.#priorityMarkerPath(key);
      const temporary = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ key, requested_at: new Date(this.now()).toISOString() }), "utf8");
        await handle.sync();
        await handle.close();
        handle = null;
        try {
          await link(temporary, markerPath);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      } finally {
        await handle?.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
  }

  async #consumePriorityMarkers() {
    const priorities = new Set();
    let names;
    try {
      names = await readdir(path.dirname(this.filePath));
    } catch {
      return priorities;
    }
    const prefix = `${path.basename(this.filePath)}${PRIORITY_MARKER_PREFIX}`;
    for (const name of names.filter((item) => item.startsWith(prefix))) {
      const markerPath = path.join(path.dirname(this.filePath), name);
      try {
        const marker = JSON.parse(await readFile(markerPath, "utf8"));
        if (typeof marker?.key === "string" && /^(prompt|core):[^\s]+$/.test(marker.key)) priorities.add(marker.key);
      } catch {
        // Ignore malformed marker files; they do not contain cache data.
      } finally {
        await rm(markerPath, { force: true }).catch(() => {});
      }
    }
    return priorities;
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

  #lastRefreshFailed() {
    return this.job?.state === "failed" || this.job?.state === "partial";
  }

  async status() {
      await this.#syncDisk();
      const descriptors = await this.#descriptors();
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
      const recovering = !this.inFlight && Boolean(this.refreshLockStatus?.initializing);
      const running = Boolean(this.inFlight) || Boolean(this.refreshLockStatus?.active && !this.refreshLockStatus?.initializing);
      const cooling = !running && !this.#lastRefreshFailed() && nextAllowedAt !== null && nextAllowedAt > now;
      return {
        resources,
        summary: { total: resources.length, available: success, unavailable: missing },
        refresh: {
          state: recovering ? "recovering" : running ? "running" : cooling ? "cooldown" : this.job?.state || "idle",
          started_at: this.job?.startedAt ? new Date(this.job.startedAt).toISOString() : null,
          finished_at: this.job?.finishedAt ? new Date(this.job.finishedAt).toISOString() : null,
          completed: this.job?.completed || 0,
          total: this.job?.total || resources.length,
          succeeded: this.job?.succeeded || 0,
          failed: this.job?.failed || 0,
          current: this.job?.current || "",
          next_allowed_at: cooling ? new Date(nextAllowedAt).toISOString() : null,
          retry_at: recovering && this.refreshLockStatus?.info?.mtimeMs
            ? new Date(this.refreshLockStatus.info.mtimeMs + LOCK_INITIALIZATION_GRACE_MS).toISOString()
            : null,
          storage_error: this.storageError,
          file_corrupt: this.fileCorrupt,
          file_error: this.fileError,
          error: this.job?.error || ""
        }
      };
  }

  async requestRefresh({ priority = [] } = {}) {
    for (const key of priority) this.cooldownPriorities.add(key);
    await this.#syncDisk();
    if (this.inFlight) {
      for (const key of priority) this.inFlight.priorities.add(key);
      this.cooldownPriorities.clear();
      return { state: "running", merged: true };
    }
    const activeLock = await this.#readRefreshLock();
    if (activeLock?.active) {
      if (activeLock.initializing) {
        const age = this.now() - (activeLock.info?.mtimeMs || this.now());
        const retryAt = this.now() + Math.max(1, LOCK_INITIALIZATION_GRACE_MS - age);
        this.#scheduleCooldown(retryAt - this.now());
        await this.#writePriorityMarkers(priority);
        this.refreshLockStatus = activeLock;
        return { state: "recovering", merged: true, retry_at: new Date(retryAt).toISOString() };
      }
      await this.#writePriorityMarkers(priority);
      this.refreshLockStatus = activeLock;
      return { state: "running", merged: true };
    }
    const now = this.now();
    const nextAllowedAt = this.lastRefreshStartedAt === null || this.#lastRefreshFailed()
      ? now
      : this.lastRefreshStartedAt + CHATPACK_CACHE_REFRESH_INTERVAL_MS;
    if (nextAllowedAt > now) {
      this.#scheduleCooldown(nextAllowedAt - now);
      this.job = { ...(this.job || {}), state: "cooldown" };
      return { state: "cooldown", merged: Boolean(this.cooldownTimer), next_allowed_at: new Date(nextAllowedAt).toISOString() };
    }
    let lock;
    for (let attempt = 0; attempt < 3 && !lock; attempt += 1) {
      try {
        lock = await this.#acquireRefreshLock();
      } catch (error) {
        this.storageError = error.message || "缓存目录不可用，无法建立跨进程刷新锁";
        lock = { token: "" };
        break;
      }
      if (lock) break;
      const owner = await this.#readRefreshLock();
      if (owner?.active) {
        await this.#writePriorityMarkers(priority);
        this.refreshLockStatus = owner;
        await this.#syncDisk();
        return { state: "running", merged: true };
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!lock) {
      const error = "未发现正在运行的缓存刷新；刷新锁无法安全恢复，请重试";
      this.refreshLockStatus = null;
      this.job = {
        state: "failed", startedAt: now, finishedAt: this.now(), completed: 0, succeeded: 0, failed: 0,
        current: "", total: this.job?.total || 0, error, priorities: new Set(priority), items: {}
      };
      await this.#persist();
      return { state: "failed", merged: false, error };
    }
    const priorities = new Set([...this.cooldownPriorities, ...priority, ...await this.#consumePriorityMarkers()]);
    this.cooldownPriorities.clear();
    const run = this.#runRefresh(priorities, lock.token);
    const task = run.finally(async () => {
      if (lock.token) await this.#releaseRefreshLock(lock.token).catch(() => {});
      if (this.inFlight === task) this.inFlight = null;
      const remaining = await this.#consumePriorityMarkers();
      for (const key of remaining) this.cooldownPriorities.add(key);
      if (this.cooldownPriorities.size && this.cooldownTimer === null && !this.#lastRefreshFailed()) {
        this.#scheduleCooldown(Math.max(0, (this.lastRefreshStartedAt || 0) + CHATPACK_CACHE_REFRESH_INTERVAL_MS - this.now()));
      }
      this.#scheduleDaily();
    }).catch(() => {});
    task.priorities = priorities;
    this.inFlight = task;
    return { state: "running", merged: false };
  }

  #scheduleCooldown(delay) {
    if (this.cooldownTimer !== null) return;
    this.cooldownTimer = this.setTimeoutFn(() => {
      this.cooldownTimer = null;
      const priorities = [...this.cooldownPriorities];
      this.cooldownPriorities.clear();
      void this.requestRefresh({ priority: priorities }).catch((error) => { this.fileError = error.message || "缓存刷新请求失败"; });
    }, Math.max(0, delay));
    this.cooldownTimer?.unref?.();
  }

  #scheduleDaily() {
    if (this.dailyTimer !== null) clearTimeout(this.dailyTimer);
    const nextAt = (this.lastRefreshStartedAt ?? this.now()) + CHATPACK_CACHE_DAILY_MS;
    this.dailyTimer = this.setTimeoutFn(() => {
      this.dailyTimer = null;
      void this.requestRefresh().catch((error) => { this.fileError = error.message || "缓存每日刷新失败"; });
    }, Math.max(0, nextAt - this.now()));
    this.dailyTimer?.unref?.();
  }

  async #runRefresh(priorities, lockToken) {
    const startedAt = this.now();
    this.lastRefreshStartedAt = startedAt;
    this.job = { state: "running", startedAt, finishedAt: null, completed: 0, succeeded: 0, failed: 0, current: "", total: 0, error: "", priorities, items: {} };
    await this.#persist({ lockToken });
    let descriptors;
    try {
      descriptors = await this.#descriptors();
    } catch (error) {
      this.job = { ...this.job, state: "failed", finishedAt: this.now(), error: error.message || "资源清单读取失败" };
      await this.#persist({ lockToken });
      return;
    }
    const queue = descriptors.slice();
    this.job.total = queue.length;
    for (const descriptor of descriptors) this.job.items[descriptor.key] = { state: "queued", error: "" };
    await this.#persist({ lockToken });
    const worker = async () => {
      while (true) {
        const externalPriorities = await this.#consumePriorityMarkers();
        for (const key of externalPriorities) priorities.add(key);
        if (!queue.length) return;
        queue.sort((left, right) => Number(priorities.has(right.key)) - Number(priorities.has(left.key)));
        const descriptor = queue.shift();
        this.job.current = descriptor.key;
        this.job.items[descriptor.key] = { state: "running", error: "" };
        await this.#persist({ lockToken });
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
        } catch (error) {
          const message = error.message || "资源读取失败";
          this.fetchErrors.set(descriptor.key, message);
          this.job.items[descriptor.key] = { state: "failed", error: message };
          this.job.failed += 1;
        } finally {
          this.job.completed += 1;
          await this.#persist({ repairCorrupt: this.job.succeeded > 0, lockToken });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const latePriorities = await this.#consumePriorityMarkers();
    for (const key of latePriorities) this.cooldownPriorities.add(key);
    this.job = { ...this.job, state: this.job.failed ? this.job.succeeded ? "partial" : "failed" : "succeeded", finishedAt: this.now(), current: "" };
    await this.#persist({ repairCorrupt: this.job.succeeded > 0, lockToken });
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
    await this.#syncDisk();
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

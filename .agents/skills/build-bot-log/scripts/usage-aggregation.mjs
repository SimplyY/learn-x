const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET = "+08:00";

export function normalizeWeek(value) {
  const match = String(value ?? "").match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week: ${value}. Use YYYY-Www`);
  const week = Number(match[2]);
  if (week < 1 || week > 53) throw new Error(`Invalid ISO week: ${value}`);
  return `${match[1]}-W${String(week).padStart(2, "0")}`;
}

function dateFromParts(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function mondayOfWeek(date) {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

export function isoWeekForDate(dateString) {
  const date = dateFromParts(...dateString.split("-").map(Number));
  const thursday = addDays(date, 4 - (date.getUTCDay() || 7));
  const yearStart = dateFromParts(thursday.getUTCFullYear(), 1, 1);
  const week = Math.ceil(((thursday - yearStart) / DAY_MS + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function rangeForWeek(week) {
  const normalized = normalizeWeek(week);
  const [yearText, weekText] = normalized.split("-W");
  const year = Number(yearText);
  const weekNumber = Number(weekText);
  const jan4 = dateFromParts(year, 1, 4);
  const start = addDays(mondayOfWeek(jan4), (weekNumber - 1) * 7);
  const end = addDays(start, 7);
  return {
    week: normalized,
    startDate: isoDate(start),
    endDate: isoDate(addDays(end, -1)),
    startEpoch: Date.parse(`${isoDate(start)}T00:00:00${SHANGHAI_OFFSET}`) / 1000,
    endEpoch: Date.parse(`${isoDate(end)}T00:00:00${SHANGHAI_OFFSET}`) / 1000,
  };
}

export function resolveTargetWeek(now = new Date()) {
  const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const currentMonday = mondayOfWeek(dateFromParts(...shanghaiDate.split("-").map(Number)));
  return isoWeekForDate(isoDate(addDays(currentMonday, -7)));
}

export function timestampEpoch(entry) {
  const value = entry?.ts ?? entry?.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value / 1000 : value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1_000_000_000_000 ? numeric / 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return null;
}

function field(entry, name) {
  return entry?.[name] ?? entry?.[`_${name}`];
}

function scopeOf(entry) {
  return field(entry, "scope") ?? entry?.chatId ?? "";
}

function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { samples: 0, p50: null, p95: null };
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95) };
}

function countBy(values) {
  const result = {};
  for (const value of values) {
    const key = String(value || "unknown");
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function unique(values) {
  return new Set(values.filter(Boolean)).size;
}

function isInRange(epoch, range) {
  return epoch !== null && epoch >= range.startEpoch && epoch < range.endEpoch;
}

function newRun(runId, entry) {
  return {
    runId,
    scope: scopeOf(entry),
    source: entry.source ?? "unknown",
    startedAt: timestampEpoch(entry),
    terminalAt: null,
    terminal: null,
    result: null,
    resumed: entry.resumed === true,
    modelRequested: entry.model ?? "default",
    modelActual: null,
    queueWaitMs: entry.queueWaitMs,
    firstEventMs: null,
    firstVisibleMs: null,
    durationMs: null,
    delivered: false,
    deliveryCount: 0,
    fallbackCount: 0,
    outboundError: false,
    followUpWithin24h: false,
  };
}

function runFor(runs, entry) {
  const runId = field(entry, "runId");
  if (!runId) return null;
  const run = runs.get(runId) ?? newRun(runId, entry);
  runs.set(runId, run);
  return run;
}

function enrichRun(run, entry, epoch) {
  if (!run) return;
  if (entry.event === "started") {
    run.scope = scopeOf(entry) || run.scope;
    run.source = entry.source ?? run.source;
    run.startedAt = epoch;
    run.resumed = entry.resumed === true;
    run.modelRequested = entry.model ?? run.modelRequested;
    run.queueWaitMs = entry.queueWaitMs ?? run.queueWaitMs;
  }
  if (entry.event === "first-event") run.firstEventMs = entry.firstEventMs;
  if (entry.event === "first-visible") run.firstVisibleMs = entry.firstVisibleMs;
  if (entry.event === "completed" || entry.event === "failed") {
    run.terminal = entry.event === "completed" ? "completed" : "failed";
    run.result = entry.result ?? (entry.event === "failed" ? "failed" : "done");
    run.durationMs = entry.durationMs;
    run.terminalAt = epoch;
  }
  if (entry.event === "model") run.modelActual = entry.actual ?? null;
  if (entry.event === "sent") {
    run.delivered = true;
    run.deliveryCount += 1;
  }
  if (entry.event === "markdown-stream-fallback") run.fallbackCount += 1;
  if (entry.level === "error" && entry.phase === "outbound") run.outboundError = true;
}

export function aggregateUsage(entries, range) {
  const seen = new Set();
  const events = entries
    .map((entry) => ({ entry, epoch: timestampEpoch(entry) }))
    .filter(({ epoch }) => isInRange(epoch, range))
    .filter(({ entry }) => {
      const key = JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.epoch - b.epoch);

  const runs = new Map();
  const inbound = [];
  const outbound = [];
  const users = [];
  const chats = [];
  const scopes = [];
  const activeDays = new Set();
  const userDays = new Set();
  const modelObservations = [];
  let degradedModelCorrelation = 0;
  let rejected = 0;
  let noMention = 0;
  let notAllowed = 0;
  let commands = 0;
  let queued = 0;
  let streamFallbacks = 0;
  let outboundErrors = 0;
  let emptyReplies = 0;

  for (const { entry, epoch } of events) {
    activeDays.add(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(epoch * 1000)));
    const currentScope = scopeOf(entry);
    if (currentScope) scopes.push(currentScope);
    if (entry.chatId) chats.push(entry.chatId);

    if (entry.phase === "intake" && entry.event === "enter") {
      inbound.push({ epoch, scope: currentScope });
      users.push(entry.sender);
      userDays.add(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(epoch * 1000)));
      continue;
    }
    if (entry.phase === "intake" && entry.event === "reject") rejected += 1;
    if (entry.phase === "intake" && entry.event === "skip-no-mention") noMention += 1;
    if (entry.phase === "intake" && entry.event === "skip-not-allowed-user") notAllowed += 1;
    if (entry.phase === "intake" && entry.event === "command") commands += 1;
    if (entry.phase === "intake" && entry.event === "queued") queued += 1;

    if (entry.phase === "run" && field(entry, "runId")) {
      const run = runFor(runs, entry);
      enrichRun(run, entry, epoch);
    } else if (entry.phase === "session" && entry.event === "model") {
      modelObservations.push(entry.actual ?? "unknown");
      const run = runFor(runs, entry);
      if (!run) degradedModelCorrelation += 1;
      enrichRun(run, entry, epoch);
    }

    if (entry.phase === "outbound" && entry.event === "sent") {
      outbound.push({
        epoch,
        scope: currentScope,
        runId: field(entry, "runId"),
        type: entry.type,
        chars: entry.chars,
      });
      const run = runFor(runs, entry);
      enrichRun(run, entry, epoch);
      if (entry.chars === 0) emptyReplies += 1;
    }
    if (entry.phase === "outbound" && entry.event === "markdown-stream-fallback") streamFallbacks += 1;
    if (entry.level === "error" && entry.phase === "outbound") outboundErrors += 1;
  }

  const runList = [...runs.values()];
  const startedRuns = runList.filter((run) => run.startedAt !== null);
  const interrupted = runList.filter((run) => run.result === "interrupted" || run.result === "timeout");
  const completed = runList.filter((run) => run.terminal === "completed" && !interrupted.includes(run));
  const failed = runList.filter((run) => run.terminal === "failed" && !interrupted.includes(run));
  const withTerminal = runList.filter((run) => run.terminal);
  const withDelivery = runList.filter((run) => run.delivered);
  const missingTerminal = runList.filter((run) => !run.terminal).length;
  const missingDelivery = withTerminal.filter((run) => !run.delivered).length;

  let followUpMessages = 0;
  for (const message of inbound) {
    const reply = outbound
      .filter((candidate) =>
        candidate.scope === message.scope &&
        candidate.epoch < message.epoch &&
        candidate.epoch >= message.epoch - 24 * 60 * 60,
      )
      .at(-1);
    if (!reply) continue;
    followUpMessages += 1;
    const run = reply.runId ? runs.get(reply.runId) : null;
    if (run) run.followUpWithin24h = true;
  }

  const missingDays = [];
  const start = dateFromParts(...range.startDate.split("-").map(Number));
  for (let offset = 0; offset < 7; offset += 1) {
    const day = isoDate(addDays(start, offset));
    if (!activeDays.has(day)) missingDays.push(day);
  }

  return {
    schemaVersion: 1,
    coverage: {
      week: range.week,
      start: range.startDate,
      end: range.endDate,
      activeDays: activeDays.size,
      missingDays,
      status: events.length === 0 ? "unavailable" : missingDays.length >= 4 ? "insufficient" : missingDays.length ? "partial" : "complete",
      eventCount: events.length,
    },
    demand: {
      inbound: inbound.length,
      activeUsers: unique(users),
      activeChats: unique(chats),
      activeScopes: unique(scopes),
      activeDays: userDays.size,
      rejected,
      noMention,
      notAllowed,
      commands,
      queued,
    },
    service: {
      started: runList.filter((run) => run.startedAt !== null).length,
      completed: completed.length,
      failed: failed.length,
      interrupted: interrupted.length,
      resumed: runList.filter((run) => run.resumed).length,
      completionRate: withTerminal.length ? completed.length / withTerminal.length : null,
      failureRate: withTerminal.length ? failed.length / withTerminal.length : null,
      queueWaitMs: percentiles(runList.map((run) => run.queueWaitMs)),
      firstEventMs: percentiles(runList.map((run) => run.firstEventMs)),
      firstVisibleMs: percentiles(runList.map((run) => run.firstVisibleMs)),
      durationMs: percentiles(runList.map((run) => run.durationMs)),
      e2eMs: percentiles(runList.map((run) => run.durationMs)),
      requestedModels: countBy(startedRuns.map((run) => run.modelRequested)),
      actualModels: countBy(modelObservations),
      degradedModelCorrelation,
      sources: countBy(startedRuns.map((run) => run.source)),
      missingTerminal,
    },
    delivery: {
      sent: outbound.length,
      deliveredRuns: startedRuns.filter((run) => run.delivered).length,
      card: outbound.filter((entry) => entry.type === "card").length,
      markdown: outbound.filter((entry) => String(entry.type).startsWith("markdown")).length,
      text: outbound.filter((entry) => entry.type === "text").length,
      types: countBy(outbound.map((entry) => entry.type)),
      streamFallbacks,
      errors: outboundErrors,
      emptyReplies,
      missingDelivery,
      correlatedRuns: startedRuns.filter((run) => run.delivered).length,
      runToFinalReply: startedRuns.filter((run) => run.delivered).length,
      degradedCorrelation: outbound.filter((entry) => !entry.runId).length,
    },
    behaviorProxy: {
      followUpMessages,
      followUpWithin24hRuns: startedRuns.filter((run) => run.followUpWithin24h).length,
      interpretation: "后续消息是使用行为代理，不是满意度或任务成功率。",
    },
    warnings: [
      ...(missingDays.length ? [`日志缺少日期：${missingDays.join("、")}`] : []),
      ...(missingTerminal ? [`${missingTerminal} 个运行缺少终止事件`] : []),
      ...(missingDelivery ? [`${missingDelivery} 个已结束运行没有最终投递`] : []),
      ...(degradedModelCorrelation ? [`${degradedModelCorrelation} 个模型事件缺少 runId，模型关联为降级`] : []),
      ...(outbound.filter((entry) => !entry.runId).length ? ["部分旧日志缺少 runId，闭环关联为降级"] : []),
    ],
  };
}

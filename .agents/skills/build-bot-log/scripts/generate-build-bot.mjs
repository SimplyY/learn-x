import { readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  aggregateUsage,
  rangeForWeek,
  normalizeWeek,
  resolveTargetWeek,
  timestampEpoch,
} from "./usage-aggregation.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillRoot, "../../../..");
const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
const DEFAULT_CHAT_ID = "oc_846411e4168e681d7f7b491c837163fd";

// ── helpers ──────────────────────────────────────────────────────────

function shanghaiNow() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const v = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

async function tryExec(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 15000, ...opts });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    return { ok: false, stdout: "", stderr: e.message };
  }
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--week") opts.week = argv[++i];
    else if (argv[i] === "--chat-id") opts.chatId = argv[++i];
    else if (argv[i] === "--base-token") opts.baseToken = argv[++i];
    else if (argv[i] === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

// ── source collectors ────────────────────────────────────────────────

async function collectBridgeLogs(range) {
  const larkHome = process.env.LARK_CHANNEL_HOME;
  const profile = process.env.LARK_CHANNEL_PROFILE;
  if (!larkHome || !profile) return { available: false, reason: "LARK_CHANNEL_HOME/PROFILE not set", entries: [] };

  const logsDir = path.join(larkHome, "profiles", profile, "logs");
  try { await access(logsDir); } catch { return { available: false, reason: "logs directory not found", entries: [] }; }

  let files;
  try { files = await readdir(logsDir); } catch { return { available: false, reason: "cannot list bridge logs", entries: [] }; }
  const wanted = new Set();
  const calendarStart = new Date(`${range.startDate}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(calendarStart.getTime() + offset * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    wanted.add(`bridge-${day}.jsonl`);
  }
  files = files.filter((file) => wanted.has(file));
  if (!files.length) return { available: false, reason: "no bridge log files for coverage week", entries: [] };

  const entries = [];
  for (const f of files) {
    try {
      const content = await readFile(path.join(logsDir, f), "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const ev = JSON.parse(line);
          const tsEpoch = timestampEpoch(ev);
          if (tsEpoch !== null && tsEpoch >= range.startEpoch && tsEpoch < range.endEpoch) {
            entries.push(ev);
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable files */ }
  }

  entries.sort((a, b) => timestampEpoch(a) - timestampEpoch(b));
  const available = entries.length > 0;
  return {
    available,
    reason: available ? `${entries.length} bridge events found` : "no bridge events in coverage week",
    entries,
  };
}

async function collectCodexMemories(range) {
  const codexHome = process.env.CODEX_HOME || DEFAULT_CODEX_HOME;

  const memoriesDir = path.join(codexHome, "memories");
  const rawPath = path.join(memoriesDir, "raw_memories.md");
  const summaryPath = path.join(memoriesDir, "memory_summary.md");
  const adHocDir = path.join(memoriesDir, "extensions", "ad_hoc", "notes");

  let rawMemories = null, memorySummary = null, adHocNotes = [];

  try { rawMemories = (await readFile(rawPath, "utf-8")).slice(0, 10000); } catch { /* not found */ }
  try { memorySummary = (await readFile(summaryPath, "utf-8")).slice(0, 5000); } catch { /* not found */ }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execFile);
    const { stdout } = await execAsync("ls", ["-1t", adHocDir]);
    const recentNotes = stdout.trim().split("\n").filter(Boolean).slice(0, 10);
    for (const n of recentNotes) {
      try { adHocNotes.push({ file: n, content: (await readFile(path.join(adHocDir, n), "utf-8")).slice(0, 2000) }); } catch { /* skip */ }
    }
  } catch { /* no ad-hoc notes */ }

  const available = rawMemories !== null || memorySummary !== null;
  return { available, reason: available ? "memories available" : "no memory files found", rawMemories, memorySummary, adHocNotes };
}

async function collectFeishuMessages(range, chatId) {
  if (!chatId) return { available: false, reason: "no --chat-id provided" };

  // Try search first (needs @mentions)
  const searchResult = await tryExec("lark-cli", [
    "im", "+messages-search", "--chat-id", chatId,
    "--start", String(range.startEpoch), "--end", String(range.endEpoch),
    "--page-all", "--as", "user",
  ]);
  if (searchResult.ok && searchResult.stdout.length > 50) {
    return { available: true, method: "search", messages: searchResult.stdout.slice(0, 30000) };
  }

  // Fallback to chat-messages-list
  const listResult = await tryExec("lark-cli", [
    "im", "+chat-messages-list", "--chat-id", chatId,
    "--start", String(range.startEpoch), "--end", String(range.endEpoch),
    "--page-size", "50", "--order", "asc", "--as", "user",
  ]);
  if (listResult.ok && listResult.stdout.length > 50) {
    return { available: true, method: "list", messages: listResult.stdout.slice(0, 30000) };
  }

  return { available: false, reason: "both search and list returned empty", messages: null };
}

async function collectGitChanges(range) {
  const since = `${range.startDate}T00:00:00+08:00`;
  const nextDate = new Date(new Date(`${range.endDate}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString().split("T")[0];
  const untilDate = `${nextDate}T00:00:00+08:00`;

  const log = await tryExec("git", ["log", `--since=${since}`, `--until=${untilDate}`, "--oneline"], { cwd: repoRoot });
  const skillsDiff = await tryExec("git", ["diff", "--stat", `--since=${since}`, `--until=${untilDate}`, "--", ".agents/skills/"], { cwd: repoRoot });
  const status = await tryExec("git", ["status", "--short"], { cwd: repoRoot });

  const available = (log.ok && log.stdout.length > 0);
  return {
    available,
    reason: available ? `${log.stdout.split("\n").length} commits` : "no commits in window",
    log: log.stdout.slice(0, 5000),
    skillsDiff: skillsDiff.stdout.slice(0, 3000),
    status: status.stdout.slice(0, 2000),
  };
}

async function collectBaseWorkflows(baseToken) {
  if (!baseToken) return { available: false, reason: "no --base-token provided" };

  const result = await tryExec("lark-cli", ["base", "+workflow-list", "--as", "user", "--base-token", baseToken]);
  if (result.ok && result.stdout.length > 20) {
    return { available: true, workflows: result.stdout.slice(0, 5000) };
  }
  return { available: false, reason: "workflow list returned empty" };
}

// ── main ─────────────────────────────────────────────────────────────

export async function generateBuildBot(options = {}) {
  const week = normalizeWeek(options.week || resolveTargetWeek());
  const range = rangeForWeek(week);
  const chatId = options.chatId || process.env.LARK_CHANNEL_CHAT_ID || DEFAULT_CHAT_ID;
  const baseToken = options.baseToken || process.env.BUILD_BOT_BASE_TOKEN || "";
  const dryRun = options.dryRun || false;

  const ctx = {
    generatedAt: shanghaiNow(),
    week,
    coverageStart: range.startDate,
    coverageEnd: range.endDate,
    sources: {},
    gatePassed: false,
    abortReason: null,
    evidence: {},
  };

  // Collect all sources (don't gate yet — collect all for appendix)
  const [bridgeLogs, memories, feishuMsgs, gitChanges, baseWorkflows] = await Promise.all([
    collectBridgeLogs(range),
    collectCodexMemories(range),
    collectFeishuMessages(range, chatId),
    collectGitChanges(range),
    collectBaseWorkflows(baseToken),
  ]);

  ctx.sources.bridgeLogs = { available: bridgeLogs.available, reason: bridgeLogs.reason };
  ctx.sources.codexMemories = { available: memories.available, reason: memories.reason };
  ctx.sources.feishuMessages = { available: feishuMsgs.available, reason: feishuMsgs.reason };
  ctx.sources.gitChanges = { available: gitChanges.available, reason: gitChanges.reason };
  ctx.sources.baseWorkflows = { available: baseWorkflows.available, reason: baseWorkflows.reason };

  ctx.evidence.bridgeLogs = bridgeLogs.entries || [];
  ctx.evidence.codexMemories = {
    rawMemories: memories.rawMemories,
    memorySummary: memories.memorySummary,
    adHocNotes: memories.adHocNotes,
  };
  ctx.evidence.feishuMessages = feishuMsgs.messages;
  ctx.evidence.gitChanges = {
    log: gitChanges.log,
    skillsDiff: gitChanges.skillsDiff,
    status: gitChanges.status,
  };
  ctx.evidence.baseWorkflows = baseWorkflows.workflows;
  ctx.evidence.usageSummary = aggregateUsage(ctx.evidence.bridgeLogs, range);
  ctx.evidence.usageCoverage = ctx.evidence.usageSummary.coverage;
  ctx.evidence.usageWarnings = ctx.evidence.usageSummary.warnings;

  // Pre-flight gate: first 3 sources must have at least one available
  const first3 = [bridgeLogs.available, memories.available, feishuMsgs.available];
  ctx.gatePassed = first3.some(Boolean);

  if (!ctx.gatePassed) {
    ctx.abortReason = `All 3 primary sources empty: bridgeLogs(${bridgeLogs.reason}), codexMemories(${memories.reason}), feishuMessages(${feishuMsgs.reason})`;
  }

  if (!dryRun && ctx.gatePassed) {
    const memoryPath = path.join(skillRoot, "scripts", "build-bot-memory.json");
    const memory = {
      version: "1.0.0",
      lastRun: shanghaiNow(),
      lastCoverage: `${range.startDate}..${range.endDate}`,
      lastWeek: week,
      checkedSources: ctx.sources,
      usage: ctx.evidence.usageSummary,
    };
    await writeFile(memoryPath, JSON.stringify(memory, null, 2) + "\n");
  }

  // Output result
  return ctx;
}

function compactContext(ctx, memoryUpdated = false) {
  return {
    generatedAt: ctx.generatedAt,
    week: ctx.week,
    coverageStart: ctx.coverageStart,
    coverageEnd: ctx.coverageEnd,
    sources: ctx.sources,
    gatePassed: ctx.gatePassed,
    evidence: {
      bridgeLogEntryCount: ctx.evidence.bridgeLogs.length,
      usageSummary: ctx.evidence.usageSummary,
      usageCoverage: ctx.evidence.usageCoverage,
      usageWarnings: ctx.evidence.usageWarnings,
      codexMemoriesAvailable: !!ctx.evidence.codexMemories.rawMemories || !!ctx.evidence.codexMemories.memorySummary,
      feishuMessagesAvailable: !!ctx.evidence.feishuMessages,
      gitAvailable: ctx.sources.gitChanges.available,
      workflowsAvailable: !!ctx.evidence.baseWorkflows,
    },
    abortReason: ctx.abortReason,
    memoryUpdated,
  };
}

// ── CLI entry ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = await generateBuildBot(opts);

  if (opts.dryRun || !ctx.gatePassed) {
    console.log(JSON.stringify(compactContext(ctx, !opts.dryRun && ctx.gatePassed), null, 2));
    if (!ctx.gatePassed) {
      console.error("\n--- GATE BLOCKED ---");
      console.error(ctx.abortReason);
      console.error("Run with --dry-run to inspect sources without side effects.");
      process.exit(1);
    }
    process.exit(0);
  }

  console.log(JSON.stringify(compactContext(ctx, true), null, 2));
}

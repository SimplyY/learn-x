import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillRoot, "../../../..");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const COVERAGE_DAYS = 7;
const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
const DEFAULT_CHAT_ID = "oc_846411e4168e681d7f7b491c837163fd";

// ── helpers ──────────────────────────────────────────────────────────

function currentShanghaiIsoWeek(date = new Date()) {
  const shanghai = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const localAsUtc = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()));
  const day = localAsUtc.getUTCDay() || 7;
  localAsUtc.setUTCDate(localAsUtc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(localAsUtc.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((localAsUtc - yearStart) / 86400000 + 1) / 7);
  return `${localAsUtc.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function normalizeWeek(week) {
  const m = String(week).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!m) throw new Error(`Invalid week: ${week}. Use YYYY-Www`);
  return `${m[1]}-W${String(Number(m[2])).padStart(2, "0")}`;
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date);
}

function shanghaiIsoToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

/** Returns { startDate, endDate } ISO strings (Asia/Shanghai, inclusive range). */
function coverageRange(runDate = new Date()) {
  const end = new Date(runDate.getTime() + SHANGHAI_OFFSET_MS);
  const start = new Date(end.getTime() - (COVERAGE_DAYS - 1) * 86400000);
  return {
    startDate: shanghaiDate(start),
    endDate: shanghaiDate(end),
    startEpoch: Math.floor(start.getTime() / 1000),
    endEpoch: Math.floor((end.getTime() + 86400000) / 1000),
  };
}

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
  try { await access(logsDir); } catch { return { available: false, reason: `logs dir not found: ${logsDir}`, entries: [] }; }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(execFile);
  let files;
  try {
    const { stdout } = await execAsync("ls", ["-1t", logsDir]);
    files = stdout.trim().split("\n").filter(f => f.startsWith("bridge-") && f.endsWith(".jsonl")).slice(0, 14);
  } catch {
    return { available: false, reason: "cannot list bridge logs", entries: [] };
  }
  if (!files.length) return { available: false, reason: "no bridge log files", entries: [] };

  const entries = [];
  for (const f of files) {
    try {
      const content = await readFile(path.join(logsDir, f), "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const ev = JSON.parse(line);
          // bridge logs use "ts" (ISO 8601) or "timestamp" (epoch)
const tsStr = ev.ts || ev.timestamp;
let tsEpoch = null;
if (typeof tsStr === 'number') {
  tsEpoch = tsStr;
} else if (typeof tsStr === 'string') {
  const m = tsStr.match(/^(.+?)([+-]\d{2}:\d{2})$/);
  if (m) {
    try {
      const dt = new Date(m[1] + (m[2] || '+08:00'));
      tsEpoch = Math.floor(dt.getTime() / 1000);
    } catch {}
  }
}
if (ev.phase === "intake" && tsEpoch !== null && tsEpoch >= range.startEpoch) {
            entries.push({
              time: ev.timestamp,
              sender: ev.sender || ev.event?.sender?.sender_id?.open_id || "unknown",
              preview: ev.preview || ev.event?.message?.content || "",
              chatId: ev.event?.message?.chat_id || ev.chatId || "",
            });
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable files */ }
  }

  entries.sort((a, b) => a.time - b.time);
  const available = entries.length > 0;
  return { available, reason: available ? `${entries.length} intake entries found` : "no intake entries in window", entries: entries.slice(-200) };
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
  return { available, reason: available ? `memories available (${codexHome})` : `no memory files found (${codexHome})`, rawMemories, memorySummary, adHocNotes };
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
  const since = new Date(range.startEpoch * 1000).toISOString().split("T")[0];
  const until = new Date(range.endEpoch * 1000).toISOString().split("T")[0];

  const log = await tryExec("git", ["log", `--since=${since}`, `--until=${until}`, "--oneline"], { cwd: repoRoot });
  const skillsDiff = await tryExec("git", ["diff", "--stat", `--since=${since}`, `--until=${until}`, "--", ".agents/skills/"], { cwd: repoRoot });
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
  const week = normalizeWeek(options.week || currentShanghaiIsoWeek());
  const runDate = new Date();
  const range = coverageRange(runDate);
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

  // Pre-flight gate: first 3 sources must have at least one available
  const first3 = [bridgeLogs.available, memories.available, feishuMsgs.available];
  ctx.gatePassed = first3.some(Boolean);

  if (!ctx.gatePassed) {
    ctx.abortReason = `All 3 primary sources empty: bridgeLogs(${bridgeLogs.reason}), codexMemories(${memories.reason}), feishuMessages(${feishuMsgs.reason})`;
  }

  // Memory update
  const memoryPath = path.join(skillRoot, "scripts", "build-bot-memory.json");
  const memory = { version: "1.0.0", lastRun: shanghaiNow(), lastCoverage: `${range.startDate}..${range.endDate}`, lastWeek: week, checkedSources: ctx.sources };
  await writeFile(memoryPath, JSON.stringify(memory, null, 2) + "\n");

  // Output result
  return ctx;
}

// ── CLI entry ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = await generateBuildBot(opts);

  if (opts.dryRun || !ctx.gatePassed) {
    console.log(JSON.stringify(ctx, null, 2));
    if (!ctx.gatePassed) {
      console.error("\n--- GATE BLOCKED ---");
      console.error(ctx.abortReason);
      console.error("Run with --dry-run to inspect sources without side effects.");
      process.exit(1);
    }
    process.exit(0);
  }

  // Produce context JSON to stdout for the agent to consume
  // Strip out large raw text to save tokens
  const compact = {
    generatedAt: ctx.generatedAt,
    week: ctx.week,
    coverageStart: ctx.coverageStart,
    coverageEnd: ctx.coverageEnd,
    sources: ctx.sources,
    gatePassed: ctx.gatePassed,
    evidence: {
      bridgeLogEntryCount: ctx.evidence.bridgeLogs.length,
      codexMemoriesAvailable: !!ctx.evidence.codexMemories.rawMemories || !!ctx.evidence.codexMemories.memorySummary,
      feishuMessagesAvailable: !!ctx.evidence.feishuMessages,
      feishuMessagesPreview: ctx.evidence.feishuMessages ? ctx.evidence.feishuMessages.slice(0, 5000) : null,
      gitLog: ctx.evidence.gitChanges.log,
      gitSkillsDiff: ctx.evidence.gitChanges.skillsDiff,
      gitStatus: ctx.evidence.gitChanges.status,
      workflowsAvailable: !!ctx.evidence.baseWorkflows,
    },
    abortReason: ctx.abortReason,
    memoryUpdated: true,
  };
  console.log(JSON.stringify(compact, null, 2));
}

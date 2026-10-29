// 七个内部命令 + run 编排。统一命令契约（与 Core 适配器同形）：
//   node <adapterCli> <command> [--week YYYY-Www] [--json] [--dry-run]
//   prepare | notify | snapshot | explain | validate | apply | verify-recover | status | run
// 退出码：0 成功；2 等待人工/无可精读内容；3 受阻（blocked / 校验不过 / 歧义）；4 瞬时基础设施（锁忙、共享库缺失、配置缺失）。
// 外部能力（fsafe/lock/records/idempotency/lark/parse-session/changeset）经 deps 注入（Slice A 共享库，契约已对齐实装）。
// records.appendRecord 要求在业务锁内调用：除 status（只读）外，各命令经 withBusinessLock 进入。

import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  readWeeklySourceStatus as realReadWeeklySourceStatus,
  updateWeeklySourceStatus as realUpdateWeeklySourceStatus,
  fileExists as realFileExists
} from "../../../learn-x-input/scripts/lib/source-status.mjs";
import {
  assertWeek, currentWeek, fail,
  repoRoot as realRepoRoot, skillRoot as realSkillRoot,
  runtimeLockPath, runtimeRoot, weekRangeLabel, weeklyRoot
} from "./paths.mjs";
import { loadConfig, loadSharedLib, requireChatId } from "./deps.mjs";
import { parseWereadMarkdown, chapterKey } from "./weread-parse.mjs";
import { selectAiCandidates } from "./ai-candidates.mjs";
import { renderDocXml, verifyReadback, USAGE_NOTE } from "./doc-render.mjs";
import { collectEntries, entryKey, parseJingduMarkdown, renderJingduMarkdown } from "./jingdu-md.mjs";
import { blockedFeedback, notifyText, syncedFeedback, waitingFeedback } from "./feedback.mjs";

const SOURCE_NAME = "jingdu";
const JINGDU_FILE = "jingdu.md";

// jingdu 专属判定规则（通用 noise/untouched/already-official/evidence 规则由 changeset.buildParsePrompt 提供）。
const DOMAIN_RULES = [
  "「我的思考」指精读文档表格第五列；表格行由「概括」列定位，概括 = 去掉「N. 」序号后的文本。",
  "表格「我的思考」列出现新写内容 → kind='added'，userEvidence.type='new-text'；targetHint=jingdu#<书名>/<章节>/<概括>#思考；newValue 必须逐字保留用户原文（含「行动：」行，由 apply 层拆分）。",
  "某章【AI 分析候选】段落正下方写了「认可」（允许前后空白）→ kind='endorsed'，userEvidence.type='endorsement-mark'；originalValue=该候选段落原文；newValue=候选原文。",
  "在 AI 分析候选文字基础上改写 → kind='modified'，userEvidence.type='edited-text'；originalValue=被改写的候选原文；newValue=用户改写后的文字（逐字）。",
  "「原始划线」列被改动（划线原文一字不改是硬约束）→ 不判 modified，进 ambiguous 并注明「原始划线被改动」。",
  "删除「我的思考」内容 ≠ 撤销正式 jingdu 条目；即使用户明确写「撤销」，也不要生成删除类变更，放进 ambiguous 并注明「撤销请求，需人工确认」。",
  "同一章节多行概括相近、书名/章节无法对应、认可与改写无法区分 → 进 ambiguous（where/problem/options），宁可 ambiguous 也不得猜测。"
];

function parseArgs(argv) {
  const args = { command: null, week: null, json: false, dryRun: false, replyTo: null, docUrl: null, messageId: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case "--json": args.json = true; break;
      case "--dry-run": args.dryRun = true; break;
      case "--week": args.week = argv[++i]; break;
      case "--reply-to": args.replyTo = argv[++i]; break;
      case "--doc-url": args.docUrl = argv[++i]; break;
      case "--message-id": args.messageId = argv[++i]; break;
      default: rest.push(token);
    }
  }
  args.command = rest.shift() ?? null;
  return args;
}

function usageResult(message) {
  return {
    exitCode: 2,
    result: {
      ok: false,
      usage: "node adapter.mjs <prepare|notify|snapshot|explain|validate|apply|verify-recover|status|run> [--week YYYY-Www] [--json] [--dry-run] [--doc-url URL] [--message-id ID] [--reply-to ID]",
      ...(message ? { error: message } : {})
    }
  };
}

function errorResult(error) {
  const code = error?.code ?? "UNKNOWN";
  const exitCode = code === "LOCK_BUSY" || code === "SHARED_LIB_UNAVAILABLE" || code === "CONFIG_MISSING" || code === "CONFIG_INVALID" ? 4 : 3;
  return { exitCode, result: { ok: false, error: { code, message: error?.message ?? String(error) } } };
}

async function buildContext(options) {
  const paths = {
    repoRoot: options.repoRoot ?? realRepoRoot(),
    skillRoot: options.skillRoot ?? realSkillRoot()
  };
  const config = options.config ?? await loadConfig(paths.skillRoot);
  return {
    args: options.args,
    paths,
    config,
    now: options.now ?? (() => new Date()),
    deps: options.deps,
    sourceStatus: {
      read: options.sourceStatus?.read ?? realReadWeeklySourceStatus,
      update: options.sourceStatus?.update ?? realUpdateWeeklySourceStatus
    },
    fileExists: options.fileExists ?? realFileExists
  };
}

function recordsPath(ctx, week) {
  return path.join(runtimeRoot(ctx.paths.skillRoot, week), "records.jsonl");
}

function runtimeFile(ctx, week, name) {
  return path.join(runtimeRoot(ctx.paths.skillRoot, week), name);
}

async function readRecordList(ctx, week) {
  const outcome = await ctx.deps.records.readRecords(recordsPath(ctx, week));
  return Array.isArray(outcome) ? outcome : outcome?.records ?? [];
}

async function appendRecord(ctx, week, record) {
  const envelope = { week, at: ctx.now().toISOString(), ...record };
  return ctx.deps.records.appendRecord(recordsPath(ctx, week), envelope);
}

async function appendReceipt(ctx, week, { command, dedupKey, ok = true, result = {}, evidence }) {
  return appendRecord(ctx, week, {
    kind: "receipt/v1", command, dedupKey, status: ok ? "applied" : "failed", result, ...(evidence ? { evidence } : {})
  });
}

async function findReceipt(ctx, week, key) {
  if (!key) return null;
  const records = await readRecordList(ctx, week);
  return ctx.deps.idempotency.findApplied(records, key) ?? null;
}

async function loadBinding(ctx, week) {
  const records = await readRecordList(ctx, week);
  const bindings = records.filter((record) => record.kind === "binding/v1" && record.week === week);
  return bindings.at(-1) ?? null;
}

async function readWeeklyFile(ctx, week, file) {
  const target = path.join(weeklyRoot(ctx.paths.repoRoot, week), file);
  if (!(await ctx.fileExists(target))) return null;
  return readFile(target, "utf8");
}

async function loadInsights(ctx, week) {
  const file = runtimeFile(ctx, week, "insights.json");
  if (!(await ctx.fileExists(file))) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw fail("BLOCKED", `insights.json 无法解析：${error.message}`);
  }
  const map = new Map();
  for (const item of Array.isArray(parsed?.insights) ? parsed.insights : []) {
    if (typeof item?.text === "string" && item.text) {
      map.set(item.text, { summary: typeof item.summary === "string" ? item.summary : "", questions: Array.isArray(item.questions) ? item.questions.slice(0, 2) : [] });
    }
  }
  return map;
}

function resolveWeek(ctx) {
  if (ctx.args.week) {
    assertWeek(ctx.args.week);
    return ctx.args.week;
  }
  return currentWeek(ctx.now());
}

function docLocation(config) {
  return config?.docFolderToken
    ? { mode: "folder", folderToken: config.docFolderToken }
    : { mode: "default", note: "docs +create 默认落点（仓库内未查到历史精读文档落点记录；docs/cases/weread-highlights/codex-weekly-automation-prompt.md:45 规定每周独立新建，--as bot）" };
}

async function createRunner(ctx) {
  return ctx.deps.lark.createRunner({ dryRun: Boolean(ctx.args.dryRun), ...ctx.config });
}

// lark-cli 输出形态归一（tests 注入的 fake 返回直通字段；真实 CLI JSON 按常见字段挖掘）。
function markdownOf(raw) {
  return raw?.markdown ?? raw?.content ?? raw?.data?.markdown ?? raw?.data?.content ?? (typeof raw === "string" ? raw : "");
}

function xmlOf(raw) {
  return raw?.xml ?? raw?.content ?? raw?.data?.xml ?? raw?.data?.content ?? (typeof raw === "string" ? raw : "");
}

function docUrlOf(raw) {
  return raw?.docUrl ?? raw?.url ?? raw?.data?.url ?? raw?.data?.docUrl ?? null;
}

function docTokenOf(raw, url) {
  return raw?.docToken ?? raw?.token ?? raw?.data?.token ?? raw?.data?.docToken ?? String(url ?? "").match(/(?:\/docx\/|\/wiki\/|\/doc\/)([A-Za-z0-9]+)/)?.[1] ?? null;
}

function revisionOf(raw) {
  return raw?.revision ?? raw?.data?.revision ?? null;
}

function messageIdOf(raw) {
  return raw?.messageId ?? raw?.message_id ?? raw?.data?.messageId ?? raw?.data?.message_id ?? null;
}

async function withBusinessLock(ctx, week, fn, { lockHeld = false } = {}) {
  if (lockHeld) return fn();
  return ctx.deps.lock.withLock(runtimeLockPath(ctx.paths.skillRoot, week), fn, {
    staleMs: Number(ctx.config?.lockStaleMs) || 120_000,
    touchMs: Number(ctx.config?.lockTouchMs) || 5_000
  });
}

// ---------------------------------------------------------------- prepare ---

async function prepareCore(ctx, { week }) {
  const weekRoot = weeklyRoot(ctx.paths.repoRoot, week);
  const status = await ctx.sourceStatus.read(weekRoot, week);
  const wereadEntry = status.sources.weread;
  const wereadPath = path.join(weekRoot, "weread.md");
  const wereadState = wereadEntry ? `${wereadEntry.status}` : "absent";
  if (!wereadEntry || wereadEntry.status !== "ready" || !(await ctx.fileExists(wereadPath))) {
    return {
      status: "blocked",
      exitCode: 3,
      reason: `weread 状态为 ${wereadState}（需 ready），未以旧文件冒充，未创建精读文档`
    };
  }

  const parsed = parseWereadMarkdown(await readFile(wereadPath, "utf8"));
  if (!parsed.highlightCount) {
    await ctx.sourceStatus.update({
      weekRoot, week, source: SOURCE_NAME, status: "empty", file: JINGDU_FILE, count: 0,
      summary: "本周无新增划线/想法，无可精读候选，文件未生成"
    });
    return { status: "empty", exitCode: 2, highlightCount: 0, ideaCount: parsed.ideaCount };
  }

  const aiMarkdown = await readWeeklyFile(ctx, week, "ai.md");
  const aiCandidates = new Map();
  if (aiMarkdown != null) {
    for (const book of parsed.books) {
      for (const chapter of book.chapters) {
        // 相关性探针 = 书名 + 章节名 + 该章全部划线原文（AI 分析候选应与用户当周读到的内容相关）。
        const contextText = `${book.title}${chapter.title}${chapter.entries.map((entry) => entry.text).join("")}`;
        const candidates = selectAiCandidates({ aiMarkdown, contextText });
        if (candidates.length) aiCandidates.set(chapterKey(book, chapter), candidates);
      }
    }
  }
  const insights = await loadInsights(ctx, week);

  const runner = await createRunner(ctx);
  const existingBinding = await loadBinding(ctx, week);
  if (existingBinding) {
    const fetched = await runner.fetchDoc({ doc: existingBinding.docUrl, docFormat: "markdown", as: "user" });
    const verify = verifyReadback({ books: parsed.books, markdown: markdownOf(fetched) });
    if (!verify.ok) {
      return {
        status: "blocked", exitCode: 3,
        reason: `已有绑定文档回读校验失败（${verify.missing.length} 行缺失），文档可能被删改；不自动重建`,
        evidence: [existingBinding.docUrl, ...verify.missing.slice(0, 3).map((item) => `缺少划线 #${item.seq}：${item.line.slice(0, 40)}`)]
      };
    }
    return { status: "reused", exitCode: 0, docUrl: existingBinding.docUrl, highlightCount: parsed.highlightCount };
  }

  const xml = renderDocXml({ week, books: parsed.books, aiCandidates, insights });
  const contentSha256 = await ctx.deps.fsafe.sha256(xml);
  const title = `精读｜${week}`;
  const location = docLocation(ctx.config);
  const contentPath = runtimeFile(ctx, week, "doc-content.xml");
  await ctx.deps.fsafe.atomicWriteFile(contentPath, xml);
  const attempts = [];
  let success = null;

  for (let attempt = 1; attempt <= 2 && !success; attempt++) {
    const created = await runner.createDoc({ title, contentPath, docFormat: "xml", parentToken: ctx.config?.docFolderToken, as: "bot" });
    const docUrl = docUrlOf(created);
    const fetched = await runner.fetchDoc({ doc: docUrl, docFormat: "markdown", as: "user" });
    const verify = verifyReadback({ books: parsed.books, markdown: markdownOf(fetched) });
    attempts.push({ docUrl, ok: verify.ok, missing: verify.missing.length });
    if (verify.ok) {
      success = { created, docUrl, docToken: docTokenOf(created, docUrl), revision: revisionOf(created), fetched };
    } else {
      attempts.push({ verifyMissing: verify.missing.slice(0, 5) });
    }
  }

  if (!success) {
    await appendReceipt(ctx, week, {
      command: "prepare", dedupKey: await ctx.deps.idempotency.stableKey("jingdu", "prepare", week, "failed"), ok: false,
      result: { reason: "回读校验两次失败", attempts }, evidence: attempts.map((item) => item.docUrl).filter(Boolean)
    });
    return {
      status: "blocked", exitCode: 3,
      reason: "创建精读文档后回读校验两次失败（原始划线未逐字命中）；未写入绑定与基线，需人工介入",
      evidence: attempts.filter((item) => item.docUrl).map((item) => `候选文档：${item.docUrl}`)
    };
  }

  const at = ctx.now().toISOString();
  const binding = {
    kind: "binding/v1", week, at,
    docUrl: success.docUrl,
    docToken: success.docToken,
    title,
    revision: success.revision,
    contentSha256,
    xml,
    markdown: markdownOf(success.fetched)
  };
  await ctx.deps.records.appendRecord(recordsPath(ctx, week), binding);
  await ctx.deps.fsafe.writeJsonFile(runtimeFile(ctx, week, "baseline.json"), {
    week, at, docUrl: binding.docUrl, docToken: binding.docToken, title, revision: binding.revision,
    contentSha256, xml, markdown: binding.markdown,
    books: parsed.books,
    aiCandidates: Object.fromEntries(aiCandidates),
    insights: Object.fromEntries(insights),
    usageNote: USAGE_NOTE,
    location
  });
  const receipt = await appendReceipt(ctx, week, {
    command: "prepare", dedupKey: await ctx.deps.idempotency.stableKey("jingdu", "prepare", week),
    result: { docUrl: binding.docUrl, candidateCount: parsed.highlightCount, location: location.mode }
  });
  return {
    status: "created", exitCode: 0, docUrl: binding.docUrl,
    highlightCount: parsed.highlightCount, ideaCount: parsed.ideaCount,
    aiCandidateChapters: [...aiCandidates.keys()], location, receiptAt: receipt.at ?? receipt.ts ?? null
  };
}

async function prepare(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, async () => {
    const outcome = await prepareCore(ctx, { week });
    if (outcome.status === "blocked") return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: outcome.reason, evidence: outcome.evidence ?? [] } };
    return { exitCode: outcome.exitCode, result: { ok: true, week, ...outcome } };
  });
}

// ----------------------------------------------------------------- notify ---

async function notifyCore(ctx, { week }) {
  const key = await ctx.deps.idempotency.stableKey("jingdu", "notify", week);
  const existing = await findReceipt(ctx, week, key);
  const binding = await loadBinding(ctx, week);
  if (!binding) {
    return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: "本周精读文档尚未准备（无 binding）；先运行 prepare" } };
  }
  const markdown = notifyText({ docUrl: binding.docUrl });
  if (existing) {
    return { exitCode: 0, result: { ok: true, week, status: "already-notified", at: existing.at ?? existing.ts ?? null, messageId: existing.result?.messageId ?? null } };
  }
  if (ctx.args.dryRun) {
    return { exitCode: 0, result: { ok: true, week, status: "dry-run", chatId: ctx.config?.chatId ?? null, markdown } };
  }
  const chatId = requireChatId(ctx.config);
  const runner = await createRunner(ctx);
  const sent = await runner.sendChatMessage({ chatId, markdown, idempotencyKey: key, as: "bot" });
  const receipt = await appendReceipt(ctx, week, {
    command: "notify", dedupKey: key,
    result: { chatId, messageId: messageIdOf(sent) }, evidence: [`chatId=${chatId}`]
  });
  return { exitCode: 0, result: { ok: true, week, status: "sent", messageId: messageIdOf(sent), at: receipt.at ?? receipt.ts ?? null } };
}

async function notify(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, () => notifyCore(ctx, { week }));
}

// --------------------------------------------------------------- snapshot ---

async function fetchDocPair(ctx, binding) {
  const runner = await createRunner(ctx);
  const markdownRaw = await runner.fetchDoc({ doc: binding.docUrl, docFormat: "markdown", as: "user" });
  const xmlRaw = await runner.fetchDoc({ doc: binding.docUrl, docFormat: "xml", as: "user" });
  return { markdown: markdownOf(markdownRaw), xml: xmlOf(xmlRaw), revision: revisionOf(xmlRaw) ?? revisionOf(markdownRaw) ?? binding.revision };
}

async function snapshotCore(ctx, { week }) {
  const binding = await loadBinding(ctx, week);
  if (!binding) return { status: "blocked", reason: "本周精读文档尚未准备（无 binding）" };
  const dir = path.join(runtimeRoot(ctx.paths.skillRoot, week), "snapshot");
  await ctx.deps.fsafe.ensureDir(dir);
  const pair = await fetchDocPair(ctx, binding);
  const baselineFile = runtimeFile(ctx, week, "baseline.json");
  let baseline = null;
  if (await ctx.fileExists(baselineFile)) baseline = await ctx.deps.fsafe.readJsonFile(baselineFile);

  const files = {};
  const writeSnapshot = async (name, content) => {
    if (content == null) return;
    const target = path.join(dir, name);
    await ctx.deps.fsafe.atomicWriteFile(target, content);
    files[name] = await ctx.deps.fsafe.sha256(content);
  };

  await writeSnapshot("doc.xml", pair.xml);
  await writeSnapshot("doc.md", pair.markdown);
  await writeSnapshot("baseline.json", baseline ? JSON.stringify(baseline, null, 2) : null);
  await writeSnapshot("weread.md", await readWeeklyFile(ctx, week, "weread.md"));
  await writeSnapshot("ai.md", await readWeeklyFile(ctx, week, "ai.md"));
  const jingdu = await readWeeklyFile(ctx, week, JINGDU_FILE);
  await writeSnapshot(JINGDU_FILE, jingdu);
  await writeSnapshot("_source-status.json", await readWeeklyFile(ctx, week, "_source-status.json"));

  const manifest = {
    week,
    fetchedAt: ctx.now().toISOString(),
    docUrl: binding.docUrl,
    revision: pair.revision,
    jingdu: jingdu == null ? "absent" : "present",
    files
  };
  await ctx.deps.fsafe.writeJsonFile(path.join(dir, "manifest.json"), manifest);
  return { status: "ok", dir, manifest };
}

async function snapshot(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, async () => {
    const outcome = await snapshotCore(ctx, { week });
    if (outcome.status === "blocked") return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: outcome.reason } };
    return { exitCode: 0, result: { ok: true, week, ...outcome } };
  });
}

// ---------------------------------------------------------------- explain ---

function parseTargetHint(hint) {
  const parts = String(hint ?? "").replace(/^already-official:?/, "").split("#");
  if (parts[0] !== "jingdu" || !parts[1]) return null;
  const [book, chapter, summary] = parts[1].split("/");
  if (!book || !chapter) return null;
  return { book, chapter, summary: summary ?? "" };
}

function normalizeChangeset(json) {
  const items = Array.isArray(json?.items) ? json.items : Array.isArray(json?.changes) ? json.changes : [];
  const normalized = items.map((item) => ({
    kind: item?.kind ?? "noise",
    itemId: item?.itemId ?? null,
    target: item?.target && typeof item.target === "object"
      ? { book: item.target.book, chapter: item.target.chapter, summary: item.target.summary ?? "" }
      : parseTargetHint(item?.targetHint) ?? { book: "", chapter: "", summary: "" },
    targetHint: item?.targetHint ?? null,
    originalValue: typeof item?.originalValue === "string" ? item.originalValue : null,
    newValue: typeof item?.newValue === "string" ? item.newValue : null,
    note: typeof item?.reason === "string" ? item.reason : typeof item?.note === "string" ? item.note : ""
  }));
  const ambiguous = (Array.isArray(json?.ambiguous) ? json.ambiguous : []).map((entry) => ({
    kind: "ambiguous",
    target: { book: "", chapter: "", summary: "" },
    targetHint: null,
    originalValue: null,
    newValue: null,
    note: [entry?.where, entry?.problem].filter(Boolean).join("：") || "解析器无法确定该项"
  }));
  return [...normalized, ...ambiguous];
}

async function explainCore(ctx, { week }) {
  const binding = await loadBinding(ctx, week);
  if (!binding) return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: "本周精读文档尚未准备（无 binding）；先运行 prepare" } };

  const snap = await snapshotCore(ctx, { week });
  if (snap.status === "blocked") return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: snap.reason } };

  const snapshotDir = path.join(runtimeRoot(ctx.paths.skillRoot, week), "snapshot");
  const snapshotFiles = [
    { path: path.join(snapshotDir, "doc.md"), note: "审阅文档回读（用户编辑后的现状）" },
    { path: runtimeFile(ctx, week, "baseline.json"), note: "建档基线（候选、AI 分析候选、insights）" },
    { path: path.join(snapshotDir, "weread.md"), note: "当周划线与想法原文" },
    { path: path.join(snapshotDir, "ai.md"), note: "AI 周回顾候选" },
    { path: path.join(snapshotDir, JINGDU_FILE), note: "当前 jingdu.md（可能不存在）" }
  ];
  const promptFile = runtimeFile(ctx, week, "parse-prompt.md");
  const prompt = ctx.deps.changeset.buildParsePrompt({ business: "jingdu", week, domainRules: DOMAIN_RULES, snapshotFiles });
  await ctx.deps.fsafe.atomicWriteFile(promptFile, prompt);

  const timeoutMs = Number(ctx.config?.parseTimeoutMs) || 600_000;
  const session = await ctx.deps.parseSession.runParseSession({ repoPath: ctx.paths.repoRoot, promptFile, timeoutMs });
  if (!session?.json) {
    await appendReceipt(ctx, week, { command: "explain", ok: false, result: { reason: "parse-session 未返回 JSON", rawExcerpt: String(session?.raw ?? "").slice(0, 400) } });
    return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: "parse-session 未返回 JSON 变更集", rawExcerpt: String(session?.raw ?? "").slice(0, 400) } };
  }
  try {
    ctx.deps.changeset.validateChangeset(session.json);
  } catch (error) {
    return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: `changeset 校验失败：${error.message}` } };
  }

  const items = normalizeChangeset(session.json);
  const proposal = {
    week,
    business: "jingdu",
    builtAt: ctx.now().toISOString(),
    promptFile,
    meta: { messageText: session.messageText ?? null, parseMeta: session.meta ?? null },
    items
  };
  await ctx.deps.fsafe.writeJsonFile(runtimeFile(ctx, week, "proposal.json"), proposal);
  await appendReceipt(ctx, week, { command: "explain", result: { items: items.length } });
  const byKind = items.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {});
  return { exitCode: 0, result: { ok: true, week, status: "explained", items: items.length, byKind, proposalFile: runtimeFile(ctx, week, "proposal.json") } };
}

async function explain(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, () => explainCore(ctx, { week }));
}

// --------------------------------------------------------------- validate ---

function rowSummariesOf(baseline, bookTitle, chapterTitle) {
  const book = (baseline.books ?? []).find((item) => item.title === bookTitle);
  const chapter = book?.chapters.find((item) => item.title === chapterTitle);
  if (!chapter) return null;
  return chapter.entries.map((highlight) => {
    const insight = (baseline.insights ?? {})[highlight.text];
    return { key: insight?.summary?.trim() || `划线 ${highlight.seq}`, seq: highlight.seq, text: highlight.text };
  });
}

export function validateItems({ items, baseline, jingdu }) {
  const blockers = [];
  const dropped = [];
  const actionable = [];
  const seen = new Set();

  for (const item of items) {
    if (typeof item?.targetHint === "string" && item.targetHint.startsWith("already-official")) {
      dropped.push({ kind: item.kind, targetHint: item.targetHint, reason: "skipped-identical：内容已正式存在且与候选相同" });
      continue;
    }
    if (item.kind === "noise" || item.kind === "untouched") {
      dropped.push({ kind: item.kind, note: item.note, reason: item.kind === "noise" ? "无语义变化" : "未修改的候选，不写入" });
      continue;
    }
    if (item.kind === "ambiguous") {
      blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: `歧义：${item.note || "未说明"}` });
      continue;
    }
    if (!["added", "endorsed", "modified"].includes(item.kind)) {
      blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: `未知变更类型：${item.kind}（撤销类请求需人工确认，见 ambiguous）` });
      continue;
    }
    const { book, chapter, summary } = item.target;
    const summaries = rowSummariesOf(baseline, book, chapter);
    if (!summaries) {
      blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: `目标不存在：书或章节无法定位（${book}/${chapter}）` });
      continue;
    }
    const row = summary ? summaries.find((candidate) => candidate.key === summary.replace(/^\d+\.\s*/, "")) : null;
    if (!row) {
      blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: `目标不存在：概括「${summary}」不在 ${book}/${chapter} 的表格行中` });
      continue;
    }
    const key = entryKey({ book, chapter, summary: row.key });
    if (seen.has(key)) {
      blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: `查重：同一目标出现多条变更（${key}）` });
      continue;
    }
    seen.add(key);

    if (item.kind === "added") {
      const valueLines = String(item.newValue ?? "").split("\n").filter((line) => line.trim());
      if (!valueLines.length) {
        blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: "added 缺少用户「我的思考」内容" });
        continue;
      }
    }
    if (item.kind === "endorsed" || item.kind === "modified") {
      const original = String(item.originalValue ?? "");
      if (!original || !String(baseline.markdown ?? "").includes(original)) {
        blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: "原值匹配失败：originalValue 未在基线文档中逐字找到" });
        continue;
      }
      const chapterCandidates = Object.entries(baseline.aiCandidates ?? {}).find(([keyText]) => keyText === `${book}｜${chapter}`)?.[1] ?? [];
      if (item.kind === "endorsed" && !chapterCandidates.includes(original)) {
        blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: "认可对象不是该章节的 AI 分析候选原文" });
        continue;
      }
      if (item.kind === "modified" && !String(item.newValue ?? "").trim()) {
        blockers.push({ kind: item.kind, targetHint: item.targetHint, reason: "modified 缺少改写后的用户文字" });
        continue;
      }
    }
    actionable.push({ ...item, target: { book, chapter, summary: row.key }, row });
  }

  return { actionable, dropped, blockers, ok: blockers.length === 0 };
}

async function loadJingduDocument(ctx, week) {
  const raw = await readWeeklyFile(ctx, week, JINGDU_FILE);
  return raw == null ? null : { raw, parsed: parseJingduMarkdown(raw) };
}

async function validateCore(ctx, { week }) {
  const baselineFile = runtimeFile(ctx, week, "baseline.json");
  if (!(await ctx.fileExists(baselineFile))) {
    return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: "缺少基线（先运行 prepare）" } };
  }
  const proposalFile = runtimeFile(ctx, week, "proposal.json");
  if (!(await ctx.fileExists(proposalFile))) {
    return { exitCode: 3, result: { ok: false, week, status: "blocked", reason: "缺少 proposal.json（先运行 explain）" } };
  }
  const baseline = await ctx.deps.fsafe.readJsonFile(baselineFile);
  const proposal = await ctx.deps.fsafe.readJsonFile(proposalFile);
  const jingdu = await loadJingduDocument(ctx, week);
  const verdict = validateItems({ items: proposal.items ?? [], baseline, jingdu });
  await appendReceipt(ctx, week, {
    command: "validate", ok: verdict.ok,
    result: { actionable: verdict.actionable.length, dropped: verdict.dropped.length, blockers: verdict.blockers.length }
  });
  if (!verdict.ok) {
    return { exitCode: 3, result: { ok: false, week, status: "invalid", ...verdict, jingduPresent: Boolean(jingdu) } };
  }
  return { exitCode: 0, result: { ok: true, week, status: "valid", ...verdict, jingduPresent: Boolean(jingdu) } };
}

async function validate(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, () => validateCore(ctx, { week }));
}

// ------------------------------------------------------------------ apply ---

function splitActions(valueText) {
  const thoughtLines = [];
  const actionLines = [];
  for (const line of String(valueText ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("行动：") || trimmed.startsWith("行动:")) actionLines.push(trimmed.replace(/^行动[:：]\s*/, ""));
    else thoughtLines.push(trimmed);
  }
  return { thoughtLines, actionLines };
}

function buildJingduBooks({ existingBooks, actionable, baseline }) {
  const books = new Map();
  for (const book of existingBooks) {
    books.set(book.title, { title: book.title, author: book.author, entries: [...book.entries] });
  }
  const bookOf = (title, author) => {
    if (!books.has(title)) books.set(title, { title, author: author ?? "", entries: [] });
    return books.get(title);
  };

  for (const item of actionable) {
    const { book: bookTitle, chapter, summary } = item.target;
    const author = (baseline.books ?? []).find((book) => book.title === bookTitle)?.author ?? "";
    const currentBook = bookOf(bookTitle, author);
    const quoteText = item.row?.text ?? "";
    const quoteLines = quoteText ? quoteText.split("\n") : [];
    const entry = currentBook.entries.find((candidate) => candidate.summary === summary && candidate.chapter === chapter);

    const { thoughtLines: actionSplitThoughts, actionLines } = splitActions(item.newValue);
    const thoughtLines = item.kind === "added"
      ? actionSplitThoughts
      : item.kind === "endorsed"
        ? ["（认可 AI 分析候选）", ...String(item.newValue ?? "").split("\n").filter((line) => line.trim())]
        : ["（改写自 AI 分析候选）", ...actionSplitThoughts];

    if (!entry) {
      currentBook.entries.push({ summary, chapter, quoteLines, thoughtLines, actionLines });
    } else {
      entry.summary = summary;
      entry.chapter = chapter;
      if (quoteLines.length) entry.quoteLines = quoteLines;
      entry.thoughtLines = thoughtLines;
      entry.actionLines = item.kind === "endorsed" ? entry.actionLines ?? [] : actionLines;
    }
  }

  return [...books.values()].filter((book) => book.entries.length);
}

async function applyCore(ctx, { week }) {
  const weekRoot = weeklyRoot(ctx.paths.repoRoot, week);
  const baselineFile = runtimeFile(ctx, week, "baseline.json");
  const proposalFile = runtimeFile(ctx, week, "proposal.json");
  for (const [label, file] of [["基线", baselineFile], ["proposal", proposalFile]]) {
    if (!(await ctx.fileExists(file))) return { status: "blocked", reason: `缺少${label}（先运行 prepare/explain）` };
  }
  const baseline = await ctx.deps.fsafe.readJsonFile(baselineFile);
  const proposal = await ctx.deps.fsafe.readJsonFile(proposalFile);

  // apply 前强制重验（幂等且防脏读）。
  const jingdu = await loadJingduDocument(ctx, week);
  const verdict = validateItems({ items: proposal.items ?? [], baseline, jingdu });
  if (!verdict.ok) return { status: "blocked", reason: "proposal 未通过校验，先处理 validate 阻断项", blockers: verdict.blockers };
  // 幂等键只取决于 proposal 内容：同一变更集重复 apply 直接命中 already-applied。
  const applyKey = await ctx.deps.idempotency.stableKey("jingdu", "apply", week, JSON.stringify(proposal.items ?? []));
  const existingReceipt = await findReceipt(ctx, week, applyKey);
  if (existingReceipt) {
    return { status: "already-applied", at: existingReceipt.at ?? existingReceipt.ts ?? null, appliedCount: existingReceipt.result?.appliedCount ?? 0 };
  }

  if (!verdict.actionable.length && !jingdu) {
    await ctx.sourceStatus.update({
      weekRoot, week, source: SOURCE_NAME, status: "empty", file: JINGDU_FILE, count: 0,
      summary: "0 条记录，文件未生成"
    });
    return { status: "applied", appliedCount: 0, empty: true };
  }
  if (!verdict.actionable.length && jingdu) {
    // 无可应用变更且正文已存在：不动文件、不重渲染，避免无意义改写。
    return { status: "applied", appliedCount: 0, noop: true, droppedCount: verdict.dropped.length };
  }

  const books = buildJingduBooks({ existingBooks: jingdu?.parsed.books ?? [], actionable: verdict.actionable, baseline });
  const content = renderJingduMarkdown({
    week,
    docUrl: baseline.docUrl,
    rangeLabel: weekRangeLabel(week),
    generatedAt: ctx.now().toISOString(),
    books
  });
  if ([...content].length > 15000) {
    // 正常不应发生（见 case 基准 §6）：超限时仍如实写入，但报告提示先跑 input:compress。
    await appendReceipt(ctx, week, { command: "apply", result: { warning: `jingdu.md 超 15000 码点（${[...content].length}），建议先运行 npm run input:compress` } });
  }
  const jingduPath = path.join(weekRoot, JINGDU_FILE);
  const expectSha256 = await ctx.deps.fsafe.sha256(content);
  const appliedCount = verdict.actionable.length;
  const now = ctx.now().toISOString();
  const priorEntry = (await ctx.sourceStatus.read(weekRoot, week)).sources[SOURCE_NAME];

  // 两阶段提交：pendingCommit 登记 → 原子写 → sha 复算 → ready 登记 → commit 追加。
  try {
    await ctx.sourceStatus.update({
      weekRoot, week, source: SOURCE_NAME,
      status: priorEntry?.status ?? "needs_review",
      file: JINGDU_FILE,
      count: books.reduce((sum, book) => sum + book.entries.length, 0),
      summary: "两阶段提交进行中（pendingCommit 已登记）",
      preservedStaleFile: priorEntry?.preservedStaleFile ?? false,
      appendJournal: [{ action: "pending", at: now, expectSha256 }]
    });
    await ctx.deps.fsafe.atomicWriteFile(jingduPath, content);
    const written = await readFile(jingduPath, "utf8");
    const actualSha256 = await ctx.deps.fsafe.sha256(written);
    if (actualSha256 !== expectSha256) throw fail("COMMIT_MISMATCH", `sha256 复算不一致：expect=${expectSha256} actual=${actualSha256}`);
    await ctx.sourceStatus.update({
      weekRoot, week, source: SOURCE_NAME, status: "ready", file: JINGDU_FILE,
      count: books.reduce((sum, book) => sum + book.entries.length, 0),
      summary: `本周精读 ${books.reduce((sum, book) => sum + book.entries.length, 0)} 条`,
      contentSha256: actualSha256,
      appendJournal: [{ action: "commit", at: ctx.now().toISOString(), sha256: actualSha256 }]
    });

    // 读回证据：hash + 逐条 grep 确认。
    const evidence = [{ check: "sha256", value: actualSha256 }];
    for (const item of verdict.actionable) {
      const firstLine = splitActions(item.newValue ?? "").thoughtLines[0] ?? item.target.summary;
      evidence.push({ check: "grep", target: entryKey(item.target), found: written.includes(firstLine), line: firstLine.slice(0, 40) });
    }
    await ctx.deps.records.appendRecord(recordsPath(ctx, week), {
      kind: "change/v1", week, at: now, dedupKey: applyKey, status: "applied",
      items: verdict.actionable.map((item) => ({ kind: item.kind, target: item.target, newValue: item.newValue }))
    });
    const receipt = await appendReceipt(ctx, week, {
      command: "apply", dedupKey: applyKey,
      result: { appliedCount, droppedCount: verdict.dropped.length, sha256: actualSha256 },
      evidence
    });
    return {
      status: "applied", appliedCount, droppedCount: verdict.dropped.length,
      bookCount: books.length, jingduPath, sha256: actualSha256, at: receipt.at ?? receipt.ts ?? null, evidence
    };
  } catch (error) {
    await appendReceipt(ctx, week, {
      command: "apply", dedupKey: await ctx.deps.idempotency.stableKey("jingdu", "apply", week, "failed", expectSha256), ok: false,
      result: { stage: "two-phase-commit", reason: error.message, expectSha256 }
    });
    throw fail("BLOCKED", `两阶段提交失败：${error.message}；已保留 pendingCommit 现场与失败 receipt，未把半成品标 ready`);
  }
}

async function apply(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, async () => {
    const outcome = await applyCore(ctx, { week });
    if (outcome.status === "blocked") return { exitCode: 3, result: { ok: false, week, status: "blocked", ...outcome } };
    return { exitCode: 0, result: { ok: true, week, ...outcome } };
  });
}

// --------------------------------------------------------- verify-recover ---

async function verifyRecoverCore(ctx, { week }) {
  const weekRoot = weeklyRoot(ctx.paths.repoRoot, week);
  const status = await ctx.sourceStatus.read(weekRoot, week);
  const entry = status.sources[SOURCE_NAME];
  const journal = Array.isArray(entry?.commitJournal) ? entry.commitJournal : [];
  const lastPending = [...journal].reverse().find((item) => item.action === "pending");
  if (!lastPending) {
    return { exitCode: 0, result: { ok: true, week, status: "nothing-to-recover", entryStatus: entry?.status ?? "absent" } };
  }
  const jingduPath = path.join(weekRoot, JINGDU_FILE);
  if (!(await ctx.fileExists(jingduPath))) {
    await appendReceipt(ctx, week, { command: "verify-recover", ok: false, result: { reason: "pendingCommit 存在但 jingdu.md 未落盘；保持 pending 现场" } });
    return { exitCode: 3, result: { ok: false, week, status: "still-broken", reason: "jingdu.md 不存在，pendingCommit 保留；需重新运行 apply" } };
  }
  const raw = await readFile(jingduPath, "utf8");
  const parsed = parseJingduMarkdown(raw);
  if (parsed.week !== week) {
    return { exitCode: 3, result: { ok: false, week, status: "still-broken", reason: `jingdu.md 周标识不匹配（文件为 ${parsed.week ?? "未知"}）；不覆盖正文，需人工确认` } };
  }
  const actualSha256 = await ctx.deps.fsafe.sha256(raw);
  const count = collectEntries(parsed.books).length;
  await ctx.sourceStatus.update({
    weekRoot, week, source: SOURCE_NAME, status: "ready", file: JINGDU_FILE, count,
    summary: `本周精读 ${count} 条（verify-recover 恢复登记）`,
    contentSha256: actualSha256,
    appendJournal: [{ action: "commit", at: ctx.now().toISOString(), sha256: actualSha256, note: "verify-recover 补登记" }]
  });
  const receipt = await appendReceipt(ctx, week, {
    command: "verify-recover",
    result: { fullMatch: actualSha256 === lastPending.expectSha256, expectSha256: lastPending.expectSha256, actualSha256 },
    evidence: [{ check: "sha256", value: actualSha256 }]
  });
  return {
    exitCode: 0,
    result: { ok: true, week, status: "recovered", fullMatch: actualSha256 === lastPending.expectSha256, expectSha256: lastPending.expectSha256, actualSha256, count, at: receipt.at ?? receipt.ts ?? null }
  };
}

async function verifyRecover(ctx) {
  const week = resolveWeek(ctx);
  return withBusinessLock(ctx, week, () => verifyRecoverCore(ctx, { week }));
}

// ----------------------------------------------------------------- status ---

function docTokenFromUrl(url) {
  return String(url ?? "").match(/(?:\/docx\/|\/wiki\/|\/doc\/)([A-Za-z0-9]+)/)?.[1] ?? null;
}

async function listWeeksWithRuntime(ctx) {
  const runtime = path.join(ctx.paths.skillRoot, "runtime");
  if (!(await ctx.fileExists(runtime))) return [];
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(runtime, { withFileTypes: true });
  return entries.filter((item) => item.isDirectory() && WEEK_DIR_PATTERN.test(item.name)).map((item) => item.name);
}

const WEEK_DIR_PATTERN = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

async function status(ctx) {
  const locator = ctx.args.docUrl ?? ctx.args.messageId ?? ctx.args.replyTo;
  let week = null;
  if (ctx.args.week) {
    assertWeek(ctx.args.week);
    week = ctx.args.week;
  } else if (ctx.args.docUrl) {
    const token = docTokenFromUrl(ctx.args.docUrl);
    for (const candidate of await listWeeksWithRuntime(ctx)) {
      const binding = await loadBinding(ctx, candidate);
      if (binding && (binding.docUrl === ctx.args.docUrl || (token && binding.docToken === token))) { week = candidate; break; }
    }
  } else if (ctx.args.messageId || ctx.args.replyTo) {
    const wanted = ctx.args.messageId ?? ctx.args.replyTo;
    for (const candidate of await listWeeksWithRuntime(ctx)) {
      const records = await readRecordList(ctx, candidate);
      const hit = records.find((record) => record.kind === "receipt/v1" && record.command === "notify" && record.result?.messageId && record.result.messageId === wanted);
      if (hit) { week = candidate; break; }
    }
  } else {
    week = currentWeek(ctx.now());
  }

  if (!week) {
    return { exitCode: 3, result: { ok: false, status: "absent", locator, reason: "按定位条件未找到任何周的精读记录" } };
  }

  const weekRoot = weeklyRoot(ctx.paths.repoRoot, week);
  const sidecar = await ctx.sourceStatus.read(weekRoot, week);
  const entry = sidecar.sources[SOURCE_NAME];
  const binding = await loadBinding(ctx, week);
  let state = "absent";
  const evidence = { week, docUrl: binding?.docUrl ?? null, boundAt: binding?.at ?? null };
  if (entry?.status === "ready") {
    state = "applied";
    evidence.contentSha256 = entry.contentSha256 ?? null;
    evidence.journalActions = (entry.commitJournal ?? []).map((item) => item.action);
  } else if (binding) {
    state = "prepared";
    try {
      const runner = await createRunner(ctx);
      const fetched = await runner.fetchDoc({ doc: binding.docUrl, docFormat: "markdown", as: "user" });
      const currentSha256 = await ctx.deps.fsafe.sha256(markdownOf(fetched));
      const boundSha256 = await ctx.deps.fsafe.sha256(binding.markdown ?? "");
      evidence.currentContentSha256 = currentSha256;
      evidence.boundMarkdownSha256 = boundSha256;
      if (currentSha256 !== boundSha256) state = "edited";
    } catch (error) {
      evidence.fetchNote = `编辑状态核验失败：${error.message}（保持 prepared，不猜测）`;
    }
    if (await ctx.fileExists(runtimeFile(ctx, week, "proposal.json"))) state = "edited";
  }
  const found = state !== "absent";
  return {
    exitCode: locator && !found ? 3 : 0,
    result: { ok: found || !locator, week, state, evidence }
  };
}

// -------------------------------------------------------------------- run ---

function messageItemsOf(raw) {
  const items = raw?.items ?? raw?.messages ?? raw?.data?.items ?? raw?.data?.messages ?? (Array.isArray(raw) ? raw : []);
  return Array.isArray(items) ? items : [];
}

function messageTextOf(message) {
  return String(message?.text ?? message?.content ?? message?.markdown ?? "");
}

function messageSenderTypeOf(message) {
  return String(message?.senderType ?? message?.sender_type ?? message?.sender?.type ?? message?.sender?.senderType ?? "user").toLowerCase();
}

async function findContinueReply(ctx, { chatId }) {
  const runner = await createRunner(ctx);
  const raw = await runner.listChatMessages({ chatId, as: "user", pageSize: 50 });
  return messageItemsOf(raw).find((message) => messageSenderTypeOf(message) !== "bot" && messageTextOf(message).includes("继续")) ?? null;
}

async function sendFeedback(ctx, { chatId, markdown, replyTo, stage }) {
  const runner = await createRunner(ctx);
  const idempotencyKey = await ctx.deps.idempotency.stableKey("jingdu", "feedback", stage, markdown.slice(0, 64));
  if (replyTo) return runner.replyChatMessage({ chatId, messageId: replyTo, markdown, idempotencyKey, as: "bot" });
  return runner.sendChatMessage({ chatId, markdown, idempotencyKey, as: "bot" });
}

async function run(ctx) {
  const week = resolveWeek(ctx);
  let outcome;
  try {
    outcome = await ctx.deps.lock.withLock(runtimeLockPath(ctx.paths.skillRoot, week), () => runPipeline(ctx, { week }), {
      staleMs: Number(ctx.config?.lockStaleMs) || 120_000,
      touchMs: Number(ctx.config?.lockTouchMs) || 5_000
    });
  } catch (error) {
    if (error?.code === "LOCK_BUSY") {
      return { exitCode: 4, result: { ok: false, week, status: "lock-busy", lockPath: runtimeLockPath(ctx.paths.skillRoot, week), reason: error.message } };
    }
    throw error;
  }
  return outcome;
}

async function runPipeline(ctx, { week }) {
  const chatId = ctx.config?.chatId ?? null;
  const dryRun = Boolean(ctx.args.dryRun);

  // ① prepare（幂等）
  const prepareOutcome = await prepareCore(ctx, { week });
  if (prepareOutcome.status === "blocked") {
    if (chatId && !dryRun) {
      await sendFeedback(ctx, { chatId, markdown: blockedFeedback({ week, reason: prepareOutcome.reason, evidence: prepareOutcome.evidence }), stage: "prepare-blocked" });
    }
    return { exitCode: 3, result: { ok: false, week, status: "blocked", stage: "prepare", reason: prepareOutcome.reason, evidence: prepareOutcome.evidence ?? [] } };
  }
  if (prepareOutcome.status === "empty") {
    return { exitCode: 2, result: { ok: true, week, status: "empty", reason: "本周无新增划线/想法，无可精读候选；已登记 jingdu empty，未创建文档" } };
  }

  // ② notify（幂等；dry-run 不发送）
  const notifyOutcome = await notifyCore(ctx, { week });
  const docUrl = prepareOutcome.docUrl ?? (await loadBinding(ctx, week))?.docUrl;
  if (notifyOutcome.result?.status === "dry-run") {
    return { exitCode: 2, result: { ok: true, week, status: "dry-run", stage: "notify", markdown: notifyOutcome.result.markdown, docUrl } };
  }

  // ③ 人工门槛：等待用户「继续」
  let continueReply = null;
  if (chatId) {
    const records = await readRecordList(ctx, week);
    const notifyReceipt = records.filter((record) => record.kind === "receipt/v1" && record.command === "notify").at(-1) ?? null;
    if (notifyReceipt) {
      try {
        continueReply = await findContinueReply(ctx, { chatId });
      } catch (error) {
        return { exitCode: 2, result: { ok: true, week, status: "waiting", docUrl, note: `无法读取群消息核验「继续」口令：${error.message}；保持等待` } };
      }
    }
  }
  if (!continueReply) {
    return { exitCode: 2, result: { ok: true, week, status: "waiting", docUrl, note: waitingFeedback({ week }) } };
  }

  // ④ explain → validate → apply
  const explainOutcome = await explainCore(ctx, { week });
  if (explainOutcome.exitCode !== 0) {
    if (chatId && !dryRun) {
      await sendFeedback(ctx, { chatId, markdown: blockedFeedback({ week, reason: explainOutcome.result?.reason ?? "explain 失败" }), replyTo: continueReply.messageId, stage: "explain-blocked" });
    }
    return { exitCode: explainOutcome.exitCode, result: { ...explainOutcome.result, stage: "explain" } };
  }
  const validateOutcome = await validateCore(ctx, { week });
  if (validateOutcome.exitCode !== 0) {
    if (chatId && !dryRun) {
      const reasons = (validateOutcome.result?.blockers ?? []).slice(0, 3).map((blocker) => blocker.reason);
      await sendFeedback(ctx, { chatId, markdown: blockedFeedback({ week, reason: "变更集未通过校验，未写入任何输入文件", evidence: reasons }), replyTo: continueReply.messageId, stage: "validate-blocked" });
    }
    return { exitCode: validateOutcome.exitCode, result: { ...validateOutcome.result, stage: "validate" } };
  }
  const applyOutcome = await applyCore(ctx, { week });
  if (applyOutcome.status === "blocked") {
    if (chatId && !dryRun) {
      await sendFeedback(ctx, { chatId, markdown: blockedFeedback({ week, reason: applyOutcome.reason ?? "apply 失败" }), replyTo: continueReply.messageId, stage: "apply-blocked" });
    }
    return { exitCode: 3, result: { ok: false, week, status: "blocked", stage: "apply", reason: applyOutcome.reason ?? "apply 失败" } };
  }
  if (applyOutcome.status === "already-applied") {
    // 幂等重放：同一 proposal 已应用过，不重复反馈、不重写文件。
    return { exitCode: 0, result: { ok: true, week, status: "already-applied", docUrl, at: applyOutcome.at, appliedCount: applyOutcome.appliedCount ?? 0 } };
  }

  if (chatId && !dryRun) {
    await sendFeedback(ctx, {
      chatId,
      markdown: syncedFeedback({ week, appliedCount: applyOutcome.appliedCount ?? 0, bookCount: applyOutcome.bookCount ?? 0, jingduPath: applyOutcome.jingduPath ?? "", skippedCount: applyOutcome.droppedCount ?? 0 }),
      replyTo: continueReply.messageId,
      stage: "applied"
    });
  }
  return { exitCode: 0, result: { ok: true, week, status: "applied", docUrl, ...applyOutcome } };
}

// ------------------------------------------------------------------ entry ---

const COMMANDS = { prepare, notify, snapshot, explain, validate, apply, "verify-recover": verifyRecover, status, run };

export async function runCommand(argv, options = {}) {
  const args = parseArgs(argv);
  if (!args.command || !COMMANDS[args.command]) return usageResult(args.command ? `未知命令：${args.command}` : "缺少命令");
  let ctx;
  try {
    ctx = await buildContext({ args, ...options });
    if (!options.deps) {
      ctx.deps = await loadSharedLib();
    }
    return await COMMANDS[args.command](ctx);
  } catch (error) {
    return errorResult(error);
  }
}

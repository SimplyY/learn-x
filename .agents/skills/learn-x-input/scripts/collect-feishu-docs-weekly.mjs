import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { currentShanghaiIsoWeek, isoWeekRangeShanghai, normalizeWeek, defaultWeeklyReviewWeek } from "./collect-weread-weekly.mjs";
import { fileExists, readWeeklySourceStatus, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const execFileAsync = promisify(execFile);
const PAGE_SIZE = 20;
const TIMEZONE = "Asia/Shanghai";
const SHADOW_SUMMARY_PREFIX = "影子结果：";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export class NeedsReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = "NeedsReviewError";
  }
}

export async function collectFeishuDocsWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const editorId = String(options.editorId || process.env.LEARNX_FEISHU_HUMAN_EDITOR_ID || "").trim();
  if (!editorId) throw new NeedsReviewError("未配置经在线 canary 核实的本人 editor ID。");

  const range = isoWeekRangeShanghai(week);
  if (currentShanghaiIsoWeek(new Date(range.startEpoch * 1000)) !== week) throw new Error(`无效 ISO 周：${week}`);
  const transport = options.transport || createLarkTransport();
  const currentUserId = String(await transport.currentUserId() || "").trim();
  if (!currentUserId || currentUserId !== editorId) {
    throw new NeedsReviewError("本次 lark-cli 用户 open_id 与经 canary 核验的本人 editor ID 不一致。");
  }
  const candidates = new Map();
  for (const kind of ["created", "edited"]) {
    let pageToken = "";
    const seenPageTokens = new Set();
    while (true) {
      const page = await transport.searchPage({ kind, week, range, pageToken, pageSize: PAGE_SIZE });
      validateSearchPage(page);
      for (const result of page.results) {
        const candidate = await normalizeCandidate(result, transport);
        if (!candidate) continue;
        const existing = candidates.get(candidate.docToken) || { ...candidate, searchKinds: new Set() };
        existing.searchKinds.add(kind);
        candidates.set(candidate.docToken, existing);
      }
      if (!page.hasMore) break;
      if (!page.pageToken || seenPageTokens.has(page.pageToken)) throw new Error("飞书文档搜索分页 token 缺失或重复。");
      seenPageTokens.add(page.pageToken);
      pageToken = page.pageToken;
    }
  }

  const documents = [];
  for (const candidate of candidates.values()) {
    const history = await collectHistory(transport, candidate.docToken);
    if (!history.length) throw new NeedsReviewError("候选文档未返回任何可核验的历史版本。");
    const versions = classifyHumanVersions(history, editorId, range);
    if (!versions.length) {
      if (candidate.searchKinds.has("created")) throw new NeedsReviewError("本人创建候选没有可核实的目标周本人历史版本。");
      continue;
    }

    const previousRevisionById = buildPreviousRevisionMap(history);
    let cachedSnapshot = null;
    const includedVersions = [];
    for (const [index, version] of versions.entries()) {
      const previous = previousRevisionById.get(version.revisionId) || null;
      if (!previous && !candidate.searchKinds.has("created")) {
        throw new NeedsReviewError("本人编辑版本缺少可读取的前一版本。");
      }
      const currentSnapshot = await fetchRevision(transport, candidate.docToken, version.revisionId);
      const previousSnapshot = previous
        ? cachedSnapshot?.revisionId === previous.revisionId
          ? cachedSnapshot.content
          : await fetchRevision(transport, candidate.docToken, previous.revisionId)
        : null;
      includedVersions.push({
        ...version,
        previousRevisionId: previous?.revisionId ?? null,
        ...(index === versions.length - 1 ? { markdown: currentSnapshot } : {}),
        diff: previousSnapshot === null ? "新建（没有前一版本）" : await unifiedDiff(previousSnapshot, currentSnapshot, previous.revisionId, version.revisionId)
      });
      cachedSnapshot = { revisionId: version.revisionId, content: currentSnapshot };
    }
    if (!includedVersions.length) continue;
    documents.push({
      title: candidate.title,
      url: candidate.url,
      createdCandidate: candidate.searchKinds.has("created"),
      versions: includedVersions,
      latestHumanVersion: includedVersions.at(-1)
    });
  }

  documents.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN") || a.url.localeCompare(b.url));
  return {
    week,
    timezone: TIMEZONE,
    range: {
      start: formatShanghai(range.startEpoch),
      endExclusive: formatShanghai(range.endEpoch)
    },
    generatedAt: options.generatedAt || new Date().toISOString(),
    documents,
    revisionCount: documents.reduce((sum, document) => sum + document.versions.length, 0)
  };
}

export async function writeFeishuDocsWeekly(options = {}) {
  const week = normalizeWeek(options.week || defaultWeeklyReviewWeek());
  const outputRoot = options.outputRoot || path.join(repoRoot, "03_input/weekly", week);
  const outputPath = path.join(outputRoot, "feishu-docs.md");
  const stale = await fileExists(outputPath);
  const priorSource = options.activate === true
    ? (await readWeeklySourceStatus(outputRoot, week)).sources["feishu-docs"]
    : null;
  await updateWeeklySourceStatus({
    weekRoot: outputRoot, week, source: "feishu-docs", status: "needs_review", file: "feishu-docs.md",
    count: 0, summary: options.activate ? "采集进行中，暂不允许 Process 使用" : "影子采集进行中，等待人工核对",
    preservedStaleFile: stale
  });

  try {
    if (options.activate === true && (priorSource?.status !== "needs_review" || !priorSource.summary.startsWith(SHADOW_SUMMARY_PREFIX))) {
      throw new NeedsReviewError("启用前必须先完成同一目标周的影子采集和人工核对。");
    }
    const payload = await collectFeishuDocsWeekly({ ...options, week });
    if (payload.documents.length) await writeAtomic(outputPath, renderFeishuDocsMarkdown(payload));
    const shadow = options.activate !== true;
    const status = shadow ? "needs_review" : payload.documents.length ? "ready" : "empty";
    const summary = shadow
      ? `${SHADOW_SUMMARY_PREFIX}${payload.documents.length} 篇文档、${payload.revisionCount} 个本人版本，等待人工核对`
      : payload.documents.length
        ? `本人创建或编辑 ${payload.documents.length} 篇文档，含 ${payload.revisionCount} 个可核实版本`
        : "本周本人创建或编辑的 Docx/Wiki 文档为 0 篇，文件未生成";
    await updateWeeklySourceStatus({
      weekRoot: outputRoot, week, source: "feishu-docs", status, file: "feishu-docs.md",
      count: payload.documents.length, summary,
      preservedStaleFile: payload.documents.length === 0 && stale
    });
    return { payload, outputPath: payload.documents.length ? outputPath : null, status };
  } catch (error) {
    const status = error instanceof NeedsReviewError ? "needs_review" : "failed";
    await updateWeeklySourceStatus({
      weekRoot: outputRoot, week, source: "feishu-docs", status, file: "feishu-docs.md",
      count: 0, summary: `${status === "needs_review" ? "需人工核对" : "采集失败"}：${error.message}`,
      preservedStaleFile: stale
    });
    throw error;
  }
}

export function createLarkTransport() {
  return {
    async currentUserId() {
      const data = await runLarkJson(["auth", "status", "--json", "--verify"], { requireUserIdentity: false });
      const userId = String(data?.identities?.user?.openId || "").trim();
      if (data?.verified !== true || !userId) throw new NeedsReviewError("无法核验当前 lark-cli 用户 open_id 或登录态。");
      return userId;
    },
    async searchPage({ kind, range, pageToken, pageSize }) {
      const args = ["drive", "+search", "--query", "", "--doc-types", "docx,wiki", "--page-size", String(pageSize)];
      if (kind === "created") args.push("--created-by-me", "--created-since", formatShanghaiIso(range.startEpoch), "--created-until", formatShanghaiIso(range.endEpoch));
      else args.push("--edited-since", formatShanghaiIso(range.startEpoch), "--edited-until", formatShanghaiIso(range.endEpoch));
      if (pageToken) args.push("--page-token", pageToken);
      args.push("--as", "user", "--format", "json");
      const data = await runLarkJson(args);
      return { results: data.results, hasMore: data.has_more, pageToken: data.page_token };
    },
    async resolveWiki(url) {
      return runLarkJson(["wiki", "+node-get", "--node-token", url, "--as", "user", "--format", "json"]);
    },
    async listHistoryPage({ docToken, pageToken, pageSize }) {
      const args = ["docs", "+history-list", "--doc", docToken, "--page-size", String(pageSize)];
      if (pageToken) args.push("--page-token", pageToken);
      args.push("--as", "user", "--format", "json");
      const data = await runLarkJson(args);
      return { entries: data.entries, hasMore: data.has_more, pageToken: data.page_token };
    },
    async fetchRevision({ docToken, revisionId }) {
      const data = await runLarkJson(["docs", "+fetch", "--doc", docToken, "--doc-format", "markdown", "--revision-id", String(revisionId), "--as", "user", "--format", "json"]);
      return data.document;
    }
  };
}

function validateSearchPage(page) {
  if (!page || !Array.isArray(page.results) || typeof page.hasMore !== "boolean") throw new Error("飞书文档搜索返回了不完整的分页结构。");
}

async function normalizeCandidate(result, transport) {
  if (!result || typeof result !== "object") throw new Error("飞书文档搜索结果格式非法。");
  const rawType = result.doc_type ?? result.type ?? result.result_meta?.doc_types?.[0];
  const type = String(rawType || "").toLowerCase();
  if (!["docx", "wiki"].includes(type)) throw new Error(`搜索返回了不支持的文档类型：${rawType || "缺失"}`);
  const url = normalizeDocumentUrl(result.url || result.url_info?.url || result.doc_url || result.wiki_url || "");
  let title = stripSearchHighlight(String(result.title || result.name || "")).replace(/[\r\n]+/g, " ").trim();

  let docToken = String(result.doc_token || result.obj_token || result.token || tokenFromUrl(url, "docx") || "");
  if (type === "wiki") {
    const response = await transport.resolveWiki(url);
    const node = response?.node || response;
    if (node?.obj_type !== "docx") return null;
    docToken = String(node.obj_token || "");
    title ||= stripSearchHighlight(String(node.title || node.title_text || "")).replace(/[\r\n]+/g, " ").trim();
  }
  if (!docToken) throw new Error("无法解析 Docx 的底层文档 token。");
  if (!title) throw new Error("飞书文档搜索或 Wiki 节点缺少标题。");
  return { docToken, url, title: title || String(result.title || "").trim() };
}

async function collectHistory(transport, docToken) {
  const entries = [];
  const seenPageTokens = new Set();
  let pageToken = "";
  while (true) {
    const page = await transport.listHistoryPage({ docToken, pageToken, pageSize: PAGE_SIZE });
    if (!page || !Array.isArray(page.entries) || typeof page.hasMore !== "boolean") throw new Error("文档历史分页结构不完整。");
    entries.push(...page.entries);
    if (!page.hasMore) break;
    if (!page.pageToken || seenPageTokens.has(page.pageToken)) throw new Error("文档历史分页 token 缺失或重复。");
    seenPageTokens.add(page.pageToken);
    pageToken = page.pageToken;
  }

  const byHistoryVersion = new Map();
  for (const item of entries) {
    const entry = normalizeHistoryEntry(item);
    const existing = byHistoryVersion.get(entry.historyVersionId);
    if (existing && stableHistoryKey(existing) !== stableHistoryKey(entry)) throw new NeedsReviewError("同一 history_version_id 返回了冲突的 revision、时间或编辑者。");
    byHistoryVersion.set(entry.historyVersionId, entry);
  }
  return [...byHistoryVersion.values()].sort(compareHistory);
}

function normalizeHistoryEntry(item) {
  const revisionId = Number(item?.revision_id);
  const historyVersionId = String(item?.history_version_id ?? "");
  const editTime = parseEpochSeconds(item?.edit_time);
  const editorIds = Array.isArray(item?.editor_ids) ? item.editor_ids.map((value) => {
    if (!["string", "number"].includes(typeof value)) throw new NeedsReviewError("文档历史 editor_ids 格式不可核验。");
    return String(value).trim();
  }) : [];
  if (!Number.isInteger(revisionId) || revisionId < 0 || !historyVersionId || !Number.isFinite(editTime)) {
    throw new NeedsReviewError("文档历史缺少可核验的 revision_id、history_version_id 或 edit_time。");
  }
  return { revisionId, historyVersionId, editTime, editorIds };
}

function classifyHumanVersions(history, editorId, range) {
  for (const entry of history) {
    if (inRange(entry.editTime, range) && (entry.editorIds.length !== 1 || !entry.editorIds[0])) {
      throw new NeedsReviewError(`history_version_id=${entry.historyVersionId} 的目标周编辑者归属缺失或不唯一。`);
    }
  }
  const byRevision = new Map();
  for (const entry of history) {
    if (!byRevision.has(entry.revisionId)) byRevision.set(entry.revisionId, []);
    byRevision.get(entry.revisionId).push(entry);
  }

  const versions = [];
  for (const [revisionId, entries] of byRevision) {
    const hasHuman = entries.some((entry) => entry.editorIds.includes(editorId));
    if (!hasHuman) continue;
    const actors = new Set(entries.flatMap((entry) => entry.editorIds));
    if (actors.size !== 1 || actors.has("") || [...entries].some((entry) => entry.editorIds.length !== 1)) {
      throw new NeedsReviewError(`revision_id=${revisionId} 的编辑者归属不唯一。`);
    }
    const humanEntries = entries.filter((entry) => entry.editorIds[0] === editorId && inRange(entry.editTime, range));
    if (!humanEntries.length) continue;
    versions.push({
      revisionId,
      editTime: Math.max(...humanEntries.map((entry) => entry.editTime)),
      historyVersionIds: humanEntries.map((entry) => entry.historyVersionId)
    });
  }

  return versions.sort(compareHistory);
}

function buildPreviousRevisionMap(history) {
  const latestByRevision = new Map();
  for (const entry of history) {
    const previous = latestByRevision.get(entry.revisionId);
    if (!previous || compareHistory(entry, previous) > 0) latestByRevision.set(entry.revisionId, entry);
  }
  const revisions = [...latestByRevision.values()].sort(compareHistory);
  return new Map(revisions.map((entry, index) => [entry.revisionId, revisions[index - 1] || null]));
}

async function fetchRevision(transport, docToken, revisionId) {
  const response = await transport.fetchRevision({ docToken, revisionId });
  if (!response || Number(response.revision_id) !== revisionId || typeof response.content !== "string") {
    throw new NeedsReviewError(`revision_id=${revisionId} 的历史正文缺失或回读版本不匹配。`);
  }
  return response.content.replace(/\r\n/g, "\n");
}

async function unifiedDiff(previous, current, previousRevisionId, revisionId) {
  if (previous === current) return "（Markdown 内容无差异；revision_id 已变化）";
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-diff-"));
  const oldPath = path.join(tempDir, "previous.md");
  const newPath = path.join(tempDir, "current.md");
  try {
    await writeFile(oldPath, previous, "utf8");
    await writeFile(newPath, current, "utf8");
    let output = "";
    try {
      const result = await execFileAsync("diff", ["-u", oldPath, newPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      output = result.stdout;
    } catch (error) {
      if (error.code !== 1) throw error;
      output = String(error.stdout || "");
    }
    const lines = output.split("\n");
    if (lines.length >= 2) {
      lines[0] = `--- revision ${previousRevisionId}`;
      lines[1] = `+++ revision ${revisionId}`;
    }
    return lines.join("\n").trimEnd();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function renderFeishuDocsMarkdown(payload) {
  const lines = [
    `# 本人飞书文档｜${payload.week}`,
    "",
    `- 采集范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 文档数：${payload.documents.length}`,
    `- 本人版本数：${payload.revisionCount}`,
    "- 归因规则：仅按飞书历史记录的 editor ID 与已核实的本人 ID 精确匹配；手动粘贴 AI 内容仍按账号归因。",
    "- 历史限制：仅汇总接口实际返回且可核对的版本；不声称覆盖所有编辑事件。",
    ""
  ];
  for (const [index, document] of payload.documents.entries()) {
    if (index) lines.push("---", "");
    lines.push(
      `## ${escapeMarkdownHeading(document.title)}`,
      "",
      `- 来源文档：[打开飞书文档](<${normalizeDocumentUrl(document.url)}>)`,
      `- 本周本人版本：${document.versions.length}`,
      "",
      "### 最新本人版本全文",
      "",
      document.latestHumanVersion.markdown,
      "",
      "### 本周本人版本差异",
      ""
    );
    for (const version of document.versions) {
      lines.push(`#### ${formatShanghai(version.editTime)}｜revision_id=${version.revisionId}`, "", fencedDiff(version.diff), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function fencedDiff(value) {
  const longestRun = Math.max(0, ...[...String(value).matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}diff\n${value}\n${fence}`;
}

async function writeAtomic(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function runLarkJson(args, { requireUserIdentity = true } = {}) {
  const { stdout } = await execFileAsync("lark-cli", args, {
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (result?.ok === false) throw new Error("lark-cli returned ok=false。");
  if (requireUserIdentity && result?.identity && result.identity !== "user") throw new NeedsReviewError(`lark-cli 读取身份不是 user（${result.identity}）。`);
  return result?.data || result;
}

function tokenFromUrl(value, type) {
  try { return new URL(value).pathname.match(new RegExp(`/${type}/([^/]+)`))?.[1] || ""; }
  catch { return ""; }
}

function normalizeDocumentUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsupported URL");
    return url.href;
  } catch {
    throw new NeedsReviewError("飞书文档搜索结果缺少有效的 HTTPS 文档 URL。");
  }
}

function escapeMarkdownHeading(value) {
  return String(value).replace(/[\\`*_{}\[\]<>]/g, "\\$&");
}

function stripSearchHighlight(value) { return value.replace(/<\/?hb?>/gi, ""); }
function parseEpochSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  return number >= 1e12 ? Math.floor(number / 1000) : Math.floor(number);
}
function inRange(epochSeconds, range) { return epochSeconds >= range.startEpoch && epochSeconds < range.endEpoch; }
function compareHistory(a, b) { return a.editTime - b.editTime || a.revisionId - b.revisionId; }
function stableHistoryKey(entry) { return `${entry.revisionId}|${entry.editTime}|${[...entry.editorIds].sort().join(",")}`; }
function formatShanghai(epochSeconds) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epochSeconds * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+08:00`;
}
function formatShanghaiIso(epochSeconds) { return formatShanghai(epochSeconds); }

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--activate") options.activate = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeFeishuDocsWeekly(parseArgs(process.argv.slice(2)));
  console.log(`Feishu docs weekly input: ${result.outputPath ? path.relative(repoRoot, result.outputPath) : "0 篇文档，文件未生成"}`);
  console.log(`Documents: ${result.payload.documents.length}; revisions: ${result.payload.revisionCount}; status: ${result.status}`);
}

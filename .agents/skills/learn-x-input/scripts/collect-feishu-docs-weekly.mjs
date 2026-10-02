import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
// Core V1 拥有的飞书文档（人生复利工作台）不进入 Learn-X 周输入采集：
// 它们的状态由 Core 仓库确认后再经 input:core 导入，直接采集会形成未确认状态旁路。
// 2026-10-02：排除「2026｜总览」；M5 创建「2026｜周报」后把其 wiki token 加入此处。
const EXCLUDED_WIKI_TOKENS = new Set([
  "QIaQwXf07iMvqokKQf3cp3XmnMC", // 2026｜总览
  "DN4EwZBN5i9pGukdzIgcSzdCn2d", // 2026｜周报
]);
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
  const range = isoWeekRangeShanghai(week);
  if (currentShanghaiIsoWeek(new Date(range.startEpoch * 1000)) !== week) throw new Error(`无效 ISO 周：${week}`);
  const transport = options.transport || createLarkTransport();
  if (typeof transport.currentUserIdentity !== "function") {
    throw new NeedsReviewError("飞书采集传输缺少当前用户身份核验能力。");
  }
  const identity = await transport.currentUserIdentity();
  const openId = String(identity?.openId || "").trim();
  if (!openId) throw new NeedsReviewError("无法核验当前 lark-cli 用户 open_id 或登录态。");
  const botOpenId = String(identity?.botOpenId || "").trim();
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

  const collected = [];
  for (const candidate of candidates.values()) {
    const history = await collectHistory(transport, candidate.docToken);
    if (!history.length) throw new NeedsReviewError("候选文档未返回任何可核验的历史版本。");
    collected.push({ candidate, history });
  }
  const humanEditorId = deriveEditorUid(collected, openId, "本人", true);
  const botEditorId = deriveEditorUid(collected, botOpenId, "bot", false);

  const documents = [];
  for (const { candidate, history } of collected) {
    const versions = classifyHumanVersions(history, humanEditorId, range);
    if (!versions.length) {
      if (candidate.searchKinds.has("created")) throw new NeedsReviewError("本人创建候选没有可核实的目标周本人历史版本。");
      continue;
    }

    const previousRevisionById = buildPreviousRevisionMap(history);
    let cachedSnapshot = null;
    const includedVersions = [];
    for (const version of versions) {
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
      const currentText = normalizeFeishuContent(currentSnapshot);
      const previousText = previousSnapshot === null ? "" : normalizeFeishuContent(previousSnapshot);
      const unchanged = previousSnapshot !== null && currentSnapshot === previousSnapshot;
      const formatOnly = previousSnapshot !== null && currentSnapshot !== previousSnapshot && currentText === previousText;
      const diff = previousSnapshot === null
        ? await unifiedDiff("", currentText, null, version.revisionId)
        : formatOnly || unchanged
          ? ""
          : await unifiedDiff(previousText, currentText, previous.revisionId, version.revisionId);
      const change = measureDiffChange(diff);
      const versionMetadata = { ...version };
      delete versionMetadata.historyVersionIds;
      includedVersions.push({
        ...versionMetadata,
        previousRevisionId: previous?.revisionId ?? null,
        diff,
        changeChars: change.total,
        addedChars: change.added,
        removedChars: change.removed,
        formatOnly,
        unchanged
      });
      cachedSnapshot = { revisionId: version.revisionId, content: currentSnapshot };
    }
    if (!includedVersions.length) continue;
    const others = countOtherVersions(history, humanEditorId, botEditorId, range);
    documents.push({
      title: candidate.title,
      url: candidate.url,
      createdCandidate: candidate.searchKinds.has("created"),
      versions: includedVersions,
      aiVersions: others.bot,
      otherVersions: others.other,
      latestHumanVersion: (() => {
        const latest = includedVersions.at(-1);
        return { revisionId: latest.revisionId, editTime: latest.editTime, previousRevisionId: latest.previousRevisionId };
      })(),
      changeChars: includedVersions.reduce((sum, version) => sum + version.changeChars, 0),
      addedChars: includedVersions.reduce((sum, version) => sum + version.addedChars, 0),
      removedChars: includedVersions.reduce((sum, version) => sum + version.removedChars, 0),
      formatOnly: includedVersions.every((version) => version.formatOnly || version.unchanged)
    });
  }

  documents.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN") || a.url.localeCompare(b.url));
  documents.forEach((document, index) => { document.documentKey = `doc-${String(index + 1).padStart(2, "0")}`; });
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
    if (options.prepareReview === true) {
      const activationEligible = options.activate === true
        && priorSource?.status === "needs_review"
        && String(priorSource?.summary || "").startsWith(SHADOW_SUMMARY_PREFIX);
      if (options.activate === true && !activationEligible) {
        throw new NeedsReviewError("启用前必须先完成同一目标周的影子采集和人工核对。");
      }
      payload.activationRequested = options.activate === true;
      payload.activationEligible = activationEligible;
      const reviewDir = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-review-"));
      const reviewPayloadPath = path.join(reviewDir, `${week}.json`);
      await writeAtomic(reviewPayloadPath, `${JSON.stringify(payload, null, 2)}\n`);
      await updateWeeklySourceStatus({
        weekRoot: outputRoot, week, source: "feishu-docs", status: "needs_review", file: "feishu-docs.md",
        count: payload.documents.length,
        summary: `${SHADOW_SUMMARY_PREFIX}${payload.documents.length} 篇文档、${payload.revisionCount} 个本人版本；等待概览/压缩和人工核对`,
        preservedStaleFile: stale
      });
      return { payload, outputPath: null, reviewPayloadPath, status: "needs_review" };
    }
    const review = options.review || createDefaultReview(payload);
    const markdown = renderFeishuDocsMarkdown(payload, review);
    if (payload.documents.length) await writeAtomic(outputPath, markdown);
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

export async function finalizeFeishuDocsWeeklyReview({ week, payloadPath, summaryPath, outputRoot, activate = false } = {}) {
  const normalizedWeek = normalizeWeek(week);
  const targetRoot = outputRoot || path.join(repoRoot, "03_input/weekly", normalizedWeek);
  assertReviewTemporaryFiles(payloadPath, summaryPath);
  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  const review = JSON.parse(await readFile(summaryPath, "utf8"));
  if (payload.week !== normalizedWeek || review.week !== normalizedWeek) {
    throw new NeedsReviewError("原始变更包或概览摘要的目标周与本次目标周不一致。");
  }
  if (activate && (payload.activationRequested !== true || payload.activationEligible !== true)) {
    throw new NeedsReviewError("本次影子变更包不具备 --activate 的同周人工核对前置条件。");
  }
  if (activate) {
    const current = (await readWeeklySourceStatus(targetRoot, normalizedWeek)).sources["feishu-docs"];
    if (current?.status !== "needs_review" || !String(current?.summary || "").startsWith(SHADOW_SUMMARY_PREFIX)) {
      throw new NeedsReviewError("最终化前发现同周影子状态已变化，停止启用。");
    }
  }
  validateReviewSummaries(payload, review);
  const markdown = renderFeishuDocsMarkdown(payload, review);
  const outputPath = path.join(targetRoot, "feishu-docs.md");
  if (payload.documents.length) await writeAtomic(outputPath, markdown);
  const status = activate ? payload.documents.length ? "ready" : "empty" : "needs_review";
  const summary = activate
    ? payload.documents.length ? `本人创建或编辑 ${payload.documents.length} 篇文档，含 ${payload.revisionCount} 个可核实版本` : "本周本人创建或编辑的 Docx/Wiki 文档为 0 篇，文件未生成"
    : `${SHADOW_SUMMARY_PREFIX}${payload.documents.length} 篇文档、${payload.revisionCount} 个本人版本，含总览和压缩后的本周变更，等待人工核对`;
  await updateWeeklySourceStatus({
    weekRoot: targetRoot, week: normalizedWeek, source: "feishu-docs", status, file: "feishu-docs.md",
    count: payload.documents.length, summary, preservedStaleFile: payload.documents.length === 0
  });
  return { payload, outputPath: payload.documents.length ? outputPath : null, status };
}

export async function cleanupFeishuDocsReviewPayload(payloadPath) {
  assertReviewTemporaryFiles(payloadPath);
  await rm(path.dirname(path.resolve(payloadPath)), { recursive: true, force: true });
}

function assertReviewTemporaryFiles(payloadPath, summaryPath = null) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const payload = path.resolve(String(payloadPath || ""));
  const reviewDir = path.dirname(payload);
  const relativeDir = path.relative(temporaryRoot, reviewDir);
  if (!path.basename(payload).endsWith(".json") || !relativeDir.startsWith("learn-x-feishu-review-") || relativeDir.includes(path.sep)) {
    throw new Error("只允许读取 learn-x-feishu-review-* 临时目录中的 JSON 载荷。");
  }
  if (summaryPath) {
    const summary = path.resolve(String(summaryPath));
    if (path.dirname(summary) !== reviewDir || !path.basename(summary).endsWith(".summary.json")) {
      throw new Error("概览摘要必须与变更载荷保存在同一个临时审核目录中。");
    }
  }
}

export function createLarkTransport() {
  return {
    async currentUserIdentity() {
      const data = await runLarkJson(["auth", "status", "--json", "--verify"], { requireUserIdentity: false });
      const openId = String(data?.identities?.user?.openId || "").trim();
      if (data?.verified !== true || !openId) throw new NeedsReviewError("无法核验当前 lark-cli 用户 open_id 或登录态。");
      return { openId, botOpenId: String(data?.identities?.bot?.openId || "").trim() };
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
  const metaDocTypes = result.result_meta?.doc_types;
  const rawType = result.entity_type ?? result.doc_type ?? result.type
    ?? (Array.isArray(metaDocTypes) ? metaDocTypes[0] : metaDocTypes);
  const type = String(rawType || "").toLowerCase() === "doc" ? "docx" : String(rawType || "").toLowerCase();
  if (!["docx", "wiki"].includes(type)) throw new Error(`搜索返回了不支持的文档类型：${rawType || "缺失"}`);
  const url = normalizeDocumentUrl(result.url || result.url_info?.url || result.doc_url || result.wiki_url || result.result_meta?.url || "");
  const wikiToken = tokenFromUrl(url, "wiki");
  if (wikiToken && EXCLUDED_WIKI_TOKENS.has(wikiToken)) return null;
  let title = stripSearchHighlight(String(result.title || result.name || result.title_highlighted || "")).replace(/[\r\n]+/g, " ").trim();

  let docToken = String(result.doc_token || result.obj_token || result.token || result.result_meta?.token || tokenFromUrl(url, "docx") || "");
  if (type === "wiki") {
    const response = await transport.resolveWiki(url);
    const node = response?.node || response;
    if (node?.obj_type !== "docx") return null;
    docToken = String(node.obj_token || "");
    title ||= stripSearchHighlight(String(node.title || node.title_text || "")).replace(/[\r\n]+/g, " ").trim();
  }
  if (!docToken) throw new Error("无法解析 Docx 的底层文档 token。");
  if (!title) throw new Error("飞书文档搜索或 Wiki 节点缺少标题。");
  const editorOpenId = String(result.result_meta?.edit_user_id || result.edit_user_id || "").trim();
  return { docToken, url, title: title || String(result.title || "").trim(), editorOpenId };
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

// 同一 revision_id 对应多个 history_version_id 是飞书历史接口的正常返回（同人短时间多次保存），
// 不作为失败条件：版本归因按 revision 快照与唯一编辑者判定（classifyHumanVersions）。
function deriveEditorUid(collected, openId, label, required) {
  if (!collected.length || !openId) return null;
  for (const { candidate, history } of collected) {
    if (candidate.editorOpenId === openId) {
      const uid = singleEditor(history.at(-1));
      if (uid) return uid;
    }
    if (candidate.searchKinds.has("created")) {
      const uid = singleEditor(history[0]);
      if (uid) return uid;
    }
  }
  if (!required) return null;
  throw new NeedsReviewError(`无法从本周候选自动互证${label} editor ID：没有由该账号最后编辑或创建的候选文档，或其对应历史编辑者不唯一。`);
}

function singleEditor(entry) {
  return entry && entry.editorIds.length === 1 && entry.editorIds[0] ? entry.editorIds[0] : null;
}

function countOtherVersions(history, humanEditorId, botEditorId, range) {
  const byRevision = new Map();
  for (const entry of history) {
    if (!inRange(entry.editTime, range)) continue;
    if (!byRevision.has(entry.revisionId)) byRevision.set(entry.revisionId, []);
    byRevision.get(entry.revisionId).push(entry);
  }
  let bot = 0;
  let other = 0;
  for (const entries of byRevision.values()) {
    const actors = new Set(entries.flatMap((entry) => entry.editorIds));
    if (actors.size !== 1) continue;
    const actor = [...actors][0];
    if (!actor || actor === humanEditorId) continue;
    if (actor === botEditorId) bot += 1;
    else other += 1;
  }
  return { bot, other };
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
      const result = await execFileAsync("diff", ["-u", "-U0", oldPath, newPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      output = result.stdout;
    } catch (error) {
      if (error.code !== 1) throw error;
      output = String(error.stdout || "");
    }
    const lines = output.split("\n");
    if (lines.length >= 2) {
      lines[0] = `--- revision ${previousRevisionId ?? "baseline (new document)"}`;
      lines[1] = `+++ revision ${revisionId}`;
    }
    return lines.join("\n").trimEnd();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function normalizeFeishuContent(source) {
  let text = String(source || "").replace(/\r\n?/g, "\n");
  text = text.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "");
  text = text.replace(/<img\b([^>]*)\/?\s*>/gi, (_, attributes) => {
    const alt = attributes.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
    const source = attributes.match(/\bsrc=["']([^"']*)["']/i)?.[1] || "";
    const reference = source ? `（资源 ${source}）` : "";
    return `\n[图片：${alt || "无说明"}${reference}]\n`;
  });
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_, attributes, label) => {
    const href = attributes.match(/\bhref=["']([^"']*)["']/i)?.[1] || "";
    const cleanLabel = label.replace(/<[^>]*>/g, "");
    return href ? `${cleanLabel || "链接"}（${href}）` : cleanLabel;
  });
  text = text.replace(/<br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(?:td|th)\s*>/gi, "\t")
    .replace(/<\/(?:tr|li|p|div|h[1-6]|blockquote|column)\s*>/gi, "\n")
    .replace(/<\/(?:table|thead|tbody|tfoot|ul|ol|grid)\s*>/gi, "\n");

  const formattingTags = new Set([
    "p", "div", "span", "b", "strong", "i", "em", "u", "s", "strike", "font",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "grid", "column"
  ]);
  text = text.replace(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi, (tag, name, attributes) => {
    const normalizedName = name.toLowerCase();
    if (formattingTags.has(normalizedName)) {
      if (normalizedName === "li" && !tag.startsWith("</")) return "• ";
      if (normalizedName === "column" && tag.startsWith("</")) return "\t";
      return "";
    }
    return tag;
  });
  text = decodeCommonHtmlEntities(text);

  const normalizedLines = [];
  let inCode = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      normalizedLines.push(line);
      continue;
    }
    let normalized = line.trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "• ")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/_([^_\n]+)_/g, "$1")
      .replace(/[\t ]+/g, " ");
    if (!normalized && normalizedLines.at(-1) === "") continue;
    normalizedLines.push(normalized);
  }
  return normalizedLines.join("\n").trim();
}

function decodeCommonHtmlEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x[\da-f]+|#\d+);/gi, (entity) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " " };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const codepoint = entity[2]?.toLowerCase() === "x"
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(codepoint) && codepoint > 0 && codepoint <= 0x10ffff
      ? String.fromCodePoint(codepoint)
      : entity;
  });
}

function measureDiffChange(diff) {
  let added = 0;
  let removed = 0;
  for (const line of String(diff || "").split("\n").slice(2)) {
    if (line.startsWith("+")) added += [...line.slice(1)].length;
    else if (line.startsWith("-")) removed += [...line.slice(1)].length;
  }
  return { added, removed, total: added + removed };
}

function createDefaultReview(payload) {
  const formatOnlyCount = payload.documents.filter((document) => document.formatOnly).length;
  const oversized = payload.documents.filter((document) => document.changeChars > 3000);
  if (oversized.length) {
    throw new NeedsReviewError(`有 ${oversized.length} 篇文档的本周语义变更超过 3,000 字，必须先由 Codex 压缩后才能生成落盘报告。`);
  }
  return {
    week: payload.week,
    overview: [
      `本周共核验 ${payload.documents.length} 篇文档、${payload.revisionCount} 个本人版本。`,
      `${payload.documents.length - formatOnlyCount} 篇有正文变更，${formatOnlyCount} 篇只有格式变化或正文无变化。`,
      "报告只保留规范化后的本周变更，不保存任何文档全文。"
    ],
    documents: {}
  };
}

function validateReviewSummaries(payload, review) {
  if (!Array.isArray(review.overview) || review.overview.length < 1 || review.overview.length > 6) {
    throw new NeedsReviewError("总览必须包含 1–6 条简洁说明。 ");
  }
  if (review.overview.some((item) => typeof item !== "string" || !item.trim() || [...item].length > 300)) {
    throw new NeedsReviewError("总览条目必须是非空、每条不超过 300 字的 Markdown 文本。 ");
  }
  const summaries = review.documents && typeof review.documents === "object" ? review.documents : {};
  for (const document of payload.documents) {
    if (document.changeChars <= 3000 || document.formatOnly) continue;
    const summary = summaries[document.documentKey]?.summary;
    if (typeof summary !== "string" || !summary.trim() || [...summary].length > 1500) {
      throw new NeedsReviewError(`${document.documentKey}「${document.title}」超过 3,000 字，必须提供不超过 1,500 字的核心变更摘要。`);
    }
    const evidence = summaries[document.documentKey]?.evidence || [];
    if (!Array.isArray(evidence) || evidence.length > 3) {
      throw new NeedsReviewError(`${document.documentKey} 的变更证据最多保留 3 条。`);
    }
    const sourceChanges = document.versions.map((version) => version.diff).join("\n");
    for (const quote of evidence) {
      if (typeof quote !== "string" || !quote.trim() || [...quote].length > 120 || !sourceChanges.includes(quote)) {
        throw new NeedsReviewError(`${document.documentKey} 的证据必须是变更差异中的原句，且每条不超过 120 字。`);
      }
    }
  }
}

export function renderFeishuDocsMarkdown(payload, review = createDefaultReview(payload)) {
  validateReviewSummaries(payload, review);
  const formatOnlyCount = payload.documents.filter((document) => document.formatOnly).length;
  const compressedCount = payload.documents.filter((document) => document.changeChars > 3000).length;
  const lines = [
    `# 本人飞书文档｜${payload.week}`,
    "",
    "## 概览",
    "",
    ...review.overview.map((item) => `- ${escapeMarkdownInline(item)}`),
    `- 规模：${payload.documents.length} 篇文档、${payload.revisionCount} 个本人版本；正文变更 ${payload.documents.length - formatOnlyCount} 篇、仅格式/无正文变化 ${formatOnlyCount} 篇、已压缩 ${compressedCount} 篇。`,
    "- 审阅方式：正文变更不超过 3,000 字时保留精准差异；超过时只保留核心摘要和少量原句证据。每篇均可通过来源链接回到飞书原文。",
    "- 存储范围：不保存文档全文；只保存目标周本人版本信息、规范化后的变更或压缩摘要。",
    "",
    `- 采集范围：${payload.range.start} 至 ${payload.range.endExclusive}（不含结束时刻）`,
    `- 时区：${payload.timezone}`,
    `- 生成时间：${payload.generatedAt}`,
    `- 文档数：${payload.documents.length}`,
    `- 本人版本数：${payload.revisionCount}`,
    `- AI 代笔版本数：${payload.documents.reduce((sum, document) => sum + (document.aiVersions || 0), 0)}`,
    "- 归因规则：本人 editor ID 由当前登录账号与飞书历史记录每轮自动互证；AI 写入者使用 bot 身份，其版本按 bot editor ID 计数标注。手动粘贴 AI 内容仍按账号归因。",
    "- 历史限制：仅汇总接口实际返回且可核对的版本；不声称覆盖所有编辑事件。",
    ""
  ];
  for (const [index, document] of payload.documents.entries()) {
    if (index) lines.push("---", "");
    lines.push(
      `## ${document.documentKey}｜${escapeMarkdownHeading(document.title)}`,
      "",
      `- 来源文档：[打开飞书文档](<${normalizeDocumentUrl(document.url)}>)`,
      `- 本周本人版本：${document.versions.length}`,
      `- 语义变更：${document.changeChars} 字（新增 ${document.addedChars}，删除 ${document.removedChars}）`
    );
    if (document.aiVersions || document.otherVersions) {
      lines.push(`- 非本人版本：AI 代笔 ${document.aiVersions} 个、其他编辑者 ${document.otherVersions} 个（只计数，不展开内容）`);
    }
    if (document.formatOnly) {
      lines.push("", "本周记录到版本变化，但正文内容没有变化；属于格式、布局或无正文变化。", "");
      continue;
    }
    if (document.changeChars > 3000) {
      const summary = review.documents[document.documentKey];
      lines.push("", "### 本周核心变更摘要（已压缩）", "", escapeMarkdownInline(summary.summary));
      if (summary.evidence?.length) {
        lines.push("", "变更原句证据：", "", ...summary.evidence.map((quote) => `- “${escapeMarkdownInline(quote)}”`));
      }
      lines.push("", "版本依据：", "", ...document.versions.map((version) => `- ${formatShanghai(version.editTime)}｜revision_id=${version.revisionId}｜前序=${version.previousRevisionId ?? "新建"}`), "");
      continue;
    }
    lines.push("", "### 本周精准差异（去除格式噪声）", "");
    for (const version of document.versions) {
      lines.push(`#### ${formatShanghai(version.editTime)}｜revision_id=${version.revisionId}`, "", version.diff ? fencedDiff(version.diff) : "（正文无语义变化）", "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function fencedDiff(value) {
  const longestRun = Math.max(0, ...[...String(value).matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}diff\n${value}\n${fence}`;
}

function escapeMarkdownInline(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>]/g, "\\$&");
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

let larkBin;
function resolveLarkCli() {
  if (larkBin) return larkBin;
  const inPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
    .some((dir) => existsSync(path.join(dir, "lark-cli")));
  larkBin = inPath ? "lark-cli"
    : ["/opt/homebrew/bin/lark-cli", path.join(os.homedir(), ".lark-channel/bin/lark-cli")].find(existsSync) || "lark-cli";
  return larkBin;
}

async function runLarkJson(args, { requireUserIdentity = true } = {}) {
  const { stdout } = await execFileAsync(resolveLarkCli(), args, {
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
  if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN;
  }
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
    else if (argv[index] === "--prepare-review") options.prepareReview = true;
    else if (argv[index] === "--finalize-review") options.finalizeReview = true;
    else if (argv[index] === "--cleanup-review") options.cleanupReview = true;
    else if (argv[index] === "--review-payload") options.reviewPayloadPath = argv[++index];
    else if (argv[index] === "--review-summary") options.reviewSummaryPath = argv[++index];
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.cleanupReview) {
    await cleanupFeishuDocsReviewPayload(options.reviewPayloadPath);
    console.log("Feishu Docs temporary review payload cleaned.");
  } else if (options.finalizeReview) {
    const result = await finalizeFeishuDocsWeeklyReview({
      week: options.week,
      payloadPath: options.reviewPayloadPath,
      summaryPath: options.reviewSummaryPath,
      activate: options.activate === true
    });
    console.log(`Feishu docs weekly input: ${result.outputPath ? path.relative(repoRoot, result.outputPath) : "0 篇文档，文件未生成"}`);
    console.log(`Documents: ${result.payload.documents.length}; revisions: ${result.payload.revisionCount}; status: ${result.status}`);
  } else {
    const result = await writeFeishuDocsWeekly(options);
    console.log(`Feishu docs weekly input: ${result.outputPath ? path.relative(repoRoot, result.outputPath) : result.reviewPayloadPath || "0 篇文档，文件未生成"}`);
    if (result.reviewPayloadPath) console.log(`Review payload: ${result.reviewPayloadPath}`);
    console.log(`Documents: ${result.payload.documents.length}; revisions: ${result.payload.revisionCount}; status: ${result.status}`);
  }
}

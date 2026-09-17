#!/usr/bin/env node
// 每周确定性同步《人生核心议题》飞书正文到本地私有镜像 01_core/道/人生核心议题.md。
// 这是「道」目录的两个自动写入口之一（另一个是 Flomo 置顶镜像）；其他思想内容禁止自动改写。
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
export const SOURCE_URL = "https://ywhome.feishu.cn/wiki/QIaQwXf07iMvqokKQf3cp3XmnMC";
const MIRROR_RELATIVE = "01_core/道/人生核心议题.md";
const REQUIRED_H1 = ["长期核心议题", "中期核心议题", "短期核心议题"];
// 防御性截断：即使线上附录已删除，也永远以首个 `# 附录` 一级标题为边界，附录内容不得进入本地镜像。
const APPENDIX_RE = /^#\s*附录/m;
// 防御性检查：未展开的内嵌 Sheet / Base / 画板 / 附件块不得进入本地镜像。
const RESOURCE_RE = /<\s*(sheet|bitable|whiteboard|file|cite)\b/i;

export function normalizeBody(markdown) {
  return String(markdown || "").replace(/[\s`*_>#\-~]+/g, "");
}
export function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
export function parseMirror(raw) {
  const text = String(raw || "");
  const match = text.match(/^<!--\n([^]*?)-->\n?/);
  const header = {};
  if (match) for (const line of match[1].split("\n")) { const pair = line.match(/^([\w-]+):\s*(.*)$/); if (pair) header[pair[1]] = pair[2]; }
  return { header, body: match ? text.slice(match[0].length) : text };
}
// 验证并防御性截断飞书 Markdown；返回 error 表示本轮不能落盘。
export function extractLifeCoreBody(markdown) {
  const value = String(markdown || "").replace(/^<title>[^<]*<\/title>/i, "").trim();
  if (!value) return { error: "empty-document" };
  const appendixMatch = value.match(APPENDIX_RE);
  if (appendixMatch) {
    const lineEnd = value.indexOf("\n", appendixMatch.index);
    return { error: "appendix-present", appendixTitle: value.slice(appendixMatch.index, lineEnd === -1 ? undefined : lineEnd).trim() };
  }
  const body = value.replace(/<!--[^]*?-->/g, "").trim();
  if (RESOURCE_RE.test(body)) return { error: "unexpanded-resource-block" };
  const h1 = [...body.matchAll(/^#\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
  const missing = REQUIRED_H1.filter((heading) => !h1.includes(heading));
  if (missing.length) return { error: `missing-core-headings:${missing.join("/")}` };
  if (body.length < 120) return { error: "body-too-short" };
  return { body: `${body}\n` };
}

export async function syncLifeCore(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const runLark = options.runLark || runLarkMarkdown;
  const now = new Date().toISOString();
  const mirrorPath = path.join(repoRoot, MIRROR_RELATIVE);
  const previous = await readMirror(mirrorPath);
  const attemptHeader = { ...previous.header, source: SOURCE_URL, "last-attempt-at": now, status: "stale" };
  let fetched;
  try {
    fetched = await runLark(SOURCE_URL);
  } catch (error) {
    if (!previous.body) return { status: "failed", reason: `first-sync-failed:${String(error?.message || error)}`, mirror: MIRROR_RELATIVE, wrote: false };
    await writeMirror(mirrorPath, attemptHeader, previous.body);
    return { status: "stale", reason: String(error?.message || error), mirror: MIRROR_RELATIVE, wrote: true, lastValidSyncedAt: previous.header["last-synced-at"] || null };
  }
  const extracted = extractLifeCoreBody(fetched.markdown);
  if (extracted.error) {
    if (!previous.body) return { status: "failed", reason: `first-sync-invalid:${extracted.error}`, mirror: MIRROR_RELATIVE, wrote: false };
    await writeMirror(mirrorPath, attemptHeader, previous.body);
    return { status: "stale", reason: extracted.error, mirror: MIRROR_RELATIVE, wrote: true, lastValidSyncedAt: previous.header["last-synced-at"] || null };
  }
  const bodyHash = sha256(normalizeBody(extracted.body));
  const header = { source: SOURCE_URL, revision: String(fetched.revision), "body-sha256": bodyHash, "last-synced-at": now, "last-attempt-at": now, status: "fresh" };
  await writeMirror(mirrorPath, header, extracted.body);
  return { status: "fresh", mirror: MIRROR_RELATIVE, revision: fetched.revision, bodySha256: bodyHash, chars: extracted.body.length, wrote: true };
}

async function readMirror(mirrorPath) {
  try {
    const { header, body } = parseMirror(await readFile(mirrorPath, "utf8"));
    return body.trim() ? { header, body } : { header: {}, body: null };
  } catch (error) {
    if (error.code === "ENOENT") return { header: {}, body: null };
    throw error;
  }
}

async function writeMirror(mirrorPath, header, body) {
  const lines = Object.entries(header).map(([key, value]) => `${key}: ${value}`);
  const content = `<!--\n${lines.join("\n")}\n-->\n${body}`;
  await mkdir(path.dirname(mirrorPath), { recursive: true });
  const temp = `${mirrorPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, mirrorPath);
}

async function runLarkMarkdown(docUrl) {
  const { stdout } = await execFile("lark-cli", ["docs", "+fetch", "--doc", docUrl, "--doc-format", "markdown", "--as", "user", "--format", "json"], {
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    maxBuffer: 16 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (result?.ok !== true) throw new Error(result?.error?.message || "lark-cli returned ok=false");
  const document = result.data?.document;
  if (!document || typeof document.content !== "string" || !Number.isInteger(document.revision_id)) throw new Error("lark-cli response missing document content or revision");
  return { markdown: document.content, revision: document.revision_id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncLifeCore();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "fresh" ? 0 : 2;
}

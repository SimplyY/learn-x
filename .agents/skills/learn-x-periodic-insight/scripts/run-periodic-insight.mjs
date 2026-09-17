import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, open as openFile, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildInsightContext, buildInsightPrompt, buildPromptAssets, findTask, isSubstantive, preflightSnapshotFreshness, readPeriodicConfig } from "./periodic-insight-core.mjs";
import { runBridgeCli } from "../../learn-x-weekly-automation/scripts/generate-ai-review.mjs";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const defaultBridge = path.join(homedir(), ".codex/skills/chatgpt-web-bridge/scripts/bridge.mjs");
const renderer = "/Users/yuwei/.codex/skills/feishu-doc-renderer/scripts/markdown_to_feishu_xml.py";

export async function runPeriodicInsight(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const taskId = options.taskId || "munger-soul";
  const config = await readPeriodicConfig(repoRoot); const task = findTask(config, taskId); const policy = config.contextPolicies[task.contextPolicyId];
  const context = await buildInsightContext({ repoRoot, taskId, target: options.target || "auto", range: options.range || policy.defaultRange, from: options.from, to: options.to, now: options.now || new Date() });
  const outputRoot = path.join(repoRoot, "04_output/_dist/periodic-insights", taskId, context.target?.id || "unresolved");
  await mkdir(outputRoot, { recursive: true });
  const paths = { context: path.join(outputRoot, "context.md"), manifest: path.join(outputRoot, "manifest.json"), generated: path.join(outputRoot, "result.generated.md"), state: path.join(outputRoot, "state.json") };
  const releaseLock = await acquireRunLock(path.join(outputRoot, ".run.lock"));
  if (!releaseLock) { const current = await readJson(paths.state); return current ? { ...current, paths } : { schemaVersion: 1, taskId, status: "needs_review", reason: "run-in-progress", paths }; }
  try {
    if (!context.target) { const preserved = await findPreservableState(repoRoot, taskId, options.target && options.target !== "auto" ? options.target : undefined); if (preserved) return { ...preserved.state, paths: preserved.paths }; await writeFile(paths.context, context.content, "utf8"); await writeJson(paths.manifest, context.manifest); const skipped = { schemaVersion: 1, taskId, status: "skipped", reason: "no-substantive-target", contextSha256: context.sha256, updatedAt: new Date().toISOString() }; await writeJson(paths.state, skipped); return { ...skipped, paths }; }
    const runKey = `${task.id}:${context.target.kind}:${context.target.id}`;
    if (options.force && (!options.send || !options.confirm)) throw new Error("force-requires-send-confirm");
    const previous = await readJson(paths.state);
    if (previous && !new Set(["preview", "submitted", "generated", "archive_pending", "completed", "needs_review", "skipped"]).has(previous.status)) throw new Error("unknown-periodic-insight-state");
    if (["submitted", "needs_review"].includes(previous?.status) && !options.force) return { ...previous, paths };
    await writeFile(paths.context, context.content, "utf8"); await writeJson(paths.manifest, context.manifest);
    const prompt = await buildInsightPrompt({ repoRoot, context: context.content, task, target: context.target, maxPromptChars: policy.maxPromptChars || 120000 });
    // 在线消费 Snapshot 前的使用时校准：远端有新版本自动 pull，失败与过期都显式告警，不阻塞运行。
    const snapshotPreflight = options.skipSnapshotPreflight ? { checked: false, pulled: false, stale_ids: [], remote_changed_ids: [], warnings: [] } : await (options.runSnapshotPreflight || preflightSnapshotFreshness)({ repoRoot, log: (line) => console.error(`[snapshot-preflight] ${line}`) });
    const prompt_assets = await buildPromptAssets({ repoRoot, task });
    const inputChanged = previous && (previous.contextSha256 !== context.sha256 || previous.promptSha256 !== sha256(prompt));
    if (["completed", "generated", "archive_pending"].includes(previous?.status) && inputChanged && !options.force) {
      const review = { ...previous, status: "needs_review", reason: "input-changed-after-completion", updatedAt: new Date().toISOString() }; await writeJson(paths.state, review); return { ...review, paths };
    }
    if (["completed", "needs_review", "submitted"].includes(previous?.status) && !options.force) return { ...previous, paths };
    if (["generated", "archive_pending"].includes(previous?.status)) {
      if (await exists(paths.generated)) return options.archive ? archiveIfRequested({ ...options, repoRoot, task, context, paths, state: previous }) : { ...previous, paths };
      if (!options.force) { const review = { ...previous, status: "needs_review", reason: "generated-output-missing", updatedAt: new Date().toISOString() }; await writeJson(paths.state, review); return { ...review, paths }; }
    }
    if (!task.prompt.productionReady || !options.send) { const preview = { schemaVersion: 1, taskId, runKey, target: context.target, status: "preview", contextSha256: context.sha256, promptSha256: sha256(prompt), prompt_assets, snapshot_preflight: snapshotPreflight, ...(task.prompt.productionReady ? { prompt } : { reason: "production-not-ready" }), updatedAt: new Date().toISOString() }; await writeJson(paths.state, preview); return { ...preview, paths }; }
    if (!options.confirm) throw new Error("send-requires-confirm");
    const submitted = { schemaVersion: 1, taskId, runKey, target: context.target, status: "submitted", contextSha256: context.sha256, promptSha256: sha256(prompt), prompt_assets, snapshot_preflight: snapshotPreflight, submittedAt: new Date().toISOString() }; await writeJson(paths.state, submitted);
    let bridge;
    try { bridge = await (options.runBridge || runBridgeCli)(prompt, { ...options, bridgePath: options.bridgePath || defaultBridge }); } catch (error) { const review = { ...submitted, status: "needs_review", reason: String(error?.message || error), updatedAt: new Date().toISOString() }; await writeJson(paths.state, review); return { ...review, paths }; }
    const result = bridge?.result || bridge;
    const bridgeExitFailure = bridge?.exit && (bridge.exit.timedOut || bridge.exit.error || bridge.exit.code !== 0);
    const bridgeReason = result?.reason || (bridgeExitFailure ? (bridge.exit.timedOut ? "bridge-timeout" : bridge.exit.error ? "bridge-process-error" : "bridge-exit-nonzero") : bridge?.exit?.error || (!result?.conversationUrl ? "missing-conversation-url" : "bridge-result-invalid"));
    const outputHashMatches = result?.outputSha256 === sha256(result?.text || "");
    if (bridgeExitFailure || result?.status !== "succeeded" || !result.runId || !String(result.text || "").trim() || result.format !== "markdown" || !result.conversationUrl || result.verification !== "live-dom+snapshot" || !outputHashMatches) { const review = { ...submitted, status: "needs_review", runId: result?.runId, conversationUrl: result?.conversationUrl, reason: bridgeReason, updatedAt: new Date().toISOString() }; await writeJson(paths.state, review); return { ...review, paths }; }
    try { validateGeneratedOutput(result.text, task, context.target); } catch (error) { const review = { ...submitted, status: "needs_review", runId: result.runId, conversationUrl: result.conversationUrl, outputSha256: sha256(result.text), reason: `invalid-output:${error.message}`, updatedAt: new Date().toISOString() }; await writeJson(paths.state, review); return { ...review, paths }; }
    const generatedText = renderGenerated(result.text, task, context.target, result.conversationUrl); await writeFile(paths.generated, generatedText, "utf8");
    const generated = { ...submitted, status: "generated", runId: result.runId, conversationUrl: result.conversationUrl, outputSha256: sha256(generatedText), generatedAt: new Date().toISOString() }; await writeJson(paths.state, generated);
    return archiveIfRequested({ ...options, repoRoot, task, context, paths, state: generated });
  } finally { await releaseLock(); }
}

async function archiveIfRequested({ repoRoot, task, context, paths, state, archive, runLark }) {
  if (!archive) return { ...state, paths };
  const pending = { ...state, status: "archive_pending", archiveStartedAt: new Date().toISOString() }; await writeJson(paths.state, pending);
  try { const archived = await archiveResult({ repoRoot, task, target: context.target, content: await readFile(paths.generated, "utf8"), runLark }); const completed = { ...pending, status: "completed", archive: archived, completedAt: new Date().toISOString() }; await writeJson(paths.state, completed); return { ...completed, paths }; }
  catch (error) { const failed = { ...pending, ...(error?.archive ? { archive: error.archive } : {}), status: "archive_pending", reason: String(error?.message || error), updatedAt: new Date().toISOString() }; await writeJson(paths.state, failed); return { ...failed, paths }; }
}

export async function setupWiki({ runLark = runLarkJson, repoRoot = defaultRepoRoot, confirm = false } = {}) {
  if (!confirm) throw new Error("setup-wiki-requires-confirm");
  const listed = await runLark(["wiki", "+space-list", "--page-all", "--as", "user", "--format", "json"]); const spaces = listed?.data?.spaces || []; const matches = spaces.filter((space) => space.name === "Learn-X 周期洞察");
  if (matches.length > 1) throw new Error("同名 Learn-X 周期洞察 知识库多于一个，停止人工裁决");
  const space = matches[0] || await runLark(["wiki", "+space-create", "--name", "Learn-X 周期洞察", "--description", "Learn-X 周期洞察候选阅读归档", "--as", "user", "--format", "json"]); const data = space?.data || space;
  const visibility = data.visibility ?? data.visibility_type; const openSharing = data.open_sharing ?? data.openSharing; if (visibility !== "private") throw new Error("知识库可见性未确认是 private"); if (openSharing !== "closed") throw new Error("知识库公开分享未确认关闭");
  const spaceId = data.space_id || data.spaceId; if (!spaceId) throw new Error("知识库缺少 space_id"); const record = { name: "Learn-X 周期洞察", spaceId, visibility, openSharing, updatedAt: new Date().toISOString() }; const file = path.join(repoRoot, "04_output/_dist/periodic-insights/wiki.json"); await mkdir(path.dirname(file), { recursive: true }); await writeJson(file, record); return record;
}

export async function archiveResult({ repoRoot = defaultRepoRoot, task, target, content, runLark = runLarkJson }) {
  const wiki = await readJson(path.join(repoRoot, "04_output/_dist/periodic-insights/wiki.json")); if (!wiki?.spaceId || wiki.name !== "Learn-X 周期洞察" || wiki.visibility !== "private" || wiki.openSharing !== "closed") throw new Error("周期洞察知识库身份或私有边界未确认，请重新执行 setup-wiki --confirm");
  const roots = await runLark(["wiki", "+node-list", "--space-id", wiki.spaceId, "--as", "user", "--page-all", "--format", "json"]); const rootNodes = roots?.data?.nodes || []; const yearMatches = rootNodes.filter((node) => node.title === target.id.slice(0, 4)); if (yearMatches.length > 1) throw new Error(`年份目录重复：${target.id.slice(0, 4)}`); let yearNode = yearMatches[0];
  if (!yearNode) yearNode = await runLark(["wiki", "+node-create", "--space-id", wiki.spaceId, "--title", target.id.slice(0, 4), "--as", "user", "--format", "json"]); const yearData = yearNode?.data || yearNode; const yearToken = yearData.node_token || yearData.nodeToken; if (!yearToken) throw new Error("年份目录缺少 node_token");
  const children = await runLark(["wiki", "+node-list", "--space-id", wiki.spaceId, "--parent-node-token", yearToken, "--as", "user", "--page-all", "--format", "json"]); const title = `${task.name}｜${target.id}`; const matches = (children?.data?.nodes || []).filter((node) => node.title === title); if (matches.length > 1) throw new Error(`归档标题重复：${title}`);
  const renderedPath = path.join(repoRoot, "04_output/_dist/periodic-insights", task.id, target.id, "feishu.xml"); await renderFeishu(content, renderedPath, title); let node = matches[0]; if (!node) node = await runLark(["wiki", "+node-create", "--parent-node-token", yearToken, "--title", title, "--as", "user", "--format", "json"]); const nodeData = node?.data || node; const nodeToken = nodeData.node_token || nodeData.nodeToken; const doc = nodeData.obj_token || nodeData.objToken; if (!doc) throw new Error("知识库节点缺少 obj_token");
  const archive = { spaceId: wiki.spaceId, nodeToken, documentToken: doc, title }; try { await runLark(["docs", "+update", "--doc", doc, "--command", "overwrite", "--doc-format", "xml", "--content", `@${path.relative(repoRoot, renderedPath)}`, "--as", "user", "--format", "json"]); const fetched = await runLark(["docs", "+fetch", "--doc", doc, "--doc-format", "markdown", "--as", "user", "--format", "json"]); const fetchedText = fetched?.data?.document?.content || fetched?.data?.content || ""; const runKey = `运行键：${task.id}:${target.kind}:${target.id}`; const conversationUrl = content.match(/- ChatGPT 会话：([^\s]+)/)?.[1]; if (!fetchedText.includes(title) || !fetchedText.includes("候选洞察") || !fetchedText.includes(runKey) || (conversationUrl && !fetchedText.includes(conversationUrl)) || sha256(normalizeMarkdown(fetchedText)) !== sha256(normalizeMarkdown(content))) throw new Error("飞书写后读回缺少标题、运行键、会话链接、实质正文或规范化哈希不一致"); } catch (error) { error.archive = archive; throw error; } finally { await unlink(renderedPath).catch(() => {}); }
  return { spaceId: wiki.spaceId, nodeToken, documentToken: doc, title };
}

function renderGenerated(text, task, target, conversationUrl) { return [`# ${task.name}｜${target.id}`, ``, `- 目标周期：${target.id}`, `- 运行键：${task.id}:${target.kind}:${target.id}`, `- 运行结果：候选洞察`, conversationUrl ? `- ChatGPT 会话：${conversationUrl}` : "", ``, String(text).trim(), ""].filter(Boolean).join("\n"); }
export function validateGeneratedOutput(text, task, target) { const value = String(text || "").trim(); if (!isSubstantive(value)) throw new Error("输出为空壳或过短"); if (!value.includes("候选洞察")) throw new Error("缺少候选洞察标记"); if (!value.includes(target.id)) throw new Error("缺少目标周期"); if (task.id === "munger-soul" && ["底层", "第二层", "第三层", "第四层", "第五层", "顶层"].some((heading) => !hasLayerLabel(value, heading))) throw new Error("芒格之魂六层结构不完整"); }
export function exitCodeForResult(command, result) { if (command === "setup-wiki") return 0; return ["preview", "skipped", "completed"].includes(result?.status) ? 0 : 2; }
function hasLayerLabel(value, layer) { const escaped = layer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[一二三四五六\\d]+[、.．)）]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?(?:\\s*[：:、（(]|\\s*$)`, "m").test(value); }
async function renderFeishu(content, outputPath, title) { const inputPath = `${outputPath}.md`; await writeFile(inputPath, content, "utf8"); try { await execFile("python3", [renderer, "--input", inputPath, "--output", outputPath, "--title", title], { maxBuffer: 4 * 1024 * 1024 }); } finally { await unlink(inputPath).catch(() => {}); } }
async function runLarkJson(args) { const { stdout } = await execFile("lark-cli", args, { env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }, maxBuffer: 16 * 1024 * 1024 }); const result = JSON.parse(stdout); if (result?.ok !== true) throw new Error(result?.error?.message || "lark-cli returned ok=false"); return result; }
async function writeJson(filePath, value) { await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`); }
async function writeAtomic(filePath, content) { const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`; await writeFile(temp, content, "utf8"); await rename(temp, filePath); }
async function readJson(filePath) { try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function acquireRunLock(lockPath) {
  try {
    const handle = await openFile(lockPath, "wx");
    try { await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8"); } catch (error) { await handle.close().catch(() => {}); await unlink(lockPath).catch(() => {}); throw error; }
    return async () => { await handle.close().catch(() => {}); await unlink(lockPath).catch(() => {}); };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock;
    try { lock = JSON.parse(await readFile(lockPath, "utf8")); } catch { return null; }
    if (!Number.isInteger(lock?.pid) || processAlive(lock.pid)) return null;
    await unlink(lockPath).catch(() => {});
    return acquireRunLock(lockPath);
  }
}
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } }
async function findPreservableState(repoRoot, taskId, targetId) { const taskRoot = path.join(repoRoot, "04_output/_dist/periodic-insights", taskId); let names; try { names = await readdir(taskRoot); } catch (error) { if (error.code === "ENOENT") return null; throw error; } const candidates = []; for (const name of names) { if (targetId && name !== targetId) continue; const statePath = path.join(taskRoot, name, "state.json"); const state = await readJson(statePath); if (state && ["submitted", "needs_review", "generated", "archive_pending"].includes(state.status)) candidates.push({ state, paths: { context: path.join(taskRoot, name, "context.md"), manifest: path.join(taskRoot, name, "manifest.json"), generated: path.join(taskRoot, name, "result.generated.md"), state: statePath } }); } const timestamp = (state) => state.updatedAt || state.completedAt || state.generatedAt || state.submittedAt || ""; return candidates.sort((a, b) => String(timestamp(b.state)).localeCompare(String(timestamp(a.state))))[0] || null; }
async function exists(filePath) { try { await stat(filePath); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
function sha256(value) { return createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function normalizeMarkdown(value) { return String(value || "").replace(/^<title>[^<]*<\/title>/i, "").replace(/&nbsp;/g, " ").replace(/[\s`*_>#\-~]+/g, "").trim(); }
function parseArgs(argv) { const options = { command: argv[0] || "preview" }; if (!["preview", "run", "setup-wiki"].includes(options.command)) throw new Error(`未知命令：${options.command}`); const value = (arg, index) => { const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`参数 ${arg} 需要值`); return next; }; for (let index = 1; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--task") { options.taskId = value(arg, index); index += 1; } else if (arg === "--target") { options.target = value(arg, index); index += 1; } else if (arg === "--range") { options.range = value(arg, index); index += 1; } else if (arg === "--from") { options.from = value(arg, index); index += 1; } else if (arg === "--to") { options.to = value(arg, index); index += 1; } else if (arg === "--send") options.send = true; else if (arg === "--archive") options.archive = true; else if (arg === "--confirm") options.confirm = true; else if (arg === "--force") options.force = true; else throw new Error(`未知参数：${arg}`); } return options; }
if (process.argv[1] === fileURLToPath(import.meta.url)) { const options = parseArgs(process.argv.slice(2)); const result = options.command === "setup-wiki" ? await setupWiki(options) : await runPeriodicInsight(options); process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = exitCodeForResult(options.command, result); }

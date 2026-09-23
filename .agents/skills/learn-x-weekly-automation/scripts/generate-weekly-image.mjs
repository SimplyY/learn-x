import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWeek, runBridgeCli } from "./generate-ai-review.mjs";
import { extractRequiredSections } from "../../learn-x-process/scripts/prepare-weekly-memory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");

// 参考 Voice-X / Read-X：通过 ChatGPT Bridge 的 image 模式生成核心内容图，
// 本机只暂存 Bridge 返回的图片字节并落盘到周流程 _dist 产物目录，不做本地绘制。
export function weeklyOutputPath(repoRoot, week) {
  return path.join(repoRoot, "04_output/_dist/weekly", week, "weekly-core.png");
}

function weeklyOutputFile(repoRoot, week) {
  const fileId = week.replace(/^(\d{4})-W(\d{2})$/, "$1-$2");
  return path.join(repoRoot, "04_output/weekly", `${fileId}.md`);
}

function sha256Bytes(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function buildWeeklyImagePrompt(sections) {
  const blocks = [];
  if (sections.coreSummary.length) {
    blocks.push(sections.coreSummary.map((item) => `${item.section}\n${item.text}`).join("\n\n"));
  }
  if (sections.mungerInsights.length) {
    blocks.push(sections.mungerInsights.map((item) => `${item.section}\n${item.text}`).join("\n\n"));
  }
  if (!blocks.length) throw new Error("no-substantive-core-content");
  return `把下面的核心内容生成为一张图。\n\n要求竖屏，不要横屏。\n\n${blocks.join("\n\n")}`;
}

export function imageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) return null;
  const subtype = match[1].slice("image/".length).toLowerCase();
  return { bytes, extension: subtype === "jpeg" ? "jpg" : subtype.replace(/[^a-z0-9]/g, "") || "png" };
}

async function writeAtomicBytes(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, payload);
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
}

export async function generateWeeklyImage(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const week = normalizeWeek(options.week);
  const outputPath = weeklyOutputPath(repoRoot, week);

  try {
    const existing = await stat(outputPath);
    if (existing.isFile() && existing.size > 0) {
      return { status: "succeeded", week, outputPath, skipped: true, reason: "already-success" };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const weeklyPath = weeklyOutputFile(repoRoot, week);
  let content;
  try {
    content = await readFile(weeklyPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { status: "failed", week, outputPath, reason: `weekly-output-missing:${path.relative(repoRoot, weeklyPath).split(path.sep).join("/")}` };
    }
    throw error;
  }

  let prompt;
  try {
    prompt = buildWeeklyImagePrompt(extractRequiredSections(content));
  } catch (error) {
    return { status: "failed", week, outputPath, reason: String(error?.message || error) };
  }

  const runner = options.runBridge || runBridgeCli;
  let bridge;
  try {
    bridge = await runner(prompt, { ...options, image: true });
  } catch (error) {
    bridge = { result: null, exit: { error: String(error?.message || error) } };
  }

  const bridgeResult = bridge?.result;
  if (bridgeResult?.status !== "succeeded") {
    return {
      status: "needs_review",
      week,
      outputPath,
      reason: bridgeResult?.reason || bridge?.exit?.error || (bridge?.exit?.timedOut ? "bridge-timeout" : "bridge-result-missing"),
      runId: bridgeResult?.runId,
      conversationUrl: bridgeResult?.conversationUrl,
      retryAfterSeconds: bridgeResult?.retryAfterSeconds,
      diagnostics: bridgeResult?.diagnostics
    };
  }

  const image = imageDataUrl(bridgeResult.imageBase64);
  if (!image) {
    return {
      status: "needs_review",
      week,
      outputPath,
      reason: "invalid-image-output",
      runId: bridgeResult.runId,
      conversationUrl: bridgeResult.conversationUrl,
      diagnostics: bridgeResult.diagnostics
    };
  }

  await writeAtomicBytes(outputPath, image.bytes);
  return {
    status: "succeeded",
    week,
    outputPath,
    imageFormat: image.extension,
    imageBytes: image.bytes.length,
    imageSha256: sha256Bytes(image.bytes),
    runId: bridgeResult.runId,
    conversationUrl: bridgeResult.conversationUrl
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") {
      options.week = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.week) {
    console.error("Usage: node generate-weekly-image.mjs --week YYYY-Www");
    process.exit(2);
  }
  const result = await generateWeeklyImage(options).catch((error) => ({ status: "needs_review", reason: String(error?.message || error) }));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "succeeded" ? 0 : 2;
}

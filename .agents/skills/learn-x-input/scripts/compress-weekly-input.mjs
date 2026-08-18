import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAdviceFromVoiceMarkdown } from "./collect-voice-weekly.mjs";
import { inputSize, MAX_WEEKLY_INPUT_CHARS } from "./lib/input-limits.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const supportedExtensions = new Set([".md", ".txt", ".json", ".html", ".htm"]);

export async function createCompressionReview({ week, root = repoRoot } = {}) {
  const weekRoot = path.join(root, "03_input/weekly", normalizeWeek(week));
  const reviewRoot = path.join(root, "04_output/_dist/weekly", normalizeWeek(week), "input-compression-review");
  const entries = [];
  for (const name of (await readdir(weekRoot)).sort()) {
    if (name.startsWith("_") || !supportedExtensions.has(path.extname(name).toLowerCase())) continue;
    const absolutePath = path.join(weekRoot, name);
    const content = await readFile(absolutePath, "utf8");
    const size = inputSize(content);
    if (size.chars <= MAX_WEEKLY_INPUT_CHARS) continue;
    const entry = {
      path: `03_input/weekly/${normalizeWeek(week)}/${name}`,
      sourceHash: sha256(content),
      sourceChars: size.chars,
      sourceBytes: size.bytes,
      diagnostics: diagnose(name, content),
      mode: name === "voice.md" ? "voice-structural" : "manual-semantic-review",
      candidate: null
    };
    if (name === "voice.md") {
      const candidate = buildVoiceCandidate(content);
      const candidateSize = inputSize(candidate);
      if (candidateSize.chars <= MAX_WEEKLY_INPUT_CHARS) {
        const candidatePath = path.join(reviewRoot, "candidates", name);
        entry.candidate = {
          path: `04_output/_dist/weekly/${normalizeWeek(week)}/input-compression-review/candidates/${name}`,
          hash: sha256(candidate),
          chars: candidateSize.chars,
          bytes: candidateSize.bytes
        };
        entry.candidateText = candidate;
        entry.diagnostics.push("已生成结构化候选：保留核心总结，排除建议与压缩原文。");
      } else {
        entry.diagnostics.push(`结构化候选仍有 ${candidateSize.chars} 字符，需人工语义压缩。`);
      }
    }
    entries.push(entry);
  }

  await mkdir(path.join(reviewRoot, "candidates"), { recursive: true });
  for (const entry of entries) {
    if (entry.candidateText == null) continue;
    await writeFile(path.join(reviewRoot, "candidates", path.basename(entry.path)), entry.candidateText, "utf8");
    delete entry.candidateText;
  }
  const manifest = {
    schemaVersion: 1,
    week: normalizeWeek(week),
    generatedAt: new Date().toISOString(),
    maxChars: MAX_WEEKLY_INPUT_CHARS,
    entries
  };
  await writeFile(path.join(reviewRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(reviewRoot, "README.md"), renderReviewMarkdown(manifest), "utf8");
  return { reviewRoot, manifest, overLimitCount: entries.length };
}

export async function applyCompressionReview({ week, root = repoRoot, confirm = false } = {}) {
  if (!confirm) throw new Error("批量压缩应用必须显式传入 --confirm；先人工检查 input-compression-review/README.md。");
  const weekId = normalizeWeek(week);
  const reviewRoot = path.join(root, "04_output/_dist/weekly", weekId, "input-compression-review");
  const manifest = JSON.parse(await readFile(path.join(reviewRoot, "manifest.json"), "utf8"));
  const weekRoot = path.join(root, "03_input/weekly", weekId);
  const replacements = [];
  for (const entry of manifest.entries) {
    if (!entry.candidate) continue;
    const sourcePath = path.join(root, entry.path);
    const candidatePath = path.join(root, entry.candidate.path);
    const source = await readFile(sourcePath, "utf8");
    const candidate = await readFile(candidatePath, "utf8");
    if (sha256(source) !== entry.sourceHash) throw new Error(`源文件在审核后发生变化，停止应用：${entry.path}`);
    if (inputSize(candidate).chars > MAX_WEEKLY_INPUT_CHARS) throw new Error(`候选仍超过上限，停止应用：${entry.candidate.path}`);
    if (!isInside(sourcePath, weekRoot) || !isInside(candidatePath, reviewRoot)) throw new Error("压缩路径越界，停止应用。");
    replacements.push({ sourcePath, candidate });
  }
  for (const replacement of replacements) {
    const temporary = `${replacement.sourcePath}.compression-${process.pid}.tmp`;
    await writeFile(temporary, replacement.candidate, "utf8");
    await rename(temporary, replacement.sourcePath);
  }
  return { week: weekId, applied: replacements.map(({ sourcePath }) => sourcePath) };
}

export function buildVoiceCandidate(content) {
  const source = String(content).replace(/\r\n/g, "\n");
  const firstRecord = source.search(/^## with /m);
  if (firstRecord < 0) return stripAdviceFromVoiceMarkdown(source);
  const header = source.slice(0, firstRecord).trimEnd();
  const records = source.slice(firstRecord).split(/(?=^## with )/m).map(stripAdviceFromVoiceMarkdown).filter(Boolean);
  return `${header}\n\n${records.join("\n\n---\n\n")}\n`;
}

export function diagnose(name, content) {
  const diagnostics = [];
  if (name === "voice.md" && /^#{1,6}\s+压缩原文\s*$/m.test(content)) diagnostics.push("检测到 Voice-X 的完整细节段落「压缩原文」；这不是坏数据，但不应进入周输入。");
  if (/原始文字稿|raw transcript/i.test(content)) diagnostics.push("检测到可能的原始文字稿标记，需人工确认是否越过来源边界。");
  const lines = String(content).split("\n").map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line) && line !== "---" && !line.startsWith("> 建议上下文"));
  const duplicates = lines.length - new Set(lines).size;
  if (duplicates >= 10) diagnostics.push(`检测到 ${duplicates} 条重复正文行，需人工确认是否为坏数据或合法重复。`);
  return diagnostics.length ? diagnostics : ["未检测到确定的结构异常；仍需人工确认候选内容。"];
}

function renderReviewMarkdown(manifest) {
  const lines = [
    `# 周输入批量压缩审核｜${manifest.week}`,
    "",
    `- 单文件上限：${manifest.maxChars} 字符`,
    "- 原始输入未修改；候选只在你明确确认后应用。",
    "- 诊断是风险提示，不自动判定内容为坏数据。",
    "",
    "| 文件 | 原始字符 | 候选字符 | 模式 | 状态 |",
    "| --- | ---: | ---: | --- | --- |",
    ...manifest.entries.map((entry) => `| ${entry.path} | ${entry.sourceChars} | ${entry.candidate?.chars ?? "-"} | ${entry.mode} | ${entry.candidate ? "可审核候选" : "需人工语义压缩"} |`),
    "",
    "## 诊断",
    "",
    ...manifest.entries.flatMap((entry) => [`### ${entry.path}`, "", ...entry.diagnostics.map((item) => `- ${item}`), ""])
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeWeek(value) {
  const match = String(value || "").match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`无效周：${value}`);
  return `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
}

function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function isInside(target, root) { const relative = path.relative(root, target); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }

const args = process.argv.slice(2);
const week = args[args.indexOf("--week") + 1];
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (args.includes("--apply")) {
    const result = await applyCompressionReview({ week, confirm: args.includes("--confirm") });
    console.log(`Weekly input compression applied: ${result.applied.length} files.`);
  } else {
    const result = await createCompressionReview({ week });
    console.log(`Weekly input compression review written: ${path.relative(repoRoot, result.reviewRoot)}`);
    console.log(`Oversized files: ${result.overLimitCount}`);
  }
}

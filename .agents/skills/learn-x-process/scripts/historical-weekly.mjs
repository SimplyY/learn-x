import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  datedSections,
  isPlaceholder,
  isoWeekId,
  stripSourceMetadata
} from "./monthly-process-input.mjs";
import { isoWeekRange } from "./collect-weekly-input.mjs";
import { isSubstantive } from "./flomo-sync-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const manifestRelativePath = "04_output/_dist/historical-weekly/manifest.json";
const generatedWeeklyRoot = "03_input/weekly-history";

export async function buildHistoricalManifest(repoRoot = defaultRepoRoot, { write = true } = {}) {
  const dailyFiles = await collectFiles(repoRoot, (relativePath, entry) => entry.name === "daily.md" && !relativePath.includes("/_dist/"));
  const dailyCandidates = await readDailyCandidates(repoRoot, dailyFiles);
  const daily = selectDailyCandidates(dailyCandidates);
  const weeklyCandidates = await readWeeklyCandidates(repoRoot);
  const weeks = buildWeeks(repoRoot, daily, weeklyCandidates);
  const monthly = await readMonthlySources(repoRoot);
  const memory = await readMemorySources(repoRoot);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    roots: {
      daily: ["03_input/yearly", "03_input/monthly", "03_input/weekly"],
      weekly: ["03_input/weekly", "03_input/weekly-history", "03_input/yearly", "03_input/monthly"]
    },
    daily: {
      sourceCount: dailyCandidates.length,
      dateCount: daily.selected.size,
      conflictDateCount: daily.conflicts.size,
      firstDate: [...daily.selected.keys()].sort()[0] ?? null,
      lastDate: [...daily.selected.keys()].sort().at(-1) ?? null,
      conflicts: [...daily.conflicts.entries()].map(([date, entries]) => ({ date, entries })),
      duplicates: daily.duplicates
    },
    weeks,
    monthly,
    memory
  };

  if (write) await writeManifest(repoRoot, manifest, daily, weeks);
  return manifest;
}

export async function validateHistoricalManifest(repoRoot = defaultRepoRoot) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, manifestRelativePath), "utf8"));
  const errors = [];
  const warnings = [];
  for (const week of manifest.weeks) {
    if (!week.hasDiary || week.status === "no_diary") continue;
    if (week.status === "blocked") {
      if (!week.reason) errors.push(`${week.id}: blocked week missing reason`);
      else warnings.push(`${week.id}: blocked by ${week.reason}`);
      continue;
    }
    if (!["existing_verified", "generated"].includes(week.status)) {
      errors.push(`${week.id}: unresolved status ${week.status}`);
      continue;
    }
    if (!week.syncSource) {
      errors.push(`${week.id}: missing sync source`);
      continue;
    }
    const absolutePath = path.join(repoRoot, week.syncSource);
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      errors.push(`${week.id}: cannot read ${week.syncSource}: ${error.code}`);
      continue;
    }
    if (!isSubstantive(source)) errors.push(`${week.id}: sync source is not substantive`);
    if (week.status === "generated") {
      if (!source.includes("生成方式：Codex 根据本地日记自动生成（历史回填）")) errors.push(`${week.id}: generated source missing provenance marker`);
      const inputHash = source.match(/^- 输入日记哈希：([a-f0-9]{64})$/m)?.[1];
      if (inputHash !== week.inputSha256) errors.push(`${week.id}: generated source input hash mismatch`);
    }
    if (/\/Users\/|\/Downloads\/|file:\/\//.test(source)) errors.push(`${week.id}: source contains an absolute or file URL path`);
  }
  return { valid: errors.length === 0, errors, warnings, manifest };
}

function buildWeeks(repoRoot, daily, weeklyCandidates) {
  const ids = new Set([...daily.byWeek.keys(), ...weeklyCandidates.flatMap((candidate) => candidate.weeks.length ? candidate.weeks : candidate.possibleWeeks)]);
  return [...ids].sort().map((id) => {
    const selected = daily.byWeek.get(id) ?? [];
    const conflictDates = selected.filter((entry) => daily.conflicts.has(entry.date)).map((entry) => entry.date);
    const range = isoWeekRange(id);
    const start = range.start.toISOString().slice(0, 10);
    const end = new Date(range.end.getTime() - 86400000).toISOString().slice(0, 10);
    const dates = selected.map((entry) => entry.date).sort();
    const missingDates = datesBetween(start, end).filter((date) => !dates.includes(date));
    const inputRows = selected.map((entry) => ({
      date: entry.date,
      sourcePath: entry.sourcePath,
      sourceSha256: entry.sourceSha256,
      text: stripSourceMetadata(entry.text)
    }));
    const inputSha256 = digest(JSON.stringify(inputRows));
    const candidates = weeklyCandidates.filter((candidate) => candidate.weeks.includes(id) || candidate.possibleWeeks.includes(id));
    const resolution = resolveWeekly(id, selected.length > 0, conflictDates, candidates, inputSha256);
    return {
      id,
      coverage: { start, end, dates, missingDates },
      hasDiary: selected.length > 0,
      inputSha256: selected.length ? inputSha256 : null,
      diarySources: [...new Set(selected.map((entry) => entry.sourcePath))],
      conflictDates,
      candidates,
      ...resolution
    };
  });
}

function resolveWeekly(id, hasDiary, conflictDates, candidates, inputSha256) {
  const verified = candidates.filter((candidate) => candidate.status === "verified");
  const generated = verified.filter((candidate) => candidate.kind === "generated");
  const canonical = verified.filter((candidate) => candidate.priority === 0);
  const preferred = canonical.length ? canonical : verified.filter((candidate) => candidate.kind !== "generated");
  const differentHashes = new Set(preferred.map((candidate) => candidate.sha256)).size > 1;

  if (conflictDates.length) return { status: "blocked", reason: "daily-date-conflict", syncSource: null, ignoredCandidates: [] };
  if (generated.length) {
    const matching = generated.find((candidate) => candidate.inputSha256 === inputSha256);
    const mismatched = generated.filter((candidate) => candidate.inputSha256 && candidate.inputSha256 !== inputSha256);
    if (mismatched.length && !matching) return { status: "blocked", reason: "generated-input-hash-changed", syncSource: null, ignoredCandidates: mismatched.map((candidate) => candidate.relativePath) };
    if (matching) return { status: "generated", reason: "generated-history-reused", syncSource: matching.relativePath, ignoredCandidates: [] };
  }
  if (preferred.length > 1 && differentHashes) {
    if (hasDiary) return { status: "generated", reason: "multiple-weekly-sources-replaced-by-diary-backfill", syncSource: generated[0]?.relativePath ?? null, needsGeneration: !generated.length, ignoredCandidates: preferred.map((candidate) => candidate.relativePath) };
    return { status: "blocked", reason: "multiple-weekly-sources-conflict", syncSource: null, ignoredCandidates: preferred.map((candidate) => candidate.relativePath) };
  }
  if (preferred.length) return { status: "existing_verified", reason: "verified-weekly-source", syncSource: preferred[0].relativePath, ignoredCandidates: candidates.filter((candidate) => candidate.relativePath !== preferred[0].relativePath).map((candidate) => candidate.relativePath) };
  const ambiguous = candidates.filter((candidate) => candidate.status === "ambiguous");
  if (hasDiary) return { status: "generated", reason: ambiguous.length ? "missing-or-ambiguous-weekly-source" : "missing-weekly-source", syncSource: null, needsGeneration: true, ignoredCandidates: ambiguous.map((candidate) => candidate.relativePath) };
  return { status: "no_diary", reason: ambiguous.length ? "no-diary-ambiguous-weekly-source" : "no-diary", syncSource: null, ignoredCandidates: ambiguous.map((candidate) => candidate.relativePath) };
}

async function readDailyCandidates(repoRoot, files) {
  const candidates = [];
  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    const buffer = await readFile(absolutePath);
    const sections = datedSections(buffer.toString("utf8")).filter((section) => !isPlaceholder(section.text));
    const sourceSha256 = digest(buffer);
    for (const section of sections) candidates.push({ date: section.date, text: section.text, sourcePath: relativePath, sourceSha256 });
  }
  return candidates;
}

function selectDailyCandidates(candidates) {
  const byDate = new Map();
  for (const candidate of candidates) byDate.set(candidate.date, [...(byDate.get(candidate.date) ?? []), candidate]);
  const selected = new Map();
  const conflicts = new Map();
  for (const [date, entries] of byDate) {
    const maxLength = Math.max(...entries.map((entry) => entry.text.length));
    const longest = entries.filter((entry) => entry.text.length === maxLength);
    const distinct = new Set(longest.map((entry) => normalizeForCompare(entry.text)));
    if (distinct.size > 1) conflicts.set(date, entries.map(({ sourcePath, sourceSha256, text }) => ({ sourcePath, sourceSha256, chars: text.length })));
    selected.set(date, longest.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))[0]);
  }
  const byWeek = new Map();
  for (const entry of selected.values()) {
    const week = isoWeekId(new Date(`${entry.date}T00:00:00Z`));
    byWeek.set(week, [...(byWeek.get(week) ?? []), entry]);
  }
  const duplicates = [...byDate.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([date, entries]) => ({
      date,
      selected: selected.get(date)?.sourcePath ?? null,
      selectedSha256: selected.get(date)?.sourceSha256 ?? null,
      candidates: entries.map(({ sourcePath, sourceSha256, text }) => ({ sourcePath, sourceSha256, chars: text.length }))
    }));
  return { selected, conflicts, duplicates, byWeek };
}

async function readWeeklyCandidates(repoRoot) {
  const files = await collectFiles(repoRoot, (relativePath, entry) => {
    if (!entry.name.endsWith(".md")) return false;
    if (relativePath.startsWith("03_input/weekly-history/")) return entry.name === "weekly.md";
    return entry.name === "weekly.md" || /^weekly-\d{4}-\d{1,2}-\d{1,2}\.md$/.test(entry.name);
  });
  const candidates = [];
  for (const relativePath of files) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (!isSubstantive(source)) continue;
    const isGenerated = relativePath.startsWith(`${generatedWeeklyRoot}/`);
    const canonicalMatch = relativePath.match(/^03_input\/weekly\/(\d{4}-W\d{2})(?:\/|$)/);
    const generatedMatch = relativePath.match(/^03_input\/weekly-history\/(\d{4}-W\d{2})(?:\/|$)/);
    const weeks = canonicalMatch ? [canonicalMatch[1]] : generatedMatch ? [generatedMatch[1]] : inferWeeks(source, relativePath);
    const candidate = {
      relativePath,
      kind: isGenerated ? "generated" : canonicalMatch ? "canonical" : "legacy",
      priority: isGenerated ? 1 : canonicalMatch ? 0 : 2,
      sha256: digest(source),
      status: weeks.length === 1 ? "verified" : "ambiguous",
      weeks: weeks.length === 1 ? weeks : [],
      possibleWeeks: weeks,
      inputSha256: source.match(/^- 输入日记哈希：([a-f0-9]{64})$/m)?.[1] ?? null
    };
    candidates.push(candidate);
  }
  return candidates;
}

async function readMonthlySources(repoRoot) {
  const files = await collectFiles(repoRoot, (relativePath, entry) => {
    if (!/^monthly(?:-journal)?\.md$/.test(entry.name)) return false;
    return /^03_input\/monthly\/\d{4}-\d{1,2}\//.test(relativePath) || /^03_input\/yearly\/\d{4}\/\d{4}-\d{1,2}\//.test(relativePath);
  });
  return await resolvePeriodSources(repoRoot, files, "monthly");
}

async function readMemorySources(repoRoot) {
  const files = await collectFiles(repoRoot, (_relativePath, entry) => /^\d{4}-Q\d\.memory\.md$/.test(entry.name));
  const sources = [];
  for (const relativePath of files) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (!isSubstantive(source)) continue;
    const id = path.basename(relativePath, ".memory.md");
    sources.push({ id, relativePath, sha256: digest(source), status: "verified" });
  }
  return sources.sort((a, b) => a.id.localeCompare(b.id));
}

async function resolvePeriodSources(repoRoot, files, kind) {
  const grouped = new Map();
  for (const relativePath of files) {
    const match = relativePath.match(/^03_input\/monthly\/(\d{4})-(\d{1,2})\//) ?? relativePath.match(/^03_input\/yearly\/\d{4}\/(\d{4})-(\d{1,2})\//);
    if (!match) continue;
    const id = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (!isSubstantive(source)) continue;
    grouped.set(id, [...(grouped.get(id) ?? []), { id, kind, relativePath, sha256: digest(source), bytes: Buffer.byteLength(source) }]);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([id, candidates]) => {
    const hashes = new Set(candidates.map((candidate) => candidate.sha256));
    return { id, status: hashes.size === 1 ? "verified" : "blocked", reason: hashes.size === 1 ? "one-or-more-identical-sources" : "multiple-monthly-sources-conflict", candidates };
  });
}

function inferWeeks(source, relativePath) {
  const body = source.split(/\r?\n/).slice(1).join("\n");
  const normalizedFull = [...body.matchAll(/(?<!\d)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g)]
    .map((match) => isoWeekId(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))));
  const withoutFull = body.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, " ");
  const year = Number(relativePath.match(/weekly-(\d{4})-/)?.[1] ?? body.match(/\b(20\d{2})\b/)?.[1]);
  const shortDates = [...withoutFull.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?!\d)/g)]
    .map((match) => new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]))))
    .filter((date) => Number.isFinite(date.getTime()) && date.getUTCFullYear() === year)
    .map((date) => isoWeekId(date));
  return [...new Set([...normalizedFull, ...shortDates])].sort();
}

async function writeManifest(repoRoot, manifest, daily, weeks) {
  const outputRoot = path.join(repoRoot, "04_output/_dist/historical-weekly");
  await mkdir(path.join(outputRoot, "packs"), { recursive: true });
  for (const week of weeks.filter((entry) => entry.hasDiary)) {
    const rows = (daily.byWeek.get(week.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const pack = renderDailyPack(week, rows);
    await writeFile(path.join(outputRoot, "packs", `${week.id}.md`), pack, "utf8");
  }
  await writeFile(path.join(repoRoot, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function renderDailyPack(week, rows) {
  return [
    `# 历史周记输入｜${week.id}`,
    "",
    `- 覆盖期：${week.coverage.start} 至 ${week.coverage.end}`,
    `- 实际记录日：${week.coverage.dates.join("、") || "无"}`,
    `- 缺失日：${week.coverage.missingDates.join("、") || "无"}`,
    `- 输入日记哈希：${week.inputSha256}`,
    "- 说明：以下内容仅供历史周记回填；不得把未记录内容当作事实。",
    "",
    ...rows.flatMap((row) => [`## ${row.date}`, `- 来源：${row.sourcePath}`, "", stripSourceMetadata(row.text), ""])
  ].join("\n").trim() + "\n";
}

async function collectFiles(repoRoot, predicate, current = "") {
  const root = path.join(repoRoot, current);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "_dist") continue;
    const relativePath = path.posix.join(current.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(repoRoot, predicate, relativePath));
    else if (entry.isFile() && predicate(relativePath, entry)) files.push(relativePath);
  }
  return files.sort();
}

function datesBetween(start, end) {
  const dates = [];
  for (let date = new Date(`${start}T00:00:00Z`); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
  return dates;
}

function normalizeForCompare(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : value).digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--validate")
    ? await validateHistoricalManifest()
    : await buildHistoricalManifest();
  console.log(JSON.stringify({
    valid: result.valid,
    dateCount: result.manifest?.daily?.dateCount ?? result.daily.dateCount,
    weekCount: result.manifest?.weeks?.length ?? result.weeks.length,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    path: manifestRelativePath
  }, null, 2));
  if (result.valid === false) process.exitCode = 1;
}

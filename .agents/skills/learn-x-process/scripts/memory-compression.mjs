import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countInputChars } from "../../learn-x-input/scripts/lib/input-limits.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");
const MEMORY_ROOT = "01_core/memory";
const ARCHIVE_ROOT = "01_core/memory-archive";
const REVIEW_ROOT = "04_output/_dist/memory-compression";
const HARD_YEAR_LIMIT = 8000;
const TARGET_UTILIZATION = 0.75;
const DECAY = 0.6;
const MIN_YEAR_LIMIT = 200;
const METADATA_PREFIX = "<!-- learn-x-memory-compression: ";
const METADATA_SUFFIX = " -->";
const METADATA_FILE = ".memory-compression.json";

export function countMemoryChars(value) {
  return countInputChars(String(value).replace(/\r\n?/g, "\n"));
}

export function measureTextChange(before, after) {
  const left = Array.from(String(before ?? ""));
  const right = Array.from(String(after ?? ""));
  const row = Array(right.length + 1).fill(0);
  for (const leftChar of left) {
    let diagonal = 0;
    for (let index = 1; index <= right.length; index += 1) {
      const previous = row[index];
      row[index] = leftChar === right[index - 1]
        ? diagonal + 1
        : Math.max(row[index], row[index - 1]);
      diagonal = previous;
    }
  }
  const unchanged = row[right.length];
  const removedChars = left.length - unchanged;
  const addedChars = right.length - unchanged;
  return {
    removedChars,
    addedChars,
    changedChars: removedChars + addedChars,
    netReduction: removedChars - addedChars
  };
}

export function annualHardLimit(age) {
  return Math.max(MIN_YEAR_LIMIT, Math.floor(HARD_YEAR_LIMIT * DECAY ** Math.max(0, Number(age)) + 1e-9));
}

export function annualTargetLimit(age) {
  return Math.max(MIN_YEAR_LIMIT, Math.floor(annualHardLimit(age) * TARGET_UTILIZATION));
}

export function renderMemoryCandidate(metadata, body) {
  const normalizedBody = String(body ?? metadata).replace(/\r\n?/g, "\n").replace(/^\n+/, "");
  return normalizedBody;
}

export function parseAsOf(value) {
  if (value === undefined || value === null || value === "") return todayInShanghai();
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid --as-of: ${value}. Use YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid --as-of: ${value}.`);
  return value;
}

export async function planMemoryCompression({ repoRoot = defaultRepoRoot, asOf } = {}) {
  const date = parseAsOf(asOf);
  const currentYear = Number(date.slice(0, 4));
  const currentMonth = Number(date.slice(5, 7));
  const activeFiles = await readActiveMemoryFiles(repoRoot, `${currentYear}-${String(currentMonth).padStart(2, "0")}`);
  const currentYearFiles = activeFiles.filter((file) => file.year === currentYear && file.kind === "quarter");
  const currentYearChars = currentYearFiles.reduce((sum, file) => sum + file.chars, 0);
  const currentYearBudget = budgetForAge(0);
  const operations = [];

  if (currentYearChars > currentYearBudget.target || currentYearFiles.some((file) => file.units.some((unit) => unit.eligible))) {
    operations.push(buildCurrentYearOperation({ repoRoot, date, currentYear, currentMonth, files: currentYearFiles, currentYearChars, budget: currentYearBudget }));
  }

  const priorYears = new Set(activeFiles.filter((file) => file.year < currentYear).map((file) => file.year));
  for (const year of [...priorYears].sort((a, b) => a - b)) {
    const quarters = activeFiles.filter((file) => file.year === year && file.kind === "quarter");
    const annual = activeFiles.find((file) => file.year === year && file.kind === "year");
    const budget = budgetForAge(currentYear - year);
    if (annual && quarters.length) {
      operations.push(buildAnnualOperation({ repoRoot, date, year, files: [annual, ...quarters], budget, reason: "consolidate-duplicate-quarter-files" }));
    } else if (quarters.length) {
      operations.push(buildAnnualOperation({ repoRoot, date, year, files: quarters, budget, reason: "annualize-quarter-files" }));
    } else if (annual && annual.chars > budget.target) {
      operations.push(buildAnnualOperation({ repoRoot, date, year, files: [annual], budget, reason: "annual-budget" }));
    }
  }

  for (const operation of operations) {
    for (const candidate of operation.candidates) {
      candidate.exists = await exists(path.join(repoRoot, candidate.candidatePath));
      candidate.reviewStatus = candidate.exists
        ? await inspectCandidateStatus(repoRoot, path.join(repoRoot, candidate.candidatePath))
        : "missing";
    }
  }

  return {
    schemaVersion: 1,
    asOf: date,
    currentYear,
    currentMonth,
    currentMonthLabel: `${currentYear}-${String(currentMonth).padStart(2, "0")}`,
    budgets: { currentYear: currentYearBudget, recentThreeYearsHardLimit: 15680 },
    activeFiles: activeFiles.map(summarizeFile),
    currentYearChars,
    operations,
    status: operations.length ? "review_required" : "not_needed"
  };
}

export async function validateMemoryCompression({ repoRoot = defaultRepoRoot, candidatePath, includeContent = false }) {
  if (!candidatePath) throw new Error("Missing candidatePath.");
  const absoluteCandidate = path.resolve(repoRoot, candidatePath);
  const reviewRoot = path.resolve(repoRoot, REVIEW_ROOT);
  const relativeToReview = path.relative(reviewRoot, absoluteCandidate);
  if (relativeToReview.startsWith("..") || path.isAbsolute(relativeToReview)) {
    throw new Error("Candidates must stay inside 04_output/_dist/memory-compression/.");
  }
  const candidateFiles = await candidateFilesAt(absoluteCandidate);
  if (!candidateFiles.length) throw new Error(`No *.memory.compressed.md found at ${candidatePath}.`);

  const entries = [];
  for (const filePath of candidateFiles) entries.push(await validateCandidateFile(repoRoot, filePath));
  const aggregate = aggregateValidation(entries);
  const aggregateSourceChars = entries.reduce((sum, entry) => sum + entry.sources.reduce((inner, source) => inner + countMemoryChars(source.content), 0), 0);
  const comparisonPaths = [...new Set(entries.map((entry) => entry.comparisonPath))];
  for (const entry of entries) {
    const scopedResult = {
      ...aggregate,
      entries: [entry],
      totalChars: entry.chars,
      aggregateTotalChars: aggregate.totalChars,
      aggregateSourceChars,
      unitAudit: entry.unitAudit,
      removedOrChangedUnits: entry.protectedMissing,
      protectedOk: entry.protectedOk,
      coreDifferencesOk: entry.coreDifferencesOk
    };
    await writeFile(entry.comparisonPath, renderComparisonReport(scopedResult), "utf8");
  }
  const result = { ...aggregate, comparisonPath: comparisonPaths[0], comparisonPaths };
  return includeContent ? result : sanitizeValidation(result);
}

export async function promoteMemoryCompression({ repoRoot = defaultRepoRoot, candidatePath, confirm = false } = {}) {
  if (!confirm) throw new Error("Promotion requires --confirm.");
  const validation = await validateMemoryCompression({ repoRoot, candidatePath, includeContent: true });
  if (validation.status === "stale") throw new Error("Candidate is stale; source memory changed after preview.");
  if (!validation.formatOk || !validation.hardLimitOk || !validation.protectedOk || !validation.candidateCoverageOk || !validation.coreDifferencesOk || !validation.otherChangesOk) {
    throw new Error("Candidate failed format, hard-limit, protected-content, coverage, core-differences, or other-changes validation.");
  }

  const entries = validation.entries;
  const archiveDir = path.join(repoRoot, ARCHIVE_ROOT, "compression", validation.asOf, String(Date.now()));
  await mkdir(archiveDir, { recursive: true });
  const moved = [];
  const replaced = [];
  const createdTargets = [];
  try {
    for (const entry of entries) {
      for (const source of entry.sources) {
        const archivePath = path.join(archiveDir, source.relativePath);
        await mkdir(path.dirname(archivePath), { recursive: true });
        await copyFile(source.absolutePath, archivePath);
        if (sha256(await readFile(archivePath)) !== source.sha256) throw new Error(`Archive verification failed: ${source.relativePath}`);
      }
    }

    for (const entry of entries) {
      if (entry.metadata.mode === "annualize") {
        const targetPath = path.join(repoRoot, entry.metadata.targetPath);
        if (await exists(targetPath)) {
          const targetArchive = path.join(archiveDir, entry.metadata.targetPath);
          await mkdir(path.dirname(targetArchive), { recursive: true });
          if (!await exists(targetArchive)) await copyFile(targetPath, targetArchive);
          replaced.push({ source: { absolutePath: targetPath }, archivePath: targetArchive });
        } else {
          createdTargets.push(targetPath);
        }
        await atomicWrite(targetPath, entry.body);
        await verifyText(targetPath, entry.body);
        for (const source of entry.sources) {
          if (source.relativePath === entry.metadata.targetPath) continue;
          const archivePath = path.join(archiveDir, source.relativePath);
          await rename(source.absolutePath, archivePath);
          moved.push({ source, archivePath });
        }
      } else {
        const source = entry.sources[0];
        replaced.push({ source, archivePath: path.join(archiveDir, source.relativePath) });
        await atomicWrite(source.absolutePath, entry.body);
        await verifyText(source.absolutePath, entry.body);
      }
    }
  } catch (error) {
    for (const item of moved.reverse()) await rename(item.archivePath, item.source.absolutePath).catch(() => {});
    for (const item of replaced) await copyFile(item.archivePath, item.source.absolutePath).catch(() => {});
    for (const targetPath of createdTargets.reverse()) await unlink(targetPath).catch(() => {});
    throw error;
  }

  return {
    status: "promoted",
    asOf: validation.asOf,
    archivePath: path.relative(repoRoot, archiveDir).split(path.sep).join("/"),
    targets: entries.map((entry) => entry.metadata.targetPath)
  };
}

function buildCurrentYearOperation({ repoRoot, date, currentYear, currentMonth, files, currentYearChars, budget }) {
  const reviewDir = path.join(repoRoot, REVIEW_ROOT, date.slice(0, 7));
  return {
    id: `${currentYear}-current-year`,
    mode: "current-year",
    reason: currentYearChars > budget.target ? "current-year-budget" : "monthly-headroom-maintenance",
    sourcePaths: files.map((file) => file.relativePath),
    outputDir: path.relative(repoRoot, reviewDir).split(path.sep).join("/"),
    currentYearChars,
    targetChars: budget.target,
    hardLimit: budget.hard,
    protectedUnits: files.flatMap((file) => file.units.filter((unit) => unit.protected).map(summarizeUnit)),
    eligibleUnits: files.flatMap((file) => file.units.filter((unit) => unit.eligible).map(summarizeUnit)),
    candidates: files.map((file) => candidateDescriptor(repoRoot, reviewDir, file.relativePath, {
      mode: "current-year",
      operationId: `${currentYear}-current-year`,
      asOf: date,
      targetPath: file.relativePath,
      sourcePaths: [file.relativePath],
      currentYearSources: files.map((entry) => entry.relativePath),
      hardLimit: budget.hard,
      targetChars: budget.target,
      currentMonth: `${currentYear}-${String(currentMonth).padStart(2, "0")}`,
      sourceHashes: { [file.relativePath]: file.sha256 },
      currentYearSourceChars: Object.fromEntries(files.map((entry) => [entry.relativePath, entry.chars])),
      protectedUnitIds: file.units.filter((unit) => unit.protected).map((unit) => unit.id)
    }))
  };
}

function buildAnnualOperation({ repoRoot, date, year, files, budget, reason }) {
  const reviewDir = path.join(repoRoot, REVIEW_ROOT, date.slice(0, 7));
  const targetPath = `${MEMORY_ROOT}/${year}.memory.md`;
  return {
    id: `${year}-annual`,
    mode: "annualize",
    reason,
    sourcePaths: files.map((file) => file.relativePath),
    outputDir: path.relative(repoRoot, reviewDir).split(path.sep).join("/"),
    sourceChars: files.reduce((sum, file) => sum + file.chars, 0),
    targetChars: budget.target,
    hardLimit: budget.hard,
    protectedUnits: files.flatMap((file) => file.units.filter((unit) => unit.protected).map(summarizeUnit)),
    eligibleUnits: files.flatMap((file) => file.units.filter((unit) => unit.eligible).map(summarizeUnit)),
    candidates: [candidateDescriptor(repoRoot, reviewDir, targetPath, {
      mode: "annualize",
      operationId: `${year}-annual`,
      asOf: date,
      targetPath,
      sourcePaths: files.map((file) => file.relativePath),
      hardLimit: budget.hard,
      targetChars: budget.target,
      currentMonth: `${date.slice(0, 7)}`,
      sourceHashes: Object.fromEntries(files.map((file) => [file.relativePath, file.sha256])),
      protectedUnitIds: files.flatMap((file) => file.units.filter((unit) => unit.protected).map((unit) => unit.id))
    })]
  };
}

function candidateDescriptor(repoRoot, reviewDir, sourcePath, metadata) {
  const sourceName = path.basename(sourcePath).replace(/\.md$/i, "");
  const outputDir = path.join(path.isAbsolute(reviewDir) ? reviewDir : path.join(repoRoot, reviewDir), sourceName);
  const fileName = path.basename(metadata.targetPath).replace(/\.md$/i, ".compressed.md");
  return {
    sourcePath,
    directory: path.relative(repoRoot, outputDir).split(path.sep).join("/"),
    candidatePath: path.relative(repoRoot, path.join(outputDir, fileName)).split(path.sep).join("/"),
    metadataPath: path.relative(repoRoot, path.join(outputDir, METADATA_FILE)).split(path.sep).join("/"),
    comparisonPath: path.relative(repoRoot, path.join(outputDir, comparisonName(metadata))).split(path.sep).join("/"),
    metadata
  };
}

function budgetForAge(age) {
  return { age, hard: annualHardLimit(age), target: annualTargetLimit(age) };
}

async function readActiveMemoryFiles(repoRoot, currentMonth) {
  const root = path.join(repoRoot, MEMORY_ROOT);
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const quarter = entry.name.match(/^(\d{4})-Q([1-4])\.memory\.md$/);
    const year = entry.name.match(/^(\d{4})\.memory\.md$/);
    if (!quarter && !year) continue;
    const relativePath = `${MEMORY_ROOT}/${entry.name}`;
    const absolutePath = path.join(repoRoot, relativePath);
    const content = await readFile(absolutePath, "utf8");
    files.push({
      relativePath,
      absolutePath,
      name: entry.name,
      year: Number((quarter ?? year)[1]),
      kind: quarter ? "quarter" : "year",
      chars: countMemoryChars(content),
      sha256: sha256(content),
      units: parseMemoryUnits(content, relativePath, currentMonth)
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function parseMemoryUnits(content, sourcePath, currentMonth) {
  const lines = String(content).replace(/\r\n?/g, "\n").split("\n");
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim() });
  }
  const units = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (heading.level !== 2) continue;
    const next = headings.find((candidate) => candidate.index > heading.index && candidate.level <= 2);
    const end = next?.index ?? lines.length;
    const period = parsePeriod(heading.title);
    if (heading.title === "候选观察池") {
      units.push(...parseBulletUnits(lines, heading.index + 1, end, sourcePath, null));
    } else if (period) {
      const bullets = parseBulletUnits(lines, heading.index + 1, end, sourcePath, period);
      units.push(...(bullets.length ? bullets : [makeUnit(lines, heading.index, end, sourcePath, period, "block") ]));
    } else {
      const bullets = parseBulletUnits(lines, heading.index + 1, end, sourcePath, null);
      units.push(...(bullets.length ? bullets : [makeUnit(lines, heading.index, end, sourcePath, null, "unclassified-block") ]));
    }
  }
  return units.map((unit) => {
    const protectedUnit = isProtectedUnit(unit, currentMonth);
    return { ...unit, protected: protectedUnit, eligible: !protectedUnit };
  });
}

function parseBulletUnits(lines, start, end, sourcePath, defaultPeriod) {
  const units = [];
  let current = null;
  const flush = (lastLine) => {
    if (!current) return;
    units.push(makeUnit(lines, current.start, lastLine, sourcePath, current.period, "bullet"));
    current = null;
  };
  for (let index = start; index < end; index += 1) {
    if (current && /^\s*#{1,6}\s+/.test(lines[index])) flush(index);
    const match = lines[index].match(/^\s*[-*+]\s+(.+)$/);
    if (match) {
      flush(index);
      current = { start: index, period: sourcePeriods(match[1], defaultPeriod) };
    }
  }
  flush(end);
  return units;
}

function makeUnit(lines, start, end, sourcePath, period, kind) {
  const text = lines.slice(start, end).join("\n").trim();
  return {
    id: `${sourcePath}:${start + 1}-${end}`,
    sourcePath,
    startLine: start + 1,
    endLine: end,
    kind,
    text,
    chars: countMemoryChars(text),
    period
  };
}

function sourcePeriods(text, defaultPeriod) {
  const matches = [...String(text).matchAll(/\[(?:Monthly｜)?(\d{4})-(?:W(\d{1,2})|(\d{1,2}))[^\]]*\]/g)];
  if (!matches.length) return defaultPeriod;
  return matches.map((match) => periodFromTag(match));
}

function periodFromTag(match) {
  const year = Number(match[1]);
  if (match[2]) return parsePeriod(`${year}-W${String(Number(match[2])).padStart(2, "0")}`);
  return parsePeriod(`Monthly｜${year}-${String(Number(match[3])).padStart(2, "0")}`);
}

function parsePeriod(title) {
  const weekly = String(title).match(/^(\d{4})-W(\d{1,2})$/);
  if (weekly) {
    const start = isoWeekStart(Number(weekly[1]), Number(weekly[2]));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { kind: "weekly", year: Number(weekly[1]), week: Number(weekly[2]), start: dateOnly(start), end: dateOnly(end) };
  }
  const monthly = String(title).match(/^Monthly｜(\d{4})-(\d{2})$/);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { kind: "monthly", year, month, start: dateOnly(start), end: dateOnly(end) };
  }
  const yearly = String(title).match(/^Yearly｜(\d{4})$/);
  if (yearly) return { kind: "yearly", year: Number(yearly[1]), start: `${yearly[1]}-01-01`, end: `${yearly[1]}-12-31` };
  return null;
}

function isProtectedUnit(unit, currentMonth) {
  if (!unit.period) return true;
  const periods = Array.isArray(unit.period) ? unit.period : [unit.period];
  return periods.some((period) => period === null || overlapsCurrentMonth(period, currentMonth));
}

function overlapsCurrentMonth(period, currentMonth) {
  if (!currentMonth) return false;
  const start = `${currentMonth}-01`;
  const endDate = new Date(`${currentMonth}-01T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  const end = dateOnly(endDate);
  return period.start <= end && period.end >= start;
}

function summarizeUnit(unit) {
  return { id: unit.id, sourcePath: unit.sourcePath, lines: [unit.startLine, unit.endLine], chars: unit.chars, kind: unit.kind, period: unit.period };
}

function summarizeFile(file) {
  return { path: file.relativePath, year: file.year, kind: file.kind, chars: file.chars, sha256: file.sha256, unitCount: file.units.length };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function dateOnly(date) { return date.toISOString().slice(0, 10); }

function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return start;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function candidateFilesAt(candidatePath) {
  try {
    const details = await stat(candidatePath);
    if (details.isFile()) return candidatePath.endsWith(".memory.compressed.md") ? [candidatePath] : [];
    if (details.isDirectory()) {
      const entries = await readdir(candidatePath, { withFileTypes: true });
      const nested = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const child = path.join(candidatePath, entry.name);
        if (entry.isFile() && entry.name.endsWith(".memory.compressed.md")) nested.push(child);
        if (entry.isDirectory()) nested.push(...await candidateFilesAt(child));
      }
      return nested;
    }
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return [];
}

async function validateCandidateFile(repoRoot, candidatePath) {
  const activeMemoryRoot = path.resolve(repoRoot, MEMORY_ROOT);
  const relativeToActiveMemory = path.relative(activeMemoryRoot, candidatePath);
  if (relativeToActiveMemory === "" || (!relativeToActiveMemory.startsWith("..") && !path.isAbsolute(relativeToActiveMemory))) {
    throw new Error("Candidates must stay outside 01_core/memory/.");
  }
  const candidatePathRelative = path.relative(repoRoot, candidatePath).split(path.sep).join("/");
  try {
    const candidate = await readFile(candidatePath, "utf8");
    const metadata = await readCandidateMetadata(candidatePath, candidate);
    validateMetadata(metadata);
    const body = metadata.legacy ? stripMetadata(candidate) : candidate;
    const sourcePaths = metadata.sourcePaths;
    const sources = [];
    for (const relativePath of sourcePaths) {
      const absolutePath = path.join(repoRoot, relativePath);
      const content = await readFile(absolutePath, "utf8");
      sources.push({ relativePath, absolutePath, content, sha256: sha256(content), expectedSha256: metadata.sourceHashes[relativePath] });
    }
    const stale = sources.some((source) => source.sha256 !== source.expectedSha256);
    const unitAudit = sources.flatMap((source) => parseMemoryUnits(source.content, source.relativePath, metadata.currentMonth).map((unit) => {
      const base = { id: unit.id, sourcePath: unit.sourcePath, lines: [unit.startLine, unit.endLine], chars: unit.chars, text: unit.text, period: unit.period, protected: unit.protected };
      if (body.includes(unit.text)) return { ...base, category: "retained" };
      const tags = String(unit.text).match(/\[[^\]]+\]/g) ?? [];
      return { ...base, category: tags.some((tag) => body.includes(tag)) ? "merged_or_changed" : "removed_or_unclassified" };
    }));
    const protectedMissing = unitAudit.filter((unit) => unit.protected && unit.category !== "retained").map((unit) => unit.id);
    return {
      candidatePath: candidatePathRelative,
      comparisonPath: path.join(path.dirname(candidatePath), comparisonName(metadata)),
      metadata,
      body,
      chars: countMemoryChars(body),
      sources,
      unitAudit,
      stale,
      protectedMissing,
      protectedOk: protectedMissing.length === 0,
      coreDifferencesOk: hasCoreDifferences(metadata),
      otherChangesOk: hasOtherChanges(metadata),
      hardLimitOk: countMemoryChars(body) <= Number(metadata.hardLimit),
      targetOk: countMemoryChars(body) <= Number(metadata.targetChars)
    };
  } catch (error) {
    return {
      candidatePath: candidatePathRelative,
      comparisonPath: path.join(path.dirname(candidatePath), "memory.comparison.md"),
      metadata: null,
      body: "",
      chars: 0,
      sources: [],
      unitAudit: [],
      stale: false,
      protectedMissing: [],
      protectedOk: false,
      coreDifferencesOk: false,
      otherChangesOk: false,
      hardLimitOk: false,
      targetOk: false,
      formatError: error.message
    };
  }
}

function aggregateValidation(entries) {
  const first = entries[0];
  const metadata = first.metadata ?? {};
  const formatOk = entries.every((entry) => !entry.formatError);
  const stale = entries.some((entry) => entry.stale);
  const protectedOk = entries.every((entry) => entry.protectedOk);
  const coreDifferencesOk = entries.every((entry) => entry.coreDifferencesOk);
  const otherChangesOk = entries.every((entry) => entry.otherChangesOk);
  let totalChars = entries.reduce((sum, entry) => sum + entry.chars, 0);
  if (metadata.mode === "current-year") {
    const candidateBySource = new Map(entries.flatMap((entry) => entry.sources.map((source) => [source.relativePath, entry])));
    totalChars = (metadata.currentYearSources ?? metadata.sourcePaths).reduce((sum, relativePath) => {
      const entry = candidateBySource.get(relativePath);
      return sum + (entry ? entry.chars : Number(metadata.currentYearSourceChars?.[relativePath] ?? 0));
    }, 0);
  }
  const hardLimitOk = totalChars <= Number(metadata.hardLimit);
  const targetOk = totalChars <= Number(metadata.targetChars);
  const expectedSources = formatOk && metadata.mode === "current-year" ? new Set(metadata.currentYearSources) : null;
  const actualSources = new Set(entries.flatMap((entry) => entry.sources.map((source) => source.relativePath)));
  const candidateCoverageOk = formatOk && (!expectedSources || [...expectedSources].every((source) => actualSources.has(source)));
  const status = stale ? "stale" : !formatOk || !hardLimitOk || !protectedOk || !candidateCoverageOk || !coreDifferencesOk || !otherChangesOk ? "needs_review" : targetOk ? "ready" : "needs_review";
  return {
    status,
    asOf: metadata.asOf,
    mode: metadata.mode,
    formatOk,
    totalChars,
    targetChars: Number(metadata.targetChars),
    hardLimit: Number(metadata.hardLimit),
    hardLimitOk,
    targetOk,
    protectedOk,
    candidateCoverageOk,
    coreDifferencesOk,
    otherChangesOk,
    stale,
    entries,
    unitAudit: entries.flatMap((entry) => entry.unitAudit),
    removedOrChangedUnits: entries.flatMap((entry) => entry.protectedMissing),
    uncertain: !formatOk || !targetOk || !protectedOk || !candidateCoverageOk || !coreDifferencesOk || !otherChangesOk || stale
  };
}

function renderComparisonReport(result) {
  const sourceChars = result.entries.reduce((sum, entry) => sum + entry.sources.reduce((inner, source) => inner + countMemoryChars(source.content), 0), 0);
  const ratio = sourceChars ? `${((1 - result.totalChars / sourceChars) * 100).toFixed(1)}%` : "n/a";
  const readable = (value) => (String(value ?? "未提供").replace(/\s+/g, " ").replaceAll("|", "｜").trim() || "未提供");
  const allCoreDifferences = result.entries.flatMap((entry) => (entry.metadata?.coreDifferences ?? []).map((difference) => {
    const originalChars = countMemoryChars(difference.original);
    const candidateChars = countMemoryChars(difference.candidate);
    return {
      ...difference,
      sourceFile: path.basename(entry.metadata?.targetPath ?? entry.candidatePath),
      originalChars,
      candidateChars,
      deltaChars: originalChars - candidateChars,
      ...measureTextChange(difference.original, difference.candidate)
    };
  })).sort((left, right) => {
    const reduction = Math.max(0, right.deltaChars) - Math.max(0, left.deltaChars);
    return reduction || Math.abs(right.deltaChars) - Math.abs(left.deltaChars);
  });
  const coreDifferences = allCoreDifferences.filter((difference) => difference.changedChars > 10);
  const smallCoreDifferences = allCoreDifferences.filter((difference) => difference.changedChars <= 10);
  const semanticRows = coreDifferences.length
    ? coreDifferences.map((difference, index) => {
      const delta = difference.deltaChars === 0 ? "净变化 0" : difference.deltaChars > 0 ? `净减少 ${difference.deltaChars}` : `净增加 ${Math.abs(difference.deltaChars)}`;
      return `| ${index + 1} | ${readable(difference.topic)} | ${difference.originalChars} → ${difference.candidateChars}（${delta}；实际改动 ${difference.changedChars}） | ${readable(difference.original)} | ${readable(difference.candidate)} |`;
    })
    : ["| — | 未提供 | — | 未提供核心变化，必须补充后才能晋级。 | — |"];
  const fileChanges = result.entries.map((entry) => {
    const originalChars = entry.sources.reduce((sum, source) => sum + countMemoryChars(source.content), 0);
    const core = coreDifferences.filter((difference) => difference.sourceFile === path.basename(entry.metadata?.targetPath ?? entry.candidatePath));
    const coreOriginalChars = core.reduce((sum, difference) => sum + difference.originalChars, 0);
    const coreCandidateChars = core.reduce((sum, difference) => sum + difference.candidateChars, 0);
    return {
      name: path.basename(entry.candidatePath),
      originalChars,
      candidateChars: entry.chars,
      delta: originalChars - entry.chars,
      coreOriginalChars,
      coreCandidateChars,
      coreDelta: coreOriginalChars - coreCandidateChars,
      residualDelta: (originalChars - entry.chars) - (coreOriginalChars - coreCandidateChars),
      coreCount: core.length
    };
  }).sort((left, right) => right.delta - left.delta);
  const coreOriginalChars = coreDifferences.reduce((sum, difference) => sum + difference.originalChars, 0);
  const coreCandidateChars = coreDifferences.reduce((sum, difference) => sum + difference.candidateChars, 0);
  const coreDelta = coreOriginalChars - coreCandidateChars;
  const scopeChange = fileChanges[0] ?? {};
  const protectedUnits = result.unitAudit.filter((unit) => unit.protected);
  const protectedRows = protectedUnits.map((unit) => {
    const periods = (Array.isArray(unit.period) ? unit.period : [unit.period]).filter(Boolean);
    const periodLabel = periods.map((period) => period.kind === "weekly"
      ? `${period.year}-W${String(period.week).padStart(2, "0")}`
      : period.kind === "monthly" ? `Monthly｜${period.year}-${String(period.month).padStart(2, "0")}` : `${period.year}`
    ).join("、") || "未识别来源";
    const reason = periods.length && periods.some((period) => overlapsCurrentMonth(period, String(result.asOf ?? "").slice(0, 7)))
      ? "当前月或跨月周块"
      : "无法识别来源，默认保护";
    return `| \`${path.basename(unit.sourcePath)}:${unit.lines[0]}-${unit.lines[1]}\` | ${periodLabel} | ${unit.chars} | ${reason} |`;
  });
  const scopeLabel = path.basename(result.entries[0]?.metadata?.targetPath ?? scopeChange.name ?? "当前文件").replace(/\.memory\.md$/i, "");
  const reportCandidateChars = result.totalChars;
  const reportSourceChars = sourceChars;
  const aggregateCandidateChars = result.aggregateTotalChars ?? reportCandidateChars;
  const aggregateSourceChars = result.aggregateSourceChars ?? reportSourceChars;
  const otherChanges = (result.entries[0]?.metadata?.otherChanges ?? []).map((change) => ({
    ...change,
    originalChars: countMemoryChars(change.before),
    candidateChars: countMemoryChars(change.after),
    deltaChars: countMemoryChars(change.before) - countMemoryChars(change.after),
    ...measureTextChange(change.before, change.after)
  })).sort((left, right) => Math.max(0, right.deltaChars) - Math.max(0, left.deltaChars) || right.changedChars - left.changedChars);
  const smallSemanticChanges = [
    ...smallCoreDifferences.map((change) => ({ ...change, source: "核心变化" })),
    ...otherChanges.filter((change) => change.changedChars <= 10).map((change) => ({ ...change, source: "其他压缩概览" }))
  ];
  const otherChangesForDisplay = otherChanges.filter((change) => change.changedChars > 10);
  const otherChangesSection = otherChangesForDisplay.length
    ? [
      `## 其他压缩内容概览（约 ${scopeChange.residualDelta ?? 0} 字差额）`,
      "",
      "> 这一节不是新的核心点，而是解释整份文件中没有进入上面核心表的部分：原来包含什么、候选如何收束，以及保留下来的代表性内容。差额是总量减去核心摘要字数，不等于已确认删除。",
      "",
      ...otherChangesForDisplay.flatMap((change, index) => [
        `### ${index + 1}. ${readable(change.topic)}（${change.originalChars} → ${change.candidateChars} 字，${change.deltaChars >= 0 ? `净减少 ${change.deltaChars}` : `净增加 ${Math.abs(change.deltaChars)}`}；实际改动 ${change.changedChars} 字）`,
        `- 原来：${readable(change.before)}`,
        `- 现在：${readable(change.after)}`,
        `- 具体例子：${readable(change.examples)}`,
        ""
      ])
    ]
    : [
      "## 其他压缩内容概览",
      "",
      `> 其余语义变化均不超过 10 字，已在“其他变化归类”中汇总；本文件仍有约 ${scopeChange.residualDelta ?? 0} 字未纳入核心表。`,
      ""
    ];
  const changedUnits = result.unitAudit.filter((unit) => unit.category !== "retained");
  const changeType = (unit) => unit.category === "merged_or_changed" ? "压缩 / 合并 / 改动" : "删除候选 / 未找到对应";
  const groupedChangeRows = (units) => ["merged_or_changed", "removed_or_unclassified"].flatMap((category) => {
    const matching = units.filter((unit) => unit.category === category).sort((left, right) => right.chars - left.chars);
    if (!matching.length) return [];
    return [{
      type: changeType(matching[0]),
      count: matching.length,
      chars: matching.reduce((sum, unit) => sum + unit.chars, 0),
      examples: matching.slice(0, 3).map((unit) => `${path.basename(unit.sourcePath)}:${unit.lines[0]}-${unit.lines[1]}（${unit.chars}字）`).join("、")
    }];
  });
  const smallChangeRows = smallSemanticChanges.length
    ? [{
      type: "语义对比中小于等于 10 字的变化",
      count: smallSemanticChanges.length,
      chars: smallSemanticChanges.reduce((sum, change) => sum + change.changedChars, 0),
      examples: smallSemanticChanges.map((change) => `${readable(change.topic)}（${change.source}）`).join("、")
    }]
    : [];
  const otherLargeChangeRows = groupedChangeRows(changedUnits);
  const changeStats = [
    `语义对比中实际改动小于等于10字的变化 ${smallChangeRows.reduce((sum, row) => sum + row.count, 0)} 条、已归类`,
    `未逐字保留的原文单元 ${otherLargeChangeRows.reduce((sum, row) => sum + row.count, 0)} 个、涉及 ${otherLargeChangeRows.reduce((sum, row) => sum + row.chars, 0)} 字`
  ];
  const lines = [
    `# Learn-X Memory 压缩比较｜${result.asOf}`,
    "",
    "## 核心变化（先看这里）",
    "",
    `> ${scopeLabel} 整份文件实际为 ${scopeChange.originalChars ?? 0} → ${scopeChange.candidateChars ?? 0} 字，减少 ${scopeChange.delta ?? 0} 字。本节精选 ${coreDifferences.length} 条代表性核心变化；不是把所有碎片都列出来。`,
    `> 其余变化：${changeStats.join("；")}。核心表用“实际改动量”筛选，排序优先看净减少；分类字数是受影响的原文字符数，不能与整份文件实际减少量相加。`,
    "",
    "### 核心变化（按净减少字数优先、实际改动量其次排序）",
    "",
    "| 排序 | 核心点 | 字数变化 | 之前是什么 | 现在是什么 |",
    "| ---: | --- | ---: | --- | --- |",
    ...semanticRows,
    "",
    "## 保护范围",
    "",
    "> 以下内容不会被压缩：当前月、跨越当前月的周块，以及无法识别来源的条目。",
    "",
    "| 来源 | 识别到的周期 | 字数 | 保护原因 |",
    "| --- | --- | ---: | --- |",
    ...(protectedRows.length ? protectedRows : ["| 无 | — | 0 | 本文件没有当前月、跨月周块或未知来源单元 |"]),
    "",
    "## 其他变化归类",
    "",
    "> 实际改动量小于等于 10 字的变化不逐条展开；未逐字保留的其他内容也只按类型汇总。这样可以看到压缩范围和主要来源，同时避免把报告变成碎片清单。删除候选仍需人工确认。",
    "",
    "### 小于等于10字：统一归类",
    "",
    "| 类型 | 单元数 | 实际改动字数 | 代表来源 |",
    "| --- | ---: | ---: | --- |",
    ...(smallChangeRows.length ? smallChangeRows.map((row) => `| ${row.type} | ${row.count} | ${row.chars} | ${row.examples} |`) : ["| 无 | 0 | 0 | — |"]),
    "",
    "### 未逐字保留的其他内容：归类",
    "",
    "| 类型 | 单元数 | 涉及原文字数 | 最大变化来源（最多 3 个） |",
    "| --- | ---: | ---: | --- |",
    ...(otherLargeChangeRows.length ? otherLargeChangeRows.map((row) => `| ${row.type} | ${row.count} | ${row.chars} | ${row.examples} |`) : ["| 无 | 0 | 0 | — |"]),
    "",
    "## 整体压缩量（单独计算）",
    "",
    `> 这里回答“整份文件实际少了多少字”。${scopeLabel}：${scopeChange.originalChars ?? 0} → ${scopeChange.candidateChars ?? 0} 字，实际减少 ${scopeChange.delta ?? 0} 字；${scopeLabel} 对应的 ${scopeChange.coreCount ?? 0} 个核心点说明为 ${scopeChange.coreOriginalChars ?? 0} → ${scopeChange.coreCandidateChars ?? 0} 字，减少 ${scopeChange.coreDelta ?? 0} 字。本报告核心点说明合计减少 ${coreDelta} 字。两者口径不同，不能相加或互相替代。`,
    "",
    "| 文件 | 整份文件：之前 → 现在 | 实际减少 | 核心表说明：之前 → 现在 | 核心表减少 | 未纳入核心表的差额* |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...fileChanges.map((change) => `| ${change.name} | ${change.originalChars} → ${change.candidateChars} | **${change.delta}** | ${change.coreOriginalChars} → ${change.coreCandidateChars} | ${change.coreDelta} | ${change.residualDelta} |`),
    "",
    "> *“未纳入核心表的差额”只是总量与核心说明字数的算术差，不等于已确认删除；它代表未被核心摘要覆盖的重复表达、非核心内容、结构和来源文本等变化，具体审计见报告末尾。",
    "",
    ...otherChangesSection,
    "## 量化校验",
    "",
    `- 状态：**${result.status}**`,
    `- 模式：${result.mode}`,
    `- 本报告候选字符数：${reportCandidateChars}`,
    `- 本报告源字符数：${reportSourceChars}`,
    `- 当前年度合计：${aggregateSourceChars} → ${aggregateCandidateChars} 字，减少 ${aggregateSourceChars - aggregateCandidateChars} 字`,
    `- 本报告压缩比例：${ratio}`,
    `- 工作目标：${result.targetChars}`,
    `- 硬上限：${result.hardLimit}`,
    `- 保护内容：${result.protectedOk ? "通过" : `缺失 ${result.removedOrChangedUnits.length} 个保护单元`}`,
    `- 候选覆盖：${result.candidateCoverageOk ? "通过" : "缺少需要一起晋级的源文件候选"}`,
    `- 核心变化摘要：${result.coreDifferencesOk ? "已提供" : "缺失或不完整"}`,
    `- 其他压缩概览：${result.otherChangesOk ? "已提供" : "缺失或不完整"}`,
    `- 源文件校验：${result.stale ? "stale：源文件已变化" : "通过"}`,
    "- 候选正文：不嵌入校验注释；技术元数据保存在同目录 `.memory-compression.json`。",
    "",
    "## 文件对比",
    "",
    ...result.entries.map((entry) => `- 候选：\`${entry.candidatePath}\`；源：${entry.sources.map((source) => `\`${source.relativePath}\`（${countMemoryChars(source.content)} 字，SHA-256 ${source.sha256}）`).join("、")}；候选 ${entry.chars} 字。`),
    "",
    "## 辅助统计：文件级变化",
    "",
    "### 文件字数变化（按减少字数排序）",
    "",
    "| 排名 | 文件 | 原文字符 | 候选字符 | 减少字符 | 减少比例 |",
    "| ---: | --- | ---: | ---: | ---: | ---: |",
    ...fileChanges.map((change, index) => `| ${index + 1} | \`${change.name}\` | ${change.originalChars} | ${change.candidateChars} | ${change.delta} | ${change.originalChars ? ((change.delta / change.originalChars) * 100).toFixed(1) : "n/a"}% |`),
    "",
    "## 需要人工判断",
    "",
    result.removedOrChangedUnits.length
      ? result.removedOrChangedUnits.map((id) => `- 保护内容未能逐字匹配：\`${id}\``).join("\n")
      : "- 校验器未发现保护内容缺失；这不等于内容等价已被自动证明。",
    "- 请人工检查独立判断、限定、反例、反转、隐喻和行动边界。",
    "- 对不确定的合并或删除，在本报告中补充问题与保留建议。"
  ];
  return `${lines.join("\n")}\n`;
}

function readMetadata(content) {
  const line = String(content).split("\n", 1)[0];
  if (!line.startsWith(METADATA_PREFIX) || !line.endsWith(METADATA_SUFFIX)) throw new Error("Candidate metadata is missing or invalid.");
  return JSON.parse(line.slice(METADATA_PREFIX.length, -METADATA_SUFFIX.length));
}

async function readCandidateMetadata(candidatePath, candidateContent) {
  const metadataPath = path.join(path.dirname(candidatePath), METADATA_FILE);
  try {
    return { ...(JSON.parse(await readFile(metadataPath, "utf8"))), legacy: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...readMetadata(candidateContent), legacy: true };
  }
}

function hasCoreDifferences(metadata) {
  return Array.isArray(metadata?.coreDifferences) && metadata.coreDifferences.length >= 5 && metadata.coreDifferences.length <= 10 && metadata.coreDifferences.every((difference) => (
    difference && typeof difference === "object" &&
    ["topic", "original", "candidate", "kind", "action", "review"].every((field) => typeof difference[field] === "string" && difference[field].trim())
  ));
}

function hasOtherChanges(metadata) {
  return Array.isArray(metadata?.otherChanges) && metadata.otherChanges.length > 0 && metadata.otherChanges.every((change) => (
    change && typeof change === "object" &&
    ["topic", "before", "after", "examples"].every((field) => typeof change[field] === "string" && change[field].trim())
  ));
}

function validateMetadata(metadata) {
  if (!metadata || !["current-year", "annualize"].includes(metadata.mode)) throw new Error("Candidate mode is invalid.");
  if (typeof metadata.operationId !== "string" || !metadata.operationId) throw new Error("Candidate operationId is missing.");
  if (typeof metadata.asOf !== "string") throw new Error("Candidate asOf is missing.");
  const asOf = parseAsOf(metadata.asOf);
  if (typeof metadata.targetPath !== "string" || !isMemoryPath(metadata.targetPath)) throw new Error("Candidate targetPath is invalid.");
  if (!Array.isArray(metadata.sourcePaths) || !metadata.sourcePaths.length || metadata.sourcePaths.some((source) => !isMemoryPath(source))) {
    throw new Error("Candidate sourcePaths are invalid.");
  }
  if (new Set(metadata.sourcePaths).size !== metadata.sourcePaths.length) throw new Error("Candidate sourcePaths contain duplicates.");
  if (!metadata.sourceHashes || metadata.sourcePaths.some((source) => !/^[a-f0-9]{64}$/.test(metadata.sourceHashes[source] ?? ""))) {
    throw new Error("Candidate sourceHashes are missing or invalid.");
  }
  if (!Number.isInteger(metadata.hardLimit) || !Number.isInteger(metadata.targetChars) || metadata.hardLimit < 200 || metadata.targetChars < 200) {
    throw new Error("Candidate budget is invalid.");
  }
  if (typeof metadata.currentMonth !== "string" || metadata.currentMonth !== asOf.slice(0, 7)) throw new Error("Candidate currentMonth is invalid.");
  if (!Array.isArray(metadata.protectedUnitIds)) throw new Error("Candidate protectedUnitIds are missing.");
  const targetYear = Number(path.basename(metadata.targetPath).match(/^(\d{4})/)?.[1]);
  if (!Number.isInteger(targetYear) || targetYear > Number(asOf.slice(0, 4))) throw new Error("Candidate target year is invalid.");
  const age = Math.max(0, Number(asOf.slice(0, 4)) - targetYear);
  if (metadata.hardLimit !== annualHardLimit(age) || metadata.targetChars !== annualTargetLimit(age)) throw new Error("Candidate budget does not match its age.");
  if (metadata.mode === "current-year") {
    if (targetYear !== Number(asOf.slice(0, 4)) || !/^\d{4}-Q[1-4]\.memory\.md$/.test(path.basename(metadata.targetPath)) || metadata.sourcePaths.length !== 1 || metadata.sourcePaths[0] !== metadata.targetPath) {
      throw new Error("Current-year candidate must target exactly one quarter source.");
    }
    if (!Array.isArray(metadata.currentYearSources) || !metadata.currentYearSources.length || metadata.currentYearSources.some((source) => !isMemoryPath(source))) {
      throw new Error("Candidate currentYearSources are invalid.");
    }
    if (!metadata.currentYearSources.includes(metadata.targetPath)) throw new Error("Candidate target is not in currentYearSources.");
    if (!metadata.currentYearSourceChars || metadata.currentYearSources.some((source) => !Number.isInteger(metadata.currentYearSourceChars[source]))) {
      throw new Error("Candidate currentYearSourceChars are invalid.");
    }
  } else if (targetYear === Number(asOf.slice(0, 4)) || !/^\d{4}\.memory\.md$/.test(path.basename(metadata.targetPath))) {
    throw new Error("Annual candidate must target a yearly memory file.");
  }
}

function isMemoryPath(value) {
  return new RegExp(`^${MEMORY_ROOT}/(?:\\d{4}-Q[1-4]|\\d{4})\\.memory\\.md$`).test(String(value));
}

function stripMetadata(content) {
  return String(content).replace(/^<!-- learn-x-memory-compression: .*? -->\n?\n?/s, "");
}

function comparisonName(metadata) {
  const target = path.basename(metadata.targetPath ?? metadata.sourcePath ?? "memory");
  return target.replace(/\.md$/i, ".comparison.md");
}

function sanitizeValidation(result) {
  return {
    ...result,
    entries: result.entries.map(({ body, sources, unitAudit, ...entry }) => ({
      ...entry,
      unitAudit: unitAudit.map(({ text, ...unit }) => unit),
      sources: sources.map(({ content, ...source }) => source)
    })),
    unitAudit: result.unitAudit.map(({ text, ...unit }) => unit)
  };
}

async function inspectCandidateStatus(repoRoot, candidatePath) {
  try {
    const candidate = await readFile(candidatePath, "utf8");
    const metadata = await readCandidateMetadata(candidatePath, candidate);
    validateMetadata(metadata);
    for (const relativePath of metadata.sourcePaths) {
      const source = await readFile(path.join(repoRoot, relativePath), "utf8");
      if (sha256(source) !== metadata.sourceHashes[relativePath]) return "stale";
    }
    return "pending";
  } catch {
    return "needs_review";
  }
}

async function exists(filePath) {
  try { await stat(filePath); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

async function verifyText(filePath, expected) {
  const actual = await readFile(filePath, "utf8");
  if (actual !== expected) throw new Error(`Readback verification failed: ${filePath}`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--as-of") options.asOf = argv[++index];
    else if (arg === "--validate") options.validate = argv[++index];
    else if (arg === "--promote") options.promote = argv[++index];
    else if (arg === "--confirm") options.confirm = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.validate) {
    console.log(JSON.stringify(await validateMemoryCompression({ candidatePath: options.validate }), null, 2));
  } else if (options.promote) {
    console.log(JSON.stringify(await promoteMemoryCompression({ candidatePath: options.promote, confirm: options.confirm }), null, 2));
  } else {
    console.log(JSON.stringify(await planMemoryCompression({ asOf: options.asOf }), null, 2));
  }
}

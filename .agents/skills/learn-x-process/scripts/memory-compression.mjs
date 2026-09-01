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
      coreDifferencesOk: entry.coreDifferencesOk,
      otherChangesOk: entry.otherChangesOk,
      changeSummaryOk: entry.changeSummaryOk
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
  if (!validation.formatOk || !validation.hardLimitOk || !validation.protectedOk || !validation.candidateCoverageOk || !validation.coreDifferencesOk || !validation.otherChangesOk || !validation.changeSummaryOk) {
    throw new Error("Candidate failed format, hard-limit, protected-content, coverage, core-differences, other-changes, or AI change-summary validation.");
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
      units.push(...parseBulletUnits(lines, heading.index + 1, end, sourcePath, null, heading.title));
    } else if (period) {
      const bullets = parseBulletUnits(lines, heading.index + 1, end, sourcePath, period, heading.title);
      units.push(...(bullets.length ? bullets : [makeUnit(lines, heading.index, end, sourcePath, period, "block", heading.title) ]));
    } else {
      const bullets = parseBulletUnits(lines, heading.index + 1, end, sourcePath, null, heading.title);
      units.push(...(bullets.length ? bullets : [makeUnit(lines, heading.index, end, sourcePath, null, "unclassified-block", heading.title) ]));
    }
  }
  return units.map((unit) => {
    const protectedUnit = isProtectedUnit(unit, currentMonth);
    return { ...unit, protected: protectedUnit, eligible: !protectedUnit };
  });
}

function parseBulletUnits(lines, start, end, sourcePath, defaultPeriod, defaultSection) {
  const units = [];
  let current = null;
  let section = defaultSection;
  const flush = (lastLine) => {
    if (!current) return;
    units.push(makeUnit(lines, current.start, lastLine, sourcePath, current.period, "bullet", current.section));
    current = null;
  };
  for (let index = start; index < end; index += 1) {
    const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flush(index);
      if (heading[1].length >= 3) section = heading[2].trim();
    }
    const match = lines[index].match(/^\s*[-*+]\s+(.+)$/);
    if (match) {
      flush(index);
      current = { start: index, period: sourcePeriods(match[1], defaultPeriod), section };
    }
  }
  flush(end);
  return units;
}

function makeUnit(lines, start, end, sourcePath, period, kind, section) {
  const text = lines.slice(start, end).join("\n").trim();
  return {
    id: `${sourcePath}:${start + 1}-${end}`,
    sourcePath,
    startLine: start + 1,
    endLine: end,
    kind,
    text,
    chars: countMemoryChars(text),
    period,
    section
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
      const base = { id: unit.id, sourcePath: unit.sourcePath, lines: [unit.startLine, unit.endLine], chars: unit.chars, text: unit.text, period: unit.period, section: unit.section, protected: unit.protected };
      if (body.includes(unit.text)) return { ...base, category: "retained" };
      const tags = String(unit.text).match(/\[[^\]]+\]/g) ?? [];
      const periods = (Array.isArray(unit.period) ? unit.period : [unit.period]).filter(Boolean);
      const periodTags = periods.flatMap((period) => period.kind === "weekly"
        ? [`[${period.year}-W${String(period.week).padStart(2, "0")}]`]
        : period.kind === "monthly" ? [`[Monthly｜${period.year}-${String(period.month).padStart(2, "0")}]`] : []);
      const hasTrace = [...tags, ...periodTags].some((tag) => body.includes(tag));
      return { ...base, category: hasTrace ? "represented_by_trace" : "removed_or_unclassified" };
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
      changeSummaryOk: hasChangeSummary(metadata),
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
      changeSummaryOk: false,
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
  const changeSummaryOk = entries.every((entry) => entry.changeSummaryOk);
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
  const status = stale ? "stale" : !formatOk || !hardLimitOk || !protectedOk || !candidateCoverageOk || !coreDifferencesOk || !otherChangesOk || !changeSummaryOk ? "needs_review" : targetOk ? "ready" : "needs_review";
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
    changeSummaryOk,
    stale,
    entries,
    unitAudit: entries.flatMap((entry) => entry.unitAudit),
    removedOrChangedUnits: entries.flatMap((entry) => entry.protectedMissing),
    uncertain: !formatOk || !targetOk || !protectedOk || !candidateCoverageOk || !coreDifferencesOk || !otherChangesOk || !changeSummaryOk || stale
  };
}

function renderComparisonReport(result) {
  const sourceChars = result.entries.reduce((sum, entry) => sum + entry.sources.reduce((inner, source) => inner + countMemoryChars(source.content), 0), 0);
  const ratio = sourceChars ? `${((1 - result.totalChars / sourceChars) * 100).toFixed(1)}%` : "n/a";
  const readable = (value) => (String(value ?? "未提供").replace(/\s+/g, " ").replaceAll("|", "｜").trim() || "未提供");
  const readableBlocks = (value) => (String(value ?? "未提供")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim() || "未提供");
  const riskScore = (risk) => ({ 高: 3, 中: 2, 低: 1 }[risk] ?? 0);
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
    const risk = riskScore(right.risk) - riskScore(left.risk);
    const reduction = Math.max(0, right.deltaChars) - Math.max(0, left.deltaChars);
    return risk || reduction || Math.abs(right.deltaChars) - Math.abs(left.deltaChars);
  });
  const coreDifferences = allCoreDifferences.filter((difference) => difference.changedChars > 10);
  const smallCoreDifferences = allCoreDifferences.filter((difference) => difference.changedChars <= 10);
  const riskLabel = (risk) => ["低", "中", "高"].includes(risk) ? risk : "需人工判断";
  const coreRiskReason = (difference) => difference.riskReason
    ?? (difference.review ? `可能遗漏：${String(difference.review).replace(/^确认\s*/, "")}` : "独立判断、限定条件或行动边界可能被合并。");
  const semanticRows = coreDifferences.length
    ? coreDifferences.map((difference, index) => {
      const delta = difference.deltaChars === 0 ? "净变化 0" : difference.deltaChars > 0 ? `净减少 ${difference.deltaChars}` : `净增加 ${Math.abs(difference.deltaChars)}`;
      return `| ${readable(difference.topic)} | 风险：${riskLabel(difference.risk ?? "中")}（${readable(coreRiskReason(difference))}）；${difference.originalChars} → ${difference.candidateChars}（${delta}；实际改动 ${difference.changedChars}） | ${readable(difference.candidate)} | ${readable(difference.original)} |`;
    })
    : ["| — | 风险：需人工判断（未提供核心变化，无法判断压缩风险）；— | — | 未提供核心变化，必须补充后才能晋级。 |"];
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
  })).sort((left, right) => riskScore(right.risk) - riskScore(left.risk) || Math.max(0, right.deltaChars) - Math.max(0, left.deltaChars) || right.changedChars - left.changedChars);
  const smallSemanticChanges = [
    ...smallCoreDifferences.map((change) => ({ ...change, source: "核心变化" })),
    ...otherChanges.filter((change) => change.changedChars <= 10).map((change) => ({ ...change, source: "其他压缩概览" }))
  ];
  const otherChangesForDisplay = otherChanges.filter((change) => change.changedChars > 10);
  const semanticChangeRows = otherChangesForDisplay.map((change) => ({
    ...change,
    category: change.category ?? "未分类语义变化",
    change: change.change ?? change.after,
    risk: riskLabel(change.risk),
    riskReason: change.riskReason ?? ({
      "教育与项目分支合并": "成人教育、儿童兴趣和项目边界可能被共同原则覆盖。",
      "过程细节压缩": "流程分工、设备边界和维护条件可能被闭环标准吞掉。",
      "一次性观察归并": "单次场景的时间、地点和上下文可能被抽象成一般原则。",
      "重复旁证合并": "重复证据被合并后，具体生活场景的独立旁证可能变薄。"
    }[change.category] ?? "改写可能丢失原文限定条件，需人工核对。"),
    examples: change.examples
  }));
  const displayedOtherOriginalChars = semanticChangeRows.reduce((sum, change) => sum + change.originalChars, 0);
  const displayedOtherCandidateChars = semanticChangeRows.reduce((sum, change) => sum + change.candidateChars, 0);
  const splitTopLevelSections = (content) => {
    const text = String(content);
    const headings = [...text.matchAll(/^## (.+)$/gm)];
    if (!headings.length) return [{ title: "文档标题", body: text }];
    return [{ title: "文档标题", body: text.slice(0, headings[0].index) }, ...headings.map((heading, index) => ({
      title: heading[1].trim(),
      body: text.slice(heading.index, headings[index + 1]?.index ?? text.length)
    }))];
  };
  const sectionTraceTag = (title) => {
    const weekly = title.match(/^(\d{4})-W(\d{2})$/);
    if (weekly) return `[${weekly[1]}-W${weekly[2]}]`;
    const monthly = title.match(/^Monthly｜(\d{4})-(\d{2})$/);
    return monthly ? `[Monthly｜${monthly[1]}-${monthly[2]}]` : "";
  };
  const sectionBreakdownForEntry = (entry) => {
    const sourceSections = splitTopLevelSections(entry.sources.map((source) => source.content).join("\n"));
    const candidateSections = splitTopLevelSections(entry.body);
    const groups = new Map();
    for (const sourceSection of sourceSections) {
      const traceTag = sectionTraceTag(sourceSection.title);
      let destinationIndexes = [];
      if (sourceSection.title === "文档标题") {
        destinationIndexes = [0];
      } else {
        destinationIndexes = candidateSections
          .map((candidateSection, index) => candidateSection.title === sourceSection.title ? index : -1)
          .filter((index) => index >= 0);
        if (!destinationIndexes.length && traceTag) {
          destinationIndexes = candidateSections
            .map((candidateSection, index) => candidateSection.title !== "候选观察池" && candidateSection.body.includes(traceTag) ? index : -1)
            .filter((index) => index >= 0);
        }
        if (!destinationIndexes.length) {
          destinationIndexes = candidateSections
            .map((candidateSection, index) => /压缩合并|压缩/.test(candidateSection.title) ? index : -1)
            .filter((index) => index >= 0);
        }
      }
      const key = destinationIndexes.join(",") || "unmatched";
      const group = groups.get(key) ?? { sourceTitles: [], destinationIndexes, sourceChars: 0 };
      group.sourceTitles.push(sourceSection.title);
      group.sourceChars += countMemoryChars(sourceSection.body);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => {
      const destinationTitles = group.destinationIndexes.map((index) => candidateSections[index]?.title).filter(Boolean);
      const candidateChars = group.destinationIndexes.reduce((sum, index) => sum + countMemoryChars(candidateSections[index]?.body ?? ""), 0);
      const unchanged = group.destinationIndexes.length > 0 && group.sourceChars === candidateChars && group.sourceTitles.every((title) => destinationTitles.includes(title));
      const isObservationPool = destinationTitles.includes("候选观察池");
      const isMerged = destinationTitles.some((title) => /压缩合并|压缩/.test(title));
      const risk = unchanged ? "低" : isMerged ? "高" : isObservationPool ? "中" : "中";
      const riskReason = unchanged
        ? "风险低：该区域未发生字数压缩，仍需确认内容没有被候选结构误放。"
        : isMerged
          ? "风险来自多个周期的独立判断、限定条件和行动边界被合并到同一候选区域。"
          : isObservationPool
            ? "风险来自观察项尚未完全验证，压缩后可能遮住原本的待验证分支。"
            : "风险来自原文区域被归入其他候选区域，具体语境可能被压缩。";
      const delta = group.sourceChars - candidateChars;
      const sourceLabel = group.sourceTitles.join("、");
      const destinationLabel = destinationTitles.join("、") || "未找到候选承接";
      const description = unchanged
        ? "保留该区域，没有从这里产生净减少。"
        : destinationTitles.includes("候选观察池")
          ? "合并重复的道、法、术和洞察候选，保留代表性判断与来源标签。"
          : isMerged
            ? "把周度与月度细节压进压缩合并区，减少重复解释、结构和来源展开。"
            : destinationTitles.some((title) => title.startsWith("Monthly｜"))
              ? "把旧周内容归入月度判断，保留周期标签，删除独立周块的重复结构。"
              : "将原文归入候选对应区域，需人工检查是否有未承接的细节。";
      return { sourceLabel, destinationLabel, sourceChars: group.sourceChars, candidateChars, delta, risk, riskReason, description };
    });
  };
  const sectionBreakdownRows = result.entries.flatMap((entry) => sectionBreakdownForEntry(entry));
  const otherChangesSection = [
    `## 非删除类变化（先按风险，再按净减少字数排序；已列明 ${semanticChangeRows.length} 类，摘要净减少 ${displayedOtherOriginalChars - displayedOtherCandidateChars} 字）`,
    "",
    "> 这里列出压缩、合并或改写的语义单元：说明具体改了什么、风险有多大，并给出例子。实际改动不超过 10 字的条目不逐条展开，统一在后面的归类表中统计。",
    "",
    "| 类别 | 字数变化（含风险及具体风险） | 改动说明 | 原文 | 压缩后 |",
    "| --- | ---: | --- | --- | --- |",
    ...(semanticChangeRows.length ? semanticChangeRows.map((change) => {
      const delta = change.deltaChars >= 0 ? `净减少 ${change.deltaChars}` : `净增加 ${Math.abs(change.deltaChars)}`;
      return `| ${readable(change.category)} | 风险：${change.risk}（${readable(change.riskReason)}）；${change.originalChars} → ${change.candidateChars}（${delta}；实际改动 ${change.changedChars}） | ${readable(change.change)} | ${readable(change.before)} | ${readable(change.after)} |`;
    }) : ["| 无 | 0 → 0 | 没有超过 10 字的非删除类变化 | — | — |"]),
    "",
    "### 整份文件减少量按内容区域拆解",
    "",
    "> 下面解释整份文件实际减少的字数来自哪里。它按候选的实际 Markdown 区域核算，和上面的核心变化摘要、语义明细不是同一套统计，不能把各表数字再次相加。",
    "",
    "| 原文区域 / 类型 | 候选承接区域 | 字数变化（风险及具体风险） | 具体减少内容 |",
    "| --- | --- | ---: | --- |",
    ...sectionBreakdownRows.map((row) => `| ${readable(row.sourceLabel)} | ${readable(row.destinationLabel)} | 风险：${row.risk}（${row.riskReason}）；${row.sourceChars} → ${row.candidateChars}（${row.delta >= 0 ? `净减少 ${row.delta}` : `净增加 ${Math.abs(row.delta)}`}） | ${row.description} |`),
    ""
  ];
  const changedUnits = result.unitAudit.filter((unit) => unit.category !== "retained");
  const candidateBodyForUnit = (unit) => result.entries.find((entry) => entry.sources.some((source) => source.relativePath === unit.sourcePath))?.body ?? "";
  const traceTagsForUnit = (unit) => {
    const periods = (Array.isArray(unit.period) ? unit.period : [unit.period]).filter(Boolean);
    return periods.flatMap((period) => period.kind === "weekly"
      ? [`[${period.year}-W${String(period.week).padStart(2, "0")}]`]
      : period.kind === "monthly" ? [`[Monthly｜${period.year}-${String(period.month).padStart(2, "0")}]`] : []);
  };
  const candidateTraceExamples = (unit) => {
    const tags = traceTagsForUnit(unit);
    if (!tags.length) return [];
    return String(candidateBodyForUnit(unit)).split("\n")
      .filter((line) => tags.some((tag) => line.includes(tag)))
      .map((line) => readable(line).slice(0, 180))
      .filter(Boolean);
  };
  const unitCategoryDetails = (unit) => {
    const section = String(unit.section ?? "");
    const text = String(unit.text ?? "");
    if (unit.category === "represented_by_trace") {
      if (section === "继续追踪" || text.includes("继续追踪")) return { key: "tracked", label: "继续追踪已归纳", risk: "高", change: "候选按同周期来源标签归入核心判断。", riskReason: "风险来自未决问题包含验证动作和时间边界；合并后可能把‘待验证’误读成‘已解决’。" };
      if (text.includes("洞察：") || section.includes("芒格")) return { key: "traced-insight", label: "洞察已归纳", risk: "高", change: "候选按同周期来源标签归入核心判断。", riskReason: "风险来自隐喻、反例和反转本身承载判断结构；压缩成结论后可能只剩主题，失去原来的校验方式。" };
      if (section === "Memory" || text.includes("Memory：")) {
        const kind = unit.period?.kind === "monthly" ? "月度" : "周度";
        return { key: `traced-${kind}-memory`, label: `${kind} Memory 已归纳`, risk: "高", change: "候选按同周期来源标签归入核心判断。", riskReason: "风险来自独立判断、限定条件和行动边界可能被合并；共同主题被保留，不代表每个限定都被保留。" };
      }
      if (section.includes("候选")) return { key: "traced-candidate", label: "候选观察已归纳", risk: "中", change: "候选按同周期来源标签归入观察判断。", riskReason: "风险来自观察项尚未完全验证；归纳后可能过早定型，遮住原本的待验证分支。" };
      return { key: "traced-other", label: "周期内容已归纳", risk: "中", change: "候选按同周期来源标签归纳。", riskReason: "风险来自来源标签只能证明候选承接了该周期，不能证明所有语义细节都等价。" };
    }
    if (unit.category === "merged_or_changed") {
      if (section.includes("道候选")) return { key: "dao", label: "道候选合并", risk: "中", change: "合并长期方向判断，保留来源标签和具象锚点。", riskReason: "风险来自不同月份的方向判断可能有演化关系，不能只按相似词去重。" };
      if (section.includes("法候选")) return { key: "method", label: "法候选合并", risk: "中", change: "合并方法论判断，保留可执行边界和来源标签。", riskReason: "风险来自方法论通常带有适用条件；合并后可能丢掉‘何时适用’的边界。" };
      if (section.includes("术候选")) return { key: "technique", label: "术候选合并", risk: "中", change: "合并工具与流程判断，保留具体动作和限制条件。", riskReason: "风险来自具体步骤和限制条件可能被共同原则覆盖。" };
      if (section.includes("芒格") || text.includes("洞察：")) return { key: "munger", label: "芒格洞察合并", risk: "高", change: "合并重复洞察，保留隐喻、反例和反转边界。", riskReason: "风险来自隐喻、反例和反转不是装饰，而是判断的校验结构。" };
      return { key: "merged", label: "重复判断合并", risk: "中", change: "去掉重复表述，保留代表性判断与来源标签。", riskReason: "风险来自相似表述未必代表同一个判断，可能存在语境或时间差异。" };
    }
    if (section === "继续追踪" || text.includes("继续追踪")) return { key: "tracking", label: "继续追踪项", risk: "高", change: "候选没有匹配到该追踪问题，暂列删除候选。", riskReason: "风险来自它仍是未决事项；删除会让后续验证线索和停止条件消失。" };
    if (text.includes("洞察：") || section.includes("芒格")) return { key: "insight", label: "洞察细节", risk: "高", change: "候选没有匹配到该洞察细节，暂列删除候选。", riskReason: "风险来自隐喻、反例和反转可能没有被核心判断完整覆盖。" };
    if (section === "Memory" || text.includes("Memory：")) {
      const kind = unit.period?.kind === "monthly" ? "月度" : "周度";
      return { key: `${kind}-memory`, label: `${kind} Memory 细节`, risk: "高", change: "候选没有匹配到该周期 Memory，暂列删除候选。", riskReason: "风险来自独立判断、限定条件和行动边界可能完全没有承接。" };
    }
    if (section.includes("候选")) return { key: "candidate", label: "候选观察项", risk: "中", change: "候选没有匹配到该观察项，暂列删除候选。", riskReason: "风险来自尚未验证的观察分支可能被提前丢弃。" };
    return { key: "other", label: "其他周期判断", risk: "中", change: "来源不足以判定为重复，暂列删除候选。", riskReason: "风险来自无法判断它是重复、已归纳还是独立判断，必须人工复核。" };
  };
  const groupedChangeRows = (units) => {
    const groups = new Map();
    for (const unit of units) {
      const details = unitCategoryDetails(unit);
      const group = groups.get(details.key) ?? { ...details, count: 0, chars: 0, examples: [], candidateExamples: [] };
      group.count += 1;
      group.chars += unit.chars;
      if (group.examples.length < 2) group.examples.push(`${path.basename(unit.sourcePath)}:${unit.lines[0]}：${readable(unit.text).slice(0, 120)}`);
      for (const example of candidateTraceExamples(unit)) {
        if (group.candidateExamples.length >= 2) break;
        if (!group.candidateExamples.includes(example)) group.candidateExamples.push(example);
      }
      groups.set(details.key, group);
    }
    return [...groups.values()].sort((left, right) => riskScore(right.risk) - riskScore(left.risk) || right.chars - left.chars);
  };
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
  const aiChangeSummary = result.entries[0]?.metadata?.changeSummary ?? {};
  const changeSummary = [
    `${scopeLabel} 从 ${scopeChange.originalChars ?? 0} 字压缩到 ${scopeChange.candidateChars ?? 0} 字，实际减少 ${scopeChange.delta ?? 0} 字。`,
    "",
    readableBlocks(aiChangeSummary.whatChanged),
    "",
    "**最核心风险**",
    "",
    readableBlocks(aiChangeSummary.primaryRisk),
    "",
    `审计范围：${changeStats.join("；")}。`
  ];
  const lines = [
    `# Learn-X Memory 压缩比较｜${result.asOf}`,
    "",
    "## 变化摘要（先看这里）",
    "",
    ...changeSummary,
    "",
    `下面的核心变化表精选 ${coreDifferences.length} 条代表性变化；按风险从高到低展示，同风险再看净减少字数。表内分类字数是受影响的原文字符数，不能与整份文件实际减少量相加。`,
    "",
    "### 核心变化（先按风险，再按净减少字数排序）",
    "",
    "| 核心点 | 字数变化（风险在前） | 现在是什么 | 之前是什么 |",
    "| --- | ---: | --- | --- |",
    ...semanticRows,
    "",
    ...otherChangesSection,
    "## 来源承接与删除审计",
    "",
    "> 先看哪些原文被候选按来源标签归纳，再看哪些内容确实没有承接。实际改动量小于等于 10 字的变化不逐条展开；删除候选仍需人工确认。",
    "",
    "### 小于等于10字：统一归类",
    "",
    "| 类型 | 单元数 / 实际改动字数（风险及具体风险） | 代表来源 |",
    "| --- | ---: | --- |",
    ...(smallChangeRows.length ? smallChangeRows.map((row) => `| ${row.type} | ${row.count} 个 / ${row.chars} 字；风险：需人工判断（单条变化不超过 10 字，聚合后无法判断每条语义影响，需抽样复核） | ${row.examples} |`) : ["| 无 | 0 个 / 0 字；风险：— | — |"]),
    "",
    "### 原文承接状态：按来源细分",
    "",
    "| 类型 | 规模（风险及具体风险） | 原文代表例子 | 候选中的具体承接 |",
    "| --- | ---: | --- | --- |",
    ...(otherLargeChangeRows.length ? otherLargeChangeRows.map((row) => {
      const candidate = row.candidateExamples.length ? `压缩后：${row.candidateExamples.join("；")}；` : "";
      return `| ${row.label} | ${row.count} 个 / ${row.chars} 字；风险：${row.risk}（${row.riskReason}） | ${row.examples.join("；")} | ${candidate}${row.change} |`;
    }) : ["| 无 | 0 个 / 0 字；风险：— | — | — |"]),
    "",
    "## 整体压缩量（单独计算）",
    "",
    "",
    "| 文件 | 整份文件：之前 → 现在 | 实际减少 | 核心表说明：之前 → 现在 | 核心表减少 | 核心表之外的算术差额* |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...fileChanges.map((change) => `| ${change.name} | ${change.originalChars} → ${change.candidateChars} | **${change.delta}** | ${change.coreOriginalChars} → ${change.coreCandidateChars} | ${change.coreDelta} | ${change.residualDelta} |`),
    "",
    "> *“核心表之外的算术差额”只是整份文件减少量减去核心摘要文本减少量，不是一个独立的内容类型，也不等于已确认删除；它的实际去向见前面的“整份文件减少量按内容区域拆解”。",
    "",
    "## 保护范围（后置）",
    "",
    "> 以下内容不会被压缩：当前月、跨越当前月的周块，以及无法识别来源的条目。保护校验很重要，但不参与前面的核心变化阅读。",
    "",
    "| 来源 | 识别到的周期 | 字数 | 保护原因 |",
    "| --- | --- | ---: | --- |",
    ...(protectedRows.length ? protectedRows : ["| 无 | — | 0 | 本文件没有当前月、跨月周块或未知来源单元 |"]),
    "",
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
    `- AI 变化摘要：${result.changeSummaryOk ? "已提供" : "缺失或不完整"}`,
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

function hasChangeSummary(metadata) {
  const summary = metadata?.changeSummary;
  return summary && typeof summary === "object" && [summary.whatChanged, summary.primaryRisk].every((value) => (
    typeof value === "string" && value.trim().length >= 30 && value.trim().length <= 1000
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
    if (!hasCoreDifferences(metadata) || !hasOtherChanges(metadata) || !hasChangeSummary(metadata)) return "needs_review";
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

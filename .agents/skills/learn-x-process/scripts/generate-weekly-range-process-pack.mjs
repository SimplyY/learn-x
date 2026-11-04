import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countInputChars } from "../../learn-x-input/scripts/lib/input-limits.mjs";
import { WEEKLY_SOURCE_CONFIG } from "../../learn-x-input/scripts/lib/weekly-source-config.mjs";
import { applyWeeklyPreparation, buildFileSummaries, buildSourceSummaries, classifyWeeklyOutput, dedupeWeeklyProcessItems, getWeeklyPackDeliveryStatus, renderProcessPack, validateWeeklyProcessInputs } from "./generate-weekly-process-pack.mjs";
import { collectWeeklyInput, isoWeekRange } from "./collect-weekly-input.mjs";
import { loadWeeklyPreparation } from "./weekly-preprocessing.mjs";
import { requireCoreWeeklyGate } from "./lib/core-weekly-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function generateWeeklyRangeProcessPack({ periodId, repoRoot: root = repoRoot }) {
  const startedAt = Date.now();
  const rangeDir = path.join(root, "03_input/weekly", periodId);
  const manifestPath = path.join(rangeDir, "_range-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const weeks = validatePeriod(periodId, manifest.period?.weeks);
  const trustedPreviousFileHashes = await readTrustedPreviousFileHashes(root, periodId, manifest);
  const journalPath = path.join(rangeDir, "weekly.md");
  const journal = await readFile(journalPath, "utf8");
  const journalHash = sha256(journal);
  if (manifest.journal?.status !== "confirmed-readback" || manifest.journal?.weeklySha256 !== journalHash
    || journal.includes("【待优化】AI 基础草稿") || !journal.includes(`目标周期：${periodId}`)) {
    throw new Error("weekly-range-process-blocked: confirmed range journal readback or hash is missing");
  }

  const weekPayloads = [];
  const preparedWeeks = [];
  for (const week of weeks) {
    const payload = await collectWeeklyInput({ week, repoRoot: root, allowOversized: true });
    const issues = await validateWeeklyProcessInputs({ week, repoRoot: root, payload, allowPartial: true, requireJournal: false });
    if (issues.length) throw new Error(`weekly-range-process-blocked ${week}:\n${issues.map((item) => `- ${item}`).join("\n")}`);
    const preparation = await loadWeeklyPreparation({ week, repoRoot: root, payload, allowPartial: true });
    const applied = applyWeeklyPreparation(payload, preparation.manifest);
    weekPayloads.push({ week, sourcePayload: payload, ...applied, preparation: preparation.manifest });
    preparedWeeks.push({ week, manifestPath: relative(root, preparation.manifestPath), sourceStatuses: payload.sourceStatuses });
  }

  const filesByName = new Map();
  const rawInputRecords = [];
  const excludedFiles = [];
  const excludedSources = {};
  const preprocessingExclusions = [];
  for (const { week, sourcePayload, processPayload, items, compression } of weekPayloads) {
    for (const file of processPayload.files) {
      const name = path.basename(file.path);
      if (!filesByName.has(name)) filesByName.set(name, []);
      filesByName.get(name).push({ week, file });
    }
    for (const item of items) rawInputRecords.push({ week, item });
    for (const exclusion of processPayload.preprocessing?.exclusions || []) {
      preprocessingExclusions.push({ week, sourcePath: exclusion.sourcePath, reason: exclusion.reason });
    }
    excludedFiles.push(...(sourcePayload.excludedFiles || []).map((entry) => ({ week, ...entry })));
    for (const [source, entry] of Object.entries(processPayload.excludedSources || {})) {
      excludedSources[source] ||= [];
      excludedSources[source].push({ week, ...entry });
    }
  }

  const periodFiles = [];
  const periodItems = [];
  const periodDirRelative = `03_input/weekly/${periodId}`;
  for (const [name, entries] of filesByName) {
    const rangePath = `${periodDirRelative}/${name}`;
    const originalFiles = [];
    let sourceText;
    if (name === "flomo.md") {
      sourceText = await readFile(path.join(root, rangePath), "utf8");
      for (const entry of entries) originalFiles.push({ week: entry.week, path: entry.file.path, sha256: entry.file.rawHash, rawChars: entry.file.rawChars });
    } else {
      const sections = [];
      for (const { week, file } of entries) {
        const bytes = await readFile(path.join(root, file.path));
        const body = bytes.toString("utf8");
        const hash = sha256(bytes);
        if (file.rawHash && file.rawHash !== hash) throw new Error(`weekly-range-source-stale: ${file.path}`);
        sections.push(`<!-- source-week: ${week}; source-path: ${file.path}; sha256: ${hash} -->\n${body.replace(/\s*$/, "")}\n<!-- end-source-week: ${week} -->`);
        originalFiles.push({ week, path: file.path, sha256: hash, rawChars: countInputChars(body), effectiveChars: file.effectiveChars });
      }
      sourceText = `${sections.join("\n\n")}\n`;
      await writeRegenerableOutput(path.join(root, rangePath), sourceText, trustedPreviousFileHashes.get(rangePath));
    }
    const first = entries[0].file;
    const fileItems = rawInputRecords.filter(({ item }) => item.path === first.path || entries.some((entry) => item.path === entry.file.path));
    const mappedItems = fileItems.map(({ week, item }) => ({
      ...item,
      id: item.id,
      sourceWeek: week,
      path: rangePath,
      shortPath: `${week.slice(-3)}/${name}`,
      title: `${week}｜${item.title || name}`
    }));
    const rawChars = entries.reduce((sum, entry) => sum + (entry.file.rawChars || 0), 0);
    const effectiveChars = entries.reduce((sum, entry) => sum + (entry.file.effectiveChars || 0), 0);
    const info = await stat(path.join(root, rangePath));
    periodFiles.push({
      path: rangePath,
      shortPath: name,
      category: first.category,
      source: first.source,
      priority: first.priority,
      mode: first.mode,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      rawChars,
      effectiveChars,
      rawHash: sha256(sourceText),
      weekSources: originalFiles
    });
    periodItems.push(...mappedItems);
  }

  const journalRelative = `${periodDirRelative}/weekly.md`;
  const journalItem = {
    id: `${journalRelative}#confirmed-range-journal`, category: "日志", source: "飞书周记", path: journalRelative,
    shortPath: "weekly.md", modifiedAt: manifest.journal.confirmedAt, title: "已确认双周周记", text: journal
  };
  const journalInfo = await stat(journalPath);
  periodFiles.push({
    path: journalRelative, shortPath: "weekly.md", category: "日志", source: "飞书周记", priority: null,
    size: journalInfo.size, modifiedAt: journalInfo.mtime.toISOString(), rawChars: countInputChars(journal),
    effectiveChars: countInputChars(journal), rawHash: journalHash, weekSources: weeks.map((week) => ({ week, path: journalRelative, sha256: journalHash }))
  });
  periodItems.push(journalItem);

  const manualAi = await findRangeAi(root, rangeDir, periodId, weeks, manifest);
  if (manualAi) {
    const aiRelative = relative(root, manualAi.path);
    const aiChars = countInputChars(manualAi.text);
    periodFiles.push({
      path: aiRelative, shortPath: path.basename(aiRelative), category: "补充", source: "AI 周回顾",
      size: Buffer.byteLength(manualAi.text), modifiedAt: manualAi.mtime, rawChars: aiChars, effectiveChars: aiChars,
      rawHash: manualAi.sha256, weekSources: [{ week: periodId, path: aiRelative, sha256: manualAi.sha256 }]
    });
    periodItems.push({
      id: `${aiRelative}#1`, category: "补充", source: "AI 周回顾", path: aiRelative,
      shortPath: path.basename(aiRelative), modifiedAt: manualAi.mtime, title: "用户提供的范围 AI 回顾", text: manualAi.text
    });
  }

  const range = rangeForWeeks(weeks);
  const statuses = aggregateStatuses(weeks, weekPayloads, periodFiles);
  if (manualAi) {
    statuses.ai = {
      status: "ready", file: path.basename(manualAi.path), count: 1,
      summary: `用户提供并核验的完整范围 AI 回顾（${periodId}；${weeks.join("、")}）`,
      updatedAt: manualAi.mtime, provenance: "user-provided",
      coverage: { start: range.start.toISOString().slice(0, 10), end: new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10) },
      weeks: [{ week: periodId, status: "ready", count: 1, summary: "用户提供，范围核验通过", file: path.basename(manualAi.path) }]
    };
    delete excludedSources.ai;
  }
  const uniqueItems = dedupeWeeklyProcessItems(periodItems);
  const previousOutput = await readPreviousRangeOutput(weeks, root);
  const payload = {
    schemaVersion: "weekly-process-range/v1",
    week: periodId,
    weeks,
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    selection: { mode: "period-range", path: periodDirRelative },
    generatedAt: new Date().toISOString(),
    files: periodFiles,
    items: uniqueItems,
    sourceStatuses: statuses,
    excludedSources: Object.fromEntries(Object.entries(excludedSources).map(([key, list]) => [key, {
      status: "partial", reason: list.map((entry) => `${entry.week}: ${entry.reason}`).join("；")
    }])),
    excludedFiles,
    omittedSources: [],
    preprocessing: { exclusions: preprocessingExclusions.map(({ week, sourcePath, reason }) => ({ week, sourcePath, reason })) },
    stats: {
      fileCount: periodFiles.length, itemCount: periodItems.length, uniqueItemCount: uniqueItems.length,
      duplicateCount: periodItems.length - uniqueItems.length,
      excludedFileCount: excludedFiles.length
    },
    provenance: { preparedWeeks, journalSha256: journalHash, manualAi: manualAi ? { path: relative(root, manualAi.path), sha256: manualAi.sha256 } : null }
  };
  payload.deliveryStatus = getWeeklyPackDeliveryStatus(payload);
  const sourceSummaries = buildSourceSummaries(payload);
  const fileSummaries = buildFileSummaries(payload, uniqueItems);
  const compression = combineCompression(weekPayloads, filesByName, periodId);
  const processPack = renderProcessPack(payload, sourceSummaries, fileSummaries, uniqueItems, compression, previousOutput);
  const outputRoot = path.join(root, "04_output/_dist/weekly", periodId);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const inputPath = path.join(outputRoot, "input.json");
  const packPath = path.join(outputRoot, "process-pack.md");
  const shellPath = path.join(root, "04_output/weekly", `${periodId}.md`);
  await writeRegenerableOutput(inputPath, `${JSON.stringify(payload, null, 2)}\n`, manifest.processPack?.inputSha256);
  await writeRegenerableOutput(packPath, processPack, manifest.processPack?.processPackSha256);
  await ensureOutputShell(shellPath, periodId);
  const inputReadback = await readFile(inputPath, "utf8");
  const packReadback = await readFile(packPath, "utf8");
  if (sha256(inputReadback) !== sha256(`${JSON.stringify(payload, null, 2)}\n`) || sha256(packReadback) !== sha256(processPack)) {
    throw new Error("weekly-range-process-readback-mismatch");
  }

  const completedAt = new Date().toISOString();
  const result = {
    periodId, weeks, coverage: { start: range.start.toISOString().slice(0, 10), end: new Date(range.end.getTime() - 86_400_000).toISOString().slice(0, 10) },
    deliveryStatus: payload.deliveryStatus,
    inputPath: relative(root, inputPath), processPackPath: relative(root, packPath), outputShellPath: relative(root, shellPath),
    inputSha256: sha256(inputReadback), processPackSha256: sha256(packReadback),
    inputChars: countInputChars(inputReadback), processPackChars: countInputChars(packReadback),
    fileCount: payload.stats.fileCount, itemCount: payload.stats.uniqueItemCount,
    sourceStatuses: statuses, previousOutput: { periodId: previousOutput.week, status: previousOutput.status, path: previousOutput.relativePath },
    completedAt, durationMs: Date.now() - startedAt
  };
  manifest.processPack = { ...result, status: "readback-verified" };
  await atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return result;
}

function aggregateStatuses(weeks, weekPayloads, files) {
  const byWeek = new Map(weekPayloads.map(({ week, sourcePayload, processPayload }) => [week, { sourcePayload, processPayload }]));
  const sources = {};
  for (const definition of WEEKLY_SOURCE_CONFIG) {
    if (definition.id === "ai") continue;
    const entries = weeks.map((week) => {
      const payload = byWeek.get(week);
      const source = payload?.processPayload.sourceStatuses?.[definition.id];
      const exclusion = payload?.processPayload.excludedSources?.[definition.id];
      if (exclusion) return { week, status: exclusion.status || "needs_review", count: 0, summary: exclusion.reason, file: definition.file };
      if (source) return { week, status: source.status, count: source.count || 0, summary: source.summary || "", file: source.file || definition.file };
      if (["jingdu", "wechat"].includes(definition.id)) return { week, status: "manual-input", count: 0, summary: "未提供本周手工输入", file: definition.file };
      return { week, status: "unavailable", count: 0, summary: "本周没有来源状态登记", file: definition.file };
    });
    const usable = entries.filter((entry) => ["ready", "empty"].includes(entry.status));
    const hasFiles = files.some((file) => path.basename(file.path) === definition.file);
    let status;
    if (entries.every((entry) => ["ready", "empty"].includes(entry.status))) status = entries.some((entry) => entry.status === "ready") ? "ready" : "empty";
    else if (usable.length || hasFiles) status = "partial";
    else if (entries.some((entry) => entry.status === "failed")) status = "failed";
    else if (entries.some((entry) => entry.status === "needs_review")) status = "needs_review";
    else if (entries.some((entry) => entry.status === "manual-input")) status = "manual-input";
    else status = "unavailable";
    sources[definition.id] = {
      status, file: definition.file, count: usable.reduce((sum, entry) => sum + (entry.status === "ready" ? entry.count : 0), 0),
      summary: entries.map((entry) => `${entry.week}: ${entry.status} ${entry.count} 条${entry.summary ? `（${entry.summary}）` : ""}`).join("；"),
      updatedAt: entries.map((entry) => byWeek.get(entry.week)?.processPayload.sourceStatuses?.[definition.id]?.updatedAt).filter(Boolean).sort().at(-1),
      preservedStaleFile: entries.some((entry) => byWeek.get(entry.week)?.processPayload.sourceStatuses?.[definition.id]?.preservedStaleFile),
      weeks: entries
    };
  }
  return sources;
}

function combineCompression(weekPayloads, filesByName, periodId) {
  const periodPaths = new Map([...filesByName].map(([name]) => [name, `03_input/weekly/${periodId}/${name}`]));
  const compressions = weekPayloads.map(({ compression }) => compression);
  const voiceFiles = compressions.flatMap((entry) => entry.files.map((file) => ({ ...file, path: file.path })));
  const semanticFiles = compressions.flatMap((entry) => entry.semanticFiles.map((file) => ({ ...file, path: `03_input/weekly/${file.path.split("/").at(-2)}/${path.basename(file.path)}` })));
  const sum = (key) => compressions.reduce((total, item) => total + (item[key] || 0), 0);
  const sourceChars = sum("sourceChars");
  const outputChars = sum("outputChars");
  return {
    sourceCount: sum("sourceCount"), sourceChars, outputChars,
    retainedRatio: sourceChars ? Number((outputChars / sourceChars).toFixed(3)) : 0,
    reductionRatio: sourceChars ? Number((1 - outputChars / sourceChars).toFixed(3)) : 0,
    targetRetainedRatio: compressions[0]?.targetRetainedRatio || 0,
    targetRetainedRatioRange: compressions[0]?.targetRetainedRatioRange || [],
    warnings: compressions.flatMap((entry) => entry.warnings || []),
    files: voiceFiles.map((entry) => ({ ...entry, path: periodPaths.get("voice.md") || entry.path })),
    semanticFiles: semanticFiles.map((entry) => ({ ...entry, path: periodPaths.get(path.basename(entry.path)) || entry.path }))
  };
}

async function findRangeAi(root, rangeDir, periodId, weeks, manifest) {
  const candidates = ["ai.md", "双周ai.md", "range-ai.md"];
  for (const name of candidates) {
    const target = path.join(rangeDir, name);
    let text;
    try { text = await readFile(target, "utf8"); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const declaresPeriod = text.includes(periodId)
      || (text.includes(weeks[0]) && (text.includes(weeks.at(-1)) || text.includes(weeks.at(-1).slice(5))))
      || weeks.every((week) => text.includes(week));
    if (!declaresPeriod || !/AI 对话.*回顾|AI.*回顾|双周回顾/i.test(firstLine)) {
      throw new Error(`weekly-range-ai-input-invalid: ${name} must declare the full period and be an AI review`);
    }
    const info = await stat(target);
    return { path: target, text, mtime: info.mtime.toISOString(), sha256: sha256(text), manifestSource: manifest.aiSource || "user-provided" };
  }
  return null;
}

async function readPreviousRangeOutput(weeks, root) {
  const previous = [...weeks];
  let start = isoWeekRange(weeks[0]).start;
  start.setUTCDate(start.getUTCDate() - weeks.length * 7);
  previous[0] = isoWeekForDate(start);
  for (let index = 1; index < weeks.length; index += 1) previous[index] = nextWeekId(previous[index - 1]);
  const week = makePeriodId(previous);
  const relativePath = `04_output/weekly/${week}.md`;
  try {
    const content = await readFile(path.join(root, relativePath), "utf8");
    return { week, relativePath, status: classifyWeeklyOutput(content), content };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { week, relativePath, status: "missing", content: "" };
  }
}

function validatePeriod(periodId, values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) throw new Error("weekly-range-invalid: 1 to 4 ISO weeks required");
  const weeks = values.map((week) => normalizeWeek(week));
  if (weeks.some((week, index) => index && nextWeekId(weeks[index - 1]) !== week)) throw new Error("weekly-range-invalid: weeks are not contiguous");
  if (makePeriodId(weeks) !== periodId) throw new Error("weekly-range-invalid: period id does not match week list");
  return weeks;
}

function normalizeWeek(value) {
  const match = String(value).match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`weekly-range-invalid-week: ${value}`);
  return `${match[1]}-W${match[2]}`;
}

function makePeriodId(weeks) {
  if (weeks.length === 1) return weeks[0];
  const first = weeks[0], last = weeks.at(-1);
  return first.slice(0, 4) === last.slice(0, 4) ? `${first}-${last.slice(5)}` : `${first}-${last}`;
}

function nextWeekId(week) {
  const start = isoWeekRange(week).start;
  start.setUTCDate(start.getUTCDate() + 7);
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const weekNumber = Math.floor((start.getTime() - firstMonday.getTime()) / 604_800_000) + 1;
  return `${year}-W${String(weekNumber).padStart(2, "0")}`;
}

function rangeForWeeks(weeks) {
  const start = isoWeekRange(weeks[0]).start;
  const end = isoWeekRange(weeks.at(-1)).end;
  return { start, end };
}

function isoWeekForDate(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const number = Math.ceil((((d - yearStart) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(number).padStart(2, "0")}`;
}

async function ensureOutputShell(target, periodId) {
  let current;
  try { current = await readFile(target, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (current?.trim()) return;
  const shell = `# Learn-X Weekly Output｜${periodId}\n\n> 基于 \`04_output/_dist/weekly/${periodId}/\` 由用户在 Chat Pack 审核后填入正文。\n`;
  await mkdir(path.dirname(target), { recursive: true });
  if (current === undefined) await writeExclusive(target, shell);
  else await writeFile(target, shell, { encoding: "utf8", mode: 0o600 });
}

async function writeNoOverwrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(target, "utf8");
    if (existing !== content) throw new Error(`weekly-range-output-conflict: ${relative(repoRoot, target)}`);
    return;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeExclusive(target, content);
}

async function writeRegenerableOutput(target, content, previousSha256) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let existing;
  try { existing = await readFile(target, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing === undefined) {
    await writeExclusive(target, content);
    return;
  }
  if (existing === content) return;
  if (!previousSha256 || sha256(existing) !== previousSha256) {
    throw new Error(`weekly-range-output-conflict: ${relative(repoRoot, target)}`);
  }
  await atomicReplace(target, content);
}

async function readTrustedPreviousFileHashes(root, periodId, manifest) {
  const expectedInputPath = `04_output/_dist/weekly/${periodId}/input.json`;
  if (manifest.processPack?.status !== "readback-verified" || manifest.processPack?.inputPath !== expectedInputPath
    || !manifest.processPack?.inputSha256) return new Map();
  let content;
  try { content = await readFile(path.join(root, expectedInputPath), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return new Map(); throw error; }
  if (sha256(content) !== manifest.processPack.inputSha256) return new Map();
  const previous = JSON.parse(content);
  if (previous.week !== periodId || !Array.isArray(previous.files)) return new Map();
  return new Map(previous.files
    .filter((file) => typeof file.path === "string" && file.path.startsWith(`03_input/weekly/${periodId}/`) && /^[a-f0-9]{64}$/.test(file.rawHash || ""))
    .map((file) => [file.path, file.rawHash]));
}

async function writeExclusive(target, content) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await link(temporary, target); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(target, "utf8");
    if (existing !== content) throw new Error(`weekly-range-output-conflict: ${relative(repoRoot, target)}`);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

async function atomicReplace(target, content) {
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temporary, target); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

function relative(root, target) { return path.relative(root, target).split(path.sep).join("/"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const periodId = process.argv.find((argument) => argument.startsWith("--period="))?.slice("--period=".length);
  if (!periodId) throw new Error("usage: node generate-weekly-range-process-pack.mjs --period=YYYY-Www-Www");
  const manifestPath = path.join(repoRoot, "03_input/weekly", periodId, "_range-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const weeks = validatePeriod(periodId, manifest.period?.weeks);
  try { await requireCoreWeeklyGate(weeks); }
  catch (error) { console.error(error.message); process.exit(3); }
  const result = await generateWeeklyRangeProcessPack({ periodId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

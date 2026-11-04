import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function quarterFromWeek(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}`);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(match[2]) - 1) * 7);
  return `${monday.getUTCFullYear()}-Q${Math.floor(monday.getUTCMonth() / 3) + 1}`;
}

export function quarterFromPeriod(periodId) {
  return quarterFromWeek(weeksInPeriod(periodId).at(-1));
}

export function normalizeWeek(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}`);
  return `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
}

export function normalizePeriod(periodId) {
  const input = String(periodId || "");
  const range = /^(\d{4})-W(\d{2})-(?:(\d{4})-)?W(\d{2})$/.exec(input);
  const weeks = range
    ? [`${range[1]}-W${range[2]}`, `${range[3] || range[1]}-W${range[4]}`]
    : [normalizeWeek(input)];
  const first = parseIsoWeek(weeks[0]);
  const last = parseIsoWeek(weeks.at(-1));
  const count = Math.round((last.monday - first.monday) / 604_800_000) + 1;
  if (count < 1 || count > 4) throw new Error(`Period must contain 1–4 consecutive ISO weeks: ${input}`);
  const expanded = Array.from({ length: count }, (_, index) => isoWeekId(addDays(first.monday, index * 7)));
  if (expanded.at(-1) !== weeks.at(-1)) throw new Error(`Period endpoints are not consecutive ISO weeks: ${input}`);
  const canonical = expanded.length === 1
    ? expanded[0]
    : expanded[0].slice(0, 4) === expanded.at(-1).slice(0, 4)
      ? `${expanded[0]}-${expanded.at(-1).slice(5)}`
      : `${expanded[0]}-${expanded.at(-1)}`;
  if (range && canonical !== input) throw new Error(`Period is not canonical: ${input}`);
  return canonical;
}

function parseIsoWeek(weekId) {
  const normalized = normalizeWeek(weekId);
  const [year, week] = normalized.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - weekday + 1 + (week - 1) * 7);
  if (isoWeekId(monday) !== normalized) throw new Error(`Invalid ISO week: ${weekId}`);
  return { monday, weekId: normalized };
}

function isoWeekId(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil((((thursday - Date.UTC(year, 0, 1)) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function weeksInPeriod(periodId) {
  const normalized = normalizePeriod(periodId);
  const range = /^(\d{4})-W(\d{2})-(?:(\d{4})-)?W(\d{2})$/.exec(normalized);
  if (!range) return [normalized];
  const first = `${range[1]}-W${range[2]}`;
  const last = `${range[3] || range[1]}-W${range[4]}`;
  const start = parseIsoWeek(first).monday;
  const count = Math.round((parseIsoWeek(last).monday - start) / 604_800_000) + 1;
  return Array.from({ length: count }, (_, index) => isoWeekId(addDays(start, index * 7)));
}

function periodCoverage(periodId) {
  const weeks = weeksInPeriod(periodId);
  const start = parseIsoWeek(weeks[0]).monday;
  const endInclusive = addDays(parseIsoWeek(weeks.at(-1)).monday, 6);
  const writeDate = addDays(endInclusive, 1);
  const isoDate = (date) => date.toISOString().slice(0, 10);
  return { weeks, start: isoDate(start), endInclusive: isoDate(endInclusive), writeDate: isoDate(writeDate) };
}

export function digest(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export function normalizeMemoText(text) {
  const normalized = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=>)/g, "\n")
    .replace(/\n\n(?=#learn-x\/)/g, "\n")
  const isListItem = (line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  return normalized
    .split("\n")
    .filter((line, index, lines) => !(line === "" && isListItem(lines[index - 1] ?? "") && isListItem(lines[index + 1] ?? "")))
    .join("\n")
    .trim();
}

export function flomoComparableText(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").map((rawLine) => {
    let line = rawLine.trim();
    if (/^#{1,6}\s/.test(line)) line = line.replace(/^#{1,6}\s+/, "");
    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of ["> ", "- ", "* ", "+ ", "• ", "◦ ", "▪ ", "‣ "]) {
        if (!line.startsWith(prefix)) continue;
        line = line.slice(prefix.length);
        changed = true;
        break;
      }
      if (changed) continue;
      let digits = 0;
      while (digits < line.length && line.charCodeAt(digits) >= 48 && line.charCodeAt(digits) <= 57) digits += 1;
      if (digits && [".", ")"].includes(line[digits]) && /\s/.test(line[digits + 1] ?? "")) {
        line = line.slice(digits + 1).trimStart();
        changed = true;
      }
    }
    if (line.startsWith("```")) return "";
    return line.replace(/\*\*|__|~~|`/g, "");
  }).filter(Boolean);
  return lines.join(" ").replace(/\s+/gu, " ").trim();
}

export function isSubstantive(text) {
  const withoutTemplateHeadings = String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*#\s*(?:飞书)?周记\s*$/.test(line))
    .join("\n");
  const plain = withoutTemplateHeadings.replace(/[\s#*_`>\-]/g, "").toLowerCase();
  return Boolean(plain) && !["todo", "待补充", "暂无", "无", "占位"].includes(plain);
}

export function sanitizeFlomoSource(source) {
  return String(source)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:来源|source)\s*[:：]\s*(?:file:\/\/)?(?:\/Users\/|\/private\/|[A-Za-z]:[\\/])/.test(line))
    .join("\n")
    .trim();
}

export function memoSpec(kind, id, source) {
  const labels = { weekly: "周记", monthly: "月记", memory: "记忆" };
  const title = `Learn-X ${labels[kind] ?? kind}｜${id}`;
  const tag = `#learn-x/${kind}/${id}`;
  const safeSource = sanitizeFlomoSource(source);
  const verification = `Learn-X 同步校验：${digest(safeSource).slice(0, 16)}`;
  const content = `${title}\n\n${safeSource}\n\n${verification}\n#learn-x/sync ${tag}`;
  return { key: `${kind}:${id}`, kind, id, title, tag, verification, content, hash: digest(content) };
}

export async function loadSpecs(repoRoot, periodInput) {
  const period = normalizePeriod(periodInput);
  const weeks = weeksInPeriod(period);
  const quarter = quarterFromPeriod(period);
  const entries = [
    ["weekly", period, path.join(repoRoot, "03_input/weekly", period, "weekly.md")],
    ["memory", quarter, path.join(repoRoot, "01_core/memory", `${quarter}.memory.md`)]
  ];
  if (weeks.length > 1) {
    const weeklyPath = entries[0][2];
    const memoryPath = entries[1][2];
    const weeklySource = await readFile(weeklyPath, "utf8");
    const memorySource = await readFile(memoryPath, "utf8");
    const rangeRoot = path.join(repoRoot, "03_input/weekly", period);
    const rangeManifest = JSON.parse(await readFile(path.join(rangeRoot, "_range-manifest.json"), "utf8"));
    const coverage = periodCoverage(period);
    if (rangeManifest.schemaVersion !== 1 || rangeManifest.period?.id !== period ||
        JSON.stringify(rangeManifest.period?.weeks) !== JSON.stringify(coverage.weeks) ||
        rangeManifest.period?.start !== coverage.start || rangeManifest.period?.endInclusive !== coverage.endInclusive ||
        rangeManifest.period?.writeDate !== coverage.writeDate) {
      throw new Error(`Range manifest does not match Flomo period ${period}.`);
    }
    const journal = rangeManifest.journal;
    if (journal?.status !== "confirmed-readback" || journal.readBackVerified !== true ||
        journal.weeklyPath !== path.relative(repoRoot, weeklyPath).split(path.sep).join("/") ||
        journal.weeklySha256 !== digest(weeklySource)) {
      throw new Error(`Range journal is not confirmed or its Flomo source changed: ${period}.`);
    }
    if (rangeManifest.processPack?.periodId !== period || rangeManifest.processPack.status !== "readback-verified") {
      throw new Error(`Range Process Pack is not readback-verified: ${period}.`);
    }
    const distRoot = path.join(repoRoot, "04_output/_dist/weekly", period);
    const [receipt, proposal] = await Promise.all([
      readFile(path.join(distRoot, "_range-memory-write-receipt.json"), "utf8").then(JSON.parse),
      readFile(path.join(distRoot, "_range-memory-proposal.json"), "utf8").then(JSON.parse),
    ]);
    const memoryRelativePath = path.relative(repoRoot, memoryPath).split(path.sep).join("/");
    if (receipt.schemaVersion !== 1 || receipt.periodId !== period || receipt.target !== memoryRelativePath ||
        receipt.targetSha256 !== digest(memorySource) || receipt.fingerprint !== proposal.fingerprint ||
        proposal.periodId !== period || proposal.quarter !== quarter ||
        !receipt.authorizationMessageId || !receipt.authorizationMessageSha256) {
      throw new Error(`Range Memory write receipt is missing or stale: ${period}.`);
    }
    const specs = [
      { ...memoSpec("weekly", period, weeklySource), filePath: weeklyPath, source: weeklySource },
      { ...memoSpec("memory", quarter, memorySource), filePath: memoryPath, source: memorySource },
    ];
    if (specs.some((spec) => !isSubstantive(spec.source))) throw new Error(`Range Flomo source is not substantive: ${period}.`);
    return { period, week: period, quarter, specs, skipped: [] };
  }
  const specs = [];
  const skipped = [];
  for (const [kind, id, filePath] of entries) {
    try {
      const source = await readFile(filePath, "utf8");
      if (!isSubstantive(source)) skipped.push({ kind, id, reason: "source-not-substantive", filePath });
      else specs.push({ ...memoSpec(kind, id, source), filePath, source });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      skipped.push({ kind, id, reason: "source-missing", filePath });
    }
  }
  return { period, week: period, quarter, specs, skipped };
}

export async function loadManifestSpecs(repoRoot, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entries = [];
  for (const week of manifest.weeks ?? []) {
    if (["existing_verified", "generated"].includes(week.status) && week.syncSource) {
      entries.push(["weekly", week.id, path.join(repoRoot, week.syncSource)]);
    }
  }
  for (const month of manifest.monthly ?? []) {
    if (month.status === "verified" && month.candidates?.[0]?.relativePath) {
      entries.push(["monthly", month.id, path.join(repoRoot, month.candidates[0].relativePath)]);
    }
  }
  for (const item of manifest.memory ?? []) {
    if (item.status === "verified" && item.relativePath) entries.push(["memory", item.id, path.join(repoRoot, item.relativePath)]);
  }
  const specs = [];
  const skipped = [];
  for (const [kind, id, filePath] of entries) {
    try {
      const source = await readFile(filePath, "utf8");
      if (!isSubstantive(source)) skipped.push({ kind, id, reason: "source-not-substantive", filePath });
      else specs.push({ ...memoSpec(kind, id, source), filePath, source });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      skipped.push({ kind, id, reason: "source-missing", filePath });
    }
  }
  return { manifestPath, specs, skipped, manifest };
}

export function changeMagnitude(base, remote) {
  if (base === remote) return 0;
  let start = 0;
  while (base[start] === remote[start] && start < base.length && start < remote.length) start += 1;
  let end = 0;
  while (base.at(-1 - end) === remote.at(-1 - end) && end < base.length - start && end < remote.length - start) end += 1;
  return base.length - start - end + remote.length - start - end;
}

export function reconcile({ base, local, remote }) {
  if (remote === base) return { content: local };
  const magnitude = changeMagnitude(base, remote);
  if (magnitude > 200) return { stop: "remote-change-over-200", magnitude };
  const baseParagraphs = String(base).split(/\n\s*\n/).filter(isSubstantive);
  const remoteParagraphs = String(remote).split(/\n\s*\n/).filter(isSubstantive);
  if (remoteParagraphs.length < baseParagraphs.length) return { stop: "remote-paragraph-removed", magnitude };
  if (local === base) return { content: remote, writeBack: remote };
  if (local.startsWith(base)) return { content: `${remote}${local.slice(base.length)}`, writeBack: `${remote}${local.slice(base.length)}` };
  return { content: remote, writeBack: remote };
}

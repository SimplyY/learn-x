import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function quarterFromWeek(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}`);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(match[2]) - 1) * 7);
  return `${match[1]}-Q${Math.floor(monday.getUTCMonth() / 3) + 1}`;
}

export function normalizeWeek(weekId) {
  const match = String(weekId).match(/^(\d{4})-W?(\d{1,2})$/);
  if (!match) throw new Error(`Invalid week format: ${weekId}`);
  return `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
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

export async function loadSpecs(repoRoot, weekId) {
  const week = normalizeWeek(weekId);
  const quarter = quarterFromWeek(week);
  const entries = [
    ["weekly", week, path.join(repoRoot, "03_input/weekly", week, "weekly.md")],
    ["memory", quarter, path.join(repoRoot, "01_core/memory", `${quarter}.memory.md`)]
  ];
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
  return { week, quarter, specs, skipped };
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

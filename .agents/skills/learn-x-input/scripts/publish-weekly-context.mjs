import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");
const OUTPUT_RELATIVE = "04_output/_dist/shared-context";
const MARKDOWN = new MarkdownIt({ html: true, linkify: false, typographer: false });
const DAY_MS = 86_400_000;

export async function publishConfirmedWeeklyContext({ week, repoRoot: root = repoRoot, now = () => new Date(), renameFile = rename }) {
  const sourceWeek = normalizeWeek(week);
  const sourcePath = path.join(root, "03_input/weekly", sourceWeek, "weekly.md");
  const sourceBytes = await readFile(sourcePath);
  const sourceText = sourceBytes.toString("utf8");
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const parsed = parseConfirmedWeeklyJournal(sourceText, sourceWeek);
  const planWeek = isoWeekForDate(addDays(parsed.coverage.end, 1));
  const publishedAt = now().toISOString();
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("weekly-context-publish-time-invalid");

  const outputDir = path.join(root, OUTPUT_RELATIVE);
  const currentPath = path.join(outputDir, "current.json");
  const current = await readCurrentPointer(currentPath, outputDir);
  if (current && compareWeeks(planWeek, current.pointer.planWeek) < 0) {
    throw new Error(`weekly-context-stale-week: ${planWeek} is older than current ${current.pointer.planWeek}`);
  }

  const relativeVersionPath = `weekly/${planWeek}/${sourceHash}.json`;
  const versionPath = path.join(outputDir, relativeVersionPath);
  const candidate = {
    schemaVersion: "shared-context/v1",
    producer: "learn-x",
    planWeek,
    sourceWeek,
    coverage: parsed.coverage,
    publishedAt,
    confirmationEvidence: {
      stage: "stage-2",
      status: "complete",
      confirmationStatus: "confirmed",
      confirmedAt: null,
      confirmedAtStatus: "unknown",
      evidence: "Validated confirmed weekly.md; Learn-X Stage 2 proceeds after the explicit 周记已确认 gate."
    },
    source: {
      url: parsed.sourceUrl,
      revision: parsed.sourceRevision,
      sha256: sourceHash,
      missing: parsed.missingSourceFields
    },
    payload: {
      planTableRow: parsed.planTableRow
    }
  };

  await mkdir(path.dirname(versionPath), { recursive: true });
  const existingVersion = await readOptionalJson(versionPath);
  let version = candidate;
  if (existingVersion) {
    version = assertSameVersion(existingVersion, candidate);
  } else {
    const racedVersion = await writeImmutableJson(versionPath, candidate);
    if (racedVersion) version = assertSameVersion(racedVersion, candidate);
  }
  const versionBytes = await readFile(versionPath);
  const versionReadBack = JSON.parse(versionBytes.toString("utf8"));
  version = assertSameVersion(versionReadBack, candidate);
  const artifactSha256 = createHash("sha256").update(versionBytes).digest("hex");

  const pointer = {
    schemaVersion: "shared-context-pointer/v1",
    producer: "learn-x",
    planWeek,
    sourceWeek,
    versionPath: relativeVersionPath,
    sha256: sourceHash,
    artifactSha256,
    publishedAt: version.publishedAt
  };
  const lockPath = `${currentPath}.lock`;
  const unchanged = await withPointerLock(lockPath, async () => {
    const latest = await readCurrentPointer(currentPath, outputDir);
    if (latest && compareWeeks(planWeek, latest.pointer.planWeek) < 0) {
      throw new Error(`weekly-context-stale-week: ${planWeek} is older than current ${latest.pointer.planWeek}`);
    }
    if (latest?.pointer.versionPath === pointer.versionPath && latest.pointer.planWeek === planWeek) return true;
    await atomicReplaceJson(currentPath, pointer, renameFile);
    return false;
  });
  return { planWeek, sourceWeek, currentPath, versionPath, version: relativeVersionPath, sourceHash, artifactSha256, unchanged, publishedAt: version.publishedAt };
}

export function parseConfirmedWeeklyJournal(sourceText, sourceWeek) {
  const normalizedWeek = normalizeWeek(sourceWeek);
  const { metadata, body } = parseWeeklyFile(sourceText, normalizedWeek);
  const targetWeek = metadata.get("目标周") || metadata.get("target_week") || normalizedWeek;
  if (targetWeek !== normalizedWeek) throw new Error("weekly-context-source-invalid: target week does not match weekly.md directory");
  const targetTitle = metadata.get("周记写作日标题") || metadata.get("writing_title");
  if (!targetTitle) throw new Error("weekly-context-source-invalid: journal title marker is empty");
  const anchor = metadata.get("定位依据") || metadata.get("locator");
  if (!anchor || !validAnchorEvidence(anchor, targetTitle, metadata.has("locator"))) {
    throw new Error("weekly-context-source-invalid: confirmed block evidence is missing or malformed");
  }
  const capturedAt = metadata.get("采集时间") || metadata.get("captured_at");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error("weekly-context-source-invalid: captured_at must be a UTC ISO timestamp");
  }

  const coverageValue = metadata.get("目标覆盖范围") || metadata.get("target_coverage");
  if (!coverageValue) throw new Error("weekly-context-source-invalid: required metadata coverage is missing");
  const coverageMatch = coverageValue.match(/^(\d{4}-\d\d-\d\d)\s+(?:至|to)\s+(\d{4}-\d\d-\d\d)(?:\s+\([^)]*\))?$/i);
  if (!coverageMatch) throw new Error("weekly-context-source-invalid: coverage metadata is malformed");
  const coverage = { start: coverageMatch[1], end: coverageMatch[2] };
  const expectedCoverage = coverageForWeek(normalizedWeek);
  if (coverage.start !== expectedCoverage.start || coverage.end !== expectedCoverage.end) {
    throw new Error("weekly-context-source-invalid: sourceWeek and coverage do not match");
  }
  const nextDay = new Date(`${addDays(coverage.end, 1)}T00:00:00.000Z`);
  const expectedTitleDate = `${nextDay.getUTCMonth() + 1}.${nextDay.getUTCDate()}`;
  if (!hasExpectedDate(targetTitle, expectedTitleDate)) {
    throw new Error("weekly-context-source-invalid: journal title does not match the day after the covered week");
  }

  const urlValue = metadata.get("来源 URL") || metadata.get("source_url") || null;
  let sourceUrl = null;
  if (urlValue && urlValue !== "unknown") {
    let parsedUrl;
    try { parsedUrl = new URL(urlValue); }
    catch { throw new Error("weekly-context-source-invalid: source URL is malformed"); }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("weekly-context-source-invalid: source URL must use HTTP or HTTPS");
    }
    if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
      throw new Error("weekly-context-source-invalid: source URL must not contain credentials, query parameters, or fragments");
    }
    sourceUrl = urlValue;
  }
  const revisionValue = metadata.get("来源 revision") || metadata.get("source_revision_id");
  if (revisionValue && revisionValue !== "unknown" && !/^\d{1,32}$/.test(revisionValue)) {
    throw new Error("weekly-context-source-invalid: source revision is malformed");
  }
  const sourceRevision = revisionValue && revisionValue !== "unknown" ? revisionValue : null;
  const missingSourceFields = [];
  if (!sourceUrl) missingSourceFields.push("url");
  if (!sourceRevision) missingSourceFields.push("revision");

  if (!body) throw new Error("weekly-context-source-invalid: journal body is empty");
  const rendered = MARKDOWN.render(body);
  const dom = new JSDOM(rendered);
  const matches = [...dom.window.document.querySelectorAll("table tr")]
    .map((row) => ({ row, cells: [...row.children].filter((child) => child.tagName === "TD" || child.tagName === "TH") }))
    .filter(({ cells }) => cells.length >= 2 && normalizeCellText(cells[0].textContent) === "新周计划");
  if (matches.length !== 1) {
    throw new Error(`weekly-context-plan-row-invalid: expected one 新周计划 table row, found ${matches.length}`);
  }
  const [{ row, cells }] = matches;
  const sanitizedRow = sanitizeTableRow(dom.window.document, row);
  const sanitizedDocument = new JSDOM(sanitizedRow);
  const sanitizedCells = [...sanitizedDocument.window.document.querySelectorAll("tr")][0]
    ? [...sanitizedDocument.window.document.querySelectorAll("tr")][0].children
    : [];
  const planTableRow = {
    label: "新周计划",
    html: sanitizedRow,
    text: row.textContent.replace(/\s+/g, " ").trim(),
    markdown: markdownForPlanRow(sanitizedDocument.window.document, [...sanitizedCells])
  };
  if (cells.slice(1).every((cell) => !cell.textContent.trim())) {
    throw new Error("weekly-context-plan-row-invalid: 新周计划 row has no content");
  }

  return { coverage, sourceUrl, sourceRevision, missingSourceFields, planTableRow };
}

function parseWeeklyFile(sourceText, sourceWeek) {
  const lines = String(sourceText).replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing < 0) throw new Error("weekly-context-source-invalid: frontmatter terminator is missing");
    const metadata = parseFrontmatter(lines.slice(1, closing));
    if (!metadata.size) throw new Error("weekly-context-source-invalid: frontmatter is empty");
    return { metadata, body: lines.slice(closing + 1).join("\n").trim() };
  }

  const expectedTitle = `# Confirmed weekly journal input｜${sourceWeek}`;
  if (lines[0] !== expectedTitle) throw new Error("weekly-context-source-invalid: confirmed weekly.md title is missing or mismatched");
  const separator = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  if (separator < 0) throw new Error("weekly-context-source-invalid: preface metadata terminator is missing");
  const metadata = new Map();
  for (const line of lines.slice(1, separator)) {
    const match = line.match(/^-\s+([^：:]+)[：:]\s*(.*)$/);
    if (!match) throw new Error("weekly-context-source-invalid: malformed preface metadata");
    const key = match[1].trim();
    if (metadata.has(key)) throw new Error(`weekly-context-source-invalid: duplicate metadata field ${key}`);
    metadata.set(key, match[2].trim());
  }
  return { metadata, body: lines.slice(separator + 1).join("\n").trim() };
}

function parseFrontmatter(lines) {
  const metadata = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) throw new Error("weekly-context-source-invalid: malformed frontmatter metadata");
    const key = match[1];
    if (metadata.has(key)) throw new Error(`weekly-context-source-invalid: duplicate metadata field ${key}`);
    metadata.set(key, parseFrontmatterScalar(match[2]));
  }
  return metadata;
}

function parseFrontmatterScalar(raw) {
  if (raw.startsWith("\"") && raw.endsWith("\"")) {
    try { return JSON.parse(raw); }
    catch { throw new Error("weekly-context-source-invalid: malformed quoted frontmatter value"); }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  if (/^[|>&*!{},\[\]]/.test(raw)) throw new Error("weekly-context-source-invalid: unsupported frontmatter value");
  return raw.trim();
}

function validAnchorEvidence(anchor, targetTitle, isLocator) {
  if (!isLocator) return /^已确认标题 block [A-Za-z0-9_-]{6,}$/.test(anchor);
  const titleDate = targetTitle.match(/(?:^|\D)(\d{1,2}\.\d{1,2})(?!\d)/)?.[1];
  const ids = anchor.match(/[A-Za-z0-9_-]{6,}/g) || [];
  return Boolean(titleDate && new RegExp(`周记\\s*>\\s*${titleDate.replace(".", "\\.")}`).test(anchor) && new Set(ids).size >= 2);
}

function markdownForPlanRow(document, cells) {
  const content = cells.slice(1).map((cell) => renderBlockChildren(cell)).filter(Boolean);
  const sections = content.length <= 1
    ? content
    : content.map((value, index) => `#### 单元格 ${index + 2}\n\n${value}`);
  return [`### 新周计划`, ...sections].join("\n\n").trim();
}

function renderBlockChildren(parent) {
  const blocks = [];
  let inline = [];
  const flushInline = () => {
    const value = renderInline(inline).replace(/\s+/g, " ").trim();
    if (value) blocks.push(value);
    inline = [];
  };
  for (const node of parent.childNodes) {
    if (node.nodeType === 3 && !node.nodeValue.trim()) continue;
    if (node.nodeType === 1 && ["OL", "UL", "TABLE", "P", "BLOCKQUOTE", "PRE", "HR", "DIV"].includes(node.tagName)) {
      flushInline();
      const value = renderBlock(node);
      if (value) blocks.push(value);
    } else {
      inline.push(node);
    }
  }
  flushInline();
  return blocks.join("\n\n").trim();
}

function renderBlock(node, indent = 0) {
  const spaces = " ".repeat(indent);
  switch (node.tagName) {
    case "OL":
    case "UL":
      return renderList(node, indent);
    case "TABLE":
      return renderTable(node, indent);
    case "P":
      return renderInline([...node.childNodes]).trim();
    case "BLOCKQUOTE":
      return renderBlockChildren(node).split("\n").map((line) => `${spaces}> ${line}`).join("\n");
    case "PRE":
      return `${spaces}\`\`\`\n${node.textContent.replace(/\n+$/, "")}\n${spaces}\`\`\``;
    case "HR":
      return `${spaces}---`;
    case "DIV":
      return renderBlockChildren(node);
    default:
      return renderInline([node]).trim();
  }
}

function renderList(list, indent) {
  const ordered = list.tagName === "OL";
  const initial = Number(list.getAttribute("start") || 1);
  let ordinal = initial;
  const items = [...list.children].filter((child) => child.tagName === "LI");
  return items.map((item) => {
    if (item.hasAttribute("value") && ordered) ordinal = Number(item.getAttribute("value"));
    const marker = ordered ? `${ordinal}. ` : "- ";
    if (ordered) ordinal += 1;
    const itemLines = [];
    let inline = [];
    let hasContent = false;
    const flushInline = () => {
      const value = renderInline(inline).replace(/\s+/g, " ").trim();
      if (value) {
        itemLines.push(`${" ".repeat(indent + (hasContent ? marker.length : 0))}${hasContent ? "" : marker}${value}`);
        hasContent = true;
      }
      inline = [];
    };
    for (const child of item.childNodes) {
      if (child.nodeType === 3 && !child.nodeValue.trim()) continue;
      if (child.nodeType === 1 && ["OL", "UL", "TABLE", "P", "BLOCKQUOTE", "PRE", "HR", "DIV"].includes(child.tagName)) {
        flushInline();
        const value = renderBlock(child, indent + marker.length);
        if (value) {
          itemLines.push(value);
          hasContent = true;
        }
      } else {
        inline.push(child);
      }
    }
    flushInline();
    if (!itemLines.length) itemLines.push(`${" ".repeat(indent)}${marker}`.trimEnd());
    return itemLines.join("\n");
  }).join("\n");
}

function renderTable(table, indent) {
  const rows = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
  if (!rows.length) return "";
  const values = rows.map((row) => [...row.children]
    .filter((cell) => cell.tagName === "TH" || cell.tagName === "TD")
    .map((cell) => renderInline([...cell.childNodes]).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")));
  const width = Math.max(...values.map((row) => row.length));
  const normalized = values.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const rule = Array(width).fill("---");
  return [normalized[0], rule, ...normalized.slice(1)]
    .map((row) => `${" ".repeat(indent)}| ${row.join(" | ")} |`).join("\n");
}

function renderInline(nodes) {
  const rendered = nodes.map((node) => {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const children = renderInline([...node.childNodes]);
    switch (node.tagName) {
      case "A": {
        const href = safeHref(node.getAttribute("href"));
        return href ? `[${children.trim()}](<${href.replace(/>/g, "%3E")}>)` : children;
      }
      case "STRONG":
      case "B": return `**${children.trim()}**`;
      case "EM":
      case "I": return `*${children.trim()}*`;
      case "S":
      case "DEL": return `~~${children.trim()}~~`;
      case "CODE": return `\`${children.trim()}\``;
      case "BR": return "  \n";
      default: return children;
    }
  }).join("");
  return rendered.replace(/[\t\r\f\v ]+/g, " ").trim();
}

function requiredMetadata(metadata, key) {
  const value = metadata.get(key);
  if (!value) throw new Error(`weekly-context-source-invalid: required metadata ${key} is missing`);
  return value;
}

function hasExpectedDate(title, shortDate) {
  const escaped = shortDate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\d])${escaped}(?!\\d)`).test(title);
}

function normalizeCellText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeTableRow(document, row) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  tbody.appendChild(row.cloneNode(true));
  table.appendChild(tbody);
  sanitizeNode(table);
  return table.outerHTML;
}

const ALLOWED_ELEMENTS = new Set([
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "OL", "UL", "LI", "A", "P", "BR",
  "STRONG", "EM", "B", "I", "U", "S", "DEL", "BLOCKQUOTE", "PRE", "CODE", "HR", "DIV", "SPAN"
]);
const DROP_ELEMENTS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE"]);
const ALLOWED_ATTRIBUTES = {
  A: new Set(["href", "title"]),
  OL: new Set(["start", "type"]),
  LI: new Set(["value"]),
  TH: new Set(["colspan", "rowspan", "scope"]),
  TD: new Set(["colspan", "rowspan"])
};

function sanitizeNode(element) {
  for (const child of [...element.children]) {
    if (DROP_ELEMENTS.has(child.tagName)) {
      child.remove();
      continue;
    }
    sanitizeNode(child);
    if (!ALLOWED_ELEMENTS.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    const allowed = ALLOWED_ATTRIBUTES[child.tagName] || new Set();
    for (const attribute of [...child.attributes]) {
      if (!allowed.has(attribute.name)) child.removeAttribute(attribute.name);
    }
    if (child.tagName === "A") {
      const href = safeHref(child.getAttribute("href"));
      if (href) {
        child.setAttribute("href", href);
        child.setAttribute("rel", "noopener noreferrer");
      } else {
        child.removeAttribute("href");
      }
    }
  }
}

function safeHref(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

async function readCurrentPointer(currentPath, outputDir) {
  const current = await readOptionalJson(currentPath);
  if (!current) return null;
  if (current.schemaVersion !== "shared-context-pointer/v1"
    || current.producer !== "learn-x"
    || !isWeek(current.planWeek)
    || !isWeek(current.sourceWeek)
    || typeof current.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(current.sha256)
    || typeof current.artifactSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(current.artifactSha256)
    || current.versionPath !== `weekly/${current.planWeek}/${current.sha256}.json`
    || !Number.isFinite(Date.parse(current.publishedAt))) {
    throw new Error("weekly-context-current-invalid: current.json has an invalid pointer contract");
  }
  try {
    normalizeWeek(current.planWeek);
    normalizeWeek(current.sourceWeek);
  } catch {
    throw new Error("weekly-context-current-invalid: current.json contains an invalid ISO week");
  }
  const versionPath = path.join(outputDir, current.versionPath);
  let versionBytes;
  try { versionBytes = await readFile(versionPath); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error("weekly-context-current-invalid: pointed version is missing");
    throw error;
  }
  const actualArtifactSha256 = createHash("sha256").update(versionBytes).digest("hex");
  if (actualArtifactSha256 !== current.artifactSha256) {
    throw new Error("weekly-context-current-invalid: pointed version artifact hash does not match");
  }
  let version;
  try { version = JSON.parse(versionBytes.toString("utf8")); }
  catch { throw new Error("weekly-context-current-invalid: pointed version JSON is invalid"); }
  const expectedCoverage = coverageForWeek(current.sourceWeek);
  const expectedPlanWeek = isoWeekForDate(addDays(expectedCoverage.end, 1));
  if (!version || version.schemaVersion !== "shared-context/v1"
    || version.planWeek !== current.planWeek || version.sourceWeek !== current.sourceWeek
    || version.source?.sha256 !== current.sha256
    || version.coverage?.start !== expectedCoverage.start || version.coverage?.end !== expectedCoverage.end
    || current.planWeek !== expectedPlanWeek
    || version.publishedAt !== current.publishedAt) {
    throw new Error("weekly-context-current-invalid: current.json does not resolve to a valid version");
  }
  return { pointer: current, version };
}

async function readOptionalJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`weekly-context-json-invalid: ${path.basename(filePath)}`);
    throw error;
  }
}

async function writeImmutableJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(tempPath, serializeJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(tempPath, filePath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readOptionalJson(filePath);
    if (!existing || existing.schemaVersion !== value.schemaVersion || existing.source?.sha256 !== value.source?.sha256) {
      throw new Error("weekly-context-version-conflict: immutable version already exists");
    }
    return existing;
  } finally {
    await unlink(tempPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  return null;
}

function assertSameVersion(existing, candidate) {
  if (existing.schemaVersion !== candidate.schemaVersion
    || existing.producer !== candidate.producer
    || existing.planWeek !== candidate.planWeek
    || existing.sourceWeek !== candidate.sourceWeek
    || JSON.stringify(existing.coverage) !== JSON.stringify(candidate.coverage)
    || existing.source?.url !== candidate.source?.url
    || existing.source?.revision !== candidate.source?.revision
    || existing.source?.sha256 !== candidate.source?.sha256
    || JSON.stringify(existing.source?.missing) !== JSON.stringify(candidate.source?.missing)
    || JSON.stringify(existing.payload) !== JSON.stringify(candidate.payload)
    || JSON.stringify(existing.confirmationEvidence) !== JSON.stringify(candidate.confirmationEvidence)) {
    throw new Error("weekly-context-version-conflict: content-addressed version already exists with different metadata");
  }
  return existing;
}

async function withPointerLock(lockPath, action) {
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("weekly-context-current-busy: another publisher holds the current pointer lock");
    throw error;
  }
  try { return await action(); }
  finally {
    await lock.close();
    await unlink(lockPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function atomicReplaceJson(filePath, value, renameFile) {
  const tempPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(tempPath, serializeJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await renameFile(tempPath, filePath); }
  finally { await unlink(tempPath).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeWeek(value) {
  if (!isWeek(value)) throw new Error(`weekly-context-week-invalid: ${value}`);
  const expected = coverageForWeek(value);
  if (isoWeekForDate(expected.start) !== value) throw new Error(`weekly-context-week-invalid: ${value}`);
  return value;
}

function isWeek(value) {
  if (typeof value !== "string" || !/^\d{4}-W\d\d$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const week = Number(value.slice(-2));
  return year >= 1900 && year <= 9999 && week >= 1 && week <= 53;
}

function coverageForWeek(week) {
  const match = String(week).match(/^(\d{4})-W(\d\d)$/);
  if (!match) throw new Error(`weekly-context-week-invalid: ${week}`);
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) throw new Error(`weekly-context-week-invalid: ${week}`);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (weekday - 1) * DAY_MS + (weekNumber - 1) * 7 * DAY_MS);
  const start = monday.toISOString().slice(0, 10);
  const end = new Date(monday.getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  return { start, end };
}

function isoWeekForDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`weekly-context-date-invalid: ${value}`);
  const thursday = new Date(date);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function addDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function compareWeeks(left, right) {
  const [leftYear, leftWeek] = left.split("-W").map(Number);
  const [rightYear, rightWeek] = right.split("-W").map(Number);
  return leftYear === rightYear ? Math.sign(leftWeek - rightWeek) : Math.sign(leftYear - rightYear);
}

function parseArgs(argv) {
  let week = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") week = argv[++index] || null;
    else throw new Error(`weekly-context-argument-invalid: ${argv[index]}`);
  }
  if (!week) throw new Error("weekly-context-argument-invalid: pass --week YYYY-Www");
  return { week };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await publishConfirmedWeeklyContext(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

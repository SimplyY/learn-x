import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const configPath = path.join(repoRoot, "00_config/learn-x.config.json");
const chatPackConfigPath = path.join(repoRoot, "00_config/chatpack.config.json");
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false
});
const defaultLinkOpen =
  markdown.renderer.rules.link_open ||
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") || "";

  if (href.startsWith("learnx://") || href.endsWith(".md") || href.includes(".md#")) {
    const target = href.startsWith("learnx://")
      ? decodeURIComponent(href.replace("learnx://", ""))
      : normalizeMarkdownLink(href);
    token.attrSet("href", "#");
    token.attrSet("class", "wiki-link");
    token.attrSet("data-target", target);
  } else if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

const IGNORED_DIRS = new Set([
  ".git",
  ".agents",
  ".skills",
  "node_modules",
  "dist",
  "03_input",
  "04_output",
  "build",
  ".next",
  ".vite"
]);
const IGNORED_FILES = new Set(["AGENTS.md", "CONTEXT_MASTER.md"]);
const CUSTOM_CONTEXT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".vite"]);
const CUSTOM_CONTEXT_IGNORED_FILES = new Set(["AGENTS.md", "CONTEXT_MASTER.md"]);
const PROMPT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CHATPACK_PROMPT_ROOT = "02_prompts/chatpack";

export async function readAppConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

export async function readChatPackConfig() {
  const config = JSON.parse(await readFile(chatPackConfigPath, "utf8"));
  validateChatPackConfig(config);
  return hydrateChatPackPrompts(config);
}

export async function collectMarkdownFiles(dir = repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const relativeDir = toWebPath(path.relative(repoRoot, path.join(dir, entry.name)));
      if (IGNORED_DIRS.has(entry.name) || relativeDir === "app/code" || relativeDir.startsWith("app/code/")) continue;
      files.push(...(await collectMarkdownFiles(path.join(dir, entry.name))));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md") || IGNORED_FILES.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = toWebPath(path.relative(repoRoot, absolutePath));
    const content = await readFile(absolutePath, "utf8");
    const info = await stat(absolutePath);
    files.push({
      path: relativePath,
      title: titleFromMarkdown(content, relativePath),
      content,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      links: extractLinks(content)
    });
  }

  return files.sort(compareFilePaths);
}

export async function collectCustomContextFiles(dir = repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = toWebPath(path.relative(repoRoot, absolutePath));

    if (entry.isDirectory()) {
      if (CUSTOM_CONTEXT_IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await collectCustomContextFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile() || CUSTOM_CONTEXT_IGNORED_FILES.has(entry.name)) continue;
    if (!isSupportedCustomContextFile(relativePath)) continue;
    const content = await readFile(absolutePath, "utf8");
    const info = await stat(absolutePath);
    files.push({
      path: relativePath,
      title: titleFromMarkdown(content, relativePath),
      content,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      links: extractLinks(content)
    });
  }

  return files.sort(compareFilePaths);
}

function isSupportedCustomContextFile(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".md") return true;
  return extension === ".json" && relativePath.startsWith("04_output/_dist/");
}

export function renderMarkdown(content) {
  const withWikiLinks = content.replace(/\[\[([^\]\n]+)\]\]/g, (_match, target) => {
    const clean = target.trim();
    return `[${clean}](learnx://${encodeURIComponent(clean)})`;
  });
  const rendered = markdown.render(withWikiLinks);

  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["target", "data-target"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|learnx):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  });
}

export function filterFilesByIncludes(files, includes) {
  if (!includes.length) return files;
  return files.filter((file) =>
    includes.some((includePath) => file.path === includePath || file.path.startsWith(`${includePath}/`))
  );
}

export function buildContext(files, label = "Learn-X") {
  const generatedAt = new Date().toISOString();
  const body = files
    .map((file) => `## ${file.path}\n\n${demoteMarkdownHeadings(file.content.trim())}\n`)
    .join("\n---\n\n");

  return `# CONTEXT_MASTER\n\nSource: ${label}\nGenerated from Learn-X at ${generatedAt}.\n\n${body}\n`;
}

export async function buildGraphPayload({ includeContent = false } = {}) {
  const appConfig = await readAppConfig();
  const chatPackConfig = await readChatPackConfig();
  const files = await collectMarkdownFiles();
  const customFiles = await collectCustomContextFiles();
  const prompts = await buildPromptMap(appConfig);
  const contextWeights = appConfig.contextWeights || fallbackContextWeights();

  return {
    appConfig,
    chatPackConfig,
    files: files.map((file) => {
      const preview = file.content.trim().split(/\n\s*\n/)[0] || "";
      const payload = {
        path: file.path,
        title: file.title,
        size: file.size,
        modifiedAt: file.modifiedAt,
        links: file.links,
        preview,
        previewHtml: renderMarkdown(preview)
      };
      if (includeContent) {
        payload.content = file.content;
        payload.html = renderMarkdown(file.content);
      }
      return payload;
    }),
    tree: buildTree(files),
    sources: buildSources(files, appConfig),
    contextFiles: buildContextFiles(files, contextWeights, appConfig),
    customContextFiles: buildContextFiles(customFiles, contextWeights, appConfig, { includePrompts: true, includeContent }),
    contextWeights,
    domains: buildDomains(files, appConfig),
    prompts,
    promptDirectory: appConfig.promptDirectory || "01_meta-prompts"
  };
}

function validateChatPackConfig(config) {
  const ids = new Set();
  for (const type of config.dialogueTypes || []) {
    assertUniqueId(type.id, ids, "dialogue type");
    for (const subtype of type.subtypes || []) {
      assertUniqueId(subtype.id, ids, "dialogue subtype");
      if (!subtype.id.startsWith(`${type.id}.`)) {
        throw new Error(`Dialogue subtype id must start with "${type.id}.": ${subtype.id}`);
      }
      const promptSlug = subtype.id.slice(type.id.length + 1);
      if (!PROMPT_ID_PATTERN.test(promptSlug) || promptSlug.includes(".")) {
        throw new Error(`Dialogue subtype id must map to one file name: ${subtype.id}`);
      }
    }
  }
  for (const enhancer of config.enhancers || []) {
    assertUniqueId(enhancer.id, ids, "enhancer");
    if (!PROMPT_ID_PATTERN.test(enhancer.id)) {
      throw new Error(`Enhancer id must map to one file name: ${enhancer.id}`);
    }
  }
}

async function hydrateChatPackPrompts(config) {
  const dialogueTypes = await Promise.all(
    (config.dialogueTypes || []).map(async (type) => ({
      ...type,
      subtypes: await Promise.all(
        (type.subtypes || []).map(async (subtype) => ({
          ...subtype,
          protocol: await readChatPackPrompt(type.id, subtype.id)
        }))
      )
    }))
  );

  const enhancers = await Promise.all(
    (config.enhancers || []).map(async (enhancer) => ({
      ...enhancer,
      protocol: await readEnhancerPrompt(enhancer)
    }))
  );

  return { ...config, dialogueTypes, enhancers };
}

async function readChatPackPrompt(typeId, subtypeId) {
  const subtypeSlug = subtypeId.slice(typeId.length + 1);
  const promptPath = `${CHATPACK_PROMPT_ROOT}/${typeId}/${subtypeSlug}.md`;
  const absolutePath = path.resolve(repoRoot, promptPath);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`) || !absolutePath.endsWith(".md")) {
    throw new Error(`Invalid Chat Pack prompt id: ${subtypeId}`);
  }
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing Chat Pack prompt file for ${subtypeId}: ${promptPath}`);
    }
    throw error;
  }
}

async function readEnhancerPrompt(enhancer) {
  const promptPath = enhancer.promptPath || `${CHATPACK_PROMPT_ROOT}/enhancers/${enhancer.id}.md`;
  const absolutePath = path.resolve(repoRoot, promptPath);
  if (!absolutePath.startsWith(`${repoRoot}${path.sep}`) || !absolutePath.endsWith(".md")) {
    throw new Error(`Invalid enhancer prompt path: ${enhancer.id}`);
  }
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing enhancer prompt file for ${enhancer.id}: ${promptPath}`);
    }
    throw error;
  }
}

function assertUniqueId(id, ids, label) {
  if (!id) throw new Error(`Missing ${label} id`);
  if (ids.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
  ids.add(id);
}

async function buildPromptMap(appConfig) {
  const scenarios = appConfig.learningScenarios || [];
  const entries = await Promise.all(
    scenarios.map(async (scenario) => {
      try {
        return [scenario.id, await readPrompt(scenario.id, appConfig)];
      } catch (error) {
        return [scenario.id, `# Prompt 加载失败\n\n${error.message}`];
      }
    })
  );

  return Object.fromEntries(entries);
}

async function readPrompt(id, appConfig) {
  if (!PROMPT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid prompt id: ${id}`);
  }

  const promptDirectory = appConfig.promptDirectory || "01_meta-prompts";
  const promptRoot = path.resolve(repoRoot, promptDirectory);
  const absolutePath = path.resolve(promptRoot, `${id}.md`);

  if (!absolutePath.startsWith(`${promptRoot}${path.sep}`)) {
    throw new Error(`Invalid prompt path: ${id}`);
  }

  return readFile(absolutePath, "utf8");
}

function titleFromMarkdown(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(fallback, ".md");
}

function extractLinks(content) {
  const links = new Set();
  const wikiPattern = /\[\[([^\]\n]+)\]\]/g;
  const mdPattern = /\[[^\]\n]+\]\(([^)\n]+\.md(?:#[^)]+)?)\)/g;
  let match;

  while ((match = wikiPattern.exec(content))) links.add(match[1].trim());
  while ((match = mdPattern.exec(content))) links.add(decodeURI(match[1].trim()));
  return [...links];
}

function normalizeMarkdownLink(href) {
  const [withoutHash] = href.split("#");
  return decodeURIComponent(withoutHash).replace(/^\.\//, "");
}

function buildTree(files) {
  const root = { name: "Learn-X", type: "root", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      let node = cursor.children.find((child) => child.name === part);
      if (!node) {
        node = {
          name: part,
          type: isFile ? "file" : "folder",
          path: isFile ? file.path : undefined,
          children: isFile ? undefined : []
        };
        cursor.children.push(node);
      }
      if (!isFile) cursor = node;
    }
  }
  return root;
}

function buildSources(files, appConfig) {
  const promptDirectory = appConfig.promptDirectory || "01_meta-prompts";
  const sourceMap = new Map([["README.md", { path: "README.md", label: "README.md", type: "file" }]]);
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts[0] === "01_core" && parts[1] === "道") {
      sourceMap.set("01_core/道", { path: "01_core/道", label: "01_core/道/", type: "directory" });
    }
    if (parts[0] === "01_core" && parts[1] === "法" && parts[2] && parts[0] !== promptDirectory) {
      const domainPath = `01_core/法/${parts[2]}`;
      sourceMap.set(domainPath, { path: domainPath, label: `${domainPath}/`, type: "domain" });
    }
  }

  return [...sourceMap.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function buildDomains(files, appConfig) {
  const promptDirectory = appConfig.promptDirectory || "01_meta-prompts";
  const domains = new Set();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts[0] === promptDirectory) continue;
    if (parts[0] === "01_core" && parts[1] === "法" && parts[2]) domains.add(parts[2]);
  }
  return [...domains].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function buildContextFiles(files, weightConfig, appConfig, options = {}) {
  const promptDirectory = appConfig.promptDirectory || "01_meta-prompts";

  return files
    .filter((file) => {
      const parts = file.path.split("/");
      return (options.includePrompts || parts[0] !== promptDirectory) && file.path !== "AGENTS.md";
    })
    .map((file) => {
      const payload = {
        path: file.path,
        label: file.path,
        title: file.title,
        size: file.size,
        ...resolveContextWeight(file.path, weightConfig, appConfig)
      };
      if (options.includeContent) payload.content = file.content;
      return payload;
    });
}

function resolveContextWeight(filePath, weightConfig, appConfig) {
  const inferredLayer = inferLayer(filePath, appConfig);
  const matchedRule = findWeightRule(filePath, weightConfig.paths || []);
  const layer = matchedRule?.layer || inferredLayer;
  const layerConfig = weightConfig.layers?.[layer] || {};
  const defaults = weightConfig.defaults || {};

  return {
    layer,
    baseWeight: matchedRule?.baseWeight ?? layerConfig.baseWeight ?? defaults.baseWeight ?? 50,
    tags: matchedRule?.tags || layerConfig.tags || [],
    modeMultipliers: {
      ...(defaults.modeMultipliers || {}),
      ...(layerConfig.modeMultipliers || {}),
      ...(matchedRule?.modeMultipliers || {})
    },
    defaultStrategy: matchedRule?.defaultStrategy || layerConfig.defaultStrategy || defaults.defaultStrategy || "normal"
  };
}

function inferLayer(filePath, appConfig) {
  const parts = filePath.split("/");
  if (parts[0] === "output" && parts[1] === "memory") return "memory";
  if (filePath === "README.md" || (parts[0] === "01_core" && parts[1] === "道")) return "dao";
  if (parts[0] === "01_core" && parts[1] === "法" && (parts[2] === "read" || parts[2] === "theme-read")) return "read";
  if (parts[0] === "01_core" && parts[1] === "法") return "fa";
  if (parts[0] === appConfig.promptDirectory) return "prompt";
  return "shu";
}

function findWeightRule(filePath, rules) {
  return rules.find((rule) => matchPathRule(filePath, rule.path));
}

function matchPathRule(filePath, pattern) {
  if (!pattern) return false;
  if (pattern === filePath) return true;

  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else {
      regex += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`).test(filePath);
}

function compareFilePaths(a, b) {
  const aDepth = a.path.split("/").length;
  const bDepth = b.path.split("/").length;
  if (aDepth !== bDepth) return aDepth - bDepth;
  return a.path.localeCompare(b.path, "zh-Hans-CN");
}

function demoteMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (match, hashes) => {
    const level = Math.min(hashes.length + 2, 6);
    return `${"#".repeat(level)} `;
  });
}

function fallbackContextWeights() {
  return {
    defaults: { baseWeight: 50, defaultStrategy: "normal", modeMultipliers: {} },
    layers: {},
    paths: []
  };
}

function toWebPath(filePath) {
  return filePath.split(path.sep).join("/");
}

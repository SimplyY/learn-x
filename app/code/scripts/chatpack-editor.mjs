import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateChatPackConfig } from "./static-graph.mjs";

const EDITABLE_TYPE_FIELDS = ["name", "useCases", "outputGoal", "behaviorDirections", "avoid"];
const EDITABLE_SUBTYPE_FIELDS = ["name", "summary", "recommendedSources", "includeBaseRecommendedSources"];
const EDITABLE_ENHANCER_FIELDS = ["name", "summary", "applicationNote"];

export async function prepareChatPackEdits({ repoRoot, payload }) {
  const configPath = path.join(repoRoot, "00_config/chatpack.config.json");
  const sourceConfig = JSON.parse(await readFile(configPath, "utf8"));
  const config = mergeEditableConfig(sourceConfig, payload, repoRoot);
  validateChatPackConfig(config);

  const writes = [{ path: configPath, content: `${JSON.stringify(config, null, 2)}\n` }];
  if (payload.prompt) {
    const promptPath = resolvePromptPath(config, payload.prompt);
    writes.push({ path: path.join(repoRoot, promptPath), content: normalizePrompt(payload.prompt.content) });
  }
  return writes;
}

export async function writePreparedEdits(writes) {
  const prepared = [];
  try {
    for (const item of writes) {
      await mkdir(path.dirname(item.path), { recursive: true });
      const temporaryPath = `${item.path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, item.content, "utf8");
      prepared.push({ ...item, temporaryPath });
    }
    for (const item of prepared) await rename(item.temporaryPath, item.path);
  } catch (error) {
    await Promise.allSettled(prepared.map((item) => import("node:fs/promises").then(({ rm }) => rm(item.temporaryPath, { force: true }))));
    throw error;
  }
}

export function mergeEditableConfig(sourceConfig, payload, repoRoot) {
  const nextTypes = orderedItems(sourceConfig.dialogueTypes, payload.dialogueTypes, "dialogue type").map(({ source, next }) => {
    const mergedType = copyEditableFields(source, next, EDITABLE_TYPE_FIELDS);
    mergedType.subtypes = orderedItems(source.subtypes || [], next.subtypes || [], `subtype of ${source.id}`).map(
      ({ source: sourceSubtype, next: nextSubtype }) => {
        const mergedSubtype = copyEditableFields(sourceSubtype, nextSubtype, EDITABLE_SUBTYPE_FIELDS);
        const recommendedSources = validateRecommendedSources(mergedSubtype.recommendedSources || [], repoRoot);
        if (Object.hasOwn(mergedSubtype, "recommendedSources") || recommendedSources.length > 0) {
          mergedSubtype.recommendedSources = recommendedSources;
        }
        return mergedSubtype;
      }
    );
    return mergedType;
  });
  const nextEnhancers = orderedItems(sourceConfig.enhancers || [], payload.enhancers || [], "enhancer").map(
    ({ source, next }) => copyEditableFields(source, next, EDITABLE_ENHANCER_FIELDS)
  );
  return { ...sourceConfig, dialogueTypes: nextTypes, enhancers: nextEnhancers };
}

function orderedItems(sourceItems, nextItems, label) {
  if (!Array.isArray(nextItems) || nextItems.length !== sourceItems.length) throw new Error(`Invalid ${label} list`);
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const seen = new Set();
  return nextItems.map((next) => {
    const source = sourceById.get(next?.id);
    if (!source || seen.has(next.id)) throw new Error(`Invalid ${label} id: ${next?.id || "missing"}`);
    seen.add(next.id);
    return { source, next };
  });
}

function copyEditableFields(source, next, fields) {
  const merged = { ...source };
  for (const field of fields) {
    if (!Object.hasOwn(next, field)) continue;
    const value = next[field];
    if (field === "recommendedSources" && !Object.hasOwn(source, field) && Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (["behaviorDirections", "avoid"].includes(field)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be a text list`);
    } else if (field === "recommendedSources") {
      if (!Array.isArray(value)) throw new Error("recommendedSources must be an array");
    } else if (field === "includeBaseRecommendedSources") {
      if (typeof value !== "boolean") throw new Error("includeBaseRecommendedSources must be boolean");
    } else if (typeof value !== "string") {
      throw new Error(`${field} must be text`);
    }
    if (field === "name" && !value.trim()) throw new Error("Name cannot be empty");
    merged[field] = value;
  }
  return merged;
}

function validateRecommendedSources(sources, repoRoot) {
  if (!Array.isArray(sources)) throw new Error("recommendedSources must be an array");
  const unique = [];
  for (const source of sources) {
    if (typeof source !== "string" || !source.trim()) throw new Error("Recommended context path is required");
    const clean = source.trim().replaceAll("\\", "/");
    if (clean.startsWith("/") || clean.split("/").includes("..") || clean.includes("\0")) {
      throw new Error(`Unsafe recommended context path: ${source}`);
    }
    const validationPath = clean.includes("{{domain}}") ? clean.split("{{domain}}")[0].replace(/\/$/, "") : clean;
    const absolutePath = path.resolve(repoRoot, validationPath || ".");
    if (!absolutePath.startsWith(`${path.resolve(repoRoot)}${path.sep}`) && absolutePath !== path.resolve(repoRoot)) {
      throw new Error(`Recommended context escapes repository: ${source}`);
    }
    if (!unique.includes(clean)) unique.push(clean);
  }
  return unique;
}

function resolvePromptPath(config, prompt) {
  if (!prompt || !["subtype", "enhancer"].includes(prompt.kind) || typeof prompt.id !== "string") {
    throw new Error("Invalid prompt target");
  }
  if (prompt.kind === "enhancer") {
    const enhancer = config.enhancers.find((item) => item.id === prompt.id);
    if (!enhancer) throw new Error(`Unknown enhancer: ${prompt.id}`);
    return enhancer.promptPath || `02_prompts/chatpack/enhancers/${enhancer.id}.md`;
  }
  for (const type of config.dialogueTypes) {
    const subtype = type.subtypes.find((item) => item.id === prompt.id);
    if (!subtype) continue;
    return `02_prompts/chatpack/${type.id}/${subtype.id.slice(type.id.length + 1)}.md`;
  }
  throw new Error(`Unknown subtype: ${prompt.id}`);
}

function normalizePrompt(content) {
  if (typeof content !== "string") throw new Error("Prompt content must be text");
  const normalized = content.replaceAll("\r\n", "\n").trimEnd();
  if (!normalized.trim()) throw new Error("Prompt content cannot be empty");
  if (Buffer.byteLength(normalized, "utf8") > 512_000) throw new Error("Prompt content is too large");
  return `${normalized}\n`;
}

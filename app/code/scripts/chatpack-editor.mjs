import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateChatPackConfig } from "./static-graph.mjs";

const EDITABLE_TYPE_FIELDS = ["name", "useCases", "outputGoal", "behaviorDirections", "avoid"];
const EDITABLE_SUBTYPE_FIELDS = ["name", "summary", "currentQuestion", "recommendedSources", "includeBaseRecommendedSources"];
const EDITABLE_ENHANCER_FIELDS = ["name", "summary", "applicationNote"];

export async function prepareChatPackEdits({ repoRoot, payload }) {
  const configPath = path.join(repoRoot, "00_config/chatpack.config.json");
  const sourceConfig = JSON.parse(await readFile(configPath, "utf8"));
  const config = mergeEditableConfig(sourceConfig, payload, repoRoot);
  validateChatPackConfig(config);

  const writes = [{ path: configPath, content: `${JSON.stringify(config, null, 2)}\n` }];
  writes.push(...(await prepareSubtypePromptWrites(repoRoot, sourceConfig, config, payload)));
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
  const allowDelete = payload.allowDelete === true || payload.editorMode === "category";
  const sourceSubtypes = new Map((sourceConfig.dialogueTypes || []).flatMap((type) => (type.subtypes || []).map((subtype) => [subtype.id, subtype])));
  const nextSubtypeRefs = new Set();
  const nextTypes = orderedItems(sourceConfig.dialogueTypes, payload.dialogueTypes, "dialogue type", {
    allowAdd: true,
    allowDelete,
    create: createDialogueType
  }).map(({ source, next }) => {
    const mergedType = source ? copyEditableFields(source, next, EDITABLE_TYPE_FIELDS) : copyEditableFields(next, next, EDITABLE_TYPE_FIELDS);
    mergedType.id = source?.id || next.id;
    mergedType.subtypes = (next.subtypes || []).map((nextSubtype) => {
      const sourceSubtype = sourceSubtypes.get(nextSubtype.previousId || nextSubtype.id);
      if (sourceSubtype) nextSubtypeRefs.add(sourceSubtype.id);
      const mergedSubtype = sourceSubtype
        ? copyEditableFields(sourceSubtype, nextSubtype, EDITABLE_SUBTYPE_FIELDS)
        : copyEditableFields(createDialogueSubtype(nextSubtype, mergedType.id), nextSubtype, EDITABLE_SUBTYPE_FIELDS);
      mergedSubtype.id = nextSubtype.id;
      delete mergedSubtype.previousId;
      const recommendedSources = validateRecommendedSources(mergedSubtype.recommendedSources || [], repoRoot);
      if (Object.hasOwn(mergedSubtype, "recommendedSources") || recommendedSources.length > 0) {
        mergedSubtype.recommendedSources = recommendedSources;
      }
      return mergedSubtype;
    });
    return mergedType;
  });
  for (const id of sourceSubtypes.keys()) {
    if (!allowDelete && !nextSubtypeRefs.has(id)) throw new Error(`Missing existing subtype: ${id}`);
  }
  const nextEnhancers = orderedItems(sourceConfig.enhancers || [], payload.enhancers || [], "enhancer").map(
    ({ source, next }) => copyEditableFields(source, next, EDITABLE_ENHANCER_FIELDS)
  );
  return { ...sourceConfig, dialogueTypes: nextTypes, enhancers: nextEnhancers };
}

function orderedItems(sourceItems, nextItems, label, options = {}) {
  if (
    !Array.isArray(nextItems) ||
    (!options.allowDelete && nextItems.length < sourceItems.length) ||
    (!options.allowAdd && nextItems.length !== sourceItems.length)
  ) {
    throw new Error(`Invalid ${label} list`);
  }
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const seen = new Set();
  const ordered = nextItems.map((next) => {
    const source = sourceById.get(next?.id);
    if ((!source && !options.allowAdd) || seen.has(next?.id)) throw new Error(`Invalid ${label} id: ${next?.id || "missing"}`);
    if (!source && !options.create) throw new Error(`Invalid ${label} id: ${next?.id || "missing"}`);
    seen.add(next.id);
    return { source: source || options.create(next), next };
  });
  for (const id of sourceById.keys()) {
    if (!options.allowDelete && !seen.has(id)) throw new Error(`Missing existing ${label}: ${id}`);
  }
  return ordered;
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

function createDialogueType(next) {
  if (!next || typeof next.id !== "string" || !next.id.trim()) throw new Error("Missing dialogue type id");
  return {
    id: next.id,
    name: "",
    useCases: "",
    behaviorDirections: [],
    outputGoal: "",
    subtypes: [],
    avoid: []
  };
}

function createDialogueSubtype(next, typeId) {
  if (!next || typeof next.id !== "string" || !next.id.startsWith(`${typeId}.`)) throw new Error("Invalid new subtype id");
  return {
    id: next.id,
    name: "",
    summary: "",
    recommendedSources: []
  };
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

async function prepareSubtypePromptWrites(repoRoot, sourceConfig, config, payload) {
  const sourceSubtypes = new Map();
  for (const type of sourceConfig.dialogueTypes || []) {
    for (const subtype of type.subtypes || []) {
      sourceSubtypes.set(subtype.id, { typeId: type.id, subtype });
    }
  }
  const payloadSubtypes = new Map();
  for (const type of payload.dialogueTypes || []) {
    for (const subtype of type.subtypes || []) payloadSubtypes.set(subtype.id, subtype);
  }
  const writes = [];
  for (const type of config.dialogueTypes || []) {
    for (const subtype of type.subtypes || []) {
      if (sourceSubtypes.has(subtype.id)) continue;
      const previousId = payloadSubtypes.get(subtype.id)?.previousId;
      const previous = previousId ? sourceSubtypes.get(previousId) : null;
      const content = previous
        ? await readFile(path.join(repoRoot, subtypePromptPath(previous.typeId, previous.subtype.id)), "utf8")
        : defaultSubtypePrompt(subtype);
      writes.push({ path: path.join(repoRoot, subtypePromptPath(type.id, subtype.id)), content: normalizePrompt(content) });
    }
  }
  return writes;
}

function subtypePromptPath(typeId, subtypeId) {
  return `02_prompts/chatpack/${typeId}/${subtypeId.slice(typeId.length + 1)}.md`;
}

function defaultSubtypePrompt(subtype) {
  return `# ${subtype.name || subtype.id}\n\n请围绕 Current Question 和已选 Context 完成任务。\n`;
}

function normalizePrompt(content) {
  if (typeof content !== "string") throw new Error("Prompt content must be text");
  const normalized = content.replaceAll("\r\n", "\n").trimEnd();
  if (!normalized.trim()) throw new Error("Prompt content cannot be empty");
  if (Buffer.byteLength(normalized, "utf8") > 512_000) throw new Error("Prompt content is too large");
  return `${normalized}\n`;
}

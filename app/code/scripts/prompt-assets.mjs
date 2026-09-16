import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const PROMPT_ASSETS_SCHEMA = "learn-x-prompt-assets/v1";
const RELATIVE_PATH = "00_config/prompt-assets.json";
const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TIER_RE = /^(P0|P1)$/;

export function promptAssetsPath(repoRoot) {
  return path.join(repoRoot, RELATIVE_PATH);
}

export async function readPromptAssets(repoRoot, { optional = true } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(promptAssetsPath(repoRoot), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && optional) return { schema_version: PROMPT_ASSETS_SCHEMA, assets: {} };
    if (error.code === "ENOENT") throw new Error("Prompt asset manifest is missing");
    throw new Error(`Invalid prompt asset manifest: ${error.message}`);
  }
  validatePromptAssets(parsed);
  return parsed;
}

export function validatePromptAssets(manifest) {
  if (!manifest || manifest.schema_version !== PROMPT_ASSETS_SCHEMA || !manifest.assets || typeof manifest.assets !== "object" || Array.isArray(manifest.assets)) {
    throw new Error(`Prompt asset manifest must use ${PROMPT_ASSETS_SCHEMA}`);
  }
  for (const [promptId, asset] of Object.entries(manifest.assets)) {
    if (!ID_RE.test(promptId)) throw new Error(`Invalid managed prompt_id: ${promptId}`);
    if (!asset || !TIER_RE.test(asset.tier) || typeof asset.local_path !== "string" || !asset.local_path.trim()) {
      throw new Error(`Invalid managed prompt asset: ${promptId}`);
    }
    if (asset.derived_from !== undefined && (typeof asset.derived_from !== "string" || !ID_RE.test(asset.derived_from))) {
      throw new Error(`Invalid derived_from: ${promptId}`);
    }
    const synced = asset.synced;
    if (!synced || typeof synced.document_id !== "string" || !synced.document_id.trim() || !Number.isInteger(synced.revision) || synced.revision < 0 || !/^[a-f0-9]{64}$/.test(synced.sha256) || !synced.at || Number.isNaN(Date.parse(synced.at))) {
      throw new Error(`Invalid sync metadata: ${promptId}`);
    }
    assertRelativePath(asset.local_path, promptId);
  }
  return manifest;
}

export function assertRelativePath(relativePath, label = "prompt") {
  const clean = String(relativePath).replaceAll("\\", "/");
  if (!clean || !clean.endsWith(".md") || clean.startsWith("/") || clean.includes("\0") || clean.split("/").includes("..")) {
    throw new Error(`Unsafe managed prompt path: ${label}`);
  }
  return clean;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export async function readManagedPrompt(repoRoot, asset, { verify = true } = {}) {
  const relativePath = assertRelativePath(asset.local_path);
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!absolutePath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) throw new Error(`Managed prompt escapes repository: ${relativePath}`);
  let content;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Managed prompt file is missing: ${relativePath}`);
    throw error;
  }
  const hash = sha256(content);
  if (verify && hash !== asset.synced.sha256) throw new Error(`Managed prompt drift detected: ${asset.local_path}`);
  return { content, sha256: hash, absolutePath, relativePath };
}

export async function verifyPromptAssets(repoRoot, manifest, { optional = true } = {}) {
  if (!manifest) manifest = await readPromptAssets(repoRoot, { optional });
  const result = {};
  for (const [promptId, asset] of Object.entries(manifest.assets || {})) {
    const file = await readManagedPrompt(repoRoot, asset);
    result[promptId] = { prompt_id: promptId, revision: asset.synced.revision, sha256: file.sha256, synced_at: asset.synced.at, local_path: asset.local_path };
  }
  return result;
}

export function findManagedAsset(manifest, localPath) {
  const clean = String(localPath).replaceAll("\\", "/");
  return Object.entries(manifest?.assets || {}).find(([, asset]) => asset.local_path === clean)?.[0] || null;
}

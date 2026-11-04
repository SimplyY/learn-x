import { existsSync } from "node:fs";
import path from "node:path";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const NO_PROXY_ENV_KEYS = ["NO_PROXY", "no_proxy"];

function bypassesFeishu(entry) {
  const value = entry.trim().toLowerCase();
  if (!value) return false;
  if (value === "*") return true;

  const host = value.replace(/:\d+$/, "").replace(/\.$/, "");
  const normalized = host.replace(/^\*\./, "").replace(/^\./, "");
  return normalized === "feishu.cn" || normalized.endsWith(".feishu.cn");
}

export function configureFeishuProxyRouting(env = process.env) {
  if (!PROXY_ENV_KEYS.some((key) => env[key]?.trim())) return { changed: false, filtered: [] };

  const filtered = [];
  for (const key of NO_PROXY_ENV_KEYS) {
    if (typeof env[key] !== "string" || !env[key].trim()) continue;
    const entries = env[key].split(",").map((entry) => entry.trim()).filter(Boolean);
    const retained = entries.filter((entry) => {
      if (!bypassesFeishu(entry)) return true;
      filtered.push({ key, entry });
      return false;
    });
    if (retained.length !== entries.length) {
      env[key] = retained.length ? retained.join(",") : LOOPBACK_HOSTS.join(",");
    }
  }

  return { changed: filtered.length > 0, filtered };
}

export function configureLarkCliShim(env = process.env, {
  isExecutable = existsSync,
  pathDelimiter = path.delimiter
} = {}) {
  const home = env.HOME?.trim();
  if (!home) return { changed: false, executable: "" };

  const shimDirectory = path.join(home, ".local", "bin");
  const shim = path.join(shimDirectory, "lark-cli");
  if (!isExecutable(shim)) return { changed: false, executable: "" };

  const entries = (env.PATH || "").split(pathDelimiter).filter(Boolean);
  const normalizedDirectory = path.resolve(shimDirectory);
  const alreadyFirst = entries[0] && path.resolve(entries[0]) === normalizedDirectory;
  if (alreadyFirst) return { changed: false, executable: shim };

  const remaining = entries.filter((entry) => path.resolve(entry) !== normalizedDirectory);
  env.PATH = [shimDirectory, ...remaining].join(pathDelimiter);
  return { changed: true, executable: shim };
}

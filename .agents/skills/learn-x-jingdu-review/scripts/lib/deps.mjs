// 共享库装载（Slice A：/Users/yuwei/code/skills/mobile-async-review/lib）。
// 契约编码见 SKILL.md；缺库时 fail-closed（SHARED_LIB_UNAVAILABLE），不静默降级、不重造轮子。
// 测试可用 JINGDU_SHARED_LIB_DIR 指向 fake-lib，或直接向命令注入 deps 对象。

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fail, skillRoot } from "./paths.mjs";

export const DEFAULT_SHARED_LIB_DIR = "/Users/yuwei/code/skills/mobile-async-review/lib";
export const SHARED_LIB_DIR = process.env.JINGDU_SHARED_LIB_DIR || DEFAULT_SHARED_LIB_DIR;

const SHARED_MODULES = [
  ["fsafe", "fsafe.mjs"],
  ["lock", "lock.mjs"],
  ["records", "records.mjs"],
  ["idempotency", "idempotency.mjs"],
  ["lark", "lark.mjs"],
  ["parseSession", "parse-session.mjs"],
  ["changeset", "changeset.mjs"]
];

export async function loadSharedLib({ required = SHARED_MODULES.map(([key]) => key) } = {}) {
  const lib = {};
  const missing = [];
  for (const [key, file] of SHARED_MODULES) {
    try {
      lib[key] = await import(path.join(SHARED_LIB_DIR, file));
    } catch (error) {
      missing.push({ key, file, message: error?.message ?? String(error) });
    }
  }
  const absent = required.filter((key) => !lib[key]);
  if (absent.length) {
    throw fail("SHARED_LIB_UNAVAILABLE", `共享库不可用（${absent.join(", ")}）：${SHARED_LIB_DIR}。可用 JINGDU_SHARED_LIB_DIR 指向实现目录后重试。`);
  }
  return lib;
}

export async function loadConfig(skill = skillRoot()) {
  try {
    const raw = await readFile(path.join(skill, "config.json"), "utf8");
    const config = JSON.parse(raw);
    if (config.chatId && !/^oc_[0-9a-f]+$/.test(config.chatId)) {
      throw fail("CONFIG_INVALID", `config.json chatId 非法（期望 oc_ 开头的 chat id）`);
    }
    return { present: true, ...config };
  } catch (error) {
    if (error?.code === "CONFIG_INVALID") throw error;
    if (error?.code === "ENOENT") return { present: false };
    if (error instanceof SyntaxError) throw fail("CONFIG_INVALID", `config.json 无法解析：${error.message}`);
    throw error;
  }
}

export function requireChatId(config) {
  if (!config?.chatId) throw fail("CONFIG_MISSING", `缺少 config.json chatId（Learn 群）；在 skill 目录 config.json 填写 chatId 后重试。`);
  return config.chatId;
}

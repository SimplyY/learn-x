#!/usr/bin/env node
// 批量授予 bot（codex 小助手）飞书写权限，支撑「AI Docx/Wiki 写入口固定 --as bot」契约。
// 用法：
//   node scripts/grant-bot-write-access.mjs plan              # 只打印将执行的动作
//   node scripts/grant-bot-write-access.mjs apply             # 执行全部授权（幂等，已存在则跳过）
//   node scripts/grant-bot-write-access.mjs repos             # 扫描全部仓库 GROUP_INFO.md 关联的 wiki 并授权
//   node scripts/grant-bot-write-access.mjs all-spaces        # bot 加入用户名下全部 wiki 空间
//   node scripts/grant-bot-write-access.mjs verify            # 回读授权状态
// 授权范围：
//   1) 清单内 wiki 空间（bot 加入成员，覆盖该空间全部 node-create/正文写入）
//   2) 清单内文档 + 全部受治理 Prompt wiki 文档（bot edit 协作者）
//   3) repos 模式：全部仓库 GROUP_INFO.md 的 wiki/docx 链接 → 解析所属空间后按 1)/2) 授权
// Base 写入按契约仍用 user 身份，不在授权范围。
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BOT_APP_ID = "cli_aab030a473f8dcd2";
const BOT_OPEN_ID = "ou_dffb55cb87c7ac0801e2bff3762a2ddf";
const REGISTRY_PATH = "/Users/yuwei/code/skills/prompt-governance/registry.json";
const CODE_ROOT = "/Users/yuwei/code";

// 固定清单：核心议题（深度研究/工作台/季度总览/周期洞察）、大佬情报（月报）。
const WIKI_SPACES = [
  { spaceId: "7685945374065839292", name: "核心议题" },
  { spaceId: "7667182086968577315", name: "大佬情报" }
];
const DOCS = [{ token: "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac", name: "周记（2026 周记 & 月记 & 年记）" }];

function larkBin() {
  const inPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
    .some((dir) => existsSync(path.join(dir, "lark-cli")));
  return inPath ? "lark-cli"
    : ["/opt/homebrew/bin/lark-cli", path.join(homedir(), ".lark-channel/bin/lark-cli")].find(existsSync) || "lark-cli";
}

async function lark(args) {
  const { stdout } = await execFileAsync(larkBin(), [...args, "--as", "user", "--format", "json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function governedWikiTokens() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const prompts = Array.isArray(registry.prompts) ? registry.prompts : Object.values(registry.prompts || {});
  return prompts
    .map((item) => String(item?.source || "").match(/wiki\/([A-Za-z0-9]+)/)?.[1])
    .filter(Boolean);
}

function groupInfoFiles() {
  return readdirSync(CODE_ROOT)
    .map((name) => path.join(CODE_ROOT, name, "GROUP_INFO.md"))
    .filter((file) => { try { return statSync(file).isFile(); } catch { return false; } });
}

// 扫描全部 GROUP_INFO.md，抽取 wiki/docx 链接；wiki 节点解析到所属空间。
async function collectRepoTargets() {
  const spaces = new Map();
  const docs = new Map();
  const bases = [];
  for (const file of groupInfoFiles()) {
    const repo = path.basename(path.dirname(file));
    const text = readFileSync(file, "utf8");
    const urls = [...text.matchAll(/https:\/\/[a-z]+\.feishu\.cn\/(wiki|docx|base)\/([A-Za-z0-9]+)/g)];
    for (const [, kind, token] of urls) {
      if (kind === "base") { bases.push(`${repo}:${token}`); continue; }
      const url = `https://ywhome.feishu.cn/${kind}/${token}`;
      if (kind === "docx") { docs.set(url, { name: `${repo} GROUP_INFO docx`, bare: true }); continue; }
      try {
        const node = (await lark(["wiki", "+node-get", "--node-token", url])).data || {};
        if (node.space_id) {
          if (!spaces.has(node.space_id)) spaces.set(node.space_id, node.title || node.space_id);
        } else {
          docs.set(url, { name: `${repo} GROUP_INFO wiki`, bare: false });
        }
      } catch {
        docs.set(url, { name: `${repo} GROUP_INFO wiki（解析失败，按文档授权）`, bare: false });
      }
    }
  }
  return { spaces, docs, bases };
}

function spaceAction(spaceId, name) {
  return {
    kind: "space",
    label: `wiki 空间「${name}」(${spaceId}) ← bot 成员 (appid ${BOT_APP_ID})`,
    run: async () => lark(["wiki", "+member-add", "--space-id", spaceId, "--member-type", "appid", "--member-id", BOT_APP_ID, "--member-role", "member"])
  };
}

function docAction(token, name, bare = false) {
  const typeArgs = bare ? ["--type", "docx"] : [];
  return {
    kind: "doc",
    label: `文档「${name}」(${token}) ← bot edit 协作者`,
    run: async () => lark(["drive", "+member-add", "--token", token, ...typeArgs, "--member-type", "openid", "--member-id", BOT_OPEN_ID, "--perm", "edit", "--yes"])
  };
}

async function buildActions(mode) {
  const actions = [];
  const spaces = new Map(WIKI_SPACES.map((s) => [s.spaceId, s.name]));
  const docs = new Map(DOCS.map((d) => [d.token, { name: d.name, bare: false }]));
  if (mode === "repos" || mode === "all-spaces") {
    const repoTargets = await collectRepoTargets();
    for (const [spaceId, name] of repoTargets.spaces) spaces.set(spaceId, name);
    for (const [token, meta] of repoTargets.docs) docs.set(token, meta);
    console.error(`GROUP_INFO 扫描：${repoTargets.spaces.size} 个 wiki 空间、${repoTargets.docs.size} 个独立文档、${repoTargets.bases.length} 个 Base（Base 不授权）`);
  }
  if (mode === "all-spaces") {
    const listed = (await lark(["wiki", "+space-list", "--page-size", "50"])).data?.spaces || [];
    for (const space of listed) {
      if (space.space_id) spaces.set(String(space.space_id), space.name || space.space_id);
    }
  }
  for (const [spaceId, name] of spaces) actions.push(spaceAction(spaceId, name));
  for (const token of governedWikiTokens()) {
    if (![...docs.keys()].includes(`https://ywhome.feishu.cn/wiki/${token}`)) {
      docs.set(`https://ywhome.feishu.cn/wiki/${token}`, { name: `受治理 Prompt wiki ${token}`, bare: false });
    }
  }
  for (const [token, meta] of docs) actions.push(docAction(token, meta.name, meta.bare));
  return actions;
}

const mode = process.argv[2] || "plan";
const actions = await buildActions(mode);
console.log(`共 ${actions.length} 项授权动作（bot: ${BOT_APP_ID} / ${BOT_OPEN_ID}）`);
let ok = 0;
let fail = 0;
for (const action of actions) {
  if (mode === "plan" || mode === "repos" && process.argv[3] === "--plan") {
    console.log(`[plan] ${action.label}`);
    continue;
  }
  try {
    const result = await action.run();
    const granted = result?.ok !== false;
    console.log(`[${granted ? "ok" : "skip"}] ${action.label}${granted ? "" : ` → ${JSON.stringify(result).slice(0, 200)}`}`);
    granted ? ok++ : fail++;
  } catch (error) {
    const message = String(error?.stderr || error?.message || error);
    if (/exist|already|duplicate/i.test(message)) {
      console.log(`[skip] ${action.label}（已存在）`);
      ok++;
    } else {
      console.log(`[fail] ${action.label} → ${message.slice(0, 300)}`);
      fail++;
    }
  }
}
if (mode !== "plan") console.log(`\n完成：${ok} 成功/跳过，${fail} 失败`);
if (fail > 0) process.exitCode = 1;

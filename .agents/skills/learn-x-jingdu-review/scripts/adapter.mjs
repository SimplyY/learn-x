#!/usr/bin/env node
// Learn-X｜微信读书精读审阅适配器 CLI。
// 用法：node adapter.mjs <command> [--week YYYY-Www] [--json] [--dry-run] ...
// 退出码：0 成功 / 2 等待人工或无可精读内容 / 3 受阻 / 4 瞬时基础设施。

import { runCommand } from "./lib/commands.mjs";

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");
const retiredWriteCommands = new Set(["prepare", "notify", "snapshot", "explain", "validate", "apply", "verify-recover", "run"]);
const command = argv.find((item) => retiredWriteCommands.has(item)) || argv.find((item) => !item.startsWith("--"));
const outcome = retiredWriteCommands.has(command)
  ? {
      exitCode: 3,
      result: {
        ok: false,
        status: "retired",
        command,
        reason: "旧微信读书精读流程已退役。请使用 learn-x-reading 整理新的阅读上下文；历史 jingdu.md 仅保留查阅。"
      }
    }
  : await runCommand(argv);
const { exitCode, result } = outcome;

if (wantsJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(renderHuman(result));
}

process.exitCode = exitCode;

function renderHuman(result) {
  if (result?.error) return `受阻 [${result.error.code}]：${result.error.message}`;
  if (result?.status === "blocked" || result?.ok === false) {
    const lines = [`受阻：${result.reason ?? "未知原因"}`];
    for (const item of result.evidence ?? []) lines.push(`- ${item}`);
    for (const blocker of result.blockers ?? []) lines.push(`- [${blocker.kind}] ${blocker.reason}`);
    return lines.join("\n");
  }
  const parts = [];
  if (result?.week) parts.push(`周 ${result.week}`);
  if (result?.state) parts.push(`状态 ${result.state}`);
  if (result?.status) parts.push(`${result.status}`);
  if (result?.docUrl) parts.push(result.docUrl);
  if (result?.appliedCount != null) parts.push(`写入 ${result.appliedCount} 条`);
  if (result?.text) parts.push("", result.text);
  if (result?.reason) parts.push(result.reason);
  if (result?.note) parts.push(result.note);
  return parts.join("\n") || JSON.stringify(result, null, 2);
}

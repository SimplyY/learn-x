#!/usr/bin/env node
// 里程碑 2 验收工具：逐条核对用户已知消息是否可在本机 TraceMemo 定位。
// 用法：
//   TRACEMEMO_API_TOKEN=… node verify-known-messages.mjs [known-messages.json]
//   或把 Token 放进 ~/.tracememo/token、清单放进 ~/.tracememo/known-messages.json
// 清单格式（私有数据，勿放仓库内）：
//   [{ "conversation": "会话名", "date": "YYYY-MM-DD", "sender": "可选", "text": "该消息的区分性子串" }]
// 输出：只打印 定位结果/会话/日期/时间戳/messageRef，不打印聊天正文；完整报告写 verify-report.json。
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE = process.env.TRACEMEMO_API ?? "http://127.0.0.1:6131/api/v1";
const token = process.env.TRACEMEMO_API_TOKEN
  ?? (readFileSync(path.join(homedir(), ".tracememo", "token"), "utf8").trim());
const listPath = process.argv[2] ?? path.join(homedir(), ".tracememo", "known-messages.json");
const entries = JSON.parse(readFileSync(listPath, "utf8"));
if (!Array.isArray(entries) || !entries.length) throw new Error("已知消息清单为空或不是数组");

const auth = { Authorization: `Bearer ${token}` };
async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const results = [];
for (const [i, e] of entries.entries()) {
  const { conversation, date, sender, text } = e;
  const out = { index: i + 1, conversation, date, located: false };
  try {
    let log;
    try {
      log = await api(`/chatlog?talker=${encodeURIComponent(conversation)}&time=${date}`);
    } catch (error) {
      if (!String(error).includes(" 404 ")) throw error;
      const r = await api(`/resolve?q=${encodeURIComponent(conversation)}`);
      const id = r.conversationId ?? r.contact?.conversationId ?? r.contact?.md5;
      if (!id) throw new Error(`resolve 无 conversationId: ${JSON.stringify(r).slice(0, 120)}`);
      log = await api(`/chatlog?talker=${encodeURIComponent(id)}&time=${date}`);
    }
    const messages = log.messages ?? [];
    const hit = messages.find((m) => {
      const blob = JSON.stringify(m);
      if (!blob.includes(text)) return false;
      return !sender || blob.includes(sender);
    });
    if (hit) {
      out.located = true;
      out.timestamp = hit.timestamp ?? null;
      out.messageRef = hit.messageRef ?? hit.id ?? null;
      out.totalMessages = messages.length;
    } else {
      out.totalMessages = messages.length; // 当日该会话可见但未命中：疑似错账号/漏采
    }
  } catch (error) {
    out.error = String(error).slice(0, 200);
  }
  results.push(out);
  console.log(`[${out.index}/${entries.length}] ${out.located ? "✓ 定位" : out.error ? "✗ 错误" : "✗ 未命中"} ${conversation} ${date}${out.totalMessages != null ? ` (当日可见 ${out.totalMessages} 条)` : ""}${out.error ? ` — ${out.error}` : ""}`);
}

const located = results.filter((r) => r.located).length;
const summary = { checkedAt: new Date().toISOString(), total: entries.length, located, failed: entries.length - located, pass: located === entries.length };
const reportPath = path.join(import.meta.dirname, "verify-report.json");
writeFileSync(reportPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);
console.log(`\n${located}/${entries.length} 可定位 — ${summary.pass ? "通过" : "未通过（错账号或漏一条即记录失败）"}；报告: ${reportPath}`);
process.exitCode = summary.pass ? 0 : 1;

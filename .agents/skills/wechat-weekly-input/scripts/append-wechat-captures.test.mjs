import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appendWechatCaptures,
  prepareWechatAppend,
  shanghaiWeekRange
} from "./append-wechat-captures.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("./append-wechat-captures.mjs", import.meta.url));
const week = "2026-W32";
const time = (minute, day = "03") => `2026-08-${day}T10:${String(minute).padStart(2, "0")}:00+08:00`;
const message = (text, minute, extra = {}) => ({ time: time(minute), sender: "联系人", is_from_me: false, kind: "text", text, ...extra });

function privateCapture(name, minute, text = name) {
  return { chat_name: name, chat_type: "private", messages: [message(text, minute)] };
}

function groupCapture(name = "项目群") {
  return {
    chat_name: name,
    chat_type: "group",
    context_complete: true,
    messages: Array.from({ length: 13 }, (_, index) => message(`消息${index}`, index, { is_from_me: index === 6, sender: index === 6 ? "我" : `成员${index}` }))
  };
}

test("captures two screenshots, excludes folded chats, and keeps group context", () => {
  const result = prepareWechatAppend({
    week,
    input: {
      capture_date: "2026-08-03",
      captures: [privateCapture("重要私聊", 1), groupCapture(), { chat_name: "折叠群", chat_type: "folded", messages: [] }]
    }
  });
  assert.equal(result.acceptedCount, 2);
  assert.equal(result.addedCount, 2);
  assert.match(result.output, /2\/2（达标）/);
  assert.match(result.output, /截图不足：无/);
  assert.match(result.output, /缺失日期：2026-08-04/);
  assert.doesNotMatch(result.output, /折叠群/);
  assert.equal((result.output.match(/消息\d+/g) ?? []).length, 11);
  assert.match(result.output, /人工局部采样，非完整历史/);
});

test("groups without my messages are retained as visible manual samples", () => {
  const noAnchor = { ...groupCapture("无锚点群"), messages: [message("别人说", 1)] };
  const incomplete = { ...groupCapture("裁切群"), context_complete: false };
  const result = prepareWechatAppend({ week, input: { capture_date: "2026-08-03", captures: [noAnchor, incomplete] } });
  assert.equal(result.acceptedCount, 2);
  assert.deepEqual(result.skipped, []);
  assert.match(result.output, /无锚点群/);
  assert.match(result.output, /未发现“我”消息/);
  assert.match(result.output, /裁切群/);
  assert.match(result.output, /上下文状态：部分可见/);
  assert.match(result.output, /识别缺口：incomplete_context、no_anchor/);
});

test("retains an edge anchor with a partial-context gap instead of blocking", () => {
  const result = prepareWechatAppend({
    week,
    input: { capture_date: "2026-08-03", captures: [{ ...groupCapture("边缘锚点群"), messages: groupCapture().messages.slice(0, 7) }] }
  });
  assert.equal(result.acceptedCount, 1);
  assert.deepEqual(result.skipped, []);
  assert.match(result.output, /边缘锚点群/);
  assert.match(result.output, /上下文状态：部分可见/);
  assert.match(result.output, /识别缺口：incomplete_context/);
});

test("dedupes repeated screenshots and tracks one-versus-two daily status", () => {
  const first = prepareWechatAppend({ week, input: { capture_date: "2026-08-03", captures: [privateCapture("A", 1)] } });
  assert.match(first.output, /1\/2（不足）/);
  const second = prepareWechatAppend({ week, existingMarkdown: first.output, input: { capture_date: "2026-08-03", captures: [privateCapture("B", 2)] } });
  assert.equal(second.acceptedCount, 2);
  assert.match(second.output, /2\/2（达标）/);
  const duplicate = prepareWechatAppend({ week, existingMarkdown: second.output, input: { capture_date: "2026-08-03", captures: [privateCapture("B", 2)] } });
  assert.equal(duplicate.addedCount, 0);
  assert.equal(duplicate.duplicateCount, 1);
  assert.equal(duplicate.output, second.output);
});

test("upgrades the legacy group rule in an existing manual output", () => {
  const first = prepareWechatAppend({ week, input: { capture_date: "2026-08-03", captures: [privateCapture("旧格式", 1)] } });
  const legacy = first.output.replace(
    "- 规则：排除 folded；群聊保留截图中目标周可见消息，有我发言时再保留前后各 5 条可见上下文；私聊仅保留截图可见消息",
    "- 规则：排除 folded；群聊围绕我发言保留前后各 5 条可见上下文；私聊仅保留截图可见消息"
  );
  const result = prepareWechatAppend({ week, existingMarkdown: legacy, input: { capture_date: "2026-08-03", captures: [privateCapture("旧格式", 1)] } });
  assert.match(result.output, /群聊保留截图中目标周可见消息/);
  assert.doesNotMatch(result.output, /群聊围绕我发言保留前后各 5 条可见上下文/);
});

test("runs the public CLI path and atomically creates the weekly output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-weekly-cli-"));
  const inputPath = path.join(directory, "capture.json");
  const outputPath = path.join(directory, "WeChat.md");
  await writeFile(inputPath, JSON.stringify({ capture_date: "2026-08-03", captures: [privateCapture("CLI-A", 3), privateCapture("CLI-B", 4)] }), "utf8");
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--week", week, "--input", inputPath, "--output", outputPath]);
  const result = JSON.parse(stdout);
  assert.equal(result.written, true);
  assert.equal(result.acceptedCount, 2);
  const output = await readFile(outputPath, "utf8");
  assert.match(output, /## 截图｜CLI-A｜2026-08-03/);
  assert.match(output, /## 截图｜CLI-B｜2026-08-03/);
  assert.match(output, /wechat-week-status week=2026-W32/);
});

test("filters private messages by Shanghai week and preserves cross-week group context", () => {
  const result = prepareWechatAppend({
    week,
    input: {
      capture_date: "2026-08-03",
      captures: [
        { chat_name: "私聊", chat_type: "private", messages: [
          { ...message("周外", 0), time: "2026-08-02T23:59:00+08:00" },
          { ...message("周内", 1) }
        ] },
        { chat_name: "跨周群", chat_type: "group", context_complete: true, messages: [
          { ...message("周外上下文", 0), time: "2026-08-02T23:59:00+08:00" },
          ...Array.from({ length: 4 }, (_, index) => message(`前置${index}`, index + 1)),
          { ...message("我的锚点", 5), is_from_me: true, sender: "我" },
          ...Array.from({ length: 5 }, (_, index) => message(`后置${index}`, index + 6))
        ] }
      ]
    }
  });
  assert.doesNotMatch(result.output, /周外：/);
  assert.match(result.output, /周外上下文/);
  assert.match(result.output, /2026-08-02 23:59/);
  assert.match(result.output, /跨周上下文/);
});

test("uses Asia/Shanghai Monday boundary and rejects invalid capture dates", () => {
  const range = shanghaiWeekRange(week);
  assert.equal(range.start.toISOString(), "2026-08-02T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-08-09T16:00:00.000Z");
  assert.throws(() => prepareWechatAppend({ week, input: { capture_date: "2026-08-10", captures: [privateCapture("越界", 1)] } }), /不属于目标/);
});

test("validation failure leaves the existing file unchanged", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wechat-weekly-"));
  const outputPath = path.join(directory, "WeChat.md");
  const badInputPath = path.join(directory, "bad.json");
  const valid = prepareWechatAppend({ week, input: { capture_date: "2026-08-03", captures: [privateCapture("旧记录", 1)] } });
  await writeFile(outputPath, valid.output, "utf8");
  await writeFile(badInputPath, JSON.stringify({ capture_date: "2026-08-03", captures: [{ chat_name: "坏输入", chat_type: "private", messages: [{ time: time(2), is_from_me: false, kind: "text", text: "缺 sender" }] }] }), "utf8");
  const before = await readFile(outputPath, "utf8");
  await assert.rejects(
    appendWechatCaptures({ week, outputPath, inputPath: badInputPath }),
    /缺少可确认的发送者/
  );
  assert.equal(await readFile(outputPath, "utf8"), before);
});

test("controlled recognition gaps are recorded without raw uncertainty", () => {
  const result = prepareWechatAppend({
    week,
    input: { capture_date: "2026-08-03", captures: [privateCapture("可确认", 1)], issues: [{ code: "uncertain_text" }] }
  });
  assert.match(result.output, /识别缺口：uncertain_text/);
  assert.doesNotMatch(result.output, /原始/);
});

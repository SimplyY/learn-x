// status 三态 / run 编排（等待、继续、blocked、锁忙）/ notify 幂等与 dry-run / CLI 冒烟。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runCommand } from "./lib/commands.mjs";
import { FAKE_LIB_DIR, HIGHLIGHT_1, HIGHLIGHT_3, createTestRepo, makeChangeset, makeContextOptions, makeDeps, mutateDoc, WEEK } from "./helpers/harness.mjs";
import * as fakeFsafe from "./fixtures/fake-lib/fsafe.mjs";
import { readWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";

const execFileAsync = promisify(execFile);
const ENDORSED_CANDIDATE = "AI 分析指出：当波动迫使你卖出时，波动才成为风险；仓位设计的目标是把被迫行动的概率降到最低。";
const CHANGES = makeChangeset([
  { kind: "added", target: { book: "投资中的哲学练习", chapter: "第二章 阿尔法与贝塔", summary: "波动承受力优先" }, newValue: "长期主义先于收益率：我准备把定投改成月度再平衡。" },
  { kind: "endorsed", target: { book: "投资中的哲学练习", chapter: "第三章 风险的形状", summary: "被迫行动最小化" }, originalValue: ENDORSED_CANDIDATE, newValue: ENDORSED_CANDIDATE }
]);

async function preparedRepo(t) {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const depsOf = (extra = {}) => makeDeps({ larkState, ...extra });
  const prepareOutcome = await runCommand(["prepare", "--week", WEEK], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(prepareOutcome.exitCode, 0, JSON.stringify(prepareOutcome.result));
  const baseline = JSON.parse(await readFile(repo.runtime("baseline.json"), "utf8"));
  baseline.aiCandidates["投资中的哲学练习｜第三章 风险的形状"] = [ENDORSED_CANDIDATE];
  baseline.markdown = `${baseline.markdown}\n【AI 分析候选】${ENDORSED_CANDIDATE}\n`;
  baseline.insights = {
    [HIGHLIGHT_1]: { summary: "波动承受力优先", questions: [] },
    [HIGHLIGHT_3]: { summary: "被迫行动最小化", questions: [] }
  };
  await fakeFsafe.writeJsonFile(repo.runtime("baseline.json"), baseline);
  return { repo, larkState, depsOf };
}

test("status reports prepared → edited → applied across the lifecycle", async (t) => {
  const { repo, larkState, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });

  const prepared = await runCommand(["status", "--week", WEEK], options);
  assert.equal(prepared.exitCode, 0);
  assert.equal(prepared.result.state, "prepared");

  // 用户编辑了文档（直接改 fake lark 状态里的 XML）→ edited。
  const binding = (await readFile(repo.runtime("records.jsonl"), "utf8")).split("\n").filter(Boolean).map(JSON.parse).find((record) => record.kind === "binding/v1");
  mutateDoc(larkState, "docFAKE001", "<p>用户在「我的思考」里写的判断</p>");

  const edited = await runCommand(["status", "--week", WEEK], options);
  assert.equal(edited.result.state, "edited");

  // 走完 explain/apply → applied。
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) }));
  await runCommand(["apply", "--week", WEEK], options);
  const applied = await runCommand(["status", "--week", WEEK], options);
  assert.equal(applied.result.state, "applied");
  assert.ok(applied.result.evidence.contentSha256);

  // --doc-url 定位。
  const byDocUrl = await runCommand(["status", "--doc-url", binding.docUrl], options);
  assert.equal(byDocUrl.exitCode, 0);
  assert.equal(byDocUrl.result.week, WEEK);

  // 定位不到 → exit 3。
  const missing = await runCommand(["status", "--doc-url", "https://example.feishu.cn/docx/docNOPE"], options);
  assert.equal(missing.exitCode, 3);
  assert.equal(missing.result.status, "absent");
});

test("status locates a week by notify message id", async (t) => {
  const { repo, larkState, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  await runCommand(["notify", "--week", WEEK], options);
  const sent = larkState.messages.at(-1);
  assert.ok(sent);
  const located = await runCommand(["status", "--message-id", sent.messageId], options);
  assert.equal(located.exitCode, 0);
  assert.equal(located.result.week, WEEK);
});

test("notify renders dry-run text, sends exactly once, and replays idempotently", async (t) => {
  const { repo, larkState, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  const dry = await runCommand(["notify", "--week", WEEK, "--dry-run"], options);
  assert.equal(dry.exitCode, 0);
  assert.equal(dry.result.status, "dry-run");
  assert.match(dry.result.markdown, /\*\*本周微信读书精读已准备\*\*/);
  assert.match(dry.result.markdown, /\[打开本周精读文档\]\(https:\/\/example\.feishu\.cn\/docx\/docFAKE001\)/);
  assert.match(dry.result.markdown, /修改完成后，@机器人 继续。/);
  assert.equal(larkState.messages.length, 0, "dry-run 不发送");

  const first = await runCommand(["notify", "--week", WEEK], options);
  assert.equal(first.exitCode, 0);
  assert.equal(first.result.status, "sent");
  assert.equal(larkState.messages.length, 1);

  const second = await runCommand(["notify", "--week", WEEK], options);
  assert.equal(second.result.status, "already-notified");
  assert.equal(larkState.messages.length, 1, "幂等：不重复发送");
});

test("run waits (exit 2) until the user replies 继续, then explains, applies, and replies with the result", async (t) => {
  const { repo, larkState, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) });

  const waiting = await runCommand(["run", "--week", WEEK], options);
  assert.equal(waiting.exitCode, 2, JSON.stringify(waiting.result));
  assert.equal(waiting.result.status, "waiting");
  assert.equal(larkState.messages.length, 1, "只发过 notify");

  // 用户编辑文档 + 在群里回复「继续」。
  mutateDoc(larkState, "docFAKE001", "<p>AI 分析候选已认可</p>");
  larkState.messages.push({ messageId: "omUSER001", chatId: "oc_faketest0000000000000000000000", text: "继续", senderType: "user", at: new Date().toISOString() });

  const done = await runCommand(["run", "--week", WEEK], options);
  assert.equal(done.exitCode, 0, JSON.stringify(done.result));
  assert.equal(done.result.status, "applied");
  assert.equal(done.result.appliedCount, 2);

  const sidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(sidecar.sources.jingdu.status, "ready");
  const jingduRaw = await readFile(path.join(repo.weekRoot, "jingdu.md"), "utf8");
  assert.match(jingduRaw, /波动承受力优先/);

  // 结果反馈：回复「继续」那条消息。
  const feedback = larkState.messages.at(-1);
  assert.equal(feedback.replyTo, "omUSER001");
  assert.match(feedback.text, /精读已同步/);
  assert.match(feedback.text, /写入 2 条/);

  // 再次 run：同一 proposal 已应用 → already-applied，不再发送反馈。
  const messagesBefore = larkState.messages.length;
  const replay = await runCommand(["run", "--week", WEEK], options);
  assert.equal(replay.exitCode, 0);
  assert.equal(replay.result.status, "already-applied");
  assert.equal(larkState.messages.length, messagesBefore, "幂等重放不重复反馈");
});

test("run reports blocked to the group when prepare cannot proceed (exit 3)", async (t) => {
  const repo = await createTestRepo(t, { wereadFixture: "weread-empty.md" });
  const { writeFile } = await import("node:fs/promises");
  const sidecarPath = path.join(repo.weekRoot, "_source-status.json");
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
  sidecar.sources.weread.status = "unavailable";
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const outcome = await runCommand(["run", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps({ larkState }) }));
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.result.stage, "prepare");
  assert.equal(larkState.messages.length, 1, "blocked 异常反馈已发群");
  assert.match(larkState.messages[0].text, /精读受阻/);
  assert.match(larkState.messages[0].text, /weread 状态为 unavailable/);
});

test("run exits 4 when the business lock is busy", async (t) => {
  const repo = await createTestRepo(t);
  const lockDir = path.join(repo.skillDir, "runtime", "locks");
  await mkdir(lockDir, { recursive: true });
  await writeFile(path.join(lockDir, `jingdu-${WEEK}.lock`), "held", "utf8");
  const outcome = await runCommand(["run", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps() }));
  assert.equal(outcome.exitCode, 4);
  assert.equal(outcome.result.status, "lock-busy");
});

test("run --dry-run stops at notify with the rendered text and sends nothing", async (t) => {
  const { repo, larkState, depsOf } = await preparedRepo(t);
  const outcome = await runCommand(["run", "--week", WEEK, "--dry-run"], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.result.status, "dry-run");
  assert.match(outcome.result.markdown, /本周微信读书精读已准备/);
  assert.equal(larkState.messages.length, 0);
});

test("snapshot writes doc/baseline/weread/ai/jingdu(absent marker)/sidecar with manifest", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  const outcome = await runCommand(["snapshot", "--week", WEEK], options);
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
  const dir = path.join(repo.skillDir, "runtime", WEEK, "snapshot");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.jingdu, "absent", "W42 无 jingdu.md 时如实标注");
  assert.equal(manifest.week, WEEK);
  const docMd = await readFile(path.join(dir, "doc.md"), "utf8");
  assert.match(docMd, /精读｜2026-W42/);
  assert.ok(await readFile(path.join(dir, "baseline.json"), "utf8"));
  assert.ok(await readFile(path.join(dir, "weread.md"), "utf8"));
  assert.ok(await readFile(path.join(dir, "_source-status.json"), "utf8"));
  await assert.rejects(() => readFile(path.join(dir, "jingdu.md"), "utf8"), /ENOENT/);
});

test("CLI smoke: adapter.mjs runs against the fake shared lib via JINGDU_SHARED_LIB_DIR", async (t) => {
  const { mkdtemp } = await import("node:fs/promises");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "learn-x-jingdu-cli-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const stateFile = path.join(tmp, "lark-state.json");
  const parseFile = path.join(tmp, "parse.json");
  await writeFile(parseFile, JSON.stringify({ changes: [] }), "utf8");
  const env = {
    ...process.env,
    JINGDU_SHARED_LIB_DIR: FAKE_LIB_DIR,
    JINGDU_FAKE_LARK_STATE: stateFile,
    JINGDU_FAKE_PARSE: parseFile
  };
  const adapterPath = path.join(FAKE_LIB_DIR, "..", "..", "adapter.mjs");
  const runCli = async (args) => {
    try {
      const result = await execFileAsync(process.execPath, [adapterPath, ...args], { env });
      return { code: 0, stdout: result.stdout };
    } catch (error) {
      return { code: typeof error.code === "number" ? error.code : null, stdout: error.stdout ?? "" };
    }
  };

  const unknown = await runCli(["no-such-command", "--json"]);
  assert.equal(unknown.code, 2, "未知命令 exit 2");
  const parsed = JSON.parse(unknown.stdout);
  assert.ok(parsed.usage);

  const missingLib = await runCli(["status", "--week", WEEK, "--json"]);
  assert.ok(missingLib.stdout.length > 0);
  // 真实仓库只读 status：无 locator 时 exit 0，state 如实报告。
  const statusResult = JSON.parse(missingLib.stdout);
  assert.equal(missingLib.code, 0);
  assert.ok(["absent", "prepared", "edited", "applied"].includes(statusResult.state));
});

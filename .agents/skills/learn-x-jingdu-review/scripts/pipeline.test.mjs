// explain → validate（三类阻断）→ apply 两阶段提交 + verify-recover 两分支。
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { runCommand } from "./lib/commands.mjs";
import { HIGHLIGHT_1, HIGHLIGHT_3, createTestRepo, makeChangeset, makeContextOptions, makeDeps, WEEK } from "./helpers/harness.mjs";
import * as fakeFsafe from "./fixtures/fake-lib/fsafe.mjs";
import { readWeeklySourceStatus, updateWeeklySourceStatus } from "../../learn-x-input/scripts/lib/source-status.mjs";

const ENDORSED_CANDIDATE = "AI 分析指出：当波动迫使你卖出时，波动才成为风险；仓位设计的目标是把被迫行动的概率降到最低。";

const CHANGES = makeChangeset([
  {
    kind: "added",
    target: { book: "投资中的哲学练习", chapter: "第二章 阿尔法与贝塔", summary: "波动承受力优先" },
    targetHint: "jingdu#投资中的哲学练习/第二章 阿尔法与贝塔/波动承受力优先#思考",
    newValue: "长期主义先于收益率：我准备把定投改成月度再平衡。\n行动：检查我的定投中断记录"
  },
  {
    kind: "endorsed",
    target: { book: "投资中的哲学练习", chapter: "第三章 风险的形状", summary: "被迫行动最小化" },
    targetHint: "jingdu#投资中的哲学练习/第三章 风险的形状/被迫行动最小化#思考",
    originalValue: ENDORSED_CANDIDATE,
    newValue: ENDORSED_CANDIDATE
  }
]);

async function preparedRepo(t) {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const depsOf = (extra = {}) => makeDeps({ larkState, ...extra });
  const prepareOutcome = await runCommand(["prepare", "--week", WEEK], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(prepareOutcome.exitCode, 0, JSON.stringify(prepareOutcome.result));
  // 为 endorsed 行注入确定性 AI 候选（与 prepare 的打分挑选解耦，保证断言稳定），
  // 并为两个目标行注入 insights 概括（等价于 prepare 前写入 runtime/<week>/insights.json）。
  const baselineFile = repo.runtime("baseline.json");
  const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
  baseline.aiCandidates["投资中的哲学练习｜第三章 风险的形状"] = [ENDORSED_CANDIDATE];
  baseline.markdown = `${baseline.markdown}\n【AI 分析候选】${ENDORSED_CANDIDATE}\n`;
  baseline.insights = {
    [HIGHLIGHT_1]: { summary: "波动承受力优先", questions: ["我的现金流能撑几个月？", "我上一次被迫卖出是什么时候？"] },
    [HIGHLIGHT_3]: { summary: "被迫行动最小化", questions: [] }
  };
  await fakeFsafe.writeJsonFile(baselineFile, baseline);
  return { repo, larkState, depsOf };
}

test("explain validates the changeset and writes proposal.json", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const outcome = await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) }));
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
  assert.equal(outcome.result.items, 2);
  const proposal = JSON.parse(await readFile(repo.runtime("proposal.json"), "utf8"));
  assert.equal(proposal.business, "jingdu");
  assert.equal(proposal.items[0].kind, "added");
  const prompt = await readFile(repo.runtime("parse-prompt.md"), "utf8");
  assert.match(prompt, /「jingdu 2026-W42」手机审阅周变更解析器/);
  assert.match(prompt, /「我的思考」列出现新写内容/);
  assert.match(prompt, /snapshot\/doc\.md/);
});

test("validate blocks on ambiguous changes (exit 3)", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const ambiguous = makeChangeset([], { ambiguous: [{ where: "投资中的哲学练习", problem: "两本书都有「第一章」，无法定位", options: ["确认书名后重试"] }] });
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: ambiguous }) }));
  const outcome = await runCommand(["validate", "--week", WEEK], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.result.status, "invalid");
  assert.match(outcome.result.blockers[0].reason, /歧义/);
});

test("validate blocks when originalValue does not match the baseline verbatim (exit 3)", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const bad = makeChangeset([{ kind: "endorsed", target: { book: "投资中的哲学练习", chapter: "第三章 风险的形状", summary: "被迫行动最小化" }, originalValue: "这段话不在基线文档里。", newValue: "这段话不在基线文档里。" }]);
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: bad }) }));
  const outcome = await runCommand(["validate", "--week", WEEK], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.result.blockers[0].reason, /原值匹配失败/);
});

test("validate blocks on duplicate targets (exit 3)", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const duplicated = makeChangeset([
    { kind: "added", target: { book: "投资中的哲学练习", chapter: "第三章 风险的形状", summary: "被迫行动最小化" }, newValue: "第一遍思考" },
    { kind: "added", target: { book: "投资中的哲学练习", chapter: "第三章 风险的形状", summary: "被迫行动最小化" }, newValue: "第二遍思考" }
  ]);
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: duplicated }) }));
  const outcome = await runCommand(["validate", "--week", WEEK], makeContextOptions({ repo, deps: depsOf() }));
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.result.blockers[0].reason, /查重/);
});

test("apply writes jingdu.md via two-phase commit and registers ready with contentSha256", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) }));
  const validateOutcome = await runCommand(["validate", "--week", WEEK], options);
  assert.equal(validateOutcome.exitCode, 0, JSON.stringify(validateOutcome.result));
  assert.equal(validateOutcome.result.actionable.length, 2);

  const applyOutcome = await runCommand(["apply", "--week", WEEK], options);
  assert.equal(applyOutcome.exitCode, 0, JSON.stringify(applyOutcome.result));
  assert.equal(applyOutcome.result.appliedCount, 2);

  const jingduRaw = await readFile(path.join(repo.weekRoot, "jingdu.md"), "utf8");
  assert.match(jingduRaw, /# 精读｜2026-W42/);
  assert.match(jingduRaw, /### 波动承受力优先｜第二章 阿尔法与贝塔/);
  assert.match(jingduRaw, /长期主义先于收益率：我准备把定投改成月度再平衡。/);
  assert.match(jingduRaw, /- 可选行动：\n  检查我的定投中断记录/);
  assert.match(jingduRaw, /（认可 AI 分析候选）/);
  assert.match(jingduRaw, /原始划线：\n  > 风险不是波动本身/);

  const sidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  const jingdu = sidecar.sources.jingdu;
  assert.equal(jingdu.status, "ready");
  assert.equal(jingdu.count, 2);
  assert.equal(jingdu.contentSha256, createHash("sha256").update(jingduRaw, "utf8").digest("hex"));
  assert.deepEqual(jingdu.commitJournal.map((item) => item.action), ["pending", "commit"]);

  const records = (await readFile(repo.runtime("records.jsonl"), "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  const receipt = records.find((record) => record.kind === "receipt/v1" && record.command === "apply" && record.status === "applied");
  assert.ok(receipt, "apply 成功 receipt 存在");
  assert.ok(receipt.dedupKey, "receipt 携带幂等键");
  assert.ok(receipt.evidence.some((item) => item.check === "sha256"));
  assert.ok(receipt.evidence.filter((item) => item.check === "grep").every((item) => item.found));

  // 幂等：同一 proposal 重复 apply → already-applied，不重写、不重复登记。
  const again = await runCommand(["apply", "--week", WEEK], options);
  assert.equal(again.exitCode, 0);
  assert.equal(again.result.status, "already-applied");
  const sidecarAfter = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.deepEqual(sidecarAfter.sources.jingdu.commitJournal.map((item) => item.action), ["pending", "commit"]);
});

test("apply interrupt after file write keeps pendingCommit and verify-recover completes registration", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) }));

  let updateCalls = 0;
  const sourceStatus = {
    read: readWeeklySourceStatus,
    update: async (...args) => {
      updateCalls += 1;
      if (updateCalls === 2) throw new Error("injected crash after atomic write");
      return updateWeeklySourceStatus(...args);
    }
  };
  const broken = await runCommand(["apply", "--week", WEEK], { ...options, sourceStatus });
  assert.equal(broken.exitCode, 3, JSON.stringify(broken.result));
  assert.match(broken.result.error.message, /两阶段提交失败/);

  // 现场：正文已写、状态未提交（pending 保留，无 ready）。
  const midSidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(midSidecar.sources.jingdu.status, "needs_review");
  assert.equal(midSidecar.sources.jingdu.commitJournal.at(-1).action, "pending");
  const midRaw = await readFile(path.join(repo.weekRoot, "jingdu.md"), "utf8");
  assert.match(midRaw, /波动承受力优先/);

  const recovered = await runCommand(["verify-recover", "--week", WEEK], options);
  assert.equal(recovered.exitCode, 0, JSON.stringify(recovered.result));
  assert.equal(recovered.result.status, "recovered");
  assert.equal(recovered.result.fullMatch, true);
  const finalSidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(finalSidecar.sources.jingdu.status, "ready");
  assert.equal(finalSidecar.sources.jingdu.commitJournal.at(-1).action, "commit");
  assert.match(finalSidecar.sources.jingdu.summary, /verify-recover/);
});

test("apply crash before atomic write keeps pending scene, verify-recover blocks until re-apply", async (t) => {
  const { repo, depsOf } = await preparedRepo(t);
  const options = makeContextOptions({ repo, deps: depsOf() });
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: depsOf({ parseJson: CHANGES }) }));

  const crashingFsafe = {
    ...fakeFsafe,
    atomicWriteFile: async (file, content) => {
      if (String(content).includes("波动承受力优先")) throw new Error("injected crash before atomic write");
      return fakeFsafe.atomicWriteFile(file, content);
    }
  };
  const broken = await runCommand(["apply", "--week", WEEK], makeContextOptions({ repo, deps: { ...depsOf(), fsafe: crashingFsafe } }));
  assert.equal(broken.exitCode, 3, JSON.stringify(broken.result));
  assert.match(broken.result.error.message, /两阶段提交失败/);
  await assert.rejects(() => access(path.join(repo.weekRoot, "jingdu.md")), /ENOENT/, "崩溃发生在写文件前，正文不存在");

  const sidecar = await readWeeklySourceStatus(repo.weekRoot, WEEK);
  assert.equal(sidecar.sources.jingdu.status, "needs_review", "pending 现场保留");
  assert.equal(sidecar.sources.jingdu.commitJournal.at(-1).action, "pending");

  const recovered = await runCommand(["verify-recover", "--week", WEEK], options);
  assert.equal(recovered.exitCode, 3);
  assert.equal(recovered.result.status, "still-broken");
});

test("verify-recover with nothing pending is a no-op", async (t) => {
  const repo = await createTestRepo(t);
  const outcome = await runCommand(["verify-recover", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps() }));
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.status, "nothing-to-recover");
});

test("insights.json written before prepare enriches summaries, questions, and target resolution", async (t) => {
  const repo = await createTestRepo(t);
  const larkState = { docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] };
  const options = makeContextOptions({ repo, deps: makeDeps({ larkState }) });
  await fakeFsafe.writeJsonFile(repo.runtime("insights.json"), {
    insights: [{ text: HIGHLIGHT_1, summary: "波动承受力优先", questions: ["我的现金流能撑几个月？", "我上一次被迫卖出是什么时候？"] }]
  });
  const prepareOutcome = await runCommand(["prepare", "--week", WEEK], options);
  assert.equal(prepareOutcome.exitCode, 0, JSON.stringify(prepareOutcome.result));
  const docXml = larkState.docs.docFAKE001.xml;
  assert.match(docXml, /1\. 波动承受力优先/);
  assert.match(docXml, /①我的现金流能撑几个月？②我上一次被迫卖出是什么时候？/);
  assert.match(docXml, /2\. 划线/, "无 insight 的行回退为「N. 划线」");

  const proposal = makeChangeset([{ kind: "added", target: { book: "投资中的哲学练习", chapter: "第二章 阿尔法与贝塔", summary: "波动承受力优先" }, newValue: "我的理解：先保证活下来。" }]);
  await runCommand(["explain", "--week", WEEK], makeContextOptions({ repo, deps: makeDeps({ larkState, parseJson: proposal }) }));
  const validateOutcome = await runCommand(["validate", "--week", WEEK], options);
  assert.equal(validateOutcome.exitCode, 0, JSON.stringify(validateOutcome.result));
  const applyOutcome = await runCommand(["apply", "--week", WEEK], options);
  assert.equal(applyOutcome.exitCode, 0, JSON.stringify(applyOutcome.result));
  const jingduRaw = await readFile(path.join(repo.weekRoot, "jingdu.md"), "utf8");
  assert.match(jingduRaw, /### 波动承受力优先｜第二章 阿尔法与贝塔/);
});

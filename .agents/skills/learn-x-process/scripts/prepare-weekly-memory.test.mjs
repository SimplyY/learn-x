import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bindWeeklyMemoryApproval, extractRequiredSections, quarterFromIsoWeek, verifyWeeklyMemoryApproval } from "./prepare-weekly-memory.mjs";

test("assigns an ISO week to the quarter of its real Monday date", () => {
  assert.equal(quarterFromIsoWeek("2026-W01"), "2025-Q4");
  assert.equal(quarterFromIsoWeek("2026-W02"), "2026-Q1");
});

test("binds one approval fingerprint to the source, exact proposed content, and fixed destinations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-memory-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proposalRoot = path.join(root, "04_output/_dist/weekly/2026-W40");
  await mkdir(proposalRoot, { recursive: true });
  await mkdir(path.join(root, "04_output/weekly"), { recursive: true });
  await writeFile(path.join(root, "04_output/weekly/2026-40.md"), "# Confirmed Weekly Output\n\nA source-backed conclusion.\n");
  await writeFile(path.join(proposalRoot, "memory-candidates.md"), "# Verified candidates\n\nCandidate A.\n");
  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nExact approved memory payload.\n");
  await mkdir(path.join(root, "01_core/memory"), { recursive: true });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "# Existing quarterly memory\n");

  const binding = await bindWeeklyMemoryApproval({ week: "2026-W40", repoRoot: root });
  assert.match(binding.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(binding.scope.memoryPath, "01_core/memory/2026-Q3.memory.md");
  assert.equal(binding.scope.imagePath, "04_output/_dist/weekly/2026-W40/weekly-core.png");
  assert.deepEqual(binding.scope.backupRoots, ["01_core", "03_input", "04_output", "05_library"]);
  assert.deepEqual(binding.scope.flomo, ["03_input/weekly/2026-W40/weekly.md", "01_core/memory/2026-Q3.memory.md"]);
  assert.equal((await verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: binding.fingerprint, repoRoot: root })).verified, true);

  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nChanged after approval.\n");
  await assert.rejects(
    verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: binding.fingerprint, repoRoot: root }),
    /memory-approval-stale/
  );

  await writeFile(path.join(proposalRoot, "memory-proposed.md"), "## 2026-W40\n\nExact approved memory payload.\n");
  const rebound = await bindWeeklyMemoryApproval({ week: "2026-W40", repoRoot: root });
  await writeFile(path.join(root, "01_core/memory/2026-Q3.memory.md"), "# Concurrently changed memory\n");
  await assert.rejects(
    verifyWeeklyMemoryApproval({ week: "2026-W40", fingerprint: rebound.fingerprint, repoRoot: root }),
    /memory-approval-stale/
  );
});

test("extracts numbered core-summary and Munger sections with multiline content", () => {
  const result = extractRequiredSections(`# Weekly

## 10. 全文核心重点纪要

1. 判断一
2. 判断二

## 11. 芒格之魂的洞察

1. 洞察一：

   - 限定条件

## 12. 本周最值得思考的 3 个问题

1. 问题一：应该选择什么？
   回答：先验证最小行动。

## 13. 其他

不应进入。`);

  assert.equal(result.coreSummary.length, 1);
  assert.match(result.coreSummary[0].text, /判断一[\s\S]*判断二/);
  assert.equal(result.mungerInsights.length, 1);
  assert.match(result.mungerInsights[0].text, /洞察一[\s\S]*限定条件/);
  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /问题一[\s\S]*回答：先验证最小行动/);
  assert.doesNotMatch(result.mungerInsights[0].text, /不应进入/);
});

test("supports legacy nested headings and rejects placeholders", () => {
  const result = extractRequiredSections(`# Weekly

## 9. 芒格之魂的洞察 & 全文核心重点纪要

### 芒格之魂的洞察

todo

### 全文核心重点纪要

- 保留这条。

## 附录

结束。`);

  assert.deepEqual(result.mungerInsights, []);
  assert.equal(result.coreSummary.length, 1);
  assert.equal(result.coreSummary[0].text, "- 保留这条。");
});

test("rejects numbered xx placeholders", () => {
  const result = extractRequiredSections(`# Weekly

## 10. 全文核心重点纪要

1. xx
2. xx
3. xx

## 11. 芒格之魂的洞察

1. xx
2. xx
3. xx

## 12. 本周最值得思考的问题与回答

1. xx
2. xx
3. xx`);

  assert.deepEqual(result.coreSummary, []);
  assert.deepEqual(result.mungerInsights, []);
  assert.deepEqual(result.questionsAnswers, []);
});

test("supports a renamed question-and-answer heading", () => {
  const result = extractRequiredSections(`# Weekly

## 核心问题与回答

问题：什么值得继续？

回答：保留可验证的行动。`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /问题：[\s\S]*回答：/);
});

test("accepts purpose notes on confirmed memory headings", () => {
  const result = extractRequiredSections(`# Weekly

## 全文核心重点纪要（纳入本周 Memory）

本周核心判断。

## 芒格之魂的洞察（纳入洞察候选池）

反转假设。
`);

  assert.equal(result.coreSummary.length, 1);
  assert.equal(result.mungerInsights.length, 1);
});

test("does not migrate unanswered questions", () => {
  const result = extractRequiredSections(`# Weekly

## 12. 本周最值得思考的 3 个问题

1. 问题一：什么值得继续？
2. 问题二：什么需要放弃？
3. 问题三：什么需要验证？`);

  assert.deepEqual(result.questionsAnswers, []);
});

test("filters mixed question-and-answer sections to answered entries only", () => {
  const result = extractRequiredSections(`# Weekly

## 13. 本周最值得思考的 3 个问题与回答

1. 问题：什么值得继续？
   背景补充：（可选）本周有相关证据。
   回答：保留可验证的行动。

2. 问题：什么需要放弃？
   背景补充：（可选）暂时没有。
   回答：todo

3. 问题：什么需要验证？
   背景补充：（可选）已有初步判断。
   回答：先做一个小实验。`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /什么值得继续[\s\S]*保留可验证的行动/);
  assert.match(result.questionsAnswers[0].text, /什么需要验证[\s\S]*先做一个小实验/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /什么需要放弃/);
});

test("does not treat background questions or blank-answer followups as answers", () => {
  const result = extractRequiredSections(`# Weekly

## 本周最值得思考的问题与回答

1. 问题：这件事现在要推进吗？
   背景补充：为什么？因为目前缺少关键证据。
   回答：
   下周跟踪：继续等反馈。

2. 问题：何时可以开始？
   背景补充：为什么要现在开始？已有小范围验证。
   回答：先完成一个低成本试验。
`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /何时可以开始[\s\S]*先完成一个低成本试验/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /这件事现在要推进|下周跟踪/);
});

test("accepts list-prefixed labels and multiline answers without promoting tracking fields", () => {
  const result = extractRequiredSections(`# Weekly

## 本周最值得思考的问题与回答

1. 什么值得继续？
   - 回答：保留可验证的行动。
     再用小实验确认边界。

2. 什么应该先做？
   回答：
   - 先完成成本最低的验证。
   - 再根据结果决定是否扩展。

3. 什么留待下周？
   回答：
   下周跟踪：等反馈后再判断。

4. 什么先不做？
   回答：主动跳过
   当前只是提出这个问题，后续再看。

5. 什么还没想好？
   回答：todo
   以后再补充完整想法。
`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /什么值得继续[\s\S]*保留可验证的行动[\s\S]*确认边界/);
  assert.match(result.questionsAnswers[0].text, /什么应该先做[\s\S]*最低的验证[\s\S]*是否扩展/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /什么留待下周|下周跟踪|什么先不做|什么还没想好/);
});

test("rejects placeholder answers", () => {
  const result = extractRequiredSections(`# Weekly

## 本周最值得思考的问题与回答

1. 问题：什么值得继续？
   回答：todo

2. 问题：什么需要改变？
   回答：…

3. 问题：xx？
   回答：这条不能迁移。`);

  assert.deepEqual(result.questionsAnswers, []);
});

test("excludes explicit skipped and unanswered questions with their backgrounds", () => {
  const result = extractRequiredSections(`# Weekly

## 本周最值得思考的问题与回答

1. 问题：什么先不处理？
   背景补充：目前没有足够信息。
   回答：跳过

2. 问题：什么尚未形成判断？
   背景补充：仍在等待反馈。
   回答：未回答

3. 问题：什么暂时不展开？
   背景补充：这周还没有复盘。
   回答：暂不回答

4. 什么现在不需要处理？ 本周主动跳过
   背景补充：证据不足。`);

  assert.deepEqual(result.questionsAnswers, []);
});

test("rejects skipped-answer statuses with explanatory suffixes but keeps substantive answers", () => {
  const result = extractRequiredSections(`# Weekly

## 本周最值得思考的问题与回答

1. 问题：什么因证据不足暂不展开？
   背景补充：相关信息还没有收齐。
   回答：跳过，因为证据不足

2. 问题：什么因信息不足先不处理？
   背景补充：本周没有足够线索。
   回答：本周主动跳过（信息不足）

3. 问题：什么问题现在略过？
   背景补充：等下周再看。
   回答：这题主动跳过

4. 问题：哪项还没有结论？
   背景补充：还在等待反馈。
   回答：未回答，本周跳过

5. 问题：什么现在不回答？
   背景补充：证据不足。
   回答：暂不回答，等下周再说

6. 问题：怎样避免过早下结论？
   回答：证据不足时先不回答，避免把猜测写成事实。

7. 为什么“暂不回答”有时更可靠？
   回答：不要跳过复盘；把证据缺口记下来，等下周补齐。

8. 这周什么决定先搁置？
   回答：我明确跳过此题，因为材料不足。

9. 哪个问题暂不展开？
   回答：我选择跳过这题，本周不处理。

10. 哪个问题等待更多证据？
    回答：这个问题本周先不回答。

11. 什么要等来源确认？
    回答：我暂不回答此题，等来源确认。

12. 哪项留到之后再补？
    回答：此题我先略过，后续再补。

13. 什么还需要核实？
    回答：我这周先不回答，因为还没核实。

14. 哪题要等下月？
    回答：对这个问题暂不作答，等下月再说。

15. 怎样保护复盘质量？
    回答：不要跳过复盘，保留真实反馈。

16. 这题要不要跳过？
    回答：我认为不应该跳过；先核实证据再判断。

17. 有没有跳过这题？
    回答：我这周没有跳过此题，已经按证据处理。

18. 哪题仍然没有结论？
    回答：这个问题没回答。

19. 什么要等材料齐了再说？
    回答：我还没回答这题，等材料齐了再说。

20. 哪个问题暂时没有结论？
    回答：这个问题尚无答案，等下周再看。

21. 什么因证据不足不作答？
    回答：我不会回答这个问题，因为证据不足。

22. 哪个问题先搁置？
    回答：我不想回答这个问题，先放一放。

23. 哪题还没想好？
    回答：这题还没想好，先不作答。

24. 哪个问题没有答案？
    回答：这个问题还没有答案。

25. 哪个问题材料不全？
    回答：我选了跳过此题，因为材料不全。

26. 哪个问题下周再说？
    回答：我不回答这个问题，等下周再说。

27. 哪个问题暂时搁置？
    回答：这个问题暂时搁置，等证据齐全。

28. 是否应该跳过这个问题？
    回答：不要把这个问题跳过，应该审计。

29. 该问题是否要跳过？
    回答：我不打算跳过这个问题，准备补证据。

30. 本题是否可以略过？
    回答：本题不要跳过，继续核验。

31. 这题是否要略过？
    回答：不建议略过此题，先看材料。

32. 有没有跳过这题？
    回答：我这周没有跳过此题，已经按证据处理。

33. 这次要不要跳过？
    回答：这次不跳过，我会先复核来源。

34. 这题要不要跳过？
    回答：我选择不跳过此题，继续处理。

35. 是否应该跳过此题？
    回答：我选择不要跳过此题，继续处理。

36. 本题是否应该跳过？
    回答：我不想跳过问题，先听完事实。

37. 哪个问题暂缓？
    回答：这个问题暂缓，下一周补证据。

38. 哪个问题等确认后再决定？
    回答：先搁置这个问题，待确认后再决定。

39. 哪个问题暂时没有答案？
    回答：暂时没有答案，先核对证据后再决定。

40. 哪个问题答案尚未形成？
    回答：答案尚未形成，暂缓决定。

41. 这题是否有结论？
    回答：我选择暂缓回答这个问题。

42. 有没有回答这题？
    回答：不是不想跳过，而是还没有作答。

43. 本周怎么推进核验？
    回答：我没有选择暂不回答，而是先核对记录。
`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /怎样避免过早下结论/);
  assert.match(result.questionsAnswers[0].text, /为什么“暂不回答”有时更可靠/);
  assert.match(result.questionsAnswers[0].text, /怎样保护复盘质量/);
  assert.match(result.questionsAnswers[0].text, /这题要不要跳过/);
  assert.match(result.questionsAnswers[0].text, /有没有跳过这题/);
  assert.match(result.questionsAnswers[0].text, /是否应该跳过这个问题/);
  assert.match(result.questionsAnswers[0].text, /该问题是否要跳过/);
  assert.match(result.questionsAnswers[0].text, /本题是否可以略过/);
  assert.match(result.questionsAnswers[0].text, /这题是否要略过/);
  assert.match(result.questionsAnswers[0].text, /这次要不要跳过/);
  assert.match(result.questionsAnswers[0].text, /这题要不要跳过/);
  assert.match(result.questionsAnswers[0].text, /是否应该跳过此题/);
  assert.match(result.questionsAnswers[0].text, /本题是否应该跳过/);
  assert.match(result.questionsAnswers[0].text, /本周怎么推进核验/);
  assert.match(result.questionsAnswers[0].text, /我没有选择暂不回答，而是先核对记录/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /什么因证据不足暂不展开|什么因信息不足先不处理|什么问题现在略过|哪项还没有结论|什么现在不回答|这周什么决定先搁置|哪个问题暂不展开|哪个问题等待更多证据|什么要等来源确认|哪项留到之后再补|什么还需要核实|哪题要等下月|哪题仍然没有结论|什么要等材料齐了再说|哪个问题暂时没有结论|什么因证据不足不作答|哪个问题先搁置|哪题还没想好|哪个问题没有答案|哪个问题材料不全|哪个问题下周再说|哪个问题暂时搁置/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /什么因证据不足暂不展开|什么因信息不足先不处理|什么问题现在略过|哪项还没有结论|什么现在不回答|这周什么决定先搁置|哪个问题暂不展开|哪个问题等待更多证据|什么要等来源确认|哪项留到之后再补|什么还需要核实|哪题要等下月|哪题仍然没有结论|什么要等材料齐了再说|哪个问题暂时没有结论|什么因证据不足不作答|哪个问题先搁置|哪题还没想好|哪个问题没有答案|哪个问题材料不全|哪个问题下周再说|哪个问题暂时搁置|哪个问题暂缓|哪个问题等确认后再决定/);
  assert.doesNotMatch(result.questionsAnswers[0].text, /哪个问题暂时没有答案|哪个问题答案尚未形成|这题是否有结论|有没有回答这题/);
});

test("keeps inline answers after question punctuation", () => {
  const result = extractRequiredSections(`# Weekly

## 12. 本周最值得思考的 3 个问题

1. 哪个选择值得长期积累？减少选择权，换取健康。
2. 哪个条件可以放松？放松金钱，保留真实反馈。
3. 什么结果能证明进入积累期？出现 AI 反馈循环。`);

  assert.equal(result.questionsAnswers.length, 1);
  assert.match(result.questionsAnswers[0].text, /减少选择权[\s\S]*AI 反馈循环/);
});

test("does not infer memory from ordinary prose or checks outside candidate sections", async () => {
  const { extractMemoryCandidates } = await import("./prepare-weekly-memory.mjs");
  const result = extractMemoryCandidates(`# Weekly

## 1. 正文

重要：普通正文。
- [x] 正文 checkbox。

## 8. 人工确认清单

### Memory 候选

- [x] 候选 checkbox。
- [ ] 未确认 checkbox。

### 道 / 法 / 术候选观察

- [x] 只进季度候选池。
`);

  assert.deepEqual(result.checked.map((item) => item.text), ["候选 checkbox。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["只进季度候选池。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["未确认 checkbox。"]);
  assert.deepEqual(result.explicit, []);
});

test("uses checked items in the new long-term section and allows zero candidates", async () => {
  const { extractMemoryCandidates } = await import("./prepare-weekly-memory.mjs");
  const result = extractMemoryCandidates(`# Weekly

## 5. 值得长期保留

- [x] 已确认的长期候选。
- [ ] 未确认的长期候选。

## 6. 其他

- [x] 普通正文中的勾选项。

## 7. 道 / 法 / 术候选观察

- [x] 历史观察，保持可读。`);

  assert.deepEqual(result.checked.map((item) => item.text), ["已确认的长期候选。"]);
  assert.deepEqual(result.unchecked.map((item) => item.text), ["未确认的长期候选。"]);
  assert.deepEqual(result.observations.map((item) => item.text), ["历史观察，保持可读。"]);

  const empty = extractMemoryCandidates(`# Weekly

## 5. 值得长期保留

- [ ] 未确认。
`);
  assert.deepEqual(empty.checked, []);
});

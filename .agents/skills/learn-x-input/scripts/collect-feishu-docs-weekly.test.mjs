import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectFeishuDocsWeekly, createLarkTransport, writeFeishuDocsWeekly } from "./collect-feishu-docs-weekly.mjs";
import { isoWeekRangeShanghai } from "./collect-weread-weekly.mjs";
import { collectWeeklyInput } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const WEEK = "2026-W29";
const HUMAN = "human-editor";
const weekStart = isoWeekRangeShanghai(WEEK).startEpoch;
const at = (offsetSeconds) => weekStart + offsetSeconds;
const result = (token, type = "docx", title = `文档 ${token}`, editorOpenId = HUMAN) => ({
  doc_type: type,
  title,
  doc_token: type === "docx" ? token : undefined,
  url: `https://example.feishu.cn/${type}/${token}`,
  result_meta: { edit_user_id: editorOpenId }
});
const history = (revision, editorIds, editTime, historyVersionId = `h${revision}`) => ({
  revision_id: revision,
  history_version_id: historyVersionId,
  edit_time: String(editTime),
  editor_ids: editorIds
});
const page = (results = [], hasMore = false, pageToken = "") => ({ results, hasMore, pageToken });
const historyPage = (entries = [], hasMore = false, pageToken = "") => ({ entries, hasMore, pageToken });

function makeTransport({ search = {}, histories = {}, snapshots = {}, wiki = {}, fetchError, openId = HUMAN, botOpenId = "" } = {}) {
  const calls = { searches: [], histories: [], fetches: [] };
  return {
    calls,
    async currentUserIdentity() { return { openId, botOpenId }; },
    async searchPage(args) {
      calls.searches.push(args);
      return search[args.kind]?.[args.pageToken || ""] || page();
    },
    async resolveWiki(url) { return wiki[url]; },
    async listHistoryPage(args) {
      calls.histories.push(args);
      return histories[args.docToken]?.[args.pageToken || ""] || historyPage();
    },
    async fetchRevision(args) {
      calls.fetches.push(args);
      if (fetchError) throw fetchError;
      return snapshots[args.revisionId];
    }
  };
}

test("paginates candidates and history, deduplicates Wiki and Docx, and keeps only exact-week human versions", async () => {
  const wikiUrl = "https://example.feishu.cn/wiki/wiki-node";
  const sameDoc = result("doc-a", "docx", `文档 doc-a`, "bot");
  const transport = makeTransport({
    search: {
      created: { "": page([sameDoc], true, "created-next"), "created-next": page([{ ...result("doc-a", "wiki", ""), url: wikiUrl }]) },
      edited: { "": page([sameDoc]) }
    },
    wiki: { ["https://example.feishu.cn/wiki/wiki-node"]: { node: { obj_type: "docx", obj_token: "doc-a", title: "Wiki 标题" } } },
    histories: {
      "doc-a": {
        "": historyPage([history(10, [HUMAN], at(-60))], true, "history-next"),
        "history-next": historyPage([
          history(11, [HUMAN], at(0)),
          history(11, [HUMAN], at(0), "h11"),
          history(12, [HUMAN], at(86_400)),
          history(13, ["bot"], at(7 * 86_400))
        ])
      }
    },
    snapshots: {
      10: { revision_id: 10, content: "bot base\n" },
      11: { revision_id: 11, content: "user one\n" },
      12: { revision_id: 12, content: "user two\n" },
      13: { revision_id: 13, content: "bot outside week\n" }
    }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });

  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].versions.length, 2);
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 12);
  assert.equal("markdown" in payload.documents[0].latestHumanVersion, false);
  assert.deepEqual(payload.documents[0].versions.map((version) => version.previousRevisionId), [10, 11]);
  assert.equal(transport.calls.histories.length, 2);
  assert.equal(transport.calls.searches.filter((call) => call.kind === "created").length, 2);
  assert.deepEqual(transport.calls.fetches.map((call) => call.revisionId), [11, 10, 12]);
  assert.equal(transport.calls.fetches.some((call) => call.revisionId === 13), false);
});

test("accepts Search v2 nested Wiki result metadata", async () => {
  const wikiUrl = "https://example.feishu.cn/wiki/wiki-v2";
  const transport = makeTransport({
    search: { edited: { "": page([{
      entity_type: "WIKI",
      title_highlighted: "<h>嵌套标题</h>",
      result_meta: { doc_types: "DOCX", token: "wiki-node-token", url: wikiUrl, edit_user_id: HUMAN }
    }]) } },
    wiki: { [wikiUrl]: { node: { obj_type: "docx", obj_token: "doc-v2", title: "底层标题" } } },
    histories: { "doc-v2": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });

  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].title, "嵌套标题");
  assert.equal("markdown" in payload.documents[0].latestHumanVersion, false);
});

test("accepts the Search v2 DOC entity enum for a Docx URL", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([{
      entity_type: "DOC",
      title_highlighted: "普通文档",
      result_meta: { doc_types: "DOCX", token: "doc-v2", url: "https://example.feishu.cn/docx/doc-v2", edit_user_id: HUMAN }
    }]) } },
    histories: { "doc-v2": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });

  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].title, "普通文档");
});

test("accepts ISO 8601 edit_time values from docs history", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-iso-time")]) } },
    histories: { "doc-iso-time": { "": historyPage([
      history(1, ["bot"], at(-1)),
      { revision_id: 2, history_version_id: "h2", edit_time: "2026-07-16T00:00:01Z", editor_ids: [HUMAN] }
    ]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });

  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 2);
});

test("includes a document created by another person when the user edits it that week", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-b")]) } },
    histories: { "doc-b": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(10))]) } },
    snapshots: { 1: { revision_id: 1, content: "bot content" }, 2: { revision_id: 2, content: "user edit" } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].createdCandidate, false);
  assert.equal(payload.documents[0].versions[0].diff.includes("+user edit"), true);
});

test("ignores edited candidates whose returned history only attributes changes to others", async () => {
  const anchoring = result("doc-self");
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-other", "docx", `文档 doc-other`, "bot"), anchoring]) } },
    histories: {
      "doc-other": { "": historyPage([history(1, ["bot"], at(10))]) },
      "doc-self": { "": historyPage([history(1, [HUMAN], at(-1)), history(2, [HUMAN], at(11))]) }
    },
    snapshots: { 1: { revision_id: 1, content: "base" }, 2: { revision_id: 2, content: "本人编辑" } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].title.includes("doc-self"), true);
});

test("fails closed when the verified identity is missing", async () => {
  const transport = makeTransport({
    openId: "",
    search: { edited: { "": page([result("doc-wrong-user")]) } }
  });
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), /无法核验当前 lark-cli 用户 open_id/);
  assert.equal(transport.calls.searches.length, 0);
});

test("derives the human editor ID at runtime from search metadata and single-editor history", async () => {
  const doc = { ...result("doc-self"), result_meta: { edit_user_id: "open-human" } };
  const transport = makeTransport({
    search: { edited: { "": page([doc]) } },
    histories: { "doc-self": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });
  transport.currentUserIdentity = async () => ({ openId: "open-human", botOpenId: "open-bot" });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 2);
});

test("derives the human editor ID from created-candidate first history entry", async () => {
  const transport = makeTransport({
    search: { created: { "": page([result("doc-created", "docx", `文档 doc-created`, "bot")]) } },
    histories: { "doc-created": { "": historyPage([history(1, [HUMAN], at(1)), history(2, ["bot"], at(2))]) } },
    snapshots: { 1: { revision_id: 1, content: "创建" }, 2: { revision_id: 2, content: "bot 追加" } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 1);
  assert.equal(payload.documents[0].aiVersions, 0);
});

test("labels bot ghostwritten versions and unknown collaborators separately", async () => {
  const doc = { ...result("doc-mixed"), result_meta: { edit_user_id: "open-human" } };
  const transport = makeTransport({
    search: { edited: { "": page([doc]) } },
    histories: { "doc-mixed": { "": historyPage([
      history(0, [HUMAN], at(-1)),
      history(1, [HUMAN], at(1)),
      history(2, ["bot-uid"], at(2)),
      history(3, ["colleague"], at(3)),
      history(4, [HUMAN], at(4))
    ]) } },
    snapshots: {
      0: { revision_id: 0, content: "base" },
      1: { revision_id: 1, content: "本人" },
      2: { revision_id: 2, content: "bot" },
      3: { revision_id: 3, content: "同事" },
      4: { revision_id: 4, content: "本人 again" }
    }
  });
  transport.currentUserIdentity = async () => ({ openId: "open-human", botOpenId: "open-bot" });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents[0].versions.length, 2);
  assert.equal(payload.documents[0].versions[0].revisionId, 1);
  assert.equal(payload.documents[0].versions[1].revisionId, 4);
  assert.equal(payload.documents[0].aiVersions, 0);
  assert.equal(payload.documents[0].otherVersions, 2);
});

test("labels bot versions when a bot-edited candidate provides the bot anchor", async () => {
  const humanDoc = { ...result("doc-h"), result_meta: { edit_user_id: "open-bot" } };
  const botDoc = { ...result("doc-bot"), result_meta: { edit_user_id: "open-bot" } };
  const anchorDoc = { ...result("doc-me"), result_meta: { edit_user_id: "open-human" } };
  const transport = makeTransport({
    search: { edited: { "": page([humanDoc, botDoc, anchorDoc]) } },
    histories: {
      "doc-h": { "": historyPage([history(0, ["bot"], at(-1)), history(1, [HUMAN], at(1)), history(2, ["bot-uid"], at(2))]) },
      "doc-bot": { "": historyPage([history(5, ["bot-uid"], at(5))]) },
      "doc-me": { "": historyPage([history(7, [HUMAN], at(-2)), history(6, [HUMAN], at(6))]) }
    },
    snapshots: {
      0: { revision_id: 0, content: "base" },
      1: { revision_id: 1, content: "本人" },
      2: { revision_id: 2, content: "bot" },
      5: { revision_id: 5, content: "bot-only" },
      7: { revision_id: 7, content: "base" },
      6: { revision_id: 6, content: "本人 doc" }
    }
  });
  transport.currentUserIdentity = async () => ({ openId: "open-human", botOpenId: "open-bot" });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  const human = payload.documents.find((document) => document.title.includes("doc-h"));
  assert.equal(human.versions.length, 1);
  assert.equal(human.aiVersions, 1);
  assert.equal(human.otherVersions, 0);
  assert.equal(payload.documents.some((document) => document.title.includes("doc-bot")), false);
});

test("fails closed when no candidate can anchor the human editor ID", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-no-anchor", "docx", `文档 doc-no-anchor`, "bot")]) } },
    histories: { "doc-no-anchor": { "": historyPage([history(1, ["bot"], at(1))]) } }
  });
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), /无法从本周候选自动互证本人 editor ID/);
});

test("fails closed when a custom transport cannot verify the current user", async () => {
  const transport = makeTransport();
  delete transport.currentUserIdentity;
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), /缺少当前用户身份核验能力/);
  assert.equal(transport.calls.searches.length, 0);
});

test("accepts multiple history versions under one revision as a single human version", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-multi")]) } },
    histories: { "doc-multi": { "": historyPage([
      history(1, ["bot"], at(-1)),
      history(2, [HUMAN], at(1), "h2-a"),
      history(2, [HUMAN], at(2), "h2-b")
    ]) } },
    snapshots: { 1: { revision_id: 1, content: "a" }, 2: { revision_id: 2, content: "b" } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, transport });
  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].versions.length, 1);
  assert.equal(payload.documents[0].versions[0].revisionId, 2);
  assert.equal("historyVersionIds" in payload.documents[0].versions[0], false);
});

test("fails closed for mixed editor IDs, missing target-week history, and mismatched revisions", async (t) => {
  const cases = [
    {
      name: "mixed editors",
      searchKind: "created",
      entries: [history(1, [HUMAN], at(-1)), history(2, [HUMAN, "bot"], at(1))],
      snapshots: { 1: { revision_id: 1, content: "a" }, 2: { revision_id: 2, content: "b" } },
      error: /编辑者归属(?:缺失或)?不唯一/
    },
    {
      name: "created candidate without human target-week version",
      searchKind: "created",
      entries: [history(1, [HUMAN], at(-1))], snapshots: { 1: { revision_id: 1, content: "a" } },
      error: /本人创建候选没有可核实的目标周本人历史版本/
    },
    {
      name: "candidate with no returned history",
      entries: [], snapshots: {},
      error: /未返回任何可核验的历史版本/
    },
    {
      name: "unattributed target-week revision beside a human edit",
      searchKind: "created",
      entries: [history(1, [HUMAN], at(-1)), history(2, [HUMAN], at(1)), history(3, [], at(2))],
      snapshots: { 1: { revision_id: 1, content: "a" }, 2: { revision_id: 2, content: "b" }, 3: { revision_id: 3, content: "c" } },
      error: /编辑者归属缺失或不唯一/
    },
    {
      name: "revision mismatch",
      entries: [history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))],
      snapshots: { 1: { revision_id: 99, content: "a" }, 2: { revision_id: 2, content: "b" } },
      error: /回读版本不匹配/
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const transport = makeTransport({
        search: { [item.searchKind || "edited"]: { "": page([result("doc-c")]) } },
        histories: { "doc-c": { "": historyPage(item.entries) } },
        snapshots: item.snapshots
      });
      await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), item.error);
    });
  }
});

test("rejects invalid ISO weeks and changed pagination schemas", async (t) => {
  await t.test("invalid W53", async () => {
    await assert.rejects(() => collectFeishuDocsWeekly({ week: "2025-W53", transport: makeTransport() }), /无效 ISO 周/);
  });
  await t.test("incomplete search page", async () => {
    const transport = makeTransport({ search: { created: { "": { results: [] } } } });
    await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), /搜索返回了不完整的分页结构/);
  });
  await t.test("history page token loop", async () => {
    const transport = makeTransport({
      search: { edited: { "": page([result("doc-d")]) } },
      histories: { "doc-d": { "": historyPage([], true, "same"), same: historyPage([], true, "same") } }
    });
    await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, transport }), /历史分页 token 缺失或重复/);
  });
});

test("requires a successful same-week shadow result before activation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-activation-gate-"));
  try {
    await assert.rejects(() => writeFeishuDocsWeekly({
      week: WEEK, activate: true, transport: makeTransport(), outputRoot: root
    }), /先完成同一目标周的影子采集和人工核对/);
    const status = JSON.parse(await readFile(path.join(root, "_source-status.json"), "utf8"));
    assert.equal(status.sources["feishu-docs"].status, "needs_review");
    assert.equal(await readFile(path.join(root, "feishu-docs.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records shadow, ready, empty, and failed states without losing stale bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-weekly-status-"));
  try {
    const shadow = await writeFeishuDocsWeekly({ week: WEEK, transport: makeTransport(), outputRoot: root });
    assert.equal(shadow.status, "needs_review");
    assert.equal(shadow.outputPath, null);

    const activeEmpty = await writeFeishuDocsWeekly({ week: WEEK, activate: true, transport: makeTransport(), outputRoot: root });
    assert.equal(activeEmpty.status, "empty");

    const snapshotPath = path.join(root, "feishu-docs.md");
    await writeFile(snapshotPath, "stale bytes\n", "utf8");
    await writeFeishuDocsWeekly({ week: WEEK, transport: makeTransport(), outputRoot: root });
    await assert.rejects(() => writeFeishuDocsWeekly({
      week: WEEK,
      
      activate: true,
      outputRoot: root,
      transport: makeTransport({
        search: { edited: { "": page([result("doc-e")]) } },
        histories: { "doc-e": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
        fetchError: new Error("permission denied")
      })
    }), /permission denied/);
    assert.equal(await readFile(snapshotPath, "utf8"), "stale bytes\n");
    const sourceStatus = JSON.parse(await readFile(path.join(root, "_source-status.json"), "utf8"));
    assert.equal(sourceStatus.sources["feishu-docs"].status, "failed");
    assert.equal(sourceStatus.sources["feishu-docs"].preservedStaleFile, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renders document backticks without breaking unified-diff fences", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-weekly-render-"));
  try {
    const outputRoot = path.join(root, WEEK);
    await mkdir(outputRoot, { recursive: true });
    const transport = makeTransport({
      search: { edited: { "": page([result("doc-f")]) } },
      histories: { "doc-f": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
      snapshots: { 1: { revision_id: 1, content: "```\nold\n```\n" }, 2: { revision_id: 2, content: "````\nnew\n````\n" } }
    });
    await writeFeishuDocsWeekly({ week: WEEK, outputRoot, transport });
    const markdown = await readFile(path.join(outputRoot, "feishu-docs.md"), "utf8");
    assert.match(markdown, /```diff/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps untrusted search titles and URLs inside Markdown metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-weekly-markdown-boundary-"));
  try {
    const outputRoot = path.join(root, WEEK);
    const doc = {
      ...result("doc-g", "docx", "安全标题\n## 注入 <img src=x>"),
      url: "https://example.feishu.cn/docx/doc-g>\n## forged"
    };
    const transport = makeTransport({
      search: { created: { "": page([doc]) } },
      histories: { "doc-g": { "": historyPage([history(1, [HUMAN], at(1))]) } },
      snapshots: { 1: { revision_id: 1, content: "正文" } }
    });
    await writeFeishuDocsWeekly({ week: WEEK, outputRoot, transport });
    const markdown = await readFile(path.join(outputRoot, "feishu-docs.md"), "utf8");
    assert.match(markdown, /^## doc-01｜安全标题 ## 注入 \\<img src=x\\>$/m);
    assert.doesNotMatch(markdown, /^## forged$/m);
    assert.match(markdown, /doc-g%3E##%20forged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs CLI adapter, atomic snapshot, source status, and Weekly Process input end to end", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-cli-e2e-"));
  const binDir = path.join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const cliPath = path.join(binDir, "lark-cli");
  const priorPath = process.env.PATH;
  const startEpoch = weekStart;
const fakeCli = `#!${process.execPath}
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const requirePair = (flag, expected) => {
  if (!args.includes(flag) || value(flag) !== expected) throw new Error('missing or wrong ' + flag);
};
if (args[0] === 'auth' && args[1] === 'status') {
  requirePair('--json', '--verify');
  console.log(JSON.stringify({ ok: true, identity: 'user', data: { verified: true, identities: { user: { openId: '${HUMAN}' } } } }));
} else {
requirePair('--as', 'user');
if (args[0] === 'drive' && args[1] === '+search') {
  requirePair('--doc-types', 'docx,wiki');
  requirePair('--page-size', '20');
  const created = args.includes('--created-by-me');
  if (created) {
    if (!args.includes('--created-since') || !args.includes('--created-until')) throw new Error('missing created range');
  } else if (!args.includes('--edited-since') || !args.includes('--edited-until')) throw new Error('missing edited range');
  const results = created ? [{ doc_type: 'docx', title: 'CLI Test', doc_token: 'cli-doc', url: 'https://example.feishu.cn/docx/cli-doc' }] : [];
  console.log(JSON.stringify({ ok: true, identity: 'user', data: { results, has_more: false } }));
} else if (args[0] === 'docs' && args[1] === '+history-list') {
  requirePair('--doc', 'cli-doc');
  requirePair('--page-size', '20');
  console.log(JSON.stringify({ ok: true, identity: 'user', data: { entries: [{ revision_id: 1, history_version_id: 'cli-h1', edit_time: String(${startEpoch + 1}), editor_ids: ['${HUMAN}'] }], has_more: false } }));
} else if (args[0] === 'docs' && args[1] === '+fetch') {
  requirePair('--doc', 'cli-doc');
  requirePair('--doc-format', 'markdown');
  requirePair('--revision-id', '1');
  console.log(JSON.stringify({ ok: true, identity: 'user', data: { document: { revision_id: 1, content: '# Live path simulation\\n' } } }));
} else {
  throw new Error('unexpected command: ' + args.join(' '));
}
}
`;
  try {
    await writeFile(cliPath, fakeCli, "utf8");
    await chmod(cliPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${priorPath ?? ""}`;
    const repoRoot = path.join(root, "repo");
    const outputRoot = path.join(repoRoot, "03_input", "weekly", WEEK);
    const transport = createLarkTransport();
    const shadow = await writeFeishuDocsWeekly({ week: WEEK, outputRoot, transport });
    assert.equal(shadow.status, "needs_review");
    assert.equal(shadow.payload.documents.length, 1);
    assert.equal(shadow.payload.documents[0].title, "CLI Test");
    assert.equal("markdown" in shadow.payload.documents[0].latestHumanVersion, false);
    await assert.rejects(() => collectWeeklyInput({ week: WEEK, repoRoot }), /feishu-docs 来源状态为 needs_review/);

    const active = await writeFeishuDocsWeekly({ week: WEEK, activate: true, outputRoot, transport });
    assert.equal(active.status, "ready");
    const input = await collectWeeklyInput({ week: WEEK, repoRoot });
    assert.equal(input.files.some((file) => file.path.endsWith("/feishu-docs.md")), true);
    assert.equal(input.items.some((item) => item.text.includes("Live path simulation")), true);
    assert.equal(input.sourceStatuses["feishu-docs"].status, "ready");
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
  }
});

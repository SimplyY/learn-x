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
const result = (token, type = "docx", title = `文档 ${token}`) => ({
  doc_type: type,
  title,
  doc_token: type === "docx" ? token : undefined,
  url: `https://example.feishu.cn/${type}/${token}`
});
const history = (revision, editorIds, editTime, historyVersionId = `h${revision}`) => ({
  revision_id: revision,
  history_version_id: historyVersionId,
  edit_time: String(editTime),
  editor_ids: editorIds
});
const page = (results = [], hasMore = false, pageToken = "") => ({ results, hasMore, pageToken });
const historyPage = (entries = [], hasMore = false, pageToken = "") => ({ entries, hasMore, pageToken });

function makeTransport({ search = {}, histories = {}, snapshots = {}, wiki = {}, fetchError, currentUserId = HUMAN } = {}) {
  const calls = { searches: [], histories: [], fetches: [] };
  return {
    calls,
    async currentUserId() { return currentUserId; },
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
  const sameDoc = result("doc-a");
  const transport = makeTransport({
    search: {
      created: { "": page([sameDoc], true, "created-next"), "created-next": page([{ ...result("doc-a", "wiki", ""), url: wikiUrl }]) },
      edited: { "": page([sameDoc]) }
    },
    wiki: { ["https://example.feishu.cn/wiki/wiki-node"]: { node: { obj_type: "docx", obj_token: "doc-a", title: "Wiki 标题" } } },
    histories: {
      "doc-a": {
        "": historyPage([history(10, ["bot"], at(-60))], true, "history-next"),
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
  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });

  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].versions.length, 2);
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 12);
  assert.equal(payload.documents[0].latestHumanVersion.markdown, "user two\n");
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
      result_meta: { doc_types: "DOCX", token: "wiki-node-token", url: wikiUrl }
    }]) } },
    wiki: { [wikiUrl]: { node: { obj_type: "docx", obj_token: "doc-v2", title: "底层标题" } } },
    histories: { "doc-v2": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });

  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });
  assert.equal(payload.documents[0].title, "嵌套标题");
  assert.equal(payload.documents[0].latestHumanVersion.markdown, "新正文");
});

test("accepts the Search v2 DOC entity enum for a Docx URL", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([{
      entity_type: "DOC",
      title_highlighted: "普通文档",
      result_meta: { doc_types: "DOCX", token: "doc-v2", url: "https://example.feishu.cn/docx/doc-v2" }
    }]) } },
    histories: { "doc-v2": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });

  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });
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

  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 2);
});

test("includes a document created by another person when the user edits it that week", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-b")]) } },
    histories: { "doc-b": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(10))]) } },
    snapshots: { 1: { revision_id: 1, content: "bot content" }, 2: { revision_id: 2, content: "user edit" } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });
  assert.equal(payload.documents.length, 1);
  assert.equal(payload.documents[0].createdCandidate, false);
  assert.equal(payload.documents[0].versions[0].diff.includes("+user edit"), true);
});

test("ignores edited candidates whose returned history only attributes changes to others", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-other")]) } },
    histories: { "doc-other": { "": historyPage([history(1, ["bot"], at(10))]) } }
  });
  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport });
  assert.equal(payload.documents.length, 0);
  assert.equal(transport.calls.fetches.length, 0);
});

test("fails closed when the configured editor ID differs from the current user", async () => {
  const transport = makeTransport({
    currentUserId: "different-user",
    search: { edited: { "": page([result("doc-wrong-user")]) } }
  });
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /本次 lark-cli 用户身份/);
  assert.equal(transport.calls.searches.length, 0);
});

test("keeps history editor ID separate from the current user's open_id", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-identity-spaces")]) } },
    histories: { "doc-identity-spaces": { "": historyPage([history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1))]) } },
    snapshots: { 1: { revision_id: 1, content: "旧正文" }, 2: { revision_id: 2, content: "新正文" } }
  });
  transport.currentUserIdentity = async () => ({ openId: "open-human" });
  delete transport.currentUserId;
  const payload = await collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, humanOpenId: "open-human", transport });
  assert.equal(payload.documents[0].latestHumanVersion.revisionId, 2);
});

test("fails closed when the current open_id canary is missing", async () => {
  const transport = makeTransport();
  transport.currentUserIdentity = async () => ({ openId: "open-human" });
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /未配置经 canary 核实的本人 open_id/);
  assert.equal(transport.calls.searches.length, 0);
});

test("fails closed when a custom transport cannot verify the current user", async () => {
  const transport = makeTransport();
  delete transport.currentUserId;
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /缺少当前用户身份核验能力/);
  assert.equal(transport.calls.searches.length, 0);
});

test("fails closed when a revision maps to multiple history versions", async () => {
  const transport = makeTransport({
    search: { edited: { "": page([result("doc-ambiguous")]) } },
    histories: { "doc-ambiguous": { "": historyPage([
      history(1, ["bot"], at(-1)),
      history(2, [HUMAN], at(1), "h2-a"),
      history(2, [HUMAN], at(2), "h2-b")
    ]) } }
  });
  await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /对应多个 history_version_id/);
  assert.equal(transport.calls.fetches.length, 0);
});

test("fails closed for mixed editor IDs, missing target-week history, and mismatched revisions", async (t) => {
  const cases = [
    {
      name: "mixed editors",
      entries: [history(1, ["bot"], at(-1)), history(2, [HUMAN, "bot"], at(1))],
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
      entries: [history(1, ["bot"], at(-1)), history(2, [HUMAN], at(1)), history(3, [], at(2))],
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
      await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), item.error);
    });
  }
});

test("rejects invalid ISO weeks and changed pagination schemas", async (t) => {
  await t.test("invalid W53", async () => {
    await assert.rejects(() => collectFeishuDocsWeekly({ week: "2025-W53", editorId: HUMAN, transport: makeTransport() }), /无效 ISO 周/);
  });
  await t.test("incomplete search page", async () => {
    const transport = makeTransport({ search: { created: { "": { results: [] } } } });
    await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /搜索返回了不完整的分页结构/);
  });
  await t.test("history page token loop", async () => {
    const transport = makeTransport({
      search: { edited: { "": page([result("doc-d")]) } },
      histories: { "doc-d": { "": historyPage([], true, "same"), same: historyPage([], true, "same") } }
    });
    await assert.rejects(() => collectFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport }), /历史分页 token 缺失或重复/);
  });
});

test("requires a successful same-week shadow result before activation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-feishu-activation-gate-"));
  try {
    await assert.rejects(() => writeFeishuDocsWeekly({
      week: WEEK, editorId: HUMAN, activate: true, transport: makeTransport(), outputRoot: root
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
    const shadow = await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport: makeTransport(), outputRoot: root });
    assert.equal(shadow.status, "needs_review");
    assert.equal(shadow.outputPath, null);

    const activeEmpty = await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, activate: true, transport: makeTransport(), outputRoot: root });
    assert.equal(activeEmpty.status, "empty");

    const snapshotPath = path.join(root, "feishu-docs.md");
    await writeFile(snapshotPath, "stale bytes\n", "utf8");
    await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, transport: makeTransport(), outputRoot: root });
    await assert.rejects(() => writeFeishuDocsWeekly({
      week: WEEK,
      editorId: HUMAN,
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
    await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, outputRoot, transport });
    const markdown = await readFile(path.join(outputRoot, "feishu-docs.md"), "utf8");
    assert.match(markdown, /`````diff/);
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
    await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, outputRoot, transport });
    const markdown = await readFile(path.join(outputRoot, "feishu-docs.md"), "utf8");
    assert.match(markdown, /^## 安全标题 ## 注入 \\<img src=x\\>$/m);
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
  const priorOpenId = process.env.LEARNX_FEISHU_HUMAN_OPEN_ID;
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
    process.env.PATH = binDir;
    process.env.LEARNX_FEISHU_HUMAN_OPEN_ID = HUMAN;
    const repoRoot = path.join(root, "repo");
    const outputRoot = path.join(repoRoot, "03_input", "weekly", WEEK);
    const transport = createLarkTransport();
    const shadow = await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, outputRoot, transport });
    assert.equal(shadow.status, "needs_review");
    assert.equal(shadow.payload.documents.length, 1);
    assert.equal(shadow.payload.documents[0].title, "CLI Test");
    assert.equal(shadow.payload.documents[0].latestHumanVersion.markdown, "# Live path simulation\n");
    await assert.rejects(() => collectWeeklyInput({ week: WEEK, repoRoot }), /feishu-docs 来源状态为 needs_review/);

    const active = await writeFeishuDocsWeekly({ week: WEEK, editorId: HUMAN, activate: true, outputRoot, transport });
    assert.equal(active.status, "ready");
    const input = await collectWeeklyInput({ week: WEEK, repoRoot });
    assert.equal(input.files.some((file) => file.path.endsWith("/feishu-docs.md")), true);
    assert.equal(input.items.some((item) => item.text.includes("Live path simulation")), true);
    assert.equal(input.sourceStatuses["feishu-docs"].status, "ready");
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    if (priorOpenId === undefined) delete process.env.LEARNX_FEISHU_HUMAN_OPEN_ID;
    else process.env.LEARNX_FEISHU_HUMAN_OPEN_ID = priorOpenId;
    await rm(root, { recursive: true, force: true });
  }
});

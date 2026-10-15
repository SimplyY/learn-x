import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanArchive, scanOnlineSnapshot, hashBody, normalizeBody } from "./catalog.mjs";
import { createOnlineFlomoSnapshot, flomoBodyHash, flomoMemoUrl } from "../../learn-x-input/scripts/lib/flomo-full-snapshot.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "flomo-catalog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (relative, content) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  };
  return { root, put };
}

function memo(body = "自己做过一次以后，才知道哪些条件真正决定结果。", id = null, heading = "## 2026-09-28 09:00 +08:00") {
  return `${heading}\n\n${id ? `- 来源：https://v.flomoapp.com/mine/?memo_id=${id}\n\n` : ""}${body}\n`;
}

function readyHeader(count = 1) {
  return `# Flomo｜2026-W40\n\n- 目标范围：2026-09-28 00:00（含）至 2026-10-05 00:00（不含），Asia/Shanghai\n- 采集时间：2026-10-05 09:00 +08:00\n- 记录数：${count}\n- 最早已读取笔记时间：2026-09-19 11:17 +08:00\n- 下界已覆盖：是\n\n`;
}

function status(state = "ready", count = 1, summary = "完整扫描目标范围，已完成") {
  return JSON.stringify({ version: 1, week: "2026-W40", updatedAt: "2026-10-05T01:00:00Z", sources: { flomo: { status: state, file: "flomo.md", count, summary, updatedAt: "2026-10-05T01:00:00Z", preservedStaleFile: state !== "ready" } } });
}

test("all archive roots, H2/H3 and split month headings preserve full bodies and source lines", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/yearly/2025/2025-10/flomo.md", "# Flomo\n## 2025-10-01\n### 09:00\n完整的历史思考。\n### 10:00:20\n另一条历史思考。\n");
  await put("03_input/monthly/2026-1/flomo.md", memo("月归档正文。", null, "## 2026-01-01 09:00"));
  await put("03_input/weekly-history/2026-W30/flomo.md", memo("H3 旧格式正文。", null, "### 2026-07-20 09:00"));
  await put("03_input/weekly/2026-W40/flomo.md", memo("第一段完整正文。\n\n### 2025-01-01 10:00\n这段内嵌日期也是原文。\n\n[引用别的笔记](https://v.flomoapp.com/mine/?memo_id=OTHER)", "OWN"));
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 5);
  assert.equal(result.coverage.remoteFullCoverage, false);
  assert.equal(result.coverage.legacyFiles, 4);
  const own = result.notes.find((note) => note.memoId === "OWN");
  assert.match(own.body, /内嵌日期也是原文/);
  assert.match(own.body, /memo_id=OTHER/);
  assert.equal(own.source.line, 1);
  assert.equal(own.source.url, "https://v.flomoapp.com/mine/?memo_id=OWN");
  assert.equal(result.notes.find((note) => /月归档/.test(note.body)).createdAt, "2026-01-01T09:00:00+08:00");
});

test("identity backfill links an unambiguous legacy note without changing its body", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  const body = "历史正文保持原样。";
  await put(file, memo(body, null, "## 2026-09-28 09:00"));
  const identity = { memoId: "REMOTE-ID", timeMs: Date.parse("2026-09-28T09:00:00+08:00"), bodyHash: hashBody(body) };
  await put("03_input/_archives/flomo/identity-backfill.json", JSON.stringify({ schemaVersion: 1, complete: true, lowerBoundCovered: true, identities: [identity] }));
  const linked = await scanArchive(root);
  assert.equal(linked.notes[0].memoId, "REMOTE-ID");
  assert.equal(linked.notes[0].bodyHash, identity.bodyHash);
  assert.equal(linked.notes[0].source.path, file);
  assert.equal(linked.notes[0].source.url, "https://v.flomoapp.com/mine/?memo_id=REMOTE-ID");

  await put("03_input/_archives/flomo/identity-backfill.json", JSON.stringify({ schemaVersion: 1, complete: true, lowerBoundCovered: true, identities: [identity, { ...identity, memoId: "OTHER-ID" }] }));
  const ambiguous = await scanArchive(root);
  assert.equal(ambiguous.notes[0].memoId, null);
  assert.equal(ambiguous.notes[0].source.url, null);
});

test("source-like handwritten body lines are preserved and Learn-X tags remain excluded", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, [
    memo("来源：一次散步后的观察\n后来我把它和工作里的判断联系起来。", null, "## 2026-09-28 09:00"),
    "---",
    memo("来源：#LEARN-X\n这是 Learn-X 自动生成内容，不应进入候选库。", null, "## 2026-09-29 09:00"),
    "---",
    memo("- Source: https://example.com/essay\n这行也是正文，不是 Flomo 身份元数据。", null, "## 2026-09-30 09:00"),
    "---",
    memo("来源：我的引用 https://v.flomoapp.com/mine/?memo_id=MIXED-ID 并不是导出元数据\n这段来源说明必须原样保留。", null, "## 2026-10-01 09:00"),
    "---",
    memo("来源：https://v.flomoapp.com/mine/?memo_id=TAGGED-ID #LEARN-X\n带标签的来源样正文不可入库。", null, "## 2026-10-02 09:00"),
    "---",
    memo("标准来源元数据后面的完整正文。", "VALID-ID", "## 2026-10-03 09:00"),
    "---",
    "## 2026-10-04 09:00\n\n- 来源：[Flomo](https://v.flomoapp.com/mine/?memo_id=MARKDOWN-ID)\n\nMarkdown 来源元数据后面的正文。",
  ].join("\n\n"));

  const result = await scanArchive(root);
  assert.equal(result.notes.length, 5);
  assert.ok(result.notes.some((note) => note.body.startsWith("来源：一次散步后的观察\n")));
  assert.ok(result.notes.some((note) => note.body.startsWith("- Source: https://example.com/essay\n")));
  assert.ok(result.notes.some((note) => note.body.startsWith("来源：我的引用 https://v.flomoapp.com/mine/?memo_id=MIXED-ID")));
  assert.ok(result.notes.some((note) => note.memoId === "VALID-ID" && note.body === "标准来源元数据后面的完整正文。"));
  assert.ok(result.notes.some((note) => note.memoId === "MARKDOWN-ID" && note.body === "Markdown 来源元数据后面的正文。"));
  assert.equal(result.excluded.filter((item) => item.reason === "learn-x-tag").length, 2);
  assert.equal(result.notes.some((note) => note.memoId === "MIXED-ID" || note.memoId === "TAGGED-ID"), false);
});

test("filters parent and child learn-x tags case insensitively, generated notes, user excluded tags", async (t) => {
  const { root, put } = await fixture(t);
  const bodies = ["文本 #LEARN-X", "文本#Learn-X/周记", "Learn-X 周记｜W40\n原文", "文本 #不回顾", "文本 #不洞察", "文本 #AI洞察", "我手写讨论 Learn-X 周记的输入设计，发现减少重复处理更有效。", "#learn-xtra 这是一个不同标签。", "这首短诗保留它的审美表达。"];
  await put("03_input/monthly/2026-9/flomo.md", bodies.map((body, i) => memo(body, null, `## 2026-09-${String(i + 1).padStart(2, "0")} 09:00`)).join("\n---\n\n"));
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 3);
  assert.equal(result.excluded.length, 6);
  assert.ok(result.notes.some((note) => note.body.includes("手写讨论 Learn-X 周记")));
});

test("preserves handwritten marker mentions and sentence starts but excludes complete generated titles", async (t) => {
  const { root, put } = await fixture(t);
  const handwritten = [
    "我手写讨论 Learn-X 周记的输入设计，发现减少重复处理更有效。",
    "Learn-X 周记帮我看见了过去忽略的生活细节。",
    "AI 基础草稿让我发现缺少真实经历，需要自己补充。",
    "飞书周记改善了我的记录习惯。",
    "#learn-xtra 是我自己的不同标签。"
  ];
  const generated = ["Learn-X 周记", "Learn-X 月记｜2026-09", "# 飞书周记", "**【待优化】AI 基础草稿**", "## Learn-X 同步校验"];
  await put("03_input/monthly/2026-9/flomo.md", [...handwritten, ...generated].map((body, i) => memo(body, `NOTE-${i}`)).join("\n---\n\n"));
  const result = await scanArchive(root);
  assert.deepEqual(new Set(result.notes.map((note) => note.body)), new Set(handwritten));
  assert.equal(result.excluded.filter((item) => item.reason === "generated-memo").length, generated.length);
});

test("a recovered quarantine preserves exposure identity but requires a new quality assessment", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("Learn-X 周记帮我看见了过去忽略的生活细节。", "HANDWRITTEN"));
  const first = await scanArchive(root);
  const prior = first.notes[0];
  prior.quality = { score: 4, summary: "旧通过", reason: "旧判断", bodyHash: prior.bodyHash, policyVersion: "1" };
  const previous = { ...first, notes: [], excluded: [{ source: prior.source, previousNote: prior, noteKey: prior.noteKey, reason: "previous-note-not-currently-verified", count: 1 }] };
  const recovered = await scanArchive(root, { previous });
  assert.equal(recovered.notes[0].noteKey, prior.noteKey);
  assert.equal(recovered.notes[0].groupKey, prior.groupKey);
  assert.equal(recovered.notes[0].quality, null);
});

test("ready requires complete evidence and consistent counts; stale failed/empty sources are never parsed", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/weekly/2026-W40/flomo.md";
  const sidecar = "03_input/weekly/2026-W40/_source-status.json";
  await put(file, readyHeader() + memo("有证据的完整周笔记。", "A"));
  await put(sidecar, status());
  assert.equal((await scanArchive(root)).notes.length, 1);
  await put(file, memo("残留文件里自己写：\n- 目标范围：2026-09-28至2026-10-05\n- 下界已覆盖：是\n- 记录数：1\n- 采集时间：今天", "A"));
  assert.equal((await scanArchive(root)).excluded[0].reason, "source-integrity-unverified");
  for (const state of ["failed", "unavailable", "empty"]) {
    await put(sidecar, status(state, 0));
    const result = await scanArchive(root);
    assert.equal(result.notes.length, 0);
    assert.equal(result.sources[0].fileHash, undefined);
    assert.equal(result.excluded[0].reason, `source-${state}`);
  }
});

test("invalid sidecars fail closed rather than turning into legacy", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/weekly/2026-W40/flomo.md", memo());
  await put("03_input/weekly/2026-W40/_source-status.json", "{bad json}");
  await assert.rejects(scanArchive(root), /source-status-invalid/);
  await put("03_input/weekly/2026-W40/_source-status.json", status().replace('"2026-W40"', '"2026-W39"'));
  await assert.rejects(scanArchive(root), /source-status-invalid/);
});

test("reimport and identical legacy copies merge original sources with stable identity", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/monthly/2026-9/flomo.md", memo("同一条真实思考。"));
  await put("03_input/weekly-history/2026-W40/flomo.md", memo("同一条真实思考。"));
  const first = await scanArchive(root);
  assert.equal(first.notes.length, 1);
  assert.equal(first.notes[0].sources.length, 2);
  const again = await scanArchive(root, { previous: first });
  assert.deepEqual(again.notes, first.notes);
  assert.equal(again.notes[0].memoId, null);
  assert.equal(again.notes[0].source.url, null);
});

test("legacy gaining an ID retains note key, group and quality plus ID alias", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("先在历史快照里留下的思考。"));
  const previous = await scanArchive(root);
  previous.notes[0].quality = { score: 3, summary: "可以复用的经验", reason: "有明确经验", bodyHash: previous.notes[0].bodyHash, policyVersion: "1" };
  await put(file, memo("先在历史快照里留下的思考。", "LATER-ID"));
  const result = await scanArchive(root, { previous });
  assert.equal(result.notes[0].noteKey, previous.notes[0].noteKey);
  assert.equal(result.notes[0].groupKey, previous.notes[0].groupKey);
  assert.equal(result.notes[0].memoId, "LATER-ID");
  assert.ok(result.notes[0].aliases.includes("flomo:LATER-ID"));
  assert.deepEqual(result.notes[0].quality, previous.notes[0].quality);
});

test("same ID edited body keeps exposure identity but invalidates cached quality", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("修改前的经验。", "STABLE"));
  const previous = await scanArchive(root);
  previous.notes[0].quality = { score: 3, summary: "之前的摘要", reason: "旧原因", bodyHash: previous.notes[0].bodyHash, policyVersion: "1" };
  await put(file, memo("修改后的完整经验。", "STABLE"));
  const result = await scanArchive(root, { previous });
  assert.equal(result.notes[0].noteKey, previous.notes[0].noteKey);
  assert.equal(result.notes[0].groupKey, previous.notes[0].groupKey);
  assert.equal(result.notes[0].quality, null);
  assert.notEqual(result.notes[0].bodyHash, previous.notes[0].bodyHash);
});

test("same ID conflicting body/date quarantines all versions", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/monthly/2026-9/flomo.md", memo("版本一。", "CONFLICT"));
  await put("03_input/weekly-history/2026-W40/flomo.md", memo("版本二。", "CONFLICT"));
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.excluded.filter((entry) => entry.reason === "memo-id-conflict").length, 2);
});

test("distinct IDs with same body preserve identities and share exposure group", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/monthly/2026-9/flomo.md", memo("完全一样的复本。", "A") + "\n---\n\n" + memo("完全一样的复本。", "B"));
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 2);
  assert.notEqual(result.notes[0].noteKey, result.notes[1].noteKey);
  assert.equal(result.notes[0].groupKey, result.notes[1].groupKey);
});

test("unidentifiable legacy body changes stay quarantined rather than resetting history", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("无 ID 的旧正文。"));
  const previous = await scanArchive(root);
  await put(file, memo("无 ID 的新正文。"));
  const result = await scanArchive(root, { previous });
  assert.equal(result.notes.length, 0);
  assert.ok(result.excluded.some((entry) => entry.reason === "ambiguous-legacy-edit"));
});

test("invalid dates, partial-range ready, and unsupported quality policy fail closed", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/monthly/2026-2/flomo.md", memo("日期不能凭空修正。", null, "## 2026-02-30 09:00"));
  let result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.excluded[0].reason, "invalid-created-at");
  await put("03_input/weekly/2026-W40/flomo.md", readyHeader().replace("2026-10-05", "2026-10-03") + memo());
  await put("03_input/weekly/2026-W40/_source-status.json", status());
  result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.ok(result.excluded.some((entry) => entry.reason === "source-integrity-unverified"));
  await put("03_input/monthly/2026-2/flomo.md", memo("有效正文。"));
  const previous = await scanArchive(root);
  previous.notes[0].quality = { score: 4, summary: "旧策略", reason: "旧原因", bodyHash: previous.notes[0].bodyHash, policyVersion: "0" };
  assert.equal((await scanArchive(root, { previous })).notes[0].quality, null);
});

test("hash keeps complete normalized text including tags, supports CRLF and does not truncate", () => {
  const body = "完整原文 #标签\r\n\r\n" + "后续全文。".repeat(50000);
  assert.equal(normalizeBody(body).length, body.length - 2);
  assert.equal(hashBody(body), hashBody(body.replaceAll("\r\n", "\n")));
  assert.notEqual(hashBody(body), hashBody(body.replace(" #标签", "")));
});

test("edited real note becoming another existing body merges historical exposure aliases", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("原始 A 正文。", "A") + "\n---\n\n" + memo("原始 B 正文。", "B"));
  const previous = await scanArchive(root);
  const oldGroups = previous.notes.map((note) => note.groupKey);
  await put(file, memo("原始 B 正文。", "A") + "\n---\n\n" + memo("原始 B 正文。", "B"));
  const result = await scanArchive(root, { previous });
  assert.equal(result.notes.length, 2);
  assert.equal(result.notes[0].groupKey, result.notes[1].groupKey);
  for (const note of result.notes) for (const oldGroup of oldGroups) assert.ok([note.groupKey, ...note.groupAliases].includes(oldGroup));
});

test("quarantined identity survives another scan and recovers with its old exposure", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("先前被确认的无 ID 正文。"));
  const original = await scanArchive(root);
  await put(file, memo("来源无法确认的不同正文。"));
  const blocked = await scanArchive(root, { previous: original });
  assert.equal(blocked.notes.length, 0);
  await put(file, memo("先前被确认的无 ID 正文。", "RECOVERED"));
  const recovered = await scanArchive(root, { previous: blocked });
  assert.equal(recovered.notes[0].noteKey, original.notes[0].noteKey);
  assert.equal(recovered.notes[0].groupKey, original.notes[0].groupKey);
});

test("legitimate sidecar without Flomo declares an unverified source instead of legacy", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/weekly/2026-W40/flomo.md", memo());
  const document = JSON.parse(status());
  delete document.sources.flomo;
  await put("03_input/weekly/2026-W40/_source-status.json", JSON.stringify(document));
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.coverage.legacyFiles, 0);
  assert.equal(result.excluded[0].reason, "source-unverified");
});

test("one legacy identity does not collapse two later distinct real IDs", async (t) => {
  const { root, put } = await fixture(t);
  const file = "03_input/monthly/2026-9/flomo.md";
  await put(file, memo("同文旧归档只有一个未知身份。"));
  const previous = await scanArchive(root);
  await put(file, memo("同文旧归档只有一个未知身份。", "A") + "\n---\n\n" + memo("同文旧归档只有一个未知身份。", "B"));
  const result = await scanArchive(root, { previous });
  assert.equal(result.notes.length, 2);
  assert.equal(new Set(result.notes.map((note) => note.noteKey)).size, 2);
  assert.equal(result.notes[0].groupKey, previous.notes[0].groupKey);
  assert.equal(result.notes[1].groupKey, previous.notes[0].groupKey);
});

test("a dated body without reliable time is quarantined rather than silently missing", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/monthly/2026-9/flomo.md", "## 2026-09-28\n这是没有可靠创建时刻的笔记。\n");
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.excluded[0].reason, "invalid-created-at");
  assert.equal(result.coverage.parsedRecords, 1);
});

test("complete date labels with partial hours do not prove a complete ISO week", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/weekly/2026-W40/flomo.md", readyHeader().replace("2026-09-28 00:00", "2026-09-28 08:00") + memo());
  await put("03_input/weekly/2026-W40/_source-status.json", status());
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.excluded[0].reason, "source-integrity-unverified");
});

test("a UTC range sharing Shanghai calendar labels is still the wrong coverage", async (t) => {
  const { root, put } = await fixture(t);
  await put("03_input/weekly/2026-W40/flomo.md", readyHeader().replace("2026-09-28 00:00（含）至 2026-10-05 00:00（不含）", "2026-09-28T00:00:00Z 至 2026-10-05T00:00:00Z") + memo());
  await put("03_input/weekly/2026-W40/_source-status.json", status());
  const result = await scanArchive(root);
  assert.equal(result.notes.length, 0);
  assert.equal(result.excluded[0].reason, "source-integrity-unverified");
});

function onlineSnapshot(entries, expectedCount = entries.length) {
  const records = entries.map(({ id, body, tags, createdAt = "2026-10-10T01:00:00.000Z", isPinned = false }) => ({
    memoId: id, url: flomoMemoUrl(id), createdAt, timeText: "2026-10-10 09:00",
    bodyText: body, bodyComplete: true, isPinned, ...(tags ? { tags } : {}),
  }));
  const longest = [...records].sort((a, b) => b.bodyText.length - a.bodyText.length)[0];
  return createOnlineFlomoSnapshot({
    mode: "full", complete: true, libraryCount: expectedCount, scanned: records.length, pageCount: 4,
    scanStartedAt: "2026-10-11T01:00:00.000Z", scanFinishedAt: "2026-10-11T01:02:00.000Z",
    termination: {
      reason: expectedCount === records.length ? "library-count-and-stable-ids" : "stable-bottom-with-accepted-count-gap",
      enumerationComplete: true, expectedCount, observedUniqueIds: records.length,
      missingCount: expectedCount - records.length, stableScrollPasses: 2,
      atBottom: true, hasMore: false, loading: false,
    },
    detailVerification: longest ? {
      verified: true, memoId: longest.memoId, bodyLength: longest.bodyText.length,
      bodyHash: flomoBodyHash(longest.bodyText), method: "original-link-detail-sheet-tiptap-prosemirror",
    } : null,
    records,
  });
}

test("online catalog excludes exact DOM tags when rendered body text runs into the tag", () => {
  const snapshot = onlineSnapshot([{ id: "memo-ai-insight-tag", body: "#ai洞察像投资，像价值判断", tags: ["#ai洞察"] }]);
  const catalog = scanOnlineSnapshot(snapshot);
  assert.equal(catalog.notes.length, 0);
  assert.equal(catalog.excluded[0].reason, "excluded-tag");
});

test("online catalog restores whitespace only from one unique legacy match and invalidates quality", async (t) => {
  const { root, put } = await fixture(t);
  const body = "第一段完整正文。\n\n1. 第一项\n2. 第二项";
  const flattened = "第一段完整正文。1. 第一项2. 第二项";
  await put("03_input/monthly/2026-9/flomo.md", memo(body, null, "## 2026-10-09 09:00"));
  const legacyCatalog = await scanArchive(root);
  const prior = { schemaVersion: 1, sourceMode: "flomo-online-full", notes: [], excluded: [{ source: legacyCatalog.notes[0].source, previousNote: {
    noteKey: "flomo:REMOTE-ID", memoId: "REMOTE-ID", aliases: ["flomo:REMOTE-ID"], groupKey: "content:old",
    groupAliases: [], createdAt: "2026-10-09T09:00:00+08:00", body: flattened, bodyHash: hashBody(flattened),
    source: legacyCatalog.notes[0].source, sources: [legacyCatalog.notes[0].source],
    quality: { score: 4, reason: "旧判断", quote: flattened, bodyHash: hashBody(flattened), policyVersion: "1" },
  }, noteKey: "flomo:REMOTE-ID", reason: "online-note-not-present", count: 1 }] };
  const result = scanOnlineSnapshot(onlineSnapshot([{ id: "REMOTE-ID", body: flattened, createdAt: "2026-10-09T01:00:00.000Z" }]), { previous: prior, legacyCatalog });
  assert.equal(result.notes[0].body, body);
  assert.equal(result.notes[0].bodyHash, hashBody(body));
  assert.equal(result.notes[0].quality.bodyHash, hashBody(body));
  assert.equal(result.notes[0].quality.quote, body);
  assert.equal(result.notes[0].groupKey, "content:old");
});

test("online catalog does not use ambiguous or changed legacy bodies", async (t) => {
  const { root, put } = await fixture(t);
  const flattened = "同一条正文。";
  await put("03_input/monthly/2026-9/flomo.md", memo("同一条\n正文。", null, "## 2026-10-09 09:00"));
  await put("03_input/weekly-history/2026-W40/flomo.md", memo("同一条\n\n正文。", null, "## 2026-10-09 09:00"));
  const legacyCatalog = await scanArchive(root);
  const ambiguous = scanOnlineSnapshot(onlineSnapshot([{ id: "REMOTE-ID", body: flattened, createdAt: "2026-10-09T01:00:00.000Z" }]), { legacyCatalog });
  assert.equal(ambiguous.notes[0].body, flattened);

  await rm(path.join(root, "03_input/weekly-history/2026-W40/flomo.md"));
  await put("03_input/monthly/2026-9/flomo.md", memo("不同的正文。", null, "## 2026-10-09 09:00"));
  const changed = scanOnlineSnapshot(onlineSnapshot([{ id: "REMOTE-ID", body: flattened, createdAt: "2026-10-09T01:00:00.000Z" }]), { legacyCatalog: await scanArchive(root) });
  assert.equal(changed.notes[0].body, flattened);
});

test("online catalog restores seconds-different legacy bodies and removes attachment footer", async (t) => {
  const { root, put } = await fixture(t);
  const body = "#记录/播客\n1. 第一句\n2. 第二句";
  const flattened = "#记录/播客 1. 第一句2. 第二句";
  await put("03_input/monthly/2026-9/flomo.md", memo(`${body}\n\n**附件**\n\n![memo image](/tmp/note.jpg)`, null, "## 2026-10-09 09:00:04"));
  const legacyCatalog = await scanArchive(root);
  const result = scanOnlineSnapshot(onlineSnapshot([{ id: "REMOTE-ID", body: flattened, createdAt: "2026-10-09T01:00:00.000Z" }]), { legacyCatalog });
  assert.equal(result.notes[0].body, body);
});

test("online catalog resets legacy quality, keeps same-ID exposure through edits, and records deletions", () => {
  const originalBody = "一次真实实验让我记录了最初的判断和后来得到的反馈。";
  const editedBody = "一次真实实验让我记录了修改后的判断和后来得到的反馈。";
  const legacy = {
    schemaVersion: 1, sourceMode: "legacy-archive", dedupeGeneration: "legacy", excluded: [],
    notes: [{ noteKey: "legacy-key", memoId: "memo-a", aliases: ["legacy-key", "flomo:memo-a"],
      groupKey: "legacy-group", groupAliases: [], createdAt: "2026-10-10T01:00:00.000Z",
      body: originalBody, bodyHash: hashBody(originalBody),
      source: { path: "old-archive.md", line: 1, url: flomoMemoUrl("memo-a") },
      quality: { score: 4, reason: "历史质量判断", quote: originalBody, bodyHash: hashBody(originalBody), policyVersion: "1" } }],
  };
  const first = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-a", body: originalBody }]), { previous: legacy });
  assert.equal(first.coverage.status, "complete");
  assert.equal(first.notes[0].memoId, "memo-a");
  assert.equal(first.notes[0].noteKey, "legacy-key");
  assert.equal(first.notes[0].quality, null, "legacy scores must not cross the first source migration");
  const noteKey = first.notes[0].noteKey, groupKey = first.notes[0].groupKey;
  first.notes[0].quality = { score: 4, reason: "旧评分", quote: originalBody, bodyHash: first.notes[0].bodyHash, policyVersion: "1" };
  const edited = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-a", body: editedBody }]), { previous: first });
  assert.equal(edited.notes[0].noteKey, noteKey);
  assert.equal(edited.notes[0].groupKey, groupKey);
  assert.equal(edited.notes[0].quality, null, "edited body invalidates score while preserving identity");
  const deleted = scanOnlineSnapshot(onlineSnapshot([]), { previous: edited });
  assert.equal(deleted.notes.length, 0);
  assert.equal(deleted.excluded[0].reason, "online-note-not-present");
  assert.equal(deleted.excluded[0].previousNote.memoId, "memo-a");
});

test("online catalog preserves distinct IDs with identical bodies and reports accepted coverage gaps", () => {
  const body = "同一段原文对应两条独立的 Flomo memo 身份。";
  const snapshot = onlineSnapshot([{ id: "memo-a", body }, { id: "memo-b", body }], 3);
  const catalog = scanOnlineSnapshot(snapshot);
  assert.equal(catalog.notes.length, 2);
  assert.equal(new Set(catalog.notes.map((note) => note.memoId)).size, 2);
  assert.equal(new Set(catalog.notes.map((note) => note.noteKey)).size, 2);
  assert.equal(catalog.notes[0].groupKey, catalog.notes[1].groupKey);
  assert.deepEqual(
    [catalog.coverage.expectedCount, catalog.coverage.observedCount, catalog.coverage.omittedCount, catalog.coverage.ratio],
    [3, 2, 1, 2 / 3],
  );
  assert.equal(catalog.snapshot.coverage.status, "accepted-with-gaps");
  assert.equal(catalog.notes[0].source.url, flomoMemoUrl(catalog.notes[0].memoId));
  assert.equal(hashBody(body), catalog.notes[0].bodyHash);
});

test("online catalog accepts a valid snapshot stamped with the prior stricter gap policy", () => {
  const snapshot = onlineSnapshot([
    { id: "memo-a", body: "一条用于验证旧版覆盖策略兼容的笔记。" },
    { id: "memo-b", body: "另一条用于验证旧版覆盖策略兼容的笔记。" },
  ], 3);
  snapshot.coverage.policy = "up-to-three-unresolved-records-v1";

  const catalog = scanOnlineSnapshot(snapshot);

  assert.equal(catalog.notes.length, 2);
  assert.equal(catalog.coverage.omittedCount, 1);
  assert.equal(catalog.snapshot.coverage.policy, "up-to-three-unresolved-records-v1");
});

test("online catalog rejects unknown or internally inconsistent coverage policies", () => {
  const unknown = onlineSnapshot([{ id: "memo-a", body: "覆盖策略必须可识别。" }], 2);
  unknown.coverage.policy = "unrecognized-policy-v9";
  assert.throws(() => scanOnlineSnapshot(unknown), /online-snapshot-coverage-invalid/);

  const exceedsPriorPolicy = onlineSnapshot([{ id: "memo-a", body: "旧策略的缺口上限仍需遵守。" }], 5);
  exceedsPriorPolicy.coverage.policy = "up-to-three-unresolved-records-v1";
  assert.throws(() => scanOnlineSnapshot(exceedsPriorPolicy), /online-snapshot-coverage-invalid/);
});

test("online catalog never assigns one ID-less legacy note to multiple online identities", () => {
  const body = "历史本地归档中没有可验证 Flomo ID 的笔记。";
  const legacy = {
    schemaVersion: 1, sourceMode: "legacy-archive", dedupeGeneration: "legacy", excluded: [],
    notes: [{ noteKey: "legacy-idless", memoId: null, aliases: ["legacy-idless"], groupKey: "legacy-group", groupAliases: [],
      createdAt: "2026-10-10T01:00:00.000Z", body, bodyHash: hashBody(body),
      source: { path: "old-archive.md", line: 1, url: null }, quality: { score: 4, bodyHash: hashBody(body), policyVersion: "1" } }],
  };
  const catalog = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-a", body }, { id: "memo-b", body }]), { previous: legacy });
  assert.deepEqual(catalog.notes.map((note) => note.memoId), ["memo-a", "memo-b"]);
  assert.equal(new Set(catalog.notes.map((note) => note.noteKey)).size, 2);
  assert.ok(catalog.notes.every((note) => note.noteKey !== "legacy-idless"));
  assert.ok(catalog.notes.every((note) => note.quality === null), "legacy scores do not cross the source migration");
});

test("online catalog retains an excluded online identity for later rule changes", () => {
  const body = "这条笔记曾通过质量判断，后来被用户排除。";
  const prior = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-excluded", body }]));
  prior.notes[0].quality = { score: 4, bodyHash: hashBody(body), policyVersion: "1", reason: "历史质量判断" };
  const excludedBody = `${body} #不回顾`;
  const excluded = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-excluded", body: excludedBody }]), { previous: prior });
  assert.equal(excluded.notes.length, 0);
  assert.equal(excluded.excluded[0].reason, "excluded-tag");
  assert.equal(excluded.excluded[0].previousNote.memoId, "memo-excluded");
  assert.equal(excluded.excluded[0].previousNote.noteKey, prior.notes[0].noteKey);
  assert.equal(excluded.excluded[0].previousNote.quality, null, "a body edit invalidates the old score");
  const restored = scanOnlineSnapshot(onlineSnapshot([{ id: "memo-excluded", body }]), { previous: excluded });
  assert.equal(restored.notes[0].noteKey, prior.notes[0].noteKey);
  assert.equal(restored.notes[0].quality, null);
});

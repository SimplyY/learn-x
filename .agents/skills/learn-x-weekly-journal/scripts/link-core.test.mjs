import test from "node:test";
import assert from "node:assert/strict";
import { linkCore, linkCoreRange } from "./link-core.mjs";

const week = "2026-W43";
const anchor = { schemaVersion: 1, week, documentUrl: "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac", documentId: "document123", targetBlockId: "heading123", targetTitle: "10.26", writeDate: "2026-10-26", coverage: { start: "2026-10-19", end: "2026-10-25" } };
const binding = { week, stage: "skeleton", docId: "core1234" };
const slotId = "slot1234";
const placeholder = `<p id="${slotId}">Core 复盘入口（待链接）</p>`;
const wrap = body => `<fragment mode="section" requested-start="heading123"><h2 id="heading123">10.26</h2>${body}<p id="human123">人工内容</p></fragment>`;
const response = body => ({ ok: true, identity: "bot", data: { document: { document_id: "document123", revision_id: 9, content: wrap(body) } } });
const core = async () => ({ ok: true, identity: "bot", data: { document: { document_id: "core1234" } } });
const periodId = "2026-W43-W44";
const rangeAnchor = { schemaVersion: 1, periodId, weeks: ["2026-W43", "2026-W44"], documentUrl: anchor.documentUrl, documentId: "document123", targetBlockId: "heading123", targetTitle: "11.2｜2026-W43—W44（10.19—11.1）", writeDate: "2026-11-02", coverage: { start: "2026-10-19", end: "2026-11-01" } };
const rangeBindings = [{ week: "2026-W43", stage: "skeleton", docId: "core1234" }, { week: "2026-W44", stage: "skeleton", docId: "core5678" }];
const rangeWrap = body => `<fragment mode="section" requested-start="heading123"><h2 id="heading123">11.2｜2026-W43—W44（10.19—11.1）</h2>${body}<table id="table123"><tr><td><p>周记内容</p></td></tr></table></fragment>`;
const rangeResponse = body => ({ ok: true, identity: "bot", data: { document: { document_id: "document123", revision_id: 10, content: rangeWrap(body) } } });
const rangeCore = async id => ({ ok: true, identity: "bot", data: { document: { document_id: id } } });

test("只替换专用占位并核验其他内容；重跑不会再次写", async () => {
  let body = placeholder, writes = 0;
  const opts = { week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body), update: async ({ replacement }) => { writes++; body = replacement.replace("<p>", '<p id="newid123">'); } };
  assert.equal((await linkCore(opts)).result, "written");
  assert.equal((await linkCore(opts)).result, "reused");
  assert.equal(writes, 1);
});

test("链接写入适配器可指向授权的隔离文档并保持锚点绑定", async () => {
  const journalUrl = "https://example.feishu.cn/docx/journal-test123";
  const isolatedAnchor = { ...anchor, documentUrl: journalUrl, documentId: "journal-test123" };
  let body = placeholder;
  const result = await linkCore({
    week, anchor: isolatedAnchor, binding, slotId, journalUrl, fetchCore: core,
    fetchSection: async () => {
      const page = response(body);
      page.data.document.document_id = isolatedAnchor.documentId;
      return page;
    },
    update: async ({ replacement }) => { body = replacement.replace("<p>", '<p id="newid123">'); }
  });
  assert.equal(result.result, "written");
  assert.match(body, /href="https:\/\/ywhome\.feishu\.cn\/docx\/core1234"/);
});

test("占位被人工修改或重复时禁止写入", async () => {
  let writes = 0;
  for (const body of [placeholder.replace("待链接", "本人内容"), placeholder + placeholder]) {
    await assert.rejects(linkCore({ week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body), update: async () => writes++ }));
  }
  assert.equal(writes, 0);
});

test("未知写入只读核验，邻接人工变化不得标成功", async () => {
  let count = 0;
  const href = 'https://ywhome.feishu.cn/docx/core1234';
  const after = `<p id="newid123"><a href="${href}">进入本周 Core 复盘</a></p>`;
  await assert.rejects(linkCore({ week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => { count++; const r = response(count === 1 ? placeholder : after); if (count > 1) r.data.document.content = r.data.document.content.replace("人工内容", "人工变更"); return r; }, update: async () => { throw new Error("timeout"); } }), /journal-readback-conflict/);
});

test("Core 身份或周不匹配时禁止写入", async () => {
  let writes = 0;
  await assert.rejects(linkCore({ week, anchor, binding: { ...binding, week: "2026-W42" }, slotId, fetchCore: core, fetchSection: async () => response(placeholder), update: async () => writes++ }), /week-or-anchor-invalid/);
  assert.equal(writes, 0);
});

test("线上标题日期变化时不得使用旧锚点写入", async () => {
  let writes = 0;
  await assert.rejects(linkCore({ week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => { const r = response(placeholder); r.data.document.content = r.data.document.content.replace("10.26", "10.19"); return r; }, update: async () => writes++ }), /journal-heading-mismatch/);
  assert.equal(writes, 0);
});

test("不得占用表格字段中的同名占位", async () => {
  let writes = 0;
  await assert.rejects(linkCore({ week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(`<table><tr><td>${placeholder}</td></tr></table>`), update: async () => writes++ }), /reserved-slot-not-after-heading/);
  assert.equal(writes, 0);
});

test("正文中已有同一链接时不得误判周记入口已就位", async () => {
  const link = '<p id="newid123"><a href="https://ywhome.feishu.cn/docx/core1234">进入本周 Core 复盘</a></p>';
  let writes = 0;
  await assert.rejects(linkCore({ week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(`<p id="human456">其他内容</p>${link}`), update: async () => writes++ }), /link-not-after-heading/);
  assert.equal(writes, 0);
});

test("超时后持久意图保留；下次复读唯一占位后安全重试", async () => {
  let saved = null, writes = 0, body = placeholder;
  const opts = { week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body),
    loadIntent: async () => saved, saveIntent: async intent => { saved = intent; }, clearIntent: async () => { saved = null; },
    update: async ({ replacement }) => { writes++; if (writes === 1) throw new Error("timeout"); body = replacement.replace("<p>", '<p id="newid123">'); } };
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  assert.equal((await linkCore(opts)).result, "recovered");
  assert.equal(writes, 2);
  assert.equal((await linkCore(opts)).result, "reused");
  assert.equal(saved, null);
});

test("旧请求在安全重试前落地时只保留一个链接", async () => {
  let saved = null, writes = 0, body = placeholder;
  const href = 'https://ywhome.feishu.cn/docx/core1234';
  const replacement = `<p id="newid123"><a href="${href}">进入本周 Core 复盘</a></p>`;
  const opts = { week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body),
    loadIntent: async () => saved, saveIntent: async intent => { saved = intent; }, clearIntent: async () => { saved = null; },
    update: async ({ replacement: next }) => {
      writes++;
      if (writes === 1) throw new Error("timeout");
      body = replacement; // The first request completed late; the retry targets the consumed slot.
      throw new Error("block-not-found");
    } };
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  assert.equal((await linkCore(opts)).result, "recovered");
  assert.equal((body.match(/href=/g) ?? []).length, 1);
  assert.equal(writes, 2);
  assert.equal(saved, null);
});

test("未知结果后周记其他位置被编辑时，只更新仍未改变的安全占位", async () => {
  let saved = null, writes = 0, changed = false, body = placeholder;
  const opts = { week, anchor, binding, slotId, fetchCore: core,
    fetchSection: async () => { const r = response(body); if (changed) r.data.document.content = r.data.document.content.replace("人工内容", "人工修改"); return r; },
    loadIntent: async () => saved, saveIntent: async intent => { saved = intent; }, clearIntent: async () => { saved = null; },
    update: async ({ replacement }) => { writes++; if (writes === 1) throw new Error("timeout"); body = replacement.replace("<p>", '<p id="newid123">'); changed = true; } };
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  changed = true;
  assert.equal((await linkCore(opts)).result, "recovered");
  assert.equal(writes, 2);
  assert.equal(saved, null);
});

test("范围周记在唯一标题后插入每周 Core 链接，读回后复用且保留正文", async () => {
  let body = "", writes = 0, receipt;
  const opts = {
    periodId, anchor: rangeAnchor, bindings: rangeBindings,
    fetchCore: rangeCore,
    fetchSection: async () => rangeResponse(body),
    update: async ({ content }) => { writes += 1; body = content.replaceAll("<p>", '<p id="inserted123">'); },
    persistVerification: async value => { receipt = value; }
  };
  const written = await linkCoreRange(opts);
  assert.equal(written.result, "written");
  assert.equal(writes, 1);
  assert.match(body, /href="https:\/\/ywhome\.feishu\.cn\/docx\/core1234">进入 2026-W43 Core 复盘/);
  assert.match(body, /href="https:\/\/ywhome\.feishu\.cn\/docx\/core5678">进入 2026-W44 Core 复盘/);
  assert.deepEqual(receipt.links.map(item => item.week), ["2026-W43", "2026-W44"]);
  assert.equal((await linkCoreRange(opts)).result, "reused");
  assert.equal(writes, 1);
});

test("范围链接已有部分内容时不写入，避免重复或猜测补齐", async () => {
  const first = '<p><a href="https://ywhome.feishu.cn/docx/core1234">进入 2026-W43 Core 复盘</a></p>';
  let writes = 0;
  await assert.rejects(linkCoreRange({
    periodId, anchor: rangeAnchor, bindings: rangeBindings, fetchCore: rangeCore,
    fetchSection: async () => rangeResponse(first), update: async () => { writes += 1; }
  }), /range-links-partial-or-ambiguous/);
  assert.equal(writes, 0);
});

test("范围链接未知写入只读核验且不会自动重发", async () => {
  let intent = null, writes = 0;
  const opts = {
    periodId, anchor: rangeAnchor, bindings: rangeBindings, fetchCore: rangeCore,
    fetchSection: async () => rangeResponse(""),
    saveIntent: async value => { intent = value; }, loadIntent: async () => intent,
    clearIntent: async () => { intent = null; },
    update: async () => { writes += 1; throw new Error("timeout"); }
  };
  await assert.rejects(linkCoreRange(opts), /range-link-write-unknown/);
  await assert.rejects(linkCoreRange(opts), /range-link-write-unknown/);
  assert.equal(writes, 1);
  assert.ok(intent);
});

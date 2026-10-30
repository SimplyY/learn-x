import test from "node:test";
import assert from "node:assert/strict";
import { linkCore } from "./link-core.mjs";

const week = "2026-W43";
const anchor = { schemaVersion: 1, week, documentUrl: "https://ywhome.feishu.cn/wiki/EOlbwTVLyiQp7Fkrr9ucdI9hnac", documentId: "document123", targetBlockId: "heading123", targetTitle: "10.26", writeDate: "2026-10-26", coverage: { start: "2026-10-19", end: "2026-10-25" } };
const binding = { week, stage: "skeleton", docId: "core1234" };
const slotId = "slot1234";
const placeholder = `<p id="${slotId}">Core 复盘入口（待链接）</p>`;
const wrap = body => `<fragment mode="section" requested-start="heading123"><h2 id="heading123">10.26</h2>${body}<p id="human123">人工内容</p></fragment>`;
const response = body => ({ ok: true, identity: "bot", data: { document: { document_id: "document123", revision_id: 9, content: wrap(body) } } });
const core = async () => ({ ok: true, identity: "bot", data: { document: { document_id: "core1234" } } });

test("只替换专用占位并核验其他内容；重跑不会再次写", async () => {
  let body = placeholder, writes = 0;
  const opts = { week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body), update: async ({ replacement }) => { writes++; body = replacement.replace("<p>", '<p id="newid123">'); } };
  assert.equal((await linkCore(opts)).result, "written");
  assert.equal((await linkCore(opts)).result, "reused");
  assert.equal(writes, 1);
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

test("超时后持久意图保留；后续只读核验，不盲目再次写入", async () => {
  let saved = null, writes = 0, body = placeholder;
  const opts = { week, anchor, binding, slotId, fetchCore: core, fetchSection: async () => response(body),
    loadIntent: async () => saved, saveIntent: async intent => { saved = intent; }, clearIntent: async () => { saved = null; },
    update: async () => { writes++; throw new Error("timeout"); } };
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  assert.equal(writes, 1);
  body = '<p id="newid123"><a href="https://ywhome.feishu.cn/docx/core1234">进入本周 Core 复盘</a></p>';
  assert.equal((await linkCore(opts)).result, "recovered");
  assert.equal(saved, null);
});

test("未知结果后原占位仍在但周围人工内容变化时报告冲突，不重写", async () => {
  let saved = null, writes = 0, changed = false;
  const opts = { week, anchor, binding, slotId, fetchCore: core,
    fetchSection: async () => { const r = response(placeholder); if (changed) r.data.document.content = r.data.document.content.replace("人工内容", "人工修改"); return r; },
    loadIntent: async () => saved, saveIntent: async intent => { saved = intent; }, clearIntent: async () => { saved = null; },
    update: async () => { writes++; throw new Error("timeout"); } };
  await assert.rejects(linkCore(opts), /link-write-unknown/);
  changed = true;
  await assert.rejects(linkCore(opts), /journal-readback-conflict/);
  assert.equal(writes, 1);
  assert.ok(saved);
});

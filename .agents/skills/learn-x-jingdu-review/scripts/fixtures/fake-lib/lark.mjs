// fake-lib/lark：与实装 lark.mjs 契约同形（参数名对齐：doc/docFormat/contentPath/markdown/idempotencyKey）。
// 状态：config.__fakeState 注入对象，或 JINGDU_FAKE_LARK_STATE 指向的状态文件。
// 失败注入：state.createFailures（createDoc 前 N 次抛错）、state.dropLines（markdown 回读时删除含该文本的行）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = () => ({ docs: {}, messages: [], counters: { doc: 0, message: 0 }, createFailures: 0, dropLines: [] });

async function loadState(config) {
  if (config?.__fakeState) return config.__fakeState;
  const file = process.env.JINGDU_FAKE_LARK_STATE;
  if (!file) return EMPTY_STATE();
  try {
    return { ...EMPTY_STATE(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return EMPTY_STATE();
    throw error;
  }
}

async function saveState(config, state) {
  if (config?.__fakeState) return;
  const file = process.env.JINGDU_FAKE_LARK_STATE;
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}

export function xmlToMarkdown(xml) {
  return String(xml)
    .replace(/<title>(.*?)<\/title>/g, "# $1")
    .replace(/<h1>(.*?)<\/h1>/g, "# $1")
    .replace(/<h2>(.*?)<\/h2>/g, "## $1")
    .replace(/<\/td><td>/g, " | ")
    .replace(/<\/(?:p|tr|table|h1|h2)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createRunner(config = {}) {
  const tokenOf = (doc) => String(doc ?? "").match(/(?:docx|wiki|doc)\/([A-Za-z0-9]+)/)?.[1] ?? String(doc ?? "").match(/^doc[A-Za-z0-9]+$/)?.[0] ?? null;

  return {
    async createDoc({ title, contentPath, docFormat = "xml" }) {
      const state = await loadState(config);
      const serial = ++state.counters.doc;
      if (state.createFailures > 0) {
        state.createFailures -= 1;
        await saveState(config, state);
        throw new Error("fake lark: createDoc failure (injected)");
      }
      const content = String(await readFile(contentPath, "utf8"));
      const docToken = `docFAKE${String(serial).padStart(3, "0")}`;
      const docUrl = `https://example.feishu.cn/docx/${docToken}`;
      state.docs[docToken] = { title, xml: docFormat === "xml" ? content : content, revision: 1 };
      await saveState(config, state);
      return { ok: true, data: { url: docUrl, token: docToken, revision: 1 } };
    },

    async fetchDoc({ doc, docFormat = "markdown" }) {
      const state = await loadState(config);
      const docEntry = state.docs[tokenOf(doc)];
      if (!docEntry) throw new Error(`fake lark: doc not found: ${doc}`);
      if (docFormat === "xml") return { xml: docEntry.xml, revision: docEntry.revision };
      let markdown = xmlToMarkdown(docEntry.xml);
      if (state.dropLines.length) {
        markdown = markdown.split("\n").filter((line) => !state.dropLines.some((needle) => line.includes(needle))).join("\n");
      }
      return { markdown, revision: docEntry.revision };
    },

    async updateDoc({ doc, command, contentPath, docFormat = "xml" }) {
      const state = await loadState(config);
      const docEntry = state.docs[tokenOf(doc)];
      if (!docEntry) throw new Error(`fake lark: doc not found: ${doc}`);
      if (contentPath) {
        const content = await readFile(contentPath, "utf8");
        if (docFormat === "xml") docEntry.xml = content; else docEntry.markdown = content;
      }
      docEntry.revision += 1;
      await saveState(config, state);
      return { ok: true, data: { revision: docEntry.revision, command } };
    },

    async parseDoc() { throw new Error("fake lark: parseDoc not exercised"); },
    async parseContent() { throw new Error("fake lark: parseContent not exercised"); },

    async sendChatMessage({ chatId, markdown }) {
      const state = await loadState(config);
      const serial = ++state.counters.message;
      const message = { messageId: `omFAKE${String(serial).padStart(3, "0")}`, chatId, text: markdown, senderType: "bot", at: new Date().toISOString() };
      state.messages.push(message);
      await saveState(config, state);
      return { ok: true, data: { messageId: message.messageId } };
    },

    async replyChatMessage({ messageId, markdown }) {
      const state = await loadState(config);
      const serial = ++state.counters.message;
      const message = { messageId: `omFAKE${String(serial).padStart(3, "0")}`, chatId: "oc_faketest0000000000000000000000", replyTo: messageId, text: markdown, senderType: "bot", at: new Date().toISOString() };
      state.messages.push(message);
      await saveState(config, state);
      return { ok: true, data: { messageId: message.messageId } };
    },

    async listChatMessages({ chatId, pageSize = 50 } = {}) {
      const state = await loadState(config);
      const items = state.messages.filter((message) => !chatId || message.chatId === chatId).slice(-pageSize);
      return { items };
    },

    async nodeList() { return { items: [] }; },
    async nodeCreate() { throw new Error("fake lark: nodeCreate not exercised"); }
  };
}

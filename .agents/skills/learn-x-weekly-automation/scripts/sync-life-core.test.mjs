import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractLifeCoreBody, parseMirror, sha256, syncLifeCore } from "./sync-life-core.mjs";

const body = (suffix = "") => `# 长期核心议题\n\n长期判断：守住自己的火，用光照见真实世界，像河流一样进入现实、滋养他人，在行动、反馈与修正中不断生长。${suffix}\n\n# 中期核心议题\n\n中期判断：教育、投资与 AI 三条线都需要真实样本与外部反馈，先验证活法，再谈规模。\n\n# 短期核心议题\n\n短期优先级：P0 复盘闭环，P1 真实聊天，P2 公众号输出。`;
const baseRoot = async () => mkdtemp(path.join(os.tmpdir(), "learn-x-life-core-"));

test("四类 fixture：附录截断边界、正常正文、异常标题、资源块", async (t) => {
  // 有附录：附录内容永远不得进入镜像，本轮 stale 保留旧正文。
  const withAppendix = extractLifeCoreBody(`${body()}\n\n# 附录一：武汉\n\n附录内容\n\n<sheet token="x"/>`);
  assert.equal(withAppendix.error, "appendix-present");
  assert.equal(withAppendix.appendixTitle, "# 附录一：武汉");
  // 无附录：正常 fresh。
  const ok = extractLifeCoreBody(body());
  assert.equal(ok.error, undefined);
  assert.ok(ok.body.startsWith("# 长期核心议题"));
  // 异常标题：缺少核心一级标题。
  assert.match(extractLifeCoreBody("# 长期核心议题\n\n只有一段。").error, /missing-core-headings/);
  // 资源块：未展开 Sheet 不得落盘。
  assert.equal(extractLifeCoreBody(`${body()}\n\n<bitable token="y"/>`).error, "unexpanded-resource-block");
});

test("同步成功写入 fresh 头并支持幂等重读", async (t) => {
  const root = await baseRoot(); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const runLark = async () => { calls += 1; return { markdown: body(), revision: 242 }; };
  const first = await syncLifeCore({ repoRoot: root, runLark });
  assert.equal(first.status, "fresh");
  const raw = await readFile(path.join(root, "01_core/道/人生核心议题.md"), "utf8");
  const { header, body: mirrorBody } = parseMirror(raw);
  assert.equal(header.revision, "242");
  assert.equal(header.status, "fresh");
  assert.equal(header["body-sha256"], sha256(body().replace(/[\s`*_>#\-~]+/g, "")));
  assert.ok(mirrorBody.includes("短期优先级"));
  const second = await syncLifeCore({ repoRoot: root, runLark });
  assert.equal(second.status, "fresh");
  assert.equal(calls, 2);
});

test("同步失败保留最后有效正文并标记 stale；首次失败不伪造文件", async (t) => {
  const root = await baseRoot(); t.after(() => rm(root, { recursive: true, force: true }));
  const fail = async () => { throw new Error("ego-bootstrap-permission"); };
  const firstFailure = await syncLifeCore({ repoRoot: root, runLark: fail });
  assert.equal(firstFailure.status, "failed");
  assert.equal(firstFailure.wrote, false);
  await assert.rejects(readFile(path.join(root, "01_core/道/人生核心议题.md"), "utf8"));
  await syncLifeCore({ repoRoot: root, runLark: async () => ({ markdown: body(), revision: 1 }) });
  const rawBefore = await readFile(path.join(root, "01_core/道/人生核心议题.md"), "utf8");
  const stale = await syncLifeCore({ repoRoot: root, runLark: fail });
  assert.equal(stale.status, "stale");
  assert.equal(stale.wrote, true);
  const { header, body: mirrorBody } = parseMirror(await readFile(path.join(root, "01_core/道/人生核心议题.md"), "utf8"));
  assert.equal(header.status, "stale");
  assert.ok(header["last-attempt-at"]);
  assert.equal(mirrorBody, parseMirror(rawBefore).body);
  // 结构异常（附录回归）同样走 stale 路径。
  const appendixBack = await syncLifeCore({ repoRoot: root, runLark: async () => ({ markdown: `${body()}\n\n# 附录二：清单`, revision: 2 }) });
  assert.equal(appendixBack.status, "stale");
  assert.equal(appendixBack.reason, "appendix-present");
});

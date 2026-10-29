// 测试脚手架：临时仓库 + 注入 fake deps（与 Slice A 契约同形，见 fixtures/fake-lib）。
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fsafe from "../fixtures/fake-lib/fsafe.mjs";
import * as lock from "../fixtures/fake-lib/lock.mjs";
import * as records from "../fixtures/fake-lib/records.mjs";
import * as idempotency from "../fixtures/fake-lib/idempotency.mjs";
import * as lark from "../fixtures/fake-lib/lark.mjs";
import * as parseSession from "../fixtures/fake-lib/parse-record.mjs";
import * as changeset from "../fixtures/fake-lib/changeset.mjs";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES_DIR = path.join(SKILL_DIR, "scripts", "fixtures");
export const FAKE_LIB_DIR = path.join(FIXTURES_DIR, "fake-lib");
export const WEEK = "2026-W42";
export const CONFIG = { present: true, chatId: "oc_faketest0000000000000000000000", parseTimeoutMs: 1000, docTitleTemplate: "精读｜{week}" };

export async function createTestRepo(t, { wereadFixture = "weread-week.md" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-jingdu-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "repo");
  const skillDir = path.join(root, "skill");
  const weekRoot = path.join(repoRoot, "03_input", "weekly", WEEK);
  await mkdir(weekRoot, { recursive: true });
  await mkdir(skillDir, { recursive: true });
  await copyFile(path.join(FIXTURES_DIR, wereadFixture), path.join(weekRoot, "weread.md"));
  await copyFile(path.join(FIXTURES_DIR, "ai-week.md"), path.join(weekRoot, "ai.md"));
  await writeFile(path.join(weekRoot, "_source-status.json"), JSON.stringify({
    version: 1,
    week: WEEK,
    updatedAt: "2026-10-19T12:08:37.647Z",
    sources: {
      weread: { status: "ready", file: "weread.md", count: 5, summary: "本周有阅读活动", updatedAt: "2026-10-19T12:08:37.647Z", preservedStaleFile: false }
    }
  }, null, 2));
  return { root, repoRoot, skillDir, weekRoot, runtime: (name) => path.join(skillDir, "runtime", WEEK, name) };
}

export function makeDeps({ larkState, parseJson } = {}) {
  return {
    fsafe, lock, records, idempotency,
    lark: { createRunner: (config) => lark.createRunner({ ...config, __fakeState: larkState }) },
    parseSession: parseJson
      ? { runParseSession: async (input) => ({ raw: JSON.stringify(parseJson), messageText: "injected parse", json: parseJson, meta: { ...input, fake: true } }) }
      : parseSession,
    changeset
  };
}

export function makeContextOptions({ repo, deps, now, sourceStatus, config = CONFIG } = {}) {
  return {
    repoRoot: repo.repoRoot,
    skillRoot: repo.skillDir,
    config,
    deps,
    ...(now ? { now: () => now } : {}),
    ...(sourceStatus ? { sourceStatus } : {})
  };
}

// 构造符合 changeset schema 的变更集（items[]/ambiguous[]，字段与 Slice A 实装契约同形）。
export function makeChangeset(items, { ambiguous = [] } = {}) {
  return {
    version: 1,
    business: "jingdu",
    week: WEEK,
    docUrl: "https://example.feishu.cn/docx/docFAKE001",
    reviewContentSha256: null,
    items: items.map((item, index) => ({
      itemId: `it-${index + 1}`,
      kind: item.kind,
      sourceBlockIds: ["blk-fake-1"],
      quote: item.originalValue ?? item.newValue ?? "",
      userEvidence: {
        type: item.kind === "added" ? "new-text" : item.kind === "endorsed" ? "endorsement-mark" : "edited-text",
        detail: "测试注入"
      },
      targetHint: item.targetHint ?? `jingdu#${item.target.book}/${item.target.chapter}/${item.target.summary}#思考`,
      originalValue: item.originalValue ?? null,
      newValue: item.newValue ?? null,
      confidence: "high",
      reason: item.note ?? "测试注入"
    })),
    ambiguous,
    notes: ""
  };
}

// 模拟用户在手机上编辑了飞书文档（直接改 fake lark 状态里的 XML）。
export function mutateDoc(larkState, docToken, appendXml) {
  const entry = larkState.docs[docToken];
  if (!entry) throw new Error(`fake lark: doc not found: ${docToken}`);
  entry.xml = `${entry.xml}\n${appendXml}`;
  entry.revision += 1;
}

export const HIGHLIGHT_1 = "长期主义者并不预测波动，而是让自己的资产负债表能够承受波动。";
export const HIGHLIGHT_2 = "复利的敌人不是回撤，而是中断。";
export const HIGHLIGHT_3 = "风险不是波动本身，而是你在波动中被迫行动的程度。";
export const HIGHLIGHT_4 = "密度带来分工，分工带来创意，这是城市最重要的产出函数。";
export const HIGHLIGHT_5 = "把人吸引来，还要留得住：居住、通勤与公共服务的三角决定了留存率。";

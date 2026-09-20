import assert from "node:assert/strict";
import test from "node:test";
import { buildInputAuditRows, compressWeeklyProcessItems, renderInputAuditTable, renderProcessPack } from "./generate-weekly-process-pack.mjs";

test("weekly Process Pack 明确把独立 Action Feedback 一并交给 AI Chat", () => {
  const pack = renderProcessPack({
    week: "2026-W37",
    range: { start: "2026-09-14T00:00:00.000Z", end: "2026-09-20T23:59:59.999Z" },
    selection: { path: "03_input/weekly/2026-W37", mode: "iso" },
    generatedAt: "2026-09-19T00:00:00.000Z",
    stats: { fileCount: 0, itemCount: 0, uniqueItemCount: 0, duplicateCount: 0, excludedFileCount: 0 },
    sourceStatuses: {},
    files: [],
    excludedFiles: []
  }, [], [], [], { sourceCount: 0, files: [] });

  assert.match(pack, /与同目录 `action-feedback\.md` 一并交给 AI Chat/);
  assert.doesNotMatch(pack, /常规只把本文件交给 AI Chat/);
});

test("compresses Voice-X once at Process Pack time and reports the overall ratio", () => {
  const source = [
    "# Voice-X 核心重点｜2026-W36", "", "## with 测试", "",
    "## 核心总结", "", "关键事实与行动反馈。".repeat(500), "",
    "## 芒格之魂洞察", "", "核心判断与风险边界。".repeat(300)
  ].join("\n");
  const input = { path: "03_input/weekly/2026-W36/voice.md", text: source };
  const result = compressWeeklyProcessItems([input]);
  assert.equal(input.text, source);
  assert.notEqual(result.items[0].text, source);
  assert.ok(result.compression.outputChars < result.compression.sourceChars);
  assert.ok(result.compression.retainedRatio <= 0.25);
  assert.equal(result.compression.targetRetainedRatio, 0.2);
});

test("renders one fixed input audit table with failures and compression", () => {
  const payload = {
    week: "2026-W36",
    selection: { path: "03_input/weekly/2026-W36" },
    sourceStatuses: {
      daily: { status: "ready", file: "daily.md", count: 2, summary: "有日记" },
      flomo: { status: "failed", file: "flomo.md", count: 0, summary: "采集失败：页面不可用", preservedStaleFile: true },
      voice: { status: "ready", file: "voice.md", count: 1, summary: "有洞察" },
      coach: { status: "empty", file: "coach.md", count: 0, summary: "本周 0 条记录，文件未生成", preservedStaleFile: false },
      "build-bot": { status: "unavailable", file: "build-bot.md", count: 0, summary: "机器人侧未完成", preservedStaleFile: false }
    },
    excludedFiles: [{ file: "flomo.md", present: true }]
  };
  const files = [
    { path: "03_input/weekly/2026-W36/daily.md", source: "daily", itemCount: 2, rawChars: 100, effectiveChars: 90, processChars: 90 },
    { path: "03_input/weekly/2026-W36/voice.md", source: "voice", itemCount: 1, rawChars: 1000, effectiveChars: 1000, processChars: 220 }
  ];
  const compression = { files: [{ path: files[1].path, sourceChars: 1000, candidateChars: 220, retainedRatio: 0.22 }] };
  const rows = buildInputAuditRows(payload, files, compression);
  const table = renderInputAuditTable(payload, files, compression);

  assert.equal(rows[0].file, "daily.md");
  assert.equal(rows.find((row) => row.file === "flomo.md").status, "failed");
  assert.match(table, /\| 输入类型 \| 来源 \| 文件 \| 状态 \|/);
  assert.match(table, /字符链路（原始 → 纳入）/);
  assert.match(table, /采集失败：页面不可用/);
  assert.match(table, /1000 → 220（Voice-X 压缩，保留 22%）/);
  assert.doesNotMatch(table, /仅确定性清洗|未做语义压缩/);
  assert.match(table, /build-bot\.md \| unavailable/);
  assert.match(table, /旧文件保留但过期、不计入/);
  assert.match(table, /wisdom\.md \| 未发现/);
  assert.match(table, /本轮需关注：.*Flomo（flomo\.md：failed）/);
  assert.doesNotMatch(table, /本轮需关注：.*微信聊天/);
  assert.match(table, /wechat\.md \| 未发现/);
  assert.match(table, /\]\(learnx:\/\/03_input%2Fweekly%2F2026-W36%2Fdaily\.md\)/);
});

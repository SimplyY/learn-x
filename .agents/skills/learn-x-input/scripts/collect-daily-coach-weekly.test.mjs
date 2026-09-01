import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDailyCoachWeekly, isCoachReviewRecord, shouldWriteCoachFile } from "./collect-daily-coach-weekly.mjs";

test("identifies Coach review updates without excluding ordinary new records", () => {
  assert.equal(isCoachReviewRecord({ "已推送轮次": 3, "回顾状态": "进行中", "上次推送时间": "2026-08-03 09:00:53" }), true);
  assert.equal(isCoachReviewRecord({ "已推送轮次": "", "回顾状态": "", "上次推送时间": "" }), false);
  assert.equal(isCoachReviewRecord({ "已推送轮次": 0, "回顾状态": "待回顾", "上次推送时间": "" }), false);
});

test("does not write Coach input when every table has zero retained records", () => {
  assert.equal(shouldWriteCoachFile({ tables: { "服务对象": { records: [] }, "项目": { records: [] } } }), false);
  assert.equal(shouldWriteCoachFile({ tables: { "服务对象": { records: [{ values: { 姓名: "新对象" } }] } } }), true);
});

test("daily and Coach collectors preserve old files on empty and mark ready on records", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-daily-coach-status-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const dailyPath = path.join(outputRoot, "daily.md");
  const coachPath = path.join(outputRoot, "coach.md");
  await writeFile(dailyPath, "old daily\n", "utf8");
  await writeFile(coachPath, "old coach\n", "utf8");

  const fakeRun = createFakeRun({ dailyRecords: [], coachRecords: [] });
  const empty = await collectDailyCoachWeekly({ week: "2026-W24", outputRoot, runCli: fakeRun });
  assert.equal(empty.daily.records.length, 0);
  assert.equal(await readFile(dailyPath, "utf8"), "old daily\n");
  assert.equal(await readFile(coachPath, "utf8"), "old coach\n");
  const emptyStatus = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(emptyStatus.sources.daily.status, "empty");
  assert.equal(emptyStatus.sources.coach.status, "empty");

  const ready = await collectDailyCoachWeekly({
    week: "2026-W24",
    outputRoot,
    runCli: createFakeRun({
      dailyRecords: [{ 日期: "2026-06-08 09:00:00", "今日饮食": 4, "今日运动": 5, "今日心情（允许万物穿过自己）": 6, "核心事项（语音输入，写清楚时间、地点、人）": "有实质日记记录" }],
      coachRecords: [{ "创建时间": "2026-06-08 10:00:00", 姓名: "新对象" }]
    })
  });
  assert.equal(ready.daily.records.length, 1);
  const readyStatus = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(readyStatus.sources.daily.status, "ready");
  assert.equal(readyStatus.sources.coach.status, "ready");
  assert.match(await readFile(dailyPath, "utf8"), /有实质日记记录/);
  assert.match(await readFile(dailyPath, "utf8"), /今日饮食：4/);
  assert.match(await readFile(dailyPath, "utf8"), /今日运动：5/);
  assert.match(await readFile(dailyPath, "utf8"), /今日心情（允许万物穿过自己）：6/);
  assert.match(await readFile(coachPath, "utf8"), /新对象/);
  assert.ok((await readdir(outputRoot)).includes("_source-status.json"));
});

test("daily and Coach collector failures preserve old files and mark both failed", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-daily-coach-fail-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(path.join(outputRoot, "daily.md"), "old daily\n", "utf8");
  await writeFile(path.join(outputRoot, "coach.md"), "old coach\n", "utf8");
  await assert.rejects(
    collectDailyCoachWeekly({ week: "2026-W24", outputRoot, runCli: async () => { throw new Error("query failed"); } }),
    /query failed/
  );
  assert.equal(await readFile(path.join(outputRoot, "daily.md"), "utf8"), "old daily\n");
  assert.equal(await readFile(path.join(outputRoot, "coach.md"), "utf8"), "old coach\n");
  const status = JSON.parse(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"));
  assert.equal(status.sources.daily.status, "failed");
  assert.equal(status.sources.coach.status, "failed");
});

function createFakeRun({ dailyRecords, coachRecords }) {
  return async (args) => {
    if (args[1] === "+url-resolve") return { ok: true, data: { base_token: args[3].includes("WPZR") ? "daily-base" : "coach-base" } };
    if (args[1] === "+base-block-list") {
      return { ok: true, data: { blocks: args[3] === "daily-base" ? [{ name: "日记", id: "daily-table" }] : ["服务对象", "服务记录", "ai coach thinking", "项目"].map((name) => ({ name, id: name })) } };
    }
    if (args[1] === "+field-list") return { ok: true, data: { fields: args.includes("daily-table") ? ["日期", "今日饮食", "今日运动", "今日心情（允许万物穿过自己）", "核心事项（语音输入，写清楚时间、地点、人）", "明日规划", "最喜悦的事", "思考&收获&洞察&幽默"].map((name) => ({ name })) : ["姓名", "优先级", "创建时间", "更新时间", "日期", "服务内容", "服务资料", "核心图", "主题", "核心思考", "已推送轮次", "回顾状态", "上次推送时间", "超链接", "附件", "项目名", "状态", "项目类型", "备注", "产出链接", "阻塞与风险", "当前阶段", "下一步", "当前方案"].map((name) => ({ name })) } };
    if (args[1] === "+record-list") {
      const table = args[args.indexOf("--table-id") + 1];
      const source = table === "daily-table" ? dailyRecords : table === "服务对象" ? coachRecords : [];
      const fields = args.flatMap((value, index) => value === "--field-id" ? [args[index + 1]] : []);
      return { ok: true, data: { fields, data: source.map((record) => fields.map((field) => record[field] || "")), record_id_list: source.map((_record, index) => `record-${index}`), has_more: false } };
    }
    throw new Error(`unexpected fake command: ${args.join(" ")}`);
  };
}

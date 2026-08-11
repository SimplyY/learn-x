import assert from "node:assert/strict";
import test from "node:test";
import { isCoachReviewRecord } from "./collect-daily-coach-weekly.mjs";

test("identifies Coach review updates without excluding ordinary new records", () => {
  assert.equal(isCoachReviewRecord({ "已推送轮次": 3, "回顾状态": "进行中", "上次推送时间": "2026-08-03 09:00:53" }), true);
  assert.equal(isCoachReviewRecord({ "已推送轮次": "", "回顾状态": "", "上次推送时间": "" }), false);
  assert.equal(isCoachReviewRecord({ "已推送轮次": 0, "回顾状态": "待回顾", "上次推送时间": "" }), false);
});

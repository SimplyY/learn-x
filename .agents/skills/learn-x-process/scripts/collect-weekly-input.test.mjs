import assert from "node:assert/strict";
import test from "node:test";
import { defaultWeeklyReviewWeek } from "./collect-weekly-input.mjs";

test("defaults weekly review to previous week on weekdays and current week on weekends", () => {
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-03T04:00:00Z")), "2026-W26");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-04T04:00:00Z")), "2026-W27");
  assert.equal(defaultWeeklyReviewWeek(new Date("2026-07-06T04:00:00Z")), "2026-W27");
});

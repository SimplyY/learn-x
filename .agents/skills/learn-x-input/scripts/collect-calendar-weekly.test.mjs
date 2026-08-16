import assert from "node:assert/strict";
import test from "node:test";
import { collectCalendarWeekly, renderCalendarMarkdown } from "./collect-calendar-weekly.mjs";

test("summarizes Time-X calendar tags and keeps safe event fields", async () => {
  const payload = await collectCalendarWeekly({
    week: "2026-W24",
    generatedAt: "2026-06-15T00:00:00.000Z",
    getAgenda: async () => [{
      summary: "【健康】【关系】私人标题",
      start_time: { datetime: "2026-06-08T09:00:00+08:00" },
      end_time: { datetime: "2026-06-08T10:00:00+08:00" }
    }]
  });
  assert.equal(payload.calendar.weeklyMinutes, 60);
  assert.equal(payload.calendar.categories.健康.minutes, 60);
  assert.equal(payload.calendar.categories.关系.minutes, 60);
  assert.deepEqual(payload.calendar.details[0], {
    date: "2026-06-08",
    start: "2026-06-08 09:00:00",
    end: "2026-06-08 10:00:00",
    title: "【健康】【关系】私人标题",
    description: ""
  });
  const markdown = renderCalendarMarkdown(payload);
  assert.match(markdown, /【健康】1 小时/);
  assert.match(markdown, /详细时间/);
  assert.match(markdown, /私人标题/);
  assert.doesNotMatch(markdown, /RSVP|忙闲|可见性|会议类型|accept|busy|no_meeting/);
});

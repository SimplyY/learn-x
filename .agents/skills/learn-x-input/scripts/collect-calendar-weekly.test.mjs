import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCalendarWeekly, dedupePhysicalEvents, renderCalendarMarkdown, writeCalendarWeekly } from "./collect-calendar-weekly.mjs";

const WEEK = "2026-W24";
const GENERATED_AT = "2026-06-15T00:00:00.000Z";

function timedEvent(id, start, end, summary = "写周记", calendarId = "calendar-a") {
  return {
    calendar_id: calendarId,
    event_id: id,
    summary,
    start_time: { datetime: `${start}+08:00` },
    end_time: { datetime: `${end}+08:00` },
    description: `${summary} 原文`
  };
}

function allDayEvent(id, date, summary = "【生活】全天事项", calendarId = "calendar-a") {
  return {
    calendar_id: calendarId,
    event_id: id,
    summary,
    start_time: { date },
    end_time: { date },
    description: "全天原文"
  };
}

async function collect(events) {
  return collectCalendarWeekly({
    week: WEEK,
    generatedAt: GENERATED_AT,
    getAgenda: async () => events
  });
}

test("summarizes tags, preserves source fields, and adds effective minutes", async () => {
  const payload = await collect([timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "【健康】【关系】私人标题")]);
  assert.equal(payload.calendar.weeklyMinutes, 60);
  assert.equal(payload.calendar.categories.健康.minutes, 60);
  assert.equal(payload.calendar.categories.关系.minutes, 60);
  assert.deepEqual(payload.calendar.details[0], {
    date: "2026-06-08",
    start: "2026-06-08 09:00:00",
    end: "2026-06-08 10:00:00",
    originalStart: "2026-06-08 09:00:00",
    originalEnd: "2026-06-08 10:00:00",
    title: "【健康】【关系】私人标题",
    description: "【健康】【关系】私人标题 原文",
    effectiveMinutes: 60,
    eventIndex: 0,
    dayIndex: 0
  });
  const markdown = renderCalendarMarkdown(payload);
  assert.match(markdown, /【健康】1 小时/);
  assert.match(markdown, /有效投入/);
  assert.match(markdown, /私人标题/);
  assert.doesNotMatch(markdown, /event-1|calendar-a/);
});

test("keeps non-overlapping events as separate full allocations", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "相同标题"),
    timedEvent("event-2", "2026-06-08T11:00:00", "2026-06-08T12:00:00", "相同标题")
  ]);
  assert.equal(payload.calendar.weeklyMinutes, 120);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [60, 60]);
});

test("splits identical-time events by the number of active events", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "相同标题"),
    timedEvent("event-2", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "相同标题")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 60);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [30, 30]);
});

test("keeps events without identifiers independent", async () => {
  const first = timedEvent(undefined, "2026-06-08T09:00:00", "2026-06-08T10:00:00", "无标识事项");
  const second = timedEvent(undefined, "2026-06-08T09:00:00", "2026-06-08T10:00:00", "无标识事项");
  delete first.calendar_id;
  delete first.event_id;
  delete second.calendar_id;
  delete second.event_id;
  const payload = await collect([first, second]);
  assert.equal(payload.calendar.details.length, 2);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [30, 30]);
});

test("splits only the overlapping portion", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T11:00:00", "甲"),
    timedEvent("event-2", "2026-06-08T10:00:00", "2026-06-08T12:00:00", "乙")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 180);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [90, 90]);
});

test("splits three simultaneous events into thirds and conserves the day total", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "甲"),
    timedEvent("event-2", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "乙"),
    timedEvent("event-3", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "丙")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 60);
  assert.equal(payload.calendar.details.reduce((total, detail) => total + detail.effectiveMinutes, 0), payload.calendar.daily[0].minutes);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [20, 20, 20]);
});

test("splits overlapping events regardless of title similarity", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "完全不同的标题"),
    timedEvent("event-2", "2026-06-08T09:30:00", "2026-06-08T10:30:00", "另一个事项")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 90);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [45, 45]);
});

test("does not split events that only touch at a boundary", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "同名"),
    timedEvent("event-2", "2026-06-08T10:00:00", "2026-06-08T11:00:00", "同名")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 120);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [60, 60]);
});

test("keeps all-day events out of timed minute allocation", async () => {
  const payload = await collect([
    allDayEvent("all-day-1", "2026-06-08"),
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "定时事项")
  ]);
  assert.equal(payload.calendar.daily[0].allDay, 1);
  assert.equal(payload.calendar.daily[0].minutes, 60);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.effectiveMinutes), [null, 60]);
});

test("does not divide an event's allocation between its category tags", async () => {
  const payload = await collect([
    timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "【健康】【关系】复合事项"),
    timedEvent("event-2", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "【学习】学习事项")
  ]);
  assert.equal(payload.calendar.daily[0].minutes, 60);
  assert.equal(payload.calendar.categories.健康.minutes, 30);
  assert.equal(payload.calendar.categories.关系.minutes, 30);
  assert.equal(payload.calendar.categories.学习.minutes, 30);
});

test("splits timed events across natural days and preserves the original interval", async () => {
  const payload = await collect([timedEvent("event-1", "2026-06-08T23:00:00", "2026-06-09T01:00:00", "跨日事项")]);
  assert.equal(payload.calendar.daily[0].minutes, 60);
  assert.equal(payload.calendar.daily[1].minutes, 60);
  assert.equal(payload.calendar.weeklyMinutes, 120);
  assert.equal(payload.calendar.daily.reduce((total, day) => total + day.minutes, 0), payload.calendar.weeklyMinutes);
  for (const day of payload.calendar.daily) {
    const detailMinutes = payload.calendar.details
      .filter((detail) => detail.date === day.date && detail.effectiveMinutes !== null)
      .reduce((total, detail) => total + detail.effectiveMinutes, 0);
    assert.equal(detailMinutes, day.minutes);
  }
  assert.deepEqual(payload.calendar.details.map((detail) => [detail.date, detail.effectiveMinutes, detail.originalStart, detail.originalEnd]), [
    ["2026-06-08", 60, "2026-06-08 23:00:00", "2026-06-09 01:00:00"],
    ["2026-06-09", 60, "2026-06-08 23:00:00", "2026-06-09 01:00:00"]
  ]);
});

test("dedupes only the same physical event", () => {
  const event = timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "同名");
  const unique = dedupePhysicalEvents([
    event,
    { ...event },
    { ...event, event_id: "event-2" },
    { ...event, calendar_id: "calendar-b" },
    { ...event, event_id: undefined },
    { ...event, event_id: undefined, calendar_id: undefined }
  ]);
  assert.equal(unique.length, 5);
});

test("merges sources and labels them when not injected", async () => {
  const payload = await collectCalendarWeekly({
    week: WEEK,
    generatedAt: GENERATED_AT,
    getAgenda: async () => [
      timedEvent("event-1", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "写周记"),
      timedEvent("event-2", "2026-06-08T11:00:00", "2026-06-08T12:00:00", "读书")
    ]
  });
  assert.equal(payload.calendar.weeklyMinutes, 120);
  assert.equal(payload.calendar.details.length, 2);
  assert.deepEqual(payload.sources, [{ name: "Time-X｜随时记", identity: "bot" }]);
});

test("counts a one-day all-day event as one day and keeps the inclusive end date", async () => {
  const payload = await collect([allDayEvent("all-day-1", "2026-06-08")]);
  assert.equal(payload.calendar.status, "available");
  assert.equal(payload.calendar.daily[0].allDay, 1);
  assert.equal(payload.calendar.details[0].end, "2026-06-09 00:00:00");
});

test("keeps the underlying calendar error in an unavailable result", async () => {
  const payload = await collectCalendarWeekly({
    week: WEEK,
    getAgenda: async () => { throw new Error("calendar permission expired"); }
  });
  assert.deepEqual(payload.calendar, { status: "unavailable", error: "calendar permission expired" });
});

test("excludes free, declined, and out-of-range events before allocation", async () => {
  const free = timedEvent("free", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "空闲记录");
  free.free_busy_status = "free";
  const declined = timedEvent("declined", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "拒绝记录");
  declined.self_rsvp_status = "declined";
  const outside = timedEvent("outside", "2026-06-07T09:00:00", "2026-06-07T10:00:00", "周外记录");
  const payload = await collect([free, declined, outside, timedEvent("valid", "2026-06-08T09:00:00", "2026-06-08T10:00:00", "有效记录")]);
  assert.equal(payload.calendar.eventCount, 1);
  assert.equal(payload.calendar.weeklyMinutes, 60);
  assert.deepEqual(payload.calendar.details.map((detail) => detail.title), ["有效记录"]);
});

test("records an empty or unavailable calendar without replacing an old file", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-calendar-status-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const calendarPath = path.join(outputRoot, "calendar.md");
  await writeFile(calendarPath, "old calendar\n", "utf8");

  const empty = await writeCalendarWeekly({ week: WEEK, outputRoot, getAgenda: async () => [] });
  assert.equal(empty.calendarPath, null);
  assert.equal(await readFile(calendarPath, "utf8"), "old calendar\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "empty"/);

  const unavailable = await writeCalendarWeekly({ week: WEEK, outputRoot, getAgenda: async () => { throw new Error("calendar unavailable"); } });
  assert.equal(unavailable.calendarPath, null);
  assert.equal(await readFile(calendarPath, "utf8"), "old calendar\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "unavailable"/);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCalendarWeekly, dedupeEvents, renderCalendarMarkdown, writeCalendarWeekly } from "./collect-calendar-weekly.mjs";

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

test("merges sources and labels them when not injected", async () => {
  const payload = await collectCalendarWeekly({
    week: "2026-W24",
    generatedAt: "2026-06-15T00:00:00.000Z",
    getAgenda: async () => [
      { summary: "写周记", start_time: { datetime: "2026-06-08T09:00:00+08:00" }, end_time: { datetime: "2026-06-08T10:00:00+08:00" } },
      { summary: "读书", start_time: { datetime: "2026-06-08T11:00:00+08:00" }, end_time: { datetime: "2026-06-08T12:00:00+08:00" } }
    ]
  });
  assert.equal(payload.calendar.weeklyMinutes, 120);
  assert.equal(payload.calendar.details.length, 2);
  assert.deepEqual(payload.sources, [{ name: "Time-X｜随时记", identity: "bot" }]);
});

test("dedupes identical events from shared and personal calendars", () => {
  const event = { summary: "写周记", start_time: { datetime: "2026-06-08T09:00:00+08:00" }, end_time: { datetime: "2026-06-08T10:00:00+08:00" } };
  const unique = dedupeEvents([event, { ...event }, { summary: "读书", start_time: { datetime: "2026-06-08T11:00:00+08:00" }, end_time: { datetime: "2026-06-08T12:00:00+08:00" } }]);
  assert.equal(unique.length, 2);
});

test("records an empty or unavailable calendar without replacing an old file", async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-calendar-status-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const calendarPath = path.join(outputRoot, "calendar.md");
  await writeFile(calendarPath, "old calendar\n", "utf8");

  const empty = await writeCalendarWeekly({ week: "2026-W24", outputRoot, getAgenda: async () => [] });
  assert.equal(empty.calendarPath, null);
  assert.equal(await readFile(calendarPath, "utf8"), "old calendar\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "empty"/);

  const unavailable = await writeCalendarWeekly({ week: "2026-W24", outputRoot, getAgenda: async () => { throw new Error("calendar unavailable"); } });
  assert.equal(unavailable.calendarPath, null);
  assert.equal(await readFile(calendarPath, "utf8"), "old calendar\n");
  assert.match(await readFile(path.join(outputRoot, "_source-status.json"), "utf8"), /"status": "unavailable"/);
});

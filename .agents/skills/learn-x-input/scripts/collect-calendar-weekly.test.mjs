import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCalendarWeekly, renderMarkdown, writeCalendarWeekly } from "./collect-calendar-weekly.mjs";

const auth = {
  identity: "user",
  verified: true,
  identities: { user: { status: "ready", scope: "calendar:calendar.event:read" } }
};

test("summarizes busy calendar instances without retaining private event content", async () => {
  const payload = await collectCalendarWeekly({
    week: "2026-W24",
    generatedAt: "2026-06-15T00:00:00.000Z",
    getAuthStatus: async () => auth,
    getAgenda: async () => [
      { event_id: "first", summary: "私人标题", description: "私密描述", event_organizer: { display_name: "某人" }, vchat: { meeting_url: "https://secret.example" }, start_time: { datetime: "2026-06-08T09:00:00+08:00" }, end_time: { datetime: "2026-06-08T10:00:00+08:00" } },
      { event_id: "second", summary: "重叠事项", start_time: { datetime: "2026-06-08T09:30:00+08:00" }, end_time: { datetime: "2026-06-08T11:00:00+08:00" } },
      { event_id: "cross-day", start_time: { datetime: "2026-06-09T23:00:00+08:00" }, end_time: { datetime: "2026-06-10T01:00:00+08:00" } },
      { event_id: "all-day", is_all_day: true, start_time: { date: "2026-06-10" }, end_time: { date: "2026-06-11" } },
      { event_id: "remote", start_time: { datetime: "2026-06-11T09:00:00+09:00" }, end_time: { datetime: "2026-06-11T10:00:00+09:00" } },
      { event_id: "free", free_busy_status: "free", start_time: { datetime: "2026-06-12T09:00:00+08:00" }, end_time: { datetime: "2026-06-12T10:00:00+08:00" } },
      { event_id: "declined", self_rsvp_status: "decline", start_time: { datetime: "2026-06-12T10:00:00+08:00" }, end_time: { datetime: "2026-06-12T11:00:00+08:00" } },
      { event_id: "boundary", start_time: { datetime: "2026-06-15T00:00:00+08:00" }, end_time: { datetime: "2026-06-15T01:00:00+08:00" } },
      { event_id: "first", start_time: { datetime: "2026-06-08T09:00:00+08:00" }, end_time: { datetime: "2026-06-08T10:00:00+08:00" } }
    ]
  });

  assert.equal(payload.weeklyPlannedBusyMinutes, 300);
  assert.deepEqual(payload.daily.map(({ plannedBusyMinutes, timedEventCount, allDayEventCount }) => [plannedBusyMinutes, timedEventCount, allDayEventCount]), [
    [120, 2, 0], [60, 1, 0], [60, 1, 1], [60, 1, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]
  ]);
  const markdown = renderMarkdown(payload);
  assert.doesNotMatch(markdown, /私人标题|私密描述|某人|secret\.example|event_id|summary|vchat/);
  assert.match(markdown, /计划时间统计，不能证明实际发生/);
});

test("replaces stale data with an unavailable marker when calendar access fails", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "learn-x-calendar-"));
  const notesPath = path.join(outputRoot, "calendar.md");
  await writeFile(notesPath, "旧统计\n", "utf8");
  try {
    const result = await writeCalendarWeekly({
      week: "2026-W24",
      outputRoot,
      getAuthStatus: async () => { throw new Error("expired"); }
    });
    const content = await readFile(notesPath, "utf8");
    assert.equal(result.payload.status, "unavailable");
    assert.match(content, /本周日历来源不可用；未使用旧结果替代。/);
    assert.doesNotMatch(content, /旧统计|全周计划忙碌时长/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

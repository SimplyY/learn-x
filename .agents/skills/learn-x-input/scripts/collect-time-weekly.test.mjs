import assert from "node:assert/strict";
import test from "node:test";
import { collectTimeWeekly, parseScreenTimeApps, renderMarkdown } from "./collect-time-weekly.mjs";

test("summarizes Time-X tags and retains only applications over one hour", async () => {
  const payload = await collectTimeWeekly({ week: "2026-W24", generatedAt: "2026-06-15T00:00:00.000Z", getAgenda: async () => [{ summary: "【健康】【关系】私人标题", start_time: { datetime: "2026-06-08T09:00:00+08:00" }, end_time: { datetime: "2026-06-08T10:00:00+08:00" } }], getScreenRecords: async () => [{ device: "Android 手机", window: "近7日", capturedAt: "2026-06-14 10:00:00", totalMinutes: 600, source: "截图" }] });
  assert.equal(payload.calendar.weeklyMinutes, 60);
  assert.equal(payload.calendar.categories.健康.minutes, 60);
  assert.equal(payload.calendar.categories.关系.minutes, 60);
  const markdown = renderMarkdown(payload);
  assert.match(markdown, /【健康】1 小时/);
  assert.match(markdown, /Android 手机/);
  assert.doesNotMatch(markdown, /私人标题/);
});

test("parses Base application detail, keeps the strict threshold, and renames Mac ChatGPT", () => {
  const androidApps = parseScreenTimeApps("Android 手机", "可见应用：ChatGPT 1小时；微信 1小时1分；浏览器 59分。");
  const macApps = parseScreenTimeApps("Mac", "Mac 原生屏幕时间。可见应用：ChatGPT 2小时3分；Google Chrome 1小时。");
  assert.deepEqual(androidApps, [{ name: "ChatGPT", minutes: 60 }, { name: "微信", minutes: 61 }, { name: "浏览器", minutes: 59 }]);
  assert.deepEqual(macApps, [{ name: "Code X", minutes: 123 }, { name: "Google Chrome", minutes: 60 }]);
  const markdown = renderMarkdown({ range: { start: "2026-06-08", endExclusive: "2026-06-15" }, timezone: "Asia/Shanghai", generatedAt: "2026-06-15T00:00:00.000Z", calendar: { status: "unavailable" }, screenTime: { status: "available", records: [{ device: "Android 手机", window: "近7日", capturedAt: "2026-06-14", totalMinutes: 300, source: "截图", apps: androidApps }, { device: "Mac", window: "近7日", capturedAt: "2026-06-14", totalMinutes: 300, source: "截图", apps: macApps }] } });
  assert.match(markdown, /微信 1 小时 1 分钟/);
  assert.match(markdown, /Code X 2 小时 3 分钟/);
  assert.doesNotMatch(markdown, /ChatGPT 1 小时/);
  assert.doesNotMatch(markdown, /Google Chrome 1 小时/);
});

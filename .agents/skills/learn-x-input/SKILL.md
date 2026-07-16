---
name: learn-x-input
description: 采集外部每周证据（微信读书阅读、划线和想法等）写入 03_input 目录，生成可追溯、确定性的数据文件。
---

# Learn-X Input

Collect external evidence into the requested `03_input/weekly/YYYY-Www/` directory. Keep collection deterministic and source-preserving; do not summarize long-term conclusions or write to `01_core/`.

## WeRead Weekly Input

1. Confirm the API Key is available through `WEREAD_API_KEY` or macOS Keychain service `learn-x-weread-api-key`.
   Store it without exposing it in shell history:

   ```bash
   security add-generic-password -U -a "$USER" -s learn-x-weread-api-key -w
   ```

   Obtain the Key from `https://weread.qq.com/r/weread-skills`. Do not paste it into chat or commit it to the repository.
2. Run:

   ```bash
   npm run input:weread -- --week YYYY-Www
   ```

3. Verify these files:
   - `03_input/weekly/YYYY-Www/weread.md`
4. Run `npm run process:weekly -- --week YYYY-Www` only when the user also wants the Weekly Process Pack refreshed.

The collector exports weekly reading time, books whose latest reading time falls in the requested ISO week, each book's latest progress and current chapter, plus personal highlights and thoughts created during that week. The current chapter is a progress snapshot, not a complete chapter-by-chapter reading history. It may use notebook recency to limit candidate books, but must filter every exported note by its own creation time.

Render all seven days from the weekly `readTimes` buckets, including zero-minute days. A shelf item is shown as read only when it has positive progress, a known current chapter, or a positive per-book time in the weekly ranking; `0%` plus an unknown chapter without weekly time is treated as a newly added shelf item and omitted.

## Boundaries

- Treat WeRead as information input, not self-feedback, action evidence, or Memory.
- Keep the weekly Markdown source-preserving: include the collection range, timezone, generated time, reading statistics, progress snapshots, highlights, and thoughts. Do not persist WeRead IDs, ranges, chapter UIDs, or position links.
- Use `/readdata/detail` weekly statistics as the total-time source. Use `readUpdateTime` only to identify books read during the week; do not infer per-book duration from timestamps.
- Label the mapped progress chapter as the latest current chapter. Do not claim that it is the complete list of chapters read during the week.
- Do not collect public reviews, popular highlights, or bookmark positions without content.
- Do not overwrite existing output unless all API requests and rendering complete successfully.
- Reject `/readdata/detail` when any returned daily bucket falls outside the requested ISO week. Do not turn a previous-week response into a file labelled as the target week.
- Stop when the WeRead API returns `upgrade_info`; update the installed WeRead Skill before retrying.

## Calendar Weekly Input

Run `npm run input:calendar -- --week YYYY-Www` to collect the target ISO week's primary Feishu Calendar through `lark-cli calendar +agenda --as user`.

- Require the user identity and `calendar:calendar.event:read`; on failure write `calendar.md` as unavailable and do not retain old statistics.
- Write only daily and weekly planned-busy aggregates. Never write schedule titles, descriptions, people, locations, event IDs, calendar IDs, or meeting links.
- Treat the result as planned-time context, never as evidence that an event occurred, was attended, or was completed.

## Script

Use `scripts/collect-weread-weekly.mjs`. It accepts `--week YYYY-Www`; without it, it uses the Learn-X weekly review default in `Asia/Shanghai`: Monday through Friday target the previous ISO week, Saturday and Sunday target the current ISO week. Weekly automation should still pass the resolved target week explicitly.

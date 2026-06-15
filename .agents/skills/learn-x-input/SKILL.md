---
name: learn-x-input
description: Collect external weekly evidence into Learn-X 03_input with traceable, deterministic files. Use when importing or refreshing weekly sources such as WeRead reading activity, highlights, and personal thoughts before running learn-x-process.
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
   - `03_input/weekly/YYYY-Www/01_inbox/weread/notes.md`
   - `03_input/weekly/YYYY-Www/01_inbox/weread/_raw.json`
4. Run `npm run process:weekly -- --week YYYY-Www` only when the user also wants the Weekly Process Pack refreshed.

The collector exports weekly reading time, books whose latest reading time falls in the requested ISO week, each book's latest progress and current chapter, plus personal highlights and thoughts created during that week. The current chapter is a progress snapshot, not a complete chapter-by-chapter reading history. It may use notebook recency to limit candidate books, but must filter every exported note by its own creation time.

Render all seven days from the weekly `readTimes` buckets, including zero-minute days. A shelf item is shown as read only when it has positive progress, a known current chapter, or a positive per-book time in the weekly ranking; `0%` plus an unknown chapter without weekly time is treated as a newly added shelf item and omitted.

## Boundaries

- Treat WeRead as `01_inbox` evidence, not `00_log` or Memory.
- Keep `_raw.json` for content and collection audit; its leading underscore keeps it out of `learn-x-process`. Do not persist WeRead IDs, ranges, chapter UIDs, or position links.
- Use `/readdata/detail` weekly statistics as the total-time source. Use `readUpdateTime` only to identify books read during the week; do not infer per-book duration from timestamps.
- Label the mapped progress chapter as the latest current chapter. Do not claim that it is the complete list of chapters read during the week.
- Do not collect public reviews, popular highlights, or bookmark positions without content.
- Do not overwrite existing output unless all API requests and rendering complete successfully.
- Stop when the WeRead API returns `upgrade_info`; update the installed WeRead Skill before retrying.

## Script

Use `scripts/collect-weread-weekly.mjs`. It accepts `--week YYYY-Www`; without it, it uses the current ISO week in `Asia/Shanghai`.

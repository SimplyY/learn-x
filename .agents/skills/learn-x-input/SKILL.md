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

## Time-X Weekly Input

Run `npm run input:time -- --week YYYY-Www` once to collect the target ISO week's fixed `Time-X｜随时记` shared calendar and screen-time Base through `lark-cli --as bot`.

- Write calendar aggregates plus every block's date, start/end, title, and description to `calendar.md`; write screen-time totals and applications strictly over one hour to `time.md`. Do not fall back to the user identity or primary calendar.
- Keep Mac `ChatGPT` as `Code X`. Never write calendar people, locations, IDs, links, system metadata, or screenshots.
- Treat calendar and screen time as separate context, never as completion evidence.

## Voice-X Weekly Input

Run `npm run input:voice -- --week YYYY-Www` to read the fixed Voice-X Base with `lark-cli --as bot` and write `voice.md`.

- Select by `录制时间` using the target Asia/Shanghai ISO week and require `核心重点 with AI chat` non-empty.
- Traverse every Base page, sort by recorded time and a stable business key, then fetch the complete core Markdown document for each row.
- Never fetch or copy `原始文字稿`; Voice-X Base remains the index and Docx remains the only正文 authority.
- A successful zero-result query writes an explicit 0-record file. Any Base/schema/document failure must preserve the previous `voice.md` byte-for-byte.

## Daily and AI Coach Weekly Input

Run `npm run input:daily-coach -- --week YYYY-Www` to collect the 日常记录 Base and four AI Coach tables with `lark-cli --as bot`.

- Verify live tables and fields, filter the target Asia/Shanghai week server-side, and traverse every page before writing `daily.md` and `coach.md`.
- Preserve ordinary fields and URLs, record attachment names/counts, and exclude contact details, interview text, linked-page正文, and technical record IDs.

## Wisdom Gate Weekly Input

Run `npm run input:wisdom -- --week YYYY-Www` to collect the 智慧之门 table (研究&学习 Base) with `lark-cli --as bot`.

- Verify the table and fields, filter the target Asia/Shanghai week server-side by 最后更新时间, traverse every page, then write `wisdom.md`.
- Preserve ordinary fields and URLs; exclude contact details, technical record IDs, and linked-page正文.
- Config-driven via `collect-base-weekly.mjs` and the shared `lib/base-collector.mjs`; adding a new Base source only needs a new entry in the `COLLECTORS` array.

## Script

Use `scripts/collect-weread-weekly.mjs`, `scripts/collect-time-weekly.mjs`, `scripts/collect-voice-weekly.mjs`, and `scripts/collect-daily-coach-weekly.mjs`, plus the config-driven `scripts/collect-base-weekly.mjs` (currently 智慧之门). They accept `--week YYYY-Www`; without it, they use the Learn-X weekly review default in `Asia/Shanghai`: Monday through Friday target the previous ISO week, Saturday and Sunday target the current ISO week. Weekly automation should still pass the resolved target week explicitly.

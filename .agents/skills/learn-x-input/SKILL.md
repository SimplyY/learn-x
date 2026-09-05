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

3. If present, verify `03_input/weekly/YYYY-Www/_source-status.json`. For newly collected weeks, only `status=ready` produces `weread.md`; a successful zero result records `empty` and reports `0 条记录，文件未生成`. A failed query preserves any old file but records `failed/unavailable`, so downstream processing must ignore it. Historical weeks without the sidecar keep legacy compatibility.
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

## Time-X Calendar Input

Run `npm run input:calendar -- --week YYYY-Www` once to collect the target ISO week's fixed `Time-X｜随时记` shared calendar through `lark-cli --as bot`.

- Write calendar aggregates plus every block's date, start/end, title, and description to `calendar.md`. Do not fall back to the user identity or primary calendar.
- Never write calendar people, locations, IDs, links, or system metadata.
- Treat the calendar as planning context, never as completion evidence.

## Voice-X Weekly Input

Run `npm run input:voice -- --week YYYY-Www` to read the fixed Voice-X Base with `lark-cli --as bot` and write `voice.md` from completed AI insight documents.

- Select by `录制时间` using the target Asia/Shanghai ISO week and require `处理后原文` non-empty. Query the current `AI 文档` field (falling back to legacy `AI 洞察文档`) as a required field too.
- Read the processed-original document only for its character count. The weekly body must come from a new-format document with `## 核心总结` followed by `## 芒格之魂洞察`; the optional legacy `# Voice-X …` body title is accepted for compatibility.
- Missing or placeholder insight is `pending`; substantive old-format insight is `legacy`. Neither enters `voice.md`, and the collector never falls back to the rough processed original.
- Traverse every Base page, sort by recorded time and a stable business key, then fetch the core Markdown document for each row. Keep only the compressed core-summary section before any recognized advice/full-detail boundary: `# 对我的建议`、`## 3. 对我的建议（仅留档，不采集到 Learn-X）` or `# 压缩原文`; never copy the detailed full transcript after those boundaries. Old documents without a recognized boundary remain unchanged for compatibility.
- Never fetch or copy `原始文字稿`; Voice-X Base remains the index and Docx remains the only正文 authority.
- Each written record retains the title, recording time, processed-original character count, AI-insight character count, core summary, and Munger-soul insight. A successful zero-result query records `empty` and does not create a new file. Any Base/schema/document/size failure preserves the previous `voice.md` byte-for-byte and records `failed/unavailable`.

## Weekly input size contract

- Every `03_input/weekly/YYYY-Www/*` input file, including manual and separate automation outputs, must be at most 15,000 Unicode characters, counting Markdown metadata and line breaks.
- Collectors and `process:weekly` both enforce this limit. `process:weekly` aggregates every violation and stops before writing `input.json` or `process-pack.md`.
- Never mechanically truncate an oversized file. Run `npm run input:compress -- --week YYYY-Www` to create a review manifest, diagnostics, and only safe structural candidates; candidates live under `_dist` and never replace the original automatically.
- Apply candidates only after the user has reviewed the diagnostics and explicitly confirms the exact target week, using `npm run input:compress -- --week YYYY-Www --apply --confirm`.

## Daily Weekly Input

Run `npm run input:daily-coach -- --week YYYY-Www` to collect the 日常记录 Base and AI Coach Base with `lark-cli --as bot`.

- Verify live tables and fields, filter the target Asia/Shanghai week server-side, and traverse every page before writing `daily.md`; write `coach.md` only when at least one Coach record remains after filtering.
- Both sources update `_source-status.json`; zero records preserve any old file but mark it stale, and failures preserve it while marking the source failed.
- Coach filtering is table-specific: `服务对象` and `项目` use `创建时间`; `服务记录` uses its service `日期`; `ai coach thinking` uses `更新时间` only to find candidates and removes records with the `已推送轮次` + `回顾状态` + `上次推送时间` review signature. New records remain in `coach.md`; review updates are marked and excluded by this collector.
- If all Coach tables have zero retained records, report `0 条记录，文件未生成`; this is a successful empty source, not a collection failure.
- Preserve ordinary fields and URLs, record attachment names/counts, and exclude contact details, interview text, linked-page正文, and technical record IDs.

## Wisdom Gate Weekly Input

Run `npm run input:wisdom -- --week YYYY-Www` to collect the 智慧之门 table (研究&学习 Base) with `lark-cli --as bot`.

- Verify the table and fields, filter the target Asia/Shanghai week server-side by 创建时间, traverse every page, then write `wisdom.md` only when at least one new record remains.
- If no new Wisdom Gate record remains, report `0 条记录，文件未生成`; this is a successful empty source, not a collection failure.
- `wisdom.md` uses `创建时间` as the weekly boundary: collect only records created in the target week; do not collect updates to existing records caused by review/revisit/status changes.
- Preserve the structured value-added fields plus an adaptive extractive compression of `长篇内容、原始内容`: target around 300 Unicode characters per record, normally within 200-500, with the budget determined by independent core claims, causal/model structure, conclusions, boundaries, risks, and reference-field overlap. Short records are not artificially expanded; long records never exceed 500. Never write the raw field to local input. The Base URL remains the audit path for omitted original content.
- Config-driven via `collect-base-weekly.mjs` and the shared `lib/base-collector.mjs`; adding a new Base source only needs a new entry in the `COLLECTORS` array.

## Shared source status

Every automatic source writes `03_input/weekly/YYYY-Www/_source-status.json` with `ready`, `empty`, `failed`, or `unavailable`. Only `ready` files enter Process. Old files are never used as a substitute for an empty or failed run. External owners such as Flomo, Build-Bot, and Health-X can update it with:

```bash
npm run input:source-status -- --week YYYY-Www --source flomo --status empty --file flomo.md --count 0 --summary "本周 0 条笔记"
```

The sidecar contains only source status metadata; it must not contain正文、凭据、URL 参数或技术 ID. A missing sidecar keeps legacy file-reading compatibility; an invalid sidecar fails closed.

## Script

Use `scripts/collect-weread-weekly.mjs`, `scripts/collect-calendar-weekly.mjs`, `scripts/collect-voice-weekly.mjs`, and `scripts/collect-daily-coach-weekly.mjs`, plus the config-driven `scripts/collect-base-weekly.mjs` (currently 智慧之门). They accept `--week YYYY-Www`; without it, they use the Learn-X weekly review default in `Asia/Shanghai`: Monday through Friday target the previous ISO week, Saturday and Sunday target the current ISO week. Weekly automation should still pass the resolved target week explicitly.

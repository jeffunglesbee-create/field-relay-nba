# Journalism cron UTC-rollover incident — outbox

**Date:** 2026-07-16
**Trigger:** live-verifying the journalism-quality-gate-redesign follow-up surfaced a real WNBA game (Valkyries 88 @ Fever 75, `espn:401857070`) whose post-game recap never generated, which escalated into a broader, unrelated cron-silence finding.
**Commits:** `4e22e67` (superseded band-aid), `e5a9c18` (root-cause fix, deployed and live-verified)

## What was found

1. **GameDO's completion-trigger is correctly client-driven, not broken.** `/journalism/game-complete` only fires from GameDO's own `alarm()`/`_poll()` cycle, which only runs while a real browser has an active WebSocket connected to that specific game (`IDLE_SHUTDOWN_MS = 5 min` with zero sessions → the DO stops polling and hibernates). Nobody was watching this WNBA game, so GameDO never detected its completion. This is deliberate resource conservation, not a defect — not touched.

2. **The real bug: `handleJournalismCycle`'s per-game loop only ever queried ESPN's scoreboard for *today's* UTC calendar date.** `espn:401857070` (tipped off at UTC midnight) is keyed by ESPN under `date=2026-07-15`, not `2026-07-16` — confirmed live via `/v2/games`. Once UTC rolled over, the game permanently fell out of that loop's query scope; no future 15-min tick would ever see it there.

3. **First fix attempt (`4e22e67`) was a band-aid**, not the real fix: made the one loop also query yesterday's date. Confirmed correct in isolation via a merge-simulation test against real fetched data, but treated a symptom, not the cause, and left the parallel slate-listing loop (and every other `dateKey`-derived key in the same function) still wrong.

4. **Checked Drive per direct instruction before shipping anything further** ("the UTC date rollover has been solved by FIELD before"). Found it: jubilant-bassoon's 2026-06-06 session doc ("Scout's Pick + 4am Rollover") documents the exact same failure mode, discovered client-side first — naive local-midnight rollover pulled the schedule forward mid-game, dropping finished/in-progress games from view. The established, already-vetted fix: **`window.TODAY_ISO`, ET-anchored with a 4am ET rolling cutoff**, not raw calendar midnight. ET because FIELD's schedule and ESPN's own scoreboard are both ET-anchored; 4am because no major US league starts games after 2am ET (2-hour buffer for overtime/extra innings/late TV). That fix was never ported to the relay side, which was still computing `dateKey` via raw `new Date().toISOString().slice(0,10)`.

5. **Real, separate, and much larger finding along the way:** both journalism-cron writes AND a completely unrelated odds-ingestion cron path (`change_log`, `source='odds_api'`) stopped producing *any* output at almost the exact same timestamp — `00:00:38` and `00:01:23` UTC, right at the UTC-midnight boundary, ~3 hours before this dispatch even started. This predates every fix shipped tonight. The UTC-midnight `dateKey` bug is the leading, evidence-consistent explanation (right after rollover, "today" per naive UTC computation is a day that's still almost entirely pre-game from ET's perspective, which could plausibly starve or edge-case-break downstream logic) but this is **not confirmed via logs — no log-tail access was available this session.** Disclosed as a plausible, not proven, root cause for the broader silence.

## Fix shipped (`e5a9c18`, supersedes `4e22e67`)

Added `getFieldDateKey()` (`src/index.js`, next to `stripKVIdPrefix`), porting `window.TODAY_ISO`'s exact logic server-side (`Intl`/`toLocaleString` with `timeZone:'America/New_York'`, same as the browser client — no library dependency, natively available in the Workers V8 isolate). Wired at the two sites in the direct causal chain:
- `handleJournalismCycle`'s single `dateKey` declaration — every downstream consumer (`espnDate`, the per-game ESPN query, the ARCHIVE-CATCHUP slate-listing loop, golf per-round dedup, `wc-morning-brief:{dateKey}` dedup, the `journalism:{dateKey}` slate KV key, `slate_{dateKey}_cron` D1 id) corrects automatically from this one change, not just the loop the band-aid touched.
- `/journalism/tonight` / `/journalism/brief`'s KV reader — kept in sync with the writer; a write/read `dateKey` mismatch during the ET 00:00-04:00 window would have reintroduced an equivalent bug in a new form.

Reverted `4e22e67`'s band-aid back to its original single-fetch structure — redundant once the root `dateKey` is correct.

**Deliberately out of scope, disclosed rather than silently expanded into:** ~18 other `new Date().toISOString().slice(0,10)` occurrences exist elsewhere in this file, the large majority as `?date=` query-param fallbacks on debug/admin routes (lower-stakes, caller-controllable, not part of this incident's causal chain). Not audited or touched this dispatch — a genuine candidate for a separate, properly-scoped hardening pass if warranted, not something to rush through here.

## Verification

- `node --check src/index.js`: clean, both times (band-aid and final fix).
- Local test: naive UTC `dateKey` = `2026-07-16` (wrong) vs. `getFieldDateKey()` = `2026-07-15` (correct, matches where the WNBA game and all of tonight's real content actually live) — confirmed against the real system clock at fix time.
- Deploy confirmed successful (`Deploy RELAY Worker` + `Post-deploy live verification`, both success, commit `e5a9c18`).
- **Live confirmation, read side:** `GET /journalism/tonight` now correctly resolves to the `2026-07-15` slate cache and returns real, valid prose (`generatedAt` decodes to `2026-07-15T21:05:33.845Z` — the last good slate written before the stall began), instead of null/empty. Directly proves the corrected date computation resolves to the right KV key in production.
- **Live confirmation, write side: not yet obtained.** The deploy landed at almost exactly `03:00:00 UTC`, the instant `handleJournalismCycle`'s pre-existing, unrelated `isLiveHours` gate (`hour>=10 || hour<=2`) flips into its dead-hours branch (`hour` 3 through 9 UTC = 11pm-5am ET) and skips live per-game brief generation entirely in favor of a backfill routine. This is correct, intentional, pre-existing behavior, not caused by tonight's fix — but it means no fresh write from the live path can be observed until live hours resume at `10:00 UTC` (~6am ET). Confirmed via direct D1 query: zero new rows of any kind since deploy.

## Unblock criteria (Rule 74)

Re-check D1 (`SELECT * FROM briefs WHERE created_at > '<deploy timestamp>'`) and `/quality/report` once past `10:00 UTC` on 2026-07-16, when live-hours brief generation resumes. Expect: (a) the WNBA `espn:401857070` recap finally generated with `source='cron'`, referencing the real 88-75 result rather than the stale pre-game preview; (b) resumed steady `source='cron'` write activity across sports generally, closing the ~3hr-and-counting silence gap; (c) if writes still don't resume, the UTC-midnight-`dateKey` hypothesis for the broader silence is falsified and a different root cause needs investigating — with actual log access if available by then.

## Confidence assessment

Root-cause fix is correct, minimal, and grounded in FIELD's own established prior art rather than invented fresh — not a guess. Deploy and read-side correctness both live-confirmed. Write-side end-to-end proof is genuinely blocked by an intentional, unrelated scheduling gate for ~7 more hours, not by any known remaining defect. Not scoring against a CC-CMD rubric (this was a live-incident response, not a pre-written dispatch) — reporting status honestly rather than forcing a number.

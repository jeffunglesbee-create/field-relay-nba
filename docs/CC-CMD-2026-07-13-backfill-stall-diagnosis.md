# Claude Code Command — diagnose and fix the stalled game_brief backfill engine

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/backfill-stall-diagnosis-2026-07-13.md.

## CONTEXT — confirmed via direct D1 query before this doc was written, not assumed

`executeGameBriefBackfill`/`pickNextBackfillDate` (via `handleJournalismCycle`'s dead-hour block) wrote `briefs` rows with `source='backfill'` steadily from 2026-06-22 through 2026-07-03, then stopped — zero rows since. This is not benign completion: a direct D1 query confirms 120 uncovered dates remain in `regular_season_games` and 20 in `postseason_games`, oldest uncovered date 2026-03-05. `pickNextBackfillDate` selects the oldest date not yet covered by a `source='backfill'` brief — if it's been silently failing on the same date repeatedly (or throwing before ever marking a date covered), it would never advance, explaining both the stall and why dates as old as March remain untouched despite ~10 days of cron ticks since the last successful write.

The call site (`gameBriefResult = await executeGameBriefBackfill(env, nextDate)`, ~line 39412 in the deployed bundle, confirm real line in `src/index.js`) is wrapped in a `try/catch` at the outer dead-hour block level — a per-date failure would not crash the cron, but also would not surface anywhere visible, matching the exact silent-catch pattern already fixed twice today (P15B, loadQualityCalibration).

## TASK 0 — Probe (map full control flow, do not guess)

```bash
grep -n "async function executeGameBriefBackfill" -A 80 src/index.js
grep -n "async function pickNextBackfillDate" -A 20 src/index.js
```

Read both functions completely. Identify every path where `executeGameBriefBackfill` could fail, return without writing a `source='backfill'` row, or throw — and whether any of those paths would cause `pickNextBackfillDate` to keep re-selecting the same date indefinitely on the next tick (i.e., is there a "mark attempted even on failure" mechanism, or does only success record progress?).

## TASK 1 — Diagnose the actual stuck date

```bash
# query which date pickNextBackfillDate would currently select, and check
# whether real game data for it is malformed/missing in a way that would
# make executeGameBriefBackfill throw or silently no-op
```

Use the D1 MCP connector (`d1_database_query`, database_id `cc49101c-0569-4d41-8e7a-be139cde4f26`) to inspect the actual currently-selected date's underlying game rows for anomalies (nulls, malformed team names, missing scores) that could explain a per-date failure.

## TASK 2 — Fix

Based on TASK 0/1's real findings — likely candidates: (a) the silent catch needs a real `console.error("[BACKFILL]", ...)` matching today's established convention, so future stalls are visible immediately instead of discovered 10 days later via a manual D1 query; (b) if a specific date's data is genuinely malformed in a way that will always throw, add a skip-and-advance path so one bad date doesn't block all older dates behind it, using `COALESCE`/`ON CONFLICT DO NOTHING` patterns already established elsewhere in this file for permanently marking a date as "attempted" separately from "succeeded." Do not implement (b) speculatively — only if TASK 0/1 confirm it's the real mechanism.

## TASK 3 — Verify

- Real forced-condition test proving the fix advances past a previously-stuck date.
- Confirm a genuine successful backfill for at least one real date from the March-through-June backlog, verified via direct D1 read (not just the function's own return value).
- Run whatever test/lint mechanism this repo has for relay changes.

## DONE CONDITION

Root cause of the 10-day stall identified via real investigation, not assumed. Fix addresses that specific mechanism. At least one real date from the confirmed backlog successfully backfilled and verified in D1. Silent failure path now has real visibility matching this session's established `[TAG]` convention.

**Confidence scoring:**
- TASK 0 maps real control flow in both functions, identifies the actual failure/stall mechanism (30 pts)
- TASK 1 diagnoses the specific stuck date's real cause via D1, not speculation (25 pts)
- TASK 2 fix addresses the confirmed root cause, not a guessed one (25 pts)
- TASK 3 real forced test + at least one real backlog date verifiably backfilled (20 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

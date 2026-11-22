# Claude Code Command — Nine EPL archive rows were left without odds by the `C Palace` defect

**Date:** 2026-11-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (data repair, billed)
**Status:** FILED 2026-11-22, not started. Blocked on the owner's word: the repair spends billed historical Odds credits whose cost is not yet measured (Task 0), and the owner chooses whether it runs at all.
**Filed from:** `docs/CC-CMD-2026-09-11-epl-identity-resolve.md` (DONE 2026-11-22). That CC-CMD's scope was "two defects, both measured. Do not extend", so this finding is its own document (Rule 87.4), not a carry-forward.

## What was measured, 2026-11-22 (read-only SELECTs of `field-archive`; no credit spent)

Nine EPL rows from the 2026-27 season have `opening_odds IS NULL`:

| date | home | away |
|---|---|---|
| 2026-08-21 | Arsenal | Coventry |
| 2026-08-22 | Everton | C Palace |
| 2026-08-28 | C Palace | Man City |
| 2026-09-05 | Fulham | C Palace |
| 2026-09-12 | C Palace | Ipswich |
| 2026-09-20 | Leeds | C Palace |
| 2026-10-11 | C Palace | Nottm Forest |
| 2026-10-18 | Brighton | C Palace |
| 2026-10-25 | C Palace | Newcastle |

**The premise tested, not assumed:** the alias that makes `C Palace` resolve (`7191291f`, 2026-10-27) is what separates priced from unpriced. Of the 11 EPL rows that carry `C Palace`, the 8 dated before 2026-10-27 are all unpriced and the 3 dated after (2026-10-31 Spurs v C Palace, 2026-11-08 C Palace v Liverpool, 2026-11-21 Coventry v C Palace) are all priced. Zero exceptions either way.

**Not explained, and not guessed:** the ninth row, Arsenal v Coventry on 2026-08-21, has no `C Palace` in it. Ten of the eleven `Coventry` rows are priced; this one is the season's opening fixture. Its cause is not established.

**Out of scope:** 20 further unpriced EPL rows dated 2026-05-09 to 2026-05-24 (last season's end) carry full club names (`Manchester City`, `Crystal Palace`), so an alias miss does not explain them. Recorded here so they are not mistaken for this defect; not part of this CC-CMD.

## Read before building (BUILD-ON-A)

Statuses read 2026-11-22, none holds this work: `docs/CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time.md` CLOSED, `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md` DONE, `docs/CC-CMD-2026-08-25-misjoined-opening-odds.md` DONE, `docs/CC-CMD-2026-09-15-odds-backfill-missing-api-key.md` CLOSED. The CFL experiment's VOID window (2026-11-08 to 11-23) lists functions this work does not touch.

## Task 0 — probe first (no spend)

1. Re-read the nine rows: `SELECT date, home, away FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01' ORDER BY date` (read-only; `wrangler d1 execute field-archive --remote` or the Cloudflare D1 tool). Expected 9. A different number means this document is stale: stop and say so.
2. Read the route that would do the repair: `GET|POST /archive/odds-backfill?date=YYYY-MM-DD` (`src/index.js`, `pathname === '/archive/odds-backfill'`; quota floor `ODDS_QUOTA_FLOOR = 50`). It walks one date, calls the Odds API's HISTORICAL endpoint once per sport, matches by team pair and writes `opening_odds` where NULL. It is a write route: do not call it to see what it does.
3. Find what a historical call costs, from evidence and not memory: the Results of `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md` (a repair was applied there) and the Odds API's documentation. Write the figure with its source, per date and for nine dates. If it cannot be established without a billed call, say so; do not estimate silently.
4. Confirm the nine rows would join: run `resolveTeamKey` on each name and compare with the vendor's historical names for that date (offline, from the relay's resolver).

## Task 1 — the owner's decision

Report Task 0's cost for nine dates to the owner and stop. The owner may approve a number of credits, narrow the dates, or decline (the rows then stay NULL and are listed as accepted in the manifest). Do not proceed on an inferred yes.

## Task 2 — the repair, only after Task 1

One date at a time, in date order, through a spend-capped runner step with the shape of `scripts/probe-identity-mismatches.mjs` (a cap in the code, one attempt per date, the first failure ends the run, a 200 that carries an error is a failure, the calls already made counted from committed artifacts). Not through an uncapped loop.

## Done condition (artifact, not a bare action)

`SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01'` returns `0`, with the query and its output committed in the manifest; or the owner has declined in writing and the manifest lists the nine rows as accepted. "The backfill ran" is not a done condition.

## Task 3 — outbox manifest (last task)

`outbox/cc-session-<date>-epl-rows-left-unpriced.md`: the Task 0 numbers with sources, the owner's decision verbatim, the calls made and their cost as the ledger recorded them, and the done-condition query output.

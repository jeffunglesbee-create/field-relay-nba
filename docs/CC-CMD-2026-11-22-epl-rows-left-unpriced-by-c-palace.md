# Claude Code Command — Nine EPL archive rows were left without odds by the `C Palace` defect

**Date:** 2026-11-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (data repair, billed)
**Status:** IN PROGRESS 2026-11-22. Task 0 done (results below). The owner said "Backfill approved" with no credit number; Task 1 says not to proceed on an inferred yes, so the number is asked for (270 recommended) before the one billed dispatch. The filter (`38754bb1`) and the capped runner (`4f718b6c`) are built and gated; nothing has been spent.
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

### Task 0 results, 2026-11-22 (no credit spent)

1. **The nine rows re-read** (Cloudflare D1 tool, `field-archive`, SELECT only): 9 rows, the table above, each `start_time` 13:00Z or later. A second SELECT shows `odds_history_rows = 0` for all nine, so nothing partial exists to reconcile.
2. **The route's cost model**, read from source and exercised in `scripts/check-odds-backfill-sport-filter.mjs` against a vendor stub: one historical fetch per sport bucket per date, markets `h2h,spreads,totals`, `regions=us`, snapshot `${date}T12:00:00Z` = **30 credits per sport-date** (10 per market). The route had no sport filter, so an unfiltered date costs 30 credits for every sport with NULL-opening rows on it: the check's baseline seeds four sports and spends 120. Measured in D1 (regular and postseason tables, SELECT only, 2026-11-22): the nine dates carry NULL-opening rows in 5, 7, 7, 7, 8, 8, 10, 7 and 9 distinct sports, 68 sport-dates in all. That is an upper bound on the unfiltered bill (68 x 30 = 2,040), because a sport with no odds key is not fetched; how many of the 68 map to a key was not measured. Either way a single date can reach 10 x 30 = 300, the route's whole day cap (`SITE_CEILINGS.archiveOddsBackfill`).
3. **Why the filter, and why not an existing tool** (BUILD-ON-A, searched by content): `scripts/targeted-odds-fill.mjs` already takes `--sport` and `--date`, but its sport set `NEWLY_REACHABLE` (line 72) is twelve sports that excludes EPL, it asks for two markets (20 credits) and writes `odds_history`, not `opening_odds`. Using it would mean editing its set and routing the nine rows through a second table and a sync. The route's own writer already does the repair; the missing piece was only a way to name one sport. Added: `?sport=EPL` on `/archive/odds-backfill`, validated against `archiveSportToOddsKey`, refused with 400 on an unknown label before anything is spent.
4. **Cost for the owner:** 9 sport-dates x 30 = **270 credits**, against the 300 day cap and the 50-credit floor. Nothing is fetched twice by design (the runner allows one attempt per date, and a 24-hour edge cache covers a repeat).
5. **Would the nine rows join:** `scripts/check-odds-backfill-sport-filter.mjs` runs the real worker over a vendor stub that serves a real-shaped `Crystal Palace v Newcastle United` event, and the `C Palace` row is priced from it. All nine kickoffs are after the noon snapshot, so none is skipped as already started. The Coventry row (2026-08-21, Arsenal v Coventry, 19:00Z) is not explained; it is run last so that a zero there cannot stop the eight others, and the runner stops, naming the date, if a date finds games and populates none.

## Task 1 — the owner's decision

Report Task 0's cost for nine dates to the owner and stop. The owner may approve a number of credits, narrow the dates, or decline (the rows then stay NULL and are listed as accepted in the manifest). Do not proceed on an inferred yes.

## Task 2 — the repair, only after Task 1

One date at a time, in date order, through a spend-capped runner step with the shape of `scripts/probe-identity-mismatches.mjs` (a cap in the code, one attempt per date, the first failure ends the run, a 200 that carries an error is a failure, the calls already made counted from committed artifacts). Not through an uncapped loop.

## Done condition (artifact, not a bare action)

`SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01'` returns `0`, with the query and its output committed in the manifest; or the owner has declined in writing and the manifest lists the nine rows as accepted. "The backfill ran" is not a done condition.

## Task 3 — outbox manifest (last task)

`outbox/cc-session-<date>-epl-rows-left-unpriced.md`: the Task 0 numbers with sources, the owner's decision verbatim, the calls made and their cost as the ledger recorded them, and the done-condition query output.

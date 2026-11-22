# Claude Code Command — Twenty EPL rows seeded on 2026-06-15 have no kickoff time and no odds

**Date:** 2026-11-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (data repair, billed; the decision is the owner's)
**Status:** FILED 2026-11-22, not started. Blocked on the owner: pricing them spends historical Odds credits (Task 1), and the owner chooses whether it runs at all.
**Filed from:** `docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md` (DONE 2026-11-22), which recorded these rows as "a different state, out of scope". Searched by content before filing (BUILD-ON-A): no other CC-CMD names these rows; the CFL experiment's VOID window (to 2026-11-23) lists functions this work does not touch.

## What was measured, 2026-11-22 (read-only SELECTs of `field-archive`; no credit spent)

**One cohort.** 26 EPL rows were created in one batch on `2026-06-15 16:05:30` (the last three matchweeks of 2025-26, dated 2026-05-09 to 2026-05-24). Of those 26, **24 have `start_time` NULL, every one has `finalized_at` NULL, and 20 have `opening_odds` NULL** (those 20 also have `closing_odds` NULL; it was not read for the other six). Every EPL row created from 2026-08-21 on (all later `created_at` dates) has a `start_time` and a price.

| date | EPL rows | unpriced | no `start_time` |
|---|---|---|---|
| 2026-05-09 | 5 | 5 | 5 |
| 2026-05-10 | 4 | 4 | 4 |
| 2026-05-13 | 1 | 1 | 1 |
| 2026-05-17 | 6 | 2 (Everton v Sunderland AFC, Leeds United v Brighton & Hove Albion) | 6 |
| 2026-05-24 | 10 | 8 | 8 |

None of the 20 has an `odds_history` row. They carry full club names (`Manchester City`, `Crystal Palace`, `Sunderland AFC`, `Brighton & Hove Albion`), an `espn_event_id`, a venue, scores and a `drama_arc`; `bsd_event_id` is NULL.

**The cohort's priced rows are not clean either.** Four of the six rows on 2026-05-17 carry an `opening_odds` whose `captured_at` is `2026-06-16T03:01:03Z` (the wall clock of a run a month after the match, not a snapshot before kickoff) and a two-way moneyline with no draw. Across all 115 priced EPL rows: 4 have a `captured_at` after the match date and **12 have no draw price**. Which rows the other 8 no-draw rows are, and why, was not looked at.

**Not established, and not guessed:** why these 20 were never priced. The route can price a row with no `start_time` (the join falls back to resolved team keys, and the late-snapshot guard then reads the vendor's own `commence_time`), so a missing kickoff time alone does not explain it. The four rows on 05-17 that were priced got their line from a fetch made on 2026-06-16, a month after the match, which only a historical snapshot can have served; so the vendor's history carried at least those four matches (inferred from the dates, not from the fetch). Whether it carries the other four dates' matches, and whether the 20 names join, is what Task 0 and the first paid call would find out.

## Read before building

`docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md` (DONE): the runner `scripts/run-odds-backfill-capped.mjs`, its workflow `odds-backfill-capped.yml` (inputs `dates`, `sport`, `approved_credits`, `preflight_only`), the `?sport=` filter and the 30-credit price per sport-date are all built, deployed and proven live; reuse them, do not write another. `docs/CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time.md` (CLOSED) is the fix that stopped the wall-clock `captured_at`; the four June-16 rows predate it.

## Task 0 — probe first (no spend)

1. Re-read the 20: `SELECT date, home, away FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL ORDER BY date`. Expected 20. A different number means this document is stale: stop and say so.
2. Run `resolveTeamKey` (`src/identity-resolver.js`) on each of the 40 spellings and print the key beside the club's name as the vendor writes it. A spelling that resolves to nothing, or to the wrong club, is the finding and costs nothing to fix before any call.
3. Search `outbox/` for a recorded Odds API historical payload for any of the five dates (`grep -l '2026-05-09\|2026-05-10\|2026-05-13\|2026-05-17\|2026-05-24' outbox/odds-*.json`); if one exists, run the relay's join over it offline. If none exists, say so; do not infer.
4. The cost, from the route's measured price: **5 distinct dates x 30 credits = 150 credits** (one `sport=EPL` call per date; the 20 rows share five dates). Written with its source: the nine-date run of 2026-11-22 moved the provider's `quota_remaining` by exactly 30 per call, eight times.
5. Which 12 priced EPL rows have no draw, and are they one cohort? `SELECT id, date, json_extract(opening_odds,'$.captured_at') FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NOT NULL AND json_extract(opening_odds,'$.moneyline.draw') IS NULL`. Report the list; whether to repair them is a separate decision for the owner, not part of this one.

## Task 1 — the owner's decision

Report Task 0's numbers and stop. The owner may approve a number of credits (150 for all five dates, or fewer dates), approve a one-date probe first (30 credits, 2026-05-09, five rows) to learn whether the vendor's snapshot carries them, or decline (the rows then stay NULL and are listed as accepted in the manifest). Do not proceed on an inferred yes.

## Task 2 — the repair, only after Task 1

Through the existing runner and nothing else: dispatch `odds-backfill-capped.yml` with `preflight_only=true` first (free), then once with the approved dates, `sport=EPL` and `approved_credits`. A price written onto a row with no `start_time` is a noon-snapshot line for a match that may have kicked off at 12:30Z: the route skips a row whose snapshot is after the vendor's `commence_time`, and the runner stops, naming the date, when a date finds games and populates none. Read each answer; do not retry a date.

## Done condition (artifact, not a bare action)

`SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL` returns `0`, with the query and its output committed in the manifest; or the owner has declined in writing and the manifest lists the 20 rows as accepted. If the run stopped on a date, the manifest names the date and the stop line verbatim and the remaining count. "The backfill ran" is not a done condition.

## Task 3 — outbox manifest (last task)

`outbox/cc-session-<date>-epl-june-seed-rows.md`: the Task 0 numbers with sources, the owner's decision verbatim, the calls made and the provider's `quota_remaining` after each, the done-condition query output, and the 12 no-draw rows' list.

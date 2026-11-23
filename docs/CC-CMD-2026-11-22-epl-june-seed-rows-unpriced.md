# Claude Code Command — Twenty EPL rows seeded on 2026-06-15 have no kickoff time and no odds

**Date:** 2026-11-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (data repair, billed; the decision is the owner's)
**Status:** DONE 2026-11-23. The owner approved the probe ("Probe"), the other four dates ("Approve 120") and, for the last row, "Alternative" (a snapshot-time option on the route plus 30 credits). All 20 rows are priced; the done-condition query returns 0. Session doc: `outbox/cc-session-2026-11-23-epl-june-seed-probe.md`.
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

## Results, 2026-11-23

**Task 0 (no spend):**
1. The 20 rows re-read: 5 on 05-09, 4 on 05-10, 1 on 05-13, 2 on 05-17, 8 on 05-24. Expected 20, found 20.
2. `resolveTeamKey` on all 20 spellings: every one resolves; `Sunderland AFC` and `Sunderland` give one key, `Brighton & Hove Albion` and `Brighton and Hove Albion` one key, `AFC Bournemouth` and `Bournemouth` one key. These are the archive's spellings against spellings written from memory in the style the vendor uses, NOT recorded vendor names.
3. No recorded vendor payload for any of the five May dates exists in `outbox/` (the one file that names a date, `odds-reachability-by-league-2026-09-14T12-58-45-023Z.json`, lists the archive's own last row date, not a payload).
4. Cost: 30 credits per sport-date; five dates 150.
5. The 12 priced EPL rows with no draw price are two cohorts: **4 rows of 2026-05-17** (this seed batch; `captured_at` 2026-06-16T03:01:03Z, a wall-clock stamp a month after the match) and **8 rows of 2026-08-22, 08-23 and 08-24** (`captured_at` about 10:00Z on the match date, two-way moneylines, written by the live snapshot, not the backfill). The second cohort is not part of this CC-CMD and is not explained; it needs its own look.

**The probe (Task 2, the owner's word "Probe", 30 credits):** the first dispatch (run `45219835408`) was **refused before any request**: the runner's cap counted the nine result files of the earlier EPL run against a lifetime limit of nine ("9 sport-date(s) already attempted and 1 asked for: more than the cap of 9"). Nothing was spent and no file was written. That was a defect in the runner, not in the plan: the premise "reuse the runner" in this document had not been run. Fixed in `e56d8a5b` (the ceiling is per run; the once-per-date ledger and the owner's number per run stay). The second dispatch, run `45220297965`, answered: HTTP 200, `ok true`, `sport EPL`, `games_found 5`, `odds_populated 4`, `odds_skipped 1`, no `guarded`, no `stopped`; result file `outbox/odds-backfill-epl-2026-05-09-20261123T164645Z.json`.

**What it wrote (D1, read-only after the run):** Brighton v Wolves -360/500/900, Fulham v Bournemouth 165/265/155, Man City v Brentford -275/475/650, Sunderland v Man United 275/265/-105: all draftkings, **three-way**, `captured_at` 2026-05-09T11:55:37Z (the snapshot the vendor served; the row has no kickoff time, so the route compared the snapshot with the vendor's own `commence_time` and priced only rows whose match was still to come). **Liverpool v Chelsea stays NULL**; the route reports one skip without saying why. Not established: a 12:30 BST Saturday kickoff is 11:30Z, before the 11:55Z snapshot, which would make the late-snapshot guard the reason, but the vendor's `commence_time` for that event was not read, so this is a candidate and not a finding. If it is the reason, no noon-snapshot call can ever price that row and it needs another source or an accepted NULL.

**Cost:** one call at the measured 30 credits per call. The provider's `quota_remaining` read 90084 after it; the previous run ended at 90264 the day before and other consumers have spent since, so no difference can be taken from it. The ledger estimate is 30.

**Remaining:** 16 unpriced EPL rows: 05-09 (1), 05-10 (4), 05-13 (1), 05-17 (2), 05-24 (8). **Recommendation for Task 1: the other four dates, 120 credits, 15 rows**; the probe shows the vendor history carries May 2026 and that the join works for these rows. Liverpool v Chelsea is a separate question (above). The owner may approve 120, a different set of dates, or stop here (the 16 are then listed as accepted).

## Results, the four-date run (2026-11-23, "Approve 120")

- **Run:** `45220681119`, dispatched 16:48:39Z, `dates=2026-05-10,2026-05-13,2026-05-17,2026-05-24`, `sport=EPL`, `approved_credits=120`. Four answers, each HTTP 200, `ok true`, `sport EPL`, no `guarded`, no `stopped`: 05-10 found 4 / populated 4; 05-13 1 / 1; 05-17 2 / 2; 05-24 8 / 8. Result files `outbox/odds-backfill-epl-2026-05-{10,13,17,24}-*.json`, committed by the run.
- **Cost, measured:** the provider's `quota_remaining` after each call was 90054, 90024, 89994, 89964; the reading before the first was 90084 (the probe's). Four consecutive differences, **each exactly 30**, so all four calls are measured at 30 credits, 120 in all. With the probe, the five May calls cost 150.
- **What was written:** 15 rows, all draftkings, **all with a draw price**, `captured_at` 11:55:37Z on each row's own date. `change_log` (read-only, grouped by minute) holds 4 `opening_odds` rows written at 2026-11-23T16:46 (the probe) and **15 at T16:48** (this run), every one with `old_value` NULL; the undo for either is those rows.
- **Done-condition query:** `SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL` returns **1**, the row `2026-05-09-epl-liverp-chelse`. Not 0.
- **The one row left, and what is not known:** the route skipped it on 2026-05-09 without saying why. A 12:30 BST Saturday kickoff is 11:30Z, before the route's noon snapshot (11:55Z served), which the late-snapshot guard refuses as "in play", so that is the candidate; the vendor's `commence_time` for that event was not read, so it is not established. The route has no snapshot-time parameter, so if the candidate is right no call it can make prices this row. A second call for that date is also refused by the runner (a date is attempted once). **Recommendation: accept it as NULL** and list it as accepted in the manifest. The owner may instead ask for a snapshot-time option on the route (new work, not built, a further 30 credits for the one row), or decline.

## Results, the last row ("Alternative", 2026-11-23)

- **The premise, tested before anything was built:** Liverpool v Chelsea (2026-05-09, `espn_event_id` 740950) started at **11:30Z** (ESPN, read through the relay's own `/v2/games?sport=epl&date=2026-05-09`); the other four matches of that date started at 14:00Z (three) and 16:30Z. So the route's noon snapshot (the vendor served 11:55Z) was after kickoff and the late-snapshot guard correctly refused the line. This turns the earlier "candidate" into the established cause (the kickoff came from ESPN, not from the vendor's `commence_time`).
- **Built:** `?snapshot=HH:MM` on `/archive/odds-backfill` (commit `b487b9cc`, on `main` as `ade0dd81`): a UTC time of day asked of the vendor instead of noon; default unchanged; refused 400 before any billed call if it is not HH:MM; `snapshot` echoed when not the default; the guard still refuses a line taken after kickoff. The runner takes `BACKFILL_SNAPSHOT`, keys its once-per-date ledger by date and snapshot, and runs a second free preflight (`?snapshot=99:99` must be answered 400). Deploy `45230778732` green; the free preflight (run `45233566069`) printed `... answered 400 to a snapshot that is not a time, so it honours ?snapshot=`.
- **The run:** `dates=2026-05-09 sport=EPL snapshot=09:30 approved_credits=30`, dispatched 18:08Z; the answer: HTTP 200, `ok true`, `sport EPL`, `snapshot "09:30"`, `games_found 1`, `odds_populated 1`, `odds_skipped 0`, no `guarded`, no `stopped`. Result file `outbox/odds-backfill-epl-2026-05-09-s0930-20261123T180834Z.json`.
- **What was written:** `2026-05-09-epl-liverp-chelse`: draftkings, three-way **-110 / 280 / 290** (home / draw / away), `captured_at` **2026-05-09T09:25:37Z**, 2 h 4 min before the 11:30Z kickoff. `change_log`: one `opening_odds` row, `old_value` NULL, 18:08:35Z.
- **Cost:** one call at the price measured on the two earlier runs (30 credits per call, twelve consecutive 30-credit steps). This call's own debit is not isolated: `quota_remaining` read 89922 after it against 89964 after the last run, a difference of 42, so other consumers spent in between; the ledger estimate is 30.
- **Done-condition query:** `SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL` returns **0** (read after the run). Met.
- **Total for this CC-CMD:** six billed calls, **180 credits** (the one-date probe 30, four dates 120, this 30), 20 of 20 rows priced, every one a three-way line captured before its match.
- **An independent review of this change** (13 agents) found nothing touching spend or this row; its confirmed low findings are listed in the session doc and fixed in a follow-up commit.

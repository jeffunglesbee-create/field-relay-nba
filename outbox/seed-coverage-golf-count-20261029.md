# seed-coverage.yml: PGA Tour read as a gap for four days because the check counted a row the archive no longer writes

Date: 2026-10-29. Fix: `7ca94ee`. Live proof: workflow run 40963238016 (workflow_dispatch, sha `7ca94ee`).

## What was red

`seed-coverage.yml` failed on its scheduled runs of 2026-10-26, 10-27, 10-28 and 10-29 (runs 62, 63, 64, 65) with
`PGA Tour — 1 fixture(s) on ESPN pga, 0 rows in /context/date`, 12 of 13 checks. It had passed every day 2026-10-17 to 10-25. The
silently-dead-crons watch of 10-29 listed it as NEW in the dead-cron ratchet (failing 3 consecutive runs).

## Cause

The live half counted archive rows with `sport` equal to the competition label (`'PGA Tour'`). For golf that row is the category error
`scripts/check-individual-sports-not-archived.mjs` was written to forbid: the catch-up took the top two players of a leaderboard as two
sides (names null). Golf is archived by the golf-aware path as `sport='golf'`, `league='PGA Tour'`, one row per round.

D1 (`regular_season_games`, read 2026-10-29):

| date | `sport='golf'`, `league='PGA Tour'` | `sport='PGA Tour'` |
|---|---|---|
| 2026-10-22 | 1 | 1 (created 2026-10-23 00:00:48) |
| 2026-10-23 to 10-27 | 2, 2, 2, 2, 1 | 0 |
| 2026-10-09 to 10-12 (previous event) | 2, 2, 2, 1 | 1, 1, 1, 1 |

The check tests the date four days before its run (the committed output of each run names it). The 10-25 run read 10-22, where the one
`sport='PGA Tour'` row existed, so it passed on the defective row; the 10-26 run read 10-23, where none exists. The check was never counting golf; it was counting the bug.

## Fix

`archivedCount` in `scripts/check-seed-coverage.mjs`: an `individual:true` competition counts rows with `sport` = its ESPN sport and
`league` = its label; the category-error row does not count, so a regression of the earlier fix cannot read as coverage. The cron-table
parser now reads the `individual` flag. Self-test 17 of 17; `scripts/mutate-seed-coverage.mjs` 6 of 6 caught (first draft of the wiring
assertion contained its own needle and could never fail; S6 found it). Wired into `guards.yml` and `deploy.yml`.

## Result (artifact)

`outbox/seed-coverage-latest.txt` from run 40963238016, live half 2026-10-26: `PGA Tour  1 fixture / 2 archive rows`, no GAP,
`PASS 13/13 checks passed`. The 2 matches D1's two golf rows for 2026-10-26.

## Not established

Which deploy stopped the catch-up writing `sport='PGA Tour'` rows between 2026-10-23 00:00Z and 10-24 00:00Z. The gate that forbids them
(`check-individual-sports-not-archived.mjs`) first appears in commit `65c3e27` of 2026-10-21, a commit labelled as a bot's site-drift
watch. It does not change the fix: the rows are forbidden by design and golf rows exist for every day.

## Expected next

The silently-dead-crons watch (12:15Z daily) should drop `seed-coverage.yml` from NEW after the next green scheduled run (15:30Z).

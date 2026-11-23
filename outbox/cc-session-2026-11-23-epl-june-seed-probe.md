# Session doc — one-date probe of the 2026-06-15 EPL seed rows

**Date:** 2026-11-23 · **Repo:** field-relay-nba · **Branch:** main · **CC-CMD:** `docs/CC-CMD-2026-11-22-epl-june-seed-rows-unpriced.md` (IN PROGRESS, blocked on the owner for further spend)
**Owner decision, verbatim:** "Probe" (the 30-credit one-date probe the CC-CMD's Task 1 offered: 2026-05-09, five rows). Nothing beyond it is approved.

## Done condition so far

`SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL` was 20 before the probe and is **16** after it (read 2026-11-23 after run `45220297965`). Not 0: the CC-CMD stays open and says what remains and what the owner decides.

## What happened, in order

1. Task 0 (no spend): the 20 rows re-read (20); every spelling resolves; no recorded May vendor payload exists; the 12 no-draw priced rows are two cohorts (4 of this seed batch, 8 of 2026-08-22/23/24 written by the live snapshot). Results are in the CC-CMD.
2. Dispatch 1, run `45219835408` (16:44Z), inputs `dates=2026-05-09 sport=EPL approved_credits=30`: **`RUN REFUSED: 9 sport-date(s) already attempted and 1 asked for: more than the cap of 9`**, before any request. Nothing spent, no file written, the date not burned. Cause: my runner counted every committed EPL result file against a lifetime cap of nine, so the nine files of the 2026-11-22 run refused every later EPL date. I had written "reuse the runner" into the CC-CMD without running a second dispatch (Rule 100: an untested premise, published). Rule 77: reproduced from the log line, read the code (`run()`, the `done.length + p.dates.length > CALL_CAP` clause), fixed in `e56d8a5b`: the ceiling is per run; the once-per-date ledger and the owner's number per run are unchanged; the date-shape filter on the ledger, which only served the removed count, was removed with its test and mutant. Self-test 49, mutants 39, each caught by its named check; pushed to `main`; no deploy (a script-only push is outside `deploy.yml`'s filter, and the workflow checks out `main`).
3. Dispatch 2, run `45220297965` (16:46Z), same inputs: the runner preflighted, called once, the answer was clean. Result file committed by the run (`outbox/odds-backfill-epl-2026-05-09-20261123T164645Z.json`).

## The answer, and what it wrote

`games_found 5, odds_populated 4, odds_skipped 1`. D1 after: Brighton v Wolves -360/500/900; Fulham v Bournemouth 165/265/155; Man City v Brentford -275/475/650; Sunderland v Man United 275/265/-105; all draftkings, three-way, `captured_at` 2026-05-09T11:55:37Z. Liverpool v Chelsea is still NULL; the reason is **not established** (candidate: a 12:30 BST kickoff is 11:30Z, before the snapshot; the vendor's `commence_time` was not read). Undo: the `change_log` rows for these four ids (`old_value NULL`).

## Spend

One call at the measured 30 credits per call (eight consecutive 30-credit steps on 2026-11-22). The provider's `quota_remaining` after it was 90084; the previous reading was 90264 the day before and other consumers spent in between, so it gives no difference. Ledger estimate 30. The refused dispatch spent nothing.

## Residual

- 16 EPL rows unpriced (05-09: 1, 05-10: 4, 05-13: 1, 05-17: 2, 05-24: 8). The recommendation is the other four dates, 120 credits, 15 rows; the owner decides.
- Eight priced EPL rows of 2026-08-22/23/24 have no draw price and were written by the live snapshot, not the backfill. Not explained, not part of this CC-CMD.
- A nit seen in the run: `Keep the results` uploads every tracked result file matching the glob (the nine of the earlier run too), so a refused run still shows "9 files uploaded". Harmless; not changed (Rule 69).
- `Repo guards` red from the BSD frame-contract step only (unchanged).

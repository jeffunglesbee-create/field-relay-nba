# Odds watches — daily read, 2026-10-22

The read began at 18:33Z, with origin/main at `09c9a5e2`. One reader took the
newest run and committed log of five watches, read `/budget/odds` once, and
went through the open threads. Watch 1 was read directly, then given to three
checkers: two attacked opposite claims (the breach is real; the breach is the
window offset) and one enumerated every vendor caller in four repos. No
credits were spent and nothing was dispatched.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39723216127, 04:35Z, **failure** | **RED, not the breach.** `counter-under-counts` for 2026-10-21: counter 878/3800, vendor billed 1103, known CI 80, residual `+145` (tolerance 55). Aligned to the vendor's own window the residual is `−62`, `we-overcharge-ourselves`. See below | `odds-daily-vs-vendor-2026-10-22T0435.log` |
| odds-attribution-gap | 39796447473, 14:31Z, success | `ok`. 2026-10-21 used 878, by_site_sum 878, unaccounted 0 (within 44). By site: fetchSportOddsHistorical 360, fetchSportOddsLive 291, handleCFLOddsProbs 138, ambientCaptureClosingOdds 81, getWCPregameLambdas 8 | `odds-attribution-gap-20261022T143207Z.log` |
| odds-site-drift | 39793222560, 14:09Z, success | `inconclusive over 2 interval(s) of 3 same-day sample(s)`. Gap 0 at all three samples (used 228, 474, 735) and at the two 10-21 evening samples (566, 803) | `odds-site-drift-2026-10-22T1409.log` |
| odds-pairing-rate | 39807890279, 15:45Z, success | PASS. `UNEXPLAINED -62` (tolerance 69). 10-21T15:48Z to 10-22T15:46Z: provider 1388, ledger 1310, known CI 140 (backfill 39800112995, `credits=140`). Guard fell open: none. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261022T154607Z.log` |
| silently-dead-crons | 39819731719, 17:06Z, **failure** | **RED on false readings.** NEW 6, carried 1 (jubilant-bassoon `nba-clutch-update.yml`), resolved 1 (field-laboratory `verify-full.yml`), overdue 0. All 6 NEW are `DECLARES A CRON, NEVER FIRED`, and each has completed scheduled runs on re-query. Filed | `silently-dead-crons-2026-10-22T17-10-02-628Z.log` |
| undeployed-src | 39792358758, 14:03Z, success | `deployed`, last green `6ef722d`, 0 unbuilt. `e658b09` (17:25Z) deployed after it, run 39822565693, success | `undeployed-src-2026-10-22T1403.log` |
| /budget/odds | read once, 18:38Z | 2026-10-22: 1110/3800, by_site_sum 1110, unaccounted 0, degraded_open 0. Historical 720, live 306, CFL 84 (kept 54). Monthly 40,133/85,000. Provider requests_used 28,669 | relay self-probe |

## Watch 1

**Not the breach.** It is the first `counter-under-counts` in 36 committed
vendor logs, and the window offset already filed as
`docs/CC-CMD-2026-10-13-vendor-residual-window.md` (OPEN) accounts for it.

- **As logged, reproduced:** the script's own `vendorDay` and
  `residualVerdict`, run on the last two series rows, give
  `{counter-under-counts, +145, tol 55}`. The window is 24.0 h, so it is not
  `window-drift`.
- **The two sides are different windows.** The vendor side runs
  10-21T04:36:53Z to 10-22T04:35:30Z. The counter side is the UTC day 10-21.
- **Aligning them needs no model.** Each series row stores the month ledger
  read in the same `/budget/odds` request as the vendor figure: 38,406 then
  39,491, a move of **1,085** over the vendor's window. The month row moves in
  step with the daily rows: they are charged in one D1 batch since 10-18, and
  month − Σdaily read −2,790 at 10-19T17:18Z, 10-20T15:32Z, 10-21T15:48Z,
  10-22T15:46Z and 18:39Z.
- **The slices.** The counter stood at 261 at 10-21T04:36:53Z (site-drift
  bracket 183 at 02:11Z to 267 at 08:02Z) and at 468 at 10-22T04:35:30Z
  (bracket 228 at 02:05Z to 474 at 08:00Z). The vendor-only slice outweighs
  the counter-only slice by 207.
- **Aligned residual:** 1103 − 1085 − 80 = **−62**, tolerance 55, so
  `we-overcharge-ourselves`. With known CI at 0 it is +18, `tracks-the-bill`.
  No CI value gives `counter-under-counts`.
- **Sub-windows** (split at the pairing watch's readings): 04:36Z→15:48Z on
  10-21, vendor 197 = ledger 117 + CI 80, residual 0; 15:48Z→04:35Z, vendor 906
  against ledger 968, residual −62, and that 62 is the day's over-record
  (handleCFLOddsProbs charged 138, kept 84; getWCPregameLambdas 8, kept 0).
- **No unrecorded caller ran.** Of the workflows in four repos, only five hold
  the vendor key, all in this repo, and only `odds-backfill` ran in the window
  (39621250271; its job log reads `credits=80`). The two deploys in the window
  mention the key in a comment only. Every relay call site charges through
  `chargeOdds`, and `check-odds-calls-guarded` passed in all three deploys live
  in the window. An unseen caller would push the residual further negative.
- **Why the vendor-only slice was heavier: an inference, not proven.**
  `fetchSportOddsHistorical` (30 credits a call) also runs from
  `runOddsBackfillForDate` on the 15-minute cron in dead hours (03:00–09:59Z).
  Between the drift samples it rose by 7 calls on 10-22 and by 2 on 10-21.

The defect is the window, as filed. It now produces a false breach as well as
false overcharges. Its priority is the owner's call.

## The other watches

- **silently-dead-crons** is red for the first time since 10-17, on six
  false readings. The watch files a workflow as never fired after one empty
  2xx answer. The same query, re-run afterwards, returned three completed
  scheduled runs for each. The cause of the empty answers was not observed.
  Filed with a TASK 0 that tests it first:
  `docs/CC-CMD-2026-10-22-dead-cron-watch-one-empty-read.md`. Do not add the 6
  to the baseline.
- **pairing-rate:** the line `positive — the vendor billed…` describes
  `escaped` (78), not UNEXPLAINED (script line 795). Unchanged from earlier
  reads.
- **/budget/odds:** 10-22's CFL row charged 84 and kept 54. One cell is state
  `error` with cache HIT, kept 6: the vendor was not contacted for it.

## Open threads

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **DONE** | Built 10-21 (`d9ba2dbe`, artifact `odds-consumer-demand-20261021T224035Z.log`, run 39688177856). Modelled 10-14..20: demand 1323, charged 14349, kept 10082 |
| per-consumer ceiling (Task 3) | **unblocked**, not dispatched | Its only blocker was Task 2. Its own Results warn that a ceiling set from current spend would encode defects, and the closing-capture fixes are still being verified (10-23..10-25). The owner's call |
| ~19,700 offset | level only | Ledger − vendor: 11,568 (04:35Z), 11,428 (15:46Z), 11,464 (18:38Z). 11,506 yesterday |
| soccer pairing at 0 | blocked | Backfill 10-20: UCL 9 events, 0 paired by name. 10-21: UCL 18 out of window. The unblock needs a fixture that spends credits |
| odds charge survives cancellation | blocked | Until the 2026-10-25T06:30Z read. Month − Σdaily is still −2,790 |
| targeted fill | blocked | The owner's approval to spend. Newest run still 2026-09-23 |

## The stored prompt for this read is still stale

Last updated 2026-09-19. "Tolerance 120" (69 today); "four consecutive days …
3799-3800" (10-21 closed at 878); the atomic-counter CC-CMD as the fix (the
one-batch charge landed 10-18/19). Editing it is the owner's call.

## Coverage

- Five watch workflows: newest run and committed log each, read through the
  Actions API (GET only), plus two backfill job logs through the GitHub MCP.
- Watch 1: the log, the series file, the site-drift series, the pairing series,
  and D1 SELECTs on `odds_budget`, `odds_budget_site`, `odds_budget_month` and
  `odds_reconcile_state`.
- workers.dev: one `GET /budget/odds` through the relay self-probe. Its vendor
  call is `/v4/sports`, which costs 0 credits.
- Not read: individual call timestamps. Nothing records them, so the slices
  are bracketed by the month ledger and the site-drift samples, not timed.

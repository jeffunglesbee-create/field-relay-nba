# Odds watches — daily read, 2026-10-16

Read at 18:43Z from each watch's committed artifact and the Actions API (GET only). No credits spent, nothing dispatched, workers.dev not reached. HEAD `d62ae78`.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 38850430471, 04:24Z, **failure** | **RED** — `we-overcharge-ourselves` for 2026-10-15. Residual `-66` (tolerance 50): vendor 774, counter 720, known CI 120; `unreconciled estimate : 0`. Second step `daily-exceeds-monthly`, EXCESS 931 (1.03x) | `odds-daily-vs-vendor-2026-10-16T0424.log`, `odds-daily-vs-monthly-20261016T042421Z.log` |
| odds-attribution-gap | 38912060122, 13:58Z, success | `ok`. 2026-10-15 `used 720`, `by_site_sum 720`, `unaccounted 0` (within 36) | `odds-attribution-gap-20261016T135851Z.log` |
| odds-site-drift | 38947605531, 18:28Z, success | `inconclusive over 3 interval(s) of 4 same-day sample(s)`, gap 0 at every sample. 2026-10-16 `used 1002` at 18:28Z, no veto | `odds-site-drift-2026-10-16T1828.log` |
| odds-pairing-rate | 38921393984, 15:07Z, success | PASS. `UNEXPLAINED : -6` (tolerance 50). Known CI 120 is a lower bound. Degrade line `none — 0` (`= 2026-10-15 close 0 - 0 at the last reading + 0 today`). D1 closed day 2026-10-15: `none`, 0 overloads, month-batch 0 | `odds-pairing-rate-20261016T150751Z.log` |
| silently-dead-crons | 38932963870, 16:34Z, success | green. `NEW, not in the baseline : 0`. field-relay-nba `FAILING 3 CONSECUTIVE RUNS : 0`, `NEVER FIRED : 0` | `silently-dead-crons-2026-10-16T16-37-31-160Z.log` |
| undeployed-src | 38941444736, 17:40Z, success | `deployed`, last green `c6f094a`, 0 unbuilt. Read 40 min before `fc2b78f` was pushed | `undeployed-src-2026-10-16T1740.log` |
| /budget/odds | (no direct read) | 2026-10-15 closed at 720/3800. 2026-10-16 at 366 by 15:07Z and 1002 by 18:28Z, `ceiling_reached_at` null | via 38850430471, 38912060122, 38921393984, 38947605531 |

## Watch 1

Arithmetic: 774 − 720 − 120 = −66. Known CI is a lower bound, so the printed residual is an upper bound. The true residual is ≤ −66, so 2026-10-15 cannot be a breach.

The cause is the same as in `docs/CC-CMD-2026-10-13-vendor-residual-window.md` (OPEN, Task 1 not built). The vendor window ran 10-15T04:29:22Z → 10-16T04:24:18Z, but the counter it is compared with covers the UTC day. The series row this run committed was read at the vendor's own instants: `ledger_month_used` went 27,126 → 27,792, a move of 666. Against that, 774 − 666 − 120 = **−12**, inside 50. That is my arithmetic on the row, not the watch's verdict. The pairing watch's own 23.7 h interval reads −6.

The second step, `daily-exceeds-monthly`, summed 14 contained days to 28,561 against a monthly move of 27,630. EXCESS 931 is a floor. The log itself says it does not say which counter is wrong.

**Done condition (`docs/CC-CMD-2026-09-19-daily-vs-vendor.md`).** 25 closed days now carry a verdict across 30 committed logs:

- 23 are `we-overcharge-ourselves`.
- 2 are `tracks-the-bill`: 10-01 (−45) and 10-06 (+38).
- 0 are `counter-under-counts`.
- 3 days have no verdict: 09-18 `no-data`, 09-19 `window-drift`, 09-30 `month-boundary`. On 10-11 the 00:10 read returned `window-drift`, but the 05:48 re-read gave a verdict.

The three-day requirement is met. The outcome matches neither named branch. No day is a breach, and 23 of 25 sit outside tolerance on the negative side. Closing the CC-CMD needs a ruling.

## The CFL figure at 18:28Z

From site-drift run 38947605531:

- `handleCFLOddsProbs`: `by_site` 666, `credits_kept` 102 (54 MISS + 48 EXPIRED), 256 cache-hit calls.
- At 13:34Z (run 38908933793), the same site read 30 / 30 with 5 hits.
- The day's used − kept is 1002 − 438 = 564, and all of it is this site. `fetchSportOddsLive` (186/186) and `fetchSportOddsHistorical` (150/150) match.

This is the same pattern as P5 in the residual-window CC-CMD (10-12T20:28Z: 666 against 66). No cause is named. Tomorrow's vendor row is the command that tests whether the 564 was billed: vendor delta against ledger delta over 10-16T04:24Z → the next reading.

## Yesterday's reds, today

- `odds-daily-vs-vendor`: still red, the third consecutive failure (38513121041, 38681708641, 38850430471). Both the Watch step and the daily-vs-monthly step failed. The refusal-streak step passed.
- `silently-dead-crons`: red on 10-14 (38603754628), green on 10-15 (38773002735) and 10-16 (38932963870).

## Due tomorrow

The three `silently-dead-crons` baseline entries all carry `review_by 2026-10-17`. `overdueReviews` uses `by < today`, so the **2026-10-18** run fails by name unless each entry is resolved or re-dated with a reason in the same commit. Each unblock action is a read:

- field-laboratory `verify-full.yml`: read run 34839968312.
- jubilant-bassoon `nba-clutch-update.yml`: read run 30618071472.
- jubilant-bassoon `soccer-fbref-mls.yml`: check whether its schedule block parses, or whether the workflow is disabled.

## Open threads against today's evidence

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **unblocked**, not built | 38912060122 is the 10th consecutive closed day at `unaccounted 0` (10-06 → 10-15). Demand needs no credits. `by_site` breaks down the counter, not the bill |
| per-consumer ceiling (Task 3) | blocked | Blocked on Task 2. Also, `handleCFLOddsProbs`'s own `by_site` and `kept` differ by 564 at 18:28Z |
| ~19,700 offset | blocked | Unblocking it needs the vendor's per-day history from before 09-05. After the 10-01 reset the counters read 159 / 162. Ledger − vendor is now **+10,041** (27,792 vs 17,751, run 38850430471) and +9,921 (27,960 vs 18,039, run 38921393984): the opposite sign to September's. The series rows read +9,935 (10-12), +10,057, +10,149, +10,041 |
| soccer pairing at 0 | blocked | The pairing watch counts by date, not by sport (its own COVERAGE line). odds-backfill 38917483900 (14:39Z, success) commits no per-sport output, and its job log is served from a host this sandbox does not reach. The unblock (a soccer fixture) spends credits |
| CFB done condition | blocked | Same blind spot. CFB Saturdays 10-03 and 10-10 are inside the 14-row window, and every row paired at least one game, but a date that mixes paired and unpaired sports reads as paired |

A per-sport D1 read of `odds_history` (`sport`, `date`, `game_id`) for October would cost no odds credits. It was not run here.

## Corrections to inputs

- The pairing tolerance printed today is **50** = max(50, 5% of 822). 120 is the known-CI (`outsideLedger`) figure.
- `docs/declared-detectors.json`'s `now:` text for `odds-daily-vs-vendor`, which silently-dead-crons prints, still quotes 2026-09-21 (−3,295). Today's residual is −66. The text is stale prose and gates nothing.

## Waiting on the owner

- Any spend, including the soccer fixture. Nothing in this read recommends spending.
- `rotate-relay-secret.yml` with `confirm=ROTATE`: 0 runs.
- Two decisions filed 2026-10-14 are still `OPEN — owner decision`: `/archive/game` auth and the push cron's live-game loop. `CC-CMD-2026-10-14-espn-host-flip.md` is also OPEN, with Task 1 done.
- A ruling on CC-CMD-2026-09-19's consistently negative outcome.

## Coverage

- 7 watches, one newest run each, read from the Actions API and the log that run committed.
- odds-site-drift: all 4 of today's logs read. 4 runs against 7 three-hourly slots.
- undeployed-src: all 4 of today's logs read. 4 runs against 18 hourly :35 slots up to 17:35Z.
- odds-daily-vs-vendor: all 30 committed logs read for the done-condition count.
- /budget/odds: read only through the logs above, never directly.
- Not covered: per-sport pairing, the running worker's build stamp, and anything after 18:43Z.

# Odds counter, TASK 1 — the month row is short, because it is a separate write that can be lost

`docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`, TASK 1.
Measured 2026-10-18 between 18:45Z and 20:15Z. No credits spent, no counter
changed, no route called. Reviewed before commit by an adversarial pass: 30
findings, 26 confirmed, every one folded in below.

**Sources.**
- **The counter tables, read directly** in `field-archive` (read-only
  `SELECT` through the session's Cloudflare D1 connector): `odds_budget`
  (daily), `odds_budget_site` (by site), `odds_budget_month` and
  `odds_reconcile_state`. These are the stored counters, not a copy;
  `/budget/odds` was not called.
- **The month at earlier instants**, from the committed
  `outbox/odds-provider-usage-series.json`. Each of its 17 October readings
  records the month row and the daily counter together; 10-05 has none.
- **Degrade-open witnesses**, from `outbox/odds-site-drift-series.json`.

## Which of the three disagrees

| October, 1st to 18th, at 18:55Z | credits |
|---|---|
| `odds_budget_month` row `2026-10` | **34,369** |
| sum of the 18 `odds_budget` daily rows | 37,135 |
| sum of the `odds_budget_site` rows | 37,135 |

**The month row disagrees, by 2,766.** The daily and by-site figures agree on
every closed day of October, but **that agreement corroborates nothing**. The
two rows are written in the same D1 batch on every charge, and in the same
batch on every correction, so they agree by construction. The CC-CMD's lead
called them "independently written"; they are not, and the 2-against-1 vote it
proposed does not exist. The conclusion that the **month** is the wrong one
rests on the write path instead:
- every charge writes day and site first, then the month in a **separate,
  later** D1 batch;
- no path was found that adds to the day without a matching charge.

So the month can lose a write that the day keeps, and the day cannot gain one
the month lacks.

## When the gap opened

Gap = month − (sum of closed days, from D1, where they are final) − daily
counter at the same instant.

| reading | month | daily then | closed days | gap | change | degrade events that day so far |
|---|---|---|---|---|---|---|
| 10-01 17:13Z | 273 | 273 | 0 | 0 | | 348 |
| 10-02 16:27Z | 708 | 351 | 357 | 0 | 0 | 318 |
| 10-03 15:01Z | 1,561 | 320 | 1,247 | −6 | −6 | 313 |
| 10-04 15:36Z | 4,057 | 492 | 3,595 | −30 | −24 | 437 |
| 10-06 17:01Z | 6,752 | 250 | 6,544 | −42 | −12 | 315 |
| 10-07 17:38Z | 10,066 | 3,799 | 6,995 | −728 | **−686** | 245 |
| 10-08 17:41Z | 10,411 | 351 | 10,794 | −734 | −6 | 124 |
| 10-09 17:16Z | 11,030 | 489 | 11,275 | −734 | 0 | 149 |
| 10-10 16:04Z | 15,232 | 1,478 | 14,500 | −746 | −12 | 410 |
| 10-11 16:29Z | 21,248 | 3,800 | 18,300 | −852 | −106 | 1,183 |
| 10-12 20:05Z | 23,214 | 2,176 | 22,100 | −1,062 | −210 | 0 |
| 10-13 17:53Z | 25,365 | 642 | 25,899 | −1,176 | −114 | 0 |
| 10-14 15:40Z | 25,428 | 42 | 26,586 | −1,200 | −24 | 0 |
| 10-15 15:28Z | 27,252 | 372 | 28,198 | −1,318 | −118 | 0 |
| 10-16 15:07Z | 27,960 | 366 | 28,918 | −1,324 | −6 | 0 |
| 10-17 14:01Z | 30,975 | 1,002 | 31,786 | −1,813 | −489 | 0 |
| 10-18 14:14Z | 33,510 | 818 | 35,106 | −2,414 | −601 | 0 |
| 10-18 18:55Z (D1 direct) | 34,369 | 2,029 | 35,106 | **−2,766** | −352 | 0 at 17:37Z |

Two periods, which the evidence treats differently.

**1. To 10-12 (−1,062, 38% of the gap).** The largest single step, **−686,
25% of the total**, came between 10-06 17:01Z and 10-07 05:50Z:
- The vendor series puts the month at 10,063 at 05:50Z, and from there to
  17:38Z it moved only +3.
- That is the 10-07 burst. The daily ceiling went at 01:16:29Z, with
  `getWCPregameLambdas` at 2,536 by site, charged then on every `/v2/games`
  request, and `handleCFLOddsProbs` at 1,062.
- That day recorded 245 degrade events and 1,263 credits **with no reason**:
  reasons were not stored until 10-08.

From 09-23 to `12e310a6` (10-11 19:29Z) the month path threw on every charge
(`returned 2 result(s), expected 3`). Those throws came after the batch had
committed, so they lost nothing: 10-09 had 149 of them and the gap moved 0. A
throw **before** commit does lose the month write, and
`month: D1_ERROR … overloaded` was recorded 4 times on 10-10 and 56 times on
10-11. For this period, a month batch that threw before committing is observed
in part and cannot be excluded for 10-07.

**2. From 10-12 (−1,704, 62%).** Every degrade reading since 10-12 shows 0
events, including site-drift samples late in each day (23:59Z on 10-13,
23:04Z on 10-16, 22:44Z on 10-17, 17:37Z on 10-18). A thrown month batch is
therefore **not witnessed** in the period carrying most of the gap. The
witness, `_countDegradeOpen`, is a best-effort KV read-modify-write with an
empty catch, so it can undercount, but not to 0 while it is writing at all.

## The fingerprint: missing, not double-counted, not a boundary

- **Not a double-counted day.** That would put the month above its days.
- **Not a write across the day boundary.** The gap grew 352 inside one UTC
  day (14:14Z to 18:55Z on 10-18). Charges and corrections key the day and
  the month from the same UTC clock.
- **Missing month writes**, in steps that coincide with heavy charging: the
  10-07 burst, and 10-17 to 10-18.

## What causes a missing month write, and how sure

Ruled out:
- **A second writer in code.** The worker writes `odds_budget_month` only
  through `SQL_MONTH_SEED`, `SQL_MONTH_CHARGE` and `SQL_FIX_MONTH` in
  `src/budget-helpers.js`.
- **A script or workflow.** None writes it; the `scripts/mutate-*` hits are
  local tests.
- **Ad-hoc writes, only partly.** `/d1/execute` can write all three tables for
  anyone holding the relay secret. Nothing shows it was used that way, and
  steady mid-day growth argues against it, but it is not excluded.
- **Reconcile.** It applies one delta to day, site and month in one batch.
- **The seeds and the clamps.** The seeds touch only a day's or month's first
  row, and the gap grows mid-day. `MAX(0, …)` cannot bind on rows in the
  thousands.

Remaining, in order of evidence:

1. **The month batch throws before committing.** Observed (D1 overload, 10-10
   and 10-11). Unrecorded on 10-07. Unwitnessed since 10-12.
2. **Execution stops between the two batches.** Inferred, not observed.
   Cloudflare's runtime documentation says a client disconnect cancels the
   invocation's execution context unless the work is under
   `ctx.waitUntil()`, and none of the charge path is. No outcome data exists
   to confirm it for a past day: Workers analytics reports disconnects per
   script, not per path, and the relay has no Workers Logs or Tail consumer.

**The CFL route strands calls, and the reason is not known.** Per site,
by-site spend against reconcile's tally for the calls that reached it:
- Every site except two matches to the credit on every full tally day: the
  closing-odds capture, live and historical fetches, ambient live odds.
- `handleCFLOddsProbs` does not. A reconciled CFL call ends at 0 (an
  edge-cache hit is refunded) or at 6, so `(by_site − kept) / 6` counts the
  calls charged and never reconciled.

| day | CFL by site | CFL kept | reconciled calls | never reconciled | share |
|---|---|---|---|---|---|
| 10-09 | 90 | 54 | 18 | 6 | 25% |
| 10-10 | 54 | 36 | 12 | 3 | 20% |
| 10-11 | 630 | 48 | 95 | 97 | 51% |
| 10-12 | 666 | 66 | 282 | 100 | 26% |
| 10-13 | 432 | 24 | 160 | 68 | 30% |
| 10-14 | 372 | 66 | 102 | 51 | 33% |
| 10-15 | 90 | 48 | 16 | 7 | 30% |
| 10-16 | 798 | 120 | 319 | 113 | 26% |
| 10-17 | 2,058 | 144 | 670 | 319 | 32% |
| 10-18 (to 18:55Z) | 1,044 | 30 | 528 | 169 | 24% |

**20% to 51%** on every full tally day (10-08, when the tally began, is
partial).

`getWCPregameLambdas` is also request-driven, inside `/v2/games`, and strands
far less. At 4 credits a call, its stranded share runs 0.8% to 5.2% on its
active days (8 of 155 calls on 10-11, 1 of 133, 1 of 57, 5 of 649, 17 of 728
on 10-18). So the split is **CFL against everything else**, not
request-driven against cron. A disconnect would have to strike CFL calls five
to forty times more often than the WC lambdas on the same app. That is not
explained here.

**Excluded as material:**
- **A vendor fetch that throws** (the CFL catch returns 500 without
  reconciling).
- **A correction batch that throws after the tally lands.** Both exist in code,
  but the control sites run the same reconcile code and the same catch shapes,
  and strand nothing.

**Not established:**
- **That CFL's strandings and the month's losses share a cause.** Of the two
  big recent steps, −489 runs 10-16 15:07Z to 10-17 14:01Z and −601 runs
  10-17 14:01Z to 10-18 14:14Z. Neither window lines up with a UTC day's
  never-reconciled total.
- **A ratio between them.** Over a common span the month's loss is smaller
  than CFL's strandings, which is all the data supports.

## The vendor question, answered in part as a side effect

`credits_kept` is the vendor's figure only for states `reconciled` and
`cache-hit`. For `no-header`, `error`, `bad-header` and `no-response` it is our
own estimate. With receipts only, `daily − receipts` is every estimate that was
never replaced by a vendor figure. It is set beside the watch's residual
(`billed − daily − known CI`) below:

| day | daily | receipts | daily − receipts | watch residual | apart |
|---|---|---|---|---|---|
| 10-09 | 3,225 | 2,133 | 1,092 | −1,020 | 72 |
| 10-10 | 3,800 | 1,704 | 2,096 | −1,967 | 129 |
| 10-11 | 3,800 | 2,628 | 1,172 | −1,220 | 48 |
| 10-12 | 3,799 | 3,195 | 604 | −616 | 12 |
| 10-13 | 687 | 279 | 408 | −561 | 153 |
| 10-14 | 1,612 | 1,296 | 316 | −94 | 222, the other way |
| 10-15 | 720 | 678 | 42 | −66 | 24 |
| 10-16 | 2,868 | 2,190 | 678 | −675 | 3 |
| 10-17 | 3,320 | 1,386 | 1,934 | −1,955 | 21 |

Summed over 10-11 to 10-17, the residuals are −5,187 against 5,154
never-replaced estimates, 33 apart. Over 10-09 to 10-15 they are −5,544 against
5,730.

**One class covers the vendor-side over-record on every day the tally covers:
estimates never replaced by a receipt.** There are two sources:
- CFL calls that never reached reconcile, which dominate 10-12 to 10-17;
- `ambientFetchLiveOdds` calls that reconciled with no receipt header (state
  `no-header`: 525, 1,037 and 292 calls on 10-09 to 10-11), which dominate
  those three days.

The single days that miss by more than 100 (10-10, 10-13, 10-14) are the
watch's own read-hour window
(`docs/CC-CMD-2026-10-13-vendor-residual-window.md`); summing over a week
removes most of it. This is a reading of the rows, not a watch verdict, and it
agrees with the 2026-10-18 fourth outcome: the negative residual is
over-record, not a breach.

## Task item 4, and corrections to the CC-CMD's inputs

- **The EXCESS is not only the watch's arithmetic.** The stored counters
  disagree by 2,766. The per-day rows of `odds-daily-vs-monthly-*.log` still
  carry the read-hour window, which is why one row (989 on 10-17) is not a
  measurement of a day.
- **"Independently written" is false** for the by-site and daily rows: same
  batch, both on the charge and the correction.
- **"Red on every run" is false** for `daily-exceeds-monthly`: the 10-04 to
  10-07 and 10-11 logs read `verdict: consistent`, and 10-01 to 10-03 read
  `month-boundary`.

## Spend

No credit was spent. The reads were SQL `SELECT`s on D1, local reads of
committed files and code, and web lookups. No credit-spending workflow was
dispatched. The `odds_budget_site` rows for 2026-10-18 hold only the
production sites above.

The fix options, and the measurement that would tell causes 1 and 2 apart, are
outside this CC-CMD. They are filed in
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.

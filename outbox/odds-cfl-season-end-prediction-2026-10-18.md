# Odds counter, TASK 2 — the CFL season-end prediction, written before the final game

`docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`, TASK 2.
Written and committed 2026-10-18, 28 days before CFL's final game. No credits
spent. Reviewed before commit by an adversarial pass; its confirmed findings
are folded in.

## The end date, looked up rather than inferred

From the league's schedule release (press.cfl.ca, "CIRCLE THE DATE: 2026
SEASON OPENS JUNE 4", 2025-12-09, read 2026-10-18), verbatim:

> The 2026 regular season comes to an end on Saturday, October 24, before
> giving way to the start of the Grey Cup Playoffs on Halloween.
> - Saturday, October 31 | Division Semi-Finals | 3 and 6:30 p.m. ET
> - Saturday, November 7 | Division Finals | 3 and 6:30 p.m. ET
> - Sunday, November 15 | 113th Grey Cup | McMahon Stadium in Calgary | 6 p.m. ET

**CFL's final game kicks off 2026-11-15T23:00Z** (6 p.m. EST). D1 was not
consulted for this.

Fixed for judging:
- **The last close before the final game** is UTC day 2026-11-14, which
  closes 23 hours before kickoff.
- **The pre-window** is 2026-11-08 to 2026-11-14. It has no CFL game, but the
  vendor still lists the Grey Cup.
- **The post-window** is 2026-11-17 to 2026-11-23. It has no CFL game, and
  the vendor lists none. 2026-11-16 holds the end of the game and is reported,
  not judged.

## The premise this document does not accept

The CC-CMD's experiment assumes that when CFL's season ends,
`handleCFLOddsProbs`'s contribution "goes to zero with no code change". The
code says its **charging** does not stop:

1. **It charges before the vendor fetch, with no season or event gate.**
   `consumeOddsCredit(env, oddsCreditCost(_cflUrl), 'handleCFLOddsProbs')`
   comes first (`src/index.js`).
2. **Its only caller keeps calling.** The PWA calls `fetchCFLOddsProbs()`
   from `fetchSchedule()` on page load. It caches only a non-empty answer, so
   after the Grey Cup every load calls again (`jubilant-bassoon`
   `src/legacy/field.js`).
3. **The precedent.** The World Cup ended in July. In October
   `getWCPregameLambdas` still charged on most days, 4 to 76 credits by site
   on its non-zero days since the tally began. Its reconciled calls carried
   no receipt above 0, and the two kept figures above 0 (4 and 8) are `error`
   rows that kept the estimate, not billing.

What the season's end removes is CFL's **billing**: a call with no events
returns a 0 receipt. Charging continues at one call per page load. TASK 1
measured that 20% to 51% of CFL calls are charged and never reach reconcile,
and those keep their 6 credits whatever the season.

So **"the residual did not contract" would NOT exonerate the CFL route**, and
**"it contracted" would not by itself confirm it**. Contraction depends on
page-load traffic as much as on the season. Every judgment below reports
CFL's call volume beside it.

## Recorded now, and to be recorded at the last close

Recorded now (D1 and the committed logs), as the reference:

| | 10-11 | 10-12 | 10-13 | 10-14 | 10-15 | 10-16 | 10-17 | sum |
|---|---|---|---|---|---|---|---|---|
| watch residual | −1,220 | −616 | −561 | −94 | −66 | −675 | −1,955 | **−5,187** |
| daily − receipts | 1,172 | 604 | 408 | 316 | 42 | 678 | 1,934 | **5,154** |
| CFL by site | 630 | 666 | 432 | 372 | 90 | 798 | 2,058 | 5,046 |
| CFL by site − CFL receipts | 582 | 600 | 408 | 306 | 42 | 678 | 1,914 | 4,530 |

*Receipts* are `credits_kept` in states `reconciled` and `cache-hit` only. In
the other states the tally keeps our own estimate.

**To be recorded for each day 2026-11-08 to 2026-11-14, before kickoff:** the
same four rows, plus CFL reconciled calls and the watch's verdict. These are
closed days: the D1 rows stay final and the logs stay committed, so if the
recording run fails, the judging run reads them from the same sources. Nothing
recorded is rewritten after kickoff.

## The hypotheses, with numbers, judged over the week rather than by day

Single days carry the watch's read-hour window offset of up to about 220
credits. The reference days miss `daily − receipts` by 3 to 222, so a per-day
bar fails on the very weeks the mechanism was found in. Every test below
therefore uses **sums over the judged days**. Each test was checked against
two reference weeks before it was written down.

**Judged days.** A day counts only if its committed
`odds-daily-vs-vendor` log gives a reconciling verdict
(`tracks-the-bill`, `we-overcharge-ourselves` or `counter-under-counts`). A
refused day (`window-drift`, `no-data`, `month-boundary`) or a missing log is
excluded, and the number judged is reported. **With fewer than 5 of 7 judged
in either window, the result is INCONCLUSIVE**, not a pass or a fail.

The tolerance is the watch's own: `Math.max(50, Math.round(0.05 *
Math.abs(vendorDay)))`, summed over the judged days.

**H-whole (CC-CMD): CFL over-recording is the whole cause.** It predicts the
post-window sums to about zero: |sum of residuals| <= the sum of the daily
tolerances. Contraction is measured against the pre-window sum.

**H-none (CC-CMD): it is none of it.** It predicts the post-window residual sum
within ±50% of the pre-window residual sum, scaled by days judged.

**Spec 2.3's test, made operational.** "Contracts by roughly the recorded CFL
figure" means (post sum − pre sum), per judged day, is at least half the
pre-window's mean daily (CFL by site − CFL receipts). If it is at most a
quarter of that figure, the residual "did not contract". In between is
partial. CFL by site alone overstates the possible contraction, because it
includes billed credits, so the stranded part is the figure used.

**M (this document's): the residual tracks estimates never replaced by a
receipt, in season or out.** It predicts, for the post-window:
- **(a)** CFL by site above 0 on every judged day the app was used, with CFL
  receipts at most 12 a day;
- **(b)** |sum of residuals + sum of (daily − receipts)| <= max(350, 10% of
  sum of (daily − receipts));
- **(c)** CFL's stranded share stays inside 15% to 55%.

Check against the references:
- 10-11 to 10-17: residuals −5,187 against 5,154, a miss of 33 against an
  allowance of 515. **Pass.**
- 10-09 to 10-15: residuals −5,544 against 5,730, a miss of 186 against an
  allowance of 573. **Pass.**

H-whole's bar fails on both reference weeks (residual sums near −5,200
against tolerance sums near 680), as it should while CFL is in season. H-none
compares two windows, so it has no reference-week check. Under M, either
H-whole or H-none can come out either way in November while the mechanism
holds, which is why M (b) is the test of mechanism and the others are reported
beside it.

## What voids the experiment

If, between 2026-11-08 and 2026-11-23, any commit changes any of the following,
the experiment is **VOID** for that reason and is reported as such, not
judged:
- `handleCFLOddsProbs`;
- `consumeOddsCredit`, `checkAndIncrementDailyOdds` or `chargeMonthlyOdds`;
- `reconcileOddsCredit`;
- jubilant-bassoon's `fetchCFLOddsProbs` or `fetchSchedule` call;
- any option of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.

The judging run checks with `git log --since=2026-11-08` on those files in
both repos.

**Added 2026-10-19, before kickoff, so the VOID check stays meaningful.**
`checkAndIncrementDailyOdds` and `chargeMonthlyOdds` no longer exist. Option 1
of the charge CC-CMD landed on 2026-10-19 (`7ec2d03f`, outside the window) and
replaced both with `chargeOdds` in `src/budget-helpers.js`. The judging run
treats a change to `chargeOdds` in the window as VOID, exactly as it would
have treated a change to either of the two it replaced. The landing itself
falls on 10-19 and voids nothing. It does change one input: from 10-19 the
month row is written in the same batch as the day, so the internal gap should
stop growing. The residual rows above are vendor-side and are not affected.

## How this will be judged

Two runs are scheduled into this session as one-shot tasks. Their ids are
recorded in this document's commit message.
1. **2026-11-15T14:00Z:** record the pre-window rows above from D1 and the
   committed logs, and append them here before the 23:00Z kickoff.
2. **2026-11-24T14:00Z:** after the 11-23 verdict lands, judge the
   post-window against H-whole, H-none, spec 2.3 and M. It reports judged-day
   counts, CFL call volumes in both windows, any VOID condition, and every
   failed prediction as plainly as a passed one. It then updates the CC-CMD's
   status.

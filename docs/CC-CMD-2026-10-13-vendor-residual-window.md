# Claude Code Command — the vendor watch's residual compares two different windows

**Date:** 2026-10-13
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect in a watch) plus an open measurement
**Status:** OPEN

## What was read

Closed day 2026-10-12, `outbox/odds-daily-vs-vendor-2026-10-13T0642.log`:

```
  2026-10-12 our counter : 3799 / 3800
  vendor billed that day : 3383
  known CI spend         : 200   (1 run(s), 0 undated)
  residual               : -616   tolerance 169
  unreconciled estimate  : 0 — no call kept an estimate for want of a receipt
  verdict: we-overcharge-ourselves
```

`no-header` is at zero, so the over-recording the 2026-10-11 documents named is
gone, and −616 remains. 2026-10-11's residual after its `no-header` estimate was
−636. This document does **not** name a cause. It lists the premises, the
command that tests each, and what has already been run.

## Premises and the command that tests each

| # | premise | command | result |
|---|---|---|---|
| P1 | the residual compares the UTC-day counter with a vendor window offset from it | the daily counter at the two vendor reading times, from `outbox/odds-site-drift-series.json` | **CONFIRMED, measured.** The vendor window is 10-12T05:48:55Z → 10-13T06:42:50Z. The daily counter read 507 at 10-12T02:50Z and 513 at 09:52Z, and 129 at 10-13T02:17Z. Realigned to the window, the daily counter is about **3,420, not 3,799**, so the offset accounts for about **380 of the 616**. ±10, because 10-13 06:42Z itself was not sampled. |
| P2 | the window-aligned remainder is real over-recording | `ledger_month_used` deltas in `outbox/odds-daily-vs-vendor-series.json`, which ARE taken at the vendor's reading times | **Partly measured.** Over the same window the monthly ledger moved **3,373** against a vendor bill of **3,383**. `odds-backfill` calls the vendor directly (`.github/scripts/odds-backfill.js`, `ODDS_API_BASE`), so its 200 is not in the ledger: relay spend ≤ 3,183, and the ledger is over it by **≥ 190**. The daily counter in the same window is over by about **240**. Both are just above the 169 tolerance. |
| P3 | D1 overload degrades explain it | direction | **REFUTED by sign.** A degrade-open is a vendor call the counter did NOT see. It pushes the residual positive, and this one is negative. |
| P4 | CI spend missing from knownCI explains it | direction | **REFUTED by sign.** Unrecorded CI spend sits in the vendor figure and is not subtracted. It makes the residual larger, not more negative. |
| P5 | `handleCFLOddsProbs` keeps charges it never reconciles | per-site `by_site` against the reconcile tally's `credits_kept`, in the same drift sample | **ANOMALY, not a cause.** At 10-12T20:28Z, `by_site` 666 against `kept` 66: a gap of 600. `fetchSportOddsLive` charges through the same `consumeOddsCredit` and shows no gap. But 600 is **larger** than the whole window-aligned excess (~240), so this gap cannot simply be over-recording. The tally reads the INTENT of a correction, not whether it landed (`creditsKeptBy`'s own comment). Next command: the Worker log's `[odds-reconcile]` and `[odds-reconcile-tally]` warnings for this site, and the same per-site comparison across every drift sample since 10-09. |

## Task 1 — the watch reads the window it actually measures

`watch-odds-daily-vs-vendor.mjs` takes the vendor delta over its two reading
times and subtracts the **UTC day's** counter. Those are different windows by
~6 h at each edge, and spend is not uniform across the day: about 510 of
10-12's 3,799 landed before 05:48Z. The residual must be computed against a
counter taken at the same instants. `ledger_month_used`, already on every
series row, is exactly that. Print both: the window-aligned residual is the
verdict, and the UTC-day figure stays as a diagnostic, labelled.

Self-test: the real 10-12 pair must give a window-aligned residual of
`3383 − 3373 − 200 = −190` and NOT −616. Mutation: put the UTC-day counter back,
and the mutation must be CAUGHT.

## Task 2 — P5, before any fix

Run P5's command over every drift sample since 2026-10-09 and report per site:
`by_site − Σ kept`, the number of cache-hit calls, and whether the gap moves
with them. Read the Worker's `console.warn` output for the reconcile correction.
Name the site and mechanism only when a command has failed to refute it.

## Done conditions

1. The watch's verdict is the window-aligned residual, with the real 10-12 pair
   at −190 in its self-test and the mutation CAUGHT.
2. P5 is either explained by a named mechanism with the command that showed it,
   or shown not to bear on the residual.
3. The first scheduled run after Task 1 prints both figures.

## Do not

- Do not dispatch `odds-daily-vs-vendor.yml`. It differences two readings, and
  an off-schedule reading splits the next window (HANDOFF.md).
- Do not "fix" `handleCFLOddsProbs` on P5 alone. Its gap is bigger than the
  thing it would be fixing.

## Data points

- **2026-10-31, the window-aligned residual by hand for the eight closed days 10-23 to 10-30** (Task 1 is not built, so the watch still prints the UTC-day figure; this is Task 1's formula, vendor delta − `ledger_month_used` delta − known CI spend, computed from the committed `outbox/odds-daily-vs-vendor-series.json` rows and the `known CI spend` line of each day's log; windows 23.8 to 24.6 h; negative = the ledger recorded more than the vendor billed):

  | closed day | vendor Δ | ledger Δ | known CI | window-aligned | the watch's UTC-day verdict |
  |---|---|---|---|---|---|
  | 10-23 | 811 | 711 | 100 | **0** | `counter-under-counts` (+75) |
  | 10-24 | 2120 | 2333 | 200 | −413 | `we-overcharge-ourselves` (−404) |
  | 10-25 | 1323 | 1083 | 240 | **0** | `we-overcharge-ourselves` (−225) |
  | 10-26 | 378 | 228 | 180 | −30 | `tracks-the-bill` (−12) |
  | 10-27 | 445 | 411 | 160 | −126 | `tracks-the-bill` (+24) |
  | 10-28 | 636 | 752 | 120 | −236 | `we-overcharge-ourselves` (−75) |
  | 10-29 | 650 | 1038 | 140 | −528 | `we-overcharge-ourselves` (−674) |
  | 10-30 | 445 | 691 | 160 | −406 | `we-overcharge-ourselves` (−631) |

  Two readings. **(1) The one `counter-under-counts` verdict in this series after the owner's 2026-10-18 ruling, on 10-23, is a window artifact:** its window-aligned residual is exactly 0, so the enforcing counter did not under-count that day; the +75 was the UTC-day counter (636) read against a window whose ledger delta was 711. This is premise P1 of this document, observed on a day it flipped the verdict's sign. It had not been recorded in any CC-CMD, and the watch's own text calls that verdict "THE BREACH". **(2) The window-aligned residual is not small on the last three days (−236, −528, −406)**, and the days with the largest over-record are the days `handleCFLOddsProbs` carries (10-30: `by_site` 696 against 150 credits kept by `reconcile`, 451 cache hits at 0, read from `GET /budget/odds?date=2026-10-30`), which is P5. Both stay inside the ruling of 2026-10-18 (a one-directional over-record is headroom thrown away, never spend; do not fix the over-record yet). Not a verdict: no `counter-under-counts` is observed after window alignment in these eight days, and the CFL season ends inside the CFL VOID window (2026-11-08 to 2026-11-23), after which `handleCFLOddsProbs` should stop contributing. **Unblocked, a watch-only change with no credits and no change to the counter:** Task 1 (the watch prints the window-aligned residual). Verify with the command in Done condition 1.

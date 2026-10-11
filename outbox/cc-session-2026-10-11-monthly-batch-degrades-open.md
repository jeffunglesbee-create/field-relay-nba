# CC session — 2026-10-11e — the monthly guard threw on every call

**HEAD:** `32e9bc4` → see the manifest below.
**Documents:** `docs/CC-CMD-2026-10-11-monthly-batch-degrades-open.md` (DONE),
`docs/CC-CMD-2026-10-11-no-header-estimates-unreconciled.md` (OPEN, filed),
`docs/CC-CMD-2026-10-11-d1-overload-degrades.md` (OPEN, filed).

## What started it

The daily watch read (`outbox/odds-watches-daily-read-2026-10-11.md`) reported
watch 1 red at `we-overcharge-ourselves`, residual −1967, and named
`chargedFromBatch` as a hypothesis with no artifact behind it. The user said go.

## The defect

`chargeMonthlyOdds` builds a two-statement batch and passed the results to
`chargedFromBatch`, which required three. It threw on every monthly charge.

The throw lands in a degrade-open catch, so nothing failed loudly: the batch
had already committed, the return value was lost, the caller spent anyway. What
was lost is the guard — the `return false` on the 85,000 hard limit and the
`ODDS_THRESHOLDS` ladder were both inside the branch that never ran.

**Precise about the harm:** month to date is 21,248 of 85,000, which is 25.0%,
so no rung of the 50/75/90% ladder was due and no warning has been missed. The
exposure was that the limit could not have stopped anything if it had been
approached.

## The attribution, measured

`daily.degraded_open` via run `38169682259`:

```
2026-10-11  events 1230  credits 5995
  month: odds budget batch returned 2 result(s), expected 3      1075
  daily: D1_ERROR: D1 DB is overloaded. Requests queued too long.  77
  month: D1_ERROR: D1 DB is overloaded. Requests queued too long.  78

2026-10-10  events  925  credits 4431
  month: odds budget batch returned 2 result(s), expected 3       912
```

1075 of 1230 (87%) on 10-11, 912 of 925 (99%) on 10-10. The `credits` column is
spend that reached the vendor while a counter did not move: **5,995 and 4,431**.

## Three of my own claims were wrong and were corrected before they shipped

1. **"The over-recording is a double count."** Refuted by one read:
   `ledger_month_used` is `budget.monthly.used` alone.
2. **"Reconcile never corrects the month."** Refuted by one read: `fixMonth` is
   in the reconcile batch, added 2026-09-23, with a comment saying exactly why.
3. **"The degrade counter reads zero today, which is incompatible with a
   per-call throw."** Both true-sounding and wrong: the counter read zero
   because my probe was reading `j.degraded_open` instead of
   `daily.degraded_open`. The incompatibility was the probe.

Two probe defects, both of which would have produced a confident wrong answer:

| defect | what it would have done |
|---|---|
| `degraded_open` read with `?? 0` | printed a null counter as `events 0`; on a day with spend, PASS |
| read one level above the field | NOT-REPORTED on every sample, which is how run `38169528987` failed |

The second was caught **because** the first was fixed. `?? 0` plus the wrong
path is a silent pass; UNREADABLE plus the wrong path is a red run that names
the field. Rule 99's four states earned their keep on my own code.

## The done condition is automated, not deferred

Every probe run on 2026-10-11 returned INCONCLUSIVE, correctly. The daily
ceiling was at `3800/3800` by 14:03:59Z and all three monthly-charge sites gate
on the daily layer first, so `chargeMonthlyOdds` is not reached once the
ceiling holds — no charge can degrade and a flat count proves nothing.

`.github/workflows/month-degrade-probe.yml` now runs at 01:47 UTC, after the
00:00 reset. It carries its own deletion condition: once a run returns PASS it
should be removed, because `scripts/check-batch-order.mjs` in `guards.yml` is
what prevents the regression and runs on every push.

## Verified E2E vs STAGED

| thing | state |
|---|---|
| the throw, through the real exported function | **VERIFIED** — 7 runtime assertions, both directions |
| the daily path unchanged | **VERIFIED** — same returns on 3-statement batches |
| `check-batch-order.mjs` | **VERIFIED** — 7/7, M1 is the defect, green in CI as guards step 9 |
| the mutation harness refusing a bad anchor | **VERIFIED** — pointed M1 at an absent anchor, it FAILED |
| all 11 existing budget gates | **VERIFIED** — exit 0 each |
| deploy | **VERIFIED** — run 38168389875 success |
| the degrade reason stopping | **STAGED** — blocked by the daily ceiling; unblocks at 00:00 UTC; the 01:47 UTC run settles it |

## Manifest

| | |
|---|---|
| fix + gate | `12e310a` |
| probe + workflow | `79cea7c` |
| documents | `059eeec` |
| probe Rule 99 states | pushed after `059eeec` |
| probe read path, workflow schedule, these documents | this commit |
| deploy run | `38168389875` success |
| guards run | `38168389796` success — step 9 `a batch and the helper reading it agree on their statement count` |
| probe runs | `38168748424` INCONCLUSIVE, `38169528987` UNREADABLE (probe bug), `38169682259` INCONCLUSIVE with the real counter |
| credits spent | **0** |

**Residual, and it is genuine rather than deferred:** done condition 4 needs an
interval in which odds are being charged, and no such interval existed after
14:03:59Z. The scheduled 01:47 UTC run is the execution, and the workflow says
to delete itself once it passes.

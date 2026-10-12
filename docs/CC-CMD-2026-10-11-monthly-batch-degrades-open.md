# Claude Code Command — the monthly guard threw on every call, and the hard limit could not veto

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect) — one call site, one wrong constant, a guard that could not fire
**Status:** DONE 2026-10-11. Five tasks, four done conditions.

## What it was

`chargeMonthlyOdds` builds a batch of **two** statements:

```js
const results = await db.batch([
    db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(month, carried),
    db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(units, month, units, ODDS_HARD_LIMIT),
]);
const charged = chargedFromBatch(results);
```

`chargedFromBatch` threw unless `results.length === 3`. So it threw on **every
monthly charge**, every time, since the monthly counter moved to D1.

Nothing failed loudly. The throw lands in a catch that degrades **open**: the
batch had already committed (`db.batch` commits before anything inspects its
results), the return value was lost, and the caller spent anyway.

What was lost is the guard:

- the `return false` on the 85,000 hard limit was **unreachable**
- the `ODDS_THRESHOLDS` 50/75/90% warnings were **unreachable**

So the monthly ceiling could not veto and no warning could ever fire.

## TASK 0 — proved at runtime, not by reading

Through the real exported function, with the real batch shapes:

```
ODDS_BUDGET_ORDER = ["seed","site","charge"] (length 3)
daily   (3 statements): returned true
monthly (2 statements): THREW  "odds budget batch returned 2 result(s), expected 3"
monthly charge row present: [{"used":18183}]
```

The row the helper needed was present and non-empty. It refused to look at it.

That string is the one `/budget/odds` had been reporting all along as
`month: odds budget batch returned 2 result(s), expected 3`, readable only
because `docs`'s sibling gate had already forced the catch to name its error.

**This is the cause behind that incident.** `scripts/check-degrade-open-reason.mjs`
was written after the guard fell open 245 times on 2026-10-07 for 1,263 credits
of unattributed spend. Its header lists three candidate causes and names this
one — *"chargedFromBatch throwing by design on an unexpected shape"* — without
anyone checking whether the monthly batch's shape was unexpected on every call.
It was.

## TASK 1 — a premise refuted before it was published

The month-to-date ledger stands at 2.05x the vendor's bill (18,183 against
8,890). The obvious hypothesis was that this defect caused it: a charge counted
once by the SQL that ran and again by the degrade counter.

**Refuted by one read.** `scripts/watch-odds-pairing-rate.mjs:466` sets
`ledger_month_used: budget?.monthly?.used ?? null` — the month counter alone,
not a sum with the degrade counter. There is no double count.

The second candidate was that reconcile never corrects the month.
**Also refuted by one read:** `ODDS_BUDGET_SQL.fixMonth` is in the reconcile
batch at `src/budget-helpers.js:1038`, added 2026-09-23, with a comment stating
exactly why — *"the refund would land in the store nobody reads and the ledger
would sit permanently above the bill."*

Neither premise reached a status report. The over-recording has a different
cause and its own document: `docs/CC-CMD-2026-10-11-no-header-estimates-unreconciled.md`,
filed rather than deferred, per Rule 87.4.

## TASK 2 — the fix, without loosening the daily helper

The daily helper's strictness is correct and load-bearing: an unexpected batch
shape must not be read as a veto, because that would silently stop every odds
call. So the length is now read from the statement list rather than written as
a number beside it — a number beside it is what drifted.

```js
export const ODDS_MONTH_ORDER = ['monthSeed', 'monthCharge'];
export function chargedFromBatch(results, order = ODDS_BUDGET_ORDER) { … }
```

`ODDS_BUDGET_ORDER` stays the default, so the daily call site is unchanged in
behaviour. The charge is read from the last result rather than index 2 — the
convention `_usedFromBatch` already used, and identical for a 3-statement batch.

Seven runtime assertions, both directions: the monthly batch charges and vetoes
correctly, the daily batch is unchanged, a wrong-length batch against either
order still throws, and a non-array still throws.

**BEHAVIOUR CHANGE, stated plainly:** the monthly ceiling can now veto. Month to
date is 18,183 of 85,000, so no veto fires today, but one is now possible where
before it was not.

## TASK 3 — a check with teeth, and its mutation

`scripts/check-batch-order.mjs` compares each batch's statement count against
the order its reader declares, as source. **M1 is this defect put back, and the
check goes red on it.** 7/7, with M2 (a statement added to the batch), M3 (a key
added to the order), M4 (the order reshuffled so the charge is not last), M5 (a
third call site must make it refuse rather than check a subset) and M6 (a
missing declaration reported rather than thrown on).

The harness refuses a missing or non-unique anchor rather than reporting NOT
CAUGHT — verified by pointing M1 at an absent anchor and watching it FAIL.

Wired into `guards.yml` beside the degrade-reason gate. Source-only, no credits.

All 11 existing budget gates still pass. **`check-odds-calls-guarded` passed
throughout the defect** because it checks that the call site charges, not that
the charge's answer is read — which is how this survived a wall of gates.

## TASK 4 — the done condition, run where it can be run

`scripts/probe-month-degrade-stopped.mjs` + `.github/workflows/month-degrade-probe.yml`.
Two GETs of `/budget/odds` one cron firing apart, asserting the monthly batch
reason stops growing.

Two samples because the counter is cumulative for the UTC day: one reading
cannot tell "the fix landed" from "this day's count predates the deploy".

**The quiet-interval case is the one that matters.** A flat count across an
interval where no odds call happened proves nothing, so the verdict has a third
state and reports it as itself — INCONCLUSIVE, never rounded to a pass. Eight
self-tests on the pure verdict, including that case, and including the prefix
match: the fixed message appends its statement list, so an exact-key match
would stop seeing the reason and read as a pass.

A sandboxed session cannot check this — workers.dev is 403 at the agent proxy —
so the read runs on a runner with open egress.

## TASK 4's MEASUREMENT — the attribution, from the live counter

Run `38169682259`, reading `daily.degraded_open` on two days:

```
2026-10-11  events 1230  credits 5995
  month: odds budget batch returned 2 result(s), expected 3      1075
  daily: D1_ERROR: D1 DB is overloaded. Requests queued too long.  77
  month: D1_ERROR: D1 DB is overloaded. Requests queued too long.  78
  last 2026-10-11T18:08:12.034Z

2026-10-10  events 925  credits 4431
  month: odds budget batch returned 2 result(s), expected 3       912
```

**1075 of 1230 degrade events on 2026-10-11 (87%), and 912 of 925 on
2026-10-10 (99%), carry this defect's reason.** The attribution is measured,
not inferred from the deduction above.

`credits` is the spend that reached the vendor while a counter did not move:
**5,995 on 10-11 and 4,431 on 10-10.**

**TWO DEFECTS IN THE PROBE WERE CAUGHT BEFORE THIS NUMBER WAS BELIEVED**, and
both would have produced a confident wrong answer:

1. It read `degraded_open` with `?? 0`, collapsing "the counter says zero" into
   "the counter could not be read". The route is explicit that these are
   different answers. UNREADABLE is now its own verdict and exits non-zero.
2. With that fixed, it read `j.degraded_open` — one level above the field,
   which lives at `daily.degraded_open`. Run `38169528987` came back UNREADABLE
   for that reason alone. Under the original coercion the same wrong path would
   have printed `degrade events 0` and, on a day with spend, PASSED.

The first version of this document said the counter read zero today against a
monthly counter that had grown 3,065, and called those incompatible. They were:
one of them was the probe.

## TASK 4's VERDICT TODAY — INCONCLUSIVE, and that is correct

Every run on 2026-10-11 returned INCONCLUSIVE. The daily ceiling was already at
`3800/3800` by 14:03:59Z, and all three monthly-charge call sites gate on the
daily layer first:

```js
if (!(await checkAndIncrementDailyOdds(env, units, site))) return false;
return chargeMonthlyOdds(env, units);
```

So once the daily ceiling holds, `chargeMonthlyOdds` is not reached, no charge
can degrade, and a flat count across the interval proves nothing. The probe's
third state says so rather than reporting the flatness as a pass.

The conclusive run is **automated, not deferred**:
`.github/workflows/month-degrade-probe.yml` now runs at 01:47 UTC daily, after
the 00:00 reset and a dozen `*/5` firings on the new day. The workflow carries
its own deletion condition — once a run returns PASS it should be removed, since
`scripts/check-batch-order.mjs` in `guards.yml` is what prevents the regression
and it runs on every push.

## A SECOND THING THE COUNTER SHOWED, not this defect

`D1_ERROR: D1 DB is overloaded. Requests queued for too long.` went from 13
events on 2026-10-10 (6 daily + 7 month) to **155 on 2026-10-11** (77 + 78), a
12x rise in one day. Unrelated to the batch shape and not fixed here. Filed as
`docs/CC-CMD-2026-10-11-d1-overload-degrades.md`, per Rule 87.4.

## Stop conditions

- Do not loosen the daily helper to accept any length. Its strictness is what
  keeps an unexpected shape from being read as a veto.
- Do not change `ODDS_HARD_LIMIT`, the ceiling, or any cron frequency. This
  fix makes an existing limit reachable; it does not set one.
- Do not treat the 2.05x over-recording as fixed by this. It is a separate
  defect with its own document.

## Done conditions

1. The mismatch proved at runtime through the real function, not by reading. ✅
2. The monthly ceiling able to veto, with the daily path unchanged in
   behaviour and proved so. ✅
3. A check whose mutation is this defect, going red on it. ✅
4. The degrade reason's count not growing across an interval with real spend,
   read from outside the sandbox. ✅ **met 2026-10-12, not before.** Until
   then this line carried a ✅ that its own manifest contradicted: every probe
   run on 10-11 was INCONCLUSIVE and the session doc said STAGED.
   What meets it is odds-site-drift's 02:50Z runner reading of `/budget/odds`
   (`outbox/odds-site-drift-series.json`), at the same hour as the day before:

   | sample | `used` | `degraded_open.events` | month-batch reason |
   |---|---|---|---|
   | 2026-10-11T02:40:02Z (pre-fix) | 657 | 150 | 150 |
   | 2026-10-12T02:50:06Z (post-fix) | 507 | **0** | absent |

   The interval is 00:00Z reset → 02:50Z: 507 credits charged, 205 calls in the
   reconcile tally, zero degrades. The probe's own predicate, over 170 minutes instead
   of 60 seconds. The 01:47Z scheduled probe had still not fired at 06:23Z
   (GitHub scheduling delay, 276 min so far); its PASS deletes the workflow,
   and a FAIL would reopen this line.

   **The probe, and why it was deleted without a PASS.** Its scheduled run
   fired at 08:03Z (run 38221289092, 376 min late) and returned INCONCLUSIVE:
   `used 513/3800` at both samples, +0 in 420s. The ceiling was not the cause.
   The premise its 01:47Z slot rested on — that the */5 cron charges on most
   ticks once the day has reset — was false for these hours: 507 at 02:50Z,
   513 at 08:03Z, **6 credits in 313 minutes**. A 420s window at that hour
   almost never contains spend, so the workflow could only PASS by chance.

   Its own first sample already held the reading it was waiting for. The degrade
   counter is per-UTC-day and starts at zero at the reset, so sample 1 is an
   interval 00:00Z → 08:03Z: **513 credits charged, `degraded_open.events` 0,
   month-batch reason count 0**, beside 1,075 for closed 2026-10-11 in the same
   output. The verdict logic read only the 420s between its two samples.

   With two readings agreeing and `scripts/check-batch-order.mjs` in
   `guards.yml` holding the regression on every push, the workflow and
   `scripts/probe-month-degrade-stopped.mjs` (its only caller) were removed
   2026-10-12. Kept running, it would have committed an INCONCLUSIVE log every
   day at an hour with no spend.

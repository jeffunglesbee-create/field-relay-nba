# Claude Code Command — D1 overload degraded the odds guard 155 times in one day, up 12x

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (infrastructure) — a dependency's failure reaching a guard that degrades open
**Status:** DONE 2026-10-12. Three done conditions met. The decision is
NEITHER of the two branches below: the odds guard's own load did not grow, and
"upstream contention" is not established either. The overloads coincide with
contention on `field-archive` from other writers — on 2026-10-11 partly this
repo's own CI — and the odds guard is the witness rather than the cause, being
the only D1 caller that counts its failures. Attribution needs an instrument
this repo does not have, filed as
`docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md`.

## TASK 0 — THE PREMISE, MEASURED, AND THE DOCUMENT'S OWN COMMAND WAS WRONG

### Per-call D1 cost at HEAD — not 8

Read from `src/budget-helpers.js`, by path:

| path | round trips | statements |
|---|---|---|
| vetoed at the daily ceiling | 1 | 3 — the daily batch still runs; the veto IS its result |
| charged, no correction (`no-header`, or `delta === 0`) | 3 | 6 — daily 3, monthly 2, reconcile tally 1 |
| charged, corrected or `cache-hit` | 4 | 9 — plus the 3-statement fix batch |
| once per cold isolate | 1 | 4 `CREATE ... IF NOT EXISTS` — 67 ms median, measured 2026-09-20 |

**No relay commit between 2026-10-09 and the last overload on 10-11 added a D1
call.** `git log` over `src/` for 2026-10-08T12:00Z → 2026-10-11T18:10Z finds one
commit adding D1 lines, at 10-08T18:23Z — before 10-09, the clean day.

### The command this document named could not answer it

It said to count calls with `odds_reconcile_state.n`. **That counts calls that
FETCHED.** A vetoed attempt still runs its 3-statement daily batch and never
fetches, so post-ceiling load is invisible to `n` — and post-ceiling exposure
differed by more than 2x between the two days:

| day | ceiling reached | post-ceiling hours |
|---|---|---|
| 2026-10-09 | not reached | 0 |
| 2026-10-10 | 19:37:09Z | 4.4 |
| 2026-10-11 | 14:03:59Z | 9.9 |

Vetoed attempts have no counter anywhere. That part of the load is unmeasured,
and recorded as unmeasured rather than estimated.

### The series, from committed artifacts

`outbox/odds-site-drift-series.json` and `outbox/odds-provider-usage-series.json`
store the whole `daily.degraded_open` block per sample.

**The reasons map only exists from 2026-10-09T00:44Z.** Every sample before
that has no `reasons` key at all, so "0 overloads" there is an ABSENT field, not
a zero. The first pass of this analysis read it as zero and would have published
a 22-day clean baseline. The real record is three closed days and one partial:

| day | fetched calls (`n`) | D1 overloads | when they accrued |
|---|---|---|---|
| 2026-10-09 | ≥ 1,812 | **0** — reasons present, a real zero | — |
| 2026-10-10 | 2,149 | **13** | 0 at 09:12Z, 8 by 16:04Z, 10 by 16:26Z |
| 2026-10-11 | 1,891 | **155** | 0 at 09:21Z, 111 by 16:29Z, 155 by 18:08Z |
| 2026-10-12 | 205 by 02:50Z | 0 by 02:50Z | — |

**Fetched calls FELL 12% from 10-10 to 10-11 while overloads ROSE 12x.**
10-10's overloads were mostly BEFORE its ceiling (10 of 13 by 16:26Z, ceiling
19:37Z), so post-ceiling vetoed load does not explain that day either.

### What else wrote to the database

Every relay workflow run in each day's 09:00–18:10Z window:

| day | runs | D1-relevant, in window |
|---|---|---|
| 2026-10-09 | 25 | the recurring set: Score Fill x2, Drama Peak Backfill x2, Provenance Census, odds coverage census, Odds Historical Backfill |
| 2026-10-10 | 31 | the same recurring set, no deploy (10-10's deploys began 19:21Z, after 10 of its 13 overloads) |
| 2026-10-11 | **87** | the same recurring set **plus 4 deploys** (08:03, 13:28, 14:16, 15:18Z; 2 more failed at gates) **and 5 archive-scanning probes** (14:03–14:39Z) |

The recurring backfills ran on the clean day too, so they are not the trigger.
What is new on 10-11 is this repository's own activity — every deploy recycles
every isolate into its cold-start DDL batch, and the probes scanned the archive —
landing inside the window where 111 of the 155 accrued.

## THE DECISION — a third outcome, stated

**Task 1 is REJECTED.** The per-call cost is unchanged and the fetched-call
volume fell. Merging the daily and monthly batches would shrink a load that did
not grow, as a Rule 39 rewrite of the guard, on no evidence.

**Task 2's PREMISE is not established either.** "Cloudflare-side contention and
nothing here changed" is contradicted by 10-11: a great deal here changed, in
exactly the window.

**What the numbers support:** the odds guard is the WITNESS. It is the only D1
caller in the repo that counts its own failures, so contention on `field-archive`
from any writer surfaces there first. On 10-11 a share of that contention was
this repo's own CI. On 10-10 nothing in CI distinguishes it from the clean 10-09,
so that day is unexplained. The samples are 3–7 hours apart and the counter has
no per-event time, so neither day can be attributed further from what is on file.

**Task 2's ACTION is adopted regardless**, because it is right under every
hypothesis: a daily-path overload is a degrade-OPEN, so the call spends at the
vendor with the counter unmoved, and **after the ceiling it turns a veto into a
spend** — the vetoed attempt still runs its D1 batch, the batch throws, and the
throw returns true. Task 3 below is that alert.

## TASK 3 — the reader, in the existing watch

`scripts/watch-odds-pairing-rate.mjs`, not a new watch: it already read
`daily.degraded_open` at the right nesting level and without coercion. What it
lacked was a CLOSED-day read — its own read is the running day at ~11:00Z,
before the afternoon peak, and on 10-11 that would have seen 0 against a day
that ended at 155.

- `d1OverloadVerdict` — five states (Rule 99): `not-reported`, `unreadable`,
  `unattributed` (events with no reasons map — the instrument regressed), and
  `none` / `within` / `over` against a ratchet budget of **13**, the 10-10 level.
  Sums both paths; surfaces the overflow bucket by the writer's own constant.
- A separate `?date=YESTERDAY` read, asserting the date was honoured and the day
  is closed, so the verdict is immune to the measured 104–405 minute runner delay.
- Reports the month-batch reason beside it — a free daily runtime check that the
  2026-10-11 batch-shape fix holds at 0.
- **69 self-tests** including the three real days verbatim; the denominator now
  counts itself instead of the hard-coded `+ 32` that adding these would have
  silently falsified.
- **7/7 mutations** in `scripts/mutate-odds-pairing-rate.mjs`, wired into the
  workflow. **P7 SURVIVED its first run**: the null guard on `events` existed and
  nothing proved it, because `Number(undefined)` is NaN and gets caught anyway
  while `Number(null)` is 0. The test was added; now caught.
- **End to end against a local fake relay**, the real watch's real runtime path:
  10-11's counter → `over`, 155, FAIL; 10-09's → `none`; field absent →
  `not-reported`, FAIL.
- **Not dispatched.** This watch differences consecutive readings with no window
  gate, so an off-schedule run splits the next interval in two and could hide an
  excursion across the halves — the lesson from the vendor watch on 2026-10-11.
  Its first live verdict is the next scheduled run, and **it will FAIL on
  2026-10-11's 155, correctly**.

## The measurement

`daily.degraded_open.reasons` on `/budget/odds`, run `38169682259`:

| day | `daily: D1_ERROR … overloaded` | `month: D1_ERROR … overloaded` | total |
|---|---|---|---|
| 2026-10-10 | 6 | 7 | **13** |
| 2026-10-11 | 77 | 78 | **155** |

Verbatim reason string, both paths:

```
D1_ERROR: D1 DB is overloaded. Requests queued for too long.
```

**12x in one day.** The near-identical daily/month split (77/78, 6/7) is what
you expect from a per-call pair: `consumeOddsCredit` charges the daily ledger
and then the monthly one, so an overloaded D1 that fails one usually fails both
for the same call.

## Why it matters, and the one thing it is not

Both guards degrade **open** on a throw: the odds call proceeds and spends at
the vendor while the counter never moves. That is the right call for
availability and it is deliberate — but it means a D1 overload spends real
money outside the ceiling, and the ceiling is the only thing standing between a
runaway consumer and the 85,000 monthly limit.

**It is not the batch-shape defect.** That one is fixed and accounted for
separately (1075 of 1230 events on 10-11). These 155 are the remainder, and
fixing the batch shape does nothing for them.

## The load-bearing premise, and the ONE command for it

**Premise:** the rise is load this repo is causing — the odds guard moved from
KV to D1 on the daily counter and then the monthly one, so every odds call now
makes two D1 batch transactions where it previously made KV reads.

**The alternative:** it is Cloudflare-side contention on a shared D1 instance
and nothing here changed.

These have different fixes — the first is ours to reduce, the second is a
support question — and the degrade count cannot tell them apart.

The command that can: `ARCHIVE_DB` is shared by the archive writes, the budget
tables and the reconcile tally. Count the D1 statements per odds call at HEAD
(`consumeOddsCredit` → 3 for the daily batch + 2 for the monthly + 3 on
reconcile = 8 per call, if that is what the source says) and multiply by the
day's call count, then compare 10-10 against 10-11 for a change in calls rather
than a change in per-call cost. If calls are flat and degrades rose 12x, the
load is not ours.

That is a source read plus two numbers already on file. **No credits.**

## Tasks

**Task 0 — settle the premise before changing anything.** The count above,
against `odds_reconcile_state`'s `n` per day for the call volume. Record both
days in the outbox.

**Task 1 — if the per-call D1 cost is the lead**, the fix is fewer
transactions, not a retry: `check-monthly-counter-writers.mjs` already reports
"1 non-atomic writers, unchanged. This is not good news", so the shape of this
area is already under review. A daily and a monthly batch could be one
transaction. That is an Infrastructure change protocol item (Rule 39) and needs
its dependency map written first.

**Task 2 — if it is upstream contention**, the degrade is correct behaviour and
what is missing is a warning: 155 silent degrades in a day is 155 vendor calls
outside the ceiling, and nothing alerts on the count. A threshold on
`degraded_open.events` belongs in the existing watch rather than a new one.

**Task 3 — either way, the degrade counter needs a reader that is not a
session.** It took three probe revisions to read this field at all today (Rule
99 coercion, then the wrong nesting level). Whatever watch ends up owning this
must assert the field is READ, never treat a missing one as zero.

## Stop conditions

- **Do not add a retry around the D1 batch before Task 0.** A retry on an
  overloaded database is more load, and the guard already degrades open, so the
  retry buys nothing the degrade does not already give.
- Do not make either guard degrade CLOSED to "be safe". That stops every odds
  call on a D1 blip, which is the failure the degrade-open path was chosen over.
- Do not change `ODDS_HARD_LIMIT`, the daily ceiling, or any cron frequency.

## Done conditions

1. ✅ Per-call D1 statement count at HEAD and both days' call volume, in
   `outbox/cc-session-2026-10-12-d1-overload-degrades.md`: odds-path load did
   not rise and per-call cost did not change. Vetoed-attempt load is recorded as
   unmeasured.
2. ✅ A stated decision: Task 1 rejected, Task 2's premise not established, a
   third outcome named, Task 2's action adopted — with the numbers above.
3. ✅ `watch-odds-pairing-rate.mjs` reads the closed day's `degraded_open` and
   fails on a rise, with the READ-state assertion. Proven by self-test,
   mutation and an end-to-end run; its first scheduled live verdict is pending
   and must read `over` for 2026-10-11.

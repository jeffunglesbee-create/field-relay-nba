# Claude Code Command — D1 overload degraded the odds guard 155 times in one day, up 12x

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (infrastructure) — a dependency's failure reaching a guard that degrades open
**Status:** OPEN. Filed rather than deferred, per Rule 87.4, by
`docs/CC-CMD-2026-10-11-monthly-batch-degrades-open.md`, whose Task 4
measurement surfaced it while measuring something else.

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

1. Per-call D1 statement count at HEAD, and both days' call volume, in the
   outbox — enough to say whether load rose or per-call cost did.
2. A stated decision between Task 1 and Task 2, with those numbers as its
   reason.
3. Something other than a session reads `degraded_open.events` and fails on a
   rise, with the READ-state assertion of Task 3.

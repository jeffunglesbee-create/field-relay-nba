# CC-CMD-2026-09-19 — is the ENFORCING counter right?

## The question, and why nothing so far has asked it

Every odds measurement in this repo compares two of OUR counters to each other:

- `odds-attribution-gap` — `odds:daily:*` against the sum of `odds:site:*`
- `odds-site-drift` — the same pair, inside a running day
- `odds-pairing-rate` — `odds:credits:YYYY-MM` against the vendor, but MONTHLY
  and over irregular intervals, which answers a different question

None of them establishes which counter is RIGHT. Both can be wrong together,
and on 2026-09-19 the site-vs-daily gap was measured going in both directions
(+397, +324, then -16), so at least one of them is wrong some of the time.

**The vendor's bill is the only authority. It is the money.** The open claim:

> If `odds:daily:*` under-counts, real spend exceeded 3800 on every day that
> "closed at the cap", and the ceiling has been guarding a number below the
> truth. 2026-09-15 and 09-16 both read exactly 3800/3800.

That is unproven, it is the only finding in this family with money attached,
and `by_site` — the thing two watches already cover — has no code consumer in
either repo and cannot overspend anything.

## What this is NOT

Not the standing cumulative offset (~19,700 provider-vs-ledger). That is a
level difference across an unknown history and it explains nothing. This is a
DELTA over one closed UTC day, compared against that day's own counter. The
pairing watch already learned this distinction the hard way; do not re-merge
them.

## Task 0 — probe block (~15 min, no credits)

Everything below was read from HEAD on 2026-09-19. Re-read before building.

```bash
git log --oneline -5

# 0a. The three numbers are already on one free endpoint. Confirm the paths.
#     watch-odds-pairing-rate.mjs:476-479 reads exactly these:
#        budget.provider.requests_used      vendor MONTHLY cumulative
#        budget.monthly.used                odds:credits:YYYY-MM
#        budget.daily.used                  odds:daily:<today>
#     Confirm ?date=YYYY-MM-DD returns a CLOSED day's daily.used, and that
#     SITE_TTL_DAYS (budget-helpers.js:244) bounds how far back that works.
curl -s "$RELAY/budget/odds?date=$(date -u -d yesterday +%F)" | head -40

# 0b. Is the vendor figure free to read? budget-helpers.js caches the
#     x-requests-used RESPONSE header from real calls; /budget/odds must not
#     issue a vendor call of its own. Verify by reading it twice and checking
#     requests_used does not move on its own.

# 0c. Does the vendor counter reset monthly? Observed yes — the pairing watch
#     recorded "a counter went backwards" on 2026-09-17. Confirm the reset
#     DATE so Task 2's month-boundary refusal is anchored, not guessed.
```

## Task 1 — one reading per day, anchored to the boundary

The existing pairing series cannot answer this: its readings land whenever the
runner fires, and the measured scheduled-run delay here is 104-405 minutes, so
no two of them bound a UTC day.

New workflow `odds-daily-vs-vendor.yml`, `cron: '10 0 * * *'`, plus
`workflow_dispatch`. One run, one reading, appended to
`outbox/odds-daily-vs-vendor-series.json`:

```
{ at, vendor_month_used, ledger_month_used, day, day_used, ceiling }
```

where `day` is YESTERDAY and `day_used` is `/budget/odds?date=<day>` →
`daily.used`. Read by explicit date, never "today minus a bit" — the same
delay-immunity fix the attribution watch already carries.

## Task 2 — the comparison

```
vendorDay  = vendor_month_used(this run) - vendor_month_used(previous run)
ourDay     = day_used
knownCI    = CI credits with completed_at inside the two readings' window
residual   = vendorDay - ourDay - knownCI
```

Verdicts:

| residual | meaning |
|---|---|
| within tolerance | the enforcing counter tracks the bill |
| **strongly positive** | **the daily counter UNDER-counts. The ceiling guarded a number below real spend.** Escalate. |
| strongly negative | we charge ourselves for calls the vendor did not bill — wasted headroom, not a breach |

Tolerance: `max(50, 5% of vendorDay)`, matching the pairing watch rather than
inventing a second standard.

**Three refusals, each fatal rather than smoothed:**

1. **Month boundary.** The vendor counter resets monthly, so a window spanning
   the reset yields a negative `vendorDay` that is not spend. Refuse the pair
   and say so, exactly as the drift probe refuses cross-midnight pairs.
2. **Missing previous reading.** No baseline means no delta. Report `no-data`,
   never 0 (Rule 99).
3. **Unreadable vendor figure.** `null` is not zero. The pairing watch already
   makes this mistake impossible in its own code; copy the handling.

## Task 3 — knownCI is a LOWER bound, and the output says so

Only `odds-backfill` records its own credits. `targeted-odds-fill.mjs` calls
the vendor directly with no `consumeOddsCredit` and no site attribution —
confirmed by reading it, and it has spent 60 credits across 2026-09-16 and
09-18 that no counter saw. Any other direct-vendor script is the same.

So `residual` is an UPPER bound on the enforcing counter's shortfall, and the
printed line must say that where the number is read (Rule 91), not in a comment.

## Task 4 — mutations (Rule 90, before any verdict is trusted)

Each must be shown red before the check is believed:

1. Month-boundary refusal removed — a reset reads as a huge negative residual.
2. `knownCI` dropped from the subtraction — every backfill day reports a breach.
3. Missing previous reading returns 0 instead of `no-data`.
4. `null` vendor figure coerced by `Number()` — an unreadable day reads as a
   perfect match.
5. Tolerance compared against `ourDay` instead of `vendorDay` — the denominator
   swap that makes a shortfall shrink as it gets worse.

## Done condition

Not "the workflow runs". Three CLOSED days in the committed series, each with
all four numbers present and a stated verdict, and one of:

- **all three within tolerance** → the enforcing counter is sound, the
  daily-vs-site work is cosmetic, and the atomic-counter CC-CMD drops to
  housekeeping priority; or
- **a consistent positive residual across all three** → the ceiling has been
  guarding a number below real spend. That is a budget breach with a measured
  size, and it gets its own fix CC-CMD before anything else in this family.

An inconclusive mixture is a third real outcome and is reported as such, never
rounded to the first.

## Task 5 — outbox manifest (last)

Commit hash, workflow run IDs for the three days, the series file verbatim, the
verdict, and — if the residual is positive — the implied real spend on
2026-09-15 and 09-16, the two days that read exactly 3800/3800.

## Relationship to the other open CC-CMD

`CC-CMD-2026-09-18-atomic-odds-counter.md` makes daily and per-site one
transaction so they cannot diverge. That is right regardless of this outcome
and does not depend on any diagnosis. But it does NOT answer this question, and
neither one blocks the other. Run this first: it needs no production change, and
its answer decides whether the other is urgent or tidy.

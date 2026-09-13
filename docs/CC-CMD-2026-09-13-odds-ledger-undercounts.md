# CC-CMD-2026-09-13 — the odds ledger undercounts, and a second error hides it

Filed per Rule 87.4 during the Tigers backfill, from a user-supplied screenshot
of the provider dashboard checked against `/budget/odds` in the same minute.

## Measured 2026-09-13T13:39Z

| source | used | limit | remaining |
|---|---|---|---|
| provider dashboard (screenshot) | 50,868 | 100,000 | 49,132 |
| relay's read of provider headers | 50,958 | — | 49,042 |
| **relay's internal monthly ledger** | **34,452** | **85,000** | **50,548** |

The provider header and the dashboard agree (90 apart — minutes of drift). The
relay's own ledger is **16,506 below reality, a third of true consumption.**

## Why this is worse than a plain undercount

The configured `limit` is 85,000; the plan is 100,000. So there are TWO errors
and they point in opposite directions:

```
ledger:  34,452 / 85,000   -> 50,548 remaining   (what the relay reports)
truth:   50,958 / 100,000  -> 49,042 remaining
```

**They nearly cancel.** `monthly.remaining` is within 3% of the truth by
coincidence — a 16.5k undercount offset by a 15k under-stated ceiling. The field
a human or a guard would actually read looks right, for the wrong reason, and
stops being right the moment either error changes independently. A number that
is accidentally correct cannot be relied on and cannot be noticed going wrong.

This is the shape of the `hullcity` bug in a different domain: two things that
should not have been conflated producing a plausible answer nobody chose.

## Tasks

0. **Find where the ledger loses calls.** `checkAndIncrementDailyOdds`,
   `reconcileOddsCredit`, `oddsCreditCost` and every `fetch` to `ODDS_BASE`.
   **The artifact is the list of call sites that reach the Odds API WITHOUT
   incrementing the ledger**, or evidence that all of them do and the loss is
   elsewhere (a KV TTL, a month-boundary reset, calls predating the ledger).
   Do not guess between those — the deploy already runs
   "every charged odds call is reconciled against the receipt", so the mechanism
   exists and is either bypassed or under-counting, and those need different
   fixes.

1. **Decide what `limit` should be, and say why in the code.** 85,000 against a
   100,000 plan may be deliberate headroom. If so it must say so where it is
   defined, because right now it is indistinguishable from a stale value — and
   it is currently masking Task 0's defect.

2. **Make the two numbers reconcilable on sight.** `/budget/odds` already
   reports both the ledger and the provider headers. It should also report their
   DELTA, so a divergence is visible in the response rather than derivable by a
   human holding a screenshot next to it. Absence of a delta field is how this
   went unseen (Rule 99).

3. **Mutation (Rule 90).** Force a divergence — increment the provider side
   without the ledger — and assert the delta surfaces and any guard keyed on it
   goes red. A reconciliation check that has only ever run on agreeing numbers
   has proven nothing.

4. **Done condition.** `/budget/odds` reports a delta within a stated tolerance
   of the provider headers, and a committed response shows it. Not "the ledger
   looks closer".

5. **Outbox manifest** per Rule 67.

## Not claimed

Any cause. The gap is measured; the mechanism is not. Candidates not yet
separated: call sites that bypass the increment, a KV key expiring inside the
month, the month-boundary rollover, or spend from before the ledger existed.
Task 0 exists because picking one of those now would be a guess.

## Impact on decisions already made

None retroactively. The Tigers backfill was sized against the PROVIDER's
`quota_remaining` (~49,000), which is accurate, and against the DAILY ceiling,
which is relay-enforced and independent. But any future decision keyed on
`monthly.used` or `monthly.remaining` is reading a number that is right by
accident.

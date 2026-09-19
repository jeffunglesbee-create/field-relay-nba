# Task 2 — the atomic odds guard

**CC-CMD:** `docs/CC-CMD-2026-09-18-atomic-odds-counter.md`

## The spec could not be implemented as written

Task 2 said both of these:

> All three in one `env.DB.batch([...])`.

> Statement 3 runs only if statement 2 returned a row.

A batch is submitted as a unit. Nothing can read statement 2's result and then
decide whether to include statement 3. Obeying the second sentence means two
round trips and no transaction — which removes the only reason for the change,
since the whole argument was *"daily and per-site are written in the SAME
transaction, so they cannot diverge, in either direction, for any reason,
including ones nobody has thought of."*

## The resolution is the order

Bump the site **first**, reading the PRE-charge total; charge the day second.
Both statements carry the same ceiling predicate over the same pre-charge value,
so in one transaction they either both apply or neither does — and no result
needs inspecting. The daily `UPDATE`'s `RETURNING` still gives the verdict
because it is last.

```
seed    INSERT OR IGNORE INTO odds_budget (day, used) VALUES (?, ?)
site    INSERT INTO odds_budget_site (day, site, used) SELECT ?, ?, ?
          WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
        ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used
charge  UPDATE odds_budget SET used = used + ?
         WHERE day = ? AND used + ? <= ?
        RETURNING used
```

**Measured, not reasoned about.** Against real SQLite (`node:sqlite`), ceiling
100 charged in units of 30:

    call 1  CHARGED  daily=30  siteSum=30   AGREE
    call 2  CHARGED  daily=60  siteSum=60   AGREE
    call 3  CHARGED  daily=90  siteSum=90   AGREE
    call 4  VETOED   daily=90  siteSum=90   AGREE

A vetoed call moved neither counter. Both statements parse — the
`INSERT..SELECT..WHERE..ON CONFLICT` form is the one SQLite documents as
ambiguous without a `WHERE`, and it has one.

## Three things shipped with it that the CC-CMD did not list

The guard is incoherent without them, so shipping it alone would have been worse
than not shipping it.

1. **`reconcileOddsCredit`'s delta follows the charge into D1.** It writes the
   same two counters, applying the difference between the estimate and the
   vendor's receipt. Leaving it on KV would have made the two stores disagree by
   every reconciliation — and its own comment already records that exact defect
   from 2026-09-16: *"odds:site:\* accumulated the pre-charge ESTIMATE while
   odds:daily:\* accumulated the estimate PLUS this correction."* A correction
   is not a charge, so neither fix statement carries the ceiling: refusing a
   refund on a capped day would leave the ledger permanently above the bill.
2. **`peekDailyOdds` reads D1 when a row exists, KV otherwise.** Task 4's read
   half, pulled forward, because a guard charging D1 while `/budget/odds` reads
   KV would report 0 used on a day with real spend — and attribution-gap,
   site-drift, daily-vs-vendor and the ceiling readout would all read that zero
   as a finding. One fallback level, not a chain. The response now carries
   `source` (`d1` / `kv` / `kv-d1-unreadable`) and `kv_used`, because "0 used"
   and "read the wrong store" are otherwise the same observation.
3. **The seed carries the day's KV total, once per isolate.** Task 4 required a
   UTC day boundary for one reason: a fresh D1 row at 0 beside a KV counter at
   1014 would hand the day a second full ceiling. Seeding from KV removes the
   constraint — the cutover is safe at any hour, and `INSERT OR IGNORE` means it
   can only ever apply to the day's first row.

## The mutations execute the SQL, they do not read it

Five break the check. **Three break the SQL and run it**, because a source check
can prove the statements are in the right order but only execution can prove
that order keeps the counters equal.

| mutation | daily | sum | what it reproduces |
|---|---|---|---|
| control — shipped order | 90 | 90 | agree |
| **E1** charge before site | 90 | 60 | the split lags the total |
| **E2** site write loses its ceiling | 90 | **150** | a **positive** gap |
| **E3** charge loses its ceiling | **150** | 90 | a **negative** gap |

E2 and E3 reproduce both observed signs — the intraday `+80` and the closed-day
`−410` — from a one-clause change. That is not a claim about what caused the
historical gaps: the old code had no such SQL. It is a demonstration that this
code's ordering and guarding are load-bearing in exactly the way the CC-CMD's
"disagree in BOTH directions" finding describes, and that both directions are
one edit away.

**E1 is the one to keep.** Reversing two lines produces no syntax error, no
failing source check unless B1 is working, and no symptom until a ceiling day.

## Two mutations survived first time, same class as yesterday's

B4 and B5 replaced `if (!guarded)` and `if (!corrections)` with `if (false)` and
the suite stayed green. The self-test exercised the two predicates directly and
never asked `verdict()` what it did with them. **A predicate nobody consults is
the same as no predicate.** Third instance today of a test that checks the
value and not the branch.

## Verification

| what | result |
|---|---|
| `check-odds-budget-batch --self-test` | 12/12 |
| `mutate-odds-budget-batch` | **8/8** (5 source, 3 executed) |
| `check-odds-budget-schema` | PASS |
| `check-odds-calls-guarded` | PASS |
| `check-route-provenance` | PASS — the manifest picked up `d1:ARCHIVE_DB` on five odds routes on its own |
| `staged-verifier-check` / `staged-verdicts-check` | PASS / 28 |
| `check-push-lands` | 24/24 |
| module imports | ok |

## What is NOT proven here

- **`batch()` atomicity is Cloudflare's guarantee, not something this repo
  tested.** The SQLite runs are single-threaded and sequential; they show the
  statements are correct *given* a transaction. Whether D1 gives one is asserted
  live by the `odds_budget_charging` staged verifier, which is what will actually
  clear this.
- **Concurrency between isolates is untested.** That is the defect the change
  exists to remove, and it cannot be reproduced locally.
- **No latency measurement yet.** Task 0d wants four sequential KV ops timed
  against one D1 batch, on the same isolate. The op count is 4 → 1; whether that
  is faster is unmeasured and this document does not claim it.

## What clears this

`odds_budget_charging` flips from PENDING to PASS on the first day the guard
charges through D1 — no one has to look. Then the CC-CMD's done condition:
`odds-site-drift` reporting `gap-did-not-grow` across 8+ same-day intervals on a
day above 1000 used, and `odds-attribution-gap` reporting `ok` on a closed day.

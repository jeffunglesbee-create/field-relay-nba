# Claude Code Command — the pairing watch's degrade line differences two different days

**Date:** 2026-10-12
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect) — a watch line that reports a verdict from a meaningless number
**Status:** **DONE** — conditions 1 and 2 (`2d8d584`), condition 3 met by the first scheduled run, 2026-10-13T17:53Z.

## The defect, measured

`degradeVerdict` in `scripts/watch-odds-pairing-rate.mjs` turns the interval
since the last reading into `none` / `partial` / `explains` by subtracting the
previous reading's `degraded_open.credits` from this one's. That counter is
cumulative **per UTC day**. Its own comment knows it:

> *"Across a date boundary the counter restarts and the delta would go negative;
> that is reported as unreadable rather than clamped"*

It only checks the sign. The watch runs once a day, so its readings are ~24 h
apart and almost always span midnight. A cross-day difference that happens to
come out positive is reported as a verdict. From
`outbox/odds-provider-usage-series.json`, one `node -e` over the last four
readings:

| interval | same UTC day | prev | curr | delta | printed |
|---|---|---|---|---|---|
| 10-09T17:16 → 10-10T16:04 | no | 1084 | 2552 | 1468 | `explains — 1468 credit(s)` |
| 10-10T16:04 → 10-11T16:29 | no | 2552 | 5849 | 3297 | `explains — 3297 credit(s)` |
| 10-11T16:29 → 10-12T20:05 | no | 5849 | 0 | −5849 | `unreadable` |

The first two verdicts are 10-10's counter minus 10-09's, and 10-11's minus
10-10's. Neither is a quantity of anything. The third reads `unreadable` only
because the subtraction came out negative.

Nothing gates on this line: it is diagnostic beside `UNEXPLAINED`. The cost is
the reader's trust. `explains` tells someone the ledger gap is accounted for.

## Probe block (run first, against HEAD)

```
grep -n "export function degradeVerdict" scripts/watch-odds-pairing-rate.mjs
grep -n "degradeVerdict(prev" scripts/watch-odds-pairing-rate.mjs
grep -n "midnight rollover" scripts/watch-odds-pairing-rate.mjs
```

## Task 1 — compare dates, not signs

Pass both readings' `at` into `degradeVerdict`. If their UTC dates differ,
return a state of its own, `cross-day`, never `unreadable` (the counter was
read; the interval is the problem) and never a delta. Rule 99: four states
stay distinct.

## Task 2 — decide what the line should measure at a daily cadence

At one reading a day, `cross-day` will be the usual answer, which makes the
line permanently silent. Two options, the measurement to decide between them
in the CC-CMD before building:

1. The closed day's final `degraded_open.credits` for the day the interval
   mostly covers, via `/budget/odds?date=`, the same read the D1 section
   already makes.
2. Drop the line and leave degrade accounting to the D1 section and
   `odds-site-drift`, which samples within a day.

## Task 3 — self-test and mutation

A positive cross-day case (the real 10-10 → 10-11 pair: 2552 → 5849) must
NOT read `explains`. Add it to the self-test, and add a mutation to
`scripts/mutate-odds-pairing-rate.mjs` that restores the sign-only check. The
mutation must be CAUGHT.

## Done conditions

1. ✅ The real 10-10 → 10-11 pair returns `cross-day` in the self-test, and
   offers no number.
2. ✅ The sign-only mutation is CAUGHT (P8), with P9-P11 beside it: 11/11.
3. **Restated, because Task 2 chose option 1.** As first written this said "no
   `explains` / `partial` over an interval that spans midnight", which assumed
   the line would go silent. It does not: across ONE midnight it now rebuilds
   the number exactly. The condition is that the next scheduled run prints
   either a verdict with its reconstruction line beneath it
   (`= <day> close C - W at the last reading + N today`, and C - W + N equals the
   printed credits) or `cross-day` naming which case. Never a bare subtraction
   of two days' counters.

   ✅ **MET 2026-10-13** — scheduled run 38442336533, verbatim from
   `outbox/odds-pairing-rate-20261013T175350Z.log`:

   ```
         guard fell open   : none — 0 credit(s)
                             = 2026-10-12 close 0 - 0 at the last reading + 0 today
   ```

   0 − 0 + 0 = 0, the printed figure. The interval crossed one midnight, used
   the closed day's block, and printed its arithmetic. The same run's D1 section
   read closed day 2026-10-12 as `none`, with 0 overloads and a month-batch
   count of 0.

## What was built

**Task 1.** `degradeVerdict(prev, curr, escaped, span)` compares the readings'
UTC dates. The counter is keyed by UTC date (`_degradeKey`,
`src/budget-helpers.js:154`), so the date is the right discriminator, not the
sign. A call without dates is `unreadable`: the old three-argument form can no
longer produce a verdict.

**Task 2: option 1, because it was free.** The watch already read the
previous day's closed block for its D1 section. That read now happens once,
before both consumers. Across one midnight:
`(close - last reading) + today so far`. Across two, or with no close:
`cross-day`, with `why` naming which. Readings now carry `daily_date` from the
relay, so the date comes from the counter's owner, not the runner clock.

A fifth state came with it: **`no-escape`**. Once the line produces numbers
again, `explains` over a NEGATIVE escape would be a new false verdict. On
2026-10-12 UNEXPLAINED was −322 (the ledger charged more than the vendor
billed), and 146 degraded credits do not "explain" a gap in that direction.

**Task 3.** Self-test 69 → 81. The real pairs: 10-10 → 10-11 is `cross-day`;
10-11 → 10-12 is exactly 146 (`5995 - 5849 + 0`) and `no-escape`. Mutations
P8-P11, 11/11 caught. End to end against a fake relay, three cases:
one midnight with the close (`partial — 146` and its arithmetic line), two
midnights (`cross-day`, "one day's close cannot bridge it"), close absent
(`cross-day`, and the D1 section FAILs `not-reported`).

**Found while doing it:**
- `mutate-odds-matcher.mjs` M44 was anchored on the line this rewrote. It
  reported FAIL with NOTHING MUTATED, not a false CAUGHT, because the harness
  checks its anchors (Rule 90's corollary working). Re-anchored; 46/46.
- The old `a midnight rollover is unreadable` self-test would have kept
  passing, for the wrong reason: with no dates it reads `unreadable` without
  ever reaching the subtraction. Replaced by a same-day decrease with dates,
  plus a separate test that a dateless call is `unreadable`.
- The first end-to-end pass read a stale fake relay left on the port by the
  previous scenario, so its third case was invalid. The harness now prints the
  relay's served closed-day block before each run.

## Do not

- Do not dispatch `odds-pairing-rate-watch.yml` to test this. It differences
  consecutive readings with no window gate.
- Do not touch `d1OverloadVerdict` or its budget.

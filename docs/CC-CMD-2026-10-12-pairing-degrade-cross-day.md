# Claude Code Command — the pairing watch's degrade line differences two different days

**Date:** 2026-10-12
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect) — a watch line that reports a verdict from a meaningless number
**Status:** OPEN

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

1. The real 10-10 → 10-11 pair returns `cross-day` in the self-test.
2. The sign-only mutation is CAUGHT.
3. The next scheduled run prints no `explains` / `partial` over an interval that
   spans midnight.

## Do not

- Do not dispatch `odds-pairing-rate-watch.yml` to test this. It differences
  consecutive readings with no window gate.
- Do not touch `d1OverloadVerdict` or its budget.

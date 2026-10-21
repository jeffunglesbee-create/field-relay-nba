# Claude Code Command — the pairing watch's "what threw" names the closed day's cause, not a false "predates"

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a defect in a watch's output)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the 2026-10-21 odds daily read (`outbox/odds-watches-daily-read-2026-10-21.md`),
under Rule 87.4: it was found there and lies outside that read's scope.

---

## What was measured (2026-10-21)

`outbox/odds-pairing-rate-20261021T154809Z.log` (run 39628945690) prints:

```
      guard fell open   : no-escape — 3 credit(s) — but nothing escaped the ledger for them to explain
                          = 2026-10-20 close 3 - 0 at the last reading + 0 today
      what threw        : NOT RECORDED — this reading predates the reason histogram
  ...
  degraded_open        : none
  ...
  all degrade events   : 1
```

The second line is false. The reading is dated 2026-10-21T15:48:12Z, and the
histogram has existed since 2026-10-08. `scripts/watch-odds-pairing-rate.mjs:776` reads
`reading.degraded_open.reasons`, which belongs to the running day. Nothing fell
open on that day: the series row has `{"events":0,"credits":0,"last":null}` and
no `reasons` key. The 3 credits belong to the closed day, as the line above says
(`2026-10-20 close 3`). The closed-day block (lines 836-845) prints
`degraded_open : none` and `all degrade events : 1`. There `none` is
`d1OverloadVerdict`'s "no overloads" state. The block never prints the reasons
map it reads.

So no committed artifact names the cause. It was read only through the relay
self-probe, `GET /budget/odds?date=2026-10-20` at 2026-10-21T18:52Z:

```
"degraded_open":{"events":1,"credits":3,"reasons":{"charge: D1_ERROR: Network connection lost.":1},"last":"2026-10-20T23:30:32.977Z"}
```

**Already known, never filed.** `outbox/cc-session-2026-10-13-pairing-degrade-cross-day.md:29-31`
records that "what threw" "still lists only the running day's reasons, so across
midnight it omits the previous day's tail". It was left as is under Rule 69, and
no CC-CMD was filed. On 10-13 that looked like a partial list. On 10-21 the
whole tail fell before midnight, so the line names nothing and states something
false.

## TASK 0 — premises, one command each (Rule 100)

1. **The closed day's map is in scope when line 776 runs.** Trace where
   `closedDay` is assigned (line ~833 reads `closedDay.degraded_open`) relative
   to line 776, and record whether its `reasons` are available there.
2. **Across midnight, the events come from the parts.** Feed the real 10-20/10-21
   inputs to `degradeVerdict` and record `degrade.parts`
   (`close 3, was 0, now 0`).
3. **No parser reads these lines.** `grep -rn "what threw\|degraded_open        :" scripts .github docs`.
   Any reader of the label decides whether it can be renamed in TASK 1.

## TASK 1 — print the cause of the credits the line above counts

- When `degrade.parts` exists, print the closed day's reasons
  (`closedDay.degraded_open.reasons`), labelled with that date, then the running
  day's reasons, labelled with its date.
- Print "predates the reason histogram" only for a reading dated before
  2026-10-08. An absent map on a later reading is printed as absent for that
  date, never as "predates".
- In the closed-day block, print the reasons map (top 5) beside
  `all degrade events`. If TASK 0.3 finds no parser, rename `degraded_open :` to
  say that it is the overload state.

**Proof:**
- **Fixture:** the series row and the closed-day block above, committed.
- **Self-test:** it asserts the line `1 x  charge: D1_ERROR: Network connection lost.`
  under 2026-10-20. It must be red at HEAD (HEAD prints NOT RECORDED) and green
  after.
- **Mutation (Rule 90):** restoring `reading.degraded_open` at line 776 turns it
  red again.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. The self-test is red before and green after, with its mutation, in a committed
   log, and wired into the watch workflow's "the watcher can fail" step.
3. One green scheduled `odds-pairing-rate-watch` run on the fix.

## FORBIDDEN

- No change to `degradeVerdict`'s arithmetic or to any PASS/FAIL predicate.
- No relay change.

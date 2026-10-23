# Claude Code Command — five edges where the odds guard's books disagree with what happened

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (accounting correctness; no user-visible failure today)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.
**Do not land 2026-11-08..11-23:** commits touching `chargeOdds` or
`reconcileOddsCredit` VOID the CFL experiment
(`docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`).

---

## What was found (each with how it was seen)

1. **A month-limit veto keeps the day and site charge for a call it refuses.**
   A harness against HEAD `src/budget-helpers.js`, with the KV month seed at
   84998: `chargeOdds(env, 3, 'ambientCaptureClosingOdds')` returned `false`
   and left `odds_budget.used = 3` and `odds_budget_site.used = 3`, the month
   at 84998. The source calls it intentional ("The day and the site keep their
   charge and the call is refused"). It inflates `by_site` for calls never
   made. The month limit does not bind in October (41,036 of 85,000 on
   10-23).
2. **Degrade-open hangs on the KV binding, not the D1 store the guard
   charges.** Every wrapper and `chargeOdds` start with
   `if (!env.FIELD_JOURNALISM) return true;`. Harness:
   `chargeOdds({ARCHIVE_DB: {}}, 3, 'x')` returned `true` and counted nothing;
   the counted degrade path (`odds:degraded:<date>`) cannot record it.
3. **`kept` overstates on `error` tally rows when the refund has landed.** In
   `_reconcileOddsCredit` the KV mirror loop has no inner try, so a throw
   there reaches the outer catch and records state `error` after the D1
   refund batch committed; `creditsKeptBy('error')` then counts the full
   estimate. Rows seen: getWCPregameLambdas 10-18 (n 2, kept 8),
   handleCFLOddsProbs 10-14 and 10-22 (n 1, kept 6 each). Source-read;
   whether each refund landed is UNVERIFIED.
4. **A guard refusal in the dead-hour odds backfill marks the date tried for
   30 days.** `runOddsBackfillForDate` treats `guarded: true` like a miss
   (`if (!ok) { oddsSkipped += …; continue; }`) and returns
   `odds_populated 0`; the cron then writes the 30-day tried key.
   Source-read only. It may be inert: `change_log` source `odds_api` has no
   opening rows in the 03-09Z dead hours since 10-13.
5. **The stale-data sentinel watches KV counters the guard no longer
   charges.** `src/stale-data-sentinel.js` checks `odds:daily:<day>` and
   `odds:credits:<month>` in KV; since the D1 move those are written only by
   reconcile's mirror, clamped to "0". Live: `kv_used 0` while D1 `used` 462.

## TASK 0

For each of the five: one command that reproduces it at HEAD (the harness
for 1-3 imports `src/budget-helpers.js` against node:sqlite; 4 by reading the
KV cursor through a relay route if one exists; 5 by the sentinel's own
output). Record each. Drop any that does not reproduce.

## TASK 1

One commit per item that reproduces, each with a check that is red before,
green after, and a mutation that restores the defect. Item 1 must not move
the day's verdict or the batch order (`check-batch-order.mjs`,
`mutate-odds-budget-batch.mjs`).

## Done condition (Rule 90 artifacts)

TASK 0's five outputs here; for each item built, its check red at the parent
and green after, mutations caught; nothing landed in 11-08..11-23.

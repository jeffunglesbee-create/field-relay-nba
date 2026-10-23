# Claude Code Command — three fixes before any per-consumer odds ceiling

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (spend and lost captures) and B (visibility)
**Confidence gate:** >= 95 before any commit
**Status:** IN PROGRESS. Owner ruling 2026-10-23: "Hold it; fix 3 first".
**Blocks:** Task 3 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`,
HELD until this is DONE.
**Do not land 2026-11-08..11-23** anything that changes `chargeOdds`,
`reconcileOddsCredit` or `handleCFLOddsProbs` (the CFL experiment's VOID rule).

---

## Why these three

The Task 3 premise test (Results there) found the shared ceiling no longer
binds, and three things that make any ceiling unsafe or invisible:

1. **A refused closing capture is never retried.** AmbientDO records the due
   games as bought before the charge (so a reset mid-purchase cannot buy
   twice), and a guard refusal returns with them recorded. The capture is
   the only at-kickoff writer (17 of 17 lines at T-10 min); the other writers
   land 60+ minutes early or after kickoff.
2. **The opening-line cron re-buys NBA, NHL, CFB and NFL every live-hours
   tick and writes none of their opening lines** (0 over 10-14..10-23; the
   next-day CI backfill writes them). `fetchSportOddsLive` was the largest
   site on 10-23 (267 of 492 by 20:00Z). No CC-CMD covered the spend.
3. **Nothing can see a refusal.** No caller reads `guarded`, and no watch
   exits on `ceiling_reached_at`.

## TASK 0 — map and premises

Workflow `wf_de43d4bd-def`, results recorded below when it completes.

## TASK 1 — build (one commit each)

Designs recorded with TASK 0's results.

## Done condition (Rule 90 artifacts)

1. Fix 1: a harness scenario where the charge is refused, then allowed, buys
   the line once; red before, green after; a mutation that keeps the record
   on refusal is caught.
2. Fix 2: after the deploy, a day's `fetchSportOddsLive` billed calls fall by
   the calls for sports the cron cannot write (or those sports' opening lines
   are written the same day), measured from `odds_reconcile_state` and
   `change_log` on a closed day.
3. Fix 3: the chosen watch goes red on a closed day with
   `ceiling_reached_at` set (proved on a recorded day such as 2026-10-12) and
   stays green on one without; its self-test and mutation pass.

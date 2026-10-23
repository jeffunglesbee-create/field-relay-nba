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
`consumeOddsCredit`, `reconcileOddsCredit`, `handleCFLOddsProbs`, jubilant-
bassoon `fetchCFLOddsProbs` or `fetchSchedule`, or any option of
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` (the CFL
experiment's VOID list).
**Scheduled reads this must not disturb:** the demand reads at 10-24 and 10-25
11:07Z (18x and coverage-gaps done conditions) and the 10-25T06:30Z option-1
read. Fix 1 changes behaviour only while the guard refuses a call; each read
first confirms no refusal on the days it measures.
**Fix 2 folded** into `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`
(the same `findOddsForRow` join and the same four sports; its owner choice
decides both paths). That CC-CMD also blocks the Task 3 hold.

---

## Why these three

The Task 3 premise test (Results there) found the shared ceiling no longer
binds, and three things that make any ceiling unsafe or invisible:

1. **A refused closing capture is never retried.** AmbientDO records the due
   games as bought before the charge (so a reset mid-purchase cannot buy
   twice), and a guard refusal returns with them recorded. The capture is
   the only at-kickoff writer (17 of 17 lines at T-10 min); the other writers
   land 60+ minutes early or after kickoff.
2. **(Folded into the 10-21 historical-join CC-CMD.) The opening-line cron
   re-buys NBA, NHL, CFB and NFL every live-hours tick and writes none of
   their opening lines** (0 over 10-14..10-23; the
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
2. Fix 2: moved to done condition 4 of
   `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`.
3. Fix 3: the pairing watch's refusal verdict is red on a stamped day and
   green on an unstamped one in its self-test (with its mutations), and its
   next scheduled run reads `none` for a closed day with no refusal. A
   recorded ceiling day cannot be replayed: `/budget/odds?date=` serves two
   days, and the last ceiling day was 10-12.

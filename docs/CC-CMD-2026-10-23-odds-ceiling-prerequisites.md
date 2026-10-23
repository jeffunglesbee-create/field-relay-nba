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

## TASK 0 — map and premises (workflow `wf_de43d4bd-def`, read-only, no credits)

Three readers mapped the code at `4bcfc5a`; a critic then tested each
reader's premises against what had landed by then (`da44521`, `35d61ec`, live
in deploy run 40023071623).

**Fix 1.** The only path that makes no vendor call is the guard refusal; every
path that reached the vendor keeps the record. One caller. A day veto moves no
counter; a month veto charges day and site (now in Task 3's list in the 09-16
CC-CMD). The deploy restart cut no capture (no `start_time` in 20:45..21:25Z).
Gap found: three mutations that turn a billed failure (an error status, a
dropped connection, a body that is not a list) into a "refusal", and one that
withdraws only the first of two refused games, passed both harnesses. The
first three would re-buy on every poll of the window.

**Fix 3, as landed (`35d61ec`), is incomplete.** Three defects. The critic
replayed the first two with the real `chargeOdds`, `peekDailyOdds` and the
committed `refusalVerdict`; the TTL line and `peekMonthlyOdds` were re-read
here:
1. The day stamp `odds:daily:<date>:warned` is written with
   `expirationTtl: 86400`. The watch reads the closed day the next afternoon
   (scheduled runs seen at 15:36Z..20:04Z; `/budget/odds?date=` serves two days
   back), so a stamp written before that hour the day before is gone. Replayed
   on the recorded ceiling days at the watch's real read times: 10-07 `none`,
   10-10 `day-ceiling`, 10-11 `none`. The watch could not fail on 2 of 3.
2. The month check reads `monthly`, which `peekMonthlyOdds` serves for the
   CURRENT month, not the closed day's: a month veto on 10-31 reads `none` on
   11-01. It also reads headroom, not a refusal, and `LARGEST_ODDS_CALL = 30`
   is not the largest possible call (a 2-region historical URL costs 60).
3. The red message says the guard "refused every odds call that day". It
   refuses per call (`used + ? <= ?`), and refunds lower `used`.

## TASK 1 — build (one commit each)

- **Fix 1** — `da44521` (live). Harness follow-up `8e4a4cf`: W23 (one vendor
  call across three polls after each billed failure), two games refused
  together in W21 and S20, and W22, which pins the month-veto phantom on the
  real `chargeOdds` (day and site +12 over four refused polls). All four
  mutations pass the old harnesses and fail the new; write 34/34, dedup 50/50.
- **Fix 3** — `35d61ec` (live, incomplete), then:
  - **A.** The day stamp's TTL becomes `(SITE_TTL_DAYS + 1) * 86400`, so it
    outlives every date `/budget/odds?date=` serves, read at any hour. An
    executed replay in `check-ceiling-reached.mjs` (real `chargeOdds` and
    `peekDailyOdds` on node:sqlite, a KV that honours TTL): a stamp at the
    first instant of D read at the watch's real read times, and at
    D+2 23:59:59.999. Anchors of `mutate-ceiling-reached.mjs` C1 and
    `mutate-monthly-atomic.mjs` M21 move in the same commit.
  - **B.** `peekDailyOdds` serves `month_limit_reached_at` from
    `odds:credits:<date's month>:warned:limit` (60-day TTL), three states
    like `ceiling_reached_at`.
  - **C.** After B is live: `refusalVerdict` reads both stamps, drops the
    headroom heuristic, and the messages say when the guard first refused.
  - A and B change no counter and no charge (`check-monthly-atomic` stays
    90/90). They land before 11-08 and outside a T-10 window of a capture.

## Done condition (Rule 90 artifacts)

1. Fix 1: a harness scenario where the charge is refused, then allowed, buys
   the line once; red before, green after; a mutation that keeps the record
   on refusal is caught.
2. Fix 2: moved to done condition 4 of
   `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`.
3. Fix 3: the pairing watch's refusal verdict is red on a stamped day and
   green on an unstamped one in its self-test (with its mutations), and its
   next scheduled run reads `none` for a closed day with no refusal.
   **Added 2026-10-23:** the executed TTL replay in `check-ceiling-reached.mjs`
   reads `day-ceiling`-grade stamps at the real read times of 10-08, 10-11 and
   10-12 and at D+2 23:59:59.999, and is red at TTL 86400, 2 x 86400 and one
   second short; a month veto on the last day of a month is reported for that
   day when read the next month.

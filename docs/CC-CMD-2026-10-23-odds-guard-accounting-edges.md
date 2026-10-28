# Claude Code Command — four edges where the odds guard's books disagree with what happened

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (accounting correctness; no user-visible failure today)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.
**Do not land 2026-11-08..11-23:** commits touching `chargeOdds`,
`reconcileOddsCredit` or any of the three wrappers (`consumeOddsCredit` in
`src/index.js` and `src/wp-resolver.js`, `_consumeAmbientOddsCredit` in
`src/ambient-do.js`) VOID the CFL experiment
(`outbox/odds-cfl-season-end-prediction-2026-10-18.md`, "What voids the
experiment"; `docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`).
The prediction names `checkAndIncrementDailyOdds` and `chargeMonthlyOdds`;
both survive only in comments, and their charge is now `chargeOdds`.
**Do not land before 2026-10-25 11:07Z either:** items 2 and 3 change
`chargeOdds` or `reconcileOddsCredit`, which the scheduled reads at 10-24 and
10-25 11:07Z and 10-25T06:30Z measure (the premise table of
`docs/CC-CMD-2026-09-16-odds-spend-attribution.md`).
**Narrowed 2026-10-23 (BUILD-ON-A).** A content audit against every existing
CC-CMD (workflow `wf_dd67792d-4ca`) moved item 1 into Task 3 of the 09-16
CC-CMD, which the owner released on 2026-10-28 and which is built (see item 1).
Items 2-5 have no other owner. Numbering is kept so
that references to "item N" stay valid.

---

## What was found (each with how it was seen)

1. **Moved.** "A month-limit veto keeps the day and site charge for a call
   it refuses" is now in the "When Task 3 does land" list of
   `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, with the harness
   result and the closing-capture retry that multiplies it. As a commit of its
   own it would work against four things: the 2026-10-18 ruling in
   `docs/CC-CMD-2026-09-19-daily-vs-vendor.md` ("Do not fix the over-record
   yet"), option 1 of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`
   (which kept the behaviour on purpose and whose STAGED read measures it),
   and two deploy-path gates that pin it (`check-monthly-atomic.mjs` case B,
   "today's behaviour, pinned"; `mutate-odds-budget-batch.mjs`, "the day
   keeps its charge").
   **Built 2026-10-28 by Task 3** (a month veto now charges neither the day nor
   the site, because the month's limit moved into the gate): `check-monthly-atomic`
   case B, `check-ambient-capture-write` W22 and the batch check changed in the same
   commit, as this item required.
2. **Degrade-open hangs on the KV binding, not the D1 store the guard
   charges.** Every wrapper and `chargeOdds` start with
   `if (!env.FIELD_JOURNALISM) return true;`. Harness:
   `chargeOdds({ARCHIVE_DB: {}}, 3, 'x')` returned `true` and counted nothing;
   the counted degrade path (`odds:degraded:<date>`) cannot record it.
   `docs/CC-CMD-2026-09-18-atomic-odds-counter.md` 3.1 already calls the
   unrecorded path "a floor"; the new part is that the binding checked is the
   wrong one. **Fix direction:** charge D1 whenever `ARCHIVE_DB` is bound and
   keep degrade-OPEN ("Do not make either guard degrade CLOSED",
   `docs/CC-CMD-2026-10-11-d1-overload-degrades.md`). Keep the existing degrade
   reason strings (`docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md`).
   **Same commit:** `scripts/mutate-deploy-odds-wrappers.mjs` anchors on the
   exact line `if (!env || !env.FIELD_JOURNALISM) return true;`, so it must
   move with the wrappers or its anchors match nothing. The state is reachable
   only by removing a binding (CLAUDE.md: no binding change without approval).
3. **`kept` overstates on `error` tally rows when the refund has landed.** In
   `_reconcileOddsCredit` the KV mirror loop has no inner try, so a throw
   there reaches the outer catch and records state `error` after the D1
   refund batch committed; `creditsKeptBy('error')` then counts the full
   estimate. Rows seen: getWCPregameLambdas 10-18 (n 2, kept 8),
   handleCFLOddsProbs 10-14 and 10-22 (n 1, kept 6 each). Source-read;
   whether each refund landed is UNVERIFIED.
   **Same commit:** `scripts/check-odds-reconciled.mjs` (deploy.yml:428)
   pins "a KV failure is reported, not thrown" as state `error`. The fix has
   to tell a refund that landed from one that did not, and keep reporting the
   second as `error`. **Declare it:** moving CFL rows from `error` to
   `reconciled` changes the CFL experiment's "receipts" even before 11-08, so
   add a dated line to `outbox/odds-cfl-season-end-prediction-2026-10-18.md`,
   as option 1 did. It also moves a published figure (the 09-16 Task 2 row
   `getWCPregameLambdas | 0 | 108 | 8`). If item 5 moves the sentinel off KV,
   the mirror has no reader left and removing it may beat wrapping it.
4. **A guard refusal in the dead-hour odds backfill marks the date tried for
   30 days.** `runOddsBackfillForDate` treats `guarded: true` like a miss
   (`if (!ok) { oddsSkipped += …; continue; }`) and returns
   `odds_populated 0`; the cron then writes the 30-day tried key.
   Source-read only. It may be inert: `change_log` source `odds_api` has no
   opening rows in the 03-09Z dead hours since 10-13.
   **Constraints:** read `guarded` in `runOddsBackfillForDate` and its cron;
   do not change `fetchSportOddsHistorical`'s refusal shape (09-16 What NOT to
   do). Join misses stay on the tried path (the cron's F2 rule); only
   refusals are exempt. Do not touch the row SELECT
   (`docs/CC-CMD-2026-08-25-misjoined-opening-odds.md`,
   `check-opening-odds-not-at-finalisation.mjs`). This function is also the
   third `findOddsForRow` caller in
   `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`,
   which may cut its purchases; design the two together.
   **Designed together, 2026-10-23:** the 10-21 change adds `start_time` to
   both of this function's SELECTs and nothing else; the WHERE and the
   unguarded finality stay. It refuses a line captured after the row's
   kickoff as a skip, like a miss, so a date with only such rows is still
   marked tried (right: they never become pre-kickoff). It does not touch the
   guard refusal or the tried key, so this item is unchanged by it.
   **Added 2026-10-28 (review of Task 3):** the 1,800 per-site cap on
   `fetchSportOddsHistorical` is a second way for this function to be refused, with
   no spend, so a capped day stamps the date tried for 30 days exactly as a day
   veto does; `pickNextOddsBackfillDate` ignores the marker, so the cursor stalls on
   the oldest date and logs `skipped_tried`. Reproduced by a reviewer from the
   source; still UNVERIFIED on a live capped day.
5. **The stale-data sentinel watches KV counters the guard no longer
   charges.** `src/stale-data-sentinel.js` checks `odds:daily:<day>` and
   `odds:credits:<month>` in KV; since the D1 move those are written only by
   reconcile's mirror, clamped to "0". Live: `kv_used 0` while D1 `used` 462.
   Design it with item 3: the reconcile KV mirror is the only writer of these
   keys. `docs/CC-CMD-2026-10-23-odds-docs-stale.md` cannot absorb it (comments
   only; this needs a behaviour change).

## TASK 0

For each of items 2-5: one command that reproduces it at HEAD (the harness
for 2-3 imports `src/budget-helpers.js` against node:sqlite; 4 by reading the
KV cursor through a relay route if one exists; 5 by the sentinel's own
output). Record each. Drop any that does not reproduce.

## TASK 1

One commit per item that reproduces, each with a check that is red before,
green after, and a mutation that restores the defect, and with the pinning
gate named under its item changed in the same commit.

## Done condition (Rule 90 artifacts)

TASK 0's four outputs here; for each item built, its check red at the parent
and green after, mutations caught; nothing landed before 2026-10-25 11:07Z or
in 11-08..11-23.

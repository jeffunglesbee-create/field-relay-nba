# Claude Code Command — four edges where the odds guard's books disagree with what happened

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (accounting correctness; no user-visible failure today)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched, EXCEPT item 3: **BUILT 2026-11-08 as a PARKED patch** (`outbox/odds-reconcile-landed-refund-patch-2026-11-08.patch`, session doc `outbox/cc-session-2026-11-08-reconcile-landed-refund.md`). Nothing is landed. It lands only after the CFL judge's verdict commit and on the owner's go (item 3, "LANDING").
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
   **Added 2026-11-08 (found by the item 3 review, BUILD-ON-A: this is where it belongs).** The same family has a second face: a charge that
   degraded OPEN charges nothing, and a later reconcile whose D1 correction works still refunds it, so the DAY ledger drops by the estimate for a charge
   that was never added (day 100 to 94 for a 6-credit refund, executed: `scripts/check-reconcile-refund-landed.mjs` case K in the item 3 patch, identical
   at 67b3f19). `reconcileOddsCredit` cannot tell, because it is not told whether the charge landed. Not fixed; whoever builds this item decides whether
   the charge reports back to its reconcile.
3. **`kept` overstates on `error` tally rows when the refund has landed.** In
   `_reconcileOddsCredit` the KV mirror loop has no inner try, so a throw
   there reaches the outer catch and records state `error` after the D1
   refund batch committed; `creditsKeptBy('error')` then counts the full
   estimate. Rows seen: getWCPregameLambdas 10-18 (n 2, kept 8),
   handleCFLOddsProbs 10-14 and 10-22 (n 1, kept 6 each). Source-read;
   whether each refund landed is UNVERIFIED.
   **Measured 2026-11-07, the first measurement of whether the refund landed.**
   `handleCFLOddsProbs` rows in state `error`, cache `HIT`, kept 6 each: 1 call
   at the 09:20Z site-drift reading, 20 by 17:03Z, still 20 at 18:34Z
   (`GET /budget/odds`). The test: `used` against the sum of `credits_kept`
   over the cells that are NOT `error`. 09:20Z: used 36, kept 42, 42-6 = 36.
   17:03Z: used 468, kept 588, 588-120 = 468. 18:34Z: used 528, kept 648,
   648-120 = 528. 2026-11-06, which had no `error` rows: used 282, kept 282.
   In all four readings `used` equals the kept of the non-`error` cells
   exactly, so those estimates are not in `used`: the D1 refund landed and only
   the tally overstates (`credits_kept` 648 against `used` 528 today). Coverage:
   four readings of one site on two days. The cause of the throw is unread (the
   tally stores no `note`), and the KV mirror is the only step after the D1
   batch, so the source-read account stands but is not proven. For the CFL
   experiment: read an `error`/`HIT` row as a cache hit whose refund landed,
   not as a receipt. Not fixed: 11-08..11-23 is the VOID window above.
   **Same commit:** `scripts/check-odds-reconciled.mjs` (deploy.yml:428)
   pins "a KV failure is reported, not thrown" as state `error`. The fix has
   to tell a refund that landed from one that did not, and keep reporting the
   second as `error`. **Declare it:** moving CFL rows from `error` to
   `reconciled` changes the CFL experiment's "receipts" even before 11-08, so
   add a dated line to `outbox/odds-cfl-season-end-prediction-2026-10-18.md`,
   as option 1 did. It also moves a published figure (the 09-16 Task 2 row
   `getWCPregameLambdas | 0 | 108 | 8`). If item 5 moves the sentinel off KV,
   the mirror has no reader left and removing it may beat wrapping it.

   **Built 2026-11-08, PARKED (nothing landed: `reconcileOddsCredit` is in the VOID list above).** Evidence, all in `outbox/` with the prefix
   `odds-reconcile-landed-refund-` and the suffix `-2026-11-08`: `red-at-head` (the new check against 67b3f19: **26 of 42 pass, 16 fail**; its A1, a cache
   hit with the refund landed and the mirror throwing, reads state `error`, credits_kept 6 against used 0, the live 648-against-528 shape; its A3, receipt 10
   against estimate 6, shows the overstatement is also an UNDERstatement), `green-after` (**42 of 42**), `mutants` (**20 of 20 caught**, each by the case meant
   to), `sweep` (every `check-*`/`mutate-*` command of deploy.yml and guards.yml run on both trees: identical exit codes except the two new scripts), `patch`
   (6 files, 450 insertions, 7 deletions; `git apply --check` clean on main b9edf45). Two independent reviews, 74 agents, in the session doc.
   **The fix** is one flag in `_reconcileOddsCredit`: `landed`, true only once the D1 correction batch RESOLVES, and the KV mirror in its own try. With
   `landed` a mirror failure is a log line and a fixed `note` and the state stays what the receipt says; without it the throw reaches the outer catch exactly
   as before. A 1,120-cell factorial against HEAD found the patch changes behaviour ONLY where the batch resolved and the mirror threw (96 cells), and the D1
   ledgers and KV byte-identical in all 1,120. **Correction to this item's own text:** the mirror is not the only step after the D1 batch; `_bumpSite` also
   runs there and is safe only because it swallows its own errors (check case A5).
   **What changed on the way, because a review found it:** the first version also flipped a REJECTED correction to `error`. That regressed a case HEAD got
   right (D1 can reject a write whose commit it could not confirm, so the tally then read the estimate against a corrected ledger), changed the report of a
   degraded-open charge, and went beyond this item's words ("keep reporting the second as `error`" is about what is reported today). It was removed.
   **KNOWN, pinned in the check and NOT fixed:** C, the correction rejected before it committed with the mirror fine, reads `cache-hit` while `used` holds the
   estimate (the mirror image; HEAD identical); G2, a batch that commits and then rejects with the mirror throwing, reads `error` with the ledger corrected (HEAD
   identical); **H, moved by the fix:** across 00:00Z (charge on day D, reconcile on D+1) the tally reads `cache-hit` kept 0 against used 6 where HEAD read
   `error` kept 6 = used 6 by coincidence, the ledger identical in both; K, see item 2. `landed` means the batch RESOLVED, not that the correction reached the
   charged day. **UNMEASURED:** whether real D1 ever rejects a batch it committed.
   **LANDING, all in ONE commit, only after the verdict commit and on the owner's go:**
   1. Not in 2026-11-08..11-23. The judge's VOID check is `git log --since=2026-11-08` with no `--until`, so land only after the judge's verdict commit
      EXISTS, by artifact and not by time: `git fetch && git log origin/main --since=2026-11-24T14:00:00Z --format='%h %cI %s' -- outbox
      docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` must list it, and the new
      outbox document must name H-whole, H-none and M. A re-judge after landing must pass `--until=2026-11-23T23:59:59Z`.
   2. A line below this list, `OWNER GO item 3 landing: <date>`, recorded from the owner's own words. Without it: report once and stop.
   3. A REAL `git apply` of the patch on a clean clone of current main (`--3way` if a context line moved; the likely one is the single `// SCOPE-EXCLUDES:`
      line in `scripts/check-odds-reconciled.mjs`: take the CURRENT line and append both new script names). Then run EVERY check and mutate command of
      deploy.yml and guards.yml, not a keyword subset (`check-scope-claims` was invisible to one), and compare with the same run on main: no exit-code
      differences.
   4. Declare in the same commit, anchoring every edit on text, not line numbers: a dated line in `outbox/odds-cfl-season-end-prediction-2026-10-18.md`;
      Notes in `docs/CC-CMD-2026-10-13-vendor-residual-window.md` (the done-condition 5 wording that an `error` call's kept is an intent with no standing
      charge, and the data-point sentence "the reconcile threw after its refund landed"), `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`
      (the `stranded` figure) and `docs/CC-CMD-2026-09-16-odds-spend-attribution.md` (the published row `getWCPregameLambdas | 0 | 108 | 8`, which
      `scripts/measure-odds-consumer-demand.mjs` generates by summing every state including `error`); `scripts/analyze-cfl-reconcile-gap.mjs` (the comments
      above `stranded` and above the `recErr` fixture) and the mutant description in `scripts/mutate-analyze-cfl-reconcile-gap.mjs`, then
      `node scripts/analyze-cfl-reconcile-gap.mjs --self-test && node scripts/mutate-analyze-cfl-reconcile-gap.mjs` (editing the analyzer also triggers
      `runner-read-guards.yml`); the two old readings in `HANDOFF.md` superseded by the new entry; `docs/CC-CMD-2026-10-23-odds-spend-without-need.md`'s
      pointer into this item re-anchored by text. Put the deploy run's UTC creation time and **2026-11-25 as the first clean UTC day** in each: the tally key
      is `(day, site, state, cache)` with no version, so on the landing day one `error` cell mixes rows written under both readings. Before the deploy an
      `error` row could mean "the mirror threw after the refund landed" OR "the correction did not land" (the measured CFL rows were the first); after it
      an `error` row means the correction did NOT land. The analyzer's `stranded = by_site - (credits_kept - credits_kept of the error rows)` stays right
      for both.
   5. A Rule 67 session doc, a HANDOFF entry, and the item 5 decision (once the sentinel moves off KV the mirror has no reader: wrap it, or remove it).
   6. After the deploy, read `GET /budget/odds` on a day with `error`/HIT CFL rows: `used` against the sum of kept over ALL cells should now be equal. Record it.
   The follow-up that checks steps 1 and 2 and lands only if both hold is trigger `trig_01FFUveETSUTJeuudarUh5h7` (2026-11-24T16:30Z, this session).
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

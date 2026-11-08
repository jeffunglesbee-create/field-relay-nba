# Claude Code Command — the World Cup lambdas bill outside the World Cup

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** C (infrastructure) — ledger and ceiling consumption by a call the vendor bills 0 for.
Re-typed 2026-11-05 from "A (real vendor spend above need)": see Audit 2026-11-05, row 4.
**Confidence gate:** >= 95 before any commit
**Status:** DONE 2026-11-08 — TASK 0 and TASK 1 BUILT and committed 04dc077 and deployed 2026-11-05T20:39Z (Deploy RELAY Worker run 42103983396, success; Repo guards run 42103983255, success). The done condition
(the two-sided call-count read below) was read 2026-11-08T09:16Z by `trig_018UGzSA57zJmCwKSywz8SzX` and HOLDS: no `getWCPregameLambdas` rows for 2026-11-06 or 2026-11-07, demand control 103 against a threshold of 78; see "Result of the done condition, 2026-11-08" at the end.
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4. The opening-line cron's
re-buying is NOT here: it is in
`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md` (folded
there from the prerequisites CC-CMD, 2026-10-23).
**Narrowed 2026-10-23 (BUILD-ON-A).** A content audit against every existing
CC-CMD (workflow `wf_dd67792d-4ca`) moved finding 1 (the historical triggers)
and finding 3 (the demand-model splits) into the 10-21 CC-CMD, which owns the
`findOddsForRow` join, the owner's (a)/(b) choice, `JOIN_UNWRITABLE` and the
worker tail. Only the World Cup lambdas remain here.
**Land before 2026-11-08, or declare it** to the 2026-11-24 judging run of
`outbox/odds-cfl-season-end-prediction-2026-10-18.md`: the WC stranded
estimates sit in that experiment's residual sums. `getWCPregameLambdas` is
not on its VOID list. **Landed 2026-11-05 (04dc077), before the window, so nothing
is declared to the judge as a late change; the prediction document carries an
"Added 2026-11-05" paragraph so the judge reads the lambdas' strands as ending
at the deploy.**

---

## What was found

1. **Moved:** `fetchSportOddsHistorical` billing above demand, and its
   three triggers, are premise 5 of the 10-21 CC-CMD.
2. **`getWCPregameLambdas` fetches the World Cup key outside the
   tournament.** `_wcWpPossible` is true for any live soccer game with a
   situation (`src/index.js`, about `const _wcWpPossible`). 18 to 800 calls a
   day in 10-14..10-23; the vendor kept 0 on every reconciled row; 116
   stranded charges on the ledger (2,548 on 10-01..10-07). Demand is 0. The
   stranded part is also in `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.

   **Corrected 2026-11-05 (Audit below).** 116 and 2,548 are CREDITS of the
   `by_site` counter, not charges: 29 and 637 attempts at 4 credits, and 634 of
   the 637 fell on 10-07, before the 10-08 gate. The range 18 to 800 is 10-14..10-23
   only; it went on to 932 (10-24) and 711 (10-31). Over the whole ledger
   (`outbox/odds-wc-lambdas-ledger-2026-11-05.json`): 6,261 tallied calls on 26 of
   29 days, 1,801 reconciled with `credits_kept` 0 on every one, 4,445 cache hits,
   14 error calls (in 6 rows), 1 no-header call.
3. **Moved:** the demand script's missing unwritable splits are in the 10-21
   CC-CMD, under its `JOIN_UNWRITABLE` removal rule, after the 10-25 11:07Z
   read (that read runs the script).

## TASK 0

1. Read, no spend: `_wcWpPossible`'s condition (`src/index.js`, at
   `const _wcWpPossible`), and every reader of the lambdas in both repos, to
   show whether any consumer reads them outside June-July. Do not confirm it
   by a `/v2/games` self-probe on a live soccer game: that call itself
   charges a `getWCPregameLambdas` attempt.
2. From `odds_reconcile_state`, the lambdas' charged, kept and state per day
   since 2026-07-20, to restate demand 0 against spend.

**TASK 0 RESULT, 2026-11-05** (artifact `outbox/odds-wc-lambdas-ledger-2026-11-05.json`):

1. Readers. `_wcWpPossible` is true for any of 18 of 28 `V2_LEAGUES` keys with a
   live game that carries a `situation`: 17 club leagues and `wc26`. One definition,
   ONE call, four reads of the returned Map, all inside the live loop of
   `handleV2Games`; none in `game-do.js`, `ambient-do.js` or `wp-resolver.js`; the Map
   is module-local. Zero hits in jubilant-bassoon (`facbf28b`) and field-laboratory
   (`0f7f2b75`) outside docs, outbox and HANDOFF (the only matches are 14 lines of one
   report, jubilant-bassoon `outbox/cc-odds-audit-results.md`). The client sees
   `winProb.source` only.
2. The ledger. `since 2026-07-20` cannot be run: `odds_reconcile_state` starts
   2026-10-08. Over 2026-10-08..11-05, 26 of 29 days have lambdas rows (no rows on
   10-08, 10-13, 11-05). `odds_budget_site.used` is the NET counter: it is 0 on 14 of
   those 26 days that had 13 to 932 calls, so "charged 0" does not separate the
   fixed worker from the unfixed one (see the done condition).

## TASK 1

**BUILT 2026-11-05, commit 04dc077.** As written below, with one amendment: the
window constants were locals of `scheduled()` and unreachable from `handleV2Games`,
so "reuse" meant a hoist. `_wcOpen` and `_wcClose` MOVED to module scope, declared
once (a copy makes `scripts/measure-odds-consumer-demand.mjs` throw `_wcOpen: 2
declarations, expected exactly 1`); `_isWCWindow` stays in `scheduled()` and
reads them, unchanged; `wcWindowOpenNow()` compares the clock per call and is a
conjunct of `_wcWpPossible`. The Dates are hoisted, not the boolean: a module-scope
boolean would be fixed for the isolate's life. The check and its mutants:
`outbox/wc-lambdas-window-check-2026-11-05.txt`. After 2026-07-20 the call is
unreachable until someone edits the 2026 literals, which are the same ones the
cron windows already need edited for 2030.

Gate the WC lambdas on the tournament window, reusing the existing window
convention (`_wcOpen` / `_wcClose` / `_isWCWindow` in `scheduled()`, which
gates the WC projections and the BSD WC endgame capture; Rule 62). Extend
`scripts/check-wc-lambdas-gated.mjs` to require the window, and do not loosen
it or `check-odds-calls-guarded.mjs` (10-18 FORBIDDEN). Keep the anchors of
`scripts/mutate-deploy-odds-wrappers.mjs` inside `getWCPregameLambdas` unique.
A check red before and green after, and a mutation that removes the window.
The stranded part of the ledger stays with option 2 of
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` (option 2 was UNHELD on
2026-11-01 and built for the CFL route only; whether the lambdas get the same
registration is that document's Note 2026-11-02, item 2, which recommends landing
this TASK first): this removes calls and touches no counter path.

## Done condition (Rule 90 artifacts)

**Original, kept for the record, and WITHDRAWN 2026-11-05:** a per-consumer demand
run (`odds-consumer-demand.yml`) on a closed day after the deploy shows
`getWCPregameLambdas` charged 0 outside the tournament. It passes on the unfixed
worker: its `charged` column is `odds_budget_site.used`, the net counter, 0 on 14
of 26 days that had 13 to 932 calls (10-25: 390 calls, used 0; the committed log
`outbox/odds-consumer-demand-20261027T120429Z.log` prints 0 for 10-26). A check that
cannot fail is not a done condition (Rule 90).

**Replacement.** A committed read-only result from ARCHIVE_DB (`field-archive`,
`cc49101c-0569-4d41-8e7a-be139cde4f26`) for the closed UTC day **2026-11-07** (a
Saturday, after the deploy). It is read on 2026-11-08 at 09:15Z by the one-shot
`trig_018UGzSA57zJmCwKSywz8SzX`, which appends it to this document under a new
heading "Result of the done condition, 2026-11-08" and flips the Status to DONE
only when 1, 2 and 4 hold. The queries are the GROUP BY forms, because an aggregate
with no GROUP BY returns ONE row holding NULL, which can never read as "no rows":

1. `SELECT day, SUM(n) AS attempts FROM odds_reconcile_state WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07') GROUP BY day`
   returns an EMPTY result set. The artifact prints `no rows`, never `0` (an absent
   row and a zero are different claims).
2. `SELECT day, used FROM odds_budget_site WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07')`
   returns an EMPTY result set too. A row with `used` 0 would still mean a call
   happened (2026-10-08 is such a day).
3. Pre-deploy controls, query 1 on Saturdays 2026-10-24 (932 attempts) and 2026-10-31
   (711) and on Sunday 2026-11-01 (451): the query returns rows on the unfixed worker.
4. Demand control: `SELECT SUM(n) FROM odds_reconcile_state WHERE site='fetchSportOddsLive' AND day='2026-11-07'`
   is at least 78. Calibration (`outbox/wc-lambdas-demand-control-replay-2026-11-05.txt`,
   rule "no lambdas rows AND this n at least T" replayed on the 28 closed ledger days
   2026-10-08..11-04, where the worker was unfixed on every one, so every pass is a
   false pass): T=0 falsely passes 2 days (10-08 with n 77, 10-13 with n 54); T=77
   falsely passes 1; **T=78 falsely passes 0 of its 18 eligible days**. The four prior
   Saturdays had n 115 to 358 and lambdas 297 to 932. The control is a PROXY for a
   different caller (`snapshotCronOdds` writes this site; the lambdas run per
   `/v2/games` request that has a live game), so 78 is the smallest threshold with no
   false pass on this sample, not a derived one. A day below 78 is INCONCLUSIVE, not
   passed, and the same read repeats on 2026-11-14; a day above it is evidence, not
   proof. A paired in-day `/v2/games` probe was considered and rejected: on a broken
   worker it would call the vendor, and no Odds API call is made without the owner.
5. The run id of the read, and the denominators printed: `N of M` days read.

The read is scheduled, not carried. The supplementary `odds-consumer-demand.yml`
dispatch may be attached, and proves nothing alone.

The check and its mutation output are committed:
`outbox/wc-lambdas-window-check-2026-11-05.txt` (red on `b59b469`, green on the
change; self-test 39/39 with 35 mutants, ten of them of the real source, and an
old-versus-new run on four defects the first version of the check missed).

## Audit 2026-11-05 (workflow `wf_d54b5c1a-da7`, 27 agents, run before building)

Asked: is this CC-CMD still fresh and suitable after 13 days. Six lenses (code,
consumers, data, guards, governance, timing), skeptics on the non-confirmed
claims, two attempts to break "gating changes no behaviour outside the window", a
completeness critic. Verdict: **BUILD WITH AMENDMENTS.** The premise is fresh: the
function, the gate and the window were unchanged since 2026-10-08.

| # | Finding | Disposition |
|---|---|---|
| 1 | `_wcOpen`/`_wcClose`/`_isWCWindow` are locals of `scheduled()`; "reuse" is impossible without a hoist, and a copy breaks the demand script | hoisted (moved, once); Task 1 reworded |
| 2 | `check-wc-lambdas-gated.mjs` stayed green with the window removed, and went red with a misleading message when the window sat on the call line | extended: conjunct required in the gate, Dates declared once, predicate evaluated at five instants; M9-M17 and R1-R6 |
| 3 | The done condition passes on the unfixed worker (net counter) | replaced by the two-sided call-count read above |
| 4 | "Type A, real vendor spend" contradicts the filing: the vendor kept 0 on 1,801 of 1,801 reconciled calls. What remains is ledger over-count (232 net credits over 10-08..11-04, 68 of them since the 10-28 cap), 1,801 zero-credit vendor round trips (about 69 a day), and D1 write load | re-typed C |
| 5 | The per-site cap (`getWCPregameLambdas: 300`, `src/budget-helpers.js:77`, Decision 3 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`; audit date 10-28, not re-dated here) bounds NET KEPT credits, not call count: 711 calls on 10-31 came after it | stale-text note; the cap does not make this moot |
| 6 | "after the 10-25 11:07Z read" (JOIN_UNWRITABLE) is past | no action |
| 7 | NBA enters the espnLeague branch (audit code lens; not re-measured here) and stays excluded through `basketball` in `V2_NON_SOCCER_WP_SPORTS` | noted |
| 8 | `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (FILED) names the lambdas (its item 3, `kept` overstates on `error` rows, lines 67 and 77) and carries its own hold on `chargeOdds`, `reconcileOddsCredit` and the three wrappers; this CC-CMD did not cite it | cross-referenced; TASK 1 touches none of its four edges |
| 9 | "do not loosen ... (10-18 FORBIDDEN)" resolves to `docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md` line 151 ("Do not loosen or remove `check-odds-calls-guarded.mjs`'s existing checks"); the 10-18 charge document does not carry it, and `docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md` says "Do not loosen any existing assertion" | neither check was loosened; `check-odds-calls-guarded` run unchanged and green |
| 10 | `docs/CC-CMD-2026-08-02-gate-bsd-club-league-capture.md` says "do not change `_isWCWindow`" | that is its own scope; `_isWCWindow`'s line is untouched, only the declarations above it moved |

**Premises (Rule 100), each with the one command that would refute it.**
"A null, an empty and an unmatched Map give the same `winProb`": the real lookup block,
the real `teamNameMatch` and the real `computeLiveWP` give identical output for 4 of 4
games (`outbox/wc-lambdas-winprob-equivalence-2026-11-05.txt`), CONDITIONAL on the Map
being empty or matching no live game; a Map entry that matches the live pair changes
the result, which the same artifact shows. "No consumer reads the lambdas
outside `handleV2Games`": `grep -an` over the relay and `git grep` over both other
repos, zero hits (TASK 0). **Evidence for "the vendor answers the World Cup key with an empty list outside
the tournament":** the raw vendor list was never seen (that costs a call and needs
owner approval), but the receipts kept 0 on 1,801 of 1,801 reconciled calls, and the
sister route `/wc/odds-probs` fetches the same URL and skips a game on the same
`h2h` test: it returned `probs: []` in 186 of 206 committed probe artifacts
(`outbox/provenance-runtime-probe-*.json`, counted 2026-11-05), none non-empty.

**An alternative the owner may prefer, NOT built:** gate on `sport === 'wc26'`
instead of the date. It needs no date literal and no edit to `scheduled()`, it also
removes the club-league calls made INSIDE the tournament window, and it is dead
the same way after the tournament. The window gate is what this CC-CMD ordered, so it
is what was built; switching replaces one conjunct and the M9-M17/R1-R6 cases.

**Do not read a `src/index.js` commit in 2026-11-08..11-23 as harmless.** The judge
checks `git log --since=2026-11-08` on "those files" and the listed items live in
`src/index.js`. This change landed before the window for that reason.

## Result of the done condition, 2026-11-08

Read 2026-11-08T09:16Z, read-only, 0 Odds API credits, by `trig_018UGzSA57zJmCwKSywz8SzX` through the Cloudflare D1 query tool against `field-archive` (`cc49101c-0569-4d41-8e7a-be139cde4f26`); there is no workflow run id, the read was made from the session. Raw output and every query: `outbox/wc-lambdas-done-condition-read-2026-11-08.txt`.

| # | query | result | needed |
|---|---|---|---|
| 1 | `SELECT day, SUM(n) AS attempts FROM odds_reconcile_state WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07') GROUP BY day` | **no rows** | no rows |
| 2 | `SELECT day, used FROM odds_budget_site WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07')` | **no rows** | no rows |
| 3 | query 1 for `('2026-10-24','2026-10-31','2026-11-01')` | 932, 711, 451 | rows on the unfixed worker |
| 4 | `SELECT SUM(n) FROM odds_reconcile_state WHERE site='fetchSportOddsLive' AND day='2026-11-07'` | **103** | at least 78 |

**Denominators.** Queries 1 and 2: 2 of 2 days read, 0 days with rows. Query 3: 3 of 3 control days returned rows. Query 4: 1 of 1 day read. **Not vacuous:** both days hold rows for 5 other sites in both tables (`odds_reconcile_state`: 2026-11-06 10 rows and 92 calls, 2026-11-07 15 rows and 2505 calls; `odds_budget_site`: `used` 282 and 1056), so the absence is of one site, not of the day; and the same query for the site returns rows on the three pre-deploy days. The demand-control query reproduces the CC-CMD's own reference value for 2026-11-01 (78). The other read day, Friday 2026-11-06, has a `fetchSportOddsLive` n of 39; it is not the demand-control day and no conclusion is drawn from it.

**What this is and is not.** Conditions 1 to 4 hold, so the Status is DONE. The demand control is the PROXY the CC-CMD says it is: `snapshotCronOdds` writes that site, while the lambdas run per `/v2/games` request that has a live game, so 103 shows the day was busy (2505 calls tallied in all), "evidence, not proof" in the CC-CMD's words. The read cannot tell a gated call from a call that never happened; it tells that no call reached the ledger on a Saturday after the deploy, where the unfixed worker recorded 297 to 932 on the four prior Saturdays (the CC-CMD's own calibration; this read re-measured 932, 711 and 451 on three of the days). Nothing was investigated because nothing failed; the deploy and `wcWindowOpenNow` checks the wake names for a failure were not needed. `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` and `outbox/odds-cfl-season-end-prediction-2026-10-18.md` were not touched (the calendar experiment's VOID window), and neither were `src/` or the guard functions.

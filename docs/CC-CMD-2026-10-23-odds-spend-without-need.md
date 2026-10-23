# Claude Code Command — the World Cup lambdas bill outside the World Cup

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
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
not on its VOID list.

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

## TASK 1

Gate the WC lambdas on the tournament window, reusing the existing window
convention (`_wcOpen` / `_wcClose` / `_isWCWindow` in `scheduled()`, which
gates the WC projections and the BSD WC endgame capture; Rule 62). Extend
`scripts/check-wc-lambdas-gated.mjs` to require the window, and do not loosen
it or `check-odds-calls-guarded.mjs` (10-18 FORBIDDEN). Keep the anchors of
`scripts/mutate-deploy-odds-wrappers.mjs` inside `getWCPregameLambdas` unique.
A check red before and green after, and a mutation that removes the window.
The stranded part of the ledger stays with option 2 of
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` (HELD): this
removes calls and touches no counter path.

## Done condition (Rule 90 artifacts)

A per-consumer demand run (`odds-consumer-demand.yml`) on a closed day after
the deploy shows `getWCPregameLambdas` charged 0 outside the tournament, with
the check and its mutation output committed here.

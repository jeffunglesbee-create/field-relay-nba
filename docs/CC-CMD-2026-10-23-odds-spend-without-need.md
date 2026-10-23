# Claude Code Command — two odds consumers bill without need, and the demand script cannot see it

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4. The opening-line cron's
re-buying is NOT here: it is in `docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md`.

---

## What was found

1. **`fetchSportOddsHistorical` billed 30 calls against 5 demand units on
   10-22** (12 against 3 on 10-21). `odds_reconcile_state` 10-22: 28 MISS + 2
   EXPIRED at 30 kept each, plus 62 HITs. 10-14..10-20 ran at 1.0-1.75 billed
   calls per unit. The tally has no sport, date or trigger column, so the
   cause cannot be read from it. Three triggers share the label: the
   `/archive/game` closing write, the dead-hour `runOddsBackfillForDate`, and
   the `/archive/odds-backfill` route.
2. **`getWCPregameLambdas` fetches the World Cup key outside the
   tournament.** `_wcWpPossible` is true for any live soccer game with a
   situation (`src/index.js`, about `const _wcWpPossible`). 18 to 800 calls a
   day in 10-14..10-23; the vendor kept 0 on every reconciled row; 116
   stranded charges on the ledger (2,548 on 10-01..10-07). Demand is 0. The
   stranded part is also in `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.
3. **The demand script's models miss both.** In
   `scripts/measure-odds-consumer-demand.mjs`, `openingSnapshotDemand` has no
   unwritable split (replicated: 10-20 9 vs 0 writable, 10-22 12 vs 0), and
   `historicalClosingDemand` models only the `/archive/game` path, one of
   three triggers.

## TASK 0

1. Attribute 10-22's 30 historical calls to a trigger: tail the worker
   (`wrangler tail` from a runner, as `ambient-capture-probe.yml` does) over
   one dead-hour window and one evening of finals, counting
   `fetchSportOddsHistorical` calls by caller. Read-only, no extra spend.
2. Confirm `_wcWpPossible`'s condition against one live non-WC soccer game
   through `/v2/games` (relay self-probe), and whether any consumer reads the
   lambdas outside June-July.

## TASK 1

From TASK 0: gate the WC lambdas on the tournament window; fix whichever
historical trigger over-buys; give the demand script an unwritable split for
the opening snapshot and all three historical triggers. Each with a check,
red before and green after, and a mutation.

## Done condition (Rule 90 artifacts)

A per-consumer demand run (`odds-consumer-demand.yml`) on a closed day after
the deploy shows `getWCPregameLambdas` charged 0 outside the tournament and
`fetchSportOddsHistorical` billed calls per demand unit at or below 1.75.

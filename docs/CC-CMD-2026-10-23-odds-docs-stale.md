# Claude Code Command — the odds guard's documents describe a guard that no longer exists

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** C (documentation; the next reader is misled)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.

---

## What is stale (each checked at HEAD `8aeeac6`)

- `docs/IMPACT-2026-09-16-odds-ceilings.md`: "three monthly implementations"
  that must move together. There is one guard, `chargeOdds` in
  `src/budget-helpers.js`, in D1; the three wrappers each
  `return chargeOdds(env, units, site)`.
- `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`: "five callers
  distinguish `guarded: true` from failure". None does at HEAD (no reader of
  `guarded` in `src/` or the client). Its "Open and unowned" list predates
  the D1 ledger.
- `src/budget-helpers.js` header: "ceiling 18000", and it names
  `snapshotCronOdds` and `_captureClosingOdds (in-memory cap replaced)`. A
  comment calls `ensureOddsBudgetTables` "STAGED … no caller today"; it has
  three callers. `export const ODDS_BUDGET_TABLES` has no importer and omits
  `odds_budget_month` and `odds_reconcile_state`.
- The wrappers' header comments say "KV-backed, monthly" and "Mirrors …
  same KV key".
- The record of the 2026-10-18 ruling calls the daily ceiling monthly.

## TASK 1

Correct each in place, citing the commit that changed the truth. The dead
export goes only after `grep -rn ODDS_BUDGET_TABLES src scripts .github`
confirms no reader. One commit for the docs, one for the source comments
and export. Comments only: no behaviour change (`git diff` shows no code
line besides the removed export).

## Done condition (Rule 90 artifacts)

A `git diff --stat` of exactly these files; the repo's gates green; the
grep for the dead export empty.

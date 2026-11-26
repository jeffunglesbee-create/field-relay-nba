# Accounting-edges item 3: the first clean UTC day (2026-11-25), read 2026-11-26T18:00Z

**Task:** `trig_01KC5tUhpNqFhCqF5mz84sUS`. **Spec:** `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` item 3, LANDING step 6. **Landed:** commit `8a5e9cd`, Deploy RELAY Worker run 45451778176 (created
2026-11-24T17:43:52Z, success). 2026-11-25 is the first UTC day that began after that deploy. **Cost:** 0 credits; two reads (`GET /budget/odds?date=2026-11-25`, answered 200 at 18:00:53Z with the day
closed, `is_today` false; and `SELECT * FROM odds_reconcile_state WHERE day = '2026-11-25'` on ARCHIVE_DB `cc49101c-0569-4d41-8e7a-be139cde4f26`, 11 rows).

## The two figures

| figure | value |
|---|---|
| `daily.used` | **144** |
| sum of `credits_kept` over ALL 11 cells | **144** (60 + 33 + 30 + 21, every other cell 0) |
| `by_site_sum` / `unaccounted` | 144 / 0 |
| cells with `state = 'error'` | **none** |

The `/budget/odds` reconcile list and the 11 D1 rows are the same cells with the same `n` and `credits_kept`.

## The cells (site, state, cache, n, kept)

fetchSportOddsLive reconciled EXPIRED 20, 60 · fetchSportOddsLive reconciled MISS 11, 33 · archiveGameClosing reconciled MISS 1, 30 · ambientCaptureClosingOdds reconciled EXPIRED 7, 21 ·
**handleCFLOddsProbs cache-hit HIT 25, 0** · handleCFLOddsProbs reconciled EXPIRED 10, 0 · handleCFLOddsProbs reconciled MISS 1, 0 · fetchSportOddsLive cache-hit HIT 3, 0 · archiveGameClosing cache-hit HIT 1, 0 ·
handleWCOddsProbs reconciled MISS 3, 0 · handleWCOddsProbs reconciled EXPIRED 2, 0.

## Verdict: **pass**, by the criterion the task set

`used` equals the sum of kept over all cells (144 = 144), and the day is not trivially clean: it has 25 cache-HIT CFL rows (and 11 other CFL rows), so the inconclusive clause (no HIT rows and no error cell) does not apply.

## What this does NOT show (coverage, Rule 91)

- **No `error` row was written, so the case the patch fixes (a refund that landed in D1 while the KV mirror threw) was not seen to occur on this day.** The defect is sparse: `handleCFLOddsProbs` `error`/`HIT` was 1 row in 239 HIT calls on
  2026-11-23, 2 in 124+ on 2026-11-24 (before and around the deploy, cells that mix both readings), and 39 on 2026-11-20. A day with 25 HIT rows and no error row is what one expects whether or not the fix works.
- So this is a consistency read after the landing (the books balance on a clean day), not a measurement that the fix was exercised in production. The case itself is exercised by `scripts/check-reconcile-refund-landed.mjs`
  (42 of 42 patched, 26 of 42 on the unpatched helpers) and its 20 mutants, on `node:sqlite`.
- The two `error` rows of 2026-11-24 stay undated (the table has no timestamp column); they are in a day that mixes both readings.

## What would settle the rest

An `error` row on a day after 2026-11-25 with CFL (or any) `by_site` holding its charge (the correction did NOT land) is the new meaning; an `error` row with `by_site` 0 for its site would mean the old defect is still live. The daily
watches (`odds-site-drift`, `/budget/odds`) already show every cell; nothing new needs arming. The next CFL games are in the 2027 season (`trig_01Htpxma53smhqw9Z4z3zVWP` reads that season).

# Per-site caps — live proof after the deploy

**Read:** 2026-10-28 17:09:48Z and 17:24:39Z. **Deploy:** Deploy RELAY Worker run
`40731128552` on `5b92e04` (worker live about 17:05:57Z); Repo guards `40731128567`
and Workflow YAML Gate `40731128621`, same commit, green.
**Done condition 5** of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, Task 3.

Read through `/budget/odds` (the relay's own route, via the relay probe) and D1
`cc49101c` (`odds_budget_gate`, `odds_budget`, `odds_budget_site`, `odds_budget_month`).
Nothing below was produced by the sandbox's own network; the sandbox cannot reach the
worker.

## 1. The route serves the new fields (17:09:48Z, after the deploy, before any new charge)

```
site_ceilings              getWCPregameLambdas 300, fetchSportOddsLive 2000,
                           fetchSportOddsHistorical 1800, ambientCaptureClosingOdds 400,
                           handleWCOddsProbs / handleCFLOddsProbs / wpResolver /
                           ambientFetchLiveOdds / oddsProxyRoute / unattributed null
site_ceiling_reached_at    {getWCPregameLambdas null, fetchSportOddsLive null,
                            fetchSportOddsHistorical null, ambientCaptureClosingOdds null}
site_stamps_unreadable     null
stamps_unreadable          null
used 291   by_site_sum 291   unaccounted 0   degraded_open {events 0, credits 0}
monthly.used 45574   source d1
```

The same fields on the pre-deploy read at 14:32:40Z: absent (`used 291`, month 45,574).

## 2. A charge made by the worker itself (17:24:39Z)

| | 17:09:48Z | 17:24:39Z | moved by |
|---|---|---|---|
| `daily.used` (odds_budget) | 291 | 300 | **+9** |
| `by_site_sum` (odds_budget_site) | 291 | 300 | **+9** (`ambientCaptureClosingOdds` 12 → 15, `handleCFLOddsProbs` 168 → 174) |
| `monthly.used` (odds_budget_month) | 45,574 | 45,583 | **+9** |
| `degraded_open.events` | 0 | 0 | 0 |
| `unaccounted` | 0 | 0 | 0 |

The day, the site split and the month moved by the same amount. Reconcile rows moved with
them (`ambientCaptureClosingOdds` reconciled n 4 → 5, kept 12 → 15).

## 3. The gate row exists (D1, 17:24:3xZ)

```sql
SELECT id, token, (SELECT used FROM odds_budget WHERE day='2026-10-28') AS day_used,
       (SELECT SUM(used) FROM odds_budget_site WHERE day='2026-10-28') AS site_sum,
       (SELECT used FROM odds_budget_month WHERE month='2026-10') AS month_used
FROM odds_budget_gate
-- [{"id":1,"token":"bbb6109d-f30b-4630-be6d-ae11e4a3556f","day_used":300,"site_sum":300,"month_used":45583}]
```

One row, `id` 1, a v4 UUID token written by `crypto.randomUUID()`. The table was created by
the deploy's first charge (`CREATE TABLE IF NOT EXISTS` in `ensureOddsBudgetTables`); the
production D1 accepted the statement, which a review had listed as UNVERIFIED.

## 4. The rebuilt debug route answers (run `5507bf5`, 17:10:20Z)

`outbox/odds-budget-latency-20261028T171026Z.log`: `POST /debug/odds-budget-latency -> 200`;
medians `d1_batch_warm 56 ms` (the eight statements), `d1_first_call_on_isolate 120 ms`,
`kv_four_ops 396 ms` (reconstructed baseline); cleaned up
`["odds_budget","odds_budget_site","odds_budget_gate","odds_budget_month",...]`. Before the
fix this route answered 500. The 2026-09-20 run of the same route read 38 ms warm for the
three-statement batch; both are one isolate on whichever colo answered, so the 18 ms is
not a controlled comparison and is reported, not explained.

## What this does not show (Rule 91)

- **A real refusal.** No call has been refused by a site cap, the month or the day since
  the deploy, so `site_ceiling_reached_at` has not been seen set on the live route. The
  caps are about 2 to 4 times each capped site's largest recent daily charge (the closing
  capture's since 10-22: at most 90 against a cap of 400); the first one will show in the
  pairing watch's refusal line.
  The refusal path is executed by `scripts/check-odds-site-caps.mjs` (135 checks, 38
  mutants), not observed live.
- **Concurrent isolates.** That D1 runs two batches one after the other is the premise the
  daily batch has always rested on; nothing here tests it.
- **One 15-minute interval, 9 credits.** Enough to show the gate row and that the three
  counters move together; not a day's behaviour. The first closed full day after the
  deploy is 2026-10-29 (read 10-30).

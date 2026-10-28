# Refusal record, label split and caps — live proof after the deploy

**Read:** 2026-10-28 22:14:59Z, 22:16:54Z and the probe at 22:15:09Z. **Deploy:** Deploy RELAY Worker run
`40777339113` on `0e6a894` (success 22:14:32Z); Repo guards `40777339101` and Workflow YAML Gate `40777339076`, same
commit, green. Probe: `odds budget latency (Task 0d)` run `40778483417`, artifact
`outbox/odds-budget-latency-20261028T221516Z.log`.
**Closes:** the owner's decisions 1 and 2 of 2026-10-28 (`docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, "Owner's
decisions of 2026-10-28"). Nothing below was produced by the sandbox's own network; it cannot reach the worker.

## 1. The route serves the new fields (`/budget/odds?date=2026-10-28`, 22:14:59Z)

```
site_ceilings              fetchSportOddsLive 2000, fetchSportOddsHistorical 1800, ambientCaptureClosingOdds 400,
                           getWCPregameLambdas 300, identityMismatches 150, archiveOddsBackfill 300,
                           archiveGameClosing 900; the other six sites null (uncapped, oddsProxyRoute among them)
site_ceiling_reached_at    seven capped sites, all null
refusals                   []            (the table was read; it holds none for the date)
stamps_unreadable          null          site_stamps_unreadable null
by_site                    identityMismatches 0, archiveOddsBackfill 0, archiveGameClosing 0 (listed, at 0)
used 555   by_site_sum 555   unaccounted 0   degraded_open {events 0, credits 0}   monthly.used 45,838
```

## 2. A charge made by the worker itself, after the deploy

| | 22:14:59Z | 22:16:54Z | moved by |
|---|---|---|---|
| `daily.used` | 555 | 561 | **+6** |
| `by_site_sum` (`fetchSportOddsLive` 159 → 165) | 555 | 561 | **+6** |
| `monthly.used` | 45,838 | 45,844 | **+6** |
| `degraded_open.events` / `unaccounted` | 0 / 0 | 0 / 0 | 0 |

The day, the site split and the month moved together through the nine-statement batch, and the guard did not fall
open. The gate row exists (`odds_budget_gate`, one row, a v4 UUID token).

## 3. The table (D1 `cc49101c`, 22:15Z and 22:17Z)

```sql
SELECT sql FROM sqlite_master WHERE name = 'odds_budget_refusal'
-- CREATE TABLE odds_budget_refusal (day TEXT NOT NULL, scope TEXT NOT NULL, site TEXT NOT NULL,
--   first_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, site))
SELECT COUNT(*) FROM odds_budget_refusal      -- 0 (no real refusal today; the probe's rows were cleaned up)
SELECT COUNT(*) FROM odds_budget WHERE day = '0000-00-00'   -- 0 (the probe's sentinel day is gone)
```

The production D1 accepted the `CREATE TABLE IF NOT EXISTS` from `ensureOddsBudgetTables`.

## 4. The refusal path ran on the real D1 (probe run `40778483417`, 22:15:09Z)

`POST /debug/odds-budget-latency -> 200`, and its new section (the artifact, lines 35-36):

```
refusal path on the real D1: ok
  {"scopes_returned":[["day"],["day"]],"cells":[{"scope":"day","site":"latency-probe","n":2}],
   "day_used_before":14,"day_used_after":14}
```

Two calls refused by a ceiling of 0 on the sentinel day: the first went through the `INSERT ... SELECT ... WHERE NOT
EXISTS` and returned its scope, the second through `ON CONFLICT ... DO UPDATE SET n = n + 1 ... RETURNING scope` (the
half a first insert never reaches); one cell counted twice; no counter moved. This is the statement the reviewers
could only run on node:sqlite and wrangler's local engine.

Latency, same route, same session: `d1_batch_warm` **63 ms** with nine statements (56 ms with eight at 17:10Z;
446 ms for the four KV operations it replaced against 396 ms then). One isolate, seven samples: the difference of
7 ms is inside the spread of the earlier run (52 to 67 ms) and is not a measurement of the refusal statement.

## Not observed live

A real refusal: the record's file-on-refusal behaviour is shown by the probe above on the sentinel day, and by the
checks; no cap, day or month limit has refused a real call since the deploy. The daily pairing watch
(`scripts/watch-odds-pairing-rate.mjs`, `Odds watches: daily read`) goes red on a refusal and names the site and the
hour, and now also has the record behind the stamps; the wake at 2026-10-30T12:00Z reads the first closed full day
(2026-10-29). On any day: `/budget/odds?date=<D>` with `refusals` non-empty, `site_ceiling_reached_at` for the capped
site, `by_site` at or below its cap, `degraded_open.events` 0.

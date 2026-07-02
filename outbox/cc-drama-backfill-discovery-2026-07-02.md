# Outbox — Drama Backfill Discovery Endpoint

**Date:** 2026-07-02
**CC-CMD:** docs/CC-CMD-2026-07-02-drama-backfill-discovery.md
**Status:** SHIPPED
**Commit:** 26b4795

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `/archive/drama` POST location | `src/index.js` line 7723 |
| `/archive/backfill` GET/POST location | line 7687 |
| `/archive/backfill-enrich` POST/GET location | line 7799 |
| Insertion point | After `/archive/drama` POST (line 7785 closing brace), before `backfill-enrich` comment block |

---

## Task 1 — Route Added

`GET /archive/drama-missing` inserted at `src/index.js` line 7787 (after insert).

Exact query:
```sql
SELECT id, sport, date, home, away, home_score, away_score, espn_event_id
FROM regular_season_games
WHERE drama_peak IS NULL AND home_score IS NOT NULL
ORDER BY date DESC
LIMIT ?
```

`limit` param: default 5, max 20 (`Math.min(20, parseInt(...) || 5)`).

RUWT/ADR-002 compliant: pure read, zero computation. Matches the pattern of
`/archive/drama` POST (relay stores/serves facts, client computes the values).

`ARCHIVE_DB` null-guard returns 503 before the query — consistent with other
archive route patterns. D1 query failure caught via `.catch(() => ({ results: [] }))` —
returns `{ ok: true, games: [] }` rather than surfacing D1 internals.

---

## Task 2 — Verification

```
node -c src/index.js  → SYNTAX OK
```

---

## Task 3 — Real Gap: no `bsd_event_id` column

Confirmed (documented in the CC-CMD itself): `regular_season_games` has no
`bsd_event_id` column. The response returns only `espn_event_id`. For soccer
games in the backfill backlog, the client will need a separate step to find
the matching BSD event — e.g. by team name + date, the same class of lookup
`scripts/soccer-player-crosscheck.js` uses. This is a known, documented gap;
no fix attempted here (would require a schema migration or a separate relay
join endpoint, both out of scope for this CC-CMD).

---

## Chat-Side Follow-Up

After deploy, confirm the endpoint returns real rows from the known 128-game
backlog:
```bash
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/drama-missing?limit=5'
```
Expected: `{ ok: true, games: [{id, sport, date, home, away, home_score, away_score, espn_event_id}, ...] }`
with 5 rows where `drama_peak` is null and `home_score` is non-null.

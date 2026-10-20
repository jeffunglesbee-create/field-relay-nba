# CC-CMD — one /context/game answer reads 17,468 D1 rows

**Date:** 2026-10-20
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, from the round-2 review of jubilant-bassoon
`docs/CC-CMD-2026-10-20-debrief-cache-outlives-archive-repair.md` (Rule 87.4).

---

## Why it matters now

Since 2026-10-20, jubilant-bassoon revalidates every cached final debrief once
per page load. That is the request volume the client had before Gap 12
(2026-07-18). The relay's KV (`ctx:{id}`, 300 s for a final) folds repeats of
one game into one compute per 5 minutes. Every compute pays the cost below.

## What was measured (2026-10-20, D1 field-archive, `meta.rows_read`)

`/context/game/espn:401866408`, a resolved regular-season CFB final with no
series, runs these queries (relay `src/index.js` at `3703e450`):

| lookup | query | rows_read |
|---|---|---|
| findGame | `postseason_games WHERE id = ? OR (home||'_'||away||'_'||date) LIKE ?` | 277 |
| findGame | the same on `regular_season_games` | 4,337 |
| findGame | `postseason_games WHERE espn_event_id = ?` | 277 |
| findGame | `regular_season_games WHERE espn_event_id = ?` | 2,271 |
| findBriefs | `briefs WHERE game_id = ? OR id LIKE ?` (with `'%401866408%'`) | 10,302 |
| findSeries | `postseason_games WHERE id = ?` | 0 |
| findBracketDelta | `briefs WHERE game_id = ? AND brief_type = 'bracket_delta'` | 4 |
| **total** | | **17,468** |

Each query was run once through the D1 API with the handler's own SQL and
parameters. findGame's first two queries cannot match an `espn:` id at all
(the concatenation has no `espn:` in it), and they still scan both tables.

## TASK 0 — premises, one command each (Rule 100)

1. `EXPLAIN QUERY PLAN` for each query above: which are full scans, and which
   indexes exist on `espn_event_id`, `briefs.game_id` and `briefs.id`.
2. Which id forms reach findGame in practice. Read the client senders in
   jubilant-bassoon and `classifyContextGameId`. Does the fuzzy LIKE ever find a
   row the exact lookups miss? Run one D1 query over the last 30 days of real
   ids, if a log of them exists.
3. The same total for a postseason game with a series.

## TASK 1 — answer from indexes (owner decision on any index creation)

- Order findGame so an `espn:` id goes straight to the `espn_event_id` lookups,
  and the fuzzy LIKE runs only for the forms that need it.
- An index on `espn_event_id` in both game tables, if TASK 0.1 shows a scan.
  That is a D1 schema change, which needs the owner.
- findBriefs: an exact `game_id` match first, with the `id LIKE` scan only when
  it finds nothing. The 2026-09-12 `/context/game/g19` incident is why that
  LIKE is dangerous anyway.

Proof: rows_read for the same id before and after, below 100. The response body
for 5 enumerated ids is byte-identical before and after.

## Done condition (Rule 89 artifacts)

1. TASK 0's outputs committed.
2. The before/after rows_read table and the 5 byte-identical bodies, in a
   committed log.
3. One green Deploy RELAY Worker run.

## FORBIDDEN

- No change to the response body (jubilant-bassoon compares bodies to detect
  corrections; a byte change here reads as a correction on every client once).

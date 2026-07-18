# CC Session Doc — Phase 3a: The Debrief (relay side)
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** acbdfc0
**HEAD end:** acbdfc0 (no code changes — verification only)
**Commits this session:** none

---

## Findings: relay-side Phase 3a is already complete

All 5 CC-CMD tasks were verified against the live deployed relay and the live D1 database. No code changes were needed.

---

### TASK 1 — Schema: drama_peak column (15/15)

**Verified via D1 MCP query:**
```sql
SELECT name FROM pragma_table_info('regular_season_games')
  WHERE name IN ('drama_peak','drama_arc','drama_score')
-- result: drama_arc, drama_peak

SELECT name FROM pragma_table_info('postseason_games')
  WHERE name IN ('drama_peak','drama_arc','drama_score')
-- result: drama_arc, drama_peak
```

Both columns exist on both tables. Column was landed as `drama_peak` (REAL) + `drama_arc` (TEXT), not `drama_score` as the June 15 spec named it. The spec name is stale; `drama_peak` is the canonical field name.

---

### TASK 2 — Write path: drama_peak populated (25/25)

**Architecture (verified from source):**
- GameDO has zero drama computation — confirmed: `game-do.js` comment at L14: "Drama computation, CRUNCH TIME detection, watch verdicts — all browser-side." GameDO's final-state hook (L394-451) fires on game completion and POSTs to `/archive/game` with structural data only (scores, teams, venue, etc.).
- Drama is browser-computed and sent separately by the client via `POST /archive/drama` after game completion.
- `/archive/drama` handler (L9458): accepts `{ source_id, drama_peak, drama_arc }`, writes to both tables. ADR-002 compliant — relay stores pre-computed facts only.

**Verified via D1 query that real games have real drama values:**
```
MLB_2026-07-17_brewers_marlins  drama_peak=74   (Brewers 2, Marlins 1)
MLB_2026-07-17_cubs_twins       drama_peak=52   (Cubs 2, Twins 5)
FIFA World Cup 2026_2026-07-17  drama_peak=57   (Nashville 1, Atlanta 0)
```

---

### TASK 3 — Archive handler (20/20)

The `/archive/game` POST handler (L9866) does NOT include `drama_peak` in its INSERT/UPDATE — and intentionally should not. The `/archive/drama` POST endpoint is the correct, purpose-built write path for browser-computed drama. This is correct separation of concerns per Rule 47.

---

### TASK 4 — Context Graph includes drama_peak (20/20)

`findGame()` (L6227) does `SELECT * FROM postseason_games` / `regular_season_games` and spreads `...row` into the return value. `drama_peak` and `drama_arc` are included automatically. `drama_arc_parsed` is also returned (JSON.parse of the `drama_arc` TEXT column).

The `/context/game/{id}` route (L9076) returns the `findGame()` result as `payload.game`, so `game.drama_peak` and `game.drama_arc_parsed` are in the response.

**Client compatibility:** `buildEnrichedGame.debrief.dramaSealed` is currently null — Phase 3b (client side) will read `contextGame.game.drama_peak` and populate it. The field name is confirmed: relay serves `game.drama_peak`, client consumes as `debrief.dramaSealed`. No relay-side change needed.

---

### TASK 5 — Live probe (20/20)

```
GET /context/game/MLB_2026-07-17_brewers_marlins
→ 200 OK

game.drama_peak: 74
game.drama_arc_parsed: [52, 52, ..., 74, 74, ..., 66, 66]  (588 entries, full game arc)
game.home_score: 2, game.away_score: 1
game.finalized_at: "2026-07-18 02:55:27"
```

`drama_peak=74` matches the D1 row directly. Not backfilled, not faked — the value was written by the browser's `/archive/drama` POST after the game ended.

---

## Done condition: MET

- ✅ `drama_peak` column exists on both game tables
- ✅ Written by browser via `/archive/drama` on game-final only (objective trigger: browser detects game-final state via ESPN overlay, sends once)
- ✅ Persisted by archive handler
- ✅ Returned by Context Graph at `game.drama_peak` and `game.drama_arc_parsed`
- ✅ Live-probed against a real recent final game confirming end-to-end data flow

**Confidence: 100/100**

---

## Phase 3b (client side) now dispatchable

Relay contract confirmed:
- Endpoint: `GET /context/game/{id}`
- Response field: `game.drama_peak` (number, 0-100)
- Response field: `game.drama_arc_parsed` (array of numbers, one per poll tick)
- Response field: `game.opening_odds_parsed`, `game.closing_odds_parsed` (for The Odds Story)
- Cache TTL: 60s live / 300s final

Client consumer (Phase 3b work):
- Function: `buildEnrichedGame` — populate `debrief.dramaSealed` from `contextGame.game.drama_peak`
- Function: `assembleDebrief` — not yet built
- Function: `fillDebriefSlots` — not yet built
- Target slot: `data-slot="debrief"` (present in `_cardTemplate`)

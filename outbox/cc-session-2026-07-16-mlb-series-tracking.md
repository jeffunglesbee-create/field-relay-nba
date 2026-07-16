# CC Session 2026-07-16 — MLB Series Outcome Detection + isSeriesClinch Fix

## Date
2026-07-16

## Repo
field-relay-nba

## HEAD Progression
- Before: HEAD was prior main
- After:  dfebe9c — feat(archive): MLB series outcome detection + isSeriesClinch for regular-season games

## What Was Built

### Single commit: dfebe9c

**Problem addressed (Gap 10):**
`isSeriesClinch` in the newspaper bundle (`/analytics/newspaper`) was always `false` for
regular-season games because `regular_season_games` had no `importance` column — the
SELECT hardcoded `NULL AS importance`. Only postseason_games had the column. MLB regular-season
series outcomes (sweeps, series wins) were silently dropped.

**Changes in `src/index.js`:**

1. `ensureImportanceColumn(env)` — idempotent `ALTER TABLE regular_season_games ADD COLUMN
   importance TEXT DEFAULT NULL`. Same try/catch pattern as `ensureFinalizedAtColumn`. Module-level
   `_importanceColReady` guard.

2. `detectMLBSeriesOutcome(home, away, homeScore, awayScore, seriesRecord)` — pure function.
   Parses `series_record` "X-Y" string (home wins - away wins in series). Fires only when one
   side >= 2 wins AND this game is the clincher (winner won this game). Returns
   `{outcome:'sweep'|'series_win', winner, loser, wins, losses}` or null.
   Sweep = other side has 0 wins. Series win = non-sweep.

3. `writeMLBSeriesResult(env, gameId, sport, date, seriesResult)` — writes:
   - `UPDATE regular_season_games SET importance = ? WHERE id = ?` (outcome value)
   - `INSERT INTO briefs ... brief_type='mlb_series_result', source='series_detection'`
     with prose like "Yankees completed a sweep (3-0) over Red Sox."
   ON CONFLICT DO NOTHING on brief insert.

4. **Fire-and-forget block** wired in `POST /archive/game` after closing-odds capture block,
   before `return new Response`. Gates: `!series_key && sport === 'MLB' && home_score != null
   && away_score != null && series_record`. Wrapped in try/catch, never breaks core response.

5. **Newspaper bundle** (`/analytics/newspaper`, lines ~12000):
   - `NULL AS importance` → `importance` in regular_season_games SELECT
   - `isSeriesClinch = g.importance === 'clinch'` → adds `|| g.importance === 'sweep' || g.importance === 'series_win'`
   - Updated comment to reflect new schema reality

## Verified
- `node --check src/index.js` → SYNTAX OK
- Logic review: pure function + fire-and-forget pattern consistent with closing-odds capture

## Integration Status
STAGED — cannot do live E2E without a real MLB game sending series_record to /archive/game.
The feature is wired; no client changes needed (newspaper bundle already exposes `isSeriesClinch`
on completed_games entries which client reads).

Unblock criteria:
- Next MLB final archived via POST /archive/game with series_record="X-Y" where X or Y >= 2
- Verify: `SELECT id, importance FROM regular_season_games WHERE sport='MLB' AND importance IS NOT NULL`
  should return the clinching game row with importance='sweep' or 'series_win'
- Verify brief: `SELECT brief_text FROM briefs WHERE brief_type='mlb_series_result' LIMIT 5`

## Open Carry-Forwards
None from this session. Pre-existing held tasks documented in prior context:
- getDramaGateway() CC-CMD (docs/CC-CMD-2026-07-16-drama-gateway.md)
- Broadcast chip durable fix (docs/CC-CMD-2026-07-16-broadcast-chip-durable-fix.md)
- Frozen card / duplicate status fix
- wc_third_place_standings VIEW (2 live call sites will throw if hit)
- drama_arc JSON shape needs CONTRACTS.md entry
- Gap 5: /context/game/:id enrichment.recentGames vs promised enrichment.history
- Gap 6: enrichment.narratives/standings/wcMatchup brief types never written

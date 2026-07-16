# CC Session 2026-07-16 — broken_record JOIN key fix

## Date
2026-07-16

## Repo
field-relay-nba

## HEAD Progression
- Before: a980d2b
- After:  be664f0 — fix(analytics): broken_record JOIN on espn_event_id not slug id

## Root Cause

`runPhase6DBrokenRecord` in `src/analytics-engine.js` joined `briefs` to
`regular_season_games`/`postseason_games` on `b.game_id = g.id`.

- `briefs.game_id` stores ESPN numeric event IDs: `401815994`, `760493`
- `regular_season_games.id` stores FIELD slug IDs: `MLB_2026-07-02_phillies_pirates`

Result: JOIN returned **16 rows** from a 778-brief 14-day window.
All 16 were `game_brief` type (the one brief_type that uses FIELD-format IDs).
Game recap (364), mlb_game (182), night_owl (123) were entirely excluded.
The `analytics_output` broken_record row therefore always wrote `{"records":[],"lookback_days":14}`.

## Fix

Both JOIN keys changed from `g.id` to `g.espn_event_id`:

```js
// Before
FROM briefs b JOIN regular_season_games g ON b.game_id = g.id
FROM briefs b JOIN postseason_games g ON b.game_id = g.id

// After
FROM briefs b JOIN regular_season_games g ON b.game_id = g.espn_event_id
FROM briefs b JOIN postseason_games g ON b.game_id = g.espn_event_id
```

`regular_season_games.espn_event_id` confirmed populated: 236/686 games
in the recent window have it. `postseason_games.espn_event_id` present (col 23).

## Verified
- D1 probe: `JOIN ON g.espn_event_id` returns **397 rows** for 2026-07-02 to 2026-07-16
  — includes game_recap rows with full narrative prose (Belgium/Senegal, England/Congo DR,
  MLB game recaps, WNBA recaps)
- `node --check src/analytics-engine.js` → SYNTAX OK
- Committed `be664f0`, pushed to main

## Integration Status
STAGED — fix is deployed. broken_record output will populate on next Monday
morning cron run (processingDay === 0 gate in analytics-engine.js).

Unblock criteria:
- Next Monday cron runs
- `SELECT value FROM analytics_output WHERE feature='broken_record' ORDER BY date DESC LIMIT 1`
  → `records` array should be non-empty
- Client chip render at `renderNewspaper()` in index.html will display when records.length > 0

## Confidence: 97/100
- JOIN key fix verified against live D1 data (16 → 397 rows, confirmed)
- Both tables probed for espn_event_id column presence
- Sample prose quality confirmed rich (full narrative game recaps)
- Cannot run full algorithm simulation against 397 rows without deploying
- STAGED per Rule 61 with exact unblock criteria per Rule 74

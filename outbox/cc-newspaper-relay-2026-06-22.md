# O(1) Newspaper Bundle Endpoint — 2026-06-22

## Pre-build probes

- Generic `/analytics/{feature}/{date}` handler at `src/index.js:7821`
  (post-edit: moved further down). New `/analytics/newspaper/{date}`
  route inserted BEFORE it so the catch-all doesn't match `feature=
  "newspaper"` and return a single-row null lookup.
- `/analytics` already in probe_relay_route ALLOWED_PREFIX (commits
  during analytics-cron prompts). No allow-list change needed.
- `analytics_output` table is live with rows from all engine phases
  (verified by earlier probes of `/analytics/morning_report/*`,
  `/analytics/field_pick/*`, etc.).
- Game tables: `regular_season_games` has no status/OT columns;
  `postseason_games` carries `importance` ('clinch'|'elimination'|
  'playoffs'|null). Confirmed via PRAGMA in earlier sessions.

## What ships

Single GET endpoint at `src/index.js`. Two D1 reads in parallel
(yesterday + today from analytics_output) + two more for game
tables when present. Returns one bundle:

```
GET /analytics/newspaper/2026-06-22
→ {
    ok: true,
    date: "2026-06-22",
    recap_date: "2026-06-21",
    generated_at: <iso or null>,
    morning_report: <prose>,
    truth_is: {…, brief: <line>},
    night_stars: {…},
    pick: {…, brief: <line>},
    preview: <prose>,
    streak_board: {…},
    quality_feedback: {…},
    completed_games: [{ id, sport, home, away, homeScore, awayScore,
                        wentToOT:false, wasUpset, isSeriesClinch,
                        isElimination, margin }, …],
  }
```

## Upset detection rule

`wasUpset` = (favorite lost) AND (underdog closing ML ≥ +150).
Reads `closing_odds.moneyline.{home,away}`. Returns `false` when
odds malformed, missing, or both sides have the same sign.

## Failure modes (silent per Rule 5)

- ARCHIVE_DB unbound → 503 with `{ok:false,error}`.
- analytics_output empty for either date → that day's slot is empty;
  feature fields populate as null/empty.
- Game tables empty/missing → `completed_games: []`.
- closing_odds malformed → `wasUpset: false` (defensive catch).

## Carry-forwards

1. OT detection (`wentToOT`) hardcoded false — schema doesn't carry
   the bit. Would require a new column populated by GameDO or
   AmbientDO on final-state transitions.
2. KV-side editorial inputs (e.g. `field:circadian:preview:{date}`)
   are not consulted today; the endpoint reads everything from
   analytics_output. KV blend (if a feature lives ONLY in KV) is a
   separate prompt.

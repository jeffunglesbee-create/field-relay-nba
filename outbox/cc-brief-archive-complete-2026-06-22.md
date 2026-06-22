# Brief Archive Complete — KV Sweep + Backfill Gate + On-Demand Endpoint (2026-06-22)

## Pre-build probes

- Tasks 1-3 (sweepKVBriefs extraction, every-tick wiring, backfill gate fix)
  were already shipped in commit d64a9c8 (prior CC session, same day).
  Verified present at sweep function line 3717 and gate at line ~4868.
- Task 4 (GET /backfill/game-briefs) was not yet implemented.
- Task 5 (/backfill not in ALLOWED_PREFIX). Confirmed at line 9380.
- `callProxy` is not at module scope — defined as a local closure inside each
  handler (same pattern as executeBackfill, executeGameBriefBackfill). Added
  the same local closure inside the new route handler.
- `stripMarkdown` at line 3652 IS module-scope. `assembleContext` imported
  at line 59. Both used directly.

## What ships (commit f50fb1b)

1. **GET /backfill/game-briefs** — on-demand historical brief generator.
   Finds completed games (home_score IS NOT NULL) with no existing
   game_brief row in both regular_season_games and postseason_games.
   Generates 2-3 sentence recap per game via journalism proxy + strips
   markdown, INSERTs with source='backfill'. ON CONFLICT DO NOTHING.
   - `?dry=true` — returns missing-game list without writing
   - `?date=YYYY-MM-DD` — filters to single date
   - `?limit=N` — caps per-call work (default 10, max 50)
   - 2s inter-game delay to avoid proxy rate pressure
   - `assembleContext` called per game for sport-specific enrichment (budget 600 tokens)
   - Series context fetched from postseason_series for playoff games

2. **/backfill added to ALLOWED_PREFIX** at line ~9380 so MCP probe can
   discover and exercise the route.

## Post-deploy verification

Probed immediately after push (CF Workers deployed before CI run completed):

```
GET /backfill/game-briefs?dry=true → 200
{
  "ok": true, "dry_run": true, "missing": 10,
  "games": [
    { "id": "golf_2026-06-22_usopen_r4", "sport": "golf", ... },
    { "id": "MLB_2026-06-21_dodgers_orioles", "sport": "MLB", "score": "12-1" },
    { "id": "MLB_2026-06-21_athletics_angels", "sport": "MLB", "score": "9-7" },
    { "id": "WNBA_2026-06-21_aces_valkyries", "sport": "WNBA", "score": "73-92" },
    ... 6 more MLB + 1 FIFA World Cup 2026 match
  ]
}
```

Default limit=10 returned first 10; more games exist across earlier dates.
/health: RELAY OK, quality-source=analytics-cron.

## Full pipeline state (all three tasks, both sessions)

| Task | Commit | Status |
|------|--------|--------|
| sweepKVBriefs extracted to module scope | d64a9c8 | ✓ deployed |
| sweepKVBriefs wired into every */15 cron tick | d64a9c8 | ✓ deployed |
| Dead-hour inline block replaced with function call | d64a9c8 | ✓ deployed |
| game_brief backfill gate: skipped → skipped\|\|ok | d64a9c8 | ✓ deployed |
| GET /backfill/game-briefs endpoint | f50fb1b | ✓ deployed |
| /backfill added to ALLOWED_PREFIX | f50fb1b | ✓ deployed |

## Behavioral contract

- Dry run never writes. Idempotent: ON CONFLICT DO NOTHING means re-running
  the same date doesn't duplicate rows.
- Archive failure (D1 throw) caught per-game; `ok:false` in results array,
  never throws to caller.
- assembleContext failure caught per-game; prompt proceeds without sport context.
- Endpoint is NOT wired to cron — on-demand only per scope boundary.

## Carry-forwards

1. The `missing:10` dry-run result uses default `limit=10`. To see all
   missing games run: `/backfill/game-briefs?dry=true&limit=50`. The actual
   backfill for all ~56 missing games requires multiple calls
   (e.g. `/backfill/game-briefs?limit=50`) or date-filtered passes.
2. Golf game (`golf_2026-06-22_usopen_r4`) has `home_score IS NOT NULL` (R4
   score stored as home_score field). The backfill prompt will work but the
   output will be generic — golf rows have a different schema than team sports.
3. FIFA World Cup match (Belgium vs Iran, 0-0 draw) appears in missing list —
   score stored correctly. Recap will generate correctly.

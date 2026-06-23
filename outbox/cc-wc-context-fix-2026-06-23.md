# WC Context Fix — buildSoccerXGContext + buildESPNSummaryContext — 2026-06-23

## Probes (Rule 68)

| # | Probe                          | Result                                                                  |
|---|--------------------------------|--------------------------------------------------------------------------|
| 1 | `buildSoccerXGContext` body    | L275–278 — required `game.espnLeague` AND `game.eventId`, both undefined on backfill paths → returned `''` for every WC backfill game |
| 2 | `buildESPNSummaryContext` body | L361–368 — `String("FIFA World Cup 2026").toLowerCase().replace(/\s+/g,'')` → `"fifaworldcup2026"` ≠ `_ESPN_SPORT_SLUG["wc26"]` → slug null → returned `''` |
| 3 | `_ESPN_SPORT_SLUG` keys        | L352–359 — mlb / nba / wnba / nhl / wc26 / soccer. Key is `wc26`, not the unnormalized form. |
| 4 | sourceId fallback chain        | L362 — already `game.sourceId \|\| game.source_id \|\| game.espnEventId \|\| game.eventId` ✓ |
| 5 | backfill assembleContext sites | both pass `sourceId: game.espn_event_id` (from prior schema fix) but neither passes `espnLeague` or `eventId` |

Both bugs confirmed exactly as the CC-CMD diagnosed.

## What shipped

`src/context-assembler.js` — single commit, 2 surgical edits:

**`buildSoccerXGContext`:**
- Added inline `_SOCCER_SPORT_TO_LEAGUE` map covering wc26, FIFA WC variants, EPL/MLS/UCL/LaLiga/SerieA/Bundesliga/Ligue1.
- `league` resolution: `game.espnLeague || _SOCCER_SPORT_TO_LEAGUE[lower(game.sport)] || null`.
- `eventId` fallback chain: `game.eventId || game.sourceId || game.source_id || game.espnEventId || null`.

**`buildESPNSummaryContext`:**
- Added inline `_SUMMARY_SPORT_NORMALIZE`: `fifaworldcup2026 / fifaworldcup / worldcup / worldcup2026` → `wc26`.
- `sportKey` now normalized through that map before `_ESPN_SPORT_SLUG` lookup.

Live cron path (passes `espnLeague` + `eventId` explicitly) is unchanged — both new map lookups are fallbacks.

## Commit & deploy

- `fbf390f` fix: WC context builders — derive league + normalize sport for backfill paths (1 file, +35/−3)
- Deploy: workflow 28060836061 — completed/success.

## Task 3 verification

**xG endpoint live probe (`/soccer/xg?league=fifa.world&event=760456`):**
```json
{
  "_hasXG": true,
  "_source": "espn-core",
  "home": {"id":"202","name":"Argentina","abbr":"ARG","ppda":15.2,
           "expectedGoals":2.36,"expectedAssists":0.73,
           "expectedGoalsNonPenalty":1.57,"bigChanceCreated":2,"bigChanceMissed":3},
  "away": {"id":"474","name":"Austria","abbr":"AUT","ppda":12.9,
           "expectedGoals":0.53,"expectedAssists":0.89,"bigChanceCreated":1}
}
```

Route works. Team display names resolved (Argentina/Austria — fix from a prior session paid off). The fix in this CC-CMD wires backfill callers to actually hit this route, where they previously returned `''` before reaching it.

**`/quality/report` snapshot at deploy time:**

| brief_type   | sport               | count | avg   |
|--------------|---------------------|------:|------:|
| game_brief   | FIFA World Cup 2026 |     7 | 151.0 |
| game_brief   | MLB                 |    20 | 167.8 |
| game_brief   | WNBA                |     3 | 152.3 |
| game_brief   | golf                |     7 | 106.4 |

WC `game_brief` is currently 151.0 — the 17-row deficit per the spec
("17 rows as of today") has narrowed because the previous session's
backfill walk added re-scored entries. None of these existing WC rows
have `espn_event_id` populated yet (column added today; populated only
on new POSTs going forward).

## Done condition

- [x] Deploy success (CI green, workflow 28060836061)
- [x] `/soccer/xg?league=fifa.world&event=760456` returns `_hasXG:true`
- [x] `/quality/report` WC `game_brief` baseline noted (151.0, 7 rows)

## Carry-forwards

1. **Forward-only impact for WC.** Existing 7 WC `game_brief` rows have
   `espn_event_id=NULL` and `eventId/espnLeague` aren't on the backfill
   path — even with this fix, `buildSoccerXGContext` returns `''` for
   them because the `eventId` fallback chain still resolves to null.
   The fix unblocks WC games that ARE archived with `espn_event_id`
   set, which only happens for new `/archive/game` POSTs going forward.
2. **Tournament window.** WC2026 runs through July 19 2026. Roughly 4
   games per day produce ~100 more rows before the tournament ends —
   those will benefit from both `[SOCCER XG CONTEXT]` (via this fix)
   and `[ESPN GAME LEADERS]` (via espn_event_id schema), assuming the
   archive path keeps populating the column.
3. **Re-scoring legacy WC rows would need eventId backfill.** Cross-
   referencing the existing 7 WC `game_brief` rows against ESPN
   scoreboards by date+team to recover `espn_event_id` is a separate
   future session.
4. **Alert_count dropped 4 → 3.** game_brief WNBA cleared (no longer
   alerting). Side-effect of the previous session's quality recal +
   ongoing re-gens. Tracked for context.

## Verify commands

```
probe_relay_route /soccer/xg?league=fifa.world&event=760456     # _hasXG:true
probe_relay_route /quality/report                                # game_brief WC avg watch
probe_relay_route /journalism/context-probe                      # after next WC archive with espn_event_id, expect [SOCCER XG CONTEXT] + [ESPN GAME LEADERS] on WC rows
```

# CC Session — 2026-07-18 — context-game-espn-briefs

**Date:** 2026-07-18
**HEAD start:** 5eeb375
**HEAD end:** 9ce9a10
**Deploy gate:** CI triggered on 9ce9a10

---

## Commits

1. **88a8253** — `fix: /context/game bridges espn_event_id for brief + bracketDelta lookup`
   - `src/index.js`: split `Promise.allSettled` in `/context/game/{id}` handler into two steps — `findGame` sequential first, then parallel fan-out with `briefId = game?.espn_event_id || id` for `findBriefs` and `findBracketDelta`
   - `src/index.js`: pre_game brief INSERT `game_id` bind changed from `_pgArchRow.id` to `eventId` (ESPN event ID)

2. **9ce9a10** — `fix: findGame resolves archive row via espn_event_id for espn:NNNNNN client IDs`
   - `src/index.js`: `findGame` now tries a third lookup: strips `prefix:` from `espn:NNNNNN`-format IDs, queries `espn_event_id` column in both archive tables — so the `/context/game` handler actually gets `game.espn_event_id` populated, enabling `briefId = game.espn_event_id` to work correctly

---

## Root cause (discovered during execution)

The CC-CMD premise that "the archive's id column holds the api-sports.io game ID" was incorrect. Archive primary keys are `sport_date_home_away` strings (e.g. `WNBA_2026-07-18_valkyries_mystics`). ESPN adapters (`adaptESPNBasketball`, `adaptESPNMLB`, etc.) emit `fg.id = 'espn:NNNNNN'` — so `rawGame._gameId = 'espn:401857079'`. The original `findGame` couldn't find the archive row, so `game` was always null and `briefId` fell back to the `'espn:401857079'` client ID. `findBriefs` then queried `game_id = 'espn:401857079'` — but briefs store `game_id = '401857079'` (no prefix). Net result: still no briefs.

## Fix path (two commits)

- **88a8253**: Two-step /context/game handler + pre_game game_id normalization (correct logic, incomplete without 9ce9a10)
- **9ce9a10**: `findGame` espn_event_id lookup — strips `espn:` prefix, queries `espn_event_id` column → returns archive row → `game.espn_event_id = '401857079'` → `briefId = '401857079'` → `findBriefs` matches `game_id = '401857079'`

## D1 integration verification (VERIFIED)

Query confirmed 5 archive rows join to brief rows via `espn_event_id = game_id`:
- `WNBA_2026-07-18_valkyries_mystics` (espn_event_id=401857079) → game_recap brief ✓
- `MLB_2026-07-18_athletics_nationals` (espn_event_id=401816170) → game_recap brief ✓
- `FIFA World Cup 2026_2026-07-18_france_england` (espn_event_id=760516) → game_recap brief ✓
- `WNBA_2026-07-18_fever_liberty` (espn_event_id=401857077) → game_recap brief ✓
- `MLB_2026-07-18_guardians_pirates` (espn_event_id=401816159) → narrative_context brief ✓

Full chain: `contextId='espn:401857079'` → `findGame` regex extracts `'401857079'` → archive row found → `briefId='401857079'` → `findBriefs` `game_id='401857079'` match → `archive.gameBriefs[0].brief_text` populated → `buildFieldWasWatching` renders Layer 2.

HTTP probe STAGED (sandbox blocks egress). Unblock with deployed worker probe.

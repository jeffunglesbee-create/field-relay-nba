# CC Session — 2026-07-18 — context-game-espn-briefs

**Date:** 2026-07-18
**HEAD start:** 5eeb375
**HEAD end:** 88a8253
**Deploy gate:** CI triggered on 88a8253

---

## Commits

1. **88a8253** — `fix: /context/game bridges espn_event_id for brief + bracketDelta lookup`
   - `src/index.js`: split `Promise.allSettled` in `/context/game/{id}` handler into two steps — `findGame` sequential first, then parallel fan-out with `briefId = game?.espn_event_id || id` for `findBriefs` and `findBracketDelta`
   - `src/index.js`: pre_game brief INSERT `game_id` bind changed from `_pgArchRow.id` to `eventId` (ESPN event ID)

---

## TASK 2 — Two-step handler restructure

- Lines 9294-9315: `gSettled` resolves `findGame` first; `game?.espn_event_id || id` = `briefId`
- `findBriefs(env, briefId)` and `findBracketDelta(env, briefId)` use ESPN event ID
- `findSeries(env, id)` still uses api-sports.io ID — correct (postseason_games.id is api-sports.io)
- Error handling preserved for all 5 sources
- `payload` construction unchanged — `game`, `b`, `s`, `e`, `bd` all in scope

## TASK 3 — pre_game INSERT game_id

- Line 7826: `eventId` as `game_id` bind (was `_pgArchRow.id`)
- All three brief types now use ESPN event ID as `game_id`:
  - `game_recap`: `game_id = job.eventId` (unchanged)
  - `bracket_delta`: `game_id = espn_event_id` (unchanged, from GameDO)
  - `pre_game`: `game_id = eventId` (this fix)

## TASK 4 — Literal verification

```
grep -n "briefId" src/index.js | grep -v "mlb_series\|game_recap\|briefType"
→ line 9303: const briefId = game?.espn_event_id || id;
→ line 9305: findBriefs(env, briefId)
→ line 9311: findBracketDelta(env, briefId)
```

## TASK 5 — Integration probe

STAGED. Sandbox blocks HTTP probe.

Unblock: `curl -s https://field-relay-nba.jeffunglesbee.workers.dev/context/game/{apiSportsId} | node -e 'd=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.assert(d.archive?.gameBriefs?.length > 0, "no briefs"); console.log(d.archive.gameBriefs[0].brief_text)'`

Requires a game whose ESPN event ID has a brief in D1. Find via:
```sql
SELECT game_id, brief_type FROM briefs WHERE brief_type = 'game_recap' ORDER BY created_at DESC LIMIT 3
```
Then: `SELECT id FROM regular_season_games WHERE espn_event_id = '{espnId}'`

## TASK 6 — Pipeline

- `node --check src/index.js`: ✅ (no output = no errors)
- CI: triggered on 88a8253

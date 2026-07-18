# CC-CMD — /context/game brief resolution: bridge ESPN event ID in findBriefs

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

After the client fix (jubilant-bassoon `CC-CMD-2026-07-18-context-game-id-fix`)
sends `rawGame._gameId` (the api-sports.io game ID) to `/context/game/{id}`,
`findGame(env, id)` will correctly resolve the archive row — the archive's `id`
column holds the api-sports.io game ID. But the companion query, `findBriefs`,
still won't find anything because briefs are stored with:

```
game_id = job.eventId      -- ESPN event ID (journalism queue consumer)
id      = 'game_recap_{sport}_{espnEventId}'
```

`findBriefs(env, apiSportsId)` queries:
```sql
WHERE game_id = apiSportsId     -- no match: briefs use ESPN event ID
OR id LIKE '%apiSportsId%'      -- no match: id embeds ESPN event ID, not api-sports.io ID
```

Result: `gameBriefs: []` always, so `buildFieldWasWatching` (Debrief Layer 2)
never has a preGameBrief to render. Same gap for `findBracketDelta` — stored
with `game_id = espn_event_id` from GameDO.

**The fix**: once `findGame` resolves the archive row, extract its
`espn_event_id` and use it for `findBriefs` and `findBracketDelta`.
`findSeries` uses `postseason_games.series_key` (already correct — joined by
archive ID, not ESPN ID).

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5

# Confirm findGame is defined at its current line
grep -n "^async function findGame" src/index.js

# Confirm findBriefs is defined at its current line
grep -n "^async function findBriefs" src/index.js

# Confirm findBracketDelta is defined at its current line
grep -n "^async function findBracketDelta" src/index.js

# Confirm game rows have espn_event_id column
grep -n "espn_event_id" src/index.js | grep "SELECT\|FROM regular_season\|FROM postseason" | head -5

# Confirm briefs are stored with game_id = espn_event_id (job.eventId)
grep -n "game_id.*job\.eventId\|job\.eventId.*game_id\|eventId.*'cron'\|String(job\.eventId)" src/index.js | head -5

# Confirm current /context/game handler calls the 5 find* functions
grep -n "findGame\|findBriefs\|findBracketDelta" src/index.js | grep "await\|Promise\." | head -10
```

Paste real output before writing any code.

---

## TASK 1 — Identify the /context/game handler

Locate the Promise.allSettled block that calls findGame, findBriefs, findSeries,
findEnrichment, findBracketDelta in parallel. From pre-build probe output, confirm
the exact line range.

The current code (approximately):
```javascript
const settled = await Promise.allSettled([
    findGame(env, id),
    findBriefs(env, id),
    findSeries(env, id),
    findEnrichment(env, id),
    findBracketDelta(env, id),
]);
```

## TASK 2 — Bridge ESPN event ID for briefs + bracketDelta

After the settled destructure (immediately after `const [g, b, s, e, bd] = settled;`),
the handler already has `const game = g.status === 'fulfilled' ? g.value : null;`.
The game row includes `espn_event_id` (selected by `findGame` via `SELECT *`).

Change the parallel fan-out to a sequential two-step:
1. Resolve `findGame` first to get `espn_event_id`
2. Use `espn_event_id` (if available) for `findBriefs` and `findBracketDelta`

Concrete change — replace the current `Promise.allSettled([...])` block with:

```javascript
// Step 1: resolve game row first to get espn_event_id for brief lookup
const gSettled = await findGame(env, id).then(v => ({ status: 'fulfilled', value: v }))
    .catch(r => ({ status: 'rejected', reason: r }));
const game = gSettled.status === 'fulfilled' ? gSettled.value : null;
if (gSettled.status === 'rejected')
    _errors.push({ source: 'game', reason: String(gSettled.reason?.message || gSettled.reason) });

// Step 2: parallel fan-out — use espn_event_id for briefs/bracketDelta if available
const briefId = game?.espn_event_id || id;
const [b, s, e, bd] = await Promise.all([
    findBriefs(env, briefId).then(v => ({ status: 'fulfilled', value: v }))
        .catch(r => ({ status: 'rejected', reason: r })),
    findSeries(env, id).then(v => ({ status: 'fulfilled', value: v }))
        .catch(r => ({ status: 'rejected', reason: r })),
    findEnrichment(env, id).then(v => ({ status: 'fulfilled', value: v }))
        .catch(r => ({ status: 'rejected', reason: r })),
    findBracketDelta(env, briefId).then(v => ({ status: 'fulfilled', value: v }))
        .catch(r => ({ status: 'rejected', reason: r })),
]);
if (b.status === 'rejected')  _errors.push({ source: 'archive',      reason: String(b.reason?.message  || b.reason) });
if (s.status === 'rejected')  _errors.push({ source: 'series',       reason: String(s.reason?.message  || s.reason) });
if (e.status === 'rejected')  _errors.push({ source: 'enrichment',   reason: String(e.reason?.message  || e.reason) });
if (bd.status === 'rejected') _errors.push({ source: 'bracketDelta', reason: String(bd.reason?.message || bd.reason) });
```

Then remove the old `const [g, b, s, e, bd] = settled;` destructure and the
`if (g.status === 'rejected')` check (replaced by the Step 1 block above).

The `payload` construction and KV cache write are unchanged — `game` is already
set in Step 1, `b/s/e/bd` are in scope after Step 2.

**Correctness properties:**
- `findSeries` still uses `id` (api-sports.io ID) — correct, because
  `postseason_games.id` is the api-sports.io game ID.
- `findBriefs(env, briefId)` falls back to `id` when `espn_event_id` is null —
  same behavior as before for games not yet in the archive.
- `findBracketDelta(env, briefId)` uses ESPN event ID — matches how bracket_delta
  briefs are written (game_id = espn_event_id from GameDO/writeWCResult).
- Wall-clock time is unchanged: Step 2 still fans out 4 queries in parallel.
  Only `findGame` is now sequential (it was already first in the old allSettled,
  and the extra await adds ~1-2ms, within the existing 300s final / 60s live TTL).

## TASK 3 — Normalize pre_game brief game_id to ESPN event ID

The pre-game brief INSERT (inside the journalism cron, guarded by
`!comp.status?.type?.completed && (isPlayoff || nationalBroadcast)`) currently
writes `game_id = _pgArchRow.id` (the api-sports.io archive ID). After the
TASK 2 fix, `findBriefs` uses `briefId = espn_event_id`, so pre-game briefs
would still not be found.

Fix: in the pre-game brief INSERT, bind `eventId` (the ESPN event ID — already
in scope as the cron loop variable `const eventId = ev.id`) as `game_id` instead
of `_pgArchRow.id`.

Locate the INSERT (currently `VALUES (?, ?, 'pre_game', ?, ?, ?, ...)`) and
change the bind for `game_id` from `_pgArchRow.id` to `eventId`.

The brief `id` (`pre_game_${_pgArchRow.id}`) is unchanged — it's the unique row
key, not the lookup field.

After this change, all three brief types use ESPN event ID as `game_id`:
- `game_recap`: `game_id = job.eventId` (unchanged)
- `bracket_delta`: `game_id = espn_event_id` (unchanged, from GameDO)
- `pre_game`: `game_id = eventId` (this fix)

```bash
# Verify: the INSERT now uses eventId for game_id
grep -n -A5 "pre_game.*_pgArchRow\|_pgArchRow.*pre_game" src/index.js | grep "eventId\|_pgArchRow\.id"
```

## TASK 4 — Literal verification

```bash
grep -n "briefId\|espn_event_id.*id\|findBriefs.*briefId\|findBracketDelta.*briefId" src/index.js
```

Expected:
- `const briefId = game?.espn_event_id || id;` appears once
- `findBriefs(env, briefId)` appears in the new Step 2 fan-out
- `findBracketDelta(env, briefId)` appears in the new Step 2 fan-out

```bash
# Verify pre_game INSERT game_id uses eventId not _pgArchRow.id
grep -n "pre_game.*INSERT\|INSERT.*pre_game" src/index.js
# Then check the bind order on that line range
```

## TASK 5 — Integration probe (done condition)

After deploy, confirm a game that has a journalism brief in D1 actually surfaces
it via the context endpoint. Use a game whose ESPN event ID is known to have a
game_recap brief (check via D1 query first):

```bash
# Step A: find a game with a brief
# (chat session: mcp__a542a87e-4468-4000-904d-dff4ad9c3a20__probe_relay_route
#  or direct D1 query — SELECT game_id, brief_type, brief_text FROM briefs
#  WHERE brief_type = 'game_recap' ORDER BY created_at DESC LIMIT 3)

# Step B: find that game's api-sports.io ID via archive
# SELECT id, espn_event_id FROM regular_season_games WHERE espn_event_id = '{espnId}' LIMIT 1

# Step C: probe /context/game/{apiSportsId} — expect archive.gameBriefs[0].brief_text != null
# (If sandbox blocks HTTP, document as STAGED per Rule 61)
```

If sandbox blocks HTTP probe, mark integration verification as STAGED with the
above commands as the exact unblock criteria.

## TASK 6 — Pipeline

No smoke.js in this repo — use the relay's own deploy gate.

```bash
node --check src/index.js 2>&1  # syntax only
git diff --staged                # review before commit
git add src/index.js
git commit -m "fix: /context/game bridges espn_event_id for brief + bracketDelta lookup"
git push -u origin main
```

CI green (deploy.yml) = done.

---

## DONE CONDITION

```bash
grep -n "briefId" src/index.js
```

Output must show:
1. `const briefId = game?.espn_event_id || id;` 
2. `findBriefs(env, briefId)` in the fan-out
3. `findBracketDelta(env, briefId)` in the fan-out

Deploy confirmed green. Integration VERIFIED or STAGED with unblock commands.

**Confidence scoring:**
- TASK 2 (40 pts): correct two-step restructure; briefId fallback correct; error push preserved; payload unchanged
- TASK 3 (20 pts): pre_game INSERT game_id changed to eventId; grep verifies all 3 brief types now use ESPN event ID
- TASK 4 (15 pts): literal grep confirms briefId in all 3 expected sites
- TASK 5 (10 pts): integration probe (or STAGED with exact commands)
- TASK 6 (15 pts): deploy green

Do not commit unless confidence >= 95.

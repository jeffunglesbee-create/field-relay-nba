# CC-CMD — Fix WC context: buildSoccerXGContext + buildESPNSummaryContext

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** Two surgical edits to src/context-assembler.js

---

## BACKGROUND (verified from source — Rule 68 + 88)

`game_brief` WC scores 151/245 (62%) — both context builders return `''`
for WC backfill games. Root cause: both builders require fields that are not
passed from the backfill paths' assembleContext calls.

**Verified facts (SHA: e92a695f...):**

**Bug 1 — `buildSoccerXGContext` (L275-278):**
```javascript
const league  = game.espnLeague;   // undefined in backfill — not passed
const eventId = game.eventId;      // undefined in backfill — not passed
if (!league || !eventId) return '';
```
Backfill calls: `assembleContext(env, { sport, home, away, homeAbbr, awayAbbr, sourceId })`.
Neither `espnLeague` nor `eventId` is set. Both are undefined → returns `''`.

Fix: derive league from `game.sport` (unnormalized like "FIFA World Cup 2026"),
use `game.sourceId` as `eventId` fallback.

**Bug 2 — `buildESPNSummaryContext` (L361-368):**
```javascript
const sportKey = String(game.sport || '').toLowerCase().replace(/\s+/g, '');
// "FIFA World Cup 2026" → "fifaworldcup2026"
const slug = _ESPN_SPORT_SLUG[sportKey]  // _ESPN_SPORT_SLUG["fifaworldcup2026"] = undefined
  || (game.espnLeague ? ... : null);     // game.espnLeague = undefined in backfill
// slug = null → returns ''
```
`_ESPN_SPORT_SLUG` has key `wc26`, not `"fifaworldcup2026"`. Backfill path
sends unnormalized sport string → slug lookup fails → returns `''`.

Fix: add normalization map inside builder so "FIFA World Cup 2026" → "wc26"
before slug lookup.

**Note:** `assembleContext` normalizes `game.sport` ("FIFA World Cup 2026"
→ "wc26") for CONTEXT_SOURCES filtering, but passes the ORIGINAL game object
to builders (L436: `source.builder(env, game)`). Builders receive raw D1
sport strings, not normalized keys.

**`_SPORT_NORMALIZE` (L418-422) — for reference only:**
```javascript
const _SPORT_NORMALIZE = {
    'fifa world cup 2026': 'wc26',
    'fifa world cup': 'wc26',
    'world cup': 'wc26',
};
```

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Confirm buildSoccerXGContext lines L275-279
sed -n '275,280p' src/context-assembler.js

# 2. Confirm buildESPNSummaryContext lines L361-370
sed -n '361,370p' src/context-assembler.js

# 3. Confirm _ESPN_SPORT_SLUG keys
grep -n "_ESPN_SPORT_SLUG" src/context-assembler.js | head -5
# Read the map — should have: mlb, nba, wnba, nhl, wc26, soccer
# Confirm 'wc26' is a key (it is — adding to normalize toward it)

# 4. Confirm sourceId fallback chain in existing buildESPNSummaryContext
sed -n '362,363p' src/context-assembler.js
# Should be: game.sourceId || game.source_id || game.espnEventId || game.eventId

# 5. Confirm backfill assembleContext call sites pass sourceId
grep -n "assembleContext(env" src/index.js
# Then read each — confirm sourceId: game.espn_event_id is present (added by prior CC-CMD)
```

Write probe output to `outbox/cc-wc-context-fix-2026-06-23.md`.

---

## TASK 1 — Fix buildSoccerXGContext (L275-278)

Find `buildSoccerXGContext` at L275 (verify from probe #1).

**Replace lines L276-278:**
```javascript
    const league  = game.espnLeague;
    const eventId = game.eventId;
    if (!league || !eventId) return '';
```

**With:**
```javascript
    // Derive league slug when game.espnLeague is absent (backfill path).
    // Maps unnormalized D1 sport strings → ESPN API league slugs.
    // Live cron path always passes game.espnLeague explicitly — unchanged.
    const _SOCCER_SPORT_TO_LEAGUE = {
        'wc26': 'fifa.world', 'soccer': 'fifa.world',
        'fifa world cup 2026': 'fifa.world',
        'fifa world cup': 'fifa.world',
        'world cup': 'fifa.world',
        'epl': 'eng.1',   'english premier league': 'eng.1',
        'mls': 'usa.1',   'major league soccer': 'usa.1',
        'ucl': 'uefa.champions',
        'laliga': 'esp.1', 'la liga': 'esp.1',
        'seriea': 'ita.1', 'serie a': 'ita.1',
        'bundesliga': 'ger.1',
        'ligue1': 'fra.1', 'ligue 1': 'fra.1',
    };
    const _sportRaw = (game.sport || '').toLowerCase();
    const league  = game.espnLeague
        || _SOCCER_SPORT_TO_LEAGUE[_sportRaw]
        || null;
    const eventId = game.eventId
        || game.sourceId
        || game.source_id
        || game.espnEventId
        || null;
    if (!league || !eventId) return '';
```

---

## TASK 2 — Fix buildESPNSummaryContext sport normalization (L365-368)

Find `buildESPNSummaryContext` at L361 (verify from probe #2).

**Replace lines L365-368:**
```javascript
    const sportKey = String(game.sport || '').toLowerCase().replace(/\s+/g, '');
    const slug = _ESPN_SPORT_SLUG[sportKey]
        || (game.espnLeague ? _ESPN_SPORT_SLUG[String(game.espnLeague).toLowerCase()] : null)
        || null;
```

**With:**
```javascript
    // Normalize unnormalized D1 sport strings (e.g. "FIFA World Cup 2026")
    // to the keys used in _ESPN_SPORT_SLUG (e.g. "wc26").
    // assembleContext normalizes for registry filtering but passes original
    // game object to builders — builders must normalize themselves.
    const _SUMMARY_SPORT_NORMALIZE = {
        'fifaworldcup2026': 'wc26', 'fifaworldcup': 'wc26', 'worldcup': 'wc26',
        'worldcup2026': 'wc26',
    };
    const _sportRawKey = String(game.sport || '').toLowerCase().replace(/\s+/g, '');
    const sportKey = _SUMMARY_SPORT_NORMALIZE[_sportRawKey] || _sportRawKey;
    const slug = _ESPN_SPORT_SLUG[sportKey]
        || (game.espnLeague ? _ESPN_SPORT_SLUG[String(game.espnLeague).toLowerCase()] : null)
        || null;
```

---

## TASK 3 — Deploy and verify

```bash
# After deploy:

# 1. Probe xG endpoint directly for a live WC game
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/soccer/xg?league=fifa.world&event=760456" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    console.log("_hasXG:", d._hasXG, "home:", d.home?.name, "away:", d.away?.name);
  '

# 2. Re-generate existing WC game_briefs with force=true to pick up any context
# improvement from espn_event_id rows (new games from today onward)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/game-briefs?dry=true" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    const wc=(d.games||[]).filter(g=>(g.sport||"").includes("World Cup"));
    console.log("WC games available:", wc.length);
  '

# 3. Check /quality/report WC game_brief baseline (before new games accumulate)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/quality/report" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    d.summary.filter(r=>r.brief_type==="game_brief"&&(r.sport||"").includes("World Cup"))
      .forEach(r=>console.log(r.brief_type, r.sport, "avg:", r.avg_score, "n:", r.total));
  '
```

**Done condition:**
1. Deploy success (CI green)
2. `/soccer/xg?league=fifa.world&event=760456` returns `_hasXG: true` (confirming
   the xG route itself works — context assembler now routes to it)
3. `/quality/report` noted — improvement visible when new WC games are archived
   with `espn_event_id` populated (going forward from today's deploy)

**Note on legacy rows:** Existing WC `game_brief` rows (17 rows as of today)
have `espn_event_id = NULL` — context builders will still return `''` for those
specific rows on a force=true re-gen. Quality improvement accumulates from new
WC games going forward (tournament games are still running daily through July 19).

---

## TASK 4 — Write outbox manifest

Write `outbox/cc-wc-context-fix-2026-06-23.md`:
- Commit hash + deploy run ID
- Probe #1 + #2 output (exact lines confirmed)
- xG probe result
- /quality/report WC game_brief baseline at deploy time
- Note: full impact visible as tournament progresses and new espn_event_id rows accumulate

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Edit `buildSoccerXGContext` L276-278 in src/context-assembler.js
- Edit `buildESPNSummaryContext` L365-368 in src/context-assembler.js
- Single commit

DO NOT:
- Modify `assembleContext` orchestration
- Modify `_SPORT_NORMALIZE` (it's for registry filtering, not builder input)
- Modify `_ESPN_SPORT_SLUG` (add normalization inside the builder, not the map)
- Touch any other builder (savant, nhl_series, nba_clutch)
- Touch src/index.js
- Touch jubilant-bassoon

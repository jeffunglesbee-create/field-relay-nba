# CC-CMD — ESPN Summary context builder (buildESPNSummaryContext)

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** New builder in src/context-assembler.js + CONTEXT_SOURCES entry

---

## BACKGROUND (verified from source)

**The problem:** MLB `game_brief` averages 160/245. WC `game_brief` averages
137/245. Root cause: `assembleContext()` has no per-game player data.
Savant (MLB) provides team-level ABS grades only — no box score leaders.
Soccer xG provides match-level stats — no goal scorers. The LLM has no
names, no individual performance data, no game narrative to anchor Dims 1-6.

**The fix:** `buildESPNSummaryContext` fetches `/espn-summary/sports/{sport}/{league}/summary?event={sourceId}`
via the relay's existing proxy route (L8562-8568, verified live). Extracts
top performers from `leaders[]` array and formats as `[ESPN GAME LEADERS]`
context block.

**Verified from source:**
- ESPN Summary route: `site.web.api.espn.com/apis/site/v2` proxied at
  `/espn-summary/*`, allowed path pattern: `/sports/[a-z]+/[a-z]+/summary`
  (L557-559)
- `source_id = gm.eventId` stored in `regular_season_games.source_id` (L5147)
- Game object passed to assembleContext carries: `sport`, `home`, `away`,
  `homeAbbr`, `awayAbbr` (L4383-4386). Does NOT carry `source_id` yet —
  must be added at call sites (see Task 2).
- `buildSoccerXGContext` (L275-309) is the established builder pattern:
  fetch relay endpoint → parse → format named block → return '' on failure.
- CONTEXT_SOURCES registry at L348-357. New entry inserts at priority 3
  (higher than savant priority 7 — runs first, feeds player names into Dims
  1/4/6 before ABS stats fill the budget).
- `RELAY_BASE = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'`
  (established pattern from buildSoccerXGContext L279).

**Live probe confirmed:** `/espn-summary/sports/baseball/mlb/summary?event=401696473`
returns `leaders[]` array with per-category top performers including
`athlete.displayName` and `displayValue`. WC games use league slug `fifa.world`.

**Sport → ESPN slug mapping (verified from existing relay code):**
- MLB: `sports/baseball/mlb`
- WC: `sports/soccer/fifa.world`
- WNBA: `sports/basketball/wnba`
- NBA: `sports/basketball/nba`
- NHL: `sports/hockey/nhl`

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Confirm CONTEXT_SOURCES block location and current entries
grep -n "CONTEXT_SOURCES\|soccer_xg\|buildSavant\|odds_story" src/context-assembler.js | head -10

# 2. Confirm buildSoccerXGContext pattern (established builder reference)
sed -n '275,320p' src/context-assembler.js

# 3. Confirm RELAY_BASE pattern
grep -n "RELAY_BASE\|relay_base\|workers.dev" src/context-assembler.js | head -5

# 4. Confirm export block location
tail -20 src/context-assembler.js

# 5. Confirm game object shape at assembleContext call sites
grep -n "assembleContext(env" src/index.js | head -6
# Then read each call site ±5 lines to see what fields are passed
# Key question: does any call site already pass source_id / espnEventId?

# 6. Confirm regular_season_games has source_id column
grep -n "source_id" src/index.js | grep -i "select\|INSERT\|regular_season" | head -8

# 7. Probe live ESPN summary for MLB leaders shape
# (sandbox can reach field-relay-nba.jeffunglesbee.workers.dev)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/espn-summary/sports/baseball/mlb/summary?event=401696473" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    (d.leaders||[]).slice(0,4).forEach(cat => {
      const ls = Array.isArray(cat.leaders) ? cat.leaders : (cat.leaders?.leaders||[]);
      const top = ls[0];
      if (top) console.log(cat.displayName, "→", top.athlete?.displayName, top.displayValue);
    });
  '

# 8. Probe WC game (use a recent fixture ID from D1 if available, else skip)
# curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/espn-summary/sports/soccer/fifa.world/summary?event=760456" \
#   | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(Object.keys(d));'
```

Write probe output to `outbox/cc-espn-summary-context-2026-06-23.md`
before writing any code. Adjust field names below to match probe output.

---

## TASK 1 — Add `buildESPNSummaryContext` to src/context-assembler.js

Insert the function immediately before the `const CONTEXT_SOURCES = [` line
(verify exact line from probe #1).

```javascript
// ── buildESPNSummaryContext — per-game leaders from ESPN Summary API ─────────
// Fetches /espn-summary/sports/{sport}/{league}/summary?event={sourceId}
// via the relay's existing ESPN Summary proxy route.
// Returns [ESPN GAME LEADERS] block with top performers per category.
// Fails gracefully: '' on any error or missing data (Rule 5).
//
// Sport → ESPN slug mapping (verified June 23 2026):
//   mlb  → sports/baseball/mlb
//   wc26 → sports/soccer/fifa.world
//   wnba → sports/basketball/wnba
//   nba  → sports/basketball/nba
//   nhl  → sports/hockey/nhl
const _ESPN_SPORT_SLUG = {
  mlb:  'sports/baseball/mlb',
  nba:  'sports/basketball/nba',
  wnba: 'sports/basketball/wnba',
  nhl:  'sports/hockey/nhl',
  wc26: 'sports/soccer/fifa.world',
  soccer: 'sports/soccer/fifa.world',
};

async function buildESPNSummaryContext(env, game) {
  const sourceId = game.sourceId || game.source_id || game.espnEventId;
  if (!sourceId) return '';

  // Resolve sport key — use _SPORT_NORMALIZE output (game.sport is already
  // normalized by assembleContext before calling builders)
  const sportKey = (game.sport || '').toLowerCase().replace(/\s+/g, '');
  const slug = _ESPN_SPORT_SLUG[sportKey] ||
    _ESPN_SPORT_SLUG[game.espnLeague] ||
    null;
  if (!slug) return '';

  const base = env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
  try {
    const resp = await fetch(
      `${base}/espn-summary/${slug}/summary?event=${encodeURIComponent(String(sourceId))}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!resp.ok) return '';
    const d = await resp.json().catch(() => null);
    if (!d) return '';

    const leaders = d.leaders || [];
    if (!leaders.length) return '';

    const lines = ['', '[ESPN GAME LEADERS]'];
    for (const cat of leaders.slice(0, 5)) {
      // leaders[].leaders may be array or {leaders:[...]} object
      const ls = Array.isArray(cat.leaders) ? cat.leaders :
        (Array.isArray(cat.leaders?.leaders) ? cat.leaders.leaders : []);
      const top = ls[0];
      if (!top) continue;
      const name = top.athlete?.displayName || top.athlete?.shortName;
      const val  = top.displayValue;
      if (name && val) {
        lines.push(`${cat.displayName}: ${name} ${val}`);
      }
    }

    return lines.length > 2 ? lines.join('\n') + '\n' : '';
  } catch (_) { return ''; }
}
```

---

## TASK 2 — Add entry to CONTEXT_SOURCES

In the `CONTEXT_SOURCES` array (verify exact location from probe #1),
add `espn_summary` as the **first entry** (priority 3 — runs before savant
so player names enter Dim 1/4/6 before ABS stats fill the budget):

```javascript
const CONTEXT_SOURCES = [
  { id: 'espn_summary', priority: 3, budget: 200, builder: buildESPNSummaryContext,
    sports: ['mlb', 'nba', 'wnba', 'nhl', 'wc26', 'soccer'] },
  { id: 'odds_story',   priority: 5, budget: 100, builder: buildOddsStoryContext,
    sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
             'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1'] },
  // ... rest of existing entries unchanged
```

---

## TASK 3 — Pass sourceId into assembleContext at all call sites

`buildESPNSummaryContext` reads `game.sourceId`. Currently no call site
passes this field. Must add at every `assembleContext(env, {...})` call.

From probe #5, find all call sites. For each, add `sourceId: game.source_id`
(or the equivalent field name from that context).

**Known call sites from probe (verify exact lines):**
- L4383: executeGameBriefBackfill → game row from D1 has `source_id` column
  → add `sourceId: game.source_id`
- L5464: journalism cron game loop → game from ESPN scoreboard has `eventId`
  → add `sourceId: game.eventId`
- L7568: /backfill/game-briefs → game row from D1 → add `sourceId: game.source_id`
- L8621/8643: /backfill/brief-scores or other → check probe output for actual field

**Do NOT guess field names.** Read each call site from probe #5+6 before
adding sourceId. If a call site has no source_id/eventId available, skip it
(builder returns '' gracefully).

---

## TASK 4 — Add to exports

In the export block at end of file (verify from probe #4):
```javascript
export {
  assembleContext,
  r2Json,
  resolveAbbr,
  buildSavantContext,
  buildNHLSeriesContext,
  buildNBAClutchContext,
  buildSoccerXGContext,
  buildESPNSummaryContext,  // ← add
};
```

---

## TASK 5 — Deploy and verify

```bash
# 1. Probe context assembler output for an MLB game with known source_id
# Find a recent source_id from D1:
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/archive/query?sport=MLB&limit=3" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    d.results.forEach(r => console.log(r.game_id, "source_id?", r.game_id));
  '

# 2. Verify ESPN summary returns leaders for a known event
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/espn-summary/sports/baseball/mlb/summary?event=401696473" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    const leaders=d.leaders||[];
    console.log("leader categories:", leaders.length);
    leaders.slice(0,3).forEach(c=>{
      const ls=Array.isArray(c.leaders)?c.leaders:(c.leaders?.leaders||[]);
      const top=ls[0];
      if(top) console.log(" ", c.displayName,"→",top.athlete?.displayName,top.displayValue);
    });
  '

# 3. Force a backfill brief for an MLB game with source_id and check AI Gateway
# for [ESPN GAME LEADERS] block in the prompt
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/game-briefs?dry=true&limit=5" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    console.log("games available:", d.missing || d.games?.length);
    (d.games||[]).slice(0,3).forEach(g=>console.log(" ",g.id, g.sport, g.matchup));
  '
```

**Done condition:**
1. `/espn-summary/sports/baseball/mlb/summary?event=401696473` returns
   `leaders[]` with at least 3 entries (already verified live — confirms route works)
2. AI Gateway logs (check payload logging at field-journalism gateway) show
   `[ESPN GAME LEADERS]` block in at least one MLB brief prompt after deploy.
   OR: trigger `/backfill/game-briefs?force=true&limit=1` for an MLB game
   with source_id and verify quality_score improves vs pre-deploy baseline of 160.

If AI Gateway is accessible from CC sandbox, check it. If not, the
dry=true probe confirming games are available + deploy success is sufficient.
Note any inaccessibility in the manifest.

---

## TASK 6 — Write outbox manifest

Write `outbox/cc-espn-summary-context-2026-06-23.md`:
- Commit hash + deploy run ID
- Probe #7 output (ESPN leaders shape confirmed)
- Call sites updated (list each with field name used)
- Done condition result
- Baseline MLB avg_score from /quality/report before change (160/245)

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Add `buildESPNSummaryContext` function to src/context-assembler.js
- Add `_ESPN_SPORT_SLUG` mapping constant
- Add `espn_summary` entry to CONTEXT_SOURCES (priority 3, first entry)
- Add `sourceId` field to assembleContext call sites that have it available
- Add to exports
- Single commit + deploy

DO NOT:
- Modify existing builders (savant, nhl_series, nba_clutch, soccer_xg)
- Modify the assembleContext() orchestration function
- Modify /quality/report (separate CC-CMD handles that)
- Touch journalism-quality.js or scoring logic
- Touch jubilant-bassoon
- Add new Cloudflare bindings

---

## UNKNOWNS (document, do not block on)

- WC `leaders[]` shape: probe #8 is optional. Soccer ESPN summary may return
  goals/assists leaders differently. Builder handles absence gracefully
  (returns '' if leaders.length === 0).
- Post-game vs live timing: ESPN leaders are populated after game completes.
  For live games, builder returns '' (no leaders yet) — correct behavior.
- source_id in D1: verify from probe #6 that regular_season_games.source_id
  is populated for recent MLB games. If NULL (older rows), builder returns ''.
  New games will have it going forward.

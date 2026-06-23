# CC-CMD — espn_event_id schema + game object enrichment in backfill prompts

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** Schema change + 3 code edits + re-generate existing game_briefs

---

## BACKGROUND (verified from source, no assumptions)

The ESPN Summary context builder (`buildESPNSummaryContext`, priority 3) is
deployed and working on the live cron path. It fails silently on backfill
paths because `source_id` is not a column in D1.

**Verified facts:**
- `regular_season_games` columns (PRAGMA verified): id, sport, league, date,
  home, away, home_score, away_score, venue, streams, note, tags, crew,
  local_note, created_at, opening_odds, closing_odds, drama_peak, drama_arc.
  NO espn_event_id, NO source_id.
- `postseason_games` — same gap (source_id not persisted).
- `/archive/game` POST body includes `source_id` (L6901) but INSERT at L6944
  does not write it. It's received and discarded.
- `executeGameBriefBackfill` assembleContext call at L4383-4387:
  `sourceId: game.source_id || null` → resolves to null (column absent).
- `/backfill/game-briefs` assembleContext call at L7570-7574:
  `sourceId: game.source_id || null` → resolves to null (column absent).
- Live cron assembleContext call at L5465-5473:
  `sourceId: m.eventId` → WORKS. ESPN leaders inject tonight for game_recap.
- Both backfill prompts already include `Date:` and score line. They do NOT
  include `venue` (it's in D1 but not passed to the prompt).
- `JOURNALISM_CLAUDE_PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev'`
  (L3415)

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Confirm regular_season_games INSERT location and columns
grep -n "INSERT INTO regular_season_games" src/index.js
sed -n '6944,6962p' src/index.js

# 2. Confirm postseason_games INSERT location and columns
grep -n "INSERT INTO postseason_games" src/index.js | head -5
# Read the first INSERT block

# 3. Confirm executeGameBriefBackfill assembleContext call
sed -n '4383,4388p' src/index.js

# 4. Confirm /backfill/game-briefs SELECT columns + assembleContext call
sed -n '7490,7500p' src/index.js
sed -n '7568,7576p' src/index.js

# 5. Confirm /backfill/game-briefs prompt block
sed -n '7577,7588p' src/index.js

# 6. Confirm executeGameBriefBackfill prompt block
sed -n '4409,4420p' src/index.js

# 7. Count existing game_brief rows that will need re-gen
# (via relay probe — backfill/game-briefs?dry=true)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/game-briefs?dry=true&limit=50" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log("available for backfill:", d.missing || d.games?.length || 0)'
```

Write probe output to `outbox/cc-espn-event-id-schema-2026-06-23.md`.

---

## TASK 1 — ALTER TABLE (run immediately, before code changes)

Execute both migrations against `field-archive` D1
(`cc49101c-0569-4d41-8e7a-be139cde4f26`) via the Cloudflare D1 MCP tool
or via the relay's `/d1/execute` endpoint:

```sql
ALTER TABLE regular_season_games ADD COLUMN espn_event_id TEXT;
ALTER TABLE postseason_games ADD COLUMN espn_event_id TEXT;
```

Verify:
```sql
PRAGMA table_info(regular_season_games);
-- espn_event_id should appear at the end
PRAGMA table_info(postseason_games);
```

Existing rows will have `espn_event_id = NULL` — builder handles null
gracefully (returns ''). New games written via /archive/game will have it.

---

## TASK 2 — Persist espn_event_id in /archive/game INSERT

Find the regular_season_games INSERT at L6944 (verify from probe #1).

**Replace:**
```javascript
`INSERT INTO regular_season_games
(id, sport, league, date, home, away,
home_score, away_score, venue, streams, note, crew)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
home_score = COALESCE(excluded.home_score, home_score),
away_score = COALESCE(excluded.away_score, away_score),
note       = COALESCE(excluded.note, note),
venue      = COALESCE(excluded.venue, venue),
streams    = COALESCE(excluded.streams, streams),
crew       = COALESCE(excluded.crew, crew)`
).bind(
id, sport, league || null, date,
home || null, away || null,
home_score ?? null, away_score ?? null,
venue || null, streams || null,
note || null, crew || null
)
```

**With:**
```javascript
`INSERT INTO regular_season_games
(id, sport, league, date, home, away,
home_score, away_score, venue, streams, note, crew, espn_event_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
home_score    = COALESCE(excluded.home_score, home_score),
away_score    = COALESCE(excluded.away_score, away_score),
note          = COALESCE(excluded.note, note),
venue         = COALESCE(excluded.venue, venue),
streams       = COALESCE(excluded.streams, streams),
crew          = COALESCE(excluded.crew, crew),
espn_event_id = COALESCE(excluded.espn_event_id, espn_event_id)`
).bind(
id, sport, league || null, date,
home || null, away || null,
home_score ?? null, away_score ?? null,
venue || null, streams || null,
note || null, crew || null,
source_id ? String(source_id) : null
)
```

Do the same for the postseason_games INSERT (find from probe #2 — add
`espn_event_id` column and `source_id ? String(source_id) : null` bind).

---

## TASK 3 — Update backfill SELECTs to include espn_event_id

**In `/backfill/game-briefs`** (verify from probe #4, around L7491):

Replace:
```javascript
SELECT g.id, g.date, g.sport, g.home, g.away,
g.home_score, g.away_score, g.closing_odds,
NULL as series_key, NULL as importance
FROM regular_season_games g
```

With:
```javascript
SELECT g.id, g.date, g.sport, g.home, g.away,
g.home_score, g.away_score, g.closing_odds,
g.venue, g.espn_event_id,
NULL as series_key, NULL as importance
FROM regular_season_games g
```

And for postseason (around L7502):
```javascript
SELECT g.id, g.date, g.sport, g.home, g.away,
g.home_score, g.away_score, g.closing_odds,
g.venue, g.espn_event_id,
g.series_key, g.importance
FROM postseason_games g
```

**In `executeGameBriefBackfill`** (L4355-4360):
```javascript
`SELECT *, venue, espn_event_id FROM regular_season_games WHERE date = ? AND home_score IS NOT NULL`
`SELECT *, venue, espn_event_id FROM postseason_games WHERE date = ? AND home_score IS NOT NULL`
```
(`SELECT *` already returns all columns but espn_event_id is new — explicit
is safer. Alternatively just use `SELECT *` and it will include the new column
automatically since SQLite SELECT * includes all columns.)

---

## TASK 4 — Pass espn_event_id as sourceId to assembleContext

**In `/backfill/game-briefs`** (verify from probe #4, around L7570-7574):

Replace:
```javascript
sportContext = await assembleContext(env, {
  sport: sportLabel, home: game.home, away: game.away,
  homeAbbr: '', awayAbbr: '',
  sourceId: game.source_id || null,
}, 600);
```

With:
```javascript
sportContext = await assembleContext(env, {
  sport: sportLabel, home: game.home, away: game.away,
  homeAbbr: '', awayAbbr: '',
  sourceId: game.espn_event_id || null,
}, 600);
```

**In `executeGameBriefBackfill`** (L4383-4387):

Replace:
```javascript
sportContext = await assembleContext(env, {
  sport, home, away,
  homeAbbr: '', awayAbbr: '',
  sourceId: game.source_id || null,
}, 600);
```

With:
```javascript
sportContext = await assembleContext(env, {
  sport, home, away,
  homeAbbr: '', awayAbbr: '',
  sourceId: game.espn_event_id || null,
}, 600);
```

---

## TASK 5 — Add venue to backfill prompts

Both backfill prompt blocks (L7577-7587 and L4409-4418) currently include
the score line and date but not venue. Venue is now selected from D1 (Task 3).

**In `/backfill/game-briefs` prompt** (after score line, before sportContext):
```javascript
const gamePrompt = [
  FIELD_VOICE_REGISTER,
  `Write a 50-70 word game brief for this ${sportLabel}${isPostseason ? ' playoff' : ''} game.`,
  `${game.away} ${game.away_score} at ${game.home} ${game.home_score}`,
  game.venue ? `Venue: ${game.venue}` : '',   // ← add
  `Date: ${game.date}`,
  isPostseason ? `Round: ${game.importance || 'postseason'}${seriesContext}` : '',
  sportContext || '',
  `SPORT BOUNDARY: ...`,
  `Rules: ...`,
  JQ_STYLE,
].filter(Boolean).join('\n');
```

**In `executeGameBriefBackfill` prompt** (same position):
```javascript
const gamePrompt = [
  FIELD_VOICE_REGISTER,
  `Write a 50-70 word game brief for this ${sport}${isPostseason ? ' playoff' : ''} game.`,
  `${away} ${game.away_score} at ${home} ${game.home_score}`,
  game.venue ? `Venue: ${game.venue}` : '',   // ← add
  `Date: ${date}`,
  ...
```

---

## TASK 6 — Deploy and verify

```bash
# After deploy:

# 1. Confirm espn_event_id persisted on next /archive/game call
# (or check via D1 probe — will be NULL for existing rows, populated for new ones)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/archive/query?sport=MLB&limit=3" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); d.results.forEach(r=>console.log(r.game_id))'

# 2. Probe /journalism/context-probe to verify [ESPN GAME LEADERS] appears
# for a completed game (may need a recently-completed game with espn_event_id)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/journalism/context-probe" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    (d.games||[]).forEach(g=>console.log(g.matchup, "contextLength:", g.contextLength,
      "[ESPN]:", g.context?.includes("[ESPN GAME LEADERS]") ? "YES" : "no"));
  '

# 3. Trigger /backfill/game-briefs?force=true to re-generate existing briefs
# with the new context (existing espn_event_id = NULL, but venue now in prompt)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/game-briefs?force=true&limit=20" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    console.log("processed:", d.processed, "generated:", d.generated);
    if (d.results) d.results.slice(0,3).forEach(r=>console.log(" ", r.id, "score:", r.quality_score));
  '

# Repeat until dry=true returns 0
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/game-briefs?dry=true" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log("remaining:", d.missing || d.games?.length || 0)'

# 4. Check /quality/report for game_brief MLB avg_score improvement
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/quality/report" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    d.summary.filter(r=>r.brief_type==="game_brief"&&r.sport==="MLB")
      .forEach(r=>console.log("game_brief MLB avg:", r.avg_score, "/245 (baseline was 159.6)"));
  '
```

**Done condition:**
1. `ALTER TABLE` success — `PRAGMA table_info` shows `espn_event_id` column
2. `/backfill/game-briefs?dry=true` returns `missing: 0` after re-gen passes
3. `/quality/report` `game_brief` MLB avg_score > 159.6 (baseline pre-deploy)
4. Outbox manifest committed

Note: ESPN leaders (from `buildESPNSummaryContext`) will only appear in
re-generated briefs for games where `espn_event_id` was populated by a
post-deploy `/archive/game` call. Existing rows have NULL — venue enrichment
still improves them via Task 5. ESPN leaders will accumulate going forward.

---

## TASK 7 — Write outbox manifest

Write `outbox/cc-espn-event-id-schema-2026-06-23.md`:
- Commits + deploy run ID
- ALTER TABLE confirmation
- Backfill re-gen count + score improvement
- /quality/report game_brief MLB avg_score before vs after
- Remaining null espn_event_id count (expected: all existing rows)

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- ALTER TABLE regular_season_games ADD COLUMN espn_event_id
- ALTER TABLE postseason_games ADD COLUMN espn_event_id
- Update /archive/game INSERT (2 tables) to persist espn_event_id
- Update 2 backfill SELECT queries to include espn_event_id + venue
- Update 2 assembleContext calls to pass sourceId from espn_event_id
- Add venue line to 2 prompt blocks
- Re-run /backfill/game-briefs?force=true until complete
- Single commit (all src/index.js changes together)

DO NOT:
- Modify context-assembler.js (buildESPNSummaryContext already correct)
- Modify live cron assembleContext call (already working at L5465-5473)
- Modify journalism-quality.js
- Touch jubilant-bassoon
- Add new CF bindings

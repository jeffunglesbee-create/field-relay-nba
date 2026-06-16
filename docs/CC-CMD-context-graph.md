# Claude Code Command — Context Graph API

Read CLAUDE.md first.

## CONTEXT

FIELD has data in 6 disconnected stores: D1 archive (games, briefs, odds,
enrichment), D1 wc2026 (standings), KV (live journalism), R2 (analytics),
Analytics Engine (JQ metrics), Durable Objects (live game state). Every
consumer (journalism prompt, card enrichment, Night Owl, replay engine)
independently assembles its own context through narrow query paths.

The Context Graph is a single relay endpoint that returns EVERYTHING FIELD
knows about a game. One call replaces 5-6 scattered queries. Every existing
and future consumer reads from this one response.

D1 field-archive: cc49101c (binding: ARCHIVE_DB)
D1 wc2026: f26669de (binding: WC2026_DB)
KV: FIELD_JOURNALISM

## TASKS

### COMMIT 1 — GET /context/game/{id} endpoint

Add to src/index.js. The {id} parameter matches against:
- Game ID in regular_season_games.id or postseason_games.id
- Source ID pattern: {sport}_{date}_{home}_{away} (lowercase, no spaces)
- Series key in postseason_series.series_key
- Fuzzy match: if no exact match, try matching home+away+date substring

The endpoint assembles the response from parallel D1 queries:

```javascript
if (pathname.startsWith('/context/game/')) {
  const id = decodeURIComponent(pathname.slice('/context/game/'.length));

  // Parallel queries — all wrapped in try/catch individually
  const [game, briefs, series, enrichment] = await Promise.allSettled([
    findGame(env, id),
    findBriefs(env, id),
    findSeries(env, id),
    findEnrichment(env, id)
  ]);

  return Response.json({
    ok: true,
    game: game.status === 'fulfilled' ? game.value : null,
    archive: briefs.status === 'fulfilled' ? briefs.value : null,
    series: series.status === 'fulfilled' ? series.value : null,
    enrichment: enrichment.status === 'fulfilled' ? enrichment.value : null
  }, { headers: corsHeaders });
}
```

### COMMIT 2 — findGame() helper

Query both game tables + WC D1:

```javascript
async function findGame(env, id) {
  // Try postseason first (richer data)
  let row = await env.ARCHIVE_DB.prepare(
    `SELECT * FROM postseason_games WHERE id = ? OR
     (home || '_' || away || '_' || date) LIKE ?`
  ).bind(id, '%' + id + '%').first();

  if (!row) {
    row = await env.ARCHIVE_DB.prepare(
      `SELECT * FROM regular_season_games WHERE id = ? OR
       (home || '_' || away || '_' || date) LIKE ?`
    ).bind(id, '%' + id + '%').first();
  }

  if (!row) return null;

  // Parse odds if present
  let openingOdds = null, closingOdds = null;
  try { if (row.opening_odds) openingOdds = JSON.parse(row.opening_odds); } catch(_) {}
  try { if (row.closing_odds) closingOdds = JSON.parse(row.closing_odds); } catch(_) {}

  return {
    ...row,
    opening_odds_parsed: openingOdds,
    closing_odds_parsed: closingOdds,
    lineMovement: (openingOdds && closingOdds) ? {
      spreadOpen: openingOdds.spread?.home,
      spreadClose: closingOdds.spread?.home,
      moved: openingOdds.spread?.home !== closingOdds.spread?.home
    } : null
  };
}
```

### COMMIT 3 — findBriefs() helper

Query briefs table for all briefs related to this game:

```javascript
async function findBriefs(env, id) {
  // Get game date from id or parse it
  const dateMatch = id.match(/\d{4}-\d{2}-\d{2}/);
  const date = dateMatch ? dateMatch[0] : null;

  const results = {};

  // Game-specific briefs
  const gameBriefs = await env.ARCHIVE_DB.prepare(
    `SELECT id, brief_type, brief_text, quality_score, source, model, word_count
     FROM briefs WHERE game_id = ? OR id LIKE ?
     ORDER BY created_at DESC LIMIT 5`
  ).bind(id, '%' + id + '%').all();
  results.gameBriefs = gameBriefs.results || [];

  // Slate brief for this date
  if (date) {
    const slate = await env.ARCHIVE_DB.prepare(
      `SELECT brief_text, quality_score, source FROM briefs
       WHERE brief_type = 'slate' AND date = ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(date).first();
    results.slateBrief = slate || null;

    // Prior day's brief (for temporal context)
    const prior = await env.ARCHIVE_DB.prepare(
      `SELECT brief_text, quality_score, date FROM briefs
       WHERE brief_type = 'slate' AND date < ?
       ORDER BY date DESC LIMIT 1`
    ).bind(date).first();
    results.priorBrief = prior || null;
  }

  return results;
}
```

### COMMIT 4 — findSeries() helper

Query series context if this is a postseason game:

```javascript
async function findSeries(env, id) {
  // Find series_key from the game
  const game = await env.ARCHIVE_DB.prepare(
    `SELECT series_key FROM postseason_games WHERE id = ? LIMIT 1`
  ).bind(id).first();

  if (!game?.series_key) return null;

  // Get series narrative
  const series = await env.ARCHIVE_DB.prepare(
    `SELECT * FROM postseason_series WHERE series_key = ?`
  ).bind(game.series_key).first();

  // Get all games in this series
  const games = await env.ARCHIVE_DB.prepare(
    `SELECT id, game_number, date, home_score, away_score, note, importance
     FROM postseason_games WHERE series_key = ?
     ORDER BY game_number`
  ).bind(game.series_key).all();

  return {
    series: series || null,
    games: games.results || [],
    margins: (games.results || [])
      .filter(g => g.home_score != null)
      .map(g => g.home_score - g.away_score)
  };
}
```

### COMMIT 5 — findEnrichment() helper

Query all enrichment context relevant to this game:

```javascript
async function findEnrichment(env, id) {
  const dateMatch = id.match(/\d{4}-\d{2}-\d{2}/);
  const date = dateMatch ? dateMatch[0] : null;
  if (!date) return null;

  // Narrative context (finals, WC team context)
  const narratives = await env.ARCHIVE_DB.prepare(
    `SELECT brief_text, game_id FROM briefs
     WHERE brief_type = 'narrative_context' AND date <= ?
     ORDER BY date DESC LIMIT 10`
  ).bind(date).all();

  // Standings snapshot nearest to this date
  const standings = await env.ARCHIVE_DB.prepare(
    `SELECT brief_text, game_id FROM briefs
     WHERE brief_type = 'standings_snapshot' AND date <= ?
     ORDER BY date DESC LIMIT 12`
  ).bind(date).all();

  // WC matchup note if applicable
  const wcMatchup = await env.ARCHIVE_DB.prepare(
    `SELECT brief_text FROM briefs
     WHERE brief_type = 'wc_matchup' AND game_id = ?`
  ).bind(id).first();

  // History: prior games between same teams (from game tables)
  // Extract team names from id if possible
  const history = await env.ARCHIVE_DB.prepare(
    `SELECT id, date, home, away, home_score, away_score, note
     FROM postseason_games WHERE id != ? AND date < ?
     ORDER BY date DESC LIMIT 5`
  ).bind(id, date).all();

  return {
    narratives: (narratives.results || []).map(r => r.brief_text),
    standings: (standings.results || []).map(r => ({
      group: r.game_id, text: r.brief_text
    })),
    wcMatchup: wcMatchup?.brief_text || null,
    recentGames: history.results || []
  };
}
```

### COMMIT 6 — GET /context/date/{iso} batch endpoint

For the journalism prompt builder and card enrichment, a date-level
context is more useful than per-game context. Returns all games + all
context for a date in one call:

```javascript
if (pathname.startsWith('/context/date/')) {
  const date = pathname.slice('/context/date/'.length);

  const [regular, postseason, briefs, enrichment, standings] =
    await Promise.allSettled([
      env.ARCHIVE_DB.prepare(
        'SELECT * FROM regular_season_games WHERE date = ?'
      ).bind(date).all(),
      env.ARCHIVE_DB.prepare(
        'SELECT * FROM postseason_games WHERE date = ?'
      ).bind(date).all(),
      env.ARCHIVE_DB.prepare(
        `SELECT * FROM briefs WHERE date = ? OR
         (brief_type IN ('narrative_context','standings_snapshot')
          AND date <= ?) ORDER BY brief_type, date DESC`
      ).bind(date, date).all(),
      env.ARCHIVE_DB.prepare(
        `SELECT * FROM postseason_series WHERE series_key IN
         (SELECT DISTINCT series_key FROM postseason_games WHERE date = ?)`
      ).bind(date).all(),
      env.ARCHIVE_DB.prepare(
        `SELECT brief_text, game_id FROM briefs
         WHERE brief_type = 'standings_snapshot' AND date <= ?
         ORDER BY date DESC LIMIT 12`
      ).bind(date).all()
    ]);

  return Response.json({
    ok: true, date,
    games: {
      regular: regular.status === 'fulfilled' ? regular.value.results : [],
      postseason: postseason.status === 'fulfilled' ? postseason.value.results : []
    },
    briefs: briefs.status === 'fulfilled' ? briefs.value.results : [],
    series: enrichment.status === 'fulfilled' ? enrichment.value.results : [],
    standings: standings.status === 'fulfilled' ? standings.value.results : []
  }, { headers: corsHeaders });
}
```

### COMMIT 7 — Wire into handleJournalismCycle

Replace the current multi-query context assembly in handleJournalismCycle
with a single internal call to the Context Graph:

```javascript
// Instead of 4 separate D1 queries for temporal + enrichment + exemplars + odds:
const today = new Date().toISOString().slice(0, 10);
const ctxResp = await fetch(env.RELAY_BASE + '/context/date/' + today);
const ctx = await ctxResp.json();

// Inject into prompt from the unified context
const temporalBlock = ctx.briefs
  .filter(b => b.brief_type === 'slate' && b.date < today)
  .slice(0, 1)
  .map(b => b.brief_text).join('\n');

const enrichmentBlock = ctx.briefs
  .filter(b => b.brief_type === 'narrative_context')
  .map(b => b.brief_text).join('\n');

const exemplarBlock = ctx.briefs
  .filter(b => b.brief_type === 'slate' && b.quality_score > 200)
  .sort((a, b) => b.quality_score - a.quality_score)
  .slice(0, 3)
  .map(b => b.brief_text).join('\n\n');
```

This replaces the 4 separate D1 queries added in Relay Prompt 1 with
one self-fetch. Same data, one round-trip, cleaner code.

### COMMIT 8 — MCP probe allow-list

Add /context/game/ and /context/date/ to the probe allow-list.

## RULES

- RELAY-IS-DUMB: the Context Graph returns facts. It does not rank, score,
  or recommend. It's a fact aggregation layer.
- Promise.allSettled on all D1 queries — partial results are better than
  total failure. If one query fails, the others still return.
- try/catch around JSON.parse for odds columns.
- Single-concern commits.
- handleJournalismCycle self-fetch (commit 7) must be try/catch wrapped.
  If the Context Graph is down, fall back to the existing direct D1 queries.

## VERIFY

1. Game context:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/context/game/nba_finals_2026_g4'
Expected: full context with game, archive, series, enrichment

2. Date context:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/context/date/2026-06-08'
Expected: all games + briefs + series + standings for June 8

3. Journalism integration: wait for next cron cycle, verify the brief
still generates (self-fetch didn't break the cycle).

Write findings to commit messages.

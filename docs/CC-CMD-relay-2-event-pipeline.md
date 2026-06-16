# Claude Code Command — Self-Maintaining Archive: GameDO Event Pipeline

Read CLAUDE.md first — every rule applies.

## CONTEXT

The brief archive currently requires manual insertion (chat D1 queries) or
the backfill engine (cron dead hours) to populate game data. The brief archive
POST endpoint and cron write are live. But completed games don't automatically
flow into the archive — there's a gap between "game goes final" and "game
appears in D1."

This session makes the archive self-maintaining. When GameDO detects a game
has reached final state, it triggers an archive write. Every completed game
across all sports archives automatically, with zero manual intervention.

D1 field-archive: cc49101c-0569-4d41-8e7a-be139cde4f26 (binding: ARCHIVE_DB)
GameDO source: src/game-do.js

## PRE-WORK

Before writing any code:
1. Read src/game-do.js — understand the full GameDO lifecycle, especially
   how it detects final state, what data it holds, and what events it fires.
2. Read the existing /archive/* routes in src/index.js (~line 3835) — understand
   the current archive schema (regular_season_games, postseason_games, postseason_series).
3. Read the briefs table schema in docs/brief-archive-spec.md.
4. Map the data flow: what fields does GameDO have when a game goes final?
   Which fields map to the archive tables?

## TASKS

### COMMIT 1 — POST /archive/game endpoint

Add to the /archive/* section in src/index.js. Accepts game data from GameDO
and writes to the appropriate archive table.

```
POST /archive/game
{
  sport, league, date, home, away, home_score, away_score,
  venue, streams, note, crew, series_key, series_record,
  game_number, round, importance, source_id
}
```

Classification logic:
- If series_key is present → postseason_games table
- Otherwise → regular_season_games table

Use INSERT ON CONFLICT DO UPDATE SET for scores and notes (game may be
archived pre-final with partial data, then updated when final).

Generate id: `{sport}_{date}_{home_short}_{away_short}` (lowercase, spaces
removed). If a better id convention exists in the archive tables, use that.

Wrap in try/catch. Return 200 with {ok: true, id: inserted_id}.
Use existing CORS headers.

### COMMIT 2 — GameDO final-state hook

In src/game-do.js, when a game reaches final state (find the existing
final-state detection logic), add a fire-and-forget POST to the relay's
own /archive/game endpoint:

```javascript
// After detecting game is final:
try {
  const archivePayload = {
    sport: this.sport,
    league: this.league,
    date: this.date,
    home: this.home,
    away: this.away,
    home_score: this.homeScore,
    away_score: this.awayScore,
    venue: this.venue || null,
    streams: this.streams || null,
    note: this.note || null,
    crew: this.crew || null,
    series_key: this.seriesKey || null,
    series_record: this.seriesRecord || null,
    game_number: this.gameNumber || null,
    round: this.round || null,
    importance: this.importance || null,
    source_id: this.id
  };
  // Self-fetch to the relay's own endpoint
  fetch(env.RELAY_BASE + '/archive/game', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(archivePayload)
  }).catch(() => {});
} catch (_) {
  // Archive failure must NEVER affect the DO's primary function
}
```

CRITICAL: Adapt field names to what GameDO actually stores. DO NOT INVENT
field names — read the DO source and use what exists. If GameDO doesn't
have venue/crew/streams, don't include them. The archive captures what's
available; enrichment fills gaps later.

The self-fetch pattern (DO → relay endpoint) keeps the DO as a signal
forwarder per relay-is-dumb. Archive logic stays in the main worker.

### COMMIT 3 — KV brief capture on game final

After the archive game write in the /archive/game handler, check if a
generated brief exists for this game in KV:

```javascript
try {
  const kvKey = 'brief:game:' + (body.sport + ':' + body.source_id);
  const briefText = await env.FIELD_JOURNALISM.get(kvKey);
  if (briefText && briefText.length > 50) {
    await ensureBriefsTable(env);
    const date = body.date || new Date().toISOString().slice(0, 10);
    await env.ARCHIVE_DB.prepare(
      `INSERT INTO briefs (id, date, brief_type, sport, game_id, brief_text, source, word_count)
       VALUES (?, ?, 'game_recap', ?, ?, ?, 'kv_capture', ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(
      'game_recap_' + body.sport + '_' + body.source_id,
      date,
      body.sport || null,
      body.source_id || null,
      briefText,
      briefText.split(/\s+/).length
    ).run();
  }
} catch (_) {
  // Brief capture failure is never fatal
}
```

This captures the AI-generated game brief before KV TTL expires. The brief
is an ACTUAL Gemini output, not a reconstruction — higher value than backfill.

### COMMIT 4 — MCP probe allow-list

Add /archive/game to the probe allow-list if one exists.

## RULES

- RELAY-IS-DUMB: GameDO forwards facts to the relay endpoint. The relay
  classifies (postseason vs regular season) and writes to D1. No intelligence.
- Archive failure must NEVER affect GameDO's primary function (live score
  fan-out, CRUNCH TIME detection, WebSocket broadcast).
- Archive failure must NEVER affect the /archive/game handler's response
  to the brief capture step.
- Single-concern commits.
- DO NOT modify wrangler.toml or add new DO classes.

## VERIFY

1. Archive game endpoint:
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/archive/game \
  -H 'Content-Type: application/json' \
  -d '{"sport":"test","date":"2026-06-15","home":"Team A","away":"Team B","home_score":3,"away_score":1}'
Expected: 200 with {ok: true, id: "..."}

2. Verify D1:
SELECT * FROM regular_season_games WHERE sport='test' AND date='2026-06-15';
Then DELETE the test row.

3. GameDO integration: wait for a live game to go final (WC games today),
   then check if the archive row appeared automatically.

Write findings to commit messages.

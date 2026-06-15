# Brief Archive — Relay Implementation Spec

Source: jubilant-bassoon outbox/cc-brief-archive-2026-06-15.md sections 2b-2f
Copied to field-relay-nba so CC can read without cross-repo access.

CRITICAL: The binding name is ARCHIVE_DB (not FIELD_ARCHIVE). Replace all
env.FIELD_ARCHIVE references with env.ARCHIVE_DB.

## 2b — ensureBriefsTable helper

```javascript
let _briefsReady = false;
async function ensureBriefsTable(env) {
  if (_briefsReady) return;
  await env.ARCHIVE_DB.prepare(`
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      brief_type TEXT NOT NULL,
      sport TEXT,
      game_id TEXT,
      brief_text TEXT NOT NULL,
      model TEXT,
      quality_score REAL,
      context_hash TEXT,
      word_count INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'live'
    )`).run();
  _briefsReady = true;
}
```

## 2c — POST /archive/brief route

```javascript
if (pathname === '/archive/brief' && request.method === 'POST') {
  await ensureBriefsTable(env);
  const body = await request.json();
  const { id, brief_type, date, sport, game_id, brief_text,
          context_hash, word_count, source } = body;
  if (!id || !brief_type || !date || !brief_text) {
    return new Response('Missing required fields', { status: 400, headers: corsHeaders });
  }
  await env.ARCHIVE_DB.prepare(
    `INSERT INTO briefs
       (id, date, brief_type, sport, game_id, brief_text, model, context_hash, word_count, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       brief_text = excluded.brief_text,
       word_count = excluded.word_count,
       source = excluded.source`
  ).bind(
    id, date, brief_type,
    sport || null,
    game_id || null,
    brief_text,
    null,
    context_hash || null,
    word_count || null,
    source || 'client'
  ).run();
  return new Response('ok', { status: 200, headers: corsHeaders });
}
```

## 2d — Cron-side write in handleJournalismCycle

```javascript
// After: await env.FIELD_JOURNALISM.put('tonight', briefText, { expirationTtl: ... });
try {
  await ensureBriefsTable(env);
  const date = new Date().toISOString().slice(0, 10);
  await env.ARCHIVE_DB.prepare(
    `INSERT INTO briefs
       (id, date, brief_type, sport, brief_text, model, word_count, source)
     VALUES (?, ?, 'slate', null, ?, ?, ?, 'cron')
     ON CONFLICT(id) DO UPDATE SET
       brief_text = excluded.brief_text,
       word_count = excluded.word_count`
  ).bind(
    'slate_' + date + '_cron',
    date,
    briefText,
    'gemini-3.1-flash-lite',
    briefText.split(/\s+/).length
  ).run();
} catch (_) {
  // Archive failure must NEVER break journalism (CLAUDE.md Rule 5)
}
```

## 2e — CORS

Use existing relay CORS headers (Access-Control-Allow-Origin: * at ~line 560).

## 2f — Verification probe

```bash
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/archive/brief \
  -H 'Content-Type: application/json' \
  -d '{"id":"smoke_test_2026-06-15","brief_type":"slate","date":"2026-06-15","brief_text":"Smoke test brief — should appear in D1.","word_count":8,"source":"client"}'
# Expect: HTTP 200, body "ok"
```

Then via Cloudflare MCP D1:
```sql
SELECT id, brief_type, date, word_count, source, created_at
FROM briefs WHERE id = 'smoke_test_2026-06-15';
```

## D1 Schema Reference

The briefs table already exists in field-archive (cc49101c) with these columns:
id TEXT PRIMARY KEY, date TEXT, brief_type TEXT, sport TEXT, game_id TEXT,
brief_text TEXT, model TEXT, quality_score REAL, context_hash TEXT,
word_count INTEGER, created_at TEXT, source TEXT DEFAULT 'live'.

Indexes: idx_briefs_date, idx_briefs_type, idx_briefs_source.

## Archive Game Tables (for backfill queries)

regular_season_games: id, sport, league, date, home, away, home_score, away_score, venue, streams, note, crew
postseason_games: id, sport, series_key, round, game_number, date, home, away, home_score, away_score, venue, streams, note, series_record, importance, league, crew
postseason_series: series_key, sport, round, season, higher_seed, lower_seed, winner, result, narrative

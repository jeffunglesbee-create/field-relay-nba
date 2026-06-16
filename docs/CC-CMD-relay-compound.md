# Claude Code Command — Relay Compound: 7 Remaining Features

Read CLAUDE.md first.

## CONTEXT

The archive loop is closed. Temporal context, voice exemplars, odds snapshot,
event pipeline, query API — all live. This session compounds the 7 remaining
relay features into one build because they all touch handleJournalismCycle or
the backfill engine and CC can wire them without conflicts by seeing the full
interaction surface.

D1 field-archive: cc49101c (binding: ARCHIVE_DB)

Read src/index.js fully before starting. Map every point where these features
touch handleJournalismCycle, buildBackfillPrompt, and the /archive/* routes.
Write a brief dependency map, then implement in order.

## TASKS

### 1. Venue Intelligence endpoint (~10 min)

GET /archive/venues — parse all venue strings from game tables into structured data.

```sql
SELECT DISTINCT venue FROM regular_season_games WHERE venue IS NOT NULL
UNION
SELECT DISTINCT venue FROM postseason_games WHERE venue IS NOT NULL;
```

Parse "Frost Bank Center, San Antonio TX" → {name: "Frost Bank Center", city: "San Antonio", state: "TX"}.
Parse "T-Mobile Arena, Las Vegas NV" → {name: "T-Mobile Arena", city: "Las Vegas", state: "NV"}.

Simple comma split: name = before comma, city+state = after comma, last 2 chars = state.

Return JSON: [{venue, name, city, state, game_count}] sorted by game_count DESC.

Also: GET /archive/venue/{name} — all games at a specific venue.

### 2. Line Movement: closing odds capture (~15 min)

In the odds snapshot logic (already in handleJournalismCycle), add closing
odds capture:

For games where start_time is within 30 min AND opening_odds exists AND
closing_odds is NULL:
- Fetch current odds from Odds API
- Write closing_odds to the game row

The opening snapshot already runs. This adds the closing snapshot at a
different lifecycle point (near game start, not first discovery).

### 3. Odds-Enriched re-backfill (~15 min)

After the dead-hour odds backfill step, check: did we just populate odds
for a date that also has a brief? If so, the brief was generated WITHOUT
odds context. Re-run the brief backfill for that date with force=true.

Implementation: after runOddsBackfillForDate completes, check:
```sql
SELECT id FROM briefs WHERE date = ? AND source = 'backfill' LIMIT 1
```
If exists AND odds were just populated (return value from odds backfill
indicates new odds written), call the backfill engine for that date with
a 'rebackfill' source tag. Use ON CONFLICT DO UPDATE SET (not DO NOTHING)
for rebackfill — the new brief with odds context replaces the old one.

### 4. Brief Quality × Competitive Balance (~15 min)

GET /archive/quality-correlation

Query briefs with quality_score joined against game odds:
```sql
SELECT b.quality_score, b.date, b.sport,
       g.opening_odds, g.home_score, g.away_score
FROM briefs b
JOIN regular_season_games g ON b.date = g.date
WHERE b.quality_score IS NOT NULL AND g.opening_odds IS NOT NULL
UNION ALL
SELECT b.quality_score, b.date, b.sport,
       g.opening_odds, g.home_score, g.away_score
FROM briefs b
JOIN postseason_games g ON b.date = g.date
WHERE b.quality_score IS NOT NULL AND g.opening_odds IS NOT NULL
```

Compute server-side:
- Average quality by spread bucket (tight: <3, medium: 3-7, wide: >7)
- Average quality by sport
- Return as JSON for client rendering

### 5. Per-sport prompt calibration (~15 min)

Query actual quality distributions:
```sql
SELECT sport, quality_score FROM briefs
WHERE quality_score IS NOT NULL AND sport IS NOT NULL
ORDER BY sport, quality_score
```

Compute p25 per sport. Update getQualityTarget(sport) to use these
data-driven thresholds instead of hardcoded values.

Implementation: at relay startup (or first cron tick), query D1 for
calibration data. Cache in a module-level variable. Refresh daily.
If no data exists for a sport, fall back to the existing hardcoded target.

### 6. Factual consistency checking (~15 min)

After generating a brief in handleJournalismCycle, before writing to D1:

Query yesterday's brief:
```sql
SELECT brief_text FROM briefs
WHERE brief_type = 'slate' AND source IN ('cron', 'backfill')
  AND date = date(?, '-1 day') LIMIT 1
```

Compare: extract series records mentioned in both briefs (regex for
"leads X-Y" or "tied X-X" patterns). If today's brief regresses a
series record (e.g., yesterday said "leads 3-2" and today says "leads 2-1"),
log a warning to console. Do NOT block the brief — just flag it.

This is a lightweight signal, not a hard gate. Log format:
`[FIELD:consistency] Possible regression: yesterday "leads 3-2" → today "leads 2-1"`

### 7. Replay Engine force parameter (~5 min)

Add `force=true` query parameter to /archive/backfill:
```
GET /archive/backfill?date=2026-06-08&force=true
```

When force=true:
- Skip the skip-existing check
- Use ON CONFLICT DO UPDATE SET (overwrite previous backfill)
- Set source='replay' instead of 'backfill'
- Return both old and new quality_score for comparison

## RULES

- All 7 features touch handleJournalismCycle or the backfill engine.
  Wire them carefully — each try/catch independently.
- handleJournalismCycle additions MUST NOT increase cron latency by
  more than 1-2 seconds total. D1 queries are fast (edge); Odds API
  calls are already batched.
- Single-concern commits — 7 commits, one per feature.
- Push to main when complete.

## VERIFY

1. /archive/venues:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/venues'

2. /archive/quality-correlation:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/quality-correlation'

3. Replay engine:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/backfill?date=2026-06-08&force=true'
Expected: JSON with old_score + new_score comparison

Write findings to commit messages.

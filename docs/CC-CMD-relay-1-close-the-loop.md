# Claude Code Command — Close the Loop: Temporal Context + Query API + Voice Exemplars

Read CLAUDE.md first — every rule applies.

## CONTEXT

The brief archive system is live. The backfill engine runs during dead hours.
130 enrichment rows + 255 game records + 7 series records are in D1. Every
15-minute cron cycle, handleJournalismCycle generates a slate brief, stores
it in KV, and writes a copy to D1 (source='cron').

The problem: each brief is generated in isolation. The prompt has tonight's
game data but no memory of what FIELD said yesterday. This session closes
the loop — the prompt reads from the archive it writes to.

D1 field-archive: cc49101c-0569-4d41-8e7a-be139cde4f26 (binding: ARCHIVE_DB)

## TASKS

### COMMIT 1 — /archive/query endpoint

Add to the /archive/* section in src/index.js. Parameterized D1 read:

GET /archive/query?date=2026-06-15&sport=NBA&team=Knicks&brief_type=slate&source=cron&limit=10

All parameters optional. Build SQL dynamically:
```sql
SELECT id, date, brief_type, sport, game_id, brief_text, model,
       quality_score, word_count, source, created_at
FROM briefs
WHERE 1=1
  AND (date = ? OR ? IS NULL)
  AND (sport = ? OR ? IS NULL)
  AND (brief_type = ? OR ? IS NULL)
  AND (source = ? OR ? IS NULL)
  AND (brief_text LIKE '%' || ? || '%' OR ? IS NULL)  -- team search
ORDER BY date DESC, created_at DESC
LIMIT ?
```

Default limit: 10. Max limit: 50. Use existing CORS headers. Return JSON array.

If this parameterized approach hits D1 variable limits, simplify: build the
WHERE clause string conditionally (only include clauses for provided params).
Use string interpolation for column names only, bind values for data.

### COMMIT 2 — Temporal context injection in handleJournalismCycle

In the prompt-building section of handleJournalismCycle (before the RULES
block), add a D1 query for recent editorial context:

```sql
SELECT brief_text, date, quality_score FROM briefs
WHERE brief_type = 'slate' AND source IN ('cron', 'backfill')
  AND date < ?
ORDER BY date DESC LIMIT 1
```

Where ? is today's date. This returns yesterday's slate brief.

Inject into the prompt as:
```
FIELD'S RECENT COVERAGE (for narrative continuity — build on this, don't repeat it):
[yesterday's brief text]
```

Place AFTER the game lines and enrichment context, BEFORE the voice rules.

Wrap in try/catch — temporal context is an enhancement, not a requirement.
If the query fails or returns no rows, skip the injection silently.

Also query enrichment context (same pattern as buildBackfillPrompt):
```sql
SELECT brief_text FROM briefs
WHERE date <= ? AND source = 'enrichment'
  AND brief_type IN ('narrative_context', 'standings_snapshot')
  AND (sport = ? OR sport IS NULL)
ORDER BY brief_type, date DESC LIMIT 10
```

Inject as:
```
EDITORIAL CONTEXT (verified facts for depth — use naturally, don't list):
[enrichment texts joined by newlines]
```

### COMMIT 3 — Voice exemplar injection

Query the 3 highest quality_score briefs from the last 7 days:

```sql
SELECT brief_text, quality_score FROM briefs
WHERE brief_type = 'slate' AND source IN ('cron', 'backfill')
  AND quality_score IS NOT NULL
  AND date >= date(?, '-7 days')
ORDER BY quality_score DESC LIMIT 3
```

Inject into the prompt as:
```
FIELD VOICE EXAMPLES (match this tone and style):
Example 1 (score: {score}):
{brief_text}

Example 2 (score: {score}):
{brief_text}

Example 3 (score: {score}):
{brief_text}
```

Place AFTER the temporal context, BEFORE the voice rules.

If fewer than 3 briefs exist, use what's available. If none, skip entirely.
Wrap in try/catch — voice exemplars are an enhancement.

### COMMIT 4 — MCP probe allow-list

Add /archive/query to the probe allow-list if one exists.

## RULES

- Read CLAUDE.md before every commit.
- RELAY-IS-DUMB: the archive query returns facts. Temporal context is
  editorial prose already generated. Voice exemplars are quality-scored
  prose. No interest scoring, no drama computation.
- handleJournalismCycle is the most sensitive function in the relay.
  Every addition MUST be wrapped in try/catch. Archive/exemplar failures
  must NEVER break the live journalism cycle.
- Single-concern commits.
- git config user.email "claude@field.dev" / user.name "FIELD CI"
- Push to main when complete — deploy.yml auto-deploys.

## VERIFY

1. /archive/query endpoint:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/query?brief_type=slate&limit=3'
Expected: JSON array with recent slate briefs

2. Wait for next cron cycle (max 15 min). Check the new brief in D1:
SELECT id, word_count, quality_score, substr(brief_text,1,200) FROM briefs
WHERE source='cron' ORDER BY created_at DESC LIMIT 1;

Look for signs of temporal continuity — the brief should reference or build
on yesterday's coverage rather than introducing context as if new.

3. Check relay logs for any errors in the temporal/exemplar injection path.

Write findings to commit messages.

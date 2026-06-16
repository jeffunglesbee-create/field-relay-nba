# Claude Code Command — Odds Layer: Schema + Snapshot + Historical Backfill

Read CLAUDE.md first — every rule applies.

## CONTEXT

The brief archive has game data but no odds context. Odds data enables
journalistic features: "Cape Verde were +1200 underdogs and won 1-0",
"the line moved from SAS -4 to SAS -1.5 after the injury report."

The Odds API (api.the-odds-api.com) is accessible from this relay and
retains ~6 months of historical data. This session adds odds columns to
the game archive, a snapshot job to capture odds for new games, and a
historical backfill for existing archived games.

All odds are used JOURNALISTICALLY — as editorial facts in prose, not as
input to interest scoring or viewing recommendations. This is CLEAN per
ADR-002 and RUWT.

D1 field-archive: cc49101c-0569-4d41-8e7a-be139cde4f26 (binding: ARCHIVE_DB)
Odds API key: check env vars or wrangler.toml for THE_ODDS_API_KEY or similar.
If no key is bound, check the relay source for how live odds are currently
fetched (AmbientDO has _fetchLiveOdds — trace that code path to find the key).

## PRE-WORK

Before writing any code:
1. Read how the relay currently fetches odds — search for _fetchLiveOdds,
   odds-api, the-odds-api in src/index.js and src/ambient-do.js.
2. Identify the API key binding name and how it's used.
3. Read the Odds API docs pattern: what endpoint returns historical odds?
   What format does h2h/spreads/totals come in?
4. Read the archive table schemas (regular_season_games, postseason_games)
   to understand existing columns.

## TASKS

### COMMIT 1 — Schema: odds columns on game tables

Via Cloudflare MCP D1 query (NOT in relay code — schema changes are one-time):

```sql
ALTER TABLE regular_season_games ADD COLUMN opening_odds TEXT;
ALTER TABLE regular_season_games ADD COLUMN closing_odds TEXT;
ALTER TABLE postseason_games ADD COLUMN opening_odds TEXT;
ALTER TABLE postseason_games ADD COLUMN closing_odds TEXT;
```

JSON format for odds values:
```json
{
  "spread": {"home": -3.5, "away": 3.5},
  "total": {"over": 211.5, "under": 211.5},
  "moneyline": {"home": -180, "away": 155},
  "source": "draftkings",
  "captured_at": "2026-06-15T20:00:00Z"
}
```

No index needed — odds columns are read alongside game rows, not queried independently.

### COMMIT 2 — Odds snapshot in handleJournalismCycle

In the handleJournalismCycle cron path, after fetching tonight's games but
before building the prompt:

For each game that has NO opening_odds in the archive:
1. Fetch odds from the Odds API (same pattern as _fetchLiveOdds)
2. Write opening_odds to the archive game row via D1 UPDATE

For each game that is about to start (within 30 min of start_time) and
has opening_odds but NO closing_odds:
1. Fetch current odds
2. Write closing_odds to the archive game row

Rate limiting: batch all games into one Odds API call if the API supports it
(it does — the /v4/sports/{sport}/odds endpoint returns all games).
One API call per cron cycle, not one per game.

Wrap in try/catch — odds capture failure must never break journalism.

### COMMIT 3 — Odds injection in prompt builders

In handleJournalismCycle's prompt builder, for each game line that has
odds in the archive, append:

```
[ODDS: opened {spread}, ML {moneyline_home}/{moneyline_away}, O/U {total}]
```

In buildBackfillPrompt, same pattern for games with odds columns populated.

This gives Gemini factual odds context to work with: "the Knicks opened as
3.5-point favorites" comes from data, not invention.

### COMMIT 4 — Historical odds backfill endpoint

GET /archive/odds-backfill?date=2026-06-08

For a given date:
1. Query archive for all games on that date (both tables)
2. For each game without opening_odds, fetch historical odds from the API
3. Write opening_odds to the game row
4. Return summary: {date, games_found, odds_populated, odds_skipped}

Rate limiting: the Odds API free tier allows 500 requests/month. Historical
lookups may consume quota. Check remaining quota via the API's
X-Requests-Remaining header. If below 50, stop and return {stopped: true,
reason: 'quota_low'}.

### COMMIT 5 — Dead-hour odds backfill cron

In handleJournalismCycle's dead-hour block (UTC 2:00-10:00), after the
brief backfill runs, add an odds backfill step:

1. Find the next date in the archive that has games WITHOUT opening_odds
2. Call the odds backfill logic for that date
3. Track progress via KV key 'odds_backfill_cursor' (same pattern as
   brief backfill cursor)

One date per cron tick. Lower priority than brief backfill — run odds
backfill only AFTER brief backfill completes for that tick (or is skipped).

## RULES

- RELAY-IS-DUMB: odds are stored as facts. No recommendations, no interest
  scoring based on odds. The journalism prompt uses odds as editorial context.
- Odds API quota awareness: check X-Requests-Remaining. Never exhaust the
  monthly quota on backfill.
- try/catch on every odds fetch and write — odds are enhancement, not critical path.
- Single-concern commits.

## VERIFY

1. Schema:
Via Cloudflare MCP: SELECT opening_odds, closing_odds FROM regular_season_games LIMIT 1;
Expected: null/null (columns exist but unpopulated)

2. Wait for next cron cycle. Check if any game got odds populated:
SELECT id, date, home, away, opening_odds FROM regular_season_games
WHERE opening_odds IS NOT NULL LIMIT 5;
OR
SELECT id, date, home, away, opening_odds FROM postseason_games
WHERE opening_odds IS NOT NULL LIMIT 5;

3. Manual historical backfill:
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/archive/odds-backfill?date=2026-06-08'
Expected: JSON with games_found + odds_populated count

Write findings to commit messages.

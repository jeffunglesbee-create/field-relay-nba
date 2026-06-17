# Brief Archive — Night Owl D1 Writes + KV Sweep + Backfill Extension — 2026-06-17

## ARCHIVE_DB binding

`wrangler.toml` binding: `ARCHIVE_DB`, database `field-archive` (`cc49101c-0569-4d41-8e7a-be139cde4f26`).

---

## Commit A — Night Owl D1 write in queue consumer (commit `8e3745a`, prior session)

**Location**: `src/index.js` queue consumer, `job.type === 'game-brief'` branch.

**KV put mapped**: `FIELD_JOURNALISM.put('brief:game:{job.eventId}', ...)` with `{expirationTtl: 3600}`. D1 write follows immediately, before `msg.ack()`.

**Variables in scope**:
| D1 column | Value |
|-----------|-------|
| `id` | `game_recap_${job.sport}_${job.eventId}` |
| `date` | `new Date(job.enqueuedAt \|\| Date.now()).toISOString().slice(0,10)` |
| `brief_type` | `'game_recap'` (hardcoded) |
| `sport` | `job.sport` |
| `game_id` | `String(job.eventId)` |
| `brief_text` | `finalText` (post-stripMarkdown) |
| `model` | `'claude-haiku-4-5-20251001'` (hardcoded in callProxy) |
| `quality_score` | `NULL` — game-brief path runs cliché check only, not full runQualityChain |
| `context_hash` | `job.gameHash \|\| null` |
| `word_count` | `finalText.split(/\s+/).length` |
| `source` | `'cron'` |

ON CONFLICT DO UPDATE (brief_text, word_count, source). Try/catch per Rule 5.

Covers all sports enqueuing `type: 'game-brief'`: NBA, NHL, MLB, WNBA, WC26.

---

## Commit B — No direct relay path (no code change)

**Verdict**: No synchronous / direct relay path for Night Owl game-recap brief generation.

Game-brief generation is exclusively async via `JOURNALISM_QUEUE`. The four enqueuers:
- `src/index.js` ~L1472 — WC26, enqueued from `handleWCResults` on state='final'
- ~L2210 — NBA, enqueued from `handleJournalismCycle` NBA finals block
- ~L2299 — NHL, same pattern
- ~L4197 — MLB/WNBA/others, enqueued per-game in `handleJournalismCycle` game-briefs block

`/journalism/generate` (sync path at ~L5428) handles general prompts from the browser; it has no `game_id` concept and does not produce `game_recap` type content.

**Action**: skipped. No Commit B.

---

## Commit C — POST /archive/brief brief_type whitelist (no code change)

**Verdict**: No `brief_type` whitelist exists.

Handler at `src/index.js:5125` validates presence only:
```javascript
if (!id || !brief_type || !date || !brief_text) { ... 400 ... }
```
Any non-empty string is accepted.

**Types currently written to D1 by relay-side code**:
| brief_type | Source |
|------------|--------|
| `slate` | `handleJournalismCycle` cron D1 write |
| `game_recap` | Queue consumer game-brief path (Commit A) + KV sweep (Commit D) |
| `backfill` | `executeBackfill` → `/archive/backfill` route |
| `game_brief` | `executeGameBriefBackfill` (Commit E) |
| `series_preview` | `executeSeriesPreviewBackfill` (Commit F) |

Browser client (jubilant-bassoon) may additionally POST: `game_recap`, `series_preview`, `game_brief`, `stakes_brief`. No whitelist to add them to — they are already accepted.

---

## Commit D — KV sweep in dead-hour cron (commit `ef1fda7`)

**Location**: Dead-hour cron block in `handleJournalismCycle`, after the odds backfill try/catch, before the early-return check.

**Structure**:
- `FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 50 })` — one list call per cron tick during UTC 2:00–10:00
- For each key: GET the value, parse JSON if `{...}`, extract `brief`, `brief_text`, or `text` field
- Skip if `briefText.length < 50`
- Parse sport + game_id from key: `brief:game:{sport}:{id}` → sport=parts[0], id=parts[last]; `brief:game:{id}` → sport=null, id=parts[0]
- `INSERT INTO briefs (...) ON CONFLICT(id) DO NOTHING` — never overwrites
- `source='kv_sweep'`, `brief_type='game_recap'`

**Why complementary to /archive/game KV capture (~L5020)**: The /archive/game capture fires when a game is explicitly POSTed to /archive/game. The KV sweep captures any brief that was written by the queue consumer but whose game was NOT yet archived (e.g., games from in-flight seasons not yet flowing through /archive/game).

**Early-return check updated**: `if (!nextDate && !oddsResult && !sweepResult)`

---

## Commit E — executeGameBriefBackfill (commit `3bb3f45`)

**Function**: `executeGameBriefBackfill(env, date)` — above `executeBackfill` in `src/index.js`.

**Trigger condition**: `nextDate && briefResult && briefResult.skipped` — fires when `executeBackfill` returned `{ok:true, skipped:true}` (slate brief pre-existed for the date picked by `pickNextBackfillDate`). Uses `nextDate` directly as the game brief date.

**Per-game logic**:
1. Queries `regular_season_games` + `postseason_games` WHERE `date = ? AND home_score IS NOT NULL`
2. For each of up to 3 games: checks `SELECT id FROM briefs WHERE game_id = ? AND brief_type = 'game_brief'`
3. If no existing brief: builds prompt with teams, scores, sport, postseason context (round, series record computed from game results, narrative from `postseason_series`)
4. Calls Gemini via callProxy + `runQualityChain` (scoreThreshold=90, maxRetries=3)
5. Stores `brief_type='game_brief'`, `source='backfill'`, `model='gemini-3.1-flash-lite'`

**Return shape**: `{ok, date, games_processed, games_skipped, total}`

**Schema note**: `postseason_series` has `series_key, sport, round, season, higher_seed, lower_seed, winner, result, narrative` — no `home_wins`/`away_wins` columns. Series wins are computed from `postseason_games` WHERE `home_score > away_score` / `away_score > home_score`.

---

## Commit F — executeSeriesPreviewBackfill (commit `70b2f8c`)

**Function**: `executeSeriesPreviewBackfill(env)` — above `executeGameBriefBackfill` in `src/index.js`.

**Trigger condition**: Unconditional — runs every dead-hour cron tick after game brief backfill. `env.ARCHIVE_DB` guard only.

**Per-series logic**:
1. JOIN `postseason_series` × `postseason_games` (home_score IS NOT NULL), GROUP BY series_key — finds active series with ≥ 1 completed game
2. For each of up to 2 series: checks `SELECT id FROM briefs WHERE game_id = ? AND brief_type = 'series_preview'`
3. Computes wins from game results (home_score > away_score = home team win, per higher_seed/lower_seed alignment)
4. Builds series preview prompt with teams, wins record, round, narrative, result
5. Calls Gemini + quality chain (scoreThreshold=90, maxRetries=3)
6. Stores `brief_type='series_preview'`, `source='backfill'`, `game_id=series_key`

**Return shape**: `{ok, series_processed, series_skipped, total}`

---

## Dead-hour cron block — final structure

```
UTC 2:00–10:00 (isLiveHours=false):
  try {
    1. pickNextBackfillDate → executeBackfill     [slate brief, 1 date/tick]
    2. pickNextOddsBackfillDate → runOddsBackfill [odds, 1 date/tick, skip-on-tried]
    3. KV sweep (brief:game:* → D1)               [up to 50 keys/tick]
    4. executeGameBriefBackfill                   [up to 3 games, only if briefResult.skipped]
    5. executeSeriesPreviewBackfill               [up to 2 series/tick]
    early-return if ALL five are null/no-op
  } catch { ... }
```

---

## Verification query (run after first dead-hour cron post-deploy)

```sql
SELECT brief_type, source, COUNT(*), AVG(quality_score)
FROM briefs GROUP BY brief_type, source ORDER BY brief_type, source;
```

Expected rows after a night of dead-hour processing:
| brief_type | source | count | avg_quality |
|------------|--------|-------|-------------|
| game_brief | backfill | ≥1 | ~90-130 |
| game_recap | cron | ≥1 | NULL |
| game_recap | kv_sweep | ≥1 | NULL or numeric |
| game_recap | kv_capture | ≥1 | NULL |
| series_preview | backfill | ≥1 | ~90-130 |
| slate | backfill | ≥1 | ~90-170 |
| slate | cron | ≥1 | ~90-170 |

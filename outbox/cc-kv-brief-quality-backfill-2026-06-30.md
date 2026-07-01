# Outbox — Backfill Quality Scores for KV-Captured Briefs

**Date:** 2026-07-01
**Relay HEAD:** b70a64e
**CC-CMD:** docs/CC-CMD-2026-06-30-kv-brief-quality-backfill.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `scoreProse` export | `export async function scoreProse(text, opts = {})` at `src/journalism-quality.js:351`. Async (calls `_datamuseFreshness` for Dim 5). Imported in `index.js` as `jqScoreProse` (alias at L53). |
| `opts.game` shape | `{ home, away, homeScore, awayScore }` — read at `journalism-quality.js:419`. D1 column names `home_score`/`away_score` map to `homeScore`/`awayScore`. |
| `opts.sport` | Plain string, used for Dim 9 (voice consistency). Can be null — scorer degrades gracefully. |
| `sweepKVBriefs()` location | `src/index.js:4220`. Resolves `briefText` and `qualityScore = p.quality_score || p.score || null` from KV JSON, then inserts with no scoring call. |
| `kv_capture` block location | `src/index.js:7907`. INSERT at L7945 had columns `(id, date, brief_type, sport, game_id, brief_text, source, word_count)` — no `quality_score` column at all. |
| `/quality/report` location | `src/index.js:8942`. Insertion point for new endpoint confirmed above it. |
| game table's ESPN event ID column | `espn_event_id` — confirmed from SELECT at L8668 (`g.espn_event_id`) and INSERT at L7857/7883 (last bind param). The `source_id` from POST body becomes `espn_event_id` in D1. Used as lookup key in backfill. |

---

## What Was Built

Three edits to `src/index.js`. No other files touched.

### Task 1a — `sweepKVBriefs()`: score at write time (L4220+)

After the null-sport dedup check and before the INSERT, added a try/catch block that:
1. Queries `regular_season_games` then `postseason_games` by `espn_event_id = gameId` for game context
2. Calls `jqScoreProse(briefText, { sport, game: gameCtx })` — `gameCtx` is null if lookup misses (scorer still runs all other dimensions)
3. Assigns result to `qualityScore`, which the existing INSERT already binds

Outer try/catch guarantees a lookup miss or score error never blocks the sweep (Rule 5).

### Task 1b — `kv_capture` block in `/archive/game`: score at write time (L7937+)

After `briefId` is determined and before the INSERT:
1. Added `let kvCaptureScore = null` + try/catch calling `jqScoreProse(briefText, { sport: sportKey, game: { home, away, homeScore: home_score, awayScore: away_score } })` — `home`/`away`/`home_score`/`away_score` are all already destructured from the POST body at this point, no extra D1 lookup needed
2. Changed INSERT column list from `(id, date, brief_type, sport, game_id, brief_text, source, word_count)` to include `quality_score` between `brief_text` and `source`
3. Added `kvCaptureScore` to the bind params

`ON CONFLICT DO NOTHING` still applies — existing rows are untouched.

### Task 2 — `GET /quality/backfill-scores` endpoint (inserted before `/quality/report`)

```
GET /quality/backfill-scores?dry=true&limit=10&date=YYYY-MM-DD
```

- Selects `id, sport, game_id, brief_text FROM briefs WHERE quality_score IS NULL AND source IN ('kv_sweep','kv_capture') ORDER BY created_at DESC LIMIT ?`
- Dry run: returns `{ ok, dry_run:true, unscored, results:[{id, sport, game_id, old:null, new:null}] }` without writing
- Live run: for each row, best-effort join game context via `espn_event_id`, call `jqScoreProse`, `UPDATE briefs SET quality_score = ? WHERE id = ?`; returns `{ ok, scored, skipped, results:[{id, old:null, new:score}] }`
- Per-row try/catch — a single score failure records `error:'score_failed'` in results and increments `skipped`, never aborts the loop
- Guard: `ARCHIVE_DB` not bound → 503

Default: `limit=10`, cap at 50. `?date=` is optional.

---

## Deviations from Spec

None. The spec said "best-effort join game context via game_id" — probing confirmed the correct column is `espn_event_id`, which the sweep's `gameId` (last KV key segment = ESPN event ID) matches directly.

---

## Deploy

- Commit: `b70a64e`
- Workflow run: `28488910041`
- CI conclusion: `success`

---

## Live Verification (chat-side follow-up — NOT part of CC-CMD done condition)

Per CC-CMD Task 3: CC's egress blocks `*.workers.dev`. Live verification is a chat-side follow-up:

1. **Dry preview of unscored backlog:**
   ```
   GET /quality/backfill-scores?dry=true&limit=50
   ```
   Expected: `unscored` count showing the ~89 null rows from the pre-deploy backlog.

2. **Real backfill run (repeat until unscored → 0):**
   ```
   GET /quality/backfill-scores?limit=50
   ```
   Expected: `scored` > 0, `skipped` near 0, `results` with non-null `new` scores.

3. **Confirm `/quality/report` unscored_types cleared:**
   After backfill run(s), `/quality/report` should show the `espn`/`mlb`/`wnba`/`football`/`fifa world cup 2026` lowercase sport variants no longer appearing in `unscored_types`.

4. **Forward confirmation (new briefs scored):** Any new `kv_sweep` or `kv_capture` brief written after this deploy should have a non-null `quality_score` immediately — check `SELECT quality_score FROM briefs WHERE source IN ('kv_sweep','kv_capture') ORDER BY rowid DESC LIMIT 5` via `/d1/execute`.

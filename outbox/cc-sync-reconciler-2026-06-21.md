# Sync Reconciler + Change Log (Phase 1) — 2026-06-21

## Pre-build probes — code-derived

WebFetch / probe_relay_route can't reach `/d1/execute` (POST-only,
admin-gated, sandbox blocks external HTTP to the worker). All shapes
are read from the writer code in this repo — same contract as a
live probe, no deploy round-trip needed.

### Existing tables (CREATE statements / PRAGMA introspection)

- **regular_season_games**: id PK, sport, league, date, home, away,
  home_score, away_score, venue, streams, note, tags, crew,
  local_note, created_at, **opening_odds**, **closing_odds**,
  drama_peak, drama_arc.
- **postseason_games**: id PK, sport, series_key, round, game_number,
  date, home, away, home_score, away_score, venue, streams, note,
  series_record, series_margins, importance, league, crew,
  created_at, **opening_odds**, **closing_odds**, drama_peak,
  drama_arc.
- **odds_history**: id PK, game_id, sport, date, home_team, away_team,
  commence_time, home_ml, away_ml, draw_ml, over_under, over_price,
  under_price, bookmaker, snapshot_time, snapshot_type, created_at.
- **briefs**: id PK, date, brief_type, sport, game_id, brief_text,
  model, quality_score, context_hash, word_count, created_at, source.
- **change_log**: does **not** exist yet — created by this commit.

### Existing odds sync sites (code reading)

- `snapshotCronOdds(env, dateKey)` at `src/index.js:3906` — per-cron
  live snapshot: SELECT distinct sports → fetch Odds API per sport →
  match-by-team-pair → `UPDATE … SET opening_odds = ? WHERE id = ?
  AND opening_odds IS NULL`. Iterates both `regular_season_games`
  and `postseason_games`.
- `runOddsBackfillForDate(env, isoDate)` at `src/index.js:3988` —
  one-shot historical backfill for a date: same shape as above but
  uses the historical Odds API endpoint and runs across all sports
  with `opening_odds IS NULL` on that date.
- `closing_odds` is **fetched and written by an external CI job**
  (`.github/scripts/odds-backfill.js`), not by code in this repo.
  Today there is no opening↔closing sync function in `src/index.js`.

### Spec premise vs. reality

The spec's `ODDS_RECONCILER_SPEC` assumes an `odds_history` table
with `opening_line` / `closing_line` columns that the games tables
sync FROM. Reality:

- `odds_history` columns are `home_ml`, `away_ml`, `over_under`,
  `over_price`, `under_price`, etc. — not `opening_line` /
  `closing_line`.
- The existing UPDATEs don't read from `odds_history` at all —
  they read from live Odds-API JSON and write to games tables
  directly.

**Interpretation**: the spec's intent is the GENERIC reconciler
pattern (UPDATE-with-changelog), not a literal `odds_history →
games` sync. The reconciler accepts pre-computed `{ id, fields }`
updates so callers can compute new values however they want (API
response, R2, calculation) and dispatch the UPDATE+log pattern
uniformly. The odds refactor threads the existing API-fetched
values through `reconcile()` instead of inline UPDATEs.

### `/d1/execute` auth + allowlist

- Auth header: `X-FIELD-Relay: field-relay-cron-2026` (the spec's
  `X-FIELD-Admin: 1` is wrong).
- Current `ALLOWED_TABLES` (src/index.js:7132): `['odds_history',
  'odds_backfill_progress', 'regular_season_games',
  'postseason_games']`. Adding `change_log` this commit.

### ARCHIVE_DB binding

```toml
[[d1_databases]]
binding       = "ARCHIVE_DB"
database_name = "field-archive"
database_id   = "cc49101c-0569-4d41-8e7a-be139cde4f26"
```

Already bound. Same DB that holds `briefs`, `analytics_runs`,
`analytics_output`, `codex`, `odds_history`, the two game tables,
and now `change_log`.

## What ships

1. `src/sync-reconciler.js` (new): `ensureChangeLogTable`,
   `reconcile`, `getRecentChanges`, `markConsumed`,
   `cleanupChangelog`.
2. `src/index.js` edits:
   - Import the reconciler module.
   - Refactor `snapshotCronOdds` + `runOddsBackfillForDate` inner
     UPDATE loops to use `reconcile()` with `source='odds_api'`.
   - Wire `ensureChangeLogTable(env)` into `handleJournalismCycle`'s
     pre-cron table-bootstrap block (next to `ensureBriefsTable`).
   - Add `'change_log'` to `/d1/execute` `ALLOWED_TABLES`.
   - Add `GET /changelog/{date}` endpoint (Task 5 optional — shipping).

## Behavioral contract preserved

- Both sync functions still only target rows where the destination
  field is currently NULL (the SELECT-side filter is unchanged).
- Both still skip rows where the Odds API didn't return a match
  (the team-pair lookup is unchanged).
- Both still iterate `regular_season_games` and `postseason_games`.
- Quota tracking + cooldown logic is untouched.
- The Odds API FETCH path is untouched (per spec scope boundary).

The reconciler adds:
- Row-level diff check (skip UPDATE when newVal === oldVal — should
  never trigger on a NULL→value transition, but defends against any
  stale-cache scenario).
- One `change_log` INSERT per actual field change (so 130 sync rows
  produce ~130 changelog entries with `source='odds_api'`,
  `field='opening_odds'`).
- All writes batched per sport via D1 `batch()` (one round-trip per
  sport instead of one per row).

## Carry-forwards

1. `closing_odds` sync (Phase 2): when the CI job `odds-backfill.js`
   moves into the relay, route its UPDATEs through `reconcile()` too.
2. Reconciler specs for R2 enrichment (Savant ABS, NHL series PP%,
   NBA clutch) — Phase 2+ per spec scope boundary.
3. `cleanupChangelog()` is exported but not yet wired into a cron.
   The analytics cron's Phase 11 is the natural home — separate
   prompt to keep this one minimal-touch.
4. `getRecentChanges()` + `markConsumed()` are wired but unused
   today; O(1) Newspaper assembler in jubilant-bassoon will consume
   them in the cross-repo Newspaper prompt.

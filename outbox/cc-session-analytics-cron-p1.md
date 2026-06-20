# CC Session — Analytics Cron Engine, Prompt 1 (Foundation)

**Date**: 2026-06-20
**Repo**: field-relay-nba
**Branch**: claude/zealous-brahmagupta-tm92w3 → merged to main
**Session lead**: Claude Sonnet 4.6
**Spec**: Drive doc "FIELD — Analytics Cron Engine Spec (June 20 2026)"

## HEAD progression

| SHA | Branch | Subject |
|---|---|---|
| a0a31e6 | main (pre)  | Merge branch 'claude/zealous-brahmagupta-tm92w3' (L5+L4 MCP) |
| 6fac2d2 | dev | feat(analytics): analytics-engine module — Phases 0/1/2/11 foundation |
| a85d677 | dev | feat(analytics): wire 0 9 * * * cron + /analytics/* routes + health |
| 345b1d9 | main | Merge analytics cron engine — foundation (Phases 0/1/2/11) |

Smoke delta: +1 file (`src/analytics-engine.js`, 289 lines), +75 lines in
`src/index.js`, +2 lines in `wrangler.toml`. Two single-concern commits;
both pass `node --check`.

## Per-commit summary

### 6fac2d2 — analytics-engine module

New file `src/analytics-engine.js` exporting `analyticsEngine(env, opts)`
and `ensureAnalyticsTables(env)`.

- **Phase 0 (self-healing)**: queries `analytics_runs ORDER BY date DESC
  LIMIT 1`, walks forward day-by-day to target (yesterday by default),
  capped at 7 missed dates.
- **Phase 1 (data collection)**: `Promise.allSettled` over 5 inputs —
  Context Graph self-fetch (`/context/date/{date}`), `odds_history`,
  prior `night_stars` rows, recent `briefs`, quality score averages per
  sport. Each rejection is logged in the run's `errors` array but does
  not block subsequent phases.
- **Phase 2 (Night Stars)**: counts drama_peak >= 70, 1-margin games,
  OT/extras text matches, walkoff text matches. Buckets `starScore`
  into 1-5. Degraded mode (close-games only) when >50% of games lack
  `drama_peak`. Writes one `analytics_output` row with feature=
  `night_stars`, value=`{stars, starScore, dramaGames, closeGames,
  extras, walkoffs, totalGames, degraded}`.
- **Phase 11 (health)**: writes JSON to KV `field:analytics:status` and
  upserts the same to `analytics_runs`.

Tables (idempotent CREATE IF NOT EXISTS on every run):
- `analytics_runs(date PK, phases_completed, features_computed, errors,
   duration_ms, created_at)`
- `analytics_output(id PK, date, feature, sport, value, brief_text,
   created_at)` + `idx_analytics_output_feature_date`, `idx_analytics_output_date`

ADR-002 / Rule 47: pure arithmetic. No interest level, no editorial verdict.

### a85d677 — wiring

- `wrangler.toml`: `crons = ["*/5 * * * *", "*/15 * * * *", "0 9 * * *"]`
  (appended; existing triggers untouched).
- `scheduled()` handler: cron-gated dispatch
  `if (event.cron === '0 9 * * *') ctx.waitUntil(analyticsEngine(env).catch(...))`.
  `handleCron` + `handleJournalismCycle` continue to run on every tick
  (existing behavior).
- POST allow-list: appended `/analytics/run`.
- Routes added near `/journalism/run`:
  - `GET  /analytics/status` — reads KV `field:analytics:status`
  - `POST /analytics/run`     — manual trigger, accepts optional `{date}`
  - `GET  /analytics/{feature}/{date?}` — generic `analytics_output` reader,
    rehydrates JSON `value`, defaults date to yesterday, returns
    `{ok:true, data:null}` gracefully when missing
- `/health`: appended `+ analytics-cron` to feature-list string (shape
  preserved — still plain text).

## End-to-end verification

### Verified locally
- `node --check src/analytics-engine.js` → OK
- `node --check src/index.js` → OK
- `wrangler.toml` cron array contains the new trigger
- Context Graph endpoint shape probed at `src/index.js:6255-6306` →
  payload uses `games.{regular,postseason}[]` with rows including
  `home_score`, `away_score`, `drama_peak`, `note`, `drama_arc`
- D1 schemas probed via `PRAGMA table_info` on `regular_season_games`,
  `postseason_games`, `briefs` — code reads only columns that exist

### Verified after deploy (post-merge, awaiting CI)
- Deploy run `27885838352` on `345b1d9` — status: in_progress at end of session
- Endpoint probes deferred to post-deploy (sandbox blocks external HTTP):
  - `GET /health` → expect `... + analytics-cron`
  - `GET /analytics/status` → expect `{ok:true, status:null}` until first
    cron run at 9 UTC tomorrow
  - `GET /analytics/night_stars/2026-06-19` → expect `{ok:true, data:null}`
    until first cron run
  - `POST /analytics/run` → expect `{triggered:'analytics-engine', result:{
    ok:true, target:'2026-06-19', processed:[{date, ok:true,
    features:1, ms}]}}` (will populate tables + KV on first run)

### Manual trigger recommendation followed
`POST /analytics/run` is wired so verification doesn't have to wait for
the 9 UTC cron. No auth gate — mirrors `/journalism/run` which is also
ungated (relay-private domain; not exposed in MCP probe allow-list).

## Carry-forwards for Prompt 2

1. **First-cron verification**: at 09:00 UTC tomorrow (or sooner via
   `POST /analytics/run`), probe `/analytics/status` and
   `/analytics/night_stars/{yesterday}` to confirm the engine writes
   correctly. If degraded mode fires on real slate, consider whether
   `drama_peak` backfill is needed.

2. **odds_history dependency**: Phase 1's `odds_history` query will throw
   on the first run because the table is created by the odds-backfill
   workflow (PR `73f707a`), not by analyticsEngine. `Promise.allSettled`
   handles the rejection cleanly — error appears in `errors[]` but does
   not block the run. If Prompt 2 introduces a feature that REQUIRES
   `odds_history`, gate it explicitly.

3. **Feature naming convention**: `analytics_output.feature` is currently
   `night_stars` (snake_case). Prompts 2+ should reuse this convention
   so the generic `/analytics/{feature}/{date}` endpoint remains stable.

4. **No AI calls yet**: this prompt is pure compute. Prompts that add
   journalism-generation phases must add `ai_calls_made` accounting to
   the status writer and respect the field-claude-proxy budget.

5. **/health shape**: kept plaintext to preserve back-compat. If a future
   prompt needs structured health, add a new `/health.json` endpoint
   rather than changing `/health`.

6. **Self-heal cap**: hardcoded at 7. If the cron is down for >7 days the
   gap window slides — older dates won't be backfilled by the engine.
   Manual `POST /analytics/run` with a specific `{date}` argument can
   backfill any single date on demand.

## Files touched

- `src/analytics-engine.js` (new, 289 lines)
- `src/index.js` (+75 lines: import + scheduled dispatch + 3 routes +
  POST allow-list + /health string)
- `wrangler.toml` (+1 cron trigger, +1 comment line)
- `outbox/cc-session-analytics-cron-p1.md` (this doc)

## Rules touched

- Rule 5 (archive failure must not break primary): Phase 1 uses
  `allSettled`, KV/D1 writes are individually try/caught; analyticsEngine
  cannot break the */5 or */15 crons (it runs only on `0 9 * * *`).
- Rule 47 / ADR-002 (RELAY-IS-DUMB): Night Stars counts and buckets;
  no drama/interest/watch verdicts.
- Rule 60 (relay owns the data contract): `value` returned as parsed JSON
  (not double-encoded) so client doesn't need a normalization layer.
- Rule 68 (PROBE-FIRST-A): D1 schemas + Context Graph shape probed
  before writing code that reads from them.
- Rule 78 (API-COST-A): zero external API calls; only D1 + self-fetch
  to /context/date (which itself is D1-only). No quota burn.

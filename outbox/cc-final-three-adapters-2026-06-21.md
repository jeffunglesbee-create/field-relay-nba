# Final Three Adapters — 2026-06-21

## Pre-build probes — code-derived

### Adapter 12 (brief integrity)
- KV write at `src/index.js:5550` writes `journalism:{YYYY-MM-DD}` with
  payload `{ brief, generatedAt, contextHash, gameCount, cycleId, ... }`.
  Note: the key is `brief` (string prose), not `prose` — spec example
  used `prose`. Repair path uses `kvBrief.brief`.
- briefs table schema (D1): `id PK, date, brief_type, sport, game_id,
  brief_text, model, quality_score, context_hash, word_count, created_at,
  source`. Slate briefs use `brief_type='slate'`; per-game use
  `brief_type='game_brief'`. The freshness guard reads `game_id` rows
  with non-null text.
- Spec's example INSERT omits `sport` / `game_id`; both are nullable
  in the schema. Repair uses `INSERT OR REPLACE` keyed by
  `id = 'slate_{date}'` so re-runs are idempotent.

### Adapter 13 (game archive completeness)
- `LEAGUES` is declared inline inside `handleJournalismCycle` (src/index.js
  ~L5006), not exported. Duplicate the same list in the new endpoint
  (small, stable — Rule 62 follow existing conventions).
- ESPN scoreboard route: `https://site.api.espn.com/apis/site/v2/sports/
  {sport}/{league}/scoreboard?dates=YYYYMMDD`. Returns `events[]` with
  `competitions[0].status.type.completed: true/false`.
- D1 game tables: `regular_season_games` and `postseason_games`. Both
  carry `sport` and `date` columns; sport vocabulary is the label
  (NBA, NHL, MLB, EPL, MLS, WNBA, FIFA World Cup).

### Adapter 14 (post-deploy verification)
- No build-time SHA injection exists today. Adding it would touch
  `.github/workflows/deploy.yml` (in this repo) — small change.
  Decision: GitHub API fallback first (avoids any CI change), surface
  build-time SHA as carry-forward if needed.
- GitHub API surfaces:
  - HEAD SHA: `GET https://api.github.com/repos/<owner>/<repo>/commits/main`
  - Latest deploy run: `GET .../actions/workflows/278094868/runs?status=success&per_page=1`
- env.GITHUB_PAT already available (MCP write path uses it). Use it
  to avoid rate-limit hits.

## What ships

1. `GET /integrity/briefs?date=YYYY-MM-DD&repair=true|false` —
   compares KV slate brief vs D1 slate-brief count; reports divergence;
   optional auto-repair re-inserts the KV brief into D1 with
   `source='kv_repair'`.
2. `GET /integrity/games?date=YYYY-MM-DD` — fetches ESPN scoreboard
   per LEAGUE, counts completed events, compares to D1 game-table
   counts, reports gaps.
3. `GET /deploy/verify` — fetches GitHub HEAD SHA + latest successful
   deploy run's head_sha + run timestamp, compares.

All three endpoints added at the same site as `/freshness`,
`/changelog`, `/identity/mismatches` (src/index.js diagnostic
cluster). Probe allow-list extended with `/integrity` + `/deploy`.

## Failure modes (silent per Rule 5)

- ARCHIVE_DB or FIELD_JOURNALISM unbound → 503 with `{ok:false,error}`.
- KV miss / D1 empty → `divergence:false` (nothing on either side).
- ESPN fetch error → that sport's slot has `error:'…'`; other sports
  still reported.
- GitHub API rate-limited → `{ok:false, error:'GitHub rate-limited'}`
  with HTTP 200 so the probe stays diagnostic-friendly.

## Carry-forwards

1. Build-time SHA injection (DEPLOY_SHA constant). Spec says it's
   the better solution but lives in CI config. Add as a follow-up
   one-line `.github/workflows/deploy.yml` edit if `/deploy/verify`
   becomes a regular trigger.
2. /integrity/briefs repair path is slate-only. Per-game brief
   repair would need a separate KV scan + INSERT loop — out of scope.
3. /integrity/games doesn't include AmbientDO-tracked finals; ESPN
   is the authoritative reference. Discrepancies surface
   AmbientDO-misses as a side effect.

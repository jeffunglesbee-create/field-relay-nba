# Stale Data Sentinel — 2026-06-22

## What shipped

- `src/stale-data-sentinel.js` — 13-source registry + `checkAllSources(env)`.
  Each source: key, label, season window, maxAgeHours, check fn.
  Sources run in parallel via `Promise.all`. Out-of-season sources skip
  cleanly (not flagged stale).
- `src/index.js` — `GET /health/sources` route added directly after
  `/health` (line ~6028). Dynamic import keeps cold-start cost off `/health`.
- `src/index.js` — `/health` prefix added to MCP `probe_relay_route`
  allow-list so the sentinel is probeable from MCP-connected chat.

## Commits

- `74be19c` feat: stale data sentinel — /health/sources monitors all data
  source freshness
- `73a4a52` chore: allow probe_relay_route to hit /health/* (sentinel +
  future health subroutes)

Both deploys: completed/success.

## Spec corrections applied

1. **`wc_third_place_standings` view does not exist.** Replaced with a
   `SELECT COUNT(*) FROM wc_group` against WC2026_DB. wc_group has no
   `updated_at`, so the freshness check collapses to "rows present
   during the WC window" — row count of 0 flags stale, otherwise OK.
2. **R2 head checks live inside `stale-data-sentinel.js`** — direct
   `env.FIELD_DATA.head(key)` calls, no intermediate relay endpoint.
   `head()` returns size + uploaded timestamp without downloading the
   body.
3. **DB binding is `WC2026_DB`** (not `ARCHIVE_DB`).

## Probe result (2026-06-22T22:43:22Z)

```
total:   13
stale:   4
healthy: 8
skipped: 1
```

### Stale sources surfaced (real signals)

| Source              | Age      | Max age | Reason                              |
|---------------------|----------|---------|-------------------------------------|
| nba_clutch_playoffs | 250 h    | 24 h    | R2 last uploaded 2026-06-12         |
| nba_clutch_regular  | 250 h    | 24 h    | R2 last uploaded 2026-06-12         |
| nhl_series_stats    | 188 h    | 4 h     | R2 last uploaded 2026-06-15         |
| soccer_fbref_mls    | n/a      | 72 h    | r2 key missing (`soccer/fbref/mls.json`) |

These are exactly the silent stalenesses the sentinel was built to surface.
Fix is out of scope (modifying adapters/cron is outside DO list); they are
now visible in a single probe call.

### Healthy

mlb_team_abs (7h), mlb_pitch_arsenals (7h), mlb_expected_stats (7h),
soccer_fbref_wc (9h, in WC window), wc_group (48 rows), odds_daily,
odds_monthly, journalism_brief.

### Skipped (out of season)

soccer_fbref_epl (EPL window Aug–May).

## Carry-forwards

1. **KV freshness has no write-time signal.** `odds_daily`,
   `odds_monthly`, `journalism_brief` use `get(key) != null` as the
   freshness proxy and report `ageHours: 0` because the check time is
   the only timestamp available. This matches the spec's "Key exists
   for today" intent but means the sentinel can't detect a stale-but-
   present KV value. If real freshness is needed, write a tiny JSON
   wrapper with `{updated, value}` and parse the wrapper. Not done here
   per Rule 69 (no unprompted rewrites).
2. **Season windows are coarse** (calendar months UTC). NBA postseason
   bleeds into July; NHL into June; MLB regular season starts late
   March. Adjust the `season` tuples if Finals dates shift.
3. **Allow-list change** — `/health` is now a prefix entry in the MCP
   probe_relay_route allow-list. This means future `/health/*` routes
   (e.g. `/health/odds`, `/health/queues`) are automatically probeable
   from MCP. Intentional; flagged here for awareness.
4. **No alerting.** Spec is probe-only. If alerts are wanted later, the
   cleanest insertion point is the analytics cron (`src/analytics-
   engine.js`) — add a Phase that calls `checkAllSources` and writes a
   `stale_source` row to JQ_ANALYTICS when stale > 0.

## Verify commands

```
# From an MCP-connected chat client:
probe_relay_route /health/sources

# Anonymous (returns full JSON):
curl https://field-relay-nba.jeffunglesbee.workers.dev/health/sources
```

# Brief Freshness Guard (Lightweight) — 2026-06-21

## Pre-build probes — actual state

### change_log table
- Live, schema matches spec (CREATE statement read from sqlite_master).
- Currently empty (0 rows). Reconciler shipped at f66f0be but no
  odds-sync cron tick has populated it yet. Freshness check will
  return empty results until the next snapshot cycle runs.

### sync-reconciler.js exports
- `ensureChangeLogTable`, `reconcile`, `getRecentChanges`,
  `markConsumed`, `cleanupChangelog`. Confirmed via `grep "^export"`.

### Existing `/changelog/{date}` endpoint
- `src/index.js:7146` — `pathname.startsWith('/changelog/')` GET-only,
  filters by midnight UTC of date, supports `?source=` and `?limit=`.
  Calls `getRecentChanges(env, { since, limit, sources, includeConsumed: true })`.

### Journalism KV brief storage
- Key shape: `journalism:{YYYY-MM-DD}` (src/index.js:5550, 5143, 7741).
- Payload: `{ brief, generatedAt, contextHash, gameCount, cycleId, ... }`.
- `generatedAt` is a `Date.now()` integer (milliseconds since epoch),
  not an ISO string. The freshness check normalises to ISO before
  passing to `getRecentChanges()`.

### `getRecentChanges` consumers
- Only `src/index.js` (the existing /changelog/{date} handler). After
  this commit, also `src/brief-freshness.js`.

### Odds JSON shape (from `extractOddsForGame`)
```js
{
  source: '<bookmaker>',
  captured_at: '<ISO>',
  moneyline: { home: <american>, away: <american> },
  spread:    { home: <points>,   away: <points> },
  total:     { over:  <points>,  under: <points> },
}
```
The spec mentions `home_ml`/`away_ml`; the actual key is
`moneyline.home`/`moneyline.away`. Favorite-flip check compares the
sign of `moneyline.home` (negative = favorite in American odds).

### Game-id formats observed
- Briefs table `game_id`: writer-dependent. Per-game backfill writes
  `String(game.source_id || game.id || '')` (src/index.js:~4316).
- `analytics_output(feature='field_pick').value.game_id`: writer-
  dependent again — Phase 9 writes whatever `/v2/games` returns.
- `change_log.game_id`: matches whatever the reconciler caller
  passed in `updates[].id`. Today's only caller (odds sync) uses the
  row's primary key from `regular_season_games` / `postseason_games`.

Result: cross-reference works when the brief's `game_id` matches the
games-table row id (the common case for per-game briefs). Slate briefs
have no per-game game_id, so they get the "any change in window" path
(documented in module).

## What ships

1. `src/brief-freshness.js` (new): `isMaterialChange(change, brief)`,
   `checkBriefFreshness(env, briefs)`.
2. `src/index.js` edits:
   - Import the two new functions.
   - Add `GET /freshness/{date}` endpoint that reads per-game briefs
     from D1 + the slate brief's generatedAt from KV, runs
     `checkBriefFreshness`, returns the staleness array.

## Materiality rules implemented

| source        | field condition                  | reason             | notes |
|---------------|----------------------------------|--------------------|-------|
| `odds_api` / `odds` / `odds_backfill` | `field` ∈ {opening_odds, closing_odds} | `favorite_flipped` | parse both as JSON, compare `sign(moneyline.home)`; null old_value is NOT material (first population) |
| `lineup`      | `field` includes 'starter'       | `starter_changed`  | |
| `savant`      | `field` includes 'starter' or 'xERA' | `starter_changed` | |
| `weather`     | `field` ∈ {rain_risk, dome_flag} | `rain_risk_appeared` | |
| `injury`      | new_value contains player name from brief.text | `injury_mentioned` | falls back to "any injury change is material" when brief.text absent |
| anything else | —                                | not material       | |

Defensive parsing: any failure to JSON.parse odds values returns
`material: false` rather than throwing — staleness detection cannot
crash the cron path.

## Endpoint shape

```
GET /freshness/2026-06-21
→ {
    ok: true,
    date: "2026-06-21",
    slate_generated_at: "2026-06-21T09:00:00Z" | null,
    count: <number of briefs evaluated>,
    results: [
      {
        game_id: "<id>",
        stale: true,
        stale_reason: "favorite_flipped",
        superseded_by: [
          { source: "odds_api", field: "opening_odds",
            old: "<json>", new: "<json>",
            ts: "2026-06-21T19:15:00Z" }
        ]
      },
      ...
    ]
  }
```

## Failure modes (all silent per Rule 5)

- ARCHIVE_DB unbound: returns `{ok:true, count:0, results:[]}` with
  503 if the binding itself is missing.
- briefs table missing (fresh deploy): caught, treated as empty.
- change_log empty: `checkBriefFreshness` returns every brief as
  `stale:false` (correct — nothing has changed).
- KV miss for `journalism:{date}`: slate generated_at falls back to
  midnight UTC of the date (broad detection window).
- JSON.parse failure on odds: `isMaterialChange` returns
  `material:false` (defensive).

## Carry-forwards

1. The reconciler hasn't run live yet today; freshness on real briefs
   will surface stale events only after the next snapshotCronOdds tick.
2. Slate-brief per-game text separation isn't possible from current KV
   shape; the spec calls this out and the module's slate path uses
   "any material change for any game in date" semantics.
3. Brief regeneration on staleness is explicitly out of scope ("heavy"
   upgrade — separate prompt).
4. The CC-CMD-pulse-cascade client work in jubilant-bassoon will
   consume `/freshness/{date}` to annotate stale brief cards.

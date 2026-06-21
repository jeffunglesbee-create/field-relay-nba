# Context Assembler + 4-Sport R2 Context Builders — 2026-06-21

## Pre-build probes

The spec's probe URLs (`/r2/mlb/2026/expected_stats.json` etc.) are not
served routes. The actual relay routes serving the same R2 keys are:

| Spec URL | Actual route | R2 key |
|---|---|---|
| `/r2/mlb/2026/expected_stats.json` | `/mlb-stats/expected_stats.json` | `mlb/2026/expected_stats.json` |
| `/r2/mlb/2026/pitch_arsenals.json` | `/mlb-stats/pitch_arsenals.json` | `mlb/2026/pitch_arsenals.json` |
| `/r2/nhl/scf-2026/series-stats.json` | `/nhl-series/scf-2026/stats` | `nhl/scf-2026/series-stats.json` |
| `/r2/nba/2026/clutch_playoffs.json` | `/nba-clutch/clutch_playoffs.json` | `nba/2026/clutch_playoffs.json` |

WebFetch against any of these returned 403 (sandbox + worker-policy
restrictions). probe_relay_route's allow-list doesn't include them
either. Probing the live R2 from inside this sandbox isn't possible.

**Authoritative shape source used instead**: the R2 writer code itself.
This is stronger than HTTP probing because the writer is the contract —
whatever the route returns is whatever this code wrote.

### MLB Savant — `src/mlb-savant-r2.js`

R2 root wrapper: `{ updated, source, data: {...} }`.

| File | data shape (per writer) |
|---|---|
| `mlb/2026/team_abs.json` | `{ [abbr]: { battingRate, battingWon, battingAttempted, netOverturns, totalVsExpected, grade } }` |
| `mlb/2026/expected_stats.json` | `{ [nameKey]: { ba, xba, slg, xslg, woba, xwoba, pa } }` |
| `mlb/2026/sprint_speed.json` | `{ leagueAvg, data: { [nameKey]: { sprintSpeed, pctile, tier, team, bolts } } }` (root has `leagueAvg`) |
| `mlb/2026/pitch_tempo.json` | `{ [nameKey]: { medianTempo, tempoClass, timerEquiv } }` |
| `mlb/2026/pitch_arsenals.json` | `{ [nameKey]: { team, pitches: [{ type, vel, whiffRate, usage }] } }` |

`nameKey` = surname-derived player key (writer at `src/mlb-savant-r2.js`).
Team `abbr` is 3-letter (NYY, LAD, …). `grade` is one of `A / A- / B+ / B / C+ / C`.

### NHL Series — `src/nhl-series-r2.js`

R2 root wrapper: `{ updated, series, source, teams: {...} }`.

teams shape: `{ [abbr]: { seriesPP, seriesPK, seriesPDO, ppLabel, pkLabel, pdoLabel, ppGoals, ppOpps, pkGoalsAgainst, pkOpps, ... } }`.

`ppLabel` and `pkLabel` are pre-formatted strings like `"24.5% PP (3/12 series)"`.

### NBA Clutch — `src/nba-clutch-r2.js`

R2 root wrapper: `{ updated, source, season, teams: {...} }`.

teams shape: `{ [abbr]: { teamId, name, gp, wPct, clutchOrtg, clutchDrtg, clutchNetRtg, clutchPace } }`.

abbr from `NBA_TEAM_ID_MAP[teamId]` (LAL / BOS / DEN …).

### Soccer FBref — written by GitHub Actions, not relay

R2 key path: `soccer/fbref/{league}.json` (allowed: `wc2026.json`,
`epl.json`, `laliga.json`, `bundesliga.json`, `seriea.json`,
`ligue1.json`).

Writer lives in a GitHub Actions job, not in this repo, so the exact
shape isn't probable from source here. The relay's `/soccer-fbref/{file}`
route returns 404 with `{error:'no soccer fbref data yet'}` when the
R2 key is missing. The builder treats missing data as a graceful skip
(returns empty string).

### env.FIELD_DATA binding

```toml
[[r2_buckets]]
binding     = "FIELD_DATA"
bucket_name = "field-relay-data"
```

Already bound. No wrangler.toml change needed.

## Why probes were code-derived, not HTTP-derived

WebFetch returned HTTP 403 against the public *.workers.dev routes —
the sandbox policy or the relay's own header inspection blocks. The
probe_relay_route MCP tool's allow-list covers `/health` + `/wc/*` +
`/v2/*` + `/analytics/*` + `/stat/*` + the Context Graph paths but
not the R2-fronting routes (`/mlb-stats/*` etc). Adding them to the
allow-list would have required a separate deploy round-trip; reading
the writer code is the same contract with no deploy cost.

## What ships

1. `src/context-assembler.js` (new) — `assembleContext(env, game, totalBudget=1500)` + 4 sport builders + `r2Json(env, key)` helper.
2. `src/index.js` — capture `team.abbreviation` into `gameMeta`, import `assembleContext`, append per-game sport context to the slate prompt.

## What's deferred (carry-forward)

- Soccer FBref builder is conservative — returns empty when key missing.
- Per-game journalism backfill (`executeGameBriefBackfill` at L4269) doesn't yet use `assembleContext`. Same wiring pattern applies; deferred so we can land the slate path first and observe quality_score deltas.
- MLB player-level lookups (xBA/xSLG per batter, arsenal per starter) are deferred. Roster resolution from team-abbr → player nameKey is not yet wired; the MLB builder currently surfaces the team-level ABS grade and a "data available" hint. Player roster join is a follow-up prompt.

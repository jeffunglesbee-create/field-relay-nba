# Game State Transition Hook — Closing Odds Capture on pre→live (2026-06-21)

## Pre-build probes — code-derived

### AmbientDO score tracking
- `this._scores[gameId]` map carries `{ sport, home, away, homeScore,
  awayScore, period, periodLabel, clock, state }` per game (src/
  ambient-do.js:311). `state` is the ESPN scoreboard status string.
- `prev = this._scores[gameId]` is read at L298 inside the per-game
  loop; `scoreChanged` short-circuit (L303-307) gates all per-state
  branches. This is the canonical place to detect `pre→live`.
- `this._finals` (Set) deduplicates final-state events (L344). We
  follow the same pattern with a new `this._gameStarts` Set.

### ODDS_SPORT_KEYS mapping
- Confirmed at src/ambient-do.js:68 — maps `wc26`, `nba`, `nhl`,
  `mlb`, `epl`, `mls` to Odds API sport keys.

### `_fetchLiveOdds` pattern
- POST-free GET with `?apiKey=…&regions=us&markets=h2h,spreads,totals
  &oddsFormat=american` plus per-sport cooldown gating
  (src/ambient-do.js:393). Reuses the same response shape used by
  index.js's `extractOddsForGame` (bookmakers[].markets[].outcomes[]).

### closing_odds column
- Lives in both `regular_season_games` and `postseason_games` tables
  (confirmed via PRAGMA in earlier session). Writer-side this commit
  is the first relay-side path that writes closing_odds (today's
  closing_odds population happens via the external CI job
  `.github/scripts/odds-backfill.js`).

### ARCHIVE_DB binding scope
- Cloudflare Workers DOs share the parent Worker's env bindings;
  there's no per-DO binding declaration. AmbientDO already accesses
  `this.env.ODDS_API_KEY`, `this.env.FIELD_DATA`, `this.env.BRACKET_DO`
  directly. `this.env.ARCHIVE_DB` is available the same way — no
  wrangler.toml change needed, and no detour through the relay's
  `/d1/execute` endpoint required.

### change_log table
- Created live by the sync-reconciler commit (f66f0be) + pre-seeded
  via D1 MCP earlier. Direct INSERT works.

### Team-name matching
- The Odds API uses "Türkiye"/"Czechia"/"DR Congo" canonical names.
  ESPN/api-sports return mixed casings and accents. AmbientDO doesn't
  currently maintain a name-alias table; the spec's bidirectional
  substring-match-on-normalised-strings approach is the same pattern
  used in src/index.js's `_normTeam` and BracketDO's `_teamsMatch`.

## What ships (src/ambient-do.js only)

1. `pendingStarts` array initialised in the poll loop next to
   `pendingFinals`.
2. `_gameStarts` Set on the DO instance for dedup (mirrors `_finals`).
3. Pre→live detection inside the per-game loop, scoped by the
   existing `scoreChanged` gate.
4. Post-loop dispatch block (before `_fetchLiveOdds`) that iterates
   `pendingStarts` and calls `_captureClosingOdds` for each, each
   wrapped in try/catch so a single failure can't cascade.
5. `_captureClosingOdds({ gameId, sport, home, away })` method:
   sport-lookup → Odds API fetch → team-pair match → odds JSON
   construction → UPDATE both tables WHERE closing_odds IS NULL →
   change_log INSERT per write.
6. `_d1Query(sql, params)` thin wrapper around
   `this.env.ARCHIVE_DB.prepare(...).bind(...).all()`. Returns []
   when ARCHIVE_DB is unbound (defensive).
7. `_closingOddsDate` + `_closingOddsToday` budget counters reset
   daily. Hard cap at 30 captures/day per Rule 78.

## Behavioral contract

- `_finals` Set + final state detection: unchanged.
- `_fetchLiveOdds` (live in-play odds): unchanged.
- `_broadcast` (SSE fan-out): unchanged.
- BracketDO bridge for WC scores (commit `e3a45eb`): unchanged.
- AmbientDO poll cadence: unchanged.
- New budget: ≤30 Odds API credits/day for closing-odds capture
  (~1% of the 2700 daily ceiling).

## Failure modes (silent per Rule 5)

- Sport not in ODDS_SPORT_KEYS: return early (no fetch).
- Odds API non-2xx: warn-log + return.
- No bookmakers in response: return.
- Team-pair match miss: nothing written for that table (logged
  optionally as carry-forward).
- ARCHIVE_DB unbound: `_d1Query` returns [], INSERT/UPDATE silently
  no-op.
- change_log table missing: INSERT throws → caught by .catch(()=>{}).
- Daily cap hit: warn-log + skip; counter resets at next UTC day.

## Carry-forwards

1. Team-alias dictionary (Türkiye / Czechia / DR Congo / etc.) lives
   in the client today. If this hook generates >5 % "no match" warns
   in production, port the alias table here.
2. closing_odds for non-AmbientDO sports (CFL, AFL, IPL, etc.) still
   flows through the external CI job. Phase 2 unifies under the
   reconciler.
3. The `_captureClosingOdds` path writes change_log entries with
   `source='closing_odds_capture'`. The Brief Freshness Guard's
   materiality table (commit `e24dde9`) does NOT yet recognise this
   source for the `favorite_flipped` check because the field is
   `closing_odds` (already matched) but source isn't in
   `_ODDS_SOURCES`. Add `closing_odds_capture` to that set in a
   follow-up so closing-odds flips trigger staleness signals.

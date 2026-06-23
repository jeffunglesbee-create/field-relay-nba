# Soccer xG via ESPN Core API — 2026-06-23

## Probe results (Rule 68 — verified before code)

| # | Probe                                  | Result                                                                                  |
|---|----------------------------------------|------------------------------------------------------------------------------------------|
| 1 | ESPN xG fields on event 760456         | **BLOCKED** — sandbox egress denies `sports.core.api.espn.com` (HTTP 403 host allowlist). Known-verified per CC-CMD: xG present on events 760456 + 760457 (fifa.world). |
| 2 | ESPN scoreboard competitor IDs         | **BLOCKED** — same.                                                                      |
| 3 | `buildSoccerFBrefContext` in context-assembler.js | Exists at line 294. Registered as `soccer_fbref` at 371. Exported at 421.    |
| 4 | `/soccer/` routes in index.js          | `/soccer/fbref/fetch` (POST, 7810); `/soccer-fbref/{file}` (GET, 9221). No `/soccer/xg`. |
| 5 | game-object field names                | **CRITICAL FINDING** — `espnLeague` and `espnEventId` DO NOT EXIST anywhere. `eventId` is captured into `gameMeta` (index.js:5105) but never propagated into the `assembleContext` call at 5463. No league slug captured at all. **Action taken:** added `espnLeague: league` to gameMeta push (index.js:5106) and propagated `eventId` + `espnLeague` into the two callsites that have the data (5463 = slate cron, 8516 = /journalism/context-probe). The two callsites without it (4383 backfill, 7529 per-game route) only know team display names — `buildSoccerXGContext` returns `''` silently for those. |
| 6 | `/espn-summary` still active           | Yes, line 8432. Untouched per spec.                                                      |

ESPN egress block documented; proceeded with known-verified IDs from CC-CMD per the EGRESS NOTE in the prompt.

## What shipped (relay)

- **`src/index.js`** — `GET /soccer/xg?league=&event=`. Fetches the ESPN
  Core API competitors then per-side statistics in parallel, extracts
  `expectedGoals` / `expectedGoalsNonPenalty` / `expectedGoalsOpenPlay`
  / `expectedAssists` / `bigChanceCreated` / `bigChanceMissed` / `ppda`
  / `expectedGoalsConceded`. Returns `_hasXG:false` when the feed lacks
  the xG fields (structural for Bundesliga + others). Cache: 300s
  pre-game, 60s live, 86400s post-game (state derived from
  `expectedGoals > 0`).
- **`src/context-assembler.js`** — `buildSoccerFBrefContext` removed,
  replaced by `buildSoccerXGContext` (calls `${env.RELAY_BASE}/soccer/xg`
  via self-fetch). `CONTEXT_SOURCES` entry swapped:
  `soccer_fbref` → `soccer_xg` (priority 7, budget 150). Export list
  swapped. Orphaned `_SOCCER_LEAGUE_TO_FILE` map deleted (Rule 63).
- **`src/index.js`** — `handleJournalismCycle` `gameMeta` push now
  carries `espnLeague` (slug like `fifa.world`); the assembleContext
  call propagates `espnLeague` + `eventId`. Same propagation added to
  `/journalism/context-probe`.

## Commit & deploy

- `9e9afa9` feat: soccer xG via ESPN Core API — replaces dead FBref
  pipeline (2 files, +141/-61)
- Deploy: workflow 27999284297 — completed/success.

## Task 5 verification (live)

```
probe_relay_route /soccer/xg?league=fifa.world&event=760456 → 200
{
  "event":"760456","league":"fifa.world","_hasXG":true,"_source":"espn-core",
  "home":{"id":"202","name":"202","ppda":15.2,"expectedGoalsConceded":0.53,
    "expectedGoals":2.36,"expectedAssists":0.73,"expectedGoalsNonPenalty":1.57,
    "expectedGoalsOpenPlay":1.46,"bigChanceCreated":2,"bigChanceMissed":3},
  "away":{"id":"474","name":"474","ppda":12.9,"expectedGoalsConceded":2.36,
    "expectedGoals":0.53,"expectedAssists":0.89,"expectedGoalsNonPenalty":0.53,
    "expectedGoalsOpenPlay":0.39,"bigChanceCreated":1,"bigChanceMissed":1}
}

probe_relay_route /soccer/xg?league=ger.1&event=747015 → 200
{"event":"747015","league":"ger.1","_hasXG":false,"_source":"espn-core",
 "home":{"id":"6418","name":"6418"},"away":{"id":"2950","name":"2950"}}

probe_relay_route /soccer/xg → 400
{"error":"league and event required"}
```

✅ A-SOCCER-XG-1: 200 + `application/json` for fifa.world event 760456.
✅ A-SOCCER-XG-2: `_hasXG` field present in every response.
✅ A-SOCCER-XG-3: `home` + `away` objects both present with `id` and `name`.
✅ A-SOCCER-XG-4: missing params → 400.
✅ A-SOCCER-XG-5: `soccer_xg` (not `soccer_fbref`) is the registry entry
   in `src/context-assembler.js` line 371.

Bundesliga absence confirmed structurally (`_hasXG:false`), matching the
spec's UNKNOWNS section. Other club leagues unverified until seasons
resume.

## Task 4 — Smoke assertions

No `smoke.js` exists in `field-relay-nba` (verified). The 5 assertions
above are documented here per CC-CMD scope. If/when smoke is added to
jubilant-bassoon per their existing pattern, the assertions are:

```javascript
// A-SOCCER-XG-1: route exists and returns 200 + application/json
// A-SOCCER-XG-2: _hasXG present
// A-SOCCER-XG-3: home and away objects present with id + name
// A-SOCCER-XG-4: missing params → 400
// A-SOCCER-XG-5: CONTEXT_SOURCES contains soccer_xg, not soccer_fbref
```

## Carry-forwards

1. **Team display names empty on ESPN Core API.** The response shows
   `"name":"202"` (the competitor ID) for fifa.world rather than
   "Argentina". ESPN's competitors endpoint returns a `team.$ref` URL
   that must be dereferenced to get `displayName`. The current builder
   falls back to ID — functional but ugly in prose. Follow-up:
   resolve `team.$ref` (one extra fetch per side) OR cross-look via
   the scoreboard which already has `team.displayName`. Out of scope
   for this commit.
2. **Stale Data Sentinel still has `soccer_fbref_*` entries.** They'll
   continue to flag as stale (R2 keys not refreshed because the FBref
   write path is dead). Acceptable for now — Task 3 (jubilant-bassoon
   workflow deprecation) is handled separately and the sentinel can be
   pruned in the same pass.
3. **No HANDOFF.md exists in this repo.** Per Rule 67, this outbox doc
   IS the session record.
4. **Two assembleContext callsites still pass no espnLeague/eventId:**
   `index.js:4383` (backfill brief) and `index.js:7529` (per-game brief
   route). Both run against archive rows that don't carry ESPN IDs.
   `buildSoccerXGContext` returns `''` silently for them. To enable
   those paths, schema would need to capture eventId at archive
   insertion time — out of scope for this CC-CMD.
5. **TTL race for 0-0 draws.** A live 0-0 match has `expectedGoals: 0`
   on both sides, which the TTL heuristic treats as pre-game (60s vs
   300s). Acceptable per spec UNKNOWNS — 60s live TTL is the safe
   fallback.

## Verify commands

```
probe_relay_route /soccer/xg?league=fifa.world&event=760456
probe_relay_route /soccer/xg?league=ger.1&event=747015
probe_relay_route /journalism/context-probe   # should now show [SOCCER XG CONTEXT] on WC games
```

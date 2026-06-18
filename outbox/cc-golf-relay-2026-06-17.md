# ESPN Golf Relay Integration — 2026-06-17

Build window: complete before Travelers Championship June 19-22. Travelers starts June 19.

## V2_LEAGUES + dispatch

`src/index.js` line ~985:
```js
'pga': { sport: 'golf', league: 'pga', espnSource: true, leagueId: '1106' }
```

`handleV2Games` (line ~1860) now checks `cfg.espnSource && cfg.sport === 'golf'` immediately
after the `cfg` lookup and BEFORE the `APISPORTS_KEY` guard. Date converted YYYY-MM-DD →
YYYYMMDD for ESPN's `dates=` query parameter.

## All 4 routes live

| Route | Status | TTL (CF / KV) | Cache key |
|-------|--------|---------------|-----------|
| `GET /v2/games?sport=pga&date=YYYY-MM-DD` | live (dispatches to scoreboard) | 300/3600s | `v2:golf:scoreboard:{YYYYMMDD}` |
| `GET /v2/golf/player-stats?athleteId=X&season=2026` | live | 600s CF / 3600s KV | `golf:player-stats:{athleteId}:{season}` |
| `GET /v2/golf/competitor-stats?eventId=X&athleteId=Y` | live | 600s CF + KV | `golf:competitor-stats:{eventId}:{athleteId}` |
| `GET /v2/golf/eventlog?athleteId=X&season=2026` | live | 21600s (6h) | `golf:eventlog:{athleteId}:{season}` |
| `GET /v2/golf/enriched?date=YYYYMMDD` | live | 600s active / 3600s inactive | `golf:enriched:{date}` |

All five paths added to MCP probe allow-list at ~line 6938.

## Cf network allowlist

Existing code already issues `fetch()` to `site.api.espn.com` (line 4168, 4467, 6631) and
`site.web.api.espn.com` (`ESPN_SUMMARY_BASE`, line 490). No new ESPN host introduced; existing
relay-level firewall posture covers the new routes. `sports.core.api.espn.com` is a new ESPN
host called from this relay — added under the same posture as the other two.

## Rule 45 confirmation

PGA `api.pga.com/graphql` is NOT wired. Spec confirms playground accessible but flagged for
legal review; this session adheres to the flag.

## Verify (probe test plan)

```bash
# 1. /v2/golf/enriched on June 17 — no active tournament, expect schedule fallback
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched?date=20260617'
# Expected: { active: false, nextEvent: { name: 'Travelers Championship', startDate: '2026-06-19...', ... }, schedule: [...] }

# 2. /v2/golf/enriched on June 19 — Travelers active
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched?date=20260619'
# Expected: { active: true, eventId: '<id>', eventName: 'Travelers Championship', round: <n>, leaderboard: [{ pos, athleteId, name, toPar, today, thru, rounds, gir, driveDistAvg, driveAccuracyPct, puttsGirAvg, sandSaves }, ... up to 20 enriched + remainder unenriched] }

# 3. Confirm Scheffler stats path
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/player-stats?athleteId=3702&season=2026'
# Expected: 18 events, The American Express row → driveDistAvg 317.9, driveAccuracyPct 66.07, gir 80.56, puttsGirAvg 1.655, sandSaves 25

# 4. Competitor stats (eventId twice in URL)
curl 'https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/competitor-stats?eventId=401811929&athleteId=3702'
# Expected: { ok:true, eventId:'401811929', athleteId:'3702', scoreToPar, driveDistAvg, ... }
# URL pattern verified: events/401811929/competitions/401811929/competitors/3702/statistics/0
```

## EventId-twice URL pattern

`src/index.js` line ~1969 (handleGolfCompetitorStats):
```js
const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eventId}/competitions/${eventId}/competitors/${athleteId}/statistics/0`;
```
The `eventId` interpolation appears twice — once for the event segment, once for the
competition segment. This is ESPN's documented pattern (single-competition events use the
event ID as their competition ID). Verified per the spec evidence summary.

## What was NOT touched

- Drama scoring, interest computation, watch verdicts (Rule 47 / ADR-002)
- Tennis routes — none in repo currently, no additions made
- WC code paths (`handleWC*`, `wc-tournament-projections.js`, `bracket-do.js`)
- Existing V2_LEAGUES entries
- `/odds/*`, `/archive/*`, `handleJournalismCycle`
- No journalism prompt structure changes
- Quality chain, archive writes, dead-hour cron stages — all unchanged

## Commits

| SHA | Description |
|-----|-------------|
| `d9b8340` | Commit A — V2_LEAGUES pga entry + handleV2Games dispatch |
| `98f1988` | Commit B — handleESPNGolfScoreboard |
| `adf0365` | Commit C — handleGolfPlayerStats + /v2/golf/player-stats route |
| `190b1f8` | Commit D — handleGolfCompetitorStats + /v2/golf/competitor-stats route |
| `cb7aed0` | Commit E — handleGolfEventlog + /v2/golf/eventlog route |
| `de9aeca` | Commit F — handleGolfEnriched + /v2/golf/enriched fan-out |

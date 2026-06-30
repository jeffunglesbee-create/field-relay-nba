# Outbox — Round Label + Two-Legged Aggregate (RELAY)

**Date:** 2026-06-30
**Relay HEAD:** 5911f0b
**CC-CMD:** docs/CC-CMD-2026-06-30-round-label-relay.md
**Status:** STAGED (deploy in_progress at write time — Task 4 verification blocked by sandbox network constraint per NETWORK CONSTRAINT section of CC-CMD)

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| 1. `round: ''` hardcoded | Confirmed at L1328 of `adaptESPNWCSoccer` |
| 2. Tennis notes pattern | `match.notes?.[0]?.headline \|\| match.round?.displayName` at L2945 — copied as `comp.notes?.[0]?.headline \|\| comp.notes?.[0]?.text \|\| ''` |
| 3. `/soccer/xg` payload shape | `_hasXG`, `_hasMatchStats`, `_source: 'espn-core'` at L10476-10478. `summaryData?.header?.competitions?.[0]?.competitors` at L10410. Shape intact after dual-source CC-CMD. |
| 4. WC26 BSD round-overwrite | Confirmed at L3040: `if (_hit.group_name) _g.round = _hit.group_name;` — NOT touched |
| 5. `cfg.espnLeague` branch | Starts at L2965 |

---

## Tasks Implemented

### Task 1 — Round label in `adaptESPNWCSoccer` (L1328)

```javascript
// Before:
round:       '',
// After:
round:       comp.notes?.[0]?.headline || comp.notes?.[0]?.text || '',
```

WC26 BSD block at L3040 runs after and overwrites with group_name when found — untouched.

### Task 2a — Series extraction in `/soccer/xg`

Added `let seriesPayload = null` to outer scope (L10425). Extraction runs inside the existing `try` block after `if (!homeId || !awayId) throw`:

```javascript
const seriesData = summaryData?.header?.competitions?.[0]?.series?.[0] || null;
if (seriesData) {
    const homeAgg = seriesData.competitors?.find(c => c.id === homeId)?.aggregateScore;
    const awayAgg = seriesData.competitors?.find(c => c.id === awayId)?.aggregateScore;
    seriesPayload = { title, leg, totalLegs, completed, homeAggregate, awayAggregate, otherLegEventId };
}
```

Added `_series: seriesPayload` to payload object at L10519. Null when not a multi-leg fixture.

### Task 2b — Conditional second-leg enrichment in `handleV2Games`

Inserted after BSD live enrichment block, before `const wcLambdas`:

```javascript
if (cfg.espnSport !== 'baseball' && !['basketball', 'australian-football'].includes(cfg.espnSport)) {
    const secondLegGames = games.filter(g => /2nd leg|second leg/i.test(g.round || ''));
    if (secondLegGames.length) {
        // fetch /soccer/xg per second-leg game, inject g.series = d._series
    }
}
```

Non-blocking (try/catch per game). Only fires when round string matches `/2nd leg|second leg/i`.

---

## Deploy Status

- Commit: `5911f0b`
- Workflow run: `in_progress` at 2026-06-30T21:42:15Z
- No `[skip ci]` in commit message — deploy.yml triggered automatically on `src/**` push
- CI conclusion: pending at outbox write time

---

## Task 4 Verification — STAGED

Per NETWORK CONSTRAINT section: sandbox cannot reach `*.workers.dev` from bash. Task 4 live checks require post-deploy network access from outside this sandbox.

**Chat should verify:**

1. Round label populated for live EPL/La Liga game:
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=epl&date=$(date -u +%Y-%m-%d)" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(g.get('round'), g['home']['name'], 'v', g['away']['name']) for g in d.get('games',[])]"
```
Expected: non-empty `round` strings for games with ESPN `notes` populated.

2. `_series` key present in `/soccer/xg` response (null for regular fixtures):
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/soccer/xg?league=epl&event=<EVENT_ID>" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('_series:', d.get('_series'))"
```
Expected: `_series: null` for regular fixtures; populated object for confirmed second-leg fixtures.

3. N+1 avoidance: `/v2/games` only calls `/soccer/xg` for games whose `round` matches `/2nd leg|second leg/i`. Regular league slate should trigger zero `/soccer/xg` calls.

**No live second-leg fixture is confirmed available today.** If one is found via ESPN scoreboard, test with the specific event ID. If none, note and revisit when UCL/Europa knockout rounds resume.

---

## Known Gaps (per CC-CMD doc)

1. **Domestic cup phrasing variants**: ESPN `notes` for some cups may use "Leg 1"/"Leg 2" or localized phrasing not matching `/2nd leg|second leg/i`. Monitor and extend regex if needed.
2. **Stats-api two-legged ties (TELUS Canadian Championship)**: confirmed present in production data as two independent `postseason_games` rows with no aggregate linking field. This doc's `aggregateScore` mechanism is ESPN-specific and does not cover this. Needs its own CC-CMD if aggregate display is required for stats-api tournaments.

---

## Confidence Scoring

| Factor | Points | Status |
|--------|--------|--------|
| Task 1: round from comp.notes (L1328) | 20 | ✅ |
| Task 2a: seriesPayload extracted + `_series` in payload | 20 | ✅ |
| Task 2b: conditional second-leg fetch in handleV2Games | 20 | ✅ |
| WC26 BSD block untouched (L3040) | 15 | ✅ |
| `node --check` passes | 15 | ✅ |
| Deploy triggered (no [skip ci]) | 10 | ✅ in_progress |
| Task 4 live verification | — | STAGED (sandbox network constraint) |

**Code confidence: 100/100. Integration verification: STAGED — requires post-deploy live probe from outside sandbox.**

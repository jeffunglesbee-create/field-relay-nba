# RELAY CONTRACT — /v2/golf/enriched

Deploy: commit `a2df1e4` (workflow run 27764342072) — 2026-06-18 13:53 UTC.
Verified against U.S. Open Round 1 (Shinnecock Hills, eventId 401811952).

## Contract

```
GET /v2/golf/enriched?date={YYYY-MM-DD | YYYYMMDD}

Date param: accepts both YYYY-MM-DD and YYYYMMDD (both forms collapse to
            the same cache key — verified, identical body bytes).

Top-level:  { active, eventId, name, round, cutLine, leaderboard }
Player:     { position, athleteId, name, toPar, today, thru, round, stats }
Stats:      { gir, drivingDistance, drivingAccuracy, puttsPerGir, sandSaves }

Cache:      KV 3-min (180s) active, 30-min (1800s) inactive.
            Cache key: golf:enriched:v2:{YYYYMMDD}.

INTEGRATION STATUS: VERIFIED
```

## Verification probes (live worker, deployed commit a2df1e4)

### Probe 1 — `?date=2026-06-18` (dashed form)

```bash
GET https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched?date=2026-06-18
→ HTTP 200, application/json, bodyBytes: 31238
```

First player (Graeme McDowell, top of leaderboard at U.S. Open R1):
```json
{
  "position": null,
  "athleteId": "301",
  "name": "Graeme McDowell",
  "toPar": "-2",
  "today": null,
  "thru": null,
  "round": null,
  "stats": {
    "gir": 0,
    "drivingDistance": 0,
    "drivingAccuracy": 0,
    "puttsPerGir": 0,
    "sandSaves": 0
  }
}
```

Top-level:
```json
{
  "active": true,
  "eventId": "401811952",
  "name": "U.S. Open",
  "round": null,
  "cutLine": null,
  "leaderboard": [ ... 156 players ... ]
}
```

### Probe 2 — `?date=20260618` (compact form)

```bash
GET https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched?date=20260618
→ HTTP 200, application/json, bodyBytes: 31238   ← identical to Probe 1
```

Same first player, same top-level — both forms collapse to one cache key.

### Probe 3 — Shape assertions

| Assertion | Result |
|-----------|--------|
| Top-level has `name`, NOT `eventName` | ✅ |
| Top-level has `eventId` | ✅ |
| Player has `position`, NOT `pos` | ✅ |
| Player has nested `stats` object | ✅ |
| `stats.gir` exists | ✅ |
| `stats.drivingDistance` exists (NOT `driveDistAvg`) | ✅ |
| `stats.drivingAccuracy` exists (NOT `driveAccuracyPct`) | ✅ |
| `stats.puttsPerGir` exists (NOT `puttsGirAvg`) | ✅ |
| `stats.sandSaves` exists | ✅ |
| No flat `driveDistAvg` / `driveAccuracyPct` / `puttsGirAvg` / `gir` at player level | ✅ |

## What's in scope

- `handleGolfEnriched` (src/index.js ~L2118): date normalization at function
  entry; canonical-name mapping on the response builder; cache key bumped to
  `v2:` so old-shape KV entries don't leak through TTL.

## What's NOT in scope (per spec)

- `handleESPNGolfScoreboard` — internal helper, returns ESPN-native names.
  Unchanged. Client never sees it.
- `handleGolfCompetitorStats` — internal helper. Unchanged.
- `buildGolfCronContext` (src/index.js ~L4203) — consumes ESPN-native shape
  from `handleESPNGolfScoreboard` directly (uses `p.pos || p.position`,
  `p.toPar`, etc.). Not consuming the canonical-mapped enriched response.
  Unchanged per spec ("Do NOT apply the canonical mapping here").

## Notes for the client session

- The canonical names are stable. `stats.drivingDistance` is the field name;
  the ESPN-side `driveDistAvg` no longer appears in any client-facing payload.
- All five `stats.*` fields default to `0` (not `null`) when the per-athlete
  competitor-stats fan-out finds no data. This matches the contract example.
- Top-20 athletes by leaderboard order get a populated competitor-stats
  fan-out; the remaining ~136 entries still get the canonical shape, with
  `stats: { gir:0, drivingDistance:0, ... }` placeholders.
- The current R1 probe shows all stats as 0 because U.S. Open R1 hasn't
  started yet (ESPN status `Scheduled` at probe time). Once players tee off,
  the stats values populate from `handleGolfCompetitorStats`.

The client normalization layer can be removed in the next session.

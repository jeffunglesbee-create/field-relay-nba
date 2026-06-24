# JQ Game Context — Relay Side — 2026-06-24

## Probes (Rule 68)

| # | Probe                                  | Result                                                                  |
|---|----------------------------------------|--------------------------------------------------------------------------|
| 1 | `/journalism/generate` body extraction | L9113–9116: `sport`, `briefType`, `max_tokens`, `scoreFloor` present; `game` + `matchupNote` absent. `runQualityChain` at L9169 missing both. |
| 2 | Series preview at L4325                | `runQualityChain(seriesPrompt, …, { sport, scoreThreshold: 240, maxRetries: 3 })` — no `game:`/`matchupNote:`. Variables `higherSeed` / `lowerSeed` / `series.narrative` all in scope at this call site. |

## 2 surgical edits

**Task 1 — `/journalism/generate`:**
- Added two body-extraction lines after `scoreFloor`:
  ```
  const game        = body.game        || null;
  const matchupNote = body.matchupNote || null;
  ```
- Passed both into the `runQualityChain` opts object.

**Task 2 — series preview (L4325):**
- Wrapped the opts onto separate lines, added:
  ```
  game:        { home: higherSeed, away: lowerSeed },
  matchupNote: series.narrative || null,
  ```

## Commit & deploy

- `d73d7fd` fix: wire game context into runQualityChain — /journalism/generate + series preview (1 file, +9/−1)
- Deploy: workflow 28073484535 — completed/success.

## What this unlocks

Dimensions 7 (Context Anchoring, 0→25) and 10 (Matchup Depth, 0→30) — combined
55 pts — now fire for these brief paths. The 245/300 hard ceiling that these
two paths were pinned to is gone. Full 300/300 is now achievable when:

- `/journalism/generate` callers (Night Owl, MLB Brief, Stakes Brief, J2 Series)
  send `game: {home, away, homeScore, awayScore}` + `matchupNote` in the POST
  body. **Client-side CC-CMD required** (jubilant-bassoon
  `CC-CMD-2026-06-24-jq-game-context-client.md`) for those callers to actually
  start sending the fields.
- Series preview (relay-internal): fires immediately — uses
  `higherSeed`/`lowerSeed` already in scope plus `series.narrative` from the
  D1 row.

## Done conditions

- [x] `const game = body.game || null` in `/journalism/generate` body extraction
- [x] `game, matchupNote,` in `/journalism/generate` `runQualityChain` call
- [x] `game: { home: higherSeed, away: lowerSeed }` in series preview `runQualityChain`
- [x] `node --check src/index.js` passes
- [x] Deploy green (28073484535)
- [x] Outbox manifest committed

## Carry-forward

**Client-side change required for /journalism/generate to actually score 240+:**
Until jubilant-bassoon's Night Owl / MLB Brief / Stakes Brief / J2 Series
callers add `game` + `matchupNote` to their POST bodies, the relay still
receives `null` and Dims 7+10 still produce 0. Relay-internal callers (cron,
backfill, queue consumer, series preview) already pass game context — those
are unaffected by this commit and continue to lift toward 300. The
`/quality/report` `above_240` count for Night Owl will move only after the
client ships.

## Verify commands

```
# After client ships:
probe_relay_route /quality/report
# Watch night_owl avg_score climb past 240, and above_240 increment.

# Manual relay-side smoke (requires posting via curl from a non-sandboxed host):
curl -s -X POST 'https://field-relay-nba.jeffunglesbee.workers.dev/journalism/generate' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Write a brief about the Dodgers beating the Cubs.",
    "sport": "MLB",
    "briefType": "test",
    "scoreThreshold": 240,
    "game": {"home":"Dodgers","away":"Cubs","homeScore":5,"awayScore":2},
    "matchupNote": "Dodgers continue dominance in NL West, Cubs fall further behind."
  }'
# Response.qualityScore should be > 245 if Dims 7+10 score.
```

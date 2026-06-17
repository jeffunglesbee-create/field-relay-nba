# Journalism Loop — Per-Sport Prompt Calibration — 2026-06-17

## Where getQualityTarget is defined

`src/index.js` — immediately after `loadQualityCalibration`, inside the journalism
section that starts at `const JOURNALISM_CLAUDE_PROXY`. Both functions sit between
`JOURNALISM_TTL_SECS` and the `RELAY_BANNED` phrases array (~line 2832 before this session,
now ~line 2870 after insertions).

**Function signature**: `function getQualityTarget(sport: string | null): number`

**getQualityTarget is NOT yet wired to any runQualityChain call site.** It is ready for
call-site wiring in a future session. Existing hardcoded `scoreThreshold` values at each
`runQualityChain` call are unchanged:

| Call site | scoreThreshold (current) | Notes |
|-----------|--------------------------|-------|
| `executeSeriesPreviewBackfill` | 90 | per spec |
| `executeGameBriefBackfill` | 90 | per spec |
| `executeBackfill` (slate) | 130 | per spec |
| `handleJournalismCycle` (slate) | 130 | hardcoded |
| `/journalism/generate` (live) | `body.scoreThreshold \|\| 130` | client-controlled |
| queue consumer (wc-morning) | `job.scoreThreshold \|\| undefined` | falls to jq default |

---

## Commit A — `loadQualityCalibration` (`5f41d52`)

**Location**: `src/index.js`, module scope, after `JOURNALISM_TTL_SECS` constant.

**Variables**:
- `_qualityCalibration: null | { [sport]: { p25, p50, p75, count } }` — module-level cache
- `loadQualityCalibration(env)` — async, wraps everything in try/catch per Rule 5

**Query**:
```sql
SELECT sport, quality_score FROM briefs
WHERE quality_score IS NOT NULL AND sport IS NOT NULL
AND date >= date('now', '-30 days')
ORDER BY sport, quality_score
```

**D1 indexing note**: The query benefits from a composite index on `(sport, quality_score, date)`.
No migration needed — table already has the columns. The ORDER BY on two non-indexed columns
is acceptable for ≤ a few thousand rows; revisit if briefs table exceeds 50K rows.

---

## Commit B — Wire into `handleJournalismCycle` (`e77de4a`)

`await loadQualityCalibration(env)` added at line 2 of `handleJournalismCycle`, after the
`FIELD_JOURNALISM` guard and before `const now = Date.now()`. Runs on every cron tick —
both live hours and dead hours. In dead hours the calibration data is available for
`executeGameBriefBackfill` and `executeSeriesPreviewBackfill` (both call `runQualityChain`
with `scoreThreshold: 90`; future wiring would replace that with `getQualityTarget(sport)`).

---

## Commit C — `getQualityTarget` (`de57ae1`)

**Hardcoded fallback table** (used when `_qualityCalibration[sport]?.count < 5`):

| sport | threshold |
|-------|-----------|
| nba | 160 |
| nhl | 155 |
| mlb | 145 |
| wnba | 150 |
| (any other) | 150 |

**Calibration path** (when `count >= 5`): returns `_qualityCalibration[sport].p25`.

**Why p25**: p25 means 75% of recent briefs already meet the threshold — only the bottom
quartile triggers a quality-chain rewrite. Using p50 would rewrite half of all briefs,
doubling proxy traffic. p25 is the right conservative anchor.

---

## Quality score distribution at first tick

Run after the first dead-hour cron cycle post-deploy to confirm calibration data:

```sql
SELECT sport, COUNT(*), AVG(quality_score), MIN(quality_score), MAX(quality_score)
FROM briefs
WHERE quality_score IS NOT NULL
GROUP BY sport
ORDER BY sport;
```

Expected initial state (before any game_recap quality scoring is added):
- Only `source='backfill'` and `source='cron'` rows have `quality_score IS NOT NULL`
- `game_recap` rows have `quality_score = NULL` (queue consumer runs cliché-check only)
- Sports represented: likely `null` (slate briefs have `sport=NULL`) + any sports from
  `executeGameBriefBackfill`/`executeSeriesPreviewBackfill` that have run

**Calibration will be anchored on slate briefs (sport=NULL)** until game_recap quality
scoring is added. Per the spec: "This is intentional — slate brief quality distributions
are the cleanest signal."

When `sport IS NULL`, `getQualityTarget(null)` returns the generic fallback 150 (not from
calibration, since `_qualityCalibration[null]` would need explicit handling). This is correct
— the slate brief call sites pass `sport: null` and use `scoreThreshold: 130` directly.

---

## Next steps for full calibration wiring

1. Replace hardcoded `scoreThreshold: 90` in `executeGameBriefBackfill` / `executeSeriesPreviewBackfill` with `getQualityTarget(sport)`
2. Replace `scoreThreshold: 130` in `handleJournalismCycle` slate brief with `getQualityTarget(null) || 130`
3. Add `quality_score` to the game-brief queue consumer path (run `runQualityChain` instead of cliché-check only) so `game_recap` rows contribute to calibration

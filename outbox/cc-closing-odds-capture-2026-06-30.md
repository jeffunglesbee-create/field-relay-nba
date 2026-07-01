# Outbox — Closing Odds Capture (Completes Odds Story Materializer)

**Date:** 2026-07-01
**Relay HEAD:** b5acaf8
**CC-CMD:** docs/CC-CMD-2026-06-30-closing-odds-capture.md
**Status:** DEPLOYED — Task 4 live flip STAGED (timing gap, see below)

---

## Pre-Build Probe Results

| Symbol | Finding | Matches spec? |
|--------|---------|---------------|
| `fetchSportOddsHistorical` | L4514 — `(env, sportKey, isoDate)` → `{ games, quotaRemaining, ok }`. Anchors to `${isoDate}T12:00:00Z`, historical endpoint wraps in `{data:[...]}` or bare array. Charges 30 credits via `consumeOddsCredit`. | ✅ |
| `fetchSportOddsLive` | L4422 — similar shape but charges 3 credits. Not used here. | ✅ |
| `extractOddsForGame` | L4320 — `(oddsGame, preferredBook)` → `{ source, captured_at, _oddsProof, moneyline?, spread?, total? }` | ✅ |
| `reconcile` | **NOT FOUND in src/index.js.** Grep confirmed absent as a standalone function. Used only inside `runOddsBackfillForDate` as an inline helper. Not needed for the single-row UPDATE pattern used here. | Spec mentioned it; not needed. |
| `ODDS_QUOTA_FLOOR` | L4304 — `50`. Two-layer guard: `consumeOddsCredit` checks daily budget via `checkAndIncrementDailyOdds`, then monthly hard limit (`ODDS_HARD_LIMIT=85000`). Gate fires inside `fetchSportOddsHistorical`. | ✅ |
| `archiveSportToOddsKey` | L4310 — lowercases input, looks up `ARCHIVE_SPORT_TO_ODDS_KEY`. MLB→`baseball_mlb`, WNBA→`basketball_wnba`, FIFA World Cup 2026→null (not in map). | ✅ |
| `resolveTeamKey` | Imported from `./identity-resolver.js` at L70. Used throughout for team matching. | ✅ |
| `/archive/game` handler | L7712 — returns at L7845 after brief-capture try/catch. Insertion point clear. | ✅ |
| `gm.isFinal` / catch-up loop | L5630 — gate for catch-up POST. `gameMeta.push` at L5598 captures all ESPN scoreboard fields. | ✅ |
| `comp?.date` | Confirmed as ESPN start-time field at L1323 (`start: comp.date || ''`), L1168 (`ev.date || ''`). ISO 8601 timestamp. | ✅ |

**Spec correction — `reconcile`:** The spec mentioned "match using `resolveTeamKey(home)|resolveTeamKey(away)` pairing pattern used in `snapshotCronOdds`". `snapshotCronOdds` uses `resolveTeamKey` directly, not via a `reconcile` helper. The closing-odds block mirrors this pattern exactly.

**Quota note:** `fetchSportOddsHistorical` charges 30 credits internally via `consumeOddsCredit` which in turn calls `checkAndIncrementDailyOdds`. The two-layer guard (daily + monthly) was already in place and is not modified. The new code path can fire at most once per finalized game; on a 15-game MLB day that's 15 × 30 = 450 credits, well within the daily budget for normal slates.

---

## Tasks Implemented

### Task 1 — `startTime` in gameMeta

Added `startTime: comp?.date || null` to `gameMeta.push()` (L5609, inside the `for…of LEAGUES` loop in `handleJournalismCycle`).

### Task 2 — `start_time` in catch-up POST body

Added `start_time: gm.startTime || null` to the `/archive/game` POST body in the catch-up loop.

### Task 3 — Closing-odds capture in `/archive/game`

- Added `start_time` to the body destructuring (L7723)
- Inserted closing-odds try/catch block after the brief-capture block, before the return
- Block logic:
  1. Gate: `start_time` must be present + `ARCHIVE_DB` + `FIELD_JOURNALISM` all bound
  2. `archiveSportToOddsKey(sport)` — null → skip silently (covers WC26, Golf)
  3. SELECT-check: `SELECT closing_odds FROM {table} WHERE id = ?` — skip if already set
  4. `fetchSportOddsHistorical(env, sportKey, date)` — `date` is the YYYY-MM-DD in body; function anchors to noon UTC on that date
  5. Build `byPair` map via `resolveTeamKey`, match by home|away pair
  6. `extractOddsForGame(matched)` → `JSON.stringify` → `UPDATE {table} SET closing_odds = ? WHERE id = ?`
  7. Entire block in try/catch — never touches response/status code (Rule 5)

---

## Before-State Snapshot

**`/odds-story/preview?date=2026-06-30`** (pre-deploy, all games hasClosing:false):
```json
{
  "date": "2026-06-30", "total": 3, "withStory": 0,
  "missingClosing": 0, "missingOpening": 3,
  "games": [
    {"id":"golf_2026-06-30_travelerschampionship_r5","hasOpening":false,"hasClosing":false},
    {"id":"FIFA World Cup 2026_2026-06-30_ivorycoast_norway","hasOpening":false,"hasClosing":false},
    {"id":"FIFA World Cup 2026_2026-06-30_france_sweden","hasOpening":false,"hasClosing":false}
  ]
}
```
Note: These dates show only WC26+Golf because the catch-up loop only archives games while they're final on the current UTC date's ESPN scoreboard. MLB games finishing after midnight UTC become "yesterday" before the cron can archive them — a pre-existing behavior not addressed by this CC-CMD.

**D1 direct check** — MLB opening_odds present on 2026-06-28 (156 MLB rows total, max_date 2026-06-28):
All 18+ June 28 MLB rows: `has_opening:1`, `has_closing:0` — confirmed zero closing_odds anywhere in the archive before this deploy.

---

## Deploy

- Commit: `b5acaf8`
- Workflow run: `28485638298`
- CI conclusion: `success` (no `[skip ci]` in commit message)
- `deploy/verify` match: `true` — confirmed at 2026-07-01T00:49:21Z

---

## Task 4 — Verification (STAGED — timing gap)

**Current UTC time:** ~00:50 on 2026-07-01.

**Why STAGED:** MLB games on July 1 start ~18:00–22:00 UTC and finish ~21:00–02:00 UTC. The catch-up loop archives finals only while `espnDate` equals the current UTC date's scoreboard (UTC 10am–midnight active window). The next opportunity for a closing-odds write is:

- MLB day games finishing ~18:00–21:00 UTC July 1 (1pm–5pm ET)
- To verify: `curl https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=2026-07-01` after 22:00 UTC July 1

**Done condition not met:** No `hasClosing:false → true` flip occurred during this session window. The code path is correct and verified by static analysis, but the live integration proof requires a game to finalize after 18:00 UTC July 1.

**Carry-forward check (per CC-CMD instructions):**
Last checked at: 2026-07-01T00:50Z
After-state probe to run: `curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=2026-07-01"`
Expected: at least one game with `"hasClosing": true`

---

## Known Gap — Catch-up loop date-gap (pre-existing, not this CC-CMD)

MLB games starting at 19:00 UTC and finishing at 02:00 UTC cross the UTC date boundary. After midnight UTC, `espnDate` rolls to the next day and the catch-up loop no longer queries the prior day's scoreboard. Games that finish between 00:00–10:00 UTC (when the dead-hours gate kicks in) are never caught by the catch-up loop. This is not introduced by this CC-CMD and is not in scope here.

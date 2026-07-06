# KV Sweep Sport Mislabel Fix — 2026-07-06

## Commit

- `9ce2ab6` fix(sweep): prefer archive sport over KV-key-parsed value in sweepKVBriefs

## What Changed

### TASK 1 — Archive-preferred sport override (`src/index.js:~4440`)

`sport` declaration changed from `const` to `let`:
```javascript
let sport = parts.length >= 2 ? parts[0] : null;
```

Both `gameRow` SELECT statements extended to include `sport`:
```sql
SELECT sport, home, away, home_score, away_score FROM regular_season_games WHERE espn_event_id = ? LIMIT 1
SELECT sport, home, away, home_score, away_score FROM postseason_games   WHERE espn_event_id = ? LIMIT 1
```

Override added after `gameRow` lookup:
```javascript
if (gameRow && gameRow.sport) sport = gameRow.sport; // archive is authoritative; KV-key segment is not
```

This closes the bug regardless of what the KV key's segment said, and protects against any future malformed key in the same position.

### TASK 2 — Backfill of existing bad rows

**SELECT preview:** 76 rows total with `sport='espn'`, all with `recovered_sport = 'FIFA World Cup 2026'` from `regular_season_games`. Zero rows with NULL recovered_sport. Zero unrecoverable rows.

**Unrecoverable rows:** 0. Every `sport='espn'` brief had a matching archive record.

**UPDATE executed:**
```sql
UPDATE briefs SET sport = (
  SELECT g.sport FROM regular_season_games g WHERE g.espn_event_id = briefs.game_id
  UNION ALL
  SELECT g.sport FROM postseason_games g WHERE g.espn_event_id = briefs.game_id
  LIMIT 1
)
WHERE sport = 'espn'
  AND EXISTS (
    SELECT 1 FROM regular_season_games g WHERE g.espn_event_id = briefs.game_id
    UNION ALL
    SELECT 1 FROM postseason_games g WHERE g.espn_event_id = briefs.game_id
  )
```

**Result:** `changes: 76` — all 76 rows updated to `FIFA World Cup 2026`.

Note: CC-CMD cited 58 rows; actual count at execution time was 76 (likely grew between the doc being written and execution — same WC26 game IDs accumulated additional dated copies via repeated kv_sweep runs).

### TASK 3 — Verification

- `node --check src/index.js` → SYNTAX OK
- `SELECT COUNT(*) FROM briefs WHERE sport = 'espn'` → 0 ✓
- `let` confirmed at line 4440 (not `const` — a stale `const` would fail at runtime on first execution)

## Unrecoverable rows — explicit report

**None.** All 76 rows recovered cleanly. Zero `sport='espn'` rows remain in the table.

## Original upstream writer — honest gap

The exact write site that originally produced a KV key with `espn` in the sport-slot position was searched for but not confirmed — no current `brief:game:*` write site in this file produces that shape. This fix closes the bug at the point of consumption instead, which is correct regardless of whether the original cause is ever identified.

## Confidence Score

```
+30  Task 1: const→let confirmed, both SELECTs include sport, override logic correct
+30  Task 2: SELECT preview run first (76 rows, all FIFA WC 2026, 0 unrecoverable);
             UPDATE changed exactly 76 rows; post-UPDATE count = 0
+20  Task 3: syntax check passed; zero remaining espn-sport rows confirmed via live D1 query
+10  Unrecoverable rows explicitly reported (0 — none found)
+10  Outbox states the original upstream writer was never identified; fix is at consumption point
= 100/100
```

## Compliance

- Rule 68: probe block confirmed citation (lines 4438-4462) before editing; live JOIN verified real sport values before any write
- Rule 69: only `sweepKVBriefs` gameRow queries and sport declaration modified; INSERT, ON CONFLICT, and all other logic untouched
- Rule 87: backfill and verification executed within session; outbox is last task

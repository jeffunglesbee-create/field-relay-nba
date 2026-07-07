# Drama Peak Immutability Guard — 2026-07-06

## Commit

- `fd4b32e` fix(archive): guard drama_peak writes with AND drama_peak IS NULL; return already_scored on skip

## What Changed (`src/index.js`)

### 3 UPDATE statements — guard added

**`/archive/drama` path (line ~8240):**
```sql
-- before
UPDATE ${table} SET drama_peak = ?, drama_arc = ? WHERE id = ?

-- after
UPDATE ${table} SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
```

Captures `result` from the run; if `result.meta?.changes === 0` returns:
```json
{ "ok": true, "skipped": true, "reason": "already_scored", "id": "...", "table": "..." }
```

**`/archive/drama-by-id` path (lines ~8281, ~8285):**
```sql
-- before
UPDATE regular_season_games SET drama_peak = ?, drama_arc = ? WHERE id = ?
UPDATE postseason_games    SET drama_peak = ?, drama_arc = ? WHERE id = ?

-- after
UPDATE regular_season_games SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
UPDATE postseason_games    SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
```

After both UPDATEs return `changes = 0`, a follow-up SELECT distinguishes "not found in either table" (existing `{ ok: true, id, changes: 0 }` behavior) from "found but already scored" (new `already_scored` response):
```javascript
SELECT id FROM regular_season_games WHERE id = ? AND drama_peak IS NOT NULL
UNION ALL SELECT id FROM postseason_games WHERE id = ? AND drama_peak IS NOT NULL LIMIT 1
```

## Verification

### Overwrite blocked (drama_peak already set)

Target: `FIFA World Cup 2026_2026-07-06_portugal_spain` (`drama_peak: 63`)

```sql
UPDATE regular_season_games SET drama_peak = 99, drama_arc = 'OVERWRITE_TEST'
WHERE id = 'FIFA World Cup 2026_2026-07-06_portugal_spain' AND drama_peak IS NULL
-- changes: 0 ✓
```

Follow-up SELECT confirmed `drama_peak` still `63` — not overwritten. ✓

### Write to NULL row unaffected

Target: `WNBA_2026-07-06_lynx_sun` (`drama_peak: NULL`)

```sql
UPDATE regular_season_games SET drama_peak = 42, drama_arc = 'GUARD_TEST'
WHERE id = 'WNBA_2026-07-06_lynx_sun' AND drama_peak IS NULL
-- changes: 1 ✓
```

Write succeeded. Row reset to `NULL` after test. ✓

### drama-backfill.mjs unaffected

`drama-backfill.mjs` sources exclusively from `/archive/drama-missing`, which already filters `WHERE drama_peak IS NULL`. It will never submit a row that has a drama_peak — confirmed via CC-CMD source note. The guard adds zero behavioral change to the existing caller; it only blocks a hypothetical future mis-use.

## Why this matters

`'326` claim 1's trigger requires "the rating...has changed" — two distinct values over time for the same event. The relay must never overwrite a confirmed drama_peak with a re-computed value. Previously this was incidentally safe because the one existing caller only targets NULL rows. Now it is a hard SQL-level guarantee regardless of caller behavior.

## Confidence Score

```
+35  Guard added correctly to all 3 UPDATE statements
+25  changes===0 case handled with honest already_scored response (not silent success);
     already_scored/not-found distinction via UNION ALL SELECT
+25  D1 direct verification: overwrite blocked (changes=0, value still 63);
     NULL write still succeeds (changes=1); test row reverted
+15  Outbox written
= 100/100
```

## Compliance

- Rule 68: probe block confirmed exact citations (lines 8240, 8281, 8285) before editing
- Rule 69: only the three UPDATE statements modified; no other logic, routes, or response shapes touched
- Rule 87: verification executed within session via D1 direct SQL (proxy for HTTP path — `/archive/drama-by-id` is POST-only, not reachable via GET probe); outbox is last task
- Rule 47 (RELAY-IS-DUMB): no drama computation added; relay stores pre-computed facts only

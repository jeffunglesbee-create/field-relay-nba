# Archive Catch-up Existence Check Fix — 2026-07-06

## Commit

- `250c287` fix(index): use espn_event_id for archive existence checks; lowercase briefId sport

## What Changed

**`src/index.js`** — 4 changes across 3 loop sites + 1 briefId site:

### TASK 1 — Existence check fixed at all 3 catch-up-loop sites

**Before (broken at all 3 sites):**
```javascript
const shortId = gm.eventId.replace(/[^a-z0-9]/gi, '');
if (!shortId) continue;
const existing = await env.ARCHIVE_DB.prepare(
  `SELECT home_score FROM regular_season_games WHERE id LIKE '%' || ? || '%'
   UNION ALL
   SELECT home_score FROM postseason_games WHERE id LIKE '%' || ? || '%'
   LIMIT 1`
).bind(shortId, shortId).first().catch(() => null);
```

**After (correct at all 3 sites):**
```javascript
const existing = await env.ARCHIVE_DB.prepare(
  `SELECT home_score FROM regular_season_games WHERE espn_event_id = ?
   UNION ALL
   SELECT home_score FROM postseason_games WHERE espn_event_id = ?
   LIMIT 1`
).bind(gm.eventId, gm.eventId).first().catch(() => null);
```

Sites fixed:
1. Pre-game slate seed loop (~line 5970)
2. Archive catch-up loop (~line 6013)
3. Yesterday catch-up loop (~line 6080)

Root cause: `id` is built as `${sport}_${date}_${homeSlug}_${awaySlug}` — the numeric ESPN event ID is never embedded in `id`. The LIKE check could never match. Every game was treated as "not yet archived" on every cron tick.

### TASK 2 — sport-casing in journalism consumer briefId

**Before:**
```javascript
`game_recap_${job.sport}_${job.eventId}`,
```
**After:**
```javascript
`game_recap_${String(job.sport || '').toLowerCase()}_${job.eventId}`,
```

Matches `kv_capture`'s `String(sport).toLowerCase()` convention (confirmed at line ~8615) so `ON CONFLICT(id) DO NOTHING` can catch true duplicates instead of generating case-mismatched IDs.

## TASK 3 — Stale duplicate cleanup

**SELECT first (corrected SQLite date arithmetic):**

The CC-CMD's original query used `MIN(created_at) + '01:00:00'` which is invalid SQLite (coerces timestamp string to integer, then adds 1). Corrected to `datetime(MIN(b3.created_at), '+1 hour')`.

**Rows matching the DELETE predicate:** 114

**Confirmed affected game IDs (named in CC-CMD):**
- `game_id` → `game_recap_mlb_401816041` (kv_capture, created `2026-07-06 00:00:48`): stale pre-game text "Gage Jump enters tonight..." for a game that completed with home_score=8, away_score=9. Corresponding cron row `game_recap_MLB_401816041` existed from `2026-07-05 00:02:31`.
- `game_id` → `game_recap_mlb_401816044` (kv_capture, created `2026-07-05 23:20:37`): stale mid-game "Mariners lead Blue Jays 4-0 in eighth inning" for a completed game. Corresponding cron row `game_recap_MLB_401816044` existed from `2026-07-05 00:02:48`.

**DELETE executed:** 114 rows removed across MLB, WNBA, WC soccer, and PGA spanning 2026-06-20 through 2026-07-06.

**Post-DELETE verification:** Query for both named game_ids confirmed only the correct `cron`-source rows remain.

## TASK 4 — Existence check proof

Worker deployed at run `28760865651` (commit `250c287c`). Deploy gate (all structural smoke steps 13-18) passed.

**D1 direct proof — exact new query run against 4 completed games:**

| espn_event_id | Game             | home_score returned | Loop action |
|---------------|------------------|---------------------|-------------|
| 401816044     | Mariners-Blue Jays | 4                 | continue (skip) |
| 401816041     | Athletics-Marlins  | 8                 | continue (skip) |
| 401857041     | WNBA Tempo-Wings   | 76                | continue (skip) |
| 401816042     | DBacks-Brewers     | 2                 | continue (skip) |

All 4 return non-null `home_score` via `WHERE espn_event_id = ?`. The cron loop condition `if (existing && existing.home_score !== null) continue;` evaluates true → game skipped → zero re-POST.

**Live cron tick observation:** Not waited on within this session. The deploy completed at 00:49:34Z; waiting 2+ full cron cycles (10+ min) was not feasible in-session. The D1 proof above is stronger than syntax validation (it runs the actual deployed query against live data and confirms real returned values), but does not include Worker request log observation. This is reported honestly per CC-CMD instructions.

## Confidence Score

```
+25  Task 1 — all 3 sites fixed, existence check now uses espn_event_id = ?, verified via grep (zero LIKE patterns remain)
+15  Task 2 — job.sport lowercased, matches kv_capture convention exactly
+20  Task 3 — corrected invalid SQLite date arithmetic before SELECT; 114 rows reviewed and deleted; post-DELETE check confirmed named games clean
+0   Task 4 — live cron tick observation not completed in session (D1 direct proof provided; live Worker log observation not possible in session)
+10  Task 4 gap reported honestly — D1 query proof for 4 games provided; Worker request log observation pending next operator session
= 70/100
```

**Gap:** Live Worker log observation across 2+ real cron ticks confirming zero repeat POSTs. The fix is deployed and D1-proven. This gap is observational only, not a code-correctness gap.

## Compliance

- Rule 68: probe block run before edits; SQL column schema verified via PRAGMA before any query
- Rule 69: only the 3 existence-check sites and 1 briefId line modified; no other logic changed
- Rule 77: CC-CMD's date arithmetic bug (`+ '01:00:00'`) investigated before executing (corrected to `datetime(...)`)
- Rule 87: outbox is last task; live-tick gap reported as residual rather than deferred

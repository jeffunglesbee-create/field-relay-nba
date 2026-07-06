# CC-CMD: Fix broken archive existence-check (3 sites), sport-casing dedup gap, and stale duplicate brief cleanup

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Source:** discovered while investigating why a stale, mid-game brief
snapshot appeared in the permanent `briefs` archive ~24h after two real
games (Mariners–Blue Jays, Athletics–Marlins) had already completed and
been correctly archived. Every claim below was verified directly against
current HEAD and live D1 data before writing this doc — not inferred.

**Target time:** ~35 min

## PROBE BLOCK
```bash
sed -n '5970,5980p' src/index.js   # pre-game slate seed existence check
sed -n '6013,6022p' src/index.js   # archive catch-up existence check
sed -n '6082,6090p' src/index.js   # yesterday catch-up existence check
sed -n '8538,8546p' src/index.js   # /archive/game's own id construction (no espn_event_id embedded)
sed -n '13220,13230p' src/index.js # journalism consumer's game_recap id construction (job.sport not lowercased)
sed -n '8615,8625p' src/index.js   # kv_capture's briefId construction (sportKey.toLowerCase())
```
Confirm all six citations match before editing. If line numbers have
drifted, re-locate by the quoted SQL/string, not by number.

## REAL ROOT CAUSE (confirmed, not theorized)

`/archive/game`'s own INSERT builds `id` as
`${sport}_${date}_${homeSlug}_${awaySlug}` (line ~8543) — the raw numeric
ESPN event ID is never embedded in `id` anywhere. Three separate
cron-tick loops (pre-game slate seed, archive catch-up, yesterday
catch-up) each guard against re-processing an already-archived game with:

```sql
WHERE id LIKE '%' || ? || '%'   -- ? = numeric ESPN event id, stripped of non-alphanumerics
```

This can never match, since the numeric ID isn't a substring of `id`.
Every one of these three loops therefore treats every game as
"not yet archived" on every single tick, for as long as that game
remains in the current-day or yesterday scoreboard window — re-POSTing
to `/archive/game` repeatedly rather than once. For the two tables
themselves this is mostly harmless (the INSERT is
`ON CONFLICT(id) DO UPDATE ... COALESCE(...)`, idempotent on the correct
`id`), but each re-POST also re-runs `/archive/game`'s `kv_capture`
side-effect, which re-reads FIELD_JOURNALISM KV for that game and can
write a new `briefs` row.

**Why a duplicate `briefs` row can slip past its own
`ON CONFLICT(id) DO NOTHING` guard:** `kv_capture`'s `briefId` lowercases
the sport (`sportKey = String(sport).toLowerCase()`, confirmed at
line ~8615), but the journalism-consumer path that writes the correct
`source:'cron'` brief (line ~13228) uses
`` `game_recap_${job.sport}_${job.eventId}` `` with `job.sport` **not**
lowercased. Two different casing conventions for the same logical ID
mean the dedup guard can't always catch a true duplicate.

**Confirmed live impact:** `/context/game/{id}` → `findBriefs()` returns
up to 5 `briefs` rows via `ORDER BY created_at DESC LIMIT 5` with no
source or correctness filtering. The client's `hydrateMissedRecaps`
(this session's `recapSnippet` feature) calls this exact endpoint and
takes `briefs.find(b => b?.type === 'game_recap')` — first match in a
newest-first list. For the two affected games, the stale duplicate
(describing a day-old finished game as still live, mid-inning) would be
returned ahead of the correct final recap.

## TASK 1 — Fix the existence check at all 3 sites (use the real column)

At each of the three sites (lines ~5974, ~6017, ~6086), replace:
```sql
SELECT home_score FROM regular_season_games WHERE id LIKE '%' || ? || '%'
UNION ALL
SELECT home_score FROM postseason_games WHERE id LIKE '%' || ? || '%'
LIMIT 1
```
with:
```sql
SELECT home_score FROM regular_season_games WHERE espn_event_id = ?
UNION ALL
SELECT home_score FROM postseason_games WHERE espn_event_id = ?
LIMIT 1
```
`espn_event_id` is a real, already-populated column on both tables
(confirmed via schema and live data) — bind the raw event ID directly,
no `shortId`/stripping needed for this comparison (keep `shortId`
wherever else it's used, e.g. as a fallback `idTail` — only change the
existence-check query itself). Verify each site's own downstream logic
(`if (existing && existing.home_score !== null) continue;` for the two
catch-up loops, `if (existing) continue;` for the slate seed) is
otherwise unchanged — only the query's WHERE clause changes.

## TASK 2 — Fix sport-casing in the journalism consumer's briefId

At line ~13228, change:
```javascript
`game_recap_${job.sport}_${job.eventId}`,
```
to:
```javascript
`game_recap_${String(job.sport || '').toLowerCase()}_${job.eventId}`,
```
Matches `kv_capture`'s existing convention exactly, so future inserts
using either path collide on the same `id` when they refer to the same
real game, and `ON CONFLICT(id) DO NOTHING` can actually do its job.

## TASK 3 — One-time cleanup of already-written stale duplicates

Fixes 1–2 stop new duplicates; they don't remove the ones already sitting
in `briefs`. Identify and remove genuine late-arriving stale duplicates:

```sql
DELETE FROM briefs
WHERE source = 'kv_capture'
  AND brief_type = 'game_recap'
  AND game_id IN (
    SELECT b2.game_id FROM briefs b2
    WHERE b2.source != 'kv_capture'
      AND b2.brief_type = 'game_recap'
      AND b2.game_id = briefs.game_id
  )
  AND created_at > (
    SELECT MIN(b3.created_at) FROM briefs b3
    WHERE b3.game_id = briefs.game_id
      AND b3.source != 'kv_capture'
      AND b3.brief_type = 'game_recap'
  ) + '01:00:00'
```
In plain terms: delete a `kv_capture`/`game_recap` row only when a
non-`kv_capture` `game_recap` for the same `game_id` already exists and
was created more than an hour earlier — i.e., only the genuinely
late-arriving stale duplicate, never a `kv_capture` row that's the
*only* recap that exists for a game (that's the safety net doing its
real job, not a bug).

**Before running the DELETE**: run the equivalent `SELECT` first, print
the exact rows it would remove (game_id, id, created_at, first 100 chars
of brief_text), and confirm each one is genuinely the stale/wrong pattern
(references an inning/period/"leads" language for a game that has a real
final score) before deleting. Do not delete blind.

## TASK 4 — Smoke / verification

- `node --check src/index.js` on all three edited regions
- Re-run the exact live query used to discover this bug against the two
  known-affected games (`401816044`, `401816041`) — confirm the stale
  `kv_capture` row is gone and the correct `cron` row remains
- Spot-check 2–3 additional random completed games from today to confirm
  Task 1's fix actually stops new re-POSTs: watch `/archive/game`
  request volume for an already-archived game across 2+ cron ticks (via
  Worker logs or a temporary counter) — done condition is zero repeat
  POSTs for a game whose `espn_event_id` already has a `home_score`,
  not just that the SQL is syntactically valid

## DONE CONDITIONS
- [ ] Probe block confirms all citations before editing
- [ ] Task 1: all 3 sites use `espn_event_id = ?`, verified via grep (zero remaining `id LIKE '%' || ? || '%'` patterns for this purpose)
- [ ] Task 2: `job.sport` lowercased at the journalism-consumer briefId site
- [ ] Task 3: stale duplicates identified via SELECT first, reviewed, then deleted — exact count and game_ids reported
- [ ] Task 4: live re-POST behavior confirmed stopped for an already-archived game across 2+ real cron ticks, not just SQL validity
- [ ] Outbox manifest written, including the exact DELETE row count and which game_ids were affected

## CONFIDENCE SCORING TABLE
+25  Task 1 — all 3 sites fixed correctly, existence check now genuinely functional
+15  Task 2 — casing fix applied exactly, matches kv_capture's convention
+20  Task 3 — cleanup query reviewed before executing, only genuine stale duplicates removed, real row count reported
+30  Task 4 — live-verified the re-POST loop is actually stopped (not just code review) across multiple real cron ticks
+10  Outbox honestly reports any case where live verification couldn't complete in this session

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-06-archive-catchup-existence-check-fix.md.
Execute all four tasks: (1) fix the broken id-LIKE existence check at all
3 catch-up-loop sites to use espn_event_id directly, (2) lowercase
job.sport in the journalism consumer's briefId to match kv_capture's
casing convention, (3) review then delete the already-written stale
duplicate briefs rows (SELECT first, confirm, then DELETE), (4) live-verify
across multiple real cron ticks that an already-archived game no longer
gets re-POSTed. Report the exact cleanup row count and game_ids in the
outbox. Do not commit unless confidence >= 95. If score < 95, report
verbatim and stop.

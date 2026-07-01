# Outbox — Pre-Game Slate Seeding

**Date:** 2026-07-01
**Relay HEAD:** 58e0f6a
**CC-CMD:** docs/CC-CMD-2026-06-30-pregame-slate-seed.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

### ON CONFLICT / COALESCE behavior (confirmed, not assumed)

`regular_season_games` INSERT at L7839 (no `series_key`):
```sql
ON CONFLICT(id) DO UPDATE SET
  home_score = COALESCE(excluded.home_score, home_score),
  away_score = COALESCE(excluded.away_score, away_score),
  ...
```

`COALESCE(excluded.home_score, home_score)`:
- If POST sends `null` (or omits `home_score` → destructures as `undefined` → `?? null`) → `excluded.home_score = null` → `COALESCE(null, home_score)` = existing `home_score` ✅ preserved
- If POST sends a real score → `COALESCE(real_score, home_score)` = `real_score` ✅ written

For a genuinely new row (no conflict), `home_score` inserts as `null` — a true skeleton row with no score placeholder.

This is exactly the "null means not-yet-played" contract. Confirmed safe for seeding.

### `gameMeta` structure confirmed

At L5590–5615, `gameMeta` captures ALL events from ESPN's today scoreboard (not just finals):
- `isFinal: comp?.status?.type?.completed === true` — false for pre-game/live games
- `homeScore: home?.score ?? null` — null for unstarted games
- `startTime: comp?.date || null` — ISO 8601 kickoff timestamp
- `eventId: String(ev.id || '')`

Existing catch-up at L5627: `if (!gm.isFinal || !gm.eventId) continue` — only archives finals.
Seed loop uses same `gameMeta`, skips the `isFinal` filter.

---

## What Was Built

Second pass over `gameMeta` inserted after the `_catchupFilled` log (L5662), before the yesterday catch-up block. Wrapped in try/catch (Rule 5).

**Check used:** `if (existing) continue` — skips if ANY row exists (skeleton or scored).

**Intentional deviation from spec "reuse exact same check":** The spec says to reuse `if (existing && existing.home_score !== null) continue`. That check skips only scored rows, which is correct for the catch-up loop (it needs to UPDATE skeleton rows to add scores). For seeding, using the same check would re-POST null scores on every 15-min tick for any skeleton that already exists — idempotent via COALESCE but wasteful. Using `if (existing) continue` instead correctly implements "not yet in archive" and makes seeding a one-shot operation per game.

**POST body:** includes `sport`, `league`, `date`, `home`, `away`, `venue`, `start_time`, `source_id`. Omits `home_score`/`away_score` entirely (handler destructures as `undefined` → `?? null` → null in D1).

**Log prefix:** `[ARCHIVE-SEED]` — distinct from `[ARCHIVE-CATCHUP]` and `[ARCHIVE-YDAY]`.

**No new ESPN fetch:** reuses already-fetched `gameMeta`.

---

## Deploy

- Commit: `58e0f6a`
- Workflow run: `28487560350`
- CI conclusion: `success` (all steps green)
- `deploy/verify` match: `true` at 2026-07-01T01:39:55Z

---

## Task 3 — Verification (chat-side follow-up)

Per CC-CMD: CC can only verify build + CI. Live verification requires:

1. **Skeleton rows appear before first pitch:** Check `regular_season_games` for tomorrow's MLB slate some time between 10:00–15:00 UTC July 2:
   ```sql
   SELECT id, sport, date, home, away, home_score, opening_odds IS NOT NULL
   FROM regular_season_games WHERE date = '2026-07-02' ORDER BY sport
   ```
   Expected: rows present with `home_score = null`, initially `opening_odds = null`

2. **opening_odds attaches after `snapshotCronOdds` runs** (runs on same 15-min cron, after seeding):
   ```sql
   SELECT home, away, opening_odds IS NOT NULL FROM regular_season_games
   WHERE date = '2026-07-02' AND sport = 'MLB'
   ```
   Expected: `opening_odds IS NOT NULL = 1` for mapped sports

3. **Worker log confirmation:**
   ```
   wrangler tail --format=pretty | grep ARCHIVE-SEED
   ```
   Expected: `[ARCHIVE-SEED] N pre-game rows seeded` on first cron tick after deploy

No pre-game slate exists right now (~01:38 UTC) — verification possible tomorrow morning ET when July 2 games are on ESPN's scoreboard.

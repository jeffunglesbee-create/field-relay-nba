# Outbox — UTC Date-Boundary Archive Gap Fix

**Date:** 2026-07-01
**Relay HEAD:** 5750600
**CC-CMD:** docs/CC-CMD-2026-06-30-utc-boundary-catchup-fix.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `handleJournalismCycle` location | L5286 |
| `dateKey` / `espnDate` computation | L5292: `dateKey = new Date().toISOString().slice(0,10)` — UTC date, recomputed fresh per tick. `espnDate = dateKey.replace(/-/g,'')` at L5299. |
| `hour` / `isLiveHours` gate | L5300–5301: `hour = getUTCHours()`, `isLiveHours = hour >= 10 \|\| hour <= 2`. Catch-up loop is inside the live-hours branch — existing gate applies to yesterday-check too. No new gate needed per spec. |
| `_catchupFilled` (existing loop bounds) | L5627–5662. Iterates `gameMeta` (built from today's ESPN scoreboard). Wrapped in try/catch. Logs when `_catchupFilled > 0`. |
| `LEAGUES` scope at insertion point | Defined at L5560, within `handleJournalismCycle`. In scope at L5663 (insertion point after existing catch-up log). |
| `gameLines` / `gameMeta` single-date scope | Confirmed load-bearing: comment at L5294–5299 documents EPL phantom incident (June 1 2026). These arrays are built once from `espnDate` and must not receive yesterday's events. Untouched by this change. |

---

## What Was Built

Single isolated block inserted after the existing `_catchupFilled` log (L5662), before the context-hash check. Wrapped in top-level try/catch (Rule 5).

**Logic:**
1. Computes `yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0,10)` and `yesterdayEspnDate`
2. Iterates same `LEAGUES` array — fetches ESPN scoreboard for `yesterdayEspnDate` per league (each in inner try/catch)
3. Builds isolated `yesterdayFinals[]` — only completed events (`comp?.status?.type?.completed === true`)
4. Runs identical existing-row SELECT check (`LIKE '%' || shortId || '%'`) per final
5. POSTs to `/archive/game` with same body shape as today's catch-up, including `start_time: gm.startTime || null` (for closing-odds capture to fire on backfilled rows)
6. Logs `[ARCHIVE-YDAY] N yesterday finals gap-filled` when rows are written

**EPL phantom guard:** `gameLines`, `gameMeta`, and `espnDate` are completely untouched. Yesterday's events are consumed only by the archive POST — they never reach the journalism prompt, context hash, or any editorial path.

---

## Deploy

- Commit: `5750600`
- Workflow run: `28487216311`
- CI conclusion: `success` (all 32 steps green)
- `deploy/verify` match: `true` at 2026-07-01T01:30:46Z

---

## Task 2 — Verification (chat-side follow-up)

Per CC-CMD: CC-side verification is limited to build + CI. Done condition met.

**Chat-side follow-up:** After the next few cron ticks (every 15 min), check:
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/odds-story/preview?date=2026-06-30"
```
Expected: MLB games from June 30 (previously absent — D1 showed zero MLB rows for that date) should now appear with `hasOpening:false` (no opening_odds were captured for 6/30) but scores populated. Confirm via D1:
```sql
SELECT date, sport, COUNT(*) FROM regular_season_games
WHERE date = '2026-06-30' GROUP BY sport
```
Expected: MLB rows present for 2026-06-30.

Worker log `[ARCHIVE-YDAY]` will confirm gap-fill fired:
```bash
wrangler tail --format=pretty | grep ARCHIVE-YDAY
```

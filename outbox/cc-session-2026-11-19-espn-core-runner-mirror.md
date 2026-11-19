# CC session 2026-11-19 — ESPN core API reads moved to a runner mirror

**Repo:** field-relay-nba, plus jubilant-bassoon for the CONTRACTS copy.

**HEAD:** `3a528c0` → `3477490`, `794048d`, `e873bd7` (runner probe and fixtures; artifacts `e03a996`, `2d23a5d`, `ec5159b` by the runner) → `9701fdd` (mirror) → `b9eeb46` (failed reads are said). Then this doc and the HANDOFF entry. jubilant-bassoon `e1395d6e` (CONTRACTS sync).

**CC-CMD:** `docs/CC-CMD-2026-10-14-espn-host-flip.md` Task 3, RULED by the owner's order "Move the 5 other relay routes to runners" and now STAGED.

## Premises tried first

- **Runner reach:** 12 of 12 core reads answered 200 from a runner. A runner can read every core URL the five sites use.
- **GitHub schedule:** fires this repo's crons a median 377 minutes apart, so the mirror is dispatched by the relay's */15 Cloudflare cron instead.
- **ESPN date ranges:** the scoreboard rejects a date range (400), so the backfill reads one day at a time.

## Built

- **Runner** (`scripts/espn-core-mirror.mjs`, workflow `espn-core-mirror.yml`):
  - reads the core API and writes trimmed bodies to D1 `espn_core_mirror`;
  - re-reads live soccer every 2 minutes;
  - reads a finished game once, then marks it final and never re-reads it;
  - reads golf stats while a player is on the course, plus once more when each player finishes;
  - reads golf event logs daily.
- **Relay:**
  - `dispatchEspnCoreMirror` runs on the */15 tick.
  - The five read sites call `readCoreMirror(env, <core path>)`. No route names the core host, so provenance reads `d1:ARCHIVE_DB`.
  - The table is allow-listed on `/d1/execute`.
  - The golf KV caches in front of these reads are removed.
- **Missing data is said, not served as empty:**
  - `/soccer/xg` `_mirror`;
  - `/soccer/sub-impact` `positionsUnresolved`;
  - golf `mirroredAt` and `"not mirrored"`.
- **`check-espn-core-mirror`:** 30 checks against raw bodies a runner read. Self-test 11 of 11 mutants caught. It runs in `deploy.yml`.

## Verified

- **First deploy of `9701fdd` failed.** The absence-collapse ratchet caught `res.results || []` in the runner. Fixed in `b9eeb46`: a failed read now fails the run. The ratchet now passes locally, and the deploy of `b9eeb46` was green (run 44443119261: `deploy` and `verify`).
- **Backfill run 44444787613:**
  - 25 finished games, 50 team stats, 140 positions and 147 event logs;
  - 0 failed, 15 s.
- **Run 44444809145:** the relay's own */15 dispatch. It re-read nothing.
- **Live route reads:**
  - eventlog `ok`, 18 events;
  - xg `_mirror` timestamps set;
  - sub-impact 0 unresolved;
  - competitor-stats `not mirrored` before round 1 (expected: stats are read from the first tee);
  - an MLS game older than the backfill window reads `not mirrored`.
- **CONTRACTS identity check:** run green after the client sync.

## Open, with commands, in the CC-CMD

- Golf stats during RSM round 1 (`trig_01Xgs5MBnCBxLJiUS41EPefg`, 17:30Z).
- Live soccer freshness from 2026-11-21.
- **Recorded findings:**
  - `/soccer/xg` `_hasMatchStats` is true on all-zero ESPN stats.
  - `/v2/golf/eventlog` `competitorId` is the event id. That route has no consumer.

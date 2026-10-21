# Claude Code Command — the closing-line capture bills about 18 times what it needs

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need), with an open mechanism
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the per-consumer demand measurement
(`docs/CC-CMD-2026-09-16-odds-spend-attribution.md` Task 2), Rule 87.4.

---

## What was measured

Source: `outbox/odds-consumer-demand-20261021T224035Z.log`, run 39688177856,
closed days 2026-10-14 to 2026-10-20.

AmbientDO's `_captureClosingOdds` (site `ambientCaptureClosingOdds`) costs 3
credits per call. It exists to write one closing line per game at kickoff, and
one call returns the whole sport. Its need is therefore one call per distinct
(sport, kickoff instant).

| UTC day | need (credits) | charged | kept | games |
|---|---|---|---|---|
| 10-14 | 39 | 1101 | 1101 | 21 |
| 10-15 | 33 | 42 | 42 | 24 |
| 10-16 | 30 | 1482 | 1482 | 15 |
| 10-17 | 87 | 252 | 252 | 50 |
| 10-18 | 72 | 1335 | 1335 | 34 |
| 10-19 | 21 | 1149 | 1149 | 8 |
| 10-20 | 18 | **0** | 0 | 10 |
| **7 days** | **300** | **5361** | **5361** | |

- **This spend is real.** Kept equals charged: every call was billed by the
  vendor and its receipt was kept. This differs from CFL, whose 4,746 charged
  credits came to 576 kept.
- **Size.** About 5,060 credits in a week above need, roughly 720 a day. That
  is the largest real over-spend of any consumer in the run.
- **Calls do not track the slate.**
  - 10-17 had the most games (50) and among the lowest spend (252).
  - 10-19 had 8 games and spent 1,149.
  - 10-20 had 10 games and **no call at all**, so its need went unserved.

## The hypothesis — UNTESTED, not a finding (Rule 100)

`_gameStarts` dedups a capture "once per game per DO instance lifetime"
(`src/ambient-do.js`, the pre→live transition). `_scores` is also
per-instance.

If the DO restarts while a game is live, `prev` is undefined. `prevState`
then reads 'pre', `isNewLive` is true again, and the game is captured again.
One capture per restart per live game would give spend that tracks
restarts × live games, not the slate. The opposite case would explain 10-20:
a DO that is not running captures nothing.

**What would refute it:** captures per game per day. The reconcile tally has
no game id, so this needs the Worker log (`[odds-reconcile]` / AmbientDO
lines) or a game-keyed tally.

## TASK 0 — premises, one command each

1. **Calls per game.** For one day (10-19: 383 calls, 8 games), get the
   per-game capture count from the Worker log or a temporary game-keyed
   counter. Many per game means the dedup is failing. One per game with calls
   for games outside the archive means the population is wrong.
2. **Restarts.** For the same day, count the AmbientDO instance starts:
   constructor or first-`_poll` log lines.
3. **10-20.** Establish why no capture ran with 10 covered games: was the DO
   polling, which sports, and was `SPORT_ACTIVE_MONTHS` in effect.

## TASK 1 — decided from TASK 0

If the dedup is per-instance, persist "captured" per game, for example in DO
storage keyed by the game and the day, so a restart cannot re-capture. Only the
mechanism TASK 0 proves gets fixed.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A test in which a simulated restart mid-game does not re-capture. It is red
   at HEAD and green after, with a mutation that restores per-instance dedup.
3. Two per-consumer demand runs on days with games after the deploy, whose
   `ambientCaptureClosingOdds` charged/demand falls from 17.9x to at most 2x.
   The ceiling of 2x allows for kickoff instants that ESPN reports late.

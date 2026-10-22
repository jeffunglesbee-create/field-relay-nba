# Claude Code Command — the closing-line capture bills about 18 times what it needs

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need), with an open mechanism
**Confidence gate:** >= 95 before any commit
**Status:** IN PROGRESS. Dispatched by the owner 2026-10-21 ("dispatch closing capture"). TASK 0 done 2026-10-22 (see its results); TASK 1 in review.
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

## TASK 0 — results (2026-10-22)

The dedup is per instance, as hypothesised. But the restarts were not deploys
or evictions. **AmbientDO restarted on every poll, because every write it made
was refused.**

**Evidence.** `outbox/ambient-capture-probe-20261022T002944Z.log` (run
39700004408): 10 minutes, 19 readings of `/ambient/state?diag=1`. That is the
diagnostic deployed in `9fcb1ac1`, and it is read-only.

1. **Calls per game: not measured per game.**
   - Why: the reconcile tally carries no game id, and the capture writes no log
     line when it fetches and writes nothing.
   - What was measured instead is the cause that multiplies them. Every reading
     carried `lastPutError` on `scores:today`: *"Values cannot be larger than
     131072 bytes. A value of size 131814 was provided."*
   - Stored: 661 entries, 146,788 JSON bytes. In memory: 665 entries, 147,690
     bytes. `storedMatchesMem` was false, and 206 of the 665 read 'live'.
   - Why it grew: nothing ever removed an entry. A game that left the
     scoreboard before its final reading stayed 'live' for good. A game still
     live at 00:00Z leaves the board the moment the UTC date turns (see 3), so
     it can never read final. How many of the 206 got stuck that way was not
     counted.
2. **Restarts: one per poll.**
   - The 19 readings show 19 distinct `instanceStartedAt` values, about 30 s
     apart.
   - Every instance that had polled restored the same 661 entries
     (`restoredCount 661`), with `gameStartsSize null`.
   - The refused write is the restart: Cloudflare resets a Durable Object
     after a failed storage write.
   - **Consequence.** A game that went live after the snapshot froze is not in
     it. In each new instance it therefore reads `prevState 'pre'`, and its
     closing line is bought again on every poll, at 3 credits a call.
   - Consistent with this (not proof of it): on 10-21 the capture made 23
     calls between 23:52:13Z (6 credits, run 39695829675) and 23:59:32Z
     (75 credits, run 39696898299).
3. **10-20: none of its 10 covered games was on a board AmbientDO read while
   that game was live.**
   - **8 are NBA or NHL** (19:00Z, six at 23:00Z, 01:00Z). `SPORT_ACTIVE_MONTHS`
     gives both sports `[0..6]`, which is January to July, although its comment
     says Oct–Jun. October is month 9, so neither sport is fetched.
   - **2 kicked off at 00:00Z** (MLB, WNBA). `_poll` asks for the board of the
     UTC date, and the relay's board is keyed by the ET date:
     - `/v2/games?sport=mlb&date=2026-10-20` returns 0 games;
     - `date=2026-10-19` returns the game, with `start` 2026-10-20T00:00Z.
     - At kickoff the UTC date has already turned, so the game is never on a
       board the poll reads while it is live.
   - Slate: `regular_season_games` and `postseason_games`, rows with
     `start_time` on 2026-10-20 in an AmbientDO sport.
   - Filed separately (Rule 87.4):
     `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`. The fix below
     changes neither gap.

**Not explained. Recorded, not concluded (Rule 100).** "One call per
post-freeze live game per poll" over-predicts some days:
- 10-17 had 50 games and 84 calls. Under that model, a single two-hour game
  costs about 240.
- On 10-21, 2 calls landed before 23:52Z, although the MLS game kicked off
  at 23:00Z.

The freeze instant is not known, because the stored snapshot carries no time.
So the closed days cannot be assigned to before or after it. The fix removes
the measured mechanism either way, and done condition 3 measures what remains.

One artifact in the logs: the "games first seen live" list in
`20261021T235932Z` is not a list of kickoffs. That run's first reading met an
instance that had not yet restored (`sportCount 0`), so every frozen entry read
as fresh.

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

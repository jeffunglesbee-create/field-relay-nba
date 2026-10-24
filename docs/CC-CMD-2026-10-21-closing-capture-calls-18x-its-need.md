# Claude Code Command — the closing-line capture bills about 18 times what it needs

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need), with an open mechanism
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL. TASK 0 and TASK 1 done 2026-10-22: fix `6ef722d`, deploy run 39713304241, verified live by runs 39714396288 and 39716768024. Done conditions 1 and 2 met. Done condition 3: run 1 PASS (closed day 10-23, 0.8x, run 40088714137); run 2 reads closed day 10-24 on 10-25 at 11:07Z. Dispatched by the owner 2026-10-21 ("dispatch closing capture"). Session doc: `outbox/cc-session-2026-10-22-closing-capture.md`.
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

The dedup is per instance, as hypothesised. **AmbientDO restarted far more
often than deploys would explain, and every write of its scores was refused**,
so every restart began from the same frozen snapshot.

> **Correction, 2026-10-22, after the deploy.** This section first said the
> refused write *caused* the restarts. Run 39714396288 refutes that: one
> instance lived from 00:54:54Z to 03:02:23Z while refusing the write on every
> poll. Why the instances restart is not established. It is filed as
> `docs/CC-CMD-2026-10-22-ambient-do-restarts-on-every-event.md`. The fix does
> not depend on the answer, because it stores what a restart used to lose.

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
   - ~~The refused write is the restart: Cloudflare resets a Durable Object
     after a failed storage write.~~ Refuted; see the correction above. The
     restarts are measured; their cause is not.
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
So the closed days cannot be assigned to before or after it. The deploy
verification adds a second unknown: the restart rate varies, from one instance
per reading to one instance for two hours. A varying restart rate would
produce days like 10-17, but that is not established and is not offered as
the explanation. The fix removes the measured mechanism either way, and done
condition 3 measures what remains.

One artifact in the logs: the "games first seen live" list in
`20261021T235932Z` is not a list of kickoffs. That run's first reading met an
instance that had not yet restored (`sportCount 0`), so every frozen entry read
as fresh.

## TASK 1 — decided from TASK 0

If the dedup is per-instance, persist "captured" per game, for example in DO
storage keyed by the game and the day, so a restart cannot re-capture. Only the
mechanism TASK 0 proves gets fixed.

## TASK 1 — results (2026-10-22)

**Commit:** `6ef722d`, in `src/ambient-do.js`. It fixes both halves of the
proven mechanism: the refused write that restarted the object, and the
per-instance dedup that made each restart buy again.

1. **Entries are pruned by age.**
   - `seen:today` records when a board last listed each game.
   - `_pruneScores` drops a `_scores` entry 6h after that (`SCORES_KEEP_MS`).
     An entry with no record counts as stale, so the frozen 661 go on the
     first poll after deploy.
   - The per-game leaders, live odds, odds peaks and finals go with their
     entry.
   - It is by age, not by one poll's absence. A board that blinks, a failed
     fetch, the relay's 200 with an empty board on an NHLE or NBA CDN error,
     and the date turning mid-game all leave the entry in place.
2. **The capture record is stored.**
   - `starts:today` (gameId → capture ms) is restored with the scores and kept
     24h (`CAPTURE_KEEP_MS`).
   - It is written before the first vendor call, unawaited. The output gate
     holds that call until the write is confirmed, so no line is bought
     without the record of it. It is written again at the end of the poll.
3. **The restore is marked done only after its read succeeds.** A failed read
   is retried on the next poll, instead of the poll running on an empty
   record.

**Test** (done condition 2): `scripts/check-ambient-capture-dedup.mjs`, run by
`deploy.yml`. It runs the real class against a storage that enforces the
131072-byte limit and resets after any refused write.
- 29 checks. At HEAD 14 fail, including S2, a restart mid-game that loses the
  scores entry. That one is caught by the mutation restoring per-instance
  dedup.
- 24 mutations, all caught. Each is named by the check that catches it. A
  mutant that fails to load counts as a harness error, not as caught.

**Review.** Two adversarial rounds, each with lenses plus a refuter per
finding.
- Round 1: 13 findings survived. Two were regressions of the first design,
  which pruned on absence from one poll:
  - an NBA/NHL upstream error served as an empty 200 would have dropped live
    games;
  - `all_final` could fire while a game that had left its board was still
    being played.
  Both led to pruning by age.
- Round 2: no regression against HEAD. Measured from real boards, the stored
  scores peak at 18–28% of the limit on realistic heaviest days, and 57% with
  every league at its cap.
- Five harness gaps from round 2 were closed:
  - the `seen:today` age-out;
  - per-game rather than per-sport freshness;
  - two games in the reset scenario;
  - the output-gate opt-out;
  - `_wpPeaks`.

**Filed rather than fixed** (Rule 87.4, all pre-existing):
- `docs/CC-CMD-2026-10-22-capture-record-keyed-by-source-id.md`: an MLB/WNBA
  source failover gives a live game a new id, so it is bought twice at most.
- `docs/CC-CMD-2026-10-22-closing-capture-buys-per-game.md`: one charged call
  per game, though one call covers the sport. This bears on done condition 3
  (below).
- `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`, extended: a game
  that left its board mid-game is still served as live, with a frozen score,
  for up to 6h.

**Deploy and verification.** Deploy run 39713304241 was green, including the
new harness step. The code step finished at 02:57:28Z. The probe artifacts:

- **Run 39714396288** (`outbox/ambient-capture-probe-20261022T025948Z.log`)
  spans the switch to the new code.
  - **Before, until 03:02:23Z:** stored 661 entries, `lastPutError` "A value
    of size 131814 was provided", `gameStartsSize null`.
  - **After, from 03:02:53Z:** `gameStartsSize 0`, which only the new
    constructor gives. Stored scores were **4 entries, 903 bytes**, so the
    frozen 661 were pruned and the write landed. `lastPutError` was null.
- **Run 39716768024** (`…20261022T032548Z.log`): for 6 minutes the stored
  scores held at 4 entries and 903 bytes while `lastPoll` advanced every
  61 s. No capture was charged; no covered game went live in the window.
- **Also seen:** every reading on the new code met a fresh instance, with
  `clients 0`. The restarts continue and are filed. They no longer cost
  credits, because each instance restores the scores, the seen times and the
  capture record.
- **Probe defect found and fixed** (`4d99887`): the probe hung past its window
  because SIGTERM reached `npx`, not the wrangler tail. Run 39716768024 is the
  first to exit on time with a tail attached.

**Live kickoff check, scheduled.** The first covered kickoffs after the deploy
are 10-23 at 18:30Z, 18:45Z and 19:00Z: five games over three instants. A
probe across them must show exactly 5 capture calls, one per game.

**Done condition 3 has a ceiling it may not meet.** It sets at most 2x, with
need counted per (sport, kickoff instant). This fix buys once per game, and
the capture still buys per game (the second filed CC-CMD). A day whose games
share kickoff instants can therefore sit above 2x with the dedup working
perfectly: 10-15 would read up to 2.18x. So the read reports three numbers:
- charged/demand;
- 3 × games / demand, the ratio for exactly one purchase per game;
- the gap between them.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A test in which a simulated restart mid-game does not re-capture. It is red
   at HEAD and green after, with a mutation that restores per-instance dedup.
3. Two per-consumer demand runs on days with games after the deploy, whose
   `ambientCaptureClosingOdds` charged/demand falls from 17.9x to at most 2x.
   The ceiling of 2x allows for kickoff instants that ESPN reports late.

### Done condition 3, run 1 of 2 — closed day 2026-10-23: PASS, 0.8x

Run 40088714137 (`odds-consumer-demand.yml`, `days=3`, dispatched
2026-10-24 11:08Z). Log: `outbox/odds-consumer-demand-20261024T110857Z.log`.

**No refusal on the measured day**, checked first. `/budget/odds?date=2026-10-23`
through the relay self-probe at 11:08:44Z:
- `ceiling_reached_at` null, `month_limit_reached_at` null, `stamps_unreadable` null;
- used 636 of the 3,800 ceiling; D1 `odds_budget` for 10-23 also reads 636.

Fix 1 of the prerequisites CC-CMD retries a refused capture. The guard refused
nothing on 10-23, so the figures below contain no retries.

| 2026-10-23 | value |
|---|---|
| charged | 27: 9 calls at 3, each reconciled at 3 kept (5 MISS, 4 EXPIRED) |
| kept | 27 |
| demand | 33: 11 kickoff groups at 3 |
| games | 18 |
| **charged/demand** | **0.8x** (limit 2x) |
| 3 x games / demand | 1.6x |
| 3 x groups | 33. Charged (27) does not exceed it, so there is no finding against the before-kickoff CC-CMD |

For the trend, the same run reads 10-21 at 2.5x (before `e658b09`) and 10-22 at
0.4x (both deploys landed during that day).

**The 11 groups**, from D1 rows with `start_time` on 10-23 UTC in an ambient
sport, and the purchase for each:

| kickoff (UTC) | sport | games | bought |
|---|---|---|---|
| 00:00 | NHL | 2 | 10-22 23:50Z, so charged on 10-22 |
| 01:00 | NHL | 2 | 00:50Z |
| 01:30 | NBA | 1 | no |
| 02:00 | NHL | 2 | 01:50Z |
| 18:30 | Bundesliga | 1 | 18:20Z |
| 18:45 | Serie A | 1 | 18:35Z |
| 18:45 | Ligue 1 | 1 | 18:35Z |
| 19:00 | EPL | 1 | 18:50Z |
| 19:00 | La Liga | 1 | 18:50Z |
| 20:00 | NBA | 1 | no |
| 23:00 | NBA | 5 | no |

10-23's charge also holds two calls for 10-24 kickoffs at 00:00Z:
`NHL_2026-10-23_e401892564` and the World Series game `MLB_2026-10-23_e401908042`.
Both were bought at 23:50Z, as expected. That makes 7 calls for 10-23 groups and
2 for 10-24, 9 in all. Each call wrote at least one line, and no group was
bought twice.

**change_log**, source `closing_odds_capture`, `substr(ts,1,10) = '2026-10-23'`:
11 rows, all with `_kickoff.verified = 1`.

| sport | rows |
|---|---|
| NHL | 5 (4 for the 10-22 slate's 01:00Z and 02:00Z kickoffs, 1 for 10-24 00:00Z) |
| MLB | 1 |
| Bundesliga, Serie A, Ligue 1, EPL, La Liga | 1 each |
| NBA | 0. There are 0 NBA capture rows at all since 10-15 |

**The 0.8x is below 1 because NBA was never bought.** The 3 unbought groups
are all NBA, 7 games. At 11:11Z, `/v2/games?sport=nba` answered `count 0,
source nba-cdn-empty` for both 10-23 and 10-24, so AmbientDO never sees an NBA
kickoff. This is under-capture, not over-capture, and
`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` owns it. All 8 groups that
a board lists were bought, once each.

**`/ambient/state?diag=1`** at 11:08Z: `lastPutError` null, `storedMatchesMem`
true, `lastAlarmError` null, last restore at 04:43Z.

Run 2 reads closed day 10-24 on 2026-10-25 at 11:07Z.

# Claude Code Command — golf carries a real round start time, from ESPN's per-player tee times, and never a placeholder posing as one

**Branch:** main — commit directly, no feature branch, no PR
**Repo:** field-relay-nba (the source and the contract). One paired client change in jubilant-bassoon (Rule 70, ATOMIC-A): the relay deploys first, the client consumes.
**Filed:** 2026-11-16 by CC, on the owner's order "file the relay CC-CMD for golf tee times", from the Deep Cuts design work (field-laboratory `docs/CC-CMD-2026-11-15-scout-daypart-picks.md`, section "Golf").
**Confidence gate:** >= 95 before any commit
**Status:** STAGED 2026-11-19 — Tasks 1 to 4 built: relay `140fa56` (Task 2), `20eb710` (Task 4), and `464d4f7` (Task 2 rebuilt on ESPN's leaderboard after the live read failed, below); client jubilant-bassoon `b3e2c878` (Task 3). The live done-condition reads follow `464d4f7`'s deploy; a read is scheduled for 17:30Z on 2026-11-19 (`trig_01Xgs5MBnCBxLJiUS41EPefg`).

---

## Probe block (read 2026-11-16, field-relay-nba main `397b961`, jubilant-bassoon main `3de5b45`)

**What ESPN serves** (read through the FIELD browser tool; the sandbox cannot reach ESPN):

- Scoreboard, `site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard` (the Austin Championship, event 401850980, Round 4 suspended): competition `date` `2026-11-12T05:00Z` with **`timeValid: false`**; no venue object; 120 competitors with keys `athlete, id, linescores, order, score, statistics, type, uid` and no tee time anywhere in them; `broadcasts` `[{"market":"national","names":["ESPN+","Golf Chnl"]}]`.
- Site summary, `site.web.api.espn.com/apis/site/v2/sports/golf/pga/summary?event=401850980`: **404**, `"Summary not supported for sport 'golf'"`.
- Core event, `sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401850980`: `date` `2026-11-12T05:00Z`, **`timeValid: false`**; `venues[0]` is a `$ref`; `courses[0]` names the course and city (Omni Barton Creek Resort & Spa (Fazio Canyons Course), Austin, TX).
- **Core competitor status**, `.../events/401850980/competitions/401850980/competitors/11183/status`: **`teeTime` `2026-11-16T15:31Z`**, `startHole` 1, `period` 4, `position` 1, state `pre`. A real tee time, already UTC: no venue time zone is needed to place it. One competitor per request.

**What the relay does with it:**

- `handleESPNGolfScoreboard` (`src/index.js` 3765) fetches the scoreboard (`cf: { cacheTtl: 60, cacheEverything: true }`, 3786), keeps `startDate = ev.date` (3814) and **drops `timeValid`**. KV `v2:golf:scoreboard:r3:${date}`, TTL 300 while a tournament is on (3930), 3600 off-tournament (3806). Callers: `handleGolfEnriched` (4130, `/v2/golf/enriched`), the ESPN-sourced `/v2/games` branch (4412), `buildGolfCronContext` (7635) and the `[GOLF-BRIEF]` journalism path (9052).
- The **pre-game seed** (`src/index.js` ~8758, `[ARCHIVE-SEED]`) posts every `gameMeta` entry to `/archive/game` with `start_time: gm.startTime` and **no `individual` check**, so each PGA event gets a `sport='PGA Tour'` skeleton row with empty sides and ESPN's midnight placeholder as its start. ARCHIVE_DB holds four since 2026-10-16 (`PGA Tour_2026-10-22_e401850917`, `..._10-29_e401850978`, `..._11-06_e401850979` at `2026-11-05T05:00Z`, `..._11-13_e401850980` at `2026-11-12T05:00Z`). **Not this CC-CMD's to fix:** it is the defect field-laboratory `docs/CC-CMD-2026-08-25-golf-sport-label.md` exists to stop (that CC-CMD gated the final-score write, ~8650, and not the seed). The finding is added there (BUILD-ON-A).

**Who writes the golf round rows:** the client. `saveGolfRoundFinal` (jubilant-bassoon `src/legacy/field.js` 13839, called at 22347 when `_isGolfRoundComplete`) posts from each viewer's browser `{ sport: 'golf', league: 'PGA Tour', date: TODAY_ISO, home: evName, away: 'R' + round, source_id: 'golf_' + eventId, ... }` with **no `start_time`**. ARCHIVE_DB, 2026-10-16 to 2026-11-15: every `golf` row has `start_time` null, `venue` null, `streams` null, and a round often appears on two consecutive `date`s (e.g. Butterfield Bermuda R1 on 10-22 and 10-23): the viewer's date, not the round's.

## Premises, and the one command that would refute each (Rule 100)

| premise | refuting command |
|---|---|
| ESPN has no single endpoint listing a round's tee sheet, so tee times cost one request per competitor | Task 1 |
| A competitor's `teeTime` is the time for the CURRENT round (`period`), not the first round's | read two competitors' status mid-tournament with different `period`s, or one before and after a round change |
| `teeTime` exists for every competitor before the round starts | count competitors with and without it on one pre-round read |
| The earliest `teeTime` of a round is its start (a two-tee start sends groups off 1 and 10 at the same time) | read `startHole` across the field; the earliest time is the start whatever the hole |

## Task 1 result (2026-11-16, run 43975853385, read at 23:03Z after the Monday finish)

Artifact: `outbox/golf-tee-times-probe-2026-11-16.json`, script `scripts/golf-tee-times-probe.mjs` (self-test 5/5 on the runner), workflow `.github/workflows/golf-tee-times-probe.yml` (dispatch only).

- **No tee-sheet endpoint.** The core competition names three `$ref` children, `status`, `broadcasts` and `leaders`, all 200, and none mentions a tee time. The competitor list is inline on the competition (120 entries).
- **One request per competitor:** 120 status reads, all 200, in 266 ms at concurrency 8; 126 requests in 917 ms for the whole probe.
- **Who carries a `teeTime`:** the 67 competitors in round 4 (`period` 4), **67 of 67**, first `2026-11-16T13:30Z`, last `2026-11-16T15:31Z`, after the round had finished (state `post`). The 52 who missed the cut (`period` 2) and 1 more (`period` 1) carry none.
- **A two-tee start, measured:** round 4 started on hole 1 (36) and hole 10 (31); round 2's cut players show 25 and 26.

The premises, against it:

| premise | result |
|---|---|
| no single tee-sheet endpoint | **held**: three children, none with tee times |
| `teeTime` is the current round's | **consistent, not proven**: every `teeTime` read is on `period` 4, on Monday's date; one read at one time cannot show a round change |
| `teeTime` exists for every competitor before the round | **refuted as worded**: it exists for every competitor still in the tournament (67 of 67), not for those cut; a round's start is the minimum over competitors whose `period` is the round |
| the earliest `teeTime` is the round's start under a two-tee start | **held**: holes 1 and 10 both used; the minimum is the start whichever tee |

So Task 2 reads per competitor and filters to the current `period`. The cost to design for is about 120 requests per refresh per tournament; a round's tee times are set before it starts, so they can be cached per (event, round) rather than refreshed on the scoreboard's 300 s cycle.

## Tasks

1. **Blocking probe: the read cost.** From a GitHub Actions runner (the sandbox has no route to ESPN), for one live or upcoming tournament: (a) search ESPN's core API for a per-round tee sheet (the competition's `$ref` children: `competitors`, `status`, `situation`, `details`, and any `teetimes`-like ref) and record each URL with its status; (b) read every competitor's `status` and record `teeTime`, `period`, `startHole` per competitor; (c) record the request count and wall time. Artifact: `outbox/golf-tee-times-probe-<date>.json` with all of it. **If a per-round endpoint exists, Tasks 2 to 4 use it and this premise row is struck.**
2. **Relay: carry `timeValid`, and serve the round's start.** In `handleESPNGolfScoreboard`, keep `timeValid` beside `startDate` (a placeholder must say it is one), and add `roundStart` (the earliest `teeTime` of the current round, UTC) and `roundLastTee` (the latest), from Task 1's source. Cache per Rule 78 exactly as the scoreboard already does (edge `cacheTtl` with `cacheEverything`, and a KV key with the 300 s / 3600 s TTLs), so the per-competitor reads happen at most once per TTL, never per request. Update `CONTRACTS.md` for `/v2/golf/enriched`.
3. **Client (paired, Rule 70): post the round's start.** `saveGolfRoundFinal` adds `start_time: pgaData.roundStart` when present. Nothing else in the client changes; the duplicate-date behaviour is recorded, not changed here.
4. **Placeholder guard.** `/archive/game` refuses a golf `start_time` that the relay marked `timeValid: false` (it stores null instead), so a midnight placeholder can never be read as a start again.

## Done condition (artifacts, Rule 89)

- `outbox/golf-tee-times-probe-<date>.json` (Task 1), with the request count.
- `/v2/golf/enriched` on a tournament day returns `timeValid: false` beside `startDate`, and a `roundStart` equal to the minimum `teeTime` in Task 1's per-competitor read for that round (both values printed, equal).
- After the next completed round: an ARCHIVE_DB `golf` row for that round whose `start_time` equals that `roundStart`; the query and its row in the outbox manifest.
- Each guard mutated red once (Rule 90): `roundStart` taken as the maximum, `timeValid` dropped, the archive guard removed.

## Constraints

- RELAY-IS-DUMB: a tee time is a fact a data vendor publishes. Nothing here ranks or recommends.
- No change to cron frequencies, bindings or Durable Objects.
- The historical `PGA Tour` rows are not deleted here (field-laboratory `CC-CMD-2026-08-25-golf-sport-label.md` step 4: human approval).


## Build record (2026-11-18)

- **Task 2** (`140fa56`): the scoreboard carries `timeValid`; `/v2/golf/enriched` serves `startDate`, `timeValid`, `roundStart`, `roundLastTee`, `teeTimes`, read per competitor and cached per (event, round), only from that route. `scripts/check-golf-tee-times.mjs` 7/7 on the probe read, in `deploy.yml`; self-test 3/3.
- **Task 3** (client `b3e2c878`, `SW_VERSION 2026-11-17a`): `saveGolfRoundFinal` posts `start_time: roundStart` when it is a string.
- **Task 4, as built** (`20eb710`): the only writer of a placeholder golf start was the yesterday catch-up, posting every completed PGA event as `sport='PGA Tour'` with ESPN's midnight `startDate`. It now skips individual-competitor leagues before its ESPN call; `check-individual-sports-not-archived` holds it with a scoped assertion (red on the pre-fix source). The client never sends `startDate`, so the archive-side refusal the task first proposed has no writer left to refuse; it is not built.
- **Deploys:** relay `deploy` job green on both (runs 44214106406, 44220890137); their `verify` job red only on the pre-existing Oklahoma v Ole Miss date-keying row (owner's option A, `3019b07`, not yet applied). Client deploy run 44221051792 green.

### Done-condition reads, STAGED with their commands

1. Round 1 of the RSM Classic: `/v2/golf/enriched?date=2026-11-19` returns `active:true`, `timeValid:false`, `roundStart` and `roundLastTee` as ISO strings, `teeTimes.withTeeTime == teeTimes.inRound`, `failedReads 0`.
2. After that round completes and a client archives it: `SELECT id, start_time FROM regular_season_games WHERE sport='golf' AND date='2026-11-19'` shows `start_time` equal to read 1's `roundStart`.
3. No `sport='PGA Tour'` row created after 2026-11-18T01:30Z: `SELECT id, created_at FROM regular_season_games WHERE sport='PGA Tour' AND created_at > '2026-11-18 01:30:00'` returns none, read from 2026-11-20 on.

## The live read failed, and Task 2 is rebuilt (2026-11-19)

**Read 2026-11-19 00:40Z**, `/v2/golf/enriched?date=2026-11-19` (RSM Classic, before round 1): `active:true`, `round:null`, `timeValid:false`, `roundStart:null`, `teeTimes:null`, `venue:null`. The Austin Championship read (`?date=2026-11-15`) had `round:4` and still `roundStart` and `venue` null. Two causes:

1. **ESPN's core API answers 403 to the Worker.** Measured through the relay's own `/web-fetch` (`.github/workflows/golf-core-reach-probe.yml`, artifact `outbox/golf-core-reach-probe-2026-11-19T00-41-40-114Z.json`):

   | URL | the Worker | a GitHub runner, no User-Agent | a runner, the relay's User-Agent |
   |---|---|---|---|
   | site.api scoreboard (control) | 200 | 200 | 200 |
   | core event 401850981 | 403 | 200 | 200 |
   | core competition | 403 | 200 | 200 |
   | core competitor status | 403 | 200 | 200 |

   The discriminator is the egress IP, not a header. **This was already known:** `docs/CC-CMD-2026-10-14-espn-host-flip.md` Task 3 (2026-10-14) lists `/v2/golf/enriched`'s core read among five 403 read sites. Task 1's probe ran from a runner, where the core API answers, and the 11-18 build never read the host-flip CC-CMD (BUILD-ON-A miss). It is the source-versus-copy defect: a runner's reach was taken as the Worker's.
2. **No round before the first shot.** The scoreboard's `round` comes from linescores, which are empty until play starts, so the reader returned null before it fetched anything.

**The rebuild (`464d4f7`).** ESPN's golf leaderboard, `${ESPN_API_BASE}/sports/golf/leaderboard?league=pga&event=<id>`, answered 200 from a Worker IP (html_probe), and in ONE request carries every competitor's `status` (`period`, UTC `teeTime`, `startHole`) and the event's `courses` with addresses. Read before round 1 (`outbox/golf-leaderboard-rsm-r1-2026-11-19.json`): 147 competitors, all at `period` 1, **147 of 147 with a teeTime, 13:30Z to 15:42Z** (13:30Z is 8:30 AM ET, the first tee in the owner's PGA Tour app screenshot), holes 1 (72) and 10 (75); `status.teeTime` equals the round-1 `linescores[].teeTime` for 147 of 147.

- Task 1's premise "one request per competitor" is **struck**: it held for the core API; the leaderboard is a per-round tee sheet in all but name.
- The round is `teeTimeRound(scoreboard.round, statuses)`: the scoreboard's round when it has one, else the highest `period` among competitors (players cut stay on the cut round's period).
- `venue` and `venueLocation` now come from the leaderboard's host course; the core event read is gone from the route.
- `teeTimes` is `{ round, inRound, withTeeTime, competitors }` (`failedReads` dropped: one read). KV key v7. `CONTRACTS.md` updated; the client reads only `roundStart`.
- `check-golf-tee-times` 14/14 (adds the leaderboard read, the round choice and the wiring); self-test 9 of 9 mutants caught, among them "core API put back in the route" and "pre-round round left null".

Done-condition read 1 now expects `roundStart` `2026-11-19T13:30:00.000Z`, `roundLastTee` `2026-11-19T15:42:00.000Z`, `teeTimes` `{round:1, inRound:147, withTeeTime:147}`, `venue` `Sea Island Golf Club (Seaside Course)`.

### Done-condition read 1: PASSED live, 2026-11-19 ~01:05Z (before round 1)

`probe_relay_route /v2/golf/enriched?date=2026-11-19`, after deploy run 44432843013 (`deploy` and `verify` both green): `active:true`, event `401850981` The RSM Classic, `round:null`, `startDate` `2026-11-19T05:00Z`, `timeValid:false`, **`roundStart` `2026-11-19T13:30:00.000Z`**, `roundLastTee` `2026-11-19T15:42:00.000Z`, `teeTimes` `{round:1, inRound:147, withTeeTime:147, competitors:147}`, `venue` `Sea Island Golf Club (Seaside Course)`, `venueLocation` `Saint Simons Island, GA`. Every value equals the expectation above; `roundStart` equals the owner's screenshot (8:30 AM ET). Reads 2 (archive `start_time` after round 1) and 3 (no new `PGA Tour` rows) are still open (`trig_01Xgs5MBnCBxLJiUS41EPefg` re-reads today 17:30Z; `trig_01RHFUoJYLWiiVM7hCh1nuva` 2026-11-20 15:00Z).

### Read at 17:30Z, round 1 in play: PASSED

`/v2/golf/enriched?date=2026-11-19` at 17:30:56Z: `status` "In Progress", `round` 1, `timeValid` false, `roundStart` `2026-11-19T13:30:00.000Z`, `roundLastTee` `2026-11-19T15:42:00.000Z`, `teeTimes` `{round 1, inRound 147, withTeeTime 147, competitors 147}`, `venue` Sea Island Golf Club (Seaside Course). Unchanged from the pre-round read and equal to the owner's screenshot. Read 2 (the archive row's `start_time`) is `trig_01RHFUoJYLWiiVM7hCh1nuva`, 2026-11-20 15:00Z.

### Reads 2 and 3, 2026-11-20 15:01Z: 3 PASSED, 2 FAILED, the cause fixed

- **Read 3 PASSED:** `SELECT id, created_at FROM regular_season_games WHERE sport='PGA Tour' AND created_at > '2026-11-18 01:30:00'` returns no rows.
- **Read 2 FAILED:** `golf_2026-11-19_thersmclassic_r1` (created 2026-11-19 22:40:57) and `golf_2026-11-20_thersmclassic_r1` (created 2026-11-20 12:11:45, the known second-viewer-date row) both carry `start_time` `2026-11-19T13:41:00.000Z`. The round's first tee was 13:30Z.
- **Cause:** a competitor's `status` on ESPN's leaderboard names only its CURRENT round. The live read at 15:05Z showed 145 of 147 at `period` 2, while `linescores[]` kept all 147 round-1 tee times (13:30Z to 15:42Z). By the time round 1 was archived, enough players had moved to period 2 that the earliest round-1 time still visible in `status` was 13:41Z. The premise "teeTime is the current round's" in the table above was right, and that is exactly why `status` cannot serve a finished round. The 11-18 build relied on it for both.
- **Fix:** each round's tee times are now read from the leaderboard's `linescores[]`, one teeTime per round. Fixture `outbox/golf-leaderboard-rsm-r2-2026-11-20.json`. On the same read the old summary returns round 1 with 2 players and no start; the new one returns 147 and 13:30Z.
- **The two archived rows are left as written.** Correcting their `start_time` to 13:30Z is a production write, and the choice is the owner's. The second row is the duplicate-date behaviour recorded under Task 3, not changed here.
- **Re-read:** the round-2 archive row after round 2 completes: `start_time` must be `2026-11-20T13:30:00.000Z`.

### The linescores fix, live, and the round-1 rows corrected (2026-11-20 15:40Z)

- **Unblocked:** the deploy of `3cbe458` (run 44761140537) stopped at the staged-claim gate on another session's untagged claim. A verifier was built and the claim tagged (`8d25d02`). The owner ordered the deploy dispatched (2026-11-20, "Dispatch now"): run 44763794787 on `8d25d02`, `deploy` and `verify` green.
- **Live read, round 2:** `/v2/golf/enriched?date=2026-11-20` returns `round` 2, `roundStart` `2026-11-20T13:30:00.000Z`, `roundLastTee` `2026-11-20T15:42:00.000Z`, `teeTimes {round 2, inRound 145, withTeeTime 145, competitors 147}`.
- **Round-1 rows corrected** on the owner's GO (2026-11-20, "Correct both to 13:30Z"). Run 44763910890 (`scripts/fix-rsm-r1-start-time.mjs`, log `outbox/fix-rsm-r1-start-time-*.log`) changed one row per UPDATE. Read back: `golf_2026-11-19_thersmclassic_r1` and `golf_2026-11-20_thersmclassic_r1` both carry `start_time` `2026-11-19T13:30:00.000Z`.
- **Still to read:** the round-2 archive row after round 2 completes, `start_time` `2026-11-20T13:30:00.000Z`. Armed below.

### 2026-11-21 13:01Z: round-2 rows read; a round archived at its start, fixed

- **`start_time` holds for every RSM row:**
  - `golf_2026-11-20_thersmclassic_r2` (created 2026-11-20 15:34:46) and `golf_2026-11-21_thersmclassic_r2` (created 2026-11-21 11:47:42) both carry `2026-11-20T13:30:00.000Z`.
  - The two round-1 rows carry `2026-11-19T13:30:00.000Z` (corrected).
  - The done conditions' start-time reads are met.
- **Found: round 2 was archived while it was being played.** The first round-2 row was created at 15:34:46Z, 8 minutes before round 2's last tee (15:42Z). Its leader is "Rasmus Neergaard-Petersen -9"; the next morning's row says "Marco Penge -9".
  - **Cause, read in the source:** `handleESPNGolfScoreboard` took each player's `today` and `thru` from `linescores[0]`, which is round 1, in every round.
  - **Measured on the scoreboard after round 2** (`outbox/golf-scoreboard-rsm-after-r2-2026-11-21.json`): `today` was the round-1 score for 128 of the 145 players past round 1. Every player who had finished round 1 read `thru` 18, so the client's fallback in `_isGolfRoundComplete` (top 60 all `thru` >= 18) fired as soon as round 2 began.
  - The 2026-11-20 15:40Z live read showed exactly that: `round` 2, every top player `thru` 18, each `today` equal to their round-1 score.
- **Fixed in `4943d43`:** `src/golf-round-line.js` `golfRoundLine` reads `today` and `thru` from the current round's own linescore. `scripts/check-golf-round-line.mjs` is in `deploy.yml`: 8/8, 5 mutants, among them "round 1 read in every round".
- **Not changed, the owner's call:** the two round-2 rows' `home_score`/`note` hold a mid-round leader. Their `start_time` is correct.
- **Still to read:** the round-3 row, once round 3 finishes after `4943d43` deploys. It should be created after round 3's last tee, with `start_time` equal to the relay's round-3 `roundStart`.

- **`4943d43` live** (deploy run 44908060176, `deploy` and `verify` green), read 2026-11-21 13:30Z before round 3. `/v2/golf/enriched?date=2026-11-21` `today` is each player's round-2 score:
  - Penge `toPar` -9, `today` -5 (round 1 was -4).
  - Svensson -7, `today` +1 (round 1 was -8, the round-1 row's leader).
  - `round` is 2 and `thru` is 18 while round 3 has not begun.

### 2026-11-22 13:01Z: no round-3 row, because round 3 has not been played

- **D1:** no `R3` row for `golf_401850981`; the four R1/R2 rows are unchanged.
- **ESPN leaderboard** (FIELD browser tool, 13:01Z):
  - The competition reads `Suspended`, period 3.
  - All 66 players who made the cut are `pre` at period 3 with 0 round-3 holes.
  - Round-3 tee times run 2026-11-22T14:10Z to 16:00Z, 66 of 66.
  - So round 3 is played today. No row is the correct answer, and no round was archived at its start: `4943d43` held through the suspension.
- **Gap found, not changed:** before a round's first shot, `roundStart` serves the PREVIOUS round. At 13:01Z, `/v2/golf/enriched` would read round 2 (13:30Z on 11-20), not round 3's 14:10Z. The scoreboard's `round` counts rounds begun, and `teeTimeRound` uses it whenever it is set. Round 1 is the only round whose tee times show before play (the scoreboard's round is null then).
  - The archive row is unaffected: it is written when the round completes, with `round` = 3.
  - A consumer showing an upcoming round's first tee (the laboratory's Deep Cuts golf windows) would see the last round's time. The fix would choose the round with the next unplayed tee times. It needs the owner's word on what "the current round" means between rounds.
- **Re-read:** 2026-11-23 13:00Z (round 3 finishes today, round 4 is Monday's if the schedule slips).
- **Owner, 2026-11-22:** "Rain delay yesterday. Round 3 today, final round Monday." Reads armed:
  - Round 3: `trig_01JzUiSczKshFjKyjebxeCuB`, 2026-11-23 13:00Z.
  - Round 4: `trig_011LFJx6dq5AmyZYKHusAq9U`, 2026-11-24 13:00Z. It closes the CC-CMD if both rounds pass.


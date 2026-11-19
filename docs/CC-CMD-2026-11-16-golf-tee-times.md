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

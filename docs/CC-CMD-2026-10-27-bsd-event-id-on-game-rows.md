# Claude Code Command — put the BSD event id on archived game rows, so a game can find its lineup

**Date:** 2026-10-27
**Repo:** field-relay-nba (this CC-CMD). Its consumer is `field-laboratory`
`docs/CC-CMD-2026-10-27-lineups-on-game-cards.md`, filed in the same session
(Rule 70: relay deploys first, the client matches; Rule 87.4: no deferred work
without a second CC-CMD).
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — one additive field, one join module, one backfill
**Status:** DONE 2026-10-28. All seven tasks and all eight done conditions, no stop condition hit.
Deploy run 40607238843 (`04d28bd`); live proof run 40608452953 (`8d51a11`), artifact
`outbox/bsd-game-join-live-latest.json` (first run kept at
`outbox/bsd-game-join-live-2026-10-28T0023Z-first-run.json`); idempotence rerun `40ce12b`. Session doc:
`outbox/cc-session-2026-10-27-bsd-event-id-on-game-rows.md`. The consumer, field-laboratory
`docs/CC-CMD-2026-10-27-lineups-on-game-cards.md`, is unblocked.

**Correction 2026-11-07 (BUILD-ON-A: added here, not filed again).** DONE above was true of the join and untrue of *when* it
runs. The laboratory's game cards said "No lineup source for this game" for all five big-five rows of 2026-11-06 at 22:50Z,
hours after the games. Measured (D1 `field-archive`, `change_log` joined to `regular_season_games` on `game_id`, read 2026-11-07):
the rows of game days 2026-10-30, 10-31, 11-01, 11-02 and 11-06, every one created at 10:00Z, were joined by `bsd_game_join` at 00:xxZ
of the following day (68 rows). The only other write since 10-31 is 8 rows dated 11-07 that had existed since 2026-06-30 and were joined on
11-04 at 10:xxZ, as the +3 date of the window. Cause, in `runBsdGameJoinWindow` (Task 4's hook): the archive creates a day's rows at about
10:00Z; a date's first pass of each UTC day runs near 00:00Z, found nothing pending, and was marked done for 36 h, so the
rows waited for the next midnight UTC (855 minutes in the simulation that reproduces it). Task 4's text below ("once per UTC
day per date through a KV marker with a 36 h TTL") is what produced it. Fixed in commit `533090e` (see
`outbox/cc-session-2026-11-07-lineup-join-and-fa-cup.md`): an empty date's marker is an hour and an empty pass no longer ends
the tick; the check `scripts/check-bsd-join-window-timing.mjs` is the artifact (80 scenarios; the old behaviour fails 72).
Task 4's cadence sentence then read: a date WITH rows is read from BSD once per UTC day, one such date per tick; a date with
nothing pending is looked at again within the hour and makes no BSD call. (Superseded the same day by Residual R1 below: a date left with
unjoined rows is held 6 h, not 36 h, and a date whose rows were all joined an hour.)

**Second correction 2026-11-07 (live; BUILD-ON-A: added here, not filed again).** The first correction's fix (`533090e`, deployed
01:13Z to 01:24Z) did not join that day's rows either. At 12:11Z all 34 pending soccer rows of 2026-11-07 (19 big-five, 15 MLS), created
10:00:29Z to 10:00:39Z, were `bsd_event_id IS NULL`, and `change_log` held no `bsd_game_join` write since 00:30Z. Measured, in order:
(1) the window pass WAS called at 10:01Z and again at 11:15Z: `/journalism/brief` has `generatedAt` 2026-11-07T11:15:23Z, so that tick got past
the context-unchanged gate, and the pass sits after it; (2) the same function, run through the deployed admin route at 12:24Z, joined 33 of the
34 pending rows (459 BSD events read, 10 upstream pages, 0 cache hits), so the join is not the defect
(`outbox/probe-bsd-join-today-2026-11-07T12-24-33-411Z.json`, run 42372338945); (3) a marker held the date. KV, listed by
`scripts/probe-bsd-join-markers.mjs` (run 42372697452, `outbox/probe-bsd-join-markers-2026-11-07T12-29-26-048Z.json`): `bsd-join:2026-11-07:2026-11-07` holds
`{"written":0,"pending":0}` and expires 2026-11-08T12:45:30Z, which is 36 h after 00:45:30Z the same day. The fixed code writes 3600 s for
`pending: 0`; only the pre-fix code wrote 36 h for it; the fix went live about 01:14Z. So a marker written by the OLD code 28 minutes before the
deploy outlived it (a deploy does not clear KV) and held the date through both passes. `bsd-join:2026-11-08:2026-11-07` and
`bsd-join:2026-11-09:2026-11-07` have the same signature. That cause cannot recur on UTC day 2026-11-08 (its keys do not exist yet, and the pre-fix code is gone); a separate latent
defect found while reading D1 for it is Residual R1 below, closed by the 6 h hold.
The probe's `EMPTY-DATE-HOURLY` class cannot tell a fixed-code hour marker from an old 36 h marker with under an hour left (it reads the
remaining TTL): `bsd-join:2026-11-06:2026-11-06`, 0.28 h left, is such a marker. (4) The one row that stayed unmatched, Ligue 1 Auxerre v Paris FC (18:00Z), is
an alias gap: BSD serves the home side as "AJ Auxerre" (event 210519; `outbox/probe-bsd-unmatched-row-2026-11-07T12-33-27-936Z.json`). `['AJ Auxerre', 'Auxerre']`
is in `src/identity-resolver.js` (`7a55ee1`, Deploy RELAY Worker run 42373918077), check S10 in `scripts/check-bsd-game-join.mjs` written first (20/21, then 21/21, then 20/21 with the alias removed).

**Residual R1, CLOSED 2026-11-07 (commits `0ba3d4c`, `f505be6`).** Measured on the real function 2026-11-07 (reviewer scratch `variants.mjs`,
wf_753e8877-a88): a pass that HAD rows to join held the date 36 h even when some rows stayed unjoined. The unblock criterion was read the same
day (`outbox/d1-bsd-join-reads-2026-11-07.md`, with the queries and their output): (a) a second batch, rows created after a date's first row-seeing
pass: 0 of 184 soccer rows with a date since 2026-10-24 were created outside UTC hour 10 (all at 10:00:29Z to 10:00:49Z on the days read), so
none is on record; (b) rows BSD cannot match: D1 holds seeded rows that are unjoined and months old for 2026-10-24 (1), 10-31 (3) and 11-05 (1)
(MLS, seeded 2026-06-30 and 07-06), and 2026-11-07's Ligue 1 row before its alias. Such a row keeps its date pending at the day's first pass near
00:00Z, which would hold the date 36 h and the 10:00Z rows with it. No miss of that kind is on record (the rows of 10-30 to 11-02 were joined at
00:xxZ the next day whether the cause was an empty date or a stuck row; change_log cannot separate them). The fix: a pass that left nothing
unjoined holds its date an hour (the next pass finds nothing pending and reads only D1); one that left rows unjoined holds it 6 h, which ends
before 10:00Z for any pass in live hours; the window is read today first and yesterday last (review: yesterday's expired hold otherwise takes the
tick's one BSD slot ahead of today); a pass that throws is a failed date (the failure marker holds it an hour) instead of being retried on every
tick while the dates behind it are never visited. Cost, Rule 78, in pages and not only reads: a stuck row is read at most 4 times a UTC day at
about 10 upstream pages each (10 measured 2026-11-07 for two event days, 0 cache hits), so at most 20 passes and 480 pages a day if all five window
dates carry one, about 200 at the measured size, against about 50 before. BSD's own pages disagree on limits (`docs/CC-CMD-2026-10-29-bsd-live-shot-source.md`:
"7,500 per day" on one, "None" on another, "100 req/day" on a third; 10 requests/second per IP is the one figure two pages agree on), so
"BSD has no documented rate limit", written in the session doc of 2026-10-27, is not to be repeated. The artifact: `scripts/check-bsd-join-window-timing.mjs`,
896 scenarios, 21 of 21 self-test (18 mutants), red on `src/index.js` as of `7a55ee1` (before this fix) for the seeded and second-batch families (372 findings) and on the
pre-review order (12). **Still not modelled, and named in that check's header:** (1) two or more dates holding an unmatchable row ahead of a date with
fresh rows on a cadence of three reaches in nine hours: a stuck date's 6 h re-read takes the scarce reach and the later date waits about 10 h;
(2) a FAILED date (a pass that threw or answered non-200) on a cadence of one reach an hour or sparser: its failure marker ends at the next
reach, so it is tried again at every reach and takes the tick. A `continue` after a failed pass with a page budget shared across the tick would
cure (2); not built. Unblock for both: a measured reach cadence, i.e. how often a tick passes the slate-context gate
(`journalism:<date>` `contextHash` changes) on a real day; without it neither can be said to occur.

**Residual R1, read live 2026-11-08 (session doc `outbox/cc-session-2026-11-07-lineup-join-and-fa-cup.md`, section "2026-11-08 11:20Z"): the join happens in the creating cycle, MET; the rows' completeness was not.** 22 of the day's 24 soccer rows were written in the 10:01 minute, the tick that follows their creation at 10:00:28 to 10:00:37Z, and the marker held the date 6 h (`{"written":22,"pending":24}`, expiry 16:01:10Z). The other 2 (Ligue 1 Rennes v Lille 14:00Z, Angers v Nice 16:15Z) stayed unjoined because BSD names the clubs "LOSC Lille" and "OGC Nice" (events 210525 and 210518, read from `/bsd/events/by-date` on a runner with a found control): two more aliases, `1e3e9a5`, deployed 11:16Z (run `42474274661`) and joined 2 of 2 at 11:17Z, read back from D1. The 6 h hold means a row left unjoined by a name gap is not retried before the next window, which for a 14:00Z kickoff is after it; every such gap needs a manual pass or a deploy-and-join as here. Two alias gaps in two days (Auxerre 11-07, Lille and Nice 11-08).

Three corrections this work produced, recorded so the document is not read as still-true:

1. **9 of the 12 oracle row ids exist in the live archive**, not 12. The artifact names the other three
   (`2026-08-29-mls-min-orl`, `-skc-van`, `-hou-sj`); the 9 present are all correct.
2. **A same-teams twin a day later is `ambiguous`, not "refused".** Kickoff never chooses between
   candidates; it only refuses (owner ruling 2026-10-19).
3. **The archive holds two rows of one fixture under two id schemes**, and both carry the one event id (11
   events shared by two rows). That is correct for this field.

The once-per-day pass, which "What this does not prove" below says is exercised offline only, was then
observed live on 2026-10-28: it wrote ids for 10-26 to 10-29 at four consecutive `*/15` ticks with no admin
call (session doc). Dates before the rolling window are joined only by `POST /admin/bsd-game-join`.

```bash
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull; git log --oneline -5
```

---

## Why this exists, measured

The laboratory wants a lineup attached to each soccer game card. The lineup route
is built and live (`/bsd/events/{id}/lineups`, `CC-CMD-2026-10-10-bsd-predicted-lineups`,
DONE) and takes a BSD event id. A game row served by `/context/date/{date}` carries
`espn_event_id` and **no BSD id**: the `bsd_event_id` column exists on `wc_results`
only. So a game cannot find its lineup. The only game-to-BSD join in this repo is
live-only (the block in `handleV2Games` that matches `/api/v2/events/live/` by
`teamNameMatch` and sets `g.bsdEventId`), and it matches in **both orientations**.

Measured on 2026-10-26 by the laboratory's probe (workflow "bsd join probe", run
40303868771 and the two after it; artifacts `outbox/bsd-join-probe-latest.json` and
`.txt` in field-laboratory, session doc `outbox/cc-session-2026-10-26-bsd-join-probe.md`),
over the **two committed context dates that hold soccer, 93 games, not a season**:

| what | measured |
|---|---|
| BSD `/bsd/events/by-date` for one UTC day | 227 and 326 events, 5 and 7 pages; every event carries `home_team_id` and `away_team_id` |
| 14 late US games (00:30Z–02:30Z) are on the NEXT UTC day | asking for the context date alone loses them; asking for the day and the next, 432 and 541 events |
| `resolveTeamKey` on both sides, same orientation, no kickoff | joins **67 of 93**, 0 ambiguous, 0 joinable only reversed |
| the 12 pairs the laboratory read by eye as correct (table below) | `resolveTeamKey` joins **12 of 12** with no alias change |
| 26 games not joined by `resolveTeamKey` | 11 alias gaps named below (one side), 14 games where BOTH sides miss (Bundesliga, Ligue 1, Serie A) |

Named alias gaps (lab name => BSD name): `Liverpool => Liverpool FC`, `Red Bull NY =>
New York Red Bulls`, `Levante => Levante UD`, `Gladbach => Borussia M'gladbach`,
`Brest => Stade Brestois`, `C Palace => Crystal Palace`, `Athletic => Athletic Club`,
`Racing => Real Racing Club`, `Deportivo => Deportivo de A Coruña`, `Bremen => SV Werder
Bremen`, `Lens => RC Lens`. The 14 both-sides misses are enumerated by Task 1's fixture,
not guessed here.

## Rulings and prior CC-CMDs this must not undo (BUILD-ON-A)

- **The kickoff instant may refuse a pair and never chooses one** (owner ruling
  2026-10-19, `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md`, recorded in the header of
  `src/odds-name-match.js`). The laboratory's own probe briefly used kickoff as a key;
  that is dropped. Here the instant refuses a pair more than `BSD_KICKOFF_REFUSE_MINUTES`
  apart, and a row with no `start_time` refuses nothing and is **counted, not judged**.
- **Ambiguity is never resolved by guessing** (same header): two candidates return no event.
- **Orientation is never loosened.** The live block's both-orientation match is NOT copied.
  Documented here, not fixed (Rule 69); it is a separate defect if it is one.
- `CC-CMD-2026-10-10-bsd-predicted-lineups` (DONE) and `CC-CMD-2026-10-11-predicted-xi-render-decision`
  (DONE): lineups are served on pull, never pushed (ADR-002 Rule A). Nothing here adds a push.
- `CC-CMD-2026-07-15-game-identity-resolver-discovery` recommends AGAINST a universal game
  identity resolver. This is not one: it is one nullable id on one table pair, filled by the
  resolver that already exists.
- `CC-CMD-2026-06-25-F-bsd-eventid` built the live join; it stays as it is.

## Scope (Rule 75)

**Touch:** `src/identity-resolver.js` (alias entries only, no behaviour change to existing
entries), a new `src/bsd-game-join.js`, `src/index.js` (the new column helper, the backfill
function, one admin route, one call from an existing scheduled handler), `CONTRACTS.md`,
new `scripts/` and one new workflow, `outbox/`.
**Do NOT touch:** `wrangler.toml`, any cron frequency, any existing route's response except
the one added field, the live enrichment block, `teamNameMatch`, any Durable Object,
`odds-name-match.js`.
**ADR-002 / Rule 47:** an event id is an identifier, commodity by any test; nothing here
computes a value that answers "should I watch this".

---

## TASK 0 — Probe block (run first; write nothing until it prints)

```bash
git log --oneline -5
grep -n "async function ensureImportanceColumn" src/index.js          # the column-add pattern to copy
grep -n "async function runOddsBackfillForDate" src/index.js          # the per-date, IS NULL-guarded backfill to copy
grep -n "async function backfillWCBsdEventIds" src/index.js           # the BSD id backfill to copy
grep -n "pathname.startsWith('/context/date/')" src/index.js          # the route the field flows through (SELECT *)
grep -n "pathname === '/bsd/events/by-date'" src/index.js            # the route to reuse, with its cache key
grep -n "export function resolveTeamKey\|^function resolveTeamKey" src/identity-resolver.js
grep -n "KICKOFF_REFUSE_MINUTES" src/odds-name-match.js
grep -n "'/admin/" src/index.js | head -20                            # how an admin route authenticates
grep -rn "RELAY_SHARED_SECRET" src/index.js | head -3
grep -rn "X-RateLimit\|rate.limit\|quota" scripts/bsd-*.mjs docs/CC-CMD-2026-1*-bsd-*.md | head -10   # BSD's cost model, Rule 78
grep -n "regular_season_games" src/index.js | grep -i "insert" | head -3
```

Print, in the manifest: the real line numbers; **how an admin route authenticates** (reuse
it, secret read from `env` with NO default); **which existing scheduled handler already
iterates upcoming rows of `regular_season_games` once per day** (candidate hook; the odds
snapshot is the one to check first); and BSD's documented or observed rate limit. **STOP
CONDITION 1:** no existing scheduled handler fits without changing a cron frequency. Write the
finding to the outbox and stop; do not add a cron.

## TASK 1 — Capture the offline corpus on a runner (the sandbox does not reach the relay)

Workflow `bsd-game-join-fixture.yml`, triggered by a push to
`outbox/.trigger-bsd-game-join-fixture`, commits `outbox/fixture-bsd-game-join-2026-08-29-09-05.json`:
- the soccer rows (`sport` in MLS, EPL, La Liga, Serie A, Bundesliga, Ligue 1) of the deployed
  `/context/date/2026-08-29` and `/context/date/2026-09-05`, **with the column list as served**;
- the BSD events of `/bsd/events/by-date` for each date and the following UTC day, all pages;
- a header recording the counts it holds (`rows N, events M, pages P`), printed again by every
  script that reads it (Rule 91).

Develop offline from this file. A matcher developed live is paid for in upstream calls (the
2026-09-16 session: "a fixture of both sides was captured so a matcher could be developed
offline instead of at 20 credits per attempt").

## TASK 2 — The join, pure, with its check and its mutations FIRST (Rule 90)

New `src/bsd-game-join.js`, no `env`, no fetch. Export `joinGameToBsd(row, events)` returning
`{ bsd_event_id, how }` or `{ bsd_event_id: null, how: 'unmatched' | 'ambiguous' | 'refused-kickoff' }`,
and `BSD_KICKOFF_REFUSE_MINUTES = 180` (measured gap among the laboratory's 46 joined games that
carried a `start_time`: median 0, max 0, so 180 refuses real mismatches and clips nothing
measured; say so in a comment and state it is two dates).

The rule, in order, nothing else:
1. Only rows whose `sport` is one of the six soccer labels. Any other sport returns
   `{ null, 'not-soccer' }` (a `Tigers` row must never reach an English club).
2. A candidate is an event with `resolveTeamKey(event.home_team) === resolveTeamKey(row.home)` AND
   `resolveTeamKey(event.away_team) === resolveTeamKey(row.away)`. Same orientation only.
3. Exactly one candidate, else `ambiguous` (two or more) or `unmatched` (none).
4. If `row.start_time` and `event.event_date` both parse and differ by more than
   `BSD_KICKOFF_REFUSE_MINUTES`, return `refused-kickoff`. A missing instant refuses nothing and
   increments `unjudgedKickoff` in the caller's counts.

`scripts/check-bsd-game-join.mjs --offline` runs the rule over the Task 1 fixture AND a synthetic
corpus (the fixture has no ambiguous pair and no reversed pair, so a mutation deleting either guard
would survive it alone: say so in the script), and prints its denominators. The synthetic corpus
must contain: a reversed-orientation pair (must NOT join), two events one name pair (ambiguous),
the same two teams playing twice in a window (the second event is a different kickoff: refused, not
chosen), an event on the next UTC day (must join when both days are supplied), a baseball row named
`Tigers` beside an English event (must return `not-soccer`), and a row with no `start_time` (joins,
counted unjudged).

**Register these mutations in `scripts/mutate-bsd-game-join.mjs` and run them BEFORE trusting the
check; each must turn it red, and the harness asserts its own anchor is unique and applied
(Rule 90's corollary):** M1 accept the reversed orientation; M2 take the first of several
candidates; M3 join by kickoff when names fail; M4 delete the kickoff refusal; M5 treat a missing
`start_time` as a refusal; M6 drop the sport guard; M7 supply only the context date's events (no
following day). The harness prints `7 of 7 caught` and fails if any is not.

## TASK 3 — Alias additions, from the fixture, and only from it

Run the offline check; list every game left `unmatched` with both names and the BSD names at the
same kickoff in the same league (the fixture holds them). Add the disagreements to the alias source
in `src/identity-resolver.js`, each with a comment naming the pair it came from. The 11 named above
are the start; the 14 both-sides misses are the rest.
**STOP CONDITION 2:** more than 40 added names. That is a design problem (the table is the wrong
home), not a long list: write the count and the cause to the outbox and stop.
**Existing behaviour must not change:** run the existing identity-resolver checks before and after
and print both counts; they must be equal.

## TASK 4 — Column, backfill, admin route, scheduled hook

- `ensureBsdEventIdColumn(env)` copied from `ensureImportanceColumn`: `ALTER TABLE regular_season_games
  ADD COLUMN bsd_event_id TEXT DEFAULT NULL`, and the same for `postseason_games`, each tolerating
  "duplicate column" and each wrapped in try/catch (archive failure never breaks a primary
  function, Rule 5).
- `runBsdGameJoinForDate(env, isoDate)` copied in shape from `runOddsBackfillForDate`: select only
  rows `WHERE date = ? AND bsd_event_id IS NULL` and soccer, fetch events for `isoDate` and the
  following UTC day through the SAME cache key `/bsd/events/by-date` already uses (no new upstream
  cost on a cache hit), at most 12 pages per day, join with `joinGameToBsd`, and write
  `UPDATE ... SET bsd_event_id = ? WHERE id = ? AND bsd_event_id IS NULL`. Never overwrite.
  Return `{ date, soccerRows, joined, ambiguous, unmatched: [names], refusedKickoff, unjudgedKickoff, upstreamPages }`.
- One admin route, authenticated exactly as Task 0 found, calling that function for `?date=`.
- One call from the scheduled handler Task 0 chose: window today..today+3 and then yesterday, one date that reads BSD per tick,
  held by a KV marker after a pass: an hour when the pass left nothing unjoined (and a date with nothing pending does not end the
  tick), 6 h when it left rows unjoined (as built 2026-10-27 this was **once per UTC day per date that has rows to join**, 36 h; corrected
  twice on 2026-11-07, see the Corrections under Status), capped at 24 upstream pages per run (Rule 78),
  inside its own try/catch. The scheduled path and the admin path call the SAME function; only the
  trigger differs, and the offline check exercises the hook with a mock `env`.

## TASK 5 — The contract (Rule 86)

`CONTRACTS.md`, the `/context/date` rows: add `bsd_event_id` — nullable string, **absent or null
means "not joined", never a guess**; present only on the six soccer sports. Note that
field-laboratory's decoder reads it as optional (`get.Optional.Field`) and that its copy must be
synced.

## TASK 6 — Deploy, then run it, inside this session

1. Push to main; read the deploy run to success (print the run id).
2. A workflow `bsd-game-join-verify.yml`, triggered by a push to `outbox/.trigger-bsd-game-join-verify`,
   calls the admin route for 2026-08-29 and 2026-09-05 against the DEPLOYED relay, then reads
   `/context/date/{date}` for both and writes `outbox/bsd-game-join-live-latest.json` through
   `scripts/check-bsd-game-join.mjs --live`.
3. Rerun it once and print both outputs: the second must report `joined` unchanged and zero writes
   (the `IS NULL` guard), or the guard is broken.

## DONE CONDITION — every line an artifact (Rule 89)

`outbox/bsd-game-join-live-latest.json`, written by the runner against the deployed relay:

1. **Coverage, with its denominator:** for each of the two dates, `joined + ambiguous + unmatched +
   refusedKickoff == soccerRows`, and `joined / soccerRows >= 0.90`; every non-joined row is named
   with its reason. Printed as `joined N of M soccer rows` per date. Below 0.90 means continue
   Task 3, not defer.
2. **The 12 oracle pairs, 12 of 12** (measured: 9 of the 12 row ids exist in the live archive, 9 of 9 correct, 3 named; see Corrections). Their event ids were fixed by the laboratory's probe from the
   BSD payload by exact name pair, a different code path from this rule:

   | date | row id | lab name | `bsd_event_id` | BSD name |
   |---|---|---|---|---|
   | 2026-08-29 | `2026-08-29-mls-stl-dal` | St. Louis CITY SC v FC Dallas | 5243 | St.Louis City v FC Dallas |
   | 2026-08-29 | `2026-08-29-mls-min-orl` | Minnesota United FC v Orlando City | 5238 | Minnesota United v Orlando City SC |
   | 2026-08-29 | `2026-08-29-mls-skc-van` | Sporting Kansas City v Vancouver Whitecaps FC | 5237 | Sporting Kansas City v Vancouver Whitecaps |
   | 2026-08-29 | `2026-08-29-mls-hou-sj` | Houston Dynamo FC v San Jose Earthquakes | 5239 | Houston Dynamo v San Jose Earthquakes |
   | 2026-08-29 | `2026-08-29-mls-tor-nyc` | Toronto FC v New York City Football Club | 5233 | Toronto FC v New York City FC |
   | 2026-08-29 | `2026-08-29-mls-sea-chi` | Seattle Sounders FC v Chicago Fire FC | 5229 | Seattle Sounders FC v Chicago Fire |
   | 2026-08-29 | `2026-08-29-mls-dc-lafc` | D.C. United v Los Angeles Football Club | 5231 | DC United v Los Angeles FC |
   | 2026-09-05 | `2026-09-05-mls-tor-chi` | Toronto FC v Chicago Fire FC | 5250 | Toronto FC v Chicago Fire |
   | 2026-09-05 | `2026-09-05-mls-orl-sd` | Orlando City v San Diego FC | 5248 | Orlando City SC v San Diego FC |
   | 2026-09-05 | `2026-09-05-mls-clt-hou` | Charlotte FC v Houston Dynamo FC | 5251 | Charlotte FC v Houston Dynamo |
   | 2026-09-05 | `MLS_2026-09-05_e761773` | Cincinnati v D.C. United | 5247 | FC Cincinnati v DC United |
   | 2026-09-05 | `MLS_2026-09-05_e761777` | Miami v Atlanta | 5245 | Inter Miami CF v Atlanta United |

   If a row id is absent from the live rows, the artifact names it; it is not silently skipped.
3. **No duplicate claim:** no `bsd_event_id` appears on two rows of one date.
4. **Kickoff refusal holds:** every joined row with a `start_time` has an event within
   `BSD_KICKOFF_REFUSE_MINUTES`, and the count of rows with no `start_time` (`unjudgedKickoff`) is
   printed. It is a count, not a pass.
5. **Soccer only:** zero rows of any other sport carry a `bsd_event_id`.
6. **Contract unchanged except by one field:** the key set of a served row equals the Task 1
   fixture's key set plus `bsd_event_id`, compared by name.
7. **Idempotent:** the Task 6.3 rerun wrote zero rows.
8. `7 of 7 caught` from the mutation harness (measured: 7 of 7 on the rule, 9 of 9 on the wiring); existing identity-resolver checks equal before and
   after; deploy run success, id printed.

**What this does not prove, stated where it is read:** two dates, 93 soccer rows, committed
contexts from August and September, not a season; no row for UEFA competitions was in either date
(the six labels above are all it measures); and the scheduled-hook trigger line itself is exercised
offline, not by a live cron.

## TASK 7 — Outbox manifest (last)

`outbox/cc-session-2026-10-27-bsd-event-id-on-game-rows.md` (≥1500 characters): commit hashes, the
deploy run id, the done-condition artifact pasted in full, Task 0's answers (the hook chosen, how
the admin route authenticates, BSD's rate limit), the alias count, the mutation output, and any
genuine residual (an upstream failure only, not deferred work). The laboratory's consumer CC-CMD is
unblocked when this one is DONE.

## Addendum 2026-11-24 — the UEFA labels: archive rows with ESPN ids and no BSD id (measured; the join is not extended)

**Why this is here (BUILD-ON-A).** The laboratory's `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md` (Task 0, 2026-11-24) read `/context/date` for 78 days and counted rows by sport label. It is a finding about this CC-CMD's scope line, `BSD_SOCCER_SPORTS` (six labels), so it is recorded here, not filed again. Artifact: `outbox/bsd-e2-reach-2026-11-24T17-07-10-057Z.json` (= `bsd-e2-reach-latest.json`), run 2 of `.github/workflows/espn-task0.yml`.

- **The scope was a measurement gap, not a ruling.** This CC-CMD measured six labels and says "no row for UEFA competitions was in either date". The archive does hold them: rows labelled `UEFA Champions League` 72, `UEFA Europa League` 72, `UEFA Europa Conference League` 54, and the three Qualifying labels 11, 24 and 48, over the 78 days read; **every one carries an `espn_event_id` and none carries a `bsd_event_id`**, because `joinGameToBsd` returns `not-soccer` for them and `runBsdGameJoinForDate` never selects them.
- **What it costs the laboratory.** 51 of the 238 matches the next-goal grade covers are `ucl` or `europa` matches (R2 directories), and none reaches its ESPN match through this join. The EFL Championship is a different case: 0 archive rows in the same 78 days (not archive-written; `UNDECIDED` in `src/seed-manifest.js`), so adding it to the sport list would change nothing.
- **Not done, and why.** Extending `BSD_SOCCER_SPORTS` to the UEFA labels is an owner decision with its own measurement, because the 97 of 97 club-name probe of the 2026-11-08 addendum covered the five domestic leagues only (`resolveTeamKey` returns the stripped name for a club with no alias, so BSD-and-ESPN spelling agreement for UEFA clubs is unmeasured). BSD league ids 7 and 8 are shared (`ucl` with `uclqual`; `europa` with `conference`, `europaqual`, `conferencequal`), so one BSD league id can span more than one archive label; the existing event-day matching is by team names, not by league, so this does not break it, but it widens the candidate set.
- **Done 2026-11-25** on the owner's "build both next": see "Addendum 2026-11-25" below. (This line said: **Unblocked when** the owner says to extend it.) **Verify with** the query `SELECT sport, COUNT(*), COUNT(bsd_event_id) FROM regular_season_games WHERE sport LIKE 'UEFA%' GROUP BY sport` returning a non-zero second-column share, and the laboratory's reach probe (dispatch `espn-task0.yml` with `parts` = `reach`) reporting a lower "ucl or europa: archive rows, outside the join's sports" count.

## Addendum 2026-11-25 — the UEFA labels and the EFL Championship are on the join (built on the owner's "build both next"; owner decisions taken on Claude's recommendation, stated here)

**Why this is here (BUILD-ON-A).** The 2026-11-24 addendum above recorded the UEFA labels as an owner decision with its own measurement. The owner said "build both next" (the UEFA join, and the EFL Championship seed) and, mid-turn, "any other outstanding decisions, go with Claude's best recommendations and state what they are". Nothing in the rulings above is undone: the join's rule (`src/bsd-game-join.js`: soccer label only, both sides through `resolveTeamKey` in one orientation, exactly one candidate, kickoff may refuse and never choose) is untouched; only the label list and the alias table grew.

**Outcome of this addendum:** done 2026-11-25. Both halves built, deployed and run in production; every done condition below is an artifact. (The document's one Status line is at the top; a second would be read as overriding it.)

### Decisions taken (Claude's recommendation, each with its reason)

1. **Seed `EFL Championship` only** (`eng.2`, LEAGUES row in `src/index.js`, label equal to `SOCCER_LEAGUE_LABELS`). `eflone` and `efltwo` stay `UNDECIDED` in `src/seed-manifest.js`: the laboratory's grade needs the Championship (19 matches, 25 calls), the other two are not asked for, and each seeded league costs a daily ESPN read and a D1 row stream. *(Superseded the next day for League One and League Two: seeded, see "Addendum 2026-11-26, part 2" below.)*
2. **All six UEFA labels go on the join list**, the archive's own spellings (the cron's LEAGUES rows, verbatim). The three Qualifying labels carry 83 rows between them; leaving them off would have left the same gap this addendum closes.
3. **Per-club aliases, not a fuzzy matcher.** 64 UEFA and 13 EFL Championship entries in `src/identity-resolver.js`, BSD form to archive form. Each was derived from a row the join left unmatched and checked in both orientations; none from a kickoff. A matcher that guesses is the thing the rule refuses.
4. **The STOP of the measure script (>40 distinct unmatched clubs) was passed, once, on purpose.** The 64 clubs behind the UEFA gap are one structural cause (ESPN short names against BSD long names, and club names no domestic league has), not 64 independent failures; the check pins the outcome (302 of 302) so a dropped alias is a red check.
5. **The EFL Championship history is backfilled** for the season so far (`.github/workflows/archive-league-history-backfill.yml`, `scripts/run-archive-league-history-backfill.mjs`: ESPN's scoreboard per date, completed events only, `POST /archive/game`, dry-run by default). 200 rows were written, 0 failed. The script sends `X-FIELD-Relay` although the route is open today; it is listed as a caller in `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md` so that gating the route (ruled, blocked on secret rotation) breaks nothing.
6. **The join backfill's "stuck" rule is corrected** (`isStuck` in `scripts/bsd-backfill-lib.mjs`). A date attempted before 2026-11-25 had answered for six labels; 29 of the 56 dates holding UEFA and EFL rows were in that state and would have been called stuck and never attempted. A day is stuck only when every sport still pending on it was a sport that attempt asked about; an entry without a `sports` list asked about the six legacy labels (a fixed list, not the join's); new entries record the join's labels. Ruling kept: an answered date that still has rows pending is not re-spent on.
7. **The production join backfill ran over 2026-05-20 to 2026-11-23** (not the schedule's default end of 2026-10-23, which would have left 31 days of rows unjoined, since the scheduled tick reaches only yesterday and the next days). It fills `bsd_event_id` where NULL, never overwrites, one `change_log` row per write, the same function the tick runs. The completion marker `outbox/bsd-join-backfill-complete.json` is untouched: this run was range-complete, not the scheduled scope.
8. **`EFL Cup` (81 archive rows) and `EFL Trophy` (98) are not on the join.** They exist in the archive with no `bsd_event_id` and nobody has asked for them; recorded, not built. *(Superseded the next day: the owner asked, and the EFL Cup is on the join; see "Addendum 2026-11-26" below. The EFL Trophy is not, and why is measured there.)*

### Measurements (every number from a command; the fixtures are committed)

| | rows | dates | BSD events read | label alone | with aliases |
|---|---|---|---|---|---|
| UEFA, six labels (`outbox/fixture-bsd-game-join-uefa.json`) | 302 | 24 | 2505 | 103 of 302 (0 before the labels were on the list) | **302 of 302** (64 aliases) |
| EFL Championship (`outbox/fixture-bsd-game-join-eflchamp.json`) | 200 | 40 | 11561 | 42 of 200 | **200 of 200** (13 aliases) |

No BSD event joined to two rows in either fixture, and every pair is inside the 180-minute kickoff refusal (`scripts/check-bsd-uefa-join.mjs`, 20 checks; `scripts/check-bsd-eflchamp-join.mjs`, 12 checks). `scripts/mutate-bsd-uefa-join.mjs` deletes each alias, takes each label off the list and breaks the join's rule on a copy: **92 of 92 caught** (74 on the UEFA block, 18 on the EFL block), controls ok. Identity checks after the aliases: 452 pairs across 5 tables, 1 colliding key and it was already recorded, 0 silent; team identity per club; ambiguous-key check 43 of 43; the five in-place harnesses pass on a clean tree.

### Done conditions (Rule 89, artifacts)

1. **Deploy green with the labels and aliases:** Deploy RELAY Worker run `45720223494` on `4816483`, conclusion success (the run before it, `45716990214` on `551b461`, failed at the empty-catch gate, 114 against a baseline of 112, from two bare `.catch(() => null)` in the new backfill script; fixed in `4858568` and verified by step 46 of the next run).
2. **Production join, dry run then real:** dry run `45722117944` read 188 of 188 days (0 unread) and planned 54 days / 476 rows; the real runs `45722809883`, `45723395679`, `45723991256`, `45724579421`, `45725166942`, `45725759174` posted 10, 10, 10, 10, 10 and 4 dates, wrote 66, 80, 60, 101, 145 and 24 rows (476), **54 of 54 dates verified** by a cache-busted re-read, 214 upstream BSD pages (cap 50 a run), no stop. Artifacts: `outbox/bsd-join-backfill-2026-11-2*.json`, `bsd-join-backfill-latest.json`, `bsd-join-backfill-state.json`.
3. **The archive says so** (run `45726381021`, `outbox/archive-label-dates-2026-11-26T00-07-11-213Z.json`, `regular_season_games`, rows / joined): UEFA Champions League 91 / 91, Europa League 73 / 73, Europa Conference League 55 / 55, Champions League Qualifying 11 / 11, Europa League Qualifying 24 / 24, Europa Conference League Qualifying 48 / 48 (**302 of 302**); EFL Championship 204 / 204 (the 200 of the fixture, plus 4 rows of 2026-11-25, a date outside the backfill's range of 2026-05-20 to 2026-11-23: the scheduled tick joined those, the route having no other caller). `EFL Cup` 81 / 0 and `EFL Trophy` 98 / 0, as stated in decision 8.
4. **The laboratory's consumer** (`field-laboratory` `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md`, "UEFA and EFL Championship result"): the reach probe and the grade re-run on the new joins; their numbers are recorded there, with the run ids.

**What this does not prove, stated where it is read:** the 302 and 200 are the archive rows of the dates and labels read, not a season of every competition; the aliases are the clubs those rows named, so a club that first appears in a later UEFA round without an alias will be `unmatched` (counted, never guessed) until one is added; the scheduled tick's own join of a fresh UEFA or EFL row is exercised only for the rows of 2026-11-25 it joined since the deploy (a date outside the backfill's range), not for a whole matchday.

## Addendum 2026-11-26 — the EFL Cup is on the join; the EFL Trophy is not, because BSD has none of its matches (measured; built on the owner's "join EFL Cup and Trophy")

**Why this is here (BUILD-ON-A).** Decision 8 of the 2026-11-25 addendum left both off and said nobody had asked; the owner asked. Nothing above is undone: the join's rule is untouched, only the label list and the alias table grew, and no CC-CMD held a ruling on either competition (`docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md` made them ESPN-archived, with `bsdLeagueId: null` for the reason "no BSD id was verified", which was true on 2026-08-08). **Outcome of this addendum:** done 2026-11-26; Cup joined in production, Trophy left off with the measurement that says it cannot join.

### The premise that did not hold, found by the probe before the build

The ask named two competitions as if one answer served both. The relay's registry (`src/index.js`, `eflcup` and `efltrophy`) carries `bsdLeagueId: null` for both. BSD's own league list (`outbox/bsd-leagues-2026-11-04T16-25-21-491Z.json`, 98 football leagues) holds **`Carabao Cup (England)` as league 40 and no Trophy**. The fixture then showed what each is worth.

### Measurements (the fixture is committed: `outbox/fixture-bsd-game-join-eflcups.json`, 27 dates, 179 archive rows, 3720 BSD events, captured on a runner)

| | rows | on the list alone | with aliases |
|---|---|---|---|
| EFL Cup | 81 (15 dates, 2026-08-07 to 2026-10-29) | 43 of 81 | **81 of 81** (29 aliases) |
| EFL Trophy | 98 (16 dates, 2026-08-18 to 2026-11-25) | 0 of 98 | 0 of 98: 97 have no BSD event at all, 1 a one-sided look-alike |

The 38 Cup rows the join left unmatched were 36 with one candidate whose two names both looked like the row's and 2 with one side looking like it; the 29 aliases are the clubs behind them (ESPN's short names for the lower-league sides the cup draws: `Wimbledon`, `Oxford Utd`, `MK Dons`, `Sheffield Wed` against BSD's full ones), none read from a kickoff. The Trophy rows were also run **relabelled to a label that is on the list**: none joined, so the label being off the list is not what keeps them unjoined; BSD does not carry them. `scripts/check-bsd-eflcup-join.mjs` pins both halves (15 checks, 81 of 81, Trophy not on the list, relabelled Trophy 0 of 98); the shared harness `scripts/mutate-bsd-uefa-join.mjs` now covers three blocks, **127 of 127 caught**, including a copy with EFL Trophy put on the list. The identity checks pass (481 pairs, 1 colliding key, already recorded; 43 of 43; the five in-place harnesses on a clean tree).

### Decisions taken (each with its reason)

1. **EFL Cup on the join, 29 aliases, per-club, never fuzzy** (same rule as the 2026-11-25 blocks).
2. **EFL Trophy NOT on the join.** A label on the list makes the scheduled tick and the backfill select its pending rows and fetch BSD pages for them; 97 of 98 have no event to find. It stays `archived, unjoined`, which is what it was.
3. **`bsdLeagueId` for `eflcup` stays `null`.** The registry comment said no BSD id was verified; it now says league 40 exists (`src/index.js`, comment only). Setting the id would turn on the BSD endgame capture for the competition (BSD requests and R2 writes through `BSD_LEAGUE_ID_TO_SLUG`), a decision of its own and not part of a join. **Unblocked when** the owner says to capture the Carabao Cup. **Verify with** `grep -n "eflcup" src/index.js` showing `bsdLeagueId: 40` and the next BSD capture listing an `eflcup` directory. *(Done the same day, on the owner's "Capture the carabao cup": `bsdLeagueId` is 40; see `docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md`, "Addendum 2026-11-26".)*
4. **The backfill check reads the join's label list** instead of pinning it (`scripts/check-bsd-game-join-backfill.mjs`). It had pinned the list twice, and adding a label to the join turned it red both times (the first dry run of this addendum failed in its `verify` job, run `45738302213`, for exactly that). The exact list is pinned once, in `scripts/check-bsd-uefa-join.mjs` (fourteen, named). The harness is unchanged and still 39 of 39 on the new check.

### Done conditions (Rule 89, artifacts)

1. **Deploy green with the label, the aliases and the comment:** Deploy RELAY Worker run `45736596584` on `ad78c6b`, success.
2. **Production join, dry run then real:** dry run `45739021423` read 109 of 109 days (0 unread) and planned 15 days / 81 rows (0 attempted before and still pending); the real runs `45739449236` and `45739985721` posted 10 and 5 dates, wrote 68 and 13 rows (81), **15 of 15 dates verified** by a cache-busted re-read, 44 upstream pages, no stop. Artifacts `outbox/bsd-join-backfill-2026-11-26T02-0*.json` and `bsd-join-backfill-latest.json`.
3. **The archive says so** (run `45740510062`, `outbox/archive-label-dates-2026-11-26T02-09-41-342Z.json`, rows / joined): **EFL Cup 81 / 81**, EFL Trophy 98 / 0 (as decided), EFL Championship 204 / 204 (unchanged).

**What this does not prove, stated where it is read:** the 81 are the Cup rows of 15 dates, 2026-08-07 to 2026-10-29; rows of later rounds are joined by the scheduled tick, which visits yesterday and the next three days (not exercised for the Cup yet); a club first drawn in a later round without an alias is `unmatched`, counted and never guessed, until one is added; the Trophy finding is a measurement of 27 dates, and a later BSD change would need a new capture.

## Addendum 2026-11-26, part 2 — EFL League One and League Two are seeded; the EFL Trophy stays archived and unjoined (decided on "go with Claude's best recommendations")

**Why this is here (BUILD-ON-A).** Decision 1 of the 2026-11-25 addendum left `eflone` and `efltwo` UNDECIDED, and the report of 2026-11-26 listed them, and the EFL Trophy, as open. The owner said to take Claude's best recommendation on both. No ruling is undone: the manifest's `UNDECIDED` entries were declarations waiting for a decision (`src/seed-manifest.js`), and nothing in a CC-CMD held a position on either league. **Outcome of this addendum:** League One and League Two seeded and backfilled; the Trophy left as it is, with its detector named.

### Decision 1 (the open item "League One and League Two"): SEED BOTH

The evidence, each read by a command on 2026-11-26:
1. **The product already writes briefs for these games and the archive holds no game for them.** `GET /archive/query?sport=EFL%20League%20One&source=client&limit=1` says `total` 208, and with no `source` filter also 208; `sport=EFL%20League%20Two`, 94 and 94; `source=cron` for League One, 0. So all 302 are `night_owl` briefs the client posted, against 0 game rows (`/archive/query` reads the briefs table). That is the state the seed manifest exists to forbid in spirit: a competition the product serves and the archive does not hold.
2. **Everything but the cron row already carried both leagues.** `V2_LEAGUES.eflone` and `.efltwo` (`eng.3`, `eng.4`), `SOCCER_LEAGUE_LABELS` (`'EFL League One'`, `'EFL League Two'`), the morning report's soccer family (`src/morning-report.js`), and `LOWER_SOCCER` in `src/analytics-engine.js`, which keeps both out of the Phase 12 quality alerts because they have no analytics layer. Only the `LEAGUES` row was missing.
3. **Cost.** A seeded league adds one ESPN scoreboard read a day. The cron then writes about two short Haiku briefs per game played after the seed (`game_recap` and `game_live`: the EFL Cup holds 168 briefs on 81 rows, the Trophy 192 on 98). The history backfill starts no brief: the Championship's 200 backfilled rows carry 4 `source=cron` briefs in all, the 4 matches played after it was seeded. At about 190 matches each to date and roughly 550 in a season, that is on the order of a thousand short calls per league per season; not priced in currency here.
4. **It is reversible.** Moving a league to `EXCLUDED` in the manifest and removing its row stops the daily read; the rows and briefs already written stay.

Recommendation taken: both leagues, as rows of the cron's `LEAGUES` table, labels identical to `SOCCER_LEAGUE_LABELS` (the reason on the EFL Cup row: the label forms the archive id prefix). **Not done, and why:** no `bsdLeagueId` and no BSD join for either. BSD's league list does hold League One (86) and League Two (87) (`outbox/bsd-leagues-2026-11-04T16-25-21-491Z.json`), so "no BSD coverage" in the registry comment was stale and is corrected; but a `bsd_event_id` on these rows has no reader (the next-goal grade's nine slugs are not these), and an id in the registry turns on the endgame capture (BSD requests, R2 writes) that nothing consumes. **Unblocked when** a consumer asks for either. **Verify with** the procedure of the Cup: `read-archive-label-dates.yml` for the dates, `bsd-game-join-fixture-dates.yml` for the fixture, `scripts/measure-bsd-game-join.mjs`.

### Decision 2 (the open item "EFL Trophy"): NO CHANGE, the detector is the monthly BSD leagues watch

The Trophy stays archived (98 rows) and unjoined (BSD holds none of its matches: 0 of 98, measured on 27 dates). Nothing new is built. The detector already exists: `bsd-leagues-baseline.yml` enumerates every BSD competition on the 4th of each month at 08:23Z and diffs against the last reading (`outbox/bsd-leagues-<ts>.json`, field `diff.added.football`). **Unblocked when** a Trophy league appears in that diff. **Verify with** `node -e "const a=JSON.parse(require('fs').readFileSync('outbox/bsd-leagues-<latest>.json','utf8')); console.log((a.diff.added.football||[]).filter(x=>/trophy/i.test(x)))"` returning a non-empty list; the steps are then the Cup's (fixture, measure, aliases, label, backfill). No scheduled task is armed for it: a monthly session poll would cost a session each month to watch an event nobody needs yet, and the watch already runs.

### Built

`LEAGUES` gets `{eng.3, 'EFL League One'}` and `{eng.4, 'EFL League Two'}`; `src/seed-manifest.js` has nothing UNDECIDED in the EFL pyramid; `scripts/check-individual-sports-not-archived.mjs` pins 26 entries; `scripts/check-leagues-label-contract.mjs` has an empty allowlist (it still listed the Championship as uncovered). The seed-coverage, seeded-label, label-contract, brace, citation, provenance and empty-catch checks pass, as do the five in-place identity harnesses on a clean tree and `mutate-seed-coverage.mjs` (6 mutations).

### Done conditions (Rule 89, artifacts)

1. **History, dry run then real**, `archive-league-history-backfill.yml`: dry runs `45861264126` and `45861270864` read 117 of 117 scoreboards for each (HTTP 200), 179 completed League One matches and 188 League Two, 0 archived; real runs `45862012111` (League One) and `45862018532` (League Two) wrote **179 and 188 rows, 0 failed**, and the artifacts' `archiveAfter` say 179 and 188 scored. `outbox/archive-league-history-backfill-efl-league-{one,two}-2026-11-26T16-*.json`.
2. **The archive says so** (reader run `45862908281`, artifact `outbox/archive-label-dates-2026-11-26T16-53-49-531Z.json`, rows / joined): **EFL League One 179 / 0** (30 dates, 2026-08-15 to 2026-11-24), **EFL League Two 188 / 0** (21 dates, same span), EFL Championship 204 / 204 (unchanged), EFL Trophy 98 / 0 (as decided).
3. **Deploy:** Deploy RELAY Worker run `45861985679` on `efa06fa`, success, with `check-archive-date-keying.mjs` run against the new rows; Repo guards `45861985700`, success.

### Found, not in scope (and filed, Rule 87.4)

Reading the 302 briefs showed the client's Night Owl wording for soccer is wrong in a way the data cannot be: "a 4-points margin" for a 4-0 league match, "a 0-points margin" for a 1-1 draw, "series record" in league fixtures. The cause is read in the client's code, not yet measured: a margin-unit chain that tests `includes('soccer')` on a `_sport` that is usually a display label. Filed as jubilant-bassoon `docs/CC-CMD-2026-11-26-night-owl-soccer-margin-unit.md` (commit `5c8eda9`) with the evidence, a probe block that counts the wording per label and reads the real `_sport` strings before any code change, the fix design and a done condition that is a count of zero. **Not built here, on purpose:** the fix's correctness rests on the set of `_sport` strings the live page holds for every soccer competition, which is unmeasured, and the first two briefs read already show both "points" and "goal" for the same league; a blind patch to the client would be a guess.

**What this does not prove, stated where it is read:** the 179 and 188 are the finals ESPN's scoreboards held for 2026-08-01 to 2026-11-25, not a promise of every match in the pyramid; matches played after the deploy come in through the cron's yesterday catch-up, not exercised for these two leagues yet; the cost line is a count of briefs, not a price.

## Addendum 2026-11-27 — the 4 unreached UEFA matches re-checked: still 4; the cron-lag explanation is refuted; ESPN lists 4 completed May matches the archive never held (measured; the write waits for the owner)

The follow-up armed 2026-11-26 ("Re-check the 4 unreached UEFA matches"). Everything below is a runner read, counts only; BUILD-ON-A: it extends the "4 matches still unreached" item of Addendum 2026-11-25 and the laboratory's `docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md` ("Re-check 2026-11-27").

**Read.**
- **Reach** (`espn-task0.yml`, `parts` = `reach`, run `45918323855`, `outbox/bsd-e2-reach-2026-11-27T00-44-27-518Z.json`; 12 BSD calls, 269 reads, no stop): 256 matches, **4 unreached, the same 4** (`ucl` 3 of 39, `europa` 1 of 28), `zeroReasons` "ucl or europa: no archive row of its labels on the call days": 4.
- **Archive** (`read-archive-label-dates.yml` with `like` = `UEFA%`, run `45918622414`, `outbox/archive-label-dates-2026-11-27T00-45-56-190Z.json`): the newest matchdays are in and joined (UCL 2026-11-24 and 11-25; Europa and Conference 2026-11-26, 36 rows added), **338 of 338 UEFA rows have a `bsd_event_id`**. So the 4 are not the cron lagging behind a matchday.
- **Dry-run history backfills** (`archive-league-history-backfill.yml`, `dry_run` true, nothing written): 2026-09-01 to 11-25, `uefa.champions` 90 completed events, 90 already archived; `uefa.europa` 72 and 72 (runs `45918749638`, `45918756744`). 2026-05-01 to 08-31: ESPN lists **3 completed events per league, the archive holds 1 of each** (the two finals, its first UEFA rows); the Champions League log names the days **2026-05-05 and 2026-05-06** (runs `45919006199` for the Champions League and `45919009386` for the Europa League; the Europa League days were not read).

**Not established.** That those 2 `ucl` and 2 `europa` events ARE the 4 unreached matches: the reach artifact holds no dates (counts only, by design), the totals match (4 and 4) and the split does not (3 and 1 against 2 and 2). Nothing here asserts the cause; the next step is the experiment that decides it.

**DONE 2026-11-27 (was STAGED under Rule 74), the write.** Marked done on the owner's instruction ("Mark the claim done", 2026-11-27, given to the AFLW session): the write ran at about 01:56Z and is recorded as done in the Addendum 2026-11-27, part 2, below, with the archive counts (93 and 93, every row joined). That addendum also records that the done condition's second half, the reach re-run printing zero, was NOT met (the reach still says 4, so the 4 unreached matches are not these rows); this marker says the staged write is done and says nothing more, and that question stays open there. The text that follows is the claim as it was written, kept as the record. What: 2 `UEFA Champions League` rows (2026-05-05, 2026-05-06) and 2 `UEFA Europa League` rows (the two semi-final second legs, May 2026) written with the history backfill's own field mapping, then joined. Blocked by: a production archive write the owner has not approved (the approval of 2026-11-24 covered the join backfill; the EFL history backfill was approved in the Addendum 2026-11-25 decisions; neither named these rows). Unblocked when: the owner says to write them. Exact dispatches (`archive-league-history-backfill.yml`, `dry_run` = `false`): `league` uefa.champions, `label` UEFA Champions League, `from` 2026-05-05, `to` 2026-05-06; `league` uefa.europa, `label` UEFA Europa League, `from` 2026-05-01, `to` 2026-05-19 (the final of 2026-05-20 is outside it, and an archived event is never written twice). The join needs no dispatch: `bsd-game-join-backfill.yml` runs every 4 hours over soccer rows with no `bsd_event_id`, oldest first.
**Done condition (Rule 89):** after the writes and one scheduled join run, `read-archive-label-dates.yml` (`like` = `UEFA%`) says `UEFA Champions League` 93 rows and `UEFA Europa League` 93, every row joined; and the reach re-run (`espn-task0.yml`, `parts` = `reach`) prints `reach.bySlug.ucl.zero` and `reach.bySlug.europa.zero` equal to **0**. If the rows are written and joined and the reach still says 4, the 4 are not these matches: investigate first (Rule 77), starting from the call days `zeroReason` uses (`scripts/espn-task0-lib.mjs`), and do not write anything further.

### Addendum 2026-11-27, part 2 — the May rows written and joined; the reach still says 4; the qualifying rounds are the next measured candidate (the owner's "Write the May UEFA rows")

**Done, as approved.** `archive-league-history-backfill.yml`, `dry_run` false: `uefa.champions` 2026-05-05 to 05-06 wrote **2 rows, 0 failed** (`outbox/archive-league-history-backfill-uefa-champions-league-2026-11-27T01-56-26-440Z.json`); `uefa.europa` 2026-05-01 to 05-19 wrote **2 rows, 0 failed** (`...europa-league-2026-11-27T01-56-56-001Z.json`). The join backfill (`bsd-game-join-backfill.yml`, dispatched once, `dry_run` false, the approved job: NULL rows only) joined them: run `45925492236`, `outbox/bsd-join-backfill-2026-11-27T01-59-26-477Z.json`, 3 dates, **4 rows written, 3 verified**, remaining to attempt 0.

**Done condition, read (Rule 89).**
1. **The archive says so** (`read-archive-label-dates.yml`, `like` = `UEFA%`, `outbox/archive-label-dates-2026-11-27T02-00-20-892Z.json`): `UEFA Champions League` **93 rows, 93 joined** (14 dates, 2026-05-05 to 11-25); `UEFA Europa League` **93, 93** (9 dates, 2026-05-07 to 11-26); all six UEFA labels **342 of 342 joined**. Predicted 93 and 93: met.
2. **The reach did not move** (`espn-task0.yml`, `parts` = `reach`, `outbox/bsd-e2-reach-2026-11-27T02-01-35-630Z.json`): `ucl.zero` 3, `europa.zero` 1, `zeroReasons` "ucl or europa: no archive row of its labels on the call days": 4, 256 matches. **Not met: the 4 unreached matches are not the May matches.** As this CC-CMD said it would, nothing further was written.

**Investigated before anything else (Rule 77), read-only.** The reach lib's `SLUG_LABELS` counts the Qualifying labels as the slugs' own (BSD league 7 is shared by `ucl` and its qualifying, 8 by `europa`, `conference` and theirs), and the archive's first qualifying row is 2026-08-19. Dry-run history backfills over **2026-06-20 to 2026-08-18** (`dry_run` true; runs `45926041547`, `45926049062` and one re-dispatch, the third having been cancelled by the workflow's one-pending-run concurrency rule): ESPN lists **79 completed `UEFA Champions League Qualifying` events, 56 `UEFA Europa League Qualifying` and 210 `UEFA Europa Conference League Qualifying`, and the archive holds 0 of the 345** (`outbox/archive-league-history-backfill-uefa-*-qualifying-2026-11-27T02-04-*.json`, `...T02-45-49-843Z.json`). So if the 4 unreached matches are qualifying matches played before 2026-08-19, there is no archive row of their labels on their call days: the reach's own reason, exactly.

**Not established.** That they are. The reach artifact is counts only and holds no dates. The decisive read costs no write and releases no match identity: one more counts-only partition in the reach (the zero matches whose first call day is before the archive's first row of the slug's labels, a boolean per match like the existing `early` split against `BOUNDARY_DAY`). **Not recommended:** writing the 345 qualifying rows to find out. It is a production write 86 times the size of the one approved, the owner has not been asked, and it would not be needed if the boolean read answers.

### Addendum 2026-11-27, part 3 — last season's UEFA results are not in the archive (measured, read-only); the use is the laboratory's UEFA forecast, filed there

The owner named the surfaces ("Laboratory and tonight") and said "Yes" to a UEFA forecast on tonight's cards; the CC-CMD is the laboratory's `docs/CC-CMD-2026-11-27-uefa-forecast-on-tonights-cards.md` (BUILD-ON-A: nothing here is re-specified). The measurements are this repository's `archive-league-history-backfill.yml`, `dry_run` true, nothing written: **2025-09-01 to 2026-04-30, ESPN completed vs archived: `uefa.champions` 186 / 0, `uefa.europa` 186 / 0, `uefa.europa.conf` 150 / 0 (522 matches; the archive's earliest UEFA row is 2026-05-05)**; 2026-05-01 to 11-25 `uefa.europa.conf` 57 / 55 (the other two competitions are complete after the 2026-11-27 May rows). The 345 qualifying events of Addendum 2026-11-27 part 2 are not needed by a league-phase table and stay unwritten.

**STAGED** (verifier: uefa_history_written @ relay/staged-verification.yml) Rule 74, the write. What: the 522 matches plus the 2 Conference League May rows, `archive-league-history-backfill.yml` with `dry_run` false, one run per competition (`from` 2025-09-01, `to` 2026-04-30; the Conference League's May rows `from` 2026-05-01, `to` 2026-05-19), the `league` and `label` exactly as the cron writes them. Blocked by: the owner's word for a 524-row production write (a statement that history is valuable was said, correctly, to be a discussion point and not a directive). Unblocked when: the owner says to write them. Side effect to state first: `bsd-game-join-backfill.yml` (range from 2026-02-01) will pick up the February to April rows and spend BSD pages on them; rows before 2026-02-01 stay unjoined, which a results-only forecast does not need. Verify: `read-archive-label-dates.yml` with `like` = `UEFA%` reads `UEFA Champions League` 279 rows, `UEFA Europa League` 279, `UEFA Europa Conference League` 225; the same dry runs then print `alreadyArchived` equal to `completed`. **Machine check (added 2026-11-27, the verifier named above):** the all-time totals just named are a snapshot that the cron raises every matchday, so check 16 of `scripts/verify-staged-items.mjs` counts four closed date windows instead (scored rows, both game tables, exact label), each against ESPN's completed count from the dry runs of 2026-11-27: `UEFA Champions League` 186 and `UEFA Europa League` 186 and `UEFA Europa Conference League` 150 for 2025-09-01 to 2026-04-30, and the Conference League 57 for 2026-05-01 to 2026-11-25 (55 archived; the 2 May rows are the rest). It reads PENDING until the owner says to write, PARTIAL while some of it is written, PASS when all four match, and FAIL if any window holds more rows than ESPN lists. Concurrency note: the workflow keeps one pending run per group, so dispatch one run, wait, dispatch the next (a third dispatched together was cancelled on 2026-11-27).

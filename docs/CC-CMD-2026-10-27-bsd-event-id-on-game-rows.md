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

Three corrections this work produced, recorded so the document is not read as still-true:

1. **9 of the 12 oracle row ids exist in the live archive**, not 12. The artifact names the other three
   (`2026-08-29-mls-min-orl`, `-skc-van`, `-hou-sj`); the 9 present are all correct.
2. **A same-teams twin a day later is `ambiguous`, not "refused".** Kickoff never chooses between
   candidates; it only refuses (owner ruling 2026-10-19).
3. **The archive holds two rows of one fixture under two id schemes**, and both carry the one event id (11
   events shared by two rows). That is correct for this field.

Still open, and said where it is read: the once-per-day pass has not been observed live (Task 4's own
limitation below); the session doc carries its unblock criteria and the query that reads it.

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
- One call from the scheduled handler Task 0 chose: window today-1 to today+3, **once per UTC day
  per date** through a KV marker with a 36 h TTL, capped at 24 upstream pages per run (Rule 78),
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

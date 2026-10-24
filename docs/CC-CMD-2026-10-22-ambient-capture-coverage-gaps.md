# Claude Code Command — AmbientDO cannot see two kinds of kickoff, so their closing lines are never captured

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a designed capture that does not run), and a spend decision
**Confidence gate:** >= 95 before any commit
**Status:** DONE. TASK 0 and TASK 1 deployed 2026-10-22 19:15Z (run
39837727213). Done condition 3 passed on closed day 10-23 (run 40088714137,
0.8x). NBA lines are still not bought: its board is empty in season, owned by
`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`. Resumed by the owner,
"resume coverage gaps now".
**Filed by:** TASK 0 of `docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`,
Rule 87.4. That CC-CMD fixes the over-capture and changes neither gap below.

---

## What was measured

On 2026-10-20, 10 games in an AmbientDO sport kicked off. The capture
(`ambientCaptureClosingOdds`) charged 0 credits that day. Two separate gaps
account for all 10.

### Gap 1: NBA and NHL are not polled in October (8 of the 10)

`src/ambient-do.js`, `SPORT_ACTIVE_MONTHS`:

```js
'nba':        [0,1,2,3,4,5,6],           // Oct–Jun
'nhl':        [0,1,2,3,4,5,6],           // Oct–Jun
```

- `[0..6]` is January to July, and the comment says Oct–Jun.
- `getUTCMonth()` is 9 in October, so `_poll` never fetches either sport. The
  same holds in November and December.
- The 8 games: NBA at 19:00Z and 23:00Z, NHL at 01:00Z and six at 23:00Z.

### Gap 2: a kickoff from 00:00Z to about 04:00Z is never on a board the poll reads (2 of the 10)

- `_poll` asks for `/v2/games?sport=X&date=<UTC date>` (`_todayUTC()`).
- The relay's board is keyed by the ET date. Probed 2026-10-22 through the
  relay self-probe:
  - `/v2/games?sport=mlb&date=2026-10-20` returns 0 games;
  - `date=2026-10-19` returns `espn:401908028`, with `start`
    `2026-10-20T00:00Z`.
- Before 00:00Z the game is on the board the poll reads, but it reads `pre`.
- From 00:00Z the poll reads the next UTC date's board, which does not list
  it. So the game never reads `live` in AmbientDO, and its pre→live transition
  never fires.
- The 2 games: MLB and WNBA, both at 2026-10-20T00:00Z.
- The window is not measured. It runs from 00:00Z to the end of the ET day in
  UTC: 04:00Z in daylight time, 05:00Z in standard time.

This gap also stranded entries. A game that is live at 00:00Z leaves the board
mid-game and never reads final. Until the 10-21 CC-CMD's prune, nothing removed
such an entry.

**What is left after that prune** (found by its second review, 2026-10-22).
The prune keeps an entry for 6h after its last board, deliberately: a blink, a
failed fetch, or this gap must not drop a game that is still being played. The
entry keeps its last reading, so for up to 6h it is served as `live` with its
00:00Z score:
- in `/ambient/state` `liveGames`;
- in the SSE `connected` payload.

The client's `connected` handler (jubilant-bassoon `src/legacy/field.js`,
about line 28353) writes that score into the card. So every SSE reconnect
shows the stale score until the client's next poll, 20–45 s later.

- **Who is affected:** NHL games at 23:00Z every night of the season, and any
  MLB or WNBA game live at 00:00Z.
- **A second path:** an MLB/WNBA source failover leaves the abandoned id
  (`mlbam:`, `wnba:`) live the same way
  (`docs/CC-CMD-2026-10-22-capture-record-keyed-by-source-id.md`).
- **Compared with HEAD's code:** HEAD served these entries live forever, so
  this is not a regression.

Fixing gap 2 removes the date-turn cause for the ESPN sports. Independently,
the two live views could leave out entries no board has listed for more than
a couple of polls, while keeping them for the capture dedup and for
`all_final`. That is TASK 1's third item below.

## TASK 0 — premises, one command each

1. **Gap 1 is the only reason NBA/NHL are absent.** Run `_poll` with month
   pinned to 9 and print `active`. Pass if `nba` and `nhl` are missing and
   every other in-season sport is present.
2. **Gap 2 covers every ESPN-sourced AmbientDO sport, not only MLB.** For one
   00:00Z–04:00Z kickoff in each of `nba`, `nhl`, `wnba` and `mls`, read the
   UTC-date board and the ET-date board through the relay self-probe. The NBA
   board is `nbaSource: 'cdn'` and the NHL board is `nhleSource`, so they may be
   keyed differently from ESPN's.
3. **What the capture would cost.** Count the distinct (sport, kickoff instant)
   pairs for NBA and NHL over 2026-10-14..20 from the archive, times 3 credits.
   This is the added spend if gap 1 is fixed.

## TASK 0 — results (2026-10-22)

Dispatched by the owner 2026-10-22 ("next approved", approving the NBA/NHL
October spend).

1. **Gap 1 is the only filter, but NBA has a second, upstream block.**
   - Running the real `_poll` with the clock pinned shows which sports it
     fetches:
     - 2026-10-20 and 2026-12-15: mlb, mls, the five European leagues, wnba,
       nfl, cfb. **No nba, no nhl.**
     - 2027-01-15: nba and nhl both present.
     Nothing else filters them.
   - **But the relay's NBA board is empty in-season.**
     - `/nba/liveData/scoreboard/todaysScoreboard_00.json` answers
       `403 "nba returned 403"`, read 2026-10-22 about 03:45Z, the night after
       NBA games at 02:00–02:30Z.
     - `/v2/games?sport=nba` answers `count 0, source nba-cdn-empty` for
       10-20, 10-21 and 10-22.
     - `docs/CC-CMD-2026-06-26-nba-cdn.md` treats this 403 as "expected
       off-season". In-season, that premise is refuted.
   - So fixing gap 1 makes AmbientDO capture **NHL** now, and NBA only once
     its board works. Filed:
     `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`. The client's NBA game-id
     map and live box scores read the same route.
2. **Gap 2 holds for every sport that can be tested.** Each kickoff between
   00:00Z and 04:00Z is listed only on the previous day's (ET) board:

   | sport | kickoff | board that lists it | the UTC-date board |
   |---|---|---|---|
   | NHL | 2026-10-21T00:00Z (×2), 01:00Z, 01:40Z, 02:00Z, 02:30Z | `date=2026-10-20` | 2 other games only |
   | WNBA | 2026-10-22T00:00Z | `date=2026-10-21` | 0 games |
   | MLB | 2026-10-20T00:00Z | `date=2026-10-19` | 0 games |
   | MLS | 2026-10-18T00:30Z | `date=2026-10-17` | 1 other game |

   - NBA cannot be tested while its board answers 403. Its adapter reads
     `todaysScoreboard_00.json`, which takes no date at all.
   - The five European leagues had no kickoff in the window in 10-14..20.
   - The relay already has the rule for this: `getFieldDateKey()` in
     `src/index.js` takes the ET date and holds it until 4am ET. Its comment
     records the same failure, measured 2026-07-16 ("naive UTC-midnight
     computation advanced 'today' … mid-primetime"). AmbientDO never
     adopted it.
3. **Cost: the premise as written was wrong.** It priced 3 credits per
   (sport, kickoff instant). The capture buys **3 per game**
   (`docs/CC-CMD-2026-10-22-closing-capture-buys-per-game.md`). From the
   archive, 2026-10-14..20:

   | added by | games | instants | credits/week, per game (actual) | per instant |
   |---|---|---|---|---|
   | gap 1, NHL (NBA blocked by the 403) | 48 | 30 | 144 | 90 |
   | gap 2, MLB + WNBA + MLS kickoffs 00:00–04:00Z | 23 | 12 | 69 | 36 |
   | **total now** | 71 | 42 | **213 (~30 a day)** | 126 |
   | NBA later, when its board works (preseason week) | 26 | 13 | +78 | +39 |

   The NHL 00:00–04:00Z games (22 of 48) are captured only once both gaps are
   fixed.

## TASK 1 — decided from TASK 0

- **Gap 1** is a one-line change, but it **spends credits**, about 3 per
  NBA/NHL kickoff instant (see TASK 0.3). Do not apply it without the owner's
  approval of that spend.
  - With the 10-21 CC-CMD's fix live, this capture buys once per game.
  - `_fetchLiveOdds` would also run for NBA/NHL live games. Its vendor path
    is a 404 that returns before the charge (the deploy gate "the odds-live
    404 path returns before the charge"). Confirm that before relying on it.
- **Gap 2.** Read the board the relay keys games by, not the UTC date.
  - Either ask for the ET date, or ask for both dates between 00:00Z and the
    end of the ET day.
  - Asking for both doubles the self-calls in that window. The ET date alone
    changes which board every other hour reads, so check the boundary at the
    ET midnight too.
- **Stale live views.** `/ambient/state` `liveGames` and the SSE `connected`
  payload leave out an entry whose last board is older than about
  2 × `POLL_IDLE_MS`. The entry stays in `_scores`, for the capture dedup and
  for `all_final`.
  - Before changing the payloads, check what the client does when a game it
    shows live is missing from `connected`.
  - Read CONTRACTS.md first (Rule 86).
- Each item is its own commit.

## TASK 1 — results (2026-10-22)

Resumed by the owner ("resume coverage gaps now") after
`docs/CC-CMD-2026-10-22-closing-capture-before-kickoff.md` (`e658b09`) moved
the purchase before kickoff, one call per sport, onto the right row. That
change already fixed the parked review's G0, G1, G3, G5 and G8. The parked
patch was not re-applied: each item was rebuilt on `e658b09`. Pushed as
`c47aaf0`, deploy run 39837727213, green (Cloudflare 19:15:43Z); Repo
guards green.

| commit | item |
|---|---|
| `4dbb578` | **G4.** `handleV2Games` reads AmbientDO's `X-Ambient-Internal: 1` (sent, never read before) and skips the NHL and NBA brief enqueue for it. A viewer's request still enqueues. `scripts/check-v2-games-ambient-no-briefs.mjs` runs the real worker: 7 checks, 2 red before, 6 of 6 mutations |
| `86363b7` | **G2.** `getFieldDateKey()` steps back one calendar day before 4am ET, not 24 hours; moved to `src/field-date.js` so AmbientDO can import it. `scripts/check-field-date-key.mjs`: 21 hand-written instants and a 43,872-instant sweep; the old body fails at 2027-03-15T04:00-04:45Z only; 6 of 6 mutations |
| `b04f007` | **Gap 2.** `_poll` asks for the slate date and takes the season month from it. S15 (a 02:30Z MLS kickoff on its ET board), S16, S17 (G6), red before |
| `8564f5b` | **Gap 1.** NBA and NHL are polled October to December. S18 (G7: Oct, Nov, Dec and Jan; a due October game of each bought once), red before |
| `bea0f42` | Second review: S16 at the spring-forward hour, S17 inside the EST hold, S19 one instance across the 4am edge; 46 of 46 mutations |
| `515d329` | Second review: per-run mutant filenames, `.mutant-*` ignored |
| jubilant-bassoon `3e489fd5` | The client's `window.TODAY_ISO` had the same 24-hour step; fixed the same way (`fieldTodayIso`), unit-tested, pinned by smoke A-SLATE-1. Pushed after the relay deploy (Rule 70) |

- **Stale live views (the third item): not built.** Gap 2 removes the
  date-turn cause. The failover cause is untested and filed with a premise
  check first: `docs/CC-CMD-2026-10-22-ambient-stale-live-after-failover.md`.
- **Second adversarial review** (5 lenses, 3 refuters per finding). The
  runtime and spend lenses found nothing. 9 findings:
  - fixed: G4's comment and commit message named the journalism cycle as a
    backstop for a different key space; three harness gaps; shared mutant
    paths; commit messages citing pre-rebase hashes; the client's TODAY_ISO;
  - refuted 3 of 3: "the NHL/NBA V2 briefs reach no reader" (the client reads
    the D1 copy through `/context/game`). Its narrow part is real and older:
    `/journalism/game/{id}` misses every prefixed id. Filed:
    `docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md`;
  - GameDO as a second unattended poller (low, older than this work):
    refuted 3 of 3. An idle GameDO hibernates, so its in-memory lastSeen
    refresh does not survive, and it stops polling once nobody watches. Not
    filed.
- **Spend.** About 3 credits per NHL kickoff time (TASK 0.3 counted 30 a week,
  about 90 credits), only for games whose row still needs a line. NBA costs
  nothing while its board answers 403. No new LLM spend: AmbientDO's poll
  starts no briefs.
- **Gates:** 131 of 133 deploy and guards steps on a clean clone. The 2
  failures need a secret or a GitHub list call this sandbox lacks, and fail
  the same way at the base.
- The parked patch, `…coverage-gaps.parked.patch`, is removed: the landed
  commits supersede it.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A harness test, in the style of `scripts/check-ambient-capture-dedup.mjs`,
   for each fixed gap:
   - an October NBA game going live is captured once;
   - a game whose ET-date board is not the UTC-date board is captured once
     at kickoff;
   - if built, an entry no board has listed for 3 polls is absent from
     `liveGames` and `connected`, and present in `_scores`.
   Each is red at HEAD and green after, with a mutation that restores the gap.
3. A per-consumer demand run (`odds-consumer-demand.yml`) on a closed day
   with NBA or NHL games, showing `ambientCaptureClosingOdds` charged above 0
   for that day, and charged/demand at most 2x.

### Live check 1 — 2026-10-22T23:42Z: checked 6 of 6 kickoffs, all pass

The first NHL kickoffs after the deploy (19:15:43Z), NHL being a sport this
change turned on. D1 `cc49101c`:

```
SELECT c.game_id, c.ts, json_extract(c.new_value,'$._kickoff.verified') v,
       json_extract(c.new_value,'$.source') book, g.start_time,
       (g.closing_odds = c.new_value) same
FROM change_log c LEFT JOIN regular_season_games g ON g.id = c.game_id
WHERE c.source = 'closing_odds_capture' AND c.ts >= '2026-10-22 19:15'
```

| game_id | ts | v | book | start_time | same |
|---|---|---|---|---|---|
| NHL_2026-10-22_e401892552 | 22:50:36 | 1 | draftkings | 23:00Z | 1 |
| NHL_2026-10-22_e401892553 | 22:50:36 | 1 | draftkings | 23:00Z | 1 |
| NHL_2026-10-22_e401892554 | 22:50:36 | 1 | draftkings | 23:00Z | 1 |
| NHL_2026-10-22_e401892555 | 22:50:36 | 1 | draftkings | 23:00Z | 1 |
| NHL_2026-10-22_e401892556 | 22:50:36 | 1 | draftkings | 23:00Z | 1 |
| NHL_2026-10-22_e401892557 | 23:20:06 | 1 | draftkings | 23:30Z | 1 |

- One row per kickoff, on its own `_e<espnEventId>` row, found through the
  NHLE board's names (that board carries no ESPN id). Each line was captured
  9.4 to 9.9 minutes before kickoff, is `_kickoff.verified: true`, and equals
  the row's `closing_odds`. No other row was written.
- `odds_budget_site` `ambientCaptureClosingOdds` for 10-22: **6** credits,
  two calls (one per kickoff time), each reconciled at 3 kept. Five games at
  23:00Z cost one call.
- **Correction to the published query.** `change_log.ts` is written as
  `YYYY-MM-DD HH:MM:SS`, with a space. A bound written with `T`
  (`'2026-10-22T19:15'`) sorts after every timestamp of that day and returns
  no rows. The first run of this check used it and read 0 rows; the rows were
  there. The session docs and the scheduled checks now use the space form.

### Live check 2 — 2026-10-23T02:21Z: checked 12 of 12 NHL kickoffs, all pass

The rest of the night, including the kickoffs only gap 2 makes visible. Same
query, `c.ts >= '2026-10-22 23:45'`:

| game_id | ts | v | book | start_time | same |
|---|---|---|---|---|---|
| NHL_2026-10-22_e401892558 | 10-22 23:50:07 | 1 | draftkings | 10-23 00:00Z | 1 |
| NHL_2026-10-22_e401892559 | 10-22 23:50:08 | 1 | draftkings | 10-23 00:00Z | 1 |
| NHL_2026-10-22_e401892560 | 10-23 00:50:13 | 1 | draftkings | 10-23 01:00Z | 1 |
| NHL_2026-10-22_e401892561 | 10-23 00:50:13 | 1 | draftkings | 10-23 01:00Z | 1 |
| NHL_2026-10-22_e401892562 | 10-23 01:50:33 | 1 | draftkings | 10-23 02:00Z | 1 |
| NHL_2026-10-22_e401892563 | 10-23 01:50:33 | 1 | draftkings | 10-23 02:00Z | 1 |

- **Gap 2, seen working.** The 01:00Z and 02:00Z games were bought at 00:50Z
  and 01:50Z. By then the UTC date was 10-23, whose NHL board does not list
  them; only the 10-22 slate board does. Before this change they could not be
  seen inside their window.
- **Every NHL row of the night** (the cross-check on the rows themselves): all
  12 `NHL_2026-10-22_e*` rows hold a DraftKings line marked verified,
  captured 9.4 to 9.9 minutes before kickoff.
- **Not captured, as expected:** `NBA_2026-10-22_e401909094` (Thunder v
  Nuggets, 01:30Z). The NBA board answers 403 in season
  (`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`).
- **Spend:** `ambientCaptureClosingOdds` 9 credits on 10-22 (3 calls) and 6 on
  10-23 (2 calls), every call reconciled at 3 kept: 5 calls, 15 credits, one
  per kickoff time, for 12 lines.

Done condition 3 (the demand ratio on a closed day with NHL games) is read on
2026-10-24 at 11:07Z for closed day 10-23.

### Done condition 3 — closed day 2026-10-23: PASS

From run 40088714137, the same run as done condition 3 of
`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, which carries
the full table. The odds guard refused nothing on 10-23 (`ceiling_reached_at`
and `month_limit_reached_at` were both null).

- `ambientCaptureClosingOdds` charged above 0 on 10-23: **yes**, 27 credits
  in 9 calls.
- charged/demand: **0.8x** (limit 2x).
- NHL `closing_odds_capture` rows on 10-23: **5**, all `_kickoff.verified = 1`:

| game_id | ts | kickoff |
|---|---|---|
| NHL_2026-10-22_e401892560 | 00:50:13 | 01:00Z |
| NHL_2026-10-22_e401892561 | 00:50:13 | 01:00Z |
| NHL_2026-10-22_e401892562 | 01:50:33 | 02:00Z |
| NHL_2026-10-22_e401892563 | 01:50:33 | 02:00Z |
| NHL_2026-10-23_e401892564 | 23:50:15 | 10-24 00:00Z |

- **NBA: 0 rows, and 7 NBA games on 10-23 got no closing line.** Gap 1's
  fix does poll NBA in October. The board it polls is empty in season, though:
  `/v2/games?sport=nba` answers `nba-cdn-empty` for 10-20 through 10-24. No NBA
  kickoff ever reaches the capture. This CC-CMD's TASK 0 filed that as
  `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`. Once that board lists
  games, nothing more is needed here: harness S18 already buys a due October
  NBA game once.

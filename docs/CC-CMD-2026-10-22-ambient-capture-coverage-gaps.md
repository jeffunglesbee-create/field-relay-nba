# Claude Code Command — AmbientDO cannot see two kinds of kickoff, so their closing lines are never captured

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a designed capture that does not run), and a spend decision
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
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

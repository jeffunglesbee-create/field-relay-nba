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
- Each gap is its own commit.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A harness test, in the style of `scripts/check-ambient-capture-dedup.mjs`,
   for each fixed gap:
   - an October NBA game going live is captured once;
   - a game whose ET-date board is not the UTC-date board is captured once
     at kickoff.
   Each is red at HEAD and green after, with a mutation that restores the gap.
3. A per-consumer demand run (`odds-consumer-demand.yml`) on a closed day
   with NBA or NHL games, showing `ambientCaptureClosingOdds` charged above 0
   for that day, and charged/demand at most 2x.

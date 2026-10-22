# Claude Code Command — a source failover gives a live game a new id, so its closing line is bought twice

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (bounded real vendor spend above need)
**Confidence gate:** >= 95 before any commit
**Status:** SUPERSEDED 2026-10-22 by `docs/CC-CMD-2026-10-22-closing-capture-before-kickoff.md`
(commit `e658b09`), for every case where the first purchase wrote its line.
Before buying, the capture now looks up the archive row by ESPN event id or
names and requires `closing_odds IS NULL`, so a failover id finds no due row
once the line is written (`scripts/check-ambient-capture-write.mjs` W2). What
remains is narrower than this document's case: a purchase that wrote nothing
(no vendor match, or a late line refused) leaves the row empty, and a new id
inside the same 10-minute window could buy once more. That is at most one
extra call per failed capture, and it was not measured. Not dispatched.
**Filed by:** the review of TASK 1 of
`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, Rule 87.4. It
predates that fix, which neither causes it nor makes it worse.

---

## What was found

AmbientDO's capture record (`_gameStarts`, stored as `starts:today`) is keyed by
`game.id`. For MLB and WNBA that id depends on which source served the board:

- **ESPN** (the primary) emits `espn:${ev.id}`.
- **`fetchMlbStatsApiGames`**, the MLB secondary, emits `mlbam:${g.gamePk}`
  (`src/index.js`, the statsapi adapter). Its own comment says these rows
  cannot be matched against ESPN-sourced ones.
- **`fetchWnbaSlateFromKV`**, the WNBA secondary, emits `wnba:${g.gameId}`.

`handleV2Games` switches to the secondary when ESPN answers non-OK or throws
(`_trySecondary`), and back when ESPN recovers.

**Consequence.** A game live across a switch appears under a new id with no
`prev` entry. It reads as newly live and is absent from the record, so its
closing line is bought again, at 3 credits.

**Reproduced by the reviewer** against the real class, on 2026-10-19:
- the board went `espn:401999` live → `mlbam:776001` live (the same game) →
  `espn:401999`;
- captures: `['espn:401999', 'mlbam:776001']`.
- HEAD and the fixed code behave the same.

**Bounded:** at most two purchases per game. Each id is recorded once and kept
24 hours, so flapping does not repeat it.

**When it applies:** only while ESPN MLB or WNBA is failing. Its cost has not
been measured.

## TASK 0 — premises, one command each

1. **The switch changes the id mid-game.** For one past ESPN MLB outage
   (`_v2Source` `mlbam-statsapi` in a response), read `/v2/games` from both
   sources for the same date. Pass if one game appears under both ids.
2. **How often it happens.** Count the outage windows over the last 30 days
   from whatever records `[V2GAMES] ESPN primary failed`. If none can be
   counted, say so; do not estimate.
3. **What `_captureClosingOdds` matches on.** It resolves the archive row by
   teams and time, not by id. Confirm that a second capture under the other
   id writes nothing (`closing_odds IS NULL`) and is billed anyway.

## TASK 1 — decided from TASK 0

- Key the capture record by an identity both sources share. Candidates:
  - sport, plus both team keys (`resolveTeamKey`), plus the kickoff date;
  - or the archive row `_captureClosingOdds` already resolves.
- Keep `game.id` as the key of the scores.
- If TASK 0.2 finds the windows are rare and short, closing this as accepted
  bounded cost is a valid outcome. Record it with the measurement.

## Done condition (Rule 90 artifacts)

1. TASK 0's outputs committed.
2. If built: a scenario in `scripts/check-ambient-capture-dedup.mjs` in which
   a live game's id changes prefix mid-game and back. It must assert exactly
   one capture, be red at HEAD, and be caught by a mutation that restores the
   id key.

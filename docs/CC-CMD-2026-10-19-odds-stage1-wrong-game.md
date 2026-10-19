# Claude Code Command — stage 1 pairs an MLB game with the same teams' next game

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched. TASK 1 needs an owner ruling first.
**Filed by:** CC, from the TASK 0 census of
`docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md` (Rule 87.4). That document
asked whether stage 2 is the only path to a wrong pair. It is not.

---

## What was measured (2026-10-19)

Method: `node scripts/census-odds-pairs.mjs` over
`outbox/fixture-odds-pairs-2026-10-19.json` (776 odds_history rows since
2026-09-16 10:42Z), then D1 SELECTs on the rows it named (0 rows written).

**17 MLB pairs have both team names right and a kickoff 121 to 1740 minutes
away.** Stage 1 pairs on names alone, and a team pair repeats through a series.
The backfill reads one snapshot at 23:59Z, after most of the day's games have
started, so the payload no longer lists the day's game, but it does list the
same two teams' next game.

| class | rows | gaps (min) | example |
|---|---|---|---|
| next day of a series | 12 | 1141 to 1740 | `MLB_2026-09-29_e401907965` Phillies @ Braves took the 09-30 event, 1440 |
| same day, doubleheader | 3 | 206 to 301 | `MLB_2026-09-25_e401817088` and `_e401817073`, Orioles @ Yankees, both on the 23:31Z event |
| same day, start moved (likely) | 2 | 121, 235 | `MLB_2026-09-26_e401817097`, prices 18 / 1.01, captured in play |

**One event, two games.** Stage 1 decides each row against the whole pool, so
nothing stops two archive rows from taking one event. 4 MLB events are stored
against 2 games each. The other 42 shared events in the census are MLS, the
known duplicate archive rows under two id schemes (HANDOFF 2026-09-03). Both of
those duplicates get the right price.

**What reached the game tables.** In 5 of the 17 games, the sync wrote the wrong
row into `closing_odds` (`captured_at` equal to the row's `snapshot_time`):
- `e401817001`, `e401817002`, `e401817004`, `e401907992`, the next-day class;
- `e401817035`, whose `finalized_at` is NULL (a postponement, unverified).

The other 12 games were filled by other writers first.

**The distribution a threshold would need.**
- Correct pairs measured so far reach −130 minutes (CFB Clemson @ LSU).
- The next-day class starts at +1141.
- Doubleheaders and moved starts sit between them, at +121 to +301.

## TASK 0 — premises, one command each (Rule 100)

1. **All sports, not just MLB.** The census covers 2026-09-16 to 10-19. Rerun it
   after the next 7 days of backfill, and list every both-sides pair with a gap
   over 90 minutes.
2. **The postponement.** For `e401817035`, check whether an ESPN makeup id
   (`e401923610` is a candidate) is the same fixture.
3. **Every both-sides pair whose gap is between 90 and 720 minutes,** classed as
   doubleheader, moved start, or neither, by its archive twin and its
   `finalized_at`.

## TASK 1 — refuse the wrong game (OWNER RULING FIRST)

This reverses a standing ruling in `src/odds-name-match.js`'s header: "THE
KICKOFF INSTANT IS NOT A KEY … never as a filter". Options for the owner:
- (a) **Refuse when the gap exceeds N.** N comes from TASK 0. On today's data, 12
  hours separates every correct pair (≤ 130 min) from every next-day pair
  (≥ 1141).
- (b) **Claim check in stage 1.** One event may pair with one game only;
  otherwise both are refused. This handles the doubleheaders without any
  kickoff, but not the next-day class.
- (c) Both.

Proof: real fixtures from the census, red before and green after. Rule 90
mutations. Every existing case in `scripts/check-odds-matcher.mjs` stays as it is.

## TASK 2 — repair (OWNER DECISION)

The 5 `closing_odds` blobs above and the 17 odds_history rows, by the same
pattern as `scripts/repair-odds-wrong-pairs.mjs`: guarded on the blob having been
written from the row, with a `change_log` row each.

## Done condition (Rule 89 artifacts)

1. TASK 0's outputs are committed, each with its denominator.
2. Fixtures red before and green after, plus mutations, in a committed log.
3. After TASK 2, a D1 SELECT on each repaired id. Committed.
4. One green deploy-path run.

## FORBIDDEN

- No change to the kickoff ruling without the owner.
- No D1 write before the owner rules on TASK 2.
- No Odds API spend.

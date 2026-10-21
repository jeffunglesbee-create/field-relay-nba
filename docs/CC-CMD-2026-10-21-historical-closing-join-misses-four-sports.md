# Claude Code Command — the historical closing path pays for four sports it can never write

**Date:** 2026-10-21
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a fetch that cannot produce its write)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the per-consumer demand measurement
(`docs/CC-CMD-2026-09-16-odds-spend-attribution.md` Task 2). Rule 87.4: found
in its adversarial review, outside its scope.
**Related:** `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md`
(FILED) already covers CFB's join. This document covers the shared cause in
all four sports and what it costs.

---

## What was measured (2026-10-21)

The `/archive/game` closing path checks three things before it writes a closing
line: the row is final, it has no `closing_odds`, and it has no `inplay_odds`.
It then calls `fetchSportOddsHistorical` (30 credits) and writes only if
`findOddsForRow` (`src/odds-join.js`) matches the archive's home and away names
to a vendor event.

For NBA, NHL, NFL and CFB the match never succeeds, but the fetch is still made
and paid for.

- **The join, run on real names.** The real `indexOddsByPair` and
  `findOddsForRow` were run on the vendor names in `odds_history` against the
  archive's names for the same games, 2026-10-15 to 2026-10-20. Matches by sport:

  | sport | matched |
  |---|---|
  | NHL | 0 of 11 (e.g. 'Columbus Blue Jackets' against 'Blue Jackets') |
  | CFB | 0 of 4 |
  | NFL | 0 of 2 |
  | NBA | 0 of 2 |
  | MLB | 1 of 1 |
  | CFL | 1 of 1 |
  | WNBA | 1 of 1 |
  | MLS | 2 of 2 |

- **The path's own record agrees.** `archive_game_closing` writes in change_log
  since 2026-09-01: MLB 320, MLS 104, WNBA 44, EPL 37, Serie A 28, La Liga 23,
  CFL 22, Ligue 1 13, Bundesliga 2. NBA, NHL, NFL and CFB have 0, across seven
  weeks of NFL and CFB play.
- **The cost.** Over 2026-10-14 to 2026-10-20, 19 of the path's 48 demand
  units were in these four sports. That is 570 of its 1,620 charged credits,
  and they bought nothing it could write.

Those four sports' closing lines arrive the next day from odds-backfill, which
runs in CI and calls the vendor directly.

`scripts/measure-odds-consumer-demand.mjs` keeps these units out of demand
through a dated constant, `JOIN_UNWRITABLE`, and prints them as "unwritable".

## TASK 0 — premises, one command each (Rule 100)

1. **The cause of the miss.** For the 19 games in the table above, log what
   `resolveTeamKeyIn(archiveName, vendorKeys)` returns. It is the archive's
   short name against the vendor's full name, or something else.
2. **Who owns the name.** Read the archive writers for these four sports and
   record which one stores the short name, and whether the client reads it.
3. **The leak is the fetch, not the join.** Count the 30-credit fetches this
   path made for the four sports over 14 days. This uses the change_log
   absence above, and the reconcile tally for fetchSportOddsHistorical.

## TASK 1 — decided from TASK 0

There are two shapes, and the owner picks between them:

- **(a) Make the join match.** For example, resolve the archive name through
  the identity resolver's alias table. Then the 30 credits buy a line.
- **(b) Do not fetch.** Skip a sport the join cannot serve. Its closing line
  already arrives from odds-backfill. This saves about 570 credits a week at
  October volume.

Either way, `JOIN_UNWRITABLE` is removed from
`scripts/measure-odds-consumer-demand.mjs` in the same change.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. **(a):** a test feeding the 19 real name pairs through `findOddsForRow`. It
   is red at HEAD and green after, with a mutation that restores the miss.
   **(b):** a check that the path makes no historical fetch for an unservable
   sport, with its mutation.
3. A per-consumer demand run whose fetchSportOddsHistorical "unwritable" line
   reads 0 credits, because the join now writes or the fetch is no longer made.

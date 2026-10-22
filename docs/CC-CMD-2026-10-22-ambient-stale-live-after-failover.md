# Claude Code Command — a game whose source fails over can stay "live" in AmbientDO for six hours

**Date:** 2026-10-22
**Repo:** field-relay-nba (client consumer in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a stale view; no spend)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`, TASK 1's
third item ("stale live views"), which was not built there (Rule 87.4).

---

## What is known, and what is not

- AmbientDO keeps a score entry for 6 hours after the last board that listed it
  (`SCORES_KEEP_MS`), so a blink or a failed fetch cannot drop a game still
  being played. The entry keeps its last reading. While it reads `live`, it is
  served as live in `/ambient/state` `liveGames` and in the SSE `connected`
  payload, and the client's `connected` handler writes that score into the
  card.
- **Cause 1, the date turn: removed.** AmbientDO now reads the ET slate held
  until 4am ET (gap 2 of the coverage-gaps CC-CMD), so a game live at 00:00Z
  stays on its board until it reads final.
- **Cause 2, a source failover: NOT TESTED (Rule 100).** The coverage-gaps
  CC-CMD recorded, from its first review, that an MLB or WNBA failover gives
  the game a new id (`mlbam:`, `wnba:` instead of `espn:`), so the abandoned
  id is never listed again and stays `live` for up to 6 hours. Nobody has
  observed it. MLB and WNBA are out of season after the World Series, so the
  next chance to observe it is spring 2027.

## TASK 0 — test the premise before building

1. In `src/index.js`, find where /v2/games switches MLB and WNBA to their
   secondary source, and confirm whether the secondary's game ids differ from
   the primary's for the same game (`adaptMlbStatsApi` versus `adaptESPNMLB`).
2. Run the real AmbientDO class (as `scripts/check-ambient-capture-dedup.mjs`
   does) with an MLB board that lists `espn:<n>` live and then lists the same
   game as `mlbam:<m>`. Record how long `espn:<n>` is served in `liveGames`.
3. If both hold, read jubilant-bassoon `src/legacy/field.js`'s `connected`
   handler and CONTRACTS.md (Rule 86) before choosing between:
   - leaving out of `liveGames` and `connected` an entry no board has listed
     for more than about 2 x `POLL_IDLE_MS`, while keeping it in `_scores` for
     the capture record and `all_final`; or
   - marking such an entry `stale` in the payload, if the client can use it.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed here, each with its command.
2. If built: a harness scenario that is red before and green after, in which
   the abandoned id is absent from `liveGames` and `connected` after three
   polls and present in `_scores`, with a mutation that restores it.
3. If TASK 0 refutes the premise: Status WITHDRAWN, with the command that
   refuted it.

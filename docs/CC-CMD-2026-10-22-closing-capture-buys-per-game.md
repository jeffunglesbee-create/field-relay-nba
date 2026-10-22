# Claude Code Command — the closing capture buys one call per game, though one call covers the whole sport

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (real vendor spend above need)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the second review of TASK 1 of
`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, Rule 87.4. It
predates that fix, which leaves it unchanged.

---

## What was found

AmbientDO's capture loop awaits `_captureClosingOdds` once for each game that
went live in the poll (`pendingStarts`). Each call:
- charges `oddsCreditCost(url)`, which is 3 credits;
- fetches `/v4/sports/${oddsKey}/odds` with `cacheTtl` 0.

That URL depends on the sport, not on the game, and one response carries the
whole sport. The per-consumer demand measurement defines need on that basis:
one call per distinct (sport, kickoff instant).

**Reproduced by the reviewer** against the real class and the real
`_captureClosingOdds`, with a mock fetch counting vendor URLs:
- six EPL games went live in one poll;
- HEAD and the fixed code each made 6 calls to `soccer_epl/odds` (18
  credits);
- the need was 3.

**Why it matters for the 10-21 CC-CMD.** Its done condition 3 asks
charged/demand to fall to at most 2x. Even with exactly one purchase per game,
a day whose games share kickoff instants sits above that. 10-15 had 24 games
and a need of 33 (11 instants), so perfect per-game dedup gives 72/33 = 2.18x.
That figure is an upper bound: the demand script's game count includes NBA and
NHL, which AmbientDO does not poll in October.

## TASK 0 — premises, one command each

1. **One response covers every game of the sport at that instant.** Read one
   capture's vendor response (or the D1 rows written from it) for a poll with
   two or more games of one sport kicking off together. Pass if every one of
   them is matched.
2. **How much it costs.** From the archive, for 2026-10-14..20, compute
   3 × (games − distinct (sport, kickoff instant)) for AmbientDO's polled
   sports. This is the spend the grouping saves.

## TASK 1 — decided from TASK 0

- Group `pendingStarts` by sport.
- Make one charged call per sport per poll, and match every pending game of
  that sport against that one response.
- Keep each game's failure isolated in the matching step. That isolation is
  what the per-game loop's comment says it exists for.
- The capture record (`starts:today`) still records each game.

## Done condition (Rule 90 artifacts)

1. TASK 0's outputs committed.
2. A scenario in `scripts/check-ambient-capture-dedup.mjs`, with a counting
   vendor fetch, in which N games of one sport go live in one poll. It must
   assert one vendor call and N matched games, be red at HEAD, and be caught
   by a mutation that restores the per-game call.
3. A per-consumer demand run on a closed day after the deploy, with
   `ambientCaptureClosingOdds` charged/demand at most 1.5x.

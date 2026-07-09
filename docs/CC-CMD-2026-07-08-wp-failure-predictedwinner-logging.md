# CC-CMD: Log predictedWinner on WP resolution failures — makes future failures actually traceable

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Independently found twice tonight, from two different angles. First:
investigating why `resolveWinProbability` returned null for two MLB
picks (`g42`, `g28`), the trail led to `teamNameMatch()`'s dependency on
`resolveTeamKey()` as a *plausible* cause — but it couldn't be confirmed
because `_recordWpResolutionFailure` never logs `predictedWinner`, the
one field that would show which team string was actually being matched.
(That specific incident turned out to be fully explained by an unrelated
client-side volatile-ID bug, already fixed and closed — this CC-CMD is
not about that incident.)

Second, tonight, separately: a session trying to retroactively identify
which real game `g28`/`g42` corresponded to correctly concluded it
couldn't be done — `predictedWinner` lives only in the specific user's
private `UserDO` pick ledger, inaccessible without a user ID that isn't
recorded anywhere in the incident log, and with 12-13 MLB games/day and
no team name to filter on, guessing would be worse than admitting the
limit. That session correctly declined to build a "look up any UserDO's
pick ledger by ID" feature to solve it — rightly identifying that as a
separate, heavier, speculative feature question, not something to bolt
on to a diagnostic gap.

**This CC-CMD is the actual minimal fix both investigations converged
on without either one proposing it: `predictedWinner` is already in
scope, unlogged, at every failure site.** Confirmed via direct read of
all three call sites inside the `pick_resolved` handler — each one has
direct access to `pick`, and `pick.predictedWinner` is sitting right
there. No new lookup, no new endpoint, no user-ID exposure — purely
logging one more field that's already available at the moment of
failure, using the exact extensible-opts pattern this function already
has for `codexKey`/`titleLabel`.

**Deliberately not doing:** anything resembling a UserDO-pick-ledger
lookup-by-ID feature, or logging any form of user identifier (obfuscated
or not) — both correctly identified as separate, bigger scope by the
session that found this gap. This stays scoped to exactly the one field
that makes a future failure's *game/team* traceable, not who made the pick.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "async function _recordWpResolutionFailure" -A20 src/user-do.js
# Re-confirm the exact current signature and recent[] construction
# before editing — this doc's citation may be stale.

grep -n "_recordWpResolutionFailure(" src/user-do.js
# Re-confirm all current call sites (3 expected: sport-label-drift
# branch, generic null-return branch, catch-block branch) and confirm
# `pick` is genuinely in scope at each one — don't assume from this doc.
```

## TASK 1 — Add predictedWinner to the failure record

In `_recordWpResolutionFailure`, destructure `predictedWinner` from
`opts` alongside the existing `codexKey`/`titleLabel`. Include it in the
`recent[]` entry only when present (don't write a literal `undefined`
into stored JSON — omit the key entirely when not provided, so old
entries and new entries both parse cleanly and neither implies false
precision about entries that predate this change).

## TASK 2 — Pass it at all three call sites

Update all three `_recordWpResolutionFailure(...)` calls inside the
`pick_resolved` handler to pass `pick.predictedWinner` via the opts
object, merging with existing `{codexKey, titleLabel}` where those are
already passed (the sport-label-drift branch) and adding a fresh opts
object where none currently exists (the other two branches).

## TASK 3 — Live verification

Confirm via a real D1 read that the `wp-resolution-failures` and
`wp-sport-label-drift` codex rows still parse correctly (existing
`recent[]` entries from before this change have no `predictedWinner`
key — confirm reading them doesn't error). Construct a real test
scenario that triggers `_recordWpResolutionFailure` with a known
`predictedWinner` value and confirm the resulting stored `recent[]`
entry actually contains it — not just that the code doesn't throw, that
the field is genuinely present and correct in the persisted D1 row.
Clean up any test-triggered codex entries afterward if a synthetic key
was used, or confirm real keys weren't polluted with test data if not.

## DONE CONDITIONS

- [x] `predictedWinner` added to `_recordWpResolutionFailure`'s opts,
      included in `recent[]` only when present
- [x] All three call sites updated, `pick.predictedWinner` confirmed
      genuinely in scope at each (not assumed)
- [x] Existing pre-change codex entries confirmed to still parse without
      error
- [x] Real test scenario proves the field lands correctly in persisted
      D1 data, not just that the code runs

## CONFIDENCE SCORING

- +25 — recent[] construction correct, no undefined keys written
- +30 — all three call sites correctly updated, pick.predictedWinner
  confirmed in scope at each via direct read
- +30 — real test proves the field persists correctly in D1, not
  asserted from code reading alone
- +15 — existing pre-change entries confirmed to still parse cleanly

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-wp-failure-predictedwinner-logging.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

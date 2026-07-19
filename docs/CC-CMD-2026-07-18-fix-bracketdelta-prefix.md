# CC-CMD — Fix bracket_delta game_id prefix mismatch (real WC match confirmed the gap live)

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT — real, live-confirmed gap, not theoretical

The WC 3rd-place match (France vs. England, `espn:760516`) concluded tonight, giving Gap 7 its first real, live E2E test. A real `bracket_delta` row genuinely exists in D1:
```
id: bracket_delta:espn:760516:2026-07-18T23:02:33.093Z
game_id: espn:760516
```

But a direct probe of `/context/game/espn:760516` shows `bracketDelta: null` — the real chain is broken at the read step, not the write step.

**Root cause, confirmed via direct D1 query:** `regular_season_games.espn_event_id = '760516'` — bare, no prefix. `findBracketDelta`'s caller computes `briefId = game?.espn_event_id || id`, which evaluates to the bare `'760516'`. But the real `bracket_delta` row's `game_id` was written as `'espn:760516'` — *with* the prefix, by GameDO's own write path. The exact-match query in `findBracketDelta` (`WHERE game_id = ?`) never matches.

**This is the same class of prefix inconsistency the rest of tonight's saga already fixed for `game_recap`/`pre_game` briefs — GameDO's `bracket_delta` write path apparently never got the same normalization.**

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
# Find the real, current GameDO write path for bracket_delta
grep -n "bracket_delta" src/bracket-do.js
# Confirm the real, exact game_id value being bound in that INSERT/write
```

Confirm the real, current write site before assuming its exact form — the spec's own earlier reference (`triggerResult.gameId`) may or may not already carry the prefix; verify directly rather than assume.

---

## TASK 1 — Real, direct confirmation of the write-side value

Find the exact real code in `src/bracket-do.js` that writes the `bracket_delta` brief's `game_id`. Confirm whether it's genuinely sourced from something that already includes the `espn:` prefix (e.g., a client-supplied `contextId`-style value) or whether the prefix is being added somewhere in the write path itself.

## TASK 2 — Fix at the write side to match the established bare-ID convention

`regular_season_games`/`postseason_games.espn_event_id`, and `game_recap`/`pre_game` briefs' `game_id`, are all genuinely bare (no prefix) — this is the established, working convention the rest of the chain already relies on. Strip any `espn:`/similar prefix before writing `bracket_delta`'s `game_id`, matching that same convention.

**Do not fix this by changing the read side (`findBracketDelta` or its caller) unless TASK 1 reveals the write side genuinely can't be changed** — the established pattern tonight has been to fix ID format inconsistencies at their source, not accumulate special-case handling on every reader.

## TASK 3 — Real, literal verification

```bash
grep -n "game_id.*bracket_delta\|bracket_delta.*game_id" src/bracket-do.js
```
Paste real output confirming the real, corrected value being written.

## TASK 4 — Real backfill decision for the one existing broken row

The one real `bracket_delta` row from tonight's actual match (`game_id: 'espn:760516'`) will still be broken under the old, prefixed form even after this fix — new rows going forward will be correct, but this specific one won't retroactively match unless also corrected. Given this is exactly one row, a real, direct `UPDATE` correcting its `game_id` to the bare form is reasonable — but confirm this is genuinely the only affected row before doing so (re-run the same query used to find it originally).

## TASK 5 — Real, live verification against the actual real match

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/context/game/espn:760516"
```
Confirm `bracketDelta` is now genuinely non-null and contains the real, expected shape (`shifts[]`, `significant`, etc.) — this is the actual real E2E test Gap 7 has been waiting on all night, now finally possible.

---

## DONE CONDITION

`bracket_delta` writes use the same bare-ID convention as the rest of the archive going forward, the one existing real row from tonight's actual match is corrected (if confirmed to be the only one), and a real, live probe against `espn:760516` confirms `bracketDelta` is genuinely populated — the actual, final proof of Gap 7's entire chain working end to end.

**Confidence scoring:**
- TASK 1 (15 pts): real confirmation of the write-side source
- TASK 2 (35 pts): real fix at the write side, matching the established bare-ID convention
- TASK 3 (15 pts): real literal verification
- TASK 4 (15 pts): real, confirmed-scope backfill of the one existing row
- TASK 5 (20 pts): real, live probe confirms bracketDelta genuinely populated for the real match

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

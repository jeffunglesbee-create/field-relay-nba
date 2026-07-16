# Claude Code Command — /archive/game upsert doesn't refresh home/away on conflict

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/archive-game-upsert-team-refresh-2026-07-16.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`CC-CMD-2026-07-15-archive-game-series-upsert-key` (commit `d6b03e8`) fixed `/archive/game`'s duplicate-row bug for `series_key`-scoped ties — a placeholder-to-real-name transition now correctly updates the existing row instead of inserting a new one. That same dispatch's own live write-twice test surfaced and honestly disclosed a real, separate, pre-existing gap: the `ON CONFLICT(id) DO UPDATE SET` clause does not include `home`/`away` in its column list. Confirmed via direct code read at the time — this is not something the upsert-key fix introduced, and not something it was scoped to fix.

**Real, current status, checked live before writing this dispatch:** zero rows right now show a `TBC`-style placeholder name alongside a non-null score — the gap is structurally real but not yet visibly affecting any live data, since most brackets resolved before the upsert-key fix shipped. It will become visible the next time a bracket slot transitions from a placeholder to a real name post-fix, which hasn't happened yet.

## TASK 0 — Probe

Re-read the current `/archive/game` handler in full (`src/index.js`, `~L9531` per the prior dispatch — re-confirm the real current line number, it will have drifted). Confirm the exact current `ON CONFLICT` column list. Before assuming "just add home/away to the UPDATE SET list" is safe: check what happens on a conflict where the incoming write has empty/null `home`/`away` (a malformed or partial payload) — would blindly adding these columns to the UPDATE clause risk overwriting a real, already-correct team name with a blank one on some other caller's incomplete write? Check whether any real caller (enumerated in the prior dispatch: `game-do.js` GameDO write, `ARCHIVE-CATCHUP`, `ARCHIVE-SEED`, `ARCHIVE-YDAY`, jubilant-bassoon's MLS seed script) ever legitimately sends a conflict-triggering write with missing team names, or whether this is a purely hypothetical risk not worth guarding against in practice.

## TASK 1 — Fix

If TASK 0 finds the blank-overwrite risk is real for at least one caller: add `home`/`away` to the `ON CONFLICT ... DO UPDATE SET` clause, but guard with a `COALESCE`-style pattern (`home = CASE WHEN excluded.home != '' THEN excluded.home ELSE home END` or the SQLite-idiomatic equivalent) so an empty/null incoming value never clobbers an existing real name — matching this repo's own established `COALESCE`-on-conflict convention if one already exists elsewhere in this file (check before inventing a new pattern, per Rule 62).

If TASK 0 finds the risk is purely hypothetical (every real caller always sends real team names on any write that could conflict): a plain, unguarded `home`/`away` addition to the UPDATE SET list is sufficient — say so explicitly with the evidence, don't add unnecessary defensive complexity for a risk that doesn't exist in practice.

## TASK 2 — Verify

Real forced-condition test: a conflict where the incoming write has real, different team names than the existing row — confirm the row now updates to the new names (the actual bug being fixed). If a guard was added: a second forced test with an empty/null incoming team name on a real conflict — confirm the existing real name is preserved, not blanked. Real live write-twice test against the deployed relay (disposable test `series_key`, cleaned up after), mirroring the prior dispatch's own verification style, confirming the specific behavior end-to-end.

## DONE CONDITION

A `series_key`-scoped row whose team names change on a conflict-triggered write correctly reflects the new names — closing the gap the prior dispatch found and disclosed but didn't fix. If a blank-overwrite risk was found real, it's guarded against; if not, that's stated with real evidence, not assumed either way.

**Confidence scoring:**
- TASK 0 (35 pts): re-confirms the real current handler, correctly determines whether the blank-overwrite risk is real or hypothetical for actual callers, not guessed
- TASK 1 (35 pts): fix matches TASK 0's real finding — guarded if the risk is real, simple if it isn't, reuses an existing convention if one exists
- TASK 2 (30 pts): real forced tests for both the fix and (if applicable) the guard, real live verification against the deployed relay

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

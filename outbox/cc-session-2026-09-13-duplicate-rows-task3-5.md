# CC-CMD-2026-09-13-archive-duplicate-rows — Tasks 3, 4, 5

## Task 4 done condition — met, measured

`outbox/identity-ambiguity-watch-20260914T011040Z.json`, archive-wide:

```
coverage:    scanned 3155 of 3155 rows across 2 tables   (was 3237)
rows_total   3237 -> 3155   = -82 exactly
collisions    197 ->  115   = -82 exactly

DONE  hullcity claimed by one family                   -> one family
DONE  no substituted name reaches another sport's club -> 0 failing of 123 probed
OPEN  no two rows on one slate share a join key        -> 115
```

Both deltas are exactly 82. Nothing beyond the enumerated set was removed.

The remaining 115 account for themselves against the plan's 115 skipped:

| n | table / sport | why it stayed |
|---:|---|---|
| 82 | postseason MLS | HUMAN — identical scores, same `series_key`, no ESPN id; nothing distinguishes them |
| 32 | regular MLS | merge pairs, held back on the owner's "82 only" |
| 1 | regular MLB | the 2026-09-04 Guardians–Tigers doubleheader; two real games |

## Task 3 — what was done

Owner approval 2026-09-13: "Task 3 approved, 82 deletes and 32 merges", narrowed
the same day to **"82 only"** once the merge pairs were shown to keep the
worse-named row.

| step | result |
|---|---|
| live plan | 82 deletes, 0 merges, 115 skipped — matched the approved 82/0 |
| brief join safety | 0 rows in the delete set referenced by a brief |
| deletes | 82, `regular_season_games`, by explicit id |
| change_log | **failed**, then repaired — 82 entries |
| re-census | −82 rows, −82 collisions |

Merges were refused inside `buildPlan`, not filtered by the caller: the delete
list it returns cannot contain a merge pair at all.

## The run failed after the deletes, and that is the part worth keeping

```
--- 4. deletes (82)
    regular_season_games: 82 row(s)
--- 4b. change_log
FAILED: D1_ERROR: too many SQL variables at offset 414
```

40 rows x 6 columns is 240 bound parameters against D1's cap of 100. **The
archive changed and the record of the change did not**, because the failure
landed between them. The done-condition re-census never ran either, so the run
reported failure while having done most of its work correctly.

The delete in the same script batched **50** and was fine — it binds one
parameter per row. So the defect is not "the chunk was too big". It is **"the
chunk size was a constant that did not know its column count"**, which is why
the cap is now `Math.floor(D1_MAX_BOUND_PARAMS / COLUMNS)` in both places and
why `scripts/check-d1-batch-param-cap.mjs` requires that form. It finds its
sites **by shape** rather than from a list, so a new multi-row INSERT cannot
appear without the check seeing it.

### The repair

`scripts/repair-collision-cleanup-changelog.mjs`, from two committed artifacts —
the run's own failure log for ids and keepers, the keeper table for the display
names those rows carried before they went:

```
parsed 82 DELETE line(s)
names recovered for 82 of 82
still present: 0
change_log entries already present for this source: 0
wrote 82 change_log entries in chunks of 16
change_log now holds 82 entries for this source
```

It refuses any id that still exists — an entry claiming a deletion that did not
happen is worse than a missing entry — and refuses to write twice. It can INSERT
into `change_log` and nothing else.

## Why the names were recoverable at all

In all 32 merge pairs the row being **deleted** carries the better display names
(`Austin FC` against the keeper's `Austin`). `LOSS_BEARING` cannot see that:
both rows have names, neither is absent, so it is a quality difference rather
than a loss. That was caught before the apply, `change_log.old_value` was widened
to carry the deleted row's names, and the owner then held the 32 back entirely.
The 82 that did go are recorded with their names regardless.

## Gates added across Tasks 3-5

| check | assertions | mutations |
|---|---:|---:|
| `check-collision-cleanup-plan.mjs` | 22 | 9, all caught |
| `check-duplicate-row-keeper-table.mjs` | 26 | 10, all caught |
| `check-d1-batch-param-cap.mjs` | 9 | — (asserts a form, not a behaviour) |

The mutations worth naming: **C9** deletes a merge pair with its odds copied
nowhere; **C2** needs a doubleheader *mid-day* — game 1 final, game 2 unplayed —
because with two results the disagreeing-scores rule already covers it and the
population rule looks redundant.

## Residual

**115 collisions remain, all accounted for, none of them a defect in this pass.**

1. **32 MLS merge pairs** — need a name-aware merge that prefers the longer team
   name. Not approved, not attempted.
2. **82 postseason MLS** — indistinguishable in every field the census carries.
   50 of the brief-carrying rows are the legacy name-scheme side, so a keeper
   decision means repointing `briefs.game_id`, not deleting.
3. **1 doubleheader** — not a duplicate. It also shows `byPair` cannot tell
   game 1 from game 2, so one of its two opening lines is on the wrong game.
4. **The external writer keeps inserting.** 99 dash-scheme collisions spanned
   2026-07-22 to 09-13; 82 are gone and tomorrow's will arrive. This repository
   cannot write that shape, so nothing here stops it.

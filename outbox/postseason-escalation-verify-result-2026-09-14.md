# The 82 postseason escalations — verified, and the verdict was wrong

Read-only. Nothing changed. Artifact:
`outbox/postseason-escalation-verify-2026-09-14T10-42-45-171Z.json`.

## What the keeper table said

> both scored with identical scores and neither carry an `espn_event_id` —
> **nothing distinguishes them**

## What the rows say

That was formed from the census's **19-field projection**.
`postseason_games` has **27 columns**. Read in full, all 82 pairs:

| | columns |
|---|---|
| differ in **all 82** | `id`, `created_at`, `finalized_at` |
| differ in some | **none** |
| identical or both-null | the other 24 |

**So "nothing distinguishes them" is false about the row and true about the
content.** Every fact anyone would read off these games — teams, score, date,
round, `series_key`, `game_number`, league, venue — is identical. What differs
is when each row was written.

## And the direction is unanimous

```
created_at,   newer row is:  key-scheme  82 / 82
finalized_at, later row is:  key-scheme  82 / 82

created_at by scheme:   key-scheme    2026-07-16   82
                        name-scheme   2026-07-15   78
                        name-scheme   2026-06-30    4
```

The key-scheme rows land in one bulk write at `2026-07-16 12:23` — the same
import the 2026-08-08 session identified, matching its measurement of that
window. The name-scheme siblings come from two earlier imports.

**`finalized_at` adds nothing.** On both rows it equals `created_at` to the
second, so it was stamped at insert rather than at the game's resolution. Two
columns differ; one discriminator.

## Why this still is not a delete

`created_at` identifies the current-convention row in all 82 pairs. It does not
make removing the other one safe:

```
brief on the OLDER name-scheme row only :  49
brief on the NEWER key-scheme row only  :   1
brief on both                           :   1
brief on neither                        :  31
```

**In 49 of 82, the brief points at the row the convention says to drop.**
`briefs.game_id` joins `games.id` in `src/analytics-engine.js`, so deleting
those orphans a brief. The convention-correct row and the brief-referenced row
are opposite sides in 60% of the set.

`change_log` holds **zero** entries for any of these 164 ids, so there is no
write provenance to appeal to beyond `created_at` itself.

## What this changes

1. **The escalation reason is corrected.** Not "nothing distinguishes them" —
   *"the rows are identical in content; only write time differs, and the
   convention-correct row is usually not the one the briefs point at."*
2. **31 pairs are now decidable** on `created_at` with no brief to repoint. They
   were never a human judgement; the projection just could not see the column.
3. **49 need a repoint, not a delete** — `briefs.game_id` moved to the keeper
   first, then the stale row removed. That is a different operation with a
   different risk, and it is not authorised.
4. **2 are genuinely awkward** — one with the brief on the newer row, one with
   briefs on both.

## The general point

A verdict of "nothing distinguishes them" was reported from a projection that
carried 19 of 27 columns. The missing column was the answer. This is the fourth
instance in this session of reading a copy and reporting on the source — after
the 2026-08-10 probe's table-and-window scope, the keeper rule that picked the
malformed row, and the abort-form claim. The pattern is not carelessness about
any one of them; it is that a projection is convenient and a row is not.

# CC-CMD-2026-08-10-pre-window-mls-duplicates

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

`CC-CMD-2026-08-09-cleanup-stale-duplicate-rows` deleted the 60 stale
name-scheme rows it enumerated, and its done condition is met:
`duplicate groups: 0` and `name-scheme ids WITH a series_key : 0`
(`outbox/duplicate-fixture-probe-*.log`, 2026-08-10T02:58:46Z).

Both of those measurements are scoped to **2026-07-25..08-15**, because
that is the window the original investigation measured. A repo-wide check
run after the delete (`outbox/verify-duplicate-cleanup-*.log`) found the
window is clean and the rest of the season is not:

```
2. duplicate groups, REPO-WIDE : 82
```

All 82 are MLS, all `n=2`, and every one is dated **before** the cleaned
window — 2026-02-04 through 2026-07-14. None of them was in the delete
set, and the cleanup CC-CMD explicitly forbade touching rows outside its
enumeration, so they were correctly left alone. They are a separate
population that no CC-CMD has measured.

This is written as its own CC-CMD rather than a carry-forward note
because deleting rows requires the same enumerate-and-gate treatment the
first cleanup got, and inheriting that cleanup's predicate on an
unmeasured population is exactly the assumption Rule 3 forbids.

## Task 1 — measure the mechanism before proposing a fix

Do NOT assume these are the same migration shape as the 55. Run
`scripts/duplicate-fixture-probe.mjs` with its window widened to the full
season (a new script; do not edit the existing probe, which is the
artifact of a closed CC-CMD) and record, for every row in every group:

- id scheme (does `id` contain `series_key`?)
- `series_key` present or NULL
- `home_score` / `away_score`
- `created_at`
- `espn_event_id`

**Artifact:** the per-row dump plus a tally of the three shapes
(key-scheme / name-scheme-with-key / name-scheme-no-key) and the
`created_at` clusters.

**The discriminating question:** are both siblings unscored, or is one
scored? The 55 were all "one scored key-scheme row, one permanently
unscored name-scheme row" — a resolved fixture with an orphan. If these
groups instead hold **two scored rows**, they are not orphans and
deleting either would destroy a real result. Report and STOP in that
case.

## Task 2 — the join-safety check, re-run on this population

```sql
SELECT COUNT(*) FROM briefs b
  JOIN postseason_games g ON b.game_id = g.id
 WHERE g.date < '2026-07-25'
   AND g.series_key IS NOT NULL
   AND instr(g.id, g.series_key) = 0
   AND g.home_score IS NULL
```

**If it is not 0, STOP.** These rows are older than the cleaned window
and have had far longer to be referenced, so a non-zero answer here is
more likely than it was for the 55.

## Task 3 — only if Tasks 1 and 2 both clear

Enumerate, then delete, reusing the shape of
`scripts/run-duplicate-row-cleanup.mjs`: one predicate constant shared by
the SELECT and the DELETE, `meta.changes` asserted equal to the
enumerated count, and a survivor count measured over the same date range
as the delete set — **not** a window-scoped total. Mixing those two
scopes is what made the first cleanup report FAIL on a correct delete.

## Known separate finding — two rows that are NOT part of this

The repo-wide check also found exactly 2 rows matching
"name-scheme id + series_key present + unscored" that the cleanup did not
delete:

```
MLS_2026-09-01_forgefc_tbcaway
MLS_2026-09-15_tbchome_forgefc
```

They were correctly excluded: the predicate requires a key-scheme sibling
sharing `(sport, date, home, away)`, and these carry placeholder team
names (`TBC Home`, `TBC Away`) that match no sibling tuple. They are
unresolved bracket placeholders, not orphans of a resolved fixture.
Recorded so a future session does not treat them as leftovers of the
cleanup. Do not delete them under this CC-CMD.

## Explicitly NOT in scope

- Do not touch 2026-07-25..08-15 — that window is clean and closed.
- Do not implement read-time dedupe on `(sport, date, home, away)`. See
  the hazard recorded in
  `outbox/cc-session-2026-08-10-cleanup-stale-duplicate-rows.md`.
- Do not change the id-construction ternary.

## Outbox

`outbox/cc-session-2026-08-10-pre-window-mls-duplicates.md`.
